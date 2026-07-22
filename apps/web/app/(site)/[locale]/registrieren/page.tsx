import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { robotsFor } from '@/lib/routes'
import { KONTO_HREF, REGISTRIEREN_HREF, sanitizeNext } from '@/lib/auth/config'
import { redirectToLocalized } from '@/lib/auth/server-helpers'
import { createClient } from '@/lib/supabase/server'
import { AuthPageShell } from '@/components/auth/auth-page-shell'
import { RegisterForm } from '@/components/auth/register-form'

// Liest die Session (getUser) → dynamisch. noindex (J7): kein alternates (Canonical auf einer
// noindex-Seite wäre ein widersprüchliches Signal, s. lib/routes.ts).
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Konto' })
  return { title: `${t('register.metaTitle')} — COOLiN ENERGY`, robots: robotsFor(REGISTRIEREN_HREF) }
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ next?: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const { next: rawNext } = await searchParams
  /*
   * Rücksprungziel (B10-5), dieselbe Prüfung wie auf der Anmeldeseite: ausschliesslich
   * seiten-INTERNE Pfade (`sanitizeNext`, kein Open Redirect). LEERER Rückfallwert statt `/konto` —
   * „kein oder kein zulässiges Ziel" heisst hier „kein Ziel": daran hängt nicht nur eine
   * Weiterleitung, sondern auch die Herkunft des entstehenden Leads, und ein Ersatzwert behauptete
   * dort einen Trichter, aus dem die Person nicht kam.
   *
   * Die Prüfung steht VOR dem angemeldet-Zweig, weil beide Wege sie brauchen — wer schon angemeldet
   * ist, soll dorthin geschickt werden, wo er hinwollte, und nicht auf die Kontoseite.
   */
  const next = sanitizeNext(rawNext, '')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user) redirectToLocalized(next || KONTO_HREF, locale)

  const t = await getTranslations({ locale, namespace: 'Konto' })
  return (
    <AuthPageShell title={t('register.title')} lead={t('register.lead')}>
      <RegisterForm next={next || undefined} />
    </AuthPageShell>
  )
}
