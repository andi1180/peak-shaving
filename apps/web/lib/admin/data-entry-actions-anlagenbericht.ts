'use server'

import { revalidatePath } from 'next/cache'
import { parseHourlyPlantReports, type HourlyPlantReportResult, type PlantReportFile } from 'extractors'
import { uploadProjectDocument } from '@/lib/project-documents/documents'
import { createClient } from '@/lib/supabase/server'
import type { Json } from '@/db-types'
import {
  MAX_EXPORT_REPORTS_PER_UPLOAD,
  MAX_EXPORT_REPORTS_TOTAL_BYTES,
  XLSX_MEDIA_TYPE,
  readStoredExportReports,
  withStoredExportReports,
  withoutExportReports,
  type ExportReportSummary,
  type StoredExportReports,
} from './export-reports'
import { readMeteringPointList } from './metering-points'
import { projectDataEntryHref } from './projects'
import type { AdminState } from './schema'
import {
  FORBIDDEN,
  GENERIC,
  UNKNOWN_PROJECT,
  UUID,
  formatMegabytes,
  isForbidden,
  readProjectId,
  statusOf,
} from './data-entry-actions-shared'

const NOTHING_SAVED = 'Es wurde nichts gespeichert.'
const POINT_GONE = 'Diesen Zählpunkt gibt es nicht (mehr). Bitte laden Sie die Seite neu.'

function parseFailure(result: Extract<HourlyPlantReportResult, { error: string }>): string {
  if (result.error === 'no_rows') {
    return `„${result.file}": enthält keine lesbaren Stundenwerte. ${NOTHING_SAVED}`
  }
  const found =
    result.headers.length > 0
      ? ` Gefunden: ${result.headers.map((h) => `„${h}"`).join(', ')}.`
      : ' Gefunden: keine Kopfzeile.'
  return (
    `„${result.file}": kein stündlicher Anlagenbericht erkannt — erwartet werden die Spalten ` +
    `„Statistischer Zeitraum", „Netzeinspeisung (kWh)" und „Netzbezug (kWh)".${found} ${NOTHING_SAVED}`
  )
}

/** Jede Datei einzeln, damit die Meldung die schuldige Datei nennt — auch wenn der Leser wirft. */
function checkEachFile(files: readonly PlantReportFile[]): string | null {
  for (const file of files) {
    let result: HourlyPlantReportResult
    try {
      result = parseHourlyPlantReports([file])
    } catch {
      result = { error: 'unknown_format', file: file.name, headers: [] }
    }
    if ('error' in result) return parseFailure(result)
  }
  return null
}

function sumKwh(readings: readonly { kwh: number }[]): number {
  return Math.round(readings.reduce((sum, r) => sum + r.kwh, 0) * 1000) / 1000
}

function summarize(result: Exclude<HourlyPlantReportResult, { error: string }>): ExportReportSummary | null {
  const { diagnostics } = result
  if (diagnostics.range === null) return null
  const spanHours =
    (Date.parse(diagnostics.range.to) - Date.parse(diagnostics.range.from)) / (60 * 60 * 1000)
  return {
    from: diagnostics.range.from,
    to: diagnostics.range.to,
    hours: diagnostics.hours,
    missingHours: Math.max(0, Math.round(spanHours) - diagnostics.hours),
    duplicateHours: diagnostics.duplicateHours,
    ambiguousHours: diagnostics.ambiguousHours,
    skippedRows: diagnostics.skippedRows,
    exportKwh: sumKwh(result.exportHourly),
    importKwh: sumKwh(result.importHourly),
  }
}

/** Liest den Entwurf frisch — `update_metering_point_draft` ERSETZT ihn. */
async function readPointDraft(
  projectId: string,
  meteringPointId: string,
): Promise<
  | { ok: true; supabase: Awaited<ReturnType<typeof createClient>>; draft: Record<string, unknown> }
  | { ok: false; state: AdminState }
> {
  const supabase = await createClient()
  const listRes = await supabase.rpc('list_metering_points', { p_project_id: projectId })
  if (listRes.error) {
    if (isForbidden(listRes.error)) return { ok: false, state: { formError: FORBIDDEN } }
    console.error('[admin/dateneingabe] list_metering_points (Anlagenbericht):', listRes.error)
    return { ok: false, state: { formError: GENERIC } }
  }
  const point = readMeteringPointList(listRes.data)?.find((p) => p.id === meteringPointId)
  if (!point) return { ok: false, state: { formError: POINT_GONE } }
  return { ok: true, supabase, draft: point.draft }
}

