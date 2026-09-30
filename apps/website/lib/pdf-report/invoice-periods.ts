import type { PdfReportInvoicePeriod } from './types'

/** Ein zusammenhängender Abrechnungsbereich über eine oder mehrere Rechnungen (ISO-Tage, inklusiv). */
export type InvoiceRange = { from: string; to: string }

const MS_PER_DAY = 86_400_000
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/

function dayMs(iso: string): number | null {
  const match = ISO_DAY.exec(iso)
  if (!match) return null
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isFinite(ms) ? ms : null
}

/** Die Rechnungen mit mindestens einer Zeitraumgrenze, ohne doppelte Zeiträume, in Eingangsreihenfolge. */
export function distinctInvoicePeriods(periods: PdfReportInvoicePeriod[]): PdfReportInvoicePeriod[] {
  const seen = new Set<string>()
  return periods.filter((period) => {
    if (period.from === null && period.to === null) return false
    const key = `${period.from ?? ''}|${period.to ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Chronologisch sortiert und zusammengefasst: ein Zeitraum, der höchstens einen Tag nach dem Ende
 * des vorigen beginnt, verlängert diesen; eine Lücke beginnt einen neuen Bereich.
 */
export function mergeInvoiceRanges(periods: PdfReportInvoicePeriod[]): InvoiceRange[] {
  // Fehlt eine Grenze, steht die bekannte für beide — es wird kein Zeitraum dazuerfunden.
  const spans = distinctInvoicePeriods(periods)
    .map((period) => {
      const from = period.from ?? period.to!
      const to = period.to ?? period.from!
      return { from, to, startMs: dayMs(from), endMs: dayMs(to) }
    })
    .filter(
      (span): span is InvoiceRange & { startMs: number; endMs: number } =>
        span.startMs !== null && span.endMs !== null && span.endMs >= span.startMs,
    )
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)

  const merged: Array<InvoiceRange & { endMs: number }> = []
  for (const span of spans) {
    const last = merged[merged.length - 1]
    if (last && span.startMs <= last.endMs + MS_PER_DAY) {
      if (span.endMs > last.endMs) {
        last.to = span.to
        last.endMs = span.endMs
      }
    } else {
      merged.push({ from: span.from, to: span.to, endMs: span.endMs })
    }
  }
  return merged.map(({ from, to }) => ({ from, to }))
}

function formatDay(iso: string, withYear: boolean): string {
  const [, year, month, day] = ISO_DAY.exec(iso)!
  return withYear ? `${day}.${month}.${year}` : `${day}.${month}.`
}

/** „01.02.–31.05.2026 und 01.07.–31.07.2026" — das Jahr steht am Beginn nur, wenn es wechselt. */
export function formatInvoiceRanges(ranges: InvoiceRange[]): string {
  const parts = ranges.map(({ from, to }) => {
    if (from === to) return formatDay(to, true)
    const sameYear = from.slice(0, 4) === to.slice(0, 4)
    return `${formatDay(from, !sameYear)}–${formatDay(to, true)}`
  })
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]}`
}
