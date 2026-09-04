import type { BatteryResultEntry, BatteryRoiSummary } from 'shared'

import { formatEur, formatKw, formatKwh1, formatYears } from '@/lib/format'
import type { ReportFigure, ReportRow, ReportStatement, ReportTable } from './statement'
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
    : { variant: 'catalog', candidates: analysis.perBattery }
}

/**
 * ⚠ WORTGLEICH ZUR VORBEDINGUNG VON `MarginalBenefitChart` — und das ist keine zweite Fachregel.
 *
 * Die Komponente wirft nicht-endliche Werte aus der Achse (ein `Infinity` zöge sie ins Unendliche
 * und machte alle übrigen Punkte unlesbar) und rendert bei weniger als zwei verbleibenden Punkten
 * GAR NICHTS — eine Linie durch einen Punkt ist keine Kurve. Gäbe es dann trotzdem einen
 * Rasterauftrag, liefe `captureChart` acht Sekunden in eine Zeitüberschreitung und setzte eine
 * technische Meldung an die Stelle einer Aussage. Dieselbe Überlegung wie bei
 * `hasRepresentativeDay` (`detail.ts`) und der Heatmap-Vorbedingung (`insight.ts`).
 */
function drawablePoints(candidates: ComparisonCandidate[]): ComparisonCandidate[] {
  return candidates.filter(
    (c) =>
      Number.isFinite(c.netSavingOverHorizon) && Number.isFinite(c.battery.usableCapacityKwh),
  )
}

export function comparisonChartPlan(analysis: PdfReportAnalysis): ComparisonChartPlan | null {
  const { variant, candidates } = candidatesOf(analysis)
  const points = drawablePoints(candidates)
  if (points.length < 2) return null
  return { variant, points, horizonYears: analysis.assumptions.horizonYears }
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
  const { variant, candidates } = candidatesOf(analysis)
  if (variant === 'addon') return candidates.length > 0
  return alternativesOf(analysis).length > 0
}

/**
 * Die Katalog-Alternativen: alle Kandidaten AUSSER dem empfohlenen.
 *
 * ── ⚠ BENANNTE ABWEICHUNG VOM BILDSCHIRM — VOLLSTÄNDIG STATT DER ERSTEN DREI ──────────────────
 * `report.tsx` kürzt auf drei (`.slice(0, 3)`, §3.8/§6.2 „2–3 Alternativen"), und dort ist das
 * richtig: jede Alternative ist eine volle `RecommendationCard`, und fünf davon in einer
 * Aufklappliste sind eine Wand. Im PDF ist eine Alternative eine TABELLENZEILE — die Kürzung
 * spart dort einen Zeilenabstand und kostet eine Angabe.
 *
 * Dazu kommt der Unterschied, der auf Papier zählt: ein Bildschirm-Report lässt sich weiter
 * aufklappen, ein weitergereichtes Blatt nicht. Was nicht gedruckt ist, ist für den Leser nicht
 * vorhanden — und die Frage „warum ist das drittbeste Gerät schlechter" wäre dann nirgends im
 * Dokument beantwortet.
 */
