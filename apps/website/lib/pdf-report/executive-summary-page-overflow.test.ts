import { describe, expect, it, vi } from 'vitest'

import { EXECUTIVE_SUMMARY_CASES } from '@/test/executive-summary-cases'
import { executiveSummaryPages } from '@/test/executive-summary-render'

/* Positivkontrolle des Ein-Seiten-Tests: mit verdreifachten Speicher-Sätzen muss der Worst-Case überlaufen. */
vi.mock('./executive-summary-copy', async (importOriginal) => {
  const original = await importOriginal<typeof import('./executive-summary-copy')>()
  return {
    ...original,
    executiveSummaryCopy: (summary: Parameters<typeof original.executiveSummaryCopy>[0]) => {
      const copy = original.executiveSummaryCopy(summary)
      return {
        ...copy,
        storage: copy.storage && [...copy.storage, ...copy.storage, ...copy.storage],
      }
    },
  }
})

describe('Vorderseite: Positivkontrolle der Seitenmessung', () => {
  it('schlägt an, wenn die Speicher-Sätze verdreifacht sind', async () => {
    expect(await executiveSummaryPages(EXECUTIVE_SUMMARY_CASES['Worst Case']!)).toBeGreaterThan(
      1,
    )
  })
})
