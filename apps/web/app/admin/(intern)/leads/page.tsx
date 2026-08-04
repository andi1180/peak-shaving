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
  EMAIL_EVENT_STATS_DAYS,
  EXPORTS_HREF,
  INDUSTRIES,
  INDUSTRY_LABELS,
  JOB_STALE_AFTER_HOURS,
  LEADS_EXPORT_HREF,
  LEADS_HREF,
  LEAD_RETENTION_JOB_KEY,
  LEAD_STATUSES,
  METERING_TYPE_LABELS,
  SUPPRESSIONS_HREF,
  consentStatusLabel,
  contactName,
  emailEventLabel,
  hoursSince,
  partnerLabel,
  purposeLabel,
  readContractReminderHealth,
  readEmailEventStats,
  readJobRuns,
  readLeadList,
  readLeadSourceStats,
  readStatus,
  sourceLabel,
  statusLabel,
  type ContractReminderHealth,
  type EmailEventStats,
  type JobRunsResult,
  type LeadConsentSummary,
  type LeadListRow,
  type LeadPartner,
  type LeadSource,
  type LeadSourceStat,
} from '@/lib/admin/leads'
import {
  EMPTY_FILTERS,
  filterRpcArgs,
  filterSearchParams,
  hasAnyFilter,
  partnerTabParams,
  PARTNER_TABS,
  readFilters,
  type LeadFilters,
  type RawQuery,
} from '@/lib/admin/lead-filters'

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

/**
 * Baut eine URL mit denselben Filtern und einer geänderten Seite.
 *
 * Die Filter-Parameter kommen aus `lib/admin/lead-filters.ts` und nicht aus einer Liste hier: die
 * Export-Route liest dieselben Namen. Eine zweite Aufzählung wäre die Stelle, an der ein neuer
 * Filter beim Seitenwechsel ODER beim Export verlorengeht — beides still.
 */
function pageHref(filters: LeadFilters, page: number): string {
  const sp = filterSearchParams(filters)
  if (page > 1) sp.set('seite', String(page))
  const qs = sp.toString()
  return qs ? `${LEADS_HREF}?${qs}` : LEADS_HREF
}

