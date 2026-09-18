import type { BatteryResultEntry, BatteryRoiEntry } from 'shared'

import { formatEur, formatKw, formatKwh1, formatYears } from '@/lib/format'
import type { ReportBuildContext } from './context'
import { block, ref, row, t, REF_LABEL, REF_SECTION, type ReportText } from './report-text'
import type { ReportRow, ReportStatement } from './statement'
import {
  primaryEntryOf,
  recommendedEntryOf,
  savingsPlacementOf,
  type SavingsPlacement,
} from './summary'
import type { PdfReportAnalysis } from './types'

/**
 * B23c-2 — das Kapitel „Empfehlung und Lastverlauf": welches Gerät, was es kostet, wie sich der
 * Lastgang liest, und woher der Wert der Ladesteuerung kommt.
 *
 * ── ⚠ DIESE DATEI DARF WEDER `@react-pdf/renderer` NOCH RECHARTS ANFASSEN ──────────────────────
 * Sie ist die Ableitung, nicht die Darstellung — derselbe Zuschnitt wie `summary.ts` und
 * `derive.ts`, und aus demselben Grund: die Entscheidung „welche Aussage bleibt bei welchem
 * fehlenden Wert aus" muss lesbar sein, ohne sie aus JSX herauszuklauben. Gerendert wird in
 * `document.tsx`, das Chart-Bild entsteht in `charts.tsx`.
 *
 * ── ⚠ DIESELBE REGEL WIE IN B23c-1: KEINE AUSSAGE OHNE RECHNUNG (D12) ─────────────────────────
 * Fehlt die Grundlage, fehlt die AUSSAGE — nicht ein Strich, nicht eine 0. Konkret:
 *   • die **Spitzenkappungs-Aussage** entfällt, wenn der Speicher den abgerechneten Leistungswert
 *     nicht senkt (`static` kappt nicht, ein Anschluss ohne Leistungspreis hat den Posten gar
 *     nicht — Delta 3). Dann steht an ihrer Stelle die Erklärung, warum im Bild keine Kapp-Linie
 *     ist: eine Aussage über das BILD, keine über eine Ersparnis.
 *   • die **Ladesteuerungs-Aussage** entfällt vollständig bei
 *     `tariffOptimization?.computable !== true` (Delta 15 Regel C).
 *
 * ── ⚠ WAS DIESES KAPITEL BEWUSST NICHT WIEDERHOLT ─────────────────────────────────────────────
 * Die Kernergebnis-Seite (B23c-1) trägt bereits die Ersparnis-Zahlen samt Aufschlüsselung, den
 * Wert der Ladesteuerung und — im Bestandsfall — die reale Gegenüberstellung zum heutigen Tarif.
 * Was hier NEU ist, ist die Kaufentscheidung (Investition, Amortisation, Netto über den Horizont,
 * die §3.8-Warnungen) und die Erklärung, wie die Ladesteuerung zu ihrer Zahl kommt.
 *
 * Die Ladesteuerungs-Aussage trägt deshalb ausdrücklich KEINE Kopfzahl: sie wäre bit-identisch mit
 * der auf der Kernergebnis-Seite (dasselbe Feld, dieselbe Formatierung), und zwei gleich grosse
 * Beträge unter zwei ähnlichen Überschriften laden dazu ein, sie zu addieren. Aus demselben Grund
 * fehlt hier die Warnung „aWATTar wäre derzeit teurer": sie ist rechnerisch dieselbe Aussage wie
 * die Kernergebnis-Zeile „Was aWATTar Sie zusätzlich kosten würde" (`surcharge = −totalEur`,
 * dieselben drei Summen) — zweimal gedruckt sähe sie wie zwei verschiedene Befunde aus.
 *
 * ── DER KATALOG-FALL BEKOMMT HIER SEINE KAUFAUSSAGE ───────────────────────────────────────────
 * D10 führte als offenen Punkt, dass die Kernergebnis-Seite im Katalog-Fall nichts zur
 * Kaufentscheidung sagt. Dieses Kapitel schliesst das: die Empfehlungs-Aussage steht in BEIDEN
 * Fällen, im Bestandsfall in der Rahmung des Bildschirm-Reports („Falls Sie stattdessen neu kaufen
 * würden") — wortgleich zur dortigen Sektionsüberschrift, damit derselbe Kunde in beiden
 * Dokumenten dieselbe Frage beantwortet bekommt.
 */

