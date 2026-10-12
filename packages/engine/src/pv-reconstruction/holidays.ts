/**
 * Gesetzliche Feiertage in Österreich (Feiertagsruhegesetz 1957, § 1 Abs. 1 ArbRG) — bundesweit,
 * ohne Landesfeiertage. Ostern nach der gregorianischen Osterformel (Meeus/Jones/Butcher).
 */

/** Ostersonntag als `{ month, day }` (Monat 1–12). */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return { month, day }
}

const FIXED: readonly string[] = [
  '01-01', // Neujahr
  '01-06', // Heilige Drei Könige
  '05-01', // Staatsfeiertag
  '08-15', // Mariä Himmelfahrt
  '10-26', // Nationalfeiertag
  '11-01', // Allerheiligen
  '12-08', // Mariä Empfängnis
  '12-25', // Christtag
  '12-26', // Stefanitag
]

/** Abstand in Tagen zum Ostersonntag: Ostermontag, Christi Himmelfahrt, Pfingstmontag, Fronleichnam. */
const EASTER_OFFSETS: readonly number[] = [1, 39, 50, 60]

const DAY_MS = 24 * 60 * 60 * 1000
const cache = new Map<number, Set<string>>()

function holidaysOf(year: number): Set<string> {
  const cached = cache.get(year)
  if (cached) return cached
  const set = new Set(FIXED)
  const easter = easterSunday(year)
  const easterMs = Date.UTC(year, easter.month - 1, easter.day)
  for (const offset of EASTER_OFFSETS) {
    const d = new Date(easterMs + offset * DAY_MS)
    set.add(
      `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
    )
  }
  cache.set(year, set)
  return set
}

export function isAustrianPublicHoliday(year: number, month: number, day: number): boolean {
  return holidaysOf(year).has(`${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
}
