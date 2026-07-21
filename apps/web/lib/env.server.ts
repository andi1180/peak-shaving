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
 * T4-3 (Stripe): SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET und die
 * Monitor-Price-ID sind additiv ergänzt — allesamt server-only, alle OPTIONAL im Schema +
 * require-on-use (s. u.), damit ein Build ohne sie durchläuft (die Marketing-Seite/der Gratis-Check
 * brauchen sie nicht; erzwungen werden sie erst im Stripe-Pfad).
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
  // service_role-Key (T4-3): umgeht RLS, wird AUSSCHLIESSLICH im Stripe-Pfad gebraucht (Webhook +
  // Checkout/Portal-Actions, s. lib/supabase/service-role.ts). Optional/require-on-use wie oben.
  SUPABASE_SERVICE_ROLE_KEY: optionalEnv,
  // Stripe (T4-3, server-only). Secret-Key + Webhook-Signing-Secret + die Monitor-Price-ID (K9:
  // der Preis lebt NUR in der Env, nie im Code/in de.json). Alle require-on-use im Stripe-Pfad.
  STRIPE_SECRET_KEY: optionalEnv,
  STRIPE_WEBHOOK_SECRET: optionalEnv,
  STRIPE_MONITOR_PRICE_ID: optionalEnv,
  // Kontaktformular-Zustellung (Resend). Fehlt der Key/Absender, meldet lib/kontakt/deliver.ts
  // `not_configured` (kein Crash) — deshalb optional.
  RESEND_API_KEY: optionalEnv,
  RESEND_FROM: optionalEnv,
  RESEND_TO: optionalEnv,
  // Signaturgeheimnis des Resend-Webhooks (B2-2, app/api/resend/webhook). Beginnt mit `whsec_`,
  // stammt aus der Endpunkt-Seite im Resend-Dashboard. Optional im Schema wie alles hier — aber
  // FAIL-CLOSED an der Verwendungsstelle: fehlt der Wert, antwortet der Endpunkt 400 statt zu
  // laufen (s. resendWebhookSecretOrNull unten). ✔ Gefahrlos rotierbar.
  RESEND_WEBHOOK_SECRET: optionalEnv,
  // Cloudflare-Turnstile-Secret. Fehlt es, wird die serverseitige Prüfung übersprungen (Honeypot
  // bleibt der Schutz) — deshalb optional.
  TURNSTILE_SECRET_KEY: optionalEnv,
  // Signaturgeheimnis der Abmeldelinks (B1-2, lib/leads/tokens.ts). Optional/require-on-use wie
  // oben: die Marketing-Seite braucht es nicht, der Lead-Pfad erzwingt es beim ersten Zugriff.
  // ⚠ NICHT ROTIEREN — s. requireLeadTokenSecret unten.
  LEAD_TOKEN_SECRET: optionalEnv,
  // Auslöse-Geheimnis des Cron-Endpunkts (B4-1, app/api/cron/**). Vercel schickt es als
  // `Authorization: Bearer …`, sobald die Variable im Projekt gesetzt ist. Optional im Schema wie
  // alles andere hier — aber FAIL-CLOSED an der Verwendungsstelle: fehlt der Wert, antwortet der
  // Endpunkt 401 statt zu laufen (s. requireCronSecret unten).
  CRON_SECRET: optionalEnv,
})

