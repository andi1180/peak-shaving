import { describe, expect, it, vi } from 'vitest'

import { EXECUTIVE_SUMMARY_CASES } from '@/test/executive-summary-cases'
import { executiveSummaryPages } from '@/test/executive-summary-render'

/* Positivkontrolle des Ein-Seiten-Tests: mit verdreifachtem Kastentext muss die Seite überlaufen. */
vi.mock('./executive-summary-copy', async (importOriginal) => {
  const original = await importOriginal<typeof import('./executive-summary-copy')>()
  return {
    ...original,
    executiveSummaryCopy: (summary: Parameters<typeof original.executiveSummaryCopy>[0]) => {
      const copy = original.executiveSummaryCopy(summary)
      return { ...copy, confidence: [...copy.confidence, ...copy.confidence, ...copy.confidence] }
    },
  }
})

describe('Vorderseite: Positivkontrolle der Seitenmessung', () => {
  it('schlägt an, wenn der Kastentext verdreifacht ist', async () => {
    expect(await executiveSummaryPages(EXECUTIVE_SUMMARY_CASES['jahr (Müldür)']!)).toBeGreaterThan(
      1,
    )
  })
})
