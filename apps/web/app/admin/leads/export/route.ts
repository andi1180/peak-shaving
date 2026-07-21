/**
 * `GET /admin/leads/export` — die Bestands-Ausfuhr als CSV (B2-1).
 *
 * Der EINZIGE Weg, auf dem personenbezogene Daten dieses Systems dauerhaft seinen Wirkungsbereich
 * verlassen. Entsprechend eng ist er gebaut.
 *
 * ── DIE DATEI ENTSTEHT SERVERSEITIG, NICHT IM BROWSER ────────────────────────────────────────────
 * Eine im Client zusammengebaute CSV setzte voraus, dass der GESAMTE gefilterte Bestand unpaginiert
 * an den Browser geht — und genau das soll der Export nicht nebenbei tun. Die Seite `/admin/leads`
 * lädt weiterhin 50 Zeilen; wer exportiert, löst einen eigenen, protokollierten Vorgang aus.
 * Gestreamt wird, damit die Antwort nicht erst vollständig im Speicher entsteht.
 *
 * ── KEIN service_role ────────────────────────────────────────────────────────────────────────────
 * `public.admin_export_leads` ist SECURITY DEFINER mit `platform.is_admin()`-Prüfung und
 * ausschliesslich an `authenticated` gegrantet. Damit läuft der gesamte Exportweg unter der
 * ANGEMELDETEN Sitzung: die Erlaubnisliste in der root-`eslint.config.mjs` bleibt unverändert, und
 * `exported_by` im Protokoll trägt einen echten Menschen statt einer Maschinenrolle (bei
 * service_role wäre `auth.uid()` null und das Protokoll strukturell aussagelos).
 *
 * ── ES GIBT KEINEN UNGEFILTERTEN EXPORT ──────────────────────────────────────────────────────────
 * Die Route übernimmt die Filter aus der Anfrage — dieselben, die die Sicht gerade zeigt (EIN
 * Vokabular, `lib/admin/lead-filters.ts`). Ohne Filter ist der Filter „alles", und er wird als
 * solcher an die Datenbank übergeben und dort im Klartext protokolliert. Einen Schalter, der die
 * Filter umgeht, gibt es nicht.
 *
 * ── WAS DIE ROUTE NICHT ENTSCHEIDET ──────────────────────────────────────────────────────────────
 * Welche Zeilen drin sind. Die zwei strukturellen Ausschlüsse (anonymisiert, gesperrt) stehen in
 * der ABFRAGE (`public.admin_export_leads`), nicht hier: eine ausgeführte Datei kann in ein
 * beliebiges fremdes Werkzeug eingespielt werden, das die Sperrliste nicht kennt — der Ausschluss
 * muss in der Quelle liegen und nicht in einer Einstellung, die jemand versehentlich weglässt.
 * Ebenso wenig entscheidet die Route, ob protokolliert wird: derselbe Aufruf, der die Zeilen
 * liefert, schreibt den Eintrag.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ANMELDEN_HREF } from '@/lib/auth/config'
import { filterRpcArgs, readFilters } from '@/lib/admin/lead-filters'
import { csvChunks, exportFileName, readExportResult } from '@/lib/admin/csv'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Text/plain und knapp: hier liest kein Browser eine gestaltete Seite, hier lädt jemand eine Datei. */
function problem(message: string, status: number): Response {
  return new NextResponse(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

export async function GET(request: Request): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  /*
   * Ohne Sitzung: Weiterleitung auf die Anmeldung — dieselbe Behandlung wie im Admin-Layout (J6),
   * damit ein Aufruf aus einem alten Tab nicht in einer nackten Fehlermeldung endet. Ein 404 wäre
   * hier falsch: die Route existiert, sie ist nur nicht für jeden.
   *
   * Der Pfad steht wörtlich und läuft nicht durch `getPathname`: `/anmelden` liegt in der
   * Sprach-Struktur, und bei `localePrefix: 'as-needed'` ist die deutsche Fassung genau dieser
   * Pfad. Ein Route Handler hat keinen Locale-Kontext, aus dem sich etwas anderes ableiten liesse.
   */
  if (!user) {
    return NextResponse.redirect(new URL(ANMELDEN_HREF, request.url), 307)
  }

  const filters = readFilters(Object.fromEntries(new URL(request.url).searchParams))

  const { data, error } = await supabase.rpc('admin_export_leads', filterRpcArgs(filters))

  if (error) {
    // 42501 = insufficient_privilege: angemeldet, aber keine Adminrolle. Die Datenbank ist die
    // Grenze, nicht diese Datei — sie WIRFT, statt eine leere Datei zu liefern (B1-1: „kein
    // Zugriff" darf sich nie als „keine Leads" lesen lassen). Eine leere CSV wäre genau das.
    if ((error as { code?: string }).code === '42501') {
      return problem('Keine Berechtigung.', 403)
    }
    console.error('[admin/leads/export] admin_export_leads:', error)
    return problem('Die Ausfuhr ist fehlgeschlagen.', 500)
  }

  const status = (data as { status?: unknown } | null)?.status
  if (status === 'invalid_filter') {
    // Dieselbe Haltung wie in der Liste: ein unbekannter Filterwert wird abgelehnt, nicht still
    // ignoriert — sonst enthielte die Datei MEHR Zeilen als angefordert.
    const which = (data as { filter?: unknown }).filter
    return problem(
      `Diese Filterkombination kennt die Datenbank nicht (${String(which)}). ` +
        'Bitte in der Lead-Liste zurücksetzen und erneut ausführen.',
      400,
    )
  }

  const result = readExportResult(data)
  if (!result) {
    console.error('[admin/leads/export] unerwartete Antwort:', data)
    return problem('Die Ausfuhr ist fehlgeschlagen.', 500)
  }

  const encoder = new TextEncoder()
  const chunks = csvChunks(result.rows)
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks.next()
      if (next.done) {
        controller.close()
        return
      }
      controller.enqueue(encoder.encode(next.value))
    },
  })

  return new NextResponse(body, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${exportFileName(result.exportedAt)}"`,
      // Eine Ausfuhr ist ein einmaliger, protokollierter Vorgang — eine zwischengespeicherte Kopie
      // in einem Proxy wäre eine zweite, unprotokollierte.
      'cache-control': 'no-store',
    },
  })
}
