import { describe, expect, it } from 'vitest'
import type {
  BatteryCandidate,
  GridTariffRowInput,
  LoadProfile,
  SpotPriceSeriesInput,
  TariffParams,
  TariffPricingInputs,
} from 'shared'

import { simulateBattery } from '../simulation/simulate'
import { computeBatterySavings } from './attribute'

/**
 * §3.7.2 — EINE Preisbasis für beide Energie-Töpfe.
 *
 * ── WARUM ES DIESE DATEI GEBEN MUSS ────────────────────────────────────────────────────────────
 * Die Kombination, an der der Defekt hing, existierte in KEINER bestehenden Suite: ein Lastgang mit
 * EINSPEISUNG **und** ein aktiver, berechenbarer Tarifoptimierungs-Hebel gleichzeitig.
 * `attribute.test.ts` hat PV, aber kein `pricing`; `tou-chain.test.ts` hat `pricing`, aber die
 * Demo-Bäckerei 2025 ist `import_only` (kein einziger negativer Slot → `selfConsumptionSaving`
 * strukturell 0). Genau in der Lücke dazwischen wurde der Eigenverbrauch mit dem FIXTARIF des
 * Kunden bewertet, während die Lastverschiebung längst über die kombinierten Marktpreise lief —
 * `totalSavingPerYear` addierte zwei Tarifwelten und trug das über `calculateRoi` weiter.
 *
 * ── DIE ISOLATION, OHNE DIE DIE ZAHLEN NICHTS BEWIESEN ─────────────────────────────────────────
 * Ein aktiver Hebel ändert nicht nur die BEWERTUNG, sondern auch den FAHRPLAN (Tages-Rangfolge,
 * Laden im günstigen Fenster). Ein blosser Vorher/Nachher-Vergleich zweier Läufe vermengte beides.
 * Alle Zahlen unten stammen deshalb aus DEMSELBEN Fahrplan: der Fix ist eine reine
 * Bewertungsänderung, und genau das ist hier gemessen — `loadShiftSaving`, `leistungspreisSaving`
 * und `newBilledKw` sind vorher wie nachher bit-identisch.
 */

const STEP_MS = 15 * 60 * 1000
const ONE_HOUR_MS = 60 * 60 * 1000
const START_ISO = '2025-06-01T00:00:00Z'
const DAYS = 10

/**
 * Ein Tag (96 × 15 min), Zeitzone UTC → Slot-Index /4 ist unmittelbar die Stunde der Preiskurve.
 *  - 00–06 h: 4 kW    · 06–10 h: 12 kW (Tag 5: `peak` in 06–08 h)
 *  - 10–14 h: −18 kW  · EINSPEISUNG (die 'pv'-Schichten dieses Tests)
 *  - 14–20 h: 22 kW   · Nachmittag — hier wird der PV-Anteil wieder entnommen
 *  - 20–22 h: 12 kW   · 22–24 h: 4 kW
 */
function day(peak?: number): number[] {
  const d = new Array<number>(96)
  for (let i = 0; i < 96; i++) {
    if (i < 24) d[i] = 4
    else if (i < 32) d[i] = peak ?? 12
    else if (i < 40) d[i] = 12
    else if (i < 56) d[i] = -18
    else if (i < 80) d[i] = 22
    else if (i < 88) d[i] = 12
    else d[i] = 4
  }
  return d
}

const t0 = Date.parse(START_ISO)
const values = Array.from({ length: DAYS }, (_, i) => day(i === 5 ? 80 : undefined)).flat()
const load: LoadProfile = {
  readings: values.map((gridPowerKw, i) => ({
    ts: new Date(t0 + i * STEP_MS).toISOString(),
    gridPowerKw,
  })),
  intervalMinutes: 15,
  timezoneMeta: 'UTC',
  source: 'net_signed',
}

const battery: BatteryCandidate = {
  id: 'b1',
  name: 'Test',
  manufacturer: 'Demo',
  class: 'commercial',
  usableCapacityKwh: 60,
  maxPowerKw: 30,
  roundTripEfficiency: 0.9,
  pricePerKwh: 400,
  inverterIncluded: true,
  requiresFoundation: false,
  controlType: 'dynamic',
}

