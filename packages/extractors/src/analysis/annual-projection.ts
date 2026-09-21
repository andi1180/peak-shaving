import {
  buildMonthlyTariffComparison,
  spreadDailyConsumptionHourly,
  utcMsToLocalFields,
  zonedWallToUtcMs,
} from 'engine'
import type {
  AnnualConsumptionEstimate,
  AnnualProjectedAmount,
  AnnualTariffProjection,
  LoadProfile,
  LoadReading,
  MarketPriceCoverage,
  MarketPriceHoursByOrigin,
  SpotPricePointInput,
  TariffParams,
  TariffPriceRange,
  TariffPricingInputs,
} from 'shared'

import {
  resolveGapMarketPrices,
  type MarketPriceWindowReader,
  type SpotPriceRangeReader,
} from './gap-market-prices'

/**
 * D6 Teil 2b — DIE JAHRES-KOSTEN-HOCHRECHNUNG FÜR GENAU ZWEI ZEILEN.
 *
 * Teil 1 (`estimateAnnualConsumption`) sagt, wie viel Energie die fehlenden Tage tragen. Teil 2a
 * (`resolveGapMarketPrices`) sagt, was eine Stunde in diesen Tagen gekostet hat. Hier entsteht aus
 * beidem die Zahl, die der Urbanz-Report zeigt: „Ihr Tarif heute" und „aWATTar ungesteuert" über
 * ein VOLLES Jahr, obwohl gemessen nur 209 Tage vorliegen.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ES ENTSTEHT KEINE ZWEITE PREISLOGIK
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Beide Zeilen — die des gemessenen Zeitraums UND die des Lückenausschnitts — kommen aus
 * `buildMonthlyTariffComparison`, also aus demselben `combinedIntervalPrices` mit denselben
 * Fixkosten-Regeln (Delta 19). Eine eigene Kostenformel für die Lücke liefe beim nächsten
 * Preisblatt-Ausbau auseinander, und der hochgerechnete Anteil wäre dann anders zusammengesetzt
 * als der gemessene — die Jahressumme enthielte einen Sprung, den niemand als Fehler erkennt.
 *
 * ⚠ Die DRITTE Reihe des Monatsvergleichs („mit Speicher") wird bewusst NICHT gebildet. Sie setzt
 * einen simulierten Fahrplan voraus; über erfundene, flach verteilte Tage wäre das keine
 * Hochrechnung mehr, sondern eine zweite Simulation über Daten, die es nicht gibt. Deshalb wird
 * `gridAfterKw` leer übergeben: die Funktion fällt dort dokumentiert auf den rohen Bezug zurück,
 * und der Rückgabewert dieser dritten Reihe wird hier schlicht nicht gelesen. Die beiden
 * Ladesteuerungs-Zeilen des Reports bleiben unverändert bei `annualizationFactor`
 * (`savings/attribute.ts`) — sie werden von hier aus nicht angefasst.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIE NACHGELADENEN PREISE BLEIBEN IN DIESEM WEG (Delta 15 Regel C)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Das Ergebnis von `resolveGapMarketPrices` wird NIE in die `TariffPricingInputs` der bestehenden
 * `tariffOptimization`-Pipeline zurückgeschrieben. Deren Blocker bei `complete === false` ist die
 * Zusage, dass für den ECHTEN Zeitraum nicht genähert wird; würde die Näherung dort einfliessen,
 * verschwände der Blocker still und mit ihm die Kennzeichnung. Diese Funktion baut sich deshalb
 * ein EIGENES `TariffPricingInputs` für den synthetischen Ausschnitt und lässt das übergebene
 * Objekt unberührt.
 *
 * ⚠ Ohne `import 'server-only'`, aus demselben Grund wie beim Geschwister `gap-market-prices.ts`:
 * alles kommt durch Ports herein, der Paket-Barrel trägt die Markierung ohnehin.
 */

/** Das Hochrechnungsfenster: 365 Kalendertage ab dem ersten belegten Ortstag (kein Schaltjahr-Sonderfall — s. `DAYS_PER_YEAR`). */
const WINDOW_DAYS = 365
const SLOTS_PER_DAY = 96
const SLOT_MS = 15 * 60 * 1000

