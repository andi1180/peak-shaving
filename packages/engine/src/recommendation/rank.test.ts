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
    expect(recommendation.rationale).toContain(perBattery[0]!.battery.name)
  })

  it('der leistungsschwache Kandidat (1,5 kW) trägt die "Leistung reicht nicht"-Warnung und landet nicht auf Platz 1', () => {
    const weak = perBattery.find((p) => p.battery.id === 'dummy-res-m10-lowpower')
    expect(weak).toBeDefined()

    console.log(
      `[§3.8 Leistungslimit] ${weak!.battery.id}: newBilledKw=${weak!.newBilledKw.toFixed(1)} kW · ` +
        `warnings=[${weak!.warnings.join(' | ')}]`,
    )

    expect(weak!.warnings.some((w) => /Leistung.*reicht nicht/i.test(w))).toBe(true)
    expect(perBattery[0]!.battery.id).not.toBe('dummy-res-m10-lowpower')
  })

  it('Betonsockel-/Wechselrichter-Warnungen erscheinen exakt bei den Kandidaten mit gesetztem Feld', () => {
    for (const p of perBattery) {
      const hasFoundationWarning = p.warnings.some((w) => /Betonsockel/i.test(w))
      expect(hasFoundationWarning).toBe(p.battery.requiresFoundation)

      const hasInverterWarning = p.warnings.some((w) => /Wechselrichter/i.test(w))
      const expectInverterWarning = !p.battery.inverterIncluded && p.battery.extraInverterCost != null
      expect(hasInverterWarning).toBe(expectInverterWarning)
    }

    // Konkrete Gegenprobe: mind. ein Kandidat mit und mind. einer ohne jede Warnung.
    expect(perBattery.some((p) => p.warnings.some((w) => /Betonsockel/i.test(w)))).toBe(true)
    expect(perBattery.some((p) => !p.warnings.some((w) => /Betonsockel/i.test(w)))).toBe(true)
    expect(perBattery.some((p) => p.warnings.some((w) => /Wechselrichter/i.test(w)))).toBe(true)
    expect(perBattery.some((p) => !p.warnings.some((w) => /Wechselrichter/i.test(w)))).toBe(true)
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
      expect(p.warnings.some((w) => /Leistung.*reicht nicht/i.test(w))).toBe(false)
    }
  })
})
