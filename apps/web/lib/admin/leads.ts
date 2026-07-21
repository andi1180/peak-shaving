/**
 * Vokabular und Antwort-Leser des Admin-Abschnitts „Leads" (B1-3).
 *
 * REIN: kein `server-only`, kein `next/*` — Server Components lesen die Typen, die Client-Formulare
 * die Beschriftungen. Gleiche Aufteilung wie `lib/admin/types.ts` + `lib/admin/config.ts` (T4-4).
 *
 * Die Zeilen-Typen sind eine BEHAUPTUNG über die Migration, kein Beweis (die Wrapper geben `jsonb`
 * zurück, der Typgenerator kennt davon nur `Json`). Deshalb lesen die Funktionen unten defensiv:
 * fehlt der erwartete Schlüssel oder ist der Status nicht `ok`, kommt `null` zurück statt eines
 * Laufzeitfehlers mitten im Rendern — und der Aufrufer kann „konnte nicht geladen werden" von
 * „nichts gefunden" unterscheiden.
 */

/** Basispfad des Lead-Abschnitts — ohne Locale-Präfix, wie der ganze Admin-Bereich. */
export const LEADS_HREF = '/admin/leads'
export const SUPPRESSIONS_HREF = '/admin/leads/sperrliste'
/** Das Protokoll der Ausfuhren (B2-1). */
export const EXPORTS_HREF = '/admin/leads/exporte'
/** Die Ausfuhr selbst — ein Route Handler, kein Seitenpfad; die Filter hängen als Query an. */
export const LEADS_EXPORT_HREF = '/admin/leads/export'

// ── Lebenszyklus ─────────────────────────────────────────────────────────────────────────────────
// Spiegel des CHECK auf `platform.leads.status`. Als Konstante zulässig (anders als die
// Einstiegspunkte): der CHECK ist eine feste, kurze Liste, und jeder Wert hat eigene Bedeutung im
// Anwendungscode. Weicht sie ab, lehnt die Datenbank den Wert ohnehin ab.
export const LEAD_STATUSES = ['new', 'contacted', 'customer', 'anonymized'] as const
export type LeadStatus = (typeof LEAD_STATUSES)[number]

/**
 * Die Werte, die sich SETZEN lassen — echte Teilmenge, und zwar aus einem fachlichen Grund:
 * `anonymized` ist die FOLGE der Anonymisierung, nicht ihr Auslöser. Der Wrapper lehnt ihn ebenfalls
 * ab (`invalid_status`); hier steht er nicht zur Auswahl, damit die Ablehnung gar nicht erst
 * provoziert wird.
 */
export const SETTABLE_LEAD_STATUSES = ['new', 'contacted', 'customer'] as const
export type SettableLeadStatus = (typeof SETTABLE_LEAD_STATUSES)[number]

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'Neu',
  contacted: 'Kontaktiert',
  customer: 'Kunde',
  anonymized: 'Anonymisiert',
}

// ── Einwilligungszwecke ──────────────────────────────────────────────────────────────────────────
// Spiegel des Postgres-Enums `platform.consent_purpose`. Enum und nicht Tabelle, weil der
// Anwendungscode jeden Zweck kennen MUSS (B1-1) — genau deshalb darf er hier stehen.
export const CONSENT_PURPOSES = [
  'marketing_email',
  'contract_expiry_reminder',
  'result_delivery',
] as const
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number]

export const CONSENT_PURPOSE_LABELS: Record<ConsentPurpose, string> = {
  marketing_email: 'Informationen & Angebote',
  contract_expiry_reminder: 'Vertragsablauf-Erinnerung',
  result_delivery: 'Ergebnis-Zusendung',
}

// ── Segmentierungsmerkmale (B3-1) ────────────────────────────────────────────────────────────────
// Spiegel des Postgres-Enums `platform.industry`. Als Konstante zulässig — und zwar aus DEMSELBEN
// Grund, aus dem die Migration ein Enum und keine Referenztabelle anlegt: der Anwendungscode MUSS
// jede Branche kennen, weil er je Branche eine Vollbenutzungsstunden-Kennzahl braucht (B3-3). Eine
// neue Branche ist deshalb zwangsläufig ein gemeinsames Code- und Migrationsereignis. `lead_sources`
// bleibt das Gegenbeispiel: Einstiegspunkte kommen laufend dazu und werden NIE gespiegelt.
export const INDUSTRIES = [
  'baeckerei',
  'gastronomie',
  'handel',
  'hotellerie',
  'tischlerei',
  'landwirtschaft',
  'kuehlhaus',
  'metallverarbeitung',
  'buero_dienstleistung',
  'sonstige',
] as const
export type Industry = (typeof INDUSTRIES)[number]

