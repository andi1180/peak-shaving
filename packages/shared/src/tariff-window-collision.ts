/**
 * Was verdrängt ein NEUES Zeitfenster? (Kollisions-Wächter, 02.09.2026)
 *
 * ── ⚠ WARUM ES DIESE PRÜFUNG BRAUCHT ───────────────────────────────────────────────────────────
 * Überlappende Fenster sind der Regelfall (ein ganztägiges `normal` plus ausgeschnittene
 * Hochlastfenster), und welches gilt, entscheidet die ENGERE Abdeckung — nicht die Reihenfolge der
 * Eingabe (`tariff-window-rules.ts`). Ein neu hinzugefügtes Fenster kann deshalb einen bestehenden
 * Satz still ersetzen, ohne dass irgendwo etwas gelöscht oder geändert würde: Das alte Fenster
 * steht danach unverändert in der Liste und gilt trotzdem nicht mehr.
 *
 * Diese Nebenwirkung ist an der Oberfläche unsichtbar und in der Datenbank unumkehrbar — es gibt
 * kein Bearbeiten und kein Löschen EINZELNER Fenster; rückgängig macht sie nur das Entfernen des
 * GANZEN Tarifstands (protokolliert, B21-2c). Genau deshalb muss sie VOR dem Anlegen dastehen.
 *
 * ── ⚠ WARUM EIN ZELL-DURCHLAUF UND KEINE RECHTECK-SCHNITTMENGE ─────────────────────────────────
 * Die naheliegende Abkürzung wäre: „das neue Fenster verdrängt jedes bestehende, mit dem es sich
 * überschneidet". Sie ist FALSCH, und zwar in beide Richtungen:
 *
 *   • Zu viel: Im Schnitt mit `normal` (ganztägig, ganzjährig) liegt oft schon `snap` und gewinnt
 *     dort. Wer dann „verdrängt `normal`" meldet, benennt das falsche Fenster und den falschen
 *     Preis — der Admin liest eine Preisänderung, die es so nie gab.
 *   • Zu wenig: Im Schnitt kann das neue Fenster auch VERLIEREN (wenn ein bestehendes enger ist).
 *     Dort verdrängt es gar nichts, und eine Warnung wäre schlicht unwahr.
 *
 * Massgeblich ist immer, WER an einem Punkt heute gewinnt und wer danach gewinnt. Deshalb wird die
 * Ebene (Kalendertag × Uhrzeit) in Zellen zerlegt, in denen die Antwort konstant ist, und je Zelle
 * dieselbe Auswahlregel gefragt, die auch die Engine fragt (`selectRateWindowIndex`).
 *
 * ── DIE ZELLEN ─────────────────────────────────────────────────────────────────────────────────
 * Kalendertag: 366 Tage eines Bezugsjahres MIT dem 29. Februar (eine Saisongrenze darf ihn nennen).
 * Uhrzeit: die Bruchstellen ALLER beteiligten Fenster, aufsteigend — dazwischen ändert sich die
 * Zugehörigkeit nicht, ein einziger Messpunkt je Abschnitt genügt also.
 *
 * Durchlaufen werden ausdrücklich NUR die Zellen, in denen das neue Fenster überhaupt gilt: wo es
 * nicht gilt, kann es auch nichts verdrängen. Das ist keine Optimierung um ihrer selbst willen,
 * sondern hält den Aufwand bei einem Formular, das die Prüfung bei jeder Eingabe neu fährt, im
 * Bereich weniger tausend Vergleiche.
 */

import type { GridTariffWindowInput } from './tariff-pricing'
import {
  MINUTES_PER_DAY,
  MONTH_LENGTHS,
  coverageScore,
  inClockWindow,
  inSeason,
  parseClockMinutes,
  selectRateWindowIndex,
} from './tariff-window-rules'

