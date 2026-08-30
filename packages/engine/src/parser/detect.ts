import type { LoadSource } from 'shared'

import {
  detectDateFormat,
  detectDateOnlyFormat,
  looksLikeTimeColumn,
  type DateFormat,
} from './datetime'
import { detectDecimalSeparator, looksNumeric, parseNumber, type DecimalSeparator } from './number'
import type { ColumnRole, RawCell, Unit, ValueColumnInfo } from './types'

const SAMPLE_ROWS = 60

// Header-Schlüsselwörter zur Import/Export-Unterscheidung.
// [ANNAHME: unbestätigt bis Martins Muster (OP#4)] — inkl. der OBIS-artigen Kürzel 1.8.0/2.8.0.
const IMPORT_KEYS = ['bezug', 'import', 'verbrauch', 'netzbezug', 'wirkbezug', 'einkauf', '1.8.0']
const EXPORT_KEYS = ['einspeis', 'export', 'lieferung', 'erzeug', 'rückspeis', 'ruckspeis', '2.8.0']
// EEG-/Energiegemeinschafts-Verrechnungsartefakte — KEIN Netz-Lastgang, Default `ignore` (OP#4).
// "überschuss" als Teilstring deckt auch "restüberschuss" ab.
const EEG_KEYS = ['überschuss', 'uberschuss']
// Split-Timestamp: Zeitspalten-Kopfzeilen, die Beginn vs. Ende eines Intervalls markieren.
const TIME_START_KEYS = ['von', 'beginn', 'start', 'from']
const TIME_END_KEYS = ['bis', 'ende']

