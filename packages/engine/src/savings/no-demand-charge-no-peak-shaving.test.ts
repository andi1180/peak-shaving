import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import type { BatteryCandidate, TariffParams } from 'shared'

import { parseLoadProfile } from '../parser'
import { positiveAnnualPeakKw } from '../peaks/metrics'
import { peakShavingBlockers } from '../simulation/peak-shaving'
import { simulateBattery } from '../simulation/simulate'
import { getTariffStrategy } from '../tariff/strategy'
import { computeBatterySavings } from './attribute'

/**
 * Delta 3 (ERSTE Anwendung) — ein Tarif OHNE Leistungspreis (`leistungspreisEurPerKwYear === 0`,
 * Tarifvariante „ohne Leistungsmessung", Delta 5) bekommt keine Spitzenkappung: weder gerechnet
 * noch kreditiert.
 *
 * ⚠ Der Prüfpunkt ist NICHT die Ersparnis-Zahl. Die war schon vor diesem Schritt 0, weil die
 * Zuschreibung mit dem Leistungspreis multipliziert (`(alt − neu) × 0 = 0`) — ein Test, der nur
 * darauf sähe, bliebe auch dann grün, wenn der Blocker gar nicht existiert. Gemessen wird deshalb
 * die SIMULATION: reserve-frei (`cap = ∞`, `socFloor ≡ 0`) und dadurch eine sichtbar andere
 * SoC-Trajektorie als dieselbe Kombination MIT Leistungspreis — die freigewordene Kapazität steht
 * dem Eigenverbrauch zur Verfügung.
 *
 * Der GEGENBEWEIS läuft in jedem Fall daneben: derselbe echte Lastgang, dieselbe Batterie, nur mit
 * echtem Leistungspreis. Dort muss unverändert gekappt und kreditiert werden — sonst bewiese der
 * Unterschied nichts über den neuen Grund, sondern nur, dass diese Batterie ohnehin nichts kappt.
 */

// Echter (synthetischer, aber gemessen etikettierter) Demo-Lastgang MIT PV — die Einspeisung ist
// nötig, damit „die Reserve gibt Kapazität für den Eigenverbrauch frei" überhaupt messbar wird.
const demoCsv = readFileSync(
  new URL('../../../../dev-fixtures/demo-baeckerei-mit-pv-netzlastgang-2023.csv', import.meta.url),
  'utf8',
)
const parsed = parseLoadProfile({ content: demoCsv, format: 'csv' })
if (!parsed.ok) throw new Error(`Demo-Fixture parst nicht: ${JSON.stringify(parsed)}`)
const lp = parsed.profile

// Eine DYNAMISCHE Batterie — sie KANN kappen; die Sperre muss also aus dem Tarif kommen.
const battery: BatteryCandidate = {
  id: 'demo-commercial-60-30',
  name: 'Demo Commercial 60/30',
  manufacturer: 'Demo',
  class: 'commercial',
  usableCapacityKwh: 60,
  maxPowerKw: 30,
  roundTripEfficiency: 0.9,
  pricePerKwh: 350,
  inverterIncluded: true,
  requiresFoundation: false,
  controlType: 'dynamic',
}

/** Nachttarif → `isCheapWindow` ist nicht überall false, die Lastverschiebung wird messbar. */
const base = {
  billingModel: 'annual_max',
  minBillableKw: 0,
  energyPriceCtPerKwh: 25,
  energyPriceNightCtPerKwh: 12,
  einspeiseverguetungCtPerKwh: 8,
} satisfies Omit<TariffParams, 'leistungspreisEurPerKwYear'>

/** Der neue Fall: Anschluss ohne Leistungsmessung — der Posten existiert nicht. */
const ohneLeistungspreis: TariffParams = { ...base, leistungspreisEurPerKwYear: 0 }
/** Die Gegenprobe: Wiener Netze NE 7 mit Leistungsmessung (der einzige real belegte Satz, B11). */
const mitLeistungspreis: TariffParams = { ...base, leistungspreisEurPerKwYear: 82.92 }

