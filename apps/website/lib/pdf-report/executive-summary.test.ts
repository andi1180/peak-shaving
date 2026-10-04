import { EXISTING_BATTERY_ID } from 'shared'
import { describe, expect, it } from 'vitest'

import { EXECUTIVE_SUMMARY_CASES as CASES, muster, variant } from '@/test/executive-summary-cases'
import { dailyPeaksOf } from './daily-peaks'
import { buildExecutiveSummary, type ExecutiveSummary } from './executive-summary'
import { executiveSummaryCopy } from './executive-summary-copy'
import { headlineStorageOf } from './headline-storage'
import { recommendedEntryOf } from './summary'

const FORBIDDEN =
  /Kappung|Amortisation|Ladesteuerung|Leistungspreis|Dispatch|Hindsight|Lastspitzenkappung/i

const summaries = Object.fromEntries(
  Object.entries(CASES).map(([name, input]) => [name, buildExecutiveSummary(input)!]),
) as Record<string, ExecutiveSummary>

describe('buildExecutiveSummary', () => {
  it('Müldür-Jahr: Stufen, Rückzahlzeit und Netto aus den bestehenden Zahlen', () => {
    const s = summaries['jahr (Müldür)']!
    expect(s.variant).toBe('tarif-und-speicher')
    expect(s.header.basis).toBe('projected')
    expect(s.stages.map((stage) => stage.savingPerYearEur)).toEqual([8025, 2125])
    expect(s.header.savingPerYearEur).toBe(10150)
    expect(s.header.savingPercent).toBeUndefined()
    expect(s.header.customerName).toBe('Muster Gastro GmbH')
    expect(s.storage).toMatchObject({
      loadShiftEur: 965,
      peakEur: 1160,
      netSavingOverHorizonEur: 12700,
    })
    expect(s.storage!.amortizationYears.toFixed(1)).toBe('4.0')
    expect(s.storage!.breakEven).toHaveLength(11)
    expect(s.ways.map((w) => [w.id, w.isRecommended])).toEqual([
      ['today', false],
      ['spot', false],
      ['spot-storage', true],
    ])
    expect(s.load.capSegments!.length).toBeGreaterThan(0)
  })

  it.each(Object.keys(CASES))('%s: Stufen summieren sich, Speicher = Hauptzahl', (name) => {
    const s = summaries[name]!
    const input = CASES[name]!
    expect(s.header.savingPerYearEur).toBe(
      s.stages.reduce((sum, st) => sum + st.savingPerYearEur, 0),
    )
    if (s.storage) {
      const headline = headlineStorageOf(input.analysis, recommendedEntryOf(input.analysis)!, input)
      expect(s.storage.savingPerYearEur).toBe(headline.savingPerYearEur)
      expect(s.stages[1]!.savingPerYearEur).toBe(headline.savingPerYearEur)
    }
  })

  it('Varianten: Stufen und Speicherblock je Fall', () => {
    expect(summaries['nur-tarif (Katalog leer)']).toMatchObject({
      variant: 'nur-tarif',
      storage: null,
    })
    expect(summaries['nur-tarif (Katalog leer)']!.stages).toEqual([
      { id: 'ohne-anschaffung', savingPerYearEur: 8025 },
    ])
    const noPay = summaries['speicher-lohnt-nicht']!
    expect(noPay).toMatchObject({ variant: 'speicher-lohnt-nicht', storage: null })
    expect(noPay.storageVerdict!.judgement).toContain('rechnet er sich damit nicht')
    const subsidy = summaries['mit Förderung']!.storage!
    expect(subsidy.hasSubsidy).toBe(true)
    expect(subsidy.amortizationYears).toBeCloseTo(subsidy.investment.netEur / 2125, 6)
    const noPeak = summaries['ohne Spitzenersparnis']!
    expect(noPeak.storage).toMatchObject({ peakEur: 0, upperBound: false, savingPerYearEur: 965 })
    expect(noPeak.load.capSegments).toBeNull()
    expect(summaries['volles Jahr (konstruiert)']!.header.basis).toBe('annual')
  })

  it('gibt es nicht mit Bestandsspeicher: wohin dessen Spitzenersparnis gehört, ist offen', () => {
    const existing = variant(({ analysis }) => {
      const primary = analysis.perBattery[0]!
      analysis.existingBatteryAnalysis = {
        entry: { ...primary, battery: { ...primary.battery, id: EXISTING_BATTERY_ID } },
      } as never
      analysis.annualScenario!.device = { batteryId: EXISTING_BATTERY_ID, name: 'Bestand' }
    })
    expect(buildExecutiveSummary(existing)).toBeNull()
  })

  it('gibt es nicht ohne Jahresbasis, ohne bekannten Tarif und für Privat', () => {
    expect(buildExecutiveSummary(muster(false))).toBeNull()
    expect(buildExecutiveSummary({ ...muster(true), priceDisplay: 'gross' })).toBeNull()
    const unknown = variant(({ analysis: a }) => {
      if (a.tariffOptimization?.computable === true)
        a.tariffOptimization.monthlyComparison!.currentTariffEur = null
    })
    expect(buildExecutiveSummary(unknown)).toBeNull()
  })
})

describe('executiveSummaryCopy', () => {
  const copies = Object.entries(summaries).map(
    ([name, s]) => [name, s, JSON.stringify(executiveSummaryCopy(s))] as const,
  )

  it('kein Fachbegriff in den Kundentexten (Positivkontrolle: der Test schlägt an)', () => {
    expect(FORBIDDEN.test('Der Speicher übernimmt die Ladesteuerung.')).toBe(true)
    for (const [name, , text] of copies) expect(text.match(FORBIDDEN), name).toBeNull()
  })

  it('kennzeichnet Obergrenze und Hochrechnung', () => {
    for (const [name, s, text] of copies) {
      if (s.storage?.upperBound) expect(text, name).toContain('frühestens')
      if (s.header.basis === 'projected') expect(text, name).toContain('hochgerechnet')
    }
  })
})

describe('dailyPeaksOf', () => {
  it('nimmt das Maximum je lokalem Kalendertag', () => {
    const peaks = dailyPeaksOf({
      timezoneMeta: 'Europe/Vienna',
      readings: [
        { ts: '2026-03-27T22:45:00Z', gridPowerKw: 9 }, // 27.03. 23:45 lokal
        { ts: '2026-03-27T23:00:00Z', gridPowerKw: 4 }, // 28.03. 00:00 lokal
        { ts: '2026-03-28T11:00:00Z', gridPowerKw: 7 },
      ],
    } as never)
    expect(peaks).toEqual([
      { day: '2026-03-27', peakKw: 9 },
      { day: '2026-03-28', peakKw: 7 },
    ])
  })

  it('deckt im Müldür-Lastgang jeden Tag ab und trifft die Gesamtspitze', () => {
    const { loadProfile } = muster(false)
    const peaks = dailyPeaksOf(loadProfile)
    expect(Math.max(...peaks.map((p) => p.peakKw))).toBe(
      Math.max(...loadProfile.readings.map((r) => r.gridPowerKw)),
    )
    expect(peaks.length).toBeGreaterThanOrEqual(157)
  })
})
