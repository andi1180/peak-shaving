'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AnalysisResult, FinancialParams, TariffParams } from 'shared'
import type { CalculatorPayload } from '@/components/flow/types'
import type { AnalysisRequest, BatteryOverride, WorkerOutbound } from './analysis-protocol'

export type AnalysisStatus = 'idle' | 'running' | 'done' | 'error'

/**
 * B14-2: die Eingangsgrössen, die GENAU das gerade angezeigte Ergebnis erzeugt haben.
 *
 * ── WARUM DER HOOK DAS FÜHRT UND NICHT DIE OBERFLÄCHE ───────────────────────────────────────────
 * `displayResult` ist entweder der Erstlauf oder eine Live-Neuberechnung (§6.2). Wer das Ergebnis
 * archiviert, muss die Eingaben mitgeben, die dazu gehören — und zwar die des ANGEZEIGTEN Laufs,
 * nicht die zuletzt ins Formular getippten. Beides fällt auseinander, sobald eine Neuberechnung
 * noch läuft (die Eingabe ist schon neu, das Ergebnis noch alt) oder fehlgeschlagen ist. Deshalb
 * entsteht dieser Datensatz erst, WENN das Ergebnis eintrifft, und immer im selben Schritt.
 *
 * `horizonYears` wird aus dem Ergebnis gelesen (`assumptions.horizonYears`) und nicht aus der
 * Anfrage: der Worker sagt damit selbst, womit er gerechnet hat.
 */
export type AnalysisRunInputs = {
  /** Wann die RECHNUNG fertig war — nicht wann exportiert wurde. */
  computedAt: string
  tariff: TariffParams
  financial?: FinancialParams
  horizonYears: number
  batteryOverride?: BatteryOverride
}

/**
 * Hook, der den Analyse-Worker verwaltet (spawn, Progress, Ergebnis, Cleanup).
 * Die Off-Main-Thread-Architektur ist real; seit Prompt 4 (abgeschlossen) ist das komplette
 * `AnalysisResult` echt berechnet (`current`/`peaks` §3.4/§3.5, `perBattery`/`recommendation`
 * §3.6-3.8) — kein Mock mehr im Worker.
 *
 * Seit U2 Prompt C (§6.2, editierbares Annahmen-Panel): `recompute()` schickt eine zusätzliche
 * Nachricht an DENSELBEN, bereits laufenden Worker (kein Neu-Spawn — Architektur-Vorgabe „muss
 * über den bestehenden Web Worker laufen"). Das Ergebnis landet in `liveResult`, NICHT in
 * `result` — `result` bleibt das unangetastete Original des ersten Laufs, damit `resetLive()`
 * ohne einen weiteren Worker-Roundtrip sofort dorthin zurückspringen kann (§6.2 „Reset-auf-
 * Original-Kontrolle"). `displayResult` ist der eine Wert, den die UI tatsächlich rendert.
 */
