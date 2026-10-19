import type { DailyConsumption } from 'extractors'
import {
  INVOICE_MERGE_FIELD_KEYS,
  INVOICE_MERGE_FIELD_LABELS,
  NETZBETREIBER_IDS,
  invoiceFieldValuesByDocument,
  minBillableKwContradicted,
  type InvoiceExtraction,
  type InvoiceMergeFieldKey,
} from 'shared'

import {
  INVOICE_FIELD_CHOICES_KEY,
  replaceInvoiceDraftFields,
  type InvoiceDraftWrite,
} from './invoice-draft-fields'
import {
  draftFieldFor,
  foldStoredInvoices,
  invoiceDraftValueFor,
  nettedInvoiceExtractions,
  readStoredInvoiceExtractions,
  withInvoicePriceBasis,
  withStoredInvoiceExtractions,
  type KnownOperatorIds,
  type StoredInvoiceExtraction,
} from './invoice-extractions'
import type { TieredDemandInfo } from './invoice-tiered-demand'

/**
 * Auswahl je widersprüchlichem Rechnungsfeld. Ein widersprüchliches Feld bleibt leer, bis eine Wahl
 * gespeichert ist; `preselected` ist nur ein Vorschlag und wird nie ohne Wahl geschrieben.
 */

/** Nur bei diesen Feldern ist ein gewichteter Mittelwert fachlich sinnvoll. */
export const WEIGHTABLE_INVOICE_FIELDS = [
  'energyPriceCtPerKwh',
  'energyPriceNightCtPerKwh',
  'einspeiseverguetungCtPerKwh',
] as const satisfies readonly InvoiceMergeFieldKey[]

export type InvoiceFieldChoice = { kind: 'weighted' } | { kind: 'document'; documentId: string }
export type StoredInvoiceFieldChoice = InvoiceFieldChoice & { chosenAt: string }
export type InvoiceFieldChoices = Partial<Record<InvoiceMergeFieldKey, StoredInvoiceFieldChoice>>

/** Netzbezug je Ortstag (`readDailyConsumption`); `null` = kein Lastgang lesbar. */
export type ConsumptionByDay = { days: readonly DailyConsumption[]; intervalMinutes: number }

export type WeightingBasis = 'load_profile' | 'days'

export type InvoiceFieldDocumentOption = {
  kind: 'document'
  documentId: string
  filename: string
  periodFrom: string | null
  periodTo: string | null
  periodAssumed: boolean
  value: string | number | boolean
}

export type InvoiceFieldWeightedOption = {
  kind: 'weighted'
  value: number
  basis: WeightingBasis
  parts: {
    documentId: string
    periodFrom: string
    periodTo: string
    value: number
    weight: number
  }[]
}

export type InvoiceFieldConflict = {
  field: InvoiceMergeFieldKey
  label: string
  options: (InvoiceFieldDocumentOption | InvoiceFieldWeightedOption)[]
  /** Nur bei gewichtbaren Feldern ohne Mittelwert: warum er nicht angeboten wird. */
  weightedUnavailableReason?: string
  preselected: InvoiceFieldChoice
  current: InvoiceFieldChoice | null
}

/** Mindestabdeckung jedes beteiligten Rechnungszeitraums durch den Lastgang für die kWh-Gewichtung. */
const MIN_LOAD_PROFILE_COVERAGE = 0.9

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000
const DATE = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
const NUMBER = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 4 })

function isWeightable(field: InvoiceMergeFieldKey): boolean {
  return (WEIGHTABLE_INVOICE_FIELDS as readonly string[]).includes(field)
}

function isoDateOrNull(value: string | null): string | null {
  return value !== null && ISO_DATE.test(value) ? value : null
}

/** Tage von–bis, beide inklusive. */
function daysInclusive(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1
}