export type AnnualTariffProjectionOptions = {
  /** Der ECHTE Lastgang des bekannten Zeitraums. */
  loadProfile: LoadProfile
  tariffParams: TariffParams
  /** Die Preisseiten wie am bekannten Zeitraum. Wird gelesen, nie verändert. */
  pricing: TariffPricingInputs
  /** Das Ergebnis von `estimateAnnualConsumption` für denselben Lastgang (D6 Teil 1). */
  consumption: AnnualConsumptionEstimate
  readSpotPrices: SpotPriceRangeReader
  fetchMarketWindow: MarketPriceWindowReader
}

/** Ein zusammenhängender Block fehlender Kalendertage (Ortszeit). */
type GapRun = { fromDate: string; toDate: string; days: number }

/**
 * Die Jahreskosten der beiden Tarifwege — oder `undefined`, wenn sie nicht ehrlich zu bilden sind.
 *
 * ── DER RECHENWEG ─────────────────────────────────────────────────────────────────────────────
 *  1. Die Zeilen des BEKANNTEN Zeitraums aus `buildMonthlyTariffComparison`, unverändert.
 *  2. Das Fenster: 365 Kalendertage ab dem ersten belegten Ortstag. Alles darin, was der Lastgang
 *     nicht belegt, ist ein fehlender Tag — das KOMPLEMENT der belegten Daten, nicht eine Zahl.
 *  3. Je zusammenhängendem Block fehlender Tage ein synthetischer Ausschnitt: 96 Viertelstunden
 *     je Tag, konstante Leistung aus `spreadDailyConsumptionHourly(Referenzrate)`, an den ECHTEN
 *     Kalenderdaten in der ECHTEN Zeitzone.
 *  4. Für jeden Block die Marktpreise über `resolveGapMarketPrices` — Bestand, Nachladung, Näherung.
 *  5. Die Zeilen des Ausschnitts aus derselben `buildMonthlyTariffComparison`.
 *  6. Jahreszahl je Zeile = gemessen + geschätzt.
 *
 * ── ⚠ WARUM AM ECHTEN KALENDERDATUM UND NICHT AN EINEM PLATZHALTERTAG ─────────────────────────
 * Ein einziger bewerteter Tag × Anzahl fehlender Tage wäre billiger und falsch: Preisblattstände
 * sind effektiv datiert (`validFrom`/`validUntil`), Netzentgelt-Fenster tragen Saisongrenzen
 * (`monthDayFrom`/`monthDayTo`), und die Marktpreis-Näherung wählt den nächstgelegenen Monat.
 * Alle drei hängen am Datum; ein Platzhaltertag zöge den Stand eines einzigen Tages über bis zu
 * ein halbes Jahr.
 *
 * ── ⚠ WANN `undefined` HERAUSKOMMT ────────────────────────────────────────────────────────────
 *  • Der bekannte Zeitraum ist selbst nicht berechenbar (`buildMonthlyTariffComparison` liefert
 *    nichts) — dann gibt es keine gemessene Grundlage, auf die etwas aufsetzen könnte.
 *  • Der Lastgang ist leer.
 *  • Es fehlen Tage, aber Teil 1 hat keine Referenzrate (`no_data`) — womit sollte bewertet werden.
 *  • Der Lückenausschnitt selbst ist nicht berechenbar: die Netzentgelt-Zeilen decken die
 *    fehlenden Kalendertage nicht ab, oder auch nach Nachladung und Näherung bleibt eine
 *    Preislücke. Dann fehlt die ganze Zahl — ausdrücklich nicht die halbe.
 *
 * ⚠ Deckt der Lastgang das Fenster VOLLSTÄNDIG ab, kommt die Hochrechnung dennoch zurück: mit
 * `projectedDays: 0` und `projectedEur: 0`. Der gemessene Wert steht dann unverändert für sich,
 * und der Aufrufer braucht keinen Sonderfall.
 */
