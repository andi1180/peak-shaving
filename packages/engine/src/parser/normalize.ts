import type { LoadSource } from 'shared'

import { parseSplitTimestamp, parseTimestamp, type DateFormat } from './datetime'
import { parseNumber, type DecimalSeparator } from './number'
import type { ColumnMapping, RawCell, SignConvention, Unit } from './types'

export type RawReading = { ms: number; value: number }

export type NormalizeParams = {
  columns: ColumnMapping
  dateFormat: DateFormat
  decimal: DecimalSeparator
  unit: Unit
  timezone: string
}

export type NormalizeResult = {
  readings: RawReading[]
  parsedRows: number
  skippedRows: number
}

function cellNumber(cell: RawCell, decimal: DecimalSeparator): number {
  if (typeof cell === 'number') return cell
  if (cell == null) return NaN
  return parseNumber(String(cell), decimal)
}

// kWh-Viertelstundenwerte → kW: kW = kWh × 4 (§3.2).
function toKw(value: number, unit: Unit): number {
  return unit === 'kWh' ? value * 4 : value
}

/** Zeitstempel einer Zeile — kombiniert (eine Spalte) oder Split (Datum + Zeitspalte, OP#4). */
function rowTimestamp(
  row: RawCell[],
  columns: ColumnMapping,
  dateFormat: DateFormat,
  timezone: string,
): number {
  const dateCell = row[columns.timestamp] ?? null
  if (columns.timeColumn != null) {
    return parseSplitTimestamp(dateCell, row[columns.timeColumn] ?? null, dateFormat, timezone)
  }
  return parseTimestamp(dateCell, dateFormat, timezone)
}

/** Summe der endlichen Werte über mehrere Spalten; null, wenn KEINE Spalte einen endlichen Wert trägt. */
function sumCols(row: RawCell[], cols: number[], decimal: DecimalSeparator): number | null {
  let sum = 0
  let any = false
  for (const col of cols) {
    const n = cellNumber(row[col] ?? null, decimal)
    if (Number.isFinite(n)) {
      sum += n
      any = true
    }
  }
  return any ? sum : null
}

/** Normalisiert Rohzeilen auf signiertes gridPowerKw (+ = Bezug, − = Einspeisung), §3.1/§3.2. */
export function normalizeLoad(
  dataRows: RawCell[][],
  params: NormalizeParams & { source: LoadSource; signConvention: SignConvention },
): NormalizeResult {
  const { columns, dateFormat, decimal, unit, timezone, source, signConvention } = params
  const readings: RawReading[] = []
  let skipped = 0

  const isSummation = columns.consumptionCols != null || columns.feedInCols != null

  for (const row of dataRows) {
    const ms = rowTimestamp(row, columns, dateFormat, timezone)
    if (!Number.isFinite(ms)) {
      skipped++
      continue
    }

    let kw: number
    if (isSummation) {
      // Mehrspalten-Mapping (OP#4): gridPowerKw = (Σ Verbrauch − Σ Einspeisung).
      const cons = sumCols(row, columns.consumptionCols ?? [], decimal)
      const feed = sumCols(row, columns.feedInCols ?? [], decimal)
      if (cons == null && feed == null) {
        skipped++
        continue
      }
      kw = toKw((cons ?? 0) - (feed ?? 0), unit)
    } else if (source === 'import_export_split') {
      const imp = cellNumber(row[columns.import ?? -1] ?? null, decimal)
      const exp = cellNumber(row[columns.export ?? -1] ?? null, decimal)
      if (!Number.isFinite(imp) && !Number.isFinite(exp)) {
        skipped++
        continue
      }
      kw = toKw((Number.isFinite(imp) ? imp : 0) - (Number.isFinite(exp) ? exp : 0), unit)
    } else {
      const v = cellNumber(row[columns.value ?? -1] ?? null, decimal)
      if (!Number.isFinite(v)) {
        skipped++
        continue
      }
      // net_signed: Vorzeichenkonvention der Quelle berücksichtigen; import_only: bereits ≥0 gemeint.
      const signed = source === 'net_signed' && signConvention === 'export_positive' ? -v : v
      kw = toKw(signed, unit)
    }

    readings.push({ ms, value: kw })
  }

  return { readings, parsedRows: readings.length, skippedRows: skipped }
}

/** Normalisiert eine einzelne Wertspalte (für PvProfile: pvGenerationKw), §3.1. */
export function normalizeSingleValue(
  dataRows: RawCell[][],
  params: NormalizeParams,
): NormalizeResult {
  const { columns, dateFormat, decimal, unit, timezone } = params
  const readings: RawReading[] = []
  let skipped = 0

  for (const row of dataRows) {
    const ms = rowTimestamp(row, columns, dateFormat, timezone)
    const v = cellNumber(row[columns.value ?? -1] ?? null, decimal)
    if (!Number.isFinite(ms) || !Number.isFinite(v)) {
      skipped++
      continue
    }
    readings.push({ ms, value: toKw(v, unit) })
  }

  return { readings, parsedRows: readings.length, skippedRows: skipped }
}
