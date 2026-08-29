/**
 * Einmaliger Backfill der aWATTar-Marktpreise (B21-2a).
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node apps/web/scripts/backfill-spot-prices.mjs [--start 2025-01-01]
 *
 * Die Schlüssel kommen aus der Shell, nicht aus einer Datei im Repo (DEPLOYMENT.md §4, Prinzip S1).
 * Ohne Argumente wird ab dem festen Anker (s. u.) bis jetzt geholt.
 *
 * ── WARUM EIN FESTER ANKER UND KEIN ROLLIERENDES FENSTER ────────────────────────────────────────
 * Die erste Fassung holte „die letzten zwölf Monate ab jetzt". Das Ergebnis hängt damit vom Tag des
 * Laufs ab: der Lauf vom 27.08.2026 begann bei 2025-08-27 und liess alles davor leer — eine Lücke,
 * die niemand sieht, weil die Tabelle gefüllt aussieht. Ein Neuaufbau (neue Umgebung, neues Projekt)
 * reproduzierte sie an einem anderen Datum erneut. Der Anker macht den Backfill stattdessen
 * reproduzierbar: derselbe Aufruf liefert unabhängig vom Ausführungstag denselben Anfang.
 *
 * ── WARUM EIN SKRIPT UND KEIN ZWEITER ENDPUNKT ──────────────────────────────────────────────────
 * Der Backfill ist ein einmaliger Vorgang, kein Betriebszustand. Als Modus des Cron-Endpunkts wäre
 * er ein dauerhaft offener Pfad, über den sich mit demselben Geheimnis ein beliebig grosser Abruf
 * auslösen liesse — ein Query-Parameter entschiede dann über die Grösse des Vorgangs. Dieselbe
 * Überlegung, aus der B4-1 die Mengenobergrenze aus dem HTTP-Handler heraushält.
 *
 * ── EIN AUFRUF GENÜGT, GEMESSEN ─────────────────────────────────────────────────────────────────
 * Ein einzelner Abruf über zwölf Monate liefert real 8.759 lückenlose Stundenwerte; die Quelle
 * kennt weder Pagination noch eine Obergrenze, die hier zu umgehen wäre. Gestapelt wird erst beim
 * Schreiben, und das erledigt `syncSpotPrices` (`../lib/spot-prices/sync.ts`) — dieselbe
 * Funktion, die auch der Cron-Endpunkt benutzt. Umrechnung, Prüfung und Stapelgrösse existieren
 * damit genau einmal.
 *
 * Das Skript läuft ausserhalb von Next, deshalb bringt es seinen eigenen Supabase-Client mit; die
 * Sync-Funktion bekommt wie beim Cron-Endpunkt nur eine `write`-Funktion gereicht.
 *
 * ── WARUM ES IN `apps/web/scripts/` LIEGT UND NICHT IM REPO-ROOT ────────────────────────────────
 * pnpm legt keine hochgezogenen `node_modules` an: ein Skript im Repo-Root könnte
 * `@supabase/supabase-js` gar nicht auflösen (gemessen), und es dafür als Root-Abhängigkeit
 * aufzunehmen hiesse, dem gesamten Monorepo ein Paket zu geben, das genau eine Datei braucht.
 * Hier liegt es neben dem Code, den es benutzt, und beide Importe lösen ohne Zutun auf.
 */
import { createClient } from '@supabase/supabase-js'
import { SPOT_PRICES_ON_CONFLICT, syncSpotPrices } from '../lib/spot-prices/sync.ts'

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error(
    'SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY müssen in der Umgebung stehen.\n' +
      'Beispiel: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node apps/web/scripts/backfill-spot-prices.mjs',
  )
  process.exit(1)
}

/**
 * Der feste Anfang des Backfills. Bewusst eine Konstante und kein gerechnetes Datum: ein
 * rollierendes Fenster hinterlässt je nach Ausführungstag eine andere Lücke (s. Kopf).
 *
 * ⚠ 23:00 UTC AM VORTAG IST KEIN VERTIPPER, sondern die MITTERNACHT DER ORTSZEIT des 1.1.2025
 * (Europe/Vienna, im Winter UTC+1). Ein österreichischer Kalenderjahr-Lastgang beginnt genau dort;
 * begänne der Preisbestand erst um Mitternacht UTC, hätte dessen erste Stunde keinen Preis und der
 * aWATTar-Vergleich wäre für JEDEN solchen Lastgang „nicht berechenbar" (Delta 15, Regel C) — eine
 * systematische Kante des Ankers, keine betriebliche Lücke. Dieselbe Ortszeit-Logik, mit der Regel B
 * beim Upload gegen den KALENDERTAG prüft (`packages/shared/src/analysis-window.ts`).
 *
 * Diese Zahl steht dort ein zweites Mal als `SPOT_PRICE_ANCHOR_ISO`; ein Wächter in
 * `analysis-window.test.ts` liest DIESE Datei und hält beide zusammen.
 */
const BACKFILL_ANCHOR_ISO = '2024-12-31T23:00:00Z'

const startArg = process.argv.indexOf('--start')
const startIso = startArg === -1 ? BACKFILL_ANCHOR_ISO : process.argv[startArg + 1]
const start = new Date(startIso ?? '')
if (Number.isNaN(start.getTime())) {
  console.error('--start erwartet ein ISO-8601-Datum, z. B. 2025-01-01 oder 2025-01-01T00:00:00Z.')
  process.exit(1)
}

const end = new Date()
if (start.getTime() >= end.getTime()) {
  console.error('--start muss in der Vergangenheit liegen.')
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

console.log(`Backfill ${start.toISOString()} … ${end.toISOString()}`)

try {
  const result = await syncSpotPrices({
    startMs: start.getTime(),
    endMs: end.getTime(),
    write: (rows) => supabase.from('spot_prices').upsert(rows, { onConflict: SPOT_PRICES_ON_CONFLICT }),
  })
  console.log(
    `Fertig: ${result.fetched} Einträge geholt, ${result.written} Zeilen geschrieben ` +
      `(${result.firstTsStart} … ${result.lastTsStart}).`,
  )
} catch (cause) {
  console.error('Backfill abgebrochen:', cause instanceof Error ? cause.message : cause)
  process.exit(1)
}
