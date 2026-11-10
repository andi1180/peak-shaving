import { countryDisplay, priceBasisLabel, type BillingModel } from 'shared'

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
  /** Überschrift der Wege, nur wo sie nicht „pro Jahr" lautet (einfachere Fassung, gemessener Zeitraum). */
  waysTitle?: string
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
    case 'measured':
      return `Beträge über ${s.header.measuredDays} gemessene Tage${measuredMonthsText(s)}, nicht hochgerechnet`
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
    `${st.name}, ${kwh} kWh nutzbar, Investition rund **${formatEur(st.investment.investmentEur)}** ${priceBasisLabel(s.priceBasis)}${subsidy}. ` +
      `Nach ${st.horizonYears} Jahren bleiben unterm Strich ${st.upperBound ? 'bis zu' : 'rund'} ` +
      `**${formatEur(st.netSavingOverHorizonEur)}**.${beyond}`,
  )
}

export function executiveSummaryCopy(s: ExecutiveSummary): ExecutiveSummaryCopy {
  if (s.simple) return simpleCopy(s, s.simple)
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

/** Bezug der Beträge der einfacheren Fassung: „pro Jahr" oder „über N gemessene Tage". */
function amountBasis(s: ExecutiveSummary): string {
  return s.header.basis === 'measured' ? `über ${s.header.measuredDays} gemessene Tage` : 'pro Jahr'
}

const isUnknownTariff = (s: ExecutiveSummary) =>
  s.variant === 'tarif-unbekannt-messzeitraum' || s.variant === 'tarif-unbekannt-ohne-speicher'

function simpleSavingBox(
  s: ExecutiveSummary,
  simple: NonNullable<ExecutiveSummary['simple']>,
): ExecutiveSummaryCopy['savingBox'] {
  const st = s.storage
  if (st) {
    const against = isUnknownTariff(s) ? `, gegenüber ${spotName(s)} ohne Speicher` : ''
    return {
      label: 'Ersparnis durch den Speicher',
      qualifier: st.upperBound ? 'bis zu' : 'rund',
      amount: formatEur(st.savingPerYearEur),
      sub: `${simple.storagePerYear ?? 'pro Jahr'}${against}`,
    }
  }
  const sentence = (sub: string) => ({ label: 'Ersparnis', qualifier: null, amount: null, sub })
  if (s.variant === 'tarif-unbekannt-ohne-speicher') return sentence(UNKNOWN_TARIFF_NOTE)
  if (s.variant === 'nur-kosten' || s.ways.length === 0) {
    return sentence('Mit den vorliegenden Daten weisen wir keine Ersparnis aus.')
  }
  const saving = simple.switchSavingEur
  const recommended = s.ways.find((way) => way.isRecommended)
  if (saving === null || Math.round(saving) <= 0 || !recommended) {
    return sentence('Mit den heutigen Daten ergibt sich für Sie keine Ersparnis.')
  }
  return {
    label: s.header.basis === 'measured' ? `Ersparnis ${amountBasis(s)}` : 'Ersparnis pro Jahr',
    qualifier: 'rund',
    amount: formatEur(saving),
    sub:
      recommended.id === 'spot-storage'
        ? `mit ${spotName(s)} und Ihrem Speicher, der günstig lädt`
        : `durch den Wechsel zu ${tariffTarget(s)}, ohne Anschaffung`,
  }
}

function simpleBasisLine(s: ExecutiveSummary, simple: NonNullable<ExecutiveSummary['simple']>): string {
  const storage = s.storage ? `; Speicher-Ersparnis ${simple.storagePerYear ?? 'pro Jahr'}` : ''
  const base =
    s.header.basis === 'measured'
      ? `Beträge ${amountBasis(s)}${measuredMonthsText(s)}, nicht hochgerechnet${storage}`
      : basisText(s)
  return s.variant === 'tarif-unbekannt-messzeitraum' ? `${base} · ${UNKNOWN_TARIFF_NOTE}` : base
}

/**
 * Wege-Satz der einfacheren Fassung. Der Bezug der Balken steht in der Überschrift darüber (wie auf
 * der vollen Seite); eigens genannt wird nur die Spitzenersparnis, wenn sie ein Jahreswert neben
 * Zeitraum-Balken ist.
 */
function simpleWaysSentence(s: ExecutiveSummary): string {
  const fee = s.hasLeistungspreis ? ' — ohne Spitzengebühr' : ''
  const costs = s.header.basis === 'measured' ? 'diese Kosten' : 'Ihre Kosten'
  const peak = s.storage?.upperBound
    ? `; deren Einsparung (bis zu ${formatEur(s.storage.peakEur)}${s.header.basis === 'measured' ? ' pro Jahr' : ''}) kommt hinzu`
    : ''
  const byId = (id: ExecutiveSummaryWay['id']) => s.ways.find((way) => way.id === id)
  const today = byId('today')
  const spot = byId('spot')
  const withStorage = byId('spot-storage')
  const recommended = s.ways.find((way) => way.isRecommended)
  if (!today) {
    if (!spot) return ''
    if (recommended && withStorage && s.storage) {
      return (
        `Mit einem Speicher, der günstig lädt, sinken ${costs} bei ${spotName(s)} von rund ` +
        `${formatEur(spot.costPerYearEur)} auf rund ${formatEur(withStorage.costPerYearEur)}${fee}${peak}.`
      )
    }
    const storagePart = withStorage
      ? `, mit einem Speicher, der günstig lädt, rund ${formatEur(withStorage.costPerYearEur)}`
      : ''
    return `Bei ${spotName(s)} kostet Ihr Strom rund ${formatEur(spot.costPerYearEur)}${storagePart}${fee}.`
  }
  const todayText = `Mit Ihrem heutigen Tarif kostet Ihr Strom rund ${formatEur(today.costPerYearEur)}${fee}`
  if (!spot) return `${todayText}. ${NO_DYNAMIC_TARIFF_TERMS_NOTE}`
  if (!recommended) return `${todayText}; keiner der geprüften Tarifwege ist günstiger.`
  const subject =
    recommended.id === 'spot-storage'
      ? s.variant === 'bestandsspeicher'
        ? `Mit ${spotName(s)} und Ihrem Speicher, der günstig lädt,`
        : `Mit ${spotName(s)} und einem Speicher, der günstig lädt,`
      : `Mit dem Wechsel zu ${tariffTarget(s)}`
  return (
    `${subject} sinken ${costs} von rund ${formatEur(today.costPerYearEur)} ` +
    `auf rund ${formatEur(recommended.costPerYearEur)}${fee}${peak}.`
  )
}

function simpleStorageVerdict(
  s: ExecutiveSummary,
  simple: NonNullable<ExecutiveSummary['simple']>,
): string | null {
  if (s.variant === 'bestandsspeicher') return 'Ihr bestehender Speicher ist in allen Zahlen berücksichtigt.'
  if (s.storageVerdict) {
    return (
      `Ein neuer Speicher (${s.storageVerdict.name}) würde rund ${formatEur(s.storageVerdict.savingPerYearEur)} ` +
      `${simple.storagePerYear ?? 'pro Jahr'} sparen. ${s.storageVerdict.judgement}`
    )
  }
  return simple.noStorageNote
}

/**
 * Die Texte der einfacheren Fassung (`simpleSummaryOf`): jede Zahl mit ihrem Bezug, Perioden- und
 * Jahreswerte nie zusammengezählt; was es nicht ehrlich gibt, entfällt.
 */
function simpleCopy(
  s: ExecutiveSummary,
  simple: NonNullable<ExecutiveSummary['simple']>,
): ExecutiveSummaryCopy {
  const spot = spotName(s)
  return {
    savingBox: simpleSavingBox(s, simple),
    paybackBox: paybackBox(s),
    totalBox: null,
    basisLine: simpleBasisLine(s, simple),
    wayLabels: s.ways.map((way) =>
      way.id === 'spot-storage' && s.variant === 'bestandsspeicher'
        ? `${spot} mit Ihrem Speicher, der günstig lädt`
        : wayLabel(way, spot),
    ),
    ...(s.header.basis === 'measured' ? { waysTitle: `Ihre Stromkosten ${amountBasis(s)}` } : {}),
    loadSentence: loadSentence(s),
    waysSentence: simpleWaysSentence(s),
    storageSaving: null,
    storage: storageRuns(s),
    storageVerdict: simpleStorageVerdict(s, simple),
  }
}
