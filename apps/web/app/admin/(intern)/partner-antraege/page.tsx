import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container } from '@/components/ui/layout'
import { Button } from '@/components/ui/button'
import { Label, Select } from '@/components/ui/input'
import { AdminError, AdminPanel, AdminSection, Pill, formatDateTime } from '@/components/admin/ui'
import {
  PARTNER_APPLICATIONS_HREF,
  PARTNER_APPLICATION_DETAIL_HREF,
  PARTNER_APPLICATION_STATUSES,
  PARTNER_APPLICATION_STATUS_LABEL,
  applicantName,
  isPartnerApplicationStatus,
  readPartnerApplicationList,
  type PartnerApplicationRow,
  type PartnerApplicationStatus,
} from '@/lib/admin/partner-applications'

/*
 * `/admin/partner-antraege` — der Prüf-Eingang der Partner-Bewerbungen (B16-3).
 *
 * ── WARUM EIN GESCHWISTERPFAD UND KEIN UNTERPFAD VON `/admin/partner` ───────────────────────────
 * `components/admin/nav.tsx` markiert einen Punkt als aktiv, wenn der Pfad mit ihm beginnt. Läge
 * dieser Eingang unter `/admin/partner/antraege`, wären BEIDE Punkte gleichzeitig markiert — genau
 * der Zustand, vor dem der Kommentar dort warnt. Fachlich sind es ohnehin zwei Dinge: „Partner" sind
 * die aufgenommenen Betriebe, hier stehen die, über die noch nicht entschieden ist.
 *
 * ── ENTSCHIEDEN WIRD AUF DER DETAILSEITE, NICHT IN DER LISTE ────────────────────────────────────
 * Genehmigen (seit B16-4a) legt einen Fachbetrieb an, vergibt einen unveränderlichen Kurz-Key und
 * setzt den Antrag endgültig — das verlangt den Freitext, die Kontoangaben und einen
 * Bestätigungsschritt und gehört deshalb dorthin, wo alles davon steht. Eine Sammelaktion in der
 * Liste gibt es aus demselben Grund nicht.
 *
 * ── DER FILTER IST EIN ECHTES GET-FORMULAR ──────────────────────────────────────────────────────
 * Kein Client-Zustand, keine Server Action: der Filter IST die URL. Damit funktioniert die Ansicht
 * ohne JavaScript, ist teilbar und kann nicht mit der Adresszeile auseinanderlaufen (Muster
 * `/admin/leads`, B1-3).
 *
 * ── DER FREITEXT STEHT SCHON IN DER LISTE ───────────────────────────────────────────────────────
 * Er ist der Grund, warum jemand einen Antrag überhaupt öffnet. Ihn erst im Detail zu zeigen hiesse,
 * jede Bewerbung einzeln anzuklicken, um zu erfahren, worum es geht. Gekürzt wird er in der
 * Übersicht auf ein paar Zeilen (`line-clamp`) — nicht im Datenpfad, sondern in der Darstellung.
 *
 * Die Zugangsprüfung läuft über dieselbe Funktion wie im Layout (`isCurrentUserAdmin`). Sie ist hier
 * NICHT redundant: dass das Layout `children` nicht rendert, verhindert nicht, dass diese Seite
 * gerendert und ins RSC-Flight-Payload geschrieben wird (ausführlich: `lib/admin/guard.ts`).
 */

export const dynamic = 'force-dynamic'

/** Neutral wie im Layout: der Tab-Titel darf nicht verraten, dass es hier etwas zu holen gibt. */
export const metadata: Metadata = {
  title: 'COOLiN ENERGY',
  robots: { index: false, follow: false },
}

const PAGE_SIZE = 50

function pageHref(status: PartnerApplicationStatus | null, page: number): string {
  const sp = new URLSearchParams()
  if (status) sp.set('status', status)
  if (page > 1) sp.set('seite', String(page))
  const qs = sp.toString()
  return qs ? `${PARTNER_APPLICATIONS_HREF}?${qs}` : PARTNER_APPLICATIONS_HREF
}

