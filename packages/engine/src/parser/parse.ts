import type { LoadProfile, PvProfile } from 'shared'

import { matchAdapter } from './adapters'
import { toIsoUtc, type DateFormat } from './datetime'
import { detectStructure, type DetectionDraft } from './detect'
import { byteSize, resolveLimits } from './limits'
import { normalizeLoad, normalizeSingleValue } from './normalize'
import { prepareSeries } from './prepare'
import { extractTable } from './table'
import type {
  ColumnMapping,
  Detection,
  ParseError,
  ParseOptions,
  ParseOutcome,
  PvParseOutcome,
  TablePreview,
  Unit,
} from './types'

const DEFAULT_TZ = 'Europe/Vienna'
const DEFAULT_MAX_GAP = 4 // 1 h

function err(
  code: ParseError['code'],
  message: string,
): { ok: false; kind: 'error'; error: ParseError } {
  return { ok: false, kind: 'error', error: { code, message } }
}

function decimalFallback(delimiter?: string): ',' | '.' {
  return delimiter === ';' ? ',' : '.'
}

function deriveColumns(draft: DetectionDraft, source: string): ColumnMapping | null {
  if (draft.timestampCol == null) return null
  if (source === 'import_export_split') {
    if (draft.importCol == null || draft.exportCol == null) return null
    return { timestamp: draft.timestampCol, import: draft.importCol, export: draft.exportCol }
  }
  const v = draft.valueCols[0]
  if (v == null) return null
  return { timestamp: draft.timestampCol, value: v }
}

function buildPreview(draft: DetectionDraft): TablePreview {
  const headers = draft.headers.length
    ? draft.headers
    : (draft.dataRows[0] ?? []).map((_, i) => `Spalte ${i + 1}`)
  const rows = draft.dataRows.slice(0, 5).map((r) => r.map((c) => (c == null ? '' : String(c))))
  return { headers, rows }
}

/** Parst rohen Datei-Inhalt zu einem validierten LoadProfile (§3.1–§3.3). Kein Datei-I/O. */
export function parseLoadProfile(
  input: { content: string | ArrayBuffer | Uint8Array; fileName?: string; format?: 'csv' | 'xlsx' },
  options: ParseOptions = {},
): ParseOutcome {
  const limits = resolveLimits(options.limits)
  const timezone = options.timezone ?? DEFAULT_TZ
  const maxGap = options.maxInterpolationGap ?? DEFAULT_MAX_GAP
  const signConvention = options.signConvention ?? 'import_positive'

  const size = byteSize(input.content)
  if (size === 0) return err('empty', 'Die Datei ist leer.')
  if (size > limits.maxBytes)
    return err('too_large', `Datei zu groß (${size} > ${limits.maxBytes} Bytes).`)

  const table = extractTable(input, options.delimiter)
  if (table.matrix.length === 0) return err('empty', 'Keine Datenzeilen gefunden.')
  if (table.matrix.length > limits.maxRows)
    return err('too_many_rows', `Zu viele Zeilen (${table.matrix.length} > ${limits.maxRows}).`)

  const draft = detectStructure(table.matrix, options.decimal ?? decimalFallback(table.delimiter))
  const adapter = matchAdapter({
    matrix: table.matrix,
    headerRow: draft.headerRow,
    headers: draft.headers,
    fileName: input.fileName,
  })
  const hints = adapter?.hints ?? {}

  const dateFormat =
    (options.dateFormat as DateFormat | undefined) ?? hints.dateFormat ?? draft.dateFormat
  const decimal = options.decimal ?? hints.decimal ?? draft.decimal
  const unit = options.unit ?? hints.unit ?? draft.unit
  const source = options.source ?? hints.source ?? draft.source
  const tz = hints.timezone ?? timezone
  const columns = options.columns ?? hints.columns ?? deriveColumns(draft, source)

  // Strukturelle Fehler.
  if (draft.timestampCol == null || dateFormat == null)
    return err('no_timestamp_column', 'Keine Zeitstempel-Spalte erkannt.')
  if (columns == null || (columns.value == null && columns.import == null))
    return err('no_value_column', 'Keine Wert-Spalte(n) erkannt.')

  const detection: Detection = {
    format: table.format,
    delimiter: table.delimiter,
    decimal,
    dateFormat,
    timezone: tz,
    unit,
    source,
    columns,
    headerRow: draft.headerRow,
    adapterId: adapter?.id ?? 'generic',
  }

  // Einheit uneindeutig → KEINE stille Annahme, Mapping-Rückmeldung (§3.2).
  if (unit === 'unknown') {
    return {
      ok: false,
      kind: 'needs_mapping',
      detection,
      issues: [
        {
          field: 'unit',
          message:
            'Einheit nicht eindeutig erkennbar (kW oder kWh). Bitte bestätigen — bei kWh-Viertelstundenwerten wird ×4 gerechnet.',
          options: ['kW', 'kWh'],
        },
      ],
      preview: buildPreview(draft),
    }
  }

  const norm = normalizeLoad(draft.dataRows, {
    columns,
    dateFormat,
    decimal,
    unit: unit as Unit,
    timezone: tz,
    source,
    signConvention,
  })
  if (norm.parsedRows === 0)
    return err('unparsable_timestamps', 'Keine Zeile mit gültigem Zeitstempel und Wert.')
  if (norm.parsedRows < 2) return err('insufficient_rows', 'Zu wenige gültige Datenzeilen.')

  const prepared = prepareSeries(norm.readings, maxGap)
  if (prepared.intervalMinutes !== 15)
    return err(
      'wrong_interval',
      `Nur 15-min-Intervall unterstützt (erkannt: ${prepared.intervalMinutes} min).`,
    )

  // Datenqualität + Warnungen.
  const warnings = [...prepared.warnings]
  if (norm.skippedRows > 0)
    warnings.push(`${norm.skippedRows} Zeile(n) ohne gültigen Zeitstempel/Wert übersprungen.`)

  // Pflichtwarnung (§3.1): import_only ohne PV-Profil.
  if (source === 'import_only' && !options.hasPvProfile) {
    warnings.push(
      'source ist „import_only" ohne PV-Profil: Die Eigenverbrauchs- und Lastverschiebungs-Ersparnis ist nicht beurteilbar und kann unterschätzt sein (keine Einspeise-/PV-Daten).',
    )
  }
  // Plausibilität: unerwartete Negativwerte bei import_only.
  if (source === 'import_only' && prepared.slots.some((s) => s.value < 0)) {
    warnings.push(
      'Negative Bezugswerte trotz source „import_only" — bitte Spaltenzuordnung prüfen.',
    )
  }

  const profile: LoadProfile = {
    readings: prepared.slots.map((s) => ({ ts: toIsoUtc(s.ms), gridPowerKw: s.value })),
    intervalMinutes: 15,
    timezoneMeta: tz,
    source,
  }

  return {
    ok: true,
    profile,
    dataQuality: {
      coveredDays: prepared.coveredDays,
      gapsInterpolated: prepared.gapsInterpolated,
      warnings,
    },
    detection,
  }
}

