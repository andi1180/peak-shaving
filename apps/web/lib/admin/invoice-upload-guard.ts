import type { AdminState } from './schema'

export const INVOICE_UPLOAD_CRASH_TEXT =
  'Der Vorgang wurde vom Server abgebrochen (Zeitüberschreitung). ' +
  'Die Rechnungen sind abgelegt, bereits gelesene bleiben erhalten — bitte die Seite neu laden und fehlende Rechnungen einzeln hochladen.'

/**
 * Umhüllt die Auslese-Action für `useActionState`: eine abgewiesene Anfrage (504, Netz) wird zur
 * Meldung in der Station, statt als Wurf den ganzen Client abstürzen zu lassen.
 */
export function guardInvoiceRead<I>(
  action: (prev: AdminState, input: I) => Promise<AdminState>,
): (prev: AdminState, input: I) => Promise<AdminState> {
  return async (prev, input) => {
    try {
      return await action(prev, input)
    } catch (cause) {
      console.error('[admin/dateneingabe] Rechnungen auslesen abgebrochen:', cause)
      return { formError: INVOICE_UPLOAD_CRASH_TEXT }
    }
  }
}
