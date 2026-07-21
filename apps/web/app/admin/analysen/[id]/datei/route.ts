/**
 * `GET /admin/analysen/[id]/datei` — die archivierte Ursprungsdatei, entpackt und geprüft (B14-2).
 *
 * ── WARUM DAS EINE EIGENE ADRESSE IST ────────────────────────────────────────────────────────────
 * `public.admin_get_analysis_source` ist in B14-1 bewusst vom Detail-Wrapper getrennt: ein
 * Seitenaufruf soll nicht nebenbei und unbemerkt mehrere hundert Kilobyte Archivdaten mitziehen.
 * Diese Route ist die Entsprechung im Anwendungscode — der Blob fliesst nur auf ausdrückliche
 * Anforderung, und dass es ein eigener Aufruf ist, macht die Kosten an der Aufrufstelle sichtbar.
 *
 * ── KEIN service_role ────────────────────────────────────────────────────────────────────────────
 * Der Wrapper ist SECURITY DEFINER mit `platform.is_admin()`-Prüfung und ausschliesslich an
 * `authenticated` gegrantet. Der gesamte Weg läuft damit unter der ANGEMELDETEN Sitzung; die
 * Erlaubnisliste in der root-`eslint.config.mjs` bleibt unverändert (Muster der Export-Route, B2-1).
 *
 * ── DIE PRÜFSUMME WIRD BEIM AUSLIEFERN GEPRÜFT, NICHT NUR BEIM SCHREIBEN ────────────────────────
 * `unpackSourceFile` entpackt UND vergleicht gegen die gespeicherte Prüfsumme. Weicht sie ab, kommt
 * ein Fehler und keine Datei. Eine archivierte Datei, die niemand mehr gegen ihre Prüfsumme hält,
 * ist eine Datei ohne Beleg — und der Schaden fiele erst dann auf, wenn sie gebraucht wird (2027).
 */
import { NextResponse } from 'next/server'
import { unpackSourceFile } from 'shared'
import { createClient } from '@/lib/supabase/server'
import { ANMELDEN_HREF } from '@/lib/auth/config'
import { readAnalysisSource, readStatus } from '@/lib/admin/analyses'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Text/plain und knapp: hier liest kein Browser eine gestaltete Seite, hier lädt jemand eine Datei. */
function problem(message: string, status: number): Response {
  return new NextResponse(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

/**
 * base64 → Bytes. `atob` steht in jeder Laufzeit zur Verfügung, die Next unterstützt, und braucht
 * kein `Buffer` — das hielte die Route unnötig an Node gebunden.
 */
function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

/** Dateiname für `content-disposition` — Anführungszeichen und Steuerzeichen fliegen raus. */
function safeFileName(name: string): string {
  const cleaned = name.replace(/[\r\n"\\]/g, '').trim()
  return cleaned === '' ? 'lastgang' : cleaned
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Ohne Sitzung: Weiterleitung auf die Anmeldung — dieselbe Behandlung wie im Admin-Layout und in
  // der Lead-Export-Route (B2-1). Ein 404 wäre falsch: die Route existiert, sie ist nur nicht für
  // jeden. Es wird dabei kein RPC abgesetzt.
  if (!user) {
    return NextResponse.redirect(new URL(ANMELDEN_HREF, request.url), 307)
  }

  const { id } = await params
  const { data, error } = await supabase.rpc('admin_get_analysis_source', { p_id: id })

  if (error) {
    // 42501 = insufficient_privilege: angemeldet, aber keine Adminrolle. Die Datenbank ist die
    // Grenze, nicht diese Datei — sie WIRFT, statt eine leere Antwort zu liefern.
    if ((error as { code?: string }).code === '42501') {
      return problem('Keine Berechtigung.', 403)
    }
    console.error('[admin/analysen/datei] admin_get_analysis_source:', error)
    return problem('Die Datei konnte nicht geladen werden.', 500)
  }

  if (readStatus(data) === 'not_found') {
    return problem('Diese Analyse gibt es nicht.', 404)
  }

  const source = readAnalysisSource(data)
  if (!source) {
    console.error('[admin/analysen/datei] unerwartete Antwort:', data)
    return problem('Die Datei konnte nicht geladen werden.', 500)
  }

  let bytes: Uint8Array
  try {
    bytes = await unpackSourceFile(
      fromBase64(source.source_file_gzip_base64),
      source.source_file_sha256,
    )
  } catch (err) {
    /*
     * Ein Archiv, das sich nicht mehr entpacken lässt oder dessen Prüfsumme abweicht, ist der
     * schwerwiegendste denkbare Befund dieses Bereichs — und er darf sich nicht als „irgendein
     * Fehler" lesen. Er wird laut geloggt und dem Menschen als das benannt, was er ist.
     */
    console.error('[admin/analysen/datei] Archiv beschädigt:', err)
    return problem(
      'Die archivierte Datei liess sich nicht gegen ihre Prüfsumme bestätigen. Es wird bewusst ' +
        'nichts ausgeliefert: eine Datei ohne Beleg ist beim Wirkungsnachweis wertlos, und eine ' +
        'stillschweigend gelieferte wäre schlimmer als gar keine.',
      500,
    )
  }

  return new NextResponse(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      // Bewusst `octet-stream` und nicht nach Endung geraten: die Datei wird heruntergeladen, nicht
      // angezeigt, und ein falsch geratener Typ liesse den Browser sie umdeuten.
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename="${safeFileName(source.source_file_name)}"`,
      // Eine Archivdatei ist personenbezogenes Vertragsdurchführungsdatum — keine Kopie in einem
      // Zwischenspeicher (dieselbe Haltung wie bei der Lead-Ausfuhr, B2-1).
      'cache-control': 'no-store',
    },
  })
}
