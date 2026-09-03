import { buildRealSavingBreakdown, sumCovered, type BatteryResultEntry } from 'shared'

import { formatEur, formatKw, formatKwh1, formatYears } from '@/lib/format'
import { HINDSIGHT_NOTE } from '@/lib/report-copy'
import type { PdfReportAnalysis } from './types'

/**
 * B23c-1 — die Executive Summary („Kernergebnisse") des react-pdf-Reports, aus dem Contract
 * abgeleitet.
 *
 * ── ⚠ DIESE DATEI DARF `@react-pdf/renderer` NICHT ANFASSEN — und Recharts genauso wenig ────────
 * Sie ist die Ableitung, nicht die Darstellung: sie entscheidet, WELCHE Aussage im Dokument steht,
 * und liefert fertige Zeichenketten. Gerendert wird in `document.tsx`. Derselbe Zuschnitt wie
 * `derive.ts` und aus demselben Grund — nur so lässt sich die Entscheidung „welche Aussage bleibt
 * bei welchem fehlenden Wert aus" lesen, ohne sie aus JSX herauszuklauben.
 *
 * ── ⚠ DER GANZE ABSCHNITT HÄNGT AN EINER REGEL: KEINE ZAHL OHNE RECHNUNG ───────────────────────
 * Jede Aussage entsteht NUR, wenn die Grösse, um die es geht, tatsächlich gerechnet wurde. Fehlt
 * die Grundlage, fehlt die ZEILE — nicht ein Strich, nicht eine 0, nicht ein „nicht verfügbar".
 * Dasselbe Muster wie das leere Adressfeld auf dem Deckblatt (`document.tsx`, `Cover`): ein
 * sichtbar leeres Feld sieht aus wie ein Fehler beim Ausdrucken, nicht wie eine nicht gestellte
 * Frage. Auf einer Seite, die „Kernergebnisse" überschrieben ist, wiegt das schwerer als sonst
 * irgendwo — sie ist die eine Seite, die ein weitergereichter Report garantiert gelesen bekommt.
 *
 * Konkret geprüft und ausgelassen wird:
 *   • die Ladesteuerung, wenn `tariffOptimization?.computable !== true` (Delta 15 Regel C: eine
 *     Vergleichszahl aus einer anderen Grundlage fällt niemandem als Fehler auf, sondern als
 *     Ergebnis),
 *   • die Spitzenkappung, wenn der Speicher den abgerechneten Leistungswert nicht senkt (`static`
 *     kappt nicht, ein Tarif ohne Leistungspreis hat den Posten gar nicht — Delta 3),
 *   • der Zusatzspeicher, wenn es gar keine bestehende Anlage gibt.
 *
 * ── ⚠ ES WIRD NICHTS NACHGERECHNET ────────────────────────────────────────────────────────────
 * Jede Zahl steht bereits im `AnalysisResult`. Die einzige Arithmetik hier ist `sumCovered` +
 * `buildRealSavingBreakdown` — und beide sind DIESELBEN Funktionen, die die Bildschirm-Karten
 * benutzen (`sumCovered` ist dafür mit diesem Schritt nach `packages/shared` gewandert, s. dort).
 * Ein zweiter Rechenweg für die Kopfzahl ergäbe im selben Report zwei Beträge, die dasselbe
 * behaupten und sich um Cents unterscheiden — genau die Differenz, die am 02.09.2026 zwischen
 * Monatsvergleich und Ersparnis-Karte aufgefallen ist.
 *
 * ── DER KATALOG-FALL BEKOMMT HIER BEWUSST KEINE EIGENE SPRACHE ─────────────────────────────────
 * Hat der Kunde keine bestehende Anlage, zeigt diese Seite ausschliesslich, was gerechnet ist:
 * Kern-Kennzahl und die §3.7-Aufschlüsselung des bestgereihten Katalog-Geräts. KEINE
 * Kaufempfehlung, keine Amortisationszeile, kein „das lohnt sich". Der Bildschirm-Report führt
 * diese Aussage bereits (`recommendation.rationale`, Investitionsblock); sie in ein zweites,
 * anders formuliertes Dokument zu übernehmen ist eine eigene Entscheidung und nicht Teil dieses
 * Schritts. Die Lücke ist benannt, nicht übersehen.
 */

export type SummaryTone = 'positive' | 'warning' | 'neutral'

