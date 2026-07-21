import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container, Num } from '@/components/ui/layout'
import { Button } from '@/components/ui/button'
import { Checkbox, Input, Label, Select } from '@/components/ui/input'
import {
  AdminError,
  AdminPanel,
  AdminTable,
  EmptyRow,
  Pill,
  Td,
  Th,
  formatDate,
  formatDateTime,
} from '@/components/admin/ui'
import {
  CONSENT_PURPOSES,
  CONSENT_STATUS_LABELS,
  CONTRACT_REMINDER_JOB_KEY,
  JOB_STALE_AFTER_HOURS,
  LEADS_HREF,
  LEAD_RETENTION_JOB_KEY,
  LEAD_STATUSES,
  SUPPRESSIONS_HREF,
  consentStatusLabel,
  hoursSince,
  purposeLabel,
  readContractReminderHealth,
  readJobRuns,
  readLeadList,
  readLeadSourceStats,
  readStatus,
  sourceLabel,
  statusLabel,
  type ContractReminderHealth,
  type JobRunsResult,
  type LeadConsentSummary,
  type LeadListRow,
  type LeadSource,
  type LeadSourceStat,
} from '@/lib/admin/leads'

/*
 * `/admin/leads` — die Lead-Liste (B1-3).
 *
 * ── WARUM DIESER ABSCHNITT EINE EIGENE ROUTE IST (und nicht ein fünfter Block auf `/admin`) ──────
 * T4-4 hat vier Verwaltungsflächen bewusst auf EINE Seite gelegt: vier kurze Tabellen ohne eigenen
 * Zustand. Die Lead-Liste hat einen: Filter, Seite, Suchbegriff. Der gehört in die URL — nur dann
 * ist eine gefilterte Ansicht teilbar, per Zurück-Taste erreichbar und nach einer Aktion
 * wiederherstellbar. Ein Block auf der Sammelseite müsste denselben Zustand in Query-Parametern
 * führen, die für die anderen drei Blöcke bedeutungslos wären.
 *
 * ── GEFILTERT WIRD IN SQL ────────────────────────────────────────────────────────────────────────
 * Alle Filter gehen als Parameter an `admin_list_leads`, keiner wird hier nachgelagert angewandt.
 * Nachgelagertes Filtern bräche die Seitenaufteilung (die Datenbank liefert 50 Zeilen, die
 * Anwendung wirft 40 weg und zeigt 10 — die Trefferzahl wäre falsch und „Seite 2" übersprünge
 * Treffer) und holte mehr personenbezogene Daten, als jemals angezeigt werden.
 *
 * ── DAS FILTERFORMULAR IST EIN ECHTES GET-FORMULAR ───────────────────────────────────────────────
 * Kein Client-Zustand, keine Server Action: die Filter SIND die URL. Damit funktioniert die Ansicht
 * ohne JavaScript, ist teilbar, und es gibt keinen zweiten Ort, an dem der Filterzustand leben und
 * mit der URL auseinanderlaufen könnte.
 *
 * Die Zugangsprüfung läuft über dieselbe Funktion wie im Layout (`isCurrentUserAdmin`, per `cache()`
 * auf einen Aufruf je Anfrage zusammengefasst). Sie ist hier NICHT redundant: dass das Layout
 * `children` nicht rendert, verhindert nicht, dass diese Seite gerendert und ins RSC-Flight-Payload
 * geschrieben wird. Ausführlich: `lib/admin/guard.ts`.
 */

export const dynamic = 'force-dynamic'

/** Neutral wie im Layout: der Tab-Titel darf nicht verraten, dass es hier etwas zu holen gibt. */
export const metadata: Metadata = {
  title: 'COOLiN ENERGY',
  robots: { index: false, follow: false },
}

const PAGE_SIZE = 50

/** Die Filter, wie sie in der URL stehen. Deutsche Schlüssel — die Routen sind es auch. */
type Query = { [key: string]: string | string[] | undefined }

function param(query: Query, name: string): string {
  const value = query[name]
  return typeof value === 'string' ? value.trim() : ''
}

