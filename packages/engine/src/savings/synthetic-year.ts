import type { LoadProfile, LoadReading, PvProfile, PvReading } from 'shared'

import { DAYS_PER_YEAR, coveredDaysOf } from './annualization'
import {
  addDays,
  findReferenceWeek,
  localDateKeyOf,
  localMidnightMs,
  parseDateKey,
  slotsInLocalDay,
  type ReferenceWeek,
  type ReferenceWeekDay,
} from './reference-week'

/**
 * D6 Teil 3 — DER SYNTHETISCHE JAHRES-LASTGANG: gemessene Tage unverändert, fehlende Tage mit der
 * ECHTEN Tagesform der Referenzwoche belegt.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ GESCHÄTZT IST DER LASTGANG, NICHT DAS ERGEBNIS
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Das ist der ganze Zweck dieses Moduls. Hier entsteht eine EINGABE — ein vollständiges
 * 365-Tage-Profil —, auf dem anschliessend dieselbe Rechenkette läuft wie auf dem echten
 * (`computeAnalysis`): derselbe SoC-Durchlauf, derselbe Dispatch, dieselbe Spitzenkappung. Der
 * naheliegende und falsche Weg wäre gewesen, die fertigen Ersparnis-Zahlen mit `365 / coveredDays`
 * zu strecken; eine Batterie ist aber keine lineare Funktion ihrer Betriebstage. Prinzip 3
 * („physikalisch korrekte Simulation, kein Peak-Zählen") gilt für den hochgerechneten Lauf
 * genauso wie für den gemessenen.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIE FEHLENDEN TAGE TRAGEN ECHTE MESSWERTE — NICHT SKALIERTE
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ein fehlender Tag bekommt die Viertelstundenwerte des Referenzwochentags mit DEMSELBEN
 * Wochentag, Wert für Wert. Es wird nichts gestreckt und nichts geglättet — und daraus folgt
 * zweierlei:
 *
 *  • Die Tagesmengen sind auf die Referenzwoche GEEICHT, weil sie ihre Tagesmengen SIND: sieben
 *    gefüllte Tage tragen exakt `rateKwhPerDay × 7`. Ein Skalieren auf die Wochenrate hätte
 *    dieselbe Wochensumme ergeben und dabei die Unterschiede zwischen Werktag und Wochenende
 *    eingeebnet — also ausgerechnet das weggerechnet, was die Referenzwoche wertvoll macht.
 *  • Die PV-Wirkung reist mit. Ist die Anlage BESTEHEND, steckt ihre Eigenversorgung in diesen
 *    Messwerten bereits als gesenkter Bezug (und ihre Einspeisung als negativer Wert). Es braucht
 *    dafür keine zweite PVGIS-Schätzung — und es darf auch keine geben: der Abzug zählte dieselbe
 *    Energie ein zweites Mal (dieselbe Überlegung wie `pv_already_in_grid_profile`).
 *
 * ⚠ Was die gefüllten Tage dagegen NICHT tragen, ist der Jahresgang: ein Winterwert steht
 * gegebenenfalls im Juli. Genau das ist die Schätzung, und der Report weist sie als solche aus.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WO DAS FENSTER LIEGT, ENTSCHEIDET DIESES MODUL NICHT ALLEIN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * 365 Kalendertage, die alle gemessenen Tage enthalten — aber WELCHE 365, hängt von etwas ab, das
 * der Rechenkern nicht wissen darf: bis wann Marktpreise geführt werden. Ein naiv nach vorne
 * gelegtes Fenster schöbe die Lücke in die ZUKUNFT, für die es weder Börsenpreise noch
 * Netzentgelt-Zeilen noch Abgabensätze gibt; ein naiv nach hinten gelegtes rutschte unter den
 * Anker, ab dem der Preisbestand überhaupt beginnt. Beide Grenzen kommen deshalb als `bounds`
 * herein — dieselbe Arbeitsteilung wie überall sonst: der Rechenkern rechnet mit dem Profil, das
 * er bekommt; WELCHES er bekommen darf, entscheiden die Ränder.
 *
 * Innerhalb der Grenzen wird das SPÄTESTMÖGLICHE Fenster gewählt. Das heisst: solange es geht,
 * beginnt das Jahr mit dem ersten gemessenen Tag (die Lücke liegt dann hinter den Messwerten, im
 * jüngsten verfügbaren Preiszeitraum); erst wenn das in die Zukunft liefe, wird so weit
 * zurückgerückt wie nötig — und keinen Tag weiter.
 *
 * ⚠ `annual-projection.ts` (D6 Teil 2b) legt sein Fenster IMMER vorwärts ab dem ersten Messtag.
 * Das ist dort ohne Folge, weil es die Preise für die Lücke selbst nachlädt bzw. nähert; hier
 * werden sie aus dem gepflegten Bestand gelesen.
 */