export const INDUSTRY_LABELS: Record<Industry, string> = {
  baeckerei: 'Bäckerei',
  gastronomie: 'Gastronomie',
  handel: 'Handel',
  hotellerie: 'Hotellerie',
  tischlerei: 'Tischlerei',
  landwirtschaft: 'Landwirtschaft',
  kuehlhaus: 'Kühlhaus',
  metallverarbeitung: 'Metallverarbeitung',
  buero_dienstleistung: 'Büro & Dienstleistung',
  sonstige: 'Sonstige',
}

/**
 * Messart. `unknown` ist ein GEPRÜFTES Ergebnis („nicht bestimmbar"), `null` heisst „nie geprüft" —
 * die Oberfläche muss die beiden auseinanderhalten, sonst liest sich ein noch nicht durchgeführter
 * Betroffenheits-Check wie ein ergebnisloser.
 */
export const METERING_TYPE_LABELS: Record<string, string> = {
  leistungsgemessen: 'leistungsgemessen',
  netzebene_7: 'Netzebene 7',
  unknown: 'geprüft, nicht bestimmbar',
}

/**
 * Zustände einer Einwilligung. `expired` erreicht die Oberfläche über den ABGELEITETEN Zustand
 * (`platform.consent_effective_status`): B1-2 setzt ihn lazy, gespeichert steht eine verfallene
 * Bestätigung weiter als `pending`. Angezeigt wird deshalb immer `effective_status`.
 */
export const CONSENT_STATUS_LABELS: Record<string, string> = {
  pending: 'offen',
  confirmed: 'bestätigt',
  withdrawn: 'widerrufen',
  expired: 'abgelaufen',
}

// ── Zeilen-Typen ─────────────────────────────────────────────────────────────────────────────────

export type LeadConsentSummary = {
  purpose: string
  /** Wie gespeichert. */
  status: string
  /** Wie wirksam — das ist der Zustand, der angezeigt und gefiltert wird. */
  effective_status: string
  granted_at: string
  confirmed_at: string | null
  withdrawn_at: string | null
}

/**
 * Die sechs Segmentierungsmerkmale (B3-1). Stehen seit B2-1 in der LISTE und nicht mehr nur in der
 * Detailsicht: ohne sie liesse sich ein gesetzter Filter nicht am Ergebnis nachvollziehen — man
 * sähe nur, dass die Menge kleiner wurde, nicht warum.
 */
export type LeadSegments = {
  industry: Industry | null
  postal_code: string | null
  annual_consumption_kwh: number | null
  metering_type: string | null
  supplier: string | null
  /** Reines Datum („YYYY-MM-DD"), keine Zeitangabe. */
  contract_end_date: string | null
}

export type LeadListRow = LeadSegments & {
  id: string
  email: string
  company: string | null
  contact_name: string | null
  phone: string | null
  status: string
  first_source_key: string
  retention_basis: string
  last_interaction_at: string
  deletion_due_at: string
  deletion_due: boolean
  anonymized_at: string | null
  anonymized_by: string | null
  created_at: string
  is_suppressed: boolean
  consents: LeadConsentSummary[]
}

export type LeadSource = { key: string; label: string }

export type LeadListResult = {
  leads: LeadListRow[]
  /** Treffer des Filters — NICHT die Zahl der Zeilen, die eine Ausfuhr enthielte. */
  total: number
  /**
   * Wie viele Zeilen eine Ausfuhr mit DEMSELBEN Filter enthielte: ohne gesperrte und anonymisierte
   * (B2-1, die zwei strukturellen Ausschlüsse stehen in der Abfrage). Getrennt geführt, weil eine
   * Oberfläche, die `total` als Export-Zeilenzahl anzeigt, eine Datei verspricht, die es so nicht
   * gibt — und die Differenz fiele niemandem auf, weil beide Zahlen plausibel sind.
   */
  exportTotal: number
  limit: number
  offset: number
  sources: LeadSource[]
}

