import {
  PVGIS_WEATHER_YEARS,
  type PvgisEchoedInputs,
  type PvgisHourlySample,
} from './pvgis'

/**
 * Das Referenzprofil (B22a) — aus den zehn PVGIS-Wetterjahren EIN gemittelter Jahresverlauf, und
 * seine Abbildung auf das 15-min-Gitter eines gegebenen Lastgangs.
 *
 * Rein & deterministisch: gleiche Eingabe → bit-identische Ausgabe, kein I/O, keine Uhr, kein Netz.
 *
 * ── ⚠ DIE ZELLEN SIND UTC-KALENDERPOSITIONEN, NICHT ORTSZEIT — und das ist eine Entscheidung ────
 * Der Sonnenstand ist eine Funktion von UTC und geographischer Länge; die Sommerzeit kennt er
 * nicht. Zwei Jahre haben zur selben UTC-Kalenderposition (Monat/Tag/Stunde) praktisch dieselbe
 * Sonnenhöhe — über zehn Jahre gemittelt bleibt die Tagesform dadurch scharf.
 *
 * Über die ORTSZEIT indiziert wäre dasselbe Mittel unscharf: die Sommerzeit beginnt und endet je
 * Jahr an einem anderen Kalendertag (letzter Sonntag im März/Oktober, 2014–2023 zwischen dem 25.
 * und dem 31.), sodass für ein und denselben Kalendertag manche Jahre bereits umgestellt sind und
 * andere nicht. Gemittelt würden dann Werte, die eine Stunde Sonnenstand auseinanderliegen — die
 * Schulterstunden verwischten. Dazu käme ein struktureller Bruch: in Ortszeit hat der März-Tag der
 * Umstellung nur 23 und der Oktober-Tag 25 Stunden, das Raster wäre also weder lückenlos noch
 * kollisionsfrei.
 *
 * ⚠ „UTC-Kalenderposition" heisst AUSDRÜCKLICH NICHT „Position im Quell-Array". Nachgeschlagen wird
 * über den ZEITPUNKT jedes Ziel-Slots. Nur so trägt die Abbildung ein Zielgitter, das über die
 * lokale Wanduhr läuft (`generateStandardLoadProfile`: von Ortszeit-Mitternacht bis Ortszeit-
 * Mitternacht, an einem Sommerzeit-Tag deshalb 92 bzw. 100 Slots) — ein positionsweises Auflegen
 * verschöbe dort die halbe Jahreskurve. Der Zeitzonen-Bezug des Lastgangs steckt bereits in seinen
 * Zeitstempeln; das Referenzprofil braucht ihn deshalb gar nicht zu kennen und ist damit eine reine
 * Eigenschaft des STANDORTS, nicht der Uhr des Kunden.
 *
 * ── ⚠ DER PREIS DES ZEHN-JAHRES-MITTELS: ES GLÄTTET, UND ZWAR MESSBAR ──────────────────────────
 * Das Pflichtenheft begründet das Mittel über die Genauigkeit des JAHRESERTRAGS (0,6 % gegen die
 * Meteonorm-Klimanormale, mit der PV*SOL rechnet). Über die FORM der Kurve sagt es nichts — und die
 * ist nicht dieselbe: Wolkentage verschiedener Jahre decken sich nicht, ein Mittel aus zehn Jahren
 * ist deshalb glatter als jedes einzelne davon.
 *
 * Gegen die ECHTE PVGIS-Antwort gemessen (02.09.2026; Wien, 10,2 kWp, 90°, Azimut −47, gekoppelt
 * mit dem H0-Profil 4.500 kWh und dem Speicher 19,2 kWh / 10,6 kW): die gemittelte Kurve erreicht
 * als Spitze 6,18 kW, die zehn Einzeljahre 7,55 bis 8,30 kW. Die Eigenverbrauchs-Ersparnis liegt
 * dadurch bei € 428,27 statt bei € 408,45 (dem Mittel der zehn einzeln gerechneten Jahre) — 4,9 %
 * höher, und höher als in JEDEM einzelnen Jahr (Höchstwert € 425,92). Grund: eine geglättete
 * Erzeugung sättigt Speicher und Verbrauch seltener, es wird weniger eingespeist und mehr selbst
 * verbraucht.
 *
 * ⇒ Die Schätzung ist systematisch leicht OPTIMISTISCH, über die ± 5,8 % Jahresstreuung hinaus.
 * Der Betrag ist klein und die Alternative wäre schlechter (ein einzelnes Wetterjahr auszuweisen
 * behauptete eine Genauigkeit, die die Datenlage nicht hergibt) — aber er gehört gesagt, und der
 * Report-Hinweis in B22b sollte ihn neben der Streuung nennen. Die Eigenschaft ist als Test
 * festgehalten (`reference-profile.test.ts`), damit sie nicht unbemerkt wächst.
 */

