import { useTranslations } from 'next-intl'
import { Container, Eyebrow } from '@/components/ui/layout'
import { Link } from '@/i18n/navigation'
import { KONTO_HREF } from '@/lib/auth/config'
import { PARTNER_BEWERBUNG_HREF } from '@/lib/partner-application/config'
import type { PortalState } from '@/lib/partner-portal/portal'
import { PartnerMarketingContent } from './partner-marketing-content'

/**
 * Das Partner-Portal `/partner-portal` (B16-4b) — die Fassung mit dem ÖFFENTLICHEN Website-Rahmen.
 *
 * Ein Fachbetrieb, der freigeschaltet ist, findet hier zwei Dinge: seinen persönlichen
 * Empfehlungslink und Textvorlagen, mit denen er seine Bestandskunden anschreiben kann. Mehr nicht —
 * und das „mehr nicht" ist der Entwurf, nicht eine Auslassung (s. `PartnerMarketingContent`).
 *
 * ── WAS B18-3 HIER GEÄNDERT HAT — UND WAS AUSDRÜCKLICH NICHT ────────────────────────────────────
 * Der Inhalt des Portal-Zustands ist nach `partner-marketing-content.tsx` gewandert, weil ihn seit
 * B18-3 zwei Rahmen zeigen. Diese Route bleibt sonst UNVERÄNDERT: derselbe öffentliche Header,
 * dieselben drei Zustände, dieselben Texte. Sie wird erst gelöscht, wenn der Portalbereich auf
 * `partner.coolin.at` vollständig migriert ist.
 *
 * SERVER-KOMPONENTE: `'use client'` ist nur das Kopierfeld (`CopyBlock`).
 */
export function PartnerPortalPage({
  state,
  /** Der VOLLSTÄNDIGE Empfehlungslink (`absoluteUrl`), nicht nur der Kurz-Key. */
  referralUrl,
}: {
  state: PortalState
  referralUrl: string | null
}) {
  const t = useTranslations('PartnerPortal')

  /*
   * „Konnte nicht geladen werden" ist AUSDRÜCKLICH nicht dasselbe wie „kein Partnerzugang" — sonst
   * schickte ein Datenbankausfall einen echten Fachbetrieb auf das Bewerbungsformular und legte ihm
   * nahe, sich ein zweites Mal zu bewerben.
   */
  if (state.state === 'error') {
    return (
      <Container className="py-16 sm:py-24">
        <div className="mx-auto w-full max-w-lg">
          <Eyebrow>{t('eyebrow')}</Eyebrow>
          <h1 className="mt-2 text-h2 text-ink">{t('error.title')}</h1>
          <p className="mt-4 text-body text-text">{t('error.body')}</p>
        </div>
      </Container>
    )
  }

  /*
   * Der Erklärzustand. Er ist der NORMALFALL für jedes Konto dieser Plattform (Monitor- und
   * Kalkulator-Kunden haben keine Partnerzeile) und darf deshalb weder wie ein Fehler aussehen noch
   * ins Leere umleiten. Ein stillgelegter Betrieb landet ebenfalls hier: `public.get_my_partner`
   * gibt ihn nicht heraus, die Seite kann den dritten Zustand also gar nicht erfinden — dieselbe
   * Lesart wie an seiner Landingpage, die ab der Stilllegung 404 antwortet.
   */
  if (state.state === 'none') {
    return (
      <Container className="py-16 sm:py-24">
        <div className="mx-auto w-full max-w-lg">
          <Eyebrow>{t('eyebrow')}</Eyebrow>
          <h1 className="mt-2 text-h2 text-ink">{t('none.title')}</h1>
          <p className="mt-4 text-body text-text">{t('none.body')}</p>
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
            <Link
              href={PARTNER_BEWERBUNG_HREF}
              className="text-small font-medium text-accent underline underline-offset-4"
            >
              {t('none.cta')}
            </Link>
            <Link
              href={KONTO_HREF}
              className="text-small font-medium text-text-muted underline underline-offset-4"
            >
              {t('none.account')}
            </Link>
          </div>
        </div>
      </Container>
    )
  }

  return (
    <Container className="py-16 sm:py-24">
      <div className="mx-auto w-full max-w-2xl">
        <Eyebrow>{t('eyebrow')}</Eyebrow>
        {/* `mt-2` sass bis B18-3 an der Überschrift selbst; sie steht jetzt im geteilten Inhalt,
            der ohne Eyebrow darüber auskommen muss. Gerendert wird dasselbe. */}
        <div className="mt-2">
          <PartnerMarketingContent
            companyName={state.partner.displayName}
            referralUrl={referralUrl}
          />
        </div>
      </div>
    </Container>
  )
}
