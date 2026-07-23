import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Container, Section } from '@/components/ui/layout'
import { PARTNER_BEWERBUNG_HREF } from '@/lib/partner-application/config'

/**
 * Partner-Banner der Startseite (B16-Einstieg) — der einzige Verweis aufs Partnerprogramm im
 * Startseiten-Inhalt.
 *
 * ── WARUM GANZ UNTEN, NACH DEM KONTAKT-CTA ──────────────────────────────────────────────────────
 * Die Startseite richtet sich an GEWERBEKUNDEN; ihr Ziel ist die Kontaktanfrage (§4.4 Nr. 7,
 * `kontakt-cta.tsx`). Ein Partner-Aufruf oberhalb davon konkurrierte mit genau der Handlung, an
 * der das Geschäft hängt — und zwar zugunsten einer Zielgruppe, die diese Seite gar nicht sucht.
 * Deshalb steht er dahinter: sichtbar für den, der bis zum Ende liest, unsichtbar als Ablenkung.
 *
 * ── WARUM SELBST-QUALIFIZIEREND FORMULIERT ──────────────────────────────────────────────────────
 * Die erste Zeile nennt den Adressaten („Elektro- oder PV-Betrieb"), nicht das Angebot. Ein
 * unspezifisches „Partner werden" müsste jeder Leser erst auf sich beziehen oder verwerfen; so
 * erkennt ein Gewerbekunde in einem halben Satz, dass er nicht gemeint ist.
 *
 * ── GENAU EIN BANNER ────────────────────────────────────────────────────────────────────────────
 * Nicht zwei, und keine zweite Platzierung weiter oben. Es gibt daneben genau zwei weitere
 * Einstiege: den Knopf rechts oben (`site-header.tsx`) und den Fusszeilen-Link
 * (`site-footer.tsx`, seit B16-3).
 *
 * Sekundärer Knopf, kein primärer: Der einzige primäre Handlungsaufruf dieser Seite bleibt das
 * Kontaktformular direkt darüber.
 *
 * ⚠ TEXTE SIND ARBEITSSTAND — s. Vermerk bei `Home.Partner` in `messages/de.json`.
 */
export function PartnerBanner() {
  const t = useTranslations('Home.Partner')

  return (
    <Section className="border-t border-line">
      <Container>
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-prose">
            <h2 className="text-h4 text-ink">{t('title')}</h2>
            <p className="mt-2 text-small text-text-muted">{t('text')}</p>
          </div>
          <div className="shrink-0">
            <Button asChild variant="secondary">
              <Link href={PARTNER_BEWERBUNG_HREF}>{t('cta')}</Link>
            </Button>
          </div>
        </div>
      </Container>
    </Section>
  )
}
