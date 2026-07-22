import { useTranslations } from 'next-intl'
import { Container } from '@/components/ui/layout'

/**
 * /datenschutz (Pflichtenheft §9.2, OP#3) — echte Inhaltsseite, ersetzt den
 * bisherigen `PagePlaceholder`.
 *
 * DER TEXT BESCHREIBT DEN TATSÄCHLICHEN STAND, nicht die Vorlage: Die alte,
 * live noch stehende Fassung (`coolin-legacy-datenschutz.md`) war für die
 * statische Netlify-Seite mit Netlify Forms und reCAPTCHA geschrieben. Nichts
 * davon läuft hier. Was hier steht, ist am Code geprüft — Vercel statt Netlify,
 * Supabase (EU/Frankfurt), Resend, PostHog cookielos, Honeypot statt Turnstile.
 * Was NICHT erreichbar ist, steht auch nicht drin: Es gibt derzeit keinen
 * aufrufbaren Kaufweg, deshalb keinen Abschnitt zur Zahlungsabwicklung — ein
 * Hinweis auf eine nicht nutzbare Funktion klärt nicht auf, er verwirrt.
 */
export function DatenschutzPage() {
  const t = useTranslations('Datenschutz')
  const sections = t.raw('sections') as { title: string; paragraphs: string[] }[]

  return (
    <Container className="py-16 sm:py-24">
      <p className="text-label uppercase text-accent">{t('eyebrow')}</p>
      <h1 className="mt-3 max-w-prose text-h1 text-ink">{t('title')}</h1>
      <p className="mt-5 max-w-prose text-lead text-text">{t('intro')}</p>
      <p className="mt-3 max-w-prose text-small text-text-muted">
        {t('lastUpdatedLabel')}: {t('lastUpdated')}
      </p>

      <div className="mt-12 max-w-prose space-y-10">
        {sections.map((section) => (
          <section key={section.title}>
            <h2 className="text-h3 text-ink">{section.title}</h2>
            <div className="mt-3 space-y-3 text-body text-text-muted">
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Container>
  )
}
