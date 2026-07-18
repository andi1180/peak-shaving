/**
 * SERVER-ONLY Umgebungsvariablen (T4-2, Aufgabe 1) — nicht-präfixte Werte + Geheimnisse.
 *
 * `import 'server-only'`: der Compiler bricht mit einem BUILD-Fehler ab, sobald diese Datei (oder
 * etwas, das sie importiert) aus einer Client-Komponente gezogen wird. DAS ist die strukturelle
 * Trennung, die Aufgabe 1 verlangt — ein server-only-Wert (SUPABASE_*, RESEND_*, TURNSTILE_SECRET,
 * später der Stripe-/Service-Role-Schlüssel) kann so nicht versehentlich im Client-Bundle landen.
 * Die client-exponierten `NEXT_PUBLIC_*` liegen getrennt in `env.public.ts`.
 *
 * DYNAMISCHER Zugriff hier ist unkritisch (server-only, nie ins Bundle inlined) — trotzdem je
 * Variable eine benannte Zeile, damit die Liste die eine Wahrheit über „welche Server-Env gibt es".
 *
 * NOCH NICHT HIER, kommt mit T4-3 (Stripe): SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY,
 * STRIPE_WEBHOOK_SECRET — allesamt server-only, gehören additiv in dieses Schema. Bewusst noch
 * nicht angelegt (keine Env auf Vorrat); die Struktur trägt sie ohne Umbau.
 */
import 'server-only'
import { z } from 'zod'
import { optionalEnv, parseEnv, requireValue } from './env-shared'

const serverSchema = z.object({
  // Supabase (server-only, §4.4). Von T3 (Monitor-Tarif-Read) UND T4-2 (Auth) genutzt.
  // Bewusst OPTIONAL im Schema, NICHT eager-required: sonst bräche `pnpm --filter web build`
  // in der CI, die keine Supabase-Env setzt und `/strom-check` deren Absenz zur Laufzeit abfängt.
  // Presence wird an der Verwendungsstelle erzwungen (requireSupabase* unten) — mit klarer Meldung
  // beim ersten Zugriff, exakt wie das bisherige file-lokale requireEnv, nur zentral. [Report (d)]
  SUPABASE_URL: optionalEnv,
  SUPABASE_ANON_KEY: optionalEnv,
  // Kontaktformular-Zustellung (Resend). Fehlt der Key/Absender, meldet lib/kontakt/deliver.ts
  // `not_configured` (kein Crash) — deshalb optional.
  RESEND_API_KEY: optionalEnv,
  RESEND_FROM: optionalEnv,
  RESEND_TO: optionalEnv,
  // Cloudflare-Turnstile-Secret. Fehlt es, wird die serverseitige Prüfung übersprungen (Honeypot
  // bleibt der Schutz) — deshalb optional.
  TURNSTILE_SECRET_KEY: optionalEnv,
})

export const serverEnv = parseEnv(
  serverSchema,
  {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM: process.env.RESEND_FROM,
    RESEND_TO: process.env.RESEND_TO,
    TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
  },
  'Server',
)

/**
 * Supabase-Zugangsdaten für Server-Reads (Monitor-Tarife) UND Auth (@supabase/ssr). Require-on-use:
 * wirft mit klarer Meldung, wenn nicht gesetzt — statt beim Import und damit im Build (s. o.).
 */
export function requireSupabaseUrl(): string {
  return requireValue(serverEnv.SUPABASE_URL, 'SUPABASE_URL')
}
export function requireSupabaseAnonKey(): string {
  return requireValue(serverEnv.SUPABASE_ANON_KEY, 'SUPABASE_ANON_KEY')
}
