import type { BatteryResultEntry, BatteryRoiEntry } from 'shared'

import { formatEur, formatEur2, formatKw, formatKwh1, formatYears } from '@/lib/format'
import type { ReportBuildContext } from './context'
import { block, ref, t, REF_SECTION } from './report-text'
import type { ReportPoint, ReportRow, ReportStatement } from './statement'
import { primaryEntryOf, recommendedEntryOf } from './summary'
import type { PdfReportAnalysis } from './types'

/**
 * B23c-2 — das Kapitel „Empfehlung und Wirtschaftlichkeit": welches Gerät, was es kostet, und woher der
 * Wert der Ladesteuerung kommt.
 *
 * ⚠ DAS LASTGANG-BILD IST HIER RAUS und steht als eigenes Kapitel davor (`LOAD_SECTION`). Nur die
 * reinen BILD-Aussagen (gestrichelte Kapp-Linie, markierte Spitzen) sind nicht zurückgekommen —
 * dafür fehlt hier das Bild. Die Kapp-Schwelle und der abgerechnete Leistungswert vorher → nachher
 * hingen nie am Bild und stehen als Zeilen wieder in der Aufschlüsselung (`capRows`).
 *
 * ── ⚠ DIESE DATEI DARF WEDER `@react-pdf/renderer` NOCH RECHARTS ANFASSEN ──────────────────────
 * Sie ist die Ableitung, nicht die Darstellung — derselbe Zuschnitt wie `summary.ts` und
 * `derive.ts`, und aus demselben Grund: die Entscheidung „welche Aussage bleibt bei welchem
 * fehlenden Wert aus" muss lesbar sein, ohne sie aus JSX herauszuklauben. Gerendert wird in
 * `document.tsx`, das Chart-Bild entsteht in `charts.tsx`.
 *
 * ── ⚠ DIESELBE REGEL WIE IN B23c-1: KEINE AUSSAGE OHNE RECHNUNG (D12) ─────────────────────────
 * Fehlt die Grundlage, fehlt die AUSSAGE — nicht ein Strich, nicht eine 0. Konkret:
 *   • die **Kapp-Zeilen** entfallen, wenn der Speicher den abgerechneten Leistungswert nicht senkt
 *     (`static` kappt nicht, ein Anschluss ohne Leistungspreis hat den Posten gar nicht — Delta 3).
 *   • die **Ladesteuerungs-Aussage** entfällt vollständig bei
 *     `tariffOptimization?.computable !== true` (Delta 15 Regel C).
 *
 * ── ⚠ DIE LADESTEUERUNGS-AUSSAGE TRÄGT SEIT DEM ZUSAMMENFASSUNGS-UMBAU WIEDER IHRE KOPFZAHL ───
 * Sie hatte bis dahin bewusst keine: der Betrag stand bit-identisch auf der Kernergebnis-Seite, und
 * zwei gleich grosse Beträge unter zwei ähnlichen Überschriften laden dazu ein, sie zu addieren.
 * Jene Seite trägt seit dem Umbau nur noch EINE Ersparnis-Aussage, und zwar als Spanne über die
 * Tarifwege (Ein-Spanne-Regel D8) — der Ladesteuerungs-Betrag steht dort nicht mehr. Ohne Kopfzahl
 * erklärte dieser Abschnitt danach die Herkunft einer Zahl, die im ganzen Dokument nicht vorkommt.
 *
 * Was hier NEU bleibt, ist die Kaufentscheidung (Investition, Amortisation, Netto über den
 * Horizont, die §3.8-Warnungen). Die Empfehlungs-Aussage steht in BEIDEN Fällen, im Bestandsfall in
 * der Rahmung des Bildschirm-Reports („Falls Sie stattdessen neu kaufen würden").
 */

