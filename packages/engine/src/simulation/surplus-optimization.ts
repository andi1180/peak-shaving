import type { LoadProfile } from 'shared'

import { utcMsToLocalFields } from '../parser/datetime'
import type { DispatchResult } from './dispatch'
import { intervalEnergyCostEur } from './energy-cost'
import { clamp, EPS, type BatteryPhysics } from './helpers'

/**
 * Ladesteuerung bei PV-Überschuss: rollierende Kostenminimierung (dynamische Programmierung über
 * den SoC), statt der Tages-Rangfolge, die den Überschuss nicht kennt (`daily-price-order.ts:132`).
 * Aufgerufen nur aus `simulateBattery`, wenn der Lastgang einspeist, eine echte Preiskurve vorliegt
 * und die Spitzenkappung gesperrt ist; sonst läuft der bisherige Dispatch unverändert.
 *
 * Zielfunktion: Summe von `intervalEnergyCostEur` über den Horizont — dieselbe Bewertung, aus der
 * die Energie-Ersparnis entsteht (`energyCostEur`: Bezug zum Intervallpreis, Einspeisung zur
 * Einspeisevergütung). Wirkungsgrad wie in `runCombinedDispatch`: η auf die Ladung, Entladung 1:1.
 *
 * Wissen: Preise so weit, wie sie veröffentlicht wären — neu geplant wird zu Beginn und täglich ab
 * 14:00 (lokal), bis zum Ende des Folgetags (Day-Ahead ist dann bekannt); bis 14:00 reicht der
 * Horizont nur bis Tagesende. Last und PV: die Planreihe aus `planning.ts` (Vorabend-Prognose),
 * dieselbe Vorausschau wie der bisherige Pfad. Jede Entscheidung fällt mit dem echten Bezug des
 * Intervalls (wie im bisherigen Dispatch) und den Restkosten des Plans.
 *
 * Rechenweg: Rückwärts-DP auf `SOC_STATES` Stufen, Restkosten zwischen den Stufen linear
 * interpoliert. Plan und Ausführung wählen je Intervall die Leistung, die Intervallkosten plus
 * Restkosten minimiert; beides ist stückweise linear in der Leistung, das Minimum liegt an einem
 * Knick (Grenze, 0, genau gedeckter Bezug bzw. eingelagerter Überschuss, SoC auf einer Stufe).
 *
 * Spitzenschutz: `simulateBattery` ruft den Pfad nur bei gesperrter Spitzenkappung auf (cap = ∞,
 * Reserve 0) — bei tiefer Kappung verfehlt ein Plan auf der Prognose die Ladefenster unter der
 * Schwelle, und der bisherige Pfad rechnete dort für viele Geräte mehr. Die Regeln sind trotzdem
 * hier hinterlegt (Kappung zuerst, Netzladung nur unter `cap`, nie unter die Reserve), damit ein
 * Aufruf mit Kappung physikalisch zulässig bleibt.
 *
 * Randwert: zwischen den Plänen ist eine kWh am Horizontende so viel wert, wie das Wiederauffüllen
 * kostet (günstigster bekannter Preis des letzten Plantags, mindestens die Einspeisevergütung —
 * `terminalValueCt`); am Lastgang-Ende muss der Start-SoC wieder erreicht sein, damit keine
 * Startenergie verschenkt wird.
 *
 * Grenzen: Restkosten auf dem Raster genähert (Fehler im Harness gegen ein feineres Raster
 * gemessen); entladen wird nie über den Bezug hinaus; Tage ohne Prognose planen mit 0 kW Last.
 */

/** SoC-Stufen des Plans. */
export const SOC_STATES = 100

/** Strafkosten je kWh unter der Spitzen-Reserve bzw. unter dem Ziel-SoC am Lastgang-Ende (€). */
const PENALTY_EUR_PER_KWH = 1000

/** Ab dieser Stunde (lokal) gelten die Day-Ahead-Preise des Folgetags als bekannt. */
const REPLAN_HOUR = 14

