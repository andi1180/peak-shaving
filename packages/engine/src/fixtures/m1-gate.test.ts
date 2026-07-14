import { describe, expect, it } from 'vitest'
import type { AnalysisResult, BillingModel, LoadProfile, TariffParams } from 'shared'

import { recommendBattery } from '../recommendation/rank'
import { simulateBattery } from '../simulation/simulate'
import {
  basisForTouLoadProfile,
  basisLoadProfile,
  basisWithPvLoadProfile,
  flatTariff,
  GATE_CATALOG,
  GATE_DYNAMIC_BATTERY,
  GATE_HORIZON_YEARS,
  GATE_STATIC_BATTERY,
  SPIKE_KW,
  touTariff,
} from './profiles'

/**
 * §3.11 M1-Gate — die formale Fixture-Suite, die das M1-Gate (§10) schließt. Läuft die VOLLE Kette
 * (`simulateBattery` → `computeBatterySavings` → `calculateRoi`, verkettet über `recommendBattery`,
 * §3.8) gegen drei benannte synthetische Profile (`fixtures/profiles.ts`) UND beide betroffenen
 * `billingModel`-Strategien — bislang lief nie ein PV- oder HT/NT-Profil durch `recommendBattery`
 * (nur `attribute.test.ts` prüft PV/TOU, aber nur bis `computeBatterySavings`, ohne ROI/Ranking).
 */

const EPS = 1e-6
const BILLING_MODELS: BillingModel[] = ['annual_max', 'monthly_max_average']

type ProfileFixture = {
  label: string
  loadProfile: LoadProfile
  tariff: (billingModel: BillingModel) => TariffParams
}

const PROFILES: ProfileFixture[] = [
  { label: 'Basis (kein PV, flacher Tarif)', loadProfile: basisLoadProfile(), tariff: flatTariff },
  { label: 'Basis + PV', loadProfile: basisWithPvLoadProfile(), tariff: flatTariff },
  { label: 'Basis + HT/NT-Fenster', loadProfile: basisForTouLoadProfile(), tariff: touTariff },
]

type MatrixRow = {
  profileLabel: string
  billingModel: BillingModel
  dynamic: AnalysisResult['perBattery'][number]
  static_: AnalysisResult['perBattery'][number]
}

function findEntry(
  perBattery: AnalysisResult['perBattery'],
  batteryId: string,
): AnalysisResult['perBattery'][number] {
  const entry = perBattery.find((p) => p.battery.id === batteryId)
  if (!entry) throw new Error(`Kein perBattery-Eintrag für ${batteryId}`)
  return entry
}

// Die 3×2-Matrix EINMAL rechnen (deterministisch) — TEIL 1/2/3 lesen daraus, statt sie mehrfach neu
// zu simulieren. `financialParams` bewusst weggelassen (wie `rank.test.ts`) — kein Contract-Bezug hier.
const MATRIX: MatrixRow[] = PROFILES.flatMap((profile) =>
  BILLING_MODELS.map((billingModel): MatrixRow => {
    const tariff = profile.tariff(billingModel)
    const { perBattery } = recommendBattery(profile.loadProfile, tariff, GATE_CATALOG, GATE_HORIZON_YEARS)
    return {
      profileLabel: profile.label,
      billingModel,
      dynamic: findEntry(perBattery, GATE_DYNAMIC_BATTERY.id),
      static_: findEntry(perBattery, GATE_STATIC_BATTERY.id),
    }
  }),
)

