import {
  PV_TEN_YEAR_SMOOTHING_OPTIMISM_PERCENT,
  buildRealSavingBreakdown,
  primaryBatteryEntry,
  savingsBaselineOf,
  sumCovered,
  tariffWayCosts,
  type BatteryCandidate,
  type BatteryResultEntry,
  type BatteryRoiEntry,
  type BillingModel,
  type ControlVariant as SharedControlVariant,
  type EstimatedPvSummary,
  type LoadProfile,
  type PvStage,
  displayedPriceLabel,
} from 'shared'

import { LARGE_GAP_SLOTS_THRESHOLD } from '@/lib/constants'
import { formatEur, formatKwh, formatKwh1, formatKwp, formatPercent } from '@/lib/format'
import {
  catalogStorageEntry,
  catalogStorageNote,
  dynamicTariffHintKind,
  recommendationRationaleText,
  storageJudgementText,
  storagePaysOff,
} from '@/lib/report-copy'
import { CANDIDATE_TABLE_ID } from './comparison'
import type { ReportBuildContext } from './context'
import { hasPvValueChapter } from './pv-value'
import { block, ref, t, REF_PLACE, type ReportText } from './report-text'
import type { ReportNotice, ReportRow, ReportStatement, ReportTone } from './statement'
import type { PdfReportAnalysis } from './types'

/**
 * Das erste inhaltliche Kapitel des react-pdf-Reports — die „Zusammenfassung".
 *
 * ── ⚠ DIESE DATEI DARF `@react-pdf/renderer` NICHT ANFASSEN — und Recharts genauso wenig ────────
 * Sie ist die Ableitung, nicht die Darstellung: sie entscheidet, WELCHE Aussage im Dokument steht,
 * und liefert fertige Zeichenketten. Gerendert wird in `document.tsx`.
 *
 * ── ⚠ EINE SPANNE, NICHT VIER BETRÄGE (Delta Report-Baukasten D8) ─────────────────────────────
 * Die Seite führt GENAU EINE Kern-Ersparnis-Aussage, und zwar als Spanne über benannte Wege. Bis
 * zum Umbau standen hier vier Aussagen mit je eigener Kopfzahl (`savings`, `peak_shaving`,
 * `load_shift`, `addon`) — vier Euro-Grössen nebeneinander, von denen drei nicht addiert werden
 * durften und die deshalb je einen eigenen Abgrenzungssatz brauchten. Genau davor warnt die
 * Ein-Spanne-Regel; sie ist mit dieser Fassung erfüllt.
 *
 * ── ⚠ DER GANZE ABSCHNITT HÄNGT AN EINER REGEL: KEINE ZAHL OHNE RECHNUNG ───────────────────────
 * Jede Aussage entsteht NUR, wenn die Grösse, um die es geht, tatsächlich gerechnet wurde. Fehlt
 * die Grundlage, fehlt die ZEILE — nicht ein Strich, nicht eine 0, nicht ein „nicht verfügbar".
 * Auf einer Seite, die „Zusammenfassung" überschrieben ist, wiegt das schwerer als sonst irgendwo:
 * sie ist die eine Seite, die ein weitergereichter Report garantiert gelesen bekommt.
 *
 * ── ⚠ ES WIRD NICHTS NACHGERECHNET ────────────────────────────────────────────────────────────
 * Die einzige Arithmetik sind `sumCovered` + `buildRealSavingBreakdown` — dieselben Funktionen, die
 * die Bildschirm-Karten benutzen. Ein zweiter Rechenweg ergäbe im selben Report zwei Beträge, die
 * dasselbe behaupten und sich um Cents unterscheiden.
 */

export type SummaryTone = ReportTone
export type SummaryRow = ReportRow

/**
 * Die Kennungen, die diese Seite noch trägt.
 *
 * ⚠ Ein Literal-Union und kein `string`: ein Tippfehler ist damit ein Compile-Fehler statt einer
 * Aussage, die niemand wiederfindet (dieselbe Überlegung wie bei `ReportBaukastenId`).
 */
export type SummaryStatement = ReportStatement & { id: 'addon' }

/**
 * Eine der zwei grossen Zahlen am Kopf der Seite.
 *
 * ⚠ `caption` ist ZWEIZEILIG, und die Trennung trägt Bedeutung: die erste Zeile sagt, WAS die Zahl
 * ist, die zweite, WORAUF sie sich bezieht. In eine Zeile gezogen liest sich die Bezugsgrösse wie
 * ein Nachsatz — und ausgerechnet sie entscheidet, ob ein Leser die Zahl für eine Jahreszahl hält.
 *
 * ⚠ `tone` ist eine AUSSAGE und keine Farbe: `ink` für das, was heute gezahlt wird, `accent` für
 * das, was sich sparen liesse. Welche Farbe daraus wird, entscheidet `document.tsx`.
 */
export type SummaryKpi = {
  id: 'cost_today' | 'possible_saving' | 'cost_awattar' | 'cost_controlled'
  value: string
  caption: readonly [string, string]
  /** Eine Zeile unter der Bezugszeile: Investition und Urteil zu einem Betrag „mit Speicher". */
  note?: string
  tone: 'ink' | 'accent'
}

export type ReportSummary = {
  /** Leer, wenn der Tarifvergleich nicht gerechnet werden konnte — dann gibt es keine der beiden. */
  kpis: SummaryKpi[]
  /** Die Hinweise, die die Datengrundlage der Zahlen darüber einschränken. */
  notices: ReportNotice[]
  /** Der Fliesstext-Absatz: was der Kunde hat, und welche Wege es gibt. */
  overview: ReportText
  /** Der Satz zur PV-Anlage — `null`, wenn keine angegeben ist. */
  pvPointer: ReportText | null
  /** Nur noch `addon` („Ausserdem schon geklärt") — leer, wenn nichts vorab geklärt ist. */
  statements: SummaryStatement[]
}

/**
 * Was diese Seite ausser dem Ergebnis liest.
 *
 * ⚠ `PdfReportInput` ist strukturell zuweisbar — der eigene Typ steht hier, damit die Signatur
 * sagt, welche FÜNF Felder gelesen werden, statt „alles, was ein Report hat".
 */
export type SummaryInput = {
  analysis: PdfReportAnalysis
  /** Gelesen wird ausschliesslich die HERKUNFT — s. `buildStandardProfileNotice`. */
  loadProfile: Pick<LoadProfile, 'source'>
  estimatedPv?: EstimatedPvSummary
  /** `undefined` = die Frage wurde nie beantwortet, und das ist NICHT `false` (s. `types.ts`). */
  hasPv?: boolean
  /** Bestehend oder geplant — s. `PdfReportInput.pvStage`. Fehlt sie, gilt `'existing'`. */
  pvStage?: PvStage
  /** Die erfasste Nennleistung der PV-Anlage. `undefined` = nicht erfasst; dann ohne Klammerwert. */
  pvPeakPowerKwp?: number
}

/**
 * Der Block, der oben steht: die bestehende Anlage des Kunden, sonst das bestgereihte Katalog-Gerät.
 *
 * Wortgleich zur Auswahl in `report.tsx` — zwei verschieden gewählte „primäre" Geräte in
 * Bildschirm-Report und PDF wären derselbe Report mit zwei verschiedenen Antworten.
 */
