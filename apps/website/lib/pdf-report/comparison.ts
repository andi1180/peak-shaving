import { displayedPriceBasis, VAT_INCLUSIVE_LABEL, type DisplayPriceBasis } from 'shared'
import type { BatteryResultEntry, BatteryRoiEntry, BatteryRoiSummary } from 'shared'

import { formatEur, formatKw, formatKwh1, formatYears } from '@/lib/format'
import {
  ANNUALIZED_LABEL,
  dynamicTariffHintKind,
  hasEnteredSubsidy,
  investmentAfterSubsidy,
  isAnnualized,
  SUBSIDY_NOTE,
  SUBSIDY_PROGRAMS_NOTE,
  TAX_EFFECT_NOTE,
} from '@/lib/report-copy'
import type { ReportBuildContext } from './context'
import type { AnnualScenarioPvInput } from './annual-scenario'
import { annualCatalogEntriesOf, headlineStorageOf } from './headline-storage'
import type { ReportFigure, ReportRow, ReportStatement, ReportTable } from './statement'
import { accent, block, column, ref, t, REF_LABEL, REF_PLACE } from './report-text'
import { hasLeistungspreis, recommendedEntryOf } from './summary'
import type { PdfReportAnalysis } from './types'

/**
 * B23c-3b-2 — das Kapitel „Speichergrösse und Gerätewahl": die Grenznutzen-Kurve und eine
 * kompakte Vergleichstabelle der übrigen Kandidaten.
 *
 * ── ⚠ DIESE DATEI DARF WEDER `@react-pdf/renderer` NOCH RECHARTS ANFASSEN ──────────────────────
 * Sie ist die Ableitung, nicht die Darstellung — derselbe Zuschnitt wie `summary.ts`,
 * `recommendation.ts`, `detail.ts`, `insight.ts` und `derive.ts`. Gerendert wird in
 * `document.tsx`, gerastert in `charts.tsx`; beide lesen die ENTSCHEIDUNG, was entsteht, aus
 * `comparisonChartPlan`.
 *
 * ── ⚠ ZWEI FÄLLE, DIE EINANDER AUSSCHLIESSEN — WORTGLEICH ZUM BILDSCHIRM ──────────────────────
 * `report.tsx` verzweigt am Ende an `isExisting`: im Bestandsfall die Zusatzspeicher-Sektion
 * (Grenznutzen `variant="addon"` + Karten ODER Klarsatz), sonst die Katalog-Kurve
 * (`variant="catalog"`) samt Alternativen-Aufklappliste. Beides beantwortet dieselbe Frage in zwei
 * Rahmungen — „welche GRÖSSE lohnt sich, und welches Gerät dieser Grösse" —, und deshalb ist es
 * hier EIN Kapitel mit zwei Inhalten und nicht zwei Kapitel, von denen eines immer leer bliebe.
 *
 * ── ⚠ DIE KURVE ERSCHEINT AUCH, WENN ALLE PUNKTE UNTER NULL LIEGEN ────────────────────────────
 * Sie hängt ausdrücklich NICHT am `netSavingOverHorizon > 0`-Filter der Tabelle darunter —
 * wortgleich zur Begründung in `report.tsx` und `marginal-benefit-chart.tsx`: rechnet sich keines
 * der Geräte, ist die Kurve die BEGRÜNDUNG des Klarsatzes. Sie zeigt, dass die Linie über alle
 * Grössen unter der Nulllinie bleibt und nicht bloss knapp danebenliegt. Ein Klarsatz ohne Bild
 * wäre eine Behauptung, die der Leser nicht nachprüfen kann.
 *
 * ── ⚠ WAS DIESES KAPITEL BEWUSST NICHT WIEDERHOLT ─────────────────────────────────────────────
 * Die Kernergebnis-Seite trägt im Bestandsfall bereits die Zusatzspeicher-Aussage (`summary.ts`,
 * `buildAddon`): entweder den bestgereihten Kandidaten mit Kopfzahl oder den Klarsatz in
 * gekürzter Form. Neu ist hier der VERGLEICH — die Kurve über alle Grössen und die Tabelle über
 * alle Kandidaten. Deshalb trägt die Aussage dieses Kapitels ausdrücklich KEINE Kopfzahl: sie wäre
 * im positiven Fall bit-identisch mit der dort (dasselbe Feld, dieselbe Formatierung), und zwei
 * gleich grosse Beträge unter zwei ähnlichen Überschriften laden dazu ein, sie zu addieren
 * (dieselbe Regel wie bei der Ladesteuerungs-Aussage in B23c-2).
 *
 * ⚠ Der KLARSATZ dagegen steht wortgleich zum Bildschirm — samt beider Absätze, die die
 * Kernergebnis-Seite kürzt. Er ist eine FESTSTELLUNG und keine Zahl: sie zweimal verschieden zu
 * formulieren liesse sie wie zwei verschiedene Befunde aussehen, und die zwei zusätzlichen Sätze
 * („Ihr Speicher deckt bereits ab …", „Wächst Ihr Verbrauch …") sind genau die Einordnung, ohne
 * die ein Kunde die Aussage für endgültig hält.
 */

/**
 * Ein Kandidat, wie ihn beide Seiten liefern.
 *
 * ⚠ Das ist GENAU der Durchschnitt von `BatteryRoiEntry` (Katalog) und `AddonBatteryScenario`
 * (Zusatzgerät) — beide sind `BatteryResultEntry & BatteryRoiSummary`, der Zusatzfall trägt nur
 * `combined` obendrauf. Dass eine Funktion beide bedient, ist damit keine Verallgemeinerung, die
 * hier erfunden wird, sondern eine Eigenschaft des Contracts.
 */
export type ComparisonCandidate = BatteryResultEntry & BatteryRoiSummary

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Der Plan: was gerastert wird
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

export type ComparisonVariant = 'catalog' | 'addon'

/** Die Props der Grenznutzen-Kurve — wortgleich zur Auswahl in `report.tsx`. */
export type ComparisonChartPlan = {
  variant: ComparisonVariant
  points: ComparisonCandidate[]
  horizonYears: number
  /** Das hervorgehobene Gerät („Bestes Gerät"): im Katalog die Empfehlung, sonst das bestgereihte. */
  highlight: ComparisonCandidate
}

