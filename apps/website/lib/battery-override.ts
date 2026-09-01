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

/*
 * ── ⚠ WAS HIER BIS ZUM 01.09.2026 STAND UND WARUM ES ENTFALLEN IST ────────────────────────────
 * `resolveBatteryOverride` und `overrideSourceFor`: die Regeln, nach denen ein aus einem Freitext
 * bestätigter Speicher (`batteryPreset`) eine Live-Neuberechnung überlebte und dabei seine
 * Herkunft `existing` behielt. Beide waren nötig, weil dieser Speicher ein OVERRIDE auf einen
 * Katalog-Kandidaten war — und ein Override ist genau das, was das Annahmen-Panel bei jedem
 * Tastendruck neu bildet oder weglässt. Vergass ein Aufrufer die Auflösung, verschwand die Angabe
 * des Kunden lautlos (gemessener Defekt vom selben Tag).
 *
 * Seit die bestehende Anlage ein EIGENES Feld des `CalculatorPayload` ist
 * (`existingBattery`, s. `components/flow/types.ts`) und ausserhalb von `perBattery` simuliert
 * wird, gibt es nichts mehr aufzulösen: beide Worker-Handler bekommen den vollen Payload, das
 * Feld reist bei jeder Nachricht unverändert mit. Der Defekt ist damit nicht behoben, sondern
 * strukturell unmöglich geworden.
 *
 * `BatteryOverride.source` bleibt am Typ (`analysis-protocol.ts`): das Analyse-Bündel führt es
 * seit Fassung 3, und ein Bündel aus dieser Zeit muss lesbar bleiben. Neu entsteht ausschliesslich
 * `catalog_preset` — die einzige Herkunft, die ein Override auf einen KATALOG-Kandidaten haben
 * kann.
 */