/** Kalendertage je Monat in einem NICHT-Schaltjahr — die Ordnung, in der das Referenzprofil liegt. */
const DAYS_PER_MONTH_NON_LEAP = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const

/** Kumulierte Tage vor dem jeweiligen Monat (Index 0 = Jänner). */
const DAYS_BEFORE_MONTH: readonly number[] = (() => {
  const out: number[] = []
  let sum = 0
  for (const d of DAYS_PER_MONTH_NON_LEAP) {
    out.push(sum)
    sum += d
  }
  return out
})()

/** 365 × 24 — die Länge des Referenzprofils. Ausdrücklich NICHT 8.784 (s. `mapFeb29ToFeb28`). */
export const REFERENCE_PROFILE_HOURS = 365 * 24

/**
 * ⚠ DIE SCHALTJAHR-REGEL (Pflichtenheft §4.1 — in B22a zu entscheiden, hier entschieden).
 *
 * **Das Referenzprofil trägt 8.760 Werte und kennt den 29. Februar nicht. Fällt er im Analysejahr
 * an, bekommt er die Werte des 28. Februar.**
 *
 * ── Warum das Profil ohne den 29. Februar gebildet wird ─────────────────────────────────────────
 * Von zehn Wetterjahren sind nur zwei Schaltjahre (2016, 2020). Ein eigener Zelleneintrag für den
 * 29. Februar wäre deshalb ein Mittel aus ZWEI Jahren neben 8.760 Mitteln aus zehn — ein Tag im
 * Jahr, dessen Streuung fünfmal so gross ist wie die aller anderen, ohne dass man es der Zahl
 * ansähe. An den echten Daten ist der Unterschied gross genug, dass er auffällt: der 29. Februar
 * 11:00 UTC liegt über 2016/2020 bei 2.293,65 W, der 28. Februar über alle zehn Jahre bei
 * 5.205,78 W. Ein aus zwei Jahren gemittelter Tag im Zehn-Jahres-Profil behauptete eine
 * Genauigkeit, die er nicht hat.
 *
 * ── Warum ausgerechnet der 28. Februar und nicht „weglassen" oder „interpolieren" ───────────────
 * Weglassen ginge nicht: das Zielgitter eines Schaltjahres HAT diesen Tag, und ein Slot ohne Wert
 * wäre eine Lücke, die im Ergebnis wie eine wolkenverhangene Nacht aussähe (der Kunde bekäme
 * 24 Stunden ohne Erzeugung mitten im Februar). Ein Mittel aus dem 28.02. und dem 01.03. wäre eine
 * dritte, nirgends gemessene Kurve. Der Nachbartag ist die Wahl, die nichts erfindet: ein Tag
 * Unterschied im Sonnenstand ist kleiner als die Streuung zwischen zwei Wetterjahren desselben
 * Tages, und der 28. Februar ist der einzige Tag, der in JEDEM Jahr existiert und unmittelbar
 * daneben liegt.
 *
 * ── Die Gegenrichtung ist damit ebenfalls beantwortet ───────────────────────────────────────────
 * Ein Schaltjahr-WETTERJAHR (2016, 2020) auf ein Nicht-Schaltjahr abzubilden heisst schlicht: seine
 * 24 Stunden des 29. Februar fliessen in KEINE Zelle ein. Sie werden verworfen und nicht etwa auf
 * den 28. Februar aufaddiert — sonst zöge ein zusätzlicher Tag den Mittelwert genau dieses einen
 * Kalendertages, und zwar nur für die zwei Schaltjahre.
 */
export function mapFeb29ToFeb28(month: number, day: number): { month: number; day: number } {
  if (month === 2 && day === 29) return { month: 2, day: 28 }
  return { month, day }
}

/**
 * (Monat, Tag, Stunde) → Zellenindex im Referenzprofil, 0…8.759. Der 29. Februar wird vorher auf
 * den 28. abgebildet (s. `mapFeb29ToFeb28`); jede andere Kalenderposition ausserhalb des
 * Nicht-Schaltjahres ist ein Programmfehler und liefert `null`.
 */
