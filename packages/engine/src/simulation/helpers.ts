import type { BatteryCandidate, BillingModel, LoadProfile } from 'shared'

import { utcMsToLocalFields } from '../parser/datetime'

// Interne Hilfsgrößen der SoC-Simulation (§3.6/§3.6.1). Rein & deterministisch, kein I/O.

/** Numerische Toleranz für Vorzeichen-/Grenzvergleiche (float-Jitter, nicht fachlich). */
export const EPS = 1e-9

export const clamp = (x: number, lo: number, hi: number): number => Math.min(Math.max(x, lo), hi)

/**
 * Die physikalischen Batteriegrößen, auf denen §3.6 rechnet — Leistung (kW) UND Energie (kWh)
 * plus Wirkungsgrad. Bewusst eine Teilmenge von `BatteryCandidate`: die Physik-Primitiven brauchen
 * weder Preis noch Klasse noch `controlType`. Sie rechnen controlType-agnostisch auf Caps/Reserve als
 * Eingabe; NUR der Orchestrator `simulateBattery` liest `controlType` (aus dem vollen `BatteryCandidate`)
 * und wählt daraus die Kappungs-Konfiguration — `static` reserve-frei (`cap=∞`/`socFloor≡0`), s. OP#5.
 * Die Zuschreibung der Ersparnis-Anteile zu static/dynamic ist §3.7, nicht dieser Baustein.
 */
export type BatteryPhysics = Pick<
  BatteryCandidate,
  'usableCapacityKwh' | 'maxPowerKw' | 'roundTripEfficiency'
>

export const toPhysics = (b: BatteryCandidate): BatteryPhysics => ({
  usableCapacityKwh: b.usableCapacityKwh,
  maxPowerKw: b.maxPowerKw,
  roundTripEfficiency: b.roundTripEfficiency,
})

/** Intervalldauer Δ in Stunden (§3.6: 15 min → 0,25 h). */
export const intervalHours = (loadProfile: LoadProfile): number => loadProfile.intervalMinutes / 60

/** Signierte Netzbezugs-Reihe (+ = Bezug, − = Einspeisung), ein Wert je Intervall. */
export const drawSeries = (loadProfile: LoadProfile): number[] =>
  loadProfile.readings.map((r) => r.gridPowerKw)

/**
 * [ANNAHME §3.6.1] Start-SoC am 1.1.: 50 % der nutzbaren Kapazität — neutrale Konvention, kein
 * Bias Richtung „voll"/„leer". Die Auswirkung dämpft sich durch laufendes Zyklieren selbst; vor
 * Auslieferung gegen Martins echtes Profil gegenprüfen (§3.6.1, §8 OP#1/#3).
 */
export const START_SOC_FRACTION = 0.5

export const startSoc = (physics: BatteryPhysics): number =>
  START_SOC_FRACTION * physics.usableCapacityKwh

/** Höchster positiver Bezug in einer Reihe (0, wenn nur Einspeisung/leer). Ohne Spread — 35.040 Werte sprengen den Stack. */
export function maxPositiveDraw(draws: number[]): number {
  let max = 0
  for (const d of draws) if (d > max) max = d
  return max
}

/**
 * Abrechnungsperioden-Zuordnung je Intervall (§3.6.1). `annual_max` → alle Intervalle Periode 0;
 * `monthly_*` → nach LOKALEM Monat (0..11), konsistent mit der TariffStrategy (§3.5) und der
 * §3.4-Gruppierung (`positiveMonthlyPeaksKw`), die ebenfalls lokale Wanduhr nutzen — nicht UTC.
 * Setzt (wie das übrige MVP) einen einzelnen abgedeckten Jahrgang voraus.
 */
export function periodIndexByInterval(
  loadProfile: LoadProfile,
  billingModel: BillingModel,
): number[] {
  if (billingModel === 'annual_max') return loadProfile.readings.map(() => 0)
  return loadProfile.readings.map(
    (r) => utcMsToLocalFields(Date.parse(r.ts), loadProfile.timezoneMeta).month - 1,
  )
}

/** Contract-Länge von `capKwByPeriod` (§3.10/`DispatchTrace`): 1 bei `annual_max`, 12 bei `monthly_*`. */
export const periodSlotCount = (billingModel: BillingModel): number =>
  billingModel === 'annual_max' ? 1 : 12

/** Per-Intervall-Kappschwelle aus den Perioden-Caps (annual: 1 Slot, monthly: 12 Slots nach Monat). */
export const capForIntervalSeries = (
  capKwByPeriod: number[],
  periodOfInterval: number[],
): number[] => periodOfInterval.map((p) => capKwByPeriod[p] ?? Infinity)

/**
 * Intervall-Indizes je Periode, in chronologischer Reihenfolge (Reihenfolge des Auftretens).
 * Für ein sortiertes Einjahresprofil erscheinen Monate aufsteigend (mit Lücken für fehlende
 * Monate) — genau die Reihenfolge, in der die sequenzielle Kapp-Suche (§3.6.1) laufen muss.
 */
export function intervalIndicesByPeriod(periodOfInterval: number[]): Map<number, number[]> {
  const byPeriod = new Map<number, number[]>()
  for (let i = 0; i < periodOfInterval.length; i++) {
    const p = periodOfInterval[i] ?? 0
    const list = byPeriod.get(p)
    if (list) list.push(i)
    else byPeriod.set(p, [i])
  }
  return byPeriod
}

/** Distinkte Perioden-IDs in chronologischer Reihenfolge (erstes Auftreten). */
export function orderedPeriodIds(periodOfInterval: number[]): number[] {
  const seen = new Set<number>()
  const order: number[] = []
  for (const p of periodOfInterval) {
    if (!seen.has(p)) {
      seen.add(p)
      order.push(p)
    }
  }
  return order
}
