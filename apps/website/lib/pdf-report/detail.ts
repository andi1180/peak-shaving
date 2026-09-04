import type {
  BatteryResultEntry,
  BatteryRoiEntry,
  MonthlyTariffComparison,
} from 'shared'
import { sumCovered } from 'shared'

import { formatEur, formatYears } from '@/lib/format'
import type { ReportRow, ReportStatement } from './statement'
import type { PdfReportAnalysis } from './types'

/**
 * B23c-3a — das Kapitel „Kostenverlauf und ein Tag im Detail": der Kostenvergleich (in der
 * Fassung, die zum Fall passt) und ein einzelner Tag im Viertelstundentakt.
 *
 * ── ⚠ DIESE DATEI DARF WEDER `@react-pdf/renderer` NOCH RECHARTS ANFASSEN ──────────────────────
 * Sie ist die Ableitung, nicht die Darstellung — derselbe Zuschnitt wie `summary.ts`,
 * `recommendation.ts` und `derive.ts`. Gerendert wird in `document.tsx`, gerastert in `charts.tsx`.
 * Beide lesen die ENTSCHEIDUNG, welcher Chart entsteht, aus `detailChartPlan` — eine Ableitung,
 * zwei Konsumenten. Zweimal ausgeschrieben stünde im Dokument eine Bildunterschrift, die ein
 * anderes Bild beschreibt als das darüber, und man sähe es der Seite nicht an.
 *
 * ── ⚠ DIE EINE BEDINGUNG: `monthlyComparison` VORHANDEN ODER NICHT ────────────────────────────
 * Ist der Monatsvergleich gerechnet, steht er; sonst steht der Kostenvergleich. Ausdrücklich KEINE
 * zweite Prüfung an `tariffOptimization.computable` — der Worker setzt `monthlyComparison`
 * ausschliesslich bei `computable === true` UND vorhandener Bestandsanlage, und eine hier
 * nachgebaute Zweitprüfung könnte davon abweichen (dieselbe Regel wie in `report.tsx` und
 * `summary.ts`: die Frage „darf ich diese Zahlen zeigen" hat einen Ort).
 *
 * ── ⚠ BENANNTE, BEWUSSTE ABWEICHUNG VOM BILDSCHIRM-REPORT — GEMESSEN, NICHT ÜBERSEHEN ─────────
 * `report.tsx` verzweigt an `isExisting`: im Bestandsfall steht der Monatsvergleich (oder, wenn er
 * fehlt, GAR NICHTS), im Katalog-Fall der Kostenvergleich. Der Fall „Bestandsanlage, Hebel nicht
 * berechenbar" trägt am Bildschirm damit KEINEN der beiden Charts. Hier trägt er den
 * Kostenvergleich, und zwar aus einem Grund, den es am Bildschirm nicht gibt:
 *
 *   • Am Bildschirm ist der Kostenvergleich an die Katalog-Empfehlung als PRIMÄRE Aussage
 *     gebunden, und die gibt es für einen Bestandskunden dort nicht (die Sektion „Falls Sie
 *     stattdessen neu kaufen würden" ist am Bildschirm ersatzlos gestrichen).
 *   • Im PDF gibt es sie sehr wohl: B23c-2 trägt die Kaufaussage in BEIDEN Fällen, im Bestandsfall
 *     in genau dieser Rahmung. Der Kostenvergleich ist das BILD zu jener Aussage — dieselbe
 *     Nettoinvestition, dieselbe Amortisation, derselbe Betrachtungszeitraum.
 *   • Ein Kapitel, das im Blocker-Fall gar nichts trägt, wäre ein Agenda-Eintrag auf eine Seite,
 *     die nur sagt, dass sie leer ist.
 *
 * Was dabei NICHT übernommen wird, ist die Begründung, die am Bildschirm dagegen spricht: die
 * Kurve vergleicht „mit gegen ohne Speicher" und ist damit für ein ZUSATZgerät die falsche Form.
 * Genau deshalb steht sie hier unter derselben Rahmung wie die Kaufaussage (Ersatz, nicht
 * Ergänzung) und der Hinweistext sagt das ausdrücklich.
 *
 * ── ⚠ DIE TAGESAUSWAHL DES ENERGIEFLUSSES WIRD HIER NICHT NACHGEBAUT ──────────────────────────
 * Welcher Tag im Bild steht, entscheidet `EnergyFlowChart` selbst (`worst_caught_peak`, sonst
 * `pv_strong`, sonst ein erklärter Leerzustand). Die Komponente wird unverändert gemountet und
 * ohne Interaktion gerastert; ihr Standardzustand IST die Auswahl. Was hier geprüft wird, ist
 * ausschliesslich, OB es überhaupt einen Tag gibt — sonst rendert die Komponente bewusst keinen
 * Chart, und der Rasterweg liefe fünf Sekunden in eine Zeitüberschreitung, um dann zu melden, dass
 * nichts zu sehen war.
 */

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Der Plan: was gerastert wird
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/** Welcher Kosten-Chart entsteht — und mit welchen Props. */
export type DetailCostPlan =
  | { kind: 'monthly'; comparison: MonthlyTariffComparison }
  | {
      kind: 'cumulative'
      entry: BatteryRoiEntry
      currentLeistungspreisCostPerYear: number
      horizonYears: number
    }

