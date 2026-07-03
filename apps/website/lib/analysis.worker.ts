import { analyzeCurrentPeaks, recommendBattery } from 'engine'
import { DEMO_BATTERY_CATALOG, type AnalysisResult } from 'shared'

import type { AnalysisRequest, WorkerOutbound } from './analysis-protocol'

/*
 * Analyse-Worker — läuft OFF-MAIN-THREAD (kein Tab-Freeze, §2.2/§5).
 *
 * ┌─ STAND (Prompt 4, ABGESCHLOSSEN) ──────────────────────────────────────────┐
 * │ `current`/`peaks` (§3.4/§3.5) UND `perBattery`/`recommendation`            │
 * │ (§3.6–§3.8) sind jetzt ECHT: `analyzeCurrentPeaks()` + `recommendBattery()`│
 * │ laufen gegen den echten geparsten Lastgang, die echten Tarifparameter aus  │
 * │ dem Formular und den `DEMO_BATTERY_CATALOG` (packages/shared) — ein        │
 * │ Platzhalter bis Martins echter Katalog vorliegt (§8 OP#2). `dataQuality`   │
 * │ ist seit Prompt 2 echt. `dispatchTrace` bleibt BEWUSST unbefüllt (§3.10)   │
 * │ — die Report-Charts sind weiterhin Platzhalter (U2, `ChartPlaceholder`),   │
 * │ es gibt noch keinen Consumer für die 15-Min-Zerlegung.                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

// `self` im Worker-Scope; als Worker getypt, um unter der DOM-lib ohne
// webworker-lib-Konflikt korrekt postMessage(1 Argument) zu erlauben.
const ctx = self as unknown as Worker

function post(message: WorkerOutbound): void {
  ctx.postMessage(message)
}

// [ANNAHME §3.1] `step-tariff.tsx` sammelt `horizonYears` noch nicht im Formular — UI-seitiger
// Default, bewusst nicht im Rechenkern (s. `SimulationConfig`-Kommentar in packages/shared).
// Nicht blockierend: sobald das Formular den Wert sammelt, ersetzt er hier direkt die Konstante.
const DEFAULT_HORIZON_YEARS = 10

ctx.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  const msg = event.data
  if (!msg || msg.type !== 'run') return

  // --- current/peaks: ECHTER Engine-Aufruf (§3.4/§3.5) ---
  const { current, peaks } = analyzeCurrentPeaks(msg.payload.load.profile, msg.payload.tariff)

  // --- perBattery/recommendation: ECHTER Engine-Aufruf (§3.6–§3.8) ---
  // `financial` ist bereits vollständig optional gebaut (§3.9) — fehlt es (Formular sammelt es
  // noch nicht immer), reicht `undefined` einfach durch: `taxEffectsIncluded=false`, `taxBenefit=0`.
  const { perBattery, recommendation } = recommendBattery(
    msg.payload.load.profile,
    msg.payload.tariff,
    DEMO_BATTERY_CATALOG,
    DEFAULT_HORIZON_YEARS,
    msg.payload.financial,
  )

  const result: AnalysisResult = {
    current,
    peaks,
    perBattery,
    recommendation,
    assumptions: {
      // Einzelner Wirkungsgrad-Wert fürs Annahmen-Panel (§6.2): der der EMPFOHLENEN Batterie —
      // jeder Kandidat hat sein eigenes `roundTripEfficiency`, dieses Feld ist ein Report-weiter
      // Anzeigewert, kein Rechenkern-Input. `perBattery` ist über den nicht-leeren
      // `DEMO_BATTERY_CATALOG` nie leer.
      roundTripEfficiency: perBattery[0]!.battery.roundTripEfficiency,
      horizonYears: DEFAULT_HORIZON_YEARS,
      billingModel: msg.payload.tariff.billingModel,
      energyPriceCtPerKwh: msg.payload.tariff.energyPriceCtPerKwh,
      einspeiseverguetungCtPerKwh: msg.payload.tariff.einspeiseverguetungCtPerKwh,
    },
    dataQuality: msg.payload.load.dataQuality,
  }

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
}
