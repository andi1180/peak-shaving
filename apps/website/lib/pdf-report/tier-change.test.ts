import { describe, expect, it } from 'vitest'
import type { NetworkTierSummary } from 'shared'

import { EXECUTIVE_SUMMARY_CASES } from '@/test/executive-summary-cases'
import { lineCount } from '@/test/pdf-text-lines'
import { buildExecutiveSummary, type ExecutiveSummary } from './executive-summary'
import { executiveSummaryCopy } from './executive-summary-copy'
import { EXEC_DONUT_LEGEND_LABEL_WIDTH, execDonutOf } from './executive-summary-donut'
import { EXEC_SLOTS } from './executive-summary-layout'
import { buildSavingsDonut } from './savings-donut'
import { tierChangesWithStorage } from './tier-change'

const tier = (t: 1 | 2): NetworkTierSummary => ({
  tier: t,
  thresholdHours: 2500,
  usageHours: 2400,
  costTier1Eur: 0,
  costTier2Eur: 0,
  correctionEur: 0,
})

describe('tierChangesWithStorage', () => {
  it('Stufe 1 → 2 wahr, 1 → 1 falsch, ohne Stufen-Daten falsch', () => {
    expect(tierChangesWithStorage({ networkTier: tier(1) }, { networkTier: tier(2) })).toBe(true)
    expect(tierChangesWithStorage({ networkTier: tier(1) }, { networkTier: tier(1) })).toBe(false)
    expect(tierChangesWithStorage({}, { networkTier: tier(2) })).toBe(false)
    expect(tierChangesWithStorage({ networkTier: tier(1) }, undefined)).toBe(false)
  })
})

describe('Beschriftung des Leistungs-Anteils', () => {
  const base = buildExecutiveSummary(EXECUTIVE_SUMMARY_CASES['jahr (Müldür)']!)!
  const withTierChange = (tierChange: boolean): ExecutiveSummary => ({
    ...base,
    hasLeistungspreis: true,
    storage: { ...base.storage!, tierChange },
  })

  it('mit Stufenwechsel: neue Legende und neuer Balkentext', () => {
    const s = withTierChange(true)
    const label = execDonutOf(s)!.segments.at(-1)!.label
    expect(label).toBe('Weniger Spitzen und günstigere Netzstufe')
    // Bestehende Legendenregel: höchstens zwei Zeilen in der Legendenbreite des Rings.
    expect(
      lineCount(label, 8, EXEC_DONUT_LEGEND_LABEL_WIDTH(EXEC_SLOTS.donut.width)),
    ).toBeLessThanOrEqual(2)
    expect(executiveSummaryCopy(s).waysSentence.replace(/\u00a0/g, ' ')).toContain(
      '— ohne Netzentgelt aus Leistung und Stufe; dessen Einsparung (bis zu € 1.160) kommt hinzu.',
    )
    expect(
      buildSavingsDonut({ switchEur: 1, controlEur: 1, peakEur: 1 }, true)!.segments[2]!.label,
    ).toBe('Kappung und Stufenwechsel (Obergrenze)')
  })

  it('ohne Stufenwechsel: Texte wie bisher', () => {
    const s = withTierChange(false)
    expect(execDonutOf(s)!.segments.at(-1)!.label).toBe('Weniger Spitzen (Höchstwert)')
    expect(executiveSummaryCopy(s).waysSentence.replace(/\u00a0/g, ' ')).toContain(
      '— ohne Spitzengebühr; deren Einsparung (bis zu € 1.160) kommt hinzu.',
    )
    expect(buildSavingsDonut({ switchEur: 1, controlEur: 1, peakEur: 1 })!.segments[2]!.label).toBe(
      'Spitzenkappung (Obergrenze)',
    )
  })
})
