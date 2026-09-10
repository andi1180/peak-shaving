/**
 * HOCH- UND HERUNTERLADEN eines Projekt-Dokuments (B24, Delta §3.2).
 *
 * ── DIE REIHENFOLGE IST DIE EIGENTLICHE AUSSAGE DIESES MODULS ───────────────────────────────────
 * Hochladen, drei Schritte:
 *   1. `public.get_project` als ANGEMELDETES KONTO — die Eigentumsfrage beantwortet die DATENBANK
 *      gegen `auth.uid()`, nie dieser Code gegen einen übergebenen Wert.
 *   2. Bytes schreiben (service_role, `storage.ts`) — der Pfad steht dann bereits fest.
 *   3. `public.append_project_document` als ANGEMELDETES KONTO — prüft ein zweites Mal und BILDET
 *      den Pfad selbst; der hier gebildete kann also gar nicht abweichen (der CHECK auf
 *      `platform.project_documents` wiese es sonst mit 23514 ab).
 *
 * ⚠ WARUM NICHT ERST DIE ZEILE, DANN DIE BYTES. Scheiterte dann der Upload, stünde eine Zeile im
 * Bestand, die eine Datei behauptet, die es nicht gibt: sie erschiene in `list_project_documents`,
 * der Chat hielte das Dokument für vorhanden, und jeder Download liefe ins Leere. In dieser
 * Reihenfolge ist der schlimmste Rest eine verwaiste DATEI — sie steht in keiner Liste, niemand
 * verweist auf sie, und sie liegt im Ordner ihres eigenen Projekts. Ein unbemerkt falscher Bestand
 * ist teurer als ein unbemerkter Rest. Schritt 3 räumt sie ausserdem auf, wenn er selbst scheitert.
 *
 * Herunterladen, zwei Schritte: `public.get_project_document` als angemeldetes Konto (liefert den
 * Pfad NUR, wenn das Projekt dem Aufrufer gehört oder er Admin ist), danach die Bytes.
 *
 * ── ZWEI KONSUMENTEN, EIN MODUL ────────────────────────────────────────────────────────────────
 * Der Kunde lädt im Chat hoch (`apps/web`, Route `/kalkulator/projekte/[id]` — die Vermutung im
 * zweiten Bauschritt, das geschehe in `apps/website`, war falsch: der Chat MUSS hier liegen, weil
 * der Zugriffsschutz aller Projekt-Wrapper an `auth.uid()` hängt und eine angemeldete Sitzung nur
 * diese App hat); Martin liest im Admin-Bereich
 * mit, wenn er eine Rückfrage aus `admin_list_open_questions` beantworten soll — ohne die Rechnung,
 * die der Kunde hochgeladen hat, kann er das nicht. Beide Wege stellen dieselbe Frage an dieselben
 * Wrapper; die Verzweigung „eigenes Projekt oder Adminrolle" steckt in `platform.project_accessible`
 * und nicht hier.
 *
 * ── ⚠ DER HTTP-RAND LIEGT NEBENAN, NICHT HIER ─────────────────────────────────────────────────
 * Seit dem achten Bauschritt gibt es ihn: `lib/project-documents/actions.ts` trägt `'use server'`
 * und ruft `uploadProjectDocument` in einer Zeile auf. Diese Datei behält bewusst KEINE Direktive.
 *
 * Der Grund ist nicht Gewohnheit, sondern eine gemessene Falle: Eine `'use server'`-Datei darf
 * ausschliesslich async Funktionen exportieren — ein daneben exportierter Typ oder Wert bricht erst
 * zur LAUFZEIT (HTTP 500), während Build, Typecheck und Lint grün bleiben (in B18-4 real
 * passiert). Dieses Modul exportiert `UploadResult`/`ReadResult`. Und `readProjectDocument` hat mit
 * `supabase-ports.ts` einen zweiten Konsumenten, der gar keinen Endpunkt braucht: Die Direktive
 * hier hätte einen für den LESEPFAD miterzeugt, den niemand anfordert — genau die Angriffsfläche
 * ohne Nutzen, die TEIL 9 der Migration für die Datenbank-Wrapper ausschliesst.
 */
import 'server-only'

import { MAX_PROJECT_DOCUMENT_BYTES, projectDocumentPath } from 'shared'

import { createClient } from '@/lib/supabase/server'
import {
  getProjectDocumentBytes,
  putProjectDocumentBytes,
  removeProjectDocumentBytes,
} from './storage'

export type UploadResult =
  | { ok: true; documentId: string; storagePath: string }
  | { ok: false; reason: 'not_found' | 'too_large' | 'invalid_file' | 'storage_failed' | 'record_failed' }

