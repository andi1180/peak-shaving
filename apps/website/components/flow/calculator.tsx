'use client'

import { useEffect, useState } from 'react'

import { useAnalysis } from '@/lib/use-analysis'
import { Stepper } from './stepper'
import { StepAnalyzing } from './step-analyzing'
import { StepResult } from './step-result'
import { StepTariff } from './step-tariff'
import { StepUpload } from './step-upload'
import type { CalculatorPayload, ParsedLoad, TariffResult } from './types'

type Step = 1 | 2 | 3 | 4

// Orchestriert den 4-Schritt-Flow (§5). Hält Schritt-State + gesammelte Daten im Client.
export function Calculator() {
  const [step, setStep] = useState<Step>(1)
  const [load, setLoad] = useState<ParsedLoad | null>(null)
  // Original-Payload (Tarif/Finanzen/PV) — für das Annahmen-Panel (§6.2): `recompute()` braucht
  // die unveränderten `load`/`pv`, um sie mit editierten `tariff`/`financial` neu zu verschicken.
  const [payload, setPayload] = useState<CalculatorPayload | null>(null)
  const analysis = useAnalysis()

  // Analyse fertig → automatisch zum Ergebnis.
  useEffect(() => {
    if (step === 3 && analysis.status === 'done') setStep(4)
  }, [step, analysis.status])

  function handleUpload(l: ParsedLoad) {
    setLoad(l)
    setStep(2)
  }

  function handleTariff(result: TariffResult) {
    if (!load) return
    const p: CalculatorPayload = { ...result, load }
    setPayload(p)
    setStep(3)
    analysis.start(p) // Off-Main-Thread; komplettes AnalysisResult echt (§3.4-3.8, Prompt 4 abgeschlossen).
  }

  function handleRestart() {
    analysis.reset()
    setLoad(null)
    setPayload(null)
    setStep(1)
  }

  // Schritte 1–3 schmal & fokussiert; das Ergebnis (Report) nutzt die volle Breite.
  const narrow = step !== 4

  return (
    <div className="flex flex-col gap-8 py-8">
      <div className="mx-auto w-full max-w-2xl px-4 sm:px-6 print:hidden">
        <Stepper current={step} />
      </div>

      {narrow ? (
        <div className="mx-auto w-full max-w-2xl px-4 sm:px-6">
          {step === 1 && <StepUpload initialLoad={load} onComplete={handleUpload} />}
          {step === 2 && <StepTariff onBack={() => setStep(1)} onComplete={handleTariff} />}
          {step === 3 && <StepAnalyzing progress={analysis.progress} status={analysis.status} />}
        </div>
      ) : (
        analysis.displayResult &&
        load &&
        payload && (
          <StepResult
            result={analysis.displayResult}
            load={load}
            payload={payload}
            recomputing={analysis.recomputing}
            recomputeError={analysis.recomputeError}
            isLive={analysis.isLive}
            onRecompute={(input) =>
              analysis.recompute(
                { ...payload, tariff: input.tariff, financial: input.financial },
                input.horizonYears,
                input.batteryOverride,
              )
            }
            onResetAssumptions={analysis.resetLive}
            onRestart={handleRestart}
          />
        )
      )}
    </div>
  )
}