describe('§3.11 M1-Gate — 3×2-Matrix (3 Profile × annual_max/monthly_max_average)', () => {
  it('Verifikations-Tabelle: alle 6 Kombinationen (dynamic-Kandidat)', () => {
    const rows = MATRIX.map((r) => {
      const d = r.dynamic
      return (
        `  ${r.profileLabel.padEnd(24)} · ${r.billingModel.padEnd(20)} · ` +
        `leistungspreis=€${d.leistungspreisSavingPerYear.toFixed(0).padStart(5)} · ` +
        `eigenverbrauch=€${d.selfConsumptionSavingPerYear.toFixed(0).padStart(4)} · ` +
        `lastverschiebung=€${d.loadShiftSavingPerYear.toFixed(0).padStart(4)} · ` +
        `total=€${d.totalSavingPerYear.toFixed(0).padStart(5)}`
      )
    })
    console.log(`[§3.11 M1-Gate] 3×2-Matrix (dynamic):\n${rows.join('\n')}`)

    expect(MATRIX).toHaveLength(6)
  })

  describe('TEIL 1 — je Profil wird der jeweils zu testende Ersparnis-Pfad tatsächlich > 0', () => {
    it('Profil 1 (Basis): Spitzenkappung > 0, aber Eigenverbrauch/Lastverschiebung bleiben 0 (kein PV, kein Fenster)', () => {
      for (const bm of BILLING_MODELS) {
        const d = MATRIX.find((r) => r.profileLabel === PROFILES[0]!.label && r.billingModel === bm)!.dynamic
        expect(d.leistungspreisSavingPerYear).toBeGreaterThan(0)
        expect(d.selfConsumptionSavingPerYear).toBe(0)
        expect(d.loadShiftSavingPerYear).toBe(0)
      }
    })

    it('Profil 2 (Basis + PV): Eigenverbrauchs-Pfad > 0 (Schritt 3–4, inkl. Spitzen-Reserve)', () => {
      for (const bm of BILLING_MODELS) {
        const d = MATRIX.find((r) => r.profileLabel === PROFILES[1]!.label && r.billingModel === bm)!.dynamic
        expect(d.selfConsumptionSavingPerYear).toBeGreaterThan(0)
        // Kein Tarif-Fenster in Profil 2 → keine Lastverschiebung.
        expect(d.loadShiftSavingPerYear).toBe(0)
      }
    })

    it('Profil 3 (Basis + HT/NT-Fenster): Lastverschiebungs-Pfad > 0 (Schritt 5, tarifbewusstes Laden)', () => {
      for (const bm of BILLING_MODELS) {
        const d = MATRIX.find((r) => r.profileLabel === PROFILES[2]!.label && r.billingModel === bm)!.dynamic
        expect(d.loadShiftSavingPerYear).toBeGreaterThan(0)
        // Kein PV in Profil 3 → kein Eigenverbrauch.
        expect(d.selfConsumptionSavingPerYear).toBe(0)
      }
    })
  })

  describe('TEIL 2 — Teiljahres-Regressionsmatrix (§3.5-Fix: Einzelmonat wird NICHT mehr verdünnt)', () => {
    for (const profile of PROFILES) {
      it(`${profile.label}: Fixtures liegen in EINEM Monat → monthly_max_average ≈ annual_max (keine 1/12-Verdünnung)`, () => {
        const annual = MATRIX.find((r) => r.profileLabel === profile.label && r.billingModel === 'annual_max')!
          .dynamic
        const monthly = MATRIX.find(
          (r) => r.profileLabel === profile.label && r.billingModel === 'monthly_max_average',
        )!.dynamic

        console.log(
          `[§3.11 Tarif-Matrix] ${profile.label}: ` +
            `annual_max leistungspreis=€${annual.leistungspreisSavingPerYear.toFixed(0)} · ` +
            `monthly_max_average leistungspreis=€${monthly.leistungspreisSavingPerYear.toFixed(0)}`,
        )

        // Die drei §3.11-Fixtures decken BEWUSST einen einzigen Kalendermonat (Februar) ab. VOR dem
        // §3.5-Fix teilte `monthly_max_average` durch 12 (die 11 leeren Monate gingen als Spitze 0 in
        // die Mittelung ein) und die Ersparnis kollabierte auf ~1/12 des annual_max-Werts — GENAU der
        // an echten Wiener-Netze-Kundendaten gefundene Fehler (billedKw 2,8 → 0,2 kW). NACH dem Fix
        // zählt nur der belegte Monat: der Mittelwert über 1 Monat = dessen Peak = Jahres-Peak, also
        // liefern monthly_max_average und annual_max (nahezu) dieselbe Ersparnis. Der Test ist damit
        // ein Voll-Ketten-Regressionswächter (recommendBattery) für genau diesen Bug.
        // (Die ECHTE 1/12-Verdünnung durch reale Monate ohne Spitze prüfen strategy.test.ts /
        // analyze.test.ts mit voller 12-Monats-Abdeckung.)
        expect(annual.leistungspreisSavingPerYear).toBeGreaterThan(0)
        expect(monthly.leistungspreisSavingPerYear).toBeGreaterThan(
          annual.leistungspreisSavingPerYear * 0.9,
        )
        expect(monthly.leistungspreisSavingPerYear).toBeLessThanOrEqual(
          annual.leistungspreisSavingPerYear + EPS,
        )
      })
    }
  })

  describe('TEIL 3 — fachliche Invarianten aus CLAUDE.md, über die gesamte Matrix', () => {
    it('billedKw nie < minBillableKw (hier: minBillableKw=0 → nur nonnegative newBilledKw)', () => {
      for (const row of MATRIX) {
        expect(row.dynamic.newBilledKw).toBeGreaterThanOrEqual(0)
        expect(row.static_.newBilledKw).toBeGreaterThanOrEqual(0)
      }
    })

    it('Summe der drei Ersparnisanteile = totalSavingPerYear (exakt, alle 6 Kombinationen × beide Kandidaten)', () => {
      for (const row of MATRIX) {
        for (const entry of [row.dynamic, row.static_]) {
          const sum =
            entry.leistungspreisSavingPerYear +
            entry.selfConsumptionSavingPerYear +
            entry.loadShiftSavingPerYear
          expect(entry.totalSavingPerYear).toBeCloseTo(sum, 6)
        }
      }
    })

    it('static kappt nie: leistungspreisSavingPerYear = 0 in JEDER der 6 Kombinationen', () => {
      for (const row of MATRIX) {
        expect(row.static_.leistungspreisSavingPerYear).toBe(0)
      }
    })
  })
})

