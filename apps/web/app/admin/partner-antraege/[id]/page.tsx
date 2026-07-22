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
import { PARTNERS_HREF } from '@/lib/admin/partners'

/*
 * `/admin/partner-antraege/[id]` — ein einzelner Antrag (B16-3).
 *
 * ── ALLE FELDER, INKLUSIVE FREITEXT ─────────────────────────────────────────────────────────────
 * Beim Genehmigen in B16-4 wird nichts davon erneut eingetippt: Firma, Ansprechperson, Adresse,
 * Telefon, Website und die Begründung stehen hier vollständig. Der Freitext ist der Grund, warum es
 * diese Seite gibt.
 *
 * ── ZWEI ADRESSEN, GETRENNT AUSGEWIESEN ─────────────────────────────────────────────────────────
 * Die Adresse IM ANTRAG und die Adresse des VERKNÜPFTEN KONTOS können auseinandergehen: Wer
 * angemeldet einen Antrag stellt, kann eine abweichende Kontaktadresse eintragen. Sie werden
 * deshalb nicht verschmolzen — wer in B16-4 ein Konto freischaltet, muss sehen, WELCHES.
 *
 * ── ES GIBT NUR EINE HANDLUNG: ABLEHNEN ─────────────────────────────────────────────────────────
 * Kein Genehmigen-Knopf, und das steht als Satz auf der Seite statt als stille Lücke. Genehmigen
 * erzeugt in B16-4 einen Partner, einen Slug und eine Freischaltung; ein Knopf, der jetzt nur den
 * Status setzte, hinterliesse einen genehmigten Antrag ohne Partner. Die Grenze liegt tiefer als
 * hier: in der Datenbank gibt es keinen Wrapper dafür (B16-3-Migration).
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
              {/*
                Der fehlende Genehmigen-Weg steht im Klartext, damit niemand ihn für einen
                vergessenen Knopf hält.
              */}
              <p className="max-w-prose text-small text-text-muted">
                Genehmigen ist hier noch nicht möglich. Dabei entstehen ein Partnereintrag, ein
                Kurz-Key und die Freischaltung des Kontos — das kommt im nächsten Bauabschnitt. Bis
                dahin lässt sich ein Fachbetrieb bei Bedarf von Hand unter{' '}
                <Link
                  href={PARTNERS_HREF}
                  className="text-accent underline decoration-accent underline-offset-[3px]"
                >
                  Partner
                </Link>{' '}
                anlegen; der Antrag bleibt dann offen stehen.
              </p>

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
