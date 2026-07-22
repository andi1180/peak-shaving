/**
 * Server-seitige Auth-Helfer (T4-2). `import 'server-only'` — nutzt `headers()`.
 * Bewusst getrennt von actions.ts: eine `'use server'`-Datei darf nur async Server Actions
 * exportieren, keine Helfer.
 */
import 'server-only'
import { headers } from 'next/headers'
import { redirect as nextRedirect } from 'next/navigation'
import { getPathname } from '@/i18n/navigation'
import { SITE_URL, HAS_CONFIGURED_SITE_URL } from '@/lib/site'

/**
 * Locale-korrekter Server-Redirect als `never`-Ausdruck. `getPathname` liefert den lokalisierten
 * Pfad (as-needed: kein Präfix für die Default-Locale), `next/navigation.redirect` wirft
 * NEXT_REDIRECT und ist als `never` typisiert. Bewusst NICHT der isomorphe `redirect` aus
 * next-intl: der ist als `void` typisiert und verhinderte sowohl die Nicht-null-Verengung nach
 * `if (!user) …` als auch das Beenden einer Action, die ihren AuthState-Rückgabetyp erfüllen muss.
 */
export function redirectToLocalized(
  href: string,
  locale: string,
  query?: Record<string, string>,
): never {
  /*
   * `query` (B10-2): Die geschützte Kalkulator-Route schickt einen nicht angemeldeten Besucher mit
   * `?next=<Zielroute>` zum Login. Der Query-Teil wird bewusst NICHT an `href` gehängt
   * („/anmelden?next=…"), sondern `getPathname` übergeben: `href` ist ein PFAD-Schlüssel, den
   * next-intl bei einer zweiten Sprache übersetzt und präfixt — ein angehängter Query-String liefe
   * in genau diese Auflösung mit hinein. Getrennt übergeben wird er erst NACH der Lokalisierung
   * angefügt und korrekt kodiert.
   */
  nextRedirect(query ? getPathname({ href: { pathname: href, query }, locale }) : getPathname({ href, locale }))
}

/**
 * Origin des aktuellen Requests aus den Headern (bei einem Formular-POST ist `origin` gesetzt).
 * NUR der Fallback für `redirectBaseUrl` unten (lokal/Preview) — bewusst NICHT exportiert, damit
 * es keine zweite, request-abhängige Basis-URL-Quelle neben `SITE_URL` gibt (s. `lib/site.ts`:
 * „es gibt bewusst keinen zweiten Ort, an dem eine Domain steht").
 */
async function getRequestOrigin(): Promise<string> {
  const h = await headers()
  const origin = h.get('origin')
  if (origin) return origin
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? 'http'
  return `${proto}://${host}`
}

/**
 * Die EINE Basis-URL für serverseitige Redirect-ZIELE: `emailRedirectTo`/`redirectTo` der
 * Auth-Mails (server-helpers) UND `success_url`/`cancel_url`/`return_url` von Stripe (lib/stripe).
 *
 * WARUM NICHT (WIE FRÜHER) DER REQUEST-ORIGIN: Der Origin-Header eines Formular-POST trägt den
 * Host, unter dem der Nutzer GERADE arbeitet — in Produktion je nach Einstieg die Apex- ODER die
 * www-Domain (coolin.at → 308 → www.coolin.at), dazu Preview-Hosts. Supabase akzeptiert
 * `emailRedirectTo`/`redirectTo` NUR, wenn die URL EXAKT in seiner Redirect-Allowlist steht, und
 * fällt sonst STILL auf die Site-URL-Wurzel zurück — der Bestätigungslink landet dann auf
 * „https://…/?code=…" (Startseite) statt „/auth/callback". Ein wechselnder Host lässt sich nicht
 * zuverlässig allowlisten.
 *
 * DESHALB: In Produktion die EINE konfigurierte, kanonische Basis-URL (`SITE_URL` — dieselbe
 * Quelle wie Canonicals/OG). Deterministisch und damit genau EINMAL allowlistbar. Lokal/in Preview
 * (kein `NEXT_PUBLIC_SITE_URL` gesetzt) weiter der echte Request-Origin, damit `localhost:<port>`
 * bzw. der Preview-Host stimmen.
 */
export async function redirectBaseUrl(): Promise<string> {
  if (HAS_CONFIGURED_SITE_URL) return SITE_URL
  return getRequestOrigin()
}

/** Callback-URL für die Auth-Mails: `${basis}/auth/callback?next=<intern>`. */
export async function callbackUrl(next: string): Promise<string> {
  const base = await redirectBaseUrl()
  return `${base}/auth/callback?next=${encodeURIComponent(next)}`
}
