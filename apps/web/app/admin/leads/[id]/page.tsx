import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container, Num } from '@/components/ui/layout'
import {
  AdminError,
  AdminPanel,
  AdminSection,
  Pill,
  formatDate,
  formatDateTime,
} from '@/components/admin/ui'
import {
  AnonymizeLead,
  LeadStatusForm,
  SuppressLeadButton,
  WithdrawConsentButton,
} from '@/components/admin/lead-actions'
import { LeadEditForm } from '@/components/admin/lead-edit-form'
import {
  LEADS_HREF,
  consentStatusLabel,
  emailEventLabel,
  purposeLabel,
  readEmailEvents,
  readLeadDetail,
  readStatus,
  retentionLabel,
  statusLabel,
  suppressionReasonLabel,
  type EmailEventRow,
  type LeadConsentDetail,
} from '@/lib/admin/leads'

/*
 * `/admin/leads/[id]` — die Detailsicht eines Leads (B1-3).
 *
 * ── DER WORTLAUT STEHT AUF DER SEITE, NICHT HINTER EINEM VERWEIS ─────────────────────────────────
 * Jede Einwilligung wird mit ihrem VOLLSTÄNDIGEN Text angezeigt, nicht nur mit Zweck und Version.
 * Der Wortlaut IST der Nachweis: die Person hat einen Satz gelesen, keinen Zweckschlüssel. Wer im
 * Streitfall belegen muss, worin jemand eingewilligt hat, darf nicht erst eine Textfassung
 * nachschlagen müssen — und schon gar nicht die HEUTE gültige, sondern genau die damals angezeigte
 * (`consents.consent_text_id` zeigt darauf, B1-1 hält sie unveränderlich).
 *
 * ── ANGEZEIGT WIRD DER WIRKSAME ZUSTAND ──────────────────────────────────────────────────────────
 * `effective_status` statt `status`: B1-2 räumt abgelaufene Bestätigungen lazy ab, gespeichert
 * bleibt `pending`. Der gespeicherte Wert steht daneben, wo er abweicht — verschwiegen wäre er eine
 * zweite Wahrheit.
 *
 * ── EIN ANONYMISIERTER LEAD HAT KEINE AKTIONEN ───────────────────────────────────────────────────
 * Alle drei Schaltflächen sind dann deaktiviert, und die Seite sagt, wann und durch wen anonymisiert
 * wurde. Die Sperre selbst sitzt in der Datenbank (Trigger `guard_anonymized_lead` und die
 * `anonymized`-Antwort der Wrapper) — die deaktivierten Knöpfe sind Höflichkeit, nicht Schutz.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'COOLiN ENERGY',
  robots: { index: false, follow: false },
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-caption font-semibold uppercase tracking-wide text-text-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-small text-ink">{children}</dd>
    </div>
  )
}

function ConsentCard({
  consent,
  leadId,
  actionsDisabled,
}: {
  consent: LeadConsentDetail
  leadId: string
  actionsDisabled: boolean
}) {
  const drifted = consent.effective_status !== consent.status
  const canWithdraw =
    consent.effective_status === 'pending' || consent.effective_status === 'confirmed'

  return (
    <AdminPanel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-h4 text-ink">{purposeLabel(consent.purpose)}</h3>
          <p className="mt-1 text-caption text-text-muted">
            Fassung <Num>{consent.consent_text_version}</Num> · {consent.consent_text_locale} ·
            Herkunft {consent.source_label ?? consent.source_key} ·{' '}
            {consent.requires_double_opt_in ? 'bestätigungspflichtig' : 'ohne Bestätigungsschritt'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Pill
            tone={
              consent.effective_status === 'confirmed'
                ? 'positive'
                : consent.effective_status === 'pending'
                  ? 'warning'
                  : 'neutral'
            }
          >
            {consentStatusLabel(consent.effective_status)}
          </Pill>
          {drifted && (
            /*
             * Der gespeicherte Wert weicht ab, weil B1-2 bewusst keinen Aufräumjob hat. Das
             * gehört sichtbar hierher: sonst behauptet die Oberfläche einen Datenbankzustand,
             * den ein Blick in die Tabelle widerlegt.
             */
            <span className="text-caption text-text-muted">
              gespeichert: {consentStatusLabel(consent.status)} (wird beim nächsten
              Bestätigungsversuch nachgezogen)
            </span>
          )}
        </div>
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <Field label="Erteilt">
          <Num>{formatDateTime(consent.granted_at)}</Num>
        </Field>
        <Field label="Bestätigt">
          <Num>{formatDateTime(consent.confirmed_at)}</Num>
        </Field>
        <Field label="Widerrufen">
          <Num>{formatDateTime(consent.withdrawn_at)}</Num>
        </Field>
      </dl>

      <div className="mt-4">
        <p className="text-caption font-semibold uppercase tracking-wide text-text-muted">
          Wortlaut, dem zugestimmt wurde
        </p>
        <blockquote className="mt-1 border-l-2 border-line-strong pl-3 text-small text-text">
          {consent.consent_text_body}
        </blockquote>
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="IP zum Zeitpunkt der Erteilung">{consent.source_ip ?? '—'}</Field>
        <Field label="Browser-Kennung">
          <span className="break-all">{consent.user_agent ?? '—'}</span>
        </Field>
      </dl>

      {/*
       * Der Knopf bleibt STEHEN, wenn es nichts mehr zu widerrufen gibt — deaktiviert, nicht
       * entfernt. Grund ist nicht Kosmetik: nach einem erfolgreichen Widerruf rendert
       * `revalidatePath` diese Seite neu. Verschwände der Knopf dabei, verschwände die Komponente,
       * die seine Rückmeldung hält — die Meldung „widerrufen (2 Einträge)" wäre nie zu sehen, weil
       * genau der Erfolg sie entfernt. Sichtbar bleibt sie nur, wenn das Formular die
       * Neu-Darstellung überlebt.
       */}
      <div className="mt-4 border-t border-line pt-4">
        <WithdrawConsentButton
          leadId={leadId}
          purpose={consent.purpose}
          disabled={actionsDisabled || !canWithdraw}
        />
        <p className="mt-2 max-w-prose text-caption text-text-muted">
          {canWithdraw
            ? 'Widerruft ALLE offenen und bestätigten Einträge dieses Zwecks — nicht nur diesen. Eine übersehene ältere Bestätigung würde sonst weiter zum Versand berechtigen.'
            : 'Hier ist nichts mehr zu widerrufen: dieser Eintrag ist bereits widerrufen oder abgelaufen.'}
        </p>
      </div>
    </AdminPanel>
  )
}

