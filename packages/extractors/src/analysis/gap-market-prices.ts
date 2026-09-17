import type {
  MarketPriceCoverage,
  MarketPriceHoursByOrigin,
  MarketPriceOrigin,
  SpotPricePointInput,
  SpotPriceSeriesInput,
  TariffPriceRange,
} from 'shared'

/**
 * D6 Teil 2a — MARKTPREISE FÜR EINEN ANALYSEZEITRAUM, LÜCKEN EINGESCHLOSSEN.
 *
 * Heute bricht der Vergleich bei einer Preislücke ab (Delta 15 Regel C: „nicht berechenbar").
 * Das ist richtig, solange niemand nachgesehen hat — aber die Lücke ist meistens keine: die
 * fehlenden Stunden liegen bei aWATTar bereit und stehen nur nicht in `spot_prices`, weil der
 * Backfill sie nie geholt hat. Diese Funktion sieht nach, bevor sie aufgibt.
 *
 * ── ⚠ SIE SCHREIBT NICHTS ─────────────────────────────────────────────────────────────────────
 * Auch nicht bei erfolgreichem Nachladen. Es gibt keinen Writer-Port, den man versehentlich
 * verdrahten könnte. Das Befüllen von `spot_prices` ist Sache des Cron/Backfills (B21-2a) — hier
 * entstünde sonst ein zweiter Schreibweg mit einer zweiten Umrechnung, und der Unterschied wäre
 * eine still verfälschte Preiskurve.
 *
 * ── DIE AUSSENWELT KOMMT ALS PORTS HEREIN (D3-Muster) ─────────────────────────────────────────
 * Weder Supabase noch Next noch `fetch` werden hier importiert. Die Leser liegen in den Apps
 * (`readSpotPricesForAnalysis` in `apps/web`, `fetchSpotPrices` in `apps/website`,
 * `fetchAwattarWindow` in `apps/web/lib/spot-prices/sync.ts`); ein Paket importiert keine App.
 *
 * ⚠ Ohne `import 'server-only'` — anders als das Geschwister `run-from-draft.ts`: dieses Modul
 * berührt weder Kundendaten noch eine Laufzeit-Abhängigkeit, alles kommt durch die Ports. Der
 * Paket-Barrel trägt die Markierung ohnehin.
 */

/**
 * Ein Eintrag der aWATTar-Marktdaten — strukturell deckungsgleich mit `AwattarEntry`
 * (`apps/web/lib/spot-prices/sync.ts`), damit `fetchAwattarWindow` unverändert eingehängt werden
 * kann. Der Typ wird hier wiederholt und nicht importiert: siehe Ports-Absatz oben.
 */
export type MarketPriceWindowEntry = {
  start_timestamp: number
  end_timestamp: number
  marketprice: number
  unit: string
}

/** Der Leser für ein Nachlade-Fenster. Grenzen in Epoch-MILLISEKUNDEN — so verlangt es die Quelle. */
export type MarketPriceWindowReader = (
  startMs: number,
  endMs: number,
) => Promise<MarketPriceWindowEntry[]>

/**
 * Der Leser für den gepflegten Bestand. Signatur wie `fetchSpotPrices(periodStart, periodEnd)`;
 * wer `readSpotPricesForAnalysis(supabase, window, intervalMinutes)` benutzt, bindet Client und
 * Intervallaufschlag beim Einhängen — die Entscheidung, wie weit das Fenster reicht, gehört zum
 * Aufrufer und nicht hierher.
 */
export type SpotPriceRangeReader = (fromIso: string, toIso: string) => Promise<SpotPriceSeriesInput>

/**
 * ⚠ `MarketPriceOrigin` UND `MarketPriceCoverage` LIEGEN SEIT D6 TEIL 2b IN `shared`
 * (`annual-projection.ts`): die Jahres-Hochrechnung reicht die Herkunft bis in
 * `AnalysisResult.annualProjection` durch, und `shared` ist die unterste Schicht. Beide stehen hier
 * unter unverändertem Namen weiter zur Verfügung — es gibt weiterhin GENAU EINE Definition je Typ.
 */
