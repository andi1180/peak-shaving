import type { LoadProfile } from 'shared'

import { utcMsToLocalFields } from '../parser/datetime'

/**
 * Das Verbrauchsmuster einer vorausschauenden Ladesteuerung
 * (`Pflichtenheft_Vorausschauende_Ladesteuerung.md` §2.2/§2.3).
 *
 * ── WAS DIESES MODUL LIEFERT ───────────────────────────────────────────────────────────────────
 * Für einen lokalen Kalendertag die Reihe, die eine Steuerung am VORABEND für diesen Tag erwartet
 * hätte: der Mittelwert der gleichartigen Tage aus der eigenen Historie des Kunden, Slot für Slot.
 * Kein Fremdprofil, kein Modell — und ausdrücklich keine Live-Prognose.
 *
 * ── ⚠ DER MITTELWERT ENTHÄLT DEN BEWERTETEN TAG NICHT (Leave-one-out), UND ZWAR HIER, NICHT IM
 *      TEST ─────────────────────────────────────────────────────────────────────────────────────
 * Am echten Lastgang gemessen (§2.2): bei `Wochentag(7) × Monat` sieht der selbst-einschliessende
 * Wert um 25 % besser aus als der ehrliche (Tages-nMAE 25,5 % gegen 33,9 %); das Leakage skaliert
 * mit `1/n` des Eimers. Ohne diese Regel sähe ausgerechnet die FEINSTE Einteilung am besten aus,
 * obwohl sie die schlechteste ist — der Fehler wäre also nicht bloss eine zu gute Zahl, sondern
 * eine falsche Bauentscheidung, die eine zu gute Zahl als Beleg mitbringt.
 *
 * ── ⚠ KEIN STILLER RÜCKFALL ────────────────────────────────────────────────────────────────────
 * Bleibt für einen Tag kein Vergleichstag übrig, entsteht KEIN Ersatzwert aus dem Gesamtmittel
 * (§2.2, dieselbe Regel wie B22 §4.1). Der Grund wird benannt und der Aufrufer entscheidet.
 */
export type ConsumptionPatternScheme =
  /** nur Kalendermonat — bestes Leave-one-out-Ergebnis an n = 1 Kunde (§2.3) */
  | 'month'
  /** WT/WE × Kalendermonat — 0,6 pp dahinter; die Achse, die bei GEWERBE tragen dürfte */
  | 'daytype_month'
  /** WT/WE × Jahreszeit — deutlich schwächer, aber gröbere Eimer für kurze Lastgänge */
  | 'daytype_season'

/**
 * ⚠ [ANNAHME, vorläufig] — REVISIONSPFLICHTIG, sobald ein gewerblicher Lastgang vorliegt.
 *
 * `month` gewinnt unter Leave-one-out am einzigen gemessenen Kunden (28,2 % gegen 28,8 % bei
 * `daytype_month`) — 0,6 pp sind aber kein Abstand, sondern Rauschen, und der gemessene Kunde ist
 * ein HAUSHALT mit Heizungslast, bei dem die Wochentagsachse nichts trägt (Verhältnis WE/WT über
 * alle Tage 0,97). Die Zielgruppe des Kalkulators sind Gewerbebetriebe; bei einer Bäckerei ist
 * genau diese Achse der Unterschied zwischen Betrieb und Stillstand. Die Wahl ist im Pflichtenheft
 * §4 ausdrücklich OFFEN und wartet auf einen zweiten, gewerblichen Lastgang `[MARTIN]`.
 * `weekday_month` (sieben Wochentage) ist dagegen entschieden AUSGESCHLOSSEN (§2.3) und steht
 * deshalb nicht im Typ.
 */
export const DEFAULT_CONSUMPTION_PATTERN_SCHEME: ConsumptionPatternScheme = 'month'

/**
 * ⚠ [ANNAHME, vorläufig] Wie viele Vergleichstage ein Eimer nach dem Ausschluss des bewerteten
 * Tages mindestens tragen muss. Ein einzelner Vergleichstag ist kein Mittelwert, sondern eine
 * Kopie eines fremden Tages — die Schwelle steht im Pflichtenheft §4 als offen und ist hier auf
 * das kleinste bezifferbare Mass gesetzt, bei dem das Wort „Muster" noch zutrifft.
 */
export const MIN_PEER_DAYS = 2

