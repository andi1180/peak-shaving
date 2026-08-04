import type { Metadata } from 'next'
import Link from 'next/link'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container } from '@/components/ui/layout'
import { AdminError, AdminPanel, AdminSection, Pill, formatDateTime } from '@/components/admin/ui'
import { ActionButton } from '@/components/admin/action-button'
import {
  CALCULATOR_REQUESTS_HREF,
  CALCULATOR_REQUEST_STATUS_LABEL,
  type CalculatorRequestStatus,
} from '@/lib/admin/calculator-requests'
import { findCalculatorRequest } from '@/lib/admin/calculator-requests-server'
import { decideCalculatorRequestAction } from '@/lib/admin/calculator-requests-actions'
import { PARTNERS_HREF } from '@/lib/admin/partners'

/*
 * `/admin/kalkulator-anfragen/[id]` — eine einzelne Anfrage und die Entscheidung darüber (B18-4).
 *
 * ── HIER WIRD ENTSCHIEDEN, NICHT IN DER LISTE ───────────────────────────────────────────────────
 * Freigeben vergibt ein `calculator_pro`-Entitlement — in DERSELBEN Transaktion, in der der Status
 * gesetzt wird (`public.admin_decide_calculator_request`, B18-4). Das ist kein Häkchen in einer
 * Tabelle: Es gibt über die Oberfläche keinen Weg zurück (ein zweiter Aufruf antwortet
 * `already_reviewed`), und die Begründung des Betriebs ist die Grundlage der Entscheidung. Deshalb
 * steht sie hier vollständig, und beide Schaltflächen stehen daneben.
 *
 * ── DIE ANFRAGE WIRD ÜBER DIE LISTE GELESEN ─────────────────────────────────────────────────────
 * Es gibt bewusst keinen `admin_get_calculator_request`-Wrapper — B18-4 legt genau vier an, und die
 * sind fertig und live; für diesen Schritt wird an der Datenbank nichts geändert.
 * `findCalculatorRequest` sucht die Zeile deshalb seitenweise über
 * `admin_list_calculator_requests` heraus und BENENNT die Obergrenze, statt bei ihrem Erreichen
 * „gibt es nicht" zu behaupten.
 *
 * ── ZWEI ZUSTÄNDE, DIE VOR DEM KLICK SICHTBAR SEIN MÜSSEN ───────────────────────────────────────
 * Kein Konto am Fachbetrieb (die Datenbank weist eine Freigabe dann mit `no_account` ab — Ablehnen
 * bleibt möglich und ist der einzige Weg, eine gegenstandslose Anfrage zu schliessen) und ein
 * stillgelegter Betrieb (der bleibt ausdrücklich entscheidbar: die Stilllegung betrifft die
 * Empfehlungslinks, nicht das Werkzeug — der Admin soll es nur wissen).
 *
 * ── DER BENACHRICHTIGUNGS-ZUSTAND WIRD ANGEZEIGT, NICHT NACHGEBAUT ──────────────────────────────
 * Der Ablauf „erst senden, dann vermerken" ist gebaut (`lib/partner-portal/calculator-request-notify.ts`)
 * und läuft im Zuge der Freigabe. Hier steht ausschliesslich das Ergebnis: `notified_at` gesetzt =
 * die Mail ist zugestellt. Es gibt bewusst KEINE Schaltfläche „erneut senden" — anders als beim
 * Partner-Portal (B16-4b) entsteht der Vermerk hier ausschliesslich im Ablauf der Entscheidung, und
 * ein zweiter Auslöser wäre ein zweiter Weg zu derselben Mail.
 *
 * ── ⚠ DIE ERFOLGSMELDUNG DER ENTSCHEIDUNG IST FLÜCHTIG — GEMESSEN, NICHT VERMUTET ───────────────
 * Die Schaltflächen werden nur gerendert, solange die Anfrage offen ist. Mit dem Erfolg wechselt der
 * Status, die Knöpfe verschwinden — und mit ihnen ihr `useActionState` samt Meldung. Im Browserlauf
 * beobachtet: nach dem Klick steht kein `role="status"`-Text mehr da. Das ist derselbe Fall wie in
 * B16-4b, und die Antwort ist dieselbe: NICHT eine flüchtige Meldung länger stehen lassen, sondern
 * einen dauerhaft lesbaren Zustand zeigen. Genau das ist der Block unten — er sagt nach jedem
 * Neuladen, dass der Zugang vergeben ist UND ob die Mail angekommen ist. Ausgerechnet der Satz, den
 * niemand verpassen darf („der Betrieb weiss noch nichts davon"), hängt damit nicht an einem
 * Render, der gerade wegfällt.
 */

export const dynamic = 'force-dynamic'