/** Die Ausfuhr übernimmt GENAU den Filter, den die Sicht gerade zeigt — ohne Seitenangabe. */
function exportHref(filters: LeadFilters): string {
  const qs = filterSearchParams(filters).toString()
  return qs ? `${LEADS_EXPORT_HREF}?${qs}` : LEADS_EXPORT_HREF
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
        <li
          key={`${c.purpose}-${c.granted_at}-${i}`}
          className="flex flex-wrap items-center gap-1.5"
        >
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
        . Der Versand wird NICHT automatisch wiederholt — das wäre eine Schleife. Zu prüfen: ist{' '}
        <code>RESEND_API_KEY</code> gesetzt, und hat Resend die Mails abgelehnt? Der Grund steht je
        Fall auf der Detailseite des Leads.
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
/**
 * Rückläufer und Beschwerden der letzten 30 Tage (B2-2).
 *
 * ── WARUM DAS AUF DER ÜBERSICHTSSEITE STEHT UND NICHT IN EINER EIGENEN AUSWERTUNG ────────────────
 * Eine steigende Beschwerdequote ist die EINZIGE Frühwarnung vor einem Reputationsschaden, und
 * niemand sucht von sich aus danach. Eine Auswertung, die man erst aufrufen muss, wird genau dann
 * nicht aufgerufen, wenn sie nötig wäre — nämlich bevor jemand merkt, dass etwas nicht stimmt. Die
 * Zahl steht deshalb dort, wo ohnehin jeder hinsieht, und wird HERVORGEHOBEN, sobald überhaupt eine
 * Beschwerde auftritt: die erste ist der Zeitpunkt zu handeln, nicht die zehnte.
 *
 * `permanentBounces` ist bewusst nicht die Zahl der `email.bounced`-Zeilen: darunter fallen auch
 * vorübergehende Rückläufer, die keine Sperre auslösen. Beide Zahlen kommen deshalb aus der
 * Datenbank und werden hier NICHT nachgerechnet — es gibt genau eine Definition von „dauerhaft".
 */
function EmailEventStatsPanel({ stats }: { stats: EmailEventStats | null }) {
  if (stats === null) {
    return (
      <AdminPanel className="mt-6">
        <AdminError>
          Die Zustellstatistik konnte nicht geladen werden. Damit ist unbekannt, ob zurzeit
          Beschwerden eingehen.
        </AdminError>
      </AdminPanel>
    )
  }

  const hasComplaints = stats.complaints > 0

  return (
    <AdminPanel className={`mt-6 ${hasComplaints ? 'border-negative bg-negative-subtle' : ''}`}>
      <h2 className="text-h4 text-ink">
        Rückläufer und Beschwerden — letzte <Num>{stats.days}</Num> Tage
      </h2>
      <div className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
        <div>
          <p className="text-caption font-semibold uppercase tracking-wide text-text-muted">
            Dauerhafte Rückläufer
          </p>
          <p className="mt-0.5 text-h3 text-ink">
            <Num>{stats.permanentBounces}</Num>
          </p>
        </div>
        <div>
          <p className="text-caption font-semibold uppercase tracking-wide text-text-muted">
            Beschwerden
          </p>
          <p
            className={`mt-0.5 text-h3 ${hasComplaints ? 'font-semibold text-negative' : 'text-ink'}`}
          >
            <Num>{stats.complaints}</Num>
          </p>
        </div>
      </div>

      {hasComplaints && (
        <p className="mt-3 max-w-prose text-small text-negative">
          <strong className="font-semibold">
            Jede Beschwerde hat die Adresse gesperrt und alle Einwilligungen widerrufen.
          </strong>{' '}
          Eine steigende Beschwerdequote ist die einzige Frühwarnung vor einem Reputationsschaden
          der Absenderdomain — und der trifft dann jede Aussendung, nicht nur die auslösende.
        </p>
      )}

      {stats.counts.length > 0 && (
        <p className="mt-3 max-w-prose text-caption text-text-muted">
          Alle Ereignisse im Zeitraum:{' '}
          {stats.counts.map((c) => `${emailEventLabel(c.event_type)} ${c.event_count}`).join(' · ')}
          . „Rückläufer" enthält auch vorübergehende (volles Postfach, kurzzeitige Störung) — die
          sperren bewusst nicht und zählen deshalb oben nicht mit.
        </p>
      )}
    </AdminPanel>
  )
}

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
        Herkunft, an der sie erteilt wurden — die zweite Zahl ist deshalb kein „davon".
        Anonymisierte Leads bleiben enthalten: sie waren echter Rücklauf. Kein Export, keine
        gefilterte Sicht — beides kommt mit B2.
      </p>
    </AdminPanel>
  )
}

/**
 * Die Reiterleiste über der Liste (B18-5).
 *
 * Zwei prominente Links plus der Ausgangszustand — mehr ist es technisch nicht: sie setzen GENAU den
 * `partner`-Parameter und tragen alle übrigen aktiven Filter unverändert mit (`partnerTabParams`).
 * Damit bleibt jede bestehende Eingrenzung INNERHALB eines Reiters erhalten, und der Export-Link
 * darunter übernimmt beides ohne eigenes Zutun — er liest denselben Filterstand.
 *
 * Bewusst `<a>`-Links und kein Formular: der Reiter IST die Adresse. Eine gefilterte Sicht soll sich
 * weitergeben und per Zurück-Taste erreichen lassen, wie der ganze Rest dieser Seite (B1-3).
 */
