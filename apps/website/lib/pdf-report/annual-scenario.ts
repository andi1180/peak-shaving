import type { AnnualScenario } from 'shared'

import { formatEur, formatKwh1 } from '@/lib/format'
import type { ReportRow, ReportStatement } from './statement'
import { summaryWaysOf } from './summary'
import type { PdfReportAnalysis } from './types'
import { PEAK_SHAVING_WAY_LABEL, buildWaysChapter, peakShavingSavingOf } from './ways'

/**
 * D6 Teil 3 — das Kapitel „Was wäre, wenn wir ein ganzes Jahr hätten?", direkt hinter den Wegen.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ES KONKURRIERT NICHT MIT DER ERSPARNIS-SPANNE DER ZUSAMMENFASSUNG (D8)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Die Kopfzahlen vorne beziehen sich auf den GEMESSENEN Zeitraum; die Zahlen hier auf 365 Tage.
 * Dieses Kapitel ist deshalb eine eigene, benannte Sektion mit eigener Zahl — `summary.ts` liest
 * `annualScenario` nirgends, und dieses Modul rührt die Spanne nicht an. Zwei Bezugszeiträume
 * unter einer Zahl wären genau die Vermischung, vor der der Report sonst überall warnt.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIE TABELLE FÜHRT DIE VIER TARIFWEGE — WEG 5 STEHT IM KASTEN, UND ZWAR AUS EINEM GRUND
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Die Wege 1–4 sind KOSTEN über das Jahr, Weg 5 (Spitzenkappung) ist eine ERSPARNIS. In derselben
 * Spalte untereinander stünden zwei Grössen mit verschiedenem Vorzeichen-Sinn unter einer
 * Überschrift. Dieselbe Trennung und dieselbe Begründung wie im Kapitel davor, wo Weg 5 aus
 * genau diesem Grund kein Balken ist (`ways.ts`).
 *
 * ⚠ IN DIESEM KAPITEL DARF WEG 5 ADDIERT WERDEN, und das ist der einzige Ort im Report, an dem
 * das gilt: dort sind es Jahresgrösse gegen Messzeitraum, hier sind ALLE Wege Jahresgrössen.
 *
 * ── ⚠ DIE ZEILEN WERDEN NICHT HARTKODIERT, SONDERN VOM KAPITEL DAVOR ÜBERNOMMEN ───────────────
 * Welche Wege dieser Kunde hat, steht in `buildWaysChapter`. Dieses Modul liest dessen Balken und
 * sucht zu jedem den Jahresbetrag — eine zweite Bedingung dafür, ob es den Vergleichstarif gibt,
 * ergäbe ein Kapitel, das einen Weg mehr oder weniger führt als das davor.
 *
 * ── ⚠ DIESE DATEI DARF `@react-pdf/renderer` NICHT ANFASSEN — dieselbe Regel wie überall sonst in
 * diesem Verzeichnis. Gerendert wird in `document.tsx`.
 */

export type AnnualScenarioChapter = {
  /** Die Absätze in Dokumentreihenfolge. */
  statements: ReportStatement[]
  /** Die Jahres-Gesamtersparnis — die Zahl des Kastens. `null`, wenn kein Weg etwas spart. */
  totalSavingEur: number | null
}

/**
 * Gibt es dieses Kapitel in diesem Dokument?
 *
 * Drei Bedingungen, und alle drei sind nötig: die Hochrechnung muss gerechnet worden sein
 * (`annualScenario`), das Kapitel davor muss stehen (sonst gäbe es keine Wege, die hier
 * wiederkehren könnten), und es muss überhaupt etwas gefehlt haben. Die dritte ist keine
 * Vorsichtsmassnahme: bei einem Lastgang über ein volles Jahr wäre dieses Kapitel eine Schätzung
 * ohne Gegenstand, die dieselben Zahlen ein zweites Mal zeigt.
 */
export function hasAnnualScenarioChapter(analysis: PdfReportAnalysis): boolean {
  const scenario = analysis.annualScenario
  return scenario != null && scenario.projectedDays > 0 && summaryWaysOf(analysis) !== null
}

