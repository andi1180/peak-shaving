import { displayedPriceLabel } from 'shared'
import type { PvValueMonth } from 'shared'

import { formatEur, formatKwh } from '@/lib/format'
import { SHOW_PV_VALUE_AMOUNTS } from './report-flags'
import type { ReportFigure, ReportRow, ReportStatement } from './statement'
import type { PdfReportAnalysis } from './types'

/**
 * DAS KAPITEL „IHRE PV-ANLAGE" — was die BESTEHENDE Anlage über den ausgewerteten Zeitraum wert war.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ES KONKURRIERT NICHT MIT DER ERSPARNIS-SPANNE DER ZUSAMMENFASSUNG (D8)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Der Wert der Anlage ist keine Ersparnis, die der Kunde noch heben kann — er ist bereits gehoben
 * und steckt in den Ist-Kosten, die weiter vorne stehen. In der Spanne stünde er als etwas, das man
 * noch bekommt. Dieses Kapitel führt ihn deshalb als eigene, benannte Zahl; `summary.ts` liest
 * `pvValue` nirgends.
 *
 * ── ⚠ HIER WIRD NICHTS GERECHNET ──────────────────────────────────────────────────────────────
 * Beide Kostenseiten und die Monatsmengen kommen fertig aus dem Contract (`analysis.pvValue`,
 * gerechnet in `packages/extractors`). Diese Datei wählt aus und formuliert. Eine zweite Ableitung
 * derselben Differenz hier liefe beim nächsten Abgaben-Ausbau von der gerechneten weg (#295).
 *
 * ── ⚠ DIESE DATEI DARF `@react-pdf/renderer` NICHT ANFASSEN — dieselbe Regel wie überall sonst in
 * diesem Verzeichnis. Gerendert wird in `document.tsx`.
 */

export type PvValueChapter = {
  /** Die Monatsbalken — dieselbe Liste, die die Zeichnung bekommt. */
  months: PvValueMonth[]
  figure: ReportFigure
  /** Die Absätze in Dokumentreihenfolge. */
  statements: ReportStatement[]
}

/**
 * Gibt es dieses Kapitel in diesem Dokument?
 *
 * ⚠ EINE BEDINGUNG UND KEINE NACHGEBAUTE: ob die Lage überhaupt rekonstruierbar war (bestehende
 * Anlage, reiner Bezugslastgang, abgelegte Erzeugungsreihe, Preisdeckung), hat der Lauf bereits
 * entschieden — steht `pvValue` da, ist sie es. Ein zweites `hasPv === true && pvStage ===
 * 'existing'` hier wäre die dritte Fassung derselben Regel und liefe beim nächsten Umbau von ihr
 * weg (dieselbe Überlegung wie bei `hasAnnualScenarioChapter`).
 */
export function hasPvValueChapter(analysis: PdfReportAnalysis): boolean {
  return analysis.pvValue != null
}

