import type { BatteryCandidate, LoadProfile, PvProfile, TariffParams } from 'shared'

/**
 * §3.11-Fixture-Generatoren — das M1-Gate braucht MINDESTENS drei synthetische Lastprofile
 * (Pflichtenheft §3.11), nicht eines: ein einzelnes Profil testet nur Spitzenkappung (Schritt 1–2)
 * und lässt Eigenverbrauch/Lastverschiebung bei jedem Testlauf unbemerkt auf 0 stehen. Reine
 * Test-Fixtures — bewusst NICHT über den `packages/engine`-Root-Barrel exportiert (wie
 * `recommendation/dummy-catalog.ts`), kein Produktionscode.
 *
 * Alle drei Profile teilen dieselbe Bäckerei-Tagesform (Ofen-Anlauf 06–08h, Geschäftstag 08–20h,
 * Nachtruhe sonst) und denselben dominanten Jahres-Peak an EINEM Tag — Profil 2/3 fügen NUR die
 * jeweils zu testende Zutat hinzu (PV bzw. HT/NT-Fenster), damit die drei Fälle direkt vergleichbar
 * bleiben (§3.11: "Basis + PV-Profil", "Basis + HT/NT-Tarif-Fenster").
 *
 * PV läuft in diesen §3.11-LASTGANG-Fixtures als negativer (einspeisender) Anteil direkt im signierten
 * `gridPowerKw` — der Netz-Lastgang enthält die Einspeisung bereits (§3.1: "Der Netz-Lastgang enthält
 * die Einspeisung bereits als kappbaren Überschuss"). SEIT der PvProfile-Kette wird ein separates
 * `PvProfile` zusätzlich konsumiert (`simulateBattery`/`recommendBattery`/`buildDispatchTrace`), ändert
 * aber NUR den Trace (echte Brutto-PV) + die Konsistenzprüfung, NICHT den Dispatch/die Ersparnis (der
 * speicherbare Überschuss = Einspeisung steckt schon im Lastgang). Passende Brutto-PV-Fixtures dazu:
 * `consistentPvProfile`/`inconsistentPvProfile` (unten).
 */

const STEP_MS = 15 * 60 * 1000
const SLOTS_PER_DAY = 96
const iso = (ms: number): string => new Date(ms).toISOString()

export const N_DAYS = 18
/** Tag mit dem dominanten Jahres-Peak (0-indiziert) — weit genug von beiden Rändern für den §3.6-Rückwärtspass. */
export const SPIKE_DAY_INDEX = 9
export const SPIKE_KW = 70
export const RAMP_KW = 12 // normaler täglicher Ofen-Anlauf (kein Jahres-Peak)
export const BUSINESS_KW = 9
export const NIGHT_KW = 3
export const PV_EXPORT_KW = 16

/**
 * Ein Tag (96 × 15 min), Bäckerei-artig:
 *  - idx 0–23  (00–06 h): Nachtruhe, `NIGHT_KW` — deckt sich mit dem HT/NT-Fenster 22:00–06:00.
 *  - idx 24–31 (06–08 h): Ofen-Anlauf, `RAMP_KW` — am `SPIKE_DAY_INDEX` stattdessen `SPIKE_KW`
 *    (der dominante, kurze Jahres-Peak, der die Kapp-Suche/Leistungspreis-Ersparnis trägt).
 *  - idx 56–63 (14–16 h): NUR bei `pv=true` Einspeisung `-PV_EXPORT_KW` (sonst Teil des Geschäftstags).
 *  - idx 32–79 (08–20 h, ohne PV-Fenster): Geschäftstag, `BUSINESS_KW`.
 *  - idx 80–95 (20–24 h): Nachtruhe, `NIGHT_KW`.
 */
function bakeryDay(opts: { spike: boolean; pv: boolean }): number[] {
  const d = new Array<number>(SLOTS_PER_DAY)
  for (let i = 0; i < SLOTS_PER_DAY; i++) {
    if (i < 24) d[i] = NIGHT_KW
    else if (i < 32) d[i] = opts.spike ? SPIKE_KW : RAMP_KW
    else if (opts.pv && i >= 56 && i < 64) d[i] = -PV_EXPORT_KW
    else if (i < 80) d[i] = BUSINESS_KW
    else d[i] = NIGHT_KW
  }
  return d
}

/** `N_DAYS` Tage ab 1. Februar (ein einzelner Kalendermonat — s. Dilutions-Kommentar in `flatTariff`). */
function buildProfile(pv: boolean): LoadProfile {
  const t0 = Date.parse('2024-02-01T00:00:00Z')
  const days = Array.from({ length: N_DAYS }, (_, i) => bakeryDay({ spike: i === SPIKE_DAY_INDEX, pv }))
  const readings = days
    .flat()
    .map((gridPowerKw, i) => ({ ts: iso(t0 + i * STEP_MS), gridPowerKw }))
  return { readings, intervalMinutes: 15, timezoneMeta: 'UTC', source: 'net_signed' }
}

/** Profil 1 (§3.11): Basis — kein PV, testet ausschließlich Spitzenkappung (Schritt 1–2). */
export const basisLoadProfile = (): LoadProfile => buildProfile(false)

/** Profil 2 (§3.11): Basis + PV — testet den Eigenverbrauchs-Pfad inkl. Spitzen-Reserve (Schritt 3–4). */
export const basisWithPvLoadProfile = (): LoadProfile => buildProfile(true)

