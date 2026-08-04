/**
 * DIE VERDRAHTUNG DER FREISCHALTUNGS-NACHRICHT (B18-4) — die Effekte zu
 * `calculator-request-notify.ts`.
 *
 * ── KEIN service_role ───────────────────────────────────────────────────────────────────────────
 * Beide benutzten Wrapper (`admin_list_partners`, `admin_mark_calculator_request_notified`) sind
 * `authenticated`-only und prüfen `platform.is_admin()` INTERN als erste Anweisung. Die
 * Autorisierung hängt damit nicht an dieser Datei; ein Fehler hier kann keinem Nicht-Admin etwas
 * verschaffen. Die `no-restricted-imports`-Erlaubnisliste in der root-`eslint.config.mjs` wurde
 * NICHT angefasst.
 *
 * ── DER EMPFÄNGER WIRD NACHGESCHLAGEN, NICHT ÜBERGEBEN ──────────────────────────────────────────
 * Über `admin_list_partners` — derselbe Lesepfad wie in `notify-server.ts` (B16-4b) und aus
 * demselben Grund: Er liefert bereits genau die drei Felder, die gebraucht werden (Anzeigename,
 * Ansprechperson, Konto-Adresse). Ein eigener Wrapper wäre eine zweite Definition davon, was ein
 * Fachbetrieb ist, für eine Handlung, die selten vorkommt; die Tabelle hat die Grössenordnung
 * „Dutzende Zeilen".
 *
 * ── JEDER EFFEKT WIRFT NIE ──────────────────────────────────────────────────────────────────────
 * Das ist die Voraussetzung für die Zusage aus `calculator-request-notify.ts` (der Ablauf wirft
 * nicht) und damit dafür, dass ein Mailproblem eine bereits vollzogene Freigabe nicht als Fehlschlag
 * aussehen lässt. Jeder Fehler wird laut geloggt — ohne die Empfängeradresse: ein Fehlerlog ist kein
 * zulässiger zweiter Speicherort für Personenbezug (B1-2).
 */
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/db-types'
import { readPartnerList } from '@/lib/admin/partners'
import { sendCalculatorRequestApprovalMail } from './calculator-request-mail'
import {
  notifyCalculatorRequest,
  type CalculatorRequestNotificationOutcome,
  type CalculatorRequestTarget,
} from './calculator-request-notify'

type Client = SupabaseClient<Database>

/**
 * Benachrichtigt einen Fachbetrieb über seinen freigeschalteten Kalkulator-Zugang. WIRFT NIE.
 *
 * @param supabase Der ANGEMELDETE Client des handelnden Admins (nicht service_role).
 */
export async function notifyCalculatorRequestBySlug(
  supabase: Client,
  input: { requestId: string; partnerSlug: string },
): Promise<CalculatorRequestNotificationOutcome> {
  return notifyCalculatorRequest(input, {
    async loadTarget(slug): Promise<CalculatorRequestTarget | null> {
      try {
        const { data, error } = await supabase.rpc('admin_list_partners')
        if (error) {
          console.error('[calculator-request] admin_list_partners (Benachrichtigung):', error)
          return null
        }
        const partner = readPartnerList(data)?.find((p) => p.slug === slug)
        if (!partner) return null
        return {
          displayName: partner.display_name,
          contactFirstName: partner.contact_first_name,
          accountEmail: partner.account_email,
        }
      } catch (cause) {
        console.error('[calculator-request] Fachbetrieb nicht lesbar:', cause)
        return null
      }
    },

    async sendMail(mail) {
      try {
        return await sendCalculatorRequestApprovalMail(mail)
      } catch (cause) {
        // `sendMail` (lib/mail/send.ts) fängt selbst ab; dieser Zweig ist die zweite Sicherung
        // dagegen, dass ein unerwarteter Wurf die Freigabe umwirft.
        console.error('[calculator-request] Freischaltungsmail nicht versendet:', cause)
        return { ok: false }
      }
    },

    async markNotified(requestId) {
      try {
        const { data, error } = await supabase.rpc('admin_mark_calculator_request_notified', {
          p_id: requestId,
        })
        if (error) {
          console.error('[calculator-request] admin_mark_calculator_request_notified:', error)
          return false
        }
        const status = (data as { status?: unknown } | null)?.status
        if (status !== 'ok') {
          /*
           * Die Mail ist an dieser Stelle bereits draussen. Der Log-Eintrag ist laut, weil der
           * Zustand von aussen aussieht wie „nie benachrichtigt" — und die naheliegende Reaktion
           * (erneut senden) dem Betrieb dieselbe Mail ein zweites Mal zustellte.
           */
          console.error(
            `[calculator-request] Mail versendet, aber notified_at NICHT gesetzt (Status: ${String(status)}).`,
          )
          return false
        }
        return true
      } catch (cause) {
        console.error('[calculator-request] notified_at konnte nicht gesetzt werden:', cause)
        return false
      }
    },
  })
}