export function primaryEntryOf(analysis: PdfReportAnalysis): BatteryResultEntry | undefined {
  /*
   * ⚠ Die REGEL liegt seit D6 Teil 3 in `shared` (`primaryBatteryEntry`): die Jahres-Hochrechnung
   * liest denselben Eintrag aus einem ZWEITEN Ergebnis, und zwei Fassungen derselben Wahl ergäben
   * ein Dokument, dessen Kapitel von verschiedenen Speichern sprechen. Hier bleibt der bisherige
   * Name stehen — die Aufrufer dieser Datei heissen unverändert.
   */
  return primaryBatteryEntry(analysis)
}

/**
 * Das empfohlene KATALOG-Gerät — ausdrücklich nicht `primaryEntryOf`.
 *
 * ⚠ Der Unterschied ist fachlich: `primaryEntryOf` liefert im Bestandsfall die Anlage des Kunden,
 * und für die gibt es keine Kaufentscheidung mehr (sie ist bezahlt). Empfohlen wird immer ein
 * Gerät aus dem Katalog.
 */
export function recommendedEntryOf(analysis: PdfReportAnalysis): BatteryRoiEntry | undefined {
  /* K3b-2: ohne Empfehlung (leerer Katalog) ist auch `perBattery` leer — beides ergibt `undefined`. */
  const id = analysis.recommendation?.batteryId
  return (
    (id === undefined ? undefined : analysis.perBattery.find((p) => p.battery.id === id)) ??
    analysis.perBattery[0]
  )
}

/**
 * Hat dieser Tarif überhaupt einen Leistungspreis?
 *
 * ⚠ [ABGELEITET, keine Contract-Zahl] — gerechnet wird `leistungspreisCostPerYear = Satz × billedKw`
 * (§3.4). Ein Ergebnis > 0 heisst: es gibt einen Satz UND einen abgerechneten Wert. Ein Anschluss
 * ohne Leistungsmessung (Netzebene 7) hat den Posten überhaupt nicht.
 *
 * ⚠ EXPORTIERT FÜR `detail.ts`: der Monatsvergleich sagt in seiner Bildunterschrift, dass der
 * Leistungspreis NICHT enthalten ist — derselbe Vorbehalt wie an der Ist-Kosten-Kopfzahl unten,
 * und deshalb an derselben Bedingung. (`prerequisites.ts` hält seine eigene Fassung, s. dort.)
 */
