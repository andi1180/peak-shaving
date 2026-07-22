import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { robotsFor } from '@/lib/routes'
import { Container, Eyebrow } from '@/components/ui/layout'
import { Button } from '@/components/ui/button'
import { Link } from '@/i18n/navigation'
import { ACCOUNT_PRODUCT, ANMELDEN_HREF, KONTO_HREF } from '@/lib/auth/config'
import { CALCULATOR_PRODUCT } from '@/lib/kalkulator/access'
import { CALCULATOR_RUN_HREF, KONTAKT_HREF } from '@/lib/nav'
import { signOutAction } from '@/lib/auth/actions'
import { RedeemCodeForm } from '@/components/redemption/redeem-code-form'
import { openBillingPortalAction } from '@/lib/stripe/actions'
import {
  CHECKOUT_CANCEL,
  CHECKOUT_ERROR,
  CHECKOUT_PARAM,
  CHECKOUT_SUCCESS,
  readCheckoutReturn,
} from '@/lib/stripe/config'
import { redirectToLocalized } from '@/lib/auth/server-helpers'
import { createClient } from '@/lib/supabase/server'

// J6: serverseitig geschützt, VOR dem Rendern. getUser() + searchParams → dynamisch. noindex (J7).
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

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('de-AT', {
    dateStyle: 'medium',
    timeZone: 'Europe/Vienna',
  }).format(new Date(iso))
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const sp = await searchParams
  const checkoutReturn = readCheckoutReturn(sp[CHECKOUT_PARAM])

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  // J6: ohne Session ein Server-Redirect, BEVOR Inhalt gerendert/ausgeliefert wird.
  if (!user) redirectToLocalized(ANMELDEN_HREF, locale)

  const t = await getTranslations({ locale, namespace: 'Konto' })

  // Der Ende-zu-Ende-Beweis: Session → Cookie → RPC-Wrapper → RLS. Die Zugangs-WAHRHEIT kommt aus
  // get_my_entitlement (K1, kennt kein Stripe); get_my_subscription liefert nur die Anzeige-DETAILS
  // (Gültigkeit, geplante Kündigung).
  const [entitlementRes, profileRes, subscriptionRes, calculatorRes] = await Promise.all([
    supabase.rpc('get_my_entitlement', { p_product: ACCOUNT_PRODUCT }),
    supabase.rpc('get_my_profile'),
    supabase.rpc('get_my_subscription', { p_product: ACCOUNT_PRODUCT }),
    // B10-2: DERSELBE Wrapper, anderes Produkt — der Kalkulator ist seit diesem Schritt ein
    // zweites Produkt mit eigenem Zugang. Ein Konto kann eines, beides oder keines davon haben
    // (`primary key (user_id, product)`); die Seite darf deshalb nicht länger so tun, als gäbe es
    // nur den Monitor.
    supabase.rpc('get_my_entitlement', { p_product: CALCULATOR_PRODUCT }),
  ])
  if (entitlementRes.error) console.error('[konto] get_my_entitlement:', entitlementRes.error)
  if (profileRes.error) console.error('[konto] get_my_profile:', profileRes.error)
  if (subscriptionRes.error) console.error('[konto] get_my_subscription:', subscriptionRes.error)
  if (calculatorRes.error) console.error('[konto] get_my_entitlement(calculator):', calculatorRes.error)

  const hasEntitlement = entitlementRes.data === true
  // Fail closed wie in `lib/kalkulator/access.ts`: ein Lesefehler ist keine Zusage. Die Anzeige
  // hier gewährt zwar keinen Zugang (das tut die Route), aber „aktiv" zu behaupten, wo die Route
  // gleich sperrt, wäre die verwirrendste aller Auskünfte.
  const hasCalculator = calculatorRes.data === true
  const subscription = subscriptionRes.data?.[0]
  const profile = profileRes.data?.[0]
  const displayName = profile?.display_name?.trim() || null
  const memberSince = profile?.created_at ?? user.created_at
  const memberSinceLabel = memberSince ? formatDate(memberSince) : '—'

  // K10: Rückkehr von einem erfolgreichen Checkout, aber der Webhook hat den Zugang noch nicht
  // gespiegelt → Wartezustand. NIEMALS „kein aktives Abo", NIEMALS optimistisch Zugang gewähren.
  const showWaiting = !hasEntitlement && checkoutReturn === CHECKOUT_SUCCESS

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

            {hasEntitlement ? (
              // Aufgabe 5b: aktives Abo — Status, Gültigkeit, Portal-Schaltfläche.
              <div className="mt-4">
                <p className="text-body font-semibold text-positive">
                  {t('account.subscriptionActive')}
                </p>
                {subscription?.current_period_end ? (
                  <p className="mt-1 text-small text-text-muted">
                    {subscription.cancel_at_period_end
                      ? t('account.cancelAtPeriodEnd', {
                          date: formatDate(subscription.current_period_end),
                        })
                      : t('account.validUntil', {
                          date: formatDate(subscription.current_period_end),
                        })}
                  </p>
                ) : null}
                {subscription ? (
                  // Kündigung/Zahlungsmittel/Rechnungen laufen im von Stripe gehosteten Portal (K8) —
                  // nicht selbst nachgebaut.
                  <form action={openBillingPortalAction} className="mt-4">
                    <Button type="submit" variant="secondary" size="md">
                      {t('account.manageSubscription')}
                    </Button>
                  </form>
                ) : null}
              </div>
            ) : showWaiting ? (
              // Aufgabe 5a / K10: Zahlung erfolgt, Webhook noch nicht eingetroffen → Wartezustand.
              <div className="mt-4 rounded-md border border-line bg-surface-sunken p-4">
                <p className="text-body font-semibold text-ink">{t('account.processingTitle')}</p>
                <p className="mt-1 text-small text-text-muted">{t('account.processingBody')}</p>
                <Link
                  href={KONTO_HREF}
                  className="mt-3 inline-block text-small font-medium text-accent underline underline-offset-4"
                >
                  {t('account.processingRefresh')}
                </Link>
              </div>
            ) : (
              // Kein aktives Abo. Das Monitor-Produkt (product_key='monitor') ist eingestellt
              // (Fahrplan 2026) → KEIN Kauf-Einstieg mehr, nur ein neutraler Hinweis ohne CTA.
              // Die T4-Infrastruktur (startCheckoutAction, Stripe-Preis-Config) bleibt für B9
              // unangetastet — hier ist NUR die UI-Aufrufstelle gekappt. Der Zugangscode-Einlöseweg
              // (RedeemCodeForm) bleibt als separater Freischaltweg bestehen.
              <div className="mt-4">
                {checkoutReturn === CHECKOUT_CANCEL ? (
                  <p className="mb-3 text-small text-text-muted">
                    {t('account.checkoutCancelled')}
                  </p>
                ) : checkoutReturn === CHECKOUT_ERROR ? (
                  <p className="mb-3 text-small text-warning">{t('account.checkoutError')}</p>
                ) : null}
                <p className="text-body font-semibold text-ink">{t('account.noSubscription')}</p>
                <p className="mt-1 text-small text-text-muted">{t('account.noSubscriptionHint')}</p>
              </div>
            )}
          </section>

          {/*
            * B10-2 — der Pro-Kalkulator als eigenes Produkt.
            *
            * Ohne diesen Abschnitt zeigte die Kontoseite jemandem, der gerade den Kalkulator
            * freigeschaltet hat, weiterhin ausschliesslich „Strom-Monitor — kein aktives Abo": eine
            * Auskunft, die für sich genommen stimmt und in der Summe „Sie haben nichts" bedeutet.
            *
            * Bewusst OHNE Kauf-Einstieg: für `calculator_pro` gibt es keinen Stripe-Preis (OP#1),
            * und ein Knopf ohne Preis wäre ein Versprechen, das die nächste Seite nicht einlöst.
            * Der Weg ohne Zugang ist derselbe wie auf der Route selbst — Anfrage oder Gutscheincode.
            */}
          <section className="rounded-lg border border-line bg-surface p-6">
            <h2 className="text-h4 text-ink">{t('account.calculatorTitle')}</h2>
            <p className="mt-1 text-small text-text-muted">{t('account.calculatorProductLabel')}</p>

            {hasCalculator ? (
              <div className="mt-4">
                <p className="text-body font-semibold text-positive">{t('account.calculatorActive')}</p>
                <Link
                  href={CALCULATOR_RUN_HREF}
                  className="mt-3 inline-block text-small font-medium text-accent underline underline-offset-4"
                >
                  {t('account.calculatorOpen')}
                </Link>
              </div>
            ) : (
              <div className="mt-4">
                <p className="text-body font-semibold text-ink">{t('account.calculatorInactive')}</p>
                <p className="mt-1 text-small text-text-muted">{t('account.calculatorInactiveHint')}</p>
                <Link
                  href={`${KONTAKT_HREF}?thema=peakShaving`}
                  className="mt-3 inline-block text-small font-medium text-accent underline underline-offset-4"
                >
                  {t('account.calculatorRequest')}
                </Link>
              </div>
            )}
          </section>

          {/*
            * Der Gutscheincode-Einlöseweg steht seit B10-2 als EIGENER Abschnitt, nicht mehr im
            * „kein Monitor-Abo"-Zweig darüber.
            *
            * Der Grund ist kein Layout-Geschmack: Ein Code kann seit diesem Schritt für ZWEI
            * Produkte ausgestellt werden (`CODE_PRODUCT_KEYS`). Im alten Zweig verschwand das
            * Formular, sobald jemand ein aktives Monitor-Abo hatte — genau dieser Kunde hätte
            * seinen Kalkulator-Code dann nirgends mehr einlösen können. Der Monitor-Zustand ist
            * kein zulässiges Kriterium für die Sichtbarkeit eines Formulars, das ein anderes
            * Produkt freischaltet.
            *
            * Ausgeblendet wird es nur, wenn BEIDE Produkte aktiv sind — dann könnte jede Eingabe
            * nur noch `already_active` ergeben, und ein Formular, das ausschliesslich scheitern
            * kann, ist eine Einladung zu einem Fehlschlag.
            *
            * GEMESSENE FOLGE, bewusst so gelassen: Schaltet die letzte fehlende Freischaltung
            * frei, verschwindet dieser Abschnitt durch seinen eigenen Erfolg — und mit ihm die
            * „Ihr Code wurde eingelöst"-Notiz. Anders als in B1-3 (wo ein verschwindender Knopf
            * die Bestätigung mitriss und repariert wurde) bleibt hier eine STÄRKERE Bestätigung
            * stehen: der Abschnitt des freigeschalteten Produkts wechselt sichtbar auf
            * „Freigeschaltet" bzw. „Aktives Abo" — und das dauerhaft, nicht nur für einen Render.
            * Fehlt danach noch ein Produkt, bleibt das Formular samt Notiz stehen (beide Fälle
            * gegen den Production-Build durchgespielt).
            */}
          {(!hasEntitlement || !hasCalculator) && (
            <section className="rounded-lg border border-line bg-surface p-6">
              <h2 className="text-h4 text-ink">{t('redeem.title')}</h2>
              <p className="mt-1 text-small text-text-muted">{t('redeem.intro')}</p>
              <RedeemCodeForm />
            </section>
          )}

          {/*
            * HIER STEHT BEWUSST KEIN LINK AUF /admin — und das ist eine Entscheidung, kein
            * Versehen. Ein solcher Link existierte kurzzeitig (isAdmin-geschützt) und wurde
            * absichtlich zurückgenommen: der Verwaltungsbereich soll vollständig unauffindbar
            * bleiben, auch für eingeloggte Admins. Sie merken sich die Adresse selbst.
            *
            * Konsequenz für künftige Arbeit: /konto darf `isCurrentUserAdmin()` gar nicht erst
            * aufrufen. Schon die Rollenabfrage wäre hier zwecklos — es gibt nichts, das von ihrer
            * Antwort abhängen dürfte.
            */}
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
