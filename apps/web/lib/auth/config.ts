/**
 * Konstanten des Konto-/Auth-Bereichs (T4-2). Rein — kein `server-only`, keine Seiteneffekte,
 * aus Server- UND Client-Kontext importierbar.
 *
 * Deutsche Slugs innerhalb der bestehenden Struktur `app/(site)/[locale]/`, damit Shell, i18n und
 * Design ohne Sonderweg greifen. Produktübergreifend (Auth trägt Monitor UND künftig den
 * Kalkulator-Portalteil) — deshalb ein eigener Bereich, KEIN Monitor-Unterpfad.
 */
export const REGISTRIEREN_HREF = '/registrieren'
export const ANMELDEN_HREF = '/anmelden'
export const PASSWORT_VERGESSEN_HREF = '/passwort-vergessen'
export const PASSWORT_NEU_HREF = '/passwort-neu'
export const KONTO_HREF = '/konto'

/** Alle noindex-Auth-Routen (J7) — von lib/routes.ts konsumiert. */
export const AUTH_HREFS = [
  REGISTRIEREN_HREF,
  ANMELDEN_HREF,
  PASSWORT_VERGESSEN_HREF,
  PASSWORT_NEU_HREF,
  KONTO_HREF,
] as const

/**
 * Produkt, dessen Entitlement die Kontoseite anzeigt. Diese Session baut den Monitor; die
 * Kontoseite ist der Ende-zu-Ende-Beweis Session→Cookie→RPC→RLS. Wert = platform.product_key.
 */
export const ACCOUNT_PRODUCT = 'monitor' as const

/**
 * Name des Redirect-Parameters an `/anmelden` (B10-2). EINE Stelle, weil ihn ab jetzt VIER
 * Beteiligte teilen: die geschützte Route (setzt ihn), die Anmeldeseite (liest ihn), das
 * Anmeldeformular (reicht ihn als verstecktes Feld weiter) und `signInAction` (leitet danach
 * dorthin). Ein getippter String an vier Stellen wäre genau die Art Vertipper, die niemand
 * bemerkt: der Login funktionierte weiter, nur landete der Nutzer wieder auf `/konto` statt
 * dort, wo er hinwollte.
 */
export const NEXT_PARAM = 'next'

/**
 * Nur seiten-INTERNE Pfade als Redirect-Ziel zulassen (kein Open Redirect über `?next=`):
 * genau ein führender „/", kein „//host", kein „http://…".
 */
export function sanitizeNext(next: string | null | undefined, fallback: string = KONTO_HREF): string {
  if (!next) return fallback
  if (!next.startsWith('/') || next.startsWith('//')) return fallback
  return next
}
