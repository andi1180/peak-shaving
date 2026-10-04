import { describe, expect, it } from 'vitest'

import { EXECUTIVE_SUMMARY_CASES } from '@/test/executive-summary-cases'
import { executiveSummaryPages } from '@/test/executive-summary-render'

describe('Vorderseite „Auf einen Blick"', () => {
  it.each(Object.keys(EXECUTIVE_SUMMARY_CASES))('%s: belegt genau eine Seite', async (name) => {
    expect(await executiveSummaryPages(EXECUTIVE_SUMMARY_CASES[name]!)).toBe(1)
  })
})