/** Eine Zeile der Aufschlüsselung. Werte sind FERTIG formatiert — hier fällt die Rundung. */
export type SummaryRow = {
  label: string
  /** Zweite, kleinere Zeile unter der Beschriftung. Fehlt, wo die Beschriftung für sich steht. */
  hint?: string
  value: string
  tone: SummaryTone
  /** `true` = Abschlusszeile der Aufschlüsselung (abgesetzt, halbfett). */
  total?: boolean
}

/** Eine der drei bis vier Kernaussagen. */
export type SummaryStatement = {
  /** Stabil — zur Wiedererkennung in Prüfläufen, nicht im Dokument sichtbar. */
  id: 'savings' | 'peak_shaving' | 'load_shift' | 'addon'
  title: string
  /** Die eine grosse Zahl. `null`, wo die Aussage keine trägt (der Zusatzspeicher-Klarsatz). */
  amount: { value: string; caption: string; tone: Exclude<SummaryTone, 'neutral'> } | null
  rows: SummaryRow[]
  /** Was der Leser über die Zahl wissen muss, damit er sie nicht falsch verwendet. */
  body: string
}

/** Die Kern-Kennzahl — die Zahl, die weh tut (§6.2). Steht immer, sie hängt an keiner Batterie. */
export type SummaryHeadline = {
  peakValue: string
  peakCaption: string
  costValue: string
  costCaption: string
}

export type ReportSummary = {
  headline: SummaryHeadline
  statements: SummaryStatement[]
}

/** Vorzeichenbewusst: ein Minus bleibt in der Zahl stehen, die Farbe folgt ihm. */
function deltaRow(label: string, hint: string, eur: number): SummaryRow {
  return { label, hint, value: formatEur(eur), tone: eur < 0 ? 'warning' : 'positive' }
}

function savingRow(label: string, eur: number): SummaryRow {
  return { label, value: formatEur(eur), tone: 'positive' }
}

/**
 * Der Block, der oben steht: die bestehende Anlage des Kunden, sonst das bestgereihte Katalog-Gerät.
 *
 * Wortgleich zur Auswahl in `report.tsx` — dieselbe Reihenfolge, dieselbe Rückfallkette. Zwei
 * verschieden gewählte „primäre" Geräte in Bildschirm-Report und PDF wären derselbe Report mit zwei
 * verschiedenen Antworten.
 */
function primaryEntryOf(analysis: PdfReportAnalysis): BatteryResultEntry | undefined {
  if (analysis.existingBatteryAnalysis) return analysis.existingBatteryAnalysis.entry
  return (
    analysis.perBattery.find((p) => p.battery.id === analysis.recommendation.batteryId) ??
    analysis.perBattery[0]
  )
}

function buildHeadline(current: PdfReportAnalysis['current']): SummaryHeadline {
  return {
    peakValue: formatKw(current.annualPeakKw),
    /*
     * ⚠ Kurz genug für EINE Zeile in der halben Kastenbreite — am gerenderten PDF gemessen:
     * die Grenze liegt bei rund 52 Zeichen (die Kostenbeschriftung daneben ist 52 lang und passt).
     * Eine umbrechende Beschriftung reisst die zweite Zeile durch den Zeilenabstand weit vom Wert
     * weg und lässt den Kasten wie einen Satzfehler aussehen.
     */
    peakCaption: 'Ihre teuerste Lastspitze — Jahreshöchstwert',
    costValue: formatEur(current.leistungspreisCostPerYear),
    costCaption: `Leistungspreis-Kosten pro Jahr (abgerechnet: ${formatKw(current.billedKw)})`,
  }
}

/**
 * Die Ersparnis — in der Fassung, die zum Fall passt.
 *
 * ⚠ DIE BEDINGUNG DER REALEN FASSUNG IST DAS VORHANDENSEIN VON `monthlyComparison`, sonst nichts.
 * Der Worker setzt es ausschliesslich, wenn der Delta-4-Hebel berechenbar ist UND eine
 * Bestandsanlage vorliegt — exakt die zwei Voraussetzungen dieser Darstellung. Eine hier
 * nachgebaute Zweitprüfung könnte davon abweichen; die Frage „darf ich diese Zahlen zeigen" hat
 * einen Ort (dieselbe Regel wie in `recommendation-card.tsx`).
 */
