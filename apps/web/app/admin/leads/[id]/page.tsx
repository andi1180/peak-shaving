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
  formatKwh,
} from '@/components/admin/ui'
import {
  AnonymizeLead,
  LeadStatusForm,
  SuppressLeadButton,
  WithdrawConsentButton,
} from '@/components/admin/lead-actions'
import {
  LEADS_HREF,
  consentStatusLabel,
  industryLabel,
  meteringTypeLabel,
  purposeLabel,
  readLeadDetail,
  readStatus,
  retentionLabel,
  statusLabel,
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
      <dt className="text-caption font-semibold uppercase tracking-wide text-text-muted">{label}</dt>
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
  const canWithdraw = consent.effective_status === 'pending' || consent.effective_status === 'confirmed'

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

export default async function AdminLeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (!(await isCurrentUserAdmin())) return null

  const { id } = await params

  const supabase = await createClient()
  const res = await supabase.rpc('admin_get_lead', { p_lead_id: id })
  if (res.error) console.error('[admin/leads] admin_get_lead:', res.error)

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

  const { lead, consents } = detail
  const isAnonymized = lead.anonymized_at !== null

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
            <Field label="Firma">{lead.company ?? '—'}</Field>
            <Field label="Ansprechperson">{lead.contact_name ?? '—'}</Field>
            <Field label="Telefon">{lead.phone ?? '—'}</Field>
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
                */}
              {isAnonymized
                ? 'nicht mehr ermittelbar'
                : lead.is_suppressed
                  ? 'gesperrt'
                  : 'nicht gesperrt'}
            </Field>
          </dl>
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

      {/* ── Betriebsdaten ─────────────────────────────────────────────────────────────────────── */}
      {/*
        * B3-1: die Dimensionen, auf denen B2 später segmentiert. BEWUSST NUR ANZEIGE — keine
        * Filter (das ist B2), keine Bearbeitbarkeit. Ein editierbares Feld bräuchte einen eigenen
        * Schreibwrapper samt Begründung, warum ein Admin eine Angabe überschreiben darf, die die
        * Person selbst gemacht hat. Hier steht es, damit sich am ERSTEN echten Lead prüfen lässt,
        * ob die Felder überhaupt ankommen.
        */}
      <AdminSection
        id="betriebsdaten"
        title="Betriebsdaten"
        description="Wird je Einstiegspunkt erhoben — kein Formular fragt alles ab, leere Felder sind daher der Normalfall und kein Fehler. Auf diesen Merkmalen segmentiert die spätere Aussendung."
      >
        <AdminPanel>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Branche">
              {lead.industry ? industryLabel(lead.industry) : '—'}
            </Field>
            <Field label="Postleitzahl">
              {/*
                * Bei einem anonymisierten Lead ist die PLZ genullt — sie lokalisiert in Kombination
                * mit Branche und Versorger einen Betrieb. Branche, Verbrauch und Messart bleiben
                * dagegen stehen: grob einordnend, nicht wiedererkennend.
                */}
              <Num>{lead.postal_code ?? '—'}</Num>
            </Field>
            <Field label="Jahresverbrauch">
              <Num>{formatKwh(lead.annual_consumption_kwh)}</Num>
            </Field>
            <Field label="Messart">
              {lead.metering_type ? meteringTypeLabel(lead.metering_type) : 'noch nicht geprüft'}
            </Field>
            <Field label="Versorger">{lead.supplier ?? '—'}</Field>
            <Field label="Vertragsende">
              <Num>{formatDate(lead.contract_end_date)}</Num>
            </Field>
          </dl>
          {/*
            * Der Hinweis steht hier und nicht nur in der Migration: wer die zwei leeren Felder
            * sieht, soll den Widerruf als Ursache erkennen und nicht auf einen Erfassungsfehler
            * schliessen.
            */}
          <p className="mt-4 max-w-prose text-caption text-text-muted">
            Versorger und Vertragsende werden ausschließlich für die Vertragsablauf-Erinnerung
            erhoben. Wird diese Einwilligung widerrufen, löscht die Datenbank beide Felder
            automatisch — fällt der Zweck weg, fällt die Grundlage für die Daten weg.
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
              <ConsentCard
                key={c.id}
                consent={c}
                leadId={lead.id}
                actionsDisabled={isAnonymized}
              />
            ))}
          </div>
        )}

        {/*
          * ES GIBT HIER BEWUSST KEINE MÖGLICHKEIT, EINE EINWILLIGUNG ANZULEGEN ODER ZU BESTÄTIGEN.
          * Eine Oberfläche, in der sich „bestätigt" ankreuzen lässt, entwertet den gesamten Nachweis
          * rückwirkend — auch die echten Einwilligungen. Es gibt dafür auch keinen Wrapper.
          */}
        <p className="mt-4 max-w-prose text-caption text-text-muted">
          Eine Einwilligung lässt sich hier nur widerrufen, nie erteilen oder bestätigen. Der einzige
          Weg zu „bestätigt“ ist der Klick der betroffenen Person auf den Link in ihrer eigenen
          Mailbox — eine Schaltfläche dafür würde jeden Nachweis rückwirkend entwerten, auch die
          echten.
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
            Eintrag hat keine Verbindung zum Lead und bleibt auch nach dessen Anonymisierung bestehen
            — sonst stünde die Person nach dem nächsten Import wieder im Verteiler.
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
