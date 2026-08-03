import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { Inter } from 'next/font/google'
import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { setRequestLocale } from 'next-intl/server'
import { routing } from '@/i18n/routing'
import { SITE_URL } from '@/lib/site'
import { organizationLd } from '@/lib/json-ld'
import { JsonLd } from '@/components/json-ld'
import { SiteHeader } from '@/components/layout/site-header'
import { SiteFooter } from '@/components/layout/site-footer'
import { PostHogAnalytics } from '@/components/analytics/posthog'
import '../../globals.css'
/*
 * WÄCHTER ÜBER DIE PRODUKTIONSPFLICHTIGEN UMGEBUNGSVARIABLEN (`lib/env.guard.ts`, heute:
 * Cloudflare Turnstile). Ein reiner Seiteneffekt-Import — die Datei prüft beim Laden und wirft,
 * wenn dieser Build unter der Produktivdomain läuft und ein Wert fehlt.
 *
 * WARUM HIER UND NICHT IN `next.config.mjs` ODER EINER `instrumentation.ts`: Die Prüfung hängt an
 * `IS_PRODUCTION_SITE` (`lib/site.ts`), also an TypeScript-Modulen, die `next.config.mjs` nicht
 * importieren kann; und `instrumentation.ts` läuft beim Start des Servers, nicht beim `next build`
 * — ein vergessener Wert fiele damit erst nach dem Deployment auf, also genau zu spät.
 *
 * Dieses Root-Layout dagegen wird beim Bauen JEDER öffentlichen Seite ausgewertet (gemessen: der
 * Build bricht ab, s. Handover in CLAUDE.md), und es ist zugleich das Layout genau der Seiten, die
 * die geschützten Formulare tragen — `/kontakt`, `/warteliste`, `/partner-werden`. Der Wächter
 * steht damit an derselben Stelle wie das, was er schützt. Der Admin-Bereich und `/styleguide`
 * haben eigene Root-Layouts und binden ihn bewusst NICHT ein: Für die Build-Wirkung genügt EIN
 * Auswertungsort, und mehrere Einbindungen wären dieselbe Prüfung an mehreren Stellen.
 */
import '@/lib/env.guard'

// Inter selbst gehostet via next/font (Pflichtenheft §7.4: Performance + DSGVO).
// next/font lädt die Dateien zur BUILD-Zeit und liefert sie aus der eigenen
// Domain aus — im Browser entsteht KEIN Request an Google.
// Es gibt bewusst nur DIESE eine Schrift (Entscheidung: Inter-only).
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
  display: 'swap',
})

export const metadata: Metadata = {
  /*
   * Löst ALLE relativen URLs der Metadaten gegen die echte Basis-URL auf
   * (Pflichtenheft §6.4) — allen voran das `og:image` aus `opengraph-image.tsx`
   * nebenan: Ohne `metadataBase` bliebe dessen URL relativ, und relative
   * Bild-URLs ignorieren Facebook/LinkedIn/WhatsApp schlicht. Die Basis kommt
   * aus `lib/site.ts`, damit es KEINE zweite Stelle mit einer Domain gibt.
   */
  metadataBase: new URL(SITE_URL),
  title: 'COOLiN ENERGY',
  description: 'Website in Aufbau.',
  /*
   * DIE GEMEINSAME OG-BASIS ALLER SEITEN. Sie steht hier und nicht pro Seite,
   * weil sie pro Seite gleich ist: Nur `og:title`/`og:description` unterscheiden
   * sich — und die füllt Next aus dem `title`/`description` der jeweiligen Seite
   * auf, sobald ein `openGraph`-Objekt existiert. Genau das ist der Zweck dieses
   * Blocks: Jede bestehende `generateMetadata` bleibt unverändert und bekommt
   * ihre OG-Tags trotzdem.
   *
   * KEIN `images`-Eintrag: Das Bild kommt aus `opengraph-image.tsx` im SELBEN
   * Segment (§6.3), Next mischt es hier hinein. Dass die Datei genau daneben
   * liegen MUSS und nicht in `app/`, ist kein Zufall — die Begründung steht in
   * ihrem Kopf. Ein `images`-Eintrag hier würde sie überstimmen.
   */
  openGraph: {
    type: 'website',
    siteName: 'COOLiN ENERGY',
    // Sprache_REGION: die Fassung ist deutsch und zielt auf Österreich (§6.1).
    // Nicht zu verwechseln mit hreflang (`lib/seo.ts`) — das beantwortet die
    // andere Frage („für wen ist diese URL die richtige?") und ist deshalb „de".
    locale: 'de_AT',
  },
  /*
   * `summary_large_image`: die große Karte statt des kleinen Vorschau-Quadrats —
   * das 1200x630-Bild ist genau dafür gebaut. Titel/Beschreibung/Bild übernimmt
   * X von den OG-Tags, sie werden hier bewusst kein zweites Mal gepflegt.
   */
  twitter: {
    card: 'summary_large_image',
  },
}

/** Alle Locales vorab bauen — statisch, ohne Request. */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) notFound()

  // Ohne setRequestLocale fällt statisches Rendering auf dynamisch zurück.
  setRequestLocale(locale)

  return (
    <html lang={locale} className={inter.variable}>
      {/* flex-col + mt-auto am Footer: der Footer sitzt auch auf kurzen Seiten unten. */}
      <body className="flex min-h-screen flex-col">
        {/*
         * DER FIRMEN-KNOTEN, EINMAL PRO SEITE (Pflichtenheft §6.4).
         *
         * Er steht im Layout und nicht auf der Startseite, obwohl er die Firma
         * beschreibt: Artikel verweisen als `publisher`, der Kalkulator als
         * `provider` auf seine `@id`. Ein Verweis, dessen Ziel auf DIESER Seite
         * fehlt, zwingt Google, das Ding woanders zu suchen — hier liegt es
         * überall gleich mit. Genau einmal, weil das Layout genau einmal läuft;
         * die anderen Blöcke beschreiben die Firma nie neu, sie zeigen nur auf
         * diese ID (`organizationRef`).
         */}
        <JsonLd schema={organizationLd()} />
        {/*
         * COOKIELOSES ANALYTICS FÜR DIE GANZE ÖFFENTLICHE SEITE (inkl. der
         * Monitor-Route /strom-check, die unter diesem Layout liegt).
         *
         * DASS ES HIER UND NUR HIER STEHT, IST DIE /admin-AUSNAHME. `app/admin`
         * hat ein EIGENES Root-Layout (T4-4, außerhalb der Sprach-Struktur) und
         * durchläuft dieses hier nie — der Verwaltungsbereich lädt PostHog damit
         * STRUKTURELL nicht, nicht per Pfad-Abfrage, die jemand später falsch
         * anpassen könnte. Das ist dort nicht nur eine Datenschutz-, sondern eine
         * Sichtbarkeitsfrage: ein Tracking-Request aus /admin wäre ein weiterer
         * Kanal, über den die bloße Existenz des Bereichs nach außen sichtbar wird
         * (dieselbe Sorge, die dort schon den Seitentitel neutral hält).
         * Ebenso ausgenommen: /styleguide (eigenes (dev)-Root-Layout).
         */}
        <PostHogAnalytics />
        <NextIntlClientProvider>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
