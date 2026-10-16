import * as XLSX from 'xlsx'
import type { HourlyEnergyReading } from './combine-hourly-export'
import { toIsoUtc, utcMsToLocalFields } from './datetime'
import type { RawCell } from './types'

const MS_PER_HOUR = 60 * 60 * 1000
const HEADER_SEARCH_ROWS = 10

/** Pflichtspalten des stündlichen Anlagenberichts — exakte Namen, keine Stichwörter. */
const TIME_HEADER = 'Statistischer Zeitraum'
const EXPORT_HEADER = 'Netzeinspeisung (kWh)'
const IMPORT_HEADER = 'Netzbezug (kWh)'

export type PlantReportFile = { name: string; data: ArrayBuffer | Uint8Array }

export type PlantReportFileSummary = {
  name: string
  from: string | null
  to: string | null
  hours: number
}

export type HourlyPlantReportDiagnostics = {
  files: number
  /** Stunden mit mindestens einem Wert (Einspeisung oder Bezug). */
  hours: number
  /** Erste Stunde bis Ende der letzten (exklusiv), UTC-ISO; `null` ohne Stunde. */
  range: { from: string; to: string } | null
  /** Dieselbe Stunde in mehreren Dateien — die erste bleibt. */
  duplicateHours: number
  /** Winterzeit-Stunde nur einmal vorhanden — als Sommerzeit gewertet. */
  ambiguousHours: number
  /** Zeile mit unlesbarer oder nicht existierender Zeit, negativem oder nicht endlichem Wert. */
  skippedRows: number
  perFile: PlantReportFileSummary[]
}

export type HourlyPlantReportResult =
  | {
      exportHourly: HourlyEnergyReading[]
      importHourly: HourlyEnergyReading[]
      diagnostics: HourlyPlantReportDiagnostics
    }
  | {
      error: 'unknown_format'
      file: string
      /** Gefundene Kopfzellen, normalisiert, höchstens 15. */ headers: string[]
    }
  | { error: 'no_rows'; file: string }

const MAX_REPORTED_HEADERS = 15

/** `dst`: Zusatz „ DST" im Zeitstempel (Portal kennzeichnet so jede Sommerzeit-Stunde). */
type Wall = { y: number; mo: number; d: number; h: number; mi: number; s: number; dst?: true }

const RE_WALL = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(\s+dst)?$/i

function cellText(cell: RawCell | undefined): string {
  return cell == null ? '' : String(cell).trim()
}

function parseWall(cell: RawCell | undefined): Wall | null {
  if (typeof cell === 'number' && Number.isFinite(cell)) {
    // Excel-Serial als naive Wanduhr (Serial 25569 = 1970-01-01).
    const dt = new Date(Math.round((cell - 25569) * 86_400_000))
    return {
      y: dt.getUTCFullYear(),
      mo: dt.getUTCMonth() + 1,
      d: dt.getUTCDate(),
      h: dt.getUTCHours(),
      mi: dt.getUTCMinutes(),
      s: dt.getUTCSeconds(),
    }
  }
  const m = RE_WALL.exec(cellText(cell))
  if (!m) return null
  return {
    y: +m[1]!,
    mo: +m[2]!,
    d: +m[3]!,
    h: +m[4]!,
    mi: +m[5]!,
    s: +(m[6] ?? 0),
    ...(m[7] ? { dst: true as const } : {}),
  }
}

function matchesWall(utcMs: number, wall: Wall, timeZone: string): boolean {
  const f = utcMsToLocalFields(utcMs, timeZone)
  return (
    f.year === wall.y &&
    f.month === wall.mo &&
    f.day === wall.d &&
    f.hour === wall.h &&
    f.minute === wall.mi
  )
}

function offsetAt(utcMs: number, timeZone: string): number {
  const f = utcMsToLocalFields(utcMs, timeZone)
  return Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute) - (utcMs - (utcMs % 60_000))
}

/** Alle UTC-Instants, die diese Wanduhrzeit tragen, aufsteigend: 0 (Sommerzeit-Lücke), 1 oder 2 (Doppelstunde). */
function wallToUtcCandidates(wall: Wall, timeZone: string): number[] {
  const naive = Date.UTC(wall.y, wall.mo - 1, wall.d, wall.h, wall.mi, wall.s)
  const offsets = new Set([
    offsetAt(naive - 3 * MS_PER_HOUR, timeZone),
    offsetAt(naive + 3 * MS_PER_HOUR, timeZone),
  ])
  return [...offsets]
    .map((offset) => naive - offset)
    .filter((ms) => matchesWall(ms, wall, timeZone))
    .sort((a, b) => a - b)
}

/** Normalzeit-Offset der Zone im Jahr (kleinerer der Offsets von Jänner und Juli). */
function standardOffset(year: number, timeZone: string): number {
  return Math.min(
    offsetAt(Date.UTC(year, 0, 1), timeZone),
    offsetAt(Date.UTC(year, 6, 1), timeZone),
  )
}

