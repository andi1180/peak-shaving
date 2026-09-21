import { AWATTAR_BASE_FEE, LEVIES_NONE, buildLevySchedule } from 'shared'
import type {
  GridTariffRowInput,
  LevySchedule,
  LoadProfile,
  MonthlyTariffComparison,
  SpotPriceSeriesInput,
  TariffParams,
  TariffPricingInputs,
} from 'shared'
import { describe, expect, it } from 'vitest'

import { buildMonthlyTariffComparison } from './monthly-tariff-comparison'

/**
 * Die fünf gesetzlichen/netzseitigen Kostenposten, am Zuschnitt des Urbanz-Referenzfalls.
 *
 * ── DER FIXTURE-ZUSCHNITT ──────────────────────────────────────────────────────────────────────
 * 20.060 Viertelstunden ab 30.01.2026 00:00 Ortszeit, 4.321,17 kWh — dieselbe Intervallzahl,
 * dieselbe Energiemenge und derselbe Zeitraum wie der echte Lastgang. Die Leistung ist KONSTANT,
 * damit die Energiemenge exakt ist und jede ct/kWh-Grösse von Hand nachrechenbar bleibt; die
 * Fensterseite ist auf EIN ganztägiges Fenster reduziert, weil die SNAP-Zuordnung anderswo geprüft
 * ist und hier nur verrauschte, nicht mehr nachrechenbare Summen erzeugte.
 *
 * ⚠ Die Sommerzeit ist der Grund für die krumme Intervallzahl: 209 Kalendertage sind 20.064
 * Viertelstunden, die Umstellung am 29.03.2026 nimmt vier davon weg. Genau diese 20.060 zählt auch
 * die echte Datei.
 *
 * ── WIE DIE EINZELNEN POSTEN ISOLIERT WERDEN ───────────────────────────────────────────────────
 * Über MASSGESCHNEIDERTE Abgabenpläne, in denen jeweils genau ein Satz ungleich null ist, und den
 * Vergleich gegen denselben Lauf ohne Abgaben. Das misst den Beitrag jedes Postens an der fertigen
 * Summe, ohne die Rechnung der Engine im Test ein zweites Mal auszuschreiben — was ein Test, der
 * seine Erwartung selbst nachbaut, nicht leisten würde.
 */

const STEP_MS = 15 * 60 * 1000
const ONE_HOUR_MS = 60 * 60 * 1000

/** 30.01.2026 00:00 Ortszeit (CET = UTC+1). */
const START_UTC = '2026-01-29T23:00:00Z'
const INTERVALS = 20_060
const TOTAL_KWH = 4321.17
/** Konstante Leistung, aus der Zielenergie abgeleitet — so ist die Menge exakt. */
const LOAD_KW = TOTAL_KWH / (INTERVALS * 0.25)

/** Die echten WN-EX0105-Sätze (NE 7): Arbeitspreis `normal`, Netzverlust, Grundpreis, Messpreis. */
const WN_NORMAL_CT = 6.98
const WN_NETZVERLUST_CT = 0.7
const WN_GRUNDPREIS_EUR_PER_YEAR = 54
const WN_MESSPREIS_EUR_PER_MONTH = 2.18

/** Die belegten Sätze 2026 (s. `packages/shared/src/levies.ts`). */
const ELEKTRIZITAETSABGABE_CT = 0.1
const EAG_FOERDERBEITRAG_CT = 0.62
/**
 * ⚠ Bis zum 21.09.2026 stand hier 3,80 — das war der GRUNDPREIS des Förderbeitrags
 * (3,796 €/Zählpunkt·Jahr), nicht die Förderpauschale. Die echte Pauschale der Netzebene 7 sind
 * 19,02 €/Jahr (EX104). Beide fallen an, deshalb stehen jetzt beide da.
 */
const EAG_PAUSCHALE_EUR_PER_YEAR = 19.02
const EAG_GRUNDPREIS_EUR_PER_YEAR = 3.796

const iso = (ms: number): string => new Date(ms).toISOString()

const LOAD: LoadProfile = {
  readings: Array.from({ length: INTERVALS }, (_, i) => ({
    ts: iso(Date.parse(START_UTC) + i * STEP_MS),
    gridPowerKw: LOAD_KW,
  })),
  intervalMinutes: 15,
  timezoneMeta: 'Europe/Vienna',
  source: 'import_only',
}

