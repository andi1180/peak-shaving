/**
 * SERVER-ONLY Supabase-Zugriff für den Monitor-Gratis-Check (T3,
 * Pflichtenheft_Monitor_MVP.md §6/§10). Liest `monitor.current_tariffs`
 * (T2, bereits gebaut + seed-befüllt) — der jeweils neueste Snapshot je Tarif.
 *
 * `import 'server-only'`: Build-Fehler statt eines Anon-Keys im Browser-Bundle,
 * falls dieses Modul je aus einer Client-Komponente importiert wird.
 *
 * ENV bewusst NICHT NEXT_PUBLIC_-präfixiert (s. apps/web/.env.example für die
 * ausführliche Begründung) — der non-prefixte Name kann strukturell nicht ins
 * Client-Bundle inlinen, anders als eine NEXT_PUBLIC_-Variable.
 */
import 'server-only'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/db-types'

/**
 * §7: die Tarif-Tabelle ändert sich nur 1×/Tag (zentraler täglicher Scraper) —
 * ein täglicher Cache ist also nicht nur billiger, sondern korrekt (kein
 * sichtbarer Datenverlust ggü. einem Live-Read bei jedem Seitenaufruf).
 */
const REVALIDATE_SECONDS = 60 * 60 * 24

function requireEnv(name: 'SUPABASE_URL' | 'SUPABASE_ANON_KEY'): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} fehlt — apps/web/.env.local aus apps/web/.env.example anlegen ` +
        `(lokal: Werte aus \`supabase status\` nach \`supabase start\`).`,
    )
  }
  return value
}

/**
 * Ein frischer Client pro Aufruf (kein Modul-Singleton): in einer
 * Server-Component/Route-Handler-Umgebung teilen sich sonst mehrere Requests
 * denselben Client-Zustand — für einen reinen, unauthentifizierten Lesezugriff
 * unnötig, und vermeidet die Frage, ob `createClient` je Request-Kontext neu
 * evaluiert wird.
 */
function getMonitorClient() {
  const url = requireEnv('SUPABASE_URL')
  const anonKey = requireEnv('SUPABASE_ANON_KEY')

  return createClient<Database, 'monitor'>(url, anonKey, {
    // `monitor` ist ein eigenes Postgres-Schema (T2, `supabase/config.toml`
    // `api.schemas`), nicht `public` — muss dem Client explizit gesagt werden
    // (setzt den `Accept-Profile`/`Content-Profile`-Header von PostgREST).
    db: { schema: 'monitor' },
    // Kein Auth-Flow hier (reiner öffentlicher Tarif-Read, RLS erlaubt `anon`
    // select) — Session-Persistenz wäre nur totes Gepäck in einem
    // Server-Kontext ohne Browser-Storage.
    auth: { persistSession: false },
    global: {
      /*
       * Bindet den PostgREST-Request in Next.js' fetch-Cache ein: Next patcht
       * das globale `fetch`, und jeder Aufruf, der `next.revalidate` trägt,
       * wird als Data-Cache-Eintrag behandelt — auch wenn der Aufruf aus einem
       * Drittanbieter-SDK (hier supabase-js) kommt, nicht direkt aus der Route.
       * Ohne diesen Wrapper hätte supabase-js keine Möglichkeit, die
       * Next-spezifische Cache-Option zu setzen.
       */
      fetch: (input, init) => fetch(input, { ...init, next: { revalidate: REVALIDATE_SECONDS } }),
    },
  })
}

/**
 * Liest `monitor.current_tariffs` VOLLSTÄNDIG (Top-15–20-Scraper-Ziel, aktuell
 * die Seed-Platzhalter aus T1 — kein Nutzerdaten-Zugriff, reine Katalogdaten).
 * Wirft bei einem Fehler, statt still ein leeres Array zu liefern — ein
 * Vergleich gegen 0 Tarife sähe aus wie „kein Tarif ist besser", nicht wie
 * „die Tarif-Tabelle ist nicht erreichbar".
 */
export async function fetchCurrentTariffRows() {
  const supabase = getMonitorClient()
  const { data, error } = await supabase.from('current_tariffs').select('*')

  if (error) {
    throw new Error(`monitor.current_tariffs konnte nicht gelesen werden: ${error.message}`)
  }

  return data
}