export const serverEnv = parseEnv(
  serverSchema,
  {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_MONITOR_PRICE_ID: process.env.STRIPE_MONITOR_PRICE_ID,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM: process.env.RESEND_FROM,
    RESEND_TO: process.env.RESEND_TO,
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
    TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
    LEAD_TOKEN_SECRET: process.env.LEAD_TOKEN_SECRET,
    CRON_SECRET: process.env.CRON_SECRET,
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

/**
 * service_role-Key (T4-3): NUR im Stripe-Pfad (s. lib/supabase/service-role.ts). Require-on-use —
 * wirft mit klarer Meldung, wenn nicht gesetzt, statt still ohne RLS-Umgehung zu laufen.
 */
export function requireSupabaseServiceRoleKey(): string {
  return requireValue(serverEnv.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY')
}

/** Stripe-Secrets/Price-ID (T4-3), require-on-use im Stripe-Pfad. */
export function requireStripeSecretKey(): string {
  return requireValue(serverEnv.STRIPE_SECRET_KEY, 'STRIPE_SECRET_KEY')
}
export function requireStripeWebhookSecret(): string {
  return requireValue(serverEnv.STRIPE_WEBHOOK_SECRET, 'STRIPE_WEBHOOK_SECRET')
}
export function requireStripeMonitorPriceId(): string {
  return requireValue(serverEnv.STRIPE_MONITOR_PRICE_ID, 'STRIPE_MONITOR_PRICE_ID')
}

/**
 * Signaturgeheimnis der Abmeldelinks (B1-2). Require-on-use im Lead-Pfad.
 *
 * ⚠ DIESER WERT DARF NICHT ROUTINEMÄSSIG ROTIERT WERDEN. Die Abmeldelinks sind ZUSTANDSLOS: die
 * Signatur ist der einzige Beweis, dass ein Link echt ist — es gibt keine Tabelle, gegen die man ihn
 * sonst prüfen könnte (Absicht: ein Abmeldelink muss auch in einer zwei Jahre alten Mail noch
 * funktionieren, eine Token-Tabelle verschwände mit der Lead-Löschung). Ein neues Geheimnis entwertet
 * damit JEDEN je versendeten Abmeldelink auf einen Schlag; Empfänger sähen die neutrale
 * „Link ungültig"-Seite und meldeten sich stattdessen als Spam. Rotation nur bei nachgewiesenem
 * Leck, und dann als bewusster Vorgang mit erneutem Versand — nicht als Hygiene-Routine.
 * (Dieselbe Warnung steht in DEPLOYMENT.md §1f und in `.env.example`.)
 */
export function requireLeadTokenSecret(): string {
  return requireValue(serverEnv.LEAD_TOKEN_SECRET, 'LEAD_TOKEN_SECRET')
}

/**
 * Auslöse-Geheimnis der Cron-Endpunkte (B4-1). BEWUSST KEIN `requireValue`: ein fehlender Wert darf
 * hier nicht werfen, sondern muss zu einer glatten 401 führen — deshalb `string | null`.
 *
 * FAIL-CLOSED IST DER GANZE PUNKT: wäre der Endpunkt ohne gesetztes Geheimnis offen ("es ist ja
 * keins konfiguriert"), könnte ihn jeder Aufrufer im Internet auslösen. Heute wäre das ein
 * fremdgesteuerter Massen-Anonymisierungslauf, ab B4-2 ein fremdgesteuerter Massenversand. Eine
 * vergessene Umgebungsvariable ist ein plausibler Zustand — ein offener Auslöser darf nicht seine
 * Folge sein.
 *
 * ⚠ IM GEGENSATZ ZU `LEAD_TOKEN_SECRET` IST DIESER WERT GEFAHRLOS ROTIERBAR. Er ist zustandsbehaftet
 * nur zwischen Vercel und diesem Endpunkt; es hängen keine bereits versendeten Links daran, die er
 * entwerten könnte. Neu setzen, neu deployen, fertig.
 */
export function cronSecretOrNull(): string | null {
  return serverEnv.CRON_SECRET ?? null
}

/**
 * Signaturgeheimnis des Resend-Webhooks (B2-2, `app/api/resend/webhook`).
 *
 * BEWUSST KEIN `requireValue`, aus demselben Grund wie bei `CRON_SECRET`: das geforderte Verhalten
 * bei fehlendem Wert ist eine glatte HTTP-Antwort (400), kein geworfener Fehler — der käme beim
 * Anbieter als 500 an und löste einen Wiederholungssturm für etwas aus, das keine Wiederholung
 * behebt. Die Prüfung bleibt trotzdem an der Verwendungsstelle (require-on-use): das Schema hält den
 * Wert optional, damit ein Build ohne ihn durchläuft, und der Endpunkt erzwingt ihn beim ersten
 * Zugriff.
 *
 * FAIL-CLOSED IST DER GANZE PUNKT: „es ist keins konfiguriert, also nehme ich jede Nutzlast an"
 * hiesse, dass jeder im Internet Adressen dauerhaft sperren und Einwilligungen widerrufen könnte —
 * eine Wirkung, für die es über die Oberfläche bewusst keinen Rückweg gibt.
 *
 * ⚠ IM GEGENSATZ ZU `LEAD_TOKEN_SECRET` IST DIESER WERT GEFAHRLOS ROTIERBAR. Er ist zustandsbehaftet
 * nur zwischen Resend und diesem Endpunkt; es hängen keine bereits versendeten Links daran, die er
 * entwerten könnte. Im Resend-Dashboard neu erzeugen, in Vercel setzen, neu deployen — Ereignisse,
 * die dazwischen ankommen, werden mit 400 abgelehnt und von Resend wiederholt.
 */
export function resendWebhookSecretOrNull(): string | null {
  return serverEnv.RESEND_WEBHOOK_SECRET ?? null
}
