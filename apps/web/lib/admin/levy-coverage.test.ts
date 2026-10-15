import { levyCoverageStatus } from 'shared'
import { describe, expect, it } from 'vitest'

import { levyCoverageNotices } from './levy-coverage'

describe('levyCoverageNotices — Warnbalken Abgabensätze', () => {
  it('warn ab 01.12. nennt Folgejahr und alle betroffenen Länder in einem Hinweis', () => {
    const notices = levyCoverageNotices(levyCoverageStatus(['AT', 'DE'], '2026-12-01'), '2026-12-01')
    expect(notices).toEqual([
      {
        tone: 'warn',
        text:
          'Abgabensätze für 2027 fehlen für Österreich, Deutschland. Ab 01.01.2027 werden ' +
          'Tarifvergleiche verweigert. Jahrespflege nötig (Projektdoc Jahrespflege_Tarifsaetze.md).',
      },
    ])
  })

  it('expired nennt Land und Enddatum je Land', () => {
    const notices = levyCoverageNotices(levyCoverageStatus(['DE'], '2027-01-01'), '2027-01-01')
    expect(notices).toEqual([
      {
        tone: 'expired',
        text: 'Abgabensätze für Deutschland nur bis 31.12.2026 hinterlegt. Vergleiche ab diesem Datum werden verweigert. Sätze nachtragen.',
      },
    ])
  })

  it('ok ergibt keinen Hinweis', () => {
    expect(levyCoverageNotices(levyCoverageStatus(['AT', 'DE'], '2026-11-30'), '2026-11-30')).toEqual([])
  })
})
