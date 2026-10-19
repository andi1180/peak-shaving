import { describe, expect, it } from 'vitest'
import { emptyInvoiceExtraction } from 'shared'

import type { StoredInvoiceExtraction } from './invoice-extractions'
import {
  invoicePeriodFlags,
  invoicePeriodOverrideError,
  localDateIso,
} from './invoice-period-flags'

const TODAY = '2026-10-19'

function entry(
  id: string,
  from: string | null,
  to: string | null,
  extra: Partial<StoredInvoiceExtraction> & { assumed?: boolean } = {},
): StoredInvoiceExtraction {
  const { assumed, ...rest } = extra
  return {
    documentId: id,
    filename: `${id}.pdf`,
    extraction: {
      ...emptyInvoiceExtraction(),
      billingPeriodFrom: from,
      billingPeriodTo: to,
      billingPeriodAssumed: assumed ?? (from === null ? null : false),
    },
    ...rest,
  }
}

const kinds = (entries: StoredInvoiceExtraction[], id: string) =>
  invoicePeriodFlags(entries, TODAY)
    .get(id)!
    .map((f) => f.kind)

describe('Hinweise zum Rechnungszeitraum', () => {
  it('je Fall genau der passende Hinweis', () => {
    const entries = [
      entry('ok', '2022-01-01', '2022-01-31'),
      entry('missing', null, null),
      entry('assumed', '2024-10-20', '2025-10-19', { assumed: true }),
      entry('future', '2026-10-01', '2026-10-31'),
      entry('long', '2023-01-01', '2024-03-31'),
    ]
    expect(kinds(entries, 'ok')).toEqual([])
    expect(kinds(entries, 'missing')).toEqual(['missing'])
    expect(kinds(entries, 'assumed')).toEqual(['assumed'])
    expect(kinds(entries, 'future')).toEqual(['future_end'])
    expect(kinds(entries, 'long')).toEqual(['too_long'])
  })

  it('Überlappung nennt die andere Rechnung; ein gemeinsamer Tag zählt wie in #520/#524', () => {
    const flags = invoicePeriodFlags(
      [
        entry('a', '2025-01-01', '2025-02-01'),
        entry('b', '2025-02-01', '2025-02-28'),
        entry('c', '2025-03-01', '2025-03-31'),
      ],
      TODAY,
    )
    expect(flags.get('a')).toEqual([{ kind: 'overlap', documentId: 'b', filename: 'b.pdf' }])
    expect(flags.get('c')).toEqual([])
  })

  it('wirkt am korrigierten Zeitraum: die Korrektur löst Schätzung und Überlappung auf', () => {
    const corrected = entry('a', '2024-03-01', '2025-02-28', {
      assumed: true,
      billingPeriodOverride: {
        from: '2025-01-01',
        to: '2025-01-31',
        at: '2026-10-19T08:00:00.000Z',
      },
    })
    expect(kinds([corrected, entry('b', '2025-02-01', '2025-02-28')], 'a')).toEqual([])
  })
})

describe('Prüfung einer Korrektur', () => {
  it('gültig, sonst ein Satz je Grund', () => {
    expect(invoicePeriodOverrideError('2025-01-01', '2025-12-31', TODAY)).toBeNull()
    expect(invoicePeriodOverrideError('2025-02-01', '2025-01-01', TODAY)).toContain('nach dem Ende')
    expect(invoicePeriodOverrideError('2024-01-01', '2025-03-01', TODAY)).toContain('400 Tage')
    expect(invoicePeriodOverrideError('2026-10-01', '2026-10-20', TODAY)).toContain('Zukunft')
    expect(invoicePeriodOverrideError('2025-02-30', '2025-03-31', TODAY)).toContain('gültige')
  })

  it('„heute" ist der Kalendertag der Ortszeit', () => {
    expect(localDateIso(new Date('2026-10-18T22:30:00Z'), 'Europe/Vienna')).toBe('2026-10-19')
  })
})