function buildSavings(
  analysis: PdfReportAnalysis,
  entry: BatteryResultEntry,
): { statement: SummaryStatement; isRealComparison: boolean } {
  const comparison =
    analysis.tariffOptimization?.computable === true
      ? analysis.tariffOptimization.monthlyComparison
      : undefined

  if (analysis.existingBatteryAnalysis && comparison) {
    const real = buildRealSavingBreakdown({
      currentTariffEur: sumCovered(comparison.currentTariffEur),
      spotWithoutControlEur: sumCovered(comparison.spotWithoutControlEur),
      spotWithBatteryEur: sumCovered(comparison.spotWithBatteryEur),
    })
    const cheaper = real.totalEur >= 0

    /*
     * ⚠ Bei einem Mehrbetrag trägt die BESCHRIFTUNG das Vorzeichen und die Zahl steht ohne Minus
     * da: „Mehrkosten −€ 84" wäre doppelt verneint und würde beim Überfliegen als Ersparnis
     * gelesen. In der Aufschlüsselung darunter ist es umgekehrt — dort IST das Vorzeichen die
     * Information (der reine Tarifwechsel ist im gemessenen Realfall negativ, und erst die
     * Ladesteuerung dreht ihn).
     */
    const statement: SummaryStatement = {
      id: 'savings',
      title: cheaper
        ? 'Was Sie mit aWATTar und Ihrem Speicher real weniger zahlen'
        : 'Was aWATTar Sie mit Ihrem Speicher derzeit zusätzlich kosten würde',
      amount: {
        value: formatEur(Math.abs(real.totalEur)),
        caption: `über ${comparison.coveredMonths} gemessene Monate — nicht hochgerechnet, exkl. MwSt.`,
        tone: cheaper ? 'positive' : 'warning',
      },
      rows: [
        deltaRow(
          'Reiner Tarifwechsel',
          'Ihr Tarif heute gegenüber aWATTar ohne jede Steuerung',
          real.tariffSwitchEur,
        ),
        deltaRow(
          'Wert der Ladesteuerung',
          'aWATTar ohne Steuerung gegenüber aWATTar mit Ihrem Speicher',
          real.controlValueEur,
        ),
        {
          label: 'Gesamt',
          value: formatEur(real.totalEur),
          tone: cheaper ? 'positive' : 'warning',
          total: true,
        },
      ],
      body:
        'Beide Beträge stammen aus dem Monatsvergleich Ihres Tarifs gegen aWATTar — dieselben ' +
        `Summen über dieselben ${comparison.coveredMonths} gemessenen Monate. Sie sind ` +
        'ausdrücklich NICHT auf ein Jahr hochgerechnet: die fehlenden Monate liegen nicht ' +
        'gleichmässig über das Jahr verteilt, und eine daraus gebildete Jahreszahl wäre eher zu ' +
        'optimistisch als zu vorsichtig. Die Spitzenkappung steckt in keiner der beiden Zeilen — ' +
        'sie hängt am Leistungspreis Ihres Netzbetreibers und nicht am Stromvertrag.',
    }
    return { statement, isRealComparison: true }
  }

  const isExisting = analysis.existingBatteryAnalysis != null
  const rows: SummaryRow[] = [
    savingRow('Spitzenkappung (Leistungspreis)', entry.leistungspreisSavingPerYear),
    savingRow('Eigenverbrauch', entry.selfConsumptionSavingPerYear),
    savingRow('Tarifbewusstes Laden', entry.loadShiftSavingPerYear),
    {
      label: 'Gesamt',
      value: formatEur(entry.totalSavingPerYear),
      tone: 'positive',
      total: true,
    },
  ]

  /*
   * §3.7.1 — die beiden ENERGIE-Zeilen sind bei einem Teilzeitraum-Lastgang hochgerechnet, die
   * Spitzenkappung (ratenbasiert, €/kW·Jahr) ausdrücklich nicht. Das zu sagen ist Teil der
   * Auskunft: ohne den zweiten Halbsatz überträgt der Leser den Vorbehalt auf die ganze
   * Aufschlüsselung.
   */
  const annualized =
    entry.annualizationFactor > 1
      ? ` Ihr Lastgang deckt ${entry.coveredDays} von 365 Tagen ab; Eigenverbrauch und ` +
        'tarifbewusstes Laden sind von diesem Zeitraum auf ein Jahr hochgerechnet — gemessen ' +
        `wurden ${formatEur(entry.selfConsumptionSavingOverCoveredPeriod)} bzw. ` +
        `${formatEur(entry.loadShiftSavingOverCoveredPeriod)}. Die Spitzenkappung ist davon nicht ` +
        'betroffen: sie ist bereits eine Jahresgrösse.'
      : ''

  const statement: SummaryStatement = {
    id: 'savings',
    title: isExisting
      ? 'Was Ihre bestehende Anlage pro Jahr einspart'
      : 'Was ein Speicher pro Jahr einsparen würde',
    amount: {
      value: formatEur(entry.totalSavingPerYear),
      caption: 'pro Jahr, exkl. MwSt.',
      tone: 'positive',
    },
    rows,
    body:
      (isExisting
        ? `Gerechnet mit Ihren eigenen Angaben (${formatKwh1(entry.battery.usableCapacityKwh)} / ` +
          `${formatKw(entry.battery.maxPowerKw)}). `
        : `Gerechnet für ${entry.battery.name} aus unserem Katalog. `) +
      'Die drei Anteile stammen aus EINER Simulation und ergeben zusammen genau die ausgewiesene ' +
      'Gesamtersparnis — keine Kilowattstunde zählt doppelt.' +
      annualized +
      ` ${HINDSIGHT_NOTE}`,
  }
  return { statement, isRealComparison: false }
}

