import { formatEur } from '@/lib/format'
import type { ExecutiveSummary, ExecutiveSummaryWay } from './executive-summary'

/**
 * Die Kundentexte der Vorderseite „Auf einen Blick". Kundensprache: keine Fachbegriffe wie
 * „Kappung", „Amortisation", „Ladesteuerung" oder „Leistungspreis" (ein Test hält sie fern), und
 * jede geschätzte oder obere Zahl ist als solche gekennzeichnet.
 */

/** Ein Textstück; `bold` für Zahlen im Fliesstext. */
export type CopyRun = { text: string; bold: boolean }

export type ExecutiveSummaryCopy = {
  /** Die grosse Zahl („bis zu € 10.150") mit „pro Jahr"; ohne Ersparnis nur der Satz. */
  hero: { amount: string | null; text: string }
  basis: string
  stages: { amount: string | null; label: string }[]
  wayLabels: string[]
  loadSentence: string
  waysSentence: string
  /** Sätze unter dem Break-even-Band, nur mit Speicherempfehlung. */
  storage: CopyRun[] | null
  storageVerdict: string | null
}

/** Fusszeile der Vorderseite — eine Konstante, damit sie sich leicht entfernen lässt. */
export const EXECUTIVE_SUMMARY_FOOTER =
  'Schätzung, keine Zusage. Annahmen und Risiken, u. a. beim Börsenpreis, im weiteren Bericht.'

const SPOT_NAME = 'aWATTar'
const PEAK_FEE = 'die Spitzengebühr (für die höchste Spitze im Monat)'

/** „ca. 4 Jahren" — eine Nachkommastelle wie `formatYears`, im Dativ. */
function yearsDative(value: number): string {
  const n = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 1 }).format(value)
  return `ca. ${n} ${n === '1' ? 'Jahr' : 'Jahren'}`
}

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

function basisText(s: ExecutiveSummary): string {
  return s.header.basis === 'projected'
    ? `geschätzt, hochgerechnet aus ${s.header.measuredDays} gemessenen Tagen`
    : `gerechnet mit Ihren Messwerten von ${s.header.measuredDays} Tagen`
}

function stageLines(s: ExecutiveSummary): ExecutiveSummaryCopy['stages'] {
  return s.stages.map((stage) => {
    const eur = formatEur(stage.savingPerYearEur)
    if (stage.id === 'mit-speicher') {
      return {
        amount: s.storage!.upperBound ? `bis zu ${eur}` : eur,
        label: 'mit einem Speicher dazu',
      }
    }
    if (stage.savingPerYearEur <= 0) {
      return { amount: null, label: 'Ein Tarifwechsel allein bringt Ihnen derzeit keinen Vorteil.' }
    }
    const recommended = s.ways.find((way) => way.isRecommended)!
    const target = recommended.id === 'comparison' ? comparisonTarget(recommended) : SPOT_NAME
    return { amount: eur, label: `Wechsel zu ${target}, ohne Anschaffung` }
  })
}

function loadSentence(s: ExecutiveSummary): string {
  const base = 'Die Balken zeigen Ihre höchste Leistung pro Tag.'
  if (!s.hasLeistungspreis) return base
  return s.storage?.upperBound
    ? `${base} Sie bestimmen ${PEAK_FEE}; ein Speicher kann Spitzen über der Linie abfangen (Höchstwert).`
    : `${base} Sie bestimmen ${PEAK_FEE}.`
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
  return (
    `${subject} sinken Ihre Kosten von rund ${formatEur(s.todayCostPerYearEur)} ` +
    `auf rund ${formatEur(recommended.costPerYearEur)}${fee}${peak}.`
  )
}

function storageRuns(s: ExecutiveSummary): CopyRun[] | null {
  const st = s.storage
  if (!st) return null
  const kwh = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 1 }).format(st.usableKwh)
  const subsidy = st.hasSubsidy
    ? `, nach Förderung rund **${formatEur(st.investment.netEur)}**`
    : ''
  const withoutPeaks =
    st.paybackWithoutPeaksYears === null
      ? ''
      : st.paybackWithoutPeaksBeyondHorizon
        ? `; allein durch günstiges Laden rechnet sich der Speicher innerhalb von ${st.horizonYears} Jahren nicht`
        : `; allein durch günstiges Laden nach **${yearsDative(st.paybackWithoutPeaksYears)}**`
  const payback = Number.isFinite(st.amortizationYears)
    ? `Rückzahlzeit: ${st.upperBound ? 'frühestens ' : ''}nach **${yearsDative(st.amortizationYears)}**${withoutPeaks}.`
    : `Rückzahlzeit: innerhalb von ${st.horizonYears} Jahren nicht erreicht.`
  return runs(
    `${st.name}, ${kwh} kWh nutzbar, Investition rund **${formatEur(st.investment.investmentEur)}** netto${subsidy}. ` +
      `${payback} Nach ${st.horizonYears} Jahren bleiben unterm Strich ${st.upperBound ? 'bis zu' : 'rund'} ` +
      `**${formatEur(st.netSavingOverHorizonEur)}**.`,
  )
}

export function executiveSummaryCopy(s: ExecutiveSummary): ExecutiveSummaryCopy {
  const total = s.header.savingPerYearEur
  return {
    hero:
      total > 0
        ? {
            amount: `${s.confidence.hasUpperBound ? 'bis zu' : 'rund'} ${formatEur(total)}`,
            text: 'pro Jahr',
          }
        : { amount: null, text: 'Mit den heutigen Daten ergibt sich für Sie keine Ersparnis.' },
    basis: basisText(s),
    stages: stageLines(s),
    wayLabels: s.ways.map(wayLabel),
    loadSentence: loadSentence(s),
    waysSentence: waysSentence(s),
    storage: storageRuns(s),
    storageVerdict: s.storageVerdict
      ? `Ein neuer Speicher (${s.storageVerdict.name}) würde rund ${formatEur(s.storageVerdict.savingPerYearEur)} pro Jahr sparen. ${s.storageVerdict.judgement}`
      : null,
  }
}
