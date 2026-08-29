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
 * ⚠ `meteringVariant` ist seit Delta 9a ein echter Parameter (vorher fest `null`). Er MUSS `null`
 * sein, wo die Netzebene keine Variante anbietet — bei NE 3–6 steht in der Spalte `null`, und die
 * Abfrage filtert dort ausdrücklich auf `IS NULL` (B21-1, `nulls not distinct`). Eine mitgeschickte
 * Variante fände dort keine Zeile, und der Hebel fiele mit „keine Netzentgelt-Daten" aus, obwohl die
 * Daten gepflegt sind. Die Entscheidung darüber trifft die Oberfläche (`hasMeteringVariant`), nicht
 * diese Funktion: sie reicht durch, was sie bekommt.
 */
export async function loadTariffPricing(
  loadProfile: LoadProfile,
  operatorId: string | null,
  netzebene: number | null,
  meteringVariant: string | null,
): Promise<TariffPricingInputs> {
  const window = analysisWindow(loadProfile)
  if (!window) return { gridTariffRows: null, spotPrices: null }

  const priceRange = analysisWindowToPriceRange(window, loadProfile.intervalMinutes)

  // Beide Seiten parallel: sie hängen nicht voneinander ab, und nacheinander wäre der Nutzer
  // doppelt so lange am Warten, ohne dass die Antwort besser würde.
  const [gridResult, spotResult] = await Promise.all([
    operatorId != null && netzebene != null
      ? fetchGridTariffs(operatorId, netzebene, meteringVariant, window.startIso, window.endIso)
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
