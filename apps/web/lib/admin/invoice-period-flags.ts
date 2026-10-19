import { effectiveInvoiceExtraction, type StoredInvoiceExtraction } from './invoice-extractions'

/**
 * Hinweise auf auffällige Abrechnungszeiträume je gelesener Rechnung — immer am WIRKSAMEN Zeitraum
 * (`effectiveInvoiceExtraction`), also nach einer Korrektur.
 */

export type InvoicePeriodFlag =
  | { kind: 'missing' }
  | { kind: 'assumed' }
  | { kind: 'future_end' }
  | { kind: 'too_long' }
  | { kind: 'overlap'; documentId: string; filename: string }

/** Längste plausible Rechnungsspanne in Tagen (beide Enden inklusive). */
export const MAX_INVOICE_PERIOD_DAYS = 400

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000

function daysInclusive(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1
}

/** Ein echtes Kalenderdatum `JJJJ-MM-TT` (kein 31.02.). */
function isCalendarDay(value: string): boolean {
  if (!ISO_DAY.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/** Heutiges Datum (`JJJJ-MM-TT`) in der Ortszeit der Zeitzone. */
export function localDateIso(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now)
}

export function invoicePeriodFlags(
  entries: readonly StoredInvoiceExtraction[],
  today: string,
): Map<string, InvoicePeriodFlag[]> {
  const periods = entries.map((entry) => {
    const {
      billingPeriodFrom: from,
      billingPeriodTo: to,
      billingPeriodAssumed,
    } = effectiveInvoiceExtraction(entry)
    return { entry, from, to, assumed: billingPeriodAssumed === true }
  })
  const result = new Map<string, InvoicePeriodFlag[]>()
  for (const p of periods) {
    const flags: InvoicePeriodFlag[] = []
    if (p.from === null || p.to === null) {
      flags.push({ kind: 'missing' })
    } else {
      if (p.assumed) flags.push({ kind: 'assumed' })
      if (p.to > today) flags.push({ kind: 'future_end' })
      if (daysInclusive(p.from, p.to) > MAX_INVOICE_PERIOD_DAYS) flags.push({ kind: 'too_long' })
      for (const other of periods) {
        if (other === p || other.from === null || other.to === null) continue
        // Inklusive Enden wie Gewichtung (#520) und Verlaufsregel (#524): ein gemeinsamer Tag überlappt.
        if (p.from <= other.to && other.from <= p.to) {
          flags.push({
            kind: 'overlap',
            documentId: other.entry.documentId,
            filename: other.entry.filename,
          })
        }
      }
    }
    result.set(p.entry.documentId, flags)
  }
  return result
}

export function invoicePeriodFlagText(flag: InvoicePeriodFlag): string {
  switch (flag.kind) {
    case 'missing':
      return 'kein Zeitraum gelesen'
    case 'assumed':
      return 'Zeitraum geschätzt'
    case 'future_end':
      return 'endet in der Zukunft'
    case 'too_long':
      return 'länger als 13 Monate'
    case 'overlap':
      return `überlappt mit ${flag.filename}`
  }
}

/** Prüft eine Korrektur; `null` heisst gültig, sonst ein Satz für die Oberfläche. */
export function invoicePeriodOverrideError(from: string, to: string, today: string): string | null {
  if (!isCalendarDay(from) || !isCalendarDay(to)) return 'Bitte zwei gültige Daten angeben.'
  if (from > to) return 'Der Beginn liegt nach dem Ende.'
  if (daysInclusive(from, to) > MAX_INVOICE_PERIOD_DAYS) {
    return `Der Zeitraum ist länger als ${MAX_INVOICE_PERIOD_DAYS} Tage.`
  }
  if (to > today) return 'Das Ende liegt in der Zukunft.'
  return null
}

/** `JJJJ-MM-TT` → `TT.MM.JJJJ`. */
export function formatIsoDay(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
}
