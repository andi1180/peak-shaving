/**
 * localStorage-Persistenz des Gratis-Check-Formulars (§6 Schritt 3, §10).
 *
 * Rein clientseitig, verlässt das Gerät nie — kein Fetch, kein Supabase-Import
 * hier. `try`/`catch` um jeden Zugriff: Safaris privater Modus und blockierte
 * Drittanbieter-Daten werfen — ein Gratis-Check, der deswegen abstürzt, wäre
 * der schlimmere Fehler als einer, der sich nichts merkt.
 */
import type { GratisCheckRawValues } from './schema'

export const GRATIS_CHECK_STORAGE_KEY = 'coolin.monitor.gratis-check'

function isGratisCheckRawValues(value: unknown): value is GratisCheckRawValues {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.annualConsumptionKwh === 'string' &&
    typeof v.energyPriceCtPerKwh === 'string' &&
    typeof v.baseFeeAmount === 'string' &&
    (v.baseFeeUnit === 'monthly' || v.baseFeeUnit === 'annual') &&
    typeof v.postalCode === 'string'
  )
}

/**
 * `null` sowohl bei „nichts gespeichert" als auch bei kaputtem/fremdem Inhalt
 * (fremde Origin-Daten, älteres/anderes Schema) — beide Fälle laufen auf
 * denselben leeren Formularzustand hinaus, kein Unterschied für den Aufrufer.
 */
export function loadStoredGratisCheckValues(): GratisCheckRawValues | null {
  try {
    const raw = window.localStorage.getItem(GRATIS_CHECK_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isGratisCheckRawValues(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function saveGratisCheckValues(values: GratisCheckRawValues): void {
  try {
    window.localStorage.setItem(GRATIS_CHECK_STORAGE_KEY, JSON.stringify(values))
  } catch {
    // Speichern ist Komfort (§6), kein Muss — ein blockierter Zugriff darf
    // den Check selbst nicht stören.
  }
}

/** Für den „Neu eingeben"-Weg (§6: „einfaches Leeren/Neu-Eingeben möglich"). */
export function clearStoredGratisCheckValues(): void {
  try {
    window.localStorage.removeItem(GRATIS_CHECK_STORAGE_KEY)
  } catch {
    // s. o.
  }
}
