/**
 * DER BYTE-TRANSPORT in den und aus dem Projekt-Dokumente-Bucket (B24).
 *
 * ── ⚠ DIESE DATEI ENTSCHEIDET NICHTS ────────────────────────────────────────────────────────────
 * Sie trägt den `service_role`-Schlüssel und umgeht damit jede RLS — aber sie beantwortet keine
 * einzige Ja/Nein-Frage. Wer ein Dokument hochladen oder lesen darf, entscheidet AUSSCHLIESSLICH die
 * Datenbank gegen `auth.uid()`, in `documents.ts`, VOR jedem Aufruf hier. Das ist keine
 * Geschmacksfrage: der Bucket ist nur durch die Abwesenheit einer Storage-Policy verschlossen
 * (gemessen, s. TEIL 7 der Migration `20260910090000_create_project_chat_state.sql`), also ist
 * `service_role` der einzige Weg an die Bytes — und damit die eine Stelle, an der ein Fehler im
 * Anwendungscode zu einem Leck über Kundengrenzen würde.
 *
 * Die naheliegende Abkürzung wäre, hier eine Konto-Kennung entgegenzunehmen und ihr zu glauben.
 * Genau die gibt es nicht: die Funktionen unten kennen Konten gar nicht.
 *
 * ── DER CLIENT VERLÄSST DIESES MODUL NICHT ──────────────────────────────────────────────────────
 * Beide Funktionen geben WERTE zurück (ein Ergebnis, Bytes) und niemals den Client selbst — sonst
 * wäre die Beschränkung auf eine Datei Kosmetik. Wortgleiche Auflage wie bei `lib/auth/admin-api.ts`
 * (B18-2a).
 *
 * ── DREI SPERREN GEGEN VERSEHENTLICHEN GEBRAUCH ─────────────────────────────────────────────────
 *   1. `import 'server-only'` — ein Import aus einer Client-Komponente bricht den Build hart.
 *   2. ESLint `no-restricted-imports` (root `eslint.config.mjs`) erlaubt den service_role-Client
 *      ausschliesslich in GENAU DIESER Datei, nicht im Verzeichnis: `documents.ts` liegt daneben und
 *      soll sich seinen Zugang nicht selbst bauen können.
 *   3. Der require-on-use-Zugriff auf den Schlüssel wirft mit klarer Meldung, wenn er fehlt.
 */
import 'server-only'

import { PROJECT_DOCUMENTS_BUCKET } from 'shared'

// KEIN `eslint-disable` — die Erlaubnis kommt aus der Allowlist in der root-`eslint.config.mjs`,
// und zwar für GENAU diese Datei. Ein Disable-Kommentar hier wäre nicht bloss überflüssig: er würde
// die Regel auch dann stumm stellen, wenn jemand die Datei später aus der Allowlist nimmt.
import { createServiceRoleClient } from '@/lib/supabase/service-role'

/**
 * Schreibt die Bytes eines Dokuments an einen bereits FESTSTEHENDEN Pfad.
 *
 * ⚠ `upsert: false`. Ein Upsert überschriebe ein Objekt, das bereits an diesem Pfad liegt — und weil
 * der Pfad aus Projekt- und Dokumentkennung besteht, hiesse das: ein zweiter Aufruf mit derselben
 * Kennung ersetzt stillschweigend eine fremde Datei. Der Fall ist unwahrscheinlich (die Kennung ist
 * eine frische UUID) und deshalb genau der, der niemandem auffiele.
 */
export async function putProjectDocumentBytes(
  storagePath: string,
  bytes: ArrayBuffer | Uint8Array,
  contentType: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const client = createServiceRoleClient()
  const { error } = await client.storage
    .from(PROJECT_DOCUMENTS_BUCKET)
    .upload(storagePath, bytes, { contentType, upsert: false })

  if (error) return { ok: false, message: error.message }
  return { ok: true }
}

/** Holt die Bytes eines Dokuments von einem bereits GEPRÜFTEN Pfad. */
export async function getProjectDocumentBytes(
  storagePath: string,
): Promise<{ ok: true; bytes: ArrayBuffer } | { ok: false; message: string }> {
  const client = createServiceRoleClient()
  const { data, error } = await client.storage.from(PROJECT_DOCUMENTS_BUCKET).download(storagePath)

  if (error || !data) return { ok: false, message: error?.message ?? 'Datei nicht gefunden' }
  return { ok: true, bytes: await data.arrayBuffer() }
}

/**
 * Entfernt ein Objekt aus dem Bucket. ZWEI Aufrufer, und sie meinen Verschiedenes.
 *
 * ── ⚠ DER KOPF DIESER FUNKTION HAT BIS ZUM LASTGANG-RÜCKWEG DAS GEGENTEIL BEHAUPTET ────────────
 * Er lautete: „Es gibt bewusst KEINEN Weg, ein eingetragenes Dokument zu löschen: dafür fehlt der
 * Datenbank-Wrapper (TEIL 9 der Migration)." Das stimmt seit der Migration `20260911180000` nicht
 * mehr — `public.admin_delete_metering_point_document` ist genau dieser Wrapper, eng an den
 * Zählpunkt gebunden. Der Satz ist ersetzt statt stehen gelassen: ein Kommentar, der eine Regel
 * behauptet, die es nicht mehr gibt, ist teurer als keiner.
 *
 *   (1) AUFRÄUMEN eines gescheiterten Uploads (`documents.ts`): Bytes geschrieben, Eintragen
 *       gescheitert. Der Rückgabewert interessiert dort nicht — die Datei steht in keiner Liste,
 *       und der Aufrufer meldet ohnehin bereits einen Fehlschlag.
 *   (2) ENTFERNEN eines eingetragenen Lastgang-Dokuments (`lib/admin/data-entry-actions.ts`). Dort
 *       ist der Rückgabewert tragend: schlägt er fehl, darf die Datenbank-Zeile NICHT gelöscht
 *       werden — sonst bliebe ein Objekt im Bucket, auf das nichts mehr zeigt. Ein sichtbarer Rest
 *       (Zeile ohne Datei) ist billiger als ein unsichtbarer (Datei ohne Zeile).
 *
 * ⚠ Deshalb gibt sie ein ERGEBNIS zurück und kein `void`. Vorher verschluckte sie jeden Fehler, und
 * Aufrufer (2) hätte gar nicht erfahren können, dass nichts geschehen ist.
 *
 * ⚠ EIN BEREITS FEHLENDES OBJEKT IST KEIN FEHLSCHLAG: die Storage-API meldet für einen unbekannten
 * Pfad keinen Fehler. Das ist hier die richtige Lesart — ein zweiter Anlauf nach einem Abbruch
 * zwischen den Schritten soll durchlaufen, nicht an dem scheitern, was beim ersten schon gelang.
 */
export async function removeProjectDocumentBytes(
  storagePath: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const client = createServiceRoleClient()
  const { error } = await client.storage.from(PROJECT_DOCUMENTS_BUCKET).remove([storagePath])

  if (error) return { ok: false, message: error.message }
  return { ok: true }
}
