import type {
  LoadProfile,
  SpotPricePointInput,
  TariffOptimizationStatus,
  TariffParams,
  TariffPriceRange,
  TariffPricingInputs,
  TimeOfUseWindow,
} from 'shared'

import { utcMsToLocalFields } from '../parser/datetime'
import { findGridTariffRow, findGridTariffWindow } from './grid-tariff-window'
import { EPS } from './helpers'

// Zeit-Tarif-Zuordnung für tarifbewusstes Laden / Lastverschiebung (§3.7). Rein & deterministisch:
// bildet jedes 15-min-Intervall auf seinen Arbeitspreis (ct/kWh) ab und markiert die „günstigen"
// Fenster, in denen der kombinierte Dispatch (§3.6 Schritt 5) bevorzugt aus dem Netz lädt.
//
// Seit B21-3b (Delta 4) kann dieser Preis ZWEI Quellen zusammenführen — Marktpreis + Netzentgelt —
// statt nur ein wanduhr-basiertes Fensterschema. Die Funktion holt dafür nichts selbst: beide
// Quellen kommen als PARAMETER herein, genau wie der Batteriekatalog (s. `tariff-pricing.ts`).
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
  /** Günstig-Flag je Intervall: Rate liegt unter dem Referenzpreis (→ Ladefenster für Lastverschiebung). */
  isCheapWindow: boolean[]
  /** True, wenn überhaupt ein günstigeres Fenster existiert (sonst ist Lastverschiebung wirkungslos). */
  touActive: boolean
  /**
   * Delta 4/Delta 15: Konnte der Tarifoptimierungs-Hebel gerechnet werden?
   * `undefined` = gar nicht angefordert (kein Fehlerfall, unveränderter Stand vor B21).
   */
  tariffOptimization?: TariffOptimizationStatus
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
 * Der Marktpreis, dessen Intervall [tsStart, tsEnd) den Zeitpunkt enthält — `null`, wenn keiner.
 *
 * Binäre Suche über die (aufsteigend sortierte) Reihe statt eines Stunden-Rasters: die Tabelle
 * könnte laut B21-1 auch feiner tragen, und ein angenommenes Raster wäre genau die stillschweigende
 * Voraussetzung, die später niemand mehr prüft. Die Dauer wird am Eintrag GEMESSEN (`tsEnd`).
 */
function findSpotPrice(startMs: number[], prices: SpotPricePointInput[], ms: number): SpotPricePointInput | null {
  let lo = 0
  let hi = prices.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (startMs[mid]! <= ms) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  if (found < 0) return null
  const candidate = prices[found]!
  return Date.parse(candidate.tsEnd) > ms ? candidate : null
}

/** Aufeinanderfolgende, lückenlos aneinandergrenzende Bereiche zu einem zusammenfassen. */
function mergeRanges(ranges: TariffPriceRange[]): TariffPriceRange[] {
  const merged: TariffPriceRange[] = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && last.toIso === range.fromIso) last.toIso = range.toIso
    else merged.push({ ...range })
  }
  return merged
}

function isNetBasis(basis: string): boolean {
  return basis === 'net'
}

/**
 * Das Ergebnis von `combinedIntervalPrices` — entweder die Preisreihe oder der EINE Grund, aus dem
 * es sie nicht gibt. Bewusst eine diskriminierte Union statt „Preise plus optionalem Fehler":
 * eine halb gefüllte Reihe neben einem Befund wäre genau die Grundlage, aus der jemand doch noch
 * eine Zahl bildet.
 */
export type CombinedIntervalPrices =
  | { prices: number[] }
  | { blocker: TariffOptimizationStatus & { computable: false } }

