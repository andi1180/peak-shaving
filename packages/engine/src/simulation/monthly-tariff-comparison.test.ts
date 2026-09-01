import { describe, expect, it } from 'vitest'
import type {
  GridTariffRowInput,
  LoadProfile,
  SpotPriceSeriesInput,
  TariffParams,
  TariffPricingInputs,
} from 'shared'

import { buildMonthlyTariffComparison } from './monthly-tariff-comparison'

/**
 * Monatsvergleich „Ist vs. aWATTar ohne Steuerung vs. aWATTar mit Speicher" (01.09.2026).
 *
 * ── ⚠ DIE ZAHLEN SIND VON HAND GERECHNET UND STEHEN ALS RECHNUNG IM TEST ───────────────────────
 * Ein aus einem vorherigen Lauf gepinnter Wert belegte nur, dass sich nichts geändert hat — nicht,
 * dass es stimmt. Die Werte des Netzentgelt-Teils sind die echten Wiener-Netze-Sätze aus dem
 * Preisblatt WN-EX0105 (Netzebene 7): Arbeitspreis `normal` 6,98 ct/kWh, `snap` 5,58 ct/kWh,
 * Netzverlustentgelt 0,700 ct/kWh.
 */

const STEP_MS = 15 * 60 * 1000
const ONE_HOUR_MS = 60 * 60 * 1000
const iso = (ms: number): string => new Date(ms).toISOString()

/** Die echten WN-EX0105-Sätze (NE 7) — sie stehen als Konstanten da, damit die Rechnung lesbar bleibt. */
const WN_NORMAL_CT = 6.98
const WN_SNAP_CT = 5.58
const WN_NETZVERLUST_CT = 0.7

const tariff: TariffParams = {
  leistungspreisEurPerKwYear: 100,
  billingModel: 'annual_max',
  minBillableKw: 0,
  energyPriceCtPerKwh: 25,
  einspeiseverguetungCtPerKwh: 8,
}

/** Lastgang in Europe/Vienna — Fenster und Monatsgrenzen sind Wanduhr-Angaben, die Zeitstempel UTC. */
function profile(startIso: string, kwPerInterval: number[]): LoadProfile {
  const t0 = Date.parse(startIso)
  return {
    readings: kwPerInterval.map((kw, i) => ({ ts: iso(t0 + i * STEP_MS), gridPowerKw: kw })),
    intervalMinutes: 15,
    timezoneMeta: 'Europe/Vienna',
    source: 'import_only',
  }
}

