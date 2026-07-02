import Papa from 'papaparse'
import * as XLSX from 'xlsx'

import type { FileFormat, RawCell, RawFileInput } from './types'

export type ExtractedTable = {
  format: FileFormat
  matrix: RawCell[][]
  delimiter?: string
}

const DELIMITER_CANDIDATES = [';', '\t', ',', '|']

function toUint8(content: string | ArrayBuffer | Uint8Array): Uint8Array {
  if (content instanceof Uint8Array) return content
  if (content instanceof ArrayBuffer) return new Uint8Array(content)
  return new TextEncoder().encode(content)
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

function detectFormat(input: RawFileInput): FileFormat {
  if (input.format) return input.format
  const name = input.fileName?.toLowerCase() ?? ''
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return 'xlsx'
  if (name.endsWith('.csv') || name.endsWith('.txt')) return 'csv'
  return typeof input.content === 'string' ? 'csv' : 'xlsx'
}

/** Wählt den Trenner, der auf möglichst vielen der ersten Zeilen konsistent vorkommt. */
export function detectDelimiter(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .slice(0, 5)
  if (lines.length === 0) return ','
  let best = ','
  let bestScore = -1
  for (const d of DELIMITER_CANDIDATES) {
    const counts = lines.map((l) => l.split(d).length - 1)
    const min = Math.min(...counts)
    if (min > bestScore) {
      bestScore = min
      best = d
    }
  }
  return best
}

/** Extrahiert eine rohe Zell-Matrix aus CSV/XLSX. Kein I/O — Inhalt kommt vom Aufrufer. */
export function extractTable(input: RawFileInput, delimiterOverride?: string): ExtractedTable {
  const format = detectFormat(input)

  if (format === 'csv') {
    const text = stripBom(
      typeof input.content === 'string'
        ? input.content
        : new TextDecoder().decode(toUint8(input.content)),
    )
    const delimiter = delimiterOverride ?? detectDelimiter(text)
    const res = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: 'greedy' })
    return { format, matrix: res.data as RawCell[][], delimiter }
  }

  const wb = XLSX.read(toUint8(input.content), { type: 'array' })
  const sheetName = wb.SheetNames[0]
  const ws = sheetName ? wb.Sheets[sheetName] : undefined
  if (!ws) return { format, matrix: [] }
  const matrix = XLSX.utils.sheet_to_json<RawCell[]>(ws, {
    header: 1,
    raw: true,
    blankrows: false,
    defval: null,
  })
  return { format, matrix }
}
