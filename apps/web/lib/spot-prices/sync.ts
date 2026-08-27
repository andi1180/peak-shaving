/**
 * B21-2a — Abruf der aWATTar-Marktpreise und Übernahme in `public.spot_prices`.
 *
 * Kanonische fachliche Quelle: `Pflichtenheft_Kalkulator_Delta_Tarifoptimierung.md`, Delta 7.
 *
 * ── DIESES MODUL KENNT WEDER NEXT NOCH SUPABASE ─────────────────────────────────────────────────
 * Es importiert nichts aus `next/*`, keinen Supabase-Client und keine Pfad-Aliasse. Das ist kein
 * Selbstzweck: es gibt ZWEI Aufrufer, die sich ihren Zugang zur Datenbank verschieden beschaffen —
 * der Cron-Endpunkt (`app/api/cron/spot-price-sync`) über `createServiceRoleClient()`, das
 * Backfill-Skript (`scripts/backfill-spot-prices.mjs`) über einen eigenen Client aus der Shell-
 * Umgebung, ausserhalb von Next. Beide reichen deshalb nur eine `write`-Funktion herein.
 *
 * Was dadurch NICHT zweimal existiert — und genau das ist der Punkt: die Einheiten-Umrechnung, die
 * Prüfung der Antwort, die Stapelgrösse und die Zählung. Eine zweite Umsetzung liefe auseinander,
 * und der Unterschied wäre eine stille Faktor-10-Abweichung in den Preisen (s. u.).
 *
 * Nebeneffekt: das Modul steht damit auch nicht unter der eslint-Regel `no-restricted-imports` für
 * `@/lib/supabase/service-role` — es importiert den Client gar nicht. Die Erlaubnisliste in
 * `eslint.config.mjs` bleibt unverändert; `app/api/cron/**` steht dort seit B4-1 ohnehin.
 */

/** Der öffentliche Marktdaten-Endpunkt der österreichischen aWATTar-Instanz (Delta 7). */
export const AWATTAR_MARKETDATA_URL = 'https://api.awattar.at/v1/marketdata'

/** Der Quellenschlüssel, unter dem diese Preise in `public.spot_prices` stehen. */
export const AWATTAR_PROVIDER = 'awattar_at'

/**
 * Die Einheit, in der aWATTar liefert — real gegen den Endpunkt verifiziert, nicht aus der Doku
 * übernommen. Sie ist Teil JEDES Eintrags der Antwort und wird bei JEDEM Eintrag geprüft.
 *
 * ⚠ Das ist die wichtigste Prüfung dieser Datei. Lieferte die Quelle eines Tages `Eur/kWh` oder
 * `Ct/kWh`, wäre die Division durch 10 unten stillschweigend um den Faktor 10 bzw. 100 falsch — und
 * eine um den Faktor 10 falsche Preiskurve fällt in einer Wirtschaftlichkeitsrechnung nicht als
 * Fehler auf, sondern als überraschend gutes Ergebnis. Ein unbekannter Wert bricht den Lauf deshalb
 * ab, statt ihn zu deuten.
 */
export const AWATTAR_EXPECTED_UNIT = 'Eur/MWh'

/**
 * `EUR/MWh → ct/kWh`, ausgeschrieben statt als Zahl:
 *   1 EUR = 100 ct, 1 MWh = 1000 kWh  ⇒  X EUR/MWh = X · 100 ct / 1000 kWh = X / 10 ct/kWh
 * Beispiel aus einer echten Antwort: 177,97 Eur/MWh → 17,797 ct/kWh.
 */
const CT_PER_KWH_PER_EUR_PER_MWH = 100 / 1000

/**
 * Wie viele Zeilen je Schreibvorgang. Der Backfill über zwölf Monate bringt ~8.760 Stundenwerte;
 * die als EIN Rumpf zu schicken ist unnötig — die Grenze liegt hier bei uns und nicht bei der
 * Plattform, und ein fehlgeschlagener Stapel kostet so nur seinen eigenen Teil.
 */
const UPSERT_CHUNK_SIZE = 500