/**
 * Die Grenzen, in denen das Jahresfenster liegen darf — beide lokale Kalendertage, `YYYY-MM-DD`,
 * beide INKLUSIV.
 *
 * ⚠ Sie beschreiben den Zeitraum, für den der Aufrufer Preise und Tarifsätze BESCHAFFEN KANN,
 * nicht den Zeitraum des Lastgangs. Der Rechenkern kennt weder den Preisanker noch die Uhr.
 */
export type SyntheticYearBounds = {
  earliestDate: string
  latestDate: string
}

/** Das Ergebnis — der vollständige Lastgang samt dem, was über seine Entstehung zu sagen ist. */
export type SyntheticYearProfile = {
  /** 365 Kalendertage, lückenlos. `source`/`pvSource` unverändert vom echten Profil. */
  profile: LoadProfile
  /**
   * Die Brutto-PV-Reihe, nach DEMSELBEN Plan verlängert — gesetzt genau dann, wenn eine übergeben
   * wurde.
   *
   * ⚠ SIE MUSS MITWACHSEN. `simulateBattery` liest sie neben dem Lastgang; bliebe sie auf dem
   * gemessenen Zeitraum stehen, hätten die gefüllten Tage einen Netzbezug MIT PV-Wirkung (er
   * steckt in den echten Messwerten), aber keine Brutto-Erzeugung daneben. Die
   * Eigenverbrauchs-Ersparnis fiele dort auf null, und das Jahresergebnis wäre gegenüber dem
   * gemessenen systematisch zu schlecht — ohne dass irgendetwas es sagte.
   */
  pvProfile?: PvProfile
  /** Erster Kalendertag des Fensters (lokal, `YYYY-MM-DD`, inklusiv). */
  windowFromDate: string
  /** Letzter Kalendertag des Fensters (lokal, inklusiv). */
  windowToDate: string
  /** Kalendertage des Fensters mit echten Messwerten. */
  measuredDays: number
  /** Kalendertage des Fensters, die aus der Referenzwoche gefüllt wurden. */
  projectedDays: number
  reference: ReferenceWeek
}

/**
 * Warum kein synthetisches Jahr entstanden ist. Ein eigener Wert je Grund, damit der Report sagen
 * kann, was fehlt, statt das Kapitel kommentarlos wegzulassen.
 */
export type SyntheticYearBlocker =
  /** Der Lastgang deckt bereits ein volles Jahr ab — es gibt nichts hochzurechnen. */
  | 'full_period'
  /** Synthetisches Standardprofil: es trägt sein Jahr bereits als Eingabe (s. `annualizationFactor`). */
  | 'synthetic_profile'
  /** Leerer Lastgang. */
  | 'no_data'
  /** Keine sieben aufeinanderfolgenden vollständigen Kalendertage — s. `findReferenceWeek`. */
  | 'no_reference_week'
  /**
   * Die belegten Tage liegen weiter als 365 Kalendertage auseinander (Lastgang mit grossen Löchern).
   * Ein Jahresfenster müsste dann echte Messwerte wegschneiden, um zu passen — und das Ergebnis
   * wäre weder der gemessene noch ein hochgerechneter Zeitraum.
   */
  | 'span_exceeds_year'
  /**
   * Innerhalb der übergebenen Grenzen liegt kein Jahresfenster, das alle Messwerte enthält —
   * typisch für einen Lastgang, der zu nah am Preisanker beginnt. Es wird dann NICHTS
   * zurechtgeschnitten: ein Fenster, das gemessene Tage weglässt, wäre eine andere Auswertung.
   */
  | 'no_window'

export type SyntheticYearResult =
  | { ok: true; value: SyntheticYearProfile }
  | { ok: false; blocker: SyntheticYearBlocker }

