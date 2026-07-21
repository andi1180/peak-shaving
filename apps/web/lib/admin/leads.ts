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

export type LeadListRow = {
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
  total: number
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
}

export type LeadDetailResult = { lead: LeadDetailRow; consents: LeadConsentDetail[] }

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
  }
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
