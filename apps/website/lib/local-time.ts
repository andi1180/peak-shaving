// Lokale Kalenderfelder für Chart-Achsen/Perioden-Segmente. Bewusst per Intl (wie die Engine,
// `packages/engine/src/parser/datetime.ts:utcMsToLocalFields`, dort nicht öffentlich exportiert) —
// dieselbe Technik auf denselben Input angewandt liefert dasselbe Ergebnis, ohne die Engine-API für
// einen reinen UI-Anzeigezweck zu erweitern.
const monthFormatterCache = new Map<string, Intl.DateTimeFormat>()

function monthFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = monthFormatterCache.get(timeZone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone, month: 'numeric' })
    monthFormatterCache.set(timeZone, fmt)
  }
  return fmt
}

/** Lokaler Monat 0-11 (Jänner=0) — konsistent mit `capKwByPeriod`-Indizierung (§3.6.1). */
export function localMonthIndex(utcMs: number, timeZone: string): number {
  return Number(monthFormatter(timeZone).format(utcMs)) - 1
}

const dayLabelCache = new Map<string, Intl.DateTimeFormat>()

/** Kurzes lokales Datum für Achsen-Ticks/Tooltips, z. B. "10. Feb". */
export function formatDayLabel(utcMs: number, timeZone: string): string {
  let fmt = dayLabelCache.get(timeZone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('de-AT', { timeZone, day: 'numeric', month: 'short' })
    dayLabelCache.set(timeZone, fmt)
  }
  return fmt.format(utcMs)
}

const dateTimeCache = new Map<string, Intl.DateTimeFormat>()

/** Volles lokales Datum + Uhrzeit für die Spitzen-Detailansicht, z. B. "Di, 10. Feb 2024, 05:00". */
export function formatDateTimeLabel(utcMs: number, timeZone: string): string {
  let fmt = dateTimeCache.get(timeZone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('de-AT', {
      timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    dateTimeCache.set(timeZone, fmt)
  }
  return fmt.format(utcMs)
}
