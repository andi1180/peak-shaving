import { describe, expect, it } from 'vitest'

import {
  ANALYSIS_BUNDLE_VERSION,
  ENGINE_COMMIT_SHA_PLACEHOLDER,
  ENGINE_VERSION,
  buildAnalysisBundle,
  deriveBaselineExtracts,
  isPlaceholderCommitSha,
  parseAnalysisBundle,
  serializeAnalysisBundle,
  type AnalysisBundleInputs,
} from './analysis-bundle'
import { sha256Hex } from './archive'
import type { AnalysisResult } from './analysis-result'
import type { BatteryCandidate } from './battery'
import type { TariffParams } from './tariff'

/**
 * B14-2 — Das Bündel im Rechner (Pflicht-Tests 8 und 9 der Aufgabenstellung).
 *
 * Die Prüfkette des Uploads liegt in `apps/web/lib/admin/analysis-upload.test.ts`; hier geht es um
 * die ERZEUGENDE Seite: erfüllt das Bündel die getypte Definition, passt die Prüfsumme zur
 * eingelesenen Datei — und entsteht ohne Ursprungsdatei nachweislich KEIN Bündel.
 */

const BATTERY: BatteryCandidate = {
  id: 'test-c60',
  name: 'PeakStore C60',
  manufacturer: '[MARTIN: Katalog]',
  class: 'commercial',
  usableCapacityKwh: 60,
  maxPowerKw: 30,
  roundTripEfficiency: 0.9,
  pricePerKwh: 235,
  inverterIncluded: true,
  requiresFoundation: false,
  controlType: 'dynamic',
}

const TARIFF: TariffParams = {
  leistungspreisEurPerKwYear: 100,
  billingModel: 'annual_max',
  minBillableKw: 0,
  energyPriceCtPerKwh: 25,
  einspeiseverguetungCtPerKwh: 8,
}

function makeResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    current: {
      annualPeakKw: 50.8,
      monthlyPeaksKw: Array(12).fill(40),
      billedKw: 50.8,
      leistungspreisCostPerYear: 5080,
    },
    peaks: {
      top: [{ ts: '2023-01-20T06:00:00.000Z', kw: 50.8 }],
      distribution: {
        byWeekday: Array(7).fill(0),
        byHour: Array(24).fill(0),
        byMonth: Array(12).fill(0),
      },
    },
    perBattery: [
      {
        battery: BATTERY,
        newBilledKw: 20.8,
        leistungspreisSavingPerYear: 3000,
        selfConsumptionSavingPerYear: 0,
        loadShiftSavingPerYear: 0,
        totalSavingPerYear: 3000,
        totalInvestment: 14100,
        subsidyAmount: 0,
        taxBenefit: 0,
        taxEffectsIncluded: false,
        netInvestment: 14100,
        amortizationYears: 4.7,
        netSavingOverHorizon: 15900,
        warnings: [],
      },
    ],
    recommendation: { batteryId: 'test-c60', rationale: 'Beispiel' },
    assumptions: {
      roundTripEfficiency: 0.9,
      horizonYears: 10,
      energyPriceCtPerKwh: 25,
      einspeiseverguetungCtPerKwh: 8,
      billingModel: 'annual_max',
    },
    dataQuality: { coveredDays: 365, coveredMonths: 12, gapsInterpolated: 0, warnings: [] },
    ...overrides,
  }
}

const INPUTS: AnalysisBundleInputs = {
  tariff: TARIFF,
  horizonYears: 10,
  batteryCatalog: [BATTERY],
  pvFileName: null,
}

/** Eine „Ursprungsdatei" — Inhalt beliebig, es zählt, dass es genau diese Bytes sind. */
const SOURCE = new TextEncoder().encode(
  'Zeitpunkt;Wert\r\n01.01.2023 00:00;1,25\r\n01.01.2023 00:15;1,30\r\n',
)

const REAL_COMMIT = 'b96f15ba9c0d1e2f3a4b5c6d7e8f90123456789a'

async function makeBundle(sourceFile: Uint8Array | null = SOURCE) {
  return buildAnalysisBundle({
    engineVersion: ENGINE_VERSION,
    engineCommitSha: REAL_COMMIT,
    computedAt: '2026-07-21T10:00:00.000Z',
    inputs: INPUTS,
    result: makeResult(),
    sourceFileName: 'lastgang-2023.csv',
    sourceFile,
  })
}

