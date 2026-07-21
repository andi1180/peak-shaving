import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { KontaktPage } from '@/components/kontakt/kontakt-page'
import { getActiveConsentText } from '@/lib/leads/store'
import { pageAlternates } from '@/lib/seo'

/**
 * /kontakt — Kontaktseite mit Formular (Pflichtenheft §5.5).
 *
 * Ersetzt den `PagePlaceholder` („in Aufbau"), der hier bis zu diesem Schritt
 * stand. Layout und Inhalt kommen aus `components/kontakt/kontakt-page.tsx`.
 *
 * Die Seite bleibt STATISCH vorgerendert (kein `searchParams`-Zugriff): Der
 * Deep-Link `?thema=<key>` wird im Formular nach der Hydration gelesen — die
 * Begründung steht dort. Ein `searchParams`-Zugriff hier würde die ganze Seite
 * inkl. Adressblock pro Request rendern lassen, um ein Dropdown vorzubelegen.
 *
 * ── B1-2: DER EINWILLIGUNGSTEXT KOMMT AUS DER DATENBANK, NICHT AUS de.json ───
 * Der Wortlaut der (freiwilligen) Marketing-Einwilligung wird hier serverseitig
 * aus `platform.consent_texts` gelesen und ins Formular gereicht. Grund: genau
 * diesen Wortlaut archiviert `public.capture_lead` anschliessend als Nachweis —
 * eine zweite Kopie in `messages/de.json` liesse den Nachweis irgendwann einen
 * Satz behaupten, den die Person nie gesehen hat (B1-1, append-only).
 *
 * `revalidate` statt `force-dynamic`: Einwilligungstexte sind append-only und
 * ändern sich Mal im Jahr. Eine Marketing-Seite pro Request neu zu rendern, um
 * einen quasi-konstanten Satz zu holen, wäre die falsche Rechnung — mit ISR
 * bleibt die Seite ausgeliefertes HTML und die neue Fassung ist nach spätestens
 * einer Stunde drin.
 *
 * FÄLLT DAS LESEN AUS (fehlende Env im CI-Build, Datenbank nicht erreichbar),
 * rendert das Formular OHNE die Ankreuzmöglichkeit — laut geloggt, aber ohne
 * Bruch: ohne Wortlaut darf keine Einwilligung eingesammelt werden, und die
 * Kontaktanfrage selbst hängt nicht daran.
 */
export const revalidate = 3600
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Kontakt' })
  return {
    title: `${t('metaTitle')} — COOLiN ENERGY`,
    description: t('metaDescription'),
    /*
     * Ohne Query: Der Deep-Link `?thema=<key>` zeigt dieselbe Seite mit einem
     * vorbelegten Dropdown — der Canonical führt ihn korrekt auf die eine
     * Kontaktseite zurück, statt jede Themen-Variante als eigene Seite
     * erscheinen zu lassen.
     */
    alternates: pageAlternates(locale, '/kontakt'),
  }
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  let marketingConsentText: string | null = null
  try {
    marketingConsentText = (await getActiveConsentText('marketing_email', locale))?.body ?? null
  } catch (cause) {
    console.warn(
      '[leads] Einwilligungstext für das Kontaktformular nicht lesbar — die freiwillige ' +
        'Ankreuzmöglichkeit wird ausgelassen:',
      cause,
    )
  }

  return <KontaktPage marketingConsentText={marketingConsentText} />
}
