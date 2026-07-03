import type { AnalysisResult } from 'shared'
import type { CalculatorPayload } from '@/components/flow/types'

// Nachrichten-Protokoll zwischen UI-Thread und Analyse-Worker. Der Payload trägt seit
// Prompt 2 den echten, geparsten Lastgang (CalculatorPayload). Seit Prompt 4 rechnet der
// Worker `current`/`peaks` (§3.4/§3.5) echt daraus; `perBattery`/`recommendation` bleiben
// gemockt, bis §3.6-3.8 stehen.

export type AnalysisRequest = {
  type: 'run'
  payload: CalculatorPayload
}

export type WorkerOutbound =
  | { type: 'progress'; value: number }
  | { type: 'result'; result: AnalysisResult }
  | { type: 'error'; message: string }
