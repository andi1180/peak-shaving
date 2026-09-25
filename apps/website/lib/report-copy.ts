import {
  controlValueOf,
  displayedPriceBasis,
  sumCovered,
  VAT_INCLUSIVE_LABEL,
  type AnalysisResult,
  type BatteryNotice,
  type BatteryResultEntry,
  type BatteryRoiEntry,
  type MonthlyTariffComparison,
  type RecommendationRationale,
} from 'shared'

import { formatEur, formatKw } from './format'

/**
 * Report-Texte, die an MEHR ALS EINER Stelle stehen müssen (Delta 16a).
 *
 * Der Fahrplan-Vorbehalt (§6.2, Pflicht) steht an der Ersparnis-Aufschlüsselung und im
 * Methodik-Kapitel; zweimal ausgeschrieben liefen die Fassungen beim nächsten Umformulieren
 * auseinander. Das ist der einzige Grund für diese Datei; sie ist bewusst kein allgemeiner
 * „Textkatalog".
 */

/** §3.7.1 — die Kennzeichnung jeder Zahl, deren Energie-Anteil aus weniger als 365 Tagen hochgerechnet ist. */
export const ANNUALIZED_LABEL = 'auf ein Jahr hochgerechnet'

export function isAnnualized(entry: Pick<BatteryResultEntry, 'annualizationFactor'>): boolean {
  return entry.annualizationFactor > 1
}

/** „pro Jahr", bei hochgerechneter Zahl mit Kennzeichnung. */
export function perYearText(entry: Pick<BatteryResultEntry, 'annualizationFactor'>): string {
  return isAnnualized(entry) ? `pro Jahr (${ANNUALIZED_LABEL})` : 'pro Jahr'
}

/** §3.7 — ohne rechenbare Preisdaten ist der Energie-Anteil nur zum Arbeitspreis bewertet. */
export const ENERGY_PRICE_ONLY_NOTE =
  'Der Energie-Anteil ist nur mit Ihrem Arbeitspreis bewertet, ohne Netzentgelte und Abgaben auf ' +
  'die eingesparte Menge — für diesen Zeitraum liegen uns keine vollständigen Preisdaten vor. ' +
  'Mit ihnen fiele er in der Regel höher aus.'

export function hasEnergyPriceOnlyBasis(entry: Pick<BatteryResultEntry, 'energySavingBasis'>): boolean {
  return entry.energySavingBasis === 'energy_price_only'
}

/**
 * Der Wert der Ladesteuerung — EINE Zahl für Wege-Kapitel, Empfehlungskapitel und Bildschirmkarte:
 * die Differenz „aWATTar ohne Steuerung" − „aWATTar mit Ladesteuerung" über die gemessenen Tage.
 * Das ist exakt der gemessene Energie-Anteil des gezeigten Speichers (§3.7-Revision 25.09.2026).
 */
export type LoadControlValue = {
  overCoveredDaysEur: number
  coveredDays: number
  /** Auf ein Jahr hochgerechnet; `null`, wenn nichts hochgerechnet ist (dann gilt die Zahl oben). */
  annualizedEur: number | null
}

export function loadControlValueOf(
  entry: Pick<BatteryResultEntry, 'energySavingPerYear' | 'energySavingOverCoveredPeriod' | 'annualizationFactor' | 'coveredDays'>,
  comparison: MonthlyTariffComparison | undefined,
): LoadControlValue {
  const withBattery = comparison?.spotWithBatteryEur
  return {
    overCoveredDaysEur:
      comparison && withBattery
        ? controlValueOf({
            spotWithoutControlEur: sumCovered(comparison.spotWithoutControlEur),
            spotWithBatteryEur: sumCovered(withBattery),
          })
        : entry.energySavingOverCoveredPeriod,
    coveredDays: entry.coveredDays,
    annualizedEur: isAnnualized(entry) ? entry.energySavingPerYear : null,
  }
}

export type DispatchMethodInput = {
  analysis: Pick<AnalysisResult, 'tariffOptimization' | 'current'>
  isStandardProfile: boolean
  /** Nur das Methodik-Kapitel nennt die Rückblick-Obergrenze der Ladesteuerung als Zahl. */
  withUpperBound: boolean
}

