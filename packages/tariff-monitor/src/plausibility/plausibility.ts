import type { PlausibilityWarning, TariffCostObject, UserTariffInput } from '../types'
import {
  ENERGY_PRICE_MAX_CT,
  ENERGY_PRICE_MIN_CT,
  INVOICE_RECONCILE_TOLERANCE_RATIO,
  TABLE_PRICE_TOLERANCE_CT,
  TOTAL_PRICE_SUSPECT_MAX_CT,
  TOTAL_PRICE_SUSPECT_MIN_CT,
} from './constants'

/**
 * Plausibilitäts-Automatik, gestuft (§5.3). Fängt den häufigsten/gefährlichsten Fehler ab:
 * Nutzer trägt den GESAMTPREIS (inkl. Netz+Steuer, ~25–35 ct) ein, obwohl nur der Energiepreis
 * des Lieferanten gefragt war (§1.4). Vier Stufen, jede liefert 0..n `PlausibilityWarning`.
 *
 * Stufe 3 (Tabellen-Abgleich) und Stufe 4 (Rechnungs-Rückrechnung) rechnen NUR, wenn ihr
 * jeweiliges injiziertes Argument vorhanden ist — fehlt es, schweigt die Stufe komplett (kein
 * Alarm, kein Platzhalter-Warning). Die Stufen schalten sich damit über die ARGUMENTE frei, nicht
 * über Code-Zweige: dieselbe Funktion deckt T1 (nur Stufe 1+2 aktiv), T2 (+ `matchedTariff`) und
 * T6 (+ `invoiceTotalEur`/`gridCostEstimate`) unverändert ab.
 */
export function checkPlausibility(
  userInput: UserTariffInput,
  matchedTariff?: TariffCostObject,
  invoiceTotalEur?: number,
  gridCostEstimate?: { baseFeeEur: number; taxesCtPerKwh: number },
): PlausibilityWarning[] {
  const warnings: PlausibilityWarning[] = []

  const rangeWarning = checkRange(userInput)
  if (rangeWarning) warnings.push(rangeWarning)

  const suspicionWarning = checkTotalPriceSuspicion(userInput)
  if (suspicionWarning) warnings.push(suspicionWarning)

  if (matchedTariff) {
    const tableWarning = checkAgainstMatchedTariff(userInput, matchedTariff)
    if (tableWarning) warnings.push(tableWarning)
  }

  if (invoiceTotalEur !== undefined && gridCostEstimate) {
    const reconcileWarning = checkInvoiceReconciliation(userInput, invoiceTotalEur, gridCostEstimate)
    if (reconcileWarning) warnings.push(reconcileWarning)
  }

  return warnings
}

/**
 * Stufe 1 (§5.3 Punkt 1, immer aktiv): reiner Sanity-Bereich, unabhängig von Stufe 2 geprüft.
 * Mit den AKTUELLEN Default-Grenzwerten (`./constants.ts`) ist das Verdachtsband der Stufe 2 eine
 * echte Teilmenge dieses Korridors — ein Wert kann beide Stufen also nie gleichzeitig auslösen.
 * Das ist eine Eigenschaft der KONSTANTEN, nicht der Logik hier: die beiden Checks fragen ihre
 * eigene Schwelle unabhängig ab (kein `else`, keine Deduplizierung) und würden bei künftig
 * überlappenden Grenzwerten (Martin, §12 #4) unverändert gemeinsam feuern.
 */
function checkRange(userInput: UserTariffInput): PlausibilityWarning | undefined {
  const price = userInput.energyPriceCtPerKwh
  if (price >= ENERGY_PRICE_MIN_CT && price <= ENERGY_PRICE_MAX_CT) return undefined

  return {
    stage: 1,
    field: 'energyPriceCtPerKwh',
    message:
      `Energiepreis ${price} ct/kWh liegt außerhalb des plausiblen Korridors ` +
      `(${ENERGY_PRICE_MIN_CT}–${ENERGY_PRICE_MAX_CT} ct/kWh) — bitte prüfen.`,
  }
}