/** `YYYY-MM-DD` → `TT.MM.JJJJ`. Reine Zeichenkettenarbeit: das Datum ist bereits Ortszeit. */
function formatDate(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`
}

/** Die Ersparnis eines Tarifwegs gegenüber „Ihr Tarif heute" — negativ, wenn er mehr kostet. */
function savingOf(scenario: AnnualScenario, costEur: number): number {
  return scenario.ways.currentTariffEur - costEur
}

/**
 * Der Jahresbetrag zu einem Balken des Wege-Kapitels.
 *
 * `null` heisst „für diesen Weg gibt es im Jahreslauf keine Zahl" — dann fällt die ZEILE weg,
 * nicht der Betrag auf 0. Eintreten kann das nur beim Vergleichstarif und nur, wenn der
 * Jahreslauf ihn anders beurteilt hat als der gemessene; eine 0 sähe dort aus wie „kostet nichts".
 */
function annualCostOf(scenario: AnnualScenario, key: string): number | null {
  if (key === 'today') return scenario.ways.currentTariffEur
  if (key === 'comparison') return scenario.ways.comparisonTariffEur
  if (key === 'uncontrolled') return scenario.ways.spotWithoutControlEur
  if (key === 'controlled') return scenario.ways.controlledEur
  return null
}

export function buildAnnualScenarioChapter(
  analysis: PdfReportAnalysis,
): AnnualScenarioChapter | null {
  const scenario = analysis.annualScenario
  const measured = buildWaysChapter(analysis)
  if (!scenario || !measured || scenario.projectedDays === 0) return null

  const reference = scenario.reference
  const statements: ReportStatement[] = [
    {
      id: 'annual_scenario_method',
      title: 'Wie diese Hochrechnung entstanden ist',
      amount: null,
      rows: [],
      body:
        /*
         * ⚠ Die GEMESSENE Tageszahl steht hier bewusst NICHT. Sie hat in diesem Dokument bereits
         * eine Quelle (`dataQuality.coveredDays`, das Kapitel davor), und `scenario.measuredDays`
         * zählt etwas leicht anderes: belegte KALENDERTAGE des Fensters gegen Intervalle ÷ 96.
         * Die beiden können sich um einen Tag unterscheiden — nebeneinander im selben Report sähe
         * das aus wie ein Rechenfehler.
         */
        `Für ein volles Jahr fehlen ${scenario.projectedDays} Kalendertage. Für diese Tage haben ` +
        'wir nicht geschätzt, was ' +
        'Sie gespart hätten — wir haben geschätzt, was Sie VERBRAUCHT hätten, und darauf dieselbe ' +
        'Rechnung laufen lassen wie auf Ihren echten Messwerten: derselbe Speicher, dieselbe ' +
        'Ladesteuerung, dieselben Netzentgelte und Abgaben. ' +
        `Als Vorlage dient Ihre verbrauchsstärkste gemessene Woche (${formatDate(reference.fromDate)} ` +
        `bis ${formatDate(reference.toDate)}, ${formatKwh1(reference.rateKwhPerDay)} pro Tag im ` +
        'Schnitt). Jeder fehlende Tag bekommt den echten Viertelstundenverlauf desselben ' +
        'Wochentags aus dieser Woche. ' +
        /*
         * ⚠ „stärkste" und nicht „kälteste": eine Auswahl nach Jahreszeit setzte voraus, dass der
         * Kunde heizlastgetrieben ist. Der Satz sagt deshalb, WARUM diese Woche gewählt wurde.
         */
        'Die stärkste Woche und nicht eine durchschnittliche: eine zu niedrig angesetzte ' +
        'Jahresmenge führte zu einem Speicher, der genau dann nicht trägt, wenn Sie ihn brauchen. ' +
        'Die Zahlen unten sind damit eher die obere als die untere Kante — und sie sind eine ' +
        'Schätzung, keine Messung.',
    },
  ]

  const wayRows: ReportRow[] = []
  for (const bar of measured.bars) {
    const costEur = annualCostOf(scenario, bar.key)
    if (costEur === null) continue
    const saving = savingOf(scenario, costEur)
    wayRows.push({
      label: bar.label,
      hint:
        bar.key === 'today'
          ? 'die Bezugsgrösse'
          : saving > 0
            ? `${formatEur(saving)} weniger als heute`
            : `${formatEur(Math.abs(saving))} mehr als heute`,
      value: formatEur(costEur),
      tone: bar.key === 'today' ? 'neutral' : saving > 0 ? 'positive' : 'warning',
    })
  }

  statements.push({
    id: 'annual_scenario_ways',
    title: 'Die Wege über ein volles Jahr',
    amount: null,
    rows: wayRows,
    body:
      `Hochgerechnete Jahreskosten für den Zeitraum ${formatDate(scenario.windowFromDate)} bis ` +
      `${formatDate(scenario.windowToDate)}, je Weg — exkl. MwSt. Gerechnet wurde jeder Weg auf ` +
      'demselben hochgerechneten Lastgang, sodass die Beträge untereinander vergleichbar bleiben. ' +
      'Gegen die Beträge im Kapitel davor sind sie es NICHT: die beziehen sich auf die ' +
      `${measured.coveredDays} tatsächlich gemessenen Tage.`,
  })

  /*
   * Der beste TARIFweg — die Wege 2–4, verglichen an ihrer Jahresersparnis. Weg 1 ist die
   * Bezugsgrösse und kann sich nicht selbst schlagen; er steht deshalb nicht zur Wahl.
   */
  let bestWay: { label: string; savingEur: number } | null = null
  for (const bar of measured.bars) {
    if (bar.key === 'today') continue
    const costEur = annualCostOf(scenario, bar.key)
    if (costEur === null) continue
    const savingEur = savingOf(scenario, costEur)
    if (savingEur > 0 && (bestWay === null || savingEur > bestWay.savingEur)) {
      bestWay = { label: bar.label, savingEur }
    }
  }

  const peakSavingEur = peakShavingSavingOf(analysis) > 0 ? scenario.ways.peakShavingSavingEur : 0
  const totalSavingEur =
    bestWay === null && peakSavingEur <= 0 ? null : (bestWay?.savingEur ?? 0) + Math.max(0, peakSavingEur)

  const totalRows: ReportRow[] = []
  if (bestWay) {
    totalRows.push({
      label: `Bester Tarifweg: ${bestWay.label}`,
      value: formatEur(bestWay.savingEur),
      tone: 'positive',
    })
  }
  if (peakSavingEur > 0) {
    totalRows.push({
      label: PEAK_SHAVING_WAY_LABEL,
      hint: 'wirkt unabhängig davon, für welchen Stromvertrag Sie sich entscheiden',
      value: formatEur(peakSavingEur),
      tone: 'positive',
    })
  }
  if (totalRows.length > 1 && totalSavingEur !== null) {
    totalRows.push({ label: 'Zusammen', value: formatEur(totalSavingEur), tone: 'positive', total: true })
  }

  statements.push({
    id: 'annual_scenario_total',
    title: 'Gesamtersparnis im Jahresvergleich',
    amount:
      totalSavingEur === null
        ? null
        : {
            value: formatEur(totalSavingEur),
            caption: 'geschätzt über 365 Tage, netto',
            tone: 'positive',
          },
    rows: totalRows,
    body:
      totalSavingEur === null
        ? 'Über ein volles Jahr gerechnet senkt keiner der geprüften Wege Ihre Kosten. Das ist ein ' +
          'Ergebnis und kein fehlender Wert — die Grundlage dafür steht in der Tabelle darüber.'
        : 'Hier dürfen die Beträge zusammengezählt werden, und das ist die einzige Stelle in diesem ' +
          'Dokument, an der das gilt: alle Zahlen dieses Kapitels beziehen sich auf dieselben 365 ' +
          'Tage. ' +
          (peakSavingEur > 0
            ? 'Die Kappung Ihrer Lastspitzen betrifft den Leistungspreis Ihres Netzbetreibers und ' +
              'kommt deshalb zu dem gewählten Stromvertrag hinzu. '
            : '') +
          'Der Betrag beruht auf dem hochgerechneten Lastgang und ist damit eine Schätzung; er ' +
          'gehört nicht mit der Ersparnis-Spanne der Zusammenfassung zusammen, die nur die ' +
          'gemessenen Tage abdeckt.',
  })

  return { statements, totalSavingEur }
}
