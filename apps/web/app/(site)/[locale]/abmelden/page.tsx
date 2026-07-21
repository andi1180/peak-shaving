import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { AuthPageShell } from '@/components/auth/auth-page-shell'
import { Button } from '@/components/ui/button'
import { suppressAllAction, withdrawPurposeAction } from '@/lib/leads/actions'
import {
  ABMELDEN_HREF,
  LEAD_STATUS_PARAM,
  UNSUBSCRIBE_PARAM,
  UNSUBSCRIBE_STATUS,
  isConsentPurpose,
} from '@/lib/leads/config'
import { verifyUnsubscribeToken } from '@/lib/leads/tokens'
import { robotsFor } from '@/lib/routes'

/**
 * `/abmelden?l=…&p=…&s=…` — die Menschenseite der Abmeldung (B1-2).
 *
 * ── ZWEI MÖGLICHKEITEN, BEWUSST UNTERSCHIEDLICH GEWICHTET ────────────────────────────────────────
 *  1. „Von diesen E-Mails abmelden" — widerruft NUR den Zweck aus dem Link. Das ist der Regelfall
 *     und deshalb die Hauptschaltfläche: wer den Newsletter nicht mehr will, will nicht zwangsläufig
 *     auch keine Erinnerung an sein Vertragsende (B1-1: getrennte Zwecke, getrennte Einwilligungen).
 *  2. „Keine E-Mails mehr von COOLiN" — widerruft ALLES und sperrt die Adresse dauerhaft. Deutlich
 *     abgesetzt, weil es die weitreichendere und praktisch unumkehrbare Entscheidung ist: der
 *     Sperrlisten-Eintrag überlebt sogar die Löschung des Leads (B1-1).
 *
 * ── KEINE AUSKUNFT DARÜBER, OB DIE ADRESSE BEKANNT IST ───────────────────────────────────────────
 * Bei ungültiger Signatur erscheint eine neutrale Seite — kein „Lead nicht gefunden", keine
 * E-Mail-Adresse, kein Zweckname. Die Signatur ist der einzige Beweis, dass der Aufrufer den Link
 * aus einer echten Mail hat; wer sie nicht hat, bekommt kein Orakel, mit dem sich Adressen oder
 * Lead-IDs abklopfen liessen. Die Seite zeigt aus demselben Grund NIRGENDS die Adresse an.
 *
 * ── WIRKUNG NUR PER POST ─────────────────────────────────────────────────────────────────────────
 * Beide Möglichkeiten sind Server-Actions. Dieselbe Begründung wie bei der Bestätigungsseite:
 * Mailscanner rufen Links vorab ab, und eine per GET ausgelöste Abmeldung wäre eine Abmeldung, die
 * niemand veranlasst hat. Der EINE erlaubte Ausnahmefall ist RFC 8058 (One-Click) — der läuft
 * ebenfalls per POST, nur ohne Rückfrage, über `app/api/abmelden/route.ts`.
 */
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Leads.unsubscribe' })
  return { title: `${t('metaTitle')} — COOLiN ENERGY`, robots: robotsFor(ABMELDEN_HREF) }
}

function param(query: { [key: string]: string | string[] | undefined }, name: string): string {
  const value = query[name]
  return typeof value === 'string' ? value.trim() : ''
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

  const query = await searchParams
  const leadId = param(query, UNSUBSCRIBE_PARAM.lead)
  const purpose = param(query, UNSUBSCRIBE_PARAM.purpose)
  const signature = param(query, UNSUBSCRIBE_PARAM.signature)
  const status = param(query, LEAD_STATUS_PARAM)

  const t = await getTranslations({ locale, namespace: 'Leads.unsubscribe' })

  /*
   * Die Signaturprüfung braucht das Server-Geheimnis (require-on-use). Fehlt es, ist die Antwort
   * dieselbe neutrale Seite — ein Konfigurationsfehler darf hier keine Stacktrace-Seite zeigen und
   * erst recht nichts über die Adresse verraten.
   */
  let signatureValid = false
  if (leadId && isConsentPurpose(purpose)) {
    try {
      signatureValid = verifyUnsubscribeToken(leadId, purpose, signature)
    } catch (cause) {
      console.error('[leads] Abmeldeseite konnte die Signatur nicht prüfen:', cause)
    }
  }

  if (!signatureValid) {
    return (
      <AuthPageShell title={t('invalid.title')} lead={t('invalid.lead')}>
        <p className="text-small text-text-muted">{t('invalid.note')}</p>
      </AuthPageShell>
    )
  }

  if (status === UNSUBSCRIBE_STATUS.purpose || status === UNSUBSCRIBE_STATUS.all) {
    const key = status === UNSUBSCRIBE_STATUS.all ? 'doneAll' : 'donePurpose'
    return (
      <AuthPageShell title={t(`${key}.title`)} lead={t(`${key}.lead`)}>
        <p className="text-small text-text-muted">{t(`${key}.note`)}</p>
      </AuthPageShell>
    )
  }

  /* Die drei signierten Werte reisen in beiden Formularen mit — die Action prüft sie erneut. */
  const hidden = (
    <>
      <input type="hidden" name={UNSUBSCRIBE_PARAM.lead} value={leadId} />
      <input type="hidden" name={UNSUBSCRIBE_PARAM.purpose} value={purpose} />
      <input type="hidden" name={UNSUBSCRIBE_PARAM.signature} value={signature} />
    </>
  )

  return (
    <AuthPageShell title={t('title')} lead={t('lead')}>
      <div className="space-y-8">
        <form action={withdrawPurposeAction} className="space-y-3">
          {hidden}
          <Button type="submit" variant="primary" size="lg" className="w-full">
            {t('purpose.submit')}
          </Button>
          <p className="text-caption text-text-muted">{t('purpose.note')}</p>
        </form>

        {/* Deutlich abgesetzt: andere Tragweite, nicht dieselbe Schaltfläche in anderer Farbe. */}
        <form action={suppressAllAction} className="space-y-3 border-t border-line pt-8">
          <Button type="submit" variant="secondary" size="lg" className="w-full">
            {t('all.submit')}
          </Button>
          <p className="text-caption text-text-muted">{t('all.note')}</p>
        </form>
      </div>
    </AuthPageShell>
  )
}
