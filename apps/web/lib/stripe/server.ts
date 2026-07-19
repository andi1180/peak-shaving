/**
 * SERVER-ONLY Stripe-Client (T4-3, K6/K8).
 *
 * `import 'server-only'`: KEIN Stripe-Code im Client-Bundle (K8) — der Compiler bricht ab, sobald
 * diese Datei aus einer Client-Komponente gezogen wird. Es wird bewusst KEIN Stripe.js/Elements
 * eingebunden; Checkout/Portal laufen über von Stripe gehostete URLs (Server Actions leiten dorthin).
 *
 * ── API-VERSION EXPLIZIT GEPINNT (K6) ────────────────────────────────────────────────────────────
 * Stripe hat mit API-Version 2025-03-31 ("Basil") `current_period_end` vom Subscription-Objekt auf
 * das SubscriptionItem verschoben. Wir pinnen `2026-06-24.dahlia` — die DEFAULT-Version der
 * installierten stripe-node 22.3.2, für die auch deren TypeScript-Typen generiert sind. Verifiziert
 * (nicht geraten, K6): in dieser Version trägt der Subscription-Typ KEIN top-level
 * `current_period_end` mehr; das Feld steht als `current_period_end: number` auf dem
 * SubscriptionItem (`stripe/.../SubscriptionItems.d.ts`). Dahlia ist Basils Nachfolger und behält
 * diese Platzierung. Der Webhook liest deshalb aus `subscription.items.data[0].current_period_end`.
 * Ein explizites Pin (statt „latest") verhindert, dass sich die Feld-Lage bei einem SDK-Update
 * unter uns wegbewegt.
 */
import 'server-only'
import Stripe from 'stripe'
import { requireStripeSecretKey } from '@/lib/env.server'

export const STRIPE_API_VERSION = '2026-06-24.dahlia' as const

let client: Stripe | null = null

/**
 * Lazily instanziierter Stripe-Client. Lazy, damit ein Build/Start ohne STRIPE_SECRET_KEY nicht
 * bricht (die Presence wird erst beim ersten echten Gebrauch erzwungen — Muster wie requireSupabase*).
 */
export function stripe(): Stripe {
  if (!client) {
    client = new Stripe(requireStripeSecretKey(), { apiVersion: STRIPE_API_VERSION })
  }
  return client
}
