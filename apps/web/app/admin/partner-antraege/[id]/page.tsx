import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container } from '@/components/ui/layout'
import { AdminError, AdminPanel, AdminSection, Pill, formatDateTime } from '@/components/admin/ui'
import { ActionButton } from '@/components/admin/action-button'
import {
  PARTNER_APPLICATIONS_HREF,
  PARTNER_APPLICATION_STATUS_LABEL,
  applicantName,
  readPartnerApplicationDetail,
} from '@/lib/admin/partner-applications'
import { rejectPartnerApplicationAction } from '@/lib/admin/partner-applications-actions'
import { PARTNERS_HREF, readPartnerList } from '@/lib/admin/partners'
import { PartnerApprovalForm } from '@/components/admin/partner-approval-form'

/*
 * `/admin/partner-antraege/[id]` — ein einzelner Antrag (B16-3, Genehmigung seit B16-4a).
 *
 * ── ALLE FELDER, INKLUSIVE FREITEXT ─────────────────────────────────────────────────────────────
 * Beim Genehmigen wird nichts davon erneut eingetippt: Firma, Ansprechperson, Adresse, Telefon,
 * Website und die Begründung stehen hier vollständig — und der Wrapper übernimmt Firma und Namen
 * direkt aus dem Antrag. Der Freitext ist der Grund, warum es diese Seite gibt.
 *
 * ── ZWEI ADRESSEN, GETRENNT AUSGEWIESEN ─────────────────────────────────────────────────────────
 * Die Adresse IM ANTRAG und die Adresse des VERKNÜPFTEN KONTOS können auseinandergehen: Wer
 * angemeldet einen Antrag stellt, kann eine abweichende Kontaktadresse eintragen. Sie werden
 * deshalb nicht verschmolzen — wer ein Konto freischaltet, muss sehen, WELCHES.
 *
 * ── DER GENEHMIGUNGSSCHRITT IST DER EINZIGE UNUMKEHRBARE VORGANG DIESES BEREICHS ────────────────
 * Er legt einen Fachbetrieb an (für den es für niemanden ein `delete`-Grant gibt), vergibt einen
 * Kurz-Key, der danach unveränderlich ist, und setzt den Antrag endgültig auf „genehmigt" — alles
 * in EINER Transaktion (`public.admin_approve_partner_application`, B16-4a). Deshalb: Vorschlag
 * statt Zwang, Verfügbarkeitsprüfung beim Tippen und ein ausdrückliches Häkchen davor.
 *
 * ── DREI ZUSTÄNDE, DIE DIE GENEHMIGUNG VERHINDERN, WERDEN VORHER GEZEIGT ────────────────────────
 * Kein Konto am Antrag · das Konto hängt schon an einem anderen Betrieb · der Antrag ist bereits
 * geprüft. Alle drei weist der Wrapper auch ab; sie hier erst NACH dem Bestätigen zu zeigen, wäre
 * bei einem nicht zurücknehmbaren Vorgang die falsche Reihenfolge.
 *
 * ── ABLEHNEN IST EINMALIG UND MIT RÜCKFRAGE ─────────────────────────────────────────────────────
 * `admin_reject_partner_application` weist einen bereits geprüften Antrag ab, statt den Zeitpunkt
 * zu überschreiben. Die Rückfrage steht davor, weil die Entscheidung über die Oberfläche nicht
 * zurückgenommen werden kann — dieselbe Abwägung wie beim Anonymisieren eines Leads (B1-3).
 */

export const dynamic = 'force-dynamic'

/** Neutral wie im Layout: der Tab-Titel darf nicht verraten, dass es hier etwas zu holen gibt. */
export const metadata: Metadata = {
  title: 'COOLiN ENERGY',
  robots: { index: false, follow: false },
}

function statusTone(status: string): 'warning' | 'positive' | 'neutral' {
  if (status === 'pending') return 'warning'
  if (status === 'approved') return 'positive'
  return 'neutral'
}

