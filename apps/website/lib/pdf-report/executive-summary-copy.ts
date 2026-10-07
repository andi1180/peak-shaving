import { formatEur } from '@/lib/format'
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

const SPOT_NAME = 'aWATTar'

/** „Text **fett** Text" → Textstücke. */
function runs(template: string): CopyRun[] {
  return template
    .split('**')
    .map((text, i) => ({ text, bold: i % 2 === 1 }))
    .filter((run) => run.text !== '')
}

function wayLabel(way: ExecutiveSummaryWay): string {
  switch (way.id) {
    case 'today':
      return 'Ihr Tarif heute'
    case 'comparison':
      return way.supplier ? `${way.supplier} (Ihr gefundener Tarif)` : 'Ihr gefundener Tarif'
    case 'spot':
      return `${SPOT_NAME} (Börsenpreis)`
    case 'spot-storage':
      return `${SPOT_NAME} mit Speicher, der günstig lädt`
  }
}

const comparisonTarget = (way: ExecutiveSummaryWay) => way.supplier ?? 'Ihrem gefundenen Tarif'

const MONTH_NAMES = [
  'Jänner',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
]

/** „(März bis August)" aus dem ersten und letzten Tag des Lastgang-Diagramms; ohne Tage leer. */
function measuredMonthsText(s: ExecutiveSummary): string {
  const peaks = s.load.dailyPeaks
  if (peaks.length === 0) return ''
  const month = (day: string) => MONTH_NAMES[new Date(Date.parse(day)).getUTCMonth()]!
  const first = month(peaks[0]!.day)
  const last = month(peaks.at(-1)!.day)
  return first === last ? ` (${first})` : ` (${first} bis ${last})`
}

function basisText(s: ExecutiveSummary): string {
  return s.header.basis === 'projected'
    ? `geschätzt, hochgerechnet aus ${s.header.measuredDays} gemessenen Tagen${measuredMonthsText(s)}`
    : `gerechnet mit Ihren Messwerten von ${s.header.measuredDays} Tagen`
}

function tariffTarget(s: ExecutiveSummary): string {
  const recommended = s.ways.find((way) => way.isRecommended)!
  return recommended.id === 'comparison' ? comparisonTarget(recommended) : SPOT_NAME
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
      ? `durch einen Speicher gegenüber ${SPOT_NAME} ohne Speicher`
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

function loadSentence(s: ExecutiveSummary): string {
  const base = 'Die Balken zeigen Ihre höchste Leistung pro Tag.'
  if (!s.hasLeistungspreis) return base
  const fee = `${base} Der höchste Balken im Monat bestimmt die Spitzengebühr`
  return s.storage?.upperBound
    ? `${fee}; ein Speicher kann Spitzen über der Linie abfangen (Höchstwert).`
    : `${fee}.`
}

function waysSentence(s: ExecutiveSummary): string {
  const recommended = s.ways.find((way) => way.isRecommended)!
  const subject =
    recommended.id === 'spot-storage'
      ? `Mit ${SPOT_NAME} und einem Speicher, der günstig lädt,`
      : `Mit dem Wechsel zu ${recommended.id === 'comparison' ? comparisonTarget(recommended) : SPOT_NAME}`
  const fee = s.hasLeistungspreis ? ' — ohne Spitzengebühr' : ''
  const peak = s.storage?.upperBound
    ? `; deren Einsparung (bis zu ${formatEur(s.storage.peakEur)}) kommt hinzu`
    : ''
  if (s.todayCostPerYearEur === null) {
    const spot = s.ways.find((way) => way.id === 'spot')!
    return (
      `Mit einem Speicher, der günstig lädt, sinken Ihre Kosten bei ${SPOT_NAME} von rund ` +
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
    wayLabels: s.ways.map(wayLabel),
    loadSentence: loadSentence(s),
    waysSentence: waysSentence(s),
    storageSaving:
      st && s.variant !== 'tarif-unbekannt'
        ? `Ersparnis durch den Speicher: ${st.upperBound ? 'bis zu' : 'rund'} ${formatEur(st.savingPerYearEur)} pro Jahr.`
        : null,
    storage: storageRuns(s),
    storageVerdict: s.storageVerdict
      ? `Ein neuer Speicher (${s.storageVerdict.name}) würde rund ${formatEur(s.storageVerdict.savingPerYearEur)} pro Jahr sparen. ${s.storageVerdict.judgement}`
      : null,
  }
}
