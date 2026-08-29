import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DEMO_BATTERY_CATALOG,
  type GridTariffRowInput,
  type SpotPriceSeriesInput,
  type TariffParams,
  type TariffPricingInputs,
} from 'shared'

import { parseLoadProfile } from '../parser'
import { recommendBattery } from '../recommendation/rank'
import { intervalTariffRates } from './tou'

/**
 * Delta 4 (B21-3b) — der kombinierte Preis durch die VOLLE Kette, gegen den echten Demo-Lastgang.
 *
 * `tou.test.ts` prüft die Preisbildung je Intervall; hier geht es um die Verdrahtung: dass
 * `recommendBattery → simulateBattery → computeBatterySavings → intervalTariffRates` dieselben
 * Preise sieht, und dass ein nicht berechenbarer Hebel die Peak-Shaving-Zahlen NICHT anfasst.
 */

const demoCsv = readFileSync(
  new URL('../../../../dev-fixtures/demo-baeckerei-lastgang-2025.csv', import.meta.url),
  'utf8',
)

const parsed = parseLoadProfile({ content: demoCsv, format: 'csv' })
if (!parsed.ok) throw new Error('Demo-Fixture nicht lesbar — der Test prüfte sonst nichts.')
const load = parsed.profile

const tariff: TariffParams = {
  leistungspreisEurPerKwYear: 38.52, // Wiener Netze NE 3, der einzige belegte Vorgabewert (B11)
  billingModel: 'annual_max',
  minBillableKw: 0,
  energyPriceCtPerKwh: 25,
  einspeiseverguetungCtPerKwh: 8,
}

const ONE_HOUR_MS = 60 * 60 * 1000

/** Lückenlose Stundenreihe über den GANZEN Lastgang, damit `complete` auch wirklich stimmt. */
function fullSpotSeries(priceAt: (hourIndex: number) => number): SpotPriceSeriesInput {
  const first = Date.parse(load.readings[0]!.ts)
  const last = Date.parse(load.readings[load.readings.length - 1]!.ts) + 15 * 60 * 1000
  const hours = Math.ceil((last - first) / ONE_HOUR_MS)
  return {
    prices: Array.from({ length: hours }, (_, h) => ({
      tsStart: new Date(first + h * ONE_HOUR_MS).toISOString(),
      tsEnd: new Date(first + (h + 1) * ONE_HOUR_MS).toISOString(),
      ctPerKwh: priceAt(h),
      priceBasis: 'net' as const,
    })),
    complete: true,
    missingRanges: [],
  }
}

const gridRows: GridTariffRowInput[] = [
  {
    validFrom: '2025-01-01',
    validUntil: null,
    netzverlustCtPerKwh: 1.23,
    priceBasis: 'net',
    windows: [
      { label: 'normal', monthDayFrom: null, monthDayTo: null, timeFrom: '00:00:00', timeTo: '24:00:00', ctPerKwh: 4.5 },
      { label: 'snap', monthDayFrom: '10-01', monthDayTo: '03-31', timeFrom: '17:00:00', timeTo: '20:00:00', ctPerKwh: 9.9 },
    ],
  },
]

