import type { RawCell } from './types'

// Zeitstempel → UTC (§3.3). Deterministisch & isomorph: nutzt nur Date-Arithmetik + Intl
// (in Browser und Node vorhanden), keine tz-Bibliothek.

export type DateFormat =
  | 'iso_offset'
  | 'iso_naive'
  | 'de_dot'
  | 'excel_serial'
  | 'de_month_name' // "17/März/2026 00:00" — kombiniert, ausgeschriebener dt. Monatsname (OP#4, Format B)
  | 'de_dot_date' // "16.06.2026" — NUR Datum (Split-Timestamp: eigene Zeitspalte, OP#4, Format A)
  | 'iso_date' // "2026-06-16" — NUR Datum (Split-Timestamp)

const RE_ISO_OFFSET = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/
const RE_ISO_NAIVE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/
const RE_DE_DOT = /^(\d{1,2})\.(\d{1,2})\.(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/

// Split-Timestamp (OP#4): getrennte Datums- und Zeitspalten. Datums-Only + Zeit-Only.
const RE_DE_DOT_DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/
const RE_ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const RE_TIME = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/

// Kombinierter Zeitstempel mit ausgeschriebenem deutschem Monatsnamen: "17/März/2026 00:00"
// (Format B). Trenner tolerant (/ . - Leerzeichen); Datum↔Zeit per Leerzeichen oder T.
const RE_DE_MONTH =
  /^(\d{1,2})[./ -]([A-Za-zäöüÄÖÜ]+)[./ -](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/

// [ANNAHME: unbestätigt bis Martins Muster (OP#4)] Ausgeschriebene dt. Monatsnamen inkl.
// österreichischer Varianten (Jänner/Feber) + gängiger 3-Buchstaben-Kürzel (ohne Punkt).
const DE_MONTHS: Record<string, number> = {
  januar: 1, jänner: 1, jaenner: 1, jan: 1, jän: 1,
  februar: 2, feber: 2, feb: 2,
  märz: 3, maerz: 3, mär: 3, mrz: 3,
  april: 4, apr: 4,
  mai: 5,
  juni: 6, jun: 6,
  juli: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sept: 9, sep: 9,
  oktober: 10, okt: 10,
  november: 11, nov: 11,
  dezember: 12, dez: 12,
}

function monthNameToNum(name: string): number | null {
  return DE_MONTHS[name.toLowerCase()] ?? null
}

// Plausibler Excel-Serial-Bereich (~1990..2100).
const EXCEL_MIN = 32000
const EXCEL_MAX = 75000

function isExcelSerial(cell: RawCell): boolean {
  return typeof cell === 'number' && cell > EXCEL_MIN && cell < EXCEL_MAX
}

function toStr(cell: RawCell): string {
  return cell == null ? '' : String(cell).trim()
}

/**
 * Erkennt ein KOMBINIERTES Datum+Zeit-Format aus Stichproben; null, wenn nichts überwiegend passt.
 * Datums-Only-Formate (Split-Timestamp) matchen hier bewusst NICHT — die erkennt `detectDateOnlyFormat`.
 */
export function detectDateFormat(samples: RawCell[]): DateFormat | null {
  const counts: Record<DateFormat, number> = {
    iso_offset: 0,
    iso_naive: 0,
    de_dot: 0,
    excel_serial: 0,
    de_month_name: 0,
    de_dot_date: 0, // date-only Formate zählen hier nie (nur zur Vollständigkeit des Record)
    iso_date: 0,
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
    else {
      const m = RE_DE_MONTH.exec(s)
      if (m && monthNameToNum(m[2]!) != null) counts.de_month_name++
    }
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

/** Erkennt ein reines DATUMS-Format (ohne Uhrzeit) — Basis der Split-Timestamp-Erkennung (OP#4). */
export function detectDateOnlyFormat(samples: RawCell[]): DateFormat | null {
  let de = 0
  let iso = 0
  let total = 0
  for (const cell of samples) {
    if (cell == null || cell === '') continue
    total++
    const s = toStr(cell)
    if (RE_DE_DOT_DATE.test(s)) de++
    else if (RE_ISO_DATE.test(s)) iso++
  }
  if (total === 0) return null
  if (de >= iso && de / total >= 0.6) return 'de_dot_date'
  if (iso / total >= 0.6) return 'iso_date'
  return null
}

/** True, wenn die Stichprobe überwiegend reine Uhrzeiten (HH:MM[:SS]) trägt — Split-Timestamp-Zeitspalte. */
export function looksLikeTimeColumn(samples: RawCell[]): boolean {
  let ok = 0
  let total = 0
  for (const cell of samples) {
    if (cell == null || cell === '') continue
    total++
    if (RE_TIME.test(toStr(cell))) ok++
  }
  return total > 0 && ok / total >= 0.6
}

/**
 * Ein `Intl.DateTimeFormat` je Zeitzone, memoisiert. Der KONSTRUKTOR ist teuer (lädt Locale-/
 * Zeitzonendaten), ein einmal gebautes Format aber über beliebig viele Instants wiederverwendbar
 * (die Optionen unten sind fix). Ohne diese Memoisierung baute `localParts` pro Aufruf ein neues
 * Format — bei 35.040 Viertelstunden × mehreren Pipeline-Pässen (Kapp-Suche, Reserve, Zuschreibung,
 * Trace) × Katalog-Kandidaten sind das über 1 Mio. Konstruktionen und der dominante Kostenfaktor
 * des `recommendBattery`-Laufs (§3.6/§3.8). Prozessweit gültig: die Zeitzonenregeln sind konstant.
 */
const formatterByTimeZone = new Map<string, Intl.DateTimeFormat>()

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let dtf = formatterByTimeZone.get(timeZone)
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatterByTimeZone.set(timeZone, dtf)
  }
  return dtf
}

/** Lokale Kalenderfelder (Wanduhr) für einen UTC-Instant, via Intl (DST-bewusst). */
function localParts(utcInstant: number, timeZone: string) {
  const parts = getFormatter(timeZone).formatToParts(new Date(utcInstant))
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

export type LocalFields = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: number
}

/**
 * Reine Memoisierung von (Zeitzone, utcMs) → lokale Felder. `utcMsToLocalFields` ist eine totale,
 * referenziell transparente Funktion (die IANA-Zeitzonenregeln sind im Prozess fix) — das Cachen
 * ändert KEIN Ergebnis, nur die Laufzeit. Nötig, weil die Analyse-Pipeline dieselben ~35.040
 * Zeitstempel über Kapp-Suche, Reserve, Zuschreibung und Trace UND je Katalog-Kandidat wiederholt
 * konvertiert (inkl. des intern gekappten Lastgangs, der dieselben Zeitstempel trägt) — so
 * kollabieren >1 Mio. Konversionen auf die distinkten Zeitstempel eines Profils.
 *
 * Gedeckelt, damit der Cache im Server-/Portal-Kontext (viele Profile nacheinander) nicht
 * unbegrenzt wächst. Ein einzelnes Jahresprofil (~35.040 distinkte Stempel) liegt weit unter der
 * Grenze, daher wird innerhalb eines Laufs nie geleert (kein Thrashing). Bei Überlauf: schlicht
 * leeren (amortisiert O(1)) — kein LRU nötig, da das Arbeitsset praktisch immer ein Profil ist.
 */
const localFieldsCache = new Map<string, LocalFields>()
const LOCAL_FIELDS_CACHE_MAX = 500_000

/**
 * Lokale Kalenderfelder für einen UTC-Instant — Basis für §3.4-Gruppierung
 * (Monat/Wochentag/Stunde von Bezugsspitzen) außerhalb des Parsers selbst.
 * Wochentag: 0=Montag..6=Sonntag (ISO-nah, nicht JS-`getDay()`-Konvention).
 *
 * Das zurückgegebene Objekt ist gecacht und wird geteilt — Aufrufer lesen ausschließlich (alle
 * destrukturieren), nie mutieren; das ist Voraussetzung der Memoisierung.
 */
export function utcMsToLocalFields(utcMs: number, timeZone: string): LocalFields {
  const key = `${timeZone}|${utcMs}`
  const cached = localFieldsCache.get(key)
  if (cached) return cached

  const { year, month, day, hour, minute } = localParts(utcMs, timeZone)
  const weekday = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7
  const fields: LocalFields = { year, month, day, hour, minute, weekday }

  if (localFieldsCache.size >= LOCAL_FIELDS_CACHE_MAX) localFieldsCache.clear()
  localFieldsCache.set(key, fields)
  return fields
}

/**
 * Anzahl der Kalendermonate (LOKALE Zeit), die mindestens einen der UTC-Zeitstempel tragen —
 * Teiljahres-Erkennung für die Datenqualität (§3.5). Basis derselben lokalen Monatsgruppierung
 * wie `coveredMonthlyPeaksKw` (peaks/metrics.ts), damit `dataQuality.coveredMonths` und der
 * abgerechnete `billedKw` unter `monthly_*` denselben Monatsbegriff verwenden.
 */
export function countCoveredMonths(msValues: Iterable<number>, timeZone: string): number {
  const seen = new Array(12).fill(false) as boolean[]
  for (const ms of msValues) seen[utcMsToLocalFields(ms, timeZone).month - 1] = true
  return seen.reduce((n, present) => (present ? n + 1 : n), 0)
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

/** Parst reine Datumsfelder (ohne Uhrzeit) → [Jahr, Monat, Tag]; null bei Fehlschlag. */
function parseDateOnlyFields(cell: RawCell, format: DateFormat): [number, number, number] | null {
  const s = toStr(cell)
  if (format === 'de_dot_date') {
    const m = RE_DE_DOT_DATE.exec(s)
    return m ? [Number(m[3]), Number(m[2]), Number(m[1])] : null
  }
  if (format === 'iso_date') {
    const m = RE_ISO_DATE.exec(s)
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
  }
  return null
}

/** Parst eine reine Uhrzeit HH:MM[:SS] → [Stunde, Minute, Sekunde]; null bei Fehlschlag. */
function parseTimeOfDay(cell: RawCell): [number, number, number] | null {
  const m = RE_TIME.exec(toStr(cell))
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? '0')] : null
}

/**
 * Kombiniert eine getrennte Datums- und Zeitspalte zu UTC-Millisekunden (Split-Timestamp, OP#4).
 * `dateFormat` ist ein reines Datumsformat; die Uhrzeit kommt aus `timeCell` (Intervall-START).
 * Fehlt/ungültig die Uhrzeit, wird 00:00 angenommen. Ungültiges Datum → NaN.
 */
export function parseSplitTimestamp(
  dateCell: RawCell,
  timeCell: RawCell,
  dateFormat: DateFormat,
  timeZone: string,
): number {
  const date = parseDateOnlyFields(dateCell, dateFormat)
  if (!date) return NaN
  const [h, mi, s] = parseTimeOfDay(timeCell) ?? [0, 0, 0]
  return zonedWallToUtcMs(date[0], date[1], date[2], h, mi, s, timeZone)
}

/** Parst eine Zeitstempel-Zelle im erkannten Format nach UTC-Millisekunden. Ungültig → NaN. */
export function parseTimestamp(cell: RawCell, format: DateFormat, timeZone: string): number {
  if (format === 'excel_serial') {
    if (typeof cell !== 'number') return NaN
    const [y, mo, d, h, mi, s] = excelSerialToFields(cell)
    // [ANNAHME: unbestätigt bis Martins Muster (OP#4)] XLSX-Datumszellen sind naive lokale Wanduhrzeit.
    return zonedWallToUtcMs(y, mo, d, h, mi, s, timeZone)
  }
  // Reine Datumsformate (Split-Timestamp ohne separate Zeitspalte) → Uhrzeit 00:00.
  if (format === 'de_dot_date' || format === 'iso_date') {
    const date = parseDateOnlyFields(cell, format)
    return date ? zonedWallToUtcMs(date[0], date[1], date[2], 0, 0, 0, timeZone) : NaN
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
  if (format === 'de_month_name') {
    const m = RE_DE_MONTH.exec(s)
    if (!m) return NaN
    const mo = monthNameToNum(m[2]!)
    if (mo == null) return NaN
    return zonedWallToUtcMs(
      Number(m[3]),
      mo,
      Number(m[1]),
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
