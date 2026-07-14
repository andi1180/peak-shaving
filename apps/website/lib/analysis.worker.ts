import {
  alignPvGrossToLoad,
  analyzeCurrentPeaks,
  pvConsistencyWarning,
  pvCoverageWarning,
  recommendBattery,
} from 'engine'
import { DEMO_BATTERY_CATALOG, type AnalysisResult, type BatteryCandidate } from 'shared'

import type { AnalysisRequest, BatteryOverride, WorkerOutbound } from './analysis-protocol'
import { DEFAULT_HORIZON_YEARS } from './constants'
import type { CalculatorPayload } from '@/components/flow/types'

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
 * └──────────────────────────────────────────────────────────────────────────┘
 */

// `self` im Worker-Scope; als Worker getypt, um unter der DOM-lib ohne
// webworker-lib-Konflikt korrekt postMessage(1 Argument) zu erlauben.
const ctx = self as unknown as Worker

function post(message: WorkerOutbound): void {
  ctx.postMessage(message)
}

/** `catalog` mit genau einem modifizierten Eintrag (Architektur-Vorgabe §6.2: unveränderte Kopie,
 * nicht der ganze Katalog) — restliche Kandidaten bleiben unangetastet, damit die Neu-Einordnung
 * (Ranking) ehrlich gegen die unveränderten Alternativen läuft. */
function applyBatteryOverride(
  catalog: BatteryCandidate[],
  override: BatteryOverride | undefined,
): BatteryCandidate[] {
  if (!override) return catalog
  return catalog.map((b) =>
    b.id === override.batteryId
      ? {
          ...b,
          ...(override.roundTripEfficiency != null
            ? { roundTripEfficiency: override.roundTripEfficiency }
            : {}),
          ...(override.pricePerKwh != null ? { pricePerKwh: override.pricePerKwh } : {}),
        }
      : b,
  )
}

function computeAnalysis(
  payload: CalculatorPayload,
  horizonYears: number,
  catalog: BatteryCandidate[],
): AnalysisResult {
  const loadProfile = payload.load.profile
  const pvProfile = payload.pv?.profile

  // --- current/peaks: ECHTER Engine-Aufruf (§3.4/§3.5) ---
  const { current, peaks } = analyzeCurrentPeaks(loadProfile, payload.tariff)

  // --- PV-Konsistenz + -Abdeckung (§3.1): Brutto-PV gegen den Netz-Lastgang prüfen (Prinzip 1: Netz
  // gewinnt) UND einen still verpuffenden PV-Upload sichtbar machen. Einmal profil-weit (nicht je
  // Batterie) — die geklemmten/getroffenen Slots hängen nur an Lastgang×PV, nicht an der Batterie.
  // Ein stiller Verlust ist schlimmer als ein sichtbarer Fehler:
  //   • pvProfile vorhanden, überlappt aber nicht/kaum → pvCoverageWarning („ins Leere gelaufen").
  //   • pvProfile vorhanden & überlappt → pvConsistencyWarning bei geklemmten Slots (z. B. unvollständiges
  //     Profil: nur ein von mehreren Wechselrichtern < Summe der Einspeise-Zählpunkte).
  //   • pvError gesetzt (Datei hochgeladen, aber nicht lesbar → pvProfile null) → Ablehnung im Report.
  const pvWarnings: string[] = []
  if (pvProfile != null) {
    const alignment = alignPvGrossToLoad(loadProfile, pvProfile)
    const coverage = pvCoverageWarning(alignment.matchedSlots, loadProfile.readings.length)
    if (coverage) pvWarnings.push(coverage)
    const consistency = pvConsistencyWarning(alignment.inconsistentSlots)
    if (consistency) pvWarnings.push(consistency)
  } else if (payload.pvError) {
    pvWarnings.push(
      `Ein PV-Profil wurde hochgeladen, konnte aber nicht gelesen werden (${payload.pvError}) — die ` +
        'Analyse läuft ohne Brutto-PV; der PV-Eigenverbrauch kann dadurch unterschätzt sein.',
    )
  }

  // --- perBattery/recommendation: ECHTER Engine-Aufruf (§3.6–§3.8) ---
  // `financial` ist bereits vollständig optional gebaut (§3.9) — fehlt es (Formular sammelt es
  // noch nicht immer), reicht `undefined` einfach durch: `taxEffectsIncluded=false`, `taxBenefit=0`.
  // `pvProfile` (optional) reichert nur den Trace um die echte Brutto-PV an (Dispatch/Ersparnis unverändert).
  const { perBattery, recommendation } = recommendBattery(
    loadProfile,
    payload.tariff,
    catalog,
    horizonYears,
    payload.financial,
    pvProfile,
  )

  return {
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
      horizonYears,
      billingModel: payload.tariff.billingModel,
      energyPriceCtPerKwh: payload.tariff.energyPriceCtPerKwh,
      einspeiseverguetungCtPerKwh: payload.tariff.einspeiseverguetungCtPerKwh,
    },
    dataQuality: pvWarnings.length
      ? {
          ...payload.load.dataQuality,
          warnings: [...payload.load.dataQuality.warnings, ...pvWarnings],
        }
      : payload.load.dataQuality,
  }
}

ctx.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  const msg = event.data
  if (!msg) return

  if (msg.type === 'run') {
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