describe('Delta 4 — kombinierter Preis durch die volle Kette (Demo-Bäckerei 2025)', () => {
  it('deckt den ganzen Jahres-Lastgang ab und rechnet den Hebel', () => {
    // Der Lastgang beginnt ortszeitlich am 1.1.2025 — genau die Ein-Stunden-Kante, für die der
    // Spotpreis-Anker vorgezogen wurde. Deckt die Preisreihe sie nicht, wäre hier `gap`.
    expect(load.readings).toHaveLength(35_040)
    expect(load.readings[0]!.ts).toBe('2024-12-31T23:00:00.000Z')

    const pricing: TariffPricingInputs = {
      gridTariffRows: gridRows,
      spotPrices: fullSpotSeries((h) => 5 + (h % 24)),
    }
    const rates = intervalTariffRates(load, tariff, pricing)
    expect(rates.tariffOptimization).toEqual({ computable: true })
    expect(rates.rateCtPerKwh).toHaveLength(35_040)
    expect(rates.rateCtPerKwh.every((v) => Number.isFinite(v))).toBe(true)

    // Erstes Intervall von Hand: Stunde 0 → 5 (Spot) + 4,5 (normal) + 1,23 = 10,73
    expect(rates.rateCtPerKwh[0]).toBeCloseTo(5 + 4.5 + 1.23, 10)
  })

  it('ein nicht berechenbarer Hebel lässt die Peak-Shaving-Zahlen unverändert', () => {
    const withoutLever = recommendBattery(load, tariff, DEMO_BATTERY_CATALOG, 10)

    const brokenPricing: TariffPricingInputs = {
      gridTariffRows: gridRows,
      spotPrices: {
        ...fullSpotSeries(() => 10),
        complete: false,
        missingRanges: [{ fromIso: '2025-07-04T10:00:00.000Z', toIso: '2025-07-04T13:00:00.000Z' }],
      },
    }
    const withBrokenLever = recommendBattery(
      load,
      tariff,
      DEMO_BATTERY_CATALOG,
      10,
      undefined,
      undefined,
      brokenPricing,
    )

    // Der Hebel sagt, warum er nichts liefert …
    const status = intervalTariffRates(load, tariff, brokenPricing).tariffOptimization
    expect(status).toMatchObject({ computable: false, side: 'spot_price', kind: 'gap' })

    // … und die Peak-Shaving-Seite ist davon BIT-IDENTISCH unberührt.
    expect(withBrokenLever.recommendation).toEqual(withoutLever.recommendation)
    expect(withBrokenLever.perBattery).toHaveLength(withoutLever.perBattery.length)
    for (let i = 0; i < withoutLever.perBattery.length; i++) {
      const a = withoutLever.perBattery[i]!
      const b = withBrokenLever.perBattery[i]!
      expect(b.battery.id).toBe(a.battery.id)
      expect(b.newBilledKw).toBe(a.newBilledKw)
      expect(b.leistungspreisSavingPerYear).toBe(a.leistungspreisSavingPerYear)
      expect(b.selfConsumptionSavingPerYear).toBe(a.selfConsumptionSavingPerYear)
      expect(b.loadShiftSavingPerYear).toBe(a.loadShiftSavingPerYear)
      expect(b.totalSavingPerYear).toBe(a.totalSavingPerYear)
    }
  })

  it('ein berechenbarer Hebel bewegt die Lastverschiebung, nicht den Leistungspreis-Anteil', () => {
    const withoutLever = recommendBattery(load, tariff, DEMO_BATTERY_CATALOG, 10)
    // Tag/Nacht-Spreizung: nachts 5 ct, tagsüber 35 ct — ein Muster, das Laden im Tal belohnt.
    const pricing: TariffPricingInputs = {
      gridTariffRows: gridRows,
      spotPrices: fullSpotSeries((h) => (h % 24 < 6 || h % 24 >= 22 ? 5 : 35)),
    }
    const withLever = recommendBattery(
      load,
      tariff,
      DEMO_BATTERY_CATALOG,
      10,
      undefined,
      undefined,
      pricing,
    )

    const byId = (list: typeof withoutLever.perBattery) =>
      new Map(list.map((entry) => [entry.battery.id, entry]))
    const before = byId(withoutLever.perBattery)
    const after = byId(withLever.perBattery)

    // Ohne Tarif-Fenster ist die Lastverschiebung per Contract 0 (§3.7) …
    for (const entry of before.values()) expect(entry.loadShiftSavingPerYear).toBe(0)
    // … mit echter Preiskurve entsteht sie bei mindestens einem Kandidaten.
    const moved = [...after.values()].filter((e) => e.loadShiftSavingPerYear > 0)
    expect(moved.length).toBeGreaterThan(0)

    /*
     * Der Leistungspreis-Anteil hängt am gekappten Profil, nicht am Preis — die Kapp-Suche ist
     * preisunabhängig, nur das LADEN in günstigen Stunden ändert sich, und das darf die Kappung
     * nicht aufweichen.
     *
     * ⚠ GEMESSEN, nicht angenommen: hier gilt Gleichheit auf 9 Nachkommastellen, NICHT
     * bit-identisch. Beobachtet wurde eine Abweichung von 5e-15 kW (35,78004081726075 gegen
     * 35,780040817260755 — ein einziges ULP). Ursache ist Fliesskomma-Akkumulation: der Greedy-
     * Ladeschritt füllt in günstigen Stunden bis DICHT AN den Cap auf, und die Reihenfolge der
     * Additionen unterscheidet sich dadurch minimal. Fachlich ist die Kappung unverändert.
     *
     * Auf dem NICHT-berechenbaren Pfad gilt dagegen echte Bit-Identität (Test oben) — dort ist
     * `isCheapWindow` überall false und der Fahrplan damit derselbe wie ohne Hebel. Genau das ist
     * die Zusage, auf die es ankommt: ein ausgefallener Hebel verändert die Peak-Shaving-Zahlen
     * nicht einmal in der letzten Stelle.
     */
    for (const [id, a] of before) {
      const b = after.get(id)!
      expect(b.newBilledKw).toBeCloseTo(a.newBilledKw, 9)
      expect(b.leistungspreisSavingPerYear).toBeCloseTo(a.leistungspreisSavingPerYear, 6)
    }
  })
})
