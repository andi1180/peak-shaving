/**
 * POST /api/stripe/webhook — die serverseitige Wahrheit der Stripe-Subscription-Spiegelung (T4-3).
 *
 * ── ROUTE-LAGE & MIDDLEWARE (K4) ─────────────────────────────────────────────────────────────────
 * Liegt unter `/api`, das die next-intl-/Supabase-Middleware im Matcher explizit ausschließt
 * (`middleware.ts`): KEIN Locale-Redirect, KEIN Session-Refresh — ein Redirect würde die
 * Signaturprüfung über den rohen Body zerstören (verifiziert, s. Report). Node-Runtime (Stripe-SDK
 * braucht Node-crypto), force-dynamic (nie cachen).
 *
 * ── ABLAUF JE EVENT (Aufgabe 4) ──────────────────────────────────────────────────────────────────
 *   1. Signatur über den ROHEN Body prüfen (K4, `await request.text()` — NIE `request.json()`).
 *      Ungültig → 400, keine Verarbeitung.
 *   2. Irrelevante/unbekannte Typen → 200, keine Verarbeitung (K5). invoice.* bewusst NICHT behandelt
 *      (jeder Statuswechsel bei Zahlungserfolg/-fehlschlag emittiert zusätzlich
 *      customer.subscription.updated, das den Spiegel ohnehin nachzieht — s. Handover-Begründung).
 *   3. Subscription ermitteln (checkout.session.completed → zugehörige Subscription bei Stripe holen;
 *      customer.subscription.* → das Event-Objekt selbst).
 *   4. Nutzer/Produkt aus subscription.metadata (bzw. session.client_reference_id, K3) auflösen,
 *      current_period_end aus dem SubscriptionItem lesen (K6), K7-Guard (aktiv ⇒ Periodenende Pflicht).
 *   5. Atomar spiegeln: EIN RPC (Event aufzeichnen + Customer verankern + Subscription upserten, K5).
 *      Der Zugang entsteht NICHT hier, sondern über den entitlements-Sync-Trigger (K1).
 *   6. Duplikat/verarbeitet → 200. Fehler in der Verarbeitung → 500 (Stripe wiederholt; K7: lieber laut
 *      scheitern als Dauerzugang verschenken).
 */
import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe/server'
import { requireStripeWebhookSecret } from '@/lib/env.server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { ACCOUNT_PRODUCT } from '@/lib/auth/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** platform.product_key — WIR kontrollieren dieses Vokabular (Enum in der DB). */
const KNOWN_PRODUCTS = new Set(['monitor', 'calculator_pro'])
/** Nur diese Typen spiegeln eine Subscription; alles andere → 200/ignoriert. */
const RELEVANT_EVENTS = new Set<Stripe.Event['type']>([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
])
/** I9-Spiegelbild im Handler (K7-Guard): diese Stripe-Status gewähren Zugang. */
const ACCESS_STATUSES = new Set(['active', 'trialing', 'past_due'])

type SubscriptionMirror = {
  eventId: string
  eventType: string
  eventCreatedAt: string
  userId: string
  product: string
  customerId: string | null
  subscriptionId: string
  status: string
  priceId: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
}