/**
 * Kandidaten eines Berichts MIT Sommerzeit-Kennzeichnung: „ DST" → nur Sommerzeit-Instant, ohne
 * Zusatz → nur Normalzeit-Instant. Die Doppelstunde ist damit eindeutig; passt keiner (Zusatz
 * ohne Sommerzeit oder Sommerzeit ohne Zusatz), wird die Zeile übersprungen.
 */
function markedCandidates(wall: Wall, timeZone: string): number[] {
  const naive = Date.UTC(wall.y, wall.mo - 1, wall.d, wall.h, wall.mi, wall.s)
  const standard = standardOffset(wall.y, timeZone)
  return wallToUtcCandidates(wall, timeZone).filter((ms) =>
    wall.dst ? naive - ms > standard : naive - ms === standard,
  )
}

/** Wert einer Zelle: `undefined` = leer (fehlt), `NaN` = ungültig, sonst die Zahl. */
function cellValue(cell: RawCell | undefined): number | undefined {
  if (typeof cell === 'number') return cell
  const text = cellText(cell)
  if (text === '') return undefined
  return /^[+-]?\d+(\.\d+)?$/.test(text) ? Number(text) : Number.NaN
}

/** Vergleichsform eines Spaltennamens: NFKC, jede Whitespace-Art (inkl. U+00A0/U+202F, Umbruch) → ein Leerzeichen, klein. */
function normalizeHeader(cell: RawCell | undefined): string {
  return cellText(cell).normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase()
}

const TIME_KEY = normalizeHeader(TIME_HEADER)
const EXPORT_KEY = normalizeHeader(EXPORT_HEADER)
const IMPORT_KEY = normalizeHeader(IMPORT_HEADER)

/**
 * Erstes Blatt als Matrix über den TATSÄCHLICH belegten Bereich. Portal-Exporte deklarieren in
 * `<dimension>` teils einen zu kleinen Bereich (gemessen: `A4:…` bei Titel in Zeile 1, Kopf in
 * Zeile 2) — über `!ref` gelesen fehlten Titel, Kopf und die erste Datenstunde. Bewusst hier und
 * nicht in `extractTable`, das der Lastgang-Parser teilt.
 */
function readMatrix(file: PlantReportFile): RawCell[][] {
  const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data)
  const wb = XLSX.read(data, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  const ws = sheetName ? wb.Sheets[sheetName] : undefined
  if (!ws) return []
  let range: XLSX.Range | null = null
  for (const key of Object.keys(ws)) {
    if (key.startsWith('!')) continue
    const { r, c } = XLSX.utils.decode_cell(key)
    if (range === null) range = { s: { r, c }, e: { r, c } }
    else {
      range.s.r = Math.min(range.s.r, r)
      range.s.c = Math.min(range.s.c, c)
      range.e.r = Math.max(range.e.r, r)
      range.e.c = Math.max(range.e.c, c)
    }
  }
  if (range === null) return []
  return XLSX.utils.sheet_to_json<RawCell[]>(ws, {
    header: 1,
    raw: true,
    blankrows: false,
    defval: null,
    range: XLSX.utils.encode_range(range),
  })
}

/** Die textreichste Zeile der Kopfsuche — für die Fehlermeldung, damit eine Abweichung sichtbar wird. */
function foundHeaders(matrix: readonly RawCell[][]): string[] {
  let best: string[] = []
  for (const row of matrix.slice(0, HEADER_SEARCH_ROWS)) {
    const texts = row
      .filter((cell) => typeof cell === 'string')
      .map(normalizeHeader)
      .filter((t) => t !== '')
    if (texts.length > best.length) best = texts
  }
  return best.slice(0, MAX_REPORTED_HEADERS)
}

type FileRows = {
  rows: { ms: number; exportKwh?: number; importKwh?: number }[]
  ambiguous: number
  skipped: number
}

