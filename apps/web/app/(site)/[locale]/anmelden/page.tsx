import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { robotsFor } from '@/lib/routes'
import { ANMELDEN_HREF, KONTO_HREF } from '@/lib/auth/config'
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
  searchParams: Promise<{ error?: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user) redirectToLocalized(KONTO_HREF, locale)

  const { error } = await searchParams
  const t = await getTranslations({ locale, namespace: 'Konto' })
  return (
    <AuthPageShell title={t('login.title')} lead={t('login.lead')}>
      {error === 'callback' && (
        <div role="alert" className="mb-4 rounded-md border border-negative bg-negative-subtle p-4">
          <p className="text-small font-semibold text-negative">{t('errors.callbackFailed')}</p>
        </div>
      )}
      <LoginForm />
    </AuthPageShell>
  )
}
