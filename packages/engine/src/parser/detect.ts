import type { LoadSource } from 'shared'

import { detectDateFormat, type DateFormat } from './datetime'
import { detectDecimalSeparator, looksNumeric, parseNumber, type DecimalSeparator } from './number'
import type { RawCell, Unit } from './types'

const SAMPLE_ROWS = 60

// Header-Schlüsselwörter zur Import/Export-Unterscheidung.
// [ANNAHME: unbestätigt bis Martins Muster (OP#4)] — inkl. der OBIS-artigen Kürzel 1.8.0/2.8.0.
const IMPORT_KEYS = ['bezug', 'import', 'verbrauch', 'netzbezug', 'wirkbezug', 'einkauf', '1.8.0']
const EXPORT_KEYS = ['einspeis', 'export', 'lieferung', 'erzeug', 'rückspeis', 'ruckspeis', '2.8.0']

export type DetectionDraft = {
  headerRow: number | null
  headers: string[]
  dataRows: RawCell[][]
  timestampCol: number | null
  dateFormat: DateFormat | null
  decimal: DecimalSeparator
  valueCols: number[]
  importCol: number | null
  exportCol: number | null
  unit: Unit | 'unknown'
  source: LoadSource
}

function toStr(cell: RawCell): string {
  return cell == null ? '' : String(cell).trim()
}

function rowWidth(matrix: RawCell[][]): number {
  let w = 0
  for (const r of matrix) w = Math.max(w, r.length)
  return w
}

function columnSamples(rows: RawCell[][], col: number, n = SAMPLE_ROWS): RawCell[] {
  const out: RawCell[] = []
  for (let i = 0; i < rows.length && out.length < n; i++) {
    out.push(rows[i]?.[col] ?? null)
  }
  return out
}

function looksLikeTimestamp(cell: RawCell): boolean {
  return detectDateFormat([cell]) !== null
}

/** Header = erste Zeile mit einer Beschriftung, die weder Zahl noch Zeitstempel ist. */
function detectHeaderRow(matrix: RawCell[][], decimal: DecimalSeparator): number | null {
  const first = matrix[0]
  if (!first) return null
  const hasLabel = first.some((c) => {
    const s = toStr(c)
    return s !== '' && !looksNumeric(s, decimal) && !looksLikeTimestamp(c)
  })
  return hasLabel ? 0 : null
}

function numericFraction(samples: RawCell[], decimal: DecimalSeparator): number {
  let total = 0
  let numeric = 0
  for (const c of samples) {
    if (c == null || c === '') continue
    total++
    if (typeof c === 'number' || looksNumeric(toStr(c), decimal)) numeric++
  }
  return total === 0 ? 0 : numeric / total
}

function hasNegative(samples: RawCell[], decimal: DecimalSeparator): boolean {
  for (const c of samples) {
    const n = typeof c === 'number' ? c : parseNumber(toStr(c), decimal)
    if (Number.isFinite(n) && n < 0) return true
  }
  return false
}

function columnSum(rows: RawCell[][], col: number, decimal: DecimalSeparator): number {
  let sum = 0
  for (const r of rows) {
    const c = r[col]
    const n = typeof c === 'number' ? c : parseNumber(toStr(c ?? ''), decimal)
    if (Number.isFinite(n)) sum += Math.abs(n)
  }
  return sum
}

function matchKeys(header: string, keys: string[]): boolean {
  const h = header.toLowerCase()
  return keys.some((k) => h.includes(k))
}

function detectUnitFromHeaders(headers: string[], valueCols: number[]): Unit | 'unknown' {
  const text = valueCols
    .map((c) => headers[c] ?? '')
    .join(' ')
    .toLowerCase()
  if (/kwh|kw h|kw·h/.test(text)) return 'kWh'
  if (/\bkw\b|k w/.test(text)) return 'kW'
  return 'unknown'
}

