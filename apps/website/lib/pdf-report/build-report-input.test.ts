import { describe, expect, it } from 'vitest'
import type { AnalysisResult, LoadProfile } from 'shared'

import { buildBasisChapter } from './basis'
import {
  REPORT_UNAVAILABLE,
  buildReportInputFromRenderRequest,
  readRenderRequest,
} from './build-report-input'
import { TARIFF_SOURCE_UNTRACKED } from './types'

/**
 * D12 Abschluss — die zwei Stellen, an denen dieser Weg eigene Entscheidungen trifft: was aus einer
 * Übergabe als Dokument-Eingang entsteht, und was passiert, wenn es keine gibt.
 */

const ANALYSIS: AnalysisResult = {
  current: {
    annualPeakKw: 48,
    monthlyPeaksKw: [48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48],
    billedKw: 48,
    leistungspreisCostPerYear: 3980.16,
  },
  peaks: { top: [{ ts: '2025-03-17T06:00:00.000Z', kw: 48 }], distribution: { byHour: [], byWeekday: [], byMonth: [] } },
  perBattery: [],
  recommendation: { batteryId: 'keiner', rationale: 'leerer Katalog' },
  assumptions: {
    roundTripEfficiency: 0.9,
    horizonYears: 10,
    energyPriceCtPerKwh: 24.5,
    einspeiseverguetungCtPerKwh: 7.2,
    billingModel: 'monthly_max_sum',
  },
  tariffOptimization: { computable: true },
  dataQuality: {
    coveredDays: 365,
    coveredMonths: 12,
    gapsInterpolated: 0,
    largestGapSlots: 0,
    warnings: [],
  },
}

const LOAD_PROFILE: LoadProfile = {
  readings: [
    { ts: '2025-03-17T00:00:00.000Z', gridPowerKw: 9 },
    { ts: '2025-12-30T23:45:00.000Z', gridPowerKw: 11 },
  ],
  intervalMinutes: 15,
  timezoneMeta: 'Europe/Vienna',
  source: 'net_signed',
}

/**
 * ⚠ DER STICHTAG LIEGT IM ZEITRAUM DES LASTGANGS. `tariffVintageNote` sagt NUR dann etwas, wenn der
 * ausgewertete Zeitraum ins laufende Kalenderjahr reicht — mit einem Stichtag im Folgejahr wäre das
 * Feld immer `null`, und die Prüfung der zwei Fassungen liefe ins Leere.
 */
const NOW = new Date('2025-09-16T09:00:00Z')

/** Eine vollständige Antwort des Wrappers, so wie supabase-js sie liefert: eine Zeile in einer Liste. */
const ROW = {
  analysis_result: ANALYSIS,
  load_profile: LOAD_PROFILE,
  report_input_meta: {
    customerLabel: 'Bäckerei Gruber GmbH',
    netzbetreiber: 'wiener_netze',
    supplierBaseFeeEurPerMonth: 3.5,
    meteringPointId: '0f9f0c2e-0000-4000-8000-000000000001',
    projectId: '0f9f0c2e-0000-4000-8000-000000000002',
  },
}