/** Parst rohen Datei-Inhalt zu einem PvProfile (§3.1). Einzelne Wertspalte, keine source. */
export function parsePvProfile(
  input: { content: string | ArrayBuffer | Uint8Array; fileName?: string; format?: 'csv' | 'xlsx' },
  options: ParseOptions = {},
): PvParseOutcome {
  const limits = resolveLimits(options.limits)
  const timezone = options.timezone ?? DEFAULT_TZ
  const maxGap = options.maxInterpolationGap ?? DEFAULT_MAX_GAP

  const size = byteSize(input.content)
  if (size === 0) return err('empty', 'Die Datei ist leer.')
  if (size > limits.maxBytes) return err('too_large', `Datei zu groß.`)

  const table = extractTable(input, options.delimiter)
  if (table.matrix.length === 0) return err('empty', 'Keine Datenzeilen gefunden.')
  if (table.matrix.length > limits.maxRows) return err('too_many_rows', 'Zu viele Zeilen.')

  const draft = detectStructure(table.matrix, options.decimal ?? decimalFallback(table.delimiter))
  const dateFormat = (options.dateFormat as DateFormat | undefined) ?? draft.dateFormat
  const decimal = options.decimal ?? draft.decimal
  const unit = options.unit ?? draft.unit
  const columns =
    options.columns ??
    (draft.timestampCol != null && draft.valueCols[0] != null
      ? { timestamp: draft.timestampCol, value: draft.valueCols[0] }
      : null)

  if (draft.timestampCol == null || dateFormat == null)
    return err('no_timestamp_column', 'Keine Zeitstempel-Spalte erkannt.')
  if (columns == null || columns.value == null)
    return err('no_value_column', 'Keine Wert-Spalte erkannt.')

  const detection: Detection = {
    format: table.format,
    delimiter: table.delimiter,
    decimal,
    dateFormat,
    timezone,
    unit,
    source: 'import_only', // PV kennt keine source; Feld für Detection-Form belegt, ungenutzt.
    columns,
    headerRow: draft.headerRow,
    adapterId: 'generic',
  }

  if (unit === 'unknown') {
    return {
      ok: false,
      kind: 'needs_mapping',
      detection,
      issues: [
        {
          field: 'unit',
          message: 'Einheit des PV-Profils nicht eindeutig (kW oder kWh). Bitte bestätigen.',
          options: ['kW', 'kWh'],
        },
      ],
      preview: buildPreview(draft),
    }
  }

  const norm = normalizeSingleValue(draft.dataRows, {
    columns,
    dateFormat,
    decimal,
    unit: unit as Unit,
    timezone,
  })
  if (norm.parsedRows < 2) return err('insufficient_rows', 'Zu wenige gültige Datenzeilen.')

  const prepared = prepareSeries(norm.readings, maxGap)
  if (prepared.intervalMinutes !== 15)
    return err(
      'wrong_interval',
      `Nur 15-min-Intervall unterstützt (erkannt: ${prepared.intervalMinutes} min).`,
    )

  const warnings = [...prepared.warnings]
  if (norm.skippedRows > 0)
    warnings.push(`${norm.skippedRows} Zeile(n) ohne gültigen Zeitstempel/Wert übersprungen.`)

  const profile: PvProfile = {
    readings: prepared.slots.map((s) => ({ ts: toIsoUtc(s.ms), pvGenerationKw: s.value })),
  }

  return {
    ok: true,
    profile,
    dataQuality: {
      coveredDays: prepared.coveredDays,
      gapsInterpolated: prepared.gapsInterpolated,
      warnings,
    },
    detection,
  }
}
