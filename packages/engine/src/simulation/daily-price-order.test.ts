import { describe, expect, it } from 'vitest'
import type {
  GridTariffRowInput,
  LoadProfile,
  SpotPriceSeriesInput,
  TariffParams,
  TariffPricingInputs,
} from 'shared'

import { dailyPriceOrder } from './daily-price-order'
import { runCombinedDispatch } from './dispatch'
import { drawSeries, intervalHours, startSoc, type BatteryPhysics } from './helpers'
import { intervalTariffRates } from './tou'

/**
 * Tages-Rangfolge für Laden/Entladen (§3.6 Schritt 5, Produktentscheidung 02.09.2026).
 *
 * ── ⚠ WORAUF DIESE TESTS ABZIELEN ──────────────────────────────────────────────────────────────
 * Ein Test, der nur „es wurde in einer günstigen Stunde geladen" prüft, bliebe auch beim alten,
 * rein chronologisch-greedy Verhalten grün — die alte Regel lädt ja ebenfalls nur unter dem
 * Tages-Mittel. Beide Tests bauen deshalb einen Tag, an dem MEHR günstige Stunden vorhanden sind,
 * als die Batterie nutzen kann, und messen, WELCHE davon benutzt werden. Und beide nennen
 * ausdrücklich, was die alte Regel getan hätte.
 */

const STEP_MS = 15 * 60 * 1000
// `ONE_HOUR_MS` statt `HOUR_MS`: Letzteres ist ein exportierter Bezeichner der B21-Datenschicht,
// und der Reinheits-Wächter (`tariff/no-data-layer-dependency.test.ts`) schlägt darauf an. Eine
// selbstverschuldete Namenskollision ist kein Grund, eine Prüfung aufzuweichen.
const ONE_HOUR_MS = 60 * 60 * 1000
const iso = (ms: number): string => new Date(ms).toISOString()

/** Lastgang in UTC, damit „Stunde h" ohne Zeitzonen-Umrechnung ein Kalendertag-Offset ist. */
function profile(startIso: string, kwPerInterval: number[]): LoadProfile {
  const t0 = Date.parse(startIso)
  return {
    readings: kwPerInterval.map((kw, i) => ({ ts: iso(t0 + i * STEP_MS), gridPowerKw: kw })),
    intervalMinutes: 15,
    timezoneMeta: 'UTC',
    source: 'import_only',
  }
}

/** Stündliche Preisreihe ab `startIso`; `priceAt(h)` ist der Börsenpreis der Stunde h. */
function spotSeries(startIso: string, hours: number, priceAt: (h: number) => number): SpotPriceSeriesInput {
  const t0 = Date.parse(startIso)
  return {
    prices: Array.from({ length: hours }, (_, h) => ({
      tsStart: iso(t0 + h * ONE_HOUR_MS),
      tsEnd: iso(t0 + (h + 1) * ONE_HOUR_MS),
      ctPerKwh: priceAt(h),
      priceBasis: 'net' as const,
    })),
    complete: true,
    missingRanges: [],
  }
}

/** Flaches Netzentgelt: der kombinierte Preis ist damit Börsenpreis + eine Konstante. */
const FLAT_GRID: GridTariffRowInput = {
  validFrom: '2024-12-01',
  validUntil: null,
  netzverlustCtPerKwh: 0,
  priceBasis: 'net',
  windows: [
    {
      label: 'normal',
      monthDayFrom: null,
      monthDayTo: null,
      timeFrom: '00:00:00',
      timeTo: '24:00:00',
      ctPerKwh: 0,
    },
  ],
}

const TARIFF: TariffParams = {
  leistungspreisEurPerKwYear: 0, // keine Spitzenkappung → cap = ∞, socFloor ≡ 0: die Rangfolge steht allein.
  billingModel: 'annual_max',
  minBillableKw: 0,
  energyPriceCtPerKwh: 25,
  einspeiseverguetungCtPerKwh: 8,
}

