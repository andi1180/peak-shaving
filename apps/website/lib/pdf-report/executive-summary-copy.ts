import { countryDisplay, type BillingModel } from 'shared'

import { formatEur } from '@/lib/format'
import { FALLBACK_DYNAMIC_TARIFF, NO_DYNAMIC_TARIFF_TERMS_NOTE } from '@/lib/report-copy'
import { aboutYears } from './break-even-band'
import type { ExecutiveSummary, ExecutiveSummaryWay } from './executive-summary'
import { aboutDuration, totalAmortizationOf } from './total-amortization'

/**
 * Die Kundentexte der Vorderseite „Auf einen Blick". Kundensprache: keine Fachbegriffe wie
 * „Kappung", „Amortisation", „Ladesteuerung" oder „Leistungspreis" (ein Test hält sie fern), und
 * jede geschätzte oder obere Zahl ist als solche gekennzeichnet.
 */

/** Ein Textstück; `bold` für Zahlen im Fliesstext. */
export type CopyRun = { text: string; bold: boolean }

export type ExecutiveSummaryCopy = {
  /** Linke Box: Ersparnis pro Jahr; ohne Ersparnis steht statt der Zahl der Satz. */
  savingBox: { label: string; qualifier: string | null; amount: string | null; sub: string }
  /** Rechte Box, nur mit Speicherblock. */
  paybackBox: { label: string; prefix: string | null; value: string; sub: string } | null
  /** Neben der Rückzahlzeit des Speichers: Amortisation der Gesamtmaßnahme, nur mit Tarifwechsel-Anteil. */
  totalBox: { label: string; prefix: string | null; value: string; sub: string } | null
  /** Zeile unter den Boxen: Rechenbasis, bei unbekanntem Tarif mit dem Hinweis darauf. */
  basisLine: string
  wayLabels: string[]
  loadSentence: string
  waysSentence: string
  /** Zeile unter „Ihr Speicher" — entfällt, wo die Speicher-Ersparnis schon die grosse Zahl ist. */
  storageSaving: string | null
  /** Sätze unter dem Break-even-Band, nur mit Speicherempfehlung. */
  storage: CopyRun[] | null
  storageVerdict: string | null
}

/** Fusszeile der Vorderseite — eine Konstante, damit sie sich leicht entfernen lässt. */
export const EXECUTIVE_SUMMARY_FOOTER =
  'Schätzung, keine Zusage. Annahmen und Risiken, u. a. beim Börsenpreis, im weiteren Bericht.'

/** Name des dynamischen Tarifs der Vorderseite; ohne Angabe der bisherige feste Name. */
const spotName = (s: ExecutiveSummary): string => s.tariffName ?? FALLBACK_DYNAMIC_TARIFF.name

/** „Text **fett** Text" → Textstücke. */
function runs(template: string): CopyRun[] {
  return template
    .split('**')
    .map((text, i) => ({ text, bold: i % 2 === 1 }))
    .filter((run) => run.text !== '')
}

function wayLabel(way: ExecutiveSummaryWay, spot: string): string {
  switch (way.id) {
    case 'today':
      return 'Ihr Tarif heute'
    case 'comparison':
      return way.supplier ? `${way.supplier} (Ihr gefundener Tarif)` : 'Ihr gefundener Tarif'
    case 'spot':
      return `${spot} (Börsenpreis)`
    case 'spot-storage':
      return `${spot} mit Speicher, der günstig lädt`
  }
}

const comparisonTarget = (way: ExecutiveSummaryWay) => way.supplier ?? 'Ihrem gefundenen Tarif'

/** „(März bis August)" aus dem ersten und letzten Tag des Lastgang-Diagramms; ohne Tage leer. */
function measuredMonthsText(s: ExecutiveSummary): string {
  const peaks = s.load.dailyPeaks
  if (peaks.length === 0) return ''
  const names = countryDisplay(s.load.country).monthsLong
  const month = (day: string) => names[new Date(Date.parse(day)).getUTCMonth()]!
  const first = month(peaks[0]!.day)
  const last = month(peaks.at(-1)!.day)
  return first === last ? ` (${first})` : ` (${first} bis ${last})`
}

/** Wortlaut der Basis `projected`; die Zusammenfassung übernimmt ihn für „Ihre Stromkosten heute". */
export const PROJECTED_BASIS_WORDS = 'geschätzt, hochgerechnet'

function basisText(s: ExecutiveSummary): string {
  switch (s.header.basis) {
    case 'projected':
      return `${PROJECTED_BASIS_WORDS} aus ${s.header.measuredDays} gemessenen Tagen${measuredMonthsText(s)}`
    case 'linear':
      return `Jahreswerte linear hochgerechnet aus ${s.header.measuredDays} Tagen Messdaten.`
    case 'annual':
      return `gerechnet mit Ihren Messwerten von ${s.header.measuredDays} Tagen`
  }
}

