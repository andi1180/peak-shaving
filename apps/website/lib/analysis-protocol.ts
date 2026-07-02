import type { AnalysisResult } from 'shared'

// Nachrichten-Protokoll zwischen UI-Thread und Analyse-Worker.
// Der Payload ist im Harness bewusst `unknown`: erst Prompt 2 (Parser) liefert
// das getypte Engine-Eingabemodell; bis dahin ignoriert der Mock-Worker ihn.

export type AnalysisRequest = {
  type: 'run'
  payload: unknown
}

export type WorkerOutbound =
  | { type: 'progress'; value: number }
  | { type: 'result'; result: AnalysisResult }
  | { type: 'error'; message: string }