/** Was das Kapitel hergibt. Jedes `null` heisst: diese Aussage entsteht in diesem Fall nicht. */
export type RecommendationChapter = {
  /**
   * Die Kaufaussage. `null` nur bei leerem Katalog — ein Zustand, den der heutige Katalog nicht
   * herstellt; behandelt, weil ein Kapitel, das dann eine Ausnahme wirft, den ganzen Report kostet.
   */
  recommendation: ReportStatement | null
  /** Woher der Wert der Ladesteuerung kommt. `null` = Hebel nicht berechenbar oder nicht gefragt. */
  loadControl: ReportStatement | null
}

function neutralRow(label: string, value: string): ReportRow {
  return { label, value, tone: 'neutral' }
}

/** Die endlichen Kapp-Schwellen des Fahrplans — `Infinity` heisst „diese Periode wird nicht gekappt". */
function finiteCaps(entry: BatteryResultEntry): number[] {
  return (entry.dispatchTrace?.capKwByPeriod ?? []).filter((kw) => Number.isFinite(kw))
}

/**
 * Kapp-Schwelle und abgerechneter Leistungswert vorher/nachher, als Zeilen statt als Bildlegende.
 * Bedingung wie vor a8f1934 (`buildChartLegend`); Format wie das alte `peak_shaving`-Zeilenpaar aus
 * `summary.ts` (vor #290): „Abgerechneter Leistungswert heute" / „Mit dem Speicher".
 */
function capRows(analysis: PdfReportAnalysis, entry: BatteryResultEntry): ReportRow[] {
  if (!(entry.leistungspreisSavingPerYear > 0)) return []
  const caps = finiteCaps(entry)
  if (caps.length === 0) return []

  const lo = Math.min(...caps)
  const hi = Math.max(...caps)
  const threshold =
    lo === hi
      ? formatKw(lo)
      : `zwischen ${formatKw(lo)} und ${formatKw(hi)} (je Abrechnungsperiode)`

  return [
    neutralRow('Kapp-Schwelle', threshold),
    neutralRow('Abgerechneter Leistungswert heute', formatKw(analysis.current.billedKw)),
    neutralRow('Mit dem Speicher', formatKw(entry.newBilledKw)),
    ...eagDemandChargeRow(analysis),
  ]
}

/**
 * Der GRUNDPREIS-Teil des EAG-Förderbeitrags — die ZWEITE kW-gebundene Jahresgrösse, unter
 * denselben Bedingungen wie die Kapp-Zeilen darüber (der Aufrufer ist ihr einziger).
 *
 * ── ⚠ EINE EIGENE ZEILE, UND SIE WIRD MIT NICHTS VERSCHMOLZEN ─────────────────────────────────
 * Sie steht neben dem abgerechneten Leistungswert, weil sie an demselben kW-Wert hängt — aber der
 * Leistungspreis ist die Netznutzung des Netzbetreibers und dies eine gesetzliche Abgabe (EAG 2021,
 * Preisblatt EX104). Zu einer Zahl addiert stünde im Report ein Posten, der auf keiner
 * Netzrechnung so dasteht; und weil die Zeile NACH den Summenzeilen des Kapitels steht
 * (`total: true`, s. `buildRecommendation`), geht sie in keine Summe ein.
 *
 * ⚠ SIE ERSCHEINT NUR, WO DER SATZ EIN LEISTUNGSPREIS IST (€/kW·Jahr — Netzebene 3–6 und NE 7 MIT
 * Leistungsmessung). Auf NE 7 OHNE Leistungsmessung ist er ein fixer Jahresbetrag und steckt
 * bereits in den Monatsreihen (`MonthlyFixedCosts.eagFlatFeeEur`); dort entsteht deshalb
 * `eagGrundpreisCostPerYear` gar nicht erst, und hier entfällt die AUSSAGE statt einer 0 zu
 * behaupten (D12).
 *
 * ⚠ [ABGELEITET, keine Contract-Zahl] Der €/kW·a-Satz in Klammern ist `Betrag / billedKw` —
 * wortgleich zur Herleitung des Leistungspreis-Satzes in `basis.ts`, und aus demselben Grund: er
 * macht die Zeile nachrechenbar (Prinzip 5), ohne dass eine zweite Zahl durch den Contract reist.
 */
