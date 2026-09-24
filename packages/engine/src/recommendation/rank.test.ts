import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import type { TariffParams } from 'shared'

import { parseLoadProfile } from '../parser'
import { DUMMY_BATTERY_CATALOG } from './dummy-catalog'
import { recommendBattery } from './rank'

// Plausibilität am ECHTEN synthetischen Demo-Bäckerei-Lastgang (dev-fixtures/), wie in
// simulation/simulate.test.ts. Kein I/O im Rechenkern — hier im TEST wird die Datei gelesen.
const demoCsv = readFileSync(
  new URL('../../../../dev-fixtures/demo-baeckerei-lastgang-2023.csv', import.meta.url),
  'utf8',
)

const tariff: TariffParams = {
  leistungspreisEurPerKwYear: 90,
  billingModel: 'annual_max',
  minBillableKw: 0,
  energyPriceCtPerKwh: 25,
  einspeiseverguetungCtPerKwh: 7,
}

describe('§3.8 recommendBattery — Demo-Bäckerei × Dummy-Katalog', () => {
  const parsed = parseLoadProfile({ content: demoCsv, format: 'csv' })
  if (!parsed.ok) throw new Error(`Demo-Fixture parst nicht: ${JSON.stringify(parsed)}`)
  const lp = parsed.profile

  const { perBattery, recommendation } = recommendBattery(lp, tariff, DUMMY_BATTERY_CATALOG, 10)

  it('liefert einen vollständig sortierten perBattery-Eintrag je Katalog-Kandidat (netSavingOverHorizon absteigend)', () => {
    expect(perBattery).toHaveLength(DUMMY_BATTERY_CATALOG.length)

    console.log(
      '[§3.8 Ranking]\n' +
        perBattery
          .map((p, i) => {
            const amort = Number.isFinite(p.amortizationYears) ? `${p.amortizationYears.toFixed(1)}J` : '∞'
            return (
              `  ${i + 1}. ${p.battery.id} — netSavingOverHorizon=€${p.netSavingOverHorizon.toFixed(0)} · ` +
              `totalSaving/a=€${p.totalSavingPerYear.toFixed(0)} · amortization=${amort} · ` +
              `warnings=[${p.warnings.join(' | ') || '—'}]`
            )
          })
          .join('\n'),
    )

    // Sortierung: netSavingOverHorizon absteigend über das ganze Array.
    for (let i = 1; i < perBattery.length; i++) {
      const prev = perBattery[i - 1]!
      const cur = perBattery[i]!
      expect(prev.netSavingOverHorizon).toBeGreaterThanOrEqual(cur.netSavingOverHorizon)
    }

    // Platz 1 hat tatsächlich den besten netSavingOverHorizon im gesamten Feld.
    const best = Math.max(...perBattery.map((p) => p.netSavingOverHorizon))
    expect(perBattery[0]!.netSavingOverHorizon).toBe(best)

    // recommendation zeigt konsistent auf Platz 1 des sortierten Arrays.
    expect(recommendation.batteryId).toBe(perBattery[0]!.battery.id)
    // Begründung als Werte (netto), identisch mit Platz 1 — der Satz entsteht im Report.
    expect(recommendation.rationale).toEqual({
      code: 'best_net_saving',
      totalSavingPerYear: perBattery[0]!.totalSavingPerYear,
      amortizationYears: perBattery[0]!.amortizationYears,
      netSavingOverHorizon: perBattery[0]!.netSavingOverHorizon,
      horizonYears: 10,
    })
  })

  it('der leistungsschwache Kandidat (1,5 kW) trägt die "Leistung reicht nicht"-Warnung und landet nicht auf Platz 1', () => {
    const weak = perBattery.find((p) => p.battery.id === 'dummy-res-m10-lowpower')
    expect(weak).toBeDefined()

    console.log(
      `[§3.8 Leistungslimit] ${weak!.battery.id}: newBilledKw=${weak!.newBilledKw.toFixed(1)} kW · ` +
        `notices=[${weak!.notices.map((n) => n.code).join(' | ')}]`,
    )

    expect(weak!.notices).toContainEqual({ code: 'power_limited', maxPowerKw: weak!.battery.maxPowerKw })
    expect(perBattery[0]!.battery.id).not.toBe('dummy-res-m10-lowpower')
  })

  it('Betonsockel-/Wechselrichter-Warnungen erscheinen exakt bei den Kandidaten mit gesetztem Feld', () => {
    for (const p of perBattery) {
      const hasFoundationWarning = p.notices.some((n) => n.code === 'foundation_required')
      expect(hasFoundationWarning).toBe(p.battery.requiresFoundation)

      const hasInverterWarning = p.notices.some((n) => n.code === 'separate_inverter')
      const expectInverterWarning = !p.battery.inverterIncluded && p.battery.extraInverterCost != null
      expect(hasInverterWarning).toBe(expectInverterWarning)
    }

    // Konkrete Gegenprobe: mind. ein Kandidat mit und mind. einer ohne jede Warnung.
    expect(perBattery.some((p) => p.notices.some((n) => n.code === 'foundation_required'))).toBe(true)
    expect(perBattery.some((p) => !p.notices.some((n) => n.code === 'foundation_required'))).toBe(true)
    expect(perBattery.some((p) => p.notices.some((n) => n.code === 'separate_inverter'))).toBe(true)
    expect(perBattery.some((p) => !p.notices.some((n) => n.code === 'separate_inverter'))).toBe(true)
    // Kein Geldbetrag mehr als fertiger Text in der Engine-Ausgabe.
    expect(perBattery.every((p) => p.warnings.every((w) => !/€/.test(w)))).toBe(true)
  })

  it('static-Batterien tragen die Martin-konforme §3.7-Warnung (reserve-frei, keine Spitzenkappung) und KEINE Leistungs-Warnung', () => {
    const staticEntries = perBattery.filter((p) => p.battery.controlType === 'static')
    expect(staticEntries.length).toBeGreaterThan(0)
    for (const p of staticEntries) {
      // Kein Leistungspreis-Anteil (static kappt keine Spitzen).
      expect(p.leistungspreisSavingPerYear).toBe(0)
      // Neuer Warntext (OP#5): „statisch" + „keine Spitzenkappung"; KEIN socFloor/Reserve-Hinweis mehr.
      expect(p.warnings.some((w) => /statisch/i.test(w) && /keine Spitzenkappung/i.test(w))).toBe(true)
      expect(p.warnings.some((w) => /socFloor|Reserve/i.test(w))).toBe(false)
      // Die „Leistung reicht nicht"-Warnung betrifft nur die Spitzenkappung → für static nie gesetzt.
      expect(p.notices.some((n) => n.code === 'power_limited')).toBe(false)
    }
  })
})