/** Was das Kapitel hergibt. Jedes `null` heisst: diese Aussage entsteht in diesem Fall nicht. */
export type RecommendationChapter = {
  /**
   * Die Kaufaussage. `null` nur bei leerem Katalog — ein Zustand, den der heutige Katalog nicht
   * herstellt; behandelt, weil ein Kapitel, das dann eine Ausnahme wirft, den ganzen Report kostet.
   */
  recommendation: ReportStatement | null
  /** Was unter dem Lastgang-Bild steht. */
  chart: ChartLegend
  /** Woher der Wert der Ladesteuerung kommt. `null` = Hebel nicht berechenbar oder nicht gefragt. */
  loadControl: ReportStatement | null
}

export type ChartLegend = {
  /** Beschreibt, was das Bild zeigt. Steht immer. */
  caption: string
  /**
   * Die Spitzenkappungs-Aussage: Kapp-Schwelle, abgefangene Spitzen, abgerechneter Wert vorher →
   * nachher. `null`, wenn der Speicher den abgerechneten Leistungswert nicht senkt.
   */
  capStatement: string | null
  /**
   * Warum im Bild keine Kapp-Linie steht. Gesetzt GENAU DANN, wenn `capStatement` fehlt — die
   * beiden schliessen einander aus, und eine leere Stelle unter einem Diagramm ohne gestrichelte
   * Linie liesse den Leser nach einem Druckfehler suchen.
   */
  noCapNote: string | null
}

function neutralRow(label: string, value: string): ReportRow {
  return { label, value, tone: 'neutral' }
}

/**
 * Die Kaufaussage.
 *
 * ⚠ `recommendation.rationale` wird BEWUSST NICHT übernommen. Der Satz kommt aus der Engine und
 * formatiert seine Beträge selbst (`€1234` über `toFixed(0)`, `rank.ts`) — im selben Dokument
 * neben `formatEur` („€ 1.234") stünden damit zwei Schreibweisen derselben Währung nebeneinander,
 * und die Zahl sähe aus wie aus einer anderen Rechnung. Dieselben Grössen stehen hier als Zeilen;
 * die Aussage geht nicht verloren, nur ihre Formatierung ist die des Dokuments.
 */
