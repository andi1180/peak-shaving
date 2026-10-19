import {
  DRAFT_PROVENANCE_KEY,
  readDraftProvenance,
  setDraftField,
  type DraftProvenanceEntry,
  type DraftValue,
} from '@/lib/project-chat/draft'

import type { DraftValueSource } from '@/lib/project-chat/tools'
import {
  INVOICE_DRAFT_FIELD_KEYS,
  draftFieldFor,
  type InvoiceDraftValue,
} from './invoice-extractions'

/** Seiteneintrag der gespeicherten Wahl je widersprüchlichem Rechnungsfeld (s. `invoice-field-choices.ts`). */
export const INVOICE_FIELD_CHOICES_KEY = '_invoiceFieldChoices'

/** Ein Rechnungswert; eine gespeicherte Wahl bringt eigene Herkunft und Notiz mit. */
export type InvoiceDraftWrite = InvoiceDraftValue & { source?: DraftValueSource; note?: string }

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

/** Trägt dieses Entwurfsfeld den Rechnungs-Vermerk? Nur `origin: 'invoice'` zählt. */
export function draftValueFromInvoice(draft: Record<string, unknown>, field: string): boolean {
  return readDraftProvenance(draft)[field]?.origin === 'invoice'
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
 * Jeder Schreibweg der Rechnungswerte (Lesen, Entfernen, Preisbasis): die aus Rechnungen stammenden
 * Felder werden durch das Ergebnis über ALLE gelesenen Rechnungen ersetzt; sagt keine mehr etwas
 * dazu oder widersprechen sie sich, wird das Feld entfernt. Handeingaben bleiben unberührt.
 */
export function replaceInvoiceDraftFields(
  draft: Record<string, unknown>,
  values: readonly InvoiceDraftWrite[],
  now: Date,
  legacyInvoiceDraft: boolean,
): Record<string, unknown> {
  const byHand = (field: string) => invoiceFieldIsByHand(draft, field, legacyInvoiceDraft)

  let next = draft
  for (const { field, value, source, note } of values) {
    if (byHand(field)) continue
    next =
      source === undefined
        ? setInvoiceDraftField(next, field, value, now)
        : setDraftField(next, field, value, source, note, now, 'invoice')
  }

  const provided = new Set(values.map(({ field }) => field))
  const stale = INVOICE_DRAFT_FIELD_KEYS.map(draftFieldFor).filter(
    (field) => field in next && !provided.has(field) && !byHand(field),
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

/** Ist dieses Feld eine Handeingabe (vorhanden, aber nicht aus Rechnungen)? */
export function invoiceFieldIsByHand(
  draft: Record<string, unknown>,
  field: string,
  legacyInvoiceDraft: boolean,
): boolean {
  return field in draft && !isInvoiceDerived(readDraftProvenance(draft)[field], legacyInvoiceDraft)
}

/** Unterscheiden sich die Rechnungsfelder samt Herkunft (ohne Zeitstempel) zwischen zwei Entwürfen? */
export function invoiceDraftFieldsDiffer(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): boolean {
  const fieldState = (draft: Record<string, unknown>, field: string) => {
    const entry = readDraftProvenance(draft)[field]
    return JSON.stringify([
      field in draft ? draft[field] : null,
      entry ? [entry.source, entry.note ?? null, entry.origin ?? null] : null,
    ])
  }
  const choices = (draft: Record<string, unknown>) =>
    JSON.stringify(draft[INVOICE_FIELD_CHOICES_KEY] ?? null)
  return (
    choices(before) !== choices(after) ||
    INVOICE_DRAFT_FIELD_KEYS.map(draftFieldFor).some(
      (field) => fieldState(before, field) !== fieldState(after, field),
    )
  )
}