/** Liest die gespeicherten Wahlen defensiv — ein kaputter Eintrag zählt als nicht gewählt. */
export function readInvoiceFieldChoices(draft: Record<string, unknown>): InvoiceFieldChoices {
  const raw = draft[INVOICE_FIELD_CHOICES_KEY]
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const result: InvoiceFieldChoices = {}
  for (const key of INVOICE_MERGE_FIELD_KEYS) {
    const entry = (raw as Record<string, unknown>)[key] as Record<string, unknown> | undefined
    if (!entry || typeof entry !== 'object') continue
    const chosenAt = typeof entry.chosenAt === 'string' ? entry.chosenAt : ''
    if (entry.kind === 'weighted') result[key] = { kind: 'weighted', chosenAt }
    else if (entry.kind === 'document' && typeof entry.documentId === 'string') {
      result[key] = { kind: 'document', documentId: entry.documentId, chosenAt }
    }
  }
  return result
}

/** Setzt den Seiteneintrag; ohne Wahl verschwindet er (ein fehlender bleibt unberührt). */
export function withInvoiceFieldChoices(
  draft: Record<string, unknown>,
  choices: InvoiceFieldChoices,
): Record<string, unknown> {
  if (Object.keys(choices).length > 0) return { ...draft, [INVOICE_FIELD_CHOICES_KEY]: choices }
  if (!(INVOICE_FIELD_CHOICES_KEY in draft)) return draft
  const next = { ...draft }
  delete next[INVOICE_FIELD_CHOICES_KEY]
  return next
}

/** Braucht die nächste Zusammenführung den Lastgang (gespeicherte Mittelwert-Wahl)? */
export function invoiceChoicesNeedConsumption(draft: Record<string, unknown>): boolean {
  return Object.values(readInvoiceFieldChoices(draft)).some((choice) => choice?.kind === 'weighted')
}

type Candidate = { entry: StoredInvoiceExtraction; option: InvoiceFieldDocumentOption }

/** `extractions` sind die gefalteten Extraktionen (`nettedInvoiceExtractions`) — samt Zeitraum-Korrektur. */
function documentCandidates(
  field: InvoiceMergeFieldKey,
  entries: readonly StoredInvoiceExtraction[],
  extractions: readonly InvoiceExtraction[],
  knownOperatorIds: KnownOperatorIds,
): Candidate[] {
  const values = invoiceFieldValuesByDocument(extractions)
  const billedKw = extractions.map((extraction) => extraction.billedKw)
  const result: Candidate[] = []
  entries.forEach((entry, index) => {
    const raw = values[index]![field]
    const write = invoiceDraftValueFor(field, raw, knownOperatorIds)
    if (write === null) return
    // Eine Mindestleistung, unter der eine andere Rechnung abrechnet, ist keine (wie im Merge).
    if (field === 'minBillableKw' && minBillableKwContradicted(raw as number, billedKw)) return
    const { billingPeriodFrom, billingPeriodTo, billingPeriodAssumed } = extractions[index]!
    result.push({
      entry,
      option: {
        kind: 'document',
        documentId: entry.documentId,
        filename: entry.filename,
        periodFrom: isoDateOrNull(billingPeriodFrom),
        periodTo: isoDateOrNull(billingPeriodTo),
        periodAssumed: billingPeriodAssumed === true,
        value: write.value,
      },
    })
  })
  return result
}

