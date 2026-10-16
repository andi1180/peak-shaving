import { DRAFT_EXPORT_REPORTS_KEY, type StoredExportReports } from 'shared'
import { DRAFT_PROVENANCE_KEY, readDraftProvenance } from '@/lib/project-chat/draft'

export {
  DRAFT_EXPORT_REPORTS_KEY,
  readStoredExportReports,
  type ExportReportSummary,
  type StoredExportReports,
} from 'shared'

/** Monatsberichte eines Jahres plus Reserve; mehr ist ein zweiter Vorgang. */
export const MAX_EXPORT_REPORTS_PER_UPLOAD = 24

/** Gesamtrumpf unter Vercels 4,5-MB-Grenze für Function-Anfragen (s. Root-CLAUDE.md). */
export const MAX_EXPORT_REPORTS_TOTAL_BYTES = 4 * 1024 * 1024

export const XLSX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

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
