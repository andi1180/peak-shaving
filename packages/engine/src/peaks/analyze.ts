import type { AnalysisResult, LoadProfile, TariffParams } from 'shared'

import { getTariffStrategy } from '../tariff/strategy'
import { peakDistribution, positiveAnnualPeakKw, positiveMonthlyPeaksKw, topPeaksKw } from './metrics'

export type CurrentPeakAnalysis = Pick<AnalysisResult, 'current' | 'peaks'>

/**
 * Spitzenerkennung & Ist-Kosten (§3.4). Reine Funktion über den unveränderten
 * Ist-Lastgang — liefert exakt die Felder, die `AnalysisResult.current` und
 * `.peaks` erwarten. `billedKw`/`leistungspreisCostPerYear` gehen über die per
 * `tariffParams.billingModel` gewählte TariffStrategy (§3.5).
 */
export function analyzeCurrentPeaks(
  loadProfile: LoadProfile,
  tariffParams: TariffParams,
): CurrentPeakAnalysis {
  const annualPeakKw = positiveAnnualPeakKw(loadProfile)
  const monthlyPeaksKw = positiveMonthlyPeaksKw(loadProfile)
  const billedKw = getTariffStrategy(tariffParams.billingModel).billedKw(loadProfile, tariffParams)
  const leistungspreisCostPerYear = tariffParams.leistungspreisEurPerKwYear * billedKw

  return {
    current: { annualPeakKw, monthlyPeaksKw, billedKw, leistungspreisCostPerYear },
    peaks: {
      top: topPeaksKw(loadProfile),
      distribution: peakDistribution(loadProfile),
    },
  }
}