export async function projectAnnualTariffComparison(
  options: AnnualTariffProjectionOptions,
): Promise<AnnualTariffProjection | undefined> {
  const { loadProfile, tariffParams, pricing, consumption } = options
  const tz = loadProfile.timezoneMeta

  /*
   * Die Zeilen des bekannten Zeitraums — GENAU die bestehende Berechnung, ohne jede Abwandlung.
   * `gridAfterKw` bleibt leer: die beiden Zeilen, die hier gelesen werden, lesen es nicht.
   */
  const measured = buildMonthlyTariffComparison(loadProfile, tariffParams, pricing, [])
  if (!measured) return undefined

  const coveredDates = new Set<string>()
  let firstMs = Number.POSITIVE_INFINITY
  for (const reading of loadProfile.readings) {
    const ms = Date.parse(reading.ts)
    if (!Number.isFinite(ms)) continue
    if (ms < firstMs) firstMs = ms
    coveredDates.add(localDateKey(ms, tz))
  }
  if (!Number.isFinite(firstMs) || coveredDates.size === 0) return undefined

  const windowFromDate = localDateKey(firstMs, tz)
  const windowToDate = addDays(windowFromDate, WINDOW_DAYS - 1)

  const missingDates: string[] = []
  for (let i = 0; i < WINDOW_DAYS; i++) {
    const date = addDays(windowFromDate, i)
    if (!coveredDates.has(date)) missingDates.push(date)
  }

  const measuredDays = WINDOW_DAYS - missingDates.length
  const base = {
    windowFromDate,
    windowToDate,
    measuredDays,
    projectedDays: missingDates.length,
    consumption: {
      method: consumption.method,
      missingDays: consumption.missingDays,
      referenceRateKwhPerDay: consumption.referenceRateKwhPerDay,
      referenceSegments: consumption.referenceSegments,
      estimatedAnnualConsumptionKwh: consumption.estimatedAnnualConsumptionKwh,
    },
  }

  if (missingDates.length === 0) {
    return {
      ...base,
      currentTariffEur: amountOf(sumRow(measured.currentTariffEur), 0),
      spotWithoutControlEur: amountOf(sumRow(measured.spotWithoutControlEur), 0),
      marketPrices: { coverage: [], hoursByOrigin: noHours(), missingRanges: [] },
    }
  }

  const rate = consumption.referenceRateKwhPerDay
  if (rate == null || !Number.isFinite(rate) || rate < 0) return undefined

  /*
   * Die Tagesform der fehlenden Tage: flach. `spreadDailyConsumptionHourly` erhält die Tagesmenge
   * exakt (der letzte Stundenwert trägt den Rundungsrest); bei konstanter Leistung innerhalb einer
   * Stunde ist die kW-Zahl zugleich die kWh-Zahl dieser Stunde, die Umrechnung also verlustfrei.
   */
  const hourlyKwh = spreadDailyConsumptionHourly(rate)

  const readings: LoadReading[] = []
  const prices: SpotPricePointInput[] = []
  const coverage: MarketPriceCoverage[] = []
  const missingRanges: TariffPriceRange[] = []
  const hoursByOrigin = noHours()
  let complete = true

  for (const run of groupConsecutive(missingDates)) {
    const [year, month, day] = parseDateKey(run.fromDate)
    /*
     * Verankert an der lokalen MITTERNACHT des ersten Tages, danach durchgehend 96 Viertelstunden
     * je Tag. Ein DST-Tag hat real 92 bzw. 100 — der Ausschnitt verschiebt sich dort für den Rest
     * des Blocks um bis zu eine Stunde gegen die Wanduhr. Die Alternative (je Tag neu verankern)
     * erzeugte an derselben Stelle eine Überlappung bzw. eine Lücke in der Reihe; die Tagesmenge
     * bleibt in beiden Fällen erhalten, und der Monat, dem eine Viertelstunde zugeordnet wird,
     * ergibt sich ohnehin aus ihrem tatsächlichen Zeitstempel.
     */
    const startMs = zonedWallToUtcMs(year, month, day, 0, 0, 0, tz)
    const endMs = startMs + run.days * SLOTS_PER_DAY * SLOT_MS

    for (let slot = 0; slot < run.days * SLOTS_PER_DAY; slot++) {
      readings.push({
        ts: new Date(startMs + slot * SLOT_MS).toISOString(),
        gridPowerKw: hourlyKwh[Math.floor((slot % SLOTS_PER_DAY) / 4)]!,
      })
    }

    const resolved = await resolveGapMarketPrices({
      fromIso: new Date(startMs).toISOString(),
      toIso: new Date(endMs).toISOString(),
      readSpotPrices: options.readSpotPrices,
      fetchMarketWindow: options.fetchMarketWindow,
    })
    prices.push(...resolved.prices)
    coverage.push(...resolved.coverage)
    missingRanges.push(...resolved.missingRanges)
    hoursByOrigin.database += resolved.hoursByOrigin.database
    hoursByOrigin.fetched += resolved.hoursByOrigin.fetched
    hoursByOrigin.assumed += resolved.hoursByOrigin.assumed
    complete &&= resolved.complete
  }

  const gapProfile: LoadProfile = {
    readings,
    intervalMinutes: 15,
    timezoneMeta: tz,
    // Nichts auf diesem Weg liest `source`; er wird vom echten Profil übernommen, damit der
    // Ausschnitt nicht als eigene Herkunftsart dasteht, die es nicht gibt.
    source: loadProfile.source,
  }
  /* Ein EIGENES Preis-Objekt — das übergebene `pricing` wird nicht verändert (s. Modulkopf). */
  const gapPricing: TariffPricingInputs = {
    gridTariffRows: pricing.gridTariffRows,
    spotPrices: { prices, complete, missingRanges },
    /*
     * Die Abgaben reisen UNVERÄNDERT mit: sie gelten für die hochgerechneten Tage genauso wie für
     * die gemessenen. Der Plan deckt sie ab, weil er auf die berührten Kalenderjahre geweitet wird
     * (`buildLevySchedule`) — auf das Messfenster beschnitten fiele die Hochrechnung hier weg.
     */
    levies: pricing.levies,
  }

  const projected = buildMonthlyTariffComparison(gapProfile, tariffParams, gapPricing, [])
  if (!projected) return undefined

  return {
    ...base,
    currentTariffEur: amountOf(
      sumRow(measured.currentTariffEur),
      sumRow(projected.currentTariffEur),
    ),
    spotWithoutControlEur: amountOf(
      sumRow(measured.spotWithoutControlEur),
      sumRow(projected.spotWithoutControlEur),
    ),
    marketPrices: { coverage, hoursByOrigin, missingRanges },
  }
}

