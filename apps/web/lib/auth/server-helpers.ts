/**
 * Server-seitige Auth-Helfer (T4-2). `import 'server-only'` — nutzt `headers()`.
 * Bewusst getrennt von actions.ts: eine `'use server'`-Datei darf nur async Server Actions
 * exportieren, keine Helfer.
 */
import 'server-only'
import { headers } from 'next/headers'
import { redirect as nextRedirect } from 'next/navigation'
import { getPathname } from '@/i18n/navigation'

/**
 * Locale-korrekter Server-Redirect als `never`-Ausdruck. `getPathname` liefert den lokalisierten
 * Pfad (as-needed: kein Präfix für die Default-Locale), `next/navigation.redirect` wirft
 * NEXT_REDIRECT und ist als `never` typisiert. Bewusst NICHT der isomorphe `redirect` aus
 * next-intl: der ist als `void` typisiert und verhinderte sowohl die Nicht-null-Verengung nach
 * `if (!user) …` als auch das Beenden einer Action, die ihren AuthState-Rückgabetyp erfüllen muss.
 */
export function redirectToLocalized(href: string, locale: string): never {
  nextRedirect(getPathname({ href, locale }))
}

/**
 * Origin des aktuellen Requests — Basis für `emailRedirectTo`/`redirectTo` der Auth-Mails.
 * Aus den Request-Headern (bei einem Formular-POST ist `origin` gesetzt), damit der Callback-Link
 * auf DENSELBEN Origin zeigt, unter dem der Nutzer gerade arbeitet (lokal localhost, in Prod die
 * echte Domain) — ohne eine Domain fest zu verdrahten.
 */
export async function getOrigin(): Promise<string> {
  const h = await headers()
  const origin = h.get('origin')
  if (origin) return origin
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? 'http'
  return `${proto}://${host}`
}

/** Callback-URL für die Auth-Mails: `${origin}/auth/callback?next=<intern>`. */
export async function callbackUrl(next: string): Promise<string> {
  const origin = await getOrigin()
  return `${origin}/auth/callback?next=${encodeURIComponent(next)}`
}
