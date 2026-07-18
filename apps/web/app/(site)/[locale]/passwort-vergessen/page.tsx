import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { robotsFor } from '@/lib/routes'
import { PASSWORT_VERGESSEN_HREF } from '@/lib/auth/config'
import { AuthPageShell } from '@/components/auth/auth-page-shell'
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form'

// Keine Session-Abhängigkeit → statisch renderbar. noindex (J7).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Konto' })
  return {
    title: `${t('forgotPassword.metaTitle')} — COOLiN ENERGY`,
    robots: robotsFor(PASSWORT_VERGESSEN_HREF),
  }
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'Konto' })
  return (
    <AuthPageShell title={t('forgotPassword.title')} lead={t('forgotPassword.lead')}>
      <ForgotPasswordForm />
    </AuthPageShell>
  )
}