describe('§3.11 M1-Gate — TEIL 3: minBillableKw bindet tatsächlich (nicht nur strukturell wahr)', () => {
  it('überdimensionierte Batterie + Mindestleistung 15 kW → newBilledKw = 15 (Sockel bindet)', () => {
    // Kleiner Peak (25 kW), große Batterie (60 kWh/20 kW) kappt ihn fast vollständig — der
    // TariffStrategy-Sockel (§3.5, `withMinimum`) verhindert, dass eine "perfekte" Batterie
    // darunter abrechnet.
    const lp = basisLoadProfile() // Jahres-Peak hier irrelevant; siehe eigener Mini-Peak unten
    const tinyPeakProfile: LoadProfile = {
      ...lp,
      readings: lp.readings.map((r) => ({ ts: r.ts, gridPowerKw: Math.min(r.gridPowerKw, 25) })),
    }
    const tariff = flatTariff('annual_max', { minBillableKw: 15 })
    const sim = simulateBattery(tinyPeakProfile, GATE_DYNAMIC_BATTERY, tariff)

    console.log(`[§3.11 Mindestleistung] cap=${(sim.capKwByPeriod[0] ?? NaN).toFixed(1)} kW · newBilledKw=${sim.newBilledKw.toFixed(1)} kW`)

    expect(sim.newBilledKw).toBeCloseTo(15, 6)
  })
})

describe('§3.11 M1-Gate — TEIL 3: soc ∈ [0, usableCapacityKwh] durchgängig (PV-Profil, voller Dispatch)', () => {
  it('Profil 2 (Basis + PV), dynamic, annual_max: jeder SoC-Wert im gültigen Bereich, |Leistung| ≤ maxPowerKw', () => {
    const lp = basisWithPvLoadProfile()
    const tariff = flatTariff('annual_max')
    const sim = simulateBattery(lp, GATE_DYNAMIC_BATTERY, tariff)

    for (const soc of sim.dispatch.socKwh) {
      expect(soc).toBeGreaterThanOrEqual(-EPS)
      expect(soc).toBeLessThanOrEqual(GATE_DYNAMIC_BATTERY.usableCapacityKwh + EPS)
    }
    for (const p of sim.dispatch.batteryPowerKw) {
      expect(Math.abs(p)).toBeLessThanOrEqual(GATE_DYNAMIC_BATTERY.maxPowerKw + EPS)
    }
    // Sanity: der Jahres-Peak wird tatsächlich spürbar unter SPIKE_KW gekappt.
    expect(sim.capKwByPeriod[0] ?? Infinity).toBeLessThan(SPIKE_KW - 5)
  })
})