export type LeadConsentDetail = LeadConsentSummary & {
  id: string
  source_key: string
  /** Klartext-Bezeichnung des Einstiegspunkts (lead_sources ist eine Tabelle, kein Enum). */
  source_label: string | null
  source_ip: string | null
  user_agent: string | null
  consent_text_version: number
  consent_text_locale: string
  consent_text_body: string
  requires_double_opt_in: boolean
}

export type LeadDetailRow = LeadListRow & {
  updated_at: string
  /** Klartext-Bezeichnung von `first_source_key` — kommt aus der DB, nicht aus einer Konstante. */
  first_source_label: string | null
  /** null, wenn das handelnde Konto inzwischen gelöscht wurde (ON DELETE SET NULL). */
  anonymized_by_email: string | null
  /*
   * B4-1: true = der Fristenlauf war der Urheber, nicht ein Mensch. Ohne dieses Feld läse die
   * Detailseite ein leeres `anonymized_by` weiterhin als „inzwischen gelöschtes Konto" — bei einem
   * Systemlauf die Behauptung eines Kontos, das es nie gab. Die Datenbank erzwingt per CHECK, dass
   * nie beides zugleich gesetzt ist.
   */
  anonymized_by_system: boolean
  /*
   * B2-1: WER zuletzt eine Stammdatenkorrektur vorgenommen hat. `last_edited_by = null` heisst
   * entweder „nie von Hand bearbeitet" ODER „handelndes Konto gelöscht" (ON DELETE SET NULL) — die
   * Zeile enthält die Antwort nicht, und die Oberfläche behauptet sie deshalb auch nicht. Ist die
   * UUID gesetzt, aber die E-Mail null, ist das Konto gelöscht (dieselbe Lesart wie bei
   * anonymized_by, B1-3).
   */
  last_edited_by: string | null
  last_edited_by_email: string | null
}

// ── Versandprotokoll der Vertragsablauf-Erinnerung (B4-2) ───────────────────────────────────────

/**
 * Eine Zeile aus `platform.contract_reminders`.
 *
 * `delivered_at = null` UND `error = null` ist KEIN Widerspruch, sondern der Abbruchfall: die Zeile
 * wurde beansprucht, und der Lauf ist vor der Rückmeldung gestorben. Die Oberfläche muss die drei
 * Zustände (zugestellt · fehlgeschlagen · offen) auseinanderhalten — „nicht zugestellt" allein wäre
 * die falsche Zusammenfassung.
 */
export type ContractReminderRow = {
  /** Reines Datum („YYYY-MM-DD") — Teil des Primärschlüssels, nicht der aktuelle Wert am Lead. */
  contract_end_date: string
  attempted_at: string
  delivered_at: string | null
  error: string | null
}

export type LeadDetailResult = {
  lead: LeadDetailRow
  consents: LeadConsentDetail[]
  /** Alle Erinnerungszeilen des Leads, jüngstes Vertragsende zuerst (B4-2). */
  contractReminders: ContractReminderRow[]
}

/**
 * Der Befund aus `public.admin_contract_reminder_health` (B4-2): beansprucht, aber nie bestätigt
 * versendet — und älter als die Schwelle, die die DATENBANK verwendet hat. `stale_after_hours`
 * fährt deshalb mit: die Oberfläche zeigt die benutzte Zahl und behauptet keine eigene.
 */
export type ContractReminderHealth = {
  staleCount: number
  oldestAttemptedAt: string | null
  staleAfterHours: number
}

// ── Herkunftszählung (B3-4) ──────────────────────────────────────────────────────────────────────

/**
 * Eine Zeile aus `public.admin_lead_source_stats`.
 *
 * DIE BEIDEN ZAHLEN HABEN VERSCHIEDENE BEZUGSGRÖSSEN, und das ist Absicht (ausführlich in der
 * B3-4-Migration): `leadCount` zählt über `leads.first_source_key` — wo der Lead ins System kam;
 * `confirmedMarketingCount` über `consents.source_key` — wo GENAU DIESE Einwilligung erteilt wurde.
 * Sonst würde die Reaktion auf eine Kampagne dem älteren Kanal gutgeschrieben, über den dieselbe
 * Person Monate zuvor hereinkam. Folge: die Spalten verhalten sich NICHT wie „davon", und die
 * Oberfläche sagt das auch.
 */