/**
 * Die Spitzenkappung.
 *
 * ⚠ ENTFÄLLT VOLLSTÄNDIG, WENN DER SPEICHER DEN ABGERECHNETEN LEISTUNGSWERT NICHT SENKT. Das ist
 * kein Randfall: eine `static` gesteuerte Anlage kappt gar nicht, und ein Anschluss ohne
 * Leistungsmessung hat den Posten überhaupt nicht (Delta 3). Eine Zeile „Spitzenkappung € 0" wäre
 * dort keine Auskunft, sondern eine Einladung, nach einem Fehler zu suchen.
 */
function buildPeakShaving(
  analysis: PdfReportAnalysis,
  entry: BatteryResultEntry,
  savingsIsRealComparison: boolean,
): SummaryStatement | null {
  if (entry.leistungspreisSavingPerYear <= 0) return null

  /*
   * ⚠ ZWEI VERSCHIEDENE WAHRHEITEN, JE NACHDEM WELCHE KOPFZAHL OBEN STEHT — und beide müssen
   * dastehen, sonst rechnet jemand falsch zusammen. Steht oben die KASSEN-Grösse aus dem
   * Monatsvergleich, ist der Leistungspreis darin NICHT enthalten (der Vergleich führt
   * ausschliesslich Arbeits- und Netz-Arbeitspreis samt Grundgebühren) — er kommt hinzu, darf aber
   * nicht addiert werden, weil er eine Jahresgrösse ist und die Zahl oben ein Zeitraumbetrag.
   * Steht oben die §3.7-Aufschlüsselung, ist er dort bereits die erste Zeile.
   */
  const relation = savingsIsRealComparison
    ? 'Dieser Betrag steckt NICHT in der Zahl oben: der Monatsvergleich führt nur Arbeits- und ' +
      'Netz-Arbeitspreis samt Grundgebühren. Er kommt hinzu — addieren lässt er sich trotzdem ' +
      'nicht, weil er eine Jahresgrösse ist und die Zahl oben ein Zeitraumbetrag.'
    : 'Dieser Betrag ist in der Gesamtersparnis oben bereits als erste Zeile enthalten und kommt ' +
      'nicht zusätzlich obendrauf.'

  return {
    id: 'peak_shaving',
    title: 'Ihre Lastspitze wird gekappt',
    amount: {
      value: formatEur(entry.leistungspreisSavingPerYear),
      caption: 'pro Jahr, exkl. MwSt.',
      tone: 'positive',
    },
    rows: [
      { label: 'Abgerechneter Leistungswert heute', value: formatKw(analysis.current.billedKw), tone: 'neutral' },
      { label: 'Mit dem Speicher', value: formatKw(entry.newBilledKw), tone: 'neutral' },
    ],
    body:
      'Der Leistungspreis hängt an Ihrem Netzbetreiber und nicht an Ihrem Stromvertrag — dieser ' +
      'Anteil bleibt auch dann bestehen, wenn Sie den Lieferanten wechseln. ' +
      relation,
  }
}

/**
 * Der Wert der Ladesteuerung unter aWATTar.
 *
 * ── ⚠ DIE AUSSAGE ENTFÄLLT VOLLSTÄNDIG, WENN DER HEBEL NICHT BERECHENBAR IST ───────────────────
 * Nicht gedämpft, nicht „vorläufig", nicht aus dem statischen Fensterschema ersatzweise gebildet —
 * gar nicht. Genau davor warnt Delta 15 Regel C: `intervalTariffRates` füllt die Preisreihe im
 * nicht berechenbaren Fall bewusst durchgehend mit dem Standard-Arbeitspreis, und eine daraus
 * gebildete Zahl behauptete, die Steuerung bringe nichts, statt zu sagen, dass sie nicht bewertbar
 * ist. Auf einer Seite mit der Überschrift „Kernergebnisse" wäre das die teuerste Sorte Fehler.
 *
 * `undefined` (Hebel gar nicht angefordert) und ein Blocker führen zum selben Ergebnis: keine
 * Zeile. Das ist Absicht — für die Seite ist beides „diese Zahl gibt es hier nicht".
 */