/**
 * „Offen" trägt den Warnton, nicht den neutralen: Ein unbearbeiteter Antrag ist der einzige Zustand
 * dieser Liste, der eine Handlung verlangt. Abgelehnt ist neutral (erledigt, kein Fehler).
 */
function statusTone(status: PartnerApplicationStatus): 'warning' | 'positive' | 'neutral' {
  if (status === 'pending') return 'warning'
  if (status === 'approved') return 'positive'
  return 'neutral'
}

export default async function AdminPartnerApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!(await isCurrentUserAdmin())) return null

  const query = await searchParams
  const rawStatus = typeof query.status === 'string' ? query.status : undefined
  /*
   * Ein unbekannter Wert wird NICHT stillschweigend auf „alle" zurückgesetzt: Er geht an die
   * Datenbank, und die antwortet mit `invalid_filter`. Sonst hielte man ein ungefiltertes Ergebnis
   * für ein gefiltertes (dieselbe Regel wie in `admin_list_leads`, B1-3).
   */
  const status = isPartnerApplicationStatus(rawStatus) ? rawStatus : null
  const page = Math.max(1, Number(typeof query.seite === 'string' ? query.seite : '1') || 1)

  const supabase = await createClient()
  const res = await supabase.rpc('admin_list_partner_applications', {
    p_status: rawStatus ?? undefined,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  })
  if (res.error)
    console.error('[admin/partner-applications] admin_list_partner_applications:', res.error)

  const list = readPartnerApplicationList(res.data)
  const pages =
    list && list !== 'invalid_filter' ? Math.max(1, Math.ceil(list.total / PAGE_SIZE)) : 1

  return (
    <Container className="py-10 sm:py-14">
      <header className="border-b border-line pb-6">
        <h1 className="text-h2 text-ink">Partner-Anträge</h1>
        <p className="mt-2 max-w-prose text-body text-text-muted">
          Bewerbungen von Fachbetrieben über <span className="text-text">/partner-werden</span>. Zu
          jedem Antrag gehört ein Konto — angelegt bei der Bewerbung oder schon vorhanden.
        </p>
        {/*
          Wo entschieden wird, steht im Klartext — sonst sucht man die Knöpfe in der Liste. Und der
          Hinweis, ohne den ein genehmigter Antrag für abgeschlossen gehalten wird: es geht keine
          Nachricht an den Betrieb raus.
        */}
        <p className="mt-3 max-w-prose text-small text-text-muted">
          Genehmigt und abgelehnt wird auf der Detailseite eines Antrags. Beim Genehmigen entsteht
          ein Fachbetrieb mit einem Kurz-Key, der danach{' '}
          <span className="text-text">unveränderlich</span> ist. Eine Nachricht an den Betrieb geht
          dabei <span className="text-text">nicht</span> automatisch raus.
        </p>
      </header>

      <AdminSection
        id="antraege-filter"
        title="Anträge"
        description="Neueste zuerst. Der Freitext steht schon hier — er ist der Grund, einen Antrag zu öffnen."
      >
        <AdminPanel>
          {/* Echtes GET-Formular: der Filter IST die URL (s. Kopf). */}
          <form
            method="get"
            action={PARTNER_APPLICATIONS_HREF}
            className="flex flex-wrap items-end gap-4"
          >
            <div>
              <Label htmlFor="status">Status</Label>
              <div className="mt-1.5">
                <Select id="status" name="status" defaultValue={rawStatus ?? ''}>
                  <option value="">Alle</option>
                  {PARTNER_APPLICATION_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {PARTNER_APPLICATION_STATUS_LABEL[value]}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <Button type="submit" variant="secondary" size="md">
              Filtern
            </Button>
            {status && (
              <Link
                href={PARTNER_APPLICATIONS_HREF}
                className="text-small text-accent underline decoration-accent underline-offset-[3px]"
              >
                Filter zurücksetzen
              </Link>
            )}
          </form>
        </AdminPanel>

        {list === 'invalid_filter' ? (
          <AdminError>
            Der Statusfilter „{rawStatus}" ist unbekannt. Die Liste zeigt deshalb NICHTS — ein
            ungefiltertes Ergebnis wäre hier als gefiltertes zu lesen.
          </AdminError>
        ) : list === null ? (
          <AdminError>
            Die Antragsliste konnte nicht geladen werden. Das ist NICHT dasselbe wie „es gibt keine
            Anträge" — bitte die Seite neu laden.
          </AdminError>
        ) : list.applications.length === 0 ? (
          <AdminPanel>
            <p className="text-small text-text-muted">
              {status
                ? `Keine Anträge mit dem Status „${PARTNER_APPLICATION_STATUS_LABEL[status]}".`
                : 'Noch keine Bewerbung eingegangen.'}
            </p>
          </AdminPanel>
        ) : (
          <>
            <p className="mb-4 text-small text-text-muted">
              {list.total} {list.total === 1 ? 'Antrag' : 'Anträge'}
              {status ? ` mit dem Status „${PARTNER_APPLICATION_STATUS_LABEL[status]}"` : ''}
            </p>
            <ul className="flex flex-col gap-4">
              {list.applications.map((application) => (
                <li key={application.id}>
                  <ApplicationCard application={application} />
                </li>
              ))}
            </ul>

            {pages > 1 && (
              <nav aria-label="Seiten" className="mt-6 flex items-center gap-4">
                {page > 1 && (
                  <Link
                    href={pageHref(status, page - 1)}
                    className="text-small text-accent underline decoration-accent underline-offset-[3px]"
                  >
                    Zurück
                  </Link>
                )}
                <span className="text-small tabular-nums text-text-muted">
                  Seite {page} von {pages}
                </span>
                {page < pages && (
                  <Link
                    href={pageHref(status, page + 1)}
                    className="text-small text-accent underline decoration-accent underline-offset-[3px]"
                  >
                    Weiter
                  </Link>
                )}
              </nav>
            )}
          </>
        )}
      </AdminSection>
    </Container>
  )
}