function customerIdOf(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null {
  if (!customer) return null
  return typeof customer === 'string' ? customer : customer.id
}

/**
 * current_period_end als Unix-Sekunden lesen (K6). PRIMÄR vom SubscriptionItem (die Lage seit
 * "Basil"/"Dahlia" — s. lib/stripe/server.ts). FALLBACK auf das top-level-Feld älterer API-Versionen:
 * ein Webhook-Endpoint/Konto mit einer alten Default-API-Version (z. B. das genutzte Test-Konto,
 * Default 2016-07-06) rendert das Feld noch auf der Subscription selbst. Beide Lagen tragen den Wert;
 * item-first ehrt K6, der Fallback macht den Spiegel unabhängig von der Endpoint-Version robust.
 * (In Produktion sollte der Endpoint zusätzlich auf die gepinnte Version gesetzt werden, s. DEPLOYMENT.md.)
 */
function readCurrentPeriodEndUnix(subscription: Stripe.Subscription): number | null {
  const item = subscription.items?.data?.[0]
  if (item && typeof item.current_period_end === 'number') return item.current_period_end
  const legacy = (subscription as unknown as { current_period_end?: number }).current_period_end
  return typeof legacy === 'number' ? legacy : null
}

/**
 * Baut den Spiegel-Datensatz aus der Stripe-Subscription (+ optional der Checkout-Session als
 * Fallback für die user_id). Wirft bei fehlendem Periodenende trotz aktivem Status (K7).
 */
function buildMirror(
  event: Stripe.Event,
  subscription: Stripe.Subscription,
  session?: Stripe.Checkout.Session,
): SubscriptionMirror {
  // K3: user_id primär aus den Subscription-Metadaten (via subscription_data.metadata gesetzt),
  // client_reference_id der Session als Fallback. NIE aus einer E-Mail erraten.
  const userId = subscription.metadata?.user_id ?? session?.client_reference_id ?? null
  if (!userId) {
    throw new Error(
      `Keine user_id in subscription.metadata/client_reference_id (sub ${subscription.id}) — nicht auflösbar`,
    )
  }

  // Produkt aus den Metadaten; unbekannt/fehlend → Default 'monitor' (aktuell das einzige verkaufte
  // Produkt). Ein Tippfehler im product_key würde beim Enum-Cast in der DB ohnehin laut scheitern.
  const metaProduct = subscription.metadata?.product
  const product = metaProduct && KNOWN_PRODUCTS.has(metaProduct) ? metaProduct : ACCOUNT_PRODUCT

  // K6: current_period_end vom Item (mit Legacy-Fallback, s. readCurrentPeriodEndUnix).
  const item = subscription.items.data[0]
  const periodEndUnix = readCurrentPeriodEndUnix(subscription)
  const currentPeriodEnd = periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null

  const status = subscription.status

  // K7-Guard (Handler-Seite): ein zugangsgewährender Status OHNE Periodenende darf nicht durchgehen —
  // sonst schriebe der Sync-Trigger valid_until=NULL bei is_active=true (Dauerzugang trotz Kündigung).
  // Der DB-CHECK ist die Rückfalllinie; hier scheitert es früher und mit klarer Meldung.
  if (ACCESS_STATUSES.has(status) && !currentPeriodEnd) {
    throw new Error(
      `Aktives Abo ${subscription.id} (Status ${status}) ohne current_period_end — ` +
        'Verarbeitung wird abgebrochen (K7), kein unbegrenzter Zugang.',
    )
  }

  return {
    eventId: event.id,
    eventType: event.type,
    eventCreatedAt: new Date(event.created * 1000).toISOString(), // I5: event.created ist der Ordnungsschlüssel
    userId,
    product,
    customerId: customerIdOf(subscription.customer),
    subscriptionId: subscription.id,
    status,
    priceId: item?.price?.id ?? null,
    currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  }
}

/** Atomarer Spiegel-RPC (K1/K5): Event aufzeichnen + Customer verankern + Subscription upserten. */
async function mirror(m: SubscriptionMirror): Promise<'processed' | 'duplicate'> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase.rpc('process_stripe_subscription_event', {
    p_event_id: m.eventId,
    p_event_type: m.eventType,
    p_event_created_at: m.eventCreatedAt,
    p_user_id: m.userId,
    p_product: m.product as 'monitor' | 'calculator_pro',
    p_stripe_subscription_id: m.subscriptionId,
    p_status: m.status,
    // Nullable/optional: null → weglassen (SQL-Default NULL). Der Wrapper schreibt dann NULL, was der
    // Sync-Trigger korrekt behandelt (bei zugangsgewährendem Status ist das per K7-Guard oben schon
    // ausgeschlossen).
    p_stripe_customer_id: m.customerId ?? undefined,
    p_price_id: m.priceId ?? undefined,
    p_current_period_end: m.currentPeriodEnd ?? undefined,
    p_cancel_at_period_end: m.cancelAtPeriodEnd,
  })
  if (error) throw new Error(`process_stripe_subscription_event fehlgeschlagen: ${error.message}`)
  return data === 'duplicate' ? 'duplicate' : 'processed'
}

export async function POST(request: Request): Promise<Response> {
  // K4: ROHER Body, niemals request.json() — sonst schlägt die Signaturprüfung fehl.
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    console.warn('[stripe/webhook] Kein stripe-signature-Header — abgelehnt.')
    return new NextResponse('Missing signature', { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe().webhooks.constructEvent(body, signature, requireStripeWebhookSecret())
  } catch (err) {
    // Ungültige Signatur → 400, KEINE Verarbeitung (K4). Ein Webhook ohne Signaturprüfung wäre ein
    // offenes Schreibrecht auf Entitlements für jeden im Internet.
    console.error('[stripe/webhook] Signaturprüfung fehlgeschlagen:', (err as Error).message)
    return new NextResponse('Invalid signature', { status: 400 })
  }

  // K5: unbekannte/irrelevante Typen → 200, keine Verarbeitung (Stripe wiederholt jede Nicht-2xx-Antwort).
  if (!RELEVANT_EVENTS.has(event.type)) {
    return NextResponse.json({ received: true, ignored: event.type })
  }

  try {
    let subscription: Stripe.Subscription | null = null
    let session: Stripe.Checkout.Session | undefined

    if (event.type === 'checkout.session.completed') {
      session = event.data.object as Stripe.Checkout.Session
      // Nur Abo-Checkouts spiegeln; ein (hier nicht genutzter) Einmalzahlungs-Checkout hätte keine sub.
      if (session.mode !== 'subscription' || !session.subscription) {
        return NextResponse.json({ received: true, note: 'no subscription in session' })
      }
      const subId =
        typeof session.subscription === 'string' ? session.subscription : session.subscription.id
      // Der Zugang entsteht NICHT aus dem Session-Event allein, sondern aus der GESPIEGELTEN
      // Subscription (K1) — deshalb holen wir sie frisch bei Stripe.
      subscription = await stripe().subscriptions.retrieve(subId)
    } else {
      // customer.subscription.created/.updated/.deleted → das Objekt IST die Subscription.
      subscription = event.data.object as Stripe.Subscription
    }

    const outcome = await mirror(buildMirror(event, subscription, session))
    return NextResponse.json({ received: true, outcome })
  } catch (err) {
    // Aussagekräftig loggen und mit != 2xx antworten → Stripe wiederholt (außer Duplikat/unbekannt,
    // die oben schon 200 lieferten). K7: lieber laut scheitern als still Dauerzugang gewähren.
    console.error(
      `[stripe/webhook] Verarbeitung von ${event.type} (${event.id}) fehlgeschlagen:`,
      err instanceof Error ? err.message : err,
    )
    return new NextResponse('Webhook handler failed', { status: 500 })
  }
}