/** Der volle Weg: Preisreihe → Rangfolge → Dispatch, einmal MIT und einmal OHNE Rangfolge. */
function run(
  load: LoadProfile,
  physics: BatteryPhysics,
  pricing: TariffPricingInputs,
  socStartKwh?: number,
): {
  withOrder: ReturnType<typeof runCombinedDispatch>
  withoutOrder: ReturnType<typeof runCombinedDispatch>
  isCheapWindow: boolean[]
  rateCtPerKwh: number[]
  order: ReturnType<typeof dailyPriceOrder>
} {
  const draws = drawSeries(load)
  const deltaH = intervalHours(load)
  const capForInterval = draws.map(() => Infinity)
  const socFloorKwh = draws.map(() => 0)
  const { rateCtPerKwh, isCheapWindow, tariffOptimization } = intervalTariffRates(load, TARIFF, pricing)
  expect(tariffOptimization).toEqual({ computable: true })

  const order = dailyPriceOrder({
    loadProfile: load,
    rateCtPerKwh,
    preferChargeInterval: isCheapWindow,
    capForInterval,
    draws,
    physics,
    deltaH,
  })
  const s0 = socStartKwh ?? startSoc(physics)
  return {
    withOrder: runCombinedDispatch(draws, capForInterval, socFloorKwh, physics, s0, deltaH, isCheapWindow, order),
    withoutOrder: runCombinedDispatch(draws, capForInterval, socFloorKwh, physics, s0, deltaH, isCheapWindow),
    isCheapWindow,
    rateCtPerKwh,
    order,
  }
}

/** Summe der geladenen Netz-Energie (kWh, netzseitig) in den Intervallen der Stunde `h`. */
function chargedInHour(batteryPowerKw: number[], h: number, deltaH: number): number {
  let sum = 0
  for (let i = h * 4; i < h * 4 + 4; i++) sum += Math.max(0, batteryPowerKw[i] ?? 0) * deltaH
  return sum
}

/** Summe der entladenen Energie (kWh) in den Intervallen der Stunde `h`. */
function dischargedInHour(batteryPowerKw: number[], h: number, deltaH: number): number {
  let sum = 0
  for (let i = h * 4; i < h * 4 + 4; i++) sum += Math.max(0, -(batteryPowerKw[i] ?? 0)) * deltaH
  return sum
}