export function buildRecommendation(
  analysis: PdfReportAnalysis,
  entry: BatteryRoiEntry,
): ReportStatement {
  const b = entry.battery
  const horizonYears = analysis.assumptions.horizonYears
  const isExisting = analysis.existingBatteryAnalysis != null

  const baseCost = b.usableCapacityKwh * b.pricePerKwh
  const foundation = b.requiresFoundation ? (b.foundationCost ?? 0) : 0
  const inverter = b.inverterIncluded ? 0 : (b.extraInverterCost ?? 0)

  const rows: ReportRow[] = [
    neutralRow(
      `Speicher (${formatKw(b.maxPowerKw)} / ${formatKwh1(b.usableCapacityKwh)})`,
      formatEur(baseCost),
    ),
  ]
  /* Nur, wo es sie gibt — eine Zeile „Betonsockel € 0" behauptete einen Posten, den es nicht gibt. */
  if (foundation > 0) rows.push(neutralRow('Betonsockel', formatEur(foundation)))
  if (inverter > 0) rows.push(neutralRow('Separater Wechselrichter', formatEur(inverter)))
  rows.push({
    label: 'Gesamtinvestition',
    value: formatEur(entry.totalInvestment),
    tone: 'neutral',
    total: true,
  })
  rows.push({
    label: 'Ersparnis pro Jahr',
    value: formatEur(entry.totalSavingPerYear),
    tone: 'positive',
  })
  rows.push({
    label: `Netto über ${horizonYears} Jahre`,
    value: formatEur(entry.netSavingOverHorizon),
    /* Vorzeichenbewusst: ein Gerät, das sich im Betrachtungszeitraum nicht einspielt, darf nicht
       grün dastehen — dieselbe Regel wie `deltaRow` in `summary.ts`. */
    tone: entry.netSavingOverHorizon < 0 ? 'warning' : 'positive',
    total: true,
  })

  /*
   * ⚠ Die Amortisation ist die Kopfzahl und nicht die Ersparnis: Letztere steht bereits auf der
   * Kernergebnis-Seite, die Amortisation nirgends. `formatYears(Infinity)` liefert „∞ Jahre" —
   * der Fall entsteht bei einer Ersparnis von 0 (`roi.ts`) und ist eine Antwort, keine Lücke.
   */
  const amortizesWithinHorizon = entry.amortizationYears <= horizonYears

  /*
   * ── ⚠ STUFE D: DER ZWEITE SATZ HÄNGT AN `addon` UND FÄLLT MIT IHM ───────────────────────────
   * Er ist der Grund, aus dem `addon` bis heute NICHT abwählbar ist
   * (`Report_Baukasten_Auswahlschicht_Verifikation.md` §2.2). Der Verweis umfasst deshalb den
   * GANZEN Satz: ohne den Zusatzspeicher-Baustein gibt es nichts, worauf er zeigen könnte, und ein
   * Rest wie „die dortigen Beträge" zeigte ins Leere.
   *
   * ⚠ OFFENGELEGTE GRENZE: „in den Kernergebnissen" bleibt geschrieben. Der Resolver kennt für ein
   * fremdes Kapitel genau EINE Form („im Kapitel „X""), und die ist hier ein anderer Wortlaut. Der
   * Satz überlebt damit ein Abwählen von `addon`, aber nicht sein Verschieben (Block 3 Nr. 18).
   */
  const framing: ReportText = isExisting
    ? t`Sie haben bereits einen Speicher — diese Aussage beantwortet deshalb nicht „soll ich überhaupt?", sondern „was bekäme ich, wenn ich Ihre Anlage durch ein neues Gerät ersetzte?".${ref(
        block('addon'),
        ` Ob sich ein ZUSÄTZLICHES Gerät neben Ihrer Anlage lohnt, steht auf der ${REF_SECTION}; die dortigen Beträge sind Differenzen und nicht mit den Zahlen hier vergleichbar.`,
        '',
      )}`
    : `Aus dem Katalog schneidet dieses Gerät über ${horizonYears} Jahre am besten ab — gereiht ` +
      'wird nach der Netto-Ersparnis über den Betrachtungszeitraum, nicht nach der Jahresersparnis: ' +
      'ein grösserer Speicher spart fast immer mehr und kostet auch mehr.'

  const taxes = entry.taxEffectsIncluded
    ? ''
    : ' Förderung und Steuervorteil sind nicht angegeben und deshalb in keiner dieser Zahlen ' +
      'enthalten — mit ihnen fiele die Investition niedriger aus.'

  return {
    id: 'recommendation',
    title: isExisting
      ? `Falls Sie stattdessen neu kaufen würden: ${b.name}`
      : `Unsere Empfehlung: ${b.name}`,
    amount: {
      value: formatYears(entry.amortizationYears),
      caption: `bis sich die Investition von ${formatEur(entry.totalInvestment)} bezahlt gemacht hat`,
      tone: amortizesWithinHorizon ? 'positive' : 'warning',
    },
    rows,
    body: t`${framing}${taxes}`,
    /*
     * Die §3.8-Warnungen des Kandidaten, unverändert. Sie stehen NEBEN der Investition und nicht
     * hinter ihr: „Betonsockel nötig (+€1800)" ist eine Kostenaussage, und sie ist in
     * `totalInvestment` bereits enthalten — wer sie überliest, hält die Gesamtsumme für zu hoch.
     */
    notes: entry.warnings,
  }
}

/** Die endlichen Kapp-Schwellen des Fahrplans — `Infinity` heisst „diese Periode wird nicht gekappt". */
function finiteCaps(entry: BatteryResultEntry | undefined): number[] {
  return (entry?.dispatchTrace?.capKwByPeriod ?? []).filter((kw) => Number.isFinite(kw))
}

/**
 * Was unter dem Bild steht.
 *
 * ⚠ Die Kapp-Linie gehört zum PRIMÄREN Block — im Bestandsfall der Anlage des Kunden, sonst der
 * Empfehlung. Wortgleich zur Auswahl in `report.tsx`: eine Schwelle, die ein Gerät zöge, das der
 * Kunde erst kaufen müsste, wäre im Hauptdiagramm seiner eigenen Auswertung die falsche Linie.
 */
