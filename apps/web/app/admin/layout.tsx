import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Inter } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { setRequestLocale } from 'next-intl/server'
import { routing } from '@/i18n/routing'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container } from '@/components/ui/layout'
import { AdminNav } from '@/components/admin/nav'
import '../globals.css'

/*
 * Root-Layout UND Zugangsschranke des Admin-Bereichs (T4-4).
 *
 * WARUM EIN EIGENES ROOT-LAYOUT: `/admin` steht — wie `/styleguide` — bewusst außerhalb der
 * Sprach-Struktur (`app/(site)/[locale]/`). Ein interner Verwaltungsbereich ist kein Seiteninhalt;
 * er braucht kein Locale-Präfix und keine Übersetzung. Next erlaubt dafür mehrere Root-Layouts,
 * solange sie sich nicht überlappen (s. `app/(dev)/layout.tsx`, dieselbe Begründung). Die Middleware
 * nimmt `/admin` entsprechend vom next-intl-Routing aus — den Session-Refresh aber NICHT.
 *
 * DIE SCHRANKE STEHT IM LAYOUT, WEIL ES JEDE KÜNFTIGE UNTERROUTE AUTOMATISCH UMSCHLIESST — läge sie
 * nur in `page.tsx`, wäre die nächste hinzugefügte Seite still ungeschützt. Sie ist damit die ZWEITE
 * Verteidigungslinie, nicht die einzige: jeder `admin_*`-Wrapper prüft `platform.is_admin()` selbst,
 * ein Fehler hier gibt also niemandem Schreibrechte.
 *
 * ACHTUNG, die Schranke hier reicht NICHT allein: dass dieses Layout `children` nicht rendert,
 * verhindert nicht, dass Next die Seite rendert und ins Flight-Payload schreibt. `page.tsx` prüft
 * deshalb ebenfalls — dieselbe Funktion, zwei Aufgaben. Begründung und Messung: `lib/admin/guard.ts`.
 *
 * DIE ZWEI ABLEHNUNGEN SIND BEWUSST VERSCHIEDEN:
 *  - keine Session  → Weiterleitung auf /anmelden (der Nutzer soll sich anmelden können).
 *  - Session, aber kein Admin → eine neutrale Seite, KEINE Weiterleitung. Ein Redirect auf /anmelden
 *    ergäbe bei bestehender Session eine Endlosschleife (angemeldet → /admin → /anmelden → /konto),
 *    und der Text verrät nicht, dass es hier einen Verwaltungsbereich gibt: wer keinen Zugang hat,
 *    erfährt aus dieser Seite nicht, dass es etwas zu haben gäbe.
 */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
  display: 'swap',
})

/*
 * NEUTRALER TITEL, bewusst — und bewusst AUCH für den Admin selbst.
 *
 * Ein `title: 'Verwaltung — …'` stünde im `<title>` JEDER Antwort dieses Segments, also auch der
 * „Kein Zugriff"-Seite: Metadaten werden aus dem Routen-Baum aufgelöst, unabhängig davon, was das
 * Layout am Ende rendert. Wer keinen Zugang hat, läse dann im Browser-Tab, dass es hier einen
 * Verwaltungsbereich GIBT — genau der Hinweis, den diese Seite nicht geben soll. Ihn stattdessen in
 * `page.tsx` zu setzen hilft nicht: auch dessen Metadaten gelten, wenn das Layout abweist.
 * Der Titel bleibt deshalb nichtssagend; die Überschrift auf der Seite benennt den Bereich für die,
 * die ihn sehen dürfen. (Beim Flow-Test aufgefallen, nicht im Entwurf — s. Bericht.)
 */
export const metadata: Metadata = {
  title: 'COOLiN ENERGY',
  robots: { index: false, follow: false },
}

/** getUser() + RPC je Aufruf: die Rolle wird live gelesen, ein Entzug greift sofort (I10). */
export const dynamic = 'force-dynamic'

function Shell({ children }: { children: ReactNode }) {
  return (
    <html lang={routing.defaultLocale} className={inter.variable}>
      <body className="bg-surface-alt">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  )
}

export default async function AdminLayout({ children }: { children: ReactNode }) {
  /*
   * Der Bereich liegt außerhalb des Locale-Segments, die UI-Primitives (`components/ui/link.tsx`)
   * sind aber locale-bewusst und werfen ohne intl-Kontext. Gleiche Lösung wie beim Styleguide:
   * Kontext der Default-Locale setzen, statt die Primitives zu verbiegen.
   */
  setRequestLocale(routing.defaultLocale)

  // Leitet ohne Session selbst auf /anmelden um (J6) und liefert sonst die Rollen-Antwort.
  if (!(await isCurrentUserAdmin())) {
    return (
      <Shell>
        <Container className="py-24">
          <div className="mx-auto max-w-md text-center">
            <h1 className="text-h3 text-ink">Kein Zugriff</h1>
            <p className="mt-3 text-body text-text-muted">
              Diese Seite steht Ihrem Konto nicht zur Verfügung.
            </p>
          </div>
        </Container>
      </Shell>
    )
  }

  /*
   * Die Navigation steht NUR im Zugangs-Zweig. Im Ablehnungs-Zweig oben gibt es sie bewusst nicht:
   * eine Leiste mit „Übersicht · Leads" verriete, was es hier zu holen gäbe — derselbe Grund, aus
   * dem der Seitentitel neutral bleibt.
   */
  return (
    <Shell>
      <AdminNav />
      {children}
    </Shell>
  )
}