export type { MarketPriceCoverage, MarketPriceOrigin } from 'shared'

/**
 * Die aufgefüllte Reihe samt Herkunftsnachweis.
 *
 * ⚠ Sie ist strukturell ein `SpotPriceSeriesInput` (`prices`/`complete`/`missingRanges`) und kann
 * unverändert dorthin gereicht werden, wo heute der reine Datenbankstand steht. `coverage` und
 * `hoursByOrigin` sind der Aufschlag: eine Reihe, der man nicht ansieht, welcher Anteil geschätzt
 * ist, könnte die Kennzeichnungspflicht aus D6 gar nicht erfüllen.
 */
export type ResolvedMarketPrices = {
  prices: SpotPricePointInput[]
  complete: boolean
  /** Was auch nach Nachladen und Rückfallregel offen blieb — leer, wenn `complete`. */
  missingRanges: TariffPriceRange[]
  coverage: MarketPriceCoverage[]
  hoursByOrigin: MarketPriceHoursByOrigin
}

const HOUR_MS = 60 * 60 * 1000

/**
 * ⚠ ZWILLING VON `AWATTAR_EXPECTED_UNIT`/`CT_PER_KWH_PER_EUR_PER_MWH` in
 * `apps/web/lib/spot-prices/sync.ts` — dieselbe Lage wie bei `findMissingRanges`, das ebenfalls an
 * zwei Stellen lebt. Wer die Umrechnung ändert, ändert sie an BEIDEN. Anders als dort bricht ein
 * unerwarteter Einheitenwert hier aber NICHT den Lauf ab: der Eintrag gilt als nicht geliefert und
 * fällt auf die Näherung. Gedeutet wird er in keinem Fall — eine um den Faktor 10 falsche
 * Preiskurve fällt später nicht als Fehler auf, sondern als überraschend gutes Ergebnis.
 */
const AWATTAR_EXPECTED_UNIT = 'Eur/MWh'
const CT_PER_KWH_PER_EUR_PER_MWH = 100 / 1000

/** Fehlt jede Angabe, gilt der Rohpreis als netto — so liefert aWATTar (Delta 6). */
const DEFAULT_PRICE_BASIS = 'net'

type Candidate = {
  startMs: number
  endMs: number
  ctPerKwh: number
  priceBasis: string
  origin: 'database' | 'fetched'
}

/**
 * Marktpreise für `[fromIso, toIso)` beschaffen: Bestand lesen, Lücken nachladen, den Rest nähern.
 *
 * ── DER ABLAUF ────────────────────────────────────────────────────────────────────────────────
 *  1. `readSpotPrices` für den ganzen Zeitraum. Meldet es `complete`, ist die Arbeit getan und der
 *     Nachlade-Leser wird NICHT angefasst — kein Netzaufruf für einen gepflegten Bestand.
 *  2. Für jede gemeldete Lücke EIN Nachlade-Aufruf, genau über deren Grenzen.
 *  3. Zusammenführen: bei Überschneidung gewinnt der Bestand, das Nachgeladene wird auf den noch
 *     offenen Rest beschnitten. Eine Stunde erscheint dadurch genau einmal.
 *  4. Was danach noch fehlt, bekommt die Näherung aus Punkt „Rückfallregel".
 *
 * ── ⚠ DIE RÜCKFALLREGEL `[ANNAHME]` ───────────────────────────────────────────────────────────
 * Liefert auch die Quelle nichts (zu weit in der Vergangenheit, Ausfall, unerwartete Einheit),
 * wird der Bereich mit dem Durchschnittspreis des NÄCHSTGELEGENEN Monats mit echten Daten belegt —
 * Vorbild ist der Urbanz-Anhang („für 5 Tage ohne Marktdaten wurde der September-2025-Schnitt als
 * Näherung verwendet"). Nähe wird zwischen den Mitten gemessen (Lücke gegen Kalendermonat), bei
 * Gleichstand gewinnt der frühere Monat.
 *
 * ⚠ Gibt es GAR KEINE echten Daten, wird nichts genähert: der Bereich bleibt in `missingRanges`
 * stehen und `complete` bleibt `false`. Ein Durchschnitt aus nichts wäre eine erfundene Zahl.
 *
 * ⚠ Ein geworfener Nachlade-Leser reisst den Lauf NICHT mit: sein Bereich gilt als nicht geliefert
 * und fällt auf die Näherung. Ein Netzfehler beim Auffüllen darf keine Analyse zu Fall bringen —
 * dafür gibt es die Kennzeichnung.
 */