function buildChartLegend(
  analysis: PdfReportAnalysis,
  primary: BatteryResultEntry | undefined,
): ChartLegend {
  const isExisting = analysis.existingBatteryAnalysis != null
  const whose = isExisting ? 'Ihres Speichers' : 'der empfohlenen Batterie'
  const caption =
    'Ihr Netzbezug über den ausgewerteten Zeitraum, in Viertelstundenwerten. Für die Darstellung ' +
    'sind je Zeitabschnitt der höchste und der niedrigste Wert behalten — die Spitzen bleiben ' +
    'dadurch erhalten, auch wo ein Bildpunkt mehrere Stunden trägt.'

  const caps = finiteCaps(primary)
  const capped = primary != null && primary.leistungspreisSavingPerYear > 0 && caps.length > 0

  if (!capped) {
    return {
      caption,
      capStatement: null,
      /*
       * ⚠ Eine Aussage über das BILD, keine über eine Ersparnis. Sie erklärt, warum die
       * gestrichelte Linie fehlt — dieselbe Auskunft, die der Bildschirm-Chart an dieser Stelle
       * gibt. Eine Kapp-Ersparnis wird hier ausdrücklich NICHT beziffert; genau die entfällt.
       */
      noCapNote:
        'Es ist keine Kapp-Schwelle eingezeichnet: der zugrunde gelegte Speicher senkt den ' +
        'abgerechneten Leistungswert nicht. Entweder steuert er nur Eigenverbrauch und Ladezeiten ' +
        '(dann kappt er keine Spitzen), oder Ihr Anschluss wird ohne Leistungspreis abgerechnet — ' +
        'dann gibt es diesen Posten gar nicht. Die Kurve selbst ist davon unberührt.',
    }
  }

  const lo = Math.min(...caps)
  const hi = Math.max(...caps)
  const threshold =
    lo === hi
      ? `von ${formatKw(lo)}`
      : `zwischen ${formatKw(lo)} und ${formatKw(hi)} (je Abrechnungsperiode)`
  const peaks = primary.dispatchTrace?.caughtPeaks.length ?? 0
  const peakPart =
    peaks > 0
      ? ` Die markierten Punkte sind die ${peaks} teuersten Spitzen, die dabei abgefangen wurden.`
      : ''

  return {
    caption,
    capStatement:
      `Die gestrichelte Linie ist die Kapp-Schwelle ${whose} ${threshold} — oberhalb davon springt ` +
      `der Speicher ein.${peakPart} Der abgerechnete Leistungswert sinkt dadurch von ` +
      `${formatKw(analysis.current.billedKw)} auf ${formatKw(primary.newBilledKw)}.`,
    noCapNote: null,
  }
}

/**
 * Woher der Wert der Ladesteuerung kommt.
 *
 * ── ⚠ ENTFÄLLT VOLLSTÄNDIG, WENN DER HEBEL NICHT BERECHENBAR IST (Delta 15 Regel C) ───────────
 * Nicht gedämpft, nicht „vorläufig", nicht aus dem statischen Fensterschema ersatzweise gebildet.
 * `intervalTariffRates` füllt die Preisreihe im nicht berechenbaren Fall bewusst durchgehend mit
 * dem Standard-Arbeitspreis; eine daraus gebildete Aussage behauptete, die Steuerung bringe
 * nichts, statt zu sagen, dass sie nicht bewertbar ist.
 *
 * ⚠ BENANNTE LÜCKE: der STRUKTURIERTE Befund des Blockers (betroffene Seite, Grund, Zeitbereiche —
 * `TariffOptimizationBlocker`) erscheint damit im PDF noch gar nicht. Am Bildschirm trägt ihn eine
 * eigene Karte. Er gehört zu den „was fehlt und warum"-Aussagen und damit in dasselbe Kapitel wie
 * Datenqualität und Warnungen (B23c-4) — nicht hierher, wo er unter einer Überschrift stünde, die
 * einen Wert ankündigt.
 */