/**
 * Welche Kandidaten das Kapitel überhaupt betrachtet.
 *
 * Bestandsfall: die Zusatzszenarien (Differenzen gegen die bestehende Anlage). Sonst: der volle
 * Katalog-Lauf. Beide sind bereits nach `netSavingOverHorizon` sortiert (§3.8) — hier wird nichts
 * umsortiert, sonst stünde im Report eine andere Rangfolge als am Bildschirm.
 */
function candidatesOf(analysis: PdfReportAnalysis): {
  variant: ComparisonVariant
  candidates: ComparisonCandidate[]
} {
  const existing = analysis.existingBatteryAnalysis
  return existing
    ? { variant: 'addon', candidates: existing.addonScenarios }
    : { variant: 'catalog', candidates: catalogCandidatesOf(analysis) }
}

/** Die Katalog-Geräte auf der Basis der Empfehlung: Jahresbasis, wenn das Jahreskapitel steht, sonst linear. */
function catalogCandidatesOf(analysis: PdfReportAnalysis): ComparisonCandidate[] {
  return annualCatalogEntriesOf(analysis) ?? analysis.perBattery
}

/**
 * ⚠ WORTGLEICH ZUR VORBEDINGUNG VON `MarginalBenefitChart` — und das ist keine zweite Fachregel.
 *
 * Die Komponente wirft nicht-endliche Werte aus der Achse (ein `Infinity` zöge sie ins Unendliche
 * und machte alle übrigen Punkte unlesbar) und rendert bei weniger als zwei verbleibenden Punkten
 * GAR NICHTS — ein einzelner Punkt zeigt keinen Grenznutzen, der braucht einen Vergleich. Gäbe es
 * dann trotzdem einen Rasterauftrag, liefe `captureChart` acht Sekunden in eine Zeitüberschreitung
 * und setzte eine technische Meldung an die Stelle einer Aussage. Dieselbe Überlegung wie bei
 * `hasRepresentativeDay` (`detail.ts`) und der Heatmap-Vorbedingung (`insight.ts`).
 */
function drawablePoints(candidates: ComparisonCandidate[]): ComparisonCandidate[] {
  return candidates.filter(
    (c) => Number.isFinite(c.netSavingOverHorizon) && Number.isFinite(c.battery.usableCapacityKwh),
  )
}

export function comparisonChartPlan(analysis: PdfReportAnalysis): ComparisonChartPlan | null {
  if (dynamicTariffHintKind(analysis)) return null
  const { variant, candidates } = candidatesOf(analysis)
  const points = drawablePoints(candidates)
  if (points.length < 2) return null
  const highlight =
    (variant === 'catalog'
      ? points.find((c) => c.battery.id === analysis.recommendation?.batteryId)
      : undefined) ?? points[0]!
  return { variant, points, horizonYears: analysis.assumptions.horizonYears, highlight }
}

/**
 * Gibt es das Kapitel überhaupt? — die Bedingung, an der auch der Agenda-Eintrag hängt.
 *
 * ── ⚠ ES IST NICHT DIESELBE BEDINGUNG WIE DIE DER KURVE ───────────────────────────────────────
 * Das Kapitel steht auch dann, wenn die Kurve nicht zustande kommt (ein einziger Kandidat), solange
 * es etwas ZU SAGEN gibt: im Bestandsfall die Zusatzspeicher-Antwort, sonst wenigstens eine
 * Alternative zur Empfehlung. Umgekehrt entfällt es, wenn beides fehlt — dann wäre es ein
 * Agenda-Eintrag auf eine Seite, die nur sagt, dass sie leer ist (D14/D15).
 *
 * ⚠ Mit dem heutigen Katalog (fünf Geräte) tritt der Fall NICHT ein; er ist trotzdem behandelt,
 * weil ein Kapitel, das bei leerem Katalog eine leere Seite erzeugt, dem Leser eine Seitenzahl
 * verspricht, hinter der nichts steht.
 */
export function hasComparisonChapter(analysis: PdfReportAnalysis): boolean {
  // Hinweis „nur mit dynamischem Tarif": eine Gerätewahl, in der jedes Gerät € 0 spart, sagt nichts.
  if (dynamicTariffHintKind(analysis)) return false
  const { variant, candidates } = candidatesOf(analysis)
  if (variant === 'addon') return candidates.length > 0
  return alternativesOf(analysis).length > 0
}

/**
 * Höchstens so viele Zeilen trägt die Kandidatentabelle (§3.8/§6.2 „2–3 Alternativen", wie
 * `report.tsx`). Die übrigen Geräte stehen als Punkte in der Kurve; eine volle Katalogliste
 * (34 Geräte, STCE 25.09.2026) sprengte als `wrap={false}`-Block die Seite und überlagerte Bild und Text.
 */
export const MAX_TABLE_ROWS = 3

/** Die nächsten Katalog-Alternativen nach der empfohlenen, in der Reihung des Contracts. */
function alternativesOf(analysis: PdfReportAnalysis): ComparisonCandidate[] {
  return catalogCandidatesOf(analysis)
    .filter((p) => p.battery.id !== analysis.recommendation?.batteryId)
    .slice(0, MAX_TABLE_ROWS)
}

/** Rechnet sich ein Gerät im Betrachtungszeitraum? Dieselbe Schwelle wie Tabelle und Engine-Reihung. */
function paysOff(c: Pick<ComparisonCandidate, 'netSavingOverHorizon'>): boolean {
  return c.netSavingOverHorizon > 0
}

/**
 * Rechnet sich KEIN Katalog-Gerät? Dann heisst die Empfehlung „Bestes Gerät im Katalog" und die
 * Gerätewahl antwortet „Derzeit nicht". `false` im Bestandsfall und ohne Kandidaten.
 */
export function noCatalogDevicePaysOff(analysis: PdfReportAnalysis): boolean {
  return !analysis.existingBatteryAnalysis && noneEconomical(catalogCandidatesOf(analysis))
}

