/**
 * Einmaliger Backfill der aWATTar-Marktpreise (B21-2a).
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node apps/web/scripts/backfill-spot-prices.mjs [--months 12]
 *
 * Die Schlüssel kommen aus der Shell, nicht aus einer Datei im Repo (DEPLOYMENT.md §4, Prinzip S1).
 * Ohne Argumente werden die letzten zwölf Monate bis jetzt geholt.
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

const monthsArg = process.argv.indexOf('--months')
const months = monthsArg === -1 ? 12 : Number(process.argv[monthsArg + 1])
if (!Number.isInteger(months) || months < 1 || months > 60) {
  console.error('--months erwartet eine ganze Zahl zwischen 1 und 60.')
  process.exit(1)
}

const end = new Date()
const start = new Date(end)
start.setUTCMonth(start.getUTCMonth() - months)

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

console.log(`Backfill ${start.toISOString()} … ${end.toISOString()} (${months} Monate)`)

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
