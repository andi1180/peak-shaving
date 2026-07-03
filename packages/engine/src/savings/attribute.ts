import type { BatteryCandidate, LoadProfile, TariffParams } from 'shared'

import {
  capForIntervalSeries,
  drawSeries,
  intervalHours,
  periodIndexByInterval,
} from '../simulation/helpers'
import { simulateBattery, type BatterySimulationResult } from '../simulation/simulate'
import { intervalTariffRates } from '../simulation/tou'
import { getTariffStrategy } from '../tariff/strategy'

/**
 * Kombinierter Dispatch → benannte Ersparnis-Felder (§3.7). EIN Simulationslauf (§3.6), aus dem alle
 * drei Ersparnis-Anteile durch reine BUCHHALTUNG über den erzeugten Fahrplan gewonnen werden — kein
 * zweiter Dispatch (Prinzip 2: „Ein Dispatch, eine ehrliche Zahl"). Die Anteile sind DISJUNKT: jede
 * geladene bzw. entladene kWh landet in genau einem Topf (s. Herkunfts-Tag-Regel unten), also gilt
 * `totalSavingPerYear === leistungspreis + selfConsumption + loadShift` exakt (per Konstruktion getestet).
 */
export type BatterySavings = {
  /** ABGERECHNETER kW-Wert, wie er im Report ausgewiesen wird (bei `static` = alter Wert, s. controlType). */
  newBilledKw: number
  /** Leistungspreis-Ersparnis = (alter − neuer billedKw) × Leistungspreis. `static` → 0 (nicht kreditiert). */
  leistungspreisSavingPerYear: number
  /** Eigenverbrauchs-Ersparnis: aus PV geladene, später selbst verbrauchte kWh × (Arbeitspreis − Einspeisevergütung). */
  selfConsumptionSavingPerYear: number
  /** Lastverschiebungs-Ersparnis: im günstigen Fenster geladene, im teuren Fenster genutzte kWh × (teuer − günstig). 0 ohne Tarif-Fenster. */
  loadShiftSavingPerYear: number
  /** Summe der drei Anteile aus DEMSELBEN Fahrplan. */
  totalSavingPerYear: number
  /** Contract-Warnungen (z.B. static-Steuerung: Spitzenkappung nicht kreditiert). */
  warnings: string[]
}

/** Herkunft einer im Speicher liegenden kWh-Schicht — bestimmt, in welchen Ersparnis-Topf ihre Nutzung fällt. */
type EnergyLayer = {
  /** Verbleibende Energie dieser Schicht (kWh, auf SoC-Ebene — nach Ladewirkungsgrad). */
  kwh: number
  /** 'pv' = aus Einspeisung/PV-Überschuss geladen; 'grid' = aus dem Netz geladen. */
  origin: 'pv' | 'grid'
  /** Nur für 'grid': Arbeitspreis (ct/kWh) zum Ladezeitpunkt — Basis für die Lastverschiebungs-Bewertung. */
  chargeCt: number
}

const EPS = 1e-9

/**
 * Rechnet die §3.6-Simulation eines Kandidaten in die benannten Ersparnis-Felder des
 * `AnalysisResult.perBattery`-Contracts um (§3.7). Optional kann ein bereits gerechnetes
 * `BatterySimulationResult` übergeben werden (spart den Doppellauf, wenn der Aufrufer die Physik
 * ohnehin schon hat) — sonst wird es hier via `simulateBattery` erzeugt.
 *
 * ── Attribution ohne Doppelzählung ──────────────────────────────────────────────────────────────
 * Ein einziger Buchhaltungs-Durchlauf über den Fahrplan (`dispatch`) führt eine FIFO-Warteschlange
 * herkunftsmarkierter Energieschichten mit (§3.7-Zuordnungsregel „Herkunfts-Tag pro geladener kWh"):
 *   • Laden bei `draw < 0`  → 'pv'-Schicht   (Schritt 3, PV-Überschuss).
 *   • Laden bei `draw ≥ 0`  → 'grid'-Schicht (Schritt 5), mit dem Arbeitspreis des Ladeintervalls.
 *   • Entladen bei `draw > cap` → SPITZENKAPPUNG: verbraucht FIFO-Schichten, erzeugt aber KEINEN
 *     Energie-Topf — dieser Anteil steckt vollständig in `leistungspreisSaving` (via billedKw).
 *   • Entladen bei `draw ≤ cap` → EIGENVERBRAUCH: die entnommenen Schichten fließen je nach Herkunft
 *     in genau EINEN Topf: 'pv' → Eigenverbrauch, 'grid' → Lastverschiebung (Wert = teuer − günstig).
 * Weil Peak-Entladung keine kWh in einen Energie-Topf legt und jede Eigenverbrauchs-kWh ihrer
 * Herkunft folgt, ist keine kWh doppelt gezählt → Summe = total (Prinzip 2).
 */
