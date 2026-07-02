'use client'

import { useEffect, useState } from 'react'

import { useAnalysis } from '@/lib/use-analysis'
import { Stepper } from './stepper'
import { StepAnalyzing } from './step-analyzing'
import { StepResult } from './step-result'
import { StepTariff } from './step-tariff'
import { StepUpload } from './step-upload'
import type { CalculatorPayload, TariffResult } from './types'

type Step = 1 | 2 | 3 | 4

// Orchestriert den 4-Schritt-Flow (§5). Hält Schritt-State + gesammelte Daten im Client.
export function Calculator() {
  const [step, setStep] = useState<Step>(1)
  const [file, setFile] = useState<File | null>(null)
  const analysis = useAnalysis()

  // Analyse fertig → automatisch zum Ergebnis.
  useEffect(() => {
    if (step === 3 && analysis.status === 'done') setStep(4)
  }, [step, analysis.status])

  function handleUpload(f: File) {
    setFile(f)
    setStep(2)
  }

  function handleTariff(result: TariffResult) {
    const payload: CalculatorPayload = { ...result, fileName: file?.name ?? null }
    setStep(3)
    analysis.start(payload) // Off-Main-Thread; im Worker sitzt vorerst der Mock (U1).
  }

  function handleRestart() {
    analysis.reset()
    setFile(null)
    setStep(1)
  }

  // Schritte 1–3 schmal & fokussiert; das Ergebnis (Report) nutzt die volle Breite.
  const narrow = step !== 4

  return (
    <div className="flex flex-col gap-8 py-8">
      <div className="mx-auto w-full max-w-2xl px-4 sm:px-6">
        <Stepper current={step} />
      </div>

      {narrow ? (
        <div className="mx-auto w-full max-w-2xl px-4 sm:px-6">
          {step === 1 && <StepUpload initialFile={file} onComplete={handleUpload} />}
          {step === 2 && <StepTariff onBack={() => setStep(1)} onComplete={handleTariff} />}
          {step === 3 && <StepAnalyzing progress={analysis.progress} status={analysis.status} />}
        </div>
      ) : (
        analysis.result && <StepResult result={analysis.result} onRestart={handleRestart} />
      )}
    </div>
  )
}
