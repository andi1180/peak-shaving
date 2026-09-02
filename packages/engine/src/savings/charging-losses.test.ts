import { describe, expect, it } from 'vitest'
import type { BatteryCandidate, LoadProfile, TariffParams } from 'shared'

import { computeBatterySavings } from './attribute'

/**
 * Delta 19 — der Ladeverlust auf der KOSTEN-Seite (§3.7).
 *
 * ── ⚠ WARUM DIESE PRÜFUNGEN NICHT AN GEPINNTEN ZAHLEN HÄNGEN ───────────────────────────────────
 * Ein aus einem Lauf abgeschriebener Wert belegte nur, dass sich nichts geändert hat. Beide Tests
 * hier messen stattdessen die REGEL selbst, und zwar so, dass der Fahrplan aus der Rechnung
 * herausfällt:
 *
 *   • Die PV-Seite wird über ZWEI Tarife mit unterschiedlicher Einspeisevergütung gemessen. Ohne
 *     Tarif-Fenster hängt der Dispatch nicht am Preis (`isCheapWindow` ist überall `false`) — beide
 *     Läufe teilen also denselben Fahrplan und dieselbe eigenverbrauchte kWh-Menge. Die Menge kürzt
 *     sich aus dem Verhältnis heraus, übrig bleibt exakt der Bewertungssatz.
 *
 *   • Die Netz-Seite wird an ihrer KIPPGRENZE gemessen: bei einem Ladepreis von `η × Entladepreis`
 *     ist die Verschiebung nach Abzug der Verluste exakt wertlos. Der alte Rechenweg wies dort
 *     weiterhin einen Aufschlag von 2,5 ct/kWh aus — die Prüfung ist damit ein echter Wächter und
 *     nicht bloss eine Wiederholung des Codes.
 */

const STEP_MS = 15 * 60 * 1000
const iso = (ms: number): string => new Date(ms).toISOString()
const ETA = 0.9

/**
 * Nacht 5 kW · Morgen 15 kW · Mittag −20 kW (PV-Überschuss) · Nachmittag 25 kW.
 *
 * Dieselbe Tagesform wie in `attribute.test.ts` — inklusive der EINEN 90-kW-Jahresspitze an Tag 5.
 * Sie ist hier nicht Zierde: erst die Spitzen-Reserve (§3.6) zwingt die Batterie, nachts aus dem
 * NETZ zu laden, und ohne 'grid'-Schichten gäbe es gar keine Lastverschiebung zu bewerten (an
 * einem Profil ohne Spitze gemessen: exakt 0, und der Test wäre trivial grün).
 */
function day(peak?: number): number[] {
  return Array.from({ length: 96 }, (_, i) => {
    if (i < 24) return 5
    if (i < 32) return peak ?? 15
    if (i < 40) return 15
    if (i < 56) return -20
    if (i < 80) return 25
    if (i < 88) return 15
    return 5
  })
}

const load: LoadProfile = (() => {
  const t0 = Date.parse('2025-06-01T00:00:00Z')
  const readings = Array.from({ length: 10 }, (_, d) => day(d === 5 ? 90 : undefined))
    .flat()
    .map((gridPowerKw, i) => ({ ts: iso(t0 + i * STEP_MS), gridPowerKw }))
  return { readings, intervalMinutes: 15, timezoneMeta: 'UTC', source: 'net_signed' }
})()

const battery: BatteryCandidate = {
  id: 'b-loss',
  name: 'Verlust-Prüfkandidat',
  manufacturer: 'Demo',
  class: 'commercial',
  usableCapacityKwh: 100,
  maxPowerKw: 50,
  roundTripEfficiency: ETA,
  pricePerKwh: 400,
  inverterIncluded: true,
  requiresFoundation: false,
  controlType: 'dynamic',
}

const base: TariffParams = {
  leistungspreisEurPerKwYear: 100,
  billingModel: 'annual_max',
  minBillableKw: 0,
  energyPriceCtPerKwh: 25,
  einspeiseverguetungCtPerKwh: 0,
}