/** Ein zusammenhängender Teilzeitraum, in dem GENAU EIN bestehendes Fenster verdrängt wird. */
export type WindowCollision = {
  /** Position des verdrängten Fensters in der übergebenen Bestandsliste (s. Kopf `selectRateWindowIndex`). */
  displacedIndex: number
  /** Das verdrängte Fenster selbst — für Bezeichnung und Preis in der Meldung. */
  displaced: GridTariffWindowInput
  /**
   * Die betroffene Saison, `MM-DD` und BEIDE Grenzen inklusiv; über den Jahreswechsel laufend
   * zulässig (`from > to`). `null` heisst ganzjährig — also alle 366 Kalendertage betroffen.
   */
  season: { from: string; to: string } | null
  /**
   * Der betroffene Uhrzeit-Bereich, `HH:MM`, `from` inklusiv und `to` exklusiv. `24:00` meint das
   * Tagesende; über Mitternacht laufend zulässig (`from > to`).
   */
  clock: { from: string; to: string }
  /** Der Satz, der in diesem Teilzeitraum HEUTE gilt. */
  fromCtPerKwh: number
  /** Der Satz, der dort nach dem Hinzufügen gälte — immer der des neuen Fensters. */
  toCtPerKwh: number
}

/** Alle 366 Kalendertage des Bezugsjahres, in Reihenfolge. Index 0 = 01.01. */
function calendarDays(): { month: number; day: number }[] {
  const out: { month: number; day: number }[] = []
  for (let month = 1; month <= 12; month++) {
    for (let day = 1; day <= MONTH_LENGTHS[month - 1]!; day++) out.push({ month, day })
  }
  return out
}

const DAYS = calendarDays()