export async function resolveGapMarketPrices(options: {
  fromIso: string
  toIso: string
  readSpotPrices: SpotPriceRangeReader
  fetchMarketWindow: MarketPriceWindowReader
}): Promise<ResolvedMarketPrices> {
  const { fromIso, toIso, readSpotPrices, fetchMarketWindow } = options
  const fromMs = Date.parse(fromIso)
  const toMs = Date.parse(toIso)
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    throw new Error(`resolveGapMarketPrices: ungültiger Zeitraum ${fromIso} … ${toIso}.`)
  }

  const stored = await readSpotPrices(fromIso, toIso)
  const candidates: Candidate[] = []
  for (const point of stored.prices) {
    const candidate = fromStoredPoint(point)
    if (candidate) candidates.push(candidate)
  }

  if (!stored.complete) {
    for (const gap of stored.missingRanges) {
      for (const entry of await readWindow(fetchMarketWindow, gap)) {
        const candidate = fromWindowEntry(entry)
        if (candidate) candidates.push(candidate)
      }
    }
  }

  const merged = mergeCandidates(candidates, fromMs, toMs)
  const { prices, coverage } = merged
  const assumed = approximate(merged.gaps, prices)

  const allPrices = [...prices, ...assumed.prices].sort((a, b) =>
    Date.parse(a.tsStart) - Date.parse(b.tsStart),
  )
  const allCoverage = [...coverage, ...assumed.coverage].sort((a, b) =>
    Date.parse(a.fromIso) - Date.parse(b.fromIso),
  )

  return {
    prices: allPrices,
    complete: assumed.gaps.length === 0,
    missingRanges: assumed.gaps,
    coverage: allCoverage,
    hoursByOrigin: {
      database: sumHours(allCoverage, 'database'),
      fetched: sumHours(allCoverage, 'fetched'),
      assumed: sumHours(allCoverage, 'assumed'),
    },
  }
}

/** Ein Fenster nachladen. Ein Fehler der Quelle wird zu „nichts geliefert" — s. Funktionskopf. */
async function readWindow(
  fetchMarketWindow: MarketPriceWindowReader,
  gap: TariffPriceRange,
): Promise<MarketPriceWindowEntry[]> {
  const startMs = Date.parse(gap.fromIso)
  const endMs = Date.parse(gap.toIso)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return []
  try {
    return await fetchMarketWindow(startMs, endMs)
  } catch {
    return []
  }
}

function fromStoredPoint(point: SpotPricePointInput): Candidate | null {
  const startMs = Date.parse(point.tsStart)
  const endMs = Date.parse(point.tsEnd)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null
  if (!Number.isFinite(point.ctPerKwh)) return null
  return {
    startMs,
    endMs,
    ctPerKwh: point.ctPerKwh,
    priceBasis: point.priceBasis || DEFAULT_PRICE_BASIS,
    origin: 'database',
  }
}