const MONTH_NAMES = [
  'Januar',
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

const monthName = (month: number): string => MONTH_NAMES[month - 1] ?? String(month)

/** „Februar, März und April" — ohne Jahr, weil der Satz den Zeitraum ohnehin nennt. */
function joinMonths(months: readonly PvValueMonth[]): string {
  const names = months.map((entry) => monthName(entry.month))
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`
}

/** `YYYY-MM-DD` → `TT.MM.JJJJ`. Reine Zeichenkettenarbeit: das Datum ist bereits Ortszeit. */
function formatDate(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`
}

export function buildPvValueChapter(analysis: PdfReportAnalysis): PvValueChapter | null {
  const scenario = analysis.pvValue
  if (!scenario) return null

  const days = String(scenario.coveredDays)
  const outage = scenario.months.filter((month) => month.outage)
  const statements: ReportStatement[] = []

  /*
   * ── DER BEFUND, UND ER STEHT NUR DA, WENN ES IHN GIBT ────────────────────────────────────────
   * Ohne auffälligen Monat entfällt dieser Absatz ersatzlos. Ein „alles unauffällig" wäre eine
   * Unbedenklichkeitsbescheinigung, die diese Auswertung nicht ausstellen kann — dieselbe Haltung
   * und derselbe Grund wie beim PV-Hinweis des Schlusskapitels (`basis.ts`).
   *
   * ⚠ DIE MONATE KOMMEN AUS DEN BALKEN UND NICHT AUS `input.pvOutageMonths`. Beide Listen stammen
   * aus demselben Befund (`detectPvOutageMonths`), aber nur die Balken sagen, welche Monate dieses
   * Kapitel tatsächlich ZEIGT. Aus der zweiten Liste gebildet könnte der Satz einen Monat nennen,
   * für den daneben kein Balken fehlt — und der Leser suchte ihn vergeblich.
   */
  if (outage.length > 0) {
    statements.push({
      id: 'pv_value_finding',
      title: 'Was Ihr Lastgang über Ihre Anlage zeigt',
      amount: null,
      rows: [],
      body:
        `In ${joinMonths(outage)} fehlt in Ihrem Lastgang das Muster, das eine arbeitende ` +
        'PV-Anlage hinterlässt: an sonnigen Mittagen geht der Netzbezug sonst gegen null, in ' +
        'diesen Monaten tut er das an keinem einzigen Tag. ' +
        /*
         * ⚠ Was daraus NICHT folgt, steht im selben Absatz wie das, was folgt. Getrennt gesetzt
         * läse sich der Befund als Diagnose und der Vorbehalt als Kleingedrucktes.
         */
        'Wir rechnen für diese Monate deshalb gar keine Erzeugung an — nicht eine geschätzte und ' +
        'auch keine null. Woran es lag, sagt der Lastgang nicht, und ob es inzwischen behoben ' +
        'ist, ebenso wenig. ' +
        `Ihre Kosten weiter vorne sind davon unberührt: sie sind Ihre tatsächlichen Kosten über ` +
        `diese ${days} Tage, mit der Anlage genau so, wie sie in diesem Zeitraum lief.`,
    })
  }

  /*
   * ── DIE KOSTENSEITEN ─────────────────────────────────────────────────────────────────────────
   * Beide Zeilen sind KOSTEN über denselben Zeitraum und dürfen deshalb untereinander stehen; die
   * Differenz darunter ist die Aussage des Kapitels. Die Jahreszeilen bekommen eine EIGENE
   * Aussage — zwei Bezugszeiträume in einer Aufschlüsselung wären genau die Vermischung, vor der
   * der Report sonst überall warnt.
   */
  const measuredRows: ReportRow[] = [
    {
      label: `Mit Ihrer PV-Anlage — ${days} gemessene Tage`,
      hint: 'Ihre tatsächlichen Kosten, wie weiter vorne ausgewiesen',
      value: formatEur(scenario.measured.withPvEur),
      tone: 'neutral',
    },
    {
      label: `Ohne PV-Anlage — dieselben ${days} Tage, rekonstruiert`,
      hint: 'Ihr Netzbezug zuzüglich der geschätzten Erzeugung, mit demselben Tarif bewertet',
      value: formatEur(scenario.measured.withoutPvEur),
      tone: 'warning',
    },
  ]

  /* ⚠ Hinter `SHOW_PV_VALUE_AMOUNTS` — s. `report-flags.ts` für den Grund. Bau bleibt vollständig. */
  if (SHOW_PV_VALUE_AMOUNTS) {
    statements.push({
      id: 'pv_value_measured',
      title: 'Was Ihre Anlage im ausgewerteten Zeitraum wert war',
      amount: {
        value: formatEur(scenario.measured.valueEur),
        caption: `über ${days} gemessene Tage, ${displayedPriceLabel(analysis)}`,
        tone: scenario.measured.valueEur >= 0 ? 'positive' : 'negative',
      },
      rows: measuredRows,
      body:
        'Beide Beträge sind mit derselben Rechnung entstanden, mit der auch „Ihr Tarif heute" weiter ' +
        'vorne gebildet wird — gleicher Arbeitspreis, gleiche Netzentgelte, gleiche Abgaben. ' +
        'Getauscht ist genau eine Sache: der Lastgang. ' +
        `Angesetzt sind dafür ${formatKwh(scenario.estimatedGenerationKwh)} geschätzte Erzeugung ` +
        'über den Zeitraum.',
    })
  }

  if (SHOW_PV_VALUE_AMOUNTS && scenario.annual) {
    const annual = scenario.annual
    statements.push({
      id: 'pv_value_annual',
      title: 'Dasselbe über ein volles Jahr',
      amount: {
        value: formatEur(annual.valueEur),
        caption: `geschätzt über 365 Tage, ${displayedPriceLabel(analysis)}`,
        tone: annual.valueEur >= 0 ? 'positive' : 'negative',
      },
      rows: [
        {
          label: 'Mit Ihrer PV-Anlage — 365 Tage',
          value: formatEur(annual.withPvEur),
          tone: 'neutral',
        },
        {
          label: 'Ohne PV-Anlage — 365 Tage, rekonstruiert',
          value: formatEur(annual.withoutPvEur),
          tone: 'warning',
        },
      ],
      body:
        `Hochgerechnet auf ${formatDate(annual.windowFromDate)} bis ` +
        `${formatDate(annual.windowToDate)}: für die ${annual.projectedDays} fehlenden ` +
        'Kalendertage ist derselbe Lastgang unterlegt wie im Kapitel „Was wäre, wenn wir ein ' +
        'ganzes Jahr hätten?", und die geschätzte Erzeugung ist nach DEMSELBEN Plan verlängert ' +
        'worden. ' +
        /*
         * ⚠ Der Satz sagt, warum die Jahreszahl nicht neben der gemessenen stehen darf. Ohne ihn
         * läse ein Kunde die beiden Kopfzahlen als zwei Messungen desselben Gegenstands.
         */
        'Die Zahl gehört nicht mit der darüber zusammen — sie beschreibt ein anderes, längeres ' +
        'Jahr und ist eine Schätzung.',
    })
  }

  /*
   * ── DIE EINORDNUNG ───────────────────────────────────────────────────────────────────────────
   * Der teal Kasten (`aside`) — eine Bemerkung, die zum Kapitel gehört, aber nicht in seiner
   * Hauptlinie steht. Dieselbe Form wie „Ausserdem schon geklärt" in der Zusammenfassung.
   *
   * ⚠ DIE DREI VORBEHALTE SIND NICHT AUSTAUSCHBAR und stehen deshalb einzeln: die Rekonstruktion
   * ist keine Messung; die gesamte Erzeugung gilt als Eigenverbrauch (und die Richtung des
   * Fehlers ist benannt); und der Befund gilt für den Auswertungszeitraum, nicht für heute.
   */
  statements.push({
    id: 'pv_value_basis',
    title: 'Einordnung',
    amount: null,
    rows: [],
    aside: true,
    body:
      'Der Vergleich mit und ohne PV-Anlage ist eine Rekonstruktion und keine zweite Messung: Ihr ' +
      'echter Netzbezug plus eine aus Wetterdaten (PVGIS) und Ihren Anlagendaten geschätzte ' +
      'Erzeugung. Ein ' +
      'Netzbetreiber-Zähler misst am Anschlusspunkt — was Ihre Anlage direkt in den Betrieb ' +
      'liefert, kommt dort nie vorbei und steht nur als gesenkter Bezug darin. Was ohne die ' +
      'Anlage gewesen wäre, kann der Lastgang deshalb nicht zeigen, sondern nur eine Schätzung ' +
      'daneben. ' +
      'Dabei gilt die gesamte geschätzte Erzeugung als selbst verbraucht; eine Netzeinspeisung ' +
      'ist nicht gegengerechnet, weil uns dafür die viertelstundengenauen Einspeisedaten fehlen ' +
      '— tatsächlicher Export würde die Differenz etwas kleiner machen. ' +
      (outage.length > 0
        ? 'Und der Befund oben ist eine Beobachtung aus dem Auswertungszeitraum: er sagt nicht, ' +
          'warum in diesen Monaten nichts zu sehen war, und nichts über den heutigen Zustand ' +
          'Ihrer Anlage.'
        : 'Und er beschreibt den Auswertungszeitraum, nicht den heutigen Zustand Ihrer Anlage.'),
  })

  return {
    months: scenario.months,
    figure: {
      caption:
        'Geschätzter PV-Eigenverbrauch je Monat, aus Ihrem echten Lastgang zurückgerechnet.',
      note:
        outage.length > 0
          ? `Für ${joinMonths(outage)} ist bewusst kein Balken gesetzt — dort zeigt der ` +
            'Lastgang keine Erzeugung, und eine 0 sähe aus wie ein geschätzter Kleinstwert.'
          : null,
    },
    statements,
  }
}
