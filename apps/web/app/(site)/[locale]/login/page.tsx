import { redirectToLocalized } from '@/lib/auth/server-helpers'
import { ANMELDEN_HREF } from '@/lib/auth/config'

/**
 * `/login` war bis T4-2 ein reiner `PagePlaceholder` (englischer Slug, noindex, seit Prompt 26
 * NICHT mehr im Header verlinkt). Mit T4-2 gibt es die echten DEUTSCHEN Auth-Routen — statt einen
 * zweiten Login-Einstieg zu doppeln, leitet `/login` dauerhaft auf `/anmelden` um. So bleibt
 * `LOGIN_HREF` (lib/nav.ts) gültig und ein evtl. noch kursierender `/login`-Link landet am echten
 * Login. (Bewusst NICHT gelöscht — gemeldet im Report unter (a).)
 */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  redirectToLocalized(ANMELDEN_HREF, locale)
}