/**
 * Den synthetischen Jahres-Lastgang bauen.
 *
 * ── DER ABLAUF ────────────────────────────────────────────────────────────────────────────────
 *  1. Referenzwoche bestimmen (`findReferenceWeek`).
 *  2. Fenster: 365 Kalendertage, endend auf dem letzten belegten Ortstag.
 *  3. Jeder Tag des Fensters, den der Lastgang nicht belegt, bekommt die Messwerte des
 *     Referenzwochentags mit demselben WOCHENTAG — an den echten Kalenderdaten in der echten
 *     Zeitzone, damit Preisblattstände, Saisonfenster und Abgabenstichtage greifen können.
 *  4. Echte und gefüllte Werte zu EINER chronologischen Reihe.
 *
 * ── ⚠ WARUM NACH WOCHENTAG UND NICHT AB LÜCKENBEGINN DURCHGEZÄHLT ─────────────────────────────
 * „Zyklisch wiederholt" lässt beides zu, aber nur eine der beiden Phasen ist richtig: ein Betrieb
 * mit Wochenendruhe hat an einem Sonntag einen anderen Tagesverlauf als an einem Dienstag. Ab
 * Lückenbeginn durchgezählt landete der Sonntagsverlauf je nach Startdatum auf einem beliebigen
 * Wochentag — und der Lastgang trüge dann sieben Ruhetage, die alle falsch liegen. Das Fenster hat
 * genau sieben Tage und damit jeden Wochentag genau einmal; die Zuordnung ist deshalb eindeutig.
 *
 * ── ⚠ ZEITUMSTELLUNG ──────────────────────────────────────────────────────────────────────────
 * Zieltag und Referenztag können verschieden lang sein (92/96/100 Viertelstunden). Gefüllt wird
 * die TATSÄCHLICHE Länge des Zieltags; reichen die Werte des Referenztags nicht, wird von vorne
 * gelesen (`% refLen`). Der Zieltag bleibt damit lückenlos, und die Tagesmenge weicht an den zwei
 * Umstellungstagen des Jahres um eine Stunde ab — eine Stunde, deren Alternative eine Lücke oder
 * eine Überlappung in der Reihe wäre.
 */
