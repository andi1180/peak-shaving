// „Ihre PV-Anlage" (22.09.2026): der rekonstruierte Lastgang OHNE die bestehende Anlage. Die
// Gegenrichtung zu `applyEstimatedPv` — addiert statt abgezogen, s. Kopf von `reconstruct.ts`.
export { addPvToGridDraw, monthlyPvGeneration, zeroPvOutageMonths } from './reconstruct'
export type { PvMonthRef } from './reconstruct'