function weightedOption(
  candidates: readonly Candidate[],
  consumption: ConsumptionByDay | null,
): { option: InvoiceFieldWeightedOption } | { reason: string } {
  const periods = candidates.map(({ option }) => ({
    documentId: option.documentId,
    from: option.periodFrom,
    to: option.periodTo,
    value: option.value as number,
  }))
  if (periods.some((p) => p.from === null || p.to === null || p.from > p.to)) {
    return { reason: 'Mindestens eine Rechnung nennt keinen vollständigen Abrechnungszeitraum.' }
  }
  const dated = periods as { documentId: string; from: string; to: string; value: number }[]
  const sorted = [...dated].sort((a, b) => (a.from < b.from ? -1 : 1))
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.from <= sorted[i - 1]!.to) {
      return { reason: 'Die Abrechnungszeiträume der Rechnungen überschneiden sich.' }
    }
  }

  const byDay = new Map((consumption?.days ?? []).map((d) => [d.day, d]))
  const perDay = consumption ? 1440 / consumption.intervalMinutes : 0
  const kwh = dated.map(({ from, to }) => {
    let sum = 0
    let intervals = 0
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY_MS) {
      const day = byDay.get(new Date(t).toISOString().slice(0, 10))
      if (day) {
        sum += day.importKwh
        intervals += day.intervals
      }
    }
    return { sum, coverage: perDay > 0 ? intervals / (daysInclusive(from, to) * perDay) : 0 }
  })
  const useLoadProfile =
    consumption !== null &&
    kwh.every((k) => k.coverage >= MIN_LOAD_PROFILE_COVERAGE) &&
    kwh.reduce((s, k) => s + k.sum, 0) > 0

  const parts = dated.map((p, i) => ({
    documentId: p.documentId,
    periodFrom: p.from,
    periodTo: p.to,
    value: p.value,
    weight: useLoadProfile ? kwh[i]!.sum : daysInclusive(p.from, p.to),
  }))
  const total = parts.reduce((s, p) => s + p.weight, 0)
  const mean = parts.reduce((s, p) => s + p.value * p.weight, 0) / total
  return {
    option: {
      kind: 'weighted',
      value: Math.round(mean * 10_000) / 10_000,
      basis: useLoadProfile ? 'load_profile' : 'days',
      parts,
    },
  }
}

function sameChoice(a: InvoiceFieldChoice, b: InvoiceFieldChoice): boolean {
  if (a.kind === 'weighted' || b.kind === 'weighted') return a.kind === b.kind
  return a.documentId === b.documentId
}

/** Wird diese Wahl für dieses widersprüchliche Feld gerade angeboten? */
export function invoiceFieldChoiceOffered(
  conflict: InvoiceFieldConflict,
  choice: InvoiceFieldChoice,
): boolean {
  return conflict.options.some((option) =>
    sameChoice(
      option.kind === 'weighted'
        ? { kind: 'weighted' }
        : { kind: 'document', documentId: option.documentId },
      choice,
    ),
  )
}

function conflictsOf(
  entries: readonly StoredInvoiceExtraction[],
  conflicts: readonly InvoiceMergeFieldKey[],
  stored: InvoiceFieldChoices,
  consumption: ConsumptionByDay | null,
  knownOperatorIds: KnownOperatorIds,
): InvoiceFieldConflict[] {
  const extractions = nettedInvoiceExtractions(entries)
  const result: InvoiceFieldConflict[] = []
  for (const field of conflicts) {
    const candidates = documentCandidates(field, entries, extractions, knownOperatorIds)
    if (candidates.length === 0) continue
    const options: InvoiceFieldConflict['options'] = candidates.map((c) => c.option)
    let weightedUnavailableReason: string | undefined
    if (isWeightable(field)) {
      const weighted = weightedOption(candidates, consumption)
      if ('option' in weighted) options.push(weighted.option)
      else weightedUnavailableReason = weighted.reason
    }

    const latest = candidates.reduce((best, c) =>
      (c.option.periodTo ?? '') > (best.option.periodTo ?? '') ? c : best,
    )
    const preselected: InvoiceFieldChoice = options.some((o) => o.kind === 'weighted')
      ? { kind: 'weighted' }
      : { kind: 'document', documentId: latest.option.documentId }

    const conflict: InvoiceFieldConflict = {
      field,
      label: INVOICE_MERGE_FIELD_LABELS[field],
      options,
      ...(weightedUnavailableReason ? { weightedUnavailableReason } : {}),
      preselected,
      current: null,
    }
    const saved = stored[field]
    if (saved && invoiceFieldChoiceOffered(conflict, saved)) {
      conflict.current =
        saved.kind === 'weighted'
          ? { kind: 'weighted' }
          : { kind: 'document', documentId: saved.documentId }
    }
    result.push(conflict)
  }
  return result
}

/** Die Werte eines Feldes je Rechnung — dieselbe Normierung wie in den Konfliktoptionen. */
export function invoiceFieldDocumentValues(
  draft: Record<string, unknown>,
  field: InvoiceMergeFieldKey,
  knownOperatorIds: KnownOperatorIds = NETZBETREIBER_IDS,
): InvoiceFieldDocumentOption[] {
  const entries = readStoredInvoiceExtractions(draft)
  return documentCandidates(field, entries, nettedInvoiceExtractions(entries), knownOperatorIds).map(
    (c) => c.option,
  )
}

