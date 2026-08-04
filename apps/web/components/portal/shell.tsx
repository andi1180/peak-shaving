import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { EmblemImage } from '@/components/brand/emblem-image'
import { WordmarkA } from '@/components/brand/wordmark'
import { Button } from '@/components/ui/button'
import { signOutAction } from '@/lib/auth/actions'
import { PORTAL_HOST_ROOT } from '@/lib/portal-host'
import { PortalNav } from './nav'

/**
 * DER RAHMEN DES PORTALBEREICHS (B18-3): Kopfzeile mit Marke, Bereichskennzeichnung und Abmeldung —
 * darunter die Reiter.
 *
 * ── ER ERSETZT DEN ÖFFENTLICHEN WEBSITE-HEADER, UND DAS IST DER ZWECK DES ABSCHNITTS ────────────
 * Bis B18-3 rendete der Portalbereich innerhalb von `(site)/[locale]/layout.tsx` und trug damit das
 * volle Marketing-Menü samt Mega-Menü, Kontakt- und Partner-Knopf. Für einen angemeldeten
 * Fachbetrieb ist das die falsche Navigation: Sie führt überall hin, nur nicht dorthin, wofür er
 * sich angemeldet hat — und ihre Links verlassen den Portal-Host (die 308-Weiche schickt sie auf
 * coolin.at).
 *
 * ── NAVY WIE DER ADMIN-RAHMEN, UND ZWAR ABSICHTLICH ────────────────────────────────────────────
 * Es soll nie ein Zweifel bestehen, ob man die öffentliche Website oder einen angemeldeten Bereich
 * vor sich hat; der weisse Website-Header und diese Kopfzeile sind auf einen Blick verschieden.
 * Dass der Admin-Bereich dieselbe Farbe trägt, ist kein Konflikt — er sagt „angemeldeter Bereich",
 * nicht „Verwaltung"; WELCHER Bereich, sagt die Kennzeichnung daneben. Farben, Schrift und
 * Primitives sind unverändert die des übrigen `apps/web`; ein zweites Designsystem entsteht nicht.
 *
 * ── DIE REITER ERSCHEINEN NUR MIT PARTNERZEILE ─────────────────────────────────────────────────
 * `active === null` heisst: dieses Konto hat keinen (aktiven) Partnerzugang, oder er liess sich
 * nicht laden. Dann gibt es nichts zu navigieren — „Allgemein" hätte keine Stammdaten zu zeigen und
 * „Marketing" keinen Empfehlungslink. Die Kopfzeile bleibt trotzdem stehen: Wer angemeldet ist,
 * muss sich abmelden können, und das ist der einzige Weg dafür.
 *
 * SERVER-KOMPONENTE. Interaktiv ist allein das Abmelde-Formular (eine Server Action).
 */
export function PortalShell({
  /** `href` des aktiven Reiters — `null` blendet die Reiterleiste aus (s. o.). */
  active,
  children,
}: {
  active: string | null
  children: ReactNode
}) {
  const t = useTranslations('PartnerPortal.shell')

  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-navy text-navy-foreground">
        <div className="mx-auto flex w-full max-w-container flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:px-6">
          {/*
           * Die Marke führt auf die Wurzel des Portal-Hosts, NICHT auf die Marketing-Startseite:
           * innerhalb des Bereichs ist das Logo der Weg nach oben, und ein Sprung auf coolin.at
           * wäre mitten in der Arbeit ein Verlassen des Bereichs, das niemand beabsichtigt hat.
           * Natives `<a>` aus denselben Gründen wie in `nav.tsx`.
           */}
          <a
            href={PORTAL_HOST_ROOT}
            className="flex items-center gap-3 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-node focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
          >
            <EmblemImage size={36} className="h-9 w-9" />
            <WordmarkA className="h-9 w-auto" />
            <span className="sr-only">{t('home')}</span>
          </a>

          <span className="rounded-sm border border-node px-2 py-0.5 text-small font-semibold uppercase tracking-wide text-node">
            {t('badge')}
          </span>

          <div className="ml-auto flex items-center gap-3">
            {/*
             * Das angemeldete Konto steht hier bewusst NICHT — es steht als eigene Zeile im Reiter
             * „Allgemein", zusammen mit den übrigen Stammdaten. Zweimal dieselbe Adresse wäre eine
             * doppelte Auskunft; in der Kopfzeile hätte sie zudem keinen Kontext.
             */}
            <form action={signOutAction}>
              <Button type="submit" variant="secondary" size="sm">
                {t('signOut')}
              </Button>
            </form>
          </div>
        </div>
      </header>

      {active !== null && <PortalNav active={active} />}

      <main className="flex-1">{children}</main>
    </div>
  )
}
