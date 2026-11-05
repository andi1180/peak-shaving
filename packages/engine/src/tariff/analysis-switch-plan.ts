import {
  analysisWindow,
  type LoadProfile,
  type MonthlyTariffComparison,
  type SwitchPlanInsufficientReason,
  type TariffSwitchPlan,
} from 'shared'

import { computeSwitchPlan } from './switch-plan'

const MIN_COVERED_DAYS = 365
const MAX_COVERED_DAYS = 367
const MINUTES_PER_DAY = 24 * 60

/**
 * Prüft die Spanne, nicht die Zahl der Messwerte: innere Lücken zählen hier bewusst nicht.
 * Der letzte Slot läuft noch bis zu seinem Ende, sonst fiele ein volles Jahr auf 364,99 Tage.
 */
function coverageProblemOf(profile: LoadProfile): SwitchPlanInsufficientReason | null {
  const window = analysisWindow(profile)
  if (window === null) return 'short_period'
  const spanMinutes = (Date.parse(window.endIso) - Date.parse(window.startIso)) / 60_000
  const coveredDays = (spanMinutes + profile.intervalMinutes) / MINUTES_PER_DAY
  if (coveredDays < MIN_COVERED_DAYS) return 'short_period'
  if (coveredDays > MAX_COVERED_DAYS) return 'overlap'
  return null
}

/**
 * Fix (Weg 2) gegen Börse ohne Speicher (Weg 3) über die gemessenen Kalendermonate. `undefined`
 * ohne Vergleichstarif: dann gibt es keine zwei Tarife, und das Ergebnisfeld entfällt.
 */
export function tariffSwitchPlanOf(
  profile: LoadProfile,
  comparison: MonthlyTariffComparison | undefined,
): TariffSwitchPlan | undefined {
  if (!comparison?.comparisonTariffEur) return undefined

  const problem = coverageProblemOf(profile)
  if (problem !== null) return { status: 'insufficient_data', reason: problem }

  return computeSwitchPlan([
    { id: 'comparison', monthlyEur: comparison.comparisonTariffEur },
    { id: 'spot', monthlyEur: comparison.spotWithoutControlEur },
  ])
}
