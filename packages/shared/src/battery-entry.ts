import type { AnalysisResult, BatteryResultEntry } from './analysis-result'

/**
 * DER PRIMÄRE SPEICHER EINES ERGEBNISSES — die bestehende Anlage des Kunden, sonst das
 * bestgereihte Katalog-Gerät.
 *
 * ── ⚠ WARUM DIE REGEL IN `shared` WOHNT ───────────────────────────────────────────────────────
 * Sie beantwortet die Frage „wessen Speicher meint dieser Report?" und wird an drei Stellen
 * gebraucht: im Bildschirm-Report, im PDF-Report (`primaryEntryOf`, `summary.ts`) und seit D6
 * Teil 3 in der Jahres-Hochrechnung, die dieselbe Spitzenkappungs-Zahl aus einem ZWEITEN Lauf
 * liest. Zwei verschieden gewählte „primäre" Geräte im selben Dokument wären derselbe Report mit
 * zwei verschiedenen Antworten.
 *
 * Der Parameter ist bewusst ein `Pick<…>` und nicht das ganze Ergebnis: die Regel liest genau
 * diese drei Felder, und die engere Signatur sagt das auch.
 */
export function primaryBatteryEntry(
  result: Pick<AnalysisResult, 'perBattery' | 'recommendation' | 'existingBatteryAnalysis'>,
): BatteryResultEntry | undefined {
  if (result.existingBatteryAnalysis) return result.existingBatteryAnalysis.entry
  const id = result.recommendation?.batteryId
  return (
    (id === undefined ? undefined : result.perBattery.find((p) => p.battery.id === id)) ??
    result.perBattery[0]
  )
}

/**
 * Weg 5 — die Kappungs-Ersparnis eines Eintrags pro Jahr: Leistungspreis inkl. Gebrauchsabgabe
 * plus EAG-Förderbeitrag Leistung. 0, wenn der Leistungspreis-Anteil nicht positiv ist (Gründe:
 * `peakShavingBlockers`). Hauptreport und Jahres-Hochrechnung rechnen beide hierüber.
 */
export function peakShavingSavingPerYearOf(
  entry: Pick<BatteryResultEntry, 'leistungspreisSavingPerYear' | 'eagDemandSavingPerYear'> | undefined,
): number {
  if (!entry || !(entry.leistungspreisSavingPerYear > 0)) return 0
  return entry.leistungspreisSavingPerYear + (entry.eagDemandSavingPerYear ?? 0)
}