async function writeDraft(
  supabase: Awaited<ReturnType<typeof createClient>>,
  meteringPointId: string,
  draft: Record<string, unknown>,
): Promise<AdminState | null> {
  const res = await supabase.rpc('update_metering_point_draft', {
    p_metering_point_id: meteringPointId,
    p_draft: draft as Json,
  })
  if (res.error) {
    if (isForbidden(res.error)) return { formError: FORBIDDEN }
    console.error('[admin/dateneingabe] update_metering_point_draft (Anlagenbericht):', res.error)
    return { formError: GENERIC }
  }
  if (statusOf(res.data) !== 'ok') {
    console.error('[admin/dateneingabe] unerwartete Antwort (Anlagenbericht):', res.data)
    return { formError: GENERIC }
  }
  return null
}

/**
 * Nimmt stündliche Anlagenberichte entgegen: erst alle prüfen, dann ablegen, dann den Satz im
 * Entwurf ERSETZEN. Ein ungültiger Bericht bricht vor jeder Ablage ab.
 */
export async function uploadMeteringPointExportReportsAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }
  const meteringPointId = String(formData.get('meteringPointId') ?? '')
  if (!UUID.test(meteringPointId)) return { formError: GENERIC }

  // Ein leeres Mehrfach-Dateifeld schickt trotzdem einen Eintrag mit Grösse 0.
  const files = formData
    .getAll('files')
    .filter((value): value is File => value instanceof File && value.size > 0)
  if (files.length === 0) {
    return { fieldErrors: { files: 'Bitte mindestens einen Anlagenbericht auswählen.' } }
  }
  if (files.length > MAX_EXPORT_REPORTS_PER_UPLOAD) {
    return {
      fieldErrors: {
        files: `Höchstens ${MAX_EXPORT_REPORTS_PER_UPLOAD} Dateien pro Vorgang — ausgewählt waren ${files.length}. ${NOTHING_SAVED}`,
      },
    }
  }
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0)
  if (totalBytes > MAX_EXPORT_REPORTS_TOTAL_BYTES) {
    return {
      fieldErrors: {
        files:
          `Die Dateien sind zusammen zu gross (${formatMegabytes(totalBytes)} MB, höchstens ` +
          `${formatMegabytes(MAX_EXPORT_REPORTS_TOTAL_BYTES)} MB). ${NOTHING_SAVED}`,
      },
    }
  }

  const reports = await Promise.all(
    files.map(async (file) => {
      const bytes = await file.arrayBuffer()
      return { file, bytes, parsed: { name: file.name, data: new Uint8Array(bytes) } as PlantReportFile }
    }),
  )
  const plantFiles = reports.map((r) => r.parsed)

  const fileError = checkEachFile(plantFiles)
  if (fileError) return { fieldErrors: { files: fileError } }

  const combined = parseHourlyPlantReports(plantFiles)
  if ('error' in combined) return { fieldErrors: { files: parseFailure(combined) } }
  const summary = summarize(combined)
  if (summary === null) {
    return { fieldErrors: { files: `Die Berichte enthalten keine lesbaren Stundenwerte. ${NOTHING_SAVED}` } }
  }

  const documents: StoredExportReports['documents'] = []
  for (const { file, bytes } of reports) {
    const upload = await uploadProjectDocument(projectId, {
      name: file.name,
      type: file.type.trim() === '' ? XLSX_MEDIA_TYPE : file.type,
      bytes,
    })
    if (!upload.ok) {
      if (upload.reason === 'not_found') return { formError: UNKNOWN_PROJECT }
      console.error('[admin/dateneingabe] uploadProjectDocument (Anlagenbericht):', upload.reason)
      return { formError: `„${file.name}" konnte nicht abgelegt werden. Der Entwurf ist unverändert.` }
    }
    documents.push({ documentId: upload.documentId, filename: file.name })
  }

  const read = await readPointDraft(projectId, meteringPointId)
  if (!read.ok) return read.state
  const replaced = readStoredExportReports(read.draft) !== null
  const failed = await writeDraft(
    read.supabase,
    meteringPointId,
    withStoredExportReports(read.draft, { documents, summary }, new Date()),
  )
  if (failed) return failed

  revalidatePath(projectDataEntryHref(projectId))
  const count = documents.length === 1 ? 'Ein Anlagenbericht' : `${documents.length} Anlagenberichte`
  return {
    success: `${count} eingelesen.${replaced ? ' Der bisherige Satz wurde ersetzt.' : ''}`,
  }
}

/** Entfernt den Satz aus dem Entwurf; die Dateien bleiben Projektdokumente (Muster Rechnung). */
export async function removeMeteringPointExportReportsAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }
  const meteringPointId = String(formData.get('meteringPointId') ?? '')
  if (!UUID.test(meteringPointId)) return { formError: GENERIC }

  const read = await readPointDraft(projectId, meteringPointId)
  if (!read.ok) return read.state
  const failed = await writeDraft(read.supabase, meteringPointId, withoutExportReports(read.draft))
  if (failed) return failed

  revalidatePath(projectDataEntryHref(projectId))
  return {
    success:
      'Anlagenberichte entfernt. Die Dateien bleiben in der Dokumentenliste des Projekts.',
  }
}
