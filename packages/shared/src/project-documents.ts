/**
 * Der Storage-Bucket der Projekt-Dokumente (B24, Delta §3.2).
 *
 * ── WARUM DIESE KONSTANTE IN `shared` STEHT UND NICHT IN EINER DER BEIDEN APPS ──────────────────
 * Der Bucket wird von ZWEI Seiten angesprochen: heute vom Server-Weg in `apps/web`, mit dem
 * Chat-Schritt zusätzlich vom Rechner in `apps/website`. Zweimal ausgeschrieben wäre er zweimal zu
 * ändern — und die zweite Schreibweise fiele erst dort auf, wo eine Datei nicht mehr gefunden wird.
 *
 * ── ES GIBT BEWUSST KEINEN DRIFT-WÄCHTER GEGEN DIE MIGRATION ───────────────────────────────────
 * Das Repo führt solche Wächter dort, wo eine Abweichung STILL ist: der Backfill-Anker
 * (`packages/shared/src/analysis-window.ts` liest die Skriptdatei) und der Herkunftsschlüssel des
 * Report-Gates (`packages/db-tests/src/report-gate-source.test.ts`) beschreiben beide Fälle, in denen
 * eine falsche Zahl bzw. ein falscher Schlüssel ein plausibles, aber falsches Ergebnis erzeugt.
 * Hier ist die Abweichung LAUT: ein Bucket, den es nicht gibt, beantwortet jeden Aufruf der
 * Storage-API mit „Bucket not found" — beim ersten Versuch, nicht irgendwann.
 */

/** Muss `id` der Bucket-Zeile aus `20260910090000_create_project_chat_state.sql` entsprechen. */
export const PROJECT_DOCUMENTS_BUCKET = 'project-documents'

/**
 * Obergrenze je Datei, wortgleich zum `file_size_limit` des Buckets (20 MB).
 *
 * ⚠ SIE STEHT AN BEIDEN ORTEN, UND DAS IST ABSICHT — nicht dieselbe Grenze zweimal, sondern
 * dieselbe Zahl in zwei Rollen: hier lehnt die ANWENDUNG mit einem lesbaren Satz ab, dort ist die
 * DATENBANK die Rücklage, die auch ein fehlerhafter Aufrufer nicht überschreitet. Dieselbe
 * Aufteilung wie bei `MAX_INVOICE_FILE_BYTES` gegen `bodySizeLimit` (Delta 9b-2a): die fachliche
 * Grenze gehört in den Code, die letzte in die Infrastruktur.
 */
export const MAX_PROJECT_DOCUMENT_BYTES = 20 * 1024 * 1024

/**
 * Der Pfad eines Dokuments IM Bucket.
 *
 * ⚠ DIE DATENBANK BILDET DENSELBEN PFAD NOCH EINMAL (`public.append_project_document`) und pinnt ihn
 * zusätzlich per CHECK auf `platform.project_documents`. Das ist keine Doppelung aus Versehen: der
 * Aufrufer braucht den Pfad, BEVOR die Zeile existiert (die Bytes werden zuerst geschrieben — s. die
 * Begründung der Reihenfolge in TEIL 3 der Migration), und die Datenbank darf sich nicht darauf
 * verlassen, dass er ihn richtig gebildet hat. Weicht diese Funktion je vom CHECK ab, wird das
 * Eintragen mit 23514 abgewiesen — laut und beim ersten Versuch.
 */
export function projectDocumentPath(projectId: string, documentId: string): string {
  return `${projectId}/${documentId}`
}