function buildLoadShift(
  analysis: PdfReportAnalysis,
  entry: BatteryResultEntry,
  savingsIsRealComparison: boolean,
): SummaryStatement | null {
  if (analysis.tariffOptimization?.computable !== true) return null

  const annualized =
    entry.annualizationFactor > 1
      ? ` Hochgerechnet aus ${entry.coveredDays} abgedeckten Tagen — gemessen wurden in diesem ` +
        `Zeitraum ${formatEur(entry.loadShiftSavingOverCoveredPeriod)}.`
      : ''

  /*
   * ⚠ DER SATZ, OHNE DEN DIESE SEITE EINEN RECHENFEHLER ZU ZEIGEN SCHEINT.
   *
   * Steht oben die Kassen-Grösse aus dem Monatsvergleich, trägt deren Aufschlüsselung bereits eine
   * Zeile „Wert der Ladesteuerung" — und die weicht von der Zahl hier um wenige Euro ab, weil sie
   * ein ANDERER Rechenweg ist (Kassendifferenz gegen §3.7-Attribution; die drei Posten sind im Kopf
   * von `real-saving.ts` benannt). Am Bildschirm liegen die beiden in getrennten Karten; auf dieser
   * Seite stehen sie wenige Zeilen auseinander, und zwei fast gleiche Zahlen unter zwei fast
   * gleichen Beschriftungen liest jeder als Fehler. Der Satz benennt den Unterschied, statt eine
   * der beiden Zahlen wegzulassen — weglassen hiesse, die Frage „was zahle ich real" oder die Frage
   * „was ist die Steuerung wert" unbeantwortet zu lassen.
   */
  const reconcile = savingsIsRealComparison
    ? ' Die Zeile „Wert der Ladesteuerung" in der Aufschlüsselung oben beantwortet dieselbe Frage ' +
      'aus der Kassensicht des Monatsvergleichs; diese Zahl hier stammt aus der Zuordnung der ' +
      'einzelnen Kilowattstunden. Die beiden Wege unterscheiden sich um wenige Euro — das ist kein ' +
      'Rechenfehler, sondern der Abstand zwischen einer Kassen- und einer Zuordnungsgrösse.'
    : ''

  return {
    id: 'load_shift',
    title: 'Wert der Ladesteuerung unter aWATTar',
    amount: {
      value: formatEur(entry.loadShiftSavingPerYear),
      caption: 'pro Jahr, exkl. MwSt.',
      tone: 'positive',
    },
    rows: [],
    body:
      'Für jede Viertelstunde Ihres Lastgangs ist der echte Börsenpreis jener Stunde plus das ' +
      'Netzentgelt Ihres Netzbetreibers angesetzt, statt eines festen Arbeitspreises. Die Zahl ' +
      'sagt damit: so viel wäre in diesem Zeitraum möglich gewesen — sie ist kein Versprechen für ' +
      'die Zukunft, denn die Marktpreise von morgen kennt niemand. Sie zeigt ausschliesslich den ' +
      'Gewinn aus den Preisunterschieden; was Ihre PV-Erzeugung über den Speicher zusätzlich ' +
      'einspart, steht als eigener Anteil („Eigenverbrauch") daneben.' +
      annualized +
      reconcile,
  }
}

/**
 * Lohnt sich ein ZUSÄTZLICHER Speicher?
 *
 * ⚠ NUR IM BESTANDSFALL. Ohne bestehende Anlage gibt es diese Frage nicht — dort ist der Kauf
 * EINES Speichers offen, und dazu sagt diese Seite bewusst nichts (s. Modulkopf).
 *
 * ⚠ Die Schwelle ist `netSavingOverHorizon > 0` und ausdrücklich NICHT `totalSavingPerYear > 0` —
 * dieselbe Bedingung wie im Bildschirm-Report (01.09.2026). Die schwächere Fassung liess an einem
 * realen Fall alle fünf Geräte als „positiv" durchgehen (€ 22–32 im Jahr bei € 6.750 Investition,
 * Amortisation 250 bis 410 Jahre). Erfunden ist hier keine Schwelle: `netSavingOverHorizon` steht
 * im Contract, und der Betrachtungszeitraum ist eine Angabe des Nutzers.
 */
