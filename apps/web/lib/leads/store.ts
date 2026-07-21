/**
 * Der EINE Datenbank-Rand des Lead-/Einwilligungspfads (B1-2).
 *
 * Genau dieses Modul ruft die sechs `public`-Wrapper aus
 * `supabase/migrations/20260721150000_create_lead_capture_wrappers.sql` — und ist damit die einzige
 * Datei ausserhalb des Stripe-Pfads, die `lib/supabase/service-role` importieren darf (Allowlist im
 * root-`eslint.config.mjs`). Die Regel wird ERWEITERT, nicht umgangen: es gibt weiterhin genau einen
 * service_role-Client, und ein Import in einer Server-Component/Page bleibt ein Lint-Fehler.
 *
 * WARUM service_role UND NICHT DER RLS-GEBUNDENE CLIENT: Ein Lead ist Betriebs-, kein Nutzerdatum
 * (B1-1) — die Person hinter einem Lead hat in aller Regel gar keinen Account, es gibt keine „eigene
 * Zeile". `authenticated` und `anon` haben auf `platform.leads`/`consents` bewusst KEIN Grant, und
 * die sechs Wrapper sind ausschliesslich an `service_role` gegrantet. Derselbe Aufbau wie der
 * Stripe-Webhook-Pfad (T4-3).
 *
 * ── FEHLERPOLITIK: HIER WIRD GEWORFEN, NICHT GESCHLUCKT ──────────────────────────────────────────
 * Dieses Modul übersetzt einen RPC-Fehler in eine Exception mit dem Funktionsnamen im Text. Ob ein
 * Fehlschlag den auslösenden Vorgang umwirft, entscheidet der AUFRUFER: die Erfassung aus dem
 * Kontaktformular fängt ihn (eine verlorene Kundenanfrage wiegt schwerer als ein verlorener Lead,
 * `capture.ts`), die Bestätigungsseite lässt ihn in den Fehlerzustand laufen. Beides wäre nicht
 * unterscheidbar, wenn schon hier alles zu `null` würde.
 */
import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import type { CaptureOutcome, CaptureResult, ConsentPurpose } from './config'
import type { LeadIndustry } from './registry'

/* ─── Rückgabe-Formen der Wrapper (jsonb) ─────────────────────────────────────────────────────── */

/*
 * `CaptureOutcome`/`CaptureResult` liegen seit B3-2 in `config.ts` (rein) — der datenbankfreie
 * Ablauf verzweigt daran und darf dieses Modul nicht anfassen. Hier nur noch re-exportiert, damit
 * bestehende Importe unverändert bleiben.
 */
export type { CaptureOutcome, CaptureResult }

export type ConsentTextResult = {
  purpose: ConsentPurpose
  version: number
  locale: string
  body: string
}

export type PendingConsentOutcome = 'valid' | 'expired' | 'already_confirmed' | 'not_found'

export type PendingConsentView = {
  outcome: PendingConsentOutcome
  purpose: ConsentPurpose | null
  body: string | null
  expiresAt: string | null
}

export type ConfirmOutcome = 'confirmed' | 'already_confirmed' | 'expired' | 'not_found'

/**
 * Der Ausschnitt der jsonb-Rückgaben, den dieses Modul liest. Die generierten DB-Typen sagen nur
 * `Json` — die FORM eines jsonb-Objekts kann Postgres nicht typisieren. Statt einer Zusicherung
 * (`as`) wird deshalb defensiv gelesen: was nicht die erwartete Form hat, wirft hier und nicht drei
 * Ebenen später als `undefined`.
 */
