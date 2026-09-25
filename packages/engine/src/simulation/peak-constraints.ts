import type { BatteryCandidate, LoadProfile, TariffParams } from 'shared'

import { searchCaps } from './cap-search'
import {
  capForIntervalSeries,
  drawSeries,
  intervalHours,
  periodIndexByInterval,
  periodSlotCount,
  toPhysics,
} from './helpers'
import { isPeakShavingDisabled } from './peak-shaving'
import { computeSocFloor } from './reserve'

/**
 * Die beiden Spitzenschutz-Schranken eines Kandidaten (§3.6 Schritte 1+2): Kapp-Schwelle je
 * Abrechnungsperiode und Reserve-Trajektorie `socFloor(t)`.
 *
 * ── WARUM EIN EIGENES MODUL ────────────────────────────────────────────────────────────────────
 * Weg a: der vorausschauend geplante Fahrplan und seine Rückblick-Obergrenze (`planning.ts`)
 * rechnen unter DENSELBEN Schranken, nur mit anderer Verbrauchserwartung — die Differenz der
 * beiden Zahlen liegt damit allein an der Prognose.
 */
export type PeakConstraints = {
  /** Kapp-Schwelle je Contract-Slot (§3.10): Länge 1 (`annual_max`) / 12 (`monthly_*`). */
  capKwByPeriod: number[]
  /** Dieselben Schwellen, aufgelöst je Intervall. */
  capForInterval: number[]
  /** Spitzen-Reserve je Intervall (kWh). */
  socFloorKwh: number[]
  /** War die Spitzenkappung gesperrt (`peakShavingBlockers`)? Dann `cap = ∞` und `socFloor ≡ 0`. */
  peakShavingDisabled: boolean
}

export function peakConstraints(
  loadProfile: LoadProfile,
  battery: BatteryCandidate,
  tariffParams: TariffParams,
): PeakConstraints {
  const physics = toPhysics(battery)
  const draws = drawSeries(loadProfile)
  const periodOfInterval = periodIndexByInterval(loadProfile, tariffParams.billingModel)
  const peakShavingDisabled = isPeakShavingDisabled(loadProfile, battery, tariffParams)

  // 1. Kapp-Suche (§3.6.1). Ohne Spitzenkappung → `cap = ∞` je Contract-Slot.
  const capKwByPeriod = peakShavingDisabled
    ? new Array<number>(periodSlotCount(tariffParams.billingModel)).fill(Infinity)
    : searchCaps(loadProfile, physics, tariffParams.billingModel).capKwByPeriod
  const capForInterval = capForIntervalSeries(capKwByPeriod, periodOfInterval)

  // 2. Spitzen-Reserve (§3.6-Kasten). Bei `cap = ∞` ergäbe `computeSocFloor` ohnehin überall 0.
  const socFloorKwh = peakShavingDisabled
    ? new Array<number>(draws.length).fill(0)
    : computeSocFloor(draws, capForInterval, physics, intervalHours(loadProfile))

  return { capKwByPeriod, capForInterval, socFloorKwh, peakShavingDisabled }
}
