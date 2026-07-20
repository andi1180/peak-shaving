'use server'

/**
 * Gutscheincode-Einlösung (Server Action). Der zweite, kostenlose Freischaltweg neben dem
 * Stripe-Checkout — beide enden in derselben platform.entitlements-Zeile, die Kontoseite kennt
 * danach keinen Unterschied.
 *
 * KEIN service_role hier (anders als beim Checkout-Start, der Zahlungs-Spiegel schreiben muss):
 * public.redeem_code ist authenticated-only und leitet die Identität aus auth.uid() ab. Ein
 * user_id-Parameter existiert nicht — es gibt also keinen Weg, ein fremdes Konto freizuschalten,
 * auch nicht durch einen Fehler in dieser Datei.
 */
import { revalidatePath } from 'next/cache'
import { getLocale } from 'next-intl/server'
import { getPathname } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/server'
import { KONTO_HREF } from '@/lib/auth/config'
import { redeemSchema, toRedeemFieldErrors, type RedeemState } from './schema'

/**
 * Status-Strings, die public.redeem_code zurückgeben kann. Jeder hat einen eigenen Nutzertext
 * (Konto.redeem.status.*) — der Nutzer soll wissen, OB der Code falsch war oder ob er nur schon
 * Zugang hat. Ein unbekannter Wert fällt auf 'generic' zurück, statt einen rohen DB-String zu zeigen.
 */
const KNOWN_STATUS = [
  'redeemed',
  'invalid_code',
  'expired',
  'exhausted',
  'already_redeemed',
  'already_active',
] as const

type RedeemStatus = (typeof KNOWN_STATUS)[number]

function isKnownStatus(value: unknown): value is RedeemStatus {
  return typeof value === 'string' && (KNOWN_STATUS as readonly string[]).includes(value)
}

export async function redeemCodeAction(
  _prev: RedeemState,
  formData: FormData,
): Promise<RedeemState> {
  const raw = formData.get('code')
  const parsed = redeemSchema.safeParse({ code: raw })
  if (!parsed.success) {
    return { fieldErrors: toRedeemFieldErrors(parsed.error.issues), code: String(raw ?? '') }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  // Die Kontoseite rendert das Formular nur für eingeloggte Nutzer; das ist die defensive
  // Rückfalllinie (z. B. Session zwischen Seitenaufbau und Absenden abgelaufen).
  if (!user) return { formError: 'notSignedIn', code: parsed.data.code }

  const { data, error } = await supabase.rpc('redeem_code', { p_code: parsed.data.code })
  if (error) {
    // Ein echter Infrastrukturfehler (nicht: ein abgelehnter Code — der kommt als Status zurück).
    console.error('[redeem] redeem_code:', error)
    return { formError: 'generic', code: parsed.data.code }
  }

  if (!isKnownStatus(data)) {
    console.error('[redeem] Unbekannter Status von redeem_code:', data)
    return { formError: 'generic', code: parsed.data.code }
  }

  if (data === 'redeemed') {
    // Die Kontoseite ist force-dynamic, liest den Zugang aber im selben Request-Zyklus wie das
    // Action-Ergebnis. revalidatePath stellt sicher, dass die Seite nach der Action mit dem NEUEN
    // Entitlement rendert — also sofort den „aktives Abo"-Zustand zeigt, ohne zweiten Klick.
    revalidatePath(getPathname({ href: KONTO_HREF, locale: await getLocale() }))
    return { status: 'redeemed' }
  }

  // Alle Ablehnungsgründe: sprechender Text, Eingabe bleibt stehen (der Nutzer will meist korrigieren).
  return { status: data, code: parsed.data.code }
}