function readFile(
  file: PlantReportFile,
  timeZone: string,
): FileRows | { unknownFormat: string[] } | 'no_rows' {
  const matrix = readMatrix(file)
  const headerIndex = matrix
    .slice(0, HEADER_SEARCH_ROWS)
    .findIndex((row) => row.some((cell) => normalizeHeader(cell) === TIME_KEY))
  if (headerIndex < 0) return { unknownFormat: foundHeaders(matrix) }
  const header = matrix[headerIndex]!.map(normalizeHeader)
  const timeCol = header.indexOf(TIME_KEY)
  const exportCol = header.indexOf(EXPORT_KEY)
  const importCol = header.indexOf(IMPORT_KEY)
  if (exportCol < 0 || importCol < 0) {
    return { unknownFormat: header.filter((t) => t !== '').slice(0, MAX_REPORTED_HEADERS) }
  }

  const dataRows = matrix
    .slice(headerIndex + 1)
    .filter((row) => row.some((cell) => cellText(cell) !== ''))
  if (dataRows.length === 0) return 'no_rows'

  // Trägt der Bericht irgendwo „ DST", ist jeder Zeitstempel ausdrücklich Sommer- oder Normalzeit.
  const marked = dataRows.some((row) => parseWall(row[timeCol])?.dst === true)
  const result: FileRows = { rows: [], ambiguous: 0, skipped: 0 }
  // Je mehrdeutiger Wanduhrzeit: wie oft schon gesehen (erste = Sommerzeit, zweite = Winterzeit).
  const ambiguousSeen = new Map<string, number>()
  for (const row of dataRows) {
    const wall = parseWall(row[timeCol])
    const exportKwh = cellValue(row[exportCol])
    const importKwh = cellValue(row[importCol])
    const invalid = [exportKwh, importKwh].some(
      (v) => v !== undefined && !(Number.isFinite(v) && v >= 0),
    )
    const candidates = !wall
      ? []
      : marked
        ? markedCandidates(wall, timeZone)
        : wallToUtcCandidates(wall, timeZone)
    if (invalid || candidates.length === 0) {
      result.skipped++
      continue
    }
    let ms = candidates[0]!
    if (candidates.length > 1) {
      const key = `${wall!.y}-${wall!.mo}-${wall!.d}-${wall!.h}-${wall!.mi}`
      const seen = ambiguousSeen.get(key) ?? 0
      if (seen >= candidates.length) {
        result.skipped++
        continue
      }
      ambiguousSeen.set(key, seen + 1)
      ms = candidates[seen]!
    }
    result.rows.push({
      ms,
      ...(exportKwh !== undefined ? { exportKwh } : {}),
      ...(importKwh !== undefined ? { importKwh } : {}),
    })
  }
  for (const seen of ambiguousSeen.values()) if (seen === 1) result.ambiguous++
  return result
}

function rangeOf(hours: readonly number[]): { from: string; to: string } | null {
  if (hours.length === 0) return null
  let min = hours[0]!
  let max = hours[0]!
  for (const ms of hours) {
    if (ms < min) min = ms
    if (ms > max) max = ms
  }
  return { from: toIsoUtc(min), to: toIsoUtc(max + MS_PER_HOUR) }
}

/**
 * Stündliche Anlagenberichte eines Wechselrichter-Portals (je Monat eine xlsx) → Einspeisung und
 * Bezug je Stunde für `combineImportWithHourlyExport`.
 *
 * Spalten über ihren exakten Namen, nicht über Stichwörter: „Verbrauch" und „Eigenverbrauch" träfen
 * das Bezugs-Stichwort der Lastgang-Erkennung. Eine leere Zelle ist ein fehlender Wert, keine 0.
 */
export function parseHourlyPlantReports(
  files: readonly PlantReportFile[],
  timezone = 'Europe/Vienna',
): HourlyPlantReportResult {
  const exportByHour = new Map<number, number>()
  const importByHour = new Map<number, number>()
  const seenHours = new Set<number>()
  const perFile: PlantReportFileSummary[] = []
  let duplicateHours = 0
  let ambiguousHours = 0
  let skippedRows = 0

  for (const file of files) {
    const read = readFile(file, timezone)
    if (read === 'no_rows') return { error: 'no_rows', file: file.name }
    if ('unknownFormat' in read) {
      return { error: 'unknown_format', file: file.name, headers: read.unknownFormat }
    }
    ambiguousHours += read.ambiguous
    skippedRows += read.skipped
    const fileHours: number[] = []
    for (const row of read.rows) {
      if (seenHours.has(row.ms)) {
        duplicateHours++
        continue
      }
      seenHours.add(row.ms)
      if (row.exportKwh !== undefined) exportByHour.set(row.ms, row.exportKwh)
      if (row.importKwh !== undefined) importByHour.set(row.ms, row.importKwh)
      if (row.exportKwh !== undefined || row.importKwh !== undefined) fileHours.push(row.ms)
    }
    const range = rangeOf(fileHours)
    perFile.push({
      name: file.name,
      from: range?.from ?? null,
      to: range?.to ?? null,
      hours: fileHours.length,
    })
  }

  const toReadings = (map: Map<number, number>): HourlyEnergyReading[] =>
    [...map].sort((a, b) => a[0] - b[0]).map(([ms, kwh]) => ({ ts: toIsoUtc(ms), kwh }))
  const valued = [...seenHours].filter((ms) => exportByHour.has(ms) || importByHour.has(ms))

  return {
    exportHourly: toReadings(exportByHour),
    importHourly: toReadings(importByHour),
    diagnostics: {
      files: files.length,
      hours: valued.length,
      range: rangeOf(valued),
      duplicateHours,
      ambiguousHours,
      skippedRows,
      perFile,
    },
  }
}