/** Die Konfliktbedingung aus B21-1 (`unique (provider, ts_start)`) — an EINER Stelle benannt. */
export const SPOT_PRICES_ON_CONFLICT = 'provider,ts_start'

/** Ein Eintrag der aWATTar-Antwort, nachdem er geprüft wurde. */
export type AwattarEntry = {
  start_timestamp: number
  end_timestamp: number
  marketprice: number
  unit: string
}

/** Eine Zeile, wie sie in `public.spot_prices` geschrieben wird. */
export type SpotPriceRow = {
  provider: string
  ts_start: string
  ts_end: string
  ct_per_kwh: number
  price_basis: 'net'
}

/**
 * Der einzige Berührungspunkt mit der Datenbank: schreibt einen Stapel per Upsert und meldet
 * ausschliesslich, ob es geklappt hat. Der Aufrufer bringt seinen eigenen Client mit.
 *
 * `PromiseLike` und nicht `Promise`, gemessen am Typfehler: der Aufruf
 * `supabase.from(…).upsert(…)` gibt einen `PostgrestFilterBuilder` zurück — ein Thenable, das erst
 * beim `await` ausgeführt wird und keine `catch`/`finally`-Methoden hat. Auf `Promise` festgelegt
 * zwänge dieser Typ jeden Aufrufer zu einem überflüssigen `Promise.resolve(...)` oder einer
 * Typzusicherung um den eigentlichen Aufruf herum.
 */
export type SpotPriceWriter = (rows: SpotPriceRow[]) => PromiseLike<{ error: { message: string } | null }>

export type SyncResult = {
  /** Wie viele Einträge die Quelle geliefert hat. */
  fetched: number
  /** Wie viele Zeilen geschrieben wurden (angelegt ODER aktualisiert — das Upsert trennt das nicht). */
  written: number
  /** Frühester geschriebener Zeitpunkt, ISO-8601, oder null bei leerem Lauf. */
  firstTsStart: string | null
  /** Spätester geschriebener Zeitpunkt, ISO-8601, oder null bei leerem Lauf. */
  lastTsStart: string | null
}

/** Fehler dieses Moduls — vom Aufrufer an der Klasse erkennbar, ohne die Meldung zu lesen. */
export class SpotPriceSyncError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SpotPriceSyncError'
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Prüft die Antwort der Quelle, bevor irgendetwas davon in die Datenbank geht.
 *
 * Die Antwort ist ein Objekt `{ object: 'list', data: [...] }` — real gegen den Endpunkt verifiziert,
 * NICHT ein rohes Array. Ein Eintrag ohne vollständige Zahlen oder mit unerwarteter Einheit bricht
 * den Lauf ab; er wird NICHT übersprungen. Eine Lücke in der Preiskurve, die niemand bemerkt, ist
 * schlimmer als ein Lauf, der sichtbar scheitert und morgen erneut anläuft.
 */
export function parseAwattarResponse(payload: unknown): AwattarEntry[] {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new SpotPriceSyncError('Unerwartete Antwort: kein Objekt.')
  }
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) {
    throw new SpotPriceSyncError('Unerwartete Antwort: Feld `data` fehlt oder ist kein Array.')
  }

  return data.map((raw, index) => {
    if (raw === null || typeof raw !== 'object') {
      throw new SpotPriceSyncError(`Eintrag ${index}: kein Objekt.`)
    }
    const entry = raw as Record<string, unknown>
    const { start_timestamp: start, end_timestamp: end, marketprice: price, unit } = entry

    if (!isFiniteNumber(start) || !isFiniteNumber(end)) {
      throw new SpotPriceSyncError(`Eintrag ${index}: Zeitstempel fehlen oder sind keine Zahlen.`)
    }
    if (end <= start) {
      throw new SpotPriceSyncError(`Eintrag ${index}: Intervallende liegt nicht nach dem Anfang.`)
    }
    if (!isFiniteNumber(price)) {
      throw new SpotPriceSyncError(`Eintrag ${index}: \`marketprice\` fehlt oder ist keine Zahl.`)
    }
    if (unit !== AWATTAR_EXPECTED_UNIT) {
      // Siehe AWATTAR_EXPECTED_UNIT: hier abzubrechen ist der ganze Zweck der Prüfung.
      throw new SpotPriceSyncError(
        `Eintrag ${index}: unerwartete Einheit ${JSON.stringify(unit)} — erwartet ` +
          `${JSON.stringify(AWATTAR_EXPECTED_UNIT)}. Der Lauf bricht ab, statt die Zahl zu deuten: ` +
          'eine falsch umgerechnete Preiskurve fällt später nicht als Fehler auf.',
      )
    }
    return { start_timestamp: start, end_timestamp: end, marketprice: price, unit }
  })
}

