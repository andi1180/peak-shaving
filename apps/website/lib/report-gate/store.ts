import 'server-only'

import {
  REPORT_GATE_CONSENT_PURPOSE,
  REPORT_GATE_SOURCE_KEY,
  type ReportGateValues,
} from 'shared'

import { createReportGateServiceClient } from './service-role'

/**
 * Delta 16b — DER EINZIGE DATENBANK-RAND DES REPORT-GATES.
 *
 * ── DIE GANZE RECHTEFLÄCHE DIESER APP IN EINER DATEI, UND SIE IST ZWEI AUFRUFE GROSS ───────────
 * Dieses Modul ist die einzige Stelle in `apps/website`, die den service_role-Schlüssel benutzen
 * darf (ESLint-Allowlist im root `eslint.config.mjs` nennt genau diese Datei). Es ruft GENAU ZWEI
 * `public`-Wrapper und sonst nichts:
 *
 *   `public.get_active_consent_text`  LESEND  — der Wortlaut, der angezeigt werden muss.
 *   `public.capture_lead`             SCHREIBEND — Lead + Einwilligung, EIN atomarer Aufruf.
 *
 * Es gibt hier bewusst keine allgemeine `rpc`-Hilfsfunktion, keinen exportierten Client und keinen
 * Weg, eine dritte Funktion aufzurufen. Wer eine braucht, ergänzt sie hier sichtbar — statt sich
 * anderswo einen zweiten Client zu bauen.
 *
 * ── WARUM DER LESENDE AUFRUF DAZUGEHÖRT UND KEINE AUSWEITUNG IST ───────────────────────────────
 * Der angezeigte und der archivierte Einwilligungswortlaut MÜSSEN dieselbe Quelle haben (B1-1,
 * §5.1 „Versionierung"). `capture_lead` löst den Text beim Archivieren selbst auf; würde die
 * Oberfläche daneben einen eigenen Satz zeigen, wäre der Nachweis wertlos — er belegte eine
 * Zustimmung zu einem Text, den niemand gesehen hat. Deshalb kommt der angezeigte Text aus
 * demselben Bestand, über dieselbe Auswahlregel („jüngste Fassung je Zweck und Sprache").
 * Insbesondere wird KEIN Text vom Client entgegengenommen.
 *
 * ── FEHLERPOLITIK: HIER WIRD GEWORFEN ──────────────────────────────────────────────────────────
 * Wie `apps/web/lib/leads/store.ts`. Ob ein Fehlschlag den Vorgang umwirft, entscheidet der
 * Aufrufer (`actions.ts`) — dort wird er zu einer neutralen Meldung, und der Download bleibt
 * gesperrt: ein freigegebener Download nach einem gescheiterten Schreibversuch wäre eine
 * Einwilligung, die es nicht gibt.
 */

/** Der Ausschnitt der `capture_lead`-Antwort, den dieses Modul liest. */
export type CaptureOutcome =
  | 'lead_only'
  | 'consent_created'
  | 'consent_confirmed'
  | 'consent_already_pending'
  | 'suppressed'

export type CaptureResult = { outcome: CaptureOutcome; leadId: string }

function asRecord(value: unknown, fn: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fn}: unerwartete Rückgabe (kein jsonb-Objekt)`)
  }
  return value as Record<string, unknown>
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * Der jüngste Einwilligungswortlaut — oder `null`, wenn keine Fassung existiert.
 *
 * `null` ist ein echter Zustand und kein Fehler: die Oberfläche zeigt die Ankreuzmöglichkeit dann
 * NICHT an und sperrt das Absenden. Ohne Wortlaut darf keine Einwilligung eingesammelt werden — und
 * `capture_lead` lehnte einen solchen Aufruf ohnehin mit 22023 ab (fail closed auf beiden Seiten).
 */
export async function getReportGateConsentText(): Promise<string | null> {
  const service = createReportGateServiceClient()
  const { data, error } = await service.rpc('get_active_consent_text', {
    p_purpose: REPORT_GATE_CONSENT_PURPOSE,
    p_locale: 'de',
  })
  if (error) throw new Error(`get_active_consent_text: ${error.message}`)

  const row = asRecord(data, 'get_active_consent_text')
  if (row.status !== 'ok') return null
  return stringOrNull(row.body)
}

/**
 * Lead + Einwilligung in EINEM atomaren Aufruf.
 *
 * ── WAS HIER FEST STEHT UND NICHT VOM CLIENT KOMMT ─────────────────────────────────────────────
 * `p_source_key` und `p_purpose` sind Konstanten aus `shared/report-gate.ts`. Der Contract des
 * Formulars (`ReportGateSubmission`) hat für beide gar kein Feld — dieselbe Regel wie in B3-2:
 * käme der Zweck vom Absender, erzeugte ein manipulierter Aufruf eine Einwilligung zu einem Text,
 * den niemand gesehen hat.
 *
 * ── KEIN TOKEN, UND DAS IST DIE FOLGE EINER DB-ENTSCHEIDUNG, NICHT EINE ZWEITE ─────────────────
 * 'offer_contact' ist nicht bestätigungspflichtig (`platform.purpose_requires_double_opt_in` zählt
 * nur 'marketing_email' und 'contract_expiry_reminder' auf). `capture_lead` verwirft seit B3-2 einen
 * übergebenen Token bei solchen Zwecken ausdrücklich — ihn hier zu erzeugen wäre also Arbeit für
 * den Papierkorb, und diese App hat ohnehin keinen Mailversand, mit dem sie ihn zustellen könnte.
 * Verzweigt wird stromabwärts strikt am `outcome`, nie am Zweck.
 *
 * ── DIE NACHWEISFELDER SIND NACHWEIS, NIE PROFILBILDUNG (B1-1) ─────────────────────────────────
 * `p_source_ip` und `p_user_agent` gehören zum Einwilligungsnachweis. Sie kommen aus den Headern
 * des Requests und werden hier nur durchgereicht.
 */
export async function captureReportGateLead(input: {
  values: ReportGateValues
  sourceIp: string | null
  userAgent: string | null
}): Promise<CaptureResult> {
  const service = createReportGateServiceClient()
  const { data, error } = await service.rpc('capture_lead', {
    p_email: input.values.email,
    p_source_key: REPORT_GATE_SOURCE_KEY,
    p_purpose: REPORT_GATE_CONSENT_PURPOSE,
    p_company: input.values.company,
    p_first_name: input.values.firstName,
    p_last_name: input.values.lastName,
    p_source_ip: input.sourceIp ?? undefined,
    p_user_agent: input.userAgent ?? undefined,
    p_locale: 'de',
  })
  if (error) throw new Error(`capture_lead: ${error.message}`)

  const row = asRecord(data, 'capture_lead')
  const outcome = stringOrNull(row.outcome)
  const leadId = stringOrNull(row.lead_id)
  if (!outcome || !leadId) throw new Error('capture_lead: outcome/lead_id fehlen in der Rückgabe')

  return { outcome: outcome as CaptureOutcome, leadId }
}