/**
 * Der kombinierte Intervallpreis (Delta 4):
 *
 *     effectivePriceCtPerKwh(t) = energyPrice(t) + netzVerbrauchspreis(t)
 *
 * mit `netzVerbrauchspreis(t) = Fensterpreis(t) + Netzverlust`. Der Netzverlust ist zeitunabhängig
 * und kommt zu JEDEM Fensterpreis hinzu — er ist kein eigenes Fenster, sondern ein Sockel auf der
 * Netzentgelt-Seite (so steht er auch im Pflegeformular aus B21-2b: ein Feld neben den Fenstern).
 *
 * Schlägt die Zuordnung für auch nur EIN Intervall fehl, ist der Hebel für die GANZE Analyse nicht
 * berechenbar — nicht für den Rest berechnet und für die Lücke geschätzt. Delta 15 Regel C nennt
 * das für die Spotpreis-Seite; hier gilt es symmetrisch auch für die Netzentgelt-Seite, denn eine
 * fehlende Tarifzeile ist dieselbe Art von Loch in derselben Rechnung.
 *
 * ── ⚠ DIE ENERGIEPREIS-SEITE IST EIN PARAMETER, DIE NETZENTGELT-SEITE NICHT (01.09.2026) ───────
 * `energyPriceCtPerKwh` schaltet die ERSTE Komponente um:
 *   • weggelassen → der BÖRSENPREIS der jeweiligen Stunde (die aWATTar-Seite, unverändert),
 *   • eine Zahl   → derselbe Arbeitspreis für jedes Intervall (der IST-Tarif aus Schritt 2).
 *
 * Der Grund ist der Monatsvergleich „Ist vs. aWATTar": beide Reihen müssen dieselbe
 * Netzentgelt-Logik (Fensterzuordnung + Netzverlust-Sockel) durchlaufen, sonst vergleicht der
 * Report zwei Zahlen, die verschieden zusammengesetzt sind — und die Differenz enthielte einen
 * Anteil, der gar nicht am Strompreis liegt. Zwei parallele Implementierungen derselben
 * Fensterlogik liefen beim nächsten Preisblatt-Ausbau garantiert auseinander; es ist deshalb EINE
 * Funktion mit zwei Aufrufen, nicht zwei Funktionen.
 *
 * ⚠ Die Lückenprüfung der SPOTPREIS-Seite läuft auch dann, wenn ihr Wert gar nicht benutzt wird.
 * Das ist Absicht: beide Aufrufe teilen dasselbe `pricing` und müssen deshalb denselben Befund
 * liefern. Ein Ist-Preis, der eine Spotpreis-Lücke überlebt, während die aWATTar-Reihe daran
 * scheitert, ergäbe im Report eine einzelne Balkenreihe ohne ihre Vergleichsreihen — genau der
 * Teilzustand, den der Monatsvergleich ausschliesst.
 */