/**
 * Separate BRUTTO-PV-Profile für den PvProfile-Pfad (§3.1) — ausgerichtet auf `basisWithPvLoadProfile`.
 * Dort exportiert der Lastgang `-PV_EXPORT_KW` (= 16 kW Einspeisung) an den Slots 56–63 (14–16 h),
 * feed-in 0 sonst. Zeitzone UTC, 96 Slots/Tag, keine DST → `i % SLOTS_PER_DAY` = Slot-des-Tages.
 */
function buildPvProfile(grossKwAtPvSlots: number): PvProfile {
  const lp = basisWithPvLoadProfile()
  return {
    readings: lp.readings.map((r, i) => {
      const slotOfDay = i % SLOTS_PER_DAY
      const gross = slotOfDay >= 56 && slotOfDay < 64 ? grossKwAtPvSlots : 0
      return { ts: r.ts, pvGenerationKw: gross }
    }),
  }
}

/**
 * KONSISTENTES Brutto-PV-Profil zu `basisWithPvLoadProfile`: 20 kW Brutto an den PV-Slots
 * (≥ Einspeisung 16 kW) → PV-Eigenverbrauch 4 kW, abgeleiteter Verbrauch dort = −16 + 20 = 4 kW ≥ 0.
 * Löst die §3.1-Konsistenz-Warnung NIE aus (`inconsistentSlots = 0`).
 */
export const consistentPvProfile = (): PvProfile => buildPvProfile(20)

/**
 * INKONSISTENTES Brutto-PV-Profil: nur 10 kW Brutto an den PV-Slots — UNTER der gemessenen
 * Einspeisung 16 kW (physikalisch unmöglich). `alignPvGrossToLoad` klemmt auf 16 kW und zählt jeden
 * betroffenen Slot: 8 PV-Slots/Tag × `N_DAYS` = 144 inkonsistente Slots.
 */
export const inconsistentPvProfile = (): PvProfile => buildPvProfile(10)

/** Erwartete Anzahl inkonsistenter Slots im `inconsistentPvProfile` (8 PV-Slots/Tag × N_DAYS). */
export const INCONSISTENT_PV_SLOTS = 8 * N_DAYS

/**
 * Profil 3 (§3.11): Basis + HT/NT-Tarif-Fenster. Testet tarifbewusstes Laden (Schritt 5,
 * `loadShiftSavingPerYear`) — die LAST ist identisch zu Profil 1, nur `touTariff()` (unten) fügt
 * das günstige Fenster hinzu. Eigener Name der Klarheit halber (§3.11 benennt es als eigenes Profil).
 */
export const basisForTouLoadProfile = (): LoadProfile => buildProfile(false)

/**
 * Flacher Tarif (kein HT/NT-Fenster). `billingModel` bewusst NICHT diluted vor-eingestellt: alle
 * `N_DAYS` liegen im selben Kalendermonat (Februar) → unter `monthly_max_average` sind 11 der 12
 * Monats-Höchstwerte 0 (`positiveMonthlyPeaksKw`, `packages/engine/src/peaks/metrics.ts:28`), der
 * Durchschnitt verdünnt den einzigen abgedeckten Monat also faktisch auf 1/12 — GENAU die §3.5-These
 * (TEIL 2 der M1-Gate-Suite), nicht künstlich nachgestellt, sondern eine direkte Konsequenz eines
 * einzelnen abgedeckten Abrechnungsmonats.
 */
export function flatTariff(
  billingModel: TariffParams['billingModel'],
  overrides: Partial<TariffParams> = {},
): TariffParams {
  return {
    leistungspreisEurPerKwYear: 100,
    billingModel,
    minBillableKw: 0,
    energyPriceCtPerKwh: 25,
    einspeiseverguetungCtPerKwh: 8,
    ...overrides,
  }
}

/** Wie `flatTariff`, plus ein NT-Fenster 22:00–06:00 zu 10 ct (günstiger als der Tagespreis 25 ct). */
export function touTariff(billingModel: TariffParams['billingModel']): TariffParams {
  return flatTariff(billingModel, {
    timeOfUseWindows: [{ from: '22:00', to: '06:00', ctPerKwh: 10 }],
  })
}

const GATE_BATTERY_PHYSICS = {
  usableCapacityKwh: 60,
  maxPowerKw: 20, // < SPIKE_KW − *irgendeine plausible cap* → Kapp-Suche bleibt leistungsbegrenzt (wie simulate.test.ts).
  roundTripEfficiency: 0.9,
  pricePerKwh: 350,
  inverterIncluded: true,
  requiresFoundation: false,
} as const

/** Kandidat A (dynamic): kreditiert Spitzenkappung + Eigenverbrauch + Lastverschiebung. */
export const GATE_DYNAMIC_BATTERY: BatteryCandidate = {
  id: 'gate-dynamic-60-20',
  name: 'M1-Gate Dynamic 60/20',
  manufacturer: 'Fixture',
  class: 'commercial',
  ...GATE_BATTERY_PHYSICS,
  controlType: 'dynamic',
}

/** Kandidat B (static): identische Physik, NUR Eigenverbrauch/Lastverschiebung — nie Spitzenkappung (OP#5). */
export const GATE_STATIC_BATTERY: BatteryCandidate = {
  id: 'gate-static-60-20',
  name: 'M1-Gate Static 60/20',
  manufacturer: 'Fixture',
  class: 'commercial',
  ...GATE_BATTERY_PHYSICS,
  controlType: 'static',
}

export const GATE_CATALOG: BatteryCandidate[] = [GATE_DYNAMIC_BATTERY, GATE_STATIC_BATTERY]

export const GATE_HORIZON_YEARS = 10