function tariffTarget(s: ExecutiveSummary): string {
  const recommended = s.ways.find((way) => way.isRecommended)!
  return recommended.id === 'comparison' ? comparisonTarget(recommended) : spotName(s)
}

const UNKNOWN_TARIFF_NOTE =
  'Ihren aktuellen Tarif kennen wir nicht; ein Tarifwechsel ist deshalb nicht bewertet.'

/**
 * Tarifwechsel-Anteil der Hero-Zahl, wenn daneben eine Rückzahlzeit steht: dann nennen beide Boxen
 * ihren Bezug, sonst teilt man die Investition durch die Gesamtersparnis.
 */
function switchShareBesidePayback(s: ExecutiveSummary): number | null {
  if (!s.storage || s.variant === 'tarif-unbekannt') return null
  const stage = s.stages.find((st) => st.id === 'ohne-anschaffung')
  return stage && stage.savingPerYearEur > 0 ? stage.savingPerYearEur : null
}

/** Mit Speicher, aber der Tarifwechsel allein spart nichts: die Ersparnis kommt vom Speicher. */
const switchAloneSavesNothing = (s: ExecutiveSummary): boolean =>
  (s.stages.find((st) => st.id === 'ohne-anschaffung')?.savingPerYearEur ?? Infinity) <= 0

function savingBox(s: ExecutiveSummary): ExecutiveSummaryCopy['savingBox'] {
  const label = 'Ersparnis pro Jahr'
  const total = s.header.savingPerYearEur
  if (total <= 0) {
    return {
      label,
      qualifier: null,
      amount: null,
      sub: 'Mit den heutigen Daten ergibt sich für Sie keine Ersparnis.',
    }
  }
  const switchShare = switchShareBesidePayback(s)
  const sub =
    switchShare !== null
      ? `davon ${formatEur(switchShare)} ohne Investition (Tarifwechsel)`
      : s.variant === 'tarif-unbekannt'
      ? `durch einen Speicher gegenüber ${spotName(s)} ohne Speicher`
      : s.variant === 'nur-speicher'
        ? 'durch einen Speicher in Ihrem heutigen Tarif'
      : s.storage && switchAloneSavesNothing(s)
        ? `Speicher mit ${spotName(s) || 'dynamischem Tarif'}`
      : s.storage
        ? 'Tarifwechsel plus Speicher'
        : `durch den Wechsel zu ${tariffTarget(s)}, ohne Anschaffung`
  return {
    label,
    qualifier: s.confidence.hasUpperBound ? 'bis zu' : 'rund',
    amount: formatEur(total),
    sub,
  }
}

function paybackBox(s: ExecutiveSummary): ExecutiveSummaryCopy['paybackBox'] {
  const st = s.storage
  if (!st) return null
  const investment = formatEur(st.investment.netEur)
  // Mit Tarifwechsel-Anteil links: Betrag hier ist die Investition, auf der die Rückzahlzeit beruht
  // (nach Förderung), daneben die Speicher-Ersparnis; „nach Förderung" passt bei 9 pt nicht mehr.
  const sub =
    switchShareBesidePayback(s) !== null
      ? `${investment} Investition, spart ${st.upperBound ? 'bis zu' : 'rund'} ${formatEur(st.savingPerYearEur)}/Jahr`
      : st.hasSubsidy
        ? `bei ${investment} Investition nach Förderung`
        : `bei ${investment} Investition`
  return {
    label: totalAmortizationOf(s) ? 'Speicher allein' : 'Rückzahlzeit des Speichers',
    prefix: st.upperBound ? 'frühestens' : null,
    value: aboutYears(st.amortizationYears),
    sub,
  }
}

function totalBox(s: ExecutiveSummary): ExecutiveSummaryCopy['totalBox'] {
  const total = totalAmortizationOf(s)
  if (!total) return null
  return {
    label: 'Gesamtmaßnahme',
    prefix: total.upperBound ? 'frühestens' : null,
    value: aboutDuration(total.years),
    sub: 'alle Maßnahmen zusammen',
  }
}

/** Welche Spitze die Gebühr bestimmt — je Abrechnungsmodell. */
const PEAK_FEE_SENTENCE: Record<BillingModel, string> = {
  annual_max: 'Die höchste Viertelstunde im Abrechnungsjahr bestimmt die Spitzengebühr',
  monthly_max_average: 'Der höchste Balken im Monat bestimmt die Spitzengebühr',
  monthly_max_sum: 'Der höchste Balken im Monat bestimmt die Spitzengebühr',
}

