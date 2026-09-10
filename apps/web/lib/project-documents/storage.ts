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
 * Entfernt ein Objekt — ausschliesslich als AUFRÄUMEN eines gescheiterten Uploads.
 *
 * ⚠ Es gibt bewusst KEINEN Weg, ein eingetragenes Dokument zu löschen: dafür fehlt der
 * Datenbank-Wrapper (TEIL 9 der Migration), und ein Objekt zu entfernen, dessen Zeile stehen bleibt,
 * erzeugte genau den lügenden Bestand, den die Upload-Reihenfolge vermeidet. Diese Funktion räumt
 * nur den umgekehrten Fall auf: Bytes geschrieben, Eintragen gescheitert.
 */
export async function removeProjectDocumentBytes(storagePath: string): Promise<void> {
  const client = createServiceRoleClient()
  await client.storage.from(PROJECT_DOCUMENTS_BUCKET).remove([storagePath])
}
