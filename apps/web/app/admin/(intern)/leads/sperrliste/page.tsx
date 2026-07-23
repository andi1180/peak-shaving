import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container, Num } from '@/components/ui/layout'
import { AdminError, AdminPanel, AdminSection } from '@/components/admin/ui'
import { SuppressionLookup } from '@/components/admin/suppression-lookup'
import { LEADS_HREF } from '@/lib/admin/leads'

/*
 * `/admin/leads/sperrliste` — Anzahl der Sperren und die Einzelabfrage (B1-3).
 *
 * ── WARUM ES HIER KEINE LISTE GIBT ───────────────────────────────────────────────────────────────
 * `platform.email_suppressions` speichert ausschliesslich den SHA-256 der normalisierten Adresse,
 * ohne Klartext und ohne Verbindung zum Lead (B1-1). Das ist Absicht: eine Liste von Menschen, die
 * „schreiben Sie mir nicht mehr" gesagt haben, wäre als Klartextliste die wertvollste und
 * gefährlichste Adressliste im ganzen System. Eine Aufstellung von Hashes wiederum ist für Menschen
 * nicht lesbar. Übrig bleiben genau zwei sinnvolle Aussagen: WIE VIELE Sperren es gibt, und ob EINE
 * konkrete Adresse dabei ist. Beides steht auf dieser Seite.
 *
 * Der Preis ist bekannt und angenommen (B1-1): wer eine Adresse RÄT, kann sie hier verifizieren.
 * Deshalb ist auch diese Auskunft admin-only — für `authenticated` wäre sie ein Orakel.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'COOLiN ENERGY',
  robots: { index: false, follow: false },
}

export default async function AdminSuppressionsPage() {
  if (!(await isCurrentUserAdmin())) return null

  const supabase = await createClient()
  const res = await supabase.rpc('admin_suppression_count')
  if (res.error) console.error('[admin/leads] admin_suppression_count:', res.error)

  const data = res.data as { status?: string; count?: number } | null
  const count = data?.status === 'ok' && typeof data.count === 'number' ? data.count : null

  return (
    <Container className="py-10 sm:py-14">
      <header className="border-b border-line pb-6">
        <Link
          href={LEADS_HREF}
          className="rounded-sm text-small text-accent underline decoration-accent underline-offset-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          ← Zurück zur Liste
        </Link>
        <h1 className="mt-3 text-h2 text-ink">Sperrliste</h1>
        <p className="mt-2 max-w-prose text-body text-text-muted">
          Adressen, an die keine Aussendung mehr gehen darf — aus einer Abmeldung, einer dauerhaften
          Unzustellbarkeit, einer Beschwerde oder einer händischen Sperre.
        </p>
      </header>

      <AdminSection id="anzahl" title="Umfang">
        <AdminPanel>
          {count === null ? (
            <AdminError>
              Die Anzahl der Sperren konnte nicht geladen werden. Bitte laden Sie die Seite neu.
            </AdminError>
          ) : (
            <>
              <p className="text-h2 text-ink">
                <Num>{count}</Num>
              </p>
              <p className="mt-1 text-small text-text-muted">
                {count === 1 ? 'gesperrte Adresse' : 'gesperrte Adressen'}
              </p>
            </>
          )}
        </AdminPanel>
      </AdminSection>

      <AdminSection
        id="abfrage"
        title="Einzelne Adresse nachsehen"
        description="Die Sperrliste enthält nur Prüfsummen der Adressen, keinen Klartext — eine Aufstellung wäre für Menschen unlesbar und als Klartextliste die gefährlichste Adressliste im System. Deshalb die Einzelabfrage: sie ist die einzige sinnvolle Darstellung, nicht eine Notlösung."
      >
        <AdminPanel>
          <SuppressionLookup />
        </AdminPanel>

        <p className="mt-4 max-w-prose text-caption text-text-muted">
          Eine Sperre lässt sich hier nicht aufheben. Sie entsteht durch die Abmeldung der Person
          oder über „Adresse dauerhaft sperren“ auf einer Lead-Seite und überlebt bewusst jede
          spätere Löschung des Leads — sonst stünde die Person nach dem nächsten Import wieder im
          Verteiler.
        </p>
      </AdminSection>
    </Container>
  )
}