describe('§3.6 Schritt 5 — Tages-Rangfolge beim LADEN: die günstigsten Stunden zuerst', () => {
  /*
   * EIN Kalendertag (UTC), 24 Stunden à 4 Intervalle. Grundlast durchgehend 20 kW, damit die
   * Batterie in jeder Stunde laden könnte.
   *
   * Preisbild (kombinierter Preis = Börsenpreis, Netzentgelt flach 0):
   *   Stunden 0–5   : 18 ct   ← günstig (unter dem Tagesmittel), aber NICHT das Günstigste
   *   Stunden 6–11  : 10 ct   ← die GÜNSTIGSTEN Stunden des Tages, sie kommen SPÄTER
   *   Stunden 12–23 : 40 ct   ← teuer
   * Tagesmittel = (6·18 + 6·10 + 12·40) / 24 = (108 + 60 + 480) / 24 = 27 ct.
   * Unter dem Mittel liegen damit die Stunden 0–11 — zwölf Stunden, also 48 Intervalle.
   *
   * Batterie: 20 kWh / 20 kW / η = 1. Bei Δ = 0,25 h lädt sie mit 5 kWh je Intervall und ist nach
   * VIER Intervallen (= einer Stunde) voll. Es gibt also achtmal mehr günstige Gelegenheit als
   * Kapazität — genau die Lage, in der sich „günstig" und „am günstigsten" unterscheiden.
   */
  const START = '2025-03-05T00:00:00Z'
  const physics: BatteryPhysics = { usableCapacityKwh: 20, maxPowerKw: 20, roundTripEfficiency: 1 }
  const load = profile(START, Array.from({ length: 96 }, () => 20))
  const priceAt = (h: number): number => (h < 6 ? 18 : h < 12 ? 10 : 40)
  const pricing: TariffPricingInputs = {
    gridTariffRows: [FLAT_GRID],
    spotPrices: spotSeries(START, 24, priceAt),
  }
  const deltaH = 0.25
  // Start leer, damit ausschliesslich gemessen wird, WO geladen wird.
  const r = run(load, physics, pricing, 0)

  it('die Ausgangslage stimmt: zwölf Stunden liegen unter dem Tagesmittel', () => {
    expect(r.rateCtPerKwh[0]).toBeCloseTo(18, 9)
    expect(r.rateCtPerKwh[24]).toBeCloseTo(10, 9)
    expect(r.rateCtPerKwh[48]).toBeCloseTo(40, 9)
    expect(r.isCheapWindow.filter(Boolean)).toHaveLength(48) // Stunden 0–11
  })

  it('MIT Rangfolge wird in den 10-ct-Stunden geladen, OHNE Rangfolge in den 18-ct-Stunden', () => {
    const cheapest = [6, 7, 8, 9, 10, 11].reduce((s, h) => s + chargedInHour(r.withOrder.batteryPowerKw, h, deltaH), 0)
    const merelyCheap = [0, 1, 2, 3, 4, 5].reduce((s, h) => s + chargedInHour(r.withOrder.batteryPowerKw, h, deltaH), 0)
    expect(cheapest).toBeCloseTo(20, 9) // die volle Kapazität aus den günstigsten Stunden
    expect(merelyCheap).toBeCloseTo(0, 9) // und keine einzige kWh aus den bloss günstigen

    // Und das ist der Beleg, dass die Änderung wirkt: die ALTE Regel tat exakt das Gegenteil.
    const oldCheapest = [6, 7, 8, 9, 10, 11].reduce(
      (s, h) => s + chargedInHour(r.withoutOrder.batteryPowerKw, h, deltaH), 0)
    const oldMerelyCheap = [0, 1, 2, 3, 4, 5].reduce(
      (s, h) => s + chargedInHour(r.withoutOrder.batteryPowerKw, h, deltaH), 0)
    expect(oldMerelyCheap).toBeCloseTo(20, 9)
    expect(oldCheapest).toBeCloseTo(0, 9)
  })

  it('geladen wird in der ERSTEN der günstigsten Stunden — Preisgleichheit erzeugt keine Rangfolge', () => {
    // Die Stunden 6–11 kosten alle gleich viel; unter Gleichen entscheidet die Chronologie.
    expect(chargedInHour(r.withOrder.batteryPowerKw, 6, deltaH)).toBeCloseTo(20, 9)
    expect(chargedInHour(r.withOrder.batteryPowerKw, 7, deltaH)).toBeCloseTo(0, 9)
  })

  it('die Ladeobergrenze ist eine Ordnungs-Aussage, keine gesetzte Schwelle', () => {
    // Stunde 0 (18 ct): später kommen 24 Intervalle à 5 kWh zu 10 ct → weit über der Kapazität,
    // die Obergrenze fällt deshalb auf 0.
    expect(r.order.chargeCeilingKwh[0]).toBeCloseTo(0, 9)
    // Stunde 6 (10 ct): nichts Günstigeres mehr an diesem Tag → volle Kapazität.
    expect(r.order.chargeCeilingKwh[24]).toBeCloseTo(20, 9)
  })
})

