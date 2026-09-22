// „Ihre PV-Anlage" (22.09.2026): der rekonstruierte Lastgang OHNE die bestehende Anlage. Die
// Gegenrichtung zu `applyEstimatedPv` — addiert statt abgezogen, s. Kopf von `reconstruct.ts`.
export {
  addPvToGridDraw,
  monthlyPvGeneration,
  PV_DAY_MIN_DEMAND_KWH,
  zeroPvDaysWithoutMiddayDemand,
  zeroPvOutageMonths,
  zeroPvWhereNoDemand,
} from './reconstruct'
export type { PvMonthRef } from './reconstruct'