/** Stufe 2 (§5.3 Punkt 2, immer aktiv): der eigentliche §1.4-Kernfehler — Gesamtpreis statt Energiepreis eingetragen. */
function checkTotalPriceSuspicion(userInput: UserTariffInput): PlausibilityWarning | undefined {
  const price = userInput.energyPriceCtPerKwh
  if (price < TOTAL_PRICE_SUSPECT_MIN_CT || price > TOTAL_PRICE_SUSPECT_MAX_CT) return undefined

  return {
    stage: 2,
    field: 'energyPriceCtPerKwh',
    message:
      `${price} ct/kWh sieht nach dem Gesamtpreis inkl. Netz und Steuern aus — wir brauchen nur ` +
      'den Energiepreis Ihres Lieferanten (ohne Netzkosten und Abgaben).',
  }
}

/** Stufe 3 (§5.3 Punkt 3, nur mit `matchedTariff`): stärkster Check, prüft gegen echte Scraping-Daten (T2). */
function checkAgainstMatchedTariff(
  userInput: UserTariffInput,
  matchedTariff: TariffCostObject,
): PlausibilityWarning | undefined {
  const deviation = Math.abs(userInput.energyPriceCtPerKwh - matchedTariff.energyPriceCtPerKwh)
  if (deviation <= TABLE_PRICE_TOLERANCE_CT) return undefined

  return {
    stage: 3,
    field: 'energyPriceCtPerKwh',
    message:
      `Eingegebener Energiepreis (${userInput.energyPriceCtPerKwh} ct/kWh) weicht um mehr als ` +
      `${TABLE_PRICE_TOLERANCE_CT} ct/kWh vom für ${matchedTariff.providerName} ${matchedTariff.tariffName} ` +
      `hinterlegten Tabellenpreis (${matchedTariff.energyPriceCtPerKwh} ct/kWh) ab — bitte prüfen.`,
  }
}

/**
 * Stufe 4 (§5.3 Punkt 4, nur mit `invoiceTotalEur` UND `gridCostEstimate`): rekonstruiert den
 * erwarteten Jahres-Rechnungsbetrag aus Energiepreis + Grundgebühr + geschätzten Netzkosten/
 * Steuern und vergleicht ihn gegen den von der KI zusätzlich extrahierten Gesamtbetrag (§5.2,
 * §14-DoD „Rechnungs-Rückrechnung erkennt widersprüchliche Extraktion"). Relative Abweichung
 * bezogen auf `invoiceTotalEur` (der tatsächlich auf der Rechnung stehende, beobachtete Wert —
 * nicht auf `expected`, die eigene Schätzung).
 *
 * [ENTSCHEIDUNG] `field: 'energyPriceCtPerKwh'`, nicht `'invoiceTotal'`: `invoiceTotalEur` ist
 * kein Formularfeld (§5.3 Punkt 4 — „nicht zur Anzeige, sondern zur Selbstvalidierung"), eine UI
 * kann dort nichts markieren. `energyPriceCtPerKwh` ist zudem der Wert, der beim §1.4-Kernfehler
 * am häufigsten falsch sitzt — die Warnung bleibt damit umsetzbar (Feld im Formular hervorhebbar)
 * und konsistent mit den Stufen 1–3.
 */
function checkInvoiceReconciliation(
  userInput: UserTariffInput,
  invoiceTotalEur: number,
  gridCostEstimate: { baseFeeEur: number; taxesCtPerKwh: number },
): PlausibilityWarning | undefined {
  const energyShare = (userInput.energyPriceCtPerKwh / 100) * userInput.annualConsumptionKwh
  const taxesShare = (gridCostEstimate.taxesCtPerKwh / 100) * userInput.annualConsumptionKwh
  const expected = energyShare + userInput.baseFeeEurPerYear + gridCostEstimate.baseFeeEur + taxesShare

  const deviationRatio = Math.abs(expected - invoiceTotalEur) / invoiceTotalEur
  if (deviationRatio <= INVOICE_RECONCILE_TOLERANCE_RATIO) return undefined

  return {
    stage: 4,
    field: 'energyPriceCtPerKwh',
    message:
      'Rückrechnung aus Energiepreis, Grundgebühr und geschätzten Netzkosten/Steuern ergibt ca. ' +
      `€${expected.toFixed(0)}/Jahr — das weicht mehr als ${(INVOICE_RECONCILE_TOLERANCE_RATIO * 100).toFixed(0)}% ` +
      `vom angegebenen Rechnungsbetrag (€${invoiceTotalEur.toFixed(0)}/Jahr) ab. Die Extraktion ist vermutlich ` +
      'widersprüchlich — bitte Energiepreis prüfen.',
  }
}