/**
 * Der Fixtarif ist bewusst NIEDRIG (10 ct) und die Einspeisevergütung mässig (5 ct) — das ist die
 * Lage des echten Kundenfalls, an dem der Defekt gemessen wurde (Arbeitspreis 9,5 ct). Genau dort
 * klafft die Lücke zu den kombinierten Marktpreisen am weitesten auf.
 *
 * KEINE `timeOfUseWindows`: ohne Hebel ist die Preisreihe damit durchgehend `energyPriceCtPerKwh`,
 * der Lauf „ohne Hebel" also exakt der Zustand vor B21. Jede Bewegung in den Zahlen unten ist
 * dadurch dem Hebel zuzuschreiben und nicht einem Fenster-Schema.
 */
const tariff: TariffParams = {
  leistungspreisEurPerKwYear: 100,
  billingModel: 'annual_max',
  minBillableKw: 0,
  energyPriceCtPerKwh: 10,
  einspeiseverguetungCtPerKwh: 5,
}

const ETA = 0.9
/** Was eine PV-kWh im Speicher gekostet hat: die Einspeisung der `1/η` kWh, die dafür hineinmussten. */
const PV_COST_CT = 5 / ETA
/** Netz-Aufschlag auf jeden Marktpreis: Fensterpreis 4,0 + Netzverlust 1,0 (Delta 4). */
const GRID_ADDER_CT = 5

const gridRows: GridTariffRowInput[] = [
  {
    validFrom: '2025-01-01',
    validUntil: null,
    netzverlustCtPerKwh: 1,
    priceBasis: 'net',
    windows: [
      {
        label: 'normal',
        monthDayFrom: null,
        monthDayTo: null,
        timeFrom: '00:00:00',
        timeTo: '24:00:00',
        ctPerKwh: 4,
      },
    ],
  },
]

/** Marktpreis je Stunde: nachts billig, mittags billig, NACHMITTAGS teuer (28 ct) — Sommerform. */
function spotAt(hourOfDay: number): number {
  if (hourOfDay < 6) return 2
  if (hourOfDay < 10) return 12
  if (hourOfDay < 14) return 3
  if (hourOfDay < 20) return 28
  if (hourOfDay < 22) return 15
  return 3
}

function series(priceAt: (hourIndex: number) => number): SpotPriceSeriesInput {
  return {
    prices: Array.from({ length: DAYS * 24 }, (_, h) => ({
      tsStart: new Date(t0 + h * ONE_HOUR_MS).toISOString(),
      tsEnd: new Date(t0 + (h + 1) * ONE_HOUR_MS).toISOString(),
      ctPerKwh: priceAt(h),
      priceBasis: 'net' as const,
    })),
    complete: true,
    missingRanges: [],
  }
}

const pricing: TariffPricingInputs = {
  gridTariffRows: gridRows,
  spotPrices: series((h) => spotAt(h % 24)),
}

