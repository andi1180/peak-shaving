import { mockAnalysisResult } from './mock-analysis'
import type { AnalysisRequest, WorkerOutbound } from './analysis-protocol'

/*
 * Analyse-Worker — läuft OFF-MAIN-THREAD (kein Tab-Freeze, §2.2/§5).
 *
 * ┌─ HARNESS-HINWEIS (Prompt 4 dockt HIER an) ────────────────────────────────┐
 * │ Aktuell sitzt hier eine MOCK-Funktion: sie ignoriert den Payload und gibt  │
 * │ nach kurzer künstlicher Verzögerung das statische Mock-AnalysisResult      │
 * │ zurück. Prompt 4 ersetzt NUR den Rechen-Block unten durch den echten       │
 * │ Engine-Aufruf (analyze(payload)) — die Nachrichten-/Progress-Verdrahtung   │
 * │ bleibt unverändert.                                                         │
 * └────────────────────────────────────────────────────────────────────────────┘
 */

// `self` im Worker-Scope; als Worker getypt, um unter der DOM-lib ohne
// webworker-lib-Konflikt korrekt postMessage(1 Argument) zu erlauben.
const ctx = self as unknown as Worker

function post(message: WorkerOutbound): void {
  ctx.postMessage(message)
}

ctx.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  const msg = event.data
  if (!msg || msg.type !== 'run') return

  // --- MOCK-Rechnung (Prompt 4: durch echten Engine-Aufruf ersetzen) ---
  const progressSteps = [12, 34, 58, 81, 100]
  let step = 0

  const tick = () => {
    const value = progressSteps[step] ?? 100
    post({ type: 'progress', value })
    step += 1
    if (step < progressSteps.length) {
      setTimeout(tick, 320)
    } else {
      post({ type: 'result', result: mockAnalysisResult })
    }
  }

  setTimeout(tick, 250)
}