/**
 * Worauf der EINE Fahrplan beruht (§3.6/§3.7, Revisionen 25.09.2026) — Methodik-Kapitel (PDF und
 * Druck) und Ersparnis-Aufschlüsselung lesen denselben Wortlaut.
 */
export function dispatchMethodText({ analysis, isStandardProfile, withUpperBound }: DispatchMethodInput): string {
  const comparison =
    analysis.tariffOptimization?.computable === true ? analysis.tariffOptimization.monthlyComparison : undefined
  const plan =
    analysis.tariffOptimization?.computable !== true
      ? 'Ohne Börsenpreise gibt es keinen Tagesplan: der Speicher lädt aus PV-Überschuss und im ' +
        'günstigen Tarif-Fenster und entscheidet dabei nur mit dem, was bis zu diesem Zeitpunkt ' +
        'bekannt ist.'
      : isStandardProfile
        ? 'Ihr Verbrauch ist ein Standardprofil aus Ihrem Jahresverbrauch; der Speicher plant jeden ' +
          'Tag mit genau diesem Profil, es ist zugleich Erwartung und gerechneter Verbrauch.'
        : 'Der Speicher plant jeden Tag am Vorabend: mit den dann bekannten Börsenpreisen und einer ' +
          'Verbrauchserwartung aus Ihren eigenen früheren Messwerten, nicht mit dem tatsächlichen ' +
          'Verbrauch des Tages. Ausgeführt wird dieser Plan auf Ihrem echten Lastgang; Ersparnis, ' +
          'Amortisation und die Reihung der Geräte stammen aus genau diesem Fahrplan.'
  const peak =
    analysis.current.leistungspreisCostPerYear > 0
      ? ' Anders die Spitzenkappung: Kappschwelle und Reserve für die Spitzen sind aus dem ganzen ' +
        'Zeitraum bestimmt, also mit dem Wissen, wann die Spitzen kommen. Der Leistungspreis-Anteil ' +
        'der Ersparnis ist deshalb eine Obergrenze.'
      : ''
  const hindsight = comparison?.spotWithBatteryHindsightEur
  const upperBoundEur =
    comparison && hindsight
      ? controlValueOf({
          spotWithoutControlEur: sumCovered(comparison.spotWithoutControlEur),
          spotWithBatteryEur: sumCovered(hindsight),
        })
      : null
  const upperBound =
    withUpperBound && comparison && upperBoundEur !== null
      ? ' Mit vollem Rückblick auf Ihren tatsächlichen Verbrauch wäre die Ladesteuerung über die ' +
        `${comparison.fixedCosts.coveredDays} gemessenen Tage höchstens ${formatEur(upperBoundEur)} ` +
        'wert gewesen — die Obergrenze dieser Rechnung, nicht ihr Ergebnis.'
      : ''
  return plan + peak + upperBound
}

/**
 * Wessen Speicher die dritte Reihe des Monatsvergleichs fährt — Dativ, für „aWATTar mit …".
 *
 * ⚠ Seit D7 entsteht diese Reihe auch OHNE Bestandsanlage, aus dem Dispatch der empfohlenen
 * Katalog-Batterie (`compute-analysis.ts`). „Ihrem Speicher" wäre dort eine Behauptung über ein
 * Gerät, das der Kunde nicht besitzt. Die Fallunterscheidung ist dieselbe wie bei der Kapp-Linie
 * (`report.tsx`, `pdf-report/recommendation.ts`); der Wortlaut steht hier, damit die Stellen, die
 * sie treffen, nicht auseinanderlaufen.
 */
export function monthlyBatteryRef(isExisting: boolean): string {
  return isExisting ? 'Ihrem Speicher' : 'der empfohlenen Batterie'
}