/** Neutral wie im Layout: der Tab-Titel darf nicht verraten, dass es hier etwas zu holen gibt. */
export const metadata: Metadata = {
  title: 'COOLiN ENERGY',
  robots: { index: false, follow: false },
}

function statusTone(status: CalculatorRequestStatus): 'warning' | 'positive' | 'neutral' {
  if (status === 'pending') return 'warning'
  if (status === 'approved') return 'positive'
  return 'neutral'
}

function BackLink() {
  return (
    <p className="text-small">
      <Link
        href={CALCULATOR_REQUESTS_HREF}
        className="text-accent underline decoration-accent underline-offset-[3px]"
      >
        ← Zurück zu den Kalkulator-Anfragen
      </Link>
    </p>
  )
}

export default async function AdminCalculatorRequestPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (!(await isCurrentUserAdmin())) return null

  const { id } = await params
  const lookup = await findCalculatorRequest(id)

  if (lookup.status !== 'ok') {
    return (
      <Container className="py-10 sm:py-14">
        <BackLink />
        <div className="mt-6">
          <AdminError>
            {lookup.status === 'not_found' ? (
              'Diese Anfrage gibt es nicht.'
            ) : lookup.status === 'truncated' ? (
              <>
                Diese Anfrage steht nicht unter den neuesten {lookup.scanned} von {lookup.total}{' '}
                Anfragen. Das heisst NICHT, dass es sie nicht gibt — die Suche bricht hier bewusst
                ab, statt Vollständigkeit vorzutäuschen. Bitte über die Liste danach suchen.
              </>
            ) : (
              'Die Anfrage konnte nicht geladen werden. Das ist NICHT dasselbe wie „gibt es nicht" — bitte die Seite neu laden.'
            )}
          </AdminError>
        </div>
      </Container>
    )
  }

  const request = lookup.request
  const name = request.partnerDisplayName ?? request.partnerSlug
  const offen = request.status === 'pending'

  return (
    <Container className="py-10 sm:py-14">
      <BackLink />

      <header className="mt-6 flex flex-wrap items-start justify-between gap-4 border-b border-line pb-6">
        <div>
          <h1 className="text-h2 text-ink">{name}</h1>
          <p className="mt-2 text-body text-text-muted">
            Kalkulator-Anfrage · eingegangen {formatDateTime(request.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!request.partnerIsActive && <Pill tone="neutral">Betrieb stillgelegt</Pill>}
          <Pill tone={statusTone(request.status)}>
            {CALCULATOR_REQUEST_STATUS_LABEL[request.status]}
          </Pill>
        </div>
      </header>

      <AdminSection
        id="anfrage-partner"
        title="Fachbetrieb"
        description="An dieses Konto geht der Zugang. Ohne Konto lässt sich nichts freigeben — ein Entitlement hängt immer an genau einem Konto."
      >
        <AdminPanel>
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <div>
              <dt className="text-caption text-text-muted">Anzeigename</dt>
              <dd className="text-small text-text">{request.partnerDisplayName ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-caption text-text-muted">Kurz-Key</dt>
              <dd className="text-small text-text">{request.partnerSlug}</dd>
            </div>
            <div>
              <dt className="text-caption text-text-muted">E-Mail (Konto)</dt>
              <dd className="text-small text-text">{request.accountEmail ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-caption text-text-muted">Status des Betriebs</dt>
              <dd className="text-small text-text">
                {request.partnerIsActive ? 'aktiv' : 'stillgelegt'}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-small">
            <Link
              href={PARTNERS_HREF}
              className="text-accent underline decoration-accent underline-offset-[3px]"
            >
              Zu den Fachbetrieben
            </Link>
          </p>
          {!request.partnerIsActive && (
            /*
             * Der Betrieb ist stillgelegt und die Anfrage trotzdem entscheidbar — das ist Absicht
             * (B18-4, TEIL 4). Wer den Zustand nicht kennt, entscheidet sonst blind.
             */
            <p className="mt-3 max-w-prose text-caption text-text-muted">
              Dieser Fachbetrieb ist stillgelegt: Seine Empfehlungslinks führen ins Leere. Über die
              Anfrage lässt sich trotzdem entscheiden — die Stilllegung betrifft die Empfehlungen,
              nicht das Werkzeug. Bitte bewusst entscheiden.
            </p>
          )}
        </AdminPanel>
      </AdminSection>

      {/*
        DIE BEGRÜNDUNG BEKOMMT EINEN EIGENEN ABSCHNITT. Sie ist die Grundlage der Entscheidung, nicht
        ein Feld unter anderen — `whitespace-pre-wrap` erhält die Absätze des Betriebs, ohne seinen
        Text in Markup zu übersetzen.
      */}
      <AdminSection
        id="anfrage-begruendung"
        title="Was der Betrieb schreibt"
        description="Pflicht-Freitext aus dem Partner-Portal — die Antwort auf „Wofür brauchen Sie den Kalkulator?“."
      >
        <AdminPanel>
          <p className="whitespace-pre-wrap text-body text-text">{request.message}</p>
        </AdminPanel>
      </AdminSection>

      <AdminSection id="anfrage-entscheidung" title="Entscheidung">
        <AdminPanel>
          {offen ? (
            <>
              {!request.accountEmail && (
                <div className="mb-5 rounded-md border border-warning-border bg-warning-subtle p-3">
                  <p className="max-w-prose text-small text-ink">
                    Freigeben ist nicht möglich: An diesem Fachbetrieb hängt kein Konto (mehr) — ein
                    Zugang hängt immer an einem Konto, es gäbe also nichts freizuschalten. Bitte
                    unter{' '}
                    <Link
                      href={PARTNERS_HREF}
                      className="text-accent underline decoration-accent underline-offset-[3px]"
                    >
                      Partner
                    </Link>{' '}
                    ein Konto verknüpfen. Ablehnen ist weiterhin möglich und der einzige Weg, eine
                    gegenstandslose Anfrage zu schliessen.
                  </p>
                </div>
              )}

              <div className="flex flex-wrap items-start gap-4">
                <ActionButton
                  action={decideCalculatorRequestAction}
                  fields={{ id: request.id, entscheidung: 'approved' }}
                  label="Zugang freigeben"
                  pendingLabel="Wird freigegeben …"
                  variant="primary"
                  /*
                    Rückfrage: Die Freigabe vergibt einen Produktzugang und lässt sich über die
                    Oberfläche nicht zurücknehmen — dieselbe Abwägung wie beim Genehmigen einer
                    Partner-Bewerbung (B16-4a).
                  */
                  confirm={`Kalkulator-Zugang für „${name}" freigeben? Das Konto bekommt sofort Zugang und eine E-Mail darüber. Die Entscheidung wird mit Ihrem Konto festgehalten und lässt sich hier nicht zurücknehmen.`}
                  showSuccess
                />
                <ActionButton
                  action={decideCalculatorRequestAction}
                  fields={{ id: request.id, entscheidung: 'rejected' }}
                  label="Anfrage ablehnen"
                  pendingLabel="Wird abgelehnt …"
                  confirm={`Anfrage von „${name}" ablehnen? Es entsteht kein Zugang, und es geht keine Nachricht an den Betrieb. Die Entscheidung lässt sich hier nicht zurücknehmen.`}
                  showSuccess
                />
              </div>

              <p className="mt-4 max-w-prose text-caption text-text-muted">
                Beim Freigeben entstehen Status und Kalkulator-Zugang in derselben Transaktion —
                entweder beides oder nichts. Danach geht eine E-Mail an das Konto des Betriebs; ein
                Fehler dabei ändert am Zugang nichts. Aus einer Ablehnung geht bewusst keine
                Nachricht raus — ein abgelehnter Werkzeugwunsch gehört in ein Gespräch.
              </p>
            </>
          ) : (
            <div>
              <p className="text-small text-text">
                Entschieden am {request.reviewedAt ? formatDateTime(request.reviewedAt) : '—'}
                {request.reviewedByEmail ? (
                  <> durch {request.reviewedByEmail}</>
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

              {request.status === 'approved' && (
                <div className="mt-4 rounded-md border border-line bg-surface-sunken p-3">
                  <p className="max-w-prose text-small text-text">
                    Der Kalkulator-Zugang ist vergeben — er entstand in derselben Transaktion wie
                    diese Entscheidung.
                  </p>
                  {request.notifiedAt ? (
                    <p className="mt-2 max-w-prose text-caption text-text-muted">
                      <span className="font-medium text-text">
                        Benachrichtigt am {formatDateTime(request.notifiedAt)}.
                      </span>{' '}
                      Der Betrieb hat die Freischaltung per E-Mail bekommen.
                    </p>
                  ) : (
                    <p className="mt-2 max-w-prose text-caption text-text-muted">
                      <span className="font-medium text-negative">
                        Der Betrieb ist NICHT benachrichtigt.
                      </span>{' '}
                      Mit der Freigabe geht die Nachricht automatisch raus — hier ist sie offenbar
                      nicht zugestellt worden. Der Zugang steht trotzdem; bitte den Betrieb auf
                      einem anderen Weg informieren.
                    </p>
                  )}
                </div>
              )}

              <p className="mt-2 max-w-prose text-caption text-text-muted">
                Eine erneute Entscheidung ist hier nicht möglich — der Zeitpunkt der ersten bleibt
                stehen. Ein Betrieb, dessen Anfrage abgelehnt wurde, kann eine neue stellen.
              </p>
            </div>
          )}
        </AdminPanel>
      </AdminSection>
    </Container>
  )
}
