import type { InvoiceFieldConflict } from '@/lib/admin/invoice-field-choices'

/** Arbeitspreis mit Mittelwert, Vorauswahl = Mittelwert, noch nichts gewählt. */
export const OPEN_WEIGHTED: InvoiceFieldConflict = {
  field: 'energyPriceCtPerKwh',
  label: 'Arbeitspreis',
  options: [
    {
      kind: 'document',
      documentId: 'doc-a',
      filename: 'rechnung-2025.pdf',
      periodFrom: '2025-01-01',
      periodTo: '2025-06-30',
      periodAssumed: false,
      value: 12.3456,
    },
    {
      kind: 'document',
      documentId: 'doc-b',
      filename: 'rechnung-2026.pdf',
      periodFrom: '2025-07-01',
      periodTo: '2025-12-31',
      periodAssumed: true,
      value: 14.1,
    },
    {
      kind: 'weighted',
      value: 13.2049,
      basis: 'load_profile',
      parts: [
        {
          documentId: 'doc-a',
          periodFrom: '2025-01-01',
          periodTo: '2025-06-30',
          value: 12.3456,
          weight: 0.52,
        },
        {
          documentId: 'doc-b',
          periodFrom: '2025-07-01',
          periodTo: '2025-12-31',
          value: 14.1,
          weight: 0.48,
        },
      ],
    },
  ],
  preselected: { kind: 'weighted' },
  current: null,
}

/** Leistungspreis: kein Mittelwert möglich, Vorauswahl = zweite Rechnung. */
export const OPEN_NO_WEIGHTED: InvoiceFieldConflict = {
  field: 'leistungspreisEurPerKwYear',
  label: 'Leistungspreis',
  options: [
    {
      kind: 'document',
      documentId: 'doc-a',
      filename: 'rechnung-2025.pdf',
      periodFrom: '2025-01-01',
      periodTo: '2025-06-30',
      periodAssumed: false,
      value: 50,
    },
    {
      kind: 'document',
      documentId: 'doc-b',
      filename: 'rechnung-2026.pdf',
      periodFrom: null,
      periodTo: null,
      periodAssumed: false,
      value: 54,
    },
  ],
  weightedUnavailableReason: 'Für dieses Feld gibt es keinen gewichteten Mittelwert.',
  preselected: { kind: 'document', documentId: 'doc-b' },
  current: null,
}

/** Arbeitspreis, Rechnung doc-a gewählt. */
export const CHOSEN_DOCUMENT: InvoiceFieldConflict = {
  ...OPEN_WEIGHTED,
  current: { kind: 'document', documentId: 'doc-a' },
}
