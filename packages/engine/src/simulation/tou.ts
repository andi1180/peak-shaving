import type { LoadProfile, TariffParams, TimeOfUseWindow } from 'shared'

import { utcMsToLocalFields } from '../parser/datetime'
import { EPS } from './helpers'

// Zeit-Tarif-Zuordnung für tarifbewusstes Laden / Lastverschiebung (§3.7). Rein & deterministisch:
// bildet jedes 15-min-Intervall auf seinen Arbeitspreis (ct/kWh) ab und markiert die „günstigen"
// Fenster, in denen der kombinierte Dispatch (§3.6 Schritt 5) bevorzugt aus dem Netz lädt.
//
// [ANNAHME] Default-NT-Fenster: Ist NUR `energyPriceNightCtPerKwh` (ohne `timeOfUseWindows`) gesetzt,
// braucht die Lastverschiebung dennoch die INFORMATION, WELCHE Stunden günstig sind. Mangels
// Fenster-Angabe nehmen wir das in AT verbreitete NT-Fenster 22:00–06:00 an. Sobald Martins
// Tarif-Systematik (OP#3) echte Fenster liefert, ersetzen die `timeOfUseWindows` diese Annahme.
const DEFAULT_NIGHT_WINDOW = { from: '22:00', to: '06:00' }

/** "HH:mm" → Minuten seit Mitternacht (lokale Wanduhr). */
function parseHhMm(s: string): number {
  const [h, m] = s.split(':')
  return (Number(h) || 0) * 60 + (Number(m) || 0)
}

/**
 * Liegt `minuteOfDay` im Fenster [from, to)? Über-Mitternacht-Fenster (from > to, z.B. 22:00–06:00)
 * werden korrekt als Vereinigung [from, 24:00) ∪ [0, to) behandelt.
 */
function inWindow(minuteOfDay: number, from: number, to: number): boolean {
  if (from <= to) return minuteOfDay >= from && minuteOfDay < to
  return minuteOfDay >= from || minuteOfDay < to
}

export type IntervalTariffRates = {
  /** Arbeitspreis (ct/kWh) je Intervall — Fenster-Preis, sonst der Standard-`energyPriceCtPerKwh`. */
  rateCtPerKwh: number[]
  /** Günstig-Flag je Intervall: Rate liegt unter dem Standard-Tagespreis (→ Ladefenster für Lastverschiebung). */
  isCheapWindow: boolean[]
  /** True, wenn überhaupt ein günstigeres Fenster existiert (sonst ist Lastverschiebung wirkungslos). */
  touActive: boolean
}

/**
 * Effektive Zeit-of-Use-Fenster mit Preis: die explizit gesetzten `timeOfUseWindows`, oder — falls nur
 * `energyPriceNightCtPerKwh` gesetzt ist — ein einzelnes Default-NT-Fenster (s. [ANNAHME] oben).
 */
function effectiveWindows(tariffParams: TariffParams): TimeOfUseWindow[] {
  const windows = tariffParams.timeOfUseWindows
  if (windows && windows.length > 0) return windows
  if (tariffParams.energyPriceNightCtPerKwh != null) {
    return [{ ...DEFAULT_NIGHT_WINDOW, ctPerKwh: tariffParams.energyPriceNightCtPerKwh }]
  }
  return []
}

/**
 * Per-Intervall-Arbeitspreis + Günstig-Fenster-Flag (§3.7). Ein Intervall bekommt den GÜNSTIGSTEN
 * Preis unter allen matchenden Fenstern; matcht keins, gilt der Standard-`energyPriceCtPerKwh`.
 * „Günstig" = Rate strikt unter dem Standardpreis. Ohne (echte oder Default-NT-)Fenster ist
 * `touActive=false` und alle Flags sind `false` → `loadShiftSavingPerYear` bleibt 0 (§3.7).
 */
export function intervalTariffRates(
  loadProfile: LoadProfile,
  tariffParams: TariffParams,
): IntervalTariffRates {
  const std = tariffParams.energyPriceCtPerKwh
  const windows = effectiveWindows(tariffParams).map((w) => ({
    from: parseHhMm(w.from),
    to: parseHhMm(w.to),
    ctPerKwh: w.ctPerKwh,
  }))

  const rateCtPerKwh: number[] = new Array(loadProfile.readings.length)
  const isCheapWindow: boolean[] = new Array(loadProfile.readings.length)
  let touActive = false

  for (let i = 0; i < loadProfile.readings.length; i++) {
    const reading = loadProfile.readings[i]!
    let rate = std
    if (windows.length > 0) {
      const { hour, minute } = utcMsToLocalFields(Date.parse(reading.ts), loadProfile.timezoneMeta)
      const minuteOfDay = hour * 60 + minute
      for (const w of windows) {
        if (inWindow(minuteOfDay, w.from, w.to) && w.ctPerKwh < rate) rate = w.ctPerKwh
      }
    }
    const cheap = rate < std - EPS
    rateCtPerKwh[i] = rate
    isCheapWindow[i] = cheap
    if (cheap) touActive = true
  }

  return { rateCtPerKwh, isCheapWindow, touActive }
}
