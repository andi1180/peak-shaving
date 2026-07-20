/**
 * Validierung + Formular-Zustandsvertrag der Gutscheincode-Einlösung.
 *
 * REIN (kein `server-only`, kein `next/*`) — Muster wie lib/auth/schema.ts: die Server Action
 * validiert damit serverseitig (Autorität), das Client-Formular rendert die zurückgegebenen Keys.
 * Fehlermeldungen sind KEYS, keine Sätze: die Wortwahl steht in messages/de.json (§8.7-Analog),
 * und serverseitig gibt es keinen Locale-Kontext für fertige Texte.
 */
import { z } from 'zod'

// Nur „ausgefüllt" — KEINE Format-/Längenregel. Welche Codes es gibt, weiß allein die Datenbank;
// eine clientseitige Formatannahme würde bei jedem künftigen Codeschema still Einlösungen
// blockieren, die die DB akzeptiert hätte. Der Trim spiegelt btrim() im RPC (kopierte Codes tragen
// regelmäßig Leerzeichen mit).
export const redeemSchema = z.object({
  code: z.string().trim().min(1, 'codeRequired'),
})

export type RedeemFieldName = 'code'

export function toRedeemFieldErrors(
  issues: z.ZodIssue[],
): Partial<Record<RedeemFieldName, string>> {
  const out: Partial<Record<RedeemFieldName, string>> = {}
  for (const issue of issues) {
    const field = issue.path[0]
    if (typeof field === 'string' && !(field in out)) {
      out[field as RedeemFieldName] = issue.message
    }
  }
  return out
}

/** Rückgabe der Einlösungs-Action (via useActionState). */
export type RedeemState = {
  /** Status-String aus public.redeem_code (Konto.redeem.status.*). */
  status?:
    'redeemed' | 'invalid_code' | 'expired' | 'exhausted' | 'already_redeemed' | 'already_active'
  /** Formular-weiter Fehler-KEY (Konto.redeem.errors.*) — nur für echte Fehlschläge, nicht für Ablehnungen. */
  formError?: string
  /** Feld-Fehler-KEYS (Konto.redeem.errors.*). */
  fieldErrors?: Partial<Record<RedeemFieldName, string>>
  /** Eingabe zur Wiederanzeige nach einer Ablehnung. */
  code?: string
}

export const REDEEM_INITIAL_STATE: RedeemState = {}
