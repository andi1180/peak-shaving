/**
 * Die Brücke zwischen der Datenschicht (B21-3a) und dem Rechenkern (Delta 4, B21-3b).
 *
 * ── WARUM ES DIESE STELLE GIBT ──────────────────────────────────────────────────────────────────
 * Die Engine darf die Datenschicht nicht kennen (Wächter:
 * `packages/engine/src/tariff/no-data-layer-dependency.test.ts`), und die Datenschicht kennt die
 * Engine nicht. Genau EIN Modul bringt beide zusammen: es holt die zwei Preisseiten für den
 * Zeitraum des Lastgangs (Delta 15 Regel A) und formt sie zu `TariffPricingInputs`.
 *
 * ── WAS HIER BEWUSST NICHT PASSIERT ─────────────────────────────────────────────────────────────
 * Kein Rückfall, keine Ersatzwerte, keine Interpolation. Scheitert eine Seite, steht an ihrer
 * Stelle `null` — und die Engine kennzeichnet den Tarifoptimierungs-Hebel als nicht berechenbar
 * (Delta 15 Regel C). Ein hier eingesetzter Vorgabewert wäre genau die stille Verschlechterung, die
 * niemandem als Fehler auffiele, sondern als Ergebnis.
 */
import { analysisWindow, type LoadProfile, type TariffPricingInputs } from 'shared'

import { analysisWindowToPriceRange, fetchGridTariffs, fetchSpotPrices } from './tariff-data'

/**
 * Beide Preisseiten für den Zeitraum des Lastgangs holen.
 *
 * `operatorId`/`netzebene` sind `null`, solange der Nutzer sie nicht gewählt hat. Dann wird die
 * Netzentgelt-Seite gar nicht erst angefragt: ohne Netzbetreiber gibt es keine Tarifzeile, und eine
 * Abfrage mit erfundenen Parametern lieferte entweder nichts oder — schlimmer — die Zeile eines
 * fremden Betreibers.
 *
 * ⚠ `meteringVariant` ist heute fest `null`. Das ist kein vergessener Parameter, sondern der
 * aktuelle Stand: eine Auswahl dafür gibt es in der Oberfläche noch nicht (Delta 9), und für die
 * Netzebenen 3–6 gehört ausdrücklich `null` in die Spalte (B21-1, `nulls not distinct`). Netzebene 7
 * — die einzige mit Varianten — wird vor der Tarifverordnung ohnehin verweigert (B11), erreicht
 * diese Stelle also nicht. Sobald Delta 9 die Auswahl bringt, wird daraus ein Parameter.
 */
export async function loadTariffPricing(
  loadProfile: LoadProfile,
  operatorId: string | null,
  netzebene: number | null,
): Promise<TariffPricingInputs> {
  const window = analysisWindow(loadProfile)
  if (!window) return { gridTariffRows: null, spotPrices: null }

  const priceRange = analysisWindowToPriceRange(window, loadProfile.intervalMinutes)

  // Beide Seiten parallel: sie hängen nicht voneinander ab, und nacheinander wäre der Nutzer
  // doppelt so lange am Warten, ohne dass die Antwort besser würde.
  const [gridResult, spotResult] = await Promise.all([
    operatorId != null && netzebene != null
      ? fetchGridTariffs(operatorId, netzebene, null, window.startIso, window.endIso)
      : Promise.resolve(null),
    fetchSpotPrices(priceRange.from, priceRange.to),
  ])

  return {
    gridTariffRows: gridResult?.ok ? gridResult.tariffs : null,
    spotPrices: spotResult.ok
      ? {
          prices: spotResult.prices,
          complete: spotResult.complete,
          missingRanges: spotResult.missingRanges,
        }
      : null,
  }
}
