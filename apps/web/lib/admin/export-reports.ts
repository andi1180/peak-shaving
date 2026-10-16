import { DRAFT_PROVENANCE_KEY, readDraftProvenance } from '@/lib/project-chat/draft'

/**
 * Stündliche Anlagenberichte (Einspeisung) am Zählpunkt — Seiteneintrag im Entwurf, Muster
 * `_invoiceExtractions`: mehrere Dokumente passen in keinen skalaren Entwurfswert. Gespeichert
 * werden Dokument-Kennungen und eine Zusammenfassung, keine Messwerte; die Rechnung (S9-3b) liest
 * die Dateien selbst.
 */
export const DRAFT_EXPORT_REPORTS_KEY = '_exportReports'

/** Monatsberichte eines Jahres plus Reserve; mehr ist ein zweiter Vorgang. */
export const MAX_EXPORT_REPORTS_PER_UPLOAD = 24

/** Gesamtrumpf unter Vercels 4,5-MB-Grenze für Function-Anfragen (s. Root-CLAUDE.md). */
export const MAX_EXPORT_REPORTS_TOTAL_BYTES = 4 * 1024 * 1024

export const XLSX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export type ExportReportSummary = {
  /** UTC-ISO, `to` exklusiv (Ende der letzten Stunde). */
  from: string
  to: string
  hours: number
  missingHours: number
  duplicateHours: number
  ambiguousHours: number
  skippedRows: number
  exportKwh: number
  importKwh: number
}

export type StoredExportReports = {
  documents: { documentId: string; filename: string }[]
  summary: ExportReportSummary
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Liest den Seiteneintrag; fehlend oder kaputt ergibt `null` (kein halber Satz). */
export function readStoredExportReports(draft: Record<string, unknown>): StoredExportReports | null {
  const raw = draft[DRAFT_EXPORT_REPORTS_KEY]
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const entry = raw as Record<string, unknown>

  const documents: StoredExportReports['documents'] = []
  if (!Array.isArray(entry.documents)) return null
  for (const doc of entry.documents) {
    const row = doc as Record<string, unknown> | null
    if (typeof row?.documentId !== 'string' || row.documentId === '') continue
    if (typeof row.filename !== 'string' || row.filename.trim() === '') continue
    documents.push({ documentId: row.documentId, filename: row.filename.trim() })
  }
  if (documents.length === 0) return null

  const s = entry.summary as Record<string, unknown> | null
  if (typeof s?.from !== 'string' || typeof s.to !== 'string') return null
  const numbers = [
    'hours',
    'missingHours',
    'duplicateHours',
    'ambiguousHours',
    'skippedRows',
    'exportKwh',
    'importKwh',
  ] as const
  const summary = { from: s.from, to: s.to } as ExportReportSummary
  for (const key of numbers) {
    const value = finiteNumber(s[key])
    if (value === null) return null
    summary[key] = value
  }
  return { documents, summary }
}

/** Ersetzt den Satz vollständig (kein Anhängen) und vermerkt die Herkunft `measured`. */
export function withStoredExportReports(
  draft: Record<string, unknown>,
  reports: StoredExportReports,
  now: Date,
): Record<string, unknown> {
  return {
    ...draft,
    [DRAFT_EXPORT_REPORTS_KEY]: reports,
    [DRAFT_PROVENANCE_KEY]: {
      ...readDraftProvenance(draft),
      [DRAFT_EXPORT_REPORTS_KEY]: { source: 'measured', at: now.toISOString() },
    },
  }
}

/** Entfernt Seiteneintrag und Herkunftsvermerk. */
export function withoutExportReports(draft: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...draft }
  delete next[DRAFT_EXPORT_REPORTS_KEY]
  const provenance = readDraftProvenance(draft)
  delete provenance[DRAFT_EXPORT_REPORTS_KEY]
  if (Object.keys(provenance).length > 0) next[DRAFT_PROVENANCE_KEY] = provenance
  else delete next[DRAFT_PROVENANCE_KEY]
  return next
}
