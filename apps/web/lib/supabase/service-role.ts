/**
 * SERVER-ONLY Supabase-Client mit dem SERVICE-ROLE-Key (T4-3). Umgeht RLS.
 *
 * ── STRENG BEGRENZTER GEBRAUCH (Aufgabe 3) ───────────────────────────────────────────────────────
 * Dieser Client trägt den SUPABASE_SERVICE_ROLE_KEY und umgeht damit jede RLS. Er ist AUSSCHLIESSLICH
 * für den Stripe-Integrations-Pfad gedacht — den Webhook (`app/api/stripe/webhook`) und die
 * Checkout-/Portal-Server-Actions (`lib/stripe/actions.ts`). Er darf NIE in einer Server-Component,
 * Page oder einem nutzerseitigen Read landen; dort läuft der reguläre, RLS-gebundene
 * `lib/supabase/server.ts`-Client (Nutzer sieht nur eigene Zeilen).
 *
 * Ein versehentlicher Gebrauch fällt auf DREI Wegen auf:
 *   1. `import 'server-only'` — ein Import aus einer Client-Komponente bricht den Build hart.
 *   2. ESLint `no-restricted-imports` (root `eslint.config.mjs`) verbietet den Import dieses Moduls
 *      überall AUSSER in den zwei erlaubten Stripe-Pfaden — ein Import anderswo lässt `pnpm lint`
 *      rot werden (der eigentliche „Server-Component/Page"-Schutz, den server-only allein nicht gibt,
 *      weil eine Server-Component ebenfalls server-seitig ist).
 *   3. Der require-on-use-Zugriff auf SUPABASE_SERVICE_ROLE_KEY wirft mit klarer Meldung, wenn der
 *      Key fehlt — die Marketing-Seite/der Gratis-Check funktioniert ohne ihn (er wird nur hier gebraucht).
 *
 * ── WARUM SERVICE-ROLE FÜR CHECKOUT/PORTAL, NICHT NUR FÜR DEN WEBHOOK ─────────────────────────────
 * Die Checkout-/Portal-Actions verankern bzw. lesen die Nutzer↔Customer-Zuordnung (K3) über
 * public-RPC-Wrapper, die service_role-only gegrantet sind (ein authentifizierter Nutzer darf die
 * Zahlungs-Spiegel-Tabellen nicht schreiben, I3). Der „nur im Webhook-Pfad"-Grundsatz aus Aufgabe 3
 * meint die ABGRENZUNG gegen normales Seiten-Rendering/Nutzer-Reads — nicht, dass der Checkout-Start
 * (der laut K3 platform.customers verankern MUSS) ohne service_role auskäme.
 */
import 'server-only'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/db-types'
import { requireSupabaseServiceRoleKey, requireSupabaseUrl } from '@/lib/env.server'

/**
 * Frischer service_role-Client pro Aufruf (kein Modul-Singleton — dieselbe Begründung wie im
 * Monitor-Read: ein geteilter Client-Zustand über Requests hinweg ist in einer Server-Umgebung
 * unnötig). Ruft ausschließlich die public-RPC-Wrapper (`.rpc(...)`) auf — `platform` ist nicht
 * exponiert, ein direkter `.from('platform.…')` würde gar nicht durchgehen (J3/K2).
 */
export function createServiceRoleClient() {
  return createClient<Database>(requireSupabaseUrl(), requireSupabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