export function useAnalysis() {
  const workerRef = useRef<Worker | null>(null)
  const [status, setStatus] = useState<AnalysisStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [liveResult, setLiveResult] = useState<AnalysisResult | null>(null)
  const [recomputing, setRecomputing] = useState(false)
  const [recomputeError, setRecomputeError] = useState<string | null>(null)

  // B14-2: die Eingaben zum jeweils angezeigten Lauf. In Refs gehalten, bis das Ergebnis eintrifft —
  // eine angefangene, noch nicht beantwortete Neuberechnung darf die Zuordnung nicht verschieben.
  const [resultInputs, setResultInputs] = useState<AnalysisRunInputs | null>(null)
  const [liveInputs, setLiveInputs] = useState<AnalysisRunInputs | null>(null)
  const pendingRunRef = useRef<Omit<AnalysisRunInputs, 'computedAt' | 'horizonYears'> | null>(null)
  const pendingLiveRef = useRef<Omit<AnalysisRunInputs, 'computedAt' | 'horizonYears'> | null>(null)
  // Nur für `onmessage` (einmal pro Worker gesetzt) sichtbar, ob ein `error` gerade zu einem
  // `run` oder einem `recompute` gehört — React-State im Closure wäre hier bei Erstellung des
  // Handlers eingefroren (stale closure), ein Ref liest immer den aktuellen Wert.
  const recomputingRef = useRef(false)

  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

  const start = useCallback((payload: CalculatorPayload) => {
    workerRef.current?.terminate()
    setStatus('running')
    setProgress(0)
    setResult(null)
    setError(null)
    setLiveResult(null)
    setRecomputing(false)
    setRecomputeError(null)
    recomputingRef.current = false
    setResultInputs(null)
    setLiveInputs(null)
    pendingRunRef.current = { tariff: payload.tariff, financial: payload.financial }
    pendingLiveRef.current = null

    const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url))
    workerRef.current = worker

    worker.onmessage = (event: MessageEvent<WorkerOutbound>) => {
      const msg = event.data
      if (msg.type === 'progress') {
        setProgress(msg.value)
      } else if (msg.type === 'result') {
        setResult(msg.result)
        const pending = pendingRunRef.current
        if (pending) {
          setResultInputs({
            ...pending,
            computedAt: new Date().toISOString(),
            horizonYears: msg.result.assumptions.horizonYears,
          })
        }
        setProgress(100)
        setStatus('done')
      } else if (msg.type === 'recomputed') {
        setLiveResult(msg.result)
        const pending = pendingLiveRef.current
        if (pending) {
          setLiveInputs({
            ...pending,
            computedAt: new Date().toISOString(),
            horizonYears: msg.result.assumptions.horizonYears,
          })
        }
        setRecomputing(false)
        recomputingRef.current = false
      } else if (msg.type === 'error') {
        if (recomputingRef.current) {
          setRecomputeError(msg.message)
          setRecomputing(false)
          recomputingRef.current = false
        } else {
          setError(msg.message)
          setStatus('error')
        }
      }
    }

    worker.onerror = (event) => {
      if (recomputingRef.current) {
        setRecomputeError(event.message || 'Neuberechnung fehlgeschlagen')
        setRecomputing(false)
        recomputingRef.current = false
      } else {
        setError(event.message || 'Worker-Fehler')
        setStatus('error')
      }
    }

    const request: AnalysisRequest = { type: 'run', payload }
    worker.postMessage(request)
  }, [])

  // Live-Neuberechnung (§6.2): läuft über denselben Worker, OHNE die künstliche
  // Fortschrittsanimation des Erstlaufs — fühlt sich dadurch tatsächlich live an. Immer der
  // VOLLE Katalog (Architektur-Vorgabe), `batteryOverride` betrifft nur den einen bearbeiteten
  // Kandidaten (Worker wendet die modifizierte Kopie an, s. analysis.worker.ts).
  const recompute = useCallback(
    (payload: CalculatorPayload, horizonYears: number, batteryOverride?: BatteryOverride) => {
      const worker = workerRef.current
      if (!worker) return
      recomputingRef.current = true
      setRecomputing(true)
      setRecomputeError(null)
      pendingLiveRef.current = {
        tariff: payload.tariff,
        financial: payload.financial,
        batteryOverride,
      }
      const request: AnalysisRequest = { type: 'recompute', payload, horizonYears, batteryOverride }
      worker.postMessage(request)
    },
    [],
  )

  // Reset-auf-Original (§6.2): kein Worker-Roundtrip nötig — `result` (Erstlauf) ist nie
  // überschrieben worden, einfach zurückschalten.
  const resetLive = useCallback(() => {
    setLiveResult(null)
    setLiveInputs(null)
    pendingLiveRef.current = null
    setRecomputeError(null)
  }, [])

  const reset = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    setStatus('idle')
    setProgress(0)
    setResult(null)
    setError(null)
    setLiveResult(null)
    setRecomputing(false)
    setRecomputeError(null)
    recomputingRef.current = false
    setResultInputs(null)
    setLiveInputs(null)
    pendingRunRef.current = null
    pendingLiveRef.current = null
  }, [])

  const displayResult = useMemo(() => liveResult ?? result, [liveResult, result])
  // Immer PAARWEISE mit `displayResult` — dieselbe Vorrangregel, damit Ergebnis und Eingaben eines
  // Bündels nachweislich zusammengehören.
  const displayInputs = useMemo(
    () => (liveResult ? liveInputs : resultInputs),
    [liveResult, liveInputs, resultInputs],
  )

  return {
    status,
    progress,
    result,
    error,
    start,
    reset,
    liveResult,
    displayResult,
    displayInputs,
    isLive: liveResult != null,
    recomputing,
    recomputeError,
    recompute,
    resetLive,
  }
}
