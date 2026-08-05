import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Inter } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { routing } from '@/i18n/routing'
import '@/app/globals.css'

/*
 * ROOT-LAYOUT DER ZUGANGSPLATTFORM (Baustein 1).
 *
 * ── WARUM AUSSERHALB VON `app/(site)/[locale]/` ────────────────────────────────────────────────
 * Dieselbe Entscheidung und dieselbe Begründung wie beim Portalbereich (B18-3), bei `/admin` (T4-4)
 * und bei `/styleguide`: Ein Produktbereich hinter einer eigenen Subdomain ist kein Seiteninhalt —
 * er braucht kein Locale-Präfix, keine Übersetzung in eine zweite Sprache und keinen Canonical. Next
 * erlaubt dafür mehrere Root-Layouts; `(site)` und dieser Baum haben kein gemeinsames Elternteil und
 * teilen sich deshalb weder Header noch Metadaten.
 *
 * DAS IST DIE CODE-TRENNUNG, DIE §8 DES PFLICHTENHEFTS VERLANGT
 * (`Pflichtenheft_Zugangsplattform_MVP.md`): „Klar abgegrenztes Modul/Route-Gruppe, nicht mit
 * Website-Marketing-Code vermischt, auch wenn beides im selben Repo/derselben App lebt." Sie ist
 * hier strukturell und nicht bloss Konvention: Der Baum kann den Website-Header technisch nicht
 * erben, und `lib/routes.ts` kann seine Seiten per Konstruktion nicht in die sitemap aufnehmen (der
 * Abgleich mit der Platte liest ausschliesslich `app/(site)/[locale]/`).
 *
 * ⚠ DER PFAD DIESES BAUMS IST VON AUSSEN AUF KEINEM HOST ERREICHBAR. Er ist ausschliesslich das
 * Ziel des internen Rewrites in `middleware.ts`; jeder direkte Aufruf — auf `coolin.at` wie auf
 * `access.coolin.at`, mit und ohne Locale-Präfix — wird dort mit 404 beantwortet, BEVOR irgendetwas
 * anderes greift. Die vollständige Begründung samt der drei Stellen, die das durchsetzen, steht bei
 * `ACCESS_RENDER_ROOT` in `lib/access-host.ts`.
 *
 * ⚠ HIER GIBT ES NOCH KEINE ZUGANGSPRÜFUNG, WEIL ES NOCH KEINE AUTH GIBT (Baustein 6.1). Wenn sie
 * kommt, gehört sie in JEDE SEITE und nicht in dieses Layout — der Grund ist im Portalbereich und im
 * Admin-Bereich gemessen: Dass ein Layout `children` nicht rendert, verhindert nicht, dass Next die
 * Seite rendert und ins Flight-Payload schreibt. Der Portalbereich hält das mit einem Wächter fest,
 * der alle `page.tsx` seines Baums liest (`lib/portal-host.test.ts`); für diesen Baum gehört
 * derselbe Wächter in `lib/access-host.test.ts`, sobald es einen Leseweg gibt, den er nennen kann.
 *
 * ⚠ SERVER-ONLY-AUFLAGE FÜR ALLES, WAS HIER HINEINKOMMT (§8): RMS-API-Credentials und jede
 * Zugriffs-/Freischaltungslogik dürfen nie im Client-Bundle landen. Der Ort dafür ist ein Modul mit
 * `import 'server-only'` unter `lib/access/` — nicht eine Komponente dieses Baums.
 */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
  display: 'swap',
})

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations({ locale: routing.defaultLocale, namespace: 'Access' })
  return {
    title: `${t('metaTitle')} — COOLiN ENERGY`,
    /*
     * `noindex` steht hier direkt und NICHT über `robotsFor` (`lib/routes.ts`) — anders als beim
     * Portalbereich, und das ist kein zweiter Fundort derselben Entscheidung: `robotsFor` beantwortet
     * die Frage je PFAD innerhalb von `app/(site)/[locale]/`, und der Portalbereich hat dort mit
     * `/partner-portal` einen echten Zwilling, dem seine `noindex`-Entscheidung gehört. Die
     * Zugangsplattform hat keinen — ihre Adressen existieren ausschliesslich auf ihrem eigenen Host.
     * Ein Eintrag in `lib/routes.ts` wäre ein Pfad, den es unter `(site)` nicht gibt; der dortige
     * Platten-Abgleich bräche laut, und zwar zu Recht.
     *
     * `nofollow` zusätzlich (der Portalbereich hat `follow`): Dort gibt es öffentliche Ziele, die
     * verfolgt werden dürfen (`/partner-werden`). Hier gibt es nichts zu verfolgen, und sobald es
     * etwas gibt, führt es hinter eine Anmeldung.
     *
     * Dass der gesamte Host ohnehin auf `Disallow: /` steht (`app/robots.ts`), ist die zweite
     * Schicht — keine Verdopplung, sondern eine andere Reichweite: Die eine wirkt je Seite, die
     * andere je Host. Und sie ist die wichtigere, weil ein `Disallow` das LESEN verbietet und ein
     * Crawler das `noindex` dieser Seite damit gar nicht zu sehen bekommt.
     */
    robots: { index: false, follow: false },
  }
}

export default function AccessLayout({ children }: { children: ReactNode }) {
  /*
   * Der Bereich liegt ausserhalb des Locale-Segments, die UI-Primitives und `useTranslations` sind
   * aber locale-bewusst und werfen ohne intl-Kontext. Gleiche Lösung wie beim Portalbereich, beim
   * Admin-Bereich und beim Styleguide: Kontext der Default-Locale setzen, statt die Primitives zu
   * verbiegen.
   *
   * ⚠ Phase 1 ist ausschliesslich Deutsch. Eine zweite Sprache ist hier eine bewusste Entscheidung
   * (welche Locale zeigt ein angemeldeter Bereich?) und keine Kleinigkeit; ein Test in
   * `lib/access-host.test.ts` bricht laut, sobald `routing.locales` wächst.
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
