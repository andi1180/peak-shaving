/**
 * Anzeige- und Ablauflogik des Auswahlblocks für widersprüchliche Rechnungsfelder.
 *
 * REIN (kein React, kein `next/*`): `apps/web` hat kein Renderer-Setup, und was hier steht —
 * welche Option welche Wahl bedeutet, wie sie beschriftet ist, was „Übernehmen" aufruft — soll
 * ohne Browser prüfbar sein. Die Komponente daneben ist nur Verdrahtung.
 */
import type { InvoiceMergeFieldKey } from 'shared'
import { invoiceFieldDisplayValue } from '@/lib/admin/invoice-extractions'
import type {
  InvoiceFieldChoice,
  InvoiceFieldChoiceResult,
  InvoiceFieldConflict,
  InvoiceFieldConflictsResult,
  InvoiceFieldDocumentOption,
  InvoiceFieldWeightedOption,
} from '@/lib/admin/invoice-field-choices'

export type InvoiceFieldOption = InvoiceFieldDocumentOption | InvoiceFieldWeightedOption

/** Die drei Server-Actions — als Parameter, damit Tests sie ersetzen können. */
export type InvoiceFieldChoiceActions = {
  getConflicts: (projectId: string, meteringPointId: string) => Promise<InvoiceFieldConflictsResult>
  choose: (
    projectId: string,
    meteringPointId: string,
    field: InvoiceMergeFieldKey,
    choice: InvoiceFieldChoice,
  ) => Promise<InvoiceFieldChoiceResult>
  clear: (
    projectId: string,
    meteringPointId: string,
    field: InvoiceMergeFieldKey,
  ) => Promise<InvoiceFieldChoiceResult>
}

const ACTION_CRASH_TEXT = 'Die Wahl konnte gerade nicht gespeichert werden. Bitte erneut versuchen.'
const CT = new Intl.NumberFormat('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Der Wert eines Radio-Knopfs; eine Rechnung über ihre Dokument-ID. */
export function choiceKey(choice: InvoiceFieldChoice): string {
  return choice.kind === 'weighted' ? 'weighted' : `document:${choice.documentId}`
}

export function optionKey(option: InvoiceFieldOption): string {
  return option.kind === 'weighted'
    ? 'weighted'
    : choiceKey({ kind: 'document', documentId: option.documentId })
}

export function choiceFromKey(key: string): InvoiceFieldChoice | null {
  if (key === 'weighted') return { kind: 'weighted' }
  if (key.startsWith('document:') && key.length > 'document:'.length) {
    return { kind: 'document', documentId: key.slice('document:'.length) }
  }
  return null
}

/** Mittelwert zuerst, danach die Rechnungen in der Reihenfolge des Servers. */
export function orderedOptions(conflict: InvoiceFieldConflict): InvoiceFieldOption[] {
  return [
    ...conflict.options.filter((o) => o.kind === 'weighted'),
    ...conflict.options.filter((o) => o.kind === 'document'),
  ]
}

/** Die gespeicherte Wahl, sofern sie noch einer angebotenen Option entspricht — sonst ist das Feld offen. */
export function chosenOption(conflict: InvoiceFieldConflict): InvoiceFieldOption | null {
  if (conflict.current === null) return null
  const key = choiceKey(conflict.current)
  return conflict.options.find((o) => optionKey(o) === key) ?? null
}

/** Vorauswahl: `preselected`, falls angeboten, sonst die erste Option. Markiert nur, schreibt nicht. */
export function initialSelection(conflict: InvoiceFieldConflict): string | null {
  const options = orderedOptions(conflict)
  const preselected = choiceKey(conflict.preselected)
  if (options.some((o) => optionKey(o) === preselected)) return preselected
  const first = options[0]
  return first ? optionKey(first) : null
}

export function formatFieldValue(
  field: InvoiceMergeFieldKey,
  value: string | number | boolean,
): string {
  if (typeof value === 'boolean') return value ? 'ja' : 'nein'
  if (typeof value === 'number' && field.endsWith('CtPerKwh')) return `${CT.format(value)} ct/kWh`
  return invoiceFieldDisplayValue(field, value)
}

/** `2026-01-31` → `31.01.2026`; alles andere bleibt, wie es kam. */
export function formatIsoDate(iso: string): string {
  const match = ISO_DATE.exec(iso)
  return match ? `${match[3]}.${match[2]}.${match[1]}` : iso
}

export function periodText(from: string | null, to: string | null): string {
  if (from === null && to === null) return 'Zeitraum unbekannt'
  return `${from === null ? '?' : formatIsoDate(from)}–${to === null ? '?' : formatIsoDate(to)}`
}

function basisText(basis: InvoiceFieldWeightedOption['basis']): string {
  return basis === 'load_profile' ? 'Lastgang-kWh' : 'Tage'
}

export function optionText(field: InvoiceMergeFieldKey, option: InvoiceFieldOption): string {
  if (option.kind === 'weighted') {
    return `Gewichteter Mittelwert: ${formatFieldValue(field, option.value)} (Gewichtung: ${basisText(option.basis)})`
  }
  const assumed = option.periodAssumed ? ' (Zeitraum geschätzt)' : ''
  return `${formatFieldValue(field, option.value)} – ${periodText(option.periodFrom, option.periodTo)} – ${option.filename}${assumed}`
}

export function partText(
  field: InvoiceMergeFieldKey,
  part: InvoiceFieldWeightedOption['parts'][number],
): string {
  return `${periodText(part.periodFrom, part.periodTo)}: ${formatFieldValue(field, part.value)}`
}

/** Kurzbeschreibung der gewählten Option im Zustand „gewählt". */
export function chosenDescription(option: InvoiceFieldOption): string {
  if (option.kind === 'weighted')
    return `Gewichteter Mittelwert (Gewichtung: ${basisText(option.basis)})`
  return `Rechnung ${option.filename}, ${periodText(option.periodFrom, option.periodTo)}`
}

type RowCall = {
  actions: Pick<InvoiceFieldChoiceActions, 'choose' | 'clear'>
  projectId: string
  meteringPointId: string
  field: InvoiceMergeFieldKey
  /** Lädt die Konfliktliste neu — nur nach einem erfolgreichen Schreiben. */
  reload: () => void
}

/** „Übernehmen": schreibt genau die markierte Option. Liefert eine Fehlermeldung oder `null`. */
export async function applyMarkedChoice(
  call: RowCall,
  markedKey: string | null,
): Promise<string | null> {
  const choice = markedKey === null ? null : choiceFromKey(markedKey)
  if (choice === null) return 'Bitte zuerst einen Wert markieren.'
  return run(call, () =>
    call.actions.choose(call.projectId, call.meteringPointId, call.field, choice),
  )
}

/** „Wahl aufheben": das Feld ist danach wieder leer und offen. */
export async function liftChoice(call: RowCall): Promise<string | null> {
  return run(call, () => call.actions.clear(call.projectId, call.meteringPointId, call.field))
}

async function run(
  call: RowCall,
  action: () => Promise<InvoiceFieldChoiceResult>,
): Promise<string | null> {
  let result: InvoiceFieldChoiceResult
  try {
    result = await action()
  } catch (cause) {
    console.error('[admin/dateneingabe] Rechnungswahl:', cause)
    return ACTION_CRASH_TEXT
  }
  if (!result.ok) return result.error
  call.reload()
  return null
}