/** Die widersprüchlichen Felder eines Entwurfs mit ihren Wahlmöglichkeiten. */
export function invoiceFieldConflictOptions(
  draft: Record<string, unknown>,
  consumption: ConsumptionByDay | null,
  knownOperatorIds: KnownOperatorIds = NETZBETREIBER_IDS,
): InvoiceFieldConflict[] {
  const entries = readStoredInvoiceExtractions(draft)
  const { conflicts } = foldStoredInvoices(entries, knownOperatorIds)
  return conflictsOf(
    entries,
    conflicts,
    readInvoiceFieldChoices(draft),
    consumption,
    knownOperatorIds,
  )
}

function choiceWrite(
  conflict: InvoiceFieldConflict,
  choice: InvoiceFieldChoice,
): InvoiceDraftWrite | null {
  const field = draftFieldFor(conflict.field)
  if (choice.kind === 'weighted') {
    const option = conflict.options.find((o) => o.kind === 'weighted')
    if (option?.kind !== 'weighted') return null
    const basis = option.basis === 'load_profile' ? 'Lastgang-kWh' : 'Tage'
    const parts = option.parts
      .map((p) => `${DATE(p.periodFrom)}–${DATE(p.periodTo)} zu ${NUMBER.format(p.value)} ct/kWh`)
      .join('; ')
    return {
      field,
      value: option.value,
      source: 'assumed',
      note: `Gewichteter Mittelwert aus den Rechnungen (Gewichtung: ${basis}): ${parts}`,
    }
  }
  const option = conflict.options.find(
    (o) => o.kind === 'document' && o.documentId === choice.documentId,
  )
  if (option?.kind !== 'document') return null
  const period =
    option.periodFrom && option.periodTo
      ? ` (${DATE(option.periodFrom)}–${DATE(option.periodTo)})`
      : ''
  return {
    field,
    value: option.value,
    source: 'measured',
    note: `Gewählt aus Rechnung ${option.filename}${period}`,
  }
}

/**
 * Der gemeinsame Schreibweg aller Rechnungs-Aktionen: falten, gültige Wahlen anwenden, ungültige
 * entfernen, dann `replaceInvoiceDraftFields`. Ohne gespeicherte Wahl identisch zum Weg davor.
 */
export function mergeInvoiceDraft(input: {
  draft: Record<string, unknown>
  entries: readonly StoredInvoiceExtraction[]
  knownOperatorIds: KnownOperatorIds
  now: Date
  legacyInvoiceDraft: boolean
  consumption: ConsumptionByDay | null
}) {
  const { draft, entries, knownOperatorIds, now, legacyInvoiceDraft, consumption } = input
  const fold = foldStoredInvoices(entries, knownOperatorIds)
  let next = withInvoicePriceBasis(withStoredInvoiceExtractions(draft, entries), fold)

  const stored = readInvoiceFieldChoices(draft)
  const kept: InvoiceFieldChoices = {}
  const writes: InvoiceDraftWrite[] = []
  if (Object.keys(stored).length > 0) {
    const conflicts = conflictsOf(entries, fold.conflicts, stored, consumption, knownOperatorIds)
    for (const conflict of conflicts) {
      const saved = stored[conflict.field]
      if (!saved || conflict.current === null) continue
      const write = choiceWrite(conflict, conflict.current)
      if (write === null) continue
      kept[conflict.field] = saved
      writes.push(write)
    }
  }

  next = replaceInvoiceDraftFields(next, [...fold.values, ...writes], now, legacyInvoiceDraft)
  return { draft: withInvoiceFieldChoices(next, kept), fold }
}

/** Antwort der Wahl-Actions; ein Fehler trägt einen Satz für die Oberfläche. */
export type InvoiceFieldChoiceResult = { ok: true } | { ok: false; error: string }
export type InvoiceFieldConflictsResult =
  | { ok: true; conflicts: InvoiceFieldConflict[]; tieredDemandInfo?: TieredDemandInfo }
  | { ok: false; error: string }