export function hasLeistungspreis(current: PdfReportAnalysis['current']): boolean {
  return current.leistungspreisCostPerYear > 0
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Die zwei Wege und die zwei Kopfzahlen
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Die Kennung eines TARIFwegs. Weg 1 („Ihr Tarif heute") ist die BEZUGSGRÖSSE und steht deshalb
 * nicht in dieser Liste; Weg 5 (Spitzenkappung) hat einen anderen Bezugszeitraum, s. unten.
 */
export type SummaryWayId = 'comparison_tariff' | 'tariff_switch' | 'controlled'

/** Ein Weg, die Stromkosten zu senken — `eur` ist die Ersparnis über den GEMESSENEN Zeitraum. */
export type SummaryWay = {
  id: SummaryWayId
  eur: number
  /** Was dieser Weg im selben Zeitraum GEKOSTET hätte — die Höhe seines Balkens. */
  costEur: number
}

/**
 * Welche Ladesteuerung Weg 4 zeigt (D7-Revision).
 *
 * ⚠ Seit D6 Teil 3 die Definition aus `shared` — sie steht an der Auswahl, die sie bestimmt
 * (`tariffWayCosts`), und nicht hier. Der Name bleibt unverändert erreichbar.
 */
export type ControlVariant = SharedControlVariant

export type SummaryWays = {
  /** Was der Kunde im gemessenen Zeitraum tatsächlich gezahlt hat — Weg 1, die Bezugsgrösse. */
  costTodayEur: number
  /** Die Bezugsgrösse aller Zahlen. */
  coveredDays: number
  /**
   * Die Tarifwege in Dokumentreihenfolge (Weg 2, 3, 4). Weg 2 fehlt, wenn der Kunde keinen
   * Vergleichstarif angegeben hat — dann gibt es ihn schlicht nicht, keinen Platzhalter.
   * `eur` kann negativ sein; dann senkt der Weg nichts.
   */
  ways: readonly SummaryWay[]
  /**
   * ⚠ `predictive` heisst: Weg 4 trägt die VORAUSSCHAUENDE Ladesteuerung (unvalidiert,
   * `PREDICTIVE_CONTROL_VALUE_BASIS`), `simple` die bisherige Tagesmittel-Regel. Der Kundentext
   * verzweigt daran — eine Prognose unbenannt zu zeigen wäre der stille Rückfall, den D15 Regel C
   * verbietet.
   */
  controlVariant: ControlVariant | null
  /** Der Lieferant zu Weg 2 — `null`, wenn es den Weg nicht gibt. */
  comparisonSupplier: string | null
}

/**
 * Die Wege aus dem Monatsvergleich — `null`, wenn er nicht gerechnet wurde.
 *
 * ── ⚠ DIE SPITZENKAPPUNG (WEG 5) STEHT AUCH NACH DER D7-REVISION NICHT IN DIESER SPANNE ───────
 * Sie ist eine JAHRESgrösse aus dem Leistungspreis (€/kW·a), die Wege hier sind Summen über den
 * gemessenen Zeitraum aus dem Monatsvergleich. In eine Spanne gezogen stünden zwei verschiedene
 * Bezugszeiträume unter einer Zahl — genau die Addition, vor der der Report an jeder anderen Stelle
 * warnt. Sie ist deshalb ein eigener Weg IM KAPITEL (`ways.ts`) mit eigener Bezugsangabe, und der
 * Fliesstext dieser Seite nennt sie weiterhin gesondert (s. `buildOverview`).
 *
 * ⚠ OHNE MONATSVERGLEICH GIBT ES AUCH KEINE IST-KOSTEN. Der Contract führt die Gesamtkosten des
 * Kunden an keiner anderen Stelle — `current.leistungspreisCostPerYear` ist allein der
 * Leistungspreis-Anteil. Beide Kopfzahlen entfallen deshalb gemeinsam oder gar nicht.
 */
export function summaryWaysOf(analysis: PdfReportAnalysis): SummaryWays | null {
  const comparison =
    analysis.tariffOptimization?.computable === true
      ? analysis.tariffOptimization.monthlyComparison
      : undefined
  if (!comparison) return null
  /* Liefertarif unbekannt: ohne „Ihr Tarif heute" gibt es die Kopfzahl „Stromkosten heute" nicht —
     die Zusammenfassung dafür wird eigens gestaltet (25.09.2026), bis dahin entfällt sie. */
  const currentSeries = comparison.currentTariffEur
  if (!currentSeries) return null

  /* K3b-2: ohne Speicherreihe gibt es keine Aufschlüsselung „Tarifwechsel + Steuerung" — der
     Tarifwechsel steht dann für sich, und Weg 4 entfällt (unten). */
  const withBatterySeries = comparison.spotWithBatteryEur
  const real = withBatterySeries
    ? buildRealSavingBreakdown({
        currentTariffEur: sumCovered(currentSeries),
        spotWithoutControlEur: sumCovered(comparison.spotWithoutControlEur),
        spotWithBatteryEur: sumCovered(withBatterySeries),
      })
    : null

  /*
   * ⚠ WELCHE REIHE WELCHER WEG IST, ENTSCHEIDET `tariffWayCosts` (`shared`) — hier steht nur noch,
   * welche ERSPARNIS daraus folgt. Die Auswahl hat seit D6 Teil 3 einen zweiten Konsumenten (den
   * synthetischen Jahreslauf); zweimal geschrieben liefen die beiden auseinander, und der
   * Unterschied sähe aus wie ein Jahresgang.
   */
  const costs = tariffWayCosts(comparison)
  const costTodayEur = sumCovered(currentSeries)
  const ways: SummaryWay[] = []

  /*
   * Weg 2 — nur, wenn die Engine die Reihe gebildet hat. Sie fehlt, wenn der Kunde keinen
   * Vergleichstarif angegeben hat ODER er brutto hinterlegt ist (`tariff.ts`); in beiden Fällen
   * entfällt der Weg ganz, statt mit einem geratenen Wert dazustehen.
   */
  if (costs.comparisonTariffEur !== null) {
    const costEur = costs.comparisonTariffEur
    ways.push({ id: 'comparison_tariff', eur: costTodayEur - costEur, costEur })
  }

  ways.push({
    id: 'tariff_switch',
    /* Derselbe Ausdruck wie in `buildRealSavingBreakdown`, auf denselben Summen — der Rückfall ist
       wertgleich und steht nur da, weil es ohne Speicherreihe keine Aufschlüsselung gibt. */
    eur: real ? real.tariffSwitchEur : costTodayEur - costs.spotWithoutControlEur,
    costEur: costs.spotWithoutControlEur,
  })

  /*
   * Weg 4 — die VORAUSSCHAUENDE Ladesteuerung, sobald die Engine sie rechnen konnte; sonst die
   * bisherige Tagesmittel-Regel. Gezeigt wird immer genau eine der beiden, und der Report sagt
   * welche (`controlVariant`).
   */
  if (costs.controlledEur !== null && real) {
    ways.push({
      id: 'controlled',
      eur:
        costs.controlVariant === 'predictive' ? costTodayEur - costs.controlledEur : real.totalEur,
      costEur: costs.controlledEur,
    })
  }

  return {
    costTodayEur,
    coveredDays: analysis.dataQuality.coveredDays,
    ways,
    controlVariant: costs.controlVariant,
    comparisonSupplier: costs.comparisonSupplier,
  }
}

/**
 * Die Tarifwege bei unbekanntem Liefertarif (Pflichtenheft §3.1a) — `null` in jedem anderen Fall.
 *
 * ⚠ EIGENE FORM NEBEN `SummaryWays` UND NICHT DEREN ERWEITERUNG: ohne „Ihr Tarif heute" gibt es
 * absolute Kosten, aber keine Ersparnis-Grösse, und jeder Leser von `SummaryWays` rechnet mit
 * einer. Bezugsgrösse kann allein der Vergleichstarif sein (`savingsBaselineOf`).
 */
export type UnknownTariffWays = {
  coveredDays: number
  /** aWATTar ohne Steuerung, über den gemessenen Zeitraum. */
  uncontrolledEur: number
  /** aWATTar mit Ladesteuerung — `null` ohne Speicher-Dispatch. */
  controlledEur: number | null
  controlVariant: ControlVariant | null
  /** Der Vergleichstarif als Bezugsgrösse; `null` = keine Ersparnis-Aussage, nur absolute Kosten. */
  baseline: { supplier: string | null; eur: number } | null
}

export function unknownTariffWaysOf(analysis: PdfReportAnalysis): UnknownTariffWays | null {
  const comparison =
    analysis.tariffOptimization?.computable === true
      ? analysis.tariffOptimization.monthlyComparison
      : undefined
  if (!comparison || comparison.currentTariffEur) return null

  const costs = tariffWayCosts(comparison)
  const baseline = savingsBaselineOf(costs)
  return {
    coveredDays: analysis.dataQuality.coveredDays,
    uncontrolledEur: costs.spotWithoutControlEur,
    controlledEur: costs.controlledEur,
    controlVariant: costs.controlVariant,
    baseline: baseline ? { supplier: costs.comparisonSupplier, eur: baseline.eur } : null,
  }
}

/**
 * Das Urteil über das empfohlene Gerät, wortgleich mit der Bildschirm-Empfehlung
 * (`recommendationRationaleText`) — `null`, wo das Gerätekapitel keine Kaufaussage trägt.
 */
export function recommendationVerdictOf(analysis: PdfReportAnalysis): string | null {
  const recommendation = analysis.recommendation
  if (!recommendation || analysis.existingBatteryAnalysis) return null
  if (dynamicTariffHintKind(analysis)) return null
  const entry = recommendedEntryOf(analysis)
  return entry ? recommendationRationaleText(entry.battery.name, recommendation.rationale) : null
}

/** Die Kopfzahlen bei unbekanntem Liefertarif: absolute Kosten, keine Ersparnis. */
export function buildUnknownTariffKpis(
  analysis: PdfReportAnalysis,
  ways: UnknownTariffWays,
): SummaryKpi[] {
  const days = `über ${ways.coveredDays} gemessene Tage, ${displayedPriceLabel(analysis)}`
  const basis = hasLeistungspreis(analysis.current) ? `${days}, ohne Leistungspreis` : days
  const kpis: SummaryKpi[] = [
    {
      id: 'cost_awattar',
      value: formatEur(ways.uncontrolledEur),
      caption: ['Stromkosten mit aWATTar ohne Steuerung', basis],
      tone: 'ink',
    },
  ]
  if (ways.controlledEur !== null) {
    const note = catalogStorageNote(analysis)
    kpis.push({
      id: 'cost_controlled',
      value: formatEur(ways.controlledEur),
      caption: [
        analysis.existingBatteryAnalysis
          ? 'Mit Ladesteuerung Ihres Speichers'
          : 'Mit Speicher und Ladesteuerung',
        basis,
      ],
      ...(note ? { note } : {}),
      tone: 'accent',
    })
  }
  return kpis
}

/** Die Wege, auf denen im gemessenen Zeitraum tatsächlich etwas zu sparen war. */
function positiveWays(ways: SummaryWays): SummaryWay[] {
  return ways.ways.filter((way) => way.eur > 0)
}

/**
 * Die zwei Kopfzahlen.
 *
 * ⚠ DIE IST-KOSTEN NENNEN IHRE GRENZE SELBST. Der Monatsvergleich führt Arbeits- und
 * Netz-Arbeitspreis samt Grundgebühren, ausdrücklich NICHT den Leistungspreis. Wo es den Posten
 * gibt, sagt die Bezugszeile das — sonst stünde unter „Ihre Stromkosten heute" eine Zahl, die bei
 * einem Gewerbekunden einen erheblichen Teil seiner Rechnung auslässt.
 *
 * ⚠ „netto" steht in DERSELBEN Bezugszeile und nicht mehr als Fussnote am Seitenende: eine
 * Preisangabe ohne Umsatzsteuer gehört an die Zahl, auf die sie sich bezieht.
 */
export function buildSummaryKpis(analysis: PdfReportAnalysis, ways: SummaryWays): SummaryKpi[] {
  const days = `über ${ways.coveredDays} gemessene Tage, ${displayedPriceLabel(analysis)}`
  const kpis: SummaryKpi[] = [
    {
      id: 'cost_today',
      value: formatEur(ways.costTodayEur),
      caption: [
        'Ihre Stromkosten heute',
        hasLeistungspreis(analysis.current) ? `${days}, ohne Leistungspreis` : days,
      ],
      tone: 'ink',
    },
  ]

  /*
   * Ein Speicher, der sich im Betrachtungszeitraum nicht rechnet, steht nicht in der Spanne — sein
   * Betrag steht als Satz darunter, mit Investition und Urteil.
   */
  const storage = catalogStorageEntry(analysis)
  const controlled = ways.ways.find((way) => way.id === 'controlled')
  const unprofitable = storage && controlled && !storagePaysOff(storage) ? storage : undefined
  const note = unprofitable
    ? `Mit Speicher und Ladesteuerung zusätzlich ${formatEur(unprofitable.totalSavingPerYear)} pro Jahr, ` +
      `bei ${formatEur(unprofitable.totalInvestment)} Investition (${unprofitable.battery.name}). ` +
      storageJudgementText(unprofitable, analysis.assumptions.horizonYears)
    : undefined

  const positive = positiveWays(ways).filter((way) => !(unprofitable && way.id === 'controlled'))
  if (positive.length === 0) {
    if (note) kpis[0] = { ...kpis[0]!, note }
    return kpis
  }

  const min = Math.min(...positive.map((way) => way.eur))
  const max = Math.max(...positive.map((way) => way.eur))
  const only = positive.length === 1 ? positive[0] : undefined

  kpis.push({
    id: 'possible_saving',
    value: min === max ? formatEur(max) : `${formatEur(min)} – ${formatEur(max)}`,
    caption: [
      'Mögliche Ersparnis',
      only === undefined
        ? 'je nach gewähltem Weg, im selben Zeitraum'
        : only.id === 'controlled'
          ? 'mit gezielter Ladesteuerung, im selben Zeitraum'
          : only.id === 'comparison_tariff'
            ? 'mit dem von Ihnen gefundenen Tarif, im selben Zeitraum'
            : 'durch einen Tarifwechsel, im selben Zeitraum',
    ],
    ...(note ? { note } : {}),
    tone: 'accent',
  })
  return kpis
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Der Fliesstext-Absatz
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Was der Kunde hat — aus den tatsächlich erfassten Angaben gebildet, Baustein für Baustein.
 *
 * ⚠ `hasPv === undefined` IST NICHT `false`: der Wizard-Entwurf kennt „nein" und „dazu wurde nichts
 * gefragt" getrennt (`readPvDraft`). Auf `false` gerundet stünde im Report eine Aussage über den
 * Kunden, die niemand gemacht hat — der Satz schweigt dann über die PV-Seite, statt sie zu
 * verneinen. Für den Speicher gibt es diese Unterscheidung nicht: ohne `existingBatteryAnalysis`
 * hat die Engine ohne Bestandsanlage gerechnet, und das IST die Aussage.
 */
function equipmentSentence(
  battery: BatteryCandidate | undefined,
  hasPv: boolean | undefined,
  pvStage: PvStage | undefined,
  pvPeakPowerKwp: number | undefined,
): string {
  const have: string[] = []
  const lack: string[] = []

  if (battery) have.push(`eine Batterie (${formatKwh1(battery.usableCapacityKwh)})`)
  else lack.push('keinen Batteriespeicher')

  const pvLabel =
    pvPeakPowerKwp === undefined ? 'eine PV-Anlage' : `eine PV-Anlage (${formatKwp(pvPeakPowerKwp)})`

  /*
   * ⚠ EINE GEPLANTE ANLAGE GEHÖRT IN KEINE DER BEIDEN LISTEN. „Sie haben bereits" wäre falsch (sie
   * steht noch nicht), „Sie haben noch keine" ebenso (sie ist bestellt, und die Rechnung darunter
   * setzt sie bereits voraus). Sie bekommt deshalb einen eigenen Satz, der beides sagt — dass es
   * sie noch nicht gibt UND dass sie in den Zahlen schon steckt.
   */
  const planned = hasPv === true && pvStage === 'planned'
  if (hasPv === true && !planned) have.push(pvLabel)
  else if (hasPv === false) lack.push('keine PV-Anlage')

  const base =
    have.length > 0 && lack.length > 0
      ? `Sie haben bereits ${have.join(' und ')}, aber noch ${lack.join(' und ')}.`
      : have.length > 0
        ? `Sie haben bereits ${have.join(' und ')}.`
        : lack.length === 2
          ? 'Sie haben bislang weder einen Batteriespeicher noch eine PV-Anlage.'
          : `Sie haben bislang ${lack[0]}.`

  return planned ? `${base} ${pvLabel[0]!.toUpperCase()}${pvLabel.slice(1)} ist geplant.` : base
}

/** Wie der Weg „aWATTar mit Steuerung" heisst — mit Bestandsanlage steuert er IHREN Speicher. */
function controlledWay(hasBattery: boolean): string {
  return (
    'ein Tarif mit stündlich wechselndem Preis, kombiniert mit gezielter Ladesteuerung ' +
    (hasBattery ? 'Ihres Speichers' : 'eines Speichers')
  )
}

const SWITCH_WAY = 'ein einfacher Tarifwechsel ohne jede Umstellung'

/** Wie ein einzelner Weg im Fliesstext heisst. */
function wayPhrase(way: SummaryWay, ways: SummaryWays, hasBattery: boolean): string {
  if (way.id === 'controlled') return controlledWay(hasBattery)
  if (way.id === 'comparison_tariff') {
    return ways.comparisonSupplier
      ? `ein Wechsel zu dem von Ihnen gefundenen Tarif (${ways.comparisonSupplier})`
      : 'ein Wechsel zu dem von Ihnen gefundenen Tarif'
  }
  return SWITCH_WAY
}

const COUNT_WORD = ['keinen', 'einen', 'zwei', 'drei'] as const

/**
 * Welche Wege es gibt — und, wo einer nicht trägt, warum nicht.
 *
 * ⚠ GEZÄHLT WIRD, WAS TATSÄCHLICH SENKT. Ein Weg mit negativer Ersparnis ist kein Weg zur
 * Kostensenkung, sondern ein teurerer Tarif; ihn mitzuzählen machte aus „zwei Wege" eine Angabe,
 * die die Spanne daneben nicht deckt.
 *
 * ⚠ Die ZAHL im Satz kommt aus `positive.length` und ist nirgends ausgeschrieben — seit der
 * D7-Revision können es bis zu drei sein (Weg 2 kommt dazu, wenn der Kunde einen Vergleichstarif
 * angegeben hat), und ein Literal liefe beim nächsten Weg still daneben.
 */
function waysSentence(ways: SummaryWays, hasBattery: boolean): string {
  const positive = positiveWays(ways)
  const phrases = positive.map((way) => wayPhrase(way, ways, hasBattery))

  if (positive.length >= 2) {
    return (
      `Es gibt ${COUNT_WORD[positive.length] ?? String(positive.length)} unterschiedlich ` +
      `aufwändige Wege, Ihre Stromkosten zu senken: ${phrases.slice(0, -1).join(', ')} oder ` +
      `${phrases[phrases.length - 1]} — alle weiter hinten im Detail erklärt.`
    )
  }
  /* K3b-2: Ohne Speicher wurde Weg 4 gar nicht gerechnet (`controlVariant === null`). Die beiden
     Sätze unten sprechen sonst über eine Ladesteuerung, zu der in diesem Report keine Zahl steht. */
  const hasControlled = ways.controlVariant !== null
  const only = positive[0]
  if (only) {
    const rest =
      only.id === 'controlled'
        ? ' Ein reiner Tarifwechsel ohne Steuerung käme Sie in Ihrem Fall teurer als Ihr heutiger Tarif.'
        : hasControlled
          ? ' Die zusätzliche Ladesteuerung bringt in Ihrem Fall nichts darüber hinaus.'
          : ''
    return (
      `Es gibt genau einen Weg, Ihre Stromkosten zu senken: ${phrases[0]} — weiter hinten im ` +
      `Detail erklärt.${rest}`
    )
  }
  return hasControlled
    ? 'Keiner der geprüften Tarifwege hätte Ihre Stromkosten im gemessenen Zeitraum gesenkt: weder ' +
      'ein reiner Wechsel zu einem Börsenpreis-Tarif noch derselbe Tarif mit gezielter ' +
      'Ladesteuerung wäre günstiger gewesen als Ihr heutiger. Die Zahlen dazu stehen weiter hinten.'
    : 'Keiner der geprüften Tarifwege hätte Ihre Stromkosten im gemessenen Zeitraum gesenkt: auch ' +
      'ein Wechsel zu einem Börsenpreis-Tarif wäre nicht günstiger gewesen als Ihr heutiger. ' +
      'Die Zahlen dazu stehen weiter hinten.'
}

/**
 * Der Absatz bei unbekanntem Liefertarif: was gerechnet ist (absolute Kosten), was fehlt (der
 * heutige Tarif) und wie es nachzuholen ist. Das Speicher-Urteil wird zitiert, nicht neu gefasst.
 */
function unknownTariffOverview(analysis: PdfReportAnalysis, ways: UnknownTariffWays): ReportText {
  const existing = analysis.existingBatteryAnalysis != null
  const controlled =
    ways.controlledEur === null
      ? '.'
      : existing
        ? ' — einmal ohne Steuerung und einmal mit gezielter Ladesteuerung Ihres Speichers.'
        : ' — einmal so, wie Sie heute Strom beziehen, und einmal mit einem Speicher, der gezielt in den günstigen Stunden lädt.'
  const baseline = ways.baseline
    ? ` Der von Ihnen gefundene Tarif${ways.baseline.supplier ? ` (${ways.baseline.supplier})` : ''} hätte im selben Zeitraum ${formatEur(ways.baseline.eur)} gekostet; was die Wege gegenüber ihm sparen, steht weiter hinten.`
    : ''
  const verdict = recommendationVerdictOf(analysis)
  const primary = primaryEntryOf(analysis)
  const peakPart: ReportText =
    primary && primary.leistungspreisSavingPerYear > 0
      ? t` Die Kappung Ihrer Lastspitzen ist in diesen Zahlen nicht enthalten: sie hängt am Leistungspreis Ihres Netzbetreibers und nicht am Stromvertrag${ref(
          block('recommendation'),
          `, und was ein Speicher dabei leistet, steht ${REF_PLACE}`,
          '',
        )}.`
      : ''

  return t`Ihren heutigen Stromtarif kennen wir nicht, weil uns Ihre Stromrechnung nicht vorliegt. Die Zahlen oben sind deshalb keine Ersparnis, sondern Ihre Stromkosten mit einem Börsenpreis-Tarif (aWATTar)${controlled}${baseline} Den Vergleich mit Ihrem heutigen Tarif rechnen wir nach, sobald Sie uns Ihre Stromrechnung nachreichen.${
    verdict
      ? t` ${verdict}${ref(block('recommendation'), ` Die Einzelheiten zum Gerät stehen ${REF_PLACE}.`, '')}`
      : ''
  }${peakPart}`
}

/**
 * Der eine Absatz der Zusammenfassung.
 *
 * ⚠ ER IST DER ORT, AN DEM DIE SPITZENKAPPUNG GENANNT WIRD. Sie steht bewusst nicht in der Spanne
 * darüber (s. `summaryWaysOf`) — verschwiege der Absatz sie ganz, führte der Report bei einem
 * Gewerbekunden eine Zahl mit der Überschrift „Mögliche Ersparnis", die seinen grössten Hebel
 * auslässt. Der Satz entsteht nur, wo der Speicher den abgerechneten Leistungswert wirklich senkt.
 */
export function buildOverview(analysis: PdfReportAnalysis, input: SummaryInput): ReportText {
  const existing = analysis.existingBatteryAnalysis
  const equipment = equipmentSentence(
    existing?.entry.battery,
    input.hasPv,
    input.pvStage,
    input.pvPeakPowerKwp,
  )
  const ways = summaryWaysOf(analysis)

  /*
   * ── K3b-2: DER HINWEIS STEHT IM ERSTEN KAPITEL, WEIL DAS IMMER GERENDERT WIRD ───────────────
   * Er erklärt, warum weiter hinten ganze Kapitel fehlen. Ein eigener Baustein wäre dafür der
   * falsche Ort: ein Baustein kann abgewählt werden (Baukasten C), und dann stünde die Lücke
   * unerklärt da.
   */
  const noRecommendation: ReportText = analysis.noRecommendationReason
    ? ' Einen Speichervorschlag enthält dieser Report nicht: für Ihre Kundenkategorie ist derzeit ' +
      'kein Speicher freigegeben, und ein Beispielgerät wäre eine Empfehlung ohne Grundlage.'
    : ''

  const unknown = unknownTariffWaysOf(analysis)
  if (unknown) return t`${equipment} ${unknownTariffOverview(analysis, unknown)}${noRecommendation}`

  if (!ways) {
    /* Der Grund steht als strukturierter Befund im Schlusskapitel — hier nur der Zeiger darauf. */
    return t`${equipment} Ob und wie sich Ihre Stromkosten über den Stromtarif senken lassen, liess sich für diesen Zeitraum nicht berechnen${ref(
      block('tariff_blocker'),
      ` — woran das liegt, steht ${REF_PLACE}`,
      '',
    )}.${noRecommendation}`
  }

  const primary = primaryEntryOf(analysis)
  const peakPart: ReportText =
    primary && primary.leistungspreisSavingPerYear > 0
      ? t` Die Kappung Ihrer Lastspitzen ist in dieser Spanne nicht enthalten: sie hängt am Leistungspreis Ihres Netzbetreibers und nicht am Stromvertrag${ref(
          block('recommendation'),
          `, und was Ihr Speicher dabei leistet, steht ${REF_PLACE}`,
          '',
        )}.`
      : ''

  return t`${equipment} ${waysSentence(ways, existing != null)}${peakPart}${noRecommendation}`
}

/**
 * Der Satz zur PV-Anlage.
 *
 * ⚠ ER HÄNGT AN DER ANGABE DES KUNDEN, NICHT AM BEFUND. Dass eine PV-Anlage da ist, ändert die
 * Lesart aller drei Kostenreihen — sie sind auf dem Netzbezug NACH Eigenverbrauch gerechnet. Der
 * zweite Halbsatz kommt nur dazu, wenn es den Befund wirklich gibt; ohne ihn versprächen wir ein
 * Kapitel, in dem nichts steht.
 */
export function buildPvPointer(
  hasPv: boolean | undefined,
  pvStage: PvStage | undefined,
  /**
   * Gibt es das Kapitel „Ihre PV-Anlage"? Entscheidet AUSSCHLIESSLICH, WOHIN der Befund-Halbsatz
   * zeigt — ob es ihn gibt, hängt weiterhin am Befund selbst (s. unten).
   */
  pvChapterPresent = false,
): ReportText | null {
  if (hasPv !== true) return null

  /*
   * ⚠ ZWEI SÄTZE, WEIL DIE ZAHLEN VERSCHIEDEN ZUSTANDE KOMMEN. Bei einer BESTEHENDEN Anlage steckt
   * die Erzeugung im gemessenen Netzbezug; bei einer GEPLANTEN ist sie aus Standort und
   * Anlagendaten geschätzt und vom Lastgang abgezogen worden. Denselben Satz über beide zu
   * schreiben hiesse, eine Schätzung als Messung auszugeben — und zwar an der Stelle, die die
   * Lesart ALLER Kostenreihen setzt.
   */
  if (pvStage === 'planned') {
    return t`Ihre geplante PV-Anlage ist in diesen Zahlen bereits berücksichtigt: ihre Erzeugung ist aus Standort und Anlagendaten geschätzt und vom gemessenen Netzbezug abgezogen — sie senkt die Kosten aller Wege gleichermassen, an der Tarifwahl ändert sie nichts.`
  }

  /*
   * ⚠ ZWEI MÖGLICHE ZIELE, UND DAS IST KEINE DOPPELUNG DES SATZES. Gibt es das Kapitel „Ihre
   * PV-Anlage", steht der Befund dort — samt dem, was er kostet und was er NICHT sagt; sonst ist
   * der Hinweis im Schlusskapitel die einzige Stelle. Ein fest auf `pv_outage` verdrahteter
   * Verweis schickte den Leser an der ausführlichen Fassung vorbei.
   *
   * ⚠ OB ES DEN HALBSATZ GIBT, entscheidet weiterhin das ZIEL und nicht diese Bedingung: beide
   * Bausteine entstehen nur mit auffälligem Monat, und ohne einen fällt der Verweis samt Satzteil
   * auf seine leere Fassung. Das Kapitel gibt es auch ohne Befund — ein an ihm hängender Satz
   * kündigte dann einen an, den niemand findet.
   */
  const finding = pvChapterPresent ? block('pv_value_finding') : block('pv_outage')

  return t`Ihre PV-Anlage ist in diesen Zahlen bereits berücksichtigt: sie senkt Ihren Netzbezug und damit die Kosten aller Wege gleichermassen — an der Tarifwahl ändert sie nichts.${ref(
    finding,
    ` Zu ihrer Erzeugung gibt es ausserdem einen Befund, der unabhängig von der Tarifwahl gilt — er steht ${REF_PLACE}.`,
    '',
  )}`
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * „Ausserdem schon geklärt"
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/** Die stabile Kennung des Zusatzspeicher-Zeigers (s. `CANDIDATE_TABLE_ID`). */
export const ADDON_ID = 'addon'

/**
 * Lohnt sich ein ZUSÄTZLICHER Speicher?
 *
 * ⚠ NUR IM BESTANDSFALL. Ohne bestehende Anlage gibt es diese Frage nicht — dort ist der Kauf
 * EINES Speichers offen, und dazu sagt diese Seite bewusst nichts.
 *
 * ── ⚠ EIN ZEIGER UND KEINE ZWEITE FASSUNG ─────────────────────────────────────────────────────
 * Die Seite sagt, dass die Frage geklärt ist; die Antwort steht dort, wo ihre Begründung liegt
 * (Kurve, Tabelle bzw. Verdikt). Ein Satz, ein teal Kasten, ein Verweis.
 *
 * ⚠ DIE ZAHL DES POSITIVEN ZWEIGS HÄNGT AN DER KANDIDATENTABELLE, und zwar an ihrem tatsächlichen
 * Dastehen. Sie ist eine Jahresersparnis, deren Beleg — welches Gerät, was es kostet, was netto
 * bleibt — AUSSCHLIESSLICH in `table_candidates` steht. Ist die Tabelle abgewählt, stünde hier
 * sonst ein Betrag, den das Dokument nirgends aufschlüsselt.
 *
 * ⚠ Die Schwelle ist `netSavingOverHorizon > 0` und ausdrücklich NICHT `totalSavingPerYear > 0` —
 * dieselbe Bedingung wie im Bildschirm-Report und wie in `comparisonSelection`. Die schwächere
 * Fassung liess an einem realen Fall alle fünf Geräte als „positiv" durchgehen (€ 22–32 im Jahr bei
 * € 6.750 Investition).
 */
export function buildAddon(analysis: PdfReportAnalysis): SummaryStatement | null {
  const existing = analysis.existingBatteryAnalysis
  if (!existing) return null

  const best = existing.addonScenarios.filter((s) => s.netSavingOverHorizon > 0)[0]

  return {
    id: ADDON_ID,
    title: 'Ausserdem schon geklärt',
    /* Kein Betrag, keine Aufschlüsselung: beide stünden in einem Kasten, der auf sie verweist. */
    amount: null,
    rows: [],
    aside: true,
    body: best
      ? t`Ein zusätzlicher Batteriespeicher rechnet sich für Sie${ref(
          block(CANDIDATE_TABLE_ID),
          `: das bestgereihte Gerät bringt ${formatEur(
            best.totalSavingPerYear,
          )} im Jahr zusätzlich, und ${REF_PLACE} steht, welches Gerät das ist und was es kostet`,
          '',
        )}.`
      : t`Ein zusätzlicher Batteriespeicher lohnt sich für Sie derzeit nicht${ref(
          block('addon_none'),
          ` — woran das liegt, steht ${REF_PLACE}`,
          '',
        )}.`,
  }
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Die vier Hinweise, die die Datengrundlage einschränken
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * ⚠ VIER BEDINGUNGEN, DIE VONEINANDER UNABHÄNGIG SIND — und genau so sind sie am Bildschirm
 * begründet. Sie sagen VERSCHIEDENES, und die Handlung, die daraus folgt, ist je eine andere:
 *
 *   • Teiljahr — es FEHLT ein Zeitraum. Abhilfe: ein anderes Abrechnungsmodell (oder mehr Monate).
 *   • Datenlücke — der Zeitraum sieht vollständig aus und hat trotzdem keine Substanz: die Slots
 *     existieren, ihre Werte sind linear aufgefüllt. Abhilfe: den vollständigen Lastgang anfordern.
 *   • Standardprofil — es gibt gar keine Messung des VERBRAUCHS. Abhilfe: echten Lastgang laden.
 *   • Geschätzte PV — es gibt keine Messung der ERZEUGUNG. Abhilfe: Lastgang MIT Einspeisung.
 *
 * ⚠ SIE STEHEN BEI DEN KOPFZAHLEN UND NICHT IM SCHLUSSKAPITEL. Sie schränken genau die Grundlage
 * ein, auf der die zwei Zahlen darüber beruhen — drei Seiten weiter hinten stünde die Einordnung
 * dort, wo sie niemand mehr mit der Zahl zusammenbringt (so schon der Bildschirm-Kommentar: „nicht
 * nur in der Datenqualitäts-Box, die beim Live-Test überscrollt wurde").
 *
 * ⚠ KEINE der Schwellen ist hier erfunden: `< 12` Monate und `startsWith('monthly')` stehen so in
 * `report.tsx`, die Lückengrenze ist die EINE Konstante `LARGE_GAP_SLOTS_THRESHOLD` (importiert,
 * nicht abgeschrieben), und `source === 'standard_profile'` ist dieselbe Eigenschaft, an der die
 * Engine die Spitzenkappung abschaltet (`peakShavingBlockers`).
 */

/**
 * Die Anzeigenamen der Abrechnungsmodelle.
 *
 * ⚠ BEWUSSTE DOPPELUNG ZU `print-assumptions-snapshot.tsx`. Sie zu teilen hiesse, aus dem
 * PDF-Verzeichnis in eine Bildschirm-Komponente zu importieren — und die zieht React und das
 * Zahlenformat-Bauteil in den Lazy-Chunk des PDF-Wegs.
 */
const BILLING_MODEL_LABEL: Record<BillingModel, string> = {
  monthly_max_average: 'Mittel der 12 Monatshöchstwerte',
  annual_max: 'Jahreshöchstwert',
  monthly_max_sum: 'Summe der 12 Monatshöchstwerte',
}

/**
 * Teiljahres-Datensatz unter einem monatsbasierten Abrechnungsmodell (§3.5).
 *
 * ⚠ BENANNTE PRÄZISIERUNG GEGENÜBER DEM BILDSCHIRM: dort steht das Modell fest als „Mittelwert der
 * Monatsspitzen" im Satz, obwohl die Bedingung auch `monthly_max_sum` trifft — dann benennt der
 * Satz das falsche Modell. Hier steht der Name, den das Ergebnis tatsächlich trägt.
 *
 * ⚠ SEIT DEM UMBAU AUF DIE ZUSAMMENFASSUNG OHNE ORTSANGABE: der abgerechnete Leistungswert steht
 * nicht mehr als Kopfzahl auf dieser Seite, „oben" zeigte ins Leere. Der Hinweis benennt ihn
 * stattdessen als Grösse — er ist deswegen nicht weniger wahr.
 */
export function buildPartialYearNotice(analysis: PdfReportAnalysis): ReportNotice | null {
  const { billingModel } = analysis.assumptions
  const { coveredMonths } = analysis.dataQuality
  if (billingModel === null || !billingModel.startsWith('monthly') || coveredMonths >= 12) {
    return null
  }
  /* Ohne Leistungspreis hat der Hinweis keinen Gegenstand: es gibt den Posten gar nicht. */
  if (!hasLeistungspreis(analysis.current)) return null

  return {
    id: 'partial_year',
    tone: 'warning',
    title: `Nur ${coveredMonths} von 12 Monaten mit Daten`,
    body:
      `Der abgerechnete Leistungswert unter dem Modell „${BILLING_MODEL_LABEL[billingModel]}" ist ` +
      `damit nicht aussagekräftig — die ${12 - coveredMonths} Monate ohne Daten kann das Modell ` +
      'nicht mitteln. „Jahreshöchstwert" als Abrechnungsmodell liefert für diesen Datensatz eine ' +
      'belastbarere Zahl.',
    list: null,
    hints: [],
  }
}

/**
 * Eine grosse zusammenhängende Datenlücke (§3.3).
 *
 * ⚠ Gemessen wird die LÄNGSTE zusammenhängende Lücke und nicht ihre Summe: 2.000 über das Jahr
 * verstreute Einzelslots sind eine Kleinigkeit, 2.000 am Stück sind drei Wochen ohne jede Messung.
 *
 * ⚠ Ein älteres archiviertes Ergebnis trägt das Feld nicht; `undefined > Schwelle` ist `false`, und
 * dann steht hier kein Hinweis statt eines Fehlers.
 *
 * ⚠ ER HÄNGT AN KEINEM TARIF — und deshalb braucht seine Folgerung zwei Fassungen: ein Anschluss
 * ohne Leistungsmessung kann die Lücke genauso reissen wie jeder andere, hat aber weder einen
 * abgerechneten Leistungswert noch eine Ersparnis daraus.
 */
export function buildLargeGapNotice(analysis: PdfReportAnalysis): ReportNotice | null {
  const slots = analysis.dataQuality.largestGapSlots
  if (!(slots > LARGE_GAP_SLOTS_THRESHOLD)) return null

  const days = Math.round(slots / 96)
  const consequence = hasLeistungspreis(analysis.current)
    ? `Eine Lastspitze, die in diesen ${days} Tagen aufgetreten ist, kann in keiner Zahl dieses ` +
      'Reports vorkommen: der abgerechnete Leistungswert und die daraus abgeleitete Ersparnis ' +
      'sind für diesen Datensatz eher zu niedrig als zu hoch.'
    : `Was in diesen ${days} Tagen tatsächlich verbraucht wurde, steckt deshalb in keiner Zahl ` +
      'dieses Reports — jede Ersparnis, die auf diesen Abschnitt entfällt, beruht auf einer ' +
      'Annahme und nicht auf einer Messung.'

  return {
    id: 'large_gap',
    tone: 'warning',
    title: `Grosse Datenlücke: ${days} Tage am Stück ohne Messwerte`,
    body:
      'Der Zeitraum ist zwar durchgehend abgedeckt, in diesem Abschnitt stammen die Werte aber ' +
      'nicht aus einer Messung — sie wurden linear zwischen dem letzten und dem nächsten bekannten ' +
      `Wert aufgefüllt. ${consequence}`,
    list: null,
    hints: [
      'Bitte den vollständigen Lastgang beim Netzbetreiber anfordern (Viertelstundenwerte ohne ' +
        'Lücke).',
    ],
  }
}

/**
 * Der Lastgang ist SYNTHETISCH (Delta 8 / 9b-1).
 *
 * ⚠ NEUTRALER Ton, nicht Warnung — wortgleich zum Bildschirm. Ein Standardprofil ist kein Mangel an
 * den Daten, sondern eine andere Art von Grundlage: für den Tarifvergleich reicht sie, für die
 * Leistungspreis-Dimension nicht.
 *
 * ⚠ ER LIEST ZWEIERLEI — die Herkunft des Lastgangs UND ob es einen Leistungspreis gibt. Beides ist
 * nötig, weil die Kombination die WAHRSCHEINLICHSTE ist: die Lastgang-Station bietet das
 * Standardprofil an, bevor die Rechnungs-Station `meteringVariant` überhaupt erhebt — ein privater
 * NE7-Anschluss läuft also regelmässig in genau diesen Fall.
 */
export function buildStandardProfileNotice(
  loadProfile: Pick<LoadProfile, 'source'>,
  current: PdfReportAnalysis['current'],
): ReportNotice | null {
  if (loadProfile.source !== 'standard_profile') return null

  const withLeistungspreis = hasLeistungspreis(current)

  return {
    id: 'standard_profile',
    tone: 'neutral',
    title: 'Auf Basis eines Standardlastprofils — keine gemessenen Werte',
    body:
      'Diese Analyse rechnet mit einem synthetischen Durchschnittsprofil, das aus Ihrer ' +
      'Jahresverbrauchs-Angabe gebildet wurde. Für den Tarifvergleich reicht das: dafür zählt, ' +
      'wann im Tagesverlauf Strom verbraucht wird. ' +
      (withLeistungspreis
        ? 'Die ausgewiesenen Leistungswerte sind dagegen die Spitzen dieser Durchschnittskurve ' +
          'und keine gemessene Lastspitze — eine Ersparnis beim Leistungspreis wird deshalb gar ' +
          'nicht erst ausgewiesen, statt sie zu schätzen.'
        : 'Über Ihre tatsächlichen Lastspitzen sagt diese Analyse dagegen nichts: eine ' +
          'Durchschnittskurve glättet sie, und gemessen wurde keine einzige.'),
    list: null,
    hints: [
      withLeistungspreis
        ? 'Für die Leistungspreis-Dimension: echten Lastgang hochladen (Viertelstundenwerte Ihres ' +
          'Netzbetreibers).'
        : /* Der Upload lohnt auch ohne Leistungspreis — er ändert Dispatch und Eigenverbrauch. */
          'Für eine gemessene Grundlage: echten Lastgang hochladen (Viertelstundenwerte Ihres ' +
          'Netzbetreibers).',
    ],
  }
}

/**
 * Die PV-Erzeugung ist GESCHÄTZT und nicht gemessen (B22b, Pflichtenheft §2.2 Punkt 1).
 *
 * ── ⚠ SEINE DATEN STEHEN NIRGENDS IM CONTRACT, UND DAS IST DER GRUND FÜR DAS EIGENE FELD ───────
 * Die Engine bekommt einen fertigen Lastgang, dem die geschätzte Erzeugung bereits abgezogen ist
 * (`applyEstimatedPv`, B22a) — WOMIT geschätzt wurde, erfährt sie nie. Standort, Nennleistung,
 * Wetterjahre und die für DIESE Anlage gemessene Streuung stehen ausschliesslich in
 * `EstimatedPvSummary`.
 *
 * ── ⚠ ER NENNT ZWEI UNSICHERHEITEN, NICHT EINE ────────────────────────────────────────────────
 * Die Jahresstreuung (± x %) aus der ECHTEN PVGIS-Antwort dieser Anlage — `spread === null` heisst
 * „keine Angabe" und nicht „Streuung 0" —, und den systematischen Aufschlag der Glättung über die
 * IMPORTIERTE Konstante. Ohne ihn läse sich das „±" wie eine symmetrische Unsicherheit.
 */
export function buildEstimatedPvNotice(
  summary: EstimatedPvSummary | undefined,
): ReportNotice | null {
  if (!summary) return null

  const spread = summary.spread
  const arrays = summary.arrayCount > 1 ? `, aufgeteilt auf ${summary.arrayCount} Modulflächen` : ''

  return {
    id: 'estimated_pv',
    tone: 'neutral',
    title: 'PV-Erzeugung geschätzt — nicht gemessen',
    body:
      'Die Eigenverbrauchs-Ersparnis in diesem Report beruht auf einer geschätzten ' +
      'Erzeugungskurve. Sie stammt nicht aus Ihrer Anlage, sondern aus dem Mittel der Wetterjahre ' +
      `${summary.weatherYears.from}–${summary.weatherYears.to} des EU-Dienstes PVGIS für ` +
      `${formatKwp(summary.totalPeakPowerKwp)} am Standort ${summary.postalCode} ` +
      `${summary.locationName}${arrays} — und wurde von Ihrem Verbrauch abgezogen.`,
    list: null,
    hints: [
      'Wie genau das ist: ' +
        (spread
          ? `Die zehn Wetterjahre liegen zwischen ${formatKwh(spread.minKwh)} und ` +
            `${formatKwh(spread.maxKwh)} im Jahr, im Mittel ${formatKwh(spread.meanKwh)} — also ` +
            `± ${formatPercent(spread.spreadPercent)} allein durch das Wetter.`
          : 'Die Streuung zwischen den Wetterjahren liegt in der Grössenordnung einiger Prozent.') +
        ' Dazu kommt ein systematischer Aufschlag: ein Mehrjahres-Mittel ist glatter als jedes ' +
        'einzelne Jahr, und eine glattere Erzeugung wird seltener eingespeist. Gemessen fällt die ' +
        'Eigenverbrauchs-Ersparnis dadurch rund ' +
        `${formatPercent(PV_TEN_YEAR_SMOOTHING_OPTIMISM_PERCENT)} höher aus als beim Mittel der ` +
        'einzeln gerechneten Jahre — die Schätzung ist also eher etwas zu optimistisch als zu ' +
        'vorsichtig.',
      'Weil damit auch jede Lastspitze zur Hälfte geschätzt ist, weist der Report keine ' +
        'Leistungspreis-Ersparnis aus. Für eine gemessene Aussage: Lastgang mit Einspeisung beim ' +
        'Netzbetreiber anfordern (Viertelstundenwerte, Bezug und Einspeisung).',
    ],
  }
}

/**
 * Die vier Hinweise in der Reihenfolge des Bildschirms.
 *
 * ⚠ Die Reihenfolge ist übernommen und nicht neu gewählt: zuerst die Herkunft der Daten (woraus der
 * Verbrauch stammt, dann woraus die Erzeugung stammt), danach die zwei Mängel am Umfang.
 */
function buildNotices(input: SummaryInput): ReportNotice[] {
  return [
    buildStandardProfileNotice(input.loadProfile, input.analysis.current),
    buildEstimatedPvNotice(input.estimatedPv),
    buildPartialYearNotice(input.analysis),
    buildLargeGapNotice(input.analysis),
  ].filter((n): n is ReportNotice => n !== null)
}

/**
 * Die ganze Seite.
 *
 * ⚠ `context` ist optional: fehlt er (Tests, der Prüfstand), bildet diese Funktion die
 * Zwischenwerte wie bisher selbst. Das Ergebnis ist dasselbe, es entsteht nur an einem anderen Ort.
 */
export function buildReportSummary(
  input: SummaryInput,
  context?: ReportBuildContext,
): ReportSummary {
  const analysis = input.analysis
  const ways = summaryWaysOf(analysis)
  const unknownWays = unknownTariffWaysOf(analysis)
  /* ⚠ `context ? … : …` statt `??` — `primaryEntry` ist selbst gültig `undefined`. */
  const entry = context ? context.primaryEntry : primaryEntryOf(analysis)

  return {
    kpis: ways
      ? buildSummaryKpis(analysis, ways)
      : unknownWays
        ? buildUnknownTariffKpis(analysis, unknownWays)
        : [],
    notices: buildNotices(input),
    overview: buildOverview(analysis, input),
    /* ⚠ `context ? … : …` wie bei `entry` darüber — der Prüfstand fährt ohne Kontext. */
    pvPointer: buildPvPointer(
      input.hasPv,
      input.pvStage,
      context ? context.hasPvValue : hasPvValueChapter(analysis),
    ),
    /*
     * Ohne einen einzigen durchgerechneten Kandidaten gibt es auch die Zusatzspeicher-Frage nicht.
     * Der Fall entsteht mit dem heutigen Katalog nicht (er ist nie leer); die Seite behandelt ihn
     * trotzdem, weil eine Zusammenfassung, die bei leerem Katalog wirft, den ganzen Report kostet.
     */
    statements: entry ? [buildAddon(analysis)].filter((s): s is SummaryStatement => s !== null) : [],
  }
}