/**
 * Wie die Reihe/der Weg „aWATTar, gesteuert" ÜBERALL heisst, wo sie BESCHRIFTET wird —
 * Balkenlabel, Legende, Tabellenzeile, Absatzüberschrift.
 *
 * ── ⚠ EIN NAME, WEIL ES EINE SACHE IST ────────────────────────────────────────────────────────
 * Bis zum 21.09.2026 stand hier `aWATTar mit ${monthlyBatteryRef(isExisting)}` — gerendert also
 * „aWATTar mit" plus Possessivum („Ihrem Speicher" bzw. „der empfohlenen Batterie"), und im
 * Monatsvergleich zusätzlich mit dem Anhang „(Ladung optimiert)". Derselbe Gegenstand trug damit
 * im selben Dokument bis zu drei Beschriftungen, und im Wege-Kapitel las sich die Achse anders als
 * die Überschrift darunter.
 *
 * ⚠ Der Wortlaut ist DER DES ZIELBILDS: `Urbanz_Wirtschaftlichkeitsanalyse V2.pdf`, Seite 5,
 * „Weg 3 — aWATTar mit Ladesteuerung". Er nennt bewusst kein Gerät — wessen Speicher gesteuert
 * wird, sagt der Fliesstext daneben (`monthlyBatteryRef`), wo ein Satz den Dativ auch tragen kann.
 * Eine Beschriftung ohne Possessivum ist ausserdem in BEIDEN Fällen richtig (Bestandsanlage wie
 * empfohlene Batterie) und braucht die Fallunterscheidung gar nicht erst.
 */
export const CONTROLLED_WAY_LABEL = 'aWATTar mit Ladesteuerung'

/**
 * K3d — Herkunft des angezeigten Wirkungsgrads eines Katalog-Geräts, am Bildschirm-Druck und im
 * PDF gleich. `null`, wo die Herkunft nicht vermerkt ist: dann steht der Wert ohne Zusatz.
 */
export function rteSourceNote(rteSource: string | null | undefined): string | null {
  if (rteSource === 'datenblatt') return 'laut Datenblatt'
  if (rteSource === 'annahme') return 'angenommen'
  return null
}

/**
 * H3 — der USt-Zusatz am Bildschirm, abgelesen an den gezeigten Zahlen (`analysisForDisplay`):
 * Privatkunden sehen „inkl. 20 % USt", Betriebe unverändert „exkl. MwSt.".
 */
export function vatNote(view: object | null | undefined): string {
  return displayedPriceBasis(view) === 'gross' ? VAT_INCLUSIVE_LABEL : 'exkl. MwSt.'
}

/**
 * Ein §3.8-Hinweis als Satz (Karte, PDF, CSV). Die Beträge kommen aus dem Ergebnis in der
 * Anzeigebasis — bei `heim` also brutto, passend zu den Investitionszeilen daneben.
 */
export function batteryNoticeText(notice: BatteryNotice): string {
  switch (notice.code) {
    case 'foundation_required':
      return `Betonsockel nötig (+${formatEur(notice.foundationCost)}).`
    case 'separate_inverter':
      return `Separater Wechselrichter nötig (+${formatEur(notice.extraInverterCost)}).`
    case 'power_limited':
      return (
        `Leistung des Kandidaten reicht nicht für alle Spitzen (${formatKw(notice.maxPowerKw)} maximale ` +
        'Lade-/Entladeleistung) — die Kappung ist leistungs-, nicht energiebegrenzt.'
      )
  }
}

/** Alle Hinweise eines Eintrags in der bisherigen Reihenfolge: Ersparnisrechnung, dann §3.8. */
export function batteryNoteTexts(entry: { warnings: string[]; notices?: BatteryNotice[] }): string[] {
  // `?? []`: Ergebnisse von vor der Umstellung (Fassung ≤ 10) tragen noch keine `notices`.
  return [...entry.warnings, ...(entry.notices ?? []).map(batteryNoticeText)]
}

/**
 * Das Katalog-Gerät hinter der Speicherreihe des Monatsvergleichs — `undefined` beim
 * Bestandsspeicher (bezahlt, keine Investition) und ohne Kandidaten.
 */
export function catalogStorageEntry(
  analysis: Pick<AnalysisResult, 'perBattery' | 'recommendation' | 'existingBatteryAnalysis'>,
): BatteryRoiEntry | undefined {
  if (analysis.existingBatteryAnalysis) return undefined
  const id = analysis.recommendation?.batteryId
  return analysis.perBattery.find((p) => p.battery.id === id) ?? analysis.perBattery[0]
}

/** Rechnet sich das Gerät im Betrachtungszeitraum? Dieselbe Schwelle wie Gerätetabelle und Engine-Reihung. */
export function storagePaysOff(entry: Pick<BatteryRoiEntry, 'netSavingOverHorizon'>): boolean {
  return entry.netSavingOverHorizon > 0
}

