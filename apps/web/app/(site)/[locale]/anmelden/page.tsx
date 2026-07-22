import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { robotsFor } from '@/lib/routes'
import { ANMELDEN_HREF, KONTO_HREF, sanitizeNext } from '@/lib/auth/config'
import { redirectToLocalized } from '@/lib/auth/server-helpers'
import { createClient } from '@/lib/supabase/server'
import { AuthPageShell } from '@/components/auth/auth-page-shell'
import { LoginForm } from '@/components/auth/login-form'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Konto' })
  return { title: `${t('login.metaTitle')} — COOLiN ENERGY`, robots: robotsFor(ANMELDEN_HREF) }
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ error?: string; next?: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const { error, next: rawNext } = await searchParams
  /*
   * B10-2: Ein Rücksprungziel darf ausschliesslich seiten-INTERN sein (`sanitizeNext`, kein Open
   * Redirect). Die Prüfung steht VOR dem angemeldet-Zweig, weil BEIDE Wege sie brauchen: der
   * bereits Angemeldete wird sofort dorthin geschickt, der noch nicht Angemeldete bekommt den
   * Wert als verstecktes Formularfeld mit. Ohne den ersten Fall liefe genau die Reihenfolge ins
   * Leere, die im Alltag am häufigsten vorkommt — Klick auf den Kalkulator, Login-Seite, „ach,
   * ich bin ja schon angemeldet", und dann `/konto` statt des Rechners.
   */
  const next = sanitizeNext(rawNext, KONTO_HREF)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user) redirectToLocalized(next, locale)

  const t = await getTranslations({ locale, namespace: 'Konto' })
  return (
    <AuthPageShell title={t('login.title')} lead={t('login.lead')}>
      {error === 'callback' && (
        <div role="alert" className="mb-4 rounded-md border border-negative bg-negative-subtle p-4">
          <p className="text-small font-semibold text-negative">{t('errors.callbackFailed')}</p>
        </div>
      )}
      {/* Nur weitergeben, wenn es wirklich ein abweichendes Ziel gibt — sonst stünde auf jeder
          gewöhnlichen Anmeldung ein verstecktes Feld mit dem Wert, der ohnehin der Default ist. */}
      <LoginForm next={next !== KONTO_HREF ? next : undefined} />
    </AuthPageShell>
  )
}
