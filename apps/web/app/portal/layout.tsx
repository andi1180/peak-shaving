import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Inter } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { routing } from '@/i18n/routing'
import { PARTNER_PORTAL_HREF } from '@/lib/partner-portal/config'
import { robotsFor } from '@/lib/routes'
import '@/app/globals.css'

/*
 * ROOT-LAYOUT DES PORTALBEREICHS (B18-3).
 *
 * ── WARUM AUSSERHALB VON `app/(site)/[locale]/` ────────────────────────────────────────────────
 * Dieselbe Entscheidung und dieselbe Begründung wie bei `/admin` (T4-4) und `/styleguide`: Ein
 * angemeldeter Bereich ist kein Seiteninhalt — er braucht kein Locale-Präfix, keine Übersetzung in
 * eine zweite Sprache und keinen Canonical. Next erlaubt dafür mehrere Root-Layouts; `(site)` und
 * dieser Baum haben kein gemeinsames Elternteil und teilen sich deshalb weder Header noch Metadaten.
 *
 * Das IST der Zweck von B18-3: Bis hierher rendete der Portalbereich innerhalb des öffentlichen
 * `(site)`-Layouts und trug damit den vollen Marketing-Header samt Mega-Menü. Der Rahmen steht
 * jetzt in `components/portal/shell.tsx`.
 *
 * ⚠ DER PFAD DIESES BAUMS IST VON AUSSEN AUF KEINEM HOST ERREICHBAR. Er ist ausschliesslich das
 * Ziel des internen Rewrites in `middleware.ts`; jeder direkte Aufruf — auf `coolin.at` wie auf
 * `partner.coolin.at`, mit und ohne Locale-Präfix — wird dort mit 404 beantwortet, BEVOR
 * irgendetwas anderes greift. Die vollständige Begründung samt der drei Stellen, die das
 * durchsetzen, steht bei `PORTAL_RENDER_ROOT` in `lib/portal-host.ts`.
 *
 * ⚠ WER HIER EINE NEUE SEITE ANLEGT, LEGT SIE UNGESCHÜTZT AN. Die Zugangsprüfung sitzt NICHT in
 * diesem Layout, sondern in jeder Seite (`readPortal`, s. `app/portal/page.tsx`) — der Grund ist
 * derselbe wie im Admin-Bereich: Dass ein Layout `children` nicht rendert, verhindert nicht, dass
 * Next die Seite rendert und ins Flight-Payload schreibt. Eine neue Seite muss `readPortal` selbst
 * aufrufen; `lib/partner-portal/portal-routes.test.ts` misst genau das.
 */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
  display: 'swap',
})

/**
 * Die Seiten lesen die Sitzung und zeigen den Namen sowie den persönlichen Link EINES Betriebs.
 * Eine zwischengespeicherte Fassung zeigte dem nächsten Besucher die Daten des vorigen — der
 * teuerste denkbare Cache-Fehler dieses Bereichs, weil eine daraus entstehende Aussendung Anfragen
 * dem falschen Betrieb zuordnete. Steht hier UND in jeder Seite: Das Layout umschliesst jede
 * künftige Unterroute automatisch, die Seite sagt es an ihrem eigenen Fundort.
 */
export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations({ locale: routing.defaultLocale, namespace: 'PartnerPortal' })
  return {
    title: `${t('metaTitle')} — COOLiN ENERGY`,
    /*
     * Die `noindex`-Entscheidung wird NICHT zweitgetroffen: Sie kommt aus `robotsFor` und gehört
     * dem Portalbereich, nicht dieser Adresse. Dass der Portal-Host ohnehin vollständig auf
     * `Disallow: /` steht (`app/robots.ts`), ist die zweite Schicht — keine Verdopplung, sondern
     * eine andere Reichweite: Die eine wirkt je Seite, die andere je Host.
     */
    robots: robotsFor(PARTNER_PORTAL_HREF),
  }
}

export default function PortalLayout({ children }: { children: ReactNode }) {
  /*
   * Der Bereich liegt ausserhalb des Locale-Segments, die UI-Primitives und `useTranslations` sind
   * aber locale-bewusst und werfen ohne intl-Kontext. Gleiche Lösung wie beim Admin-Bereich und
   * beim Styleguide: Kontext der Default-Locale setzen, statt die Primitives zu verbiegen.
   *
   * ⚠ Phase 1 ist ausschliesslich Deutsch — dieselbe Prämisse wie bei `/admin`. Eine zweite Sprache
   * ist hier eine bewusste Entscheidung (welche Locale zeigt ein angemeldeter Bereich?) und keine
   * Kleinigkeit; ein Test in `lib/portal-host.test.ts` bricht laut, sobald `routing.locales` wächst.
   */
  setRequestLocale(routing.defaultLocale)

  return (
    <html lang={routing.defaultLocale} className={inter.variable}>
      <body className="bg-surface-alt">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  )
}
