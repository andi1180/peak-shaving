import { describe, expect, it } from 'vitest'
import { AWATTAR_BASE_FEE } from 'shared'
import type {
  GridTariffRowInput,
  LoadProfile,
  MonthlyTariffComparison,
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
 *
 * ── ⚠ SEIT DELTA 19 STECKEN GRUNDGEBÜHREN IN DEN REIHEN ────────────────────────────────────────
 * Die Erwartungswerte tragen sie deshalb sichtbar als eigenen Summanden (`awattarShare(...)`) und
 * nicht eingerechnet in eine Gesamtzahl: so bleibt an jeder Assertion ablesbar, welcher Teil
 * Arbeitskosten und welcher Fixkosten sind. `tariff` unten setzt bewusst KEINE
 * `supplierBaseFeeEurPerMonth` — der Vorgabefall ist „keine Angabe" und rechnet mit 0, und genau
 * diesen Fall müssen die Bestandserwartungen abbilden.
 */

const STEP_MS = 15 * 60 * 1000
const ONE_HOUR_MS = 60 * 60 * 1000
const iso = (ms: number): string => new Date(ms).toISOString()

/** Die echten WN-EX0105-Sätze (NE 7) — sie stehen als Konstanten da, damit die Rechnung lesbar bleibt. */
const WN_NORMAL_CT = 6.98
const WN_SNAP_CT = 5.58
const WN_NETZVERLUST_CT = 0.7

/**
 * Der anteilige aWATTar-Grundgebühr-Betrag für EINEN belegten Kalendertag des genannten Monats
 * (Delta 19) — von Hand nachvollziehbar: Monatsgebühr ÷ Tage dieses Monats.
 */
function awattarShare(days: number, daysInMonth: number): number {
  return (AWATTAR_BASE_FEE.eurPerMonth * days) / daysInMonth
}

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
    // Delta 19: dazu die Fixkosten des EINEN belegten Kalendertags (15. Jänner 2025, 31 Tage).
    // Der Ist-Tarif trägt keine (dieses `tariff` gibt keine Lieferanten-Grundgebühr an), die
    // beiden aWATTar-Reihen tragen 4,79 € ÷ 31. Ein Netz-Grundpreis ist auf `WN_ROW` nicht
    // hinterlegt und darf deshalb nirgends auftauchen.
    const dayFee = awattarShare(1, 31)
    const expectedCurrent = (12 * 31.28 + 12 * 32.68) / 100
    const expectedSpot = (12 * 16.28 + 12 * 17.68) / 100 + dayFee

    expect(result.currentTariffEur[0]).toBeCloseTo(expectedCurrent, 10)
    expect(result.spotWithoutControlEur[0]).toBeCloseTo(expectedSpot, 10)
    // Ohne Batterie-Eingriff (gridAfter = roher Lastgang) ist die dritte Reihe die zweite.
    expect(result.spotWithBatteryEur[0]).toBeCloseTo(expectedSpot, 10)
  })

  it('die Differenz Ist − aWATTar ist EXAKT Energiepreis-Differenz MINUS Gebührendifferenz — das Netzentgelt kürzt sich weg', () => {
    /*
     * ⚠ DER KERNTEST GEGEN DIE BEZUGSGLEICHHEITS-FALLE. Liefen die beiden Reihen durch zwei
     * verschiedene Netzentgelt-Implementierungen, enthielte die Differenz einen Anteil, der gar
     * nicht am Strompreis liegt — und niemand sähe es, weil beide Zahlen für sich plausibel sind.
     * Geprüft wird deshalb nicht „ungefähr weniger", sondern die exakte Identität.
     *
     * ⚠ SEIT DELTA 19 KÜRZEN SICH NICHT MEHR ALLE FIXKOSTEN WEG, UND DAS IST DER GANZE PUNKT DES
     * ABSCHNITTS: der Netz-Arbeitspreis tut es (beide Reihen laufen durch dieselbe Funktion), die
     * GRUNDGEBÜHREN tun es nicht — der Kunde tauscht beim Wechsel die eine gegen die andere. Die
     * Erwartung trägt die Gebührendifferenz deshalb als eigenen, benannten Summanden. Ohne ihn wäre
     * dieser Test nach der Änderung rot, und der naheliegende „Fix" (Toleranz aufweichen) hätte
     * genau die Netzentgelt-Wächterwirkung zerstört, für die es ihn gibt.
     */
    const load = profile(START_UTC, Array.from({ length: 24 }, () => 4))
    const gridAfter = load.readings.map((r) => r.gridPowerKw)
    const result = buildMonthlyTariffComparison(load, tariff, pricing, gridAfter)!

    // 24 Intervalle × 1 kWh = 24 kWh; Preisdifferenz je kWh = 25 − 10 = 15 ct.
    const energyKwh = 24 * 4 * 0.25
    const expectedEnergyDelta = (energyKwh * (tariff.energyPriceCtPerKwh - 10)) / 100
    // Ist-Reihe: keine Lieferanten-Gebühr angegeben (0). aWATTar-Reihe: ein Tag im Jänner.
    const expectedFeeDelta = 0 - awattarShare(1, 31)
    expect(result.currentTariffEur[0]! - result.spotWithoutControlEur[0]!).toBeCloseTo(
      expectedEnergyDelta + expectedFeeDelta,
      10,
    )
  })

  it('ein Dispatch, der Bezug wegnimmt, senkt AUSSCHLIESSLICH die Reihe „mit Speicher"', () => {
    const load = profile(START_UTC, Array.from({ length: 24 }, () => 4))
    // Die Hälfte des Bezugs weggenommen — so, wie es ein Speicher täte.
    const gridAfter = load.readings.map((r) => r.gridPowerKw / 2)
    const result = buildMonthlyTariffComparison(load, tariff, pricing, gridAfter)!

    /*
     * ⚠ HALBIERT WIRD NUR DER VERBRAUCHSABHÄNGIGE TEIL. Die Grundgebühr fällt unverändert an —
     * ein Speicher senkt den Bezug, nicht den Vertrag. Der Test rechnet sie deshalb heraus und
     * wieder hinzu; ohne das hätte er nach Delta 19 einen Fehler behauptet, wo keiner ist.
     */
    const dayFee = awattarShare(1, 31)
    expect(result.spotWithBatteryEur[0]).toBeCloseTo(
      (result.spotWithoutControlEur[0]! - dayFee) / 2 + dayFee,
      10,
    )
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

    // 4 kWh Einspeisung × 8 ct = 0,32 € Erlös. Delta 19: die aWATTar-Reihen tragen zusätzlich
    // die Gebühr des einen belegten Junitags (30 Tage) — der Erlös deckt sie nicht auf.
    const revenue = -(4 * tariff.einspeiseverguetungCtPerKwh) / 100
    const dayFee = awattarShare(1, 30)
    expect(result.currentTariffEur[5]).toBeCloseTo(revenue, 10)
    expect(result.spotWithoutControlEur[5]).toBeCloseTo(revenue + dayFee, 10)
    expect(result.spotWithBatteryEur[5]).toBeCloseTo(revenue + dayFee, 10)
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

describe('Monatsvergleich — Grundgebühren (Delta 19)', () => {
  /*
   * Ein Lastgang, der GENAU zwei Kalendertage berührt: 30. und 31. Jänner 2025. Zwei Tage in
   * einem 31-Tage-Monat — die Anteiligkeit ist damit von Hand nachrechenbar (2/31), und ein
   * fälschlich voller Monatsbetrag wäre um mehr als das Fünfzehnfache daneben.
   */
  const START_UTC = '2025-01-29T23:00:00Z' // = 30.01.2025 00:00 Ortszeit
  const spot = spotSeries(START_UTC, 48, () => 10)
  const rowWithoutFee: GridTariffRowInput = WN_ROW
  /** Dieselbe Zeile, aber mit einer echten JAHRESPAUSCHALE — der Fall „ohne Leistungsmessung". */
  const rowWithAnnualFlat: GridTariffRowInput = {
    ...WN_ROW,
    grundpreisAmount: 365,
    grundpreisUnit: 'eur_per_year',
  }
  /** Dieselbe Zeile mit einem LEISTUNGSPREIS — er darf hier ausdrücklich NICHT auftauchen. */
  const rowWithDemandCharge: GridTariffRowInput = {
    ...WN_ROW,
    grundpreisAmount: 82.92,
    grundpreisUnit: 'eur_per_kw_year',
  }

  /** Zwei volle Tage, 4 kW durchgehend — 192 Intervalle. */
  const load = profile(START_UTC, Array.from({ length: 192 }, () => 4))
  const gridAfter = load.readings.map((r) => r.gridPowerKw)

  function run(row: GridTariffRowInput, supplierFee?: number) {
    return buildMonthlyTariffComparison(
      load,
      supplierFee == null ? tariff : { ...tariff, supplierBaseFeeEurPerMonth: supplierFee },
      { gridTariffRows: [row], spotPrices: spot },
      gridAfter,
    )!
  }

  it('rechnet die Gebühren ANTEILIG nach belegten Kalendertagen — nie den vollen Monatsbetrag', () => {
    const result = run(rowWithoutFee, 3.5)

    expect(result.fixedCosts.coveredDays).toBe(2)
    expect(result.fixedCosts.supplierBaseFeeEur).toBeCloseTo((3.5 * 2) / 31, 12)
    expect(result.fixedCosts.awattarBaseFeeEur).toBeCloseTo(
      (AWATTAR_BASE_FEE.eurPerMonth * 2) / 31,
      12,
    )
    // Der volle Monatsbetrag wäre 3,50 € — die anteilige Zahl liegt deutlich darunter.
    expect(result.fixedCosts.supplierBaseFeeEur).toBeLessThan(3.5)
  })

  it('ordnet jede Gebühr GENAU der Reihe zu, in der sie anfällt', () => {
    const withFee = run(rowWithoutFee, 3.5)
    const noFee = run(rowWithoutFee, 0)

    // Die Lieferanten-Gebühr steht ausschliesslich in „Ihr Tarif heute" …
    expect(withFee.currentTariffEur[0]! - noFee.currentTariffEur[0]!).toBeCloseTo(
      (3.5 * 2) / 31,
      12,
    )
    // … und in KEINER der beiden aWATTar-Reihen.
    expect(withFee.spotWithoutControlEur[0]).toBeCloseTo(noFee.spotWithoutControlEur[0]!, 12)
    expect(withFee.spotWithBatteryEur[0]).toBeCloseTo(noFee.spotWithBatteryEur[0]!, 12)
  })

  it('⚠ der Netz-Grundpreis steht in ALLEN DREI Reihen und kürzt sich aus jeder Differenz heraus', () => {
    /*
     * Der Kernbeleg für die Symmetrie: derselbe Netzanschluss bleibt derselbe, egal von wem der
     * Kunde seine Energie kauft. Stünde die Jahrespauschale nur in einer Reihe, verschöbe sie den
     * Vergleich um einen Betrag, der mit dem Stromvertrag nichts zu tun hat.
     *
     * 365 €/Jahr über 2 Tage in einem 365-Tage-Jahr = exakt 2 €.
     */
    const withFlat = run(rowWithAnnualFlat)
    const without = run(rowWithoutFee)

    expect(withFlat.fixedCosts.networkBaseFeeEur).toBeCloseTo(2, 12)
    for (const key of ['currentTariffEur', 'spotWithoutControlEur', 'spotWithBatteryEur'] as const) {
      expect(withFlat[key][0]! - without[key][0]!).toBeCloseTo(2, 12)
    }
    // Und deshalb ist JEDE Differenz zwischen den Reihen unverändert.
    expect(withFlat.currentTariffEur[0]! - withFlat.spotWithoutControlEur[0]!).toBeCloseTo(
      without.currentTariffEur[0]! - without.spotWithoutControlEur[0]!,
      12,
    )
  })

  it('⚠ ein LEISTUNGSPREIS (`eur_per_kw_year`) wird NICHT eingerechnet — er ist die Jahreszahl im Report', () => {
    /*
     * Die teuerste denkbare Verwechslung dieses Abschnitts: 82,92 €/kW·a als Jahrespauschale
     * gelesen ergäbe eine plausible, aber frei erfundene Zahl — und der Leistungspreis stünde
     * zugleich weiterhin als Jahreswert im Report. Doppelt gezählt und falsch dimensioniert.
     */
    const withDemand = run(rowWithDemandCharge)
    const without = run(rowWithoutFee)

    expect(withDemand.fixedCosts.networkBaseFeeEur).toBe(0)
    expect(withDemand.currentTariffEur[0]).toBeCloseTo(without.currentTariffEur[0]!, 12)
  })

  it('die ausgewiesenen Fixkosten sind die AUFSCHLÜSSELUNG der Reihen, kein zusätzlicher Posten', () => {
    /*
     * Wer die `fixedCosts` zu einem Balken addiert, zählt sie doppelt — das Feld ist da, damit der
     * Report sagen kann, was drin steckt. Geprüft, indem der Fixanteil aus der Reihe
     * herausgerechnet wird: übrig bleibt exakt die Reihe eines Laufs ohne jede Gebühr.
     */
    const withFees = run(rowWithAnnualFlat, 3.5)
    const bare = run(rowWithoutFee, 0)

    // ⚠ Auch der `bare`-Lauf trägt die aWATTar-Gebühr (sie ist eine Konstante, keine Eingabe) —
    // der reine Arbeitskosten-Anteil entsteht deshalb auf BEIDEN Seiten durch dasselbe Abziehen.
    const workOnly = (r: MonthlyTariffComparison, series: 'current' | 'spot'): number => {
      const fix =
        series === 'current'
          ? r.fixedCosts.networkBaseFeeEur + r.fixedCosts.supplierBaseFeeEur
          : r.fixedCosts.networkBaseFeeEur + r.fixedCosts.awattarBaseFeeEur
      const value =
        series === 'current' ? r.currentTariffEur[0]! : r.spotWithoutControlEur[0]!
      return value - fix
    }

    expect(workOnly(withFees, 'current')).toBeCloseTo(workOnly(bare, 'current'), 12)
    expect(workOnly(withFees, 'spot')).toBeCloseTo(workOnly(bare, 'spot'), 12)
    // Die dritte Reihe trägt denselben Fixanteil wie die zweite (gleicher Vertrag, anderer Bezug).
    const spotFix = withFees.fixedCosts.networkBaseFeeEur + withFees.fixedCosts.awattarBaseFeeEur
    const bareSpotFix = bare.fixedCosts.networkBaseFeeEur + bare.fixedCosts.awattarBaseFeeEur
    expect(withFees.spotWithBatteryEur[0]! - spotFix).toBeCloseTo(
      bare.spotWithBatteryEur[0]! - bareSpotFix,
      12,
    )
  })

  it('ohne Angabe rechnet die Lieferanten-Gebühr mit 0 — die konservative Richtung', () => {
    /*
     * 0 lässt den HEUTIGEN Tarif billiger aussehen als er ist und den aWATTar-Vorteil damit
     * kleiner, nicht grösser. Eine geschätzte Gebühr wäre die gefährliche Richtung.
     */
    const result = run(rowWithoutFee)
    expect(result.fixedCosts.supplierFeeEurPerMonth).toBe(0)
    expect(result.fixedCosts.supplierBaseFeeEur).toBe(0)
    expect(result.fixedCosts.awattarFeeEurPerMonth).toBe(AWATTAR_BASE_FEE.eurPerMonth)
  })

  it('zählt einen Kalendertag EINMAL, nicht je Intervall', () => {
    /*
     * Ein Tag hat 96 Intervalle. Würde die Gebühr je Intervall statt je Tag anteilig gebucht,
     * stünde in `coveredDays` 192 statt 2 — und die Monatsgebühr wäre um das Sechsfache des
     * Monatsbetrags überschritten.
     */
    const full = run(rowWithoutFee, 3.5)
    // Derselbe Zeitraum, aber nur ein Intervall je Tag (00:00 und 24 h später).
    const sparse = profile(START_UTC, [4])
    const sparseResult = buildMonthlyTariffComparison(
      sparse,
      { ...tariff, supplierBaseFeeEurPerMonth: 3.5 },
      { gridTariffRows: [rowWithoutFee], spotPrices: spot },
      [4],
    )!

    expect(full.fixedCosts.coveredDays).toBe(2)
    expect(sparseResult.fixedCosts.coveredDays).toBe(1)
    expect(sparseResult.fixedCosts.supplierBaseFeeEur).toBeCloseTo(3.5 / 31, 12)
  })
})