export function buildSyntheticYearProfile(
  loadProfile: LoadProfile,
  bounds: SyntheticYearBounds,
  pvProfile?: PvProfile,
): SyntheticYearResult {
  if (loadProfile.source === 'standard_profile') return { ok: false, blocker: 'synthetic_profile' }

  const coveredDays = coveredDaysOf(loadProfile)
  if (coveredDays <= 0 || loadProfile.readings.length === 0) {
    return { ok: false, blocker: 'no_data' }
  }
  if (coveredDays >= DAYS_PER_YEAR) return { ok: false, blocker: 'full_period' }

  const tz = loadProfile.timezoneMeta
  const covered = new Set<string>()
  let lastDate = ''
  let firstDate = ''
  for (const reading of loadProfile.readings) {
    const ms = Date.parse(reading.ts)
    if (!Number.isFinite(ms)) continue
    const date = localDateKeyOf(ms, tz)
    covered.add(date)
    if (firstDate === '' || date < firstDate) firstDate = date
    if (date > lastDate) lastDate = date
  }
  if (covered.size === 0) return { ok: false, blocker: 'no_data' }

  /*
   * Das späteste Fenster, das noch alle Messwerte enthält und in den Grenzen bleibt:
   *   • es darf nicht nach dem ersten Messtag beginnen (sonst fehlten Messwerte am Anfang),
   *   • es darf nicht nach `latestDate` enden,
   *   • es darf nicht vor `earliestDate` beginnen und muss den letzten Messtag noch enthalten.
   */
  const latestStart = minDate(firstDate, addDays(bounds.latestDate, -(DAYS_PER_YEAR - 1)))
  const earliestStart = maxDate(bounds.earliestDate, addDays(lastDate, -(DAYS_PER_YEAR - 1)))
  if (firstDate < addDays(lastDate, -(DAYS_PER_YEAR - 1))) {
    return { ok: false, blocker: 'span_exceeds_year' }
  }
  if (earliestStart > latestStart) return { ok: false, blocker: 'no_window' }

  const windowFromDate = latestStart
  const windowToDate = addDays(windowFromDate, DAYS_PER_YEAR - 1)

  const reference = findReferenceWeek(loadProfile)
  if (reference === null) return { ok: false, blocker: 'no_reference_week' }

  /*
   * ⚠ DER PLAN ENTSTEHT EINMAL UND WIRD ZWEIMAL ANGEWANDT — auf den Lastgang und auf die
   * Brutto-PV-Reihe. Zwei getrennte Zuordnungen könnten je Tag verschiedene Referenztage wählen;
   * Netzbezug und Erzeugung stammten dann aus verschiedenen Tagen, und der Eigenverbrauch, den
   * die Simulation daraus bildet, hätte nie stattgefunden.
   */
  const byWeekday = new Map(reference.days.map((day) => [day.weekday, day]))
  const plan: {
    date: string
    source: ReferenceWeekDay
    startMs: number
    slots: number
  }[] = []

  for (let i = 0; i < DAYS_PER_YEAR; i++) {
    const date = addDays(windowFromDate, i)
    if (covered.has(date)) continue

    /*
     * Der Wochentag des ZIELtags, 0 = Montag — dieselbe Zählung wie `utcMsToLocalFields` und
     * damit wie `reference.days`.
     */
    const [y, m, d] = parseDateKey(date)
    const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
    const source = byWeekday.get(weekday)
    /* Kann nicht eintreten (sieben Tage = jeder Wochentag einmal), aber ein `!` wäre eine Behauptung. */
    if (!source) continue

    plan.push({
      date,
      source,
      startMs: localMidnightMs(date, tz),
      slots: slotsInLocalDay(date, tz, loadProfile.intervalMinutes),
    })
  }

  const intervalMs = loadProfile.intervalMinutes * 60 * 1000
  const filled: LoadReading[] = []
  for (const day of plan) {
    for (let slot = 0; slot < day.slots; slot++) {
      filled.push({
        ts: new Date(day.startMs + slot * intervalMs).toISOString(),
        gridPowerKw: day.source.readings[slot % day.source.readings.length]!.gridPowerKw,
      })
    }
  }

  const readings = [...loadProfile.readings, ...filled].sort(
    (a, b) => Date.parse(a.ts) - Date.parse(b.ts),
  )

  return {
    ok: true,
    value: {
      profile: { ...loadProfile, readings },
      ...(pvProfile ? { pvProfile: extendPv(pvProfile, plan, tz, intervalMs) } : {}),
      windowFromDate,
      windowToDate,
      measuredDays: DAYS_PER_YEAR - plan.length,
      projectedDays: plan.length,
      reference,
    },
  }
}

/**
 * Die Brutto-PV-Reihe nach demselben Plan verlängern.
 *
 * ⚠ Trägt der Referenztag KEINE Erzeugungswerte, bekommt der Zieltag auch keine — statt einer
 * erfundenen Erzeugung bleibt die Reihe dort schlicht leer, genau wie im gemessenen Zeitraum.
 * `alignPvGrossToLoad` behandelt das als nicht getroffenen Slot, und die Simulation rechnet dort
 * ohne Brutto-PV weiter.
 */
function extendPv(
  pvProfile: PvProfile,
  plan: readonly { source: ReferenceWeekDay; startMs: number; slots: number }[],
  timeZone: string,
  intervalMs: number,
): PvProfile {
  const byDate = new Map<string, PvReading[]>()
  for (const reading of pvProfile.readings) {
    const ms = Date.parse(reading.ts)
    if (!Number.isFinite(ms)) continue
    const date = localDateKeyOf(ms, timeZone)
    const bucket = byDate.get(date)
    if (bucket) bucket.push(reading)
    else byDate.set(date, [reading])
  }
  for (const bucket of byDate.values()) bucket.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))

  const filled: PvReading[] = []
  for (const day of plan) {
    const source = byDate.get(day.source.date)
    if (!source || source.length === 0) continue
    for (let slot = 0; slot < day.slots; slot++) {
      filled.push({
        ts: new Date(day.startMs + slot * intervalMs).toISOString(),
        pvGenerationKw: source[slot % source.length]!.pvGenerationKw,
      })
    }
  }

  return {
    readings: [...pvProfile.readings, ...filled].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts)),
  }
}

const minDate = (a: string, b: string): string => (a < b ? a : b)
const maxDate = (a: string, b: string): string => (a > b ? a : b)
