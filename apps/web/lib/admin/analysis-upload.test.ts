import { describe, expect, it } from 'vitest'
import {
  ENGINE_COMMIT_SHA_PLACEHOLDER,
  ENGINE_VERSION,
  buildAnalysisBundle,
  gzipDecompress,
  serializeAnalysisBundle,
  type AnalysisBundle,
  type AnalysisBundleInputs,
  type AnalysisResult,
  type BatteryCandidate,
  type TariffParams,
} from 'shared'

import { MAX_SOURCE_FILE_BYTES } from './analyses'
import { prepareAnalysisUpload, type AnalysisUploadForm } from './analysis-upload'

/**
 * B14-2 — Die Prüfkette des Uploads (Pflicht-Tests 1, 2, 3, 5 und der Argumentteil von 4).
 *
 * ── WARUM DAS HIER UND NICHT IM DB-GATE STEHT ────────────────────────────────────────────────────
 * Geprüft wird genau die Eigenschaft, die sich NUR ausserhalb der Datenbank prüfen lässt: dass ein
 * abgelehntes Bündel gar keinen Aufruf erzeugt. Das Verhalten der Wrapper selbst (Prüfsumme in SQL,
 * gzip-Bindung, Append-only) ist B14-1 und liegt im DB-Gate.
 *
 * Die Bündel entstehen hier über `buildAnalysisBundle` — dieselbe Funktion, die auch der Rechner
 * benutzt. Ein von Hand getipptes Bündel würde nur beweisen, dass die Prüfung zu dem passt, was der
 * Test sich ausgedacht hat.
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
  billingModel: 'monthly_max_average',
  minBillableKw: 0,
  energyPriceCtPerKwh: 25,
  einspeiseverguetungCtPerKwh: 8,
}

const RESULT: AnalysisResult = {
  current: {
    annualPeakKw: 50.8,
    monthlyPeaksKw: Array(12).fill(40),
    billedKw: 50.6,
    leistungspreisCostPerYear: 5060,
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
      newBilledKw: 20.6,
      leistungspreisSavingPerYear: 2700,
      selfConsumptionSavingPerYear: 0,
      loadShiftSavingPerYear: 0,
      totalSavingPerYear: 2700,
      totalInvestment: 14100,
      subsidyAmount: 0,
      taxBenefit: 0,
      taxEffectsIncluded: false,
      netInvestment: 14100,
      amortizationYears: 7.1,
      netSavingOverHorizon: 7900,
      warnings: [],
    },
  ],
  recommendation: { batteryId: 'test-c60', rationale: 'Beispiel' },
  assumptions: {
    roundTripEfficiency: 0.9,
    horizonYears: 10,
    energyPriceCtPerKwh: 25,
    einspeiseverguetungCtPerKwh: 8,
    billingModel: 'monthly_max_average',
  },
  dataQuality: { coveredDays: 365, coveredMonths: 12, gapsInterpolated: 0, warnings: [] },
}

const INPUTS: AnalysisBundleInputs = {
  tariff: TARIFF,
  horizonYears: 10,
  batteryCatalog: [BATTERY],
  pvFileName: null,
}

const SOURCE = new TextEncoder().encode(
  'Zeitpunkt;Wert\r\n01.01.2023 00:00;1,25\r\n01.01.2023 00:15;1,30\r\n',
)
const OTHER_SOURCE = new TextEncoder().encode('Zeitpunkt;Wert\r\n01.01.2023 00:00;9,99\r\n')

const REAL_COMMIT = 'b96f15ba9c0d1e2f3a4b5c6d7e8f90123456789a'

const FORM: AnalysisUploadForm = {
  customerLabel: '  Kühlhaus Nord GmbH  ',
  siteLabel: 'Halle 2',
  analysisKind: 'betreut',
  leadId: '',
  supersedesId: '',
}

async function bundleFor(commitSha = REAL_COMMIT): Promise<AnalysisBundle> {
  return buildAnalysisBundle({
    engineVersion: ENGINE_VERSION,
    engineCommitSha: commitSha,
    computedAt: '2026-07-21T10:00:00.000Z',
    inputs: INPUTS,
    result: RESULT,
    sourceFileName: 'lastgang-2023.csv',
    sourceFile: SOURCE,
  })
}

async function prepare(
  bundleText: string,
  sourceFile: Uint8Array = SOURCE,
  form: AnalysisUploadForm = FORM,
) {
  return prepareAnalysisUpload({
    bundleText,
    sourceFileName: 'lastgang-2023.csv',
    sourceFile,
    form,
  })
}

describe('B14-2 — Prüfkette des Analyse-Uploads', () => {
  // ── Pflicht-Test 1 ────────────────────────────────────────────────────────────────────────────
  it('weist eine unbekannte bundleVersion ab und erzeugt keine Argumente', async () => {
    const bundle = await bundleFor()
    const text = JSON.stringify({ ...bundle, bundleVersion: 2 })

    const result = await prepare(text)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unerreichbar')
    expect(result.message).toMatch(/Unbekannte Bündel-Fassung 2/)
    expect(result.message).toMatch(/es wird nichts angelegt/i)
    // Es gibt keine Argumente — also gibt es auch nichts, was an die Datenbank gehen könnte.
    expect('prepared' in result).toBe(false)
  })

  it('weist eine fehlende bundleVersion ab', async () => {
    const bundle = await bundleFor()
    const { bundleVersion: _drop, ...rest } = bundle
    const result = await prepare(JSON.stringify(rest))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/bundleVersion/)
  })

  // ── Pflicht-Test 2 ────────────────────────────────────────────────────────────────────────────
  it('weist ein Bündel mit Platzhalter-Commit ab', async () => {
    const bundle = await bundleFor(ENGINE_COMMIT_SHA_PLACEHOLDER)
    const result = await prepare(serializeAnalysisBundle(bundle))

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unerreichbar')
    expect(result.message).toMatch(/keinen belegbaren Engine-Commit/)
    // Die Begründung gehört in die Meldung: sonst liest sich die Ablehnung wie Schikane.
    expect(result.message).toMatch(/Wirkungsnachweis/)
  })

  it('weist auch einen leeren Commit ab — nicht nur den benannten Platzhalter', async () => {
    const bundle = await bundleFor()
    const result = await prepare(JSON.stringify({ ...bundle, engineCommitSha: '' }))
    expect(result.ok).toBe(false)
  })

  // ── Pflicht-Test 3 — der wichtigste Fehlerfall der Seite ──────────────────────────────────────
  it('weist Bündel und Ursprungsdatei ab, deren Prüfsummen nicht zusammenpassen', async () => {
    const bundle = await bundleFor()
    const result = await prepare(serializeAnalysisBundle(bundle), OTHER_SOURCE)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unerreichbar')
    expect(result.message).toMatch(/gehören NICHT zusammen/)
    // Beide Werte stehen in der Meldung — wer sie sieht, kann die richtige Datei suchen.
    expect(result.message).toContain(bundle.sourceFileSha256)
    expect(result.field).toBe('sourceFile')
  })

  // ── Pflicht-Test 5 ────────────────────────────────────────────────────────────────────────────
  it('lehnt eine Datei über der Obergrenze ab, ohne das Bündel überhaupt zu lesen', async () => {
    const tooBig = new Uint8Array(MAX_SOURCE_FILE_BYTES + 1)
    // Bewusst ein KAPUTTES Bündel dazu: käme die Ablehnung nicht von der Grösse, scheiterte der
    // Test am JSON — die Reihenfolge der Prüfungen ist damit mitbewiesen.
    const result = await prepare('kein json', tooBig)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toMatch(/Obergrenze von 20 MB/)
      expect(result.field).toBe('sourceFile')
    }
  })

  it('lehnt eine unlesbare Bündel-Datei ab', async () => {
    const result = await prepare('{ kein json')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/kein lesbares JSON/)
  })

  it('verlangt einen Kunden — ohne ihn ist die Analyse 2027 niemandem zuzuordnen', async () => {
    const bundle = await bundleFor()
    const result = await prepare(serializeAnalysisBundle(bundle), SOURCE, {
      ...FORM,
      customerLabel: '   ',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.field).toBe('customerLabel')
  })

  // ── Pflicht-Test 4 (Argumentteil) ─────────────────────────────────────────────────────────────
  it('erzeugt im Gutfall Argumente, deren fünf Auszüge mit `result` übereinstimmen', async () => {
    const bundle = await bundleFor()
    const result = await prepare(serializeAnalysisBundle(bundle))

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    const { args } = result.prepared

    // Die fünf Auszüge stammen AUS dem Ergebnis, nicht aus dem Formular.
    expect(args.p_baseline_billed_kw_before).toBe(RESULT.current.billedKw)
    expect(args.p_baseline_billed_kw_after).toBe(RESULT.perBattery[0]!.newBilledKw)
    expect(args.p_baseline_annual_saving_eur).toBe(RESULT.perBattery[0]!.totalSavingPerYear)
    expect(args.p_recommended_battery_label).toBe(RESULT.perBattery[0]!.battery.name)
    expect(args.p_recommended_capacity_kwh).toBe(RESULT.perBattery[0]!.battery.usableCapacityKwh)

    // `inputs` und `result` reisen WORTGLEICH mit — nicht bereinigt, nicht neu zusammengesetzt.
    expect(args.p_inputs).toEqual(bundle.inputs)
    expect(args.p_result).toEqual(bundle.result)

    // Kopfdaten aus dem Bündel, Beschriftungen aus dem Formular (getrimmt).
    expect(args.p_engine_version).toBe(ENGINE_VERSION)
    expect(args.p_engine_commit_sha).toBe(REAL_COMMIT)
    expect(args.p_computed_at).toBe('2026-07-21T10:00:00.000Z')
    expect(args.p_customer_label).toBe('Kühlhaus Nord GmbH')
    expect(args.p_site_label).toBe('Halle 2')
    expect(args.p_analysis_kind).toBe('betreut')
    expect(args.p_source_file_sha256).toBe(bundle.sourceFileSha256)

    // Optionalfelder ohne Angabe werden WEGGELASSEN (⇒ SQL-Default null), nicht auf null gesetzt.
    expect('p_lead_id' in args).toBe(false)
    expect('p_supersedes_id' in args).toBe(false)
  })

  it('übergibt Datei und gzip-Fassung als bytea-Hex, und das gzip enthält genau die Datei', async () => {
    const bundle = await bundleFor()
    const result = await prepare(serializeAnalysisBundle(bundle))
    if (!result.ok) throw new Error(result.message)
    const { args } = result.prepared

    expect(args.p_source_file).toMatch(/^\\x[0-9a-f]+$/)
    expect(args.p_source_file_gzip).toMatch(/^\\x1f8b/)

    // Der Rundlauf über die gzip-Fassung: entpackt ergibt sie bitgleich die Ursprungsdatei.
    const gzip = Uint8Array.from(
      args.p_source_file_gzip
        .slice(2)
        .match(/../g)!
        .map((h) => Number.parseInt(h, 16)),
    )
    expect(Array.from(await gzipDecompress(gzip))).toEqual(Array.from(SOURCE))
  })

  it('nimmt Lead und ersetzte Analyse nur als echte UUID an', async () => {
    const bundle = await bundleFor()
    const good = await prepare(serializeAnalysisBundle(bundle), SOURCE, {
      ...FORM,
      leadId: '11111111-2222-3333-4444-555555555555',
      supersedesId: 'nicht-uuid',
    })
    if (!good.ok) throw new Error(good.message)
    expect(good.prepared.args.p_lead_id).toBe('11111111-2222-3333-4444-555555555555')
    // Ein unbrauchbarer Wert wird weggelassen statt durchgereicht: die Datenbank sähe sonst einen
    // Typfehler, und der Mensch bekäme eine Meldung, die nichts mit seiner Eingabe zu tun hat.
    expect('p_supersedes_id' in good.prepared.args).toBe(false)
  })
})
