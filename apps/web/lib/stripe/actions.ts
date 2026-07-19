'use server'

/**
 * Stripe-Server-Actions (T4-3, K8): Checkout- und Customer-Portal-Start. Beide leiten auf eine von
 * Stripe GEHOSTETE URL weiter — KEIN Stripe.js/Elements im Browser (K8). Aufgerufen aus echten
 * `<form action={…}>`-Elementen (Kontoseite + Abo-Teaser).
 *
 * service_role-Nutzung ist hier korrekt (K3): der Checkout-Start MUSS die Nutzer↔Customer-Zuordnung
 * in platform.customers verankern, bevor der Checkout läuft — das geht nur über die service_role-only
 * RPC-Wrapper (ein authentifizierter Nutzer darf die Zahlungs-Spiegel nicht schreiben, I3).
 */
import { redirect } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { getPathname } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { stripe } from '@/lib/stripe/server'
import { requireStripeMonitorPriceId } from '@/lib/env.server'
import { ACCOUNT_PRODUCT, ANMELDEN_HREF, KONTO_HREF } from '@/lib/auth/config'
import { getOrigin, redirectToLocalized } from '@/lib/auth/server-helpers'
import { CHECKOUT_CANCEL, CHECKOUT_ERROR, CHECKOUT_PARAM, CHECKOUT_SUCCESS } from './config'

/** Absolute, locale-korrekte Kontoseiten-URL mit optionalem checkout-Rückkehr-Parameter. */
async function kontoUrl(locale: string, ret?: string): Promise<string> {
  const origin = await getOrigin()
  const path = getPathname({ href: KONTO_HREF, locale })
  return ret ? `${origin}${path}?${CHECKOUT_PARAM}=${ret}` : `${origin}${path}`
}

/**
 * Checkout starten (Aufgabe 5a/5c). Legt den Stripe-Customer an bzw. schlägt ihn nach und verankert
 * ihn VOR dem Checkout (K3), erstellt eine Subscription-Checkout-Session mit user_id/product in
 * client_reference_id UND subscription_data.metadata (K3) und leitet auf die gehostete Checkout-Seite
 * weiter. KEIN Preis im eigenen Code (K9) — der Betrag steht nur auf Stripes Seite.
 */
export async function startCheckoutAction(): Promise<void> {
  const locale = await getLocale()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  // Ohne Session (z. B. Teaser-Klick nach Session-Ablauf) → zur Anmeldung. Der Teaser rendert die
  // Checkout-Form ohnehin nur für eingeloggte Nutzer; das ist die defensive Rückfalllinie.
  if (!user) redirectToLocalized(ANMELDEN_HREF, locale)

  let checkoutUrl: string
  try {
    const service = createServiceRoleClient()

    // K3: bestehenden Customer wiederverwenden statt einen zweiten anzulegen.
    const { data: existing, error: lookupError } = await service.rpc('get_stripe_customer_id', {
      p_user_id: user.id,
    })
    if (lookupError) throw new Error(`get_stripe_customer_id: ${lookupError.message}`)

    let customerId = existing
    if (!customerId) {
      const customer = await stripe().customers.create({
        email: user.email ?? undefined,
        metadata: { user_id: user.id },
      })
      customerId = customer.id
      // K3: Zuordnung VOR dem Checkout verankern — nicht danach aus einer E-Mail erraten.
      const { error: anchorError } = await service.rpc('upsert_stripe_customer', {
        p_user_id: user.id,
        p_stripe_customer_id: customerId,
      })
      if (anchorError) throw new Error(`upsert_stripe_customer: ${anchorError.message}`)
    }

    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: requireStripeMonitorPriceId(), quantity: 1 }],
      // K3: beide Wege, über die der Webhook den Nutzer auflöst.
      client_reference_id: user.id,
      subscription_data: { metadata: { user_id: user.id, product: ACCOUNT_PRODUCT } },
      // K10: die Rückkehr-URL trägt den Parameter, an dem die Kontoseite den Zustand erkennt.
      success_url: await kontoUrl(locale, CHECKOUT_SUCCESS),
      cancel_url: await kontoUrl(locale, CHECKOUT_CANCEL),
    })
    if (!session.url) throw new Error('Checkout-Session ohne URL')
    checkoutUrl = session.url
  } catch (err) {
    console.error('[stripe/checkout] Start fehlgeschlagen:', err instanceof Error ? err.message : err)
    // Neutraler Fehlerzustand auf der Kontoseite (kein Crash, kein Fehlerton).
    redirect(await kontoUrl(locale, CHECKOUT_ERROR))
  }
  // Weiterleitung auf die von Stripe gehostete Checkout-Seite (K8). redirect() wirft NEXT_REDIRECT →
  // außerhalb des try/catch.
  redirect(checkoutUrl)
}

/**
 * Customer-Portal öffnen (Aufgabe 5b): Kündigung, Zahlungsmittel, Rechnungen — alles bei Stripe, nicht
 * selbst nachgebaut. Braucht eine im Stripe-Account konfigurierte Portal-Einstellung (einmalig per
 * API angelegt, s. DEPLOYMENT.md / Setup-Skript).
 */
export async function openBillingPortalAction(): Promise<void> {
  const locale = await getLocale()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirectToLocalized(ANMELDEN_HREF, locale)

  let portalUrl: string
  try {
    const service = createServiceRoleClient()
    const { data: customerId, error } = await service.rpc('get_stripe_customer_id', {
      p_user_id: user.id,
    })
    if (error) throw new Error(`get_stripe_customer_id: ${error.message}`)
    // Ohne Customer kein Portal — sollte bei aktivem Abo nie vorkommen (der Checkout verankert ihn).
    if (!customerId) throw new Error('Kein Stripe-Customer für diesen Nutzer')

    const session = await stripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: await kontoUrl(locale),
    })
    portalUrl = session.url
  } catch (err) {
    console.error('[stripe/portal] Start fehlgeschlagen:', err instanceof Error ? err.message : err)
    redirect(await kontoUrl(locale, CHECKOUT_ERROR))
  }
  redirect(portalUrl)
}