const GRID_AFTER = LOAD.readings.map((r) => r.gridPowerKw)

const SPOT: SpotPriceSeriesInput = {
  prices: Array.from({ length: INTERVALS / 4 + 1 }, (_, h) => ({
    tsStart: iso(Date.parse(START_UTC) + h * ONE_HOUR_MS),
    tsEnd: iso(Date.parse(START_UTC) + (h + 1) * ONE_HOUR_MS),
    ctPerKwh: 10,
    priceBasis: 'net',
  })),
  complete: true,
  missingRanges: [],
}

function gridRow(withMesspreis: boolean): GridTariffRowInput {
  return {
    validFrom: '2026-01-01',
    validUntil: null,
    netzverlustCtPerKwh: WN_NETZVERLUST_CT,
    grundpreisAmount: WN_GRUNDPREIS_EUR_PER_YEAR,
    grundpreisUnit: 'eur_per_year',
    ...(withMesspreis
      ? { messpreisAmount: WN_MESSPREIS_EUR_PER_MONTH, messpreisUnit: 'eur_per_month' }
      : {}),
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
    ],
  }
}

/** Der Ist-Tarif des Referenzfalls: 9,5 ct/kWh, keine Einspeisung, keine Lieferanten-Grundgebühr. */
const TARIFF: TariffParams = {
  leistungspreisEurPerKwYear: 0,
  billingModel: 'annual_max',
  minBillableKw: 0,
  energyPriceCtPerKwh: 9.5,
  einspeiseverguetungCtPerKwh: 0,
}

/** Ein Plan mit genau EINEM von null verschiedenen Satz — der Rest steht ausdrücklich auf 0. */
function onlyLevy(overrides: Partial<LevySchedule['periods'][number]>): LevySchedule {
  return {
    periods: [
      {
        validFrom: '2026-01-01',
        validUntil: null,
        elektrizitaetsabgabeCtPerKwh: 0,
        eagFoerderbeitragCtPerKwh: 0,
        eagFoerderbeitragGrundpreisAmount: 0,
        eagFoerderbeitragGrundpreisUnit: 'eur_per_year',
        eagPauschaleEurPerYear: 0,
        gebrauchsabgabeRate: 0,
        ...overrides,
      },
    ],
  }
}

function run(levies: LevySchedule, withMesspreis = true): MonthlyTariffComparison {
  const pricing: TariffPricingInputs = {
    gridTariffRows: [gridRow(withMesspreis)],
    spotPrices: SPOT,
    levies,
  }
  const result = buildMonthlyTariffComparison(LOAD, TARIFF, pricing, GRID_AFTER)
  expect(result).toBeDefined()
  return result!
}

const sum = (series: (number | null)[]): number =>
  series.reduce<number>((acc, v) => (v == null ? acc : acc + v), 0)

/** Der Lauf ohne jede Abgabe und ohne Messpreis — die Bezugsgrösse aller Differenzen. */
const BASE = run(LEVIES_NONE, false)

