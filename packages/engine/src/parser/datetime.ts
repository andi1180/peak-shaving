import type { RawCell } from './types'

// Zeitstempel → UTC (§3.3). Deterministisch & isomorph: nutzt nur Date-Arithmetik + Intl
// (in Browser und Node vorhanden), keine tz-Bibliothek.

export type DateFormat = 'iso_offset' | 'iso_naive' | 'de_dot' | 'excel_serial'

const RE_ISO_OFFSET = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/
const RE_ISO_NAIVE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/
const RE_DE_DOT = /^(\d{1,2})\.(\d{1,2})\.(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/

// Plausibler Excel-Serial-Bereich (~1990..2100).
const EXCEL_MIN = 32000
const EXCEL_MAX = 75000

function isExcelSerial(cell: RawCell): boolean {
  return typeof cell === 'number' && cell > EXCEL_MIN && cell < EXCEL_MAX
}

function toStr(cell: RawCell): string {
  return cell == null ? '' : String(cell).trim()
}

/** Erkennt das Datumsformat aus Stichproben; null, wenn nichts überwiegend passt. */
export function detectDateFormat(samples: RawCell[]): DateFormat | null {
  const counts: Record<DateFormat, number> = {
    iso_offset: 0,
    iso_naive: 0,
    de_dot: 0,
    excel_serial: 0,
  }
  let total = 0
  for (const cell of samples) {
    if (cell == null || cell === '') continue
    total++
    if (isExcelSerial(cell)) {
      counts.excel_serial++
      continue
    }
    const s = toStr(cell)
    if (RE_ISO_OFFSET.test(s)) counts.iso_offset++
    else if (RE_ISO_NAIVE.test(s)) counts.iso_naive++
    else if (RE_DE_DOT.test(s)) counts.de_dot++
  }
  if (total === 0) return null
  let best: DateFormat | null = null
  let bestCount = 0
  for (const fmt of Object.keys(counts) as DateFormat[]) {
    if (counts[fmt] > bestCount) {
      bestCount = counts[fmt]
      best = fmt
    }
  }
  // Mindestens 60 % der Stichproben müssen passen, sonst „unbekannt".
  return best && bestCount / total >= 0.6 ? best : null
}

/** Lokale Kalenderfelder (Wanduhr) für einen UTC-Instant, via Intl (DST-bewusst). */
function localParts(utcInstant: number, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(new Date(utcInstant))
  const map: Record<string, number> = {}
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = Number(p.value)
  }
  return {
    year: map.year ?? 1970,
    month: map.month ?? 1,
    day: map.day ?? 1,
    hour: (map.hour ?? 0) === 24 ? 0 : (map.hour ?? 0),
    minute: map.minute ?? 0,
    second: map.second ?? 0,
  }
}

/** Offset (tz-Wanduhr minus UTC) in ms für den gegebenen UTC-Instant. */
function tzOffsetMs(utcInstant: number, timeZone: string): number {
  const { year, month, day, hour, minute, second } = localParts(utcInstant, timeZone)
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  return asUtc - utcInstant
}

/**
 * Lokale Kalenderfelder für einen UTC-Instant — Basis für §3.4-Gruppierung
 * (Monat/Wochentag/Stunde von Bezugsspitzen) außerhalb des Parsers selbst.
 * Wochentag: 0=Montag..6=Sonntag (ISO-nah, nicht JS-`getDay()`-Konvention).
 */
export function utcMsToLocalFields(
  utcMs: number,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const { year, month, day, hour, minute } = localParts(utcMs, timeZone)
  const weekday = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7
  return { year, month, day, hour, minute, weekday }
}

/** Naive Wanduhrzeit in `timeZone` → UTC-Millisekunden (DST-bewusst, Best-effort an Übergängen). */
export function zonedWallToUtcMs(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  timeZone: string,
): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s)
  // Zwei Iterationen stabilisieren den Offset auch nahe DST-Wechseln.
  const off1 = tzOffsetMs(guess, timeZone)
  const off2 = tzOffsetMs(guess - off1, timeZone)
  return guess - off2
}

function excelSerialToFields(serial: number): [number, number, number, number, number, number] {
  // Excel-Serial → Unix-ms (Serial 25569 = 1970-01-01), als naive Wanduhr interpretiert.
  const ms = Math.round((serial - 25569) * 86400 * 1000)
  const dt = new Date(ms)
  return [
    dt.getUTCFullYear(),
    dt.getUTCMonth() + 1,
    dt.getUTCDate(),
    dt.getUTCHours(),
    dt.getUTCMinutes(),
    dt.getUTCSeconds(),
  ]
}

/** Parst eine Zeitstempel-Zelle im erkannten Format nach UTC-Millisekunden. Ungültig → NaN. */
export function parseTimestamp(cell: RawCell, format: DateFormat, timeZone: string): number {
  if (format === 'excel_serial') {
    if (typeof cell !== 'number') return NaN
    const [y, mo, d, h, mi, s] = excelSerialToFields(cell)
    // [ANNAHME: unbestätigt bis Martins Muster (OP#4)] XLSX-Datumszellen sind naive lokale Wanduhrzeit.
    return zonedWallToUtcMs(y, mo, d, h, mi, s, timeZone)
  }
  const s = toStr(cell)
  if (format === 'iso_offset') {
    const iso = s.includes('T') ? s : s.replace(' ', 'T')
    const ms = Date.parse(iso)
    return Number.isNaN(ms) ? NaN : ms
  }
  if (format === 'iso_naive') {
    const m = RE_ISO_NAIVE.exec(s)
    if (!m) return NaN
    return zonedWallToUtcMs(
      Number(m[1]),
      Number(m[2]),
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6] ?? '0'),
      timeZone,
    )
  }
  // de_dot
  const m = RE_DE_DOT.exec(s)
  if (!m) return NaN
  return zonedWallToUtcMs(
    Number(m[3]),
    Number(m[2]),
    Number(m[1]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? '0'),
    timeZone,
  )
}

/** UTC-Millisekunden → ISO-String mit 'Z' (Contract: LoadProfile.ts ist ISO/UTC). */
export function toIsoUtc(ms: number): string {
  return new Date(ms).toISOString()
}