/** Generische Struktur-Erkennung (§3.2). Adapter-Hints/Optionen werden im Orchestrator daraufgelegt. */
export function detectStructure(
  matrix: RawCell[][],
  decimalFallback: DecimalSeparator,
): DetectionDraft {
  // Grobe Dezimal-Schätzung aus allen String-Zellen (für Header-/Numerik-Erkennung).
  const stringCells: string[] = []
  for (const r of matrix) {
    for (const c of r) {
      if (typeof c === 'string' && /[0-9]/.test(c)) stringCells.push(c)
    }
  }
  const decimalGuess = detectDecimalSeparator(stringCells, decimalFallback)

  const headerRow = detectHeaderRow(matrix, decimalGuess)
  const headers = (headerRow === null ? [] : (matrix[headerRow] ?? [])).map((c) =>
    toStr(c).toLowerCase(),
  )
  const dataRows = matrix.slice(headerRow === null ? 0 : headerRow + 1)
  const width = rowWidth(matrix)

  // Zeitstempel-Spalte: erste Spalte, deren Stichprobe ein Datumsformat ergibt.
  let timestampCol: number | null = null
  let dateFormat: DateFormat | null = null
  for (let col = 0; col < width; col++) {
    const fmt = detectDateFormat(columnSamples(dataRows, col))
    if (fmt) {
      timestampCol = col
      dateFormat = fmt
      break
    }
  }

  // Dezimaltrenner aus den Wert-Spalten verfeinern.
  const valueCandidates: number[] = []
  for (let col = 0; col < width; col++) {
    if (col === timestampCol) continue
    if (numericFraction(columnSamples(dataRows, col), decimalGuess) >= 0.6)
      valueCandidates.push(col)
  }
  const valueStrings: string[] = []
  for (const col of valueCandidates) {
    for (const c of columnSamples(dataRows, col)) {
      if (typeof c === 'string') valueStrings.push(c)
    }
  }
  const decimal = detectDecimalSeparator(valueStrings, decimalGuess)

  const unit = detectUnitFromHeaders(headers, valueCandidates)

  // source-Ableitung (§3.1/§3.2).
  let source: LoadSource
  let importCol: number | null = null
  let exportCol: number | null = null
  const valueCols = valueCandidates

  if (valueCandidates.length >= 2) {
    source = 'import_export_split'
    // Import/Export per Header-Schlüsselwort; sonst: größere Summe = Import.
    for (const col of valueCandidates) {
      const h = headers[col] ?? ''
      if (importCol === null && matchKeys(h, IMPORT_KEYS)) importCol = col
      else if (exportCol === null && matchKeys(h, EXPORT_KEYS)) exportCol = col
    }
    const first = valueCandidates[0]!
    const second = valueCandidates[1]!
    if (importCol === null && exportCol === null) {
      const s0 = columnSum(dataRows, first, decimal)
      const s1 = columnSum(dataRows, second, decimal)
      importCol = s0 >= s1 ? first : second
      exportCol = s0 >= s1 ? second : first
    } else if (importCol === null) {
      importCol = valueCandidates.find((c) => c !== exportCol) ?? first
    } else if (exportCol === null) {
      exportCol = valueCandidates.find((c) => c !== importCol) ?? second
    }
  } else if (valueCandidates.length === 1) {
    const col = valueCandidates[0]!
    // Einzelspalte mit Negativwerten → net_signed; sonst import_only
    // [ANNAHME] all-positiv ist zwischen net_signed (nie eingespeist) und import_only nicht
    // unterscheidbar → import_only als sichere Vorgabe (löst die §3.1-Schutzwarnung aus).
    source = hasNegative(columnSamples(dataRows, col), decimal) ? 'net_signed' : 'import_only'
  } else {
    source = 'import_only'
  }

  return {
    headerRow,
    headers,
    dataRows,
    timestampCol,
    dateFormat,
    decimal,
    valueCols,
    importCol,
    exportCol,
    unit,
    source,
  }
}