function asRecord(value: unknown, fn: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fn}: unerwartete Rückgabe (kein jsonb-Objekt)`)
  }
  return value as Record<string, unknown>
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/* ─── Erfassung ───────────────────────────────────────────────────────────────────────────────── */

export type CaptureLeadInput = {
  email: string
  sourceKey: string
  /** Ohne Zweck entsteht KEINE Einwilligungszeile (Rechtsgrundlage Vertragsanbahnung). */
  purpose?: ConsentPurpose | null
  tokenHash?: string | null
  tokenExpiresAt?: Date | null
  company?: string | null
  /**
   * Vor- und Nachname getrennt (ehemals ein `contactName`). Der Grund ist die Anrede in späterer
   * Korrespondenz: sie braucht den Nachnamen als eigenen Wert, und ein zusammengesetzter Name
   * lässt sich nachträglich nicht zuverlässig zerlegen. Beide werden in `capture_lead` EINZELN
   * zusammengeführt (Bestand gewinnt, wie `company`/`phone`).
   */
  firstName?: string | null
  lastName?: string | null
  phone?: string | null
  /** Nachweisfelder der Einwilligung (B1-1: ausschliesslich Nachweis, nie Profilbildung). */
  sourceIp?: string | null
  userAgent?: string | null
  locale?: string
  /*
   * Die sechs Segmentierungsfelder (B3-1). Alle optional: die Einstiegspunkte sind
   * kontextspezifisch und erheben unterschiedliche Felder. Ein NICHT übergebener Wert lässt einen
   * bestehenden UNBERÜHRT (COALESCE-Zusammenführung in `capture_lead`) — deshalb wird `undefined`
   * durchgereicht und nicht in `null` übersetzt.
   */
  industry?: LeadIndustry | null
  postalCode?: string | null
  annualConsumptionKwh?: number | null
  meteringType?: 'leistungsgemessen' | 'netzebene_7' | 'unknown' | null
  supplier?: string | null
  /** ISO-Datum (`YYYY-MM-DD`) — die Spalte ist `date`, kein Zeitstempel. */
  contractEndDate?: string | null
}

/** EIN atomarer Aufruf: Lead + optionale Einwilligung in einer Transaktion. */
export async function captureLead(input: CaptureLeadInput): Promise<CaptureResult> {
  const service = createServiceRoleClient()
  const { data, error } = await service.rpc('capture_lead', {
    p_email: input.email,
    p_source_key: input.sourceKey,
    p_purpose: input.purpose ?? undefined,
    p_token_hash: input.tokenHash ?? undefined,
    p_token_expires_at: input.tokenExpiresAt?.toISOString() ?? undefined,
    p_company: input.company ?? undefined,
    p_first_name: input.firstName ?? undefined,
    p_last_name: input.lastName ?? undefined,
    p_phone: input.phone ?? undefined,
    p_source_ip: input.sourceIp ?? undefined,
    p_user_agent: input.userAgent ?? undefined,
    p_locale: input.locale ?? undefined,
    p_industry: input.industry ?? undefined,
    p_postal_code: input.postalCode ?? undefined,
    p_annual_consumption_kwh: input.annualConsumptionKwh ?? undefined,
    p_metering_type: input.meteringType ?? undefined,
    p_supplier: input.supplier ?? undefined,
    p_contract_end_date: input.contractEndDate ?? undefined,
  })
  if (error) throw new Error(`capture_lead: ${error.message}`)

  const row = asRecord(data, 'capture_lead')
  const outcome = stringOrNull(row.outcome)
  const leadId = stringOrNull(row.lead_id)
  if (!outcome || !leadId) throw new Error('capture_lead: outcome/lead_id fehlen in der Rückgabe')

  return {
    outcome: outcome as CaptureOutcome,
    leadId,
    consentId: stringOrNull(row.consent_id),
  }
}

/* ─── Einwilligungstext ───────────────────────────────────────────────────────────────────────── */

/**
 * Die jüngste Fassung des Einwilligungstextes — der Wortlaut, der ANGEZEIGT und anschliessend von
 * `capture_lead` ARCHIVIERT wird (dieselbe Auswahlregel in der Datenbank, nicht zweimal im Code).
 * `null`, wenn keine Fassung existiert; das Formular blendet die Ankreuzmöglichkeit dann aus —
 * ohne Wortlaut darf keine Einwilligung eingesammelt werden.
 */
export async function getActiveConsentText(
  purpose: ConsentPurpose,
  locale = 'de',
): Promise<ConsentTextResult | null> {
  const service = createServiceRoleClient()
  const { data, error } = await service.rpc('get_active_consent_text', {
    p_purpose: purpose,
    p_locale: locale,
  })
  if (error) throw new Error(`get_active_consent_text: ${error.message}`)

  const row = asRecord(data, 'get_active_consent_text')
  if (row.status !== 'ok') return null

  const body = stringOrNull(row.body)
  if (!body) return null

  return {
    purpose,
    version: typeof row.version === 'number' ? row.version : 0,
    locale: stringOrNull(row.locale) ?? locale,
    body,
  }
}

/* ─── Double-Opt-in ───────────────────────────────────────────────────────────────────────────── */

/** GET-Pfad der Bestätigungsseite. Verändert NICHTS (der Wrapper ist STABLE). */
export async function getPendingConsentByToken(tokenHash: string): Promise<PendingConsentView> {
  const service = createServiceRoleClient()
  const { data, error } = await service.rpc('get_pending_consent_by_token', {
    p_token_hash: tokenHash,
  })
  if (error) throw new Error(`get_pending_consent_by_token: ${error.message}`)

  const row = asRecord(data, 'get_pending_consent_by_token')
  const outcome = (stringOrNull(row.outcome) ?? 'not_found') as PendingConsentOutcome

  return {
    outcome,
    purpose: stringOrNull(row.purpose) as ConsentPurpose | null,
    body: stringOrNull(row.consent_text_body),
    expiresAt: stringOrNull(row.expires_at),
  }
}

/** POST-Pfad: der einzige Weg zu status='confirmed'. Idempotent. */
export async function confirmConsent(tokenHash: string): Promise<ConfirmOutcome> {
  const service = createServiceRoleClient()
  const { data, error } = await service.rpc('confirm_consent', { p_token_hash: tokenHash })
  if (error) throw new Error(`confirm_consent: ${error.message}`)

  const row = asRecord(data, 'confirm_consent')
  return (stringOrNull(row.outcome) ?? 'not_found') as ConfirmOutcome
}

/* ─── Abmeldung ───────────────────────────────────────────────────────────────────────────────── */

/**
 * Widerruf EINES Zwecks. Der Wrapper antwortet immer gleich — auch bei unbekanntem Lead; ein
 * Abmeldelink darf nicht verraten, ob es die Adresse gibt.
 */
export async function withdrawConsent(leadId: string, purpose: ConsentPurpose): Promise<number> {
  const service = createServiceRoleClient()
  const { data, error } = await service.rpc('withdraw_consent', {
    p_lead_id: leadId,
    p_purpose: purpose,
  })
  if (error) throw new Error(`withdraw_consent: ${error.message}`)

  const row = asRecord(data, 'withdraw_consent')
  return typeof row.withdrawn_count === 'number' ? row.withdrawn_count : 0
}

/** „Keine E-Mails mehr": widerruft ALLE Zwecke und sperrt die Adresse dauerhaft (nur als Hash). */
export async function suppressEmailAndWithdrawAll(leadId: string): Promise<number> {
  const service = createServiceRoleClient()
  const { data, error } = await service.rpc('suppress_email_and_withdraw_all', {
    p_lead_id: leadId,
  })
  if (error) throw new Error(`suppress_email_and_withdraw_all: ${error.message}`)

  const row = asRecord(data, 'suppress_email_and_withdraw_all')
  return typeof row.withdrawn_count === 'number' ? row.withdrawn_count : 0
}
