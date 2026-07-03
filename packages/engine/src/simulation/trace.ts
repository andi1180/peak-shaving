import type { DispatchTrace, LoadProfile, TariffParams } from 'shared'

import { utcMsToLocalFields } from '../parser/datetime'
import { capForIntervalSeries, drawSeries, intervalHours, periodIndexByInterval } from './helpers'
import type { BatterySimulationResult } from './simulate'

/**
 * `dispatchTrace`-Befüllung (§3.10/§6.2) — reine DATENEXTRAKTION aus dem EINEN bereits gerechneten
 * `BatterySimulationResult` (§3.6/§3.7). KEINE Zweitsimulation (Prinzip 2/3: „Ein Dispatch, eine
 * ehrliche Zahl"): jede hier gelieferte Größe stammt aus `sim` bzw. dem unveränderten Lastgang.
 *
 * Der Trace trägt bewusst NUR die von der UI nicht ableitbaren Größen (Kapp-Schwellen, Spitzen-
 * Overlays, die SoC-/Batterie-Zerlegung repräsentativer Tage) — NICHT die bis zu 35.040 15-min-
 * Rohpunkte (die UI hat den Lastgang client-side; Downsampling der Jahresübersicht bleibt UI-Sache,
 * s. DispatchTrace-Kommentar in packages/shared). Consumer: die U2-Report-Charts.
 *
 * Datenherkunft je Feld:
 *  • `capKwByPeriod`  — 1:1 aus der Kapp-Suche (`sim.capKwByPeriod`); `∞` je Slot bei `static`
 *    (keine Spitzenkappung, OP#5) — konsistent mit dem bereits im Contract geführten `∞`
 *    (`amortizationYears` bei nicht amortisierender Batterie).
 *  • `caughtPeaks`    — die Top-Peaks (`peaks.top`, §3.4), die die Kappung tatsächlich gesenkt hat.
 *  • `representativeDays` — bis zu zwei Tage in voller 15-min-Auflösung (s. `buildRepresentativeDays`).
 */

const EPS = 1e-9

