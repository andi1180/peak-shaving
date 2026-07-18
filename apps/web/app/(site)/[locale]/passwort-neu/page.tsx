import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { robotsFor } from '@/lib/routes'
import { ANMELDEN_HREF, PASSWORT_NEU_HREF } from '@/lib/auth/config'
import { redirectToLocalized } from '@/lib/auth/server-helpers'
import { createClient } from '@/lib/supabase/server'
import { AuthPageShell } from '@/components/auth/auth-page-shell'
import { NewPasswordForm } from '@/components/auth/new-password-form'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Konto' })
  return { title: `${t('newPassword.metaTitle')} — COOLiN ENERGY`, robots: robotsFor(PASSWORT_NEU_HREF) }
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  // Ohne (Recovery-)Session, die der Callback nach dem Reset-Link setzt, gibt es hier nichts zu
  // tun → zurück zum Login. Server-seitiger Redirect VOR jedem Rendern (kein Aufblitzen).
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirectToLocalized(ANMELDEN_HREF, locale)

  const t = await getTranslations({ locale, namespace: 'Konto' })
  return (
    <AuthPageShell title={t('newPassword.title')} lead={t('newPassword.lead')}>
      <NewPasswordForm />
    </AuthPageShell>
  )
}