export function referenceHourIndex(month: number, day: number, hour: number): number | null {
  const mapped = mapFeb29ToFeb28(month, day)
  const maxDay = DAYS_PER_MONTH_NON_LEAP[mapped.month - 1]
  if (maxDay == null || mapped.day < 1 || mapped.day > maxDay) return null
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null
  return ((DAYS_BEFORE_MONTH[mapped.month - 1] ?? 0) + (mapped.day - 1)) * 24 + hour
}

/** Zellenindex für einen UTC-Zeitpunkt. Die Minute wird verworfen — das IST die Treppenfunktion. */
export function referenceHourIndexForUtcMs(utcMs: number): number | null {
  const d = new Date(utcMs)
  if (Number.isNaN(d.getTime())) return null
  return referenceHourIndex(d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours())
}

/** Der Jahresertrag eines einzelnen Wetterjahres — Grundlage der Streuungsangabe im Report. */
export type AnnualYield = { year: number; kwh: number }

export type WeatherYearAverage = {
  /**
   * 8.760 Zellen. `null` heisst: für diese UTC-Kalenderposition trug KEIN Wetterjahr einen Wert.
   * Ausdrücklich nicht `0` — eine 0 wäre eine gemessene Nacht, `null` ist eine Lücke.
   */
  meanKwByHour: readonly (number | null)[]
  /** Wie viele Wetterjahre in die jeweilige Zelle eingegangen sind. */
  countByHour: readonly number[]
  /** Jahresertrag je Wetterjahr, aufsteigend. Enthält den 29. Februar — er IST Teil des Ertrags. */
  annualYields: readonly AnnualYield[]
}

/**
 * Mittelt die Stundenwerte aller gelieferten Wetterjahre je UTC-Kalenderposition.
 *
 * Bewusst OHNE Vollständigkeitsprüfung — die macht `buildPvReferenceProfile` darüber. Getrennt,
 * damit sich das Mittel an einer gekürzten ECHTEN Antwort prüfen lässt (eine vollständige
 * Zehn-Jahres-Antwort sind 8,2 MB und gehört nicht als Fixture ins Repo).
 */
export function averageWeatherYears(samples: readonly PvgisHourlySample[]): WeatherYearAverage {
  const sums = new Array<number>(REFERENCE_PROFILE_HOURS).fill(0)
  const counts = new Array<number>(REFERENCE_PROFILE_HOURS).fill(0)
  const yieldByYear = new Map<number, number>()

  for (const s of samples) {
    const d = new Date(s.utcMs)
    const year = d.getUTCFullYear()
    const month = d.getUTCMonth() + 1
    const day = d.getUTCDate()

    // Der Jahresertrag zählt JEDE gelieferte Stunde, auch den 29. Februar: er ist Teil des Ertrags
    // dieses Jahres, und die Streuungsangabe im Report soll den echten Jahreswert nennen.
    yieldByYear.set(year, (yieldByYear.get(year) ?? 0) + s.pvGenerationKw)

    // Für die ZELLEN dagegen fällt er heraus (s. `mapFeb29ToFeb28`).
    if (month === 2 && day === 29) continue

    const idx = referenceHourIndex(month, day, d.getUTCHours())
    if (idx == null) continue
    sums[idx] = (sums[idx] ?? 0) + s.pvGenerationKw
    counts[idx] = (counts[idx] ?? 0) + 1
  }

  const meanKwByHour = sums.map((sum, i) => {
    const n = counts[i] ?? 0
    return n === 0 ? null : sum / n
  })

  const annualYields = [...yieldByYear.entries()]
    .map(([year, kwh]) => ({ year, kwh }))
    .sort((a, b) => a.year - b.year)

  return { meanKwByHour, countByHour: counts, annualYields }
}

/**
 * Das fertige Referenzprofil — ein gemittelter Jahresverlauf für GENAU EINE Modulfläche, in kW.
 *
 * Es ist die einzige Grösse, die der Proxy an den Browser zurückgibt: der Lastgang bleibt dort, die
 * Kopplung Verbrauch − Erzeugung geschieht mit `applyEstimatedPv` im Browser (Prinzip 4).
 */