function PartnerTabs({ filters }: { filters: LeadFilters }) {
  return (
    <nav aria-label="Zuordnung zu einem Fachbetrieb" className="mt-8">
      <ul className="flex flex-wrap gap-2 border-b border-line pb-px">
        {PARTNER_TABS.map((tab) => {
          const active = filters.partnerAssignment === tab.value
          const qs = partnerTabParams(filters, tab.value).toString()
          return (
            <li key={tab.value || 'alle'}>
              <Link
                href={qs ? `${LEADS_HREF}?${qs}` : LEADS_HREF}
                aria-current={active ? 'page' : undefined}
                className={
                  active
                    ? 'inline-block rounded-t-md border-b-2 border-accent px-4 py-2 text-body font-semibold text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring'
                    : 'inline-block rounded-t-md border-b-2 border-transparent px-4 py-2 text-body text-text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring'
                }
              >
                {tab.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/**
 * Herkunft ODER Partner — je nach Reiter dieselbe Spalte mit verschiedener Frage.
 *
 * Im Reiter „Partner-Leads" ist die Herkunft nachrangig (sie ist dort fast durchgehend dieselbe:
 * die Landingpage bzw. das Kontaktformular mit `?partner=`), und die eigentliche Frage lautet
 * „welcher Fachbetrieb". Umgekehrt hat im Reiter „Direktanfragen" per Definition kein Lead einen
 * Fachbetrieb — eine Partner-Spalte wäre dort eine Spalte aus Gedankenstrichen.
 *
 * Im Ausgangszustand („Alle") stehen beide Angaben übereinander, weil dort beide Sorten Zeilen
 * nebeneinanderliegen und sich sonst nicht unterscheiden liessen.
 */
function OriginCell({
  lead,
  sources,
  partners,
  showPartnerOnly,
}: {
  lead: LeadListRow
  sources: LeadSource[]
  partners: LeadPartner[]
  showPartnerOnly: boolean
}) {
  const partner = lead.partner_slug ? partnerLabel(lead.partner_slug, partners) : null

  if (showPartnerOnly) {
    // Kein Fachbetrieb im Partner-Reiter ist per Filter unmöglich; träte er doch auf, wäre der
    // Gedankenstrich die ehrlichere Anzeige als eine leere Zelle.
    return <>{partner ?? '—'}</>
  }

  return (
    <>
      {sourceLabel(lead.first_source_key, sources)}
      {partner && <span className="mt-1 block text-caption text-text-muted">über {partner}</span>}
    </>
  )
}

function LeadRow({
  lead,
  sources,
  partners,
  showPartnerOnly,
}: {
  lead: LeadListRow
  sources: LeadSource[]
  partners: LeadPartner[]
  showPartnerOnly: boolean
}) {
  const name = contactName(lead)
  return (
    <tr>
      <Td>{lead.company ?? '—'}</Td>
      {/*
       * Ein Gedankenstrich und nicht das Weglassen der Zeile wie im Partner-Portal (B18-3): dort ist
       * die Ansprechperson eine EIGENE Zeile in einer Aufzählung, hier eine Zelle in einer Tabelle —
       * eine ausgelassene Zelle verschöbe alle folgenden. Die Tabelle hält es an den übrigen
       * Nullable-Feldern seit jeher so (Firma).
       */}
      <Td>{name ?? '—'}</Td>
      <Td>
        {/*
         * Die E-Mail bleibt der Weg in die Detailsicht, obwohl sie nicht mehr die erste Spalte ist:
         * sie ist das einzige Feld, das jeder Lead trägt (NOT NULL) — eine Firma kann fehlen, und
         * ein Link, den es nur manchmal gibt, wäre schlechter als einer an zweiter Stelle.
         */}
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
      <Td>
        <OriginCell
          lead={lead}
          sources={sources}
          partners={partners}
          showPartnerOnly={showPartnerOnly}
        />
      </Td>
      <Td className="whitespace-nowrap">
        {/*
         * Seit B18-5 das ANLAGEdatum und nicht mehr die letzte Interaktion. Zwei Gründe: die Liste
         * ist nach `created_at` sortiert (die angezeigte Spalte erklärt damit die Reihenfolge,
         * statt eine zweite, unsichtbare zu haben), und „wann kam das herein" ist die Frage, die man
         * an einer Anfrage-Liste stellt. Die letzte Interaktion steht weiterhin auf der Detailseite,
         * wo sie zusammen mit der Löschfrist steht, die sie berechnet.
         */}
        <Num>{formatDate(lead.created_at)}</Num>
      </Td>
      <Td>
        <ConsentCell consents={lead.consents} />
      </Td>
    </tr>
  )
}

export default async function AdminLeadsPage({
  searchParams,
}: {
  searchParams: Promise<RawQuery>
}) {
  // Kein Zugang → gar keinen Inhalt erzeugen. Was der Nutzer stattdessen SIEHT, entscheidet das
  // Layout (neutrale Seite); hier geht es darum, dass nichts entsteht, das mitgeschickt werden kann.
  if (!(await isCurrentUserAdmin())) return null

  const query = await searchParams
  const filters = readFilters(query)
  const rawPage = query.seite
  const page = Math.max(
    1,
    Number.parseInt((typeof rawPage === 'string' ? rawPage : '') || '1', 10) || 1,
  )

  const supabase = await createClient()
  const res = await supabase.rpc('admin_list_leads', {
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
    ...filterRpcArgs(filters),
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
  const [retentionRes, reminderRes, healthRes, sourceStatsRes, emailStatsRes] = await Promise.all([
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
    // B2-2: die Frühwarnung. Ebenfalls ein eigener Aufruf und ebenfalls filterunabhängig — die
    // Beschwerdequote ist eine Eigenschaft der AUSSENDUNG, nicht der gerade angesehenen Teilmenge.
    supabase.rpc('admin_email_event_stats', { p_days: EMAIL_EVENT_STATS_DAYS }),
  ])
  if (retentionRes.error) console.error('[admin/leads] admin_list_job_runs:', retentionRes.error)
  if (reminderRes.error) console.error('[admin/leads] admin_list_job_runs:', reminderRes.error)
  if (healthRes.error)
    console.error('[admin/leads] admin_contract_reminder_health:', healthRes.error)
  if (sourceStatsRes.error)
    console.error('[admin/leads] admin_lead_source_stats:', sourceStatsRes.error)
  if (emailStatsRes.error)
    console.error('[admin/leads] admin_email_event_stats:', emailStatsRes.error)
  const retentionRuns = readJobRuns(retentionRes.data)
  const reminderRuns = readJobRuns(reminderRes.data)
  const reminderHealth = readContractReminderHealth(healthRes.data)
  const sourceStats = readLeadSourceStats(sourceStatsRes.data)
  const emailStats = readEmailEventStats(emailStatsRes.data)

  const result = readLeadList(res.data)
  // Ein abgelehnter Filterwert ist etwas anderes als ein Ladefehler: die Datenbank hat geantwortet,
  // nur eben ablehnend. Sie ignoriert einen unbekannten Wert bewusst NICHT still — sonst hielte man
  // ein ungefiltertes Ergebnis für gefiltert.
  const invalidFilter = readStatus(res.data) === 'invalid_filter'

  const total = result?.total ?? 0
  const exportTotal = result?.exportTotal ?? 0
  const sources = result?.sources ?? []
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  /*
   * B18-5: der aktive Reiter — aber nur, wenn der Wert einer IST. Ein unbekanntes `?partner=…`
   * markiert bewusst keinen Reiter (die Datenbank lehnt es ohnehin als `invalid_filter` ab, und die
   * Meldung darüber sagt „bitte zurücksetzen"); ein Reiter, der sich dabei als aktiv ausgäbe, machte
   * den abgelehnten Filter zu einer gültigen Sicht.
   */
  const activeTab = PARTNER_TABS.find((t) => t.value === filters.partnerAssignment)?.value ?? ''
  /*
   * Im Reiter „Partner-Leads" trägt die vierte Spalte die Partner-Identität, sonst die Herkunft.
   * Die Bedingung hängt am REITER und nicht daran, ob zufällig alle sichtbaren Zeilen einen
   * Fachbetrieb tragen — eine Spaltenüberschrift, die sich je Seite ändern könnte, wäre keine.
   */
  const showPartnerOnly = activeTab === 'assigned'
  /** Alle Filter leeren, den Reiter behalten (s. Kommentar an der Schaltfläche). */
  const resetQuery = partnerTabParams(EMPTY_FILTERS, activeTab).toString()
  const resetHref = resetQuery ? `${LEADS_HREF}?${resetQuery}` : LEADS_HREF

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
          — nachsehen, ob eine Adresse dauerhaft gesperrt ist.{' '}
          <Link
            href={EXPORTS_HREF}
            className="rounded-sm font-medium text-accent underline decoration-accent underline-offset-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Ausfuhren
          </Link>{' '}
          — wer wann eine Kopie des Bestands mitgenommen hat.
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

      <EmailEventStatsPanel stats={emailStats} />

      <SourceStats stats={sourceStats} />

      {/* ── Filter ────────────────────────────────────────────────────────────────────────────── */}
      <AdminPanel className="mt-6">
        <form method="get" action={LEADS_HREF} className="flex flex-col gap-4">
          {/*
           * Der aktive Reiter reist als verstecktes Feld mit (B18-5). Ohne ihn setzte JEDE
           * Filterabsendung die Zuordnung zurück — der Admin filterte innerhalb von
           * „Partner-Leads" und bekäme wortlos den Gesamtbestand, also genau die Menge, die
           * grösser ist als angefordert. Das Feld entsteht nur, wenn ein Reiter gesetzt ist:
           * ein leeres `partner=` in der URL wäre ein Wert, den `readFilters` erst wieder
           * verwerfen müsste.
           */}
          {filters.partnerAssignment && (
            <input type="hidden" name="partner" value={filters.partnerAssignment} />
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <Label htmlFor="filter-suche">Suche (E-Mail oder Firma)</Label>
              <div className="mt-1.5">
                <Input
                  id="filter-suche"
                  name="suche"
                  type="search"
                  defaultValue={filters.search}
                  placeholder="teil einer Adresse oder Firma"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="filter-status">Status</Label>
              <div className="mt-1.5">
                <Select id="filter-status" name="status" defaultValue={filters.status}>
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
                <Select id="filter-quelle" name="quelle" defaultValue={filters.sourceKey}>
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
                <Select id="filter-zweck" name="zweck" defaultValue={filters.consentPurpose}>
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
                <Select
                  id="filter-einwilligung"
                  name="einwilligung"
                  defaultValue={filters.consentStatus}
                >
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
                <Checkbox
                  id="filter-faellig"
                  name="faellig"
                  value="1"
                  defaultChecked={filters.dueOnly}
                />
                <Label htmlFor="filter-faellig" className="font-normal">
                  nur zur Anonymisierung fällige
                </Label>
              </div>
            </div>
          </div>

          {/*
           * ── B2-1: die Segmentierungsdimensionen aus B3-1 ─────────────────────────────────────
           * Optisch abgesetzt, weil sie eine andere Frage beantworten als die Filter darüber: die
           * oberen betreffen den Zustand eines Leads im System (Status, Herkunft, Einwilligung),
           * diese hier den BETRIEB dahinter. Das ist die Trennung, entlang derer die Aussendung
           * im November zusammengestellt wird.
           */}
          <fieldset className="border-t border-line pt-4">
            <legend className="sr-only">Betriebsmerkmale</legend>
            <p className="text-caption font-semibold uppercase tracking-wide text-text-muted">
              Betrieb
            </p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="filter-branche">Branche</Label>
                <div className="mt-1.5">
                  <Select id="filter-branche" name="branche" defaultValue={filters.industry}>
                    <option value="">alle</option>
                    {INDUSTRIES.map((key) => (
                      <option key={key} value={key}>
                        {INDUSTRY_LABELS[key]}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor="filter-messart">Messart</Label>
                <div className="mt-1.5">
                  <Select id="filter-messart" name="messart" defaultValue={filters.meteringType}>
                    <option value="">alle</option>
                    {Object.entries(METERING_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor="filter-plz">PLZ beginnt mit</Label>
                <div className="mt-1.5">
                  <Input
                    id="filter-plz"
                    name="plz"
                    inputMode="numeric"
                    maxLength={4}
                    defaultValue={filters.postalPrefix}
                    placeholder="z. B. 11"
                    aria-describedby="filter-plz-hint"
                  />
                </div>
                {/*
                 * Führende Ziffern statt vollständiger PLZ: „11" trifft die Wiener Innenbezirke.
                 * Ein Gleichheitsfilter zwänge dazu, ein Netzgebiet als Aufzählung einzelner
                 * Postleitzahlen zu treffen — und eine vergessene wäre nicht sichtbar, sondern nur
                 * eine etwas kleinere Menge.
                 */}
                <p id="filter-plz-hint" className="mt-1.5 text-caption text-text-muted">
                  Führende Ziffern — „11“ trifft alle Wiener Innenbezirke.
                </p>
              </div>

              <div>
                <Label htmlFor="filter-verbrauch-ab">Jahresverbrauch ab (kWh)</Label>
                <div className="mt-1.5">
                  <Input
                    id="filter-verbrauch-ab"
                    name="verbrauch-ab"
                    inputMode="numeric"
                    defaultValue={filters.consumptionMin}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="filter-verbrauch-bis">Jahresverbrauch bis (kWh)</Label>
                <div className="mt-1.5">
                  <Input
                    id="filter-verbrauch-bis"
                    name="verbrauch-bis"
                    inputMode="numeric"
                    defaultValue={filters.consumptionMax}
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="filter-vertragsende-ab">Vertragsende ab</Label>
                  <div className="mt-1.5">
                    <Input
                      id="filter-vertragsende-ab"
                      name="vertragsende-ab"
                      type="date"
                      defaultValue={filters.contractEndFrom}
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="filter-vertragsende-bis">Vertragsende bis</Label>
                  <div className="mt-1.5">
                    <Input
                      id="filter-vertragsende-bis"
                      name="vertragsende-bis"
                      type="date"
                      defaultValue={filters.contractEndTo}
                    />
                  </div>
                </div>
              </div>
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" size="md">
              Filtern
            </Button>
            <Button asChild variant="ghost" size="md">
              {/*
               * Zurückgesetzt werden die FILTER, nicht der Reiter: der Reiter ist die Sicht, in der
               * gearbeitet wird, und wer ihn verlassen will, klickt ihn an. Ohne diese Unterscheidung
               * wäre „Zurücksetzen" der einzige Weg, unbeabsichtigt den Bestand zu wechseln.
               */}
              <Link href={resetHref}>Zurücksetzen</Link>
            </Button>
          </div>
        </form>
      </AdminPanel>

      {/* ── Ergebnis ──────────────────────────────────────────────────────────────────────────── */}
      <PartnerTabs filters={filters} />

      <section aria-labelledby="treffer" className="mt-4">
        <h2 id="treffer" className="text-h4 text-ink">
          {invalidFilter ? (
            'Treffer'
          ) : (
            <>
              <Num>{total}</Num> Treffer
            </>
          )}
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
                      <Th>Firma</Th>
                      <Th>Ansprechperson</Th>
                      <Th>E-Mail</Th>
                      <Th>{showPartnerOnly ? 'Partner' : 'Herkunft'}</Th>
                      <Th>Datum</Th>
                      <Th>Einwilligungen</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.leads.length === 0 && (
                      <EmptyRow colSpan={6}>Kein Lead passt zu diesen Filtern.</EmptyRow>
                    )}
                    {result.leads.map((lead) => (
                      <LeadRow
                        key={lead.id}
                        lead={lead}
                        sources={result.sources}
                        partners={result.partners}
                        showPartnerOnly={showPartnerOnly}
                      />
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
                        <Link href={pageHref(filters, page - 1)}>Zurück</Link>
                      </Button>
                    )}
                    {page < lastPage && (
                      <Button asChild variant="secondary" size="sm">
                        <Link href={pageHref(filters, page + 1)}>Weiter</Link>
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/*
               * B2-1: die Ausfuhr. Sie übernimmt GENAU den Filter, den diese Sicht gerade zeigt —
               * einen Weg, ungefiltert zu exportieren, gibt es nicht; ohne Filter ist der Filter
               * „alles" und wird als solcher protokolliert.
               *
               * Die angezeigte Zahl ist `export_total` und NICHT die Trefferzahl darüber: der
               * Export schliesst gesperrte und anonymisierte Zeilen strukturell aus. Beide Zahlen
               * wären plausibel — deshalb steht hier die, die wirklich in der Datei landet, und
               * daneben, warum sie kleiner sein kann.
               *
               * Ein einfacher Link und kein Formular: der Download ist ein GET, und eine gefilterte
               * Ausfuhr soll sich als Adresse weitergeben lassen wie die Sicht selbst.
               */}
              <div className="border-t border-line px-4 py-4 sm:px-6">
                <div className="flex flex-wrap items-center gap-3">
                  <Button asChild variant="secondary" size="sm">
                    <a href={exportHref(filters)} download>
                      <Num>{exportTotal}</Num>
                      {exportTotal === 1 ? ' Zeile ausführen' : ' Zeilen ausführen'} (CSV)
                    </a>
                  </Button>
                  <span className="text-caption text-text-muted">
                    {hasAnyFilter(filters)
                      ? 'mit dem gerade angewandten Filter'
                      : 'ohne Filter — also der gesamte anschreibbare Bestand'}
                  </span>
                </div>
                <p className="mt-2 max-w-prose text-caption text-text-muted">
                  Gesperrte und anonymisierte Zeilen sind <strong>nicht</strong> enthalten — der
                  Ausschluss steht in der Abfrage, nicht in einer Einstellung: eine ausgeführte
                  Datei kann in ein fremdes Werkzeug wandern, das die Sperrliste nicht kennt.{' '}
                  {exportTotal !== total && (
                    <>
                      Von den <Num>{total}</Num> Treffern fallen dadurch{' '}
                      <Num>{total - exportTotal}</Num> heraus.{' '}
                    </>
                  )}
                  Je Zeile steht der Einwilligungsstand zu „Informationen &amp; Angebote“ in einer
                  eigenen Spalte. Jede Ausfuhr wird protokolliert (
                  <Link
                    href={EXPORTS_HREF}
                    className="rounded-sm font-medium text-accent underline decoration-accent underline-offset-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Ausfuhren
                  </Link>
                  ).
                </p>
                <p className="mt-2 max-w-prose text-caption text-text-muted">
                  Keine Sammelaktionen und kein Versand — die Aussendung kommt mit B2-2.
                </p>
              </div>
            </AdminPanel>
          </>
        )}
      </section>
    </Container>
  )
}
