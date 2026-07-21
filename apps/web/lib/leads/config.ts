/**
 * Konstanten des Lead-/Einwilligungspfads (B1-2). Rein — kein `server-only`, keine Seiteneffekte,
 * aus Server- UND Client-Kontext importierbar (Muster wie `lib/auth/config.ts`).
 *
 * Deutsche Slugs innerhalb der bestehenden Struktur `app/(site)/[locale]/`, wie `/registrieren` und
 * `/anmelden` — Shell, i18n und Design greifen dadurch ohne Sonderweg.
 */

import type { Database } from '@/db-types'

/** Zweck einer Einwilligung — 1:1 das DB-Enum `platform.consent_purpose` (B1-1). */
export type ConsentPurpose = Database['platform']['Enums']['consent_purpose']

/** Bestätigungsseite des Double-Opt-in. Der Klartext-Token steht in `?token=…`. */
export const EINWILLIGUNG_BESTAETIGEN_HREF = '/einwilligung-bestaetigen'

/** Abmeldeseite. Signierte Nutzlast in `?l=<leadId>&p=<purpose>&s=<signatur>`. */
export const ABMELDEN_HREF = '/abmelden'

/**
 * Alle noindex-Lead-Routen — von `lib/routes.ts` konsumiert, exakt wie `AUTH_HREFS`.
 * Suchmaschinen haben auf einer Bestätigungs- oder Abmeldeseite nichts zu suchen: beide sind
 * persönliche Einmal-Adressen aus einer E-Mail, keine Inhalte.
 */
export const LEAD_HREFS = [EINWILLIGUNG_BESTAETIGEN_HREF, ABMELDEN_HREF] as const

/**
 * Der RFC-8058-Endpunkt für One-Click-Unsubscribe. Liegt bewusst unter `/api`, weil der
 * Middleware-Matcher das ausschliesst (`middleware.ts`): ein Locale-Redirect würde den POST
 * zerstören (in T4-3 am Stripe-Webhook verifiziert).
 */
export const ABMELDEN_API_PATH = '/api/abmelden'

/**
 * Query-Parameter des Abmeldelinks. Kurz, weil sie in JEDER Aussendung in JEDER Fusszeile stehen —
 * und weil ein langer Link in Mail-Clients umgebrochen und dadurch unklickbar wird.
 */
export const UNSUBSCRIBE_PARAM = {
  lead: 'l',
  purpose: 'p',
  signature: 's',
} as const

/** Query-Parameter des Bestätigungslinks (Klartext-Token). */
export const CONFIRM_TOKEN_PARAM = 'token'

/**
 * Rückmelde-Parameter der beiden Seiten. Die Server Actions leiten nach getaner Arbeit auf dieselbe
 * URL mit diesem Parameter zurück — die Seite liest ihren Zustand danach wieder frisch aus der
 * Datenbank, statt einen zweiten Zustand im Client zu halten.
 */
export const LEAD_STATUS_PARAM = 'status'

/** Erlaubte Werte von `?status=` auf `/abmelden`. Alles andere wird ignoriert (kein freier Text). */
export const UNSUBSCRIBE_STATUS = {
  purpose: 'abgemeldet',
  all: 'gesperrt',
} as const

/**
 * Einstiegspunkte (`platform.lead_sources.key`), die dieser Bauabschnitt benutzt. Die Tabelle kennt
 * mehr (B1-1 seedet fünf) — hier stehen nur die, für die es CODE gibt. B3 baut die
 * Erfassungskomponente mit den weiteren Einstiegspunkten.
 */
export const LEAD_SOURCE_KONTAKTFORMULAR = 'kontaktformular'

/** Menschenlesbare Bezeichnung eines Zwecks — für Logs, nicht für die Oberfläche. */
export function isConsentPurpose(value: unknown): value is ConsentPurpose {
  return (
    value === 'marketing_email' ||
    value === 'contract_expiry_reminder' ||
    value === 'result_delivery'
  )
}
