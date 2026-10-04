import { formatEur } from '@/lib/format'
import type { ExecutiveSummary, ExecutiveSummaryWay } from './executive-summary'

/**
 * Die Kundentexte der Vorderseite „Auf einen Blick". Kundensprache: keine Fachbegriffe wie
 * „Kappung", „Amortisation", „Ladesteuerung" oder „Leistungspreis" (ein Test hält sie fern), und
 * jede geschätzte oder obere Zahl ist als solche gekennzeichnet.
 */
export type ExecutiveSummaryCopy = {
  headline: string
  stages: string[]
  wayLabels: string[]
  waysParagraph: string
  storage: string[] | null
  storageVerdict: string | null
  confidenceTitle: string
  confidence: string[]
}

const MONTHS = [
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

const SPOT_NAME = 'aWATTar'
const STORAGE_LOADS_CHEAP = 'der Speicher lädt, wenn Strom günstig ist'
const PEAK_FEE = 'die Gebühr für Ihre höchste Leistungsspitze im Monat'

function years(value: number): string {
  return new Intl.NumberFormat('de-AT', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)
}

/** „März bis August", bei Lücken „Jänner, März bis Mai". */
function monthList(months: number[]): string {
  const runs: [number, number][] = []
  for (const m of months) {
    const last = runs.at(-1)
    if (last && m === last[1] + 1) last[1] = m
    else runs.push([m, m])
  }
  return runs
    .map(([from, to]) => (from === to ? MONTHS[from]! : `${MONTHS[from]} bis ${MONTHS[to]}`))
    .join(', ')
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

function basisText(s: ExecutiveSummary): string {
  return s.header.basis === 'projected'
    ? `geschätzt, hochgerechnet aus ${s.header.measuredDays} gemessenen Tagen`
    : `gerechnet mit Ihren Messwerten von ${s.header.measuredDays} Tagen`
}

function stageLines(s: ExecutiveSummary): string[] {
  return s.stages.map((stage) => {
    const eur = formatEur(stage.savingPerYearEur)
    if (stage.id === 'mit-speicher') {
      const st = s.storage!
      return st.upperBound
        ? `Mit einem neuen Speicher zusätzlich bis zu rund ${eur} pro Jahr: ` +
            `rund ${formatEur(st.loadShiftEur)}, weil ${STORAGE_LOADS_CHEAP}, ` +
            `und bis zu ${formatEur(st.peakEur)}, weil er teure Stromspitzen vermeidet.`
        : `Mit einem neuen Speicher zusätzlich rund ${eur} pro Jahr, weil ${STORAGE_LOADS_CHEAP}.`
    }
    if (stage.savingPerYearEur <= 0) {
      return 'Ein Tarifwechsel allein bringt Ihnen derzeit keinen Vorteil.'
    }
    const recommended = s.ways.find((way) => way.isRecommended)!
    const target = recommended.id === 'comparison' ? wayLabel(recommended) : SPOT_NAME
    return s.variant === 'bestandsspeicher'
      ? `Ohne neue Anschaffung: rund ${eur} pro Jahr, wenn Sie zu ${SPOT_NAME} wechseln und ${STORAGE_LOADS_CHEAP.replace('der Speicher', 'Ihr vorhandener Speicher')}.`
      : `Ohne neue Anschaffung: rund ${eur} pro Jahr durch den Wechsel zu ${target}.`
  })
}

function waysParagraph(s: ExecutiveSummary): string {
  const recommended = s.ways.find((way) => way.isRecommended)!
  const withoutPeakFee = s.hasLeistungspreis ? ` (ohne ${PEAK_FEE})` : ''
  const peakPart =
    s.storage && s.storage.upperBound
      ? ` Dazu kommen bis zu ${formatEur(s.storage.peakEur)} pro Jahr weniger für ${PEAK_FEE}, weil der Speicher teure Stromspitzen vermeidet.`
      : ''
  return (
    `Heute zahlen Sie rund ${formatEur(s.todayCostPerYearEur)} pro Jahr für Strom${withoutPeakFee}. ` +
    (recommended.isToday
      ? 'Keiner der anderen Wege ist günstiger.'
      : `Mit dem Weg „${wayLabel(recommended)}" wären es rund ${formatEur(recommended.costPerYearEur)}.`) +
    peakPart
  )
}

function storageLines(s: ExecutiveSummary): string[] | null {
  const st = s.storage
  if (!st) return null
  const included = [
    ...(st.includes.installation ? ['Installation'] : []),
    ...(st.includes.foundation ? ['Betonsockel'] : []),
    ...(st.includes.extraInverter ? ['Wechselrichter'] : []),
  ]
  const payback = Number.isFinite(st.amortizationYears)
    ? `Rückzahlzeit: ${st.upperBound ? 'frühestens ' : ''}ca. ${years(st.amortizationYears)} Jahre`
    : `Rückzahlzeit: innerhalb von ${st.horizonYears} Jahren nicht erreicht`
  return [
    `${st.name}, ${new Intl.NumberFormat('de-AT', { maximumFractionDigits: 1 }).format(st.usableKwh)} kWh nutzbar`,
    `Investition rund ${formatEur(st.investment.investmentEur)} netto` +
      (included.length > 0 ? `, inklusive ${included.join(', ')}` : ''),
    ...(st.hasSubsidy ? [`Nach Förderung rund ${formatEur(st.investment.netEur)}`] : []),
    st.upperBound
      ? `Ersparnis bis zu rund ${formatEur(st.savingPerYearEur)} pro Jahr, davon rund ${formatEur(st.loadShiftEur)}, weil ${STORAGE_LOADS_CHEAP}`
      : `Ersparnis rund ${formatEur(st.savingPerYearEur)} pro Jahr, weil ${STORAGE_LOADS_CHEAP}`,
    payback,
    `Nach ${st.horizonYears} Jahren bleiben ${st.upperBound ? 'bis zu ' : ''}rund ${formatEur(st.netSavingOverHorizonEur)} übrig`,
  ]
}

function confidenceLines(s: ExecutiveSummary): string[] {
  const c = s.confidence
  return [
    c.isProjected
      ? `Hochgerechnet aus ${c.measuredDays} gemessenen Tagen (${monthList(c.measuredMonths)}); die übrigen ${c.projectedDays} Tage sind geschätzt.`
      : `Gerechnet mit ${c.measuredDays} gemessenen Tagen (${monthList(c.measuredMonths)}).`,
    ...(c.hasUpperBound
      ? [
          'Der Betrag für vermiedene Stromspitzen ist ein Höchstwert: er setzt voraus, dass der Speicher jede Spitze rechtzeitig erkennt und genug geladen hat.',
        ]
      : []),
    ...(c.spotTariffRecommended
      ? [
          'Beim Börsentarif ändert sich der Preis stündlich; künftige Preise können höher oder niedriger sein als im gerechneten Zeitraum.',
        ]
      : []),
    'Alle Beträge netto und gerundet. Eine Vorausberechnung, keine Zusage.',
  ]
}

export function executiveSummaryCopy(s: ExecutiveSummary): ExecutiveSummaryCopy {
  const total = s.header.savingPerYearEur
  const upTo = s.confidence.hasUpperBound ? 'bis zu ' : ''
  return {
    headline:
      total > 0
        ? `Sie können ${upTo}rund ${formatEur(total)} pro Jahr sparen (${basisText(s)}).`
        : `Mit den heutigen Daten ergibt sich für Sie keine Ersparnis (${basisText(s)}).`,
    stages: stageLines(s),
    wayLabels: s.ways.map(wayLabel),
    waysParagraph: waysParagraph(s),
    storage: storageLines(s),
    storageVerdict: s.storageVerdict
      ? `Ein neuer Speicher (${s.storageVerdict.name}) würde rund ${formatEur(s.storageVerdict.savingPerYearEur)} pro Jahr sparen. ${s.storageVerdict.judgement}`
      : null,
    confidenceTitle: 'Wie sicher ist das?',
    confidence: confidenceLines(s),
  }
}
