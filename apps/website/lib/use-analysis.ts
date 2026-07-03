'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnalysisResult } from 'shared'
import type { CalculatorPayload } from '@/components/flow/types'
import type { AnalysisRequest, WorkerOutbound } from './analysis-protocol'

export type AnalysisStatus = 'idle' | 'running' | 'done' | 'error'

/**
 * Hook, der den Analyse-Worker verwaltet (spawn, Progress, Ergebnis, Cleanup).
 * Die Off-Main-Thread-Architektur ist real; im Worker sitzt vorerst der Mock (U1).
 */
export function useAnalysis() {
  const workerRef = useRef<Worker | null>(null)
  const [status, setStatus] = useState<AnalysisStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)

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
      } else if (msg.type === 'error') {
        setError(msg.message)
        setStatus('error')
      }
    }

    worker.onerror = (event) => {
      setError(event.message || 'Worker-Fehler')
      setStatus('error')
    }

    const request: AnalysisRequest = { type: 'run', payload }
    worker.postMessage(request)
  }, [])

  const reset = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    setStatus('idle')
    setProgress(0)
    setResult(null)
    setError(null)
  }, [])

  return { status, progress, result, error, start, reset }
}
