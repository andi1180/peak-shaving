// Spitzenerkennung & Ist-Kosten (§3.4).
export { analyzeCurrentPeaks } from './analyze'
export type { CurrentPeakAnalysis } from './analyze'
export {
  positiveAnnualPeakKw,
  positiveMonthlyPeaksKw,
  topPeaksKw,
  peakDistribution,
  TOP_PEAKS_N,
} from './metrics'
