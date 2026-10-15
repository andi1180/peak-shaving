import { COUNTRY_LABELS, isCountry, type LevyCoverageStatus } from 'shared'

/**
 * Die Hinweise des Abgaben-Warnbalkens im Admin-Bereich — rein, damit testbar ohne Renderer.
 * Nie im Kundenreport: dort entfällt bei fehlenden Sätzen der Vergleich mit benanntem Grund.
 */
export type LevyCoverageNotice = { tone: 'warn' | 'expired'; text: string }

function countryLabel(country: string): string {
  return isCountry(country) ? COUNTRY_LABELS[country] : country
}

function formatIsoDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  return `${day}.${month}.${year}`
}

export function levyCoverageNotices(
  statuses: readonly LevyCoverageStatus[],
  today: string,
): LevyCoverageNotice[] {
  const notices: LevyCoverageNotice[] = []
  for (const s of statuses) {
    if (s.status !== 'expired') continue
    notices.push({
      tone: 'expired',
      text:
        s.coverageEnd === null
          ? `Abgabensätze für ${countryLabel(s.country)} sind nicht hinterlegt. Vergleiche werden verweigert. Sätze nachtragen.`
          : `Abgabensätze für ${countryLabel(s.country)} nur bis ${formatIsoDate(s.coverageEnd)} hinterlegt. Vergleiche ab diesem Datum werden verweigert. Sätze nachtragen.`,
    })
  }
  const warned = statuses.filter((s) => s.status === 'warn').map((s) => countryLabel(s.country))
  if (warned.length > 0) {
    const nextYear = Number(today.slice(0, 4)) + 1
    notices.push({
      tone: 'warn',
      text:
        `Abgabensätze für ${nextYear} fehlen für ${warned.join(', ')}. Ab 01.01.${nextYear} werden ` +
        'Tarifvergleiche verweigert. Jahrespflege nötig (Projektdoc Jahrespflege_Tarifsaetze.md).',
    })
  }
  return notices
}
