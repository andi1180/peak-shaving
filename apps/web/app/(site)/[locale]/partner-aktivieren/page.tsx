import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { AuthPageShell } from '@/components/auth/auth-page-shell'
import { PartnerActivationForm } from '@/components/partner-portal/partner-activation-form'
import { ACTIVATION_TOKEN_PARAM, PARTNER_AKTIVIEREN_HREF } from '@/lib/partner-portal/config'
import { robotsFor } from '@/lib/routes'

/**
 * `/partner-aktivieren?token=…` — der Klick, der einen Partnerzugang scharf schaltet (B18-2a).
 *
 * ── DER GET ZEIGT NUR AN. FREIGESCHALTET WIRD PER SERVER ACTION (POST). ─────────────────────────
 * Keine Stilfrage, sondern die Antwort auf eine gemessene Eigenschaft: Ein Aktivierungstoken ist
 * EINMALIG einlösbar (zweite Verwendung → HTTP 403 `otp_expired`), und Mailscanner in Unternehmen
 * — bei der Zielgruppe dieser Mail der Regelfall — rufen Links in eingehenden Mails vorab ab.
 * Wirkte der GET, verbrauchte der Scanner den Token, bevor der Mensch ihn sieht; der Fachbetrieb
 * bekäme „Link ungültig" und käme ohne Rückfrage nicht mehr in sein Portal. Dieselbe Bauform und
 * dieselbe Begründung wie bei `/einwilligung-bestaetigen` (B1-2).
 *
 * Diese Seite ruft deshalb GAR NICHTS auf: Sie prüft den Token nicht einmal auf Gültigkeit (das
 * wäre bei GoTrue ohnehin nicht ohne Einlösen möglich) und liest weder Datenbank noch Sitzung. Sie
 * reicht den Wert nur an ein Formular weiter.
 *
 * ── SIE LIEGT AUF DEM PORTAL-HOST, UND DAS IST BINDEND ──────────────────────────────────────────
 * Der Link aus der Freischaltungsmail zeigt in Produktion auf `partner.coolin.at`. Die Aktivierung
 * setzt die Auth-Cookies, und die sind HOST-gebunden: Liefe die Seite auf der Hauptdomain, entstünde
 * die Sitzung dort, und der Fachbetrieb wäre auf seiner eigenen Subdomain weiterhin abgemeldet.
 * Der Pfad steht deshalb in `PORTAL_HOST_PATHS` (`lib/portal-host.ts`) und fällt nicht unter die
 * 308-Weiche. Auf `coolin.at` bleibt er trotzdem erreichbar — das Ziel nach dem Klick ist dann
 * `/partner-portal` statt `/` (s. `activation-actions.ts`).
 *
 * `force-dynamic` und `noindex` aus demselben Grund wie bei den Auth- und Lead-Routen: Eine
 * persönliche Einmal-Adresse aus einer E-Mail ist kein Seiteninhalt, und ihr Query trägt einen
 * einlösbaren Token.
 */
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'PartnerActivation' })
  return {
    title: `${t('metaTitle')} — COOLiN ENERGY`,
    robots: robotsFor(PARTNER_AKTIVIEREN_HREF),
  }
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
  const raw = query[ACTIVATION_TOKEN_PARAM]
  const token = typeof raw === 'string' ? raw.trim() : ''

  const t = await getTranslations({ locale, namespace: 'PartnerActivation' })

  /*
   * Ohne Token gibt es nichts freizuschalten. Der Zustand bekommt einen eigenen Text statt eines
   * Formulars mit leerem Feld: Ein Knopf, der garantiert scheitert, ist eine Sackgasse mit
   * Umweg — und die häufigste Ursache (ein beim Kopieren abgeschnittener Link) lässt sich nur
   * beheben, wenn sie benannt wird.
   */
  if (!token) {
    return (
      <AuthPageShell title={t('missing.title')} lead={t('missing.lead')}>
        <p className="text-small text-text-muted">{t('missing.note')}</p>
      </AuthPageShell>
    )
  }

  return (
    <AuthPageShell title={t('title')} lead={t('lead')}>
      <div className="flex flex-col gap-5">
        <PartnerActivationForm token={token} />
        <p className="text-caption text-text-muted">{t('note')}</p>
      </div>
    </AuthPageShell>
  )
}