export type PvReferenceProfile = {
  /** 8.760 Werte in kW, indiziert über `referenceHourIndex`. Lückenlos — s. `buildPvReferenceProfile`. */
  hourlyKw: readonly number[]
  /** Die gemittelten Wetterjahre. Gehört in den Report, nicht in eine Fussnote (§2.1). */
  weatherYears: { from: number; to: number }
  /** Jahresertrag je Wetterjahr — die Streuung IST die ehrliche Genauigkeitsgrenze des Vorhabens. */
  annualYields: readonly AnnualYield[]
  /** Was PVGIS als Eingaben zurückgespiegelt hat — Nachweis der Rechenannahmen. */
  inputs: PvgisEchoedInputs
}

export type PvReferenceProfileOutcome =
  | { ok: true; profile: PvReferenceProfile }
  /**
   * `incomplete_coverage` — mindestens eine der 8.760 Kalenderpositionen trägt keinen Wert. Fail
   * closed: ein Profil mit Löchern ergäbe eine Erzeugungskurve, in der Stunden ohne Sonne stehen,
   * die es nie gab, und der Kunde sähe eine plausible, zu niedrige Zahl.
   * `unexpected_years` — die Antwort deckt nicht genau die angeforderten Wetterjahre ab. Aus einem
   * Zehn-Jahres-Mittel würde sonst still ein Neun-Jahres-Mittel, und der Report zitierte eine
   * Grundlage, die es nicht gibt.
   */
  | { ok: false; reason: 'incomplete_coverage' | 'unexpected_years' }

/**
 * Baut das Referenzprofil und prüft dabei beides, was still schiefgehen könnte: die Vollständigkeit
 * der Kalenderabdeckung und den tatsächlich gelieferten Jahressatz.
 */
export function buildPvReferenceProfile(
  samples: readonly PvgisHourlySample[],
  inputs: PvgisEchoedInputs,
  weatherYears: { from: number; to: number } = PVGIS_WEATHER_YEARS,
): PvReferenceProfileOutcome {
  const avg = averageWeatherYears(samples)

  const expected: number[] = []
  for (let y = weatherYears.from; y <= weatherYears.to; y++) expected.push(y)
  const got = avg.annualYields.map((a) => a.year)
  if (got.length !== expected.length || got.some((y, i) => y !== expected[i])) {
    return { ok: false, reason: 'unexpected_years' }
  }

  const hourlyKw: number[] = []
  for (const mean of avg.meanKwByHour) {
    if (mean == null) return { ok: false, reason: 'incomplete_coverage' }
    hourlyKw.push(mean)
  }

  return { ok: true, profile: { hourlyKw, weatherYears, annualYields: avg.annualYields, inputs } }
}

/**
 * ⚠ TREPPENFUNKTION, KEINE INTERPOLATION (Pflichtenheft §2.5).
 *
 * Der PVGIS-Stundenwert gilt für ALLE vier Viertelstunden seiner Stunde. Eine lineare Interpolation
 * behauptete einen Verlauf zwischen zwei Stundenwerten, den PVGIS gar nicht ausweist — und der
 * Kalkulator entscheidet an Preis- und Leistungsschwellen, an denen ein erfundener Zwischenwert
 * eine Ladeentscheidung kippen kann. Die Treppe erfindet nichts, was nicht in den Daten steht, und
 * sie ist zugleich die Regel, mit der die Wirkungsmessung der Bestandsaufnahme gefahren wurde
 * (€ 384,69 gehören zu dieser Regel und zu keiner anderen).
 *
 * Sie steckt in `referenceHourIndexForUtcMs`: die Minute des Ziel-Zeitstempels wird verworfen.
 *
 * @param timestamps Die Zeitstempel des Ziel-Lastgangs, ISO/UTC, in ihrer Reihenfolge. Die Rückgabe
 *                   hat dieselbe Länge und dieselbe Reihenfolge.
 */
export function expandReferenceToTimestamps(
  profile: PvReferenceProfile,
  timestamps: readonly string[],
): number[] {
  return timestamps.map((ts) => {
    const ms = Date.parse(ts)
    const idx = referenceHourIndexForUtcMs(ms)
    /*
     * Ein unlesbarer Zeitstempel kann hier nicht vorkommen: die Reihe stammt aus einem bereits
     * aufbereiteten `LoadProfile` (§3.3). Käme er doch, ist 0 kW die konservative Antwort — sie
     * unterschätzt den Eigenverbrauch, statt eine Erzeugung zu behaupten.
     */
    if (idx == null) return 0
    return profile.hourlyKw[idx] ?? 0
  })
}
