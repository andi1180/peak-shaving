import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { notifyCalculatorRequestBySlug } from '@/lib/partner-portal/calculator-request-notify-server'
import type { CalculatorRequestNotificationOutcome } from '@/lib/partner-portal/calculator-request-notify'
import {
  readCalculatorRequestDecision,
  readCalculatorRequestList,
  type CalculatorRequestDecision,
  type CalculatorRequestDecisionOutcome,
  type CalculatorRequestList,
  type CalculatorRequestStatus,
} from './calculator-requests'

/**
 * DER ADMIN-SCHREIBWEG DER KALKULATOR-ANFRAGEN (B18-4).
 *
 * ── KEIN service_role ───────────────────────────────────────────────────────────────────────────
 * Beide Wrapper sind `authenticated`-only und prüfen `platform.is_admin()` intern. Über
 * `service_role` wäre `reviewed_by` strukturell leer — und die Zuschreibung einer Handlung, an der
 * ein Produktzugang hängt, ist der halbe Zweck des Protokolls (dieselbe Überlegung wie bei
 * `created_by` in B14-1 und bei der Genehmigung in B16-4a). Die
 * `no-restricted-imports`-Erlaubnisliste wurde NICHT angefasst.
 *
 * WIRFT NICHT. Ein Fehlschlag wird geloggt und zu einem Zustand — die Oberfläche zeigt dann einen
 * ehrlichen „gerade nicht möglich"-Hinweis statt einer leeren Liste (die etwas anderes behauptete).
 */

export async function readCalculatorRequests(
  input: { status?: CalculatorRequestStatus | null; limit?: number; offset?: number } = {},
): Promise<CalculatorRequestList | null> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('admin_list_calculator_requests', {
    p_status: input.status ?? undefined,
    p_limit: input.limit ?? undefined,
    p_offset: input.offset ?? undefined,
  })
  if (error) console.error('[calculator-request] admin_list_calculator_requests:', error)

  return readCalculatorRequestList(data, error)
}

/**
 * Das Ergebnis einer Entscheidung — und, bei einer Freigabe, was aus der Benachrichtigung wurde.
 *
 * ⚠ DIE ZWEI ZUSTÄNDE SIND GETRENNT, UND DAS IST DER GANZE PUNKT. Die Freigabe ist vollzogen,
 * sobald `decision.status === 'ok'`: Status und Entitlement stehen in EINER Transaktion in der
 * Datenbank. Was danach mit der Mail passiert, ändert daran nichts mehr. Ein gemeinsamer
 * Erfolgs-/Fehlschlagswert liesse den Admin bei einem Mailproblem „hat nicht geklappt" lesen und
 * die Freigabe wiederholen — die dann `already_reviewed` gäbe und wie ein zweiter Fehler aussähe.
 */
export type CalculatorRequestDecisionResult = {
  decision: CalculatorRequestDecisionOutcome
  /** `null` bei einer Ablehnung und bei jedem Abbruch — dann geht bewusst keine Mail hinaus. */
  notification: CalculatorRequestNotificationOutcome | null
}

export async function decideCalculatorRequest(
  requestId: string,
  decision: CalculatorRequestDecision,
): Promise<CalculatorRequestDecisionResult> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('admin_decide_calculator_request', {
    p_id: requestId,
    p_decision: decision,
  })
  if (error) console.error('[calculator-request] admin_decide_calculator_request:', error)

  const outcome = readCalculatorRequestDecision(data, error)

  /*
   * Die Mail geht AUSSCHLIESSLICH bei einer erfolgreichen FREIGABE hinaus.
   *
   * Für eine Ablehnung ist bewusst keine Nachricht vorgesehen: Ein abgelehnter Werkzeugwunsch
   * gehört in ein Gespräch, nicht in eine automatische Mail — und die Datenbank hält denselben
   * Grundsatz fest (`calculator_requests_notified_only_when_approved`).
   *
   * ⚠ Auch bei `entitlement === 'already_active'` geht sie raus: Für den Betrieb ist die Auskunft
   * dieselbe („Ihr Zugang steht"), und woher der Zugang stammt, ist seine Sache nicht.
   */
  if (outcome.status !== 'ok' || outcome.decision !== 'approved' || !outcome.partnerSlug) {
    return { decision: outcome, notification: null }
  }

  const notification = await notifyCalculatorRequestBySlug(supabase, {
    requestId,
    partnerSlug: outcome.partnerSlug,
  })

  return { decision: outcome, notification }
}
