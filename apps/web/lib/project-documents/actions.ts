'use server'

import 'server-only'

import { MAX_PROJECT_DOCUMENT_BYTES } from 'shared'

import { PROJECT_ID_PATTERN } from '@/lib/kalkulator/projects'
import { uploadProjectDocument, type UploadResult } from './documents'

/**
 * B24 — DER HTTP-RAND DES DOKUMENT-UPLOADS (achter Bauschritt).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ HIER ENTSTEHT DER ENDPUNKT — `documents.ts` HATTE BIS HIERHER KEINEN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Der Kopf von `lib/project-documents/documents.ts` sagt es seit dem zweiten Bauschritt wörtlich:
 * „Dieses Modul ist die Funktion, die die Action des nächsten Schritts in einer Zeile aufruft — und
 * bis dahin ohne HTTP-Rand." Diese Datei IST jene Action. Der Upload-Weg selbst (drei Schritte,
 * Eigentumsfrage an die DATENBANK, Bytes vor dem Eintrag) wird **nicht nachgebaut und nicht
 * angefasst** — er wird gerufen.
 *
 * ── ⚠ WARUM EINE EIGENE DATEI UND NICHT `'use server'` IN `documents.ts` ──────────────────────
 * Eine `'use server'`-Datei darf ausschliesslich async Funktionen exportieren (in B18-4 real als
 * HTTP 500 zur Laufzeit aufgeschlagen, obwohl Build, Typecheck und Lint grün waren). `documents.ts`
 * exportiert Typen und hat mit `readProjectDocument` einen zweiten Konsumenten, der KEINEN
 * Endpunkt braucht: `supabase-ports.ts` liest darüber die Bytes für die Extraktions-Werkzeuge.
 * Die Direktive dort hätte also einen Endpunkt für den Lesepfad miterzeugt, den niemand anfordert.
 *
 * ── ⚠ DIE TYPEN GELTEN AN DIESEM RAND NICHT ──────────────────────────────────────────────────
 * Dieselbe Auflage wie in `lib/project-chat/chat.ts`: die Argumente kommen deserialisiert vom
 * Client, TypeScript prüft den AUFRUF und nicht die Nutzlast. Beide werden deshalb hier geprüft,
 * bevor irgendetwas geschieht — die Grössengrenze zusätzlich VOR dem Lesen der Bytes, damit eine
 * absurd grosse Datei nicht erst vollständig in den Speicher wandert.
 *
 * ── DIE ZUGRIFFSFRAGE STELLT WEITERHIN DIE DATENBANK ─────────────────────────────────────────
 * Kein Sitzungs-Parameter, keine Konto-Kennung: `uploadProjectDocument` fragt `public.get_project`
 * als angemeldetes Konto, und die Antwort kommt aus `platform.project_accessible` gegen
 * `auth.uid()`. Ein übergebener Wert, dem geglaubt würde, wäre die eine Stelle, an der ein Fehler
 * zu einem Leck über Kundengrenzen würde.
 */
export async function uploadProjectDocumentAction(
  projectId: string,
  formData: FormData,
): Promise<UploadResult> {
  if (typeof projectId !== 'string' || !PROJECT_ID_PATTERN.test(projectId)) {
    return { ok: false, reason: 'not_found' }
  }

  const file = formData.get('file')
  if (!(file instanceof File)) return { ok: false, reason: 'invalid_file' }
  if (file.size === 0) return { ok: false, reason: 'invalid_file' }
  if (file.size > MAX_PROJECT_DOCUMENT_BYTES) return { ok: false, reason: 'too_large' }

  return uploadProjectDocument(projectId, {
    name: file.name,
    /*
     * ⚠ `content_type` ist eine ANGABE des Browsers und kein Beweis (Spaltenkommentar der
     * Migration). Er entscheidet später ausschliesslich, WELCHER Extraktor gefragt wird. Ein leerer
     * Typ kommt real vor (manche Browser melden für unbekannte Endungen nichts) und würde von
     * `uploadProjectDocument` als `invalid_file` abgewiesen — deshalb hier der neutrale Rückfall,
     * mit dem der Bucket ohnehin umgehen kann (`allowed_mime_types = null`, Delta §3.2).
     */
    type: file.type.trim() === '' ? 'application/octet-stream' : file.type,
    bytes: await file.arrayBuffer(),
  })
}
