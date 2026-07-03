import type { AnalysisResult } from 'shared'
import type { CalculatorPayload } from '@/components/flow/types'

// Nachrichten-Protokoll zwischen UI-Thread und Analyse-Worker. Der Payload trägt seit
// Prompt 2 den echten, geparsten Lastgang (CalculatorPayload); die Berechnung selbst ist
// im Worker weiter gemockt, bis Prompt 4 den echten Engine-Aufruf einhängt.

export type AnalysisRequest = {
  type: 'run'
  payload: CalculatorPayload
}

export type WorkerOutbound =
  | { type: 'progress'; value: number }
  | { type: 'result'; result: AnalysisResult }
  | { type: 'error'; message: string }
