import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container, Num } from '@/components/ui/layout'
import { Button } from '@/components/ui/button'
import { Checkbox, Label } from '@/components/ui/input'
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
import { ColumnFilter } from '@/components/admin/column-filter'
import {
  ActiveFilterChips,
  ChoiceFilterPanel,
  DateRangeFilterPanel,
  TextFilterPanel,
} from '@/components/admin/lead-filter-panels'
import {
  CONSENT_PURPOSES,
  CONSENT_STATUS_LABELS,
  CONTRACT_REMINDER_JOB_KEY,
  EMAIL_EVENT_STATS_DAYS,
  EXPORTS_HREF,
  LEADS_EXPORT_HREF,
  LEADS_HREF,
  LEAD_NEW_HREF,
  LEAD_RETENTION_JOB_KEY,
  JOB_STALE_AFTER_HOURS,
  SUPPRESSIONS_HREF,
  consentStatusLabel,
  hoursSince,
  emailEventLabel,
  partnerLabel,
  purposeLabel,
  readContractReminderHealth,
  readEmailEventStats,
  readJobRuns,
  readLeadList,
  readStatus,
  type ContractReminderHealth,
  type EmailEventStats,
  type JobRunsResult,
  type LeadConsentSummary,
  type LeadListRow,
  type LeadPartner,
} from '@/lib/admin/leads'
import {
  filterRpcArgs,
  filterSearchParams,
  hasAnyFilter,
  PARTNER_ASSIGNMENT_LABELS,
  readFilters,
  type LeadFilters,
  type RawQuery,
} from '@/lib/admin/lead-filters'
import {
  LEAD_SOURCE_CATEGORIES,
  LEAD_SOURCE_CATEGORY_LABELS,
  categoryOfSourceKey,
  sourceCategoryLabel,
} from '@/lib/admin/lead-source-categories'
import { themaOptions } from '@/lib/admin/lead-thema'

/*
 * `/admin/leads` — die Lead-Liste (B1-3, spaltenweise Filter seit 05.08.2026).
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
 * ── DIE FILTER SITZEN IN DEN SPALTENKÖPFEN, DER ZUSTAND BLEIBT DIE URL ───────────────────────────
 * Die grosse Filtersektion oberhalb der Liste und die drei Reiter aus B18-5 sind entfallen; an
 * ihrer Stelle steht je Spalte ein Symbol, das ein Popover öffnet. Was sich NICHT geändert hat, ist
 * das Prinzip: In jedem Popover steckt ein echtes `<form method="get">`, jede Änderung ist ein
 * Seitenaufruf, und der vollständige Filterstand steht in der Adresse. Es gibt weiterhin keinen
 * zweiten Ort, an dem er leben und mit der URL auseinanderlaufen könnte.
 *
 * Die FÄHIGKEITEN der drei Reiter sind vollständig erhalten: „nur mit Fachbetrieb" und „nur ohne
 * Fachbetrieb" stehen im Popover der Zuordnungsspalte, „alle" ist wie bisher der Zustand ohne
 * Parameter.
 *
 * ── WAS HIER BEWUSST NICHT MEHR STEHT ────────────────────────────────────────────────────────────
 * Die Auswertung „Rücklauf je Herkunft" (B3-4) ist entfernt. Sie beantwortete eine ANDERE Frage als
 * diese Seite (welcher Kanal bringt Kontakte — nicht: welcher Kontakt ist das) und zählte dafür
 * bestandsweit, also ausdrücklich an den Filtern vorbei. Über einer Liste, die sich jetzt spaltenweise
 * eingrenzen lässt, sind zwei Zahlen mit verschiedenen Bezugsgrössen nebeneinander irreführend: die
 * Tabelle zeigte fünf Treffer und der Abschnitt darüber weiterhin dreistellige Summen. Der Wrapper
 * `public.admin_lead_source_stats` bleibt bestehen und unangetastet — die Auswertung gehört auf eine
 * eigene Fläche, nicht über den Bestand.
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

/** Zahl der Spalten — steht an EINER Stelle, damit der Leerzustand nicht daneben liegt. */
const COLUMN_COUNT = 10

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
 * Ein Spaltenkopf mit Filter. Beschriftung und Symbol stehen nebeneinander, damit die Spalte auch
 * ohne geöffnetes Popover erkennen lässt, ob sie eingegrenzt ist (Farbe UND `aria-label` tragen
 * die Aussage — Farbe ist nie das einzige Merkmal, WCAG 1.4.1).
 */