export type LeadSourceStat = {
  key: string
  label: string
  is_active: boolean
  lead_count: number
  confirmed_marketing_count: number
}

// ── Exportprotokoll (B2-1) ───────────────────────────────────────────────────────────────────────

/**
 * Eine Zeile aus `public.admin_list_exports`.
 *
 * `exported_by_email = null` bei gesetzter `exported_by` heisst „Konto inzwischen gelöscht"
 * (ON DELETE SET NULL) — der Vorgang bleibt belegt, nur die Zuschreibung entfällt. Dieselbe Lesart
 * wie bei `anonymized_by` (B1-3).
 */
export type AdminExportRow = {
  id: string
  exported_at: string
  row_count: number
  filter_summary: string
  exported_by: string | null
  exported_by_email: string | null
}

// ── Laufprotokoll der zeitgesteuerten Jobs (B4-1) ────────────────────────────────────────────────

/**
 * Schlüssel des Fristenlaufs — Spiegel des CHECK auf `platform.job_runs.job_key`. Als Konstante
 * zulässig aus demselben Grund wie `LEAD_STATUSES`: kurze feste Liste, jeder Wert hat im
 * Anwendungscode eigene Bedeutung (dieser hier bestimmt, welchen Job `/admin/leads` anzeigt).
 */
export const LEAD_RETENTION_JOB_KEY = 'lead_retention'

/**
 * Schlüssel der Vertragsablauf-Erinnerung (B4-2) — der zweite Wert des CHECK auf
 * `platform.job_runs.job_key`. Beide Läufe stehen auf `/admin/leads` mit EIGENEM Stand
 * nebeneinander: ein gemeinsamer „Cron läuft"-Indikator verschwiege genau den Fall, in dem der eine
 * läuft und der andere nicht — und die Ausfallfolgen sind verschieden (nicht durchgesetzte
 * Löschfristen gegen nicht versendete Erinnerungen).
 */
export const CONTRACT_REMINDER_JOB_KEY = 'contract_reminder'

/**
 * Ab wann ein ausbleibender Lauf hervorgehoben wird. 48 Stunden und nicht 24: der Job läuft täglich,
 * ein einzelner verpasster Lauf (Deployment, Plattformstörung) ist folgenlos — die Fristen bewegen
 * sich in Monaten. Zwei ausgefallene Läufe hintereinander sind dagegen kein Zufall mehr.
 */
export const JOB_STALE_AFTER_HOURS = 48

export type JobRunOutcome = 'success' | 'refused' | 'error'

export type JobRun = {
  id: string
  job_key: string
  started_at: string
  /** null = der Lauf ist nie zu Ende gekommen (Abbruch/Timeout). */
  finished_at: string | null
  outcome: JobRunOutcome | null
  items_considered: number | null
  items_processed: number | null
  detail: string | null
}

export type JobRunsResult = {
  runs: JobRun[]
  /**
   * Der zuletzt ERFOLGREICHE Lauf — von der Datenbank getrennt ermittelt, nicht aus `runs`
   * herausgesucht: sonst hinge „zuletzt erfolgreich am …" an der Fenstergrösse und behauptete nach
   * genug misslungenen Läufen „noch nie erfolgreich".
   */
  lastSuccess: JobRun | null
}


// ── Leser ────────────────────────────────────────────────────────────────────────────────────────

function asObject(data: unknown): Record<string, unknown> | null {
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null
}

/** Der rohe `status` einer Wrapper-Antwort (z. B. 'ok' | 'not_found' | 'invalid_filter'). */
export function readStatus(data: unknown): string | null {
  const obj = asObject(data)
  return typeof obj?.status === 'string' ? obj.status : null
}

/** `null` = der Wrapper hat NICHT `ok` gemeldet (nicht: „es gibt keine Leads"). */
export function readLeadList(data: unknown): LeadListResult | null {
  const obj = asObject(data)
  if (!obj || obj.status !== 'ok') return null
  return {
    leads: Array.isArray(obj.leads) ? (obj.leads as LeadListRow[]) : [],
    total: typeof obj.total === 'number' ? obj.total : 0,
    exportTotal: typeof obj.export_total === 'number' ? obj.export_total : 0,
    limit: typeof obj.limit === 'number' ? obj.limit : 50,
    offset: typeof obj.offset === 'number' ? obj.offset : 0,
    sources: Array.isArray(obj.sources) ? (obj.sources as LeadSource[]) : [],
  }
}