function formatMonthDay(index: number): string {
  const { month, day } = DAYS[index]!
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Die Bruchstellen der Uhrzeit-Achse: dazwischen ändert sich keine Zugehörigkeit. */
function clockSegments(windows: readonly GridTariffWindowInput[]): { from: number; to: number }[] {
  const marks = new Set<number>([0, MINUTES_PER_DAY])
  for (const w of windows) {
    for (const value of [parseClockMinutes(w.timeFrom), parseClockMinutes(w.timeTo)]) {
      if (value > 0 && value < MINUTES_PER_DAY) marks.add(value)
    }
  }
  const sorted = [...marks].sort((a, b) => a - b)
  const out: { from: number; to: number }[] = []
  for (let i = 0; i < sorted.length - 1; i++) out.push({ from: sorted[i]!, to: sorted[i + 1]! })
  return out
}

/**
 * Gewinnt das neue Fenster gegen das heute geltende?
 *
 * ⚠ Die Bedingung bildet die Schleife aus `selectRateWindowIndex` EXAKT nach — einschliesslich
 * ihrer Reihenfolge: Das neue Fenster wird dort zuletzt geprüft und muss den Bestand deshalb echt
 * schlagen (kleinere Abdeckung) oder bei Gleichstand teurer sein. Wer die Bedingung hier lockerer
 * fasst, meldet eine Verdrängung, die nie einträte.
 */
function candidateBeats(
  candidateScore: number,
  candidate: GridTariffWindowInput,
  current: GridTariffWindowInput,
): boolean {
  const currentScore = coverageScore(current)
  return (
    candidateScore < currentScore ||
    (candidateScore === currentScore && candidate.ctPerKwh > current.ctPerKwh)
  )
}

/** Aufsteigende Läufe zusammenhängender Indizes, zyklisch geschlossen (letzter grenzt an ersten). */
function cyclicRuns(indices: readonly number[], total: number): { from: number; to: number }[] {
  if (indices.length === 0) return []
  if (indices.length === total) return [{ from: 0, to: total - 1 }]

  const sorted = [...indices].sort((a, b) => a - b)
  const runs: { from: number; to: number }[] = []
  let start = sorted[0]!
  let prev = start
  for (let i = 1; i < sorted.length; i++) {
    const value = sorted[i]!
    if (value === prev + 1) {
      prev = value
      continue
    }
    runs.push({ from: start, to: prev })
    start = value
    prev = value
  }
  runs.push({ from: start, to: prev })

  // Der Jahres- bzw. Tageswechsel ist keine Grenze: 10-01…12-31 und 01-01…03-31 sind EIN Zeitraum.
  if (runs.length > 1) {
    const first = runs[0]!
    const last = runs[runs.length - 1]!
    if (first.from === 0 && last.to === total - 1) {
      runs.pop()
      runs.shift()
      runs.unshift({ from: last.from, to: first.to })
    }
  }
  return runs
}

/**
 * Welche bestehenden Fenster würde `candidate` verdrängen, in welchen Teilzeiträumen, mit welcher
 * Preisänderung?
 *
 * `existing` ist die Liste OHNE den Kandidaten — genau die Fenster, die heute an der Tarifzeile
 * hängen. Ein leeres Ergebnis heisst: keine Verdrängung. Das schliesst zwei sehr verschiedene
 * Fälle ein und unterscheidet sie bewusst NICHT (die Oberfläche warnt in beiden nicht):
 * das neue Fenster füllt eine Lücke, in der bisher gar kein Satz galt — oder es verliert überall
 * gegen ein bereits engeres Fenster und bleibt damit wirkungslos. Der zweite Fall ist eine eigene,
 * hier ausdrücklich NICHT gebaute Prüfung (s. Handover).
 */
export function findWindowCollisions(
  candidate: GridTariffWindowInput,
  existing: readonly GridTariffWindowInput[],
): WindowCollision[] {
  if (existing.length === 0) return []

  const candidateFrom = parseClockMinutes(candidate.timeFrom)
  const candidateTo = parseClockMinutes(candidate.timeTo)
  const candidateScore = coverageScore(candidate)

  const segments = clockSegments([...existing, candidate])
  // Nur die Abschnitte, in denen der Kandidat überhaupt gilt — anderswo verdrängt er nichts.
  const active = segments
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => inClockWindow(segment.from, candidateFrom, candidateTo))
  if (active.length === 0) return []

  // verdrängtes Fenster → Kalendertag → betroffene Abschnitts-Indizes (aufsteigend).
  const hits = new Map<number, Map<number, number[]>>()

  for (let d = 0; d < DAYS.length; d++) {
    const { month, day } = DAYS[d]!
    if (!inSeason(month, day, candidate.monthDayFrom, candidate.monthDayTo)) continue

    for (const { segment, index } of active) {
      const current = selectRateWindowIndex(existing, month, day, segment.from)
      // Keine Lücke füllen ist keine Verdrängung.
      if (current < 0) continue
      if (!candidateBeats(candidateScore, candidate, existing[current]!)) continue

      let byDay = hits.get(current)
      if (!byDay) {
        byDay = new Map<number, number[]>()
        hits.set(current, byDay)
      }
      const list = byDay.get(d)
      if (list) list.push(index)
      else byDay.set(d, [index])
    }
  }

  const out: WindowCollision[] = []

  for (const displacedIndex of [...hits.keys()].sort((a, b) => a - b)) {
    const byDay = hits.get(displacedIndex)!
    const displaced = existing[displacedIndex]!

    /*
     * Zusammengefasst wird in zwei Schritten, und die Reihenfolge ist die Aussage:
     * erst die Kalendertage mit IDENTISCHEM Abschnitts-Muster zu einem Zeitraum, dann innerhalb
     * dieses Zeitraums die Abschnitte zu Uhrzeit-Bereichen. Andersherum entstünden Zeiträume, die
     * für verschiedene Uhrzeiten verschieden weit reichen — also mehr Meldungen als Sachverhalte.
     */
    const byPattern = new Map<string, number[]>()
    for (const [dayIndex, segmentIndices] of byDay) {
      const key = segmentIndices.join(',')
      const days = byPattern.get(key)
      if (days) days.push(dayIndex)
      else byPattern.set(key, [dayIndex])
    }

    const findings: WindowCollision[] = []
    for (const [key, days] of byPattern) {
      const segmentIndices = key.split(',').map(Number)
      const clockRanges = cyclicRuns(segmentIndices, segments.length).map((run) => ({
        from: formatClock(segments[run.from]!.from),
        to: formatClock(segments[run.to]!.to),
      }))

      for (const dayRun of cyclicRuns(days, DAYS.length)) {
        const season =
          dayRun.from === 0 && dayRun.to === DAYS.length - 1
            ? null
            : { from: formatMonthDay(dayRun.from), to: formatMonthDay(dayRun.to) }

        for (const clock of clockRanges) {
          findings.push({
            displacedIndex,
            displaced,
            season,
            clock,
            fromCtPerKwh: displaced.ctPerKwh,
            toCtPerKwh: candidate.ctPerKwh,
          })
        }
      }
    }

    // Stabile Reihenfolge: sonst wechselte die Meldung ihre Anordnung zwischen zwei gleichen Läufen.
    findings.sort(
      (a, b) =>
        (a.season?.from ?? '').localeCompare(b.season?.from ?? '') ||
        a.clock.from.localeCompare(b.clock.from),
    )
    out.push(...findings)
  }

  return out
}