export default async function AdminPartnerApplicationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (!(await isCurrentUserAdmin())) return null

  const { id } = await params
  const supabase = await createClient()
  const res = await supabase.rpc('admin_get_partner_application', { p_id: id })
  if (res.error)
    console.error('[admin/partner-applications] admin_get_partner_application:', res.error)

  const application = readPartnerApplicationDetail(res.data)

  if (application === null || application === 'not_found') {
    return (
      <Container className="py-10 sm:py-14">
        <p className="text-small">
          <Link
            href={PARTNER_APPLICATIONS_HREF}
            className="text-accent underline decoration-accent underline-offset-[3px]"
          >
            ← Zurück zu den Anträgen
          </Link>
        </p>
        <div className="mt-6">
          <AdminError>
            {application === 'not_found'
              ? 'Diesen Antrag gibt es nicht.'
              : 'Der Antrag konnte nicht geladen werden. Das ist NICHT dasselbe wie „gibt es nicht" — bitte die Seite neu laden.'}
          </AdminError>
        </div>
      </Container>
    )
  }

  const name = applicantName(application)
  const offen = application.status === 'pending'

  /*
   * Die bereits vergebenen Kurz-Keys für die Verfügbarkeitsprüfung im Formular. Sie werden aus der
   * bestehenden Partnerliste gelesen und NICHT über einen eigenen Prüf-Wrapper: der wäre eine
   * zweite Definition von „vergeben" und könnte trotzdem nicht garantieren, dass der Key im Moment
   * des Bestätigens noch frei ist. Die harte Grenze bleibt `duplicate_slug` im Wrapper.
   *
   * Nur geladen, wenn überhaupt genehmigt werden kann — ein zweiter Datenbankaufruf auf einer Seite,
   * die nur anzeigt, wäre Aufwand ohne Ertrag.
   */
  const kannGenehmigtWerden = offen && application.user_id !== null && !application.account_partner_slug
  let takenSlugs: string[] = []
  if (kannGenehmigtWerden) {
    const partnerRes = await supabase.rpc('admin_list_partners')
    if (partnerRes.error) console.error('[admin/partner-applications] admin_list_partners:', partnerRes.error)
    takenSlugs = (readPartnerList(partnerRes.data) ?? []).map((p) => p.slug)
  }

  const felder: Array<[string, string]> = [
    ['Firma', application.company],
    ['Ansprechperson', name],
    ['E-Mail (Antrag)', application.email],
    ['Telefon', application.phone ?? '—'],
    ['Website', application.website ?? '—'],
    ['Eingegangen', formatDateTime(application.created_at)],
  ]

  return (
    <Container className="py-10 sm:py-14">
      <p className="text-small">
        <Link
          href={PARTNER_APPLICATIONS_HREF}
          className="text-accent underline decoration-accent underline-offset-[3px]"
        >
          ← Zurück zu den Anträgen
        </Link>
      </p>

      <header className="mt-6 flex flex-wrap items-start justify-between gap-4 border-b border-line pb-6">
        <div>
          <h1 className="text-h2 text-ink">{application.company}</h1>
          <p className="mt-2 text-body text-text-muted">
            {name} · {application.email}
          </p>
        </div>
        <Pill tone={statusTone(application.status)}>
          {PARTNER_APPLICATION_STATUS_LABEL[application.status]}
        </Pill>
      </header>

      <AdminSection id="antrag-angaben" title="Angaben des Betriebs">
        <AdminPanel>
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {felder.map(([label, value]) => (
              <div key={label}>
                <dt className="text-caption text-text-muted">{label}</dt>
                <dd className="text-small text-text">{value}</dd>
              </div>
            ))}
          </dl>
        </AdminPanel>
      </AdminSection>

      {/*
        DER FREITEXT BEKOMMT EINEN EIGENEN ABSCHNITT. Er ist die Grundlage der Prüfung, nicht ein
        Feld unter anderen — `whitespace-pre-wrap` erhält die Absätze, die der Betrieb geschrieben
        hat, ohne seinen Text in Markup zu übersetzen.
      */}
      <AdminSection
        id="antrag-freitext"
        title="Was der Betrieb schreibt"
        description={
          'Die Antwort auf „Was macht Ihr Betrieb, warum möchten Sie Partner werden?“ — ' +
          'Pflichtfeld im Formular.'
        }
      >
        <AdminPanel>
          <p className="whitespace-pre-wrap text-body text-text">{application.message}</p>
        </AdminPanel>
      </AdminSection>

      <AdminSection
        id="antrag-konto"
        title="Konto"
        description="Über dieses Konto läuft später die Freischaltung. Die Adresse kann von der im Antrag abweichen — wer angemeldet einen Antrag stellt, darf eine andere Kontaktadresse angeben."
      >
        <AdminPanel>
          {application.account_email ? (
            <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
              <div>
                <dt className="text-caption text-text-muted">E-Mail (Konto)</dt>
                <dd className="text-small text-text">{application.account_email}</dd>
              </div>
              <div>
                <dt className="text-caption text-text-muted">Konto-Kennung</dt>
                <dd className="break-all text-small text-text">{application.user_id}</dd>
              </div>
            </dl>
          ) : (
            /*
              Kein Konto ist ein echter Zustand und kein Fehler: Die Kontoanlage kann gescheitert
              sein (Rate-Limit, Ausfall), oder es gab mehrere Konten zu dieser Adresse und die
              Datenbank hat bewusst KEINES gewählt (B16-3-Migration). Der Antrag entsteht in beiden
              Fällen — was fehlt, ist die Verknüpfung, und die zieht B16-4 nach.
            */
            <p className="text-small text-text-muted">
              Mit diesem Antrag ist kein Konto verknüpft. Das kann zwei Gründe haben: Die
              Kontoanlage ist fehlgeschlagen (der Antrag entsteht trotzdem — eine verlorene
              Bewerbung wiegt schwerer), oder zu dieser Adresse gibt es mehrere Konten und keines
              wurde ausgewählt. Vor einer Freischaltung ist das zu klären.
            </p>
          )}
        </AdminPanel>
      </AdminSection>

      <AdminSection id="antrag-pruefung" title="Prüfung">
        <AdminPanel>
          {offen ? (
            <>
              {kannGenehmigtWerden ? (
                <PartnerApprovalForm
                  applicationId={application.id}
                  company={application.company}
                  takenSlugs={takenSlugs}
                />
              ) : application.user_id === null ? (
                /*
                 * ⚠ Real aufgetreten: `submit_partner_application` legt den Antrag auch dann an,
                 * wenn die Kontoanlage scheitert (gemessen am Rate-Limit des Mailversands) —
                 * bewusst, denn eine verlorene Bewerbung wiegt schwerer als eine fehlende
                 * Verknüpfung. Genehmigt entstünde daraus ein Fachbetrieb ohne Login, und der
                 * Kurz-Key wäre unwiderruflich verbraucht. Der Wrapper weist das ab (`no_account`);
                 * hier steht der Grund, BEVOR jemand einen Kurz-Key aussucht.
                 */
                <div className="rounded-md border border-warning-border bg-warning-subtle p-3">
                  <p className="max-w-prose text-small text-ink">
                    Genehmigen ist nicht möglich, solange kein Konto mit diesem Antrag verknüpft ist.
                    Es entstünde ein Fachbetrieb, in dessen Zugang sich niemand einloggen könnte —
                    und der Kurz-Key wäre verbraucht. Zwei Auswege: den Betrieb sich unter{' '}
                    <span className="text-text">/partner-werden</span> erneut bewerben lassen (dabei
                    entsteht das Konto), oder ihn unter{' '}
                    <Link
                      href={PARTNERS_HREF}
                      className="text-accent underline decoration-accent underline-offset-[3px]"
                    >
                      Partner
                    </Link>{' '}
                    von Hand anlegen und dort sein bestehendes Konto verknüpfen.
                  </p>
                </div>
              ) : (
                <div className="rounded-md border border-warning-border bg-warning-subtle p-3">
                  <p className="max-w-prose text-small text-ink">
                    Das Konto dieses Antrags gehört bereits zum Fachbetrieb{' '}
                    <span className="font-medium">{application.account_partner_slug}</span>. Ein
                    Konto kann derzeit nur an einem Betrieb hängen — genehmigen lässt sich der
                    Antrag deshalb nicht. Bitte prüfen, ob es sich um dieselbe Firma handelt; dann
                    ist hier nichts zu tun.
                  </p>
                </div>
              )}

              <div className="mt-5 border-t border-line pt-4">
                <ActionButton
                  action={rejectPartnerApplicationAction}
                  fields={{ id: application.id }}
                  label="Bewerbung ablehnen"
                  pendingLabel="Wird abgelehnt …"
                  /*
                    Rückfrage: Die Entscheidung lässt sich über die Oberfläche nicht zurücknehmen
                    (der Wrapper weist einen bereits geprüften Antrag ab, damit der Zeitpunkt der
                    ersten Entscheidung stehen bleibt).
                  */
                  confirm={`Bewerbung von „${application.company}" ablehnen? Die Entscheidung wird mit Ihrem Konto und dem Zeitpunkt festgehalten und lässt sich hier nicht zurücknehmen.`}
                  showSuccess
                />
                <p className="mt-3 max-w-prose text-caption text-text-muted">
                  Der Antrag bleibt danach vollständig stehen — abgelehnt heisst geprüft, nicht
                  gelöscht. Eine automatische Absagemail geht NICHT raus.
                </p>
              </div>
            </>
          ) : (
            <div>
              <p className="text-small text-text">
                Geprüft am {application.reviewed_at ? formatDateTime(application.reviewed_at) : '—'}
                {application.reviewed_by_email ? (
                  <> durch {application.reviewed_by_email}</>
                ) : (
                  /*
                    `reviewed_by` trägt `on delete set null`: Der VORGANG bleibt belegt, nur die
                    Zuschreibung entfällt, wenn das Konto des Prüfers gelöscht wurde. Dasselbe
                    Muster und dieselbe Formulierung wie bei `platform.leads.anonymized_by` (B1-3).
                  */
                  <> durch ein inzwischen gelöschtes Konto</>
                )}
                .
              </p>
              {/*
                Der ANGELEGTE Fachbetrieb steht hier, nicht nur der Status: sonst endete ein
                genehmigter Antrag in einer Sackgasse — man wüsste, dass entschieden wurde, aber
                nicht, welcher Kurz-Key dabei entstanden ist.

                Und der Satz, ohne den ein Admin den Vorgang für abgeschlossen hält: Der Betrieb ist
                NICHT benachrichtigt. Er wartet sonst auf eine Mail, die es noch nicht gibt.
              */}
              {application.status === 'approved' && application.partner_slug && (
                <div className="mt-4 rounded-md border border-line bg-surface-sunken p-3">
                  <p className="max-w-prose text-small text-text">
                    Angelegt als Fachbetrieb{' '}
                    <span className="font-medium">{application.partner_slug}</span> —{' '}
                    <Link
                      href={PARTNERS_HREF}
                      className="text-accent underline decoration-accent underline-offset-[3px]"
                    >
                      in der Partnerliste
                    </Link>{' '}
                    samt Empfehlungslink.
                  </p>
                  <p className="mt-2 max-w-prose text-caption text-text-muted">
                    <span className="font-medium text-text">
                      Der Betrieb wurde NICHT benachrichtigt.
                    </span>{' '}
                    Es geht keine automatische Nachricht raus — das Partner-Portal und die Mail dazu
                    kommen im nächsten Bauabschnitt. Bis dahin bitte selbst Kontakt aufnehmen und
                    den Empfehlungslink weitergeben.
                  </p>
                </div>
              )}
              <p className="mt-2 text-caption text-text-muted">
                Eine erneute Entscheidung ist hier nicht möglich — der Zeitpunkt der ersten bleibt
                stehen.
              </p>
            </div>
          )}
        </AdminPanel>
      </AdminSection>
    </Container>
  )
}
