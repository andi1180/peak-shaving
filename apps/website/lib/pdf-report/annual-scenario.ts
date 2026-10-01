import { EXISTING_BATTERY_ID, displayedPriceLabel } from 'shared'
import type { AnnualScenario } from 'shared'

import { formatEur } from '@/lib/format'
import { CONTROLLED_WAY_LABEL } from '@/lib/report-copy'
import { hasAdviceChapter } from './advice'
import { ADVICE_SECTION } from './content'
import type { ReportNotice, ReportRow, ReportStatement } from './statement'
import { summaryWaysOf } from './summary'
import type { PdfReportInput } from './types'

/**
 * D6 Teil 3 — das Kapitel „Hochrechnung auf ein ganzes Jahr", direkt hinter den Wegen.
 *
 * ⚠ ES KONKURRIERT NICHT MIT DER ERSPARNIS-SPANNE DER ZUSAMMENFASSUNG (D8): die Kopfzahlen vorne
 * beziehen sich auf den GEMESSENEN Zeitraum, die Zahlen hier auf 365 Tage; `summary.ts` liest
 * `annualScenario` nirgends. Hier dürfen die drei Ersparnisanteile addiert werden, weil alle drei
 * Jahresgrössen auf demselben hochgerechneten Lastgang sind.
 *
 * ⚠ DIESE DATEI DARF `@react-pdf/renderer` NICHT ANFASSEN — gerendert wird in `document.tsx`.
 */

export type AnnualScenarioChapter = {
  /** Die Absätze in Dokumentreihenfolge. */
  statements: ReportStatement[]
  /** Die Jahres-Gesamtersparnis = Summe der gerundeten Zeilen. */
  totalSavingEur: number
}

/**
 * PV in der Rechnung: die Füllung trägt Tage einer Jahreszeit in eine andere, und mit PV wandert
 * dabei die Erzeugung mit (zu wenig Bezug im Winter) — dann gibt es das Kapitel nicht.
 */
function involvesPv(input: PdfReportInput): boolean {
  const source = input.loadProfile.source
  return (
    input.hasPv === true ||
    input.estimatedPv != null ||
    input.loadProfile.pvSource === 'estimated' ||
    source === 'net_signed' ||
    source === 'import_export_split'
  )
}

/**
 * Gibt es dieses Kapitel? Die Hochrechnung muss gerechnet sein, etwas muss gefehlt haben, das
 * Gerät des Hauptreports muss genannt sein, das Wege-Kapitel muss stehen, und es darf keine PV
 * im Spiel sein.
 */
export function hasAnnualScenarioChapter(input: PdfReportInput): boolean {
  return buildAnnualScenarioChapter(input) !== null
}

/** `YYYY-MM-DD` → `TT.MM.JJJJ`. Reine Zeichenkettenarbeit: das Datum ist bereits Ortszeit. */
function formatDate(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`
}

/** Ganze Euro — die Zeilen der Übersicht werden VOR dem Summieren gerundet, damit die Summe stimmt. */
const euros = (value: number): number => Math.round(value)

/** Wie der Speicher im Fliesstext heisst: der eigene als „Ihr bestehender Speicher", sonst sein Name. */
function deviceRef(scenario: AnnualScenario): string {
  const device = scenario.device!
  return device.batteryId === EXISTING_BATTERY_ID
    ? 'Ihrem bestehenden Speicher'
    : `dem Speicher „${device.name}"`
}

