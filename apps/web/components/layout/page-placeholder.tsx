import { useTranslations } from 'next-intl'
import { Container, Eyebrow } from '@/components/ui/layout'

/**
 * Platzhalter für eine noch nicht gebaute Seite.
 *
 * Bewusst minimal: Titel + „in Aufbau". Der Zweck dieses Schritts ist, dass
 * jeder Nav-Link auflöst und die Seite komplett begehbar ist — Inhalte,
 * Hero-Flächen und Sektionen kommen in eigenen Prompts (Pflichtenheft §11).
 *
 * `titleKey` zeigt in den `Pages`-Namespace der Message-Datei — auch die
 * Platzhalter halten sich an §8.7 (keine Strings hart im JSX).
 */
export function PagePlaceholder({ titleKey }: { titleKey: string }) {
  const tPages = useTranslations('Pages')
  const t = useTranslations('Placeholder')

  return (
    <Container className="py-16 sm:py-24">
      <Eyebrow>{t('inProgress')}</Eyebrow>
      <h1 className="mt-2 text-h1 text-ink">{tPages(titleKey)}</h1>
      <p className="mt-4 max-w-prose text-lead text-text-muted">{t('note')}</p>
    </Container>
  )
}
