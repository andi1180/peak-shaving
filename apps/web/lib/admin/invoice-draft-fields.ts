import type { InvoiceMergeFieldKey } from 'shared'

import {
  DRAFT_PROVENANCE_KEY,
  readDraftProvenance,
  setDraftField,
  type DraftProvenanceEntry,
  type DraftValue,
} from '@/lib/project-chat/draft'

import {
  INVOICE_DRAFT_FIELD_KEYS,
  draftFieldFor,
  type InvoiceDraftValue,
} from './invoice-extractions'

/**
 * Übergang für Entwürfe von vor dem Rechnungs-Vermerk: ein `measured`-Wert ohne Notiz, der vor
 * diesem Zeitpunkt geschrieben wurde, gilt als übernommen — nur an Zählpunkten mit bereits gelesenen
 * Rechnungen (sonst ist er eine Handeingabe).
 */
export const INVOICE_ORIGIN_LEGACY_BEFORE = '2026-09-30T06:50:00.000Z'

function isInvoiceDerived(
  entry: DraftProvenanceEntry | undefined,
  legacyInvoiceDraft: boolean,
): boolean {
  if (entry === undefined) return false
  if (entry.origin === 'invoice') return true
  return (
    legacyInvoiceDraft &&
    entry.source === 'measured' &&
    entry.note === undefined &&
    entry.at !== '' &&
    entry.at < INVOICE_ORIGIN_LEGACY_BEFORE
  )
}

/** Ein Wert aus der Rechnungs-Zusammenführung — `measured`, ohne Notiz, mit Rechnungs-Vermerk. */
export function setInvoiceDraftField(
  draft: Record<string, unknown>,
  field: string,
  value: DraftValue,
  now: Date,
): Record<string, unknown> {
  return setDraftField(draft, field, value, 'measured', undefined, now, 'invoice')
}

/**
 * (Erneutes) Lesen: die aus Rechnungen stammenden Felder werden durch das Ergebnis über ALLE
 * gelesenen Rechnungen ersetzt; sagt keine mehr etwas dazu, wird das Feld entfernt. Handeingaben
 * bleiben unberührt, ein widersprüchliches Feld behält seinen Wert (so sagt es die Station zu).
 */
export function replaceInvoiceDraftFields(
  draft: Record<string, unknown>,
  values: readonly InvoiceDraftValue[],
  conflicts: readonly InvoiceMergeFieldKey[],
  now: Date,
  legacyInvoiceDraft: boolean,
): Record<string, unknown> {
  const provenance = readDraftProvenance(draft)
  const byHand = (field: string) =>
    field in draft && !isInvoiceDerived(provenance[field], legacyInvoiceDraft)

  let next = draft
  for (const { field, value } of values) {
    if (byHand(field)) continue
    next = setInvoiceDraftField(next, field, value, now)
  }

  const provided = new Set(values.map(({ field }) => field))
  const conflicting = new Set(conflicts.map(draftFieldFor))
  const stale = INVOICE_DRAFT_FIELD_KEYS.map(draftFieldFor).filter(
    (field) => field in next && !provided.has(field) && !conflicting.has(field) && !byHand(field),
  )
  if (stale.length === 0) return next

  const cleared: Record<string, unknown> = { ...next }
  const clearedProvenance = readDraftProvenance(next)
  for (const field of stale) {
    delete cleared[field]
    delete clearedProvenance[field]
  }
  if (Object.keys(clearedProvenance).length > 0) cleared[DRAFT_PROVENANCE_KEY] = clearedProvenance
  else delete cleared[DRAFT_PROVENANCE_KEY]
  return cleared
}