function ApplicationCard({ application }: { application: PartnerApplicationRow }) {
  const name = applicantName(application)

  return (
    <AdminPanel>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-h4 text-ink">
            <Link
              href={PARTNER_APPLICATION_DETAIL_HREF(application.id)}
              className="underline decoration-line-strong underline-offset-4 hover:decoration-accent"
            >
              {application.company}
            </Link>
          </h3>
          <p className="mt-1 text-caption text-text-muted">
            {name} · {application.email} · eingegangen {formatDateTime(application.created_at)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/*
            Das Kontokennzeichen steht neben dem Status, weil es die Frage beantwortet, die beim
            Genehmigen als Erste kommt: Gibt es überhaupt ein Konto zum Freischalten?
          */}
          {application.has_account ? (
            <Pill tone="neutral">Konto verknüpft</Pill>
          ) : (
            <Pill tone="warning">ohne Konto</Pill>
          )}
          <Pill tone={statusTone(application.status)}>
            {PARTNER_APPLICATION_STATUS_LABEL[application.status]}
          </Pill>
        </div>
      </div>

      {/*
        Gekürzt in der DARSTELLUNG, nicht im Datenpfad: die Detailseite zeigt denselben Text
        vollständig, und die Liste soll überflogen werden können.
      */}
      <p className="mt-4 line-clamp-3 whitespace-pre-wrap text-small text-text">
        {application.message}
      </p>

      <p className="mt-4">
        <Link
          href={PARTNER_APPLICATION_DETAIL_HREF(application.id)}
          className="text-small text-accent underline decoration-accent underline-offset-[3px]"
        >
          Antrag ansehen
        </Link>
      </p>
    </AdminPanel>
  )
}