describe('B14-2 — Bündel-Export im Rechner', () => {
  // ── Pflicht-Test 8 ────────────────────────────────────────────────────────────────────────────
  it('erzeugt ein Bündel, das die getypte Definition erfüllt, mit passender Prüfsumme', async () => {
    const bundle = await makeBundle()

    expect(bundle.bundleVersion).toBe(ANALYSIS_BUNDLE_VERSION)
    expect(bundle.engineVersion).toBe(ENGINE_VERSION)
    expect(bundle.engineCommitSha).toBe(REAL_COMMIT)
    expect(bundle.sourceFileName).toBe('lastgang-2023.csv')

    // Die Prüfsumme gilt der EINGELESENEN Datei, nicht einer abgeleiteten Fassung.
    expect(bundle.sourceFileSha256).toBe(await sha256Hex(SOURCE))
    expect(bundle.sourceFileSha256).toMatch(/^[0-9a-f]{64}$/)

    // Die Ursprungsdatei selbst steckt NICHT im Bündel — sie wird getrennt hochgeladen.
    expect(JSON.stringify(bundle)).not.toContain('01.01.2023')

    // Und das serialisierte Bündel besteht die Prüfung der Gegenseite.
    const parsed = parseAnalysisBundle(JSON.parse(serializeAnalysisBundle(bundle)))
    expect(parsed.ok).toBe(true)
  })

  it('führt die Eingangsgrössen als WERTE mit — kein Verweis auf eine Katalogzeile', async () => {
    const bundle = await makeBundle()
    // Der komplette Kandidat inklusive Preis und Wirkungsgrad, nicht nur seine Kennung: ein Verweis
    // änderte die eingefrorene Baseline still mit, sobald jemand den Katalog pflegt (B14-1).
    expect(bundle.inputs.batteryCatalog[0]).toMatchObject({
      id: 'test-c60',
      pricePerKwh: 235,
      roundTripEfficiency: 0.9,
      usableCapacityKwh: 60,
    })
    expect(bundle.inputs.tariff.billingModel).toBe('annual_max')
    expect(bundle.inputs.horizonYears).toBe(10)
  })

  // ── Pflicht-Test 9 ────────────────────────────────────────────────────────────────────────────
  it('erzeugt OHNE vorliegende Ursprungsdatei kein Bündel', async () => {
    await expect(makeBundle(null)).rejects.toThrow(/Ursprungsdatei liegt nicht mehr vor/)
    await expect(makeBundle(new Uint8Array(0))).rejects.toThrow(
      /Ursprungsdatei liegt nicht mehr vor/,
    )
  })

  it('erkennt Platzhalter-Commits, echte Commits nicht', () => {
    expect(isPlaceholderCommitSha(ENGINE_COMMIT_SHA_PLACEHOLDER)).toBe(true)
    expect(isPlaceholderCommitSha('')).toBe(true)
    expect(isPlaceholderCommitSha('   ')).toBe(true)
    expect(isPlaceholderCommitSha(undefined)).toBe(true)
    expect(isPlaceholderCommitSha('b96f15b')).toBe(false)
    expect(isPlaceholderCommitSha(REAL_COMMIT)).toBe(false)
  })
})

