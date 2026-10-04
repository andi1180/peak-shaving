import { describe, expect, it, vi } from 'vitest'

import { EXECUTIVE_SUMMARY_CASES } from '@/test/executive-summary-cases'
import { executiveSummaryPages } from '@/test/executive-summary-render'

/* Ohne Tagesspitzen entfällt der Lastgang-Block; die Seite bleibt eine Seite. */
vi.mock('./daily-peaks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./daily-peaks')>()),
  dailyPeaksOf: () => [],
}))

describe('Vorderseite ohne Lastgangdaten', () => {
  it.each(['jahr (Müldür)', 'Worst Case'])('%s: belegt genau eine Seite', async (name) => {
    expect(await executiveSummaryPages(EXECUTIVE_SUMMARY_CASES[name]!)).toBe(1)
  })
})
