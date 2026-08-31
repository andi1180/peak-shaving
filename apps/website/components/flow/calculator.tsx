'use client'

import { useEffect, useState } from 'react'

import { useAnalysis } from '@/lib/use-analysis'
import { Stepper } from './stepper'
import { StepAnalyzing } from './step-analyzing'
import { StepResult } from './step-result'
import { StepTariff } from './step-tariff'
import { StepUpload } from './step-upload'
import type { CalculatorPayload, ParsedLoad, TariffPrefill, TariffResult } from './types'

type Step = 1 | 2 | 3 | 4

// Orchestriert den 4-Schritt-Flow (§5). Hält Schritt-State + gesammelte Daten im Client.
export function Calculator() {
  const [step, setStep] = useState<Step>(1)
  const [load, setLoad] = useState<ParsedLoad | null>(null)
  /*
   * Delta 9b-2b: die aus einer Rechnung abgelesenen Tarifangaben. Sie hängen NICHT an `ParsedLoad`,
   * obwohl sie im selben Schritt entstehen — ein `LoadProfile` ist der Verbrauch, und ein
   * Tarifsatz gehört nicht hinein. In `ParsedLoad` mitgeführt reiste er ausserdem in das
   * Analyse-Bündel (B14-2), wo die Tarifwerte längst denormalisiert stehen; er stünde dort ein
   * zweites Mal und könnte von den gerechneten abweichen.
   */
  const [tariffPrefill, setTariffPrefill] = useState<TariffPrefill | undefined>(undefined)
  // Original-Payload (Tarif/Finanzen/PV) — für das Annahmen-Panel (§6.2): `recompute()` braucht
  // die unveränderten `load`/`pv`, um sie mit editierten `tariff`/`financial` neu zu verschicken.
  const [payload, setPayload] = useState<CalculatorPayload | null>(null)
  const analysis = useAnalysis()

  // Analyse fertig → automatisch zum Ergebnis.
  useEffect(() => {
    if (step === 3 && analysis.status === 'done') setStep(4)
  }, [step, analysis.status])

  function handleUpload(l: ParsedLoad, prefill?: TariffPrefill) {
    setLoad(l)
    /*
     * Auch das LEERE Ergebnis wird übernommen: wer zurückgeht und statt der Rechnung eine
     * Lastgang-Datei wählt, darf nicht die Tarifwerte der vorigen Rechnung im Formular vorfinden.
     * `setTariffPrefill(prefill)` statt `if (prefill)` — die Zuweisung IST das Zurücksetzen.
     */
    setTariffPrefill(prefill)
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
    setTariffPrefill(undefined)
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
          {step === 2 && load && (
            <StepTariff
              // B21-3b: nur für den ZEITRAUM der Preisabfragen (Delta 15 Regel A) — die Messwerte
              // selbst bleiben im Browser (Prinzip 4).
              loadProfile={load.profile}
              // Delta 9b-2b: vorbelegt aus dem Rechnungs-Scan, sonst `undefined` (= wie vorher).
              prefill={tariffPrefill}
              onBack={() => setStep(1)}
              onComplete={handleTariff}
            />
          )}
          {step === 3 && <StepAnalyzing progress={analysis.progress} status={analysis.status} />}
        </div>
      ) : (
        analysis.displayResult &&
        load &&
        payload && (
          <StepResult
            result={analysis.displayResult}
            // B14-2: die Eingaben GENAU zu `displayResult` — der Hook führt beide paarweise, damit
            // ein Bündel keine Eingaben zu einem anderen Ergebnis mitschreiben kann.
            inputs={analysis.displayInputs}
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
