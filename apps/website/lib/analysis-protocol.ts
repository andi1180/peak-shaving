import type { AnalysisResult } from 'shared'
import type { CalculatorPayload } from '@/components/flow/types'

// Nachrichten-Protokoll zwischen UI-Thread und Analyse-Worker. Der Payload trägt seit
// Prompt 2 den echten, geparsten Lastgang (CalculatorPayload). Seit Prompt 4 (abgeschlossen)
// rechnet der Worker das komplette `AnalysisResult` echt daraus — `current`/`peaks` (§3.4/§3.5)
// und `perBattery`/`recommendation` (§3.6–§3.8, gegen den `DEMO_BATTERY_CATALOG`).
//
// Seit U2 Prompt C (§6.2, editierbares Annahmen-Panel): ein zweiter Request-Typ `recompute`
// erlaubt eine VOLLSTÄNDIGE Neuberechnung mit geänderten Annahmen, OHNE den Worker neu zu
// spawnen (derselbe langlebige Worker aus dem initialen `run` verarbeitet weitere Nachrichten —
// `ctx.onmessage` ist nicht auf eine einzige Nachricht beschränkt). Läuft IMMER über den ganzen
// `DEMO_BATTERY_CATALOG` (Architektur-Vorgabe: korrekte Neu-Einordnung ggü. unveränderten
// Kandidaten), nicht nur die angezeigte Batterie. `batteryOverride` ersetzt genau EINEN
// Katalog-Eintrag durch eine modifizierte Kopie (Worker-seitig, s. analysis.worker.ts).

export type BatteryOverride = {
  batteryId: string
  roundTripEfficiency?: number
  pricePerKwh?: number
}

export type AnalysisRequest =
  | { type: 'run'; payload: CalculatorPayload }
  | {
      type: 'recompute'
      payload: CalculatorPayload
      horizonYears: number
      batteryOverride?: BatteryOverride
    }

export type WorkerOutbound =
  | { type: 'progress'; value: number }
  | { type: 'result'; result: AnalysisResult }
  | { type: 'recomputed'; result: AnalysisResult }
  | { type: 'error'; message: string }
