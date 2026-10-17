import type { LoadProfile } from 'shared'

/**
 * Die Einspeisevergütung, die die Engine in „Ihr Tarif heute" gegenrechnet — über die Messwerte des
 * gemessenen Zeitraums, als positiver Betrag in €. Exakt die Formel aus
 * `engine/src/simulation/energy-cost.ts` (`intervalEnergyCostEur`): je Intervall mit negativem
 * Netzbezug kW × Intervalldauer × Satz / 100, ohne Abgaben, ohne Kappung, ohne Rundung.
 */
export function feedInCreditEur(
  loadProfile: Pick<LoadProfile, 'readings' | 'intervalMinutes'>,
  feedInCtPerKwh: number | null | undefined,
): number {
  if (!feedInCtPerKwh) return 0
  const deltaHours = loadProfile.intervalMinutes / 60
  let eur = 0
  for (const reading of loadProfile.readings) {
    if (reading.gridPowerKw < 0) eur -= (reading.gridPowerKw * feedInCtPerKwh * deltaHours) / 100
  }
  return eur
}