export function readLeadDetail(data: unknown): LeadDetailResult | null {
  const obj = asObject(data)
  if (!obj || obj.status !== 'ok') return null
  const lead = asObject(obj.lead)
  if (!lead) return null
  return {
    lead: lead as unknown as LeadDetailRow,
    consents: Array.isArray(obj.consents) ? (obj.consents as LeadConsentDetail[]) : [],
    contractReminders: Array.isArray(obj.contract_reminders)
      ? (obj.contract_reminders as ContractReminderRow[])
      : [],
  }
}

/** `null` = der Wrapper hat NICHT `ok` gemeldet (nicht: „es gibt keine offenen Zeilen"). */
export function readContractReminderHealth(data: unknown): ContractReminderHealth | null {
  const obj = asObject(data)
  if (!obj || obj.status !== 'ok') return null
  return {
    staleCount: typeof obj.stale_count === 'number' ? obj.stale_count : 0,
    oldestAttemptedAt: typeof obj.oldest_attempted_at === 'string' ? obj.oldest_attempted_at : null,
    staleAfterHours: typeof obj.stale_after_hours === 'number' ? obj.stale_after_hours : 24,
  }
}

/** `null` = der Wrapper hat NICHT `ok` gemeldet (nicht: „es gibt keine Quellen"). */
export function readLeadSourceStats(data: unknown): LeadSourceStat[] | null {
  const obj = asObject(data)
  if (!obj || obj.status !== 'ok') return null
  return Array.isArray(obj.sources) ? (obj.sources as LeadSourceStat[]) : []
}

/** `null` = der Wrapper hat NICHT `ok` gemeldet (nicht: „es gab keine Ausfuhren"). */
export function readExports(data: unknown): AdminExportRow[] | null {
  const obj = asObject(data)
  if (!obj || obj.status !== 'ok') return null
  return Array.isArray(obj.exports) ? (obj.exports as AdminExportRow[]) : []
}

/** `null` = der Wrapper hat NICHT `ok` gemeldet (nicht: „es gab keine Läufe"). */
export function readJobRuns(data: unknown): JobRunsResult | null {
  const obj = asObject(data)
  if (!obj || obj.status !== 'ok') return null
  const lastSuccess = asObject(obj.last_success)
  return {
    runs: Array.isArray(obj.runs) ? (obj.runs as JobRun[]) : [],
    lastSuccess: lastSuccess ? (lastSuccess as unknown as JobRun) : null,
  }
}

/** Stunden seit einem ISO-Zeitpunkt; `null` bei fehlendem oder unlesbarem Wert. */
export function hoursSince(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return null
  return (now.getTime() - then) / 3_600_000
}

// ── Beschriftungen ohne eigene Quelle ────────────────────────────────────────────────────────────

export function statusLabel(status: string): string {
  return LEAD_STATUS_LABELS[status as LeadStatus] ?? status
}

export function purposeLabel(purpose: string): string {
  return CONSENT_PURPOSE_LABELS[purpose as ConsentPurpose] ?? purpose
}

export function consentStatusLabel(effectiveStatus: string): string {
  return CONSENT_STATUS_LABELS[effectiveStatus] ?? effectiveStatus
}

export function industryLabel(industry: string): string {
  return INDUSTRY_LABELS[industry as Industry] ?? industry
}

export function meteringTypeLabel(meteringType: string): string {
  return METERING_TYPE_LABELS[meteringType] ?? meteringType
}

/** Herkunftsbezeichnung aus der mitgelieferten `sources`-Liste — Schlüssel als Rückfallebene. */
export function sourceLabel(key: string, sources: LeadSource[]): string {
  return sources.find((s) => s.key === key)?.label ?? key
}

export const RETENTION_BASIS_LABELS: Record<string, string> = {
  marketing: 'werblich (24 Monate)',
  commercial: 'kaufmännisch (7 Jahre)',
}

export function retentionLabel(basis: string): string {
  return RETENTION_BASIS_LABELS[basis] ?? basis
}