/**
 * Die Props des Tages-Energieflusses — wortgleich zur Auswahl in `report.tsx`.
 *
 * ⚠ Im Bestandsfall genau EIN Eintrag: die Anlage des Kunden. Ein Tagesverlauf eines Geräts, das
 * er erst kaufen müsste, wäre in seiner eigenen Auswertung die falsche Kurve — dieselbe Überlegung
 * wie bei der Kapp-Linie im Lastgang-Chart (`recommendation.ts`).
 */
export type DetailFlowPlan = {
  entries: BatteryResultEntry[]
  selectedBatteryId: string
}

export type DetailChartPlan = {
  cost: DetailCostPlan | null
  flow: DetailFlowPlan | null
}

/** Das empfohlene KATALOG-Gerät — dieselbe Rückfallkette wie `recommendation.ts` und `report.tsx`. */
function recommendedEntryOf(analysis: PdfReportAnalysis): BatteryRoiEntry | undefined {
  return (
    analysis.perBattery.find((p) => p.battery.id === analysis.recommendation.batteryId) ??
    analysis.perBattery[0]
  )
}

/**
 * Gibt es überhaupt einen Tag zu zeichnen?
 *
 * ⚠ Das ist NICHT die Tagesauswahl der Komponente, sondern ihre Vorbedingung: `representativeDays`
 * trägt ausschliesslich die beiden Etiketten `worst_caught_peak` und `pv_strong` (`DispatchTrace`),
 * und die Komponente zeigt ihren Leerzustand genau dann, wenn keines von beiden vorliegt. WELCHER
 * der beiden gilt, entscheidet weiterhin sie.
 */
function hasRepresentativeDay(entry: BatteryResultEntry | undefined): boolean {
  return (entry?.dispatchTrace?.representativeDays.length ?? 0) > 0
}

