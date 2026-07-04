'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AnalysisResult } from 'shared'
import type { CalculatorPayload } from '@/components/flow/types'
import type { AnalysisRequest, BatteryOverride, WorkerOutbound } from './analysis-protocol'

export type AnalysisStatus = 'idle' | 'running' | 'done' | 'error'

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

    const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url))
    workerRef.current = worker

    worker.onmessage = (event: MessageEvent<WorkerOutbound>) => {
      const msg = event.data
      if (msg.type === 'progress') {
        setProgress(msg.value)
      } else if (msg.type === 'result') {
        setResult(msg.result)
        setProgress(100)
        setStatus('done')
      } else if (msg.type === 'recomputed') {
        setLiveResult(msg.result)
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
      const request: AnalysisRequest = { type: 'recompute', payload, horizonYears, batteryOverride }
      worker.postMessage(request)
    },
    [],
  )

  // Reset-auf-Original (§6.2): kein Worker-Roundtrip nötig — `result` (Erstlauf) ist nie
  // überschrieben worden, einfach zurückschalten.
  const resetLive = useCallback(() => {
    setLiveResult(null)
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
  }, [])

  const displayResult = useMemo(() => liveResult ?? result, [liveResult, result])

  return {
    status,
    progress,
    result,
    error,
    start,
    reset,
    liveResult,
    displayResult,
    isLive: liveResult != null,
    recomputing,
    recomputeError,
    recompute,
    resetLive,
  }
}
