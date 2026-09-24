import {
  displayedPriceBasis,
  VAT_INCLUSIVE_LABEL,
  type AnalysisResult,
  type BatteryNotice,
  type RecommendationRationale,
} from 'shared'

import { formatEur, formatKw } from './format'

/**
 * Report-Texte, die an MEHR ALS EINER Stelle stehen müssen (Delta 16a).
 *
 * ── WARUM EINE KONSTANTE UND NICHT ZWEIMAL DERSELBE SATZ ────────────────────────────────────────
 * Der Hindsight-Hinweis ist nach §6.2 PFLICHT und steht seit U2 unaufdringlich an der
 * Ersparnis-Aufschlüsselung (`recommendation-card.tsx`) — genau dort, wo §6.2 ihn verlangt
 * („beim Eigenverbrauchs-/Lastverschiebungs-Anteil"). Der Methodik-Abschnitt des erweiterten
 * Druck-Reports (Delta 16a) braucht dieselbe Aussage ein zweites Mal, weil er als Kapitel für sich
 * gelesen wird: ein Report, den ein Installateur beim Kunden dalässt, wird abschnittsweise
 * gelesen, nicht von vorn bis hinten.
 *
 * Zweimal ausgeschrieben liefen die beiden Fassungen beim nächsten Umformulieren auseinander — und
 * dann stünde in einem Dokument zweimal derselbe Vorbehalt in zwei Schärfen. Das ist der einzige
 * Grund für diese Datei; sie ist bewusst kein allgemeiner „Textkatalog".
 *
 * Der Wortlaut ist WÖRTLICH der bestehende (U2, `recommendation-card.tsx`) — in Delta 16a
 * ausdrücklich übernommen und nicht neu formuliert.
 */

/** §6.2/§3.6, Pflicht. Steht an der Ersparnis-Aufschlüsselung UND im Methodik-Abschnitt. */
export const HINDSIGHT_NOTE =
  'Eigenverbrauch & tarifbewusstes Laden sind mit vollem Rückblick auf das Jahresprofil ' +
  'gerechnet (Bestmarke). Der Spitzenschutz-Anteil ist davon nicht betroffen.'

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

/** Der Satz zur Empfehlung, aus den Werten der Engine. */
export function recommendationRationaleText(batteryName: string, r: RecommendationRationale): string {
  const amortization = Number.isFinite(r.amortizationYears)
    ? `nach ${new Intl.NumberFormat('de-AT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(r.amortizationYears)} Jahren`
    : 'innerhalb des Betrachtungszeitraums nicht'
  return (
    `${batteryName} spart voraussichtlich ${formatEur(r.totalSavingPerYear)} pro Jahr und ` +
    `amortisiert sich ${amortization} — Netto-Ersparnis über ${r.horizonYears} Jahre: ` +
    `${formatEur(r.netSavingOverHorizon)}.`
  )
}

/** Statt eines Heimspeichers ohne jede Ersparnis (∞ Amortisation), s. `needsDynamicTariffHint`. */
export const DYNAMIC_TARIFF_HINT =
  'Ein Speicher lohnt sich für Haushalte nur mit einem dynamischen Tarif (Börsenpreis). ' +
  'Aktivieren Sie den Börsenpreis-Vergleich, um die Wirkung zu sehen.'

/**
 * Heimspeicher, Börsenpreis-Vergleich nicht angefordert (`tariffOptimization` fehlt — ein
 * angeforderter, aber nicht berechenbarer Vergleich trägt ein Objekt) und kein Kandidat spart
 * etwas. Mit eigenem Speicher bleibt dessen Karte stehen.
 */
export function needsDynamicTariffHint(
  analysis: Pick<AnalysisResult, 'perBattery' | 'recommendation' | 'tariffOptimization' | 'existingBatteryAnalysis'>,
): boolean {
  return (
    analysis.recommendation != null &&
    analysis.existingBatteryAnalysis == null &&
    analysis.tariffOptimization === undefined &&
    analysis.perBattery.length > 0 &&
    analysis.perBattery.every((e) => e.battery.class === 'residential' && e.totalSavingPerYear === 0)
  )
}
