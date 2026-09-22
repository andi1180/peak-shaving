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
  /** Summe beider Ausfallarten. */
  skippedRows: number
  /** Zeilen, deren Zeitstempel unlesbar ist — sie haben keinen Ort auf der Zeitachse. */
  skippedTimestampRows: number
  /** Zeilen MIT gültigem Zeitstempel, aber ohne verwertbaren Messwert. */
  skippedValueRows: number
  /** Erster und letzter Zeitstempel der Wert-Ausfälle; `null`, wenn es keine gibt. */
  valueGapRange: { fromMs: number; toMs: number } | null
}

/**
 * Sammelstelle für die beiden Ausfallarten. (22.09.2026)
 *
 * Sie waren bis hierher EIN Zähler, und die daraus gebaute Meldung („ohne gültigen
 * Zeitstempel/Wert") konnte zwei sehr verschiedene Dinge bedeuten: eine unlesbare Zeile — also ein
 * Verdacht auf falsch erkanntes Format — oder eine Zeile, die korrekt an ihrer Stelle steht und
 * bloss keinen Messwert trägt, weil der Zähler zu der Zeit noch nichts geliefert hat. Am
 * Referenzfall waren es 14.980 Zeilen der zweiten Art, und die Meldung las sich wie ein
 * Parser-Fehler. Getrennt gezählt, nie addiert.
 */
function createSkipTally() {
  let timestampRows = 0
  let valueRows = 0
  let fromMs = Number.POSITIVE_INFINITY
  let toMs = Number.NEGATIVE_INFINITY

  return {
    noteTimestamp() {
      timestampRows++
    },
    /** `ms` ist der GÜLTIGE Zeitstempel der Zeile — nur der Wert fehlt. */
    noteValue(ms: number) {
      valueRows++
      if (ms < fromMs) fromMs = ms
      if (ms > toMs) toMs = ms
    },
    finish(readings: RawReading[]): NormalizeResult {
      return {
        readings,
        parsedRows: readings.length,
        skippedRows: timestampRows + valueRows,
        skippedTimestampRows: timestampRows,
        skippedValueRows: valueRows,
        valueGapRange: valueRows > 0 ? { fromMs, toMs } : null,
      }
    },
  }
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
  const tally = createSkipTally()

  const isSummation = columns.consumptionCols != null || columns.feedInCols != null

  for (const row of dataRows) {
    const ms = rowTimestamp(row, columns, dateFormat, timezone)
    if (!Number.isFinite(ms)) {
      tally.noteTimestamp()
      continue
    }

    let kw: number
    if (isSummation) {
      // Mehrspalten-Mapping (OP#4): gridPowerKw = (Σ Verbrauch − Σ Einspeisung).
      const cons = sumCols(row, columns.consumptionCols ?? [], decimal)
      const feed = sumCols(row, columns.feedInCols ?? [], decimal)
      if (cons == null && feed == null) {
        tally.noteValue(ms)
        continue
      }
      kw = toKw((cons ?? 0) - (feed ?? 0), unit)
    } else if (source === 'import_export_split') {
      const imp = cellNumber(row[columns.import ?? -1] ?? null, decimal)
      const exp = cellNumber(row[columns.export ?? -1] ?? null, decimal)
      if (!Number.isFinite(imp) && !Number.isFinite(exp)) {
        tally.noteValue(ms)
        continue
      }
      kw = toKw((Number.isFinite(imp) ? imp : 0) - (Number.isFinite(exp) ? exp : 0), unit)
    } else {
      const v = cellNumber(row[columns.value ?? -1] ?? null, decimal)
      if (!Number.isFinite(v)) {
        tally.noteValue(ms)
        continue
      }
      // net_signed: Vorzeichenkonvention der Quelle berücksichtigen; import_only: bereits ≥0 gemeint.
      const signed = source === 'net_signed' && signConvention === 'export_positive' ? -v : v
      kw = toKw(signed, unit)
    }

    readings.push({ ms, value: kw })
  }

  return tally.finish(readings)
}

/** Normalisiert eine einzelne Wertspalte (für PvProfile: pvGenerationKw), §3.1. */
export function normalizeSingleValue(
  dataRows: RawCell[][],
  params: NormalizeParams,
): NormalizeResult {
  const { columns, dateFormat, decimal, unit, timezone } = params
  const readings: RawReading[] = []
  const tally = createSkipTally()

  for (const row of dataRows) {
    // Zeitstempel zuerst: ohne ihn lässt sich ein fehlender Wert keinem Zeitpunkt zuordnen.
    const ms = rowTimestamp(row, columns, dateFormat, timezone)
    if (!Number.isFinite(ms)) {
      tally.noteTimestamp()
      continue
    }
    const v = cellNumber(row[columns.value ?? -1] ?? null, decimal)
    if (!Number.isFinite(v)) {
      tally.noteValue(ms)
      continue
    }
    readings.push({ ms, value: toKw(v, unit) })
  }

  return tally.finish(readings)
}
