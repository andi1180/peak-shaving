import { computeAnalysis } from 'engine'
import { DEMO_BATTERY_CATALOG } from 'shared'

import type { AnalysisRequest, WorkerOutbound } from './analysis-protocol'
// B14-2: dieselbe Katalog-Änderung, die auch der Bündel-Export mitschreibt — eine Definition,
// zwei Aufrufer (s. `lib/battery-override.ts`).
import { applyBatteryOverride } from './battery-override'
import { DEFAULT_HORIZON_YEARS } from './constants'

/*
 * Analyse-Worker — läuft OFF-MAIN-THREAD (kein Tab-Freeze, §2.2/§5).
 *
 * ┌─ STAND (Prompt 4, ABGESCHLOSSEN) ──────────────────────────────────────────┐
 * │ `current`/`peaks` (§3.4/§3.5) UND `perBattery`/`recommendation`            │
 * │ (§3.6–§3.8) sind jetzt ECHT: `analyzeCurrentPeaks()` + `recommendBattery()`│
 * │ laufen gegen den echten geparsten Lastgang, die echten Tarifparameter aus  │
 * │ dem Formular und den `DEMO_BATTERY_CATALOG` (packages/shared) — ein        │
 * │ Platzhalter bis Martins echter Katalog vorliegt (§8 OP#2). `dataQuality`   │
 * │ ist seit Prompt 2 echt. `dispatchTrace` ist seit der §6.2-Befüllung        │
 * │ (`recommendBattery` → `buildDispatchTrace`) je perBattery-Eintrag ECHT.    │
 * │                                                                            │
 * │ U2 Prompt C: `computeAnalysis()` bündelt die komplette Berechnung, damit   │
 * │ sowohl `run` (Erstlauf, mit künstlicher Fortschrittsanimation) als auch    │
 * │ `recompute` (Annahmen-Panel, §6.2, ohne Verzögerung — Performance-Fix      │
 * │ macht `recommendBattery` ~650ms für den vollen Katalog) dieselbe, EINE     │
 * │ Rechenkette durchlaufen (Prinzip 2: keine zweite, abweichende Rechnung).   │
 * │ Derselbe Worker bleibt über die gesamte Report-Sitzung am Leben (kein      │
 * │ Neu-Spawn je Annahmen-Änderung) — `ctx.onmessage` verarbeitet beliebig     │
 * │ viele Nachrichten nacheinander.                                           │
 * │                                                                            │
 * │ D3 (16.09.2026): `computeAnalysis` selbst liegt jetzt in `packages/engine` │
 * │ — dieser Worker ist ihr Aufrufer, nicht mehr ihr Eigentümer.               │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

// `self` im Worker-Scope; als Worker getypt, um unter der DOM-lib ohne
// webworker-lib-Konflikt korrekt postMessage(1 Argument) zu erlauben.
const ctx = self as unknown as Worker

function post(message: WorkerOutbound): void {
  ctx.postMessage(message)
}

ctx.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  const msg = event.data
  if (!msg) return

  if (msg.type === 'run') {
    /*
     * Der Katalog des Erstlaufs ist der UNVERÄNDERTE — es gibt beim ersten Lauf keinen Override
     * (der entsteht erst im Annahmen-Panel, §6.2). Ein bestätigter Bestandsspeicher verändert ihn
     * ausdrücklich NICHT mehr: er ist kein Katalog-Kandidat, sondern wird daneben simuliert
     * (`buildExistingBatteryAnalysis`). Nur so bleiben die Zusatzspeicher-Szenarien ehrlich —
     * verglichen wird gegen echte Katalog-Geräte, nicht gegen ein umetikettiertes.
     */
    const result = computeAnalysis(msg.payload, DEFAULT_HORIZON_YEARS, DEMO_BATTERY_CATALOG)

    // Künstliche Fortschrittsanimation NUR beim Erstlauf (§5 Schritt 3, StepAnalyzing) — kein
    // fachlicher Wert, reine Wahrnehmungs-Geste. `recompute` (unten) überspringt sie bewusst,
    // damit sich die Live-Neuberechnung im Annahmen-Panel tatsächlich live anfühlt.
    const progressSteps = [12, 34, 58, 81, 100]
    let step = 0
    const tick = () => {
      const value = progressSteps[step] ?? 100
      post({ type: 'progress', value })
      step += 1
      if (step < progressSteps.length) {
        setTimeout(tick, 320)
      } else {
        post({ type: 'result', result })
      }
    }
    setTimeout(tick, 250)
    return
  }

  if (msg.type === 'recompute') {
    try {
      /*
       * Der Bestandsspeicher reist im PAYLOAD mit und muss hier nicht aufgelöst werden — anders
       * als bis zum 01.09.2026, als er als `batteryPreset` ein Override war und bei jeder
       * Neuberechnung gegen einen ausdrücklichen Override abzugleichen war (vergass ein Aufrufer
       * das, verschwand die Angabe des Kunden lautlos). `msg.payload` trägt ihn unverändert;
       * `computeAnalysis` liest ihn selbst.
       */
      const catalog = applyBatteryOverride(DEMO_BATTERY_CATALOG, msg.batteryOverride)
      const result = computeAnalysis(msg.payload, msg.horizonYears, catalog)
      post({ type: 'recomputed', result })
    } catch (err) {
      post({
        type: 'error',
        message: err instanceof Error ? err.message : 'Neuberechnung fehlgeschlagen',
      })
    }
  }
}
