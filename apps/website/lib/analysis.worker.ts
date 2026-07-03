import { analyzeCurrentPeaks } from 'engine'
import type { AnalysisResult } from 'shared'

import { mockAnalysisResult } from './mock-analysis'
import type { AnalysisRequest, WorkerOutbound } from './analysis-protocol'

/*
 * Analyse-Worker — läuft OFF-MAIN-THREAD (kein Tab-Freeze, §2.2/§5).
 *
 * ┌─ STAND (Prompt 4, TEILWEISE) ──────────────────────────────────────────────┐
 * │ `current` + `peaks` (§3.4/§3.5) sind ECHT: `analyzeCurrentPeaks()` läuft   │
 * │ gegen den echten geparsten Lastgang + die echten Tarifparameter aus dem    │
 * │ Formular. `perBattery` + `recommendation` sind WEITER MOCK — die hängen an │
 * │ der SoC-Simulation (§3.6), dem kombinierten Dispatch (§3.7) und dem        │
 * │ Empfehlungs-Ranking (§3.8), die noch nicht gebaut sind (blockiert auf      │
 * │ Martins Static-Control-Antwort). `dataQuality` ist bereits seit Prompt 2   │
 * │ echt; `assumptions` übernimmt zusätzlich die realen Tarifwerte, wo das     │
 * │ ohne SimulationConfig (horizonYears/roundTripEfficiency) möglich ist.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

// `self` im Worker-Scope; als Worker getypt, um unter der DOM-lib ohne
// webworker-lib-Konflikt korrekt postMessage(1 Argument) zu erlauben.
const ctx = self as unknown as Worker

function post(message: WorkerOutbound): void {
  ctx.postMessage(message)
}

ctx.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  const msg = event.data
  if (!msg || msg.type !== 'run') return

  // --- current/peaks: ECHTER Engine-Aufruf (§3.4/§3.5) ---
  const { current, peaks } = analyzeCurrentPeaks(msg.payload.load.profile, msg.payload.tariff)

  // --- perBattery/recommendation: weiter MOCK, bis §3.6-3.8 stehen ---
  const result: AnalysisResult = {
    ...mockAnalysisResult,
    current,
    peaks,
    assumptions: {
      ...mockAnalysisResult.assumptions,
      billingModel: msg.payload.tariff.billingModel,
      energyPriceCtPerKwh: msg.payload.tariff.energyPriceCtPerKwh,
      einspeiseverguetungCtPerKwh: msg.payload.tariff.einspeiseverguetungCtPerKwh,
    },
    dataQuality: msg.payload.load.dataQuality,
  }

  const progressSteps = [12, 34, 58, 81, 100]
  let step = 0

  const tick = () => {
    const value = progressSteps[step] ?? 100
    post({ type: 'progress', value })
    step += 1
    if (step < progressSteps.length) {
      setTimeout(tick, 320)
    } else {
      post({ type: 'result', result })
    }
  }

  setTimeout(tick, 250)
}