function alternativesOf(analysis: PdfReportAnalysis): ComparisonCandidate[] {
  return analysis.perBattery.filter((p) => p.battery.id !== analysis.recommendation.batteryId)
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Die Tabelle: EINE Funktion, ZWEI Konsumenten
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

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
 */
export function buildCandidateTable(
  candidates: ComparisonCandidate[],
  horizonYears: number,
): ReportTable {
  return {
    columns: [
      { label: 'Gerät', width: 3 },
      { label: 'Grösse', width: 2.4 },
      { label: 'Investition', width: 1.7, align: 'right' },
      { label: 'Ersparnis/Jahr', width: 1.7, align: 'right' },
      { label: 'Amortisation', width: 1.6, align: 'right' },
      { label: `Netto über ${horizonYears} Jahre`, width: 2, align: 'right' },
    ],
    rows: candidates.map((c) => ({
      key: c.battery.id,
      cells: [
        c.battery.name,
        `${formatKwh1(c.battery.usableCapacityKwh)} / ${formatKw(c.battery.maxPowerKw)}`,
        formatEur(c.totalInvestment),
        formatEur(c.totalSavingPerYear),
        /* `formatYears(Infinity)` liefert „∞ Jahre" — eine Antwort, keine Lücke (s. `roi.ts`). */
        formatYears(c.amortizationYears),
        formatEur(c.netSavingOverHorizon),
      ],
    })),
  }
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
}

function neutralRow(label: string, value: string): ReportRow {
  return { label, value, tone: 'neutral' }
}

/**
 * Die Bildunterschrift der Kurve.
 *
 * ⚠ Sie beschreibt das BILD, nicht die Karte: gerastert wird der Recharts-Zeichenbereich, die
 * beiden erklärenden Absätze der Komponente (Achsenwahl und „keine stetige Kurve") liegen
 * ausserhalb und stehen im PDF hier. Ohne sie stünde eine Linie durch fünf Punkte da, deren
 * Y-Achse man für die Jahresersparnis halten könnte — und das ist genau die Verwechslung, gegen
 * die die Komponente ihre Achse gewählt hat.
 */
function buildFigure(plan: ComparisonChartPlan): ReportFigure {
  const which = plan.variant === 'addon' ? ' des Zusatzgeräts' : ''
  return {
    caption:
      `Je Katalog-Gerät ein Punkt: waagrecht seine nutzbare Kapazität, senkrecht das, was über ` +
      `${plan.horizonYears} Jahre netto übrig bleibt — Ersparnis abzüglich der Anschaffung` +
      `${which}. Über der waagrechten Nulllinie rechnet sich ein Gerät im Betrachtungszeitraum, ` +
      'darunter nicht. Alle Beträge netto (ohne USt.).',
    note:
      `Die Linie verbindet ${plan.points.length} Geräte, sie interpoliert nichts dazwischen: mit ` +
      'der Kapazität ändert sich auch die Leistung, und ein Gerät, das zwischen zwei Punkten läge, ' +
      'gibt es im Katalog nicht — seinen Preis kennen wir also auch nicht. Gemessen ist die ' +
      'Netto-Ersparnis über den Zeitraum und ausdrücklich nicht die Jahresersparnis: die steigt mit ' +
      'der Kapazität fast immer, und die Frage ist nicht „bringt mehr Speicher mehr", sondern „ab ' +
      'wann zahlt er sich nicht mehr ein".',
  }
}

/** Warum keine Kurve da ist — erreichbar nur bei einem einzigen Kandidaten. */
const FIGURE_MISSING =
  'Für diesen Report ist keine Grenznutzen-Kurve abgebildet: es liegt nur ein einziges ' +
  'durchgerechnetes Gerät vor, und eine Linie durch einen Punkt ist keine Kurve. Die Zahlen ' +
  'dieses Reports sind davon nicht betroffen — sie stammen aus der Berechnung, nicht aus der ' +
  'Abbildung.'

/**
 * Der Klarsatz: kein Zusatzgerät rechnet sich.
 *
 * ⚠ WORTGLEICH ZUM BILDSCHIRM (`report.tsx`, `zusatzspeicher-lohnt-nicht`), samt beider Absätze.
 * Die Kernergebnis-Seite trägt eine gekürzte Fassung derselben Feststellung; hier steht sie
 * vollständig, weil hier die Kurve daneben liegt, die sie belegt. Zwei verschieden formulierte
 * Fassungen desselben Befunds im selben Dokument sähen wie zwei Befunde aus.
 */
function buildVerdict(horizonYears: number): ReportStatement {
  return {
    id: 'addon_none',
    title: 'Ein zusätzlicher Speicher lohnt sich derzeit nicht',
    /*
     * ⚠ KEINE KOPFZAHL — es gibt keine. Eine erfundene 0 an dieser Stelle wäre eine Zahl, die
     * etwas anderes behauptet als der Satz darunter (s. `ReportStatement.amount`).
     */
    amount: null,
    rows: [],
    body:
      'Keines der Geräte aus unserem Katalog verdient neben Ihrer bestehenden Anlage seine ' +
      `Anschaffung innerhalb von ${horizonYears} Jahren wieder ein. Eine zusätzliche Ersparnis ` +
      'kann dabei durchaus herauskommen — über den Betrachtungszeitraum gerechnet bleibt sie nur ' +
      'unter dem, was das Gerät kostet. Ihr Speicher deckt bei diesem Verbrauch bereits ab, was ' +
      'sich wirtschaftlich holen lässt; mehr Kapazität stünde einen grossen Teil der Zeit ' +
      'ungenutzt da. Das ist eine Aussage über diesen Lastgang, diese Tarifangaben und einen ' +
      `Betrachtungszeitraum von ${horizonYears} Jahren. Wächst Ihr Verbrauch, ändert sich Ihr ` +
      'Tarif, kommt PV dazu oder rechnen Sie über einen längeren Zeitraum, kann die Antwort eine ' +
      'andere sein.',
  }
}

/**
 * Die Einleitung über der Tabelle.
 *
 * ⚠ Die drei Zeilen darüber sind KEINE Wiederholung der Tabelle, sondern ihre Einordnung: wie
 * viele Geräte betrachtet wurden, wie viele davon sich rechnen, und — im Zusatzfall — dass alle
 * Ersparnis-Zahlen Differenzen sind. Ohne die dritte Zeile liest sich die Spalte
 * „Ersparnis/Jahr" als Bruttozahl des gemeinsamen Speichers.
 */
function buildTableStatement(
  variant: ComparisonVariant,
  considered: ComparisonCandidate[],
  horizonYears: number,
): ReportStatement {
  const isAddon = variant === 'addon'
  /*
   * ⚠ Beide Zahlen zählen über ALLE betrachteten Geräte, nicht über die gezeigten Zeilen. Im
   * Katalog-Fall fehlt in der Tabelle das empfohlene Gerät (es steht vollständig im Kapitel davor)
   * — „davon wirtschaftlich" über die Tabelle gezählt liesse ausgerechnet den besten Kandidaten
   * aus und meldete eine kleinere Zahl, als der Report an anderer Stelle ausweist.
   */
  const rows: ReportRow[] = [
    neutralRow('Betrachtete Geräte', String(considered.length)),
    neutralRow(
      `Davon im Betrachtungszeitraum (${horizonYears} Jahre) wirtschaftlich`,
      String(considered.filter((c) => c.netSavingOverHorizon > 0).length),
    ),
  ]

  return {
    id: isAddon ? 'addon_table' : 'catalog_alternatives',
    title: isAddon
      ? 'Diese Zusatzgeräte rechnen sich — im Vergleich'
      : 'Die übrigen Geräte des Katalogs — im Vergleich',
    /* ⚠ KEINE KOPFZAHL: der bestgereihte Betrag steht bereits auf der Kernergebnis-Seite bzw. im
       Empfehlungs-Kapitel; hier stünde er ein zweites Mal und lüde dazu ein, ihn zu addieren. */
    amount: null,
    rows,
    body: isAddon
      ? 'Gerechnet ist je Zeile EIN gemeinsamer Speicher aus Ihrer bestehenden Anlage und diesem ' +
        'Gerät (Kapazität und Leistung addiert, Wirkungsgrad kapazitätsgewichtet). Ausgewiesen ist ' +
        'davon ausschliesslich, was ÜBER Ihre bestehende Anlage hinaus herauskommt — die Spalten ' +
        '„Ersparnis/Jahr" und „Netto" sind also Differenzen und nicht die Ersparnis des ' +
        'gemeinsamen Speichers. Bezahlt wird allein das neue Gerät; Ihre bestehende Anlage geht in ' +
        'keine dieser Zahlen ein. Gezeigt sind die Geräte, die ihre Anschaffung im ' +
        'Betrachtungszeitraum wieder einspielen; die übrigen stehen als Punkte in der Kurve ' +
        'darüber.'
      : 'Gereiht ist nach der Netto-Ersparnis über den Betrachtungszeitraum — derselben Grösse wie ' +
        'die Kurve darüber und wie die Empfehlung im Kapitel „Empfehlung und Lastverlauf". Das ' +
        'empfohlene Gerät steht deshalb hier nicht noch einmal: es ist dort vollständig ' +
        'aufgeschlüsselt. Diese Tabelle sagt, was die Alternativen dagegen leisten — und um ' +
        'welchen Betrag die Empfehlung besser ist. Die §3.8-Hinweise eines Geräts (Betonsockel, ' +
        'separater Wechselrichter, zu geringe Leistung für alle Spitzen) sind in der Investition ' +
        'bereits enthalten, stehen hier aber nicht je Zeile — sie stehen beim empfohlenen Gerät.',
  }
}

export function buildComparisonChapter(analysis: PdfReportAnalysis): ComparisonChapter {
  const plan = comparisonChartPlan(analysis)
  const { variant, candidates } = candidatesOf(analysis)
  const horizonYears = analysis.assumptions.horizonYears

  /*
   * ⚠ DIE SCHWELLE IST `netSavingOverHorizon > 0` — dieselbe wie am Bildschirm und in
   * `summary.ts`, und ausdrücklich keine hier erfundene. Die schwächere Fassung
   * (`totalSavingPerYear > 0`) liess an einem realen Fall alle fünf Geräte durchgehen: € 22–32 im
   * Jahr bei € 6.750 Investition, Amortisation 250 bis 410 Jahre (01.09.2026).
   */
  const shown =
    variant === 'addon'
      ? candidates.filter((c) => c.netSavingOverHorizon > 0)
      : alternativesOf(analysis)

  const hasTable = shown.length > 0

  return {
    figure: plan ? buildFigure(plan) : null,
    figureMissing: plan ? null : FIGURE_MISSING,
    statement: hasTable
      ? buildTableStatement(variant, candidates, horizonYears)
      : buildVerdict(horizonYears),
    table: hasTable ? buildCandidateTable(shown, horizonYears) : null,
  }
}