describe('§3.7.2 — der Eigenverbrauch wird am ENTLADE-Intervall bewertet, nicht am Fixtarif', () => {
  it('bewegt den Eigenverbrauchs-Topf um den vollen Preisabstand — Lastverschiebung und Leistungspreis bit-identisch', () => {
    const s = computeBatterySavings(load, battery, tariff, undefined, pricing)

    console.log(
      `[§3.7.2 PV × Hebel] eigenverbrauch=€${s.selfConsumptionSavingOverCoveredPeriod.toFixed(2)} ` +
        `(VORHER €2.67) · lastverschiebung=€${s.loadShiftSavingOverCoveredPeriod.toFixed(2)} ` +
        `(unverändert) · leistungspreis=€${s.leistungspreisSavingPerYear.toFixed(0)} (unverändert) · ` +
        `total=€${s.totalSavingPerYear.toFixed(2)} (VORHER €7856.93)`,
    )

    /*
     * ── DER EIGENVERBRAUCHS-TOPF: VORHER 2,666666666666667 € — NACHHER 16,466666666666672 € ──────
     * Die Zahl steht als RECHNUNG da und nicht als abgeschriebener Lauf: der PV-Anteil dieses
     * Profils wird vollständig im teuren Nachmittagsfenster entnommen (Marktpreis 28 + 5 Netz =
     * 33 ct), der alte Wert bewertete ihn mit dem Fixtarif von 10 ct. Das Verhältnis der beiden
     * Bewertungen ist damit exakt der Faktor zwischen alter und neuer Zahl — trifft er nicht, ist
     * entweder die Preisbasis wieder eine andere oder die Entnahme liegt woanders.
     */
    const oldRateCt = 10 - PV_COST_CT // = 4,444… ct/kWh (Fixtarif, profilweit)
    const newRateCt = 28 + GRID_ADDER_CT - PV_COST_CT // = 27,444… ct/kWh (Entlade-Intervall)
    expect(s.selfConsumptionSavingOverCoveredPeriod).toBeCloseTo(
      (2.666666666666667 * newRateCt) / oldRateCt,
      9,
    )
    expect(s.selfConsumptionSavingOverCoveredPeriod).toBeCloseTo(16.466666666666672, 9)

    /*
     * ── DIE ANDEREN ZWEI TÖPFE SIND UNBERÜHRT ───────────────────────────────────────────────────
     * Bit-identisch zum Stand vor dem Fix, an DEMSELBEN Fahrplan gemessen. Ohne diese Zusage wäre
     * die Bewegung oben nicht als reine Bewertungsänderung belegt, sondern könnte ebenso gut eine
     * andere Physik sein.
     */
    expect(s.loadShiftSavingOverCoveredPeriod).toBeCloseTo(130.40000000000006, 9)
    expect(s.leistungspreisSavingPerYear).toBe(3000)
    expect(s.newBilledKw).toBe(50)

    // Prinzip 2: die Summe der drei Anteile ist weiterhin exakt `totalSavingPerYear`.
    expect(s.totalSavingPerYear).toBeCloseTo(
      s.leistungspreisSavingPerYear + s.selfConsumptionSavingPerYear + s.loadShiftSavingPerYear,
      10,
    )
    // VORHER 7856,933333333336 → NACHHER 8360,633333333335 (+503,70 €/Jahr allein aus der Bewertung).
    expect(s.totalSavingPerYear).toBeCloseTo(8360.633333333335, 8)
  })

  it('lässt den Lauf OHNE Hebel unverändert — der Fix ist keine stille Verschiebung des Bestands', () => {
    const s = computeBatterySavings(load, battery, tariff)

    /*
     * Ohne `pricing` liefert `intervalTariffRates` durchgehend `energyPriceCtPerKwh` — der neue
     * Ausdruck `dischargeCt − PV-Einstand` ergibt dann Wert für Wert genau die alte profilweite
     * Rate. Der Unterschied liegt allein in der Summationsreihenfolge (Σ take × Rate statt
     * Σ take × Rate am Ende) und damit unter jeder Fliesskomma-Auflösung, die hier zählt:
     * gemessen 26,666666666666664 gegen vorher 26,66666666666667 — Δ ≈ 7e-15.
     */
    expect(s.selfConsumptionSavingOverCoveredPeriod).toBeCloseTo(26.66666666666667, 9)
    expect(Math.abs(s.selfConsumptionSavingOverCoveredPeriod - 26.66666666666667)).toBeLessThan(1e-9)
    expect(s.loadShiftSavingOverCoveredPeriod).toBe(0) // keine Fenster, keine Arbitrage
    expect(s.leistungspreisSavingPerYear).toBe(3000)
  })
})

/**
 * ── WÄCHTER-PROBE: DER CLAMP GREIFT JE INTERVALL, NICHT EINMAL PROFILWEIT ──────────────────────
 * Flache Marktpreise → keine Arbitrage, praktisch jede Entnahme ist PV-Eigenverbrauch. Genau EINE
 * Stunde wird unter die Einspeise-Kosten (5/0,9 = 5,56 ct) gedrückt.
 *
 * Alle drei Läufe teilen sich denselben, EINMAL gerechneten Fahrplan (`precomputed`) — sonst
 * änderte die abgesenkte Stunde auch den Dispatch, und die Probe misst dann zwei Dinge auf einmal.
 */
