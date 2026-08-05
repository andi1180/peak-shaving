import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container } from '@/components/ui/layout'
import { Button } from '@/components/ui/button'
import { AdminError, AdminPanel } from '@/components/admin/ui'
import {
  LeadIntakeForm,
  type MentionedBusinessOption,
  type PartnerOption,
} from '@/components/admin/lead-intake-form'
import { readPartnerList } from '@/lib/admin/partners'
import { readMentionedBusinessList } from '@/lib/admin/mentioned-businesses'
import { getActiveConsentText } from '@/lib/leads/store'
import { LEADS_HREF } from '@/lib/admin/leads'

/*
 * `/admin/leads/neu` — eine telefonisch hereingekommene Anfrage aufnehmen (B19).
 *
 * ── EIGENE SEITE, KEIN DIALOG ───────────────────────────────────────────────────────────────────
 * Der gesamte Admin-Bereich arbeitet mit Seiten: `leads/[id]`, `analysen/neu`, `partner-antraege/[id]`.
 * Ein Modal wäre hier zusätzlich unpraktisch — die Aufnahme läuft WÄHREND eines Telefonats, und ein
 * Dialog, der die Liste dahinter verdeckt und bei einem Klick daneben verschwindet, ist genau die
 * falsche Bauform für eine Eingabe, die zwei Minuten dauert und nicht verloren gehen darf.
 *
 * ── ⚠ DIESE SEITE VERSENDET KEINE E-MAIL ────────────────────────────────────────────────────────
 * Weder an den Interessenten noch intern. Sie importiert kein Mailmodul, und die Server Action
 * dahinter auch nicht (`lib/admin/lead-intake-actions.ts`). Begründung und Absicherung stehen im
 * Kopf von `lib/admin/lead-intake.ts`.
 */

export const dynamic = 'force-dynamic'

/** Neutral wie im Layout: der Tab-Titel darf nicht verraten, dass es hier etwas zu holen gibt. */
export const metadata: Metadata = {
  title: 'COOLiN ENERGY',
  robots: { index: false, follow: false },
}

export default async function NewLeadPage() {
  // Kein Zugang → gar keinen Inhalt erzeugen. Was der Nutzer stattdessen SIEHT, entscheidet das
  // Layout; hier geht es darum, dass nichts entsteht, das mitgeschickt werden kann.
  if (!(await isCurrentUserAdmin())) return null

  const supabase = await createClient()

  /*
   * Drei unabhängige Vorbereitungen. Jede darf fehlschlagen, ohne die Seite unbrauchbar zu machen:
   * Ohne Fachbetriebe entfällt die Zuordnung, ohne die formlos erfassten Firmen bleibt der Weg
   * „neue Firma eintragen" bestehen, ohne Wortlaut entfällt die Freigabe — die Aufnahme des Leads
   * selbst hängt an keinem der drei.
   */
  const [partnerRes, businessRes, disclosureText] = await Promise.all([
    supabase.rpc('admin_list_partners'),
    supabase.rpc('admin_list_mentioned_businesses'),
    /*
     * Der WORTLAUT der Freigabe kommt aus `platform.consent_texts` und nicht aus dieser Datei:
     * Angezeigter und archivierter Text müssen dieselbe Quelle haben (B1-1, append-only). Fehlt er,
     * rendert das Formular die Ankreuzmöglichkeit gar nicht erst — ohne den Text, dem zugestimmt
     * wird, darf keine Einwilligung entstehen. Dieselbe Regel wie auf der Partner-Landingpage.
     */
    getActiveConsentText('partner_lead_disclosure', 'de').catch((cause) => {
      console.error('[admin/lead-intake] get_active_consent_text:', cause)
      return null
    }),
  ])

  if (partnerRes.error) console.error('[admin/lead-intake] admin_list_partners:', partnerRes.error)
  if (businessRes.error) {
    console.error('[admin/lead-intake] admin_list_mentioned_businesses:', businessRes.error)
  }
  const partnerRows = readPartnerList(partnerRes.data)
  const businessRows = readMentionedBusinessList(businessRes.data)

  /*
   * Nur AKTIVE Betriebe stehen zur Wahl — ein stillgelegter darf keine neue Zuordnung mehr
   * bekommen (dieselbe Lesart wie `get_active_partner` und `capture_lead`). Die Server Action
   * prüft die Auswahl unabhängig davon ein zweites Mal: Ein `<option>`-Wert ist im Browser in
   * fünf Sekunden geändert.
   */
  const partners: PartnerOption[] = (partnerRows ?? [])
    .filter((partner) => partner.is_active)
    .map((partner) => ({ slug: partner.slug, displayName: partner.display_name }))

  /*
   * Die formlos erfassten Firmen kennen KEINE Stilllegung — es gibt kein `is_active`, und das ist
   * Absicht: Sie sind eine Notiz und kein Konto-Vorläufer (s. `lib/admin/mentioned-businesses.ts`).
   * Es wird deshalb auch nichts gefiltert.
   */
  const mentionedBusinesses: MentionedBusinessOption[] = (businessRows ?? []).map((business) => ({
    id: business.id,
    name: business.name,
  }))

  return (
    <Container className="py-10 sm:py-14">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h2 text-ink">Lead anlegen</h1>
        <Button asChild variant="secondary" size="md">
          <Link href={LEADS_HREF}>Zurück zur Liste</Link>
        </Button>
      </div>
      <p className="mt-2 max-w-2xl text-body text-text-muted">
        Für Anfragen, die telefonisch hereinkommen. Der Kontakt entsteht mit der Herkunft
        „Telefonische Anfrage (intern erfasst)“ und ist in der Liste dadurch von einer selbst
        abgeschickten Anfrage unterscheidbar.
      </p>

      <AdminPanel className="mt-6">
        {partnerRows === null && (
          <div className="mb-4">
            <AdminError>
              Die Fachbetriebe konnten nicht geladen werden. Der Lead lässt sich trotzdem anlegen —
              nur ohne Zuordnung und ohne Freigabe.
            </AdminError>
          </div>
        )}
        {businessRows === null && (
          <div className="mb-4">
            <AdminError>
              Die formlos erfassten Firmen konnten nicht geladen werden. Eine bestehende Firma lässt
              sich deshalb gerade nicht auswählen. „Neue Firma eintragen“ funktioniert weiterhin und
              findet eine gleich geschriebene bestehende Firma auch dann wieder.
            </AdminError>
          </div>
        )}
        <LeadIntakeForm
          partners={partners}
          mentionedBusinesses={mentionedBusinesses}
          partnerDisclosureConsentText={disclosureText?.body ?? null}
        />
      </AdminPanel>
    </Container>
  )
}