/**
 * Eine Zeile des Zustellprotokolls (B2-2).
 *
 * Der Ton unterscheidet die drei Fälle bewusst: eine Beschwerde ist die schärfste Rückmeldung, die
 * eine Person geben kann, und darf nicht neben einer Zustellung verschwinden. Ein VORÜBERGEHENDER
 * Rückläufer wird ausdrücklich als solcher benannt — sonst läse sich jede „Rückläufer"-Zeile wie
 * eine Sperre, und die Hälfte davon war keine.
 */
function EmailEventRowItem({ event }: { event: EmailEventRow }) {
  const isComplaint = event.event_type === 'email.complained'
  /*
   * Beide Formen des vorübergehenden Rückläufers tragen den Hinweis: `email.delivery_delayed` (bei
   * Resend der REGELFALL für einen weichen Rückläufer — die Nutzlast trägt dort gar kein
   * bounce-Objekt) und ein `email.bounced` mit ausdrücklich nicht-dauerhafter Einstufung. Ohne den
   * Hinweis stünde bei der häufigeren Form nur „verzögert", und die Frage, die man sich beim Lesen
   * stellt — hat das jetzt gesperrt? — bliebe unbeantwortet.
   */
  const isTransient =
    event.event_type === 'email.delivery_delayed' ||
    (event.event_type === 'email.bounced' && !event.is_permanent_bounce)

  return (
    <li className="border-t border-line py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <Pill
          tone={
            isComplaint || event.is_permanent_bounce
              ? 'negative'
              : isTransient
                ? 'warning'
                : 'neutral'
          }
        >
          {emailEventLabel(event.event_type)}
        </Pill>
        <Num className="text-caption text-text-muted">
          {formatDateTime(event.occurred_at ?? event.received_at)}
        </Num>
        {event.is_permanent_bounce && (
          <span className="text-caption text-text-muted">dauerhaft — hat die Adresse gesperrt</span>
        )}
        {isTransient && (
          <span className="text-caption text-text-muted">vorübergehend — sperrt bewusst nicht</span>
        )}
        {isComplaint && (
          <span className="text-caption text-text-muted">
            hat gesperrt und alle Einwilligungen widerrufen
          </span>
        )}
      </div>
      {(event.bounce_type || event.bounce_subtype) && (
        <p className="mt-1 text-caption text-text-muted">
          Einstufung des Anbieters:{' '}
          {[event.bounce_type, event.bounce_subtype].filter(Boolean).join(' / ')}
        </p>
      )}
      {event.reason && (
        <p className="mt-1 max-w-prose break-words text-caption text-text-muted">{event.reason}</p>
      )}
    </li>
  )
}