export type HorizonPlanInput = {
  /** Erwarteter Netzbezug je Intervall (signiert). */
  planKw: ArrayLike<number>
  /** Bezugspreis je Intervall (ct/kWh). */
  drawCtPerKwh: ArrayLike<number>
  feedInCtPerKwh: number
  physics: BatteryPhysics
  deltaH: number
  startSocKwh: number
  /** Kapp-Schwelle je Intervall; ∞ ohne Spitzenkappung. */
  capKw?: ArrayLike<number>
  /** Mindest-SoC am ENDE jedes Intervalls (Spitzen-Reserve). */
  minEndSocKwh?: ArrayLike<number>
  /** Mindest-SoC am Horizontende. */
  terminalMinSocKwh?: number
  /** Wert einer kWh, die am Horizontende im Speicher liegt (ct/kWh). */
  terminalValueCtPerKwh?: number
  states?: number
}

export type HorizonPlan = {
  /** Restkosten (€) ab dem ENDE von Intervall t je SoC-Stufe, inkl. Strafterm — Zeile t. */
  endValue: Float64Array
  stepKwh: number
  states: number
  /** Kosten des Horizonts ab dem Start-SoC laut DP (€, inkl. Strafterm). */
  dpValueEur: number
}

/** Interpolierte Restkosten am Ende von Intervall `row` bei SoC `socKwh`. */
function valueAt(plan: HorizonPlan, row: number, socKwh: number): number {
  return interpolate(plan.endValue, row * (plan.states + 1), plan.states, plan.stepKwh, socKwh)
}

function interpolate(
  values: Float64Array,
  base: number,
  states: number,
  stepKwh: number,
  socKwh: number,
): number {
  const x = clamp(socKwh / stepKwh, 0, states)
  const i0 = Math.min(Math.floor(x), states - 1)
  const w = x - i0
  return values[base + i0]! * (1 - w) + values[base + i0 + 1]! * w
}

const socAfter = (soc: number, kw: number, deltaH: number, eta: number) =>
  soc + (kw > 0 ? kw * deltaH * eta : kw * deltaH)

/** Ein Intervall: Bezug, Preis, Kapp-Schwelle und Mindest-SoC am Intervallende. */
export type IntervalState = { drawKw: number; priceCt: number; capKw: number; minEndSocKwh: number }

/**
 * Wer bei exakt gleichen Kosten gewinnt. Ohne Angabe: Halten vor Entladen (bisheriges Verhalten,
 * aWATTar-Pfad). `discharge`: Entladen vor Halten — für den Lauf im eigenen Tarif, s. `decideInterval`.
 */
export type TieBreak = 'discharge'

/**
 * Batterieleistung für EIN Intervall: Intervallkosten plus Restkosten des Plans (Zeile `row`)
 * minimal, unter Leistungs-, SoC-, Kapp- und Reservegrenzen; über der Kapp-Schwelle wird wie in
 * `runCombinedDispatch` zuerst gekappt. Entladen wird nie über den Bezug hinaus.
 */
export function decideInterval(
  plan: HorizonPlan,
  row: number,
  soc: number,
  interval: IntervalState,
  feedInCt: number,
  physics: BatteryPhysics,
  deltaH: number,
  tieBreak?: TieBreak,
): number {
  const { usableCapacityKwh: C, maxPowerKw: P, roundTripEfficiency: eta } = physics
  const { drawKw: draw, priceCt, capKw: cap, minEndSocKwh: floorNext } = interval
  if (draw > cap) return -Math.min(draw - cap, P, soc / deltaH)

  const step = plan.stepKwh
  const maxDischargeKw = Math.max(0, Math.min(P, draw, (soc - floorNext) / deltaH))
  const maxChargeKw = Math.max(0, Math.min(P, cap - Math.max(0, draw), (C - soc) / (deltaH * eta)))
  // Unter der Spitzen-Reserve muss nachgeladen werden, soweit es die Grenzen zulassen.
  const minKw =
    soc < floorNext - EPS
      ? Math.min(maxChargeKw, (floorNext - soc) / (deltaH * eta))
      : -maxDischargeKw
  let bestKw = 0
  let best = Infinity
  const consider = (kw: number) => {
    if (kw < minKw - EPS || kw > maxChargeKw + EPS) return
    const v =
      intervalEnergyCostEur(draw + kw, deltaH, priceCt, feedInCt) +
      valueAt(plan, row, socAfter(soc, kw, deltaH, eta))
    if (v < best - 1e-12) {
      best = v
      bestKw = kw
    }
  }
  // Bei gleichen Kosten gewinnt der zuerst geprüfte Kandidat: echter Überschuss wird eingelagert.
  if (draw < 0) consider(Math.min(maxChargeKw, -draw))
  /*
   * Bei konstantem Preis ist der Randwert (`terminalValueCt`) exakt der Entladepreis: Halten und
   * Entladen kosten im Plan gleich viel, der Gleichstand ist strukturell. Halten zuerst liesse den
   * Speicher voll stehen und die PV des Folgetags ins Netz gehen; Entladen zuerst (Eigenverbrauch)
   * ist dort optimal (gegen eine Eigenverbrauchs-Referenz gemessen).
   */
  if (tieBreak === 'discharge') consider(minKw)
  consider(Math.max(0, minKw))
  consider(minKw)
  consider(maxChargeKw)
  for (let u = Math.ceil((soc - maxDischargeKw * deltaH) / step - EPS); u * step < soc - EPS; u++) {
    consider((u * step - soc) / deltaH)
  }
  for (
    let u = Math.floor(soc / step + EPS) + 1;
    u * step <= socAfter(soc, maxChargeKw, deltaH, eta) + EPS;
    u++
  ) {
    consider((u * step - soc) / (deltaH * eta))
  }
  return bestKw
}