/** Lokaler Kalendertag „YYYY-MM-DD" (Wanduhr, `timezoneMeta`) — Gruppierungsschlüssel der repräsentativen Tage. */
function localDateKey(utcMs: number, timeZone: string): string {
  const { year, month, day } = utcMsToLocalFields(utcMs, timeZone)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)}`
}

/** Interner Merker eines abgefangenen Top-Peaks — trägt den Intervall-Index für die Tages-Zuordnung. */
type CaughtPeak = { ts: string; originalKw: number; residualKw: number; index: number }

export function buildDispatchTrace(
  loadProfile: LoadProfile,
  tariffParams: TariffParams,
  sim: BatterySimulationResult,
  topPeaks: Array<{ ts: string; kw: number }>,
): DispatchTrace {
  const readings = loadProfile.readings
  const draws = drawSeries(loadProfile)
  const deltaH = intervalHours(loadProfile)
  const tz = loadProfile.timezoneMeta
  const periodOfInterval = periodIndexByInterval(loadProfile, tariffParams.billingModel)
  const capForInterval = capForIntervalSeries(sim.capKwByPeriod, periodOfInterval)
  const { socKwh, gridAfterKw, batteryPowerKw } = sim.dispatch

  // ts → Intervall-Index (Zeitstempel sind im 15-min-Gitter eindeutig).
  const indexByTs = new Map<string, number>()
  for (let i = 0; i < readings.length; i++) indexByTs.set(readings[i]!.ts, i)

  // ── caughtPeaks — NUR die Top-Peaks, die die Kappung tatsächlich gesenkt hat ────────────────────
  // Abgefangen ⇔ der Bezug lag über der Kappschwelle (`draw > cap`, Dispatch-Schritt 2) UND die
  // Batterie hat ihn messbar reduziert (`draw − gridAfter > 0`). Ein leistungsbegrenzter Peak zählt
  // als abgefangen (er wurde gesenkt), auch wenn `residualKw` über `cap` bleibt — die Wahrheit steht
  // im `residualKw`. Bei `static` (cap = ∞) ist der Test nie erfüllt → leer. `caught` ist per
  // Konstruktion true: der Contract-Shape trägt das Feld, die Miss-Fälle werden bewusst NICHT geführt
  // („nur die tatsächlich abgefangenen, nicht alle Top-Peaks").
  const caught: CaughtPeak[] = []
  for (const peak of topPeaks) {
    const i = indexByTs.get(peak.ts)
    if (i == null) continue
    const draw = draws[i] ?? 0
    const cap = capForInterval[i] ?? Infinity
    const residual = gridAfterKw[i] ?? draw
    if (draw > cap + EPS && draw - residual > EPS) {
      caught.push({ ts: peak.ts, originalKw: draw, residualKw: residual, index: i })
    }
  }
  const caughtPeaks: DispatchTrace['caughtPeaks'] = caught.map((c) => ({
    ts: c.ts,
    originalKw: c.originalKw,
    residualKw: c.residualKw,
    caught: true,
  }))

  const representativeDays = buildRepresentativeDays({
    readings,
    draws,
    deltaH,
    tz,
    socKwh,
    gridAfterKw,
    batteryPowerKw,
    caught,
  })

  return { capKwByPeriod: sim.capKwByPeriod, caughtPeaks, representativeDays }
}

type DayContext = {
  readings: LoadProfile['readings']
  draws: number[]
  deltaH: number
  tz: string
  socKwh: number[]
  gridAfterKw: number[]
  batteryPowerKw: number[]
  caught: CaughtPeak[]
}

/**
 * Deterministische Auswahl der repräsentativen Tage (fachliche Aussage, keine UI-Kosmetik — U2 trifft
 * sie nicht still, s. DispatchTrace-Kommentar in packages/shared):
 *   • `worst_caught_peak` (PFLICHT, sofern überhaupt gekappt wurde) — der Tag der teuersten
 *     ABGEFANGENEN Spitze (höchster `originalKw` unter `caught`, Tie-Break: früherer Zeitstempel).
 *     Fehlt sauber, wenn nichts abgefangen wurde (`static` oder zu schwache Batterie) — kein Fake-Tag.
 *   • `pv_strong` (OPTIONAL) — nur wenn Einspeisung auftritt. Im MVP gibt es kein separat konsumiertes
 *     `PvProfile` (s. simulate.ts/§3.1); „Einspeisung" ⇔ negatives `gridPowerKw`. Gewählt wird der Tag
 *     mit der höchsten eingespeisten PV-Energie (Σ max(0,−draw)·Δ), Tie-Break: früheres Datum.
 * Fällt `pv_strong` auf denselben Tag wie `worst_caught_peak`, wird er NICHT doppelt ausgeliefert
 * (identischer 96-Vektor) — die Aussage steckt ohnehin im Label.
 */
function buildRepresentativeDays(ctx: DayContext): DispatchTrace['representativeDays'] {
  const { readings, draws, deltaH, tz, caught } = ctx

  // Lokale Tageszuordnung EINMAL (ein Intl-Pass), danach für Auswahl UND Extraktion wiederverwendet.
  const dateKeyOfInterval = readings.map((r) => localDateKey(Date.parse(r.ts), tz))

  const days: DispatchTrace['representativeDays'] = []
  const usedDates = new Set<string>()

  // (1) worst_caught_peak
  const worst = caught.reduce<CaughtPeak | null>((best, c) => {
    if (!best || c.originalKw > best.originalKw + EPS) return c
    if (Math.abs(c.originalKw - best.originalKw) <= EPS && c.ts < best.ts) return c
    return best
  }, null)
  if (worst) {
    const date = dateKeyOfInterval[worst.index]!
    days.push({ date, label: 'worst_caught_peak', intervals: collectDay(date, dateKeyOfInterval, ctx) })
    usedDates.add(date)
  }

  // (2) pv_strong — Tag mit der höchsten eingespeisten PV-Energie, sofern Einspeisung auftritt.
  const feedInByDate = new Map<string, number>()
  for (let i = 0; i < draws.length; i++) {
    const exportKw = Math.max(0, -(draws[i] ?? 0))
    if (exportKw <= EPS) continue
    const key = dateKeyOfInterval[i]!
    feedInByDate.set(key, (feedInByDate.get(key) ?? 0) + exportKw * deltaH)
  }
  if (feedInByDate.size > 0) {
    // Nur bei strikt größerer Energie ersetzen ⇒ bei Gleichstand bleibt der zuerst eingefügte (=früheste,
    // da `draws` chronologisch durchlaufen wird) Tag — deterministischer Tie-Break ohne Extra-Sort.
    let pvDate: string | null = null
    let bestEnergy = -Infinity
    for (const [date, energy] of feedInByDate) {
      if (energy > bestEnergy + EPS) {
        bestEnergy = energy
        pvDate = date
      }
    }
    if (pvDate && !usedDates.has(pvDate)) {
      days.push({ date: pvDate, label: 'pv_strong', intervals: collectDay(pvDate, dateKeyOfInterval, ctx) })
    }
  }

  return days
}

/**
 * Extrahiert die 15-min-Intervalle EINES lokalen Kalendertages in voller Auflösung (typ. 96; an
 * Profil-Rändern oder DST-Tagen entsprechend weniger/mehr). Energiebilanz je Slot ist per
 * Konstruktion konsistent: der Dispatch garantiert `gridAfter = draw + batteryPower`, d.h. die
 * ursprüngliche Last `draw = gridPowerKw − batteryPowerKw` (Vorzeichen: + laden, − entladen) — genau
 * die Invariante, an der ein Tages-Energiefluss-Chart Unsinn zeigen würde, wenn sie bräche.
 */
function collectDay(
  date: string,
  dateKeyOfInterval: string[],
  ctx: DayContext,
): DispatchTrace['representativeDays'][number]['intervals'] {
  const { readings, draws, socKwh, gridAfterKw, batteryPowerKw } = ctx
  const intervals: DispatchTrace['representativeDays'][number]['intervals'] = []
  for (let i = 0; i < readings.length; i++) {
    if (dateKeyOfInterval[i] !== date) continue
    const draw = draws[i] ?? 0
    intervals.push({
      ts: readings[i]!.ts,
      gridPowerKw: gridAfterKw[i] ?? draw, // Netzbezug NACH Batterie
      // [MVP] Kein separat konsumiertes PvProfile: die einzige PV-Größe ist die am Zähler sichtbare
      // Einspeisung (Überschuss) = max(0,−draw). Bruttoerzeugung (auch der direkt vor Ort verbrauchte
      // Teil) ist erst mit einem echten PvProfile verfügbar (OP-abhängig). Ⓘ Deshalb KEIN unabhängiger
      // Term der geprüften Bilanz `draw = grid − battery` — nur die PV-Bande fürs Chart.
      pvGenerationKw: Math.max(0, -draw),
      batteryPowerKw: batteryPowerKw[i] ?? 0,
      socKwh: socKwh[i] ?? 0,
    })
  }
  return intervals
}