describe('§3.6 Schritt 5 — Tages-Rangfolge beim ENTLADEN: die teuersten Stunden zuerst', () => {
  /*
   * EIN Kalendertag. Preisbild:
   *   Stunden 0–11  : 20 ct   ← unter dem Tagesmittel → Ladefenster
   *   Stunden 12–17 : 38 ct   ← teuer genug für Eigenverbrauch, aber NICHT das Teuerste
   *   Stunden 18–23 : 60 ct   ← die teuersten Stunden des Tages, sie kommen SPÄTER
   * Tagesmittel = (12·20 + 6·38 + 6·60) / 24 = (240 + 228 + 360) / 24 = 34,5 ct.
   *
   * Batterie 20 kWh / 20 kW / η = 1, leer gestartet: sie lädt in den 20-ct-Stunden voll und kann
   * danach genau EINMAL 20 kWh abgeben — es gibt an diesem Tag kein weiteres Ladefenster. Die
   * Frage ist also allein, WANN sie abgibt, und zwischen 38 und 60 ct liegen 22 ct je kWh.
   */
  const START = '2025-03-06T00:00:00Z'
  const physics: BatteryPhysics = { usableCapacityKwh: 20, maxPowerKw: 20, roundTripEfficiency: 1 }
  const load = profile(START, Array.from({ length: 96 }, () => 20))
  const priceAt = (h: number): number => (h < 12 ? 20 : h < 18 ? 38 : 60)
  const pricing: TariffPricingInputs = {
    gridTariffRows: [FLAT_GRID],
    spotPrices: spotSeries(START, 24, priceAt),
  }
  const deltaH = 0.25
  const r = run(load, physics, pricing, 0)

  it('die Ausgangslage stimmt: nur die 20-ct-Stunden sind Ladefenster', () => {
    expect(r.isCheapWindow.filter(Boolean)).toHaveLength(48) // Stunden 0–11
    expect(r.isCheapWindow[48]).toBe(false) // Stunde 12 (38 ct)
    expect(r.isCheapWindow[72]).toBe(false) // Stunde 18 (60 ct)
  })

  it('MIT Rangfolge fliesst die Energie in die 60-ct-Stunden, OHNE Rangfolge in die 38-ct-Stunden', () => {
    const priciest = [18, 19, 20, 21, 22, 23].reduce(
      (sum, h) => sum + dischargedInHour(r.withOrder.batteryPowerKw, h, deltaH), 0)
    const merelyPricey = [12, 13, 14, 15, 16, 17].reduce(
      (sum, h) => sum + dischargedInHour(r.withOrder.batteryPowerKw, h, deltaH), 0)
    expect(priciest).toBeCloseTo(20, 9)
    expect(merelyPricey).toBeCloseTo(0, 9)

    // Und das ist der Beleg: die ALTE Regel entlud vollständig in die 38-ct-Stunden und stand am
    // Abend leer da — sie kennt nur „Bezug ist da", nicht „teurer kommt noch".
    const oldPriciest = [18, 19, 20, 21, 22, 23].reduce(
      (sum, h) => sum + dischargedInHour(r.withoutOrder.batteryPowerKw, h, deltaH), 0)
    const oldMerelyPricey = [12, 13, 14, 15, 16, 17].reduce(
      (sum, h) => sum + dischargedInHour(r.withoutOrder.batteryPowerKw, h, deltaH), 0)
    expect(oldMerelyPricey).toBeCloseTo(20, 9)
    expect(oldPriciest).toBeCloseTo(0, 9)
  })

  it('die Preis-Untergrenze hält die Energie bis zur ersten teuren Stunde und gibt sie dann frei', () => {
    expect(r.order.priceFloorKwh[48]).toBeCloseTo(20, 9) // Stunde 12 (38 ct): alles reserviert
    expect(r.order.priceFloorKwh[72]).toBeCloseTo(0, 9) // Stunde 18 (60 ct): nichts Teureres mehr
    expect(r.withOrder.socKwh[71]).toBeCloseTo(20, 6) // unmittelbar davor steht sie voll da
  })
})

