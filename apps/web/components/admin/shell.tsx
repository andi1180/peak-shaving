import type { ReactNode } from 'react'
import { EmblemImage } from '@/components/brand/emblem-image'
import { WordmarkA } from '@/components/brand/wordmark'
import { Button } from '@/components/ui/button'
import { adminSignOutAction } from '@/lib/admin/actions'
import { ADMIN_HREF } from '@/lib/admin/config'
import { ADMIN_NAV_ITEMS } from '@/lib/admin/nav'
import { currentUserEmail } from '@/lib/admin/session'
import { AdminNav } from './nav'

/**
 * Der Rahmen des Admin-Bereichs (B17): Kopfzeile mit Marke, Bereichskennzeichnung, angemeldetem
 * Konto und Abmeldung — darunter die Navigation.
 *
 * ── ER WIRD AUSSCHLIESSLICH IM ZUGANGS-ZWEIG GERENDERT ───────────────────────────────────────────
 * Aufgerufen wird er an genau EINER Stelle: in `app/admin/(intern)/layout.tsx`, NACH der bestandenen
 * Rollenprüfung. Weder die „Kein Zugriff"-Antwort noch der Anmelde-Eingang bekommen ihn zu sehen.
 * Das ist keine Kosmetik: eine Leiste mit „Leads · Analysen · Partner-Anträge" verriete jedem, der
 * die Adresse kennt, was es hier zu holen gäbe — derselbe Grund, aus dem der Seitentitel des
 * geschützten Zweigs seit T4-4 nichtssagend bleibt. Die Beschriftungen kommen deshalb auch nicht aus
 * der Client-Datei, sondern aus `lib/admin/nav.ts` (Begründung dort).
 *
 * ── EIGENER CHARAKTER, DASSELBE GESTALTUNGSSYSTEM ────────────────────────────────────────────────
 * Navy-Kopfzeile statt der weissen Kopfzeile des öffentlichen Auftritts — es soll nie ein Zweifel
 * bestehen, ob man gerade die Kundensicht oder die Verwaltung vor sich hat. Farben, Schrift und
 * Primitives sind dabei unverändert die des übrigen `apps/web` (`bg-navy`, `WordmarkA`, `Button`);
 * ein zweites Designsystem entsteht nicht.
 *
 * Server-Komponente: sie liest die Sitzung und die Bereichsliste. Interaktiv ist allein die
 * Navigation (`AdminNav`, wegen `usePathname`).
 */
export async function AdminShell({ children }: { children: ReactNode }) {
  const email = await currentUserEmail()

  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-navy text-navy-foreground">
        <div className="mx-auto flex w-full max-w-container flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:px-6">
          {/*
           * Die Marke führt auf die Admin-Übersicht, NICHT auf die Startseite: innerhalb des
           * Bereichs ist das Logo der Weg nach oben, und ein Sprung auf die Marketingseite wäre
           * mitten in der Arbeit ein Verlassen des Bereichs, das niemand beabsichtigt hat.
           */}
          <a
            href={ADMIN_HREF}
            className="flex items-center gap-3 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-node focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
          >
            <EmblemImage size={36} className="h-9 w-9" />
            <WordmarkA className="h-9 w-auto" />
            <span className="sr-only">Zur Übersicht</span>
          </a>

          {/*
           * Die Kennzeichnung steht NEBEN der Marke und nicht im Seitentitel: der Titel bleibt
           * bewusst nichtssagend (s. `app/admin/layout.tsx`), sichtbar sein muss sie trotzdem — für
           * die, die den Bereich sehen dürfen.
           */}
          <span className="rounded-sm border border-node px-2 py-0.5 text-small font-semibold uppercase tracking-wide text-node">
            Admin-Bereich
          </span>

          <div className="ml-auto flex items-center gap-3">
            {/*
             * Welches Konto gerade arbeitet, gehört sichtbar in die Kopfzeile: Rollen hängen an
             * genau EINEM Konto, und wer mit dem falschen von zweien angemeldet ist, sucht den
             * Fehler sonst bei den Rechten statt bei der Anmeldung (dieselbe Überlegung wie beim
             * Kalkulator-Zugang, B10-2). Fehlt die Adresse, steht hier nichts — geraten wird nicht.
             */}
            {/*
             * `text-white/70` und NICHT `text-navy-foreground/70`: Tailwind verwirft ein `/alpha`
             * auf `var()`-Hex-Tokens still (DESIGN.md) — die Abschwächung fiele ersatzlos weg, ohne
             * Fehler. `--color-on-navy` IST #ffffff, die beiden sagen hier also dasselbe.
             */}
            {email && (
              <span className="hidden max-w-[16rem] truncate text-small text-white/70 sm:inline">
                {email}
              </span>
            )}
            <form action={adminSignOutAction}>
              <Button type="submit" variant="secondary" size="sm">
                Abmelden
              </Button>
            </form>
          </div>
        </div>
      </header>

      <AdminNav items={ADMIN_NAV_ITEMS} />

      <main className="flex-1">{children}</main>
    </div>
  )
}