describe('buildReportInputFromRenderRequest', () => {
  it('baut aus einer vollständigen Übergabe den Dokument-Eingang', () => {
    const readout = readRenderRequest({ data: [ROW], error: null })
    expect(readout.status).toBe('ok')
    if (readout.status !== 'ok') return

    const input = buildReportInputFromRenderRequest(readout.request, NOW)

    expect(input.title).toBe('Wirtschaftlichkeitsanalyse Batteriespeicher & Ladeoptimierung')
    expect(input.subtitle).toBe('Auf Basis Ihres Viertelstunden-Lastgangs')
    expect(input.period).toBe('17.03.2025 – 31.12.2025')
    expect(input.printedAt).toBe('16.09.2025')
    expect(input.loadProfile).toBe(LOAD_PROFILE)

    /* NUR die Firma — Name und Adresse werden auf diesem Weg nicht erhoben. */
    expect(input.customer).toEqual({ company: 'Bäckerei Gruber GmbH' })

    /* Die zwei Festlegungen dieses Weges: keine behauptete Herkunft, keine geschätzte PV. */
    expect(input.tariffSource).toBe(TARIFF_SOURCE_UNTRACKED)
    expect(input.estimatedPv).toBeUndefined()

    /* D9-Vorgriff: der Netzbetreiber reist als Angabe mit und steht im Tarifquellen-Satz. */
    expect(input.netzbetreiber).toBe('wiener_netze')
    expect(buildBasisChapter(input).tariffSource).toContain('(Netzbetreiber: Wiener Netze)')

    /* Der Preisstand-Satz nennt die Grundgebühr, weil die Übergabe eine trägt. */
    expect(input.tariffVintage).toContain('Arbeitspreis und Grundgebühr basieren')

    /* Verengt auf die sieben gelesenen Felder — `peaks` reist NICHT mit. */
    expect(Object.keys(input.analysis).sort()).toEqual([
      'assumptions',
      'current',
      'dataQuality',
      'existingBatteryAnalysis',
      'perBattery',
      'recommendation',
      'tariffOptimization',
    ])
    expect('peaks' in input.analysis).toBe(false)
  })

  it('lässt die Grundgebühr ohne Angabe aus dem Preisstand-Satz weg', () => {
    const readout = readRenderRequest({
      data: [{ ...ROW, report_input_meta: { customerLabel: null, supplierBaseFeeEurPerMonth: null } }],
      error: null,
    })
    if (readout.status !== 'ok') throw new Error('Übergabe sollte lesbar sein')

    const input = buildReportInputFromRenderRequest(readout.request, NOW)

    expect(input.tariffVintage).toContain('Der Arbeitspreis basiert')
    /* Ohne Bezeichnung gar kein Kundenblock statt eines leeren Feldes auf dem Deckblatt. */
    expect(input.customer).toBeUndefined()
  })

  /**
   * ⚠ EINE UNBEKANNTE KENNUNG IST DERSELBE FALL WIE „keine Angabe". Die Schreibseite prüft bewusst
   * nicht gegen eine feste Liste; ohne diese Prüfung stünde `linz_netz` als Name auf dem Blatt.
   */
  it('lässt einen unbekannten Netzbetreiber weg und den Satz damit unverändert', () => {
    const readout = readRenderRequest({
      data: [{ ...ROW, report_input_meta: { ...ROW.report_input_meta, netzbetreiber: 'linz_netz' } }],
      error: null,
    })
    if (readout.status !== 'ok') throw new Error('Übergabe sollte lesbar sein')

    const input = buildReportInputFromRenderRequest(readout.request, NOW)

    expect(input.netzbetreiber).toBeUndefined()
    expect(buildBasisChapter(input).tariffSource).not.toContain('Netzbetreiber:')
    expect(buildBasisChapter(input).tariffSource).not.toContain('linz_netz')
  })
})

describe('readRenderRequest — eine Meldung für jeden Fehlschlag', () => {
  /**
   * ⚠ DER KERN DIESES SCHRITTS: unbekannte Kennung, abgelaufene Kennung und ein Lesefehler führen
   * zu DEMSELBEN Zustand — und damit zu derselben Anzeige. Ein eigener Zustand für „gab es, ist
   * abgelaufen" machte das Raten von Kennungen zu einer Suche mit Rückmeldung.
   */
  it.each([
    ['unbekannt oder abgelaufen (leere Antwort)', { data: [], error: null }],
    ['keine Zeile', { data: null, error: null }],
    ['Lesefehler, z. B. unpassend geformte Kennung', { data: null, error: { code: '22P02' } }],
    ['Zeile ohne Lastgang', { data: [{ ...ROW, load_profile: {} }], error: null }],
  ])('%s → unavailable', (_name, result) => {
    expect(readRenderRequest(result)).toEqual({ status: 'unavailable' })
  })

  it('hat genau EINEN Text für diesen Zustand', () => {
    expect(REPORT_UNAVAILABLE).toContain('nicht verfügbar')
    /* Weder „unbekannt" noch „abgelaufen" als unterscheidende Auskunft über eine fremde Kennung. */
    expect(REPORT_UNAVAILABLE).not.toContain('unbekannt')
  })
})