describe('§3.6 Schritt 5 — die Rangfolge kostet KEINEN Durchsatz', () => {
  /*
   * ⚠ Der Test, der die naive Fassung dieser Regel widerlegt hat (s. Modulkopf `daily-price-order`).
   * Preisbild:
   *   Stunden 0–5   : 41 ct   ← über dem Tagesmittel → Eigenverbrauch erlaubt
   *   Stunden 6–17  : 30 ct   ← Ladefenster MITTEN AM TAG
   *   Stunden 18–23 : 60 ct   ← die teuersten Stunden
   * Tagesmittel = (6·41 + 12·30 + 6·60) / 24 = (246 + 360 + 360) / 24 = 40,25 ct.
   *
   * Der Speicher startet voll und schafft an diesem Tag ZWEI Zyklen: morgens 20 kWh zu 41 ct
   * abgeben, mittags zu 30 ct nachladen, abends 20 kWh zu 60 ct abgeben. Eine Regel, die die
   * Energie stur für die teuerste Stunde zurückhielte, lieferte nur die Hälfte davon — und wäre
   * damit schlechter als der Stand vor dieser Änderung.
   */
  const START = '2025-03-08T00:00:00Z'
  const physics: BatteryPhysics = { usableCapacityKwh: 20, maxPowerKw: 20, roundTripEfficiency: 1 }
  const load = profile(START, Array.from({ length: 96 }, () => 20))
  const priceAt = (h: number): number => (h < 6 ? 41 : h < 18 ? 30 : 60)
  const pricing: TariffPricingInputs = {
    gridTariffRows: [FLAT_GRID],
    spotPrices: spotSeries(START, 24, priceAt),
  }
  const deltaH = 0.25
  const r = run(load, physics, pricing, 20)

  it('die frühen 41-ct-Stunden werden bedient, weil mittags zu 30 ct nachgeladen werden kann', () => {
    expect(r.order.priceFloorKwh[0]).toBeCloseTo(0, 9)
    const early = [0, 1, 2, 3, 4, 5].reduce(
      (sum, h) => sum + dischargedInHour(r.withOrder.batteryPowerKw, h, deltaH), 0)
    expect(early).toBeCloseTo(20, 9)
  })

  it('und die teuren Abendstunden trotzdem auch — zwei volle Zyklen an einem Tag', () => {
    const evening = [18, 19, 20, 21, 22, 23].reduce(
      (sum, h) => sum + dischargedInHour(r.withOrder.batteryPowerKw, h, deltaH), 0)
    expect(evening).toBeCloseTo(20, 9)

    const total = Array.from({ length: 24 }, (_, h) =>
      dischargedInHour(r.withOrder.batteryPowerKw, h, deltaH)).reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(40, 9)
    // Der Durchsatz ist derselbe wie ohne Rangfolge — sie verschiebt nur, WOHIN er fliesst.
    const totalOld = Array.from({ length: 24 }, (_, h) =>
      dischargedInHour(r.withoutOrder.batteryPowerKw, h, deltaH)).reduce((a, b) => a + b, 0)
    expect(totalOld).toBeCloseTo(40, 9)
  })
})

describe('§3.6 Schritt 5 — die Schranken lassen den Spitzenschutz unangetastet', () => {
  /*
   * Ein Tag mit einer echten Spitze in einer BILLIGEN Stunde. Die Preis-Untergrenze würde die
   * Energie gern für den teuren Abend zurückhalten — Schritt 2 (Spitzenkappung) fragt sie nicht.
   */
  const START = '2025-03-07T00:00:00Z'
  const physics: BatteryPhysics = { usableCapacityKwh: 20, maxPowerKw: 20, roundTripEfficiency: 1 }
  // Stunde 3 (Intervalle 12–15) trägt 60 kW, sonst 20 kW.
  const kws = Array.from({ length: 96 }, (_, i) => (i >= 12 && i < 16 ? 60 : 20))
  const load = profile(START, kws)
  const priceAt = (h: number): number => (h < 18 ? 10 : 45)
  const pricing: TariffPricingInputs = {
    gridTariffRows: [FLAT_GRID],
    spotPrices: spotSeries(START, 24, priceAt),
  }

  it('bei `cap` = 40 kW wird die Spitze gekappt, obwohl die Preis-Untergrenze dort greift', () => {
    const draws = drawSeries(load)
    const deltaH = intervalHours(load)
    const capForInterval = draws.map(() => 40)
    const socFloorKwh = draws.map(() => 0)
    const { rateCtPerKwh, isCheapWindow } = intervalTariffRates(load, TARIFF, pricing)
    const order = dailyPriceOrder({
      loadProfile: load,
      rateCtPerKwh,
      preferChargeInterval: isCheapWindow,
      capForInterval,
      draws,
      physics,
      deltaH,
    })
    // Die Untergrenze reserviert in Intervall 12 sehr wohl Energie für den teuren Abend …
    expect(order.priceFloorKwh[12] ?? 0).toBeGreaterThan(0)

    const d = runCombinedDispatch(draws, capForInterval, socFloorKwh, physics, 20, deltaH, isCheapWindow, order)
    // … und trotzdem wird die Spitze vollständig auf `cap` gekappt.
    for (let i = 12; i < 16; i++) expect(d.gridAfterKw[i]).toBeCloseTo(40, 6)
  })
})