export function buildLoadControl(
  analysis: PdfReportAnalysis,
  primary: BatteryResultEntry | undefined,
  /*
   * ⚠ Stufe D: HEREINGEREICHT und nicht mehr hier abgeleitet. Die eigene Ableitung
   * (`isRealSavingsComparison(analysis)`) beantwortete die Frage aus `analysis` — sie sagte also
   * „Kassen-Fassung", auch wenn das Dokument `savings` gar nicht zeigt. Der Wert kommt aus dem
   * Kontext, wie jede andere report-weite Grösse (B1).
   */
  placement: SavingsPlacement,
): ReportStatement | null {
  if (analysis.tariffOptimization?.computable !== true) return null
  if (!primary) return null

  /* ⚠ Der Verweis deckt nur die BENENNUNG der fremden Zahl; zum Ortswort s. `framing`. */
  const annualized: ReportText =
    primary.annualizationFactor > 1
      ? t` Ihr Lastgang deckt ${String(primary.coveredDays)} von 365 Tagen ab; ${ref(
          block('load_shift'),
          `die Zahl auf der ${REF_SECTION} ist`,
          'der ausgewiesene Wert ist',
        )} von diesem Zeitraum auf ein Jahr hochgerechnet — gemessen wurden ${formatEur(primary.loadShiftSavingOverCoveredPeriod)}.`
      : ''

  /*
   * ⚠ DIESELBE FALLE WIE IN `summary.ts`: „tarifbewusstes Laden" ist eine Zeile der
   * §3.7-Aufschlüsselung und existiert in der Kassen-Fassung (Monatsvergleich) nicht — dort steht
   * der Effekt bereits in „Wert der Ladesteuerung" mit drin.
   */
  const embeddedNote: ReportText =
    placement === 'cash'
      ? t`${ref(
          row('savings', 'control_value'),
          `Er steckt in der Zeile „${REF_LABEL}" in der Aufschlüsselung der ${REF_SECTION} bereits mit drin`,
          'Er steckt in der Gesamtersparnis bereits mit drin',
        )} und kommt nicht zusätzlich obendrauf`
      : /*
         * ⚠ Die Beschriftung bleibt HIER geschrieben, und zwar wegen der Gross-/Kleinschreibung:
         * die Zeile heisst „Tarifbewusstes Laden", im Satz steht sie klein. `${REF_LABEL}` würde
         * den Wortlaut ändern — der Verweis trägt deshalb nur die Existenz.
         */
        t`${ref(
          row('savings', 'load_shift'),
          'Er steckt in der Gesamtersparnis bereits als „tarifbewusstes Laden"',
          'Er steckt in der Gesamtersparnis bereits mit drin',
        )} und kommt nicht zusätzlich obendrauf`

  const selfConsumptionNote: ReportText =
    placement === 'cash'
      ? 'was Ihre PV-Erzeugung über den Speicher einspart, steckt in derselben Zeile mit drin'
      : t`was Ihre PV-Erzeugung über den Speicher einspart, ${ref(
          row('savings', 'self_consumption'),
          `steht als eigener Anteil („${REF_LABEL}") daneben`,
          'steckt in der Gesamtersparnis mit drin',
        )}`

  return {
    id: 'load_control',
    title: 'Woher der Wert der Ladesteuerung kommt',
    /*
     * ⚠ KEINE KOPFZAHL — s. Modulkopf. Der Betrag steht auf der Kernergebnis-Seite; hier stünde er
     * bit-identisch ein zweites Mal und lüde dazu ein, ihn zu addieren.
     */
    amount: null,
    rows: [],
    body: t`Für jede Viertelstunde Ihres Lastgangs ist der echte Börsenpreis jener Stunde plus das Netzentgelt Ihres Netzbetreibers angesetzt, statt eines festen Arbeitspreises. Der Speicher lädt in den günstigen Viertelstunden und entlädt in den teuren; die Differenz ist der ausgewiesene Wert. Er ist ein RÜCKBLICK auf die tatsächlichen Marktpreise Ihres Zeitraums und kein Versprechen für die Zukunft — die Preise von morgen kennt niemand. ${embeddedNote}, und er zeigt ausschliesslich den Gewinn aus den Preisunterschieden: ${selfConsumptionNote}.${annualized}`,
  }
}

export function buildRecommendationChapter(
  analysis: PdfReportAnalysis,
  /* Report-Baukasten B1 — s. `buildReportSummary`. Ohne ihn wird wie bisher selbst abgeleitet. */
  context?: ReportBuildContext,
): RecommendationChapter {
  /* ⚠ `context ? … : …` statt `??` — beide Einträge sind selbst gültig `undefined`. */
  const recommended = context ? context.recommendedEntry : recommendedEntryOf(analysis)
  const primary = context ? context.primaryEntry : primaryEntryOf(analysis)
  const placement = context ? context.savingsPlacement : savingsPlacementOf(analysis, primary)

  return {
    recommendation: recommended ? buildRecommendation(analysis, recommended) : null,
    chart: buildChartLegend(analysis, primary),
    loadControl: buildLoadControl(analysis, primary, placement),
  }
}
