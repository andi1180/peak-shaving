import { alignPvGrossToLoad, analyzeCurrentPeaks, pvConsistencyWarning, recommendBattery } from 'engine'
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
 * │ ist seit Prompt 2 echt. `dispatchTrace` ist seit der §6.2-Befüllung        │
 * │ (`recommendBattery` → `buildDispatchTrace`) je perBattery-Eintrag ECHT und │
 * │ wird hier unverändert mitgereicht (perBattery-Spread unten) — Consumer     │
 * │ sind die U2-Report-Charts (noch `ChartPlaceholder`, Verdrahtung offen).    │
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

  const loadProfile = msg.payload.load.profile
  const pvProfile = msg.payload.pv?.profile

  // --- current/peaks: ECHTER Engine-Aufruf (§3.4/§3.5) ---
  const { current, peaks } = analyzeCurrentPeaks(loadProfile, msg.payload.tariff)

  // --- PV-Konsistenz (§3.1): Brutto-PV gegen den Netz-Lastgang prüfen (Prinzip 1: Netz gewinnt) ---
  // Einmal profil-weit (nicht je Batterie) — die geklemmten Slots hängen nur an Lastgang×PV, nicht an
  // der Batterie. Warnung wandert in dataQuality (analog zur import_only-Pflichtwarnung §3.1).
  const pvWarning =
    pvProfile != null
      ? pvConsistencyWarning(alignPvGrossToLoad(loadProfile, pvProfile).inconsistentSlots)
      : null

  // --- perBattery/recommendation: ECHTER Engine-Aufruf (§3.6–§3.8) ---
  // `financial` ist bereits vollständig optional gebaut (§3.9) — fehlt es (Formular sammelt es
  // noch nicht immer), reicht `undefined` einfach durch: `taxEffectsIncluded=false`, `taxBenefit=0`.
  // `pvProfile` (optional) reichert nur den Trace um die echte Brutto-PV an (Dispatch/Ersparnis unverändert).
  const { perBattery, recommendation } = recommendBattery(
    loadProfile,
    msg.payload.tariff,
    DEMO_BATTERY_CATALOG,
    DEFAULT_HORIZON_YEARS,
    msg.payload.financial,
    pvProfile,
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
    dataQuality: pvWarning
      ? {
          ...msg.payload.load.dataQuality,
          warnings: [...msg.payload.load.dataQuality.warnings, pvWarning],
        }
      : msg.payload.load.dataQuality,
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
