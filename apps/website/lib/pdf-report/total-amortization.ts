import { aboutYears } from './break-even-band'
import type { ExecutiveSummary } from './executive-summary'
import { formatYears } from '@/lib/format'
import { amortizationYearsOf } from './headline-storage'

/**
 * Amortisation der Gesamtmaßnahme: Investition des Speichers ÷ gesamte Ersparnis pro Jahr (Tarifwechsel
 * + Ladesteuerung + Spitzenkappung, die grosse Zahl der Vorderseite). Es gibt sie nur, wo der
 * Tarifwechsel etwas bringt — sonst ist sie die Rückzahlzeit des Speichers. Einzige Quelle für
 * Vorderseite und Wirtschaftlichkeit.
 */
export function totalAmortizationOf(
  s: ExecutiveSummary,
): { years: number; upperBound: boolean } | null {
  const st = s.storage
  if (!st || s.variant !== 'tarif-und-speicher') return null
  const switchSaving = s.stages.find((stage) => stage.id === 'ohne-anschaffung')?.savingPerYearEur
  const total = s.header.savingPerYearEur
  if (!switchSaving || switchSaving <= 0 || total <= 0 || st.netInvestmentEur <= 0) return null
  return { years: amortizationYearsOf(st.netInvestmentEur, total), upperBound: st.upperBound }
}

/**
 * Gesamt-Amortisation immer in Jahren („ca. 1,1 Jahre", „ca. 1 Jahr", „ca. 2 Jahre"), vergleichbar mit
 * „Speicher allein"; Untergrenze „ca. 0,1 Jahre". `dative` für „nach ca. 1,1 Jahren".
 */
export function aboutDuration(years: number, dative = false): string {
  const text = aboutYears(Math.max(years, 0.1))
  return dative && text.endsWith('e') ? `${text}n` : text
}

/**
 * Zeile und Satz zur Gesamtmaßnahme unter der Speicher-Rückzahlzeit im Kapitel „Empfehlung und
 * Wirtschaftlichkeit"; `null`, wo es die Kennzahl nicht gibt. `storageYears` ist die Zahl darüber.
 */
export function totalAmortizationExtra(
  summary: ExecutiveSummary | null | undefined,
  storageYears: number,
): { line: string; note: string } | null {
  const total = summary ? totalAmortizationOf(summary) : null
  if (!total) return null
  const earliest = total.upperBound ? 'frühestens ' : ''
  return {
    line: `Gesamtmaßnahme: ${earliest}${aboutDuration(total.years)}`,
    note:
      'Mit Tarifwechsel, Ladesteuerung und Spitzenkappung zusammen ist die Investition ' +
      `${earliest}nach ${aboutDuration(total.years, true)} amortisiert. ` +
      'Der Tarifwechsel selbst erfordert keine Investition; der Speicher allein amortisiert sich ' +
      `${earliest}in ${formatYears(storageYears)}n.`,
  }
}
