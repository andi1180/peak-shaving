/**
 * Reine Stripe-Konstanten (T4-3). Kein `server-only`, keine Secrets, keine Stripe-SDK-Importe —
 * aus Server- UND Client-Kontext importierbar (die Kontoseite liest den Rückkehr-Parameter, der
 * Abo-Teaser rendert client-seitig). Der Stripe-CLIENT + die Secrets liegen getrennt in
 * `lib/stripe/server.ts` (`import 'server-only'`).
 */

/**
 * Rückkehr-Parameter der Stripe-Checkout-URLs (K10). Die success_url/cancel_url tragen
 * `?checkout=success` bzw. `?checkout=cancel`, damit die Kontoseite den Rückkehr-Zustand erkennt —
 * insbesondere den Wartezustand „Zahlung wird verarbeitet", falls der Webhook noch nicht eintraf.
 */
export const CHECKOUT_PARAM = 'checkout'
export const CHECKOUT_SUCCESS = 'success'
export const CHECKOUT_CANCEL = 'cancel'
/** Von den Server-Actions gesetzt, wenn der Checkout/Portal-Start selbst fehlschlug (neutraler Hinweis). */
export const CHECKOUT_ERROR = 'error'

export type CheckoutReturn =
  | typeof CHECKOUT_SUCCESS
  | typeof CHECKOUT_CANCEL
  | typeof CHECKOUT_ERROR

export function readCheckoutReturn(value: string | string[] | undefined): CheckoutReturn | null {
  const v = Array.isArray(value) ? value[0] : value
  if (v === CHECKOUT_SUCCESS || v === CHECKOUT_CANCEL || v === CHECKOUT_ERROR) return v
  return null
}
