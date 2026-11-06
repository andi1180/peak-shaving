import {
  analysisWindow,
  type LoadProfile,
  type MonthlyTariffComparison,
  type SwitchPlanInsufficientReason,
  type TariffSwitchPlan,
} from 'shared'

import { utcMsToLocalFields } from '../parser/datetime'
import { computeSwitchPlan } from './switch-plan'

const MIN_COVERED_DAYS = 365
const MAX_COVERED_DAYS = 367
const MS_PER_DAY = 24 * 60 * 60 * 1000

function localDayNumber(iso: string, timeZone: string): number {
  const { year, month, day } = utcMsToLocalFields(Date.parse(iso), timeZone)
  return Date.UTC(year, month - 1, day) / MS_PER_DAY
}

/**
 * Prüft die Spanne, nicht die Zahl der Messwerte: innere Lücken zählen hier bewusst nicht.
 * Gezählt werden lokale Kalendertage inklusive beider Enden, sonst fiele ein Jahr über die
 * Zeitumstellung oder mit angebrochenem letztem Tag unter 365.
 */
function coverageProblemOf(profile: LoadProfile): SwitchPlanInsufficientReason | null {
  const window = analysisWindow(profile)
  if (window === null) return 'short_period'
  const timeZone = profile.timezoneMeta
  const coveredDays = localDayNumber(window.endIso, timeZone) - localDayNumber(window.startIso, timeZone) + 1
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