function fromWindowEntry(entry: MarketPriceWindowEntry): Candidate | null {
  if (entry.unit !== AWATTAR_EXPECTED_UNIT) return null
  const { start_timestamp: startMs, end_timestamp: endMs, marketprice: price } = entry
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null
  if (!Number.isFinite(price)) return null
  return {
    startMs,
    endMs,
    ctPerKwh: price * CT_PER_KWH_PER_EUR_PER_MWH,
    priceBasis: DEFAULT_PRICE_BASIS,
    origin: 'fetched',
  }
}

/**
 * Bestand und Nachgeladenes zu EINER überschneidungsfreien Reihe verweben und dabei festhalten,
 * welches Stück woher kam.
 *
 * Bei gleichem Beginn gewinnt der Bestand: er ist die gepflegte Quelle, und ein Nachlade-Ergebnis
 * soll ihn nicht überschreiben können. Ein teilweise überlappender Eintrag wird auf den noch
 * offenen Rest BESCHNITTEN statt verworfen — der Preis der Stunde gilt auch für ihren Rest, und
 * verworfen bliebe an seiner Stelle eine Lücke, die es nicht gibt.
 */
function mergeCandidates(
  candidates: Candidate[],
  fromMs: number,
  toMs: number,
): { prices: SpotPricePointInput[]; coverage: MarketPriceCoverage[]; gaps: TariffPriceRange[] } {
  const rank = (origin: Candidate['origin']) => (origin === 'database' ? 0 : 1)
  const ordered = [...candidates].sort(
    (a, b) => a.startMs - b.startMs || rank(a.origin) - rank(b.origin),
  )

  const prices: SpotPricePointInput[] = []
  const coverage: MarketPriceCoverage[] = []
  const gaps: TariffPriceRange[] = []
  let coveredUntil = fromMs

  for (const candidate of ordered) {
    const start = Math.max(candidate.startMs, coveredUntil)
    const end = Math.min(candidate.endMs, toMs)
    if (end <= start) continue
    if (start > coveredUntil) gaps.push({ fromIso: iso(coveredUntil), toIso: iso(start) })

    prices.push({
      tsStart: iso(start),
      tsEnd: iso(end),
      ctPerKwh: candidate.ctPerKwh,
      priceBasis: candidate.priceBasis,
    })
    coverage.push({
      origin: candidate.origin,
      fromIso: iso(start),
      toIso: iso(end),
      hours: (end - start) / HOUR_MS,
    })
    coveredUntil = end
  }

  if (coveredUntil < toMs) gaps.push({ fromIso: iso(coveredUntil), toIso: iso(toMs) })
  return { prices, coverage: dedupeCoverage(coverage), gaps }
}

/**
 * Benachbarte Stücke gleicher Herkunft gehören zu EINEM Eintrag zusammengefasst — sonst zählte
 * `coverage` 8.760 Stundeneinträge auf, und die Aussage „diese fünf Tage sind genähert" ginge darin
 * unter.
 */
function dedupeCoverage(coverage: MarketPriceCoverage[]): MarketPriceCoverage[] {
  const merged: MarketPriceCoverage[] = []
  for (const entry of coverage) {
    const last = merged[merged.length - 1]
    if (last && last.origin === entry.origin && last.toIso === entry.fromIso && !last.assumption) {
      last.toIso = entry.toIso
      last.hours += entry.hours
      continue
    }
    merged.push({ ...entry })
  }
  return merged
}

type MonthAverage = {
  year: number
  month: number
  midMs: number
  ctPerKwh: number
  priceBasis: string
}

/**
 * Offene Bereiche mit dem Durchschnitt des nächstgelegenen Monats belegen.
 *
 * Der Durchschnitt ist DAUER-gewichtet (`Σ ct·h / Σ h`) und nicht das Mittel der Einträge: eine
 * Quelle darf gröber oder feiner liefern, und ein einzelner Viertelstundenwert soll nicht so viel
 * wiegen wie eine ganze Stunde.
 */
