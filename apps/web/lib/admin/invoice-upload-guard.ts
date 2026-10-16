import type { AdminState } from './schema'

/**
 * Obergrenze für die Summe der Dateien EINES Rechnungs-Uploads. Vercel weist jeden Function-Rumpf
 * über 4,5 MB mit 413 ab, bevor die Action läuft — die Prüfung hier sagt es vorher.
 */
export const MAX_INVOICE_UPLOAD_REQUEST_BYTES = 4 * 1024 * 1024

export const INVOICE_UPLOAD_CRASH_TEXT =
  'Der Vorgang wurde vom Server abgebrochen (Zeitüberschreitung oder zu grosse Anfrage). ' +
  'Bereits gelesene Rechnungen bleiben erhalten — bitte die Seite neu laden und fehlende Rechnungen einzeln hochladen.'

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toLocaleString('de-AT', { maximumFractionDigits: 1 })
}

/** Meldung, wenn die gewählten Dateien zusammen über der Grenze liegen — sonst `null`. */
export function invoiceUploadTooLargeText(formData: FormData): string | null {
  const total = formData
    .getAll('files')
    .reduce((sum, value) => sum + (value instanceof File ? value.size : 0), 0)
  if (total <= MAX_INVOICE_UPLOAD_REQUEST_BYTES) return null
  return (
    `Datei zu gross: zusammen ${megabytes(total)} MB, max. ${megabytes(MAX_INVOICE_UPLOAD_REQUEST_BYTES)} MB je Vorgang. ` +
    'Bitte weniger Rechnungen auf einmal wählen. Es wurde nichts hochgeladen.'
  )
}

/**
 * Umhüllt die Upload-Action für `useActionState`: eine abgewiesene Anfrage (504, 413, Netz) wird
 * zur Meldung in der Station, statt als Wurf den ganzen Client abstürzen zu lassen.
 */
export function guardInvoiceUpload(
  action: (prev: AdminState, formData: FormData) => Promise<AdminState>,
): (prev: AdminState, formData: FormData) => Promise<AdminState> {
  return async (prev, formData) => {
    const tooLarge = invoiceUploadTooLargeText(formData)
    if (tooLarge !== null) return { fieldErrors: { files: tooLarge } }
    try {
      return await action(prev, formData)
    } catch (cause) {
      console.error('[admin/dateneingabe] Rechnungs-Upload abgebrochen:', cause)
      return { formError: INVOICE_UPLOAD_CRASH_TEXT }
    }
  }
}