export function computeBatterySavings(
  loadProfile: LoadProfile,
  battery: BatteryCandidate,
  tariffParams: TariffParams,
  precomputed?: BatterySimulationResult,
): BatterySavings {
  const sim = precomputed ?? simulateBattery(loadProfile, battery, tariffParams)

  const strategy = getTariffStrategy(tariffParams.billingModel)
  const oldBilledKw = strategy.billedKw(loadProfile, tariffParams)

  const draws = drawSeries(loadProfile)
  const deltaH = intervalHours(loadProfile)
  const eta = battery.roundTripEfficiency
  const periodOfInterval = periodIndexByInterval(loadProfile, tariffParams.billingModel)
  const capForInterval = capForIntervalSeries(sim.capKwByPeriod, periodOfInterval)
  const { rateCtPerKwh } = intervalTariffRates(loadProfile, tariffParams)

  const std = tariffParams.energyPriceCtPerKwh
  const einspeise = tariffParams.einspeiseverguetungCtPerKwh
  // Eigenverbrauchs-Wert einer PV-kWh: vermeidet Bezug zum Arbeitspreis, verzichtet auf Einspeisung.
  const pvSelfConsumptionCtPerKwh = Math.max(0, std - einspeise)

  // FIFO-Warteschlange. Der Start-SoC (§3.6.1, 50 % [ANNAHME]) trägt keine Herkunft → als neutrale
  // 'grid'-Schicht zum Standardpreis geführt: erzeugt weder Eigenverbrauchs- noch Lastverschiebungs-
  // Ersparnis (chargeCt = std) und verhindert nur den FIFO-Unterlauf.
  const layers: EnergyLayer[] = []
  if (sim.startSocKwh > EPS) layers.push({ kwh: sim.startSocKwh, origin: 'grid', chargeCt: std })

  let pvSelfConsumedKwh = 0
  let loadShiftCtKwh = 0 // Σ kWh × (teuer − günstig) in ct·kWh, am Ende /100 → €

  const batteryPowerKw = sim.dispatch.batteryPowerKw
  for (let i = 0; i < draws.length; i++) {
    const bk = batteryPowerKw[i] ?? 0
    const draw = draws[i] ?? 0
    const cap = capForInterval[i] ?? Infinity

    if (bk > EPS) {
      // Laden — Herkunft aus dem Vorzeichen der Ausgangslast (deckt sich mit dem Dispatch-Branch).
      const storedKwh = bk * deltaH * eta // exakt wie der Dispatch (soc += P·Δ·η)
      if (draw < 0) layers.push({ kwh: storedKwh, origin: 'pv', chargeCt: einspeise })
      else layers.push({ kwh: storedKwh, origin: 'grid', chargeCt: rateCtPerKwh[i] ?? std })
    } else if (bk < -EPS) {
      // Entladen — FIFO entnehmen und je nach Zweck/Herkunft zuordnen.
      let remaining = -bk * deltaH // Lieferung 1:1 aus dem SoC (soc -= P·Δ)
      const isPeak = draw > cap
      const dischargeCt = rateCtPerKwh[i] ?? std
      while (remaining > EPS && layers.length > 0) {
        const layer = layers[0]!
        const take = Math.min(remaining, layer.kwh)
        layer.kwh -= take
        remaining -= take
        if (layer.kwh <= EPS) layers.shift()

        if (isPeak) continue // Spitzenkappung → steckt in leistungspreisSaving, kein Energie-Topf.
        if (layer.origin === 'pv') {
          pvSelfConsumedKwh += take
        } else {
          // 'grid': Lastverschiebung = nur der Aufschlag (teuer jetzt − günstig beim Laden), ≥ 0.
          loadShiftCtKwh += take * Math.max(0, dischargeCt - layer.chargeCt)
        }
      }
    }
  }

  const selfConsumptionSavingPerYear = (pvSelfConsumedKwh * pvSelfConsumptionCtPerKwh) / 100
  const loadShiftSavingPerYear = loadShiftCtKwh / 100

  // ── controlType-Zuschreibung (§3.6/§3.7; Martins Semantik, OP#5) ─────────────────────────────────
  // controlType ist eine Frage der STEUERUNGS-Konfiguration, nicht der Batteriezelle.
  //  • 'dynamic' → Spitzenkappung: voller Leistungspreis-Anteil kreditiert (newBilledKw = gekappt).
  //  • 'static'  → NUR Eigenverbrauch/Lastverschiebung, KEINE Spitzenkappung: `leistungspreisSaving = 0`
  //    und newBilledKw = alter (ungekappter) Wert. Der zugrunde liegende Fahrplan ist bereits
  //    reserve-frei simuliert (`simulateBattery`, cap = ∞ / socFloor ≡ 0 für static) → Eigenverbrauch
  //    nutzt die volle Kapazität. Die drei Ersparnis-Töpfe oben stammen aus GENAU diesem Fahrplan, die
  //    Nicht-Doppelzählung (Summe = total) gilt für static unverändert.
  const warnings: string[] = []
  let newBilledKw: number
  let leistungspreisSavingPerYear: number
  if (battery.controlType === 'static') {
    newBilledKw = oldBilledKw
    leistungspreisSavingPerYear = 0
    warnings.push(
      'Statische Steuerung: nur Eigenverbrauch/Lastverschiebung, keine Spitzenkappung — der ' +
        'Leistungspreis-Anteil wird nicht kreditiert. Mit zusätzlicher Steuerungshardware ' +
        '(z. B. Smartfox/iHome Manager) auf Peak-Shaving aufrüstbar; die Kostenmodellierung dieser ' +
        'Aufrüstung ist offen bis zum realen Katalog (OP#2).',
    )
  } else {
    newBilledKw = sim.newBilledKw
    leistungspreisSavingPerYear = (oldBilledKw - newBilledKw) * tariffParams.leistungspreisEurPerKwYear
  }

  const totalSavingPerYear =
    leistungspreisSavingPerYear + selfConsumptionSavingPerYear + loadShiftSavingPerYear

  return {
    newBilledKw,
    leistungspreisSavingPerYear,
    selfConsumptionSavingPerYear,
    loadShiftSavingPerYear,
    totalSavingPerYear,
    warnings,
  }
}