describe('Die fünf fehlenden Kostenposten — Urbanz-Zuschnitt, Wiener Netze NE 7', () => {
  it('der Fixture-Zuschnitt trifft den Referenzfall: 209 belegte Kalendertage, 8 Monate', () => {
    // Steht als eigene Prüfung da, weil ALLE Erwartungen unten an diesen beiden Zahlen hängen —
    // verschiebt sich der Zuschnitt, soll das hier auffallen und nicht als Rechenfehler erscheinen.
    expect(BASE.fixedCosts.coveredDays).toBe(209)
    expect(BASE.coveredMonths).toBe(8)
  })

  it('jeder der fünf Posten einzeln — und zusammen rund 73 € mehr', () => {
    // 1 — Messpreis: 2,18 €/Monat, tagesanteilig über die belegten Tage jedes Monats.
    const messpreis = run(LEVIES_NONE, true)
    expect(messpreis.fixedCosts.meteringFeeEur).toBeCloseTo(15.05, 2)

    // 2 — Elektrizitätsabgabe: 0,10 ct/kWh × 4.321,17 kWh = 4,32 €.
    const strom = run(onlyLevy({ elektrizitaetsabgabeCtPerKwh: ELEKTRIZITAETSABGABE_CT }), false)
    expect(sum(strom.currentTariffEur) - sum(BASE.currentTariffEur)).toBeCloseTo(
      (TOTAL_KWH * ELEKTRIZITAETSABGABE_CT) / 100,
      6,
    )

    // 3 — EAG-Förderbeitrag: 0,620 ct/kWh × 4.321,17 kWh = 26,79 €.
    const eag = run(onlyLevy({ eagFoerderbeitragCtPerKwh: EAG_FOERDERBEITRAG_CT }), false)
    expect(sum(eag.currentTariffEur) - sum(BASE.currentTariffEur)).toBeCloseTo(
      (TOTAL_KWH * EAG_FOERDERBEITRAG_CT) / 100,
      6,
    )

    /*
     * 4 — die beiden verbrauchsUNabhängigen EAG-Teile, tagesanteilig über 209 von 365 Tagen:
     * Förderpauschale 19,02 €/Jahr und der Grundpreis des Förderbeitrags 3,796 €/Zählpunkt·Jahr.
     * Sie landen bewusst in DERSELBEN Fixposten-Zeile (`eagFlatFeeEur`) — für den Kunden ist es
     * ein Betrag, und getrennt ausgewiesen bräuchte der Report eine Zeile, die niemand liest.
     */
    const pauschale = run(
      onlyLevy({
        eagPauschaleEurPerYear: EAG_PAUSCHALE_EUR_PER_YEAR,
        eagFoerderbeitragGrundpreisAmount: EAG_GRUNDPREIS_EUR_PER_YEAR,
      }),
      false,
    )
    expect(pauschale.fixedCosts.eagFlatFeeEur).toBeCloseTo(
      ((EAG_PAUSCHALE_EUR_PER_YEAR + EAG_GRUNDPREIS_EUR_PER_YEAR) * 209) / 365,
      6,
    )

    // 5 — Gebrauchsabgabe, hier mit dem festen 7-%-Satz gemessen: sie bemisst sich am Netzpreis,
    //     also am Netz-Arbeitspreis (6,98 + 0,70 ct/kWh) PLUS Grundpreis und Messpreis.
    const abgabe = run(onlyLevy({ gebrauchsabgabeRate: 0.07 }), true)
    const netzArbeitEur = (TOTAL_KWH * (WN_NORMAL_CT + WN_NETZVERLUST_CT)) / 100
    const netzFixEur = messpreis.fixedCosts.networkBaseFeeEur + messpreis.fixedCosts.meteringFeeEur
    expect(abgabe.fixedCosts.usageChargeOnFixedEur).toBeCloseTo(netzFixEur * 0.07, 6)
    expect(sum(abgabe.currentTariffEur) - sum(messpreis.currentTariffEur)).toBeCloseTo(
      (netzArbeitEur + netzFixEur) * 0.07,
      6,
    )

    // Alle fünf gemeinsam, mit den ECHTEN datierten Sätzen (6 % bis 28.02., danach 7 %).
    const full = run(levySchedule(), true)
    const delta = sum(full.currentTariffEur) - sum(BASE.currentTariffEur)
    expect(delta).toBeGreaterThan(82)
    expect(delta).toBeLessThan(87)
  })

  it('⚠ die Abgaben stehen in ALLEN DREI Reihen, nicht nur bei „Ihr Tarif heute"', () => {
    /*
     * Der Kernbeleg gegen die Falle, wegen der die Posten in der gemeinsamen Schicht liegen: an
     * `currentTariffEur` gehängt verglichen die Balken zwei verschieden zusammengesetzte
     * Rechnungen, und die spätere „Drei Wege"-Gegenüberstellung stünde auf zwei Massstäben.
     *
     * ⚠ Dieser Fixture reicht in allen drei Reihen DENSELBEN Netzbezug durch (`GRID_AFTER` ist der
     * rohe Lastgang) — nur deshalb müssen die drei Zuwächse auf die Nachkommastelle gleich sein.
     * Mit einem echten Dispatch fällt der dritte HÖHER aus, und das ist richtig: die Ladeverluste
     * erhöhen die bezogene Energiemenge, und die beiden ct/kWh-Abgaben hängen an ihr.
     */
    const full = run(levySchedule(), true)
    const deltas = (
      ['currentTariffEur', 'spotWithoutControlEur', 'spotWithBatteryEur'] as const
    ).map((key) => sum(full[key]) - sum(BASE[key]))

    expect(deltas[1]).toBeCloseTo(deltas[0]!, 9)
    expect(deltas[2]).toBeCloseTo(deltas[0]!, 9)
    expect(deltas[0]).toBeGreaterThan(82)
    // Die Grundgebühren-Zuordnung bleibt davon unberührt: aWATTar zahlt weiter seine eigene.
    expect(full.fixedCosts.awattarBaseFeeEur).toBeCloseTo(
      (AWATTAR_BASE_FEE.eurPerMonth * 209) / 30.5,
      0,
    )
  })

  it('⚠ der Gebrauchsabgabe-Satz springt PERIODENGENAU, statt einmal am Zeitraumbeginn zu gelten', () => {
    /*
     * Der Lastgang beginnt am 30.01.2026 — einmal am Anfang ausgewertet gälten 6 % für das ganze
     * Jahr, obwohl ab 01.03.2026 7 % anfallen (und umgekehrt bei der offenen Zeile gelesen 7 % für
     * den Jänner). Der echte Plan muss deshalb STRIKT zwischen den beiden festen Sätzen liegen;
     * genau dieser Test wird rot, wenn jemand die Auswahl auf einen einzigen Satz zurückbaut.
     */
    const flat6 = sum(run(onlyLevy({ gebrauchsabgabeRate: 0.06 }), true).currentTariffEur)
    const flat7 = sum(run(onlyLevy({ gebrauchsabgabeRate: 0.07 }), true).currentTariffEur)
    const dated = sum(
      run({ periods: levySchedule().periods.map(usageChargeOnly) }, true).currentTariffEur,
    )

    expect(dated).toBeGreaterThan(flat6)
    expect(dated).toBeLessThan(flat7)
    // Zwei Perioden im Plan, nicht eine — sonst könnte der Sprung gar nicht stattfinden.
    expect(levySchedule().periods.length).toBeGreaterThanOrEqual(2)
  })
})