export function combinedIntervalPrices(
  loadProfile: LoadProfile,
  pricing: TariffPricingInputs,
  energyPriceCtPerKwh?: number,
): CombinedIntervalPrices {
  const { gridTariffRows, spotPrices } = pricing

  if (gridTariffRows == null || gridTariffRows.length === 0) {
    return {
      blocker: {
        computable: false,
        side: 'grid_tariff',
        kind: 'unavailable',
        ranges: [],
        message:
          'Tarifoptimierung nicht berechenbar: Für den gewählten Netzbetreiber und die gewählte ' +
          'Netzebene liegen keine Netzentgelt-Daten vor. Der Vergleich mit Börsen-Strompreisen ' +
          'braucht beide Preisseiten — Peak Shaving und Eigenverbrauch sind davon nicht betroffen.',
      },
    }
  }
  if (spotPrices == null) {
    return {
      blocker: {
        computable: false,
        side: 'spot_price',
        kind: 'unavailable',
        ranges: [],
        message:
          'Tarifoptimierung nicht berechenbar: Die Börsen-Strompreise konnten nicht gelesen werden. ' +
          'Peak Shaving und Eigenverbrauch sind davon nicht betroffen.',
      },
    }
  }
  if (!spotPrices.complete) {
    return {
      blocker: {
        computable: false,
        side: 'spot_price',
        kind: 'gap',
        ranges: spotPrices.missingRanges,
        message: gapMessage('Börsen-Strompreise', spotPrices.missingRanges),
      },
    }
  }

  const nonNetGrid = gridTariffRows.find((row) => !isNetBasis(String(row.priceBasis)))
  if (nonNetGrid) {
    return {
      blocker: {
        computable: false,
        side: 'grid_tariff',
        kind: 'price_basis',
        ranges: [{ fromIso: nonNetGrid.validFrom, toIso: nonNetGrid.validUntil ?? nonNetGrid.validFrom }],
        message:
          'Tarifoptimierung nicht berechenbar: Eine Netzentgelt-Zeile ist nicht als Nettopreis ' +
          'hinterlegt. Gerechnet wird durchgängig netto; eine Umrechnung würde einen Steuersatz ' +
          'voraussetzen, den wir nicht erfinden.',
      },
    }
  }
  const nonNetSpot = spotPrices.prices.find((p) => !isNetBasis(String(p.priceBasis)))
  if (nonNetSpot) {
    return {
      blocker: {
        computable: false,
        side: 'spot_price',
        kind: 'price_basis',
        ranges: [{ fromIso: nonNetSpot.tsStart, toIso: nonNetSpot.tsEnd }],
        message:
          'Tarifoptimierung nicht berechenbar: Ein Börsenpreis ist nicht als Nettopreis hinterlegt. ' +
          'Gerechnet wird durchgängig netto; eine Umrechnung würde einen Steuersatz voraussetzen, ' +
          'den wir nicht erfinden.',
      },
    }
  }

  const startMs = spotPrices.prices.map((p) => Date.parse(p.tsStart))
  const intervalMs = loadProfile.intervalMinutes * 60 * 1000
  const prices: number[] = new Array(loadProfile.readings.length)
  const gridGaps: TariffPriceRange[] = []
  const spotGaps: TariffPriceRange[] = []

  for (let i = 0; i < loadProfile.readings.length; i++) {
    const reading = loadProfile.readings[i]!
    const ms = Date.parse(reading.ts)
    const { year, month, day, hour, minute } = utcMsToLocalFields(ms, loadProfile.timezoneMeta)
    const localDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

    const row = findGridTariffRow(gridTariffRows, localDate)
    const window = row ? findGridTariffWindow(row, month, day, hour * 60 + minute) : null
    const spot = findSpotPrice(startMs, spotPrices.prices, ms)

    if (row == null || window == null) {
      gridGaps.push({ fromIso: reading.ts, toIso: new Date(ms + intervalMs).toISOString() })
    }
    if (spot == null) {
      spotGaps.push({ fromIso: reading.ts, toIso: new Date(ms + intervalMs).toISOString() })
    }
    // Die Energiepreis-Komponente: der übergebene Festpreis, sonst der Börsenpreis der Stunde.
    const energyCt = energyPriceCtPerKwh ?? spot?.ctPerKwh ?? null
    prices[i] =
      row && window && energyCt != null
        ? energyCt + window.ctPerKwh + row.netzverlustCtPerKwh
        : Number.NaN
  }

  // Die Netzentgelt-Seite wird zuerst gemeldet: fehlt sie, ist das ein Pflegestand, der von Hand
  // nachzutragen ist — die Spotpreis-Lücke dagegen schliesst der nächste Cron-Lauf von selbst.
  if (gridGaps.length > 0) {
    const ranges = mergeRanges(gridGaps)
    return {
      blocker: {
        computable: false,
        side: 'grid_tariff',
        kind: 'gap',
        ranges,
        message: gapMessage('Netzentgelte', ranges),
      },
    }
  }
  if (spotGaps.length > 0) {
    const ranges = mergeRanges(spotGaps)
    return {
      blocker: {
        computable: false,
        side: 'spot_price',
        kind: 'gap',
        ranges,
        message: gapMessage('Börsen-Strompreise', ranges),
      },
    }
  }

  return { prices }
}

