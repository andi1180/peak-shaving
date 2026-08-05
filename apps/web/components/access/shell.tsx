import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { EmblemImage } from '@/components/brand/emblem-image'
import { WordmarkA } from '@/components/brand/wordmark'
import { ACCESS_HOST_ROOT } from '@/lib/access-host'

/**
 * DER RAHMEN DER ZUGANGSPLATTFORM (Baustein 1): Kopfzeile mit Marke und Bereichskennzeichnung.
 *
 * ── ER ERSETZT DEN ÖFFENTLICHEN WEBSITE-HEADER, UND DAS IST DER ZWECK DES BAUSTEINS ─────────────
 * Vor Baustein 1 lieferte `access.coolin.at` die komplette Marketing-Website aus (gemessen: `/` und
 * `/leistungen` je 200) und damit das volle Mega-Menü. Für ein Produkt, dessen Nutzer sich hier
 * anmelden werden, ist das die falsche Navigation: Sie führt überall hin, nur nicht dorthin, wofür
 * die Subdomain existiert — und ihre Links verlassen den Host (die 308-Weiche schickt sie auf
 * coolin.at).
 *
 * ── NAVY WIE ADMIN- UND PARTNER-RAHMEN, UND ZWAR ABSICHTLICH ───────────────────────────────────
 * Es soll nie ein Zweifel bestehen, ob man die öffentliche Website oder einen Produktbereich vor
 * sich hat; der weisse Website-Header und diese Kopfzeile sind auf einen Blick verschieden. Dass
 * Admin-Bereich und Partner-Portal dieselbe Farbe tragen, ist kein Konflikt — sie sagt „eigener
 * Bereich", nicht „Verwaltung"; WELCHER Bereich, sagt die Kennzeichnung daneben. Farben, Schrift und
 * Primitives sind unverändert die des übrigen `apps/web` (`DESIGN.md`); ein zweites Designsystem
 * entsteht hier nicht, und genau deshalb ist der Bereich auf einen Blick als COOLiN erkennbar.
 *
 * ── WAS BEWUSST FEHLT ──────────────────────────────────────────────────────────────────────────
 * Kein Abmelde-Knopf und keine Reiterleiste. Beides wäre heute eine Requisite: Es gibt keine
 * Anmeldung (Baustein 6.1) und es gibt genau eine Seite, also nichts zu navigieren. Ein Reiter, der
 * nichts tut, ist Bauaufwand, den der tatsächliche Bau wieder anfassen muss — dieselbe Entscheidung
 * wie beim Partner-Portal, wo B18-4 ausdrücklich NICHT als deaktivierter Platzhalter vorgebaut
 * wurde. Sie kommen mit dem Schritt, der sie füllt; das Vorbild dafür steht in
 * `components/portal/shell.tsx` und `lib/partner-portal/nav.ts`.
 *
 * SERVER-KOMPONENTE, ohne jeden Client-Anteil.
 */
export function AccessShell({ children }: { children: ReactNode }) {
  const t = useTranslations('Access.shell')

  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-navy text-navy-foreground">
        <div className="mx-auto flex w-full max-w-container flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:px-6">
          {/*
           * Die Marke führt auf die Wurzel DIESES Hosts, nicht auf die Marketing-Startseite:
           * innerhalb eines Bereichs ist das Logo der Weg nach oben, und ein Sprung auf coolin.at
           * wäre ein Verlassen des Bereichs, das niemand beabsichtigt hat. Natives `<a>` aus
           * demselben Grund wie im Portal-Rahmen: Der locale-bewusste Link (`components/ui/link.tsx`)
           * erzeugte bei einer zweiten Sprache `/en/` — eine Adresse, die es auf diesem Host nicht
           * gibt.
           */}
          <a
            href={ACCESS_HOST_ROOT}
            className="flex items-center gap-3 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-node focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
          >
            <EmblemImage size={36} className="h-9 w-9" />
            <WordmarkA className="h-9 w-auto" />
            <span className="sr-only">{t('home')}</span>
          </a>

          <span className="rounded-sm border border-node px-2 py-0.5 text-small font-semibold uppercase tracking-wide text-node">
            {t('badge')}
          </span>
        </div>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  )
}
