import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Inter } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { setRequestLocale } from 'next-intl/server'
import { routing } from '@/i18n/routing'
import '@/app/globals.css'

/*
 * Die HTML-Hülle des Admin-Bereichs (T4-4; mit B17 aus `app/admin/layout.tsx` hierher gewandert).
 *
 * ── WARUM DER BEREICH SEIT B17 ZWEI ROOT-LAYOUTS HAT UND KEIN GEMEINSAMES ────────────────────────
 * `/admin` steht — wie `/styleguide` — bewusst außerhalb der Sprach-Struktur (`app/(site)/[locale]/`):
 * ein interner Verwaltungsbereich ist kein Seiteninhalt, er braucht kein Locale-Präfix und keine
 * Übersetzung. Next erlaubt dafür mehrere Root-Layouts (s. `app/(dev)/layout.tsx`, dieselbe
 * Begründung).
 *
 * Mit B17 kam eine Route dazu, die ANONYM erreichbar sein muss — der Anmelde-Eingang. Der
 * naheliegende Aufbau (ein gemeinsames Root-Layout für `/admin`, die Schranke eine Ebene tiefer in
 * einer Route-Group) war gebaut und funktionierte — und GENAU DA WURDE GEMESSEN, WARUM ER NICHT
 * TAUGT: Next hat in das anonym ausgelieferte HTML des Eingangs zusätzlich das Skript-Bündel der
 * ADMIN-ÜBERSICHT geschrieben (`chunks/app/admin/(intern)/page-….js`). Darin stehen die Namen ihrer
 * Server Actions (`upsertScrapeTargetAction`, `grantRoleByEmailAction`, `createCodeAction`). Ein
 * Zugang entsteht dadurch nicht — die Actions lehnen ohne Sitzung ab, und die DB-Wrapper prüfen
 * `platform.is_admin()` selbst —, aber es ist genau die Struktur-Auskunft, die dieser Bereich nicht
 * geben soll. Gegenprobe: keine öffentliche Seite tut das (`/leistungen/pv-speicher` lädt genau ihr
 * eigenes Bündel und das ihres Layouts, nicht das der Elternseite).
 *
 * Deshalb: ZWEI getrennte Root-Layouts ohne gemeinsames Elternteil — `app/admin/(intern)/layout.tsx`
 * (geschützt) und `app/admin/anmelden/layout.tsx` (öffentlich). Die beiden Routen-Bäume teilen sich
 * damit kein Segment, und Next hat nichts, worüber es Bündel zusammenlegen könnte. Damit die Hülle
 * dadurch nicht zweimal existiert, steht sie hier: EINE Fassung, zwei Aufrufer.
 *
 * ⚠ WER HIER EINE NEUE ROUTE ANLEGT, LEGT SIE UNGESCHÜTZT AN. Alles, was einen Zugang braucht,
 * gehört unter `app/admin/(intern)/`. Direkt unter `app/admin/` gehört ausschliesslich der
 * Anmelde-Eingang. `lib/admin/route-protection.test.ts` misst genau das.
 */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
  display: 'swap',
})

/**
 * Die Metadaten, die für ALLES unter `/admin` gelten — EIN Fundort für beide Root-Layouts.
 *
 * NEUTRALER TITEL, bewusst — und bewusst AUCH für den Admin selbst: Ein `title: 'Verwaltung — …'`
 * stünde im `<title>` jeder Antwort des geschützten Zweigs, also auch der „Kein Zugriff"-Seite;
 * Metadaten werden aus dem Routen-Baum aufgelöst, unabhängig davon, was das Layout am Ende rendert.
 * Wer keinen Zugang hat, läse dann im Browser-Tab, dass es hier einen Verwaltungsbereich GIBT —
 * genau der Hinweis, den diese Seite nicht geben soll. (Beim Flow-Test aufgefallen, nicht im
 * Entwurf.) Der Anmelde-Eingang überschreibt genau dieses eine Feld: er ist die einzige Seite hier,
 * die sich benennen SOLL. `robots` bleibt davon unberührt — Next führt Metadaten feldweise zusammen.
 */
export const ADMIN_METADATA: Metadata = {
  title: 'COOLiN ENERGY',
  robots: { index: false, follow: false },
}

export function AdminRootShell({ children }: { children: ReactNode }) {
  /*
   * Der Bereich liegt außerhalb des Locale-Segments, die UI-Primitives (`components/ui/link.tsx`)
   * sind aber locale-bewusst und werfen ohne intl-Kontext. Gleiche Lösung wie beim Styleguide:
   * Kontext der Default-Locale setzen, statt die Primitives zu verbiegen.
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