function eagDemandChargeRow(analysis: PdfReportAnalysis): ReportRow[] {
  const amount = analysis.current.eagGrundpreisCostPerYear
  if (amount === undefined || !(analysis.current.billedKw > 0)) return []

  const rate = amount / analysis.current.billedKw
  return [
    neutralRow(
      'EAG-Förderbeitrag (Grundpreis) heute',
      `${formatEur(amount)} pro Jahr (${formatEur2(rate)} / kW·a)`,
    ),
  ]
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
  rows.push(...capRows(analysis, entry))

  /*
   * ⚠ Die Amortisation ist die Kopfzahl und nicht die Ersparnis: Letztere steht als Zeile in der
   * Aufschlüsselung darunter, die Amortisation nirgends sonst. `formatYears(Infinity)` liefert „∞ Jahre" —
   * der Fall entsteht bei einer Ersparnis von 0 (`roi.ts`) und ist eine Antwort, keine Lücke.
   */
  const amortizesWithinHorizon = entry.amortizationYears <= horizonYears

  /*
   * ── ⚠ STUFE D: DER ZWEITE PUNKT HÄNGT AN `addon` UND FÄLLT MIT IHM ──────────────────────────
   * Er war der Grund, aus dem `addon` bis B3-2b nicht abwählbar war
   * (`Report_Baukasten_Auswahlschicht_Verifikation.md` §2.2). Der Verweis umfasst deshalb den
   * GANZEN Satz: ohne den Zusatzspeicher-Baustein gibt es nichts, worauf er zeigen könnte, und ein
   * Rest wie „die dortigen Beträge" zeigte ins Leere. Als eigener Listenpunkt (B3-3) entfällt mit
   * ihm auch seine Nummer — die Zählung schliesst sich, s. `statementPoints`.
   *
   * ⚠ Der Satz überlebt ein Abwählen von `addon` (leere Ersatzfassung), aber nicht sein
   * Verschieben in ein Kapitel ohne Verweisnamen — dann fällt er ebenfalls auf die leere Fassung.
   */
  /*
   * B3-4 — jeder Punkt trägt eine feste Leadzeile. Die beiden Rahmungen schliessen einander aus,
   * tragen aber bewusst VERSCHIEDENE Titel: im Bestandsfall beantwortet die Aussage „was bekäme
   * ich statt meiner Anlage?", im Katalogfall „welches Gerät soll ich nehmen?" — ein gemeinsamer
   * Titel müsste so allgemein ausfallen, dass er in beiden Fällen nichts mehr sagt.
   */
  const framing: ReportPoint[] = isExisting
    ? [
        {
          title: 'Ersatz Ihrer bestehenden Anlage',
          text:
            'Sie haben bereits einen Speicher — diese Aussage beantwortet deshalb nicht „soll ich ' +
            'überhaupt?", sondern „was bekäme ich, wenn ich Ihre Anlage durch ein neues Gerät ersetzte?".',
        },
        {
          title: 'Zusätzlicher Speicher',
          text: t`${ref(
            block('addon'),
            `Ob sich ein ZUSÄTZLICHES Gerät neben Ihrer Anlage lohnt, steht auf der ${REF_SECTION}; die dortigen Beträge sind Differenzen und nicht mit den Zahlen hier vergleichbar.`,
            '',
          )}`,
        },
      ]
    : [
        {
          title: 'Die wirtschaftlichste Option',
          text:
            `Aus dem Katalog schneidet dieses Gerät über ${horizonYears} Jahre am besten ab — gereiht ` +
            'wird nach der Netto-Ersparnis über den Betrachtungszeitraum, nicht nach der Jahresersparnis: ' +
            'ein grösserer Speicher spart fast immer mehr und kostet auch mehr.',
        },
      ]

  const taxes: ReportPoint[] = entry.taxEffectsIncluded
    ? []
    : [
        {
          title: 'Ohne Steuervorteil gerechnet',
          text:
            'Förderung und Steuervorteil sind nicht angegeben und deshalb in keiner dieser Zahlen ' +
            'enthalten — mit ihnen fiele die Investition niedriger aus.',
        },
      ]

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
    /*
     * B3-3 (20a) — die Aussage steht als nummerierte Liste und nicht als Absatz; das Zielbild
     * setzt sie so (S. 11). Der Wortlaut ist derselbe, ein Punkt je Satz: weggefallen sind allein
     * die Leerzeichen, mit denen die Sätze im Absatz aneinanderhingen.
     */
    body: '',
    points: [...framing, ...taxes],
    /*
     * Die §3.8-Warnungen des Kandidaten, unverändert. Sie stehen NEBEN der Investition und nicht
     * hinter ihr: „Betonsockel nötig (+€1800)" ist eine Kostenaussage, und sie ist in
     * `totalInvestment` bereits enthalten — wer sie überliest, hält die Gesamtsumme für zu hoch.
     */
    notes: entry.warnings,
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
): ReportStatement | null {
  if (analysis.tariffOptimization?.computable !== true) return null
  if (!primary) return null

  /* ⚠ Er zeigt auf die EIGENE Kopfzahl darüber — seit dem Zusammenfassungs-Umbau gibt es die Zahl
     nur noch hier, und ein Verweis auf ein fremdes Kapitel liefe ins Leere. */
  const annualized =
    primary.annualizationFactor > 1
      ? ` Ihr Lastgang deckt ${primary.coveredDays} von 365 Tagen ab; der Betrag oben ist von ` +
        'diesem Zeitraum auf ein Jahr hochgerechnet — gemessen wurden ' +
        `${formatEur(primary.loadShiftSavingOverCoveredPeriod)}.`
      : ''

  /*
   * ⚠ DER SATZ GEGEN DAS DOPPELTZÄHLEN BLEIBT, SEIN VERWEIS FÄLLT. Er zeigte bis zum
   * Zusammenfassungs-Umbau auf eine Zeile der Ersparnis-Aufschlüsselung („Wert der Ladesteuerung"
   * bzw. „tarifbewusstes Laden"); die gibt es nicht mehr. Was er sagt, gilt unverändert: der Betrag
   * ist einer der drei Anteile DERSELBEN Simulation und kommt nicht obendrauf. Es ist wörtlich die
   * Ersatzfassung, die der Verweis ohne sein Ziel ohnehin genommen hätte.
   */
  const embeddedNote = 'Er steckt in der Gesamtersparnis dieses Speichers bereits mit drin'
  const selfConsumptionNote =
    'was Ihre PV-Erzeugung über den Speicher einspart, steckt dort als eigener Anteil daneben'

  return {
    id: 'load_control',
    title: 'Wert der Ladesteuerung unter aWATTar',
    /* ⚠ SEIT DEM ZUSAMMENFASSUNGS-UMBAU DER EINZIGE ORT DIESES BETRAGS — s. Modulkopf. */
    amount: {
      value: formatEur(primary.loadShiftSavingPerYear),
      caption: 'pro Jahr, exkl. MwSt.',
      tone: 'positive',
    },
    rows: [],
    body:
      'Für jede Viertelstunde Ihres Lastgangs ist der echte Börsenpreis jener Stunde plus das ' +
      'Netzentgelt Ihres Netzbetreibers angesetzt, statt eines festen Arbeitspreises. Der Speicher ' +
      'lädt in den günstigen Viertelstunden und entlädt in den teuren; die Differenz ist der ' +
      'ausgewiesene Wert. Er ist ein RÜCKBLICK auf die tatsächlichen Marktpreise Ihres Zeitraums ' +
      'und kein Versprechen für die Zukunft — die Preise von morgen kennt niemand. ' +
      `${embeddedNote}, und er zeigt ausschliesslich den Gewinn aus den Preisunterschieden: ` +
      `${selfConsumptionNote}.${annualized}`,
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

  return {
    recommendation: recommended ? buildRecommendation(analysis, recommended) : null,
    loadControl: buildLoadControl(analysis, primary),
  }
}
