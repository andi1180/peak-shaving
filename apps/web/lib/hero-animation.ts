/**
 * Hero-Animation der Startseite — reine Zeitfunktionen (Leadgen-Umbau Schritt 2).
 *
 * Vorlage ist der freigegebene Prototyp `docs/prototypes/hero-animation-prototyp.html`; Werte,
 * Dauern und Formeln sind von dort 1:1 übernommen. Alles hier ist rein (keine DOM-, React- oder
 * Zeit-Abhängigkeit): `frameAt(t)` beschreibt das komplette Bild zum Zeitpunkt `t` (Sekunden im
 * Loop), die Komponente zeichnet es nur. Prinzipdarstellung — keine Messwerte.
 */

/** Ersparnis-Zahl („bis zu −30 %") anzeigen? Standard AUS: der Beleg für die Zahl steht aus. */
export const HERO_SHOW_SAVING_FIGURE = false

/** Schematischer Arbeitstag: Last je Stunde (relativ) und die Obergrenze. */
export const LOAD = [
  0.18, 0.17, 0.17, 0.17, 0.18, 0.22, 0.33, 0.48, 0.56, 0.7, 0.92, 0.74, 0.52, 0.55, 0.71, 0.6,
  0.56, 0.5, 0.4, 0.31, 0.25, 0.21, 0.19, 0.18,
] as const
export const CAP = 0.62
export const PEAKS = [9, 10, 11, 14] as const
/** Günstige Zeiten, in denen der Speicher lädt (Hintergrundband), als [von, bis) in Stunden. */
export const BANDS = [
  [0, 5],
  [18, 22],
] as const

// Diagramm-Geometrie (viewBox 0 0 600 270).
export const VIEW_W = 600
export const VIEW_H = 270
export const X0 = 28
export const X1 = 588
export const YT = 14
export const YB = 236
export const SLOT = (X1 - X0) / 24
export const BAR_W = SLOT * 0.66
export const yOf = (v: number) => YB - v * (YB - YT)
export const CAP_Y = yOf(CAP)
export const GRID_FRACTIONS = [0.25, 0.5, 0.75, 1] as const
export const AXIS_HOURS = [0, 6, 12, 18, 24] as const

const inBand = (h: number) => BANDS.some(([a, b]) => h >= a && h < b)

/** Dauer je Stunde in Sekunden: an den Spitzen läuft die Uhr langsamer, damit man es sieht. */
export const DURATIONS = LOAD.map((_, h) =>
  h >= 9 && h <= 11 ? 2.7 : h === 14 ? 2.5 : inBand(h) ? 0.8 : 0.55,
)
export const START = 0.8
/** Startzeitpunkt jeder Stunde; `HOUR_STARTS[24]` ist das Tagesende. */
export const HOUR_STARTS: readonly number[] = DURATIONS.reduce<number[]>(
  (acc, d, h) => {
    acc.push(acc[h]! + d)
    return acc
  },
  [START],
)
export const DAY_END = HOUR_STARTS[24]!
export const FADE_START = DAY_END + 0.3
export const FADE_END = FADE_START + 5.0
export const LOOP_DURATION = FADE_END + 1.0
/** Erstes Bild (auch ohne JS und bei reduzierter Bewegung): das Schlussbild. */
export const FINAL_FRAME_T = FADE_START + 1.5
export const START_DELAY_MS = 600

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a), 0, 1)
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3)
const hs = (h: number) => HOUR_STARTS[h]!
const dur = (h: number) => DURATIONS[h]!

/** Tagesstunde (0–24, mit Nachkommastellen) zum Loop-Zeitpunkt `t`. */
export function hourAt(t: number): number {
  if (t <= START) return 0
  for (let h = 0; h < 24; h++) if (t < hs(h + 1)) return h + (t - hs(h)) / dur(h)
  return 24
}

/** Übernahme einer Spitze durch den Speicher (0–1): erst sichtbar rot, dann füllt er sie türkis. */
export const takeoverProgress = (h: number, t: number) => ease(seg(t, hs(h) + 1.15, hs(h) + 2.05))

const chargeProgress = (h: number, t: number) =>
  easeOut(seg(t, hs(h) + 0.15, hs(h) + 0.15 + dur(h) * 0.75))

const CHARGE: Readonly<Record<number, number>> = {
  0: 0.13,
  1: 0.13,
  2: 0.13,
  3: 0.13,
  4: 0.13,
  18: 0.15,
  19: 0.15,
  20: 0.15,
  21: 0.15,
}
const DISCHARGE: Readonly<Record<number, number>> = { 9: 0.16, 10: 0.24, 11: 0.2, 14: 0.18 }

export type BatteryMode = 'wait' | 'in' | 'out'

