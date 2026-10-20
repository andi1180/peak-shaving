/*
 * Adressen der Profi-Report-Seite (Leadgen 4b) — eine Stelle für Seite, Schnellcheck, Schnellreport-
 * Mail und -PDF. Rein, ohne `server-only`.
 */
import { PROFI_REPORT_HREF } from '@/lib/nav'
import { absoluteUrl } from '@/lib/site'

export { PROFI_REPORT_HREF }

/** Anker der Blätterleiste („So sieht ein Profi-Report aus"). */
export const PROFI_REPORT_BEISPIEL_ID = 'beispiel'
/** Anker des Anfrageformulars. */
export const PROFI_REPORT_ANFRAGE_ID = 'anfrage'

/** Beispiel-Report als Dateien in `public/beispiel-report/` (Schritt 4a). */
export const BEISPIEL_REPORT_DIR = '/beispiel-report'
export const BEISPIEL_REPORT_PDF_HREF = `${BEISPIEL_REPORT_DIR}/beispiel-profi-report.pdf`

export type ProfiReportAnchor = typeof PROFI_REPORT_BEISPIEL_ID | typeof PROFI_REPORT_ANFRAGE_ID

/**
 * Absolute Adresse für Links aus Schnellreport-Mail und -PDF, mit UTM-Parametern, damit die
 * Besuche aus beiden Kanälen getrennt auswertbar sind. Der Anker steht hinter der Query.
 */
export function schnellreportProfiReportUrl(
  anchor: ProfiReportAnchor,
  medium: 'email' | 'pdf',
): string {
  const query = new URLSearchParams({
    utm_source: 'schnellreport',
    utm_medium: medium,
    utm_campaign: 'profi-report',
  })
  return absoluteUrl(`${PROFI_REPORT_HREF}?${query.toString()}#${anchor}`)
}