function loadSentence(s: ExecutiveSummary): string {
  const base = 'Die Balken zeigen Ihre höchste Leistung pro Tag.'
  if (!s.hasLeistungspreis) return base
  const fee = `${base} ${PEAK_FEE_SENTENCE[s.billingModel ?? 'monthly_max_sum']}`
  return s.storage?.upperBound
    ? `${fee}; ein Speicher kann Spitzen über der Linie abfangen (Höchstwert).`
    : `${fee}.`
}

function waysSentence(s: ExecutiveSummary): string {
  const recommended = s.ways.find((way) => way.isRecommended)
  // Ohne Börsenseite gibt es nur „Ihr Tarif heute" — und den Grund, warum kein Vergleich daneben steht.
  if (!recommended) {
    const today = s.todayCostPerYearEur ?? 0
    const fee = s.hasLeistungspreis ? ' — ohne Spitzengebühr' : ''
    return `Mit Ihrem heutigen Tarif kostet Ihr Strom rund ${formatEur(today)}${fee}. ${NO_DYNAMIC_TARIFF_TERMS_NOTE}`
  }
  const subject =
    recommended.id === 'spot-storage'
      ? `Mit ${spotName(s)} und einem Speicher, der günstig lädt,`
      : `Mit dem Wechsel zu ${recommended.id === 'comparison' ? comparisonTarget(recommended) : spotName(s)}`
  const tierChange = s.storage?.tierChange === true
  const fee = s.hasLeistungspreis
    ? tierChange
      ? ' — ohne Netzentgelt aus Leistung und Stufe'
      : ' — ohne Spitzengebühr'
    : ''
  const peak = s.storage?.upperBound
    ? `; ${tierChange ? 'dessen' : 'deren'} Einsparung (bis zu ${formatEur(s.storage.peakEur)}) kommt hinzu`
    : ''
  if (s.todayCostPerYearEur === null) {
    const spot = s.ways.find((way) => way.id === 'spot')!
    return (
      `Mit einem Speicher, der günstig lädt, sinken Ihre Kosten bei ${spotName(s)} von rund ` +
      `${formatEur(spot.costPerYearEur)} auf rund ${formatEur(recommended.costPerYearEur)}${fee}${peak}.`
    )
  }
  return (
    `${subject} sinken Ihre Kosten von rund ${formatEur(s.todayCostPerYearEur)} ` +
    `auf rund ${formatEur(recommended.costPerYearEur)}${fee}${peak}.`
  )
}

/**
 * Sätze unter dem Speicherblock: Gerät mit Investition und der Betrag nach dem Horizont. Die
 * Rückzahlzeit tragen Box und Band; nur „rechnet sich allein durch Laden nicht" hat dort keinen Marker.
 */
function storageRuns(s: ExecutiveSummary): CopyRun[] | null {
  const st = s.storage
  if (!st) return null
  const kwh = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 1 }).format(st.usableKwh)
  const subsidy = st.hasSubsidy
    ? `, nach Förderung rund **${formatEur(st.investment.netEur)}**`
    : ''
  const beyond = st.paybackWithoutPeaksBeyondHorizon
    ? ` Allein durch günstiges Laden rechnet sich der Speicher innerhalb von ${st.horizonYears} Jahren nicht.`
    : ''
  return runs(
    `${st.name}, ${kwh} kWh nutzbar, Investition rund **${formatEur(st.investment.investmentEur)}** netto${subsidy}. ` +
      `Nach ${st.horizonYears} Jahren bleiben unterm Strich ${st.upperBound ? 'bis zu' : 'rund'} ` +
      `**${formatEur(st.netSavingOverHorizonEur)}**.${beyond}`,
  )
}

export function executiveSummaryCopy(s: ExecutiveSummary): ExecutiveSummaryCopy {
  const st = s.storage
  return {
    savingBox: savingBox(s),
    paybackBox: paybackBox(s),
    totalBox: totalBox(s),
    basisLine:
      s.variant === 'tarif-unbekannt' ? `${basisText(s)} · ${UNKNOWN_TARIFF_NOTE}` : basisText(s),
    wayLabels: s.ways.map((way) => wayLabel(way, spotName(s))),
    loadSentence: loadSentence(s),
    waysSentence: waysSentence(s),
    storageSaving:
      st && s.variant !== 'tarif-unbekannt' && s.variant !== 'nur-speicher'
        ? `Ersparnis durch den Speicher: ${st.upperBound ? 'bis zu' : 'rund'} ${formatEur(st.savingPerYearEur)} pro Jahr.`
        : null,
    storage: storageRuns(s),
    storageVerdict: s.storageVerdict
      ? `Ein neuer Speicher (${s.storageVerdict.name}) würde rund ${formatEur(s.storageVerdict.savingPerYearEur)} pro Jahr sparen. ${s.storageVerdict.judgement}`
      : null,
  }
}