/** Baut eine URL mit denselben Filtern und einer geänderten Seite. */
function pageHref(query: Query, page: number): string {
  const sp = new URLSearchParams()
  for (const key of ['status', 'quelle', 'zweck', 'einwilligung', 'suche'] as const) {
    const value = param(query, key)
    if (value) sp.set(key, value)
  }
  if (param(query, 'faellig') === '1') sp.set('faellig', '1')
  if (page > 1) sp.set('seite', String(page))
  const qs = sp.toString()
  return qs ? `${LEADS_HREF}?${qs}` : LEADS_HREF
}

/**
 * Die Einwilligungsspalte — die operativ wichtigste der Liste: nur BESTÄTIGTE Einwilligungen sind
 * im November aktivierbar. Angezeigt wird der WIRKSAME Zustand (`effective_status`), nicht der
 * gespeicherte: eine `pending`-Zeile mit längst verfallenem Token als „offen" auszuweisen hiesse,
 * eine Bestätigung anzukündigen, die nicht mehr kommen kann (B1-2 räumt lazy ab).
 */
function ConsentCell({ consents }: { consents: LeadConsentSummary[] }) {
  if (consents.length === 0) {
    return <span className="text-text-muted">keine</span>
  }
  return (
    <ul className="flex flex-col gap-1">
      {consents.map((c, i) => (
        <li key={`${c.purpose}-${c.granted_at}-${i}`} className="flex flex-wrap items-center gap-1.5">
          <span>{purposeLabel(c.purpose)}</span>
          <Pill
            tone={
              c.effective_status === 'confirmed'
                ? 'positive'
                : c.effective_status === 'pending'
                  ? 'warning'
                  : 'neutral'
            }
          >
            {consentStatusLabel(c.effective_status)}
          </Pill>
        </li>
      ))}
    </ul>
  )
}

/**
 * Der Stand EINES zeitgesteuerten Jobs — seit B4-2 gibt es zwei davon.
 *
 * ── WARUM DIESE ZEILE ÜBERHAUPT EXISTIERT ────────────────────────────────────────────────────────
 * Der wahrscheinlichste Fehler eines Cron-Jobs ist nicht, dass er scheitert, sondern dass er NICHT
 * LÄUFT — und ein ausgebliebener Lauf sieht von hier aus exakt aus wie ein Lauf ohne Arbeit. Genau
 * das ist der planmässige Zustand des Fristenlaufs bis 2028 („null Fälle") und, solange kein Lead
 * ein Vertragsende trägt, auch der der Erinnerung. Ohne diese Zeile fiele ein seit Monaten stilles
 * `CRON_SECRET` erstmals an verstrichenen Löschfristen bzw. an einer ausgebliebenen Erinnerung auf.
 * Die Hervorhebung nach 48 Stunden ist deshalb der eigentliche Zweck des Bauteils: es soll
 * auffallen, ohne dass jemand danach sucht.
 *
 * ── ZWEI ZEILEN, NICHT EINE ──────────────────────────────────────────────────────────────────────
 * B4-2 zeigt beide Läufe mit EIGENEM Stand. Ein gemeinsamer „die Crons laufen"-Indikator verschwiege
 * genau den Fall, in dem der eine läuft und der andere nicht — und die Folgen sind verschieden:
 * nicht durchgesetzte Löschfristen sind eine Rechtspflicht, ausgebliebene Erinnerungen ein
 * gebrochenes Versprechen gegenüber Menschen, die dafür ihr Vertragsende hergegeben haben.
 *
 * ── KEIN AUSLÖSEKNOPF ────────────────────────────────────────────────────────────────────────────
 * Beide Jobs laufen täglich von selbst. Eine Schaltfläche „jetzt ausführen" gäbe einem Menschen die
 * Möglichkeit, versehentlich einen unumkehrbaren Massenvorgang zu starten — beim Fristenlauf eine
 * Massen-Anonymisierung, bei der Erinnerung einen Massenversand. Ein Risiko ohne Gegenwert; wer
 * einen Lauf wirklich vorziehen muss, hat den Weg über den Endpunkt und das Geheimnis.
 */