export default async function AdminLeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isCurrentUserAdmin())) return null

  const { id } = await params

  const supabase = await createClient()
  // Zwei unabhängige Aufrufe: das Zustellprotokoll gehört nicht in `admin_get_lead`, weil es
  // seitenweise begrenzt ist und der Lead selbst nicht — und ein Fehler beim Laden der Ereignisse
  // darf nicht die ganze Detailseite umwerfen (dieselbe Aufteilung wie auf `/admin/leads`).
  const [res, eventsRes] = await Promise.all([
    supabase.rpc('admin_get_lead', { p_lead_id: id }),
    supabase.rpc('admin_list_email_events', { p_lead_id: id, p_limit: 50 }),
  ])
  if (res.error) console.error('[admin/leads] admin_get_lead:', res.error)
  if (eventsRes.error) console.error('[admin/leads] admin_list_email_events:', eventsRes.error)
  const emailEvents = readEmailEvents(eventsRes.data)

  // 'not_found' ist ein fachlicher Zustand (veralteter Link) → 404. Ein LADEFEHLER ist etwas
  // anderes und darf sich nicht als „gibt es nicht" ausgeben.
  if (readStatus(res.data) === 'not_found') notFound()

  const detail = readLeadDetail(res.data)
  if (!detail) {
    return (
      <Container className="py-10 sm:py-14">
        <AdminError>
          Dieser Lead konnte nicht geladen werden. Bitte laden Sie die Seite neu.
        </AdminError>
      </Container>
    )
  }

  const { lead, consents, contractReminders } = detail
  const isAnonymized = lead.anonymized_at !== null

  /*
   * B4-2: die Erinnerung zum AKTUELL eingetragenen Vertragsende — das ist die Frage, die im
   * Zweifel gestellt wird („die Person sagt, sie habe nichts bekommen"). Zeilen zu einem ANDEREN
   * Datum bleiben sichtbar (s. unten): sie sind die Spur einer Korrektur und beantworten die
   * Anschlussfrage „warum bekam sie zwei".
   */
  const currentReminder =
    contractReminders.find((r) => r.contract_end_date === lead.contract_end_date) ?? null
  const otherReminders = contractReminders.filter((r) => r !== currentReminder)

  return (
    <Container className="py-10 sm:py-14">
      <header className="border-b border-line pb-6">
        <Link
          href={LEADS_HREF}
          className="rounded-sm text-small text-accent underline decoration-accent underline-offset-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          ← Zurück zur Liste
        </Link>
        <h1 className="mt-3 break-all text-h2 text-ink">{lead.email}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Pill tone={isAnonymized ? 'neutral' : 'warning'}>{statusLabel(lead.status)}</Pill>
          {lead.is_suppressed && <Pill tone="negative">Adresse gesperrt</Pill>}
          {lead.deletion_due && <Pill tone="negative">Löschfrist erreicht</Pill>}
        </div>
      </header>

      {isAnonymized && (
        <div className="mt-6 rounded-md border border-line-strong bg-surface-sunken p-4">
          <p className="max-w-prose text-small text-ink">
            <strong className="font-semibold">Dieser Lead ist anonymisiert.</strong> Anonymisiert am{' '}
            <Num>{formatDateTime(lead.anonymized_at)}</Num>
            {/*
             * B4-1: der Systemlauf wird ZUERST geprüft. Vorher schloss diese Kette aus einem leeren
             * `anonymized_by` auf ein gelöschtes Konto — was richtig war, solange nur Menschen
             * anonymisieren konnten. Seit der Fristenlauf existiert, wäre genau das eine
             * Behauptung über ein Konto, das es nie gab. Die Antwort steht jetzt in der Zeile
             * (`anonymized_by_system`), sie wird nicht mehr erraten.
             */}
            {lead.anonymized_by_system ? (
              <> automatisch (Fristablauf)</>
            ) : lead.anonymized_by_email ? (
              <> durch {lead.anonymized_by_email}</>
            ) : lead.anonymized_by ? (
              <> durch ein inzwischen gelöschtes Konto</>
            ) : (
              <> — das handelnde Konto wurde inzwischen gelöscht</>
            )}
            . Alle Aktionen sind deaktiviert; die Datenbank lehnt jede Änderung ab. Die
            Einwilligungsnachweise unten bleiben bestehen — ohne Identitätsmerkmale sind sie kein
            Personenbezug mehr, belegen aber weiterhin, dass korrekt gearbeitet wurde.
          </p>
          {/*
           * Ohne diesen Satz liest sich „Sperrliste: nicht mehr ermittelbar" unten wie „die Sperre
           * wurde mitgelöscht" — das Gegenteil des B1-1-Entwurfs. Ein bestehender Sperreintrag
           * hängt an der ECHTEN Adresse, und die gibt es hier nicht mehr; er ist deshalb weiterhin
           * wirksam, nur diesem Lead nicht mehr zuzuordnen.
           */}
          <p className="mt-2 max-w-prose text-small text-text-muted">
            Ein etwaiger Sperrlisten-Eintrag besteht weiter — er hängt an der ursprünglichen Adresse
            und wirkt bei jeder künftigen Aussendung. Er lässt sich diesem Lead nur nicht mehr
            zuordnen, weil die Adresse hier gelöscht ist. Genau dafür ist die Sperrliste ohne
            Verbindung zum Lead gebaut.
          </p>
        </div>
      )}

      {/* ── Stammdaten ────────────────────────────────────────────────────────────────────────── */}
      <AdminSection id="stammdaten" title="Stammdaten">
        <AdminPanel>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Ersterfassung über">
              {lead.first_source_label ?? lead.first_source_key}
            </Field>
            <Field label="Angelegt">
              <Num>{formatDateTime(lead.created_at)}</Num>
            </Field>
            <Field label="Letzte Interaktion">
              <Num>{formatDateTime(lead.last_interaction_at)}</Num>
            </Field>
            <Field label="Aufbewahrung">{retentionLabel(lead.retention_basis)}</Field>
            <Field label="Löschfrist">
              <Num className={lead.deletion_due ? 'font-semibold text-negative' : undefined}>
                {formatDate(lead.deletion_due_at)}
              </Num>
            </Field>
            <Field label="Sperrliste">
              {/*
               * Bei einem anonymisierten Lead wird `is_suppressed` über die PLATZHALTER-Adresse
               * berechnet und sagt deshalb nichts über die echte aus. „nicht gesperrt" wäre hier
               * eine falsche Auskunft.
               *
               * B2-2: Ist gesperrt, wird der GRUND benannt. Mit dem Rückläufer-/Beschwerdepfad gibt
               * es drei Wege auf die Liste, und sie bedeuten Verschiedenes: eine Abmeldung ist ein
               * normaler Vorgang, eine Beschwerde der Anlass, die eigene Aussendung zu prüfen.
               * Ohne den Grund sähen beide gleich aus.
               */}
              {isAnonymized
                ? 'nicht mehr ermittelbar'
                : lead.is_suppressed
                  ? `gesperrt (${lead.suppression_reason ? suppressionReasonLabel(lead.suppression_reason) : 'Grund nicht hinterlegt'})`
                  : 'nicht gesperrt'}
            </Field>
            {/*
             * B2-1: `last_edited_by = null` ist ZWEIDEUTIG (nie von Hand bearbeitet ODER Konto
             * gelöscht) — die Zeile enthält die Antwort nicht, und die Oberfläche rät hier nicht,
             * anders als es B1-3 bei anonymized_by tat, bevor B4-1 die Urheberschaft ins
             * Datenmodell holte. Unterschieden wird nur, was die Daten hergeben: steht eine UUID
             * ohne E-Mail da, ist das Konto weg.
             */}
            <Field label="Zuletzt bearbeitet von">
              {lead.last_edited_by_email ??
                (lead.last_edited_by
                  ? 'ein inzwischen gelöschtes Konto'
                  : 'nicht von Hand bearbeitet')}
            </Field>
          </dl>
        </AdminPanel>

        {/*
         * B2-1: der Korrekturweg. Die neun Felder stehen GENAU in dieser Komponente — bei einem
         * anonymisierten Lead rendert sie dieselben neun als reine Anzeige. Eine zweite,
         * schreibgeschützte Liste daneben hätte bedeutet, dass jede Änderung an der Feldmenge an
         * zwei Stellen nachzuziehen ist.
         */}
        <AdminPanel className="mt-4">
          <h3 className="text-h4 text-ink">Stammdaten korrigieren</h3>
          <p className="mt-1 max-w-prose text-small text-text-muted">
            Für Tippfehler und Nachträge. Ein geleertes Feld LÖSCHT die Angabe — anders als bei der
            Erfassung, wo eine fehlende Angabe den Bestand unberührt lässt: dort heisst „leer"
            „weiss ich nicht", hier „das war falsch".
          </p>
          <div className="mt-4">
            <LeadEditForm lead={lead} disabled={isAnonymized} />
          </div>
        </AdminPanel>

        <AdminPanel className="mt-4">
          <h3 className="text-h4 text-ink">Status ändern</h3>
          <p className="mt-1 max-w-prose text-small text-text-muted">
            Der Status ist reiner Lebenszyklus. Eine Abmeldung steht bewusst NICHT darin — sie ist
            ein Einwilligungszustand: man kann vom Marketing abgemeldet und zugleich zahlender Kunde
            sein.
          </p>
          <div className="mt-4">
            <LeadStatusForm
              leadId={lead.id}
              current={isAnonymized ? 'new' : lead.status}
              disabled={isAnonymized}
            />
          </div>
        </AdminPanel>
      </AdminSection>

      {/* ── Vertragsablauf-Erinnerung ─────────────────────────────────────────────────────────── */}
      {/*
       * Die Betriebsdaten selbst (B3-1) sind seit B2-1 Teil des Korrekturformulars oben — sie
       * standen vorher als eigene Anzeige-Sektion hier. Was bleibt, ist der Erinnerungsstand: er
       * ist keine Stammdatenangabe, sondern das Ergebnis eines Versands.
       */}
      <AdminSection
        id="erinnerung"
        title="Vertragsablauf-Erinnerung"
        description="Versorger und Vertragsende werden ausschließlich für diesen Zweck erhoben. Wird die Einwilligung widerrufen, löscht die Datenbank beide Felder automatisch — und seit B4-2 auch die Zeilen im Versandprotokoll. Fällt der Zweck weg, fällt die Grundlage für die Daten weg, und zwar für jede Kopie."
      >
        <AdminPanel>
          {lead.contract_end_date === null ? (
            <p className="mt-2 max-w-prose text-small text-text-muted">
              Kein Vertragsende hinterlegt — für diesen Lead ist keine Erinnerung fällig.
            </p>
          ) : currentReminder === null ? (
            <p className="mt-2 max-w-prose text-small text-text-muted">
              Für das eingetragene Vertragsende (<Num>{formatDate(lead.contract_end_date)}</Num>)
              wurde noch nicht erinnert. Der Lauf erfasst es acht Wochen vorher — vorausgesetzt, die
              Einwilligung ist bestätigt und die Adresse nicht gesperrt.
            </p>
          ) : currentReminder.delivered_at ? (
            <p className="mt-2 max-w-prose text-small text-text-muted">
              Erinnert am <Num>{formatDateTime(currentReminder.delivered_at)}</Num> für das
              Vertragsende <Num>{formatDate(currentReminder.contract_end_date)}</Num>. Zu diesem
              Vertragsende wird nicht erneut erinnert.
            </p>
          ) : currentReminder.error ? (
            <p className="mt-2 max-w-prose text-small text-negative">
              <strong className="font-semibold">Der Versand ist fehlgeschlagen</strong> — Versuch am{' '}
              <Num>{formatDateTime(currentReminder.attempted_at)}</Num>: {currentReminder.error} Der
              Versand wird NICHT automatisch wiederholt (das wäre eine Schleife). Um es erneut zu
              versuchen, muss die Ursache behoben und die Zeile entfernt werden.
            </p>
          ) : (
            <p className="mt-2 max-w-prose text-small text-negative">
              <strong className="font-semibold">Beansprucht, aber ohne Rückmeldung</strong> —
              Versuch am <Num>{formatDateTime(currentReminder.attempted_at)}</Num>. Der Lauf ist
              zwischen Beanspruchung und Versand abgebrochen. Ob die Mail rausging, ist von hier aus
              nicht feststellbar; genau deshalb wird nicht automatisch wiederholt.
            </p>
          )}

          {otherReminders.length > 0 && (
            <div className="mt-4 border-t border-line pt-4">
              <p className="text-caption font-semibold uppercase tracking-wide text-text-muted">
                Frühere Vertragsenden
              </p>
              <ul className="mt-2 space-y-1">
                {otherReminders.map((reminder) => (
                  <li key={reminder.contract_end_date} className="text-small text-text-muted">
                    <Num>{formatDate(reminder.contract_end_date)}</Num> —{' '}
                    {reminder.delivered_at ? (
                      <>
                        erinnert am <Num>{formatDateTime(reminder.delivered_at)}</Num>
                      </>
                    ) : reminder.error ? (
                      <>fehlgeschlagen: {reminder.error}</>
                    ) : (
                      <>
                        beansprucht am <Num>{formatDateTime(reminder.attempted_at)}</Num>, ohne
                        Rückmeldung
                      </>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-2 max-w-prose text-caption text-text-muted">
                Ein anderes Datum heißt: das Vertragsende wurde korrigiert. Zu jedem Vertragsende
                wird genau einmal erinnert — eine Korrektur erzeugt deshalb zu Recht eine neue
                Erinnerung, kein Duplikat.
              </p>
            </div>
          )}
        </AdminPanel>
      </AdminSection>

      {/* ── Zustellereignisse ─────────────────────────────────────────────────────────────────── */}
      <AdminSection
        id="zustellung"
        title="Zustellung"
        description="Was Resend über bereits versendete Mails zurückgemeldet hat. Ein dauerhafter Rückläufer sperrt die Adresse, eine Beschwerde sperrt UND widerruft alle Einwilligungen; ein vorübergehender Rückläufer (volles Postfach, kurzzeitige Störung) tut bewusst keines von beidem. Öffnungen und Klicks stehen hier nicht — sie werden nicht erhoben."
      >
        <AdminPanel>
          {emailEvents === null ? (
            <AdminError>
              Die Zustellereignisse konnten nicht geladen werden. Damit ist unbekannt, ob zu dieser
              Adresse etwas zurückgekommen ist.
            </AdminError>
          ) : emailEvents.length === 0 ? (
            <p className="max-w-prose text-small text-text-muted">
              Zu dieser Adresse ist nichts zurückgekommen. Das ist der Normalfall — auch für einen
              Lead, an den noch nie etwas versendet wurde.
            </p>
          ) : (
            <ul className="flex flex-col">
              {emailEvents.map((e) => (
                <EmailEventRowItem key={e.id} event={e} />
              ))}
            </ul>
          )}
          {/*
           * ES GIBT HIER BEWUSST KEINE MÖGLICHKEIT, EINE SPERRE AUFZUHEBEN — und es gibt dafür
           * auch keinen Wrapper. Entsperren ist der Sache nach Erteilen, und die Regel aus B1-3
           * lautet: der Admin kann widerrufen, nie erteilen. Eine Schaltfläche „doch wieder
           * zustellen" wäre der Weg, auf dem eine Beschwerde mit einem Klick verschwindet.
           */}
          <p className="mt-4 max-w-prose text-caption text-text-muted">
            Eine Sperre lässt sich hier nicht aufheben. Entsperren wäre der Sache nach Erteilen, und
            der Admin kann widerrufen, nie erteilen. Ein begründeter Einzelfall bleibt ein bewusster
            Eingriff in der Datenbank.
          </p>
        </AdminPanel>
      </AdminSection>

      {/* ── Einwilligungen ────────────────────────────────────────────────────────────────────── */}
      <AdminSection
        id="einwilligungen"
        title="Einwilligungen"
        description="Mehrere je Zweck über die Zeit sind der Normalfall — erteilen, widerrufen, erneut erteilen. Jede Zeile ist ein eigener Nachweis mit eigenem Zeitpunkt, eigener Herkunft und eigenem Textstand. Nur „bestätigt“ berechtigt zum Versand."
      >
        {consents.length === 0 ? (
          <AdminPanel>
            <p className="text-small text-text-muted">
              Für diesen Lead gibt es keine Einwilligung. Das ist kein Fehler: eine Kontaktanfrage
              ist Vertragsanbahnung, keine Einwilligung — sie erzeugt bewusst keine.
            </p>
          </AdminPanel>
        ) : (
          <div className="flex flex-col gap-4">
            {consents.map((c) => (
              <ConsentCard key={c.id} consent={c} leadId={lead.id} actionsDisabled={isAnonymized} />
            ))}
          </div>
        )}

        {/*
         * ES GIBT HIER BEWUSST KEINE MÖGLICHKEIT, EINE EINWILLIGUNG ANZULEGEN ODER ZU BESTÄTIGEN.
         * Eine Oberfläche, in der sich „bestätigt" ankreuzen lässt, entwertet den gesamten Nachweis
         * rückwirkend — auch die echten Einwilligungen. Es gibt dafür auch keinen Wrapper.
         */}
        <p className="mt-4 max-w-prose text-caption text-text-muted">
          Eine Einwilligung lässt sich hier nur widerrufen, nie erteilen oder bestätigen. Der
          einzige Weg zu „bestätigt“ ist der Klick der betroffenen Person auf den Link in ihrer
          eigenen Mailbox — eine Schaltfläche dafür würde jeden Nachweis rückwirkend entwerten, auch
          die echten.
        </p>
      </AdminSection>

      {/* ── Eingriffe ─────────────────────────────────────────────────────────────────────────── */}
      <AdminSection
        id="eingriffe"
        title="Sperren und anonymisieren"
        description="Zwei verschiedene Dinge: die Sperre betrifft den VERSAND und überlebt jede spätere Löschung; die Anonymisierung entfernt den Personenbezug und ist endgültig."
      >
        <AdminPanel>
          <h3 className="text-h4 text-ink">Adresse dauerhaft sperren</h3>
          <p className="mt-1 max-w-prose text-small text-text-muted">
            Widerruft alle Zwecke und trägt die Adresse als SHA-256-Wert in die Sperrliste ein. Der
            Eintrag hat keine Verbindung zum Lead und bleibt auch nach dessen Anonymisierung
            bestehen — sonst stünde die Person nach dem nächsten Import wieder im Verteiler.
          </p>
          <div className="mt-4">
            <SuppressLeadButton leadId={lead.id} disabled={isAnonymized || lead.is_suppressed} />
            {lead.is_suppressed && !isAnonymized && (
              <p className="mt-2 text-caption text-text-muted">
                Diese Adresse ist bereits gesperrt.
              </p>
            )}
          </div>
        </AdminPanel>

        <div className="mt-4">
          {isAnonymized ? (
            <AdminPanel>
              <p className="text-small text-text-muted">
                Bereits anonymisiert — es gibt nichts mehr zu entfernen.
              </p>
            </AdminPanel>
          ) : (
            <AnonymizeLead
              leadId={lead.id}
              email={lead.email}
              consentCount={consents.length}
              isSuppressed={lead.is_suppressed}
            />
          )}
        </div>
      </AdminSection>
    </Container>
  )
}
