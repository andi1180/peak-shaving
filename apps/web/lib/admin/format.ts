/**
 * Zahlen- und Datumsformate des Admin-Bereichs (T4-4, herausgezogen in B2-1).
 *
 * REIN: kein React, kein `server-only` — `components/admin/ui.tsx` re-exportiert von hier, und die
 * Export-Route (B2-1) benutzt dieselben Funktionen für die CSV. Vorher standen sie in der
 * UI-Datei; ein Route Handler hätte dafür React mitziehen müssen, und eine zweite Kopie im
 * CSV-Modul hätte bedeutet, dass die ausgeführte Datei ein anderes Datumsformat trägt als die
 * Sicht, aus der sie entstand. Verhalten unverändert.
 *
 * Feste Locale/Zeitzone: der Bereich ist intern und österreichisch. Ohne explizite Zeitzone
 * formatierte der Server in UTC und der Browser in Ortszeit — dieselbe Zeile zeigte je nach
 * Renderort eine andere Uhrzeit (Hydration-Abweichung inklusive).
 */

const DATE_TIME = new Intl.DateTimeFormat('de-AT', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Vienna',
})

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : DATE_TIME.format(d)
}

/**
 * Nur das Datum — für Fristen (B1-3). Eine Löschfrist auf die Minute genau anzuzeigen behauptet eine
 * Genauigkeit, die sie nicht hat: sie ist eine abgeleitete Monatsrechnung, und entschieden wird
 * anhand des Tages.
 */
const DATE_ONLY = new Intl.DateTimeFormat('de-AT', {
  dateStyle: 'medium',
  timeZone: 'Europe/Vienna',
})

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : DATE_ONLY.format(d)
}

/**
 * Jahresverbrauch (B3-1). Mit Tausendertrennung, weil „180000" und „18000" beim Überfliegen
 * nicht unterscheidbar sind — und genau diese Grössenordnung entscheidet über die Zielgruppe.
 */
const INTEGER = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 0 })

export function formatKwh(value: number | null | undefined): string {
  return typeof value === 'number' ? `${INTEGER.format(value)} kWh` : '—'
}