/** Rückwärts-DP über den Horizont: Restkosten je SoC-Stufe am Ende jedes Intervalls. */
export function planHorizon(input: HorizonPlanInput): HorizonPlan {
  const { planKw, drawCtPerKwh, feedInCtPerKwh, physics, deltaH, capKw, minEndSocKwh } = input
  const { usableCapacityKwh: C, maxPowerKw: P, roundTripEfficiency: eta } = physics
  const S = input.states ?? SOC_STATES
  const T = planKw.length
  const step = C / S
  const maxUp = Math.floor((P * deltaH * eta) / step + EPS)
  const maxDown = Math.floor((P * deltaH) / step + EPS)
  const K = maxUp + maxDown + 1
  const powerOf = (k: number) => (k >= 0 ? (k * step) / (deltaH * eta) : (k * step) / deltaH)

  const endValue = new Float64Array(T * (S + 1))
  let V = new Float64Array(S + 1)
  let nv = new Float64Array(S + 1)
  const terminalMin = input.terminalMinSocKwh ?? 0
  const terminalValueEurPerKwh = (input.terminalValueCtPerKwh ?? 0) / 100
  for (let s = 0; s <= S; s++) {
    V[s] =
      Math.max(0, terminalMin - s * step) * PENALTY_EUR_PER_KWH - terminalValueEurPerKwh * s * step
  }
  const cost = new Float64Array(K)

  for (let t = T - 1; t >= 0; t--) {
    const f = planKw[t]!
    const price = drawCtPerKwh[t]!
    const cap = capKw ? capKw[t]! : Infinity
    const floor = minEndSocKwh ? minEndSocKwh[t]! : 0
    const base = t * (S + 1)
    const W = endValue.subarray(base, base + S + 1)
    for (let s = 0; s <= S; s++)
      W[s] = V[s]! + Math.max(0, floor - s * step - EPS) * PENALTY_EUR_PER_KWH

    // Unzulässig: Ladung über die Kapp-Schwelle (oberes Ende) und Entladung über den Bezug hinaus
    // (unteres Ende, kein Export aus dem Speicher) — beide schneiden ein zusammenhängendes Stück ab.
    const kBottom = -Math.min(maxDown, Math.floor((Math.max(0, f) * deltaH) / step + EPS))
    let kTop = maxUp
    for (let j = 0; j < K; j++) {
      const k = j - maxDown
      const b = powerOf(k)
      if (k < kBottom) cost[j] = Infinity
      else if (b > 0 && f + b > cap + EPS) {
        cost[j] = Infinity
        kTop = Math.min(kTop, k - 1)
      } else cost[j] = intervalEnergyCostEur(f + b, deltaH, price, feedInCtPerKwh)
    }
    if (isConvex(cost, kBottom + maxDown, kTop + maxDown) && isConvex(W, 0, S)) {
      // Konvexe Stufe: der kleinste Zielzustand wandert mit s nur nach rechts (Monge) — O(S + K).
      let u = 0
      for (let s = 0; s <= S; s++) {
        const lo = Math.max(s + kBottom, 0)
        const hi = Math.min(s + kTop, S)
        if (u < lo) u = lo
        let fu = cost[u - s + maxDown]! + W[u]!
        while (u < hi) {
          const fn = cost[u + 1 - s + maxDown]! + W[u + 1]!
          if (!(fn < fu)) break
          u += 1
          fu = fn
        }
        nv[s] = fu
      }
    } else {
      for (let s = 0; s <= S; s++) {
        const lo = Math.max(kBottom, -s)
        const hi = Math.min(kTop, S - s)
        let best = Infinity
        for (let k = lo; k <= hi; k++) best = Math.min(best, cost[k + maxDown]! + W[s + k]!)
        nv[s] = best
      }
    }
    // Knicke zwischen den Stufen: Bezug genau gedeckt, Überschuss genau eingelagert, volle Leistung.
    if (f <= cap) {
      for (let s = 0; s <= S; s++) {
        const soc = s * step
        const maxDis = Math.min(P, Math.max(0, f), soc / deltaH)
        const maxCh = Math.max(0, Math.min(P, cap - Math.max(0, f), (C - soc) / (deltaH * eta)))
        const candidates = f < 0 ? [-maxDis, maxCh, Math.min(maxCh, -f)] : [-maxDis, maxCh]
        for (const kw of candidates) {
          const v =
            intervalEnergyCostEur(f + kw, deltaH, price, feedInCtPerKwh) +
            interpolate(W, 0, S, step, socAfter(soc, kw, deltaH, eta))
          if (v < nv[s]!) nv[s] = v
        }
      }
    }
    const swap = V
    V = nv
    nv = swap
  }

  return {
    endValue,
    stepKwh: step,
    states: S,
    dpValueEur: interpolate(V, 0, S, step, clamp(input.startSocKwh, 0, C)),
  }
}