function buildAddon(analysis: PdfReportAnalysis): SummaryStatement | null {
  const existing = analysis.existingBatteryAnalysis
  if (!existing) return null

  const horizonYears = analysis.assumptions.horizonYears
  const positive = existing.addonScenarios.filter((s) => s.netSavingOverHorizon > 0)
  const best = positive[0]

  if (!best) {
    return {
      id: 'addon',
      title: 'Ein zusätzlicher Speicher lohnt sich derzeit nicht',
      amount: null,
      rows: [],
      body:
        'Keines der Geräte aus unserem Katalog verdient neben Ihrer bestehenden Anlage seine ' +
        `Anschaffung innerhalb von ${horizonYears} Jahren wieder ein. Eine zusätzliche Ersparnis ` +
        'kann dabei durchaus herauskommen — über den Betrachtungszeitraum gerechnet bleibt sie ' +
        'nur unter dem, was das Gerät kostet. Das ist eine Aussage über diesen Lastgang, diese ' +
        `Tarifangaben und einen Betrachtungszeitraum von ${horizonYears} Jahren.`,
    }
  }

  return {
    id: 'addon',
    title: 'Ein zusätzlicher Speicher rechnet sich',
    amount: {
      value: formatEur(best.totalSavingPerYear),
      caption: 'zusätzlich pro Jahr, exkl. MwSt.',
      tone: 'positive',
    },
    rows: [
      { label: 'Gerät', value: best.battery.name, tone: 'neutral' },
      {
        label: 'Investition (nur das Zusatzgerät)',
        value: formatEur(best.totalInvestment),
        tone: 'neutral',
      },
      { label: 'Amortisation', value: formatYears(best.amortizationYears), tone: 'neutral' },
      {
        label: `Netto über ${horizonYears} Jahre`,
        value: formatEur(best.netSavingOverHorizon),
        tone: 'positive',
        total: true,
      },
    ],
    body:
      'Gerechnet als EIN gemeinsamer Speicher aus Ihrer Anlage und diesem Gerät ' +
      `(${formatKwh1(best.combined.usableCapacityKwh)} / ${formatKw(best.combined.maxPowerKw)}). ` +
      'Alle Beträge hier sind das, was über Ihre bestehende Anlage hinaus herauskommt — nicht die ' +
      'Ersparnis des gemeinsamen Speichers. Bezahlt wird ausschliesslich das neue Gerät; Ihre ' +
      'bestehende Anlage geht in keine dieser Zahlen ein.' +
      (positive.length > 1
        ? ` ${positive.length} der Katalog-Geräte verdienen ihre Anschaffung im ` +
          `Betrachtungszeitraum wieder ein; hier steht das bestgereihte.`
        : ''),
  }
}

export function buildReportSummary(analysis: PdfReportAnalysis): ReportSummary {
  const headline = buildHeadline(analysis.current)
  const entry = primaryEntryOf(analysis)

  /*
   * Ohne einen einzigen durchgerechneten Kandidaten bleibt die Kern-Kennzahl — sie hängt allein am
   * Lastgang und am Tarif. Alles Übrige entfällt, statt mit Nullen dazustehen. Der Fall entsteht
   * mit dem heutigen Katalog nicht (er ist nie leer); die Seite behandelt ihn trotzdem, weil eine
   * Executive Summary, die bei leerem Katalog eine Ausnahme wirft, den ganzen Report kostet.
   */
  if (!entry) return { headline, statements: [] }

  /*
   * ⚠ `isRealComparison` reist als eigener Rückgabewert heraus und wird NICHT aus dem erzeugten
   * Text zurückgelesen (etwa an einer Zeilenbeschriftung). Woran die Spitzenkappungs-Aussage
   * hängt — „steckt in der Zahl oben" gegen „kommt hinzu" — ist eine fachliche Verzweigung, und
   * sie an einer Zeichenkette festzumachen hiesse, dass eine Umformulierung sie still umdreht.
   */
  const savings = buildSavings(analysis, entry)

  const statements = [
    savings.statement,
    buildPeakShaving(analysis, entry, savings.isRealComparison),
    buildLoadShift(analysis, entry, savings.isRealComparison),
    buildAddon(analysis),
  ].filter((s): s is SummaryStatement => s !== null)

  return { headline, statements }
}
