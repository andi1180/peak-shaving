import type { LoadProfile, PvProfile } from 'shared'

import { drawSeries } from './helpers'

/**
 * Brutto-PV-Erzeugung auf den Netz-Lastgang ausrichten + Konsistenz gegen den Lastgang prüfen (§3.1).
 * Rein & deterministisch, kein I/O.
 *
 * ── Die Physik (§3.1) ────────────────────────────────────────────────────────────────────────────
 * Der Netz-Lastgang (`gridPowerKw`, signiert: + = Bezug, − = Einspeisung) enthält den PV-Effekt
 * BEREITS — der am Zähler sichtbare Überschuss ist die Einspeisung `Einspeisung(t) = max(0, −grid(t))`.
 * Das optionale `PvProfile` liefert zusätzlich die BRUTTO-Erzeugung des Wechselrichters (immer ≥ 0),
 * inkl. des vor Ort direkt selbst verbrauchten Anteils. Daraus wird der abgeleitete Verbrauch (der
 * 4. Strom fürs Energiefluss-Chart) rekonstruierbar: `Verbrauch(t) = grid(t) + BruttoPV(t)` (signiert),
 * bzw. gleichwertig `Verbrauch = Netzbezug + PV-Eigenverbrauch` mit
 * `PV-Eigenverbrauch(t) = BruttoPV(t) − Einspeisung(t)`.
 *
 * ── Konsistenz-Regel (Prinzip 1: „Der Netz-Lastgang ist die Wahrheit") ───────────────────────────
 * `BruttoPV(t) ≥ Einspeisung(t)` MUSS gelten (man kann nicht mehr einspeisen als erzeugen). Bei
 * Widerspruch (reale, evtl. schlecht synchronisierte Profile) gewinnt der Netz-Lastgang: die
 * Brutto-PV wird für die Rechnung auf `Einspeisung(t)` hochgeklemmt — das garantiert einen
 * nie-negativen abgeleiteten Verbrauch (`Verbrauch = grid + BruttoPV ≥ grid + Einspeisung ≥ 0`).
 * Die Anzahl geklemmter Slots wird zurückgegeben, damit der Aufrufer (Worker) eine
 * `dataQuality`-Warnung mit konkreter Slot-Zahl setzen kann — Warnung, kein harter Fehler
 * (analog zur `import_only`-Pflichtwarnung §3.1). KEIN Crash, kein negativer Verbrauch.
 *
 * ── Fehlende Abdeckung ≠ Widerspruch ─────────────────────────────────────────────────────────────
 * Ein Slot OHNE PV-Messwert (kein Zeitstempel-Match) ist eine Abdeckungslücke, kein physikalischer
 * Widerspruch: er wird still auf die Einspeisung gesetzt (= exakt das Verhalten ohne PvProfile für
 * diesen Slot) und NICHT als inkonsistent gezählt. Nur ein VORHANDENER Messwert unter der
 * Einspeisung ist ein echter Widerspruch.
 */
export type PvAlignment = {
  /** Brutto-PV je Lastgang-Intervall (≥ 0, bereits auf `Einspeisung` hochgeklemmt). */
  grossPvKw: number[]
  /** Anzahl Slots, in denen ein vorhandener Brutto-PV-Messwert UNTER der Einspeisung lag (geklemmt). */
  inconsistentSlots: number
}

const EPS = 1e-9

export function alignPvGrossToLoad(loadProfile: LoadProfile, pvProfile: PvProfile): PvAlignment {
  const draws = drawSeries(loadProfile)

  // ts → Brutto-PV (das PvProfile liegt auf demselben 15-min-Gitter, s. parsePvProfile/prepareSeries).
  const pvByTs = new Map<string, number>()
  for (const r of pvProfile.readings) pvByTs.set(r.ts, r.pvGenerationKw)

  const grossPvKw = new Array<number>(draws.length).fill(0)
  let inconsistentSlots = 0

  for (let i = 0; i < draws.length; i++) {
    const feedIn = Math.max(0, -(draws[i] ?? 0)) // Einspeisung = am Zähler sichtbarer Überschuss
    const raw = pvByTs.get(loadProfile.readings[i]!.ts)

    if (raw == null) {
      // Abdeckungslücke: kein PV-Messwert → auf Einspeisung setzen (No-PvProfile-Verhalten), nicht zählen.
      grossPvKw[i] = feedIn
      continue
    }

    const nonNeg = Math.max(0, raw) // Brutto-PV ist definitionsgemäß ≥ 0
    if (nonNeg < feedIn - EPS) {
      // Widerspruch: weniger erzeugt als eingespeist → auf Einspeisung klemmen (Netz gewinnt) + zählen.
      grossPvKw[i] = feedIn
      inconsistentSlots++
    } else {
      grossPvKw[i] = nonNeg
    }
  }

  return { grossPvKw, inconsistentSlots }
}

/**
 * Report-fertige `dataQuality`-Warnung zur PV-Konsistenz (§3.1) — oder `null`, wenn alle Brutto-PV-
 * Werte plausibel ≥ Einspeisung waren. Der Worker hängt sie an `dataQuality.warnings` an.
 */
export function pvConsistencyWarning(inconsistentSlots: number): string | null {
  if (inconsistentSlots <= 0) return null
  return (
    `${inconsistentSlots} Viertelstunde(n) mit Brutto-PV unter der am Zähler gemessenen Einspeisung ` +
    '— physikalisch unmöglich (mehr eingespeist als erzeugt). Für die Rechnung wurde die Brutto-PV ' +
    'auf die Einspeisung angehoben (der Netz-Lastgang gilt als Wahrheit); die Eigenverbrauchs-Aussage ' +
    'kann in diesen Slots ungenau sein. Bitte PV- und Lastgang-Zeitstempel/Zeitzone prüfen.'
  )
}
