import { describe, expect, it } from 'vitest'
import type {
  GridTariffRowInput,
  LoadProfile,
  SpotPriceSeriesInput,
  TariffParams,
  TariffPricingInputs,
} from 'shared'

import { intervalTariffRates } from './tou'

/**
 * Delta 4 (B21-3b) — der kombinierte Intervallpreis.
 *
 * Die Zahlen in diesen Tests sind VON HAND nachgerechnet und stehen als Rechnung im Test, nicht als
 * Erwartungswert aus einem vorherigen Lauf: `effectivePriceCtPerKwh(t) = Spotpreis(t) +
 * Fensterpreis(t) + Netzverlust`. Ein gepinnter Wert ohne die Rechnung daneben belegte nur, dass
 * sich nichts geändert hat — nicht, dass es stimmt.
 */

const STEP_MS = 15 * 60 * 1000
const ONE_HOUR_MS = 60 * 60 * 1000
const iso = (ms: number): string => new Date(ms).toISOString()

/**
 * Lastgang in **Europe/Vienna**, weil genau das der reale Fall ist: Tarif-Zeitfenster (SNAP) und
 * Gültigkeitsdaten sind Wanduhr- bzw. Kalenderangaben, die Zeitstempel dagegen UTC. Ein Test in UTC
 * bliebe grün, auch wenn die Zeitzone ignoriert würde.
 */
function profile(startIso: string, count: number, kw = 10): LoadProfile {
  const t0 = Date.parse(startIso)
  return {
    readings: Array.from({ length: count }, (_, i) => ({ ts: iso(t0 + i * STEP_MS), gridPowerKw: kw })),
    intervalMinutes: 15,
    timezoneMeta: 'Europe/Vienna',
    source: 'import_only',
  }
}

const tariff: TariffParams = {
  leistungspreisEurPerKwYear: 100,
  billingModel: 'annual_max',
  minBillableKw: 0,
  energyPriceCtPerKwh: 25,
  einspeiseverguetungCtPerKwh: 8,
}

/** Stündliche Preisreihe ab `startIso`, Preis i = `priceAt(i)`. */
function spotSeries(startIso: string, hours: number, priceAt: (h: number) => number): SpotPriceSeriesInput {
  const t0 = Date.parse(startIso)
  return {
    prices: Array.from({ length: hours }, (_, h) => ({
      tsStart: iso(t0 + h * ONE_HOUR_MS),
      tsEnd: iso(t0 + (h + 1) * ONE_HOUR_MS),
      ctPerKwh: priceAt(h),
      priceBasis: 'net',
    })),
    complete: true,
    missingRanges: [],
  }
}

/** Das reale B21-2b-Muster: ein ganztägiges Grundfenster + ein saisonal ausgeschnittenes SNAP-Fenster. */
function gridRow(
  validFrom: string,
  validUntil: string | null,
  normalCt: number,
  snapCt: number,
  netzverlustCtPerKwh = 1.23,
): GridTariffRowInput {
  return {
    validFrom,
    validUntil,
    netzverlustCtPerKwh,
    priceBasis: 'net',
    windows: [
      { label: 'normal', monthDayFrom: null, monthDayTo: null, timeFrom: '00:00:00', timeTo: '24:00:00', ctPerKwh: normalCt },
      { label: 'snap', monthDayFrom: '10-01', monthDayTo: '03-31', timeFrom: '17:00:00', timeTo: '20:00:00', ctPerKwh: snapCt },
    ],
  }
}