/**
 * Führt einen Plan auf einer Bezugsreihe aus (Intervalle `from`..`to` des Plans) und schreibt
 * Leistung, SoC und Netzbezug in `out` ab `offset`. Gibt den End-SoC zurück.
 */
export function executePlan(
  plan: HorizonPlan,
  intervals: (t: number) => IntervalState,
  from: number,
  to: number,
  startSocKwh: number,
  feedInCt: number,
  physics: BatteryPhysics,
  deltaH: number,
  out: DispatchResult,
  offset: number,
  tieBreak?: TieBreak,
): number {
  let soc = startSocKwh
  for (let t = from; t < to; t++) {
    const interval = intervals(t)
    const kw = decideInterval(plan, t, soc, interval, feedInCt, physics, deltaH, tieBreak)
    soc = clamp(
      socAfter(soc, kw, deltaH, physics.roundTripEfficiency),
      0,
      physics.usableCapacityKwh,
    )
    out.socKwh[offset + t] = soc
    out.batteryPowerKw[offset + t] = kw
    out.gridAfterKw[offset + t] = interval.drawKw + kw
  }
  return soc
}

/** Zweite Differenzen ≥ 0 (mit Rundungstoleranz) über `values[from..to]`. */
function isConvex(values: Float64Array, from: number, to: number): boolean {
  for (let i = from + 1; i < to; i++) {
    const d2 = values[i + 1]! - 2 * values[i]! + values[i - 1]!
    const scale = Math.abs(values[i + 1]!) + Math.abs(values[i]!) + Math.abs(values[i - 1]!)
    if (d2 < -1e-12 * (1 + scale)) return false
  }
  return true
}

export type SurplusDispatchInput = {
  loadProfile: LoadProfile
  /** Echter Netzbezug (signiert) — darauf wird ausgeführt. */
  draws: number[]
  /** Erwarteter Netzbezug — damit wird geplant. */
  planKw: number[]
  drawCtPerKwh: number[]
  feedInCtPerKwh: number
  capForInterval: number[]
  /** Spitzen-Reserve am START jedes Intervalls (`computeSocFloor`). */
  socFloorKwh: number[]
  physics: BatteryPhysics
  startSocKwh: number
  deltaH: number
  states?: number
  /** Nur der Lauf im eigenen Tarif setzt `discharge`; ohne Angabe bitgleich zum bisherigen Verhalten. */
  tieBreak?: TieBreak
}