const FLAT_SPOT_CT = 20
function flatPricing(lowHour?: number, lowValue?: number): TariffPricingInputs {
  return {
    gridTariffRows: gridRows,
    spotPrices: series((h) => (h === lowHour ? (lowValue as number) : FLAT_SPOT_CT)),
  }
}

describe('§3.7.2 — Clamp je Intervall', () => {
  it('eine Stunde unter der Einspeisevergütung trägt 0 bei statt eines negativen Beitrags', () => {
    const flat = flatPricing()
    const sim = simulateBattery(load, battery, tariff, undefined, flat)

    const base = computeBatterySavings(load, battery, tariff, sim, flat)
    // 15:00 h des ersten Tages: kombiniert 5 − 2 = 3 ct < 5,56 ct Einstand → Beitrag 0.
    const low = computeBatterySavings(load, battery, tariff, sim, flatPricing(15, -2))
    // Dieselbe Stunde noch viel tiefer. OHNE Clamp müsste der Topf hier WEITER fallen.
    const lower = computeBatterySavings(load, battery, tariff, sim, flatPricing(15, -900))

    console.log(
      `[§3.7.2 Clamp] flach=€${base.selfConsumptionSavingOverCoveredPeriod.toFixed(3)} · ` +
        `eine Stunde bei 3 ct=€${low.selfConsumptionSavingOverCoveredPeriod.toFixed(3)} · ` +
        `dieselbe Stunde bei −895 ct=€${lower.selfConsumptionSavingOverCoveredPeriod.toFixed(3)} ` +
        `(VORHER alle drei €26.667)`,
    )

    /*
     * Der flache Lauf, wieder als Rechnung: 25 ct kombiniert je Entnahme statt 10 ct Fixtarif.
     * VORHER stand hier — für ALLE DREI Läufe — 26,66666666666667 €: die profilweite Rate konnte
     * einen einzelnen Intervallpreis gar nicht sehen. Dass die drei Zahlen sich jetzt überhaupt
     * unterscheiden, IST der Nachweis der Intervall-Bewertung.
     */
    const oldRateCt = 10 - PV_COST_CT
    const flatRateCt = FLAT_SPOT_CT + GRID_ADDER_CT - PV_COST_CT
    expect(base.selfConsumptionSavingOverCoveredPeriod).toBeCloseTo(
      (26.66666666666667 * flatRateCt) / oldRateCt,
      9,
    )
    expect(base.selfConsumptionSavingOverCoveredPeriod).toBeCloseTo(116.66666666666664, 9)

    // Die abgesenkte Stunde kostet echten Beitrag — die Bewertung hängt wirklich am Intervall.
    expect(low.selfConsumptionSavingOverCoveredPeriod).toBeLessThan(
      base.selfConsumptionSavingOverCoveredPeriod - 1,
    )
    // ⚠ DER EIGENTLICHE WÄCHTER: noch tiefer ändert NICHTS mehr. Ohne `max(0, …)` je Intervall wäre
    // `lower` strikt kleiner als `low` — der Topf würde von einer einzigen Stunde aufgezehrt.
    expect(lower.selfConsumptionSavingOverCoveredPeriod).toBe(
      low.selfConsumptionSavingOverCoveredPeriod,
    )
    expect(low.selfConsumptionSavingOverCoveredPeriod).toBeCloseTo(112.38888888888887, 9)

    // Kein Topf wird negativ, und die Summen-Invariante hält in allen drei Läufen.
    for (const r of [base, low, lower]) {
      expect(r.selfConsumptionSavingOverCoveredPeriod).toBeGreaterThanOrEqual(0)
      expect(r.loadShiftSavingOverCoveredPeriod).toBeGreaterThanOrEqual(0)
      expect(r.totalSavingPerYear).toBeCloseTo(
        r.leistungspreisSavingPerYear + r.selfConsumptionSavingPerYear + r.loadShiftSavingPerYear,
        10,
      )
    }
  })
})
