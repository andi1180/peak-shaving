import type { AnalysisResult } from 'shared'
import type { CalculatorPayload } from '@/components/flow/types'

// Nachrichten-Protokoll zwischen UI-Thread und Analyse-Worker. Der Payload trägt seit
// Prompt 2 den echten, geparsten Lastgang (CalculatorPayload). Seit Prompt 4 (abgeschlossen)
// rechnet der Worker das komplette `AnalysisResult` echt daraus — `current`/`peaks` (§3.4/§3.5)
// und `perBattery`/`recommendation` (§3.6–§3.8, gegen den `DEMO_BATTERY_CATALOG`).

export type AnalysisRequest = {
  type: 'run'
  payload: CalculatorPayload
}

export type WorkerOutbound =
  | { type: 'progress'; value: number }
  | { type: 'result'; result: AnalysisResult }
  | { type: 'error'; message: string }