export type ReadResult =
  | { ok: true; bytes: ArrayBuffer; filename: string; contentType: string }
  | { ok: false; reason: 'not_found' | 'storage_failed' }

/** Die Form, in der die Wrapper antworten — sie liefern durchgängig ein jsonb-Objekt mit `status`. */
type WrapperResult = { status?: string; [key: string]: unknown }

export async function uploadProjectDocument(
  projectId: string,
  file: { name: string; type: string; bytes: ArrayBuffer },
  deps?: { newDocumentId?: () => string },
): Promise<UploadResult> {
  // ── Grösse ZUERST, vor jedem Netzwerkweg. Die Datenbank trägt dieselbe Zahl als Rücklage
  // (`file_size_limit` am Bucket); hier lehnt die ANWENDUNG mit einem lesbaren Grund ab, statt eine
  // 20-MB-Datei erst hochzuladen und dann vom Storage-Dienst abgewiesen zu bekommen.
  if (file.bytes.byteLength === 0) return { ok: false, reason: 'invalid_file' }
  if (file.bytes.byteLength > MAX_PROJECT_DOCUMENT_BYTES) return { ok: false, reason: 'too_large' }
  if (file.name.trim() === '' || file.type.trim() === '') return { ok: false, reason: 'invalid_file' }

  const supabase = await createClient()

  // ── Schritt 1: die DATENBANK beantwortet die Eigentumsfrage, gegen auth.uid().
  const { data: project, error: projectError } = await supabase.rpc('get_project', { p_id: projectId })
  if (projectError || (project as WrapperResult | null)?.status !== 'ok') {
    return { ok: false, reason: 'not_found' }
  }

  const documentId = deps?.newDocumentId?.() ?? crypto.randomUUID()
  const storagePath = projectDocumentPath(projectId, documentId)

  // ── Schritt 2: die Bytes. Erst jetzt, und erst nachdem die Datenbank zugestimmt hat.
  const put = await putProjectDocumentBytes(storagePath, file.bytes, file.type)
  if (!put.ok) return { ok: false, reason: 'storage_failed' }

  // ── Schritt 3: eintragen. Der Wrapper prüft das Eigentum ein zweites Mal und bildet den Pfad
  // selbst — er kann also nicht auf das zeigen, was hier geschrieben wurde, wenn beides auseinander
  // liefe.
  const { data: recorded, error: recordError } = await supabase.rpc('append_project_document', {
    p_project_id: projectId,
    p_document_id: documentId,
    p_original_filename: file.name,
    p_content_type: file.type,
  })

  if (recordError || (recorded as WrapperResult | null)?.status !== 'ok') {
    // Die eben geschriebenen Bytes aufräumen: eine Datei ohne Eintrag ist zwar harmlos (sie steht in
    // keiner Liste), aber sie kostet Platz und niemand käme je wieder an sie heran.
    await removeProjectDocumentBytes(storagePath)
    return { ok: false, reason: 'record_failed' }
  }

  return { ok: true, documentId, storagePath }
}

export async function readProjectDocument(documentId: string): Promise<ReadResult> {
  const supabase = await createClient()

  // Die Eigentumsfrage beantwortet die DATENBANK — dieser Code erfährt den Pfad nur, wenn sie
  // zugestimmt hat. Es gibt keinen Weg, an ihr vorbei einen Pfad zu erraten: der Bucket ist privat
  // und ohne Policy für keine Client-Rolle erreichbar.
  const { data, error } = await supabase.rpc('get_project_document', { p_document_id: documentId })
  const result = data as { status?: string; document?: Record<string, string> } | null
  if (error || result?.status !== 'ok' || !result.document) {
    return { ok: false, reason: 'not_found' }
  }

  const got = await getProjectDocumentBytes(result.document.storage_path!)
  if (!got.ok) return { ok: false, reason: 'storage_failed' }

  return {
    ok: true,
    bytes: got.bytes,
    filename: result.document.original_filename!,
    // ⚠ DER AUFRUFER MUSS DARAUS EINEN ANHANG MACHEN (`Content-Disposition: attachment`) und darf
    // diesen Typ NICHT als `Content-Type` einer Antwort setzen, die der Browser anzeigt: er ist eine
    // ANGABE des Kunden (Spaltenkommentar `platform.project_documents.content_type`), und der Bucket
    // nimmt bewusst jeden Dokumenttyp an (Delta §3.2). Der Wert steht hier für Anzeige und
    // Extraktor-Wahl, nicht für die Auslieferung.
    contentType: result.document.content_type!,
  }
}
