import type { LoadProfile, LoadSource, PvProfile } from 'shared'

// Öffentliche Typen des Parsers (§3.2/§3.3). Alles rein/isomorph — kein I/O hier.

export type FileFormat = 'csv' | 'xlsx'

/** Roh-Inhalt einer Datei. CSV als String, XLSX/XLS als ArrayBuffer/Uint8Array. Kein Datei-I/O in der Engine. */
export type RawFileInput = {
  content: string | ArrayBuffer | Uint8Array
  fileName?: string
  format?: FileFormat
}

export type Unit = 'kW' | 'kWh'

/** Eine Zelle der roh extrahierten Tabelle (CSV → String; XLSX → auch number/boolean). */
export type RawCell = string | number | boolean | null

export type ParseLimits = {
  maxBytes: number
  maxRows: number
}

/** Spalten-Zuordnung. Genau `value` ODER (`import` [+ `export`]) ist gesetzt. */
export type ColumnMapping = {
  timestamp: number
  value?: number
  import?: number
  export?: number
}

export type SignConvention = 'import_positive' | 'export_positive'

export type ParseOptions = {
  limits?: Partial<ParseLimits>
  /** Zeitzone zur Interpretation lokaler (naiver) Zeitstempel; Metadatum im LoadProfile. */
  timezone?: string
  /** Bestätigt/überschreibt die erkannte Einheit (Mapping-Schritt). */
  unit?: Unit
  /** Bestätigt/überschreibt die erkannte source (Mapping-Schritt). */
  source?: LoadSource
  /** Bestätigt/überschreibt die Spaltenzuordnung (Mapping-Schritt). */
  columns?: ColumnMapping
  delimiter?: string
  decimal?: ',' | '.'
  dateFormat?: string
  /** Vorzeichen im net_signed-Quellfeld. Default: import_positive (+ = Bezug). */
  signConvention?: SignConvention
  /** Ob ein PvProfile mitgeliefert wird (steuert die import_only-Pflichtwarnung, §3.1). */
  hasPvProfile?: boolean
  /** Max. aufeinanderfolgende fehlende 15-min-Slots, die still interpoliert werden. Default 4 (= 1 h). */
  maxInterpolationGap?: number
}

/** Deckt sich mit `AnalysisResult['dataQuality']` (§3.10) — der Parser liefert den Datenqualitäts-Teil. */
export type DataQuality = {
  coveredDays: number
  gapsInterpolated: number
  warnings: string[]
}

/** Was automatisch erkannt wurde — vom UI im Mapping-Schritt anzeigbar/korrigierbar. */
export type Detection = {
  format: FileFormat
  delimiter?: string
  decimal?: ',' | '.'
  dateFormat: string
  timezone: string
  unit: Unit | 'unknown'
  source: LoadSource
  columns: ColumnMapping
  headerRow: number | null
  adapterId: string
}

export type TablePreview = {
  headers: string[]
  rows: string[][]
}

export type MappingIssueField =
  'unit' | 'source' | 'timestampColumn' | 'valueColumn' | 'delimiter' | 'decimal'

export type MappingIssue = {
  field: MappingIssueField
  message: string
  options?: string[]
}

export type ParseErrorCode =
  | 'empty'
  | 'too_large'
  | 'too_many_rows'
  | 'unsupported_format'
  | 'no_timestamp_column'
  | 'no_value_column'
  | 'unparsable_timestamps'
  | 'wrong_interval'
  | 'insufficient_rows'

export type ParseError = {
  code: ParseErrorCode
  message: string
}

/**
 * Ergebnis von `parseLoadProfile`. Discriminated Union:
 * - ok:true → validiertes LoadProfile + Datenqualität + Erkennung.
 * - ok:false, kind:'needs_mapping' → Struktur/Einheit uneindeutig; das UI zeigt `detection`+`preview`
 *   und lässt bestätigen/korrigieren (§3.2). KEINE stille Annahme.
 * - ok:false, kind:'error' → strukturell nicht verarbeitbar.
 */
export type ParseOutcome =
  | { ok: true; profile: LoadProfile; dataQuality: DataQuality; detection: Detection }
  | {
      ok: false
      kind: 'needs_mapping'
      detection: Detection
      issues: MappingIssue[]
      preview: TablePreview
    }
  | { ok: false; kind: 'error'; error: ParseError }

export type PvParseOutcome =
  | { ok: true; profile: PvProfile; dataQuality: DataQuality; detection: Detection }
  | {
      ok: false
      kind: 'needs_mapping'
      detection: Detection
      issues: MappingIssue[]
      preview: TablePreview
    }
  | { ok: false; kind: 'error'; error: ParseError }
