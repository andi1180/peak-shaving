import type { LoadSource } from 'shared'

import type { DateFormat } from './datetime'
import type { DecimalSeparator } from './number'
import type { ColumnMapping, RawCell, Unit } from './types'

export type AdapterContext = {
  matrix: RawCell[][]
  headerRow: number | null
  /** Kleingeschriebene Header-Zellen (leer, wenn kein Header). */
  headers: string[]
  fileName?: string
}

export type AdapterHints = Partial<{
  columns: ColumnMapping
  unit: Unit
  source: LoadSource
  dateFormat: DateFormat
  decimal: DecimalSeparator
  timezone: string
}>

export interface FormatAdapter {
  id: string
  label: string
  /** Erkennt ein konkretes Anbieter-Format. `null` = kein Match → nächster Adapter bzw. generische Erkennung. */
  match(ctx: AdapterContext): AdapterHints | null
}

/*
 * Adapter-Registry (§3.2) — der klar getrennte Erweiterungspunkt.
 *
 * ┌─ OFFEN (OP#4) ─────────────────────────────────────────────────────────────┐
 * │ Die realen Layouts von Wiener Netze / Netz NÖ / Salzburg Netz sowie der     │
 * │ Wechselrichter-Exporte (Fronius/SMA/Sungrow) sind NICHT bekannt. Sobald     │
 * │ Martins Muster vorliegen, kommen sie als eigene FormatAdapter HIER rein —   │
 * │ OHNE die generische Erkennung (detect.ts) zu ändern. Beispiel-Skelett:      │
 * │                                                                             │
 * │   const wienerNetze: FormatAdapter = {                                       │
 * │     id: 'wiener_netze', label: 'Wiener Netze',                               │
 * │     match(ctx) {                                                             │
 * │       // [ANNAHME: unbestätigt bis Martins Muster (OP#4)]                    │
 * │       if (!ctx.headers.some(h => h.includes('...'))) return null             │
 * │       return { columns: {...}, unit: 'kWh', source: 'net_signed', ... }      │
 * │     },                                                                       │
 * │   }                                                                          │
 * │                                                                             │
 * │ Bis dahin ist die Registry leer und die generische Heuristik greift immer.  │
 * └────────────────────────────────────────────────────────────────────────────┘
 */
export const adapters: FormatAdapter[] = []

/** Erster Adapter, der matcht, gewinnt; sonst null (→ generische Erkennung). */
export function matchAdapter(ctx: AdapterContext): { id: string; hints: AdapterHints } | null {
  for (const a of adapters) {
    const hints = a.match(ctx)
    if (hints) return { id: a.id, hints }
  }
  return null
}