/**
 * Rechnet geprüfte Einträge in Tabellenzeilen um.
 *
 * `price_basis: 'net'` ist keine Vermutung: aWATTar liefert Rohpreise ohne Steuern und Abgaben
 * (Delta 6). Der Wert steht trotzdem an JEDER Zeile und nicht nur im Spaltenvorgabewert — eine
 * zweite, brutto liefernde Quelle soll ihn ausdrücklich setzen müssen.
 */
export function toSpotPriceRows(entries: AwattarEntry[]): SpotPriceRow[] {
  return entries.map((entry) => ({
    provider: AWATTAR_PROVIDER,
    ts_start: new Date(entry.start_timestamp).toISOString(),
    ts_end: new Date(entry.end_timestamp).toISOString(),
    ct_per_kwh: entry.marketprice * CT_PER_KWH_PER_EUR_PER_MWH,
    price_basis: 'net',
  }))
}

/**
 * Holt ein Zeitfenster von aWATTar.
 *
 * Die Grenzen sind Epoch-MILLISEKUNDEN, so verlangt es der Endpunkt. Ein einzelner Aufruf über
 * zwölf Monate liefert real 8.759 lückenlose Stundenwerte (gemessen) — es gibt keine Pagination und
 * keine Obergrenze, die der Backfill umgehen müsste.
 */
export async function fetchAwattarWindow(
  startMs: number,
  endMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<AwattarEntry[]> {
  if (!Number.isInteger(startMs) || !Number.isInteger(endMs) || endMs <= startMs) {
    throw new SpotPriceSyncError('Ungültiges Zeitfenster: erwartet ganzzahlige Millisekunden, Ende nach Anfang.')
  }
  const url = `${AWATTAR_MARKETDATA_URL}?start=${startMs}&end=${endMs}`
  const response = await fetchImpl(url, { headers: { accept: 'application/json' } })
  if (!response.ok) {
    throw new SpotPriceSyncError(`aWATTar antwortete mit HTTP ${response.status}.`)
  }
  return parseAwattarResponse(await response.json())
}

/**
 * Der ganze Vorgang: holen → prüfen → umrechnen → stapelweise upserten.
 *
 * Ein leeres Fenster ist KEIN Fehler (`written: 0`): fragt der tägliche Lauf den übernächsten Tag
 * ab, bevor er veröffentlicht ist, liefert die Quelle schlicht weniger Einträge.
 */
export async function syncSpotPrices(options: {
  write: SpotPriceWriter
  startMs: number
  endMs: number
  fetchImpl?: typeof fetch
}): Promise<SyncResult> {
  const { write, startMs, endMs, fetchImpl } = options
  const entries = await fetchAwattarWindow(startMs, endMs, fetchImpl)
  const rows = toSpotPriceRows(entries)

  let written = 0
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK_SIZE)
    const { error } = await write(chunk)
    if (error) {
      throw new SpotPriceSyncError(
        `Schreibvorgang fehlgeschlagen nach ${written} von ${rows.length} Zeilen: ${error.message}`,
      )
    }
    written += chunk.length
  }

  return {
    fetched: entries.length,
    written,
    firstTsStart: rows[0]?.ts_start ?? null,
    lastTsStart: rows[rows.length - 1]?.ts_start ?? null,
  }
}