function amountOf(measuredEur: number, projectedEur: number): AnnualProjectedAmount {
  return { measuredEur, projectedEur, totalEur: measuredEur + projectedEur }
}

/** Monate ohne Messwert sind `null` und tragen nichts bei — nicht 0, und nicht NaN. */
function sumRow(values: (number | null)[]): number {
  return values.reduce<number>((sum, value) => (value == null ? sum : sum + value), 0)
}

function noHours(): MarketPriceHoursByOrigin {
  return { database: 0, fetched: 0, assumed: 0 }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** Lokaler Kalendertag als `YYYY-MM-DD` — dieselbe Ableitung wie in `buildMonthlyTariffComparison`. */
function localDateKey(ms: number, timeZone: string): string {
  const { year, month, day } = utcMsToLocalFields(ms, timeZone)
  return `${year}-${pad(month)}-${pad(day)}`
}

function parseDateKey(key: string): [number, number, number] {
  return [Number(key.slice(0, 4)), Number(key.slice(5, 7)), Number(key.slice(8, 10))]
}

/** Kalendertage weiterzählen — reine Kalenderarithmetik, ohne Zeitzone und damit ohne DST-Frage. */
function addDays(key: string, days: number): string {
  const [year, month, day] = parseDateKey(key)
  const at = new Date(Date.UTC(year, month - 1, day + days))
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`
}

/**
 * Aufeinanderfolgende Kalendertage zu Blöcken bündeln.
 *
 * Ein Aufruf von `resolveGapMarketPrices` JE BLOCK statt einem über die ganze Spanne: dazwischen
 * liegt der gemessene Zeitraum, und ein Aufruf darüber holte Preise für Tage, die schon bewertet
 * sind — im Zweifel mit einem Nachlade-Aufruf gegen aWATTar, den niemand braucht.
 */
function groupConsecutive(dates: string[]): GapRun[] {
  const runs: GapRun[] = []
  for (const date of dates) {
    const last = runs[runs.length - 1]
    if (last && addDays(last.toDate, 1) === date) {
      last.toDate = date
      last.days += 1
      continue
    }
    runs.push({ fromDate: date, toDate: date, days: 1 })
  }
  return runs
}
