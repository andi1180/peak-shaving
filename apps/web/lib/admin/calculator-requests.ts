/**
 * DER PRÜF-EINGANG DER KALKULATOR-ANFRAGEN — der reine Teil (B18-4).
 *
 * REIN: kein `server-only`, kein `next/*`, kein Supabase-Client — dieselbe Aufteilung wie
 * `lib/admin/partner-applications.ts` (B16-3) und `lib/admin/leads.ts` (B1-3). Der Leser übersetzt
 * die Antwort der Wrapper in Zustände, die die Oberfläche kennt; die Verdrahtung steht in
 * `calculator-requests-server.ts`.
 *
 * ── EIN LESEFEHLER IST NICHT „KEINE ANFRAGEN" ───────────────────────────────────────────────────
 * `readCalculatorRequestList` liefert `null`, wenn die Antwort keinen bekannten Zustand trägt — und
 * ausdrücklich NICHT eine leere Liste. Eine leere Liste ist eine AUSSAGE („es liegt nichts an"), ein
 * Fehler ist das Fehlen einer Aussage; wer beides gleich anzeigt, sagt einem Admin, es gebe nichts
 * zu tun, obwohl niemand nachgesehen hat (dieselbe Trennung wie im Anfragen-Reiter, B18-6).
 *
 * ── DIE ZEILE WIRD GERETTET, SOWEIT SIE TRÄGT ───────────────────────────────────────────────────
 * Eine Zeile ohne `id` oder ohne Status wird VERWORFEN (ohne stabilen Schlüssel könnte die
 * Oberfläche keine Entscheidung an sie binden), die übrigen bleiben. Wegen einer kaputten Zeile die
 * ganze Sicht auf `null` zu setzen liesse echte, offene Anfragen verschwinden — und die zu
 * übersehen kostet mehr, als eine unvollständige Liste kostet. `total` bleibt dabei die Zahl der
 * DATENBANK: lieber „eine Anfrage, die ich nicht sehe" als „eine, die es nie gab".
 */

/**
 * Die Adressen des Prüf-Eingangs.
 *
 * ⚠ EIGENER GESCHWISTERPFAD, ausdrücklich NICHT `/admin/kalkulator/anfragen`. `components/admin/nav.tsx`
 * markiert einen Punkt als aktiv, sobald der Pfad mit ihm BEGINNT — ein Unterpfad des
 * Kalkulator-Punktes hätte zwei Punkte gleichzeitig markiert, genau der Zustand, den der Kommentar
 * dort ausschliesst. Dieselbe Entscheidung und derselbe Grund wie bei `/admin/partner-antraege`
 * (B16-3).
 */
export const CALCULATOR_REQUESTS_HREF = '/admin/kalkulator-anfragen'

export function CALCULATOR_REQUEST_DETAIL_HREF(id: string): string {
  return `${CALCULATOR_REQUESTS_HREF}/${id}`
}

/** Die drei Zustände einer Anfrage — deckungsgleich mit `platform.calculator_request_status`. */
export const CALCULATOR_REQUEST_STATUSES = ['pending', 'approved', 'rejected'] as const
export type CalculatorRequestStatus = (typeof CALCULATOR_REQUEST_STATUSES)[number]

export function isCalculatorRequestStatus(value: unknown): value is CalculatorRequestStatus {
  return (
    typeof value === 'string' &&
    (CALCULATOR_REQUEST_STATUSES as readonly string[]).includes(value)
  )
}

/**
 * Die deutschen Beschriftungen der drei Zustände.
 *
 * Als `Record` über die Union getypt: Ein vierter Enum-Wert bricht hier beim Typecheck, statt in der
 * Oberfläche als roher Schlüssel aufzutauchen (Muster `PARTNER_APPLICATION_STATUS_LABEL`, B16-3).
 */
export const CALCULATOR_REQUEST_STATUS_LABEL: Record<CalculatorRequestStatus, string> = {
  pending: 'Offen',
  approved: 'Freigegeben',
  rejected: 'Abgelehnt',
}

/** Die beiden Entscheidungen — die Werte sind die des Enums, nicht eine zweite Übersetzung. */
export const CALCULATOR_REQUEST_DECISIONS = ['approved', 'rejected'] as const
export type CalculatorRequestDecision = (typeof CALCULATOR_REQUEST_DECISIONS)[number]

/**
 * Eine Zeile des Prüf-Eingangs, so wie `public.admin_list_calculator_requests` sie liefert.
 *
 * `partnerDisplayName` ist die Identität, `partnerSlug` die Adresse — beides fährt mit, weil ein
 * Kurz-Key kein Name ist (dieselbe Entscheidung wie in der Lead-Liste, B18-5).
 *
 * `accountEmail === null` ist der Zustand, den `admin_decide_calculator_request` beim Freigeben mit
 * `no_account` abweist. Die Oberfläche kann ihn damit VOR dem Klick benennen, statt ihn erst über
 * die Abweisung zu erfahren.
 */