describe('Delta 3 — ein Tarif ohne Leistungspreis trägt keine Spitzenkappung', () => {
  it('nennt den Tarif als Grund — und NUR dann', () => {
    expect(peakShavingBlockers(lp, battery, ohneLeistungspreis)).toEqual(['no_demand_charge'])
    expect(peakShavingBlockers(lp, battery, mitLeistungspreis)).toEqual([])
  })

  it('simuliert reserve-frei — und die Gegenprobe beweist, dass die Reserve sonst wirklich bindet', () => {
    const ohne = simulateBattery(lp, battery, ohneLeistungspreis)
    const mit = simulateBattery(lp, battery, mitLeistungspreis)

    // Neuer Fall: keine Kapp-Schwelle, keine Reserve.
    expect(ohne.capKwByPeriod.every((c) => c === Infinity)).toBe(true)
    expect(ohne.socFloorKwh.every((v) => v === 0)).toBe(true)

    // Gegenprobe: mit Leistungspreis wird sehr wohl eine Schwelle gesucht UND Kapazität gebunden.
    // Ohne diese Assertion wäre „reserve-frei" eine Aussage, die auch trivial wahr sein könnte.
    const rawPeak = positiveAnnualPeakKw(lp)
    expect(mit.capKwByPeriod.every((c) => Number.isFinite(c) && c < rawPeak)).toBe(true)
    expect(mit.socFloorKwh.some((v) => v > 0)).toBe(true)

    // Die SoC-Trajektorie ist dadurch sichtbar eine andere — nicht nur rechnerisch, sondern in der
    // Zeitreihe, die auch die §6.2-Charts zeigen.
    const differing = ohne.dispatch.socKwh.filter(
      (v, i) => Math.abs(v - (mit.dispatch.socKwh[i] ?? 0)) > 1e-9,
    ).length
    const maxDelta = ohne.dispatch.socKwh.reduce(
      (m, v, i) => Math.max(m, Math.abs(v - (mit.dispatch.socKwh[i] ?? 0))),
      0,
    )
    console.log(
      `[Delta 3] SoC-Trajektorie: ${differing} von ${ohne.dispatch.socKwh.length} Slots abweichend, ` +
        `max |Δ| = ${maxDelta.toFixed(3)} kWh · cap(mit) = ${(mit.capKwByPeriod[0] ?? NaN).toFixed(3)} kW ` +
        `bei rohem Jahres-Peak ${rawPeak.toFixed(3)} kW · max socFloor(mit) = ` +
        `${Math.max(...mit.socFloorKwh).toFixed(3)} kWh`,
    )
    expect(differing).toBeGreaterThan(0)
    expect(maxDelta).toBeGreaterThan(0)
  })

  it('kreditiert KEINE Spitzenkappung und meldet den ungekappten Wert — Gegenprobe tut beides doch', () => {
    const oldBilledKw = getTariffStrategy(base.billingModel).billedKw(lp, ohneLeistungspreis)

    const ohne = computeBatterySavings(lp, battery, ohneLeistungspreis)
    const mit = computeBatterySavings(lp, battery, mitLeistungspreis)

    console.log(
      `[Delta 3] billedKw ohne Batterie=${oldBilledKw.toFixed(4)} kW · ` +
        `ohne LP: leistungspreis=€${ohne.leistungspreisSavingPerYear.toFixed(2)}, newBilledKw=${ohne.newBilledKw.toFixed(4)} · ` +
        `mit LP: leistungspreis=€${mit.leistungspreisSavingPerYear.toFixed(2)}, newBilledKw=${mit.newBilledKw.toFixed(4)}`,
    )

    // Regression (war schon vor diesem Schritt so): keine Leistungspreis-Ersparnis.
    expect(ohne.leistungspreisSavingPerYear).toBe(0)
    // NEU: der ausgewiesene abgerechnete Wert ist der UNGEKAPPTE. Vorher stand hier der gekappte
    // Wert aus einer Kappung, die niemandem etwas einbrachte — eine Zahl, die eine Wirkung behauptet.
    expect(ohne.newBilledKw).toBe(oldBilledKw)

    // Gegenprobe: mit echtem Leistungspreis unverändert echte Kappung und echte Ersparnis.
    expect(mit.leistungspreisSavingPerYear).toBeGreaterThan(0)
    expect(mit.newBilledKw).toBeLessThan(oldBilledKw)
  })

  it('gibt die gebundene Kapazität an den Eigenverbrauch zurück — der eigentliche Effekt', () => {
    const ohne = computeBatterySavings(lp, battery, ohneLeistungspreis)
    const mit = computeBatterySavings(lp, battery, mitLeistungspreis)

    const energieTopfOhne = ohne.selfConsumptionSavingPerYear + ohne.loadShiftSavingPerYear
    const energieTopfMit = mit.selfConsumptionSavingPerYear + mit.loadShiftSavingPerYear
    console.log(
      `[Delta 3] Energie-Töpfe: ohne LP €${energieTopfOhne.toFixed(2)} ` +
        `(EV €${ohne.selfConsumptionSavingPerYear.toFixed(2)} + LV €${ohne.loadShiftSavingPerYear.toFixed(2)}) · ` +
        `mit LP €${energieTopfMit.toFixed(2)} ` +
        `(EV €${mit.selfConsumptionSavingPerYear.toFixed(2)} + LV €${mit.loadShiftSavingPerYear.toFixed(2)})`,
    )

    // Die Spitzen-Reserve kostet Eigenverbrauch; ohne Leistungspreis gibt es sie nicht mehr.
    expect(energieTopfOhne).toBeGreaterThan(energieTopfMit)
  })

  it('sagt im Report-Contract, WARUM — und die Summe der Anteile bleibt exakt', () => {
    const ohne = computeBatterySavings(lp, battery, ohneLeistungspreis)
    expect(ohne.warnings.some((w) => /Tarif ohne Leistungspreis/.test(w))).toBe(true)
    expect(ohne.warnings.some((w) => /Statische Steuerung|Synthetisches Standardlastprofil/.test(w))).toBe(
      false,
    )
    expect(ohne.totalSavingPerYear).toBeCloseTo(
      ohne.leistungspreisSavingPerYear +
        ohne.selfConsumptionSavingPerYear +
        ohne.loadShiftSavingPerYear,
      12,
    )

    // Gegenprobe: mit Leistungspreis steht der Satz NICHT da.
    const mit = computeBatterySavings(lp, battery, mitLeistungspreis)
    expect(mit.warnings.some((w) => /Tarif ohne Leistungspreis/.test(w))).toBe(false)
  })

  it('nennt bei einer statischen Batterie ohne Leistungspreis BEIDE Gründe', () => {
    const statisch: BatteryCandidate = { ...battery, id: 'demo-stat-60-30', controlType: 'static' }
    expect(peakShavingBlockers(lp, statisch, ohneLeistungspreis)).toEqual([
      'static_control',
      'no_demand_charge',
    ])
    const s = computeBatterySavings(lp, statisch, ohneLeistungspreis)
    expect(
      s.warnings.filter((w) => /Statische Steuerung|Tarif ohne Leistungspreis/.test(w)),
    ).toHaveLength(2)
    expect(s.leistungspreisSavingPerYear).toBe(0)
  })
})