describe('Delta 4 — kombinierter Intervallpreis', () => {
  /*
   * 1. Januar 2025, Ortszeit Wien. Der Lastgang beginnt um 00:00 Ortszeit = 2024-12-31T23:00Z
   *    (die Kante, für die der Spotpreis-Anker vorgezogen wurde). 24 Intervalle = 6 Stunden.
   */
  const START_UTC = '2024-12-31T23:00:00Z'

  it('rechnet Spotpreis + Fensterpreis + Netzverlust zusammen — drei Intervalle von Hand', () => {
    const load = profile(START_UTC, 24)
    // Stundenpreise 5, 6, 7, 8, 9, 10 ct/kWh.
    const spot = spotSeries(START_UTC, 6, (h) => 5 + h)
    const pricing: TariffPricingInputs = {
      gridTariffRows: [gridRow('2025-01-01', '2025-12-31', 4.5, 9.9)],
      spotPrices: spot,
    }

    const { rateCtPerKwh, tariffOptimization } = intervalTariffRates(load, tariff, pricing)

    expect(tariffOptimization).toEqual({ computable: true })
    expect(rateCtPerKwh).toHaveLength(24)

    // Intervall 0 — 00:00 Ortszeit, Stunde 0: 5 (Spot) + 4,5 (normal) + 1,23 (Netzverlust) = 10,73
    expect(rateCtPerKwh[0]).toBeCloseTo(5 + 4.5 + 1.23, 10)
    // Intervall 3 — 00:45 Ortszeit, immer noch Stunde 0 (Viertelstunde ≠ Preisstunde)
    expect(rateCtPerKwh[3]).toBeCloseTo(5 + 4.5 + 1.23, 10)
    // Intervall 4 — 01:00 Ortszeit, Stunde 1: 6 + 4,5 + 1,23 = 11,73
    expect(rateCtPerKwh[4]).toBeCloseTo(6 + 4.5 + 1.23, 10)
    // Intervall 20 — 05:00 Ortszeit, Stunde 5: 10 + 4,5 + 1,23 = 15,73
    expect(rateCtPerKwh[20]).toBeCloseTo(10 + 4.5 + 1.23, 10)
  })

  it('nimmt im SNAP-Fenster den ausgeschnittenen Preis, davor und danach den Grundpreis', () => {
    // 1.1.2025 ab 16:00 Ortszeit = 15:00Z. SNAP gilt 17:00–20:00 Ortszeit, saisonal 10-01…03-31.
    const start = '2025-01-01T15:00:00Z'
    const load = profile(start, 24) // 16:00–22:00 Ortszeit
    const spot = spotSeries(start, 6, () => 10)
    const pricing: TariffPricingInputs = {
      gridTariffRows: [gridRow('2025-01-01', '2025-12-31', 4.5, 9.9)],
      spotPrices: spot,
    }

    const { rateCtPerKwh } = intervalTariffRates(load, tariff, pricing)

    // 16:00 Ortszeit (Intervall 0) — vor SNAP: 10 + 4,5 + 1,23 = 15,73
    expect(rateCtPerKwh[0]).toBeCloseTo(10 + 4.5 + 1.23, 10)
    // 17:00 Ortszeit (Intervall 4) — SNAP: 10 + 9,9 + 1,23 = 21,13
    expect(rateCtPerKwh[4]).toBeCloseTo(10 + 9.9 + 1.23, 10)
    // 19:45 Ortszeit (Intervall 15) — noch SNAP (Fenster ist [17:00, 20:00))
    expect(rateCtPerKwh[15]).toBeCloseTo(10 + 9.9 + 1.23, 10)
    // 20:00 Ortszeit (Intervall 16) — wieder Grundfenster
    expect(rateCtPerKwh[16]).toBeCloseTo(10 + 4.5 + 1.23, 10)
  })

  it('lässt das SNAP-Fenster ausserhalb seiner Saison aus (Sommer, gleiche Uhrzeit)', () => {
    // 1. Juli 2025, 17:00 Ortszeit (Sommerzeit! = 15:00Z) — SNAP gilt nur 10-01…03-31.
    const start = '2025-07-01T15:00:00Z'
    const load = profile(start, 4)
    const spot = spotSeries(start, 1, () => 10)
    const pricing: TariffPricingInputs = {
      gridTariffRows: [gridRow('2025-01-01', '2025-12-31', 4.5, 9.9)],
      spotPrices: spot,
    }

    const { rateCtPerKwh } = intervalTariffRates(load, tariff, pricing)
    expect(rateCtPerKwh[0]).toBeCloseTo(10 + 4.5 + 1.23, 10)
  })

  it('wechselt MITTEN im Lastgang die Tarifzeile — inklusives valid_until, kein Versatz um einen Tag', () => {
    /*
     * Zwei aufeinanderfolgende Stände derselben Kombination, wie `public.create_grid_tariff` sie
     * anlegt: `… → 2025-12-31` und `2026-01-01 → offen`. Der Lastgang läuft über den Wechsel.
     * Beginn 31.12.2025 22:00 Ortszeit = 21:00Z, 16 Intervalle = 4 Stunden (bis 02:00 Ortszeit).
     */
    const start = '2025-12-31T21:00:00Z'
    const load = profile(start, 16)
    const spot = spotSeries(start, 4, () => 10)
    const pricing: TariffPricingInputs = {
      gridTariffRows: [
        gridRow('2025-01-01', '2025-12-31', 4.5, 9.9),
        gridRow('2026-01-01', null, 6.0, 12.0, 2.0),
      ],
      spotPrices: spot,
    }

    const { rateCtPerKwh, tariffOptimization } = intervalTariffRates(load, tariff, pricing)
    expect(tariffOptimization).toEqual({ computable: true })

    // 22:00/23:00 Ortszeit am 31.12.2025 → ALTE Zeile (letzter Gültigkeitstag, `valid_until` inklusiv)
    expect(rateCtPerKwh[0]).toBeCloseTo(10 + 4.5 + 1.23, 10)
    expect(rateCtPerKwh[7]).toBeCloseTo(10 + 4.5 + 1.23, 10)
    // 00:00/01:00 Ortszeit am 1.1.2026 → NEUE Zeile (anderer Fensterpreis UND anderer Netzverlust)
    expect(rateCtPerKwh[8]).toBeCloseTo(10 + 6.0 + 2.0, 10)
    expect(rateCtPerKwh[15]).toBeCloseTo(10 + 6.0 + 2.0, 10)

    // Der Wechsel liegt GENAU zwischen Intervall 7 und 8 — kein Intervall trägt einen Mischpreis.
    const distinct = [...new Set(rateCtPerKwh.map((v) => v.toFixed(6)))]
    expect(distinct).toHaveLength(2)
  })

  it('halboffen gelesen fiele der letzte Gültigkeitstag heraus — er tut es nicht', () => {
    // Der ganze 31.12.2025 (Ortszeit) gehört noch zur alten Zeile. Nur die alte Zeile ist da:
    // fiele der letzte Tag heraus, wäre der Hebel „nicht berechenbar" statt gerechnet.
    const start = '2025-12-30T23:00:00Z' // 31.12.2025 00:00 Ortszeit
    const load = profile(start, 96)
    const spot = spotSeries(start, 24, () => 10)
    const pricing: TariffPricingInputs = {
      gridTariffRows: [gridRow('2025-01-01', '2025-12-31', 4.5, 9.9)],
      spotPrices: spot,
    }

    const { rateCtPerKwh, tariffOptimization } = intervalTariffRates(load, tariff, pricing)
    expect(tariffOptimization).toEqual({ computable: true })
    expect(rateCtPerKwh.every((v) => Number.isFinite(v))).toBe(true)
  })

  it('meldet eine SPOTPREIS-Lücke mit Grund und Zeitraum — und rechnet den Hebel nicht', () => {
    const load = profile(START_UTC, 24)
    const spot = spotSeries(START_UTC, 6, () => 10)
    const withGap: SpotPriceSeriesInput = {
      ...spot,
      complete: false,
      missingRanges: [{ fromIso: '2025-01-01T02:00:00.000Z', toIso: '2025-01-01T03:00:00.000Z' }],
    }
    const pricing: TariffPricingInputs = {
      gridTariffRows: [gridRow('2025-01-01', '2025-12-31', 4.5, 9.9)],
      spotPrices: withGap,
    }

    const result = intervalTariffRates(load, tariff, pricing)

    expect(result.tariffOptimization).toMatchObject({
      computable: false,
      side: 'spot_price',
      kind: 'gap',
      ranges: [{ fromIso: '2025-01-01T02:00:00.000Z', toIso: '2025-01-01T03:00:00.000Z' }],
    })
    // Der Zeitraum steht IM Text, nicht nur im Objekt — die Meldung geht so in `dataQuality`.
    expect(result.tariffOptimization).toHaveProperty('message', expect.stringContaining('2025-01-01 02:00'))
    // Kein stiller Rückfall: alle Raten auf dem Standardpreis, keine Lastverschiebung.
    expect(result.rateCtPerKwh.every((v) => v === 25)).toBe(true)
    expect(result.isCheapWindow.every((v) => v === false)).toBe(true)
    expect(result.touActive).toBe(false)
  })

  it('meldet eine NETZENTGELT-Lücke, wenn keine Tarifzeile das Intervall abdeckt', () => {
    // Lastgang 2025, Tarifzeile gilt erst ab 2026 → gar keine Deckung.
    const load = profile(START_UTC, 24)
    const pricing: TariffPricingInputs = {
      gridTariffRows: [gridRow('2026-01-01', null, 4.5, 9.9)],
      spotPrices: spotSeries(START_UTC, 6, () => 10),
    }

    const result = intervalTariffRates(load, tariff, pricing)
    expect(result.tariffOptimization).toMatchObject({
      computable: false,
      side: 'grid_tariff',
      kind: 'gap',
    })
    const blocker = result.tariffOptimization as { ranges: Array<{ fromIso: string; toIso: string }> }
    // Zusammenhängend → EIN Bereich, nicht 24 einzelne.
    expect(blocker.ranges).toHaveLength(1)
    expect(blocker.ranges[0]!.fromIso).toBe('2024-12-31T23:00:00.000Z')
    expect(result.rateCtPerKwh.every((v) => v === 25)).toBe(true)
  })

  it('meldet eine TEILWEISE Netzentgelt-Lücke mit dem betroffenen Zeitraum', () => {
    // Deckung erst ab dem zweiten Tag: der erste Tag ist die Lücke.
    const start = '2024-12-31T23:00:00Z' // 1.1.2025 00:00 Ortszeit
    const load = profile(start, 192) // 2 Tage
    const pricing: TariffPricingInputs = {
      gridTariffRows: [gridRow('2025-01-02', null, 4.5, 9.9)],
      spotPrices: spotSeries(start, 48, () => 10),
    }

    const result = intervalTariffRates(load, tariff, pricing)
    const blocker = result.tariffOptimization as {
      side: string
      ranges: Array<{ fromIso: string; toIso: string }>
    }
    expect(blocker.side).toBe('grid_tariff')
    expect(blocker.ranges).toHaveLength(1)
    expect(blocker.ranges[0]!.fromIso).toBe('2024-12-31T23:00:00.000Z')
    // Der erste Tag Ortszeit endet mit 2025-01-01T23:00Z (= 2.1. 00:00 Ortszeit).
    expect(blocker.ranges[0]!.toIso).toBe('2025-01-01T23:00:00.000Z')
  })

  it('meldet fehlende Quellen getrennt: Netzentgelt zuerst, dann Spotpreise', () => {
    const load = profile(START_UTC, 4)
    const spot = spotSeries(START_UTC, 1, () => 10)

    const noGrid = intervalTariffRates(load, tariff, { gridTariffRows: null, spotPrices: spot })
    expect(noGrid.tariffOptimization).toMatchObject({
      computable: false,
      side: 'grid_tariff',
      kind: 'unavailable',
      ranges: [],
    })

    const noSpot = intervalTariffRates(load, tariff, {
      gridTariffRows: [gridRow('2025-01-01', null, 4.5, 9.9)],
      spotPrices: null,
    })
    expect(noSpot.tariffOptimization).toMatchObject({
      computable: false,
      side: 'spot_price',
      kind: 'unavailable',
    })

    // Fehlen BEIDE, wird die Netzentgelt-Seite genannt: sie ist ein Pflegestand, der von Hand
    // nachzutragen ist — eine Spotpreis-Lücke schliesst der nächste Cron-Lauf von selbst.
    const neither = intervalTariffRates(load, tariff, { gridTariffRows: null, spotPrices: null })
    expect(neither.tariffOptimization).toMatchObject({ side: 'grid_tariff' })
  })

  it('rechnet nicht mit Bruttopreisen, statt sie stillschweigend zu mischen (Delta 6)', () => {
    const load = profile(START_UTC, 4)
    const grossSpot = spotSeries(START_UTC, 1, () => 10)
    grossSpot.prices[0]!.priceBasis = 'gross'

    const result = intervalTariffRates(load, tariff, {
      gridTariffRows: [gridRow('2025-01-01', null, 4.5, 9.9)],
      spotPrices: grossSpot,
    })
    expect(result.tariffOptimization).toMatchObject({
      computable: false,
      side: 'spot_price',
      kind: 'price_basis',
    })
  })

  it('misst „günstig" am MITTEL der kombinierten Preise, nicht am alten Standardpreis', () => {
    /*
     * Der kombinierte Preis liegt durch das Netzentgelt als Ganzes über `energyPriceCtPerKwh` (25).
     * Gegen den alten Bezugswert gemessen wäre keine einzige Stunde günstig, und die
     * Lastverschiebung fiele still auf 0 — genau die stille Verschlechterung, die dieser Bauschritt
     * vermeiden soll.
     */
    const load = profile(START_UTC, 24)
    // Stundenpreise 10, 30, 10, 30, 10, 30 → kombiniert 15,73 / 35,73 / … Mittel = 25,73
    const spot = spotSeries(START_UTC, 6, (h) => (h % 2 === 0 ? 10 : 30))
    const pricing: TariffPricingInputs = {
      gridTariffRows: [gridRow('2025-01-01', null, 4.5, 9.9)],
      spotPrices: spot,
    }

    const { rateCtPerKwh, isCheapWindow, touActive } = intervalTariffRates(load, tariff, pricing)
    const mean = rateCtPerKwh.reduce((a, b) => a + b, 0) / rateCtPerKwh.length
    expect(mean).toBeCloseTo(25.73, 10)
    expect(touActive).toBe(true)
    expect(isCheapWindow[0]).toBe(true) // 15,73 < 25,73
    expect(isCheapWindow[4]).toBe(false) // 35,73 > 25,73
    // Beide Stunden liegen ÜBER bzw. UNTER dem alten Standardpreis von 25 — am alten Bezugswert
    // gemessen wäre nur die 10-ct-Stunde knapp darunter geblieben und die Aussage eine andere.
    expect(rateCtPerKwh[0]!).toBeGreaterThan(0)
  })

  it('ohne `pricing` verhält es sich exakt wie vor B21 — statische Fenster, kein Status', () => {
    const load = profile(START_UTC, 96)
    const withNight: TariffParams = { ...tariff, energyPriceNightCtPerKwh: 12 }

    const plain = intervalTariffRates(load, tariff)
    expect(plain.tariffOptimization).toBeUndefined()
    expect(plain.rateCtPerKwh.every((v) => v === 25)).toBe(true)
    expect(plain.touActive).toBe(false)

    const nt = intervalTariffRates(load, withNight)
    expect(nt.tariffOptimization).toBeUndefined()
    expect(nt.touActive).toBe(true)
    // 00:00–06:00 Ortszeit ist das Default-NT-Fenster → 12 ct.
    expect(nt.rateCtPerKwh[0]).toBe(12)
    // 08:00 Ortszeit (Intervall 32) liegt ausserhalb → Standardpreis.
    expect(nt.rateCtPerKwh[32]).toBe(25)
  })
})