export function detailChartPlan(analysis: PdfReportAnalysis): DetailChartPlan {
  const existing = analysis.existingBatteryAnalysis
  const comparison =
    analysis.tariffOptimization?.computable === true
      ? analysis.tariffOptimization.monthlyComparison
      : undefined
  const recommended = recommendedEntryOf(analysis)

  let cost: DetailCostPlan | null = null
  if (comparison) {
    cost = { kind: 'monthly', comparison }
  } else if (recommended) {
    cost = {
      kind: 'cumulative',
      entry: recommended,
      currentLeistungspreisCostPerYear: analysis.current.leistungspreisCostPerYear,
      horizonYears: analysis.assumptions.horizonYears,
    }
  }

  /* Bestandsfall: die Anlage des Kunden, sonst der volle Katalog mit der Empfehlung ausgewählt —
     wortgleich zu `report.tsx`. */
  const flowEntries: BatteryResultEntry[] = existing ? [existing.entry] : analysis.perBattery
  const flowSelected = existing ? existing.entry.battery.id : analysis.recommendation.batteryId
  const flowEntry =
    flowEntries.find((e) => e.battery.id === flowSelected) ?? flowEntries[0]

  return {
    cost,
    flow:
      flowEntry && hasRepresentativeDay(flowEntry)
        ? { entries: flowEntries, selectedBatteryId: flowSelected }
        : null,
  }
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Das Kapitel: was neben den Bildern steht
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/** Bildunterschrift und der Satz darunter — dieselbe Form wie `ChartLegend` in `recommendation.ts`. */
export type DetailFigure = {
  caption: string
  /** Steht unter der Bildunterschrift, wo es etwas zu sagen gibt. */
  note: string | null
}

export type DetailChapter = {
  /** Was unter dem Kosten-Chart steht. `null` = es entsteht keiner. */
  cost: { figure: DetailFigure; statement: ReportStatement | null } | null
  /** Warum keiner entsteht. Gesetzt GENAU DANN, wenn `cost === null`. */
  costMissing: string | null
  /** Was unter dem Energiefluss-Bild steht. `null` = es entsteht keines. */
  flow: DetailFigure | null
  /** Warum keines entsteht. Gesetzt GENAU DANN, wenn `flow === null`. */
  flowMissing: string | null
}

function neutralRow(label: string, value: string): ReportRow {
  return { label, value, tone: 'neutral' }
}

/**
 * Der Monatsvergleich.
 *
 * ── ⚠ DIE DREI SUMMEN MÜSSEN NEBEN DEM BILD STEHEN, UND ZWAR AUS ZWEI GRÜNDEN ─────────────────
 * (1) Gerastert wird der Recharts-ZEICHENBEREICH; die Legende der Komponente liegt ausserhalb
 *     davon (D11: Text gehört nativ neben das Bild, nicht als Pixel hinein). Ohne die Zeilen
 *     stünden je Monat drei unbeschriftete Balken.
 * (2) Die Kernergebnis-Seite zeigt im Bestandsfall die DIFFERENZEN zwischen genau diesen drei
 *     Summen (`buildRealSavingBreakdown`); die Summen selbst stehen dort nirgends. Es ist also
 *     keine Wiederholung, sondern die Grundlage.
 *
 * ⚠ Gerechnet wird hier nichts: `sumCovered` ist DIESELBE Funktion, mit der die Legende am
 * Bildschirm und die Executive Summary ihre Summen bilden (`packages/shared/src/real-saving.ts`).
 * Ein zweiter Reducer ergäbe im selben Report anders gebildete Summen derselben drei Reihen.
 */
function buildMonthly(comparison: MonthlyTariffComparison): {
  figure: DetailFigure
  statement: ReportStatement
} {
  const fixed = comparison.fixedCosts
  const rows: ReportRow[] = [
    neutralRow('Ihr Tarif heute', formatEur(sumCovered(comparison.currentTariffEur))),
    neutralRow('aWATTar ohne Steuerung', formatEur(sumCovered(comparison.spotWithoutControlEur))),
    neutralRow(
      'aWATTar mit Ihrem Speicher',
      formatEur(sumCovered(comparison.spotWithBatteryEur)),
    ),
  ]

  /*
   * Die Grundgebühren nur, wo es sie gibt. Eine Zeile „Grundgebühr € 0" behauptete einen Posten,
   * den die Rechnung des Kunden nicht kennt — dieselbe Regel wie beim Betonsockel in
   * `recommendation.ts`.
   */
  const fees: string[] = []
  if (fixed.supplierFeeEurPerMonth > 0) {
    fees.push(`Ihr Lieferant ${formatEur(fixed.supplierFeeEurPerMonth)}/Monat`)
  }
  fees.push(`aWATTar ${formatEur(fixed.awattarFeeEurPerMonth)}/Monat`)

  return {
    figure: {
      caption:
        'Energie- und Netzkosten je Kalendermonat. Die drei Balken eines Monats stehen in ' +
        'derselben Reihenfolge wie die Zeilen darunter: grau Ihr heutiger Tarif, hell aWATTar ohne ' +
        'Steuerung, kräftig aWATTar mit Ihrem Speicher. Monate ohne Messwert bleiben leer.',
      note: null,
    },
    statement: {
      id: 'monthly_comparison',
      title: 'Das zahlen Sie jetzt — und das zahlten Sie mit aWATTar',
      /*
       * ⚠ KEINE KOPFZAHL. Die Differenz zwischen der ersten und der dritten Zeile ist die
       * Kern-Ersparnis der Kernergebnis-Seite; hier gross daneben gesetzt stünde derselbe Betrag
       * zweimal im Dokument und lüde dazu ein, ihn zu addieren (dieselbe Regel wie bei der
       * Ladesteuerungs-Aussage, B23c-2).
       */
      amount: null,
      rows,
      body:
        `Summen über die ${comparison.coveredMonths} gemessenen Monate — ausdrücklich NICHT auf ein ` +
        'Jahr hochgerechnet: die fehlenden Monate liegen nicht gleichverteilt über das Jahr. ' +
        'Enthalten sind Arbeitspreis, Netz-Arbeitspreis und die anteiligen Grundgebühren ' +
        `(${fees.join(' · ')}). NICHT enthalten ist der Leistungspreis — er steht als Jahreszahl ` +
        'auf der Kernergebnis-Seite; ihn auf Monate zu verteilen verlangte eine Aufteilungsregel, ' +
        'die es nicht gibt. Die Kernergebnis-Seite zeigt die DIFFERENZEN zwischen diesen drei ' +
        'Summen; hier stehen sie absolut.',
    },
  }
}

/**
 * Der Kostenvergleich mit/ohne Speicher.
 *
 * ⚠ OHNE AUFSCHLÜSSELUNG, und das ist eine Entscheidung: Investition, Amortisation und Netto über
 * den Horizont stehen bereits als Zeilen im Kapitel davor (B23c-2). Sie hier zu wiederholen setzte
 * dieselben Beträge ein zweites Mal unter eine andere Überschrift. Was das Bild BEITRÄGT, ist der
 * Verlauf — und der lässt sich nicht als Zeile schreiben.
 *
 * ⚠ Der gerasterte Ausschnitt ist der ERSTE Zeichenbereich der Komponente, also die
 * Kostenkurve. Die gestapelte Ersparnis-Aufschlüsselung darunter ist ein ZWEITER Chart derselben
 * Komponente und bleibt bewusst draussen: ihre drei Kategorien stehen als Zeilen auf der
 * Kernergebnis-Seite, und eine Grafik derselben drei Zahlen wäre die dritte Fassung derselben
 * Aussage im selben Dokument.
 */
function buildCumulative(plan: Extract<DetailCostPlan, { kind: 'cumulative' }>): {
  figure: DetailFigure
  statement: null
} {
  const { entry, horizonYears } = plan
  const amortizes = Number.isFinite(entry.amortizationYears) && entry.amortizationYears <= horizonYears

  /*
   * ⚠ Die Farbe der Fläche wird nur beschrieben, wie sie im Bild TATSÄCHLICH vorkommt. Schneiden
   * sich die Linien im Betrachtungszeitraum nicht, bleibt das Band durchgehend rot — „rot bis
   * dahin, grün danach" schickte den Leser dann eine grüne Fläche suchen, die es nicht gibt.
   */
  const base =
    `Aufsummierte Kosten über ${horizonYears} Jahre: gestrichelt ohne Speicher, durchgezogen mit. ` +
    'Beide Linien beginnen bei der Nettoinvestition. '

  return {
    figure: {
      caption: amortizes
        ? base +
          'Wo sie sich schneiden, hat sich der Speicher bezahlt gemacht; die Fläche dazwischen ist ' +
          'bis dahin rot und danach grün.'
        : base +
          'Sie schneiden sich in diesem Zeitraum nicht — die Fläche dazwischen bleibt deshalb ' +
          'durchgehend rot.',
      note: amortizes
        ? `Der Schnittpunkt liegt bei ${formatYears(entry.amortizationYears)} — dieselbe Zahl wie ` +
          'im Kapitel davor, hier als Verlauf. Danach ist die Differenz der beiden Linien Geld, ' +
          'das nicht mehr an den Netzbetreiber geht.'
        : 'Der Speicher spielt seine Anschaffung in diesem Zeitraum nicht ein. Der Abstand ' +
          'zwischen den Linien wird kleiner, er wird aber nicht null.',
    },
    statement: null,
  }
}

/**
 * Was unter dem Energiefluss-Bild steht.
 *
 * ⚠ Die Legende der Komponente liegt AUSSERHALB des gerasterten Zeichenbereichs — die vier Linien
 * wären im Bild sonst unbeschriftet. Sie werden deshalb im Text benannt, und zwar nach FORM und
 * Farbe: Akzent und Akzent-Hover liegen dicht beieinander (#0f766e gegen #0e6b64), unterscheidbar
 * sind PV und Batterie im Bild an der Fläche gegen die Linie.
 *
 * ⚠ Der TAG kommt aus dem gerenderten Baum (`charts.tsx` liest ihn beim Rastern) und wird hier
 * NICHT abgeleitet — welcher Tag gilt, entscheidet die Komponente (s. Modulkopf). Fehlt die
 * Angabe, fehlt der Halbsatz; ein erfundenes Datum unter einem Bild wäre schlimmer als keines.
 */
function buildFlow(dayCaption: string | null): DetailFigure {
  const day = dayCaption ? `${dayCaption}. ` : ''
  return {
    caption:
      `Ein einzelner Tag im Viertelstundentakt. ${day}Die dunkle Fläche ist Ihr Verbrauch, die ` +
      'petrolfarbene Fläche die PV-Erzeugung; die graue Linie ist der Netzbezug, die kräftige ' +
      'petrolfarbene Linie die Leistung des Speichers (über der Nulllinie lädt er, darunter ' +
      'entlädt er).',
    note:
      'Der Verbrauch ist nicht gemessen, sondern abgeleitet: Netzbezug − Batterieleistung + ' +
      'PV-Erzeugung. Der Tag stammt aus derselben Simulation wie alle Zahlen dieses Reports — er ' +
      'wird nicht eigens nachgerechnet.',
  }
}

/**
 * Warum kein Energiefluss-Tag da ist.
 *
 * ⚠ Dieselben zwei Gründe, die auch die Komponente in ihrem Leerzustand nennt — und in derselben
 * Reihenfolge. Sie sind hier ausgeschrieben und nicht aus ihr gelesen: was im Leerzustand steht,
 * ist Fliesstext in einer Bildschirm-Komponente, und ihn als Bild in ein PDF zu rastern wäre genau
 * die Aufteilung, die D11 ausschliesst.
 */
function flowMissingNote(entry: BatteryResultEntry | undefined): string {
  const which = entry ? `„${entry.battery.name}"` : 'Der zugrunde gelegte Speicher'
  const why =
    entry?.battery.controlType === 'static'
      ? `${which} ist statisch gesteuert und kappt deshalb keine Spitzen — es gibt keinen Tag mit ` +
        'einer abgefangenen Spitze.'
      : `Für ${which} wurde im ausgewerteten Zeitraum keine Spitze abgefangen.`
  return (
    `Für diesen Report ist kein Tages-Energiefluss abgebildet. ${why} Und es liegt kein ` +
    'PV-Erzeugungsprofil vor, aus dem sich ersatzweise ein Tag mit starker Einspeisung wählen ' +
    'liesse. Die Zahlen dieses Reports sind davon nicht betroffen — sie stammen aus der ' +
    'Simulation, nicht aus der Abbildung.'
  )
}

/**
 * Das Kapitel.
 *
 * `measured.flowDay` ist die Beschriftung, die die Energiefluss-Komponente beim Rastern
 * TATSÄCHLICH getragen hat (Datum und, wo es beide Tage gibt, welcher gilt). Sie kommt aus
 * `charts.tsx` herein und wird hier nicht gebildet.
 */
export function buildDetailChapter(
  analysis: PdfReportAnalysis,
  measured: { flowDay: string | null } = { flowDay: null },
): DetailChapter {
  const plan = detailChartPlan(analysis)

  const cost =
    plan.cost === null
      ? null
      : plan.cost.kind === 'monthly'
        ? buildMonthly(plan.cost.comparison)
        : buildCumulative(plan.cost)

  const flowEntry = plan.flow
    ? undefined
    : /* Nur für die Begründung gebraucht: WELCHER Speicher keinen Tag hergibt. */
      (analysis.existingBatteryAnalysis?.entry ?? recommendedEntryOf(analysis))

  return {
    cost,
    costMissing:
      cost === null
        ? 'Für diesen Report ist kein Kostenvergleich abgebildet: es liegt kein durchgerechnetes ' +
          'Gerät vor, gegen das sich vergleichen liesse.'
        : null,
    flow: plan.flow ? buildFlow(measured.flowDay) : null,
    flowMissing: plan.flow ? null : flowMissingNote(flowEntry),
  }
}