/** Eine Lückenmeldung, die den betroffenen Zeitraum NENNT statt ihn nur zu zählen. */
function gapMessage(what: string, ranges: TariffPriceRange[]): string {
  const fmt = (iso: string) => iso.slice(0, 16).replace('T', ' ')
  const first = ranges[0]
  const span = first ? `${fmt(first.fromIso)} bis ${fmt(first.toIso)} UTC` : 'unbekannt'
  const more = ranges.length > 1 ? ` (und ${ranges.length - 1} weitere Zeitraum/Zeiträume)` : ''
  return (
    `Tarifoptimierung nicht berechenbar: Für einen Teil des Lastgang-Zeitraums fehlen ${what} — ` +
    `${span}${more}. Es wird bewusst nicht interpoliert und nicht übersprungen; Peak Shaving und ` +
    'Eigenverbrauch sind davon nicht betroffen.'
  )
}

/**
 * Anteil eines vollen Tages, den ein Kalendertag mindestens tragen muss, damit sein eigenes Mittel
 * als Bezugswert taugt. Bei einem 15-min-Gitter sind das 48 von 96 Intervallen.
 */
const MIN_DAY_COVERAGE_RATIO = 0.5

/** Lokaler Kalendertag als Schlüssel — `utcMsToLocalFields` ist DST-bewusst (s. `parser/datetime`). */
function localDayKey(ms: number, timezoneMeta: LoadProfile['timezoneMeta']): string {
  const { year, month, day } = utcMsToLocalFields(ms, timezoneMeta)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * „Günstig" = der kombinierte Preis liegt unter dem Mittel SEINES Kalendertags (lokale Wanduhr).
 *
 * ── ⚠ WARUM TAGES- UND NICHT PERIODEN-MITTEL ─────────────────────────────────────────────────
 * Bis 02.09.2026 war der Bezugswert das arithmetische Mittel über den GANZEN Lastgang. Bei einer
 * Jahres-Preiskurve ist das kein Schwellenwert für „lohnt sich das Laden", sondern im Wesentlichen
 * ein SAISON-Filter: in einem teuren Winter liegt fast jede Stunde über dem Jahresmittel (nichts
 * gilt als günstig, obwohl es auch dort billige Nächte gibt), in einem billigen Sommer fast jede
 * darunter (alles gilt als günstig, auch die Tagesspitze). Die Batterie wird dadurch genau dann
 * nicht tarifbewusst geladen, wenn der Preisabstand innerhalb des Tages am grössten ist — und im
 * Sommer wahllos, weil die Schwelle nicht mehr unterscheidet. Der Speicher zykliert real TÄGLICH;
 * der Bezugswert, gegen den „billig" gemessen wird, muss deshalb ebenfalls der Tag sein.
 *
 * Die Gruppierung läuft über die lokale Wanduhr — dieselbe Ableitung wie `coveredMonthlyPeaksKw`
 * (§3.4/§3.5) und `buildMonthlyTariffComparison`. DST-Tage (92 bzw. 100 Intervalle) und Schaltjahre
 * fallen dadurch von selbst richtig, ohne eine eigene Regel.
 *
 * ── ⚠ ES IST DAS TAGES-IST, KEIN KAUSALER PROXY (Vortag, gleitendes Fenster) ─────────────────
 * Das Mittel eines Tages steht erst fest, wenn der Tag vorbei ist — die Schwelle „weiss" also
 * mehr, als eine reale Steuerung um 03:00 wüsste. Das ist bewusst so: der übrige Dispatch rechnet
 * ohnehin mit vollem Rückblick (`searchCaps`, `computeSocFloor` sehen das ganze Periodenprofil,
 * §3.6 „Methodische Konsequenz"), und ein nur HIER kausaler Bezugswert wäre halbe Kausalität ohne
 * Wirkung — er machte die Zahl nicht ehrlicher, nur die Begründung inkonsistent. Der Vorbehalt
 * „Bestmarke mit vollem Rückblick" (§6.2, HINDSIGHT_NOTE im Report) deckt genau das ab und gilt
 * unverändert weiter.
 *
 * ── ⚠ RANDFRAGMENTE FALLEN AUF DAS PERIODEN-MITTEL ZURÜCK, NICHT AUF 0 UND NICHT AUF DEN VORTAG ─
 * Ein Lastgang beginnt oder endet mitten im Tag; ein solches Fragment trägt womöglich nur die
 * teuren Nachmittagsstunden. Sein eigenes Mittel wäre dann kein Tagesmittel, sondern das Mittel
 * eines Ausschnitts — und alles darin sähe je nach Ausschnitt willkürlich günstig oder teuer aus.
 * Unterhalb der halben Tagesabdeckung gilt deshalb der Perioden-Durchschnitt (der bisherige
 * Bezugswert): eine bekannte, benannte Grösse statt einer aus zu wenigen Werten gebildeten. Der
 * Vortag scheidet aus demselben Grund aus wie oben — er wäre eine kausale Regel an genau einer
 * Stelle eines rückblickenden Verfahrens.
 */
function cheapAgainstDailyMean(loadProfile: LoadProfile, rateCtPerKwh: number[]): boolean[] {
  const count = rateCtPerKwh.length
  const tz = loadProfile.timezoneMeta

  // Perioden-Mittel: Rückfallwert für Randfragmente (und der Bezugswert von vor dem 02.09.2026).
  let periodSum = 0
  for (const rate of rateCtPerKwh) periodSum += rate
  const periodMean = periodSum / (count || 1)

  const intervalsPerDay = loadProfile.intervalMinutes > 0 ? (24 * 60) / loadProfile.intervalMinutes : 0
  const minIntervals = Math.ceil(intervalsPerDay * MIN_DAY_COVERAGE_RATIO)

  const dayKeys = new Array<string>(count)
  const sums = new Map<string, number>()
  const counts = new Map<string, number>()
  for (let i = 0; i < count; i++) {
    const reading = loadProfile.readings[i]
    // Reisst die Preisreihe über die Readings hinaus (kann nur bei abweichender Reihenlänge
    // passieren), bleibt es für diese Intervalle beim Perioden-Mittel statt bei einem geratenen Tag.
    const key = reading ? localDayKey(Date.parse(reading.ts), tz) : ''
    dayKeys[i] = key
    if (!key) continue
    sums.set(key, (sums.get(key) ?? 0) + rateCtPerKwh[i]!)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const isCheapWindow = new Array<boolean>(count)
  for (let i = 0; i < count; i++) {
    const key = dayKeys[i]!
    const n = key ? (counts.get(key) ?? 0) : 0
    const reference = n >= minIntervals && n > 0 ? sums.get(key)! / n : periodMean
    isCheapWindow[i] = rateCtPerKwh[i]! < reference - EPS
  }
  return isCheapWindow
}

/**
 * Per-Intervall-Arbeitspreis + Günstig-Fenster-Flag (§3.7, Delta 4).
 *
 * ── OHNE `pricing` (Stand vor B21) ─────────────────────────────────────────────────────────────
 * Ein Intervall bekommt den GÜNSTIGSTEN Preis unter allen matchenden `timeOfUseWindows`; matcht
 * keins, gilt der Standard-`energyPriceCtPerKwh`. „Günstig" = Rate strikt unter dem Standardpreis.
 * Ohne (echte oder Default-NT-)Fenster ist `touActive=false` und alle Flags sind `false` →
 * `loadShiftSavingPerYear` bleibt 0 (§3.7). Dieser Pfad ist unverändert.
 *
 * ── MIT `pricing` (Tarifoptimierungs-Hebel angefordert, B21-3b) ────────────────────────────────
 * Der Preis je Intervall ist der kombinierte (Marktpreis + Netzentgelt, s. `combinedPrices`).
 * Der Referenzpreis, gegen den „günstig" gemessen wird, ist dann NICHT mehr
 * `energyPriceCtPerKwh`: der kombinierte Preis liegt durch das Netzentgelt als Ganzes höher als der
 * reine Energiepreis — gegen den alten Bezugswert gemessen wäre keine einzige Stunde mehr
 * „günstig", und die Lastverschiebung fiele still auf 0. „Unterdurchschnittlich teure Stunde" ist
 * der Begriff, den eine Preiskurve mit 8.760 verschiedenen Werten überhaupt zulässt.
 *
 * Seit 02.09.2026 ist dieser Durchschnitt der des jeweiligen KALENDERTAGS (lokale Wanduhr), nicht
 * mehr der des ganzen Lastgangs — samt Rückfallregel für Randfragmente. Begründung und Randfälle
 * stehen vollständig bei `cheapAgainstDailyMean` und sind dort nachzulesen, bevor jemand die
 * Schwelle wieder anfasst.
 *
 * ⚠ Das bleibt eine Greedy-Schwelle und ist kein Optimierer (Delta 4 „LP-Lücke", Delta 11/14):
 * bei zwei Preisstufen (HT/NT) ist der Unterschied unerheblich, bei 8.760 echt verschiedenen
 * Stundenpreisen potenziell relevant. Die BEWERTUNG einer verschobenen kWh hängt nicht an dieser
 * Schwelle, sondern an den tatsächlichen Preisen beim Laden und beim Entladen (`attribute.ts`) —
 * die Schwelle steuert nur, WANN geladen wird.
 *
 * ── IST DER HEBEL ANGEFORDERT, ABER NICHT BERECHENBAR ──────────────────────────────────────────
 * Dann fällt die Funktion AUSDRÜCKLICH NICHT auf das statische Fensterschema zurück: alle Raten
 * stehen auf `energyPriceCtPerKwh`, alle Flags auf `false`, `touActive=false`. Der Hebel liefert
 * damit nichts (statt einer Zahl aus einer anderen Grundlage), und `tariffOptimization` sagt warum.
 * Ein stiller Rückfall wäre die stille Verschlechterung, vor der Delta 15 warnt: eine zu niedrige
 * Vergleichszahl fällt niemandem als Fehler auf, sondern als Ergebnis.
 */
export function intervalTariffRates(
  loadProfile: LoadProfile,
  tariffParams: TariffParams,
  pricing?: TariffPricingInputs,
): IntervalTariffRates {
  const std = tariffParams.energyPriceCtPerKwh
  const count = loadProfile.readings.length

  if (pricing) {
    const combined = combinedIntervalPrices(loadProfile, pricing)
    if ('blocker' in combined) {
      return {
        rateCtPerKwh: new Array<number>(count).fill(std),
        isCheapWindow: new Array<boolean>(count).fill(false),
        touActive: false,
        tariffOptimization: combined.blocker,
      }
    }

    const rateCtPerKwh = combined.prices
    const isCheapWindow = cheapAgainstDailyMean(loadProfile, rateCtPerKwh)
    let touActive = false
    for (const cheap of isCheapWindow) {
      if (cheap) {
        touActive = true
        break
      }
    }
    return { rateCtPerKwh, isCheapWindow, touActive, tariffOptimization: { computable: true } }
  }

  const windows = effectiveWindows(tariffParams).map((w) => ({
    from: parseHhMm(w.from),
    to: parseHhMm(w.to),
    ctPerKwh: w.ctPerKwh,
  }))

  const rateCtPerKwh: number[] = new Array(count)
  const isCheapWindow: boolean[] = new Array(count)
  let touActive = false

  for (let i = 0; i < count; i++) {
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

/**
 * Nur der Status, ohne die Preisreihe — für den Aufrufer, der EINMAL profilweit wissen will, ob der
 * Hebel rechenbar ist (der Worker, für `dataQuality.warnings`).
 *
 * Bewusst dieselbe Rechnung wie oben und keine zweite Prüfung daneben: zwei Ableitungen desselben
 * Befunds liefen auseinander, und dann meldete die Oberfläche „berechenbar", während die Engine
 * nichts gerechnet hat (dieselbe Überlegung wie bei `analysisWindow` in B21-3a).
 */
export function evaluateTariffOptimization(
  loadProfile: LoadProfile,
  tariffParams: TariffParams,
  pricing?: TariffPricingInputs,
): TariffOptimizationStatus | undefined {
  return intervalTariffRates(loadProfile, tariffParams, pricing).tariffOptimization
}