/** Das Speicher-Urteil — wortgleich überall, wo ein Betrag „mit Speicher" steht. */
export function storageJudgementText(
  entry: Pick<BatteryRoiEntry, 'netSavingOverHorizon'>,
  horizonYears: number,
): string {
  return `Im Betrachtungszeitraum von ${horizonYears} Jahren rechnet er sich damit${storagePaysOff(entry) ? '' : ' nicht'}.`
}

/** Gerät, Investition und Urteil in einer Zeile — für Kopfzahlen und Diagramm-Legenden. */
export function storageInvestmentNote(entry: BatteryRoiEntry, horizonYears: number): string {
  return (
    `Speicher: ${entry.battery.name}, Investition ${formatEur(entry.totalInvestment)}. ` +
    storageJudgementText(entry, horizonYears)
  )
}

/** Die Zeile zur Speicherreihe eines Ergebnisses — `null` beim Bestandsspeicher und ohne Kandidaten. */
export function catalogStorageNote(
  analysis: Pick<AnalysisResult, 'perBattery' | 'recommendation' | 'existingBatteryAnalysis' | 'assumptions'>,
): string | null {
  const entry = catalogStorageEntry(analysis)
  return entry ? storageInvestmentNote(entry, analysis.assumptions.horizonYears) : null
}

/** Der Satz zur Empfehlung, aus den Werten der Engine; `annualized` = Energie-Anteil hochgerechnet. */
export function recommendationRationaleText(
  batteryName: string,
  r: RecommendationRationale,
  annualized = false,
): string {
  const amortization = Number.isFinite(r.amortizationYears)
    ? `nach ${new Intl.NumberFormat('de-AT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(r.amortizationYears)} Jahren`
    : 'innerhalb des Betrachtungszeitraums nicht'
  return (
    `${batteryName} spart voraussichtlich ${formatEur(r.totalSavingPerYear)} ` +
    `${annualized ? `pro Jahr (${ANNUALIZED_LABEL})` : 'pro Jahr'} und ` +
    `amortisiert sich ${amortization} — Netto-Ersparnis über ${r.horizonYears} Jahre: ` +
    `${formatEur(r.netSavingOverHorizon)}.`
  )
}

/** Statt eines Heimspeichers ohne jede Ersparnis (∞ Amortisation), s. `dynamicTariffHintKind`. */
export const DYNAMIC_TARIFF_HINT =
  'Ein Speicher lohnt sich für Haushalte nur mit einem dynamischen Tarif (Börsenpreis). ' +
  'Aktivieren Sie den Börsenpreis-Vergleich, um die Wirkung zu sehen.'

/** Derselbe Befund, wenn der Vergleich angefordert war, aber nicht gerechnet werden konnte. */
export const DYNAMIC_TARIFF_HINT_NOT_COMPUTABLE =
  'Ein Speicher lohnt sich für Haushalte nur mit einem dynamischen Tarif (Börsenpreis). ' +
  'Der Börsenpreis-Vergleich ließ sich für Ihre Angaben nicht rechnen — die Gründe stehen im ' +
  'Abschnitt „Vergleich mit Börsen-Strompreisen".'

export type DynamicTariffHintKind = 'not_requested' | 'not_computable'

/**
 * Heimspeicher, kein berechneter Börsenpreis-Vergleich (nicht angefordert ODER angefordert und
 * nicht berechenbar) und kein Kandidat spart etwas → Hinweis statt der ganzen Speicher-Strecke.
 * Mit eigenem Speicher bleibt dessen Karte stehen. `null` = kein Hinweis.
 */
export function dynamicTariffHintKind(
  analysis: Pick<AnalysisResult, 'perBattery' | 'recommendation' | 'tariffOptimization' | 'existingBatteryAnalysis'>,
): DynamicTariffHintKind | null {
  const kind =
    analysis.tariffOptimization === undefined
      ? 'not_requested'
      : analysis.tariffOptimization.computable === false
        ? 'not_computable'
        : null
  if (
    kind === null ||
    analysis.recommendation == null ||
    analysis.existingBatteryAnalysis != null ||
    analysis.perBattery.length === 0 ||
    !analysis.perBattery.every((e) => e.battery.class === 'residential' && e.totalSavingPerYear === 0)
  ) {
    return null
  }
  return kind
}

export function dynamicTariffHintText(kind: DynamicTariffHintKind): string {
  return kind === 'not_requested' ? DYNAMIC_TARIFF_HINT : DYNAMIC_TARIFF_HINT_NOT_COMPUTABLE
}