export type CalculatorRequestRow = {
  id: string
  partnerSlug: string
  partnerDisplayName: string | null
  partnerIsActive: boolean
  accountEmail: string | null
  message: string
  status: CalculatorRequestStatus
  createdAt: string | null
  reviewedAt: string | null
  reviewedByEmail: string | null
  notifiedAt: string | null
}

export type CalculatorRequestList = {
  total: number
  limit: number
  offset: number
  requests: CalculatorRequestRow[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function asInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readRow(value: unknown): CalculatorRequestRow | null {
  const row = asRecord(value)
  if (!row) return null

  const id = asString(row.id)
  const partnerSlug = asString(row.partner_slug)
  const status = row.status
  if (!id || !partnerSlug || !isCalculatorRequestStatus(status)) return null

  return {
    id,
    partnerSlug,
    partnerDisplayName: asString(row.partner_display_name),
    // Fehlt die Angabe, gilt „aktiv" — der Regelfall. Ein fehlendes Feld darf keinen Betrieb
    // fälschlich als stillgelegt kennzeichnen; das wäre eine Behauptung über ihn.
    partnerIsActive: row.partner_is_active !== false,
    accountEmail: asString(row.account_email),
    message: typeof row.message === 'string' ? row.message : '',
    status,
    createdAt: asString(row.created_at),
    reviewedAt: asString(row.reviewed_at),
    reviewedByEmail: asString(row.reviewed_by_email),
    notifiedAt: asString(row.notified_at),
  }
}

/**
 * Übersetzt die Antwort von `public.admin_list_calculator_requests`.
 *
 * `null` heisst „nicht abrufbar" — auch bei `invalid_filter`: Ein abgewiesener Filter ist kein
 * Bestand, den man anzeigen dürfte (die Oberfläche würde sonst den GESAMTEN Eingang zeigen und für
 * die gefilterte Teilmenge halten, genau der stille Ausfall, gegen den B18-5 den Filterwert als
 * Text durchreicht).
 */
export function readCalculatorRequestList(
  data: unknown,
  error?: unknown,
): CalculatorRequestList | null {
  if (error) return null

  const payload = asRecord(data)
  if (!payload || payload.status !== 'ok') return null
  if (!Array.isArray(payload.requests)) return null

  return {
    total: asInt(payload.total, 0),
    limit: asInt(payload.limit, 50),
    offset: asInt(payload.offset, 0),
    requests: payload.requests.map(readRow).filter((r): r is CalculatorRequestRow => r !== null),
  }
}

/**
 * Was aus einer Entscheidung geworden ist.
 *
 * `entitlement` unterscheidet, ob der Zugang gerade ENTSTANDEN ist oder schon bestand — die
 * Oberfläche soll beides sagen können, statt eine Freigabe zu behaupten, die es nicht gab. Beides
 * ist ein Erfolg; die Anfrage ist in beiden Fällen genehmigt.
 */
export type CalculatorRequestDecisionOutcome =
  | {
      status: 'ok'
      decision: CalculatorRequestDecision
      entitlement: 'granted' | 'already_active' | null
      partnerSlug: string | null
    }
  | { status: 'not_found' }
  | { status: 'already_reviewed'; current: CalculatorRequestStatus | null }
  | { status: 'no_account' }
  | { status: 'invalid_decision' }
  | { status: 'missing_fields' }
  | { status: 'error' }

export function readCalculatorRequestDecision(
  data: unknown,
  error?: unknown,
): CalculatorRequestDecisionOutcome {
  if (error) return { status: 'error' }

  const row = asRecord(data)
  const status = row ? asString(row.status) : null

  switch (status) {
    case 'ok': {
      const decision = row?.decision
      if (decision !== 'approved' && decision !== 'rejected') return { status: 'error' }
      const entitlement = row?.entitlement
      return {
        status: 'ok',
        decision,
        entitlement:
          entitlement === 'granted' || entitlement === 'already_active' ? entitlement : null,
        partnerSlug: asString(row?.partner_slug),
      }
    }
    case 'not_found':
      return { status: 'not_found' }
    case 'already_reviewed':
      return {
        status: 'already_reviewed',
        current: isCalculatorRequestStatus(row?.current) ? row.current : null,
      }
    case 'no_account':
      return { status: 'no_account' }
    case 'invalid_decision':
      return { status: 'invalid_decision' }
    case 'missing_fields':
      return { status: 'missing_fields' }
    default:
      return { status: 'error' }
  }
}