export type DetectionDraft = {
  headerRow: number | null
  /** Kleingeschriebene Header (Erkennung). */
  headers: string[]
  /** Original-Header (Anzeige/Zählpunkt-ID). */
  rawHeaders: string[]
  dataRows: RawCell[][]
  timestampCol: number | null
  /** Split-Timestamp: Zeitspalte (Intervall-START), wenn `timestampCol` nur das Datum trägt. */
  timeColumn: number | null
  dateFormat: DateFormat | null
  decimal: DecimalSeparator
  valueCols: number[]
  /** Klassifizierte Wert-Spalten (Rollen-Vorschläge) — Basis des Mehrspalten-Mappings. */
  valueColumnInfos: ValueColumnInfo[]
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

/**
 * Zweite Stichprobe, GLEICHMÄSSIG über die ganze Datei verteilt (erste UND letzte Datenzeile
 * inklusive) — die Rückfallebene für Dateien mit langem Anfangs-Leerlauf.
 *
 * ⚠ Warum es sie braucht: `columnSamples` liest die ERSTEN `SAMPLE_ROWS` Datenzeilen. Ein realer
 * Netzbetreiber-Export kann über Tausende Zeilen hinweg Zeitstempel führen, die Wert-Zellen aber
 * leer lassen (der Zählpunkt war noch nicht in Betrieb, die Fernauslesung begann später) und erst
 * danach echte Messwerte tragen. In der Kopf-Stichprobe ist dann JEDE Zelle leer, `numericFraction`
 * liefert 0, es wird keine einzige Wert-Spalte gefunden — und der Parser lehnt eine vollständig
 * brauchbare Datei mit `no_value_column` ab. An einem realen Kundenexport gemessen (rund 15.000
 * leere Wert-Zellen vor dem ersten Messwert): abgelehnt wurde nicht eine unlesbare Datei, sondern
 * eine, deren Daten weiter hinten stehen.
 *
 * Bewusst KEIN Ersatz für die Kopf-Stichprobe, sondern eine Ergänzung, die ausschliesslich greift,
 * wenn die Kopf-Stichprobe GAR NICHTS gefunden hat (s. `detectStructure`). Dadurch kann sie eine
 * bereits erkannte Struktur nicht verändern — sie kann nur eine bisher abgelehnte Datei retten.
 * Eine spaltenweise Ausweitung („für jede Spalte, die im Kopf nichts hergab, zusätzlich verteilt
 * nachsehen") wäre genau das nicht: sie könnte eine heute einspaltige Erkennung still zu einer
 * zweispaltigen machen und damit `source` und Vorzeichenrechnung einer Bestandsdatei ändern.
 */
function spreadColumnSamples(rows: RawCell[][], col: number, n = SAMPLE_ROWS): RawCell[] {
  const count = Math.min(n, rows.length)
  if (count === 0) return []
  if (count === 1) return [rows[0]?.[col] ?? null]
  const out: RawCell[] = []
  for (let k = 0; k < count; k++) {
    // k = 0 → erste Zeile, k = count-1 → LETZTE Zeile, dazwischen gleichmässig verteilt.
    out.push(rows[Math.round(((rows.length - 1) * k) / (count - 1))]?.[col] ?? null)
  }
  return out
}

/** Woher die Stichprobe einer Spalte kommt — Dateikopf oder über die ganze Datei verteilt. */
type ColumnSampler = (col: number) => RawCell[]

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

/** Einheit aus einem EINZELNEN Header (Mehrspalten-Mapping: je Spalte). */
function unitFromHeader(header: string): Unit | 'unknown' {
  const t = header.toLowerCase()
  if (/kwh|kw h|kw·h/.test(t)) return 'kWh'
  if (/\bkw\b|k w/.test(t)) return 'kW'
  return 'unknown'
}

function isEeg(header: string): boolean {
  return matchKeys(header, EEG_KEYS)
}

/** Rollen-Vorschlag je Wert-Spalte. EEG zuerst (Default `ignore`), sonst Einspeisung/Verbrauch per Keyword. */
function classifyRole(header: string): ColumnRole {
  if (isEeg(header)) return 'ignore'
  if (matchKeys(header, EXPORT_KEYS)) return 'feed_in'
  if (matchKeys(header, IMPORT_KEYS)) return 'consumption'
  return 'ignore' // unklassifiziert → sicherer Default, nicht still als Verbrauch werten
}

/** Zählpunkt-ID (österr. Zählpunktbezeichnung „AT…") aus dem Header, falls vorhanden. */
function extractMeteringPointId(header: string): string | null {
  const m = /\bAT\d{8,}\b/i.exec(header)
  return m ? m[0].toUpperCase() : null
}

/**
 * Erkennt einen Wechselrichter-/ESS-Export (OP#4, Format B): reines Speicher-/PV-Log OHNE Netzbezug
 * (Ein-/Ausgangsleistung, Batterielade-/-entladeleistung). Solche Dateien sind KEIN Netz-Lastgang
 * und werden fachlich abgelehnt, statt einen Lastgang daraus zu konstruieren.
 */
export function isInverterExport(headers: string[]): boolean {
  const text = headers.join(' ').toLowerCase()
  if (text.includes('energy storage system')) return true
  if (text.includes('batterieladeleistung') || text.includes('batterieentladeleistung')) return true
  return text.includes('eingangsleistung') && text.includes('ausgangsleistung')
}

/** Wählt aus mehreren Zeit-Only-Spalten den Intervall-START (Von-Spalte), sonst die erste. */
function pickStartTimeCol(timeCols: number[], headers: string[]): number {
  const start = timeCols.find((c) => matchKeys(headers[c] ?? '', TIME_START_KEYS))
  if (start != null) return start
  const nonEnd = timeCols.filter((c) => !matchKeys(headers[c] ?? '', TIME_END_KEYS))
  return nonEnd[0] ?? timeCols[0]!
}

type TimestampDetection = {
  timestampCol: number | null
  timeColumn: number | null
  dateFormat: DateFormat | null
}

/**
 * Zeitstempel-Spalte(n) aus EINER Stichprobe: (1) kombinierte Datum+Zeit-Spalte, sonst
 * (2) Split-Timestamp (getrennte Datums- + Zeitspalte, OP#4). Der Ablauf ist unverändert der
 * bisherige — herausgezogen ist er nur, damit dieselbe Logik auch mit der verteilten Stichprobe
 * laufen kann (s. `spreadColumnSamples`).
 */
function detectTimestampColumns(
  width: number,
  headers: string[],
  sample: ColumnSampler,
): TimestampDetection {
  // (1) Kombinierter Zeitstempel: erste Spalte, deren Stichprobe ein Datum+Zeit-Format ergibt.
  for (let col = 0; col < width; col++) {
    const fmt = detectDateFormat(sample(col))
    if (fmt) return { timestampCol: col, timeColumn: null, dateFormat: fmt }
  }

  // (2) Split-Timestamp (OP#4): keine kombinierte Spalte gefunden → getrennte Datums- + Zeitspalte.
  let dateCol: number | null = null
  let dateOnlyFmt: DateFormat | null = null
  for (let col = 0; col < width; col++) {
    const fmt = detectDateOnlyFormat(sample(col))
    if (fmt) {
      dateCol = col
      dateOnlyFmt = fmt
      break
    }
  }
  if (dateCol != null) {
    const timeCols: number[] = []
    for (let col = 0; col < width; col++) {
      if (col === dateCol) continue
      if (looksLikeTimeColumn(sample(col))) timeCols.push(col)
    }
    if (timeCols.length >= 1) {
      return {
        timestampCol: dateCol,
        timeColumn: pickStartTimeCol(timeCols, headers),
        dateFormat: dateOnlyFmt,
      }
    }
  }

  return { timestampCol: null, timeColumn: null, dateFormat: null }
}

/** Spalten, deren Stichprobe überwiegend Zahlen trägt — Zeitstempel-/Zeitspalte ausgenommen. */
function findValueCandidates(
  width: number,
  timestampCol: number | null,
  timeColumn: number | null,
  decimal: DecimalSeparator,
  sample: ColumnSampler,
): number[] {
  const out: number[] = []
  for (let col = 0; col < width; col++) {
    if (col === timestampCol || col === timeColumn) continue
    if (numericFraction(sample(col), decimal) >= 0.6) out.push(col)
  }
  return out
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
  const headerCells = headerRow === null ? [] : (matrix[headerRow] ?? [])
  const rawHeaders = headerCells.map((c) => toStr(c))
  const headers = rawHeaders.map((h) => h.toLowerCase())
  const dataRows = matrix.slice(headerRow === null ? 0 : headerRow + 1)
  const width = rowWidth(matrix)

  // Zwei Stichproben-Arten: der Dateikopf (wie bisher) und, als Rückfallebene, eine über die ganze
  // Datei verteilte. Die verteilte lohnt nur, wenn es überhaupt mehr Zeilen gibt, als die
  // Kopf-Stichprobe liest — sonst liefert sie dieselben Zellen und der zweite Anlauf wäre umsonst.
  const head: ColumnSampler = (col) => columnSamples(dataRows, col)
  const spread: ColumnSampler = (col) => spreadColumnSamples(dataRows, col)
  const hasRowsBeyondHead = dataRows.length > SAMPLE_ROWS

  // Zeitstempel. Der zweite Anlauf läuft NUR, wenn der erste nichts gefunden hat — dann steht heute
  // ohnehin `no_timestamp_column` am Ende, er kann also keine bestehende Erkennung verändern.
  let ts = detectTimestampColumns(width, headers, head)
  if (ts.timestampCol == null && hasRowsBeyondHead) {
    ts = detectTimestampColumns(width, headers, spread)
  }
  const { timestampCol, timeColumn, dateFormat } = ts

  // Wert-Spalten. Ebenfalls zweistufig, und ebenfalls nur als Ganzes: fand der Kopf mindestens EINE
  // Spalte, bleibt es exakt bei seinem Ergebnis (sonst könnte eine im Kopf leere Zusatzspalte eine
  // heute einspaltige Datei still zu einer zweispaltigen machen — und damit `source` kippen).
  let valueSampler = head
  let valueCandidates = findValueCandidates(width, timestampCol, timeColumn, decimalGuess, head)
  if (valueCandidates.length === 0 && hasRowsBeyondHead) {
    valueSampler = spread
    valueCandidates = findValueCandidates(width, timestampCol, timeColumn, decimalGuess, spread)
  }

  // Dezimaltrenner aus den Wert-Spalten verfeinern — aus DERSELBEN Stichprobe, die die Spalten
  // gefunden hat: bei einem geretteten Anfangs-Leerlauf trüge die Kopf-Stichprobe nur leere Zellen
  // und der Trenner fiele grundlos auf die Grobschätzung zurück.
  const valueStrings: string[] = []
  for (const col of valueCandidates) {
    for (const c of valueSampler(col)) {
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
    //
    // ⚠ BEWUSST die KOPF-Stichprobe, auch wenn die Wert-Spalte über `spread` gerettet wurde: die
    // Vorzeichen-Erkennung bleibt von diesem Schritt unangetastet. Sie hier mitzuweiten änderte das
    // Etikett bestehender Dateien (bekannt und dokumentiert: ein signierter Lastgang, dessen erste
    // Einspeisung nach Zeile 60 liegt, gilt heute als `import_only` — B21-3a). Folgenlos für die
    // ZAHLEN (`normalizeLoad` klemmt bei `import_only` nichts weg), aber eine repoweite Änderung
    // der Quellen-Erkennung, die in einen eigenen Schritt gehört und nicht als Nebenwirkung hier.
    source = hasNegative(columnSamples(dataRows, col), decimal) ? 'net_signed' : 'import_only'
  } else {
    source = 'import_only'
  }

  // Klassifizierte Wert-Spalten für das Mehrspalten-Mapping (§3.2/OP#4).
  const valueColumnInfos: ValueColumnInfo[] = valueCandidates.map((col) => {
    const raw = rawHeaders[col] ?? ''
    return {
      index: col,
      header: raw || `Spalte ${col + 1}`,
      meteringPointId: extractMeteringPointId(raw),
      unit: unitFromHeader(raw),
      suggestedRole: classifyRole(headers[col] ?? ''),
      eegAccounting: isEeg(headers[col] ?? ''),
    }
  })

  return {
    headerRow,
    headers,
    rawHeaders,
    dataRows,
    timestampCol,
    timeColumn,
    dateFormat,
    decimal,
    valueCols,
    valueColumnInfos,
    importCol,
    exportCol,
    unit,
    source,
  }
}
