import { findLevyPeriod, type LoadProfile, type TariffPricingInputs } from 'shared'

import { utcMsToLocalFields } from '../parser/datetime'

/**
 * Der Aufschlag der Gebrauchsabgabe auf ein Netzentgelt über den Lastgang-Zeitraum, als Faktor
 * `1 + Satz` — gemittelt über die belegten lokalen Kalendertage.
 *
 * Gebraucht für den Leistungspreis: Wiener GAG Tarif C Post 1 erfasst ALLE Einnahmen des
 * Netzbetreibers, also auch ihn. Tagesgewichtet, weil der Satz datiert ist (6 % → 7 % am
 * 01.03.2026) und der Leistungspreis als Jahresgrösse über den ganzen Zeitraum gerechnet wird.
 *
 * ⚠ Ein Tag OHNE Abgabenzeitraum zählt mit Faktor 1. Anders als beim Tarifvergleich wird hier
 * nicht verweigert: der Leistungspreis ist auch ohne Abgaben eine belegte Zahl, und ihn wegen einer
 * fehlenden Abgabe zu streichen wäre der grössere Fehler. Ohne `pricing` gilt dasselbe.
 */
export function usageLevyFactor(loadProfile: LoadProfile, pricing: TariffPricingInputs | undefined): number {
  const periods = pricing?.levies?.periods ?? []
  if (periods.length === 0) return 1

  const days = new Set<string>()
  for (const reading of loadProfile.readings) {
    const { year, month, day } = utcMsToLocalFields(Date.parse(reading.ts), loadProfile.timezoneMeta)
    days.add(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
  }
  if (days.size === 0) return 1

  let sum = 0
  for (const date of days) sum += 1 + (findLevyPeriod(periods, date)?.gebrauchsabgabeRate ?? 0)
  return sum / days.size
}