function JobStatus({
  result,
  label,
  schedule,
  /** Was der Lauf gesehen bzw. getan hat — je Job ein anderer Satz. */
  itemsSeen,
  itemsDone,
  /** Was es bedeutet, wenn er ausbleibt. Keine Floskel: das ist die Handlungsaufforderung. */
  consequence,
  loadError,
}: {
  result: JobRunsResult | null
  label: string
  schedule: string
  itemsSeen: string
  itemsDone: string
  consequence: string
  loadError: string
}) {
  if (result === null) {
    return (
      <div className="mt-4">
        <AdminError>{loadError}</AdminError>
      </div>
    )
  }

  const lastRun = result.runs[0] ?? null
  const lastSuccess = result.lastSuccess
  const hours = hoursSince(lastSuccess?.started_at)
  // Kein erfolgreicher Lauf bekannt ist der SCHÄRFERE Fall, nicht der harmlosere: er heisst
  // entweder „noch nie gelaufen" (Geheimnis fehlt, Cron nicht registriert) oder „schon so lange
  // nicht mehr, dass es aus dem Fenster gefallen ist".
  const stale = hours === null || hours > JOB_STALE_AFTER_HOURS

  return (
    <div
      className={
        stale
          ? 'mt-4 rounded-md border border-negative bg-negative-subtle p-4'
          : 'mt-4 rounded-md border border-line bg-surface-sunken p-4'
      }
      role={stale ? 'alert' : undefined}
    >
      <p className={stale ? 'text-small text-negative' : 'text-small text-text-muted'}>
        <strong className="font-semibold">{label}:</strong>{' '}
        {lastSuccess ? (
          <>
            zuletzt erfolgreich am <Num>{formatDateTime(lastSuccess.started_at)}</Num> —{' '}
            <Num>{lastSuccess.items_considered ?? 0}</Num> {itemsSeen},{' '}
            <Num>{lastSuccess.items_processed ?? 0}</Num> {itemsDone}.
          </>
        ) : (
          <>bisher kein erfolgreicher Lauf verzeichnet.</>
        )}{' '}
        {stale ? (
          <>
            Seit über <Num>{JOB_STALE_AFTER_HOURS}</Num> Stunden lief er nicht erfolgreich —{' '}
            <strong className="font-semibold">{consequence}</strong> Eingeplant ist er täglich um{' '}
            {schedule}. Zu prüfen: ist <code>CRON_SECRET</code> in Vercel gesetzt und der
            Cron-Eintrag im aktuellen Production-Deployment registriert?
          </>
        ) : (
          <>Er läuft automatisch, täglich um {schedule}.</>
        )}
      </p>

      {/*
        * Eine Verweigerung ist kein Fehler, sondern die eingebaute Bremse: oberhalb der Obergrenze
        * anonymisiert der Fristenlauf NICHTS bzw. versendet die Erinnerung KEINE einzige Mail. Sie
        * muss im Klartext hier stehen — sonst sieht der Bereich aus wie „läuft" und niemand
        * erfährt, dass seit Tagen nichts passiert.
        */}
      {lastRun?.outcome === 'refused' && (
        <p className="mt-2 max-w-prose text-small text-negative">
          <strong className="font-semibold">
            Der letzte Lauf am <Num>{formatDateTime(lastRun.started_at)}</Num> hat verweigert.
          </strong>{' '}
          {lastRun.detail}
        </p>
      )}

      {lastRun?.outcome === 'error' && (
        <p className="mt-2 max-w-prose text-small text-negative">
          <strong className="font-semibold">
            Der letzte Lauf am <Num>{formatDateTime(lastRun.started_at)}</Num> ist abgebrochen.
          </strong>{' '}
          {lastRun.detail}
        </p>
      )}

      {/*
        * Auch ein ERFOLGREICHER Lauf kann einzelne Fehlversände enthalten (B4-2: ein Fehlversand
        * bricht den Lauf nicht ab). Das Detailfeld nennt sie — ohne diese Zeile stünde „erfolgreich"
        * da und die Fehlschläge wären nur in der Datenbank sichtbar.
        */}
      {lastRun?.outcome === 'success' && lastRun.detail && (
        <p className="mt-2 max-w-prose text-small text-text-muted">{lastRun.detail}</p>
      )}
    </div>
  )
}

