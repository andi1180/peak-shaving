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
  /** Nur mit Spitzenersparnis: was die Balken nicht enthalten. */
  waysFootnote: string | null
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

/** „nach ca. 4 Jahren" — eine Nachkommastelle wie `formatYears`, im Dativ. */
function afterYears(value: number): string {
  const n = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 1 }).format(value)
  return `nach ca. ${n} ${n === '1' ? 'Jahr' : 'Jahren'}`
}

/** Jänner, Februar, November, Dezember. */
const WINTER_MONTHS = [0, 1, 10, 11]

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
        ? `Mit einem neuen Speicher zusätzlich bis zu ${eur} pro Jahr: ` +
            `rund ${formatEur(st.loadShiftEur)}, weil ${STORAGE_LOADS_CHEAP}, ` +
            `und bis zu ${formatEur(st.peakEur)}, weil er teure Stromspitzen vermeidet.`
        : `Mit einem neuen Speicher zusätzlich rund ${eur} pro Jahr, weil ${STORAGE_LOADS_CHEAP}.`
    }
    if (stage.savingPerYearEur <= 0) {
      return 'Ein Tarifwechsel allein bringt Ihnen derzeit keinen Vorteil.'
    }
    const recommended = s.ways.find((way) => way.isRecommended)!
    const target = recommended.id === 'comparison' ? wayLabel(recommended) : SPOT_NAME
    return `Ohne neue Anschaffung: rund ${eur} pro Jahr durch den Wechsel zu ${target}.`
  })
}

function waysParagraph(s: ExecutiveSummary): string {
  const recommended = s.ways.find((way) => way.isRecommended)!
  return (
    `Heute zahlen Sie rund ${formatEur(s.todayCostPerYearEur)} pro Jahr für Strom. ` +
    (recommended.isToday
      ? 'Keiner der anderen Wege ist günstiger.'
      : `Mit dem Weg „${wayLabel(recommended)}" wären es rund ${formatEur(recommended.costPerYearEur)}.`)
  )
}

/** Der zweite Teil der Rückzahlzeit, wenn sie die Spitzenersparnis als Obergrenze enthält. */
function paybackWithoutPeaks(st: NonNullable<ExecutiveSummary['storage']>): string {
  if (st.paybackWithoutPeaksYears === null) return ''
  return st.paybackWithoutPeaksBeyondHorizon
    ? `; allein durch günstiges Laden rechnet sich der Speicher innerhalb von ${st.horizonYears} Jahren nicht`
    : `; allein durch günstiges Laden ${afterYears(st.paybackWithoutPeaksYears)}`
}

/** Die Balken sind ohne Spitzengebühr gerechnet — das steht da, sobald der Tarif eine hat. */
function waysFootnote(s: ExecutiveSummary): string | null {
  if (!s.hasLeistungspreis) return null
  const base =
    'Stromkosten ohne die Spitzengebühr (die gesonderte Gebühr für Ihre höchste Leistungsspitze im Monat).'
  return s.storage?.upperBound
    ? `${base} Deren Einsparung (bis zu ${formatEur(s.storage.peakEur)}) kommt hinzu.`
    : base
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
    ? `Rückzahlzeit: ${st.upperBound ? 'frühestens ' : ''}${afterYears(st.amortizationYears)}` +
      paybackWithoutPeaks(st)
    : `Rückzahlzeit: innerhalb von ${st.horizonYears} Jahren nicht erreicht`
  return [
    `${st.name}, ${new Intl.NumberFormat('de-AT', { maximumFractionDigits: 1 }).format(st.usableKwh)} kWh nutzbar`,
    `Investition rund ${formatEur(st.investment.investmentEur)} netto` +
      (included.length > 0 ? `, inklusive ${included.join(', ')}` : ''),
    ...(st.hasSubsidy ? [`Nach Förderung rund ${formatEur(st.investment.netEur)}`] : []),
    st.upperBound
      ? `Ersparnis bis zu ${formatEur(st.savingPerYearEur)} pro Jahr, davon rund ${formatEur(st.loadShiftEur)}, weil ${STORAGE_LOADS_CHEAP}`
      : `Ersparnis rund ${formatEur(st.savingPerYearEur)} pro Jahr, weil ${STORAGE_LOADS_CHEAP}`,
    payback,
    `Nach ${st.horizonYears} Jahren bleiben unterm Strich ${st.upperBound ? 'bis zu' : 'rund'} ${formatEur(st.netSavingOverHorizonEur)} (nach Abzug der Investition).`,
  ]
}

/** Börsenpreis-Risiko, beziffert mit dem Tarifwechsel-Anteil (Stufe 1), sofern er etwas spart. */
function spotPriceLine(s: ExecutiveSummary): string {
  const switchEur = s.stages[0]!.savingPerYearEur
  const total = s.header.savingPerYearEur
  if (switchEur <= 0 || total <= 0) {
    return 'Beim Börsentarif ändert sich der Preis stündlich; künftige Preise können höher oder niedriger sein als im gerechneten Zeitraum.'
  }
  return (
    `${switchEur >= total / 2 ? 'Der größte Teil' : 'Ein Teil'} der Ersparnis (rund ${formatEur(switchEur)}) ` +
    `kommt vom Wechsel zu ${SPOT_NAME} und hängt damit am Börsenpreis; dieser ändert sich stündlich, ` +
    'künftige Preise können höher oder niedriger sein.'
  )
}

function confidenceLines(s: ExecutiveSummary): string[] {
  const c = s.confidence
  return [
    c.isProjected
      ? `Hochgerechnet aus ${c.measuredDays} gemessenen Tagen (${monthList(c.measuredMonths)}); die übrigen ${c.projectedDays} Tage sind geschätzt.`
      : `Gerechnet mit ${c.measuredDays} gemessenen Tagen (${monthList(c.measuredMonths)}).`,
    ...(c.measuredMonths.some((m) => WINTER_MONTHS.includes(m))
      ? []
      : [
          `Gemessen wurde nur in den wärmeren Monaten (${monthList(c.measuredMonths)}); im Winter kann die Ersparnis geringer ausfallen.`,
        ]),
    ...(c.hasUpperBound
      ? [
          'Der Betrag für vermiedene Stromspitzen ist ein Höchstwert: er setzt voraus, dass der Speicher jede Spitze rechtzeitig erkennt und genug geladen hat.',
        ]
      : []),
    ...(c.spotTariffRecommended ? [spotPriceLine(s)] : []),
    'Alle Beträge netto und gerundet. Eine Vorausberechnung, keine Zusage.',
  ]
}

export function executiveSummaryCopy(s: ExecutiveSummary): ExecutiveSummaryCopy {
  const total = s.header.savingPerYearEur
  return {
    headline:
      total > 0
        ? `Sie können ${s.confidence.hasUpperBound ? 'bis zu' : 'rund'} ${formatEur(total)} pro Jahr sparen (${basisText(s)}).`
        : `Mit den heutigen Daten ergibt sich für Sie keine Ersparnis (${basisText(s)}).`,
    stages: stageLines(s),
    wayLabels: s.ways.map(wayLabel),
    waysParagraph: waysParagraph(s),
    waysFootnote: waysFootnote(s),
    storage: storageLines(s),
    storageVerdict: s.storageVerdict
      ? `Ein neuer Speicher (${s.storageVerdict.name}) würde rund ${formatEur(s.storageVerdict.savingPerYearEur)} pro Jahr sparen. ${s.storageVerdict.judgement}`
      : null,
    confidenceTitle: 'Wie sicher ist das?',
    confidence: confidenceLines(s),
  }
}
