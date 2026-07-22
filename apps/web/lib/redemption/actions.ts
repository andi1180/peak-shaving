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
import { KONTO_HREF, NEXT_PARAM, sanitizeNext } from '@/lib/auth/config'
import { redirectToLocalized } from '@/lib/auth/server-helpers'
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

  /*
   * Rücksprungziel (B10-4). Das Formular steht seit diesem Schritt an ZWEI Orten: auf `/konto`
   * (ohne Ziel — dort bleibt der Nutzer) und auf der Anfrage-Seite des Pro-Kalkulators (mit Ziel —
   * dorthin wollte er, bevor ihn die Zugangsprüfung angehalten hat).
   *
   * Der Wert kommt aus einem versteckten Formularfeld und ist im Browser frei änderbar. Er läuft
   * deshalb durch `sanitizeNext` — dieselbe Funktion, die schon das `?next=` des Logins absichert
   * (B10-2), und aus demselben Grund: ohne die Prüfung wäre die Einlösung ein Open Redirect
   * (`https://…` als Ziel, der Nutzer löst bei UNS ein und landet auf einer fremden Seite, die er
   * für unsere hält).
   *
   * `sanitizeNext` bekommt hier einen LEEREN Rückfallwert statt des üblichen `/konto`: „kein oder
   * kein zulässiges Ziel" heisst an dieser Stelle „gar nicht weiterleiten", nicht „nach /konto".
   * Mit dem Vorgabewert schickte ein manipuliertes Feld die Kontoseite auf sich selbst um, statt
   * die Einlösung an Ort und Stelle zu bestätigen.
   */
  const rawRedirect = formData.get(NEXT_PARAM)?.toString()
  const redirectTo = rawRedirect ? sanitizeNext(rawRedirect, '') : ''

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
    const locale = await getLocale()

    // Die Kontoseite ist force-dynamic, liest den Zugang aber im selben Request-Zyklus wie das
    // Action-Ergebnis. revalidatePath stellt sicher, dass die Seite nach der Action mit dem NEUEN
    // Entitlement rendert — also sofort den „aktives Abo"-Zustand zeigt, ohne zweiten Klick.
    // Das gilt AUCH, wenn gleich weitergeleitet wird: sonst zeigte ein späterer Aufruf von /konto
    // aus dem Router-Cache noch „Nicht freigeschaltet" für ein Produkt, das gerade freigeschaltet
    // wurde.
    revalidatePath(getPathname({ href: KONTO_HREF, locale }))

    /*
     * Wer von der Kalkulator-Route kommt, wollte in den RECHNER — nicht auf eine Erfolgsmeldung mit
     * einem weiteren Klick davor. Ein echter Server-Redirect (wirft NEXT_REDIRECT), funktioniert
     * also auch ohne JavaScript.
     *
     * WICHTIG, weil es wie eine Zugangsentscheidung aussieht und keine ist: Diese Weiterleitung
     * gewährt NICHTS. Die Zielroute prüft das Entitlement frisch (`getCalculatorAccess`,
     * force-dynamic) und entscheidet erneut. Ein Code für ein ANDERES Produkt (`monitor`) wird von
     * `public.redeem_code` korrekt eingelöst, meldet hier `redeemed` — und die Zielroute zeigt
     * trotzdem weiter die Anfrage-Seite. Die Produkt-Isolation liegt unverändert bei der Datenbank
     * und der Zugangsprüfung der Route, nicht bei dieser Zeile.
     */
    if (redirectTo) redirectToLocalized(redirectTo, locale)

    return { status: 'redeemed' }
  }

  // Alle Ablehnungsgründe: sprechender Text, Eingabe bleibt stehen (der Nutzer will meist korrigieren).
  return { status: data, code: parsed.data.code }
}