/**
 * Beansprucht, aber nie bestätigt versendet (B4-2) — der Befund, der sonst niemandem auffällt.
 *
 * Die Person wartet auf ihre Erinnerung, der Lauf meldet Erfolg (er hat den Fall ja abgearbeitet),
 * und die Zeile steht still in der Tabelle. Genau deshalb steht sie hier oben und nicht in einer
 * Detailansicht. Solche Zeilen werden bewusst NICHT automatisch wiederholt: automatische
 * Wiederholung von E-Mail-Versand erzeugt Schleifen — im schlechteren Fall kommen die Mails durch
 * und nur die Rückmeldung nicht, und dann wiederholt sich der Versand täglich.
 *
 * Die Schwelle kommt aus der DATENBANK mit (`stale_after_hours`), nicht aus einer Konstante hier:
 * die Oberfläche soll die Zahl zeigen, mit der tatsächlich gezählt wurde.
 */
function StaleContractReminders({ health }: { health: ContractReminderHealth | null }) {
  if (health === null || health.staleCount === 0) return null

  return (
    <div className="mt-4 rounded-md border border-negative bg-negative-subtle p-4" role="alert">
      <p className="max-w-prose text-small text-negative">
        <strong className="font-semibold">
          <Num>{health.staleCount}</Num> Erinnerung(en) wurden beansprucht, aber nie zugestellt.
        </strong>{' '}
        Sie sind älter als <Num>{health.staleAfterHours}</Num> Stunden
        {health.oldestAttemptedAt ? (
          <>
            {' '}
            (älteste vom <Num>{formatDateTime(health.oldestAttemptedAt)}</Num>)
          </>
        ) : null}
        . Der Versand wird NICHT automatisch wiederholt — das wäre eine Schleife. Zu prüfen: sind{' '}
        <code>RESEND_API_KEY</code> und <code>RESEND_FROM</code> gesetzt, und hat Resend die Mails
        abgelehnt? Der Grund steht je Fall auf der Detailseite des Leads.
      </p>
    </div>
  )
}

/**
 * Rücklauf je Herkunftsquelle (B3-4) — die kleinste Auswertung, die die Frage beantwortet, ob die
 * Postaktion etwas gebracht hat.
 *
 * ── WARUM SIE ÜBERHAUPT HIER STEHT ───────────────────────────────────────────────────────────────
 * B3-4 teilt die Warteliste in ZWEI Routen: `/warteliste` (organisch) und `/warteliste/wko` (der
 * gedruckte QR-Code). Ohne eine Stelle, an der beide Herkünfte nebeneinander sichtbar sind, wäre
 * diese Teilung folgenlos — die Leads lägen unterscheidbar im Bestand, und niemand könnte die eine
 * Frage beantworten, für die sie getrennt erfasst werden.
 *
 * ── ABGRENZUNG ZU B2, ausdrücklich ───────────────────────────────────────────────────────────────
 * Das ist KEINE gefilterte Sicht und KEIN Export. Es gibt nichts anzuklicken, nichts einzugrenzen
 * und keine einzige Adresse: nur Zahlen je Quelle. Segmentierung (Branche, Netzebene, PLZ), Export
 * und Massenaussendung bleiben B2 — sie hängen an einer Zustell- und Prüfschicht, die es noch nicht
 * gibt. Eine Zahl kann man ansehen; eine Adressliste kann man versenden.
 *
 * ── DIE BEIDEN SPALTEN ZÄHLEN VERSCHIEDENE DINGE ─────────────────────────────────────────────────
 * Leads über `first_source_key` (wo der Lead ins System kam, seit B1-1 unveränderlich), bestätigte
 * Einwilligungen über den `source_key` der EINWILLIGUNG (wo genau diese erteilt wurde). Sonst würde
 * die Reaktion auf eine Kampagne dem älteren Kanal gutgeschrieben, über den dieselbe Person Monate
 * zuvor hereinkam — und der Brief systematisch zu niedrig bewertet. Die zweite Zahl ist deshalb
 * KEIN „davon", und die Fußzeile sagt das.
 */