/** Ladestand (0–1) und Modus: lädt nachts, gibt bei Spitzen ab, lädt abends nach. */
export function batteryAt(t: number): { level: number; mode: BatteryMode } {
  let lvl = 0.3
  let mode: BatteryMode = 'wait'
  for (let h = 0; h < 24; h++) {
    const c = CHARGE[h]
    if (c) {
      const p = chargeProgress(h, t)
      lvl += c * p
      if (p > 0 && t < hs(h + 1)) mode = 'in'
    }
    const d = DISCHARGE[h]
    if (d) {
      const q = takeoverProgress(h, t)
      lvl -= d * q
      if (q > 0 && t < hs(h + 1)) mode = 'out'
    }
  }
  const level = clamp(lvl, 0.04, 1)
  // Nach dem Tag gleitet die Anzeige zurück auf den Startstand.
  const shown =
    t >= FADE_END ? level + (0.3 - level) * ease(seg(t, FADE_END, LOOP_DURATION)) : level
  return { level: shown, mode }
}

/** Ersparnis in Prozent: ein kleiner Teil über den Tag (günstig laden), der Großteil an den Spitzen. */
export function savingPercentAt(t: number): number {
  let saving = 8 * clamp(hourAt(t) / 24, 0, 1)
  for (const h of PEAKS) saving += 5.5 * takeoverProgress(h, t)
  return saving * (1 - ease(seg(t, FADE_END, LOOP_DURATION)))
}

/** Index der Erklärzeile (0–6). */
export function captionIndexAt(t: number): number {
  const hp = hourAt(t)
  let ci = 0
  if (hp >= 5.5) ci = 1
  if (hp >= 9) ci = 2
  if (hp >= 9 && takeoverProgress(9, t) > 0.5) ci = 3
  if (hp >= 12) ci = 4
  if (hp >= 14 && hp < 15) ci = takeoverProgress(14, t) > 0.5 ? 3 : 2
  if (hp >= 15) ci = 3
  if (hp >= 17.5) ci = 5
  if (t >= FADE_START) ci = 6
  return ci
}

/** Uhrzeit im Viertelstundenraster, „24:00" nach Tagesende. */
export function clockAt(t: number): string {
  if (t >= DAY_END) return '24:00'
  const mins = Math.floor((clamp(hourAt(t), 0, 23.99) * 60) / 15) * 15
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
}

export type PeakTagKind = 'peak' | 'takeover' | 'storage'

/** Hinweis an der aktuellen Spitze, oder `null`. */
export function peakTagAt(t: number): { hour: number; kind: PeakTagKind; opacity: number } | null {
  let tag: { hour: number; kind: PeakTagKind; opacity: number } | null = null
  for (const h of PEAKS) {
    if (t >= hs(h) + 0.25 && t < hs(h + 1) + 0.1) {
      const k = takeoverProgress(h, t)
      const opacity =
        seg(t, hs(h) + 0.25, hs(h) + 0.45) * (1 - seg(t, hs(h + 1) - 0.15, hs(h + 1) + 0.1))
      tag = { hour: h, kind: k <= 0.02 ? 'peak' : k < 1 ? 'takeover' : 'storage', opacity }
    }
  }
  return tag
}

/** Balkenanteile (relative Last) einer Stunde: Netz bis zur Linie, Spitze darüber, davon Speicher. */
export function barAt(h: number, t: number): { grid: number; top: number; storage: number } {
  const fadeOut = 1 - ease(seg(t, FADE_END, LOOP_DURATION))
  const total = LOAD[h]! * easeOut(seg(t, hs(h), hs(h) + 0.4)) * fadeOut
  const grid = Math.min(total, CAP)
  const top = Math.max(0, total - CAP)
  const k = (PEAKS as readonly number[]).includes(h) ? takeoverProgress(h, t) : 0
  return { grid, top, storage: top * k }
}

export type HeroFrame = {
  bars: { grid: number; top: number; storage: number }[]
  playheadX: number
  playheadVisible: boolean
  clock: string
  tag: ReturnType<typeof peakTagAt>
  battery: { level: number; mode: BatteryMode; dayOver: boolean }
  savingPercent: number
  savingPrefixVisible: boolean
  captionIndex: number
}

export function frameAt(t: number): HeroFrame {
  return {
    bars: LOAD.map((_, h) => barAt(h, t)),
    playheadX: X0 + clamp(hourAt(t), 0, 24) * SLOT,
    playheadVisible: t < DAY_END,
    clock: clockAt(t),
    tag: peakTagAt(t),
    battery: { ...batteryAt(t), dayOver: t >= DAY_END },
    savingPercent: savingPercentAt(t),
    savingPrefixVisible: t >= DAY_END && t < FADE_END,
    captionIndex: captionIndexAt(t),
  }
}