function spotSeries(
  startIso: string,
  hours: number,
  priceAt: (h: number) => number,
): SpotPriceSeriesInput {
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

/** Das reale B21-2b-Muster: ganztägiges Grundfenster + saisonal ausgeschnittenes SNAP-Fenster. */
const WN_ROW: GridTariffRowInput = {
  validFrom: '2024-01-01',
  validUntil: null,
  netzverlustCtPerKwh: WN_NETZVERLUST_CT,
  priceBasis: 'net',
  windows: [
    {
      label: 'normal',
      monthDayFrom: null,
      monthDayTo: null,
      timeFrom: '00:00:00',
      timeTo: '24:00:00',
      ctPerKwh: WN_NORMAL_CT,
    },
    {
      label: 'snap',
      monthDayFrom: '10-01',
      monthDayTo: '03-31',
      timeFrom: '17:00:00',
      timeTo: '20:00:00',
      ctPerKwh: WN_SNAP_CT,
    },
  ],
}

describe('Monatsvergleich — die Netzentgelt-Seite ist in BEIDEN Preisreihen dieselbe', () => {
  /*
   * 15. Jänner 2025, ab 17:00 ORTSZEIT = 16:00Z. Damit liegt das erste Intervall im SNAP-Fenster
   * (17:00–20:00, Saison 01.10.–31.03.) und ein späteres im Grundfenster — beide an EINEM Tag,
   * damit der Unterschied ausschliesslich aus dem Fenster stammt.
   */
  const START_UTC = '2025-01-15T16:00:00Z'
  const spot = spotSeries(START_UTC, 6, () => 10)
  const pricing: TariffPricingInputs = { gridTariffRows: [WN_ROW], spotPrices: spot }

  it('ein Intervall gegen die echten Wiener-Netze-Sätze, SNAP und normal, beide Reihen', () => {
    // 24 Intervalle = 6 Stunden ab 17:00 Ortszeit: 17:00–20:00 liegt im SNAP-Fenster (12
    // Intervalle), 20:00–23:00 im ganztägigen Grundfenster (12 Intervalle).
    const load = profile(START_UTC, Array.from({ length: 24 }, () => 4))
    const gridAfter = load.readings.map((r) => r.gridPowerKw)
    const result = buildMonthlyTariffComparison(load, tariff, pricing, gridAfter)!
    expect(result).toBeDefined()

    // 4 kW × 0,25 h = 1 kWh je Intervall — die Kosten je Intervall sind damit der Preis in Euro.
    // SNAP (12 Intervalle, 17:00–20:00 Ortszeit): Ist 25 + 5,58 + 0,70 = 31,28 ct
    //                                             aWATTar 10 + 5,58 + 0,70 = 16,28 ct
    // Grundfenster (12 Intervalle, 20:00–23:00 Ortszeit): Ist 25 + 6,98 + 0,70 = 32,68 ct
    //                                                     aWATTar 10 + 6,98 + 0,70 = 17,68 ct
    const expectedCurrent = (12 * 31.28 + 12 * 32.68) / 100
    const expectedSpot = (12 * 16.28 + 12 * 17.68) / 100

    expect(result.currentTariffEur[0]).toBeCloseTo(expectedCurrent, 10)
    expect(result.spotWithoutControlEur[0]).toBeCloseTo(expectedSpot, 10)
    // Ohne Batterie-Eingriff (gridAfter = roher Lastgang) ist die dritte Reihe die zweite.
    expect(result.spotWithBatteryEur[0]).toBeCloseTo(expectedSpot, 10)
  })

  it('die Differenz Ist − aWATTar ist EXAKT die Energiepreis-Differenz — das Netzentgelt kürzt sich weg', () => {
    /*
     * ⚠ DER KERNTEST GEGEN DIE BEZUGSGLEICHHEITS-FALLE. Liefen die beiden Reihen durch zwei
     * verschiedene Netzentgelt-Implementierungen, enthielte die Differenz einen Anteil, der gar
     * nicht am Strompreis liegt — und niemand sähe es, weil beide Zahlen für sich plausibel sind.
     * Geprüft wird deshalb nicht „ungefähr weniger", sondern die exakte Identität.
     */
    const load = profile(START_UTC, Array.from({ length: 24 }, () => 4))
    const gridAfter = load.readings.map((r) => r.gridPowerKw)
    const result = buildMonthlyTariffComparison(load, tariff, pricing, gridAfter)!

    // 24 Intervalle × 1 kWh = 24 kWh; Preisdifferenz je kWh = 25 − 10 = 15 ct.
    const energyKwh = 24 * 4 * 0.25
    const expectedDelta = (energyKwh * (tariff.energyPriceCtPerKwh - 10)) / 100
    expect(result.currentTariffEur[0]! - result.spotWithoutControlEur[0]!).toBeCloseTo(
      expectedDelta,
      10,
    )
  })

  it('ein Dispatch, der Bezug wegnimmt, senkt AUSSCHLIESSLICH die Reihe „mit Speicher"', () => {
    const load = profile(START_UTC, Array.from({ length: 24 }, () => 4))
    // Die Hälfte des Bezugs weggenommen — so, wie es ein Speicher täte.
    const gridAfter = load.readings.map((r) => r.gridPowerKw / 2)
    const result = buildMonthlyTariffComparison(load, tariff, pricing, gridAfter)!

    expect(result.spotWithBatteryEur[0]).toBeCloseTo(result.spotWithoutControlEur[0]! / 2, 10)
    // Die beiden Reihen auf dem ROHEN Lastgang sind davon unberührt.
    const untouched = buildMonthlyTariffComparison(
      load,
      tariff,
      pricing,
      load.readings.map((r) => r.gridPowerKw),
    )!
    expect(result.currentTariffEur[0]).toBe(untouched.currentTariffEur[0])
    expect(result.spotWithoutControlEur[0]).toBe(untouched.spotWithoutControlEur[0])
  })
})

describe('Monatsvergleich — Monatsgruppierung, Abdeckung und Hochrechnung', () => {
  /*
   * Ein Lastgang, der GENAU zwei Kalendermonate berührt: 31.01.2025 23:00 Ortszeit bis
   * 01.02.2025 00:45 Ortszeit. Über die Ortszeit-Mitternacht hinweg, damit die Gruppierung nach
   * der Wanduhr und nicht nach UTC geprüft ist (UTC steht in dieser Stunde noch auf dem 31.01.).
   */
  const START_UTC = '2025-01-31T22:00:00Z' // = 23:00 Ortszeit
  const spot = spotSeries(START_UTC, 4, () => 10)
  const pricing: TariffPricingInputs = { gridTariffRows: [WN_ROW], spotPrices: spot }

  const load = profile(START_UTC, Array.from({ length: 12 }, () => 4))
  const gridAfter = load.readings.map((r) => r.gridPowerKw)

  it('gruppiert nach LOKALEM Kalendermonat — 4 Intervalle Jänner, 8 Intervalle Februar', () => {
    const result = buildMonthlyTariffComparison(load, tariff, pricing, gridAfter)!
    // Grundfenster (23:00–01:00 Ortszeit, ausserhalb 17–20): Ist 25 + 6,98 + 0,70 = 32,68 ct/kWh.
    // 4 kW × 0,25 h = 1 kWh je Intervall.
    expect(result.currentTariffEur[0]).toBeCloseTo((4 * 32.68) / 100, 10) // Jänner
    expect(result.currentTariffEur[1]).toBeCloseTo((8 * 32.68) / 100, 10) // Februar
    expect(result.coveredMonths).toBe(2)
  })

  it('folgt NICHT dem Abrechnungsmodell — `annual_max` liefert trotzdem zwei Monatsbalken', () => {
    /*
     * ⚠ Gegen `periodIndexByInterval`: das folgt dem `billingModel` und lieferte bei `annual_max`
     * genau EINEN Balken für das ganze Jahr. Beide Modelle müssen dieselbe Monatsaufteilung
     * ergeben — die Monate sind eine Eigenschaft des Kalenders, nicht des Tarifvertrags.
     */
    const annual = buildMonthlyTariffComparison(load, tariff, pricing, gridAfter)!
    const monthly = buildMonthlyTariffComparison(
      load,
      { ...tariff, billingModel: 'monthly_max_average' },
      pricing,
      gridAfter,
    )!
    expect(annual.currentTariffEur).toEqual(monthly.currentTariffEur)
    expect(annual.coveredMonths).toBe(2)
    expect(monthly.coveredMonths).toBe(2)
  })

  it('Monate ohne Messwert sind `null`, nicht 0 — und alle drei Reihen haben Länge 12', () => {
    const result = buildMonthlyTariffComparison(load, tariff, pricing, gridAfter)!
    for (const series of [
      result.currentTariffEur,
      result.spotWithoutControlEur,
      result.spotWithBatteryEur,
    ]) {
      expect(series).toHaveLength(12)
      // Belegt sind Jänner (0) und Februar (1); alles andere trägt `null`.
      for (let m = 2; m < 12; m++) expect(series[m]).toBeNull()
      expect(series[0]).not.toBeNull()
      expect(series[1]).not.toBeNull()
    }
  })

  it('rechnet NICHT auf ein Jahr hoch — ein Teilzeitraum bleibt der Teilzeitraum', () => {
    /*
     * Der Lastgang deckt 12 Intervalle ab; §3.7.1 würde daraus per `annualizationFactor` eine
     * Jahresgrösse machen. Für Monatsbalken wäre das eine Aussage über Monate, für die es keine
     * Messung gibt. Geprüft an der SUMME: sie ist exakt die Summe der gerechneten Intervalle.
     */
    const result = buildMonthlyTariffComparison(load, tariff, pricing, gridAfter)!
    const total = (result.currentTariffEur[0] ?? 0) + (result.currentTariffEur[1] ?? 0)
    expect(total).toBeCloseTo((12 * 32.68) / 100, 10)
  })
})

describe('Monatsvergleich — Einspeisung und nicht berechenbare Preisseiten', () => {
  const START_UTC = '2025-06-15T10:00:00Z'
  const spot = spotSeries(START_UTC, 2, () => 10)
  const pricing: TariffPricingInputs = { gridTariffRows: [WN_ROW], spotPrices: spot }

  it('nettet die Einspeisung in ALLEN DREI Reihen mit demselben Satz', () => {
    /*
     * ⚠ Bewusste Abweichung von der ursprünglich skizzierten Formel, die nur die Speicher-Reihe
     * nettete: nur dort genettet verglichen die Balken „Bezugskosten" gegen „Bezugskosten abzüglich
     * Einspeiseerlös", und die Speicher-Reihe sähe umso besser aus, je mehr der Kunde einspeist.
     * Ohne diesen Test bliebe die Asymmetrie unbemerkt — beide Zahlen sind für sich plausibel.
     */
    const load = profile(START_UTC, [-4, -4, -4, -4]) // reine Einspeisung, 1 kWh je Intervall
    const gridAfter = load.readings.map((r) => r.gridPowerKw)
    const result = buildMonthlyTariffComparison(load, tariff, pricing, gridAfter)!

    // 4 kWh Einspeisung × 8 ct = 0,32 € Erlös → alle drei Reihen stehen bei −0,32 €.
    const expected = -(4 * tariff.einspeiseverguetungCtPerKwh) / 100
    expect(result.currentTariffEur[5]).toBeCloseTo(expected, 10)
    expect(result.spotWithoutControlEur[5]).toBeCloseTo(expected, 10)
    expect(result.spotWithBatteryEur[5]).toBeCloseTo(expected, 10)
  })

  it('liefert `undefined`, wenn die Netzentgelt-Seite fehlt — keine halbe Reihe', () => {
    const load = profile(START_UTC, [4, 4, 4, 4])
    const gridAfter = load.readings.map((r) => r.gridPowerKw)
    expect(
      buildMonthlyTariffComparison(load, tariff, { gridTariffRows: null, spotPrices: spot }, gridAfter),
    ).toBeUndefined()
  })

  it('liefert `undefined` bei einer Spotpreis-Lücke — AUCH die Ist-Reihe entsteht dann nicht', () => {
    /*
     * ⚠ Die Ist-Reihe braucht den Börsenpreis rechnerisch gar nicht. Sie darf trotzdem nicht
     * alleine entstehen: eine einzelne Balkenreihe ohne ihre Vergleichsreihen ist genau der
     * Teilzustand, den dieser Abschnitt ausschliesst.
     */
    const load = profile(START_UTC, [4, 4, 4, 4, 4, 4, 4, 4]) // 2 h, Spotreihe deckt nur 2 h ab
    const shortSpot = spotSeries(START_UTC, 1, () => 10)
    const gridAfter = load.readings.map((r) => r.gridPowerKw)
    expect(
      buildMonthlyTariffComparison(
        load,
        tariff,
        { gridTariffRows: [WN_ROW], spotPrices: shortSpot },
        gridAfter,
      ),
    ).toBeUndefined()
  })
})
