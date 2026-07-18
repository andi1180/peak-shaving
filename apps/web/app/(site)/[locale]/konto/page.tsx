import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { robotsFor } from '@/lib/routes'
import { Container, Eyebrow } from '@/components/ui/layout'
import { Button } from '@/components/ui/button'
import { ACCOUNT_PRODUCT, ANMELDEN_HREF, KONTO_HREF } from '@/lib/auth/config'
import { signOutAction } from '@/lib/auth/actions'
import { redirectToLocalized } from '@/lib/auth/server-helpers'
import { createClient } from '@/lib/supabase/server'

// J6: serverseitig geschützt, VOR dem Rendern. getUser() → dynamisch. noindex (J7).
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Konto' })
  return { title: `${t('account.metaTitle')} — COOLiN ENERGY`, robots: robotsFor(KONTO_HREF) }
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  // J6: ohne Session ein Server-Redirect, BEVOR Inhalt gerendert/ausgeliefert wird.
  if (!user) redirectToLocalized(ANMELDEN_HREF, locale)

  const t = await getTranslations({ locale, namespace: 'Konto' })

  // Der Ende-zu-Ende-Beweis: Session → Cookie → RPC-Wrapper → RLS. Nur die public-RPC-Wrapper —
  // KEIN Stripe, KEINE subscriptions-Tabelle (J8). Ohne T4-3 ist „kein aktives Abo" für JEDEN
  // Nutzer der korrekte Wahrheitswert, kein Fehler.
  const [entitlementRes, profileRes] = await Promise.all([
    supabase.rpc('get_my_entitlement', { p_product: ACCOUNT_PRODUCT }),
    supabase.rpc('get_my_profile'),
  ])
  if (entitlementRes.error) console.error('[konto] get_my_entitlement:', entitlementRes.error)
  if (profileRes.error) console.error('[konto] get_my_profile:', profileRes.error)

  const hasEntitlement = entitlementRes.data === true
  const profile = profileRes.data?.[0]
  const displayName = profile?.display_name?.trim() || null
  const memberSince = profile?.created_at ?? user.created_at
  const memberSinceLabel = memberSince
    ? new Intl.DateTimeFormat('de-AT', { dateStyle: 'medium', timeZone: 'Europe/Vienna' }).format(
        new Date(memberSince),
      )
    : '—'

  return (
    <Container className="py-16 sm:py-24">
      <div className="mx-auto w-full max-w-lg">
        <Eyebrow>{t('account.eyebrow')}</Eyebrow>
        <h1 className="mt-2 text-h2 text-ink">{t('account.title')}</h1>

        <div className="mt-8 flex flex-col gap-4">
          <section className="rounded-lg border border-line bg-surface p-6">
            <dl className="flex flex-col gap-4">
              <div>
                <dt className="text-small text-text-muted">{t('account.emailLabel')}</dt>
                <dd className="mt-0.5 break-words font-medium text-ink">{user.email}</dd>
              </div>
              {displayName && (
                <div>
                  <dt className="text-small text-text-muted">{t('account.displayNameLabel')}</dt>
                  <dd className="mt-0.5 break-words font-medium text-ink">{displayName}</dd>
                </div>
              )}
              <div>
                <dt className="text-small text-text-muted">{t('account.memberSince')}</dt>
                <dd className="mt-0.5 tabular-nums text-ink">{memberSinceLabel}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-lg border border-line bg-surface p-6">
            <h2 className="text-h4 text-ink">{t('account.subscriptionTitle')}</h2>
            <p className="mt-1 text-small text-text-muted">{t('account.monitorProductLabel')}</p>
            <p className="mt-4 text-body font-semibold text-ink">
              {hasEntitlement ? t('account.subscriptionActive') : t('account.noSubscription')}
            </p>
            <p className="mt-2 text-small text-text-muted">{t('account.subscriptionHint')}</p>
          </section>

          <form action={signOutAction}>
            <Button type="submit" variant="secondary" size="md">
              {t('account.logout')}
            </Button>
          </form>
        </div>
      </div>
    </Container>
  )
}