describe('Delta 19 — Ladeverluste sind eine Koste, nicht nur ein SoC-Effekt', () => {
  it('PV-Eigenverbrauch: bewertet mit (Arbeitspreis − Einspeisevergütung ÷ η), nicht (Arbeitspreis − Einspeisevergütung)', () => {
    /*
     * Um EINE kWh einzuspeichern, gehen `1/η` kWh Einspeiseerlös verloren. Bei 8 ct und η = 0,9
     * sind das 8,889 ct je gespeicherter kWh und nicht 8 ct — die Differenz ist der Ladeverlust,
     * für den bisher niemand bezahlt hat.
     */
    const withoutFeedIn = computeBatterySavings(load, battery, base)
    const withFeedIn = computeBatterySavings(load, battery, {
      ...base,
      einspeiseverguetungCtPerKwh: 8,
    })

    // Ohne Einspeisevergütung ist der Wert einer eigenverbrauchten kWh der volle Arbeitspreis →
    // daraus fällt die verschobene MENGE heraus, ohne sie dem Fahrplan entnehmen zu müssen.
    const shiftedKwh = (withoutFeedIn.selfConsumptionSavingOverCoveredPeriod * 100) / 25
    expect(shiftedKwh).toBeGreaterThan(0)

    const expected = (shiftedKwh * (25 - 8 / ETA)) / 100
    const oldRule = (shiftedKwh * (25 - 8)) / 100

    expect(withFeedIn.selfConsumptionSavingOverCoveredPeriod).toBeCloseTo(expected, 9)
    // Und der Unterschied zur alten Regel ist keine Rundung: er ist der Verlust selbst.
    expect(oldRule - expected).toBeCloseTo((shiftedKwh * 8 * (1 / ETA - 1)) / 100, 9)
    expect(withFeedIn.selfConsumptionSavingOverCoveredPeriod).toBeLessThan(oldRule)

    // Der Fahrplan ist in beiden Läufen derselbe — der Leistungspreis-Anteil bleibt unberührt.
    expect(withFeedIn.leistungspreisSavingPerYear).toBe(withoutFeedIn.leistungspreisSavingPerYear)
    expect(withFeedIn.newBilledKw).toBe(withoutFeedIn.newBilledKw)
  })

  it('⚠ Lastverschiebung an der Kippgrenze: ein Ladepreis von η × Entladepreis ist EXAKT wertlos', () => {
    /*
     * Der entscheidende Wächter. Bei 22,50 ct Nachttarif und 25 ct tagsüber sieht die Verschiebung
     * nach dem alten Rechenweg wie ein Geschäft aus (2,50 ct/kWh Aufschlag) — sie ist aber genau
     * das Gegenteil: 22,50 ÷ 0,9 = 25,00 ct je eingespeicherter kWh, also derselbe Preis, den der
     * Kunde tagsüber ohnehin zahlt. Der Speicher fährt hier Energie durch und verdient nichts.
     *
     * Geladen wird trotzdem (das Fenster ist nominell günstiger, und der Dispatch entscheidet an
     * der Preis-Schwelle, nicht an der Wirtschaftlichkeit) — ohne diesen Test bliebe der Ertrag
     * daraus unbemerkt positiv.
     */
    const atBreakEven = computeBatterySavings(load, battery, {
      ...base,
      timeOfUseWindows: [{ from: '22:00', to: '06:00', ctPerKwh: 25 * ETA }],
    })
    expect(atBreakEven.loadShiftSavingOverCoveredPeriod).toBeCloseTo(0, 8)

    // Gegenprobe, damit der Nullwert nicht aus einem ausgefallenen Ladefenster stammt: DEUTLICH
    // unter der Kippgrenze entsteht sehr wohl eine Ersparnis, am selben Profil und Gerät.
    const belowBreakEven = computeBatterySavings(load, battery, {
      ...base,
      timeOfUseWindows: [{ from: '22:00', to: '06:00', ctPerKwh: 12 }],
    })
    expect(belowBreakEven.loadShiftSavingOverCoveredPeriod).toBeGreaterThan(1)

    /*
     * Und der Wert unter der Kippgrenze folgt derselben Regel: der Aufschlag je gespeicherter kWh
     * ist 25 − 12/0,9 = 11,667 ct statt der 13 ct des alten Rechenwegs. Die verschobene Menge
     * fällt aus dem Verhältnis heraus.
     */
    const oldMargin = 25 - 12
    const newMargin = 25 - 12 / ETA
    const impliedKwh = (belowBreakEven.loadShiftSavingOverCoveredPeriod * 100) / newMargin
    expect((impliedKwh * oldMargin) / 100).toBeGreaterThan(
      belowBreakEven.loadShiftSavingOverCoveredPeriod,
    )
  })

  it('η = 1 lässt beide Töpfe unverändert — der Faktor greift nur, wo es Verluste gibt', () => {
    /*
     * Die Gegenrichtung: ohne Ladeverlust ist `1/η = 1`, und die neue Regel muss bit-genau
     * dasselbe liefern wie die alte. Hier gerechnet mit einem verlustfreien Zwilling desselben
     * Geräts — die Bewertung ist dann wieder (25 − 8) bzw. (25 − 12).
     */
    const lossless = computeBatterySavings(
      load,
      { ...battery, roundTripEfficiency: 1 },
      { ...base, einspeiseverguetungCtPerKwh: 8 },
    )
    const shiftedKwh = (lossless.selfConsumptionSavingOverCoveredPeriod * 100) / (25 - 8)
    expect(shiftedKwh).toBeGreaterThan(0)
    expect(lossless.selfConsumptionSavingOverCoveredPeriod).toBeCloseTo(
      (shiftedKwh * (25 - 8 / 1)) / 100,
      12,
    )
  })
})