export type ConsumptionPatternOutcome =
  /** Prognose in kW auf den Intervallen DIESES Tages (signiert wie der Lastgang selbst). */
  | { ok: true; forecastKw: number[]; peerDays: number }
  /** Kein Wert — der Grund wird benannt statt ersetzt (§2.2). */
  | { ok: false; reason: 'empty_bucket' | 'insufficient_history' | 'standard_profile' }

/**
 * Lokaler Kalendertag als Schlüssel — dieselbe Ableitung wie `localDayKey` in
 * `daily-price-order.ts`. Exportiert, weil `consumptionPatternForDay` genau dieses Format erwartet
 * und ein von Hand gebildeter Schlüssel sonst still in `empty_bucket` liefe.
 */
export function localDayKeyOf(ms: number, timezoneMeta: string): string {
  const { year, month, day } = utcMsToLocalFields(ms, timezoneMeta)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Der Eimerschlüssel eines Tages.
 *
 * ⚠ Der Monat trägt bewusst KEIN Jahr — wie der übrige Rechenkern setzt das MVP einen einzelnen
 * abgedeckten Jahrgang voraus (`periodIndexByInterval`, `buildMonthlyTariffComparison`). Wochenende
 * ist `weekday >= 5` bei der Konvention 0 = Montag, identisch zu `dailyShape` in `h0.ts`.
 * Jahreszeiten sind meteorologisch (Dez–Feb, Mär–Mai, Jun–Aug, Sep–Nov).
 */
function bucketKeyOf(month: number, weekday: number, scheme: ConsumptionPatternScheme): string {
  if (scheme === 'month') return `m${month}`
  const dayType = weekday >= 5 ? 'we' : 'wt'
  if (scheme === 'daytype_month') return `${dayType}-m${month}`
  return `${dayType}-s${Math.floor((month % 12) / 3)}`
}

type DayIndex = {
  /** Kalendertag → Intervall-Indizes in chronologischer Reihenfolge. */
  slotsByDay: Map<string, number[]>
  /** Eimerschlüssel → Kalendertage dieses Eimers. */
  daysByBucket: Map<string, string[]>
  /** Kalendertag → Eimerschlüssel. */
  bucketOfDay: Map<string, string>
}

function buildDayIndex(loadProfile: LoadProfile, scheme: ConsumptionPatternScheme): DayIndex {
  const slotsByDay = new Map<string, number[]>()
  const daysByBucket = new Map<string, string[]>()
  const bucketOfDay = new Map<string, string>()

  for (let i = 0; i < loadProfile.readings.length; i++) {
    const reading = loadProfile.readings[i]!
    const { year, month, day, weekday } = utcMsToLocalFields(
      Date.parse(reading.ts),
      loadProfile.timezoneMeta,
    )
    const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const slots = slotsByDay.get(key)
    if (slots) {
      slots.push(i)
      continue
    }
    slotsByDay.set(key, [i])
    const bucket = bucketKeyOf(month, weekday, scheme)
    bucketOfDay.set(key, bucket)
    const days = daysByBucket.get(bucket)
    if (days) days.push(key)
    else daysByBucket.set(bucket, [key])
  }

  return { slotsByDay, daysByBucket, bucketOfDay }
}

/**
 * Der Slot-Mittelwert der Vergleichstage eines Eimers, OHNE den bewerteten Tag.
 *
 * Gemittelt wird je SLOTPOSITION innerhalb des lokalen Tages, nicht je Uhrzeit: damit fallen
 * DST-Tage (92 bzw. 100 Intervalle) von selbst richtig, und ein Vergleichstag, der eine Position
 * gar nicht hat, trägt dort schlicht nichts bei — statt die Reihe zu verkürzen oder mit 0 zu
 * verdünnen. Ein Zielslot ohne jeden Beitrag bekommt 0; das ist kein Rückfall auf eine andere
 * Kurve, sondern die Aussage „für diese Position gibt es keinen Vergleichswert".
 */
function meanOverPeers(
  draws: number[],
  slotsByDay: Map<string, number[]>,
  peerDays: string[],
  targetSlots: number[],
): number[] {
  const sum = new Array<number>(targetSlots.length).fill(0)
  const count = new Array<number>(targetSlots.length).fill(0)

  for (const peer of peerDays) {
    const peerSlots = slotsByDay.get(peer)
    if (!peerSlots) continue
    const upTo = Math.min(peerSlots.length, targetSlots.length)
    for (let p = 0; p < upTo; p++) {
      sum[p]! += draws[peerSlots[p]!] ?? 0
      count[p]! += 1
    }
  }

  return sum.map((s, p) => (count[p]! > 0 ? s / count[p]! : 0))
}

/**
 * Die Verbrauchsprognose für EINEN lokalen Kalendertag (§2.7 (2)).
 *
 * Der Parameter ist der Tag selbst und kein Schalter: das Leave-one-out ist Produktivverhalten,
 * nicht eine Testhilfe, die man abschalten könnte.
 */
export function consumptionPatternForDay(
  loadProfile: LoadProfile,
  targetDayKey: string,
  scheme: ConsumptionPatternScheme = DEFAULT_CONSUMPTION_PATTERN_SCHEME,
): ConsumptionPatternOutcome {
  // §0.2: ein synthetisches Profil träfe sich selbst exakt — Muster und Wahrheit wären dieselbe
  // Formel (`h0.ts`: „Es gibt keinen Zufall in diesem Generator"), und die ausgewiesene Güte wäre
  // eine Selbstauskunft.
  if (loadProfile.source === 'standard_profile') return { ok: false, reason: 'standard_profile' }

  const index = buildDayIndex(loadProfile, scheme)
  const targetSlots = index.slotsByDay.get(targetDayKey)
  if (!targetSlots) return { ok: false, reason: 'empty_bucket' }

  const draws = loadProfile.readings.map((r) => r.gridPowerKw)
  return patternFromIndex(draws, index, targetDayKey, targetSlots)
}

function patternFromIndex(
  draws: number[],
  index: DayIndex,
  targetDayKey: string,
  targetSlots: number[],
): ConsumptionPatternOutcome {
  const bucket = index.bucketOfDay.get(targetDayKey)
  const peers = (bucket ? (index.daysByBucket.get(bucket) ?? []) : []).filter(
    (d) => d !== targetDayKey,
  )
  if (peers.length === 0) return { ok: false, reason: 'empty_bucket' }
  if (peers.length < MIN_PEER_DAYS) return { ok: false, reason: 'insufficient_history' }
  return {
    ok: true,
    forecastKw: meanOverPeers(draws, index.slotsByDay, peers, targetSlots),
    peerDays: peers.length,
  }
}

export type ForecastDrawSeries = {
  /** Prognostizierter Netzbezug je Intervall (kW, signiert). Auf Tagen ohne Muster: 0. */
  forecastKw: number[]
  /** Trägt das Intervall ein Muster? Tage ohne Muster sind hier durchgehend `false`. */
  hasPattern: boolean[]
  /** Kalendertage mit Muster bzw. ohne. Beide gehören in den Nachweis, nicht in eine Fussnote. */
  patternDays: number
  daysWithoutPattern: number
}

/**
 * Dieselbe Prognose über den GANZEN Lastgang, Tag für Tag — der Eingabetausch des Vorhabens (§1).
 *
 * Der Tagesindex entsteht EINMAL und wird von allen Tagen geteilt; `consumptionPatternForDay` baut
 * ihn je Aufruf neu und ist der Einzelfall-Zugang derselben Rechnung.
 */
export function forecastDrawSeries(
  loadProfile: LoadProfile,
  scheme: ConsumptionPatternScheme = DEFAULT_CONSUMPTION_PATTERN_SCHEME,
): ForecastDrawSeries {
  const n = loadProfile.readings.length
  const forecastKw = new Array<number>(n).fill(0)
  const hasPattern = new Array<boolean>(n).fill(false)
  if (loadProfile.source === 'standard_profile') {
    return { forecastKw, hasPattern, patternDays: 0, daysWithoutPattern: 0 }
  }

  const index = buildDayIndex(loadProfile, scheme)
  const draws = loadProfile.readings.map((r) => r.gridPowerKw)
  let patternDays = 0
  let daysWithoutPattern = 0

  for (const [dayKey, targetSlots] of index.slotsByDay) {
    const outcome = patternFromIndex(draws, index, dayKey, targetSlots)
    if (!outcome.ok) {
      daysWithoutPattern += 1
      continue
    }
    patternDays += 1
    for (let p = 0; p < targetSlots.length; p++) {
      forecastKw[targetSlots[p]!] = outcome.forecastKw[p] ?? 0
      hasPattern[targetSlots[p]!] = true
    }
  }

  return { forecastKw, hasPattern, patternDays, daysWithoutPattern }
}