describe('Ohne belegte Sätze wird der Hebel verweigert, nicht zu niedrig gerechnet', () => {
  it('eine unbelegte Kombination liefert einen leeren Plan — und damit KEINE Monatsreihen', () => {
    /*
     * ⚠ Seit dem EX104-Nachtrag sind NE 3–7 alle belegt; der unbelegte Fall ist jetzt die
     * MESSVARIANTE. EX104 führt für NE 7 drei Zeilen und keine variantenlose — wer keine mitgibt,
     * bekommt nichts. Ein Plan ohne Zeitraum führt im Rechenkern zur Lückenmeldung; eine halbe
     * Rechnung entsteht nicht.
     */
    expect(buildLevySchedule('wiener_netze', 7, '2026-01-30', '2026-08-26').periods).toEqual([])
    expect(
      buildMonthlyTariffComparison(
        LOAD,
        TARIFF,
        { gridTariffRows: [gridRow(true)], spotPrices: SPOT, levies: { periods: [] } },
        GRID_AFTER,
      ),
    ).toBeUndefined()
  })

  it('ein unbelegter Netzbetreiber ebenso — Wien ist die einzige hinterlegte Gebrauchsabgabe', () => {
    expect(
      buildLevySchedule('netz_noe', 7, '2026-01-30', '2026-08-26', 'ohne_leistungsmessung').periods,
    ).toEqual([])
  })
})

/** Der echte Plan des Referenzfalls. */
function levySchedule(): LevySchedule {
  return buildLevySchedule('wiener_netze', 7, '2026-01-30', '2026-08-26', 'ohne_leistungsmessung')
}

/** Derselbe Zeitschnitt, aber ohne die beiden ct/kWh-Abgaben und ohne die Fixbeträge. */
function usageChargeOnly(p: LevySchedule['periods'][number]): LevySchedule['periods'][number] {
  return {
    ...p,
    elektrizitaetsabgabeCtPerKwh: 0,
    eagFoerderbeitragCtPerKwh: 0,
    eagFoerderbeitragGrundpreisAmount: 0,
    eagPauschaleEurPerYear: 0,
  }
}
