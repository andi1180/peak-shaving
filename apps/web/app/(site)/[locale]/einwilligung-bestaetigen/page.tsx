import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { AuthPageShell } from '@/components/auth/auth-page-shell'
import { Button } from '@/components/ui/button'
import { confirmConsentAction } from '@/lib/leads/actions'
import { CONFIRM_TOKEN_PARAM, EINWILLIGUNG_BESTAETIGEN_HREF } from '@/lib/leads/config'
import { getPendingConsentByToken, type PendingConsentOutcome } from '@/lib/leads/store'
import { hashConfirmationToken } from '@/lib/leads/tokens'
import { robotsFor } from '@/lib/routes'

/**
 * `/einwilligung-bestaetigen?token=…` — die Bestätigungsseite des Double-Opt-in (B1-2).
 *
 * ── DER GET ZEIGT NUR AN. BESTÄTIGT WIRD PER SERVER ACTION (POST). ───────────────────────────────
 * Das ist keine Stilfrage. Mailscanner in Unternehmen (Microsoft Defender, Proofpoint & Co.) rufen
 * Links in eingehenden Mails VORAB ab, bevor der Mensch sie sieht. Bestätigte ein GET die
 * Einwilligung, entstünden Einwilligungen, die niemand erteilt hat — und der Nachweis wäre entwertet:
 * er belegte dann nur noch, dass ein Virenscanner eine URL geöffnet hat. Deshalb liest diese Seite
 * ausschliesslich (`get_pending_consent_by_token` ist STABLE und schreibt NICHTS, auch kein
 * „abgelaufen"-Nachtragen), und erst die Schaltfläche löst die Wirkung aus.
 *
 * Dynamisch (liest die Datenbank je Aufruf) und `noindex` wie die Auth-Routen: eine persönliche
 * Einmal-Adresse aus einer E-Mail ist kein Seiteninhalt.
 */
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Leads.confirm' })
  return {
    title: `${t('metaTitle')} — COOLiN ENERGY`,
    robots: robotsFor(EINWILLIGUNG_BESTAETIGEN_HREF),
  }
}

/**
 * Der angezeigte Zustand. `error` ist NICHT dasselbe wie `not_found`: „wir konnten gerade nicht
 * nachsehen" darf sich nicht als „diesen Link gibt es nicht" lesen — sonst würde ein
 * Konfigurations-/Netzfehler eine gültige Einwilligung als ungültig darstellen und die Person
 * bekäme nie eine zweite Chance.
 */
type ViewState = PendingConsentOutcome | 'error'

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const query = await searchParams
  const raw = query[CONFIRM_TOKEN_PARAM]
  const token = typeof raw === 'string' ? raw.trim() : ''

  let state: ViewState = 'not_found'
  let consentText: string | null = null

  if (token) {
    try {
      // Nur der HASH erreicht die Datenbank. Der Klartext-Token steht in der Mail und in dieser URL,
      // nie im Bestand (B1-1: ein DB-Leck darf keine bestätigbaren Tokens enthalten).
      const view = await getPendingConsentByToken(hashConfirmationToken(token))
      state = view.outcome
      consentText = view.body
    } catch (cause) {
      console.error('[leads] Bestätigungsseite konnte den Stand nicht lesen:', cause)
      state = 'error'
    }
  }

  const t = await getTranslations({ locale, namespace: 'Leads.confirm' })

  return (
    <AuthPageShell title={t(`${state}.title`)} lead={t(`${state}.lead`)}>
      {state === 'valid' ? (
        <form action={confirmConsentAction} className="space-y-6">
          {/* Der Token reist als verstecktes Feld mit — die Action bekommt ihn dadurch im POST,
              nicht aus der URL des GET, den ein Scanner ausgelöst haben könnte. */}
          <input type="hidden" name={CONFIRM_TOKEN_PARAM} value={token} />

          {consentText && (
            <blockquote className="border-l-2 border-accent-border bg-surface-alt p-4 text-small text-text">
              {consentText}
            </blockquote>
          )}

          <Button type="submit" variant="primary" size="lg" className="w-full">
            {t('valid.submit')}
          </Button>
        </form>
      ) : (
        /*
         * Alle übrigen Zustände sind Endzustände ohne Handlung: abgelaufen (mit dem Hinweis, die
         * Einwilligung neu anzufordern — es gibt bewusst KEINEN automatischen Neuversand, der wäre
         * eine unangeforderte Mail an eine unbestätigte Adresse), unbekannt, bereits bestätigt,
         * und der technische Fehlerzustand.
         */
        <p className="text-small text-text-muted">{t(`${state}.note`)}</p>
      )}
    </AuthPageShell>
  )
}