describe('B11 — Tarif-Herkunft im Bündel (Fassung 2)', () => {
  const WITH_SOURCE: AnalysisBundleInputs = {
    ...INPUTS,
    tariffSetId: 'at-2026',
    tariffSetLabel: 'Netznutzung Österreich, Stand 2026',
    tariffSetValidFrom: '2026-01-01',
    tariffProfileKey: 'wiener_netze:NE3',
    tariffOverriddenFields: ['billingModel'],
  }

  // ── Pflicht-Test 7 ────────────────────────────────────────────────────────────────────────────
  it('trägt Fassung 2, die neuen Felder — und die Preiswerte weiterhin DENORMALISIERT', async () => {
    const bundle = await buildAnalysisBundle({
      engineVersion: ENGINE_VERSION,
      engineCommitSha: REAL_COMMIT,
      computedAt: '2026-07-21T10:00:00.000Z',
      inputs: WITH_SOURCE,
      result: makeResult(),
      sourceFileName: 'lastgang-2023.csv',
      sourceFile: SOURCE,
    })

    expect(bundle.bundleVersion).toBe(2)
    expect(bundle.inputs.tariffSetId).toBe('at-2026')
    expect(bundle.inputs.tariffSetValidFrom).toBe('2026-01-01')
    expect(bundle.inputs.tariffProfileKey).toBe('wiener_netze:NE3')
    expect(bundle.inputs.tariffOverriddenFields).toEqual(['billingModel'])

    /*
     * DER EIGENTLICHE PUNKT: die Kennung tritt NEBEN die Werte, nicht an ihre Stelle. Stünde hier
     * nur noch `tariffSetId`, änderte ein gepflegter Tarifsatz-Stand die eingefrorene Baseline
     * still mit — genau das verbietet B14-1, Regel (b), und zwar ausdrücklich schon mit Blick auf
     * diesen Bauabschnitt.
     */
    expect(bundle.inputs.tariff.leistungspreisEurPerKwYear).toBe(100)
    expect(bundle.inputs.tariff.billingModel).toBe('annual_max')
    expect(bundle.inputs.tariff.minBillableKw).toBe(0)

    expect(parseAnalysisBundle(JSON.parse(serializeAnalysisBundle(bundle))).ok).toBe(true)
  })

  it('lässt die Felder weg, wenn kein Netzbetreiber gewählt wurde', async () => {
    const bundle = await makeBundle()
    // Fehlend, nicht leer: „kam direkt aus der Netzrechnung" ist eine eigene Aussage.
    expect(bundle.inputs.tariffSetId).toBeUndefined()
    expect(bundle.inputs.tariffOverriddenFields).toBeUndefined()
    expect(bundle.bundleVersion).toBe(2)
  })

  it('unterscheidet „unverändert übernommen" von „keine Auswahl"', async () => {
    const bundle = await buildAnalysisBundle({
      engineVersion: ENGINE_VERSION,
      engineCommitSha: REAL_COMMIT,
      computedAt: '2026-07-21T10:00:00.000Z',
      inputs: { ...WITH_SOURCE, tariffOverriddenFields: [] },
      result: makeResult(),
      sourceFileName: 'lastgang-2023.csv',
      sourceFile: SOURCE,
    })
    // Leeres Array = Vorgabewerte unverändert übernommen. Fehlendes Feld = gar keine Auswahl.
    expect(bundle.inputs.tariffOverriddenFields).toEqual([])
    expect(bundle.inputs.tariffSetId).toBe('at-2026')
  })

  // ── Pflicht-Test 8 ────────────────────────────────────────────────────────────────────────────
  it('nimmt ein Bündel der Fassung 1 unverändert an', async () => {
    const v2 = await makeBundle()
    // Ein Bündel, wie es der Rechner VOR B11 erzeugt hat: Fassung 1, ohne die neuen Felder.
    const v1 = { ...v2, bundleVersion: 1 }

    const parsed = parseAnalysisBundle(JSON.parse(JSON.stringify(v1)))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.bundle.bundleVersion).toBe(1)
    expect(parsed.bundle.inputs.tariffSetId).toBeUndefined()
    // Unverändert heisst unverändert: die Rückgabe ist das rohe Objekt, nicht eine „migrierte" Kopie.
    expect(parsed.bundle.inputs.tariff).toEqual(v2.inputs.tariff)
    expect(parsed.bundle.sourceFileSha256).toBe(v2.sourceFileSha256)
  })

  it('lehnt eine unbekannte Fassung weiterhin ab, statt zu raten', () => {
    const parsed = parseAnalysisBundle({ bundleVersion: 3 })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.message).toContain('Unbekannte Bündel-Fassung 3')
    expect(parsed.message).toContain('1, 2')
  })
})

describe('B14-2 — die fünf typisierten Auszüge', () => {
  it('leitet sie aus dem Ergebnis ab, nicht aus einer Eingabe', () => {
    const extracts = deriveBaselineExtracts(makeResult())
    expect(extracts).toEqual({
      billedKwBefore: 50.8,
      billedKwAfter: 20.8,
      annualSavingEur: 3000,
      recommendedBatteryLabel: 'PeakStore C60',
      recommendedCapacityKwh: 60,
    })
  })

  it('bleibt bei fehlender Empfehlung ehrlich statt einen Ersatzwert zu behaupten', () => {
    const extracts = deriveBaselineExtracts(makeResult({ perBattery: [] }))
    // Modell und Kapazität sind unbekannt (null, die Spalten sind dafür nullable); die zwei
    // kW-Werte sind GLEICH und die Ersparnis 0 — ohne empfohlene Batterie ändert sich nichts.
    expect(extracts.recommendedBatteryLabel).toBeNull()
    expect(extracts.recommendedCapacityKwh).toBeNull()
    expect(extracts.billedKwAfter).toBe(extracts.billedKwBefore)
    expect(extracts.annualSavingEur).toBe(0)
  })
})
