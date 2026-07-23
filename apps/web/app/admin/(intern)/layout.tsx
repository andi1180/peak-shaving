import type { ReactNode } from 'react'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container } from '@/components/ui/layout'
import { AdminShell } from '@/components/admin/shell'
import { AdminRootShell, ADMIN_METADATA } from '@/components/admin/root-shell'

/*
 * Root-Layout UND Zugangsschranke des GESCHÜTZTEN Admin-Bereichs (T4-4; mit B17 aus
 * `app/admin/layout.tsx` in diese Route-Group gewandert, im VERHALTEN unverändert).
 *
 * WARUM DIE ROUTE-GROUP `(intern)`: Seit B17 gibt es unterhalb von `/admin` eine Route, die anonym
 * erreichbar sein MUSS — den Anmelde-Eingang. Läge die Schranke weiter im gemeinsamen Root-Layout,
 * umschlösse sie auch ihn und leitete ihn auf die Kundenanmeldung um; er wäre unerreichbar.
 * `(intern)` taucht in keiner URL auf, alle bestehenden Admin-Pfade sind wörtlich dieselben
 * geblieben. Warum es zwei GETRENNTE Root-Layouts sind statt eines gemeinsamen — mit Messung:
 * `components/admin/root-shell.tsx`.
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
 *  - keine Session  → Weiterleitung auf /anmelden (der Nutzer soll sich anmelden können). Die
 *    Umleitung steckt in `isCurrentUserAdmin` selbst und ist von B17 NICHT angefasst worden.
 *  - Session, aber kein Admin → eine neutrale Seite, KEINE Weiterleitung. Ein Redirect auf /anmelden
 *    ergäbe bei bestehender Session eine Endlosschleife (angemeldet → /admin → /anmelden → /konto),
 *    und der Text verrät nicht, dass es hier einen Verwaltungsbereich gibt: wer keinen Zugang hat,
 *    erfährt aus dieser Seite nicht, dass es etwas zu haben gäbe. Das gilt AUCH für jemanden, der
 *    gerade über `/admin/anmelden` gekommen ist — dieser Eingang gibt ihm keine Sonderbehandlung und
 *    sagt ihm insbesondere nicht, dass ihm eine Rolle fehlt.
 */

export const metadata = ADMIN_METADATA

/** getUser() + RPC je Aufruf: die Rolle wird live gelesen, ein Entzug greift sofort (I10). */
export const dynamic = 'force-dynamic'

export default async function AdminInternLayout({ children }: { children: ReactNode }) {
  // Leitet ohne Session selbst auf /anmelden um (J6) und liefert sonst die Rollen-Antwort.
  if (!(await isCurrentUserAdmin())) {
    return (
      <AdminRootShell>
        <Container className="py-24">
          <div className="mx-auto max-w-md text-center">
            <h1 className="text-h3 text-ink">Kein Zugriff</h1>
            <p className="mt-3 text-body text-text-muted">
              Diese Seite steht Ihrem Konto nicht zur Verfügung.
            </p>
          </div>
        </Container>
      </AdminRootShell>
    )
  }

  /*
   * Rahmen und Navigation stehen NUR im Zugangs-Zweig. Im Ablehnungs-Zweig oben gibt es sie bewusst
   * nicht: eine Leiste mit „Übersicht · Leads" verriete, was es hier zu holen gäbe — derselbe Grund,
   * aus dem der Seitentitel neutral bleibt.
   */
  return (
    <AdminRootShell>
      <AdminShell>{children}</AdminShell>
    </AdminRootShell>
  )
}
