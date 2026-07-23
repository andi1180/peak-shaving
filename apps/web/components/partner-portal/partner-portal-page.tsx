import { useTranslations } from 'next-intl'
import { Container, Eyebrow } from '@/components/ui/layout'
import { Link } from '@/i18n/navigation'
import { KONTO_HREF } from '@/lib/auth/config'
import { PARTNER_BEWERBUNG_HREF } from '@/lib/partner-application/config'
import type { PortalState } from '@/lib/partner-portal/portal'
import { CopyBlock } from './copy-block'

/**
 * Das Partner-Portal `/partner-portal` (B16-4b).
 *
 * Ein Fachbetrieb, der freigeschaltet ist, findet hier zwei Dinge: seinen persönlichen
 * Empfehlungslink und Textvorlagen, mit denen er seine Bestandskunden anschreiben kann. Mehr nicht —
 * und das „mehr nicht" ist der Entwurf, nicht eine Auslassung (s. unten).
 *
 * ── ⚠ ES STEHT NICHTS ÜBER EINZELNE INTERESSENTEN DARIN ─────────────────────────────────────────
 * Keine Namen, keine Firmen, keine Anzahl, kein Status. Die namentliche Sicht setzt einen
 * Einwilligungszweck voraus, den es noch nicht gibt — ein Interessent hat eingewilligt, dass COOLiN
 * ihn kontaktiert, nicht dass ein dritter Betrieb seinen Namen zu sehen bekommt (B16-6, wartet auf
 * die juristische Prüfung). Auch die blosse ANZAHL fehlt bewusst: sie ist B16-5, dort wird die
 * Zählweise gesondert entschieden, und eine hier schnell hingeschriebene Zahl wäre die Zahl, an der
 * sich der Betrieb ab dem ersten Tag orientiert.
 *
 * Statt eines leeren Bereichs, der wie ein Defekt aussieht, steht ein Platzhalter-Hinweis: dass
 * Auswertungszahlen folgen und warum hier noch keine stehen. Eine erfundene Zahl wäre der einzige
 * Fehler, der schlimmer wäre als gar keine.
 *
 * ── ⚠ ARBEITSSTAND DER TEXTE ────────────────────────────────────────────────────────────────────
 * Gerüst und Formulierungen stammen aus dem Bau; die endgültigen kommen von Andreas/Martina. Die
 * Texte liegen unter `PartnerPortal.*` in `messages/de.json` und tragen dort einen Vermerk. Das
 * betrifft besonders die zwei VORLAGEN: Sie gehen unter dem NAMEN DES PARTNERS an dessen
 * Bestandskunden. Bindende Leitplanken für jede Neufassung — keine Preis-, Ergebnis- oder
 * Ersparnisversprechen, keine Zusage über die Bearbeitungsdauer, COOLiN tritt als unabhängiger
 * Prüfer auf und nicht als Verkäufer.
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

  const copyLabels = {
    button: t('copy.button'),
    copied: t('copy.copied'),
    copiedAnnounce: t('copy.copiedAnnounce'),
    failed: t('copy.failed'),
  }

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

  const templates = [
    {
      key: 'short' as const,
      label: t('templates.short.label'),
      subject: t('templates.short.subject'),
      body: t('templates.short.body', { link: referralUrl ?? '' }),
    },
    {
      key: 'long' as const,
      label: t('templates.long.label'),
      subject: t('templates.long.subject'),
      body: t('templates.long.body', { link: referralUrl ?? '' }),
    },
  ]

  return (
    <Container className="py-16 sm:py-24">
      <div className="mx-auto w-full max-w-2xl">
        <Eyebrow>{t('eyebrow')}</Eyebrow>
        <h1 className="mt-2 text-h2 text-ink">{t('title')}</h1>
        <p className="mt-3 text-body text-text-muted">
          {t('intro', { company: state.partner.displayName })}
        </p>

        <div className="mt-8 flex flex-col gap-4">
          <section className="rounded-lg border border-line bg-surface p-6">
            <h2 className="text-h4 text-ink">{t('link.title')}</h2>
            <p className="mt-1 text-small text-text-muted">{t('link.hint')}</p>
            <div className="mt-4">
              {referralUrl && <CopyBlock value={referralUrl} labels={copyLabels} />}
            </div>
          </section>

          <section className="rounded-lg border border-line bg-surface p-6">
            <h2 className="text-h4 text-ink">{t('templates.title')}</h2>
            <p className="mt-1 text-small text-text-muted">{t('templates.intro')}</p>

            <div className="mt-5 flex flex-col gap-6">
              {templates.map((template) => (
                <div key={template.key}>
                  <h3 className="text-small font-semibold text-ink">{template.label}</h3>

                  <p className="mt-3 text-caption text-text-muted">{t('templates.subjectLabel')}</p>
                  <div className="mt-1">
                    <CopyBlock value={template.subject} labels={copyLabels} />
                  </div>

                  <p className="mt-4 text-caption text-text-muted">{t('templates.bodyLabel')}</p>
                  <div className="mt-1">
                    <CopyBlock value={template.body} multiline labels={copyLabels} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/*
            Der Platzhalter — kein leerer Bereich, der wie ein Defekt aussieht, und keine erfundene
            Zahl. Die Zählweise entscheidet B16-5; bis dahin steht hier, dass hier bewusst nichts
            steht.
          */}
          <section className="rounded-lg border border-line bg-surface-sunken p-6">
            <h2 className="text-h4 text-ink">{t('stats.title')}</h2>
            <p className="mt-1 text-small text-text-muted">{t('stats.body')}</p>
          </section>
        </div>
      </div>
    </Container>
  )
}