/** Planungszeitpunkte und Horizontenden: Lastgang-Beginn, dann jeder Tag ab 14:00 lokal. */
function planningWindows(
  loadProfile: LoadProfile,
): { start: number; end: number; horizonEnd: number }[] {
  const n = loadProfile.readings.length
  const dayIndex = new Array<number>(n)
  const replan: boolean[] = new Array<boolean>(n).fill(false)
  let day = -1
  let prevKey = ''
  let replannedToday = false
  for (let i = 0; i < n; i++) {
    const f = utcMsToLocalFields(Date.parse(loadProfile.readings[i]!.ts), loadProfile.timezoneMeta)
    const key = `${f.year}-${f.month}-${f.day}`
    if (key !== prevKey) {
      day += 1
      prevKey = key
      replannedToday = false
    }
    dayIndex[i] = day
    if (!replannedToday && f.hour >= REPLAN_HOUR) {
      replan[i] = true
      replannedToday = true
    }
  }
  const lastIndexOfDay: number[] = []
  for (let i = 0; i < n; i++) lastIndexOfDay[dayIndex[i]!] = i

  const starts = [0]
  for (let i = 1; i < n; i++) if (replan[i]) starts.push(i)
  return starts.map((start, w) => {
    const end = w + 1 < starts.length ? starts[w + 1]! : n
    // Vor 14:00 sind nur die Preise des laufenden Tages bekannt, ab 14:00 auch die des Folgetags.
    const knownDay = dayIndex[start]! + (replan[start] ? 1 : 0)
    const horizonEnd = (lastIndexOfDay[Math.min(knownDay, day)] ?? n - 1) + 1
    return { start, end, horizonEnd: Math.max(horizonEnd, end) }
  })
}

/**
 * Rest-SoC am Horizontende: so viel wert, wie das Wiederauffüllen kostet — der günstigste bekannte
 * Bezugspreis des letzten Plantags —, mindestens aber die Einspeisevergütung einer eingelagerten
 * PV-kWh. Mit 0 € verwarf der Plan Mittagsladung, die erst nach dem Horizont gebraucht wird.
 */
function terminalValueCt(
  drawCtPerKwh: number[],
  horizonEnd: number,
  deltaH: number,
  feedInCt: number,
): number {
  const lastDay = Math.round(24 / deltaH)
  let minCt = Infinity
  for (let i = Math.max(0, horizonEnd - lastDay); i < horizonEnd; i++)
    minCt = Math.min(minCt, drawCtPerKwh[i]!)
  return Math.max(feedInCt, Number.isFinite(minCt) ? minCt : feedInCt)
}

/** Rollierend geplanter, auf dem echten Lastgang ausgeführter Fahrplan (s. Modulkopf). */
export function runSurplusOptimizedDispatch(input: SurplusDispatchInput): DispatchResult {
  const {
    draws,
    planKw,
    drawCtPerKwh,
    feedInCtPerKwh,
    capForInterval,
    socFloorKwh,
    physics,
    deltaH,
  } = input
  const n = draws.length
  const out: DispatchResult = {
    socKwh: new Array<number>(n).fill(0),
    gridAfterKw: new Array<number>(n).fill(0),
    batteryPowerKw: new Array<number>(n).fill(0),
  }
  // Mindest-SoC am ENDE von Intervall i = Reserve am Start von i + 1 (am Lastgang-Ende 0).
  const minEnd = new Float64Array(n)
  for (let i = 0; i < n; i++) minEnd[i] = i + 1 < n ? (socFloorKwh[i + 1] ?? 0) : 0

  let soc = clamp(input.startSocKwh, 0, physics.usableCapacityKwh)
  for (const { start, end, horizonEnd } of planningWindows(input.loadProfile)) {
    const plan = planHorizon({
      planKw: planKw.slice(start, horizonEnd),
      drawCtPerKwh: drawCtPerKwh.slice(start, horizonEnd),
      feedInCtPerKwh,
      physics,
      deltaH,
      startSocKwh: soc,
      capKw: capForInterval.slice(start, horizonEnd),
      minEndSocKwh: minEnd.subarray(start, horizonEnd),
      terminalMinSocKwh: horizonEnd === n ? input.startSocKwh : 0,
      terminalValueCtPerKwh:
        horizonEnd === n ? 0 : terminalValueCt(drawCtPerKwh, horizonEnd, deltaH, feedInCtPerKwh),
      states: input.states,
    })
    soc = executePlan(
      plan,
      (t) => ({
        drawKw: draws[start + t] ?? 0,
        priceCt: drawCtPerKwh[start + t]!,
        capKw: capForInterval[start + t] ?? Infinity,
        minEndSocKwh: minEnd[start + t]!,
      }),
      0,
      end - start,
      soc,
      feedInCtPerKwh,
      physics,
      deltaH,
      out,
      start,
      input.tieBreak,
    )
  }
  return out
}