function SourceStats({ stats }: { stats: LeadSourceStat[] | null }) {
  if (stats === null) {
    return (
      <AdminPanel className="mt-6">
        <AdminError>Die Herkunftszählung konnte nicht geladen werden.</AdminError>
      </AdminPanel>
    )
  }

  return (
    <AdminPanel className="mt-6 p-0 sm:p-0">
      <div className="px-4 py-4 sm:px-6">
        <h2 className="text-h4 text-ink">Rücklauf je Herkunft</h2>
        <div className="mt-3">
          <AdminTable>
            <thead>
              <tr>
                <Th>Herkunft</Th>
                <Th>Leads</Th>
                <Th>bestätigte Marketing-Einwilligungen</Th>
              </tr>
            </thead>
            <tbody>
              {stats.length === 0 && <EmptyRow colSpan={3}>Keine Herkunftsquellen.</EmptyRow>}
              {stats.map((row) => (
                <tr key={row.key}>
                  <Td>
                    {row.label}
                    {/* Der Schlüssel steht daneben, weil er im Code, in der URL und in dieser
                        Tabelle derselbe sein muss — die Bezeichnung ist frei änderbar, er nicht. */}
                    <span className="ml-2 text-caption text-text-muted">{row.key}</span>
                  </Td>
                  <Td className="whitespace-nowrap">
                    <Num>{row.lead_count}</Num>
                  </Td>
                  <Td className="whitespace-nowrap">
                    <Num>{row.confirmed_marketing_count}</Num>
                  </Td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        </div>
      </div>
      <p className="border-t border-line px-4 py-3 text-caption text-text-muted sm:px-6">
        Leads zählen nach der Herkunft, über die sie ins System kamen; Einwilligungen nach der
        Herkunft, an der sie erteilt wurden — die zweite Zahl ist deshalb kein „davon". Anonymisierte
        Leads bleiben enthalten: sie waren echter Rücklauf. Kein Export, keine gefilterte Sicht —
        beides kommt mit B2.
      </p>
    </AdminPanel>
  )
}

function LeadRow({ lead, sources }: { lead: LeadListRow; sources: LeadSource[] }) {
  return (
    <tr>
      <Td>
        <Link
          href={`${LEADS_HREF}/${lead.id}`}
          className="rounded-sm font-medium text-accent underline decoration-accent underline-offset-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {lead.email}
        </Link>
        {lead.is_suppressed && (
          <span className="mt-1 block">
            <Pill tone="negative">gesperrt</Pill>
          </span>
        )}
      </Td>
      <Td>{lead.company ?? '—'}</Td>
      <Td>
        <Pill tone={lead.status === 'anonymized' ? 'neutral' : 'warning'}>
          {statusLabel(lead.status)}
        </Pill>
      </Td>
      <Td>{sourceLabel(lead.first_source_key, sources)}</Td>
      <Td>
        <ConsentCell consents={lead.consents} />
      </Td>
      <Td className="whitespace-nowrap">
        <Num>{formatDateTime(lead.last_interaction_at)}</Num>
      </Td>
      <Td className="whitespace-nowrap">
        {lead.deletion_due ? (
          // Fällige Fristen sind der einzige Grund, warum diese Liste vor B4 überhaupt regelmäßig
          // angesehen werden muss — sie werden deshalb deutlich hervorgehoben, nicht nur datiert.
          <span className="inline-flex flex-col items-start gap-1">
            <Pill tone="negative">fällig</Pill>
            <Num className="text-caption text-text-muted">{formatDate(lead.deletion_due_at)}</Num>
          </span>
        ) : (
          <Num>{formatDate(lead.deletion_due_at)}</Num>
        )}
      </Td>
    </tr>
  )
}

export default async function AdminLeadsPage({ searchParams }: { searchParams: Promise<Query> }) {
  // Kein Zugang → gar keinen Inhalt erzeugen. Was der Nutzer stattdessen SIEHT, entscheidet das
  // Layout (neutrale Seite); hier geht es darum, dass nichts entsteht, das mitgeschickt werden kann.
  if (!(await isCurrentUserAdmin())) return null

  const query = await searchParams
  const filterStatus = param(query, 'status')
  const filterSource = param(query, 'quelle')
  const filterPurpose = param(query, 'zweck')
  const filterConsent = param(query, 'einwilligung')
  const filterSearch = param(query, 'suche')
  const filterDue = param(query, 'faellig') === '1'
  const page = Math.max(1, Number.parseInt(param(query, 'seite') || '1', 10) || 1)

  const supabase = await createClient()
  const res = await supabase.rpc('admin_list_leads', {
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
    p_status: filterStatus || undefined,
    p_source_key: filterSource || undefined,
    p_consent_purpose: (filterPurpose || undefined) as
      | 'marketing_email'
      | 'contract_expiry_reminder'
      | 'result_delivery'
      | undefined,
    p_consent_status: filterConsent || undefined,
    p_search: filterSearch || undefined,
    p_due_only: filterDue,
  })
  if (res.error) console.error('[admin/leads] admin_list_leads:', res.error)

  // Weitere, voneinander unabhängige Aufrufe: der Stand der zeitgesteuerten Jobs (B4-1/B4-2) und
  // der Befund offener Erinnerungen. Bewusst NICHT in `admin_list_leads` hineingezogen — die
  // Lead-Liste ist gefiltert und seitenweise, der Job-Stand ist keines von beidem; ein gemeinsamer
  // Wrapper müsste bei jedem Seitenwechsel dasselbe mitliefern. Ein Fehler in einem Aufruf darf die
  // übrigen nicht mitreissen.
  //
  // Je Job ein eigener Aufruf statt eines gemeinsamen mit `p_job_key => null`: sonst müsste die
  // Seite die Läufe hier auseinandersortieren, und `last_success` käme gemischt zurück — der
  // Fristenlauf würde die Erinnerung als „läuft" ausweisen (oder umgekehrt).
  const [retentionRes, reminderRes, healthRes, sourceStatsRes] = await Promise.all([
    supabase.rpc('admin_list_job_runs', {
      p_job_key: LEAD_RETENTION_JOB_KEY,
      // 5 statt 1: der LETZTE Lauf (evtl. verweigert) und der letzte ERFOLGREICHE können
      // verschiedene sein — beide müssen in einer Antwort Platz haben, ohne dass die Seite
      // nachfragen muss.
      p_limit: 5,
    }),
    supabase.rpc('admin_list_job_runs', { p_job_key: CONTRACT_REMINDER_JOB_KEY, p_limit: 5 }),
    supabase.rpc('admin_contract_reminder_health'),
    // B3-4: die Herkunftszählung. Ebenfalls ein eigener Aufruf — sie zählt den GESAMTEN Bestand und
    // hat mit den Filtern der Liste nichts zu tun; in `admin_list_leads` hineingezogen müsste sie
    // bei jedem Seitenwechsel mitgerechnet werden und wäre gleichzeitig versucht, sich am Filter zu
    // orientieren (dann zählte sie etwas anderes, als die Überschrift verspricht).
    supabase.rpc('admin_lead_source_stats'),
  ])
  if (retentionRes.error) console.error('[admin/leads] admin_list_job_runs:', retentionRes.error)
  if (reminderRes.error) console.error('[admin/leads] admin_list_job_runs:', reminderRes.error)
  if (healthRes.error)
    console.error('[admin/leads] admin_contract_reminder_health:', healthRes.error)
  if (sourceStatsRes.error)
    console.error('[admin/leads] admin_lead_source_stats:', sourceStatsRes.error)
  const retentionRuns = readJobRuns(retentionRes.data)
  const reminderRuns = readJobRuns(reminderRes.data)
  const reminderHealth = readContractReminderHealth(healthRes.data)
  const sourceStats = readLeadSourceStats(sourceStatsRes.data)

  const result = readLeadList(res.data)
  // Ein abgelehnter Filterwert ist etwas anderes als ein Ladefehler: die Datenbank hat geantwortet,
  // nur eben ablehnend. Sie ignoriert einen unbekannten Wert bewusst NICHT still — sonst hielte man
  // ein ungefiltertes Ergebnis für gefiltert.
  const invalidFilter = readStatus(res.data) === 'invalid_filter'

  const total = result?.total ?? 0
  const sources = result?.sources ?? []
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <Container className="py-10 sm:py-14">
      <header className="border-b border-line pb-6">
        <h1 className="text-h2 text-ink">Leads</h1>
        <p className="mt-2 max-w-prose text-body text-text-muted">
          Der Bestand aus Kontaktformular, Rechner und den übrigen Einstiegspunkten. Nur bestätigte
          Einwilligungen dürfen angeschrieben werden — alles andere ist rechtlich wertlos.
        </p>
        <p className="mt-3 max-w-prose text-small text-text-muted">
          <Link
            href={SUPPRESSIONS_HREF}
            className="rounded-sm font-medium text-accent underline decoration-accent underline-offset-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Sperrliste
          </Link>{' '}
          — nachsehen, ob eine Adresse dauerhaft gesperrt ist.
        </p>
      </header>

      {/*
        * Steht bewusst OBEN und nicht im Kleingedruckten: die Zeile beschreibt keine Einschränkung
        * der Oberfläche, sondern den Betriebszustand einer Rechtspflicht.
        *
        * ERSETZT den B1-3-Hinweis „Löschfristen werden derzeit manuell durchgesetzt" — der ist mit
        * B4-1 sachlich falsch geworden. Der Filter „nur zur Anonymisierung fällige" bleibt
        * bestehen: er zeigt jetzt, WAS der nächste Lauf anfassen wird, statt einer Arbeitsliste
        * für Handarbeit.
        */}
      <div className="mt-6">
        <JobStatus
          result={retentionRuns}
          label="Fristenlauf"
          schedule="03:15 UTC"
          itemsSeen="fällige Leads gesehen"
          itemsDone="anonymisiert"
          consequence="die Löschfristen werden derzeit nicht durchgesetzt."
          loadError="Der Stand des Fristenlaufs konnte nicht geladen werden. Damit ist unbekannt, ob die Löschfristen zurzeit durchgesetzt werden."
        />
        <JobStatus
          result={reminderRuns}
          label="Vertragsablauf-Erinnerung"
          schedule="06:40 UTC"
          itemsSeen="fällige Erinnerungen gesehen"
          itemsDone="versendet"
          consequence="Erinnerungen werden derzeit nicht versendet — wer sein Vertragsende hinterlegt hat, bekommt sie nicht."
          loadError="Der Stand der Vertragsablauf-Erinnerung konnte nicht geladen werden. Damit ist unbekannt, ob Erinnerungen zurzeit versendet werden."
        />
        <StaleContractReminders health={reminderHealth} />
      </div>

      <SourceStats stats={sourceStats} />

      {/* ── Filter ────────────────────────────────────────────────────────────────────────────── */}
      <AdminPanel className="mt-6">
        <form method="get" action={LEADS_HREF} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <Label htmlFor="filter-suche">Suche (E-Mail oder Firma)</Label>
              <div className="mt-1.5">
                <Input
                  id="filter-suche"
                  name="suche"
                  type="search"
                  defaultValue={filterSearch}
                  placeholder="teil einer Adresse oder Firma"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="filter-status">Status</Label>
              <div className="mt-1.5">
                <Select id="filter-status" name="status" defaultValue={filterStatus}>
                  <option value="">alle</option>
                  {LEAD_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {statusLabel(s)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="filter-quelle">Herkunft</Label>
              <div className="mt-1.5">
                <Select id="filter-quelle" name="quelle" defaultValue={filterSource}>
                  <option value="">alle</option>
                  {/*
                    * Die Einstiegspunkte kommen aus der DATENBANK (`lead_sources` ist eine Tabelle,
                    * kein Enum — laufend kommen neue dazu, B3). Eine Konstante hier ließe jede neue
                    * Quelle im Filter fehlen, ohne dass es auffiele.
                    */}
                  {sources.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="filter-zweck">Einwilligung — Zweck</Label>
              <div className="mt-1.5">
                <Select id="filter-zweck" name="zweck" defaultValue={filterPurpose}>
                  <option value="">alle</option>
                  {CONSENT_PURPOSES.map((p) => (
                    <option key={p} value={p}>
                      {purposeLabel(p)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="filter-einwilligung">Einwilligung — Zustand</Label>
              <div className="mt-1.5">
                <Select id="filter-einwilligung" name="einwilligung" defaultValue={filterConsent}>
                  <option value="">alle</option>
                  {Object.entries(CONSENT_STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                  <option value="none">keine (für den gewählten Zweck)</option>
                </Select>
              </div>
            </div>

            <div className="flex items-end">
              <div className="flex items-start gap-2 pb-2">
                <Checkbox id="filter-faellig" name="faellig" value="1" defaultChecked={filterDue} />
                <Label htmlFor="filter-faellig" className="font-normal">
                  nur zur Anonymisierung fällige
                </Label>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" size="md">
              Filtern
            </Button>
            <Button asChild variant="ghost" size="md">
              <Link href={LEADS_HREF}>Zurücksetzen</Link>
            </Button>
          </div>
        </form>
      </AdminPanel>

      {/* ── Ergebnis ──────────────────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="treffer" className="mt-8">
        <h2 id="treffer" className="text-h4 text-ink">
          {invalidFilter ? 'Treffer' : <><Num>{total}</Num> Treffer</>}
        </h2>

        {invalidFilter ? (
          <div className="mt-4">
            <AdminError>
              Diese Filterkombination kennt die Datenbank nicht. Bitte setzen Sie die Filter zurück.
            </AdminError>
          </div>
        ) : result === null ? (
          <div className="mt-4">
            <AdminError>
              Die Lead-Liste konnte nicht geladen werden. Bitte laden Sie die Seite neu.
            </AdminError>
          </div>
        ) : (
          <>
            <AdminPanel className="mt-4 p-0 sm:p-0">
              <div className="px-4 py-2 sm:px-6">
                <AdminTable>
                  <thead>
                    <tr>
                      <Th>E-Mail</Th>
                      <Th>Firma</Th>
                      <Th>Status</Th>
                      <Th>Herkunft</Th>
                      <Th>Einwilligungen</Th>
                      <Th>Letzte Interaktion</Th>
                      <Th>Löschfrist</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.leads.length === 0 && (
                      <EmptyRow colSpan={7}>
                        Kein Lead passt zu diesen Filtern.
                      </EmptyRow>
                    )}
                    {result.leads.map((lead) => (
                      <LeadRow key={lead.id} lead={lead} sources={result.sources} />
                    ))}
                  </tbody>
                </AdminTable>
              </div>

              {lastPage > 1 && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-6">
                  <p className="text-caption text-text-muted">
                    Seite <Num>{page}</Num> von <Num>{lastPage}</Num>
                  </p>
                  <div className="flex items-center gap-2">
                    {page > 1 && (
                      <Button asChild variant="secondary" size="sm">
                        <Link href={pageHref(query, page - 1)}>Zurück</Link>
                      </Button>
                    )}
                    {page < lastPage && (
                      <Button asChild variant="secondary" size="sm">
                        <Link href={pageHref(query, page + 1)}>Weiter</Link>
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/*
                * Bewusst OHNE Export und OHNE Sammelaktionen: beides ist B2 (Segmentierung und
                * Aussendung). Ein Export vor der Suppression-/Zustellprotokoll-Schicht wäre eine
                * Adressliste ohne die Prüfungen, die vor jedem Versand zu laufen haben.
                */}
              <p className="border-t border-line px-4 py-3 text-caption text-text-muted sm:px-6">
                Kein Export, keine Sammelaktionen — Segmentierung und Aussendung kommen mit B2.
              </p>
            </AdminPanel>
          </>
        )}
      </section>
    </Container>
  )
}
