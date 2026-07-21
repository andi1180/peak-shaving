import type { BatteryCandidate } from 'shared'
import type { BatteryOverride } from './analysis-protocol'

/**
 * `catalog` mit genau EINEM modifizierten Eintrag (Architektur-Vorgabe §6.2: eine modifizierte
 * Kopie, nicht ein zweiter Katalog) — die übrigen Kandidaten bleiben unangetastet, damit die
 * Neu-Einordnung (Ranking) ehrlich gegen die unveränderten Alternativen läuft.
 *
 * ── WARUM DAS SEIT B14-2 HIER STEHT UND NICHT MEHR IM WORKER ────────────────────────────────────
 * Das Analyse-Bündel führt den Batteriekatalog-STAND als WERTE mit — genau das Array, mit dem
 * gerechnet wurde, inklusive einer Änderung aus dem Annahmen-Panel. Der Export läuft im
 * UI-Thread, die Rechnung im Worker; eine zweite Umsetzung derselben Regel liefe irgendwann
 * auseinander, und dann trüge das Archiv einen Katalog, gegen den nie gerechnet wurde. Eine
 * Definition, zwei Aufrufer.
 */
export function applyBatteryOverride(
  catalog: BatteryCandidate[],
  override: BatteryOverride | undefined,
): BatteryCandidate[] {
  if (!override) return catalog
  return catalog.map((b) =>
    b.id === override.batteryId
      ? {
          ...b,
          ...(override.roundTripEfficiency != null
            ? { roundTripEfficiency: override.roundTripEfficiency }
            : {}),
          ...(override.pricePerKwh != null ? { pricePerKwh: override.pricePerKwh } : {}),
        }
      : b,
  )
}
