import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Container, Section } from '@/components/ui/layout'
import { KONTAKT_HREF } from '@/lib/nav'

/**
 * Kontakt-CTA (§4.4 Nr. 7) — Abschluss der Seite.
 *
 * Nur der Verweis auf `/kontakt`; das Formular selbst steht dort (§5.5,
 * `components/kontakt/`). Die Startseite kennt kein Thema, das sie vorwählen
 * könnte — deshalb der nackte `KONTAKT_HREF` ohne `?thema=`. Ein geratenes Thema
 * wäre schlechter als keins: Der Nutzer müsste es korrigieren, statt es zu wählen.
 *
 * Texte aus `reference/coolin-legacy.html` (Vorgehen-Abschluss + Kontakt-Block:
 * „In 30 Minuten klären wir…", „Unverbindliches Erstgespräch…", „Hilfreiche
 * Unterlagen"). Die 30 Minuten sind keine Erfolgs-Kennzahl, sondern die Dauer
 * des angebotenen Gesprächs.
 *
 * DIE UNTERLAGEN-LISTE STEHT IM `Kontakt`-NAMESPACE, nicht in `Home.Kontakt`:
 * `/kontakt` zeigt dieselbe Liste. Zwei Kopien wären zwei Listen, die beim ersten
 * „ach ja, und die Zählpunktnummer" auseinanderlaufen — sichtbar erst für den,
 * der beide Seiten nacheinander liest.
 */
export function KontaktCta() {
  const t = useTranslations('Home.Kontakt')
  const tKontakt = useTranslations('Kontakt')

  const docs = [
    tKontakt('docs.doc1'),
    tKontakt('docs.doc2'),
    tKontakt('docs.doc3'),
    tKontakt('docs.doc4'),
    tKontakt('docs.doc5'),
  ]

  return (
    <Section tone="alt" className="border-t border-line">
      <Container>
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <h2 className="text-h2 text-ink">{t('title')}</h2>
            <p className="mt-4 max-w-prose text-lead text-text-muted">{t('lead')}</p>
            <div className="mt-8">
              <Button asChild variant="primary" size="lg">
                <Link href={KONTAKT_HREF}>{t('cta')}</Link>
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-line bg-surface p-6">
            <p className="text-label uppercase text-ink">{tKontakt('docs.title')}</p>
            <ul className="mt-4 space-y-2">
              {docs.map((doc) => (
                <li key={doc} className="flex gap-3 text-small text-text-muted">
                  {/* Aufzählungspunkt als Fläche, nicht als Zeichen — kein Emoji,
                      kein Icon-Rauschen (§7.3). Dekor → aria-hidden. */}
                  <span
                    className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent"
                    aria-hidden="true"
                  />
                  {doc}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Container>
    </Section>
  )
}