function noneEconomical(candidates: ComparisonCandidate[]): boolean {
  return candidates.length > 0 && !candidates.some(paysOff)
}

/**
 * Zeigt das Gerätekapitel „Derzeit nicht"? Die EINE Bedingung für jede Stelle, die davon abhängt
 * (Vorschlag, Kaufaussagen) — sonst widerspricht ein Kapitel dem anderen (STCE 26.09.2026).
 */
export function catalogVerdictIsNo(analysis: PdfReportAnalysis): boolean {
  return noCatalogDevicePaysOff(analysis) && hasComparisonChapter(analysis)
}

const NO_PAYOFF_REASON =
  'Ohne Leistungspreis und ohne PV-Anlage kommt die gesamte Ersparnis aus der Preisdifferenz am ' +
  'Spotmarkt; bei Ihrem Verbrauch reicht das nicht aus, um die Investition zu decken.'

/**
 * Der strukturelle Grund, warum sich kein Katalog-Gerät rechnet — nur, wo er eindeutig ist: kein
 * Leistungspreis, ausdrücklich keine PV, Energie-Anteil voll aus den Preisdaten bewertet. Jede
 * andere Lage hat mehrere Hebel, und ein Satz dazu wäre geraten — dann `null`.
 */
export function noPayoffReasonOf(
  analysis: PdfReportAnalysis,
  hasPv: boolean | undefined,
): string | null {
  if (!noCatalogDevicePaysOff(analysis) || hasPv !== false) return null
  if (hasLeistungspreis(analysis.current)) return null
  if (!analysis.perBattery.every((c) => c.energySavingBasis === 'full_price')) return null
  return NO_PAYOFF_REASON
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Die Tabelle: EINE Funktion, ZWEI Konsumenten
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Report-Baukasten B2 — die stabile Kennung dieser Tabelle.
 *
 * ⚠ SIE STEHT NEBEN DEM ERZEUGER UND NICHT IM RÜCKGABEWERT: `ReportTable` ist eine reine
 * DARSTELLUNGS-Form (`statement.ts`) und trägt bewusst kein `id`-Feld — eines zu ergänzen hiesse,
 * jeden bestehenden Tabellen-Vergleich um ein Feld zu erweitern, das der Renderer nie liest. Die
 * Kennung ist eine Eigenschaft des BAUSTEINS (wofür die Registry ihn adressiert), nicht des Werts.
 */
export const CANDIDATE_TABLE_ID = 'table_candidates'

/**
 * Die kompakte Kandidatentabelle.
 *
 * ── ⚠ EINE FUNKTION FÜR BEIDE FÄLLE, UND DIE SPALTEN SIND IDENTISCH ───────────────────────────
 * Zusatzgeräte und Katalog-Alternativen tragen dieselben sechs Grössen; was sich unterscheidet,
 * ist ihre BEDEUTUNG (im Zusatzfall sind alle Ersparnis-Zahlen Differenzen gegen die bestehende
 * Anlage). Das gehört in den Fliesstext daneben und nicht in eine Spaltenüberschrift: „Zusätzliche
 * Ersparnis pro Jahr" passt in keine Spalte von 60 pt, und zwei Spaltensätze wären zwei Tabellen,
 * die beim nächsten Nachtrag auseinanderlaufen.
 *
 * ⚠ KAPAZITÄT UND LEISTUNG STEHEN IN EINER ZELLE. Sie sind zusammen die „Grösse" eines Geräts und
 * werden auch am Bildschirm gemeinsam genannt (`Speicher (30,0 kW / 60,0 kWh)`); zwei Spalten
 * kosteten die Breite, die der Gerätename braucht. Die Reihenfolge ist kWh zuerst — die X-Achse
 * der Kurve darüber ist die Kapazität, und wer von dort in die Tabelle sieht, sucht sie zuerst.
 *
 * ⚠ Die Reihenfolge der Zeilen ist die des Contracts (`netSavingOverHorizon` absteigend, §3.8) und
 * wird hier NICHT neu sortiert: eine zweite Rangfolge im selben Dokument wäre eine zweite Aussage
 * darüber, welches Gerät das beste ist.
 *
 * ⚠ Die Spaltengewichte sind an den Inter-Breiten bei 8,5 pt ausgemessen: das längste untrennbare
 * Wort je Spalte („ST510kWh-125kW-4h", „Ersparnis/Jahr", „Amortisation") muss hineinpassen — es gibt
 * keine Silbentrennung (`fonts.ts`), ein zu langes Wort liefe in die Nachbarspalte.
 */
/** Die Markierung je Gerät; Datenquelle ist der Engine-Hinweis `power_limited` (`isPowerLimited`, `rank.ts`). */
export const POWER_LIMITED_MARK = 'Leistung begrenzt'

/** Was die Markierung heisst — im Absatz über der Tabelle (Jahresfall). */
export const POWER_LIMITED_NOTE =
  `Eine Markierung „${POWER_LIMITED_MARK}" heisst: Das Gerät hält die Schwelle, die für es berechnet ist, könnte mit mehr Leistung aber tiefer kappen.`

function isPowerLimitedCandidate(c: ComparisonCandidate): boolean {
  return 'notices' in c && (c as BatteryRoiEntry).notices.some((n) => n.code === 'power_limited')
}

export function buildCandidateTable(
  candidates: ComparisonCandidate[],
  horizonYears: number,
  /* Katalog-Fall: das empfohlene Gerät, gegen das die Abstandsspalte rechnet. */
  reference: ComparisonCandidate | null = null,
  markPowerLimited = false,
): ReportTable {
  const distance = reference
    ? [
        {
          key: 'distance',
          label: reference.netSavingOverHorizon > 0 ? 'Abstand zur Empfehlung' : 'Abstand zum besten Gerät',
          width: 2.1,
          align: 'right' as const,
        },
      ]
    : []
  const subsidy = candidates.some(hasEnteredSubsidy)
  const afterSubsidy = subsidy
    ? [{ key: 'after_subsidy', label: 'Nach Förderung', width: 1.6, align: 'right' as const }]
    : []
  return {
    columns: [
      { label: 'Gerät', width: 3.2 },
      { label: 'Grösse', width: 2 },
      { label: 'Investition', width: 1.6, align: 'right' },
      ...afterSubsidy,
      { key: 'saving_per_year', label: 'Ersparnis/Jahr', width: 2.1, align: 'right' },
      { label: 'Amortisation', width: 1.85, align: 'right' },
      {
        key: 'net_over_horizon',
        label: `Netto über ${horizonYears} Jahre`,
        width: 1.6,
        align: 'right',
      },
      ...distance,
    ],
    rows: candidates.map((c) => ({
      key: c.battery.id,
      ...(markPowerLimited && isPowerLimitedCandidate(c) ? { note: POWER_LIMITED_MARK } : {}),
      cells: [
        c.battery.name,
        `${formatKwh1(c.battery.usableCapacityKwh)} / ${formatKw(c.battery.maxPowerKw)}`,
        formatEur(c.totalInvestment),
        ...(subsidy ? [formatEur(investmentAfterSubsidy(c))] : []),
        formatEur(c.totalSavingPerYear),
        /* `formatYears(Infinity)` liefert „∞ Jahre" — eine Antwort, keine Lücke (s. `roi.ts`). */
        formatYears(c.amortizationYears),
        formatEur(c.netSavingOverHorizon),
        ...(reference ? [distanceText(reference, c, horizonYears)] : []),
      ],
    })),
  }
}

function distanceText(reference: ComparisonCandidate, c: ComparisonCandidate, horizonYears: number): string {
  const gap = reference.netSavingOverHorizon - c.netSavingOverHorizon
  return Number.isFinite(gap) ? `${formatEur(gap)} weniger über ${horizonYears} Jahre` : '–'
}

/** Die Zeile über der Tabelle — gezählt über ALLE betrachteten Geräte, nicht über die gezeigten. */
export function countLineOf(considered: ComparisonCandidate[]): string {
  const n = considered.length
  return (
    `${n} ${n === 1 ? 'Gerät' : 'Geräte'} geprüft, davon ${considered.filter(paysOff).length} im ` +
    'Betrachtungszeitraum wirtschaftlich.'
  )
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Das Kapitel: was neben der Kurve steht
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

export type ComparisonChapter = {
  /** Was unter der Grenznutzen-Kurve steht. `null` = sie entsteht in diesem Fall nicht. */
  figure: ReportFigure | null
  /** Warum sie nicht entsteht. Gesetzt GENAU DANN, wenn `figure === null`. */
  figureMissing: string | null
  /** Die Aussage darunter: entweder die Einleitung der Tabelle oder der Klarsatz. Steht immer. */
  statement: ReportStatement
  /** Die Vergleichstabelle. `null` GENAU DANN, wenn `statement` der Klarsatz ist. */
  table: ReportTable | null
  /**
   * Die Zeile unter der Tabelle für ein Ergebnis vor Fassung 17: Empfehlung auf Jahresbasis, Tabelle
   * linear. Mit Jahresreihung (`annualScenario.devices`) stehen beide auf derselben Basis — keine Zeile.
   */
  tableFootnote: string | null
  /** „N Geräte geprüft, davon M …" über der Tabelle — `null` beim Klarsatz (er nennt die Zahl selbst). */
  countLine: string | null
}

function neutralRow(label: string, value: string): ReportRow {
  return { label, value, tone: 'neutral' }
}

/**
 * Die Bildunterschrift der Punktwolke.
 *
 * ⚠ Sie beschreibt das BILD, nicht die Karte: gerastert wird der Recharts-Zeichenbereich, die
 * beiden erklärenden Absätze der Komponente (Achsenwahl und „keine stetige Kurve") liegen
 * ausserhalb und stehen im PDF hier. Ohne sie stünden fünf Punkte ohne Verbindung da, deren
 * Y-Achse man für die Jahresersparnis halten könnte — und das ist genau die Verwechslung, gegen
 * die die Komponente ihre Achse gewählt hat.
 */
function buildFigure(plan: ComparisonChartPlan, basis: DisplayPriceBasis): ReportFigure {
  const which = plan.variant === 'addon' ? ' des Zusatzgeräts' : ''
  return {
    caption:
      `Je Katalog-Gerät ein Punkt: waagrecht seine nutzbare Kapazität, senkrecht das, was über ` +
      `${plan.horizonYears} Jahre netto übrig bleibt — Ersparnis abzüglich der Anschaffung` +
      `${which}. Über der waagrechten Nulllinie rechnet sich ein Gerät im Betrachtungszeitraum, ` +
      `darunter nicht.${highlightCaption(plan)} Alle Beträge ` +
      `${basis === 'gross' ? VAT_INCLUSIVE_LABEL : 'netto (ohne USt.)'}.`,
    note:
      `Es sind ${plan.points.length} Geräte unseres Katalogs, keine stetige Kurve: mit ` +
      'der Kapazität ändert sich auch die Leistung, und ein Gerät, das zwischen zwei Punkten läge, ' +
      'gibt es im Katalog nicht — seinen Preis kennen wir also auch nicht. Gemessen ist die ' +
      'Netto-Ersparnis über den Zeitraum und ausdrücklich nicht die Jahresersparnis: die steigt mit ' +
      'der Kapazität fast immer, und die Frage ist nicht „bringt mehr Speicher mehr", sondern „ab ' +
      'wann zahlt er sich nicht mehr ein".',
  }
}

/** Der Satz zum hervorgehobenen Punkt — der Bezugspunkt, an dem der Leser die übrigen misst. */
function highlightCaption(plan: ComparisonChartPlan): string {
  const h = plan.highlight
  return (
    ` Die dunkle Raute „Bestes Gerät" ist ${h.battery.name} ` +
    `(${formatKwh1(h.battery.usableCapacityKwh)}, ${formatEur(h.netSavingOverHorizon)} über ` +
    `${plan.horizonYears} Jahre).`
  )
}

/** Warum keine Punktwolke da ist — erreichbar nur bei einem einzigen Kandidaten. */
const FIGURE_MISSING =
  'Für diesen Report ist keine Grenznutzen-Grafik abgebildet: es liegt nur ein einziges ' +
  'durchgerechnetes Gerät vor, und ein einzelner Punkt zeigt keinen Grenznutzen. Die Zahlen ' +
  'dieses Reports sind davon nicht betroffen — sie stammen aus der Berechnung, nicht aus der ' +
  'Abbildung.'

/**
 * Der bestgereihte Kandidat, sofern sein Fehlbetrag eine nennbare Zahl ist — B3-2a.
 *
 * ⚠ DIESELBE VORBEDINGUNG WIE `drawablePoints`, AN DERSELBEN DATENLAGE: `considered` ist
 * ungefiltert, und ein nicht-endlicher `netSavingOverHorizon` ergäbe „€ ∞ im Minus". Gesucht ist
 * deshalb das erste ENDLICHE Element — die Reihung ist absteigend (§3.8), das erste endliche ist
 * damit das beste, ohne hier neu zu sortieren.
 *
 * ⚠ Und er muss echt unter null liegen: „bliebe € 0 im Minus" wäre ein Satz, der nichts belegt.
 * Genau 0 ist in diesem Zweig möglich (die Schwelle der Tabelle ist `> 0`) und dann entfällt der
 * Satz, statt eine Null als Fehlbetrag auszuweisen.
 */
function shortfallOf(considered: ComparisonCandidate[]): number | null {
  const best = considered.find((c) => Number.isFinite(c.netSavingOverHorizon))
  return best !== undefined && best.netSavingOverHorizon < 0 ? -best.netSavingOverHorizon : null
}

/**
 * Was der Klarsatz über seine eigene Reichweite sagt — wortgleich zum Bildschirm.
 *
 * ⚠ Steht neben der Funktion und nicht in ihrem Template: der Satzkörper besteht aus einem
 * gerechneten Teil (Anzahl, Fehlbetrag) und einem festen; ineinandergeschoben wäre beim nächsten
 * Nachtrag nicht mehr zu sehen, welcher Teil aus dem Ergebnis stammt.
 */
function tragweite(horizonYears: number): string {
  return (
    ' Eine zusätzliche Ersparnis kann dabei durchaus herauskommen — über den Betrachtungszeitraum ' +
    'gerechnet bleibt sie nur unter dem, was das Gerät kostet. Ihr Speicher deckt bei diesem ' +
    'Verbrauch bereits ab, was sich wirtschaftlich holen lässt; mehr Kapazität stünde einen ' +
    'grossen Teil der Zeit ungenutzt da. Das ist eine Aussage über diesen Lastgang, diese ' +
    `Tarifangaben und einen Betrachtungszeitraum von ${horizonYears} Jahren. Wächst Ihr ` +
    'Verbrauch, ändert sich Ihr Tarif, kommt PV dazu oder rechnen Sie über einen längeren ' +
    'Zeitraum, kann die Antwort eine andere sein.'
  )
}

/**
 * Der Klarsatz: kein Zusatzgerät rechnet sich.
 *
 * ── ⚠ ER IST SEIT B3-2a EIN VERDIKT UND KEINE FESTSTELLUNG ────────────────────────────────────
 * Überschrift und Kopfzahl sind die des Zielbildes (S. 10, gemessen): die Frage „Lohnt sich ein
 * zusätzlicher Speicher?" und darunter das Wort „Nein" im Kostenton. Eine Feststellung als
 * Überschrift („… lohnt sich derzeit nicht") beantwortet eine Frage, die der Leser an dieser
 * Stelle noch gar nicht gestellt bekommen hat; die Frage-Antwort-Form stellt sie zuerst.
 *
 * ⚠ ZWEI ZAHLEN BELEGEN DAS VERDIKT, UND BEIDE STEHEN IM FLIESSTEXT: wie viele Geräte geprüft
 * wurden, und um wie viel das beste davon danebenliegt. Eine Tabelle der gescheiterten Kandidaten
 * steht hier ausdrücklich NICHT — gereiht nach Netto-Ersparnis lüde sie dazu ein, sich das „am
 * wenigsten schlechte" auszusuchen, auf einem Blatt, dessen Kernaussage lautet, dass keines davon
 * sich rechnet. Die Kurve darunter führt die Kandidaten bereits als Punkte.
 *
 * ⚠ WORTGLEICH ZUM BILDSCHIRM (`report.tsx`, `zusatzspeicher-lohnt-nicht`) bleiben die vier
 * einordnenden Sätze. Die Kernergebnis-Seite trägt eine gekürzte Fassung derselben Feststellung;
 * hier steht sie vollständig, weil hier die Kurve daneben liegt, die sie belegt. Zwei verschieden
 * formulierte Fassungen desselben Befunds im selben Dokument sähen wie zwei Befunde aus.
 */
export function buildVerdict(
  considered: ComparisonCandidate[],
  horizonYears: number,
): ReportStatement {
  return withSubsidyNote(verdictOf(considered, horizonYears), considered, false)
}

function verdictOf(considered: ComparisonCandidate[], horizonYears: number): ReportStatement {
  const shortfall = shortfallOf(considered)
  /* Ein Gerät braucht die Einzahl — „Keines der 1 geprüften Geräte" wäre ein Satzfehler im
     Kundendokument, und der Fall entsteht real (ein einziges Zusatzszenario unter der Schwelle). */
  const opening =
    considered.length === 1
      ? 'Das eine geprüfte Batteriegerät würde sich neben Ihrer bestehenden Anlage innerhalb von '
      : `Keines der ${considered.length} geprüften Batteriegeräte würde sich neben Ihrer ` +
        'bestehenden Anlage innerhalb von '

  /* Der Betrag ist AUSGEZEICHNET und nicht bloss genannt: er ist die eine Zahl dieser Seite, und
     das Zielbild setzt genau diese Wortgruppe in die Farbe des Verdikts. */
  const beleg =
    shortfall === null
      ? ''
      : t` Das am besten abschneidende Gerät bliebe über ${String(
          horizonYears,
        )} Jahre gerechnet ${accent(`${formatEur(shortfall)} im Minus`)}.`

  return {
    id: 'addon_none',
    title: 'Lohnt sich ein zusätzlicher Speicher?',
    /*
     * ⚠ DIE „ZAHL" IST HIER EIN WORT, und das ist der Grund für `ReportAmountTone` (`statement.ts`):
     * die Antwort auf die Überschrift, im Kostenton und im Grad der Kopfzahlen. Eine erfundene 0
     * stünde an dieser Stelle für etwas anderes als der Satz darunter.
     *
     * ⚠ OHNE BEZUGSGRÖSSE: das Zielbild setzt neben „Nein" nichts. Der Beleg ist der Fliesstext,
     * und dort steht er als Satz und nicht als Beschriftung eines Worts.
     */
    amount: { value: 'Nein', caption: '', tone: 'negative' },
    rows: [],
    body: t`${opening}${String(horizonYears)} Jahren finanziell rechnen.${beleg}${tragweite(
      horizonYears,
    )}`,
  }
}

/**
 * Die Einleitung über der Tabelle.
 *
 * ⚠ Wie viele Geräte geprüft wurden und wie viele sich rechnen, steht als Zeile direkt über der
 * Tabelle (`countLineOf`). Im Zusatzfall bleibt die Einordnung, dass alle Ersparnis-Zahlen
 * Differenzen sind — ohne sie liest sich „Ersparnis/Jahr" als Bruttozahl des gemeinsamen Speichers.
 *
 * Rechnet sich im Katalog-Fall KEIN Gerät, trägt die Aussage das Urteil in der Form des
 * Bestandsfalls: Frage als Überschrift, „Derzeit nicht" im Kostenton.
 */
export function buildTableStatement(
  variant: ComparisonVariant,
  considered: ComparisonCandidate[],
  /* `noPayoffReasonOf` — steht vor der Einleitung, nur im Fall „Derzeit nicht". */
  noPayoffReason: string | null = null,
  /* Die Geräte der Tabelle — für den Satz zur Amortisation nach Steuern. */
  shown: ComparisonCandidate[] = [],
  /* `ComparisonSelection.markPowerLimited` — dann erklärt der Absatz die Markierung. */
  markPowerLimited = false,
): ReportStatement {
  return withTaxNote(
    withSubsidyNote(tableStatementOf(variant, considered, noPayoffReason, markPowerLimited), considered, true),
    shown,
  )
}

function tableStatementOf(
  variant: ComparisonVariant,
  considered: ComparisonCandidate[],
  noPayoffReason: string | null,
  markPowerLimited: boolean,
): ReportStatement {
  const isAddon = variant === 'addon'
  const none = !isAddon && noneEconomical(considered)
  const rows: ReportRow[] = []
  /* §3.7.1 — Ersparnis, Amortisation und Netto der Tabelle ruhen auf dem hochgerechneten Energie-Anteil. */
  const annualized = considered.find((c) => isAnnualized(c))
  if (annualized) {
    rows.push(
      neutralRow('Energie-Anteil der Ersparnis', `${ANNUALIZED_LABEL} aus ${annualized.coveredDays} Tagen`),
    )
  }
  /* Ohne wirtschaftliches Gerät gibt es keine Empfehlung, nur ein bestgereihtes Gerät. */
  const best = none ? 'das beste Gerät' : 'die Empfehlung'
  const bestDevice = none ? 'Das beste Gerät' : 'Das empfohlene Gerät'

  return {
    id: isAddon ? 'addon_table' : 'catalog_alternatives',
    title: isAddon
      ? 'Diese Zusatzgeräte rechnen sich — im Vergleich'
      : none
        ? 'Lohnt sich ein Speicher?'
        : 'Die übrigen Geräte des Katalogs — im Vergleich',
    /* ⚠ KEINE KOPFZAHL: der bestgereihte Betrag steht bereits auf der Kernergebnis-Seite bzw. im
       Empfehlungs-Kapitel; hier stünde er ein zweites Mal und lüde dazu ein, ihn zu addieren.
       Das Urteil ist ein Wort, keine Zahl (wie `buildVerdict`). */
    amount: none ? { value: 'Derzeit nicht', caption: '', tone: 'negative' } : null,
    rows,
    body: isAddon
      ? /*
         * ── ⚠ STUFE D: DER SATZ HÄNGT AN EINER SPALTE DER TABELLE NEBENAN ────────────────────
         * Er war der Grund, aus dem `table_candidates` nicht abwählbar war
         * (`Report_Baukasten_Auswahlschicht_Verifikation.md` §2.2): abgeschaltet beschriebe er
         * Spalten, die es nicht gibt. Der Verweis trägt jetzt beides — die Beschriftung der
         * Spalte und die Fassung ohne Tabelle.
         *
         * ⚠ „Netto" bleibt als Kurzform im Satz stehen: die Spalte heisst „Netto über 10 Jahre",
         * und der volle Kopf mitten im Fliesstext läse sich als zweite Zahl statt als Spaltenname.
         */
        t`Gerechnet ist ${tableRef('je Zeile', 'je Gerät')} EIN gemeinsamer Speicher aus Ihrer bestehenden Anlage und diesem Gerät (Kapazität und Leistung addiert, Wirkungsgrad kapazitätsgewichtet). Ausgewiesen ist davon ausschliesslich, was ÜBER Ihre bestehende Anlage hinaus herauskommt — ${ref(
          column(CANDIDATE_TABLE_ID, 'saving_per_year'),
          `die Spalten „${REF_LABEL}" und „Netto" sind also Differenzen und nicht die Ersparnis des gemeinsamen Speichers`,
          'die ausgewiesenen Beträge sind also Differenzen und nicht die Ersparnis des gemeinsamen Speichers',
        )}. Bezahlt wird allein das neue Gerät; Ihre bestehende Anlage geht in keine dieser Zahlen ein. ${tableRef(
          'Gezeigt sind die Geräte, die ihre Anschaffung im Betrachtungszeitraum wieder einspielen; die übrigen stehen',
          'Alle betrachteten Geräte stehen',
        )} als Punkte in der Kurve darüber.`
      : /*
         * ── ⚠ STUFE D: DER KAPITELNAME WIRD NICHT MEHR AUSGESCHRIEBEN ────────────────────────
         * Der Kapiteltitel war hier einmal ein Literal — die EINZIGE solche Stelle im ganzen
         * Katalog. Eine Umbenennung des Kapitels hätte damit einen Verweis auf ein Kapitel
         * hinterlassen, das es nicht mehr gibt; genau das ist inzwischen eingetreten und hat
         * nichts gekostet („Empfehlung und Lastverlauf" → „Empfehlung und Wirtschaftlichkeit",
         * ohne dass jemand diesen Satz angefasst hätte). Die Ortsangabe kommt
         * jetzt aus der Leseordnung und der Titel aus `REPORT_SECTIONS` (`layout.ts`), also nach
         * demselben Muster, mit dem `RESULTS_FOOTNOTE` seinen Kapitelnamen schon immer gebildet
         * hat: `METHODOLOGY_SECTION.title` statt eines Literals (`content.ts`).
         *
         * ⚠ Zwei Verweise auf dasselbe Ziel: die Ortsangabe und das „dort" danach. Steht die
         * Empfehlung eines Tages in diesem Kapitel, wird aus beiden „oben" bzw. „weiter unten" —
         * ohne dass jemand den Satz anfasst.
         */
        t`${none && noPayoffReason ? `${noPayoffReason} ` : ''}${tableRef(
          'Gereiht ist',
          'Verglichen wird',
        )} nach der Netto-Ersparnis über den Betrachtungszeitraum — derselben Grösse wie die Kurve darüber und wie ${best} ${recommendationRef(REF_PLACE, 'dieses Reports')}. ${tableRef(
          `${bestDevice} steht deshalb hier nicht noch einmal: es ist`,
          `${bestDevice} selbst ist`,
        )} ${recommendationRef('dort', none ? 'beim besten Gerät' : 'beim empfohlenen Gerät')} vollständig aufgeschlüsselt. ${tableRef(
          `Diese Tabelle zeigt die nächsten Alternativen — und um welchen Betrag ${best} besser ist; alle übrigen Geräte stehen als Punkte in der Kurve. `,
          '',
        )}${
          markPowerLimited
            ? t`Die Hinweise zu einem Gerät (Betonsockel, separater Wechselrichter) sind in der Investition enthalten${recommendationRef(none ? '; sie stehen beim besten Gerät' : '; sie stehen beim empfohlenen Gerät', '')}.${tableRef(
                ` ${POWER_LIMITED_NOTE}`,
                '',
              )}`
            : t`Die Hinweise zu einem Gerät (Betonsockel, separater Wechselrichter, zu geringe Leistung für alle Spitzen) sind in der Investition bereits enthalten${tableRef(
                ', werden hier aber nicht je Gerät wiederholt',
                '',
              )}${recommendationRef(none ? ' — sie stehen beim besten Gerät' : ' — sie stehen beim empfohlenen Gerät', '')}.`
        }`,
  }
}

/**
 * Der Verweis auf die Empfehlung.
 *
 * ⚠ Die Ersatzformulierung ist keine Kür: der Klarsatz nennt die Empfehlung als Massstab der
 * Reihung, und ohne sie im Dokument wäre „es ist dort vollständig aufgeschlüsselt" eine Ansage auf
 * eine Stelle, die es nicht gibt. `recommendation` entfällt bei leerem Katalog (`recommendation.ts`).
 */
function recommendationRef(say: string, absent: string) {
  return ref(block('recommendation'), say, absent)
}

/**
 * Der Verweis auf die Kandidatentabelle daneben — B3-1.
 *
 * ⚠ SEIT B3-1 IST SIE ABWÄHLBAR (`REPORT_OPTIONAL_SECTIONS`), und beide Klarsätze reden über sie:
 * „je Zeile", „Gereiht ist", „hier", „Diese Tabelle". Ohne Tabelle zeigt jedes dieser Wörter auf
 * nichts — und anders als bei einem Kapitelverweis sieht man dem Satz das nicht an. Der
 * Spaltenverweis oben (`column(…)`) deckt davon ausdrücklich NUR die Spaltennamen ab.
 */
function tableRef(say: string, absent: string) {
  return ref(block(CANDIDATE_TABLE_ID), say, absent)
}

/**
 * Wer in diesem Kapitel worüber redet — Report-Baukasten B2.
 *
 * ⚠ HERAUSGEZOGEN UND NICHT ZWEITMAL GESCHRIEBEN: `buildComparisonChapter` und die Registry
 * brauchen dieselbe Auswahl, und zwei Fassungen der Schwelle `netSavingOverHorizon > 0` liefen
 * beim nächsten Umbau auseinander — dann stünde in der Registry ein anderer Baustein als im
 * Dokument. Eine Bedingung, ein Ort.
 */
export type ComparisonSelection = {
  variant: ComparisonVariant
  /** ALLE betrachteten Geräte — die Grundlage der zwei Zeilen über der Tabelle. */
  considered: ComparisonCandidate[]
  /** Die Zeilen der Tabelle (höchstens `MAX_TABLE_ROWS`). Leer heisst: statt der Tabelle steht der Klarsatz. */
  shown: ComparisonCandidate[]
  /** Katalog-Fall: das empfohlene Gerät, gegen das die Abstandsspalte rechnet. `null` im Bestandsfall. */
  reference: ComparisonCandidate | null
  horizonYears: number
  /** Jahresfall (E2): Zeilen von Geräten, deren Leistung die Kappung begrenzt, tragen eine Markierung. */
  markPowerLimited: boolean
}

export function comparisonSelection(analysis: PdfReportAnalysis): ComparisonSelection {
  const { variant, candidates } = candidatesOf(analysis)
  const reference =
    variant === 'catalog'
      ? (candidates.find((c) => c.battery.id === analysis.recommendation?.batteryId) ?? null)
      : null

  /*
   * ⚠ DIE SCHWELLE IST `netSavingOverHorizon > 0` — dieselbe wie am Bildschirm und in
   * `summary.ts`, und ausdrücklich keine hier erfundene. Die schwächere Fassung
   * (`totalSavingPerYear > 0`) liess an einem realen Fall alle fünf Geräte durchgehen: € 22–32 im
   * Jahr bei € 6.750 Investition, Amortisation 250 bis 410 Jahre (01.09.2026).
   */
  const shown =
    variant === 'addon'
      ? candidates.filter(paysOff).slice(0, MAX_TABLE_ROWS)
      : alternativesOf(analysis)

  return {
    variant,
    considered: candidates,
    shown,
    reference,
    horizonYears: analysis.assumptions.horizonYears,
    markPowerLimited: variant === 'catalog' && annualCatalogEntriesOf(analysis) !== null,
  }
}

/**
 * Sagt dieses Kapitel „Nein" — rechnet sich also kein Zusatzgerät neben der bestehenden Anlage?
 *
 * ⚠ SIE LIEST `comparisonSelection` UND ERFINDET DIE SCHWELLE NICHT NEU: eine leere Auswahl ist
 * genau das, was `buildComparisonChapter` den Klarsatz statt der Tabelle bauen lässt
 * (`buildVerdict`, Überschrift „Lohnt sich ein zusätzlicher Speicher?", Antwort „Nein"). Eine
 * zweite Fassung von `netSavingOverHorizon > 0` liefe beim nächsten Umbau auseinander.
 *
 * ⚠ DER BESTANDSFALL STECKT IN `variant === 'addon'` — `candidatesOf` verzweigt allein an
 * `existingBatteryAnalysis`. Ein zweites `analysis.existingBatteryAnalysis` daneben wäre dieselbe
 * Frage an zwei Orten, und nur einer davon würde beim nächsten Umbau angefasst.
 *
 * ⚠ `hasComparisonChapter` gehört dazu: ohne das Kapitel wird der Klarsatz gar nicht gezeigt, und
 * „Nein" ist dann nirgends im Dokument gesagt.
 */
/** Bei eingetragener Förderung: der Satz dazu am Ende des Kapiteltexts — sonst unverändert. */
function withSubsidyNote(
  statement: ReportStatement,
  considered: ComparisonCandidate[],
  hasTable: boolean,
): ReportStatement {
  if (!considered.some(hasEnteredSubsidy)) return statement
  const programs = considered.some((c) => c.subsidyProgramAmounts !== undefined)
  const note = `${hasTable ? '„Nach Förderung“: ' : ''}${SUBSIDY_NOTE}${programs ? ` ${SUBSIDY_PROGRAMS_NOTE}` : ''} Amortisation und Netto rechnen mit diesem Betrag.`
  return { ...statement, body: statement.body === '' ? note : t`${statement.body} ${note}` }
}

/**
 * Die Amortisation nach Steuern der Tabellengeräte als Satz: eine neunte Spalte passt nicht in die
 * Seitenbreite (am gerenderten PDF gemessen, 27.09.2026).
 */
function withTaxNote(statement: ReportStatement, shown: ComparisonCandidate[]): ReportStatement {
  const taxed = shown.filter((c) => c.taxEffect !== undefined)
  if (taxed.length === 0) return statement
  const values = taxed
    .map((c) => `${c.battery.name}: ${formatYears(c.taxEffect!.amortizationYearsAfterTax)}`)
    .join('; ')
  const note = `Amortisation nach Steuern: ${values}. ${TAX_EFFECT_NOTE}`
  return { ...statement, body: statement.body === '' ? note : t`${statement.body} ${note}` }
}

export function hasNegativeAddonVerdict(analysis: PdfReportAnalysis): boolean {
  const { variant, shown } = comparisonSelection(analysis)
  return variant === 'addon' && shown.length === 0 && hasComparisonChapter(analysis)
}

/** Ergebnis vor Fassung 17: die Tabelle rechnet linear, die Empfehlung im Kasten auf Jahresbasis. */
const TABLE_BASIS_FOOTNOTE =
  'Die Geräte in dieser Tabelle sind einheitlich linear hochgerechnet und deshalb höher als die ' +
  'Jahresrechnung der Empfehlung weiter oben. Verglichen wird der Abstand, nicht die absolute Zahl.'

function tableFootnoteOf(
  analysis: PdfReportAnalysis,
  recommended: BatteryRoiEntry | undefined,
  hasReference: boolean,
  pv: AnnualScenarioPvInput | undefined,
): string | null {
  if (!hasReference || !recommended || !pv || annualCatalogEntriesOf(analysis) !== null) return null
  return headlineStorageOf(analysis, recommended, pv).basis === 'annual' ? TABLE_BASIS_FOOTNOTE : null
}

export function buildComparisonChapter(
  analysis: PdfReportAnalysis,
  /* Report-Baukasten B1 — s. `buildReportSummary`. Ohne ihn wird wie bisher selbst abgeleitet. */
  context?: ReportBuildContext,
  hasPv?: boolean,
  /* Nur mit ihm ist das Jahreskapitel prüfbar — ohne bleibt die Tabelle ohne Fussnote. */
  pv?: AnnualScenarioPvInput,
): ComparisonChapter {
  /* ⚠ `context ? … : …` statt `??` — `comparisonPlan` ist selbst gültig `null`. */
  const plan = context ? context.comparisonPlan : comparisonChartPlan(analysis)
  const { variant, considered, shown, reference, horizonYears, markPowerLimited } =
    comparisonSelection(analysis)
  const hasTable = shown.length > 0

  return {
    figure: plan ? buildFigure(plan, displayedPriceBasis(analysis)) : null,
    figureMissing: plan ? null : FIGURE_MISSING,
    statement: hasTable
      ? buildTableStatement(variant, considered, noPayoffReasonOf(analysis, hasPv), shown, markPowerLimited)
      : buildVerdict(considered, horizonYears),
    table: hasTable ? buildCandidateTable(shown, horizonYears, reference, markPowerLimited) : null,
    tableFootnote: hasTable
      ? tableFootnoteOf(
          analysis,
          context ? context.recommendedEntry : recommendedEntryOf(analysis),
          reference !== null,
          pv,
        )
      : null,
    countLine: hasTable ? countLineOf(considered) : null,
  }
}