function FilterTh({
  label,
  active,
  children,
  className,
}: {
  label: string
  active: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <Th className={className}>
      <span className="flex items-center gap-1 whitespace-nowrap">
        {label}
        <ColumnFilter label={label} active={active}>
          {children}
        </ColumnFilter>
      </span>
    </Th>
  )
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

/**
 * Die Zuordnungsspalte — EINE Spalte, deren Inhalt von der Herkunft abhängt.
 *
 * ── WARUM NICHT DREI SPALTEN ─────────────────────────────────────────────────────────────────────
 * Die drei möglichen Angaben schliessen einander in der Praxis fast immer aus: Ein Lead über einen
 * Partnerlink hat einen Fachbetrieb, eine intern aufgenommene Anfrage hat höchstens eine formlos
 * genannte Firma, und eine Anfrage über das Kontaktformular hat höchstens den „empfohlen
 * durch"-Freitext. Drei eigene Spalten wären damit drei überwiegend leere — und die Tabelle hätte
 * dreizehn statt zehn.
 *
 * ── DIE HERKUNFT ENTSCHEIDET, WAS GEZEIGT WIRD, ABER NICHT ALLEIN ────────────────────────────────
 * Bei einer intern aufgenommenen Anfrage kann BEIDES gesetzt sein (B19-Nachbesserung: es gibt
 * bewusst keinen CHECK dagegen — ein Lead kann über den Link von Betrieb A hereingekommen sein und
 * beim Rückruf Betrieb B genannt haben). Deshalb wird nicht „entweder/oder" geraten, sondern
 * gezeigt, was tatsächlich dasteht — und WELCHES von beidem es ist, steht als Kennzeichnung dabei.
 * Ohne sie sähe eine formlos getippte Notiz aus wie ein freigeschalteter Fachbetrieb, und die
 * beiden bedeuten grundverschiedene Dinge (die eine ist ein Zugriffsrecht, die andere eine Notiz).
 */
function AssignmentCell({ lead, partners }: { lead: LeadListRow; partners: LeadPartner[] }) {
  const category = categoryOfSourceKey(lead.first_source_key)
  const partner = lead.partner_slug ? partnerLabel(lead.partner_slug, partners) : null
  const mentioned = lead.mentioned_business_name

  if (category === 'partner') {
    // Kein Fachbetrieb bei dieser Herkunft ist der Fall „Betrieb stillgelegt, Mail lag noch in
    // Postfächern" (B16-2): die Anfrage kam an, die Zuordnung wurde verworfen. Leer ist dann die
    // richtige Anzeige — es gibt nichts zuzuordnen.
    return partner ? <>{partner}</> : <Empty />
  }

  if (category === 'admin') {
    if (!partner && !mentioned) return <Empty />
    return (
      <span className="flex flex-col gap-0.5">
        {partner && <span>{partner}</span>}
        {mentioned && (
          <span>
            {mentioned}
            <span className="block text-caption text-text-muted">formlos genannt</span>
          </span>
        )}
      </span>
    )
  }

  // „Kontaktformular": der Freitext des Interessenten. Eine BEOBACHTUNG, kein Urteil — die
  // Kennzeichnung sagt das, damit sie niemand für eine bestätigte Zuordnung hält (B16-1).
  if (!lead.referred_by_text) return <Empty />
  return (
    <span>
      {lead.referred_by_text}
      <span className="block text-caption text-text-muted">empfohlen von (Angabe)</span>
    </span>
  )
}

/**
 * Eine leere Zelle — wirklich leer.
 *
 * ── WARUM KEIN „—" ──────────────────────────────────────────────────────────────────────────────
 * Bei zehn Spalten, von denen drei regelmässig nichts enthalten (Telefon, Zuordnung, Thema), wäre
 * eine Spalte voller Gedankenstriche optisches Rauschen, das sich beim Überfliegen wie Inhalt
 * liest. Die Zelle bleibt trotzdem eine Zelle — anders als im Partner-Portal (B18-3) wird hier
 * keine Zeile ausgelassen, das verschöbe alle folgenden Spalten.
 *
 * ── UND AUCH KEIN VERSTECKTES „nicht angegeben" ─────────────────────────────────────────────────
 * Der erste Entwurf trug ein `sr-only`-„nicht angegeben". Im Browserlauf gemessen: `sr-only`
 * blendet über `clip` aus, nicht über `display` — der Text steht damit im `innerText` und landet
 * beim KOPIEREN der Tabelle mit. Eine Lead-Liste wird kopiert (in eine Tabellenkalkulation, in eine
 * Mail), und dort stünde dann in jeder dritten Zelle ein Wort, das niemand geschrieben hat. Eine
 * leere Tabellenzelle ist ohnehin die konventionelle Form für „keine Angabe"; die Spaltenüberschrift
 * bleibt vorgelesen, weil `Th` sie als `scope="col"` führt.
 */
function Empty() {
  return null
}

function LeadRow({
  lead,
  partners,
  themaLabels,
}: {
  lead: LeadListRow
  partners: LeadPartner[]
  themaLabels: Map<string, string>
}) {
  return (
    <tr>
      <Td>{lead.company ?? <Empty />}</Td>
      <Td>{lead.first_name ?? <Empty />}</Td>
      <Td>{lead.last_name ?? <Empty />}</Td>
      <Td>
        {/*
         * Die E-Mail bleibt der Weg in die Detailsicht: sie ist das einzige Feld, das jeder Lead
         * trägt (NOT NULL) — eine Firma kann fehlen, und ein Link, den es nur manchmal gibt, wäre
         * schlechter als einer in der Mitte der Zeile.
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
      <Td className="whitespace-nowrap">{lead.phone ?? <Empty />}</Td>
      <Td>{sourceCategoryLabel(lead.first_source_key)}</Td>
      <Td>
        <AssignmentCell lead={lead} partners={partners} />
      </Td>
      <Td>
        {/*
         * Das LABEL, nicht der Schlüssel — aufgelöst über dieselbe Taxonomie, die das öffentliche
         * Dropdown füllt. Ein Schlüssel, den die heutige Liste nicht mehr kennt (umbenanntes
         * Leistungsfeld, Altbestand), wird ROH gezeigt statt verschwiegen: ein leeres Feld sähe aus
         * wie „nicht angegeben" und wäre eine Angabe (`lib/admin/lead-thema.ts`).
         */}
        {lead.thema ? (themaLabels.get(lead.thema) ?? lead.thema) : <Empty />}
      </Td>
      <Td className="whitespace-nowrap">
        {/*
         * Das ANLAGEdatum (seit B18-5). Zwei Gründe: die Liste ist nach `created_at` sortiert (die
         * angezeigte Spalte erklärt damit die Reihenfolge, statt eine zweite, unsichtbare zu haben),
         * und „wann kam das herein" ist die Frage, die man an eine Anfrage-Liste stellt. Die letzte
         * Interaktion steht weiterhin auf der Detailseite, wo sie zusammen mit der Löschfrist steht,
         * die sie berechnet.
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

  /*
   * Die Themen-Beschriftungen kommen aus der ÖFFENTLICHEN Taxonomie und werden SERVERSEITIG mit
   * fester Locale aufgelöst — derselbe Weg wie im Aufnahmeformular (B19). Der Admin-Bereich hält
   * seine eigenen Sätze sonst im Code (`lib/admin/schema.ts`); das gilt weiterhin und wird hier
   * nicht aufgeweicht: aufgelöst werden ausschliesslich fremde Texte, die dieser Bereich nur
   * anzeigt und nie besitzt. Ins Client-Bündel wandern fertige Zeichenketten, kein Katalog.
   */
  const [tNav, tKontakt] = await Promise.all([
    getTranslations({ locale: 'de', namespace: 'Nav' }),
    getTranslations({ locale: 'de', namespace: 'Kontakt' }),
  ])
  const themen = themaOptions((namespace, key) => (namespace === 'Nav' ? tNav(key) : tKontakt(key)))
  const themaLabels = new Map(themen.map((t) => [t.key, t.label]))

  // Weitere, voneinander unabhängige Aufrufe: der Stand der zeitgesteuerten Jobs (B4-1/B4-2) und
  // der Befund offener Erinnerungen. Bewusst NICHT in `admin_list_leads` hineingezogen — die
  // Lead-Liste ist gefiltert und seitenweise, der Job-Stand ist keines von beidem; ein gemeinsamer
  // Wrapper müsste bei jedem Seitenwechsel dasselbe mitliefern. Ein Fehler in einem Aufruf darf die
  // übrigen nicht mitreissen.
  //
  // Je Job ein eigener Aufruf statt eines gemeinsamen mit `p_job_key => null`: sonst müsste die
  // Seite die Läufe hier auseinandersortieren, und `last_success` käme gemischt zurück — der
  // Fristenlauf würde die Erinnerung als „läuft" ausweisen (oder umgekehrt).
  const [retentionRes, reminderRes, healthRes, emailStatsRes] = await Promise.all([
    supabase.rpc('admin_list_job_runs', {
      p_job_key: LEAD_RETENTION_JOB_KEY,
      // 5 statt 1: der LETZTE Lauf (evtl. verweigert) und der letzte ERFOLGREICHE können
      // verschiedene sein — beide müssen in einer Antwort Platz haben, ohne dass die Seite
      // nachfragen muss.
      p_limit: 5,
    }),
    supabase.rpc('admin_list_job_runs', { p_job_key: CONTRACT_REMINDER_JOB_KEY, p_limit: 5 }),
    supabase.rpc('admin_contract_reminder_health'),
    // B2-2: die Frühwarnung. Ein eigener Aufruf und filterunabhängig — die Beschwerdequote ist eine
    // Eigenschaft der AUSSENDUNG, nicht der gerade angesehenen Teilmenge.
    supabase.rpc('admin_email_event_stats', { p_days: EMAIL_EVENT_STATS_DAYS }),
  ])
  if (retentionRes.error) console.error('[admin/leads] admin_list_job_runs:', retentionRes.error)
  if (reminderRes.error) console.error('[admin/leads] admin_list_job_runs:', reminderRes.error)
  if (healthRes.error)
    console.error('[admin/leads] admin_contract_reminder_health:', healthRes.error)
  if (emailStatsRes.error)
    console.error('[admin/leads] admin_email_event_stats:', emailStatsRes.error)
  const retentionRuns = readJobRuns(retentionRes.data)
  const reminderRuns = readJobRuns(reminderRes.data)
  const reminderHealth = readContractReminderHealth(healthRes.data)
  const emailStats = readEmailEventStats(emailStatsRes.data)

  const result = readLeadList(res.data)
  // Ein abgelehnter Filterwert ist etwas anderes als ein Ladefehler: die Datenbank hat geantwortet,
  // nur eben ablehnend. Sie ignoriert einen unbekannten Wert bewusst NICHT still — sonst hielte man
  // ein ungefiltertes Ergebnis für gefiltert.
  const invalidFilter = readStatus(res.data) === 'invalid_filter'

  const total = result?.total ?? 0
  const exportTotal = result?.exportTotal ?? 0
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <Container className="py-10 sm:py-14">
      <header className="border-b border-line pb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-h2 text-ink">Leads</h1>
          {/*
           * B19 — der einzige Weg, von Hand einen Lead anzulegen (telefonische Anfragen). Steht
           * oben und nicht am Ende der Liste: Er wird während eines Telefonats gebraucht, nicht
           * nach dem Durchsehen des Bestands.
           */}
          <Button asChild variant="primary" size="md">
            <Link href={LEAD_NEW_HREF}>Lead anlegen</Link>
          </Button>
        </div>
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

      {/* ── Ergebnis ──────────────────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="treffer" className="mt-8">
        <h2 id="treffer" className="text-h4 text-ink">
          {invalidFilter ? (
            'Treffer'
          ) : (
            <>
              <Num>{total}</Num> Treffer
            </>
          )}
        </h2>

        <ActiveFilterChips filters={filters} themaLabels={themaLabels} />

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
                      <FilterTh label="Firma" active={!!filters.company}>
                        <TextFilterPanel
                          filters={filters}
                          param="firma"
                          value={filters.company}
                          clear={{ company: '' }}
                          placeholder="Teil des Firmennamens"
                        />
                      </FilterTh>
                      <FilterTh label="Vorname" active={!!filters.firstName}>
                        <TextFilterPanel
                          filters={filters}
                          param="vorname"
                          value={filters.firstName}
                          clear={{ firstName: '' }}
                        />
                      </FilterTh>
                      <FilterTh label="Name" active={!!filters.lastName}>
                        <TextFilterPanel
                          filters={filters}
                          param="nachname"
                          value={filters.lastName}
                          clear={{ lastName: '' }}
                        />
                      </FilterTh>
                      <FilterTh label="E-Mail" active={!!filters.email}>
                        <TextFilterPanel
                          filters={filters}
                          param="mail"
                          value={filters.email}
                          clear={{ email: '' }}
                          placeholder="Teil der Adresse"
                        />
                      </FilterTh>
                      <FilterTh label="Telefon" active={!!filters.phone}>
                        <TextFilterPanel
                          filters={filters}
                          param="telefon"
                          value={filters.phone}
                          clear={{ phone: '' }}
                        />
                      </FilterTh>
                      <FilterTh
                        label="Herkunft"
                        active={filters.sourceCategories.length > 0 || !!filters.sourceKey}
                      >
                        <ChoiceFilterPanel
                          filters={filters}
                          param="herkunft"
                          selected={filters.sourceCategories}
                          clear={{ sourceCategories: [] }}
                          choices={LEAD_SOURCE_CATEGORIES.map((category) => ({
                            value: category,
                            label: LEAD_SOURCE_CATEGORY_LABELS[category],
                          }))}
                        />
                      </FilterTh>
                      <FilterTh
                        label="Zuordnung"
                        active={!!filters.assignment || !!filters.partnerAssignment}
                      >
                        {/*
                         * ZWEI Fragen in EINEM Popover, und sie sind bewusst verschieden: das
                         * Suchfeld trifft den angezeigten TEXT (Fachbetrieb, formlos genannte
                         * Firma, „empfohlen von"-Freitext), die zwei Ankreuzfelder die bestätigte
                         * ZUORDNUNG (`partner_slug`) — die Fähigkeit der drei B18-5-Reiter.
                         * Beobachtung und Urteil bleiben damit auch in der Bedienung getrennt
                         * (B16-1), stehen aber dort, wo man sie sucht: an der Spalte.
                         */}
                        <div className="flex flex-col gap-3">
                          <TextFilterPanel
                            filters={filters}
                            param="zuordnung"
                            value={filters.assignment}
                            clear={{ assignment: '' }}
                            placeholder="Fachbetrieb, Firma oder Angabe"
                          />
                          <div className="border-t border-line pt-3">
                            <form method="get" action={LEADS_HREF}>
                              <PartnerAssignmentChoice filters={filters} />
                            </form>
                          </div>
                        </div>
                      </FilterTh>
                      <FilterTh
                        label="Thema"
                        active={filters.themaKeys.length > 0 || filters.themaNone}
                      >
                        <ChoiceFilterPanel
                          filters={filters}
                          param="thema"
                          selected={filters.themaKeys}
                          clear={{ themaKeys: [], themaNone: false }}
                          choices={themen.map((t) => ({ value: t.key, label: t.label }))}
                          extraParams={['thema-leer']}
                          extra={
                            <div className="flex items-start gap-2 border-t border-line pt-2">
                              <Checkbox
                                id="f-thema-leer"
                                name="thema-leer"
                                value="1"
                                defaultChecked={filters.themaNone}
                              />
                              <Label htmlFor="f-thema-leer" className="font-normal leading-tight">
                                ohne Thema
                                <span className="block text-caption text-text-muted">
                                  z. B. Warteliste, Registrierung, Telefonaufnahme
                                </span>
                              </Label>
                            </div>
                          }
                        />
                      </FilterTh>
                      <FilterTh
                        label="Datum"
                        active={!!filters.createdFrom || !!filters.createdTo}
                        className="whitespace-nowrap"
                      >
                        <DateRangeFilterPanel filters={filters} />
                      </FilterTh>
                      <FilterTh
                        label="Einwilligungen"
                        active={
                          filters.consentPurposes.length > 0 || filters.consentStates.length > 0
                        }
                      >
                        {/*
                         * Zwei Ankreuzlisten in EINEM Formular — Zweck UND Zustand. Getrennt
                         * abzusenden hiesse, dass die zweite Auswahl die erste überschreibt: ein
                         * GET-Formular schickt nur seine eigenen Felder, und der jeweils andere
                         * Parameter fiele beim Absenden weg.
                         */}
                        <form method="get" action={LEADS_HREF}>
                          <ConsentChoice filters={filters} />
                        </form>
                      </FilterTh>
                    </tr>
                  </thead>
                  <tbody>
                    {result.leads.length === 0 && (
                      <EmptyRow colSpan={COLUMN_COUNT}>Kein Lead passt zu diesen Filtern.</EmptyRow>
                    )}
                    {result.leads.map((lead) => (
                      <LeadRow
                        key={lead.id}
                        lead={lead}
                        partners={result.partners}
                        themaLabels={themaLabels}
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
                      ? 'mit den gerade gesetzten Spaltenfiltern'
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
                  Die formlos genannte Firma steht in der Liste, aber bewusst nicht in der Datei —
                  ein Filter schränkt Zeilen ein, eine zusätzliche Spalte änderte das Dateiformat.
                </p>
              </div>
            </AdminPanel>
          </>
        )}
      </section>
    </Container>
  )
}

/**
 * Die zwei Zustände der Fachbetrieb-Zuordnung als Ankreuzfelder — die Fähigkeit der B18-5-Reiter.
 *
 * Bewusst als Auswahl aus ZWEI Feldern und nicht als drei Optionsfelder: „beide angekreuzt" ist
 * dasselbe wie „keins angekreuzt" (jeder Lead hat einen Fachbetrieb oder keinen), und ein dritter
 * Zustand „alle" wäre eine Schaltfläche, die nichts tut, was das Zurücksetzen nicht schon tut.
 */
function PartnerAssignmentChoice({ filters }: { filters: LeadFilters }) {
  return (
    <>
      {[...filterSearchParams(filters).entries()]
        .filter(([name]) => name !== 'partner')
        .map(([name, value], i) => (
          <input key={`${name}-${value}-${i}`} type="hidden" name={name} value={value} />
        ))}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-caption font-semibold uppercase tracking-wide text-text-muted">
          Fachbetrieb
        </legend>
        {(['assigned', 'unassigned'] as const).map((value) => (
          <div key={value} className="flex items-start gap-2">
            {/*
             * Ein Optionsfeld (`radio`) statt einer Ankreuzbox: die beiden Zustände schliessen
             * einander aus. Ohne einen Weg zurück auf „alle" wäre die Auswahl allerdings eine
             * Falle — dafür gibt es „Zurücksetzen" darunter.
             */}
            <input
              type="radio"
              id={`f-partner-${value}`}
              name="partner"
              value={value}
              defaultChecked={filters.partnerAssignment === value}
              className="mt-1 h-4 w-4 accent-accent"
            />
            <Label htmlFor={`f-partner-${value}`} className="font-normal leading-tight">
              {PARTNER_ASSIGNMENT_LABELS[value]}
            </Label>
          </div>
        ))}
      </fieldset>
      <div className="mt-3 flex items-center justify-between gap-2">
        <Button type="submit" variant="primary" size="sm">
          Übernehmen
        </Button>
        <Link
          href={
            filterSearchParams({ ...filters, partnerAssignment: '' }).toString()
              ? `${LEADS_HREF}?${filterSearchParams({ ...filters, partnerAssignment: '' })}`
              : LEADS_HREF
          }
          className="rounded-sm text-caption text-text-muted underline underline-offset-2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring"
        >
          Zurücksetzen
        </Link>
      </div>
    </>
  )
}

/** Zweck UND Zustand in EINEM Formular — s. Kommentar an der Spalte. */
function ConsentChoice({ filters }: { filters: LeadFilters }) {
  const purposes = new Set(filters.consentPurposes)
  const states = new Set(filters.consentStates)
  return (
    <>
      {[...filterSearchParams(filters).entries()]
        .filter(([name]) => name !== 'zweck' && name !== 'einwilligung')
        .map(([name, value], i) => (
          <input key={`${name}-${value}-${i}`} type="hidden" name={name} value={value} />
        ))}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-caption font-semibold uppercase tracking-wide text-text-muted">
          Zweck
        </legend>
        {CONSENT_PURPOSES.map((purpose) => (
          <div key={purpose} className="flex items-start gap-2">
            <Checkbox
              id={`f-zweck-${purpose}`}
              name="zweck"
              value={purpose}
              defaultChecked={purposes.has(purpose)}
            />
            <Label htmlFor={`f-zweck-${purpose}`} className="font-normal leading-tight">
              {purposeLabel(purpose)}
            </Label>
          </div>
        ))}
      </fieldset>
      <fieldset className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
        <legend className="mb-1 text-caption font-semibold uppercase tracking-wide text-text-muted">
          Zustand
        </legend>
        {Object.entries(CONSENT_STATUS_LABELS).map(([value, label]) => (
          <div key={value} className="flex items-start gap-2">
            <Checkbox
              id={`f-einw-${value}`}
              name="einwilligung"
              value={value}
              defaultChecked={states.has(value)}
            />
            <Label htmlFor={`f-einw-${value}`} className="font-normal leading-tight">
              {label}
            </Label>
          </div>
        ))}
        {/*
         * Die Umkehrung: KEINE (passende) Einwilligung. Sie steht bei den Zuständen, weil sie einer
         * ist — und sie darf mit echten Zuständen zusammen angekreuzt sein (dann gilt „oder").
         */}
        <div className="flex items-start gap-2 border-t border-line pt-2">
          <Checkbox
            id="f-einw-none"
            name="einwilligung"
            value="none"
            defaultChecked={states.has('none')}
          />
          <Label htmlFor="f-einw-none" className="font-normal leading-tight">
            keine
            <span className="block text-caption text-text-muted">
              ohne Zweck: gar keine Einwilligung
            </span>
          </Label>
        </div>
      </fieldset>
      <div className="mt-3 flex items-center justify-between gap-2">
        <Button type="submit" variant="primary" size="sm">
          Übernehmen
        </Button>
        <Link
          href={
            filterSearchParams({ ...filters, consentPurposes: [], consentStates: [] }).toString()
              ? `${LEADS_HREF}?${filterSearchParams({ ...filters, consentPurposes: [], consentStates: [] })}`
              : LEADS_HREF
          }
          className="rounded-sm text-caption text-text-muted underline underline-offset-2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring"
        >
          Zurücksetzen
        </Link>
      </div>
    </>
  )
}