function approximate(
  gaps: TariffPriceRange[],
  realPrices: SpotPricePointInput[],
): { prices: SpotPricePointInput[]; coverage: MarketPriceCoverage[]; gaps: TariffPriceRange[] } {
  const months = monthAverages(realPrices)
  if (gaps.length === 0 || months.length === 0) {
    return { prices: [], coverage: [], gaps }
  }

  const prices: SpotPricePointInput[] = []
  const coverage: MarketPriceCoverage[] = []

  for (const gap of gaps) {
    const startMs = Date.parse(gap.fromIso)
    const endMs = Date.parse(gap.toIso)
    const reference = nearestMonth(months, (startMs + endMs) / 2)

    /*
     * Stundenscheiben und nicht EIN Eintrag über den ganzen Bereich: die Reihe behält damit
     * dieselbe Körnung wie ihr gemessener Teil, und wer sie zeichnet oder je Intervall nachschlägt,
     * muss keinen Sonderfall kennen. Am Rand wird die letzte Scheibe beschnitten.
     */
    for (let sliceStart = startMs; sliceStart < endMs; sliceStart += HOUR_MS) {
      const sliceEnd = Math.min(sliceStart + HOUR_MS, endMs)
      prices.push({
        tsStart: iso(sliceStart),
        tsEnd: iso(sliceEnd),
        ctPerKwh: reference.ctPerKwh,
        priceBasis: reference.priceBasis,
      })
    }

    coverage.push({
      origin: 'assumed',
      fromIso: gap.fromIso,
      toIso: gap.toIso,
      hours: (endMs - startMs) / HOUR_MS,
      assumption: { year: reference.year, month: reference.month, ctPerKwh: reference.ctPerKwh },
    })
  }

  return { prices, coverage, gaps: [] }
}

/**
 * Monatsdurchschnitte der ECHTEN Preise, chronologisch. Kalendermonat in UTC — dieselbe Zeitachse,
 * auf der `spot_prices` und die Lückenprüfung rechnen; eine Ortszeit brächte hier nur eine zweite.
 */
function monthAverages(prices: SpotPricePointInput[]): MonthAverage[] {
  const tallies = new Map<string, { year: number; month: number; ctHours: number; hours: number; priceBasis: string }>()

  for (const price of prices) {
    const startMs = Date.parse(price.tsStart)
    const endMs = Date.parse(price.tsEnd)
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue
    const at = new Date(startMs)
    const year = at.getUTCFullYear()
    const month = at.getUTCMonth() + 1
    const hours = (endMs - startMs) / HOUR_MS
    const key = `${year}-${month}`

    const tally = tallies.get(key)
    if (!tally) {
      tallies.set(key, {
        year,
        month,
        ctHours: price.ctPerKwh * hours,
        hours,
        priceBasis: price.priceBasis || DEFAULT_PRICE_BASIS,
      })
      continue
    }
    tally.ctHours += price.ctPerKwh * hours
    tally.hours += hours
  }

  return [...tallies.values()]
    .filter((t) => t.hours > 0)
    .map((t) => ({
      year: t.year,
      month: t.month,
      midMs: (Date.UTC(t.year, t.month - 1, 1) + Date.UTC(t.year, t.month, 1)) / 2,
      ctPerKwh: t.ctHours / t.hours,
      priceBasis: t.priceBasis,
    }))
    .sort((a, b) => a.midMs - b.midMs)
}

/** Strikt kleiner, damit bei gleichem Abstand der FRÜHERE Monat gewinnt (`months` ist sortiert). */
function nearestMonth(months: MonthAverage[], atMs: number): MonthAverage {
  return months.reduce((best, candidate) =>
    Math.abs(candidate.midMs - atMs) < Math.abs(best.midMs - atMs) ? candidate : best,
  )
}

function sumHours(coverage: MarketPriceCoverage[], origin: MarketPriceOrigin): number {
  return coverage.reduce((sum, entry) => (entry.origin === origin ? sum + entry.hours : sum), 0)
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}