export function buildAnnualScenarioChapter(input: PdfReportInput): AnnualScenarioChapter | null {
  const analysis = input.analysis
  const scenario = analysis.annualScenario
  if (!scenario || scenario.projectedDays <= 0 || !scenario.device) return null
  if (summaryWaysOf(analysis) === null || involvesPv(input)) return null
  const { currentTariffEur, spotWithoutControlEur, controlledEur } = scenario.ways
  // Ohne „Ihr Tarif heute" (Liefertarif unbekannt) oder ohne gesteuerte Reihe fehlt die Grundlage.
  if (currentTariffEur === null || controlledEur === null) return null

  const days = scenario.measuredDays + scenario.projectedDays
  const measuredPercent = Math.round((scenario.measuredDays / days) * 100)
  const priceLabel = displayedPriceLabel(analysis)
  const window = `${formatDate(scenario.windowFromDate)} bis ${formatDate(scenario.windowToDate)}`
  const ratesNote = scenario.ratesAsOf
    ? `Netzentgelte und Abgaben im Stand vom ${formatDate(scenario.ratesAsOf)}`
    : 'Netzentgelte und Abgaben zum jeweiligen Datum'

  const basis: ReportStatement = {
    id: 'annual_scenario_basis',
    title: 'Worauf diese Hochrechnung beruht',
    amount: null,
    rows: [],
    body:
      `Für ${scenario.measuredDays} von ${days} Tagen (${measuredPercent} %) liegen Messdaten vor. ` +
      `Die übrigen ${scenario.projectedDays} Tage haben wir ergänzt, indem wir Ihr gemessenes ` +
      'Verbrauchsmuster Woche für Woche rückwärts fortgeschrieben haben: jeder Tag bekommt den ' +
      'Verlauf desselben Wochentags, Feiertage sind nicht gesondert berücksichtigt. Gerechnet ist ' +
      `der Zeitraum ${window} mit den echten aWATTar-Börsenpreisen dieser Tage; ${ratesNote}. ` +
      'Alle Zahlen auf den Seiten davor beruhen auf dem gemessenen Zeitraum — die Jahreszahlen ' +
      'stehen nur in diesem Kapitel.',
  }

  const costs: ReportStatement = {
    id: 'annual_scenario_costs',
    title: 'Ihre Stromkosten über ein Jahr',
    amount: null,
    rows: [
      { label: 'Ihr Tarif heute', value: formatEur(currentTariffEur), tone: 'neutral' },
      { label: 'aWATTar ohne Steuerung', value: formatEur(spotWithoutControlEur), tone: 'neutral' },
      { label: CONTROLLED_WAY_LABEL, value: formatEur(controlledEur), tone: 'neutral' },
    ],
    body: `Hochgerechnete Jahreskosten (${priceLabel}), gerechnet mit ${deviceRef(scenario)}.`,
  }

  const switchEur = euros(currentTariffEur - spotWithoutControlEur)
  const controlEur = euros(spotWithoutControlEur - controlledEur)
  const peakEur = euros(Math.max(0, scenario.ways.peakShavingSavingEur))
  const totalSavingEur = switchEur + controlEur + peakEur
  const toneOf = (eur: number): ReportRow['tone'] => (eur >= 0 ? 'positive' : 'warning')

  const rows: ReportRow[] = [
    { label: 'Tarifwechsel zu aWATTar', value: formatEur(switchEur), tone: toneOf(switchEur) },
    {
      label: 'Ladesteuerung des Speichers',
      value: formatEur(controlEur),
      tone: toneOf(controlEur),
    },
    ...(peakEur > 0
      ? [
          {
            label: 'Spitzenkappung durch den Speicher (Obergrenze)',
            value: formatEur(peakEur),
            tone: 'positive' as const,
          },
        ]
      : []),
    { label: 'Summe', value: formatEur(totalSavingEur), tone: toneOf(totalSavingEur), total: true },
  ]

  const assumption: ReportNotice = {
    id: 'annual_scenario_assumption',
    tone: 'neutral',
    title: 'Annahme',
    body: 'Diese Hochrechnung ist eine Annahme auf Grundlage Ihrer gemessenen Tage — keine Prognose und keine Zusage.',
    list: {
      label: null,
      items: [
        ...(peakEur > 0
          ? [
              'Die Spitzenkappung ist eine Obergrenze: sie setzt voraus, dass der Speicher jede ' +
                'Lastspitze rechtzeitig voll geladen erreicht.',
            ]
          : []),
        'Angenommen ist ein über das Jahr gleichbleibendes Verbrauchsmuster. Heizung, Lüftung, ' +
          'Kühlung oder Saisonbetrieb können die ergänzten Monate deutlich verändern.',
        `Die ${scenario.projectedDays} ergänzten Tage wurden nie gemessen.`,
      ],
    },
    hints: [],
  }

  const overview: ReportStatement = {
    id: 'annual_scenario_savings',
    title: 'Woher die Ersparnis kommt',
    amount: {
      value: formatEur(totalSavingEur),
      caption: `pro Jahr, geschätzt, ${priceLabel}`,
      tone: totalSavingEur >= 0 ? 'positive' : 'warning',
    },
    rows,
    body:
      'Gegenüber Ihrem heutigen Tarif, je Jahr. Die Zeilen bauen aufeinander auf und dürfen hier ' +
      'zusammengezählt werden: alle drei beziehen sich auf dieselben 365 Tage.',
    notice: assumption,
  }

  const hasAdvice = hasAdviceChapter(input)
  const elsewhere = hasAdvice ? `im Kapitel „${ADVICE_SECTION.title}"` : 'auf den Seiten davor'
  const deviation: ReportStatement = {
    id: 'annual_scenario_deviation',
    title: hasAdvice
      ? `Warum weicht die Speicher-Ersparnis hier von „${ADVICE_SECTION.title}" ab?`
      : 'Warum weicht die Speicher-Ersparnis hier ab?',
    amount: null,
    rows: [],
    body:
      `Die Ersparnis des Speichers ${elsewhere} ist aus dem gemessenen Zeitraum gleichmässig auf ` +
      'ein Jahr hochgerechnet. Dieses Kapitel rechnet die ergänzten Monate dagegen mit den echten ' +
      'Börsenpreisen dieser Monate. Im Winter ist die Spanne zwischen günstigen und teuren Stunden ' +
      'meist kleiner — die Ladesteuerung bringt dort weniger als im Messzeitraum.',
  }

  return { statements: [basis, costs, overview, deviation], totalSavingEur }
}
