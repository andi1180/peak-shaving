/**
 * DIE VERDRAHTUNG DER PARTNER-BENACHRICHTIGUNG (B16-4b) — die Effekte zu `notify.ts`.
 *
 * Sie steht in einem EIGENEN Modul und nicht in einer der beiden Server-Action-Dateien, weil GENAU
 * ZWEI Wege sie brauchen und beide dieselbe Nachricht auslösen müssen:
 *
 *   1. Die Genehmigung eines Antrags (`lib/admin/partner-applications-actions.ts`, B16-4a).
 *   2. Das erneute Senden im Admin-Bereich (`lib/admin/partners-actions.ts`) — für einen
 *      fehlgeschlagenen Versand UND für von Hand angelegte Betriebe (Raymann), die nie durch eine
 *      Genehmigung liefen und deren Konto erst nachträglich verknüpft wurde.
 *
 * Zwei Fassungen desselben Ablaufs liefen beim ersten Fix auseinander — und zwar an der
 * unangenehmsten Stelle: Der eine Weg setzte `notified_at`, der andere nicht, und der Admin-Bereich
 * zeigte für zwei identische Vorgänge verschiedene Zustände.
 *
 * ── KEIN service_role ───────────────────────────────────────────────────────────────────────────
 * Beide benutzten Wrapper (`admin_list_partners`, `admin_mark_partner_notified`) sind
 * `authenticated`-only und prüfen `platform.is_admin()` INTERN als erste Anweisung. Die
 * Autorisierung hängt damit nicht an dieser Datei; ein Fehler hier kann keinem Nicht-Admin etwas
 * verschaffen. Die `no-restricted-imports`-Erlaubnisliste in der root-`eslint.config.mjs` wurde
 * NICHT angefasst.
 *
 * ── DER EMPFÄNGER WIRD NACHGESCHLAGEN, NICHT ÜBERGEBEN ──────────────────────────────────────────
 * `loadTarget` liest die Partnerliste und sucht den Kurz-Key heraus — die Adresse kommt also aus der
 * Datenbank und nie aus einem Formularfeld. Das ist kein Misstrauen gegen den Admin, sondern die
 * einzige Konstruktion, in der Adresse und Vermerk garantiert denselben Datensatz meinen: Eine
 * mitgeschickte Adresse könnte zu einem anderen Betrieb gehören als der Slug, und `notified_at`
 * stünde danach an der falschen Zeile.
 *
 * Bewusst KEIN eigener `admin_get_partner`-Wrapper dafür. `admin_list_partners` liefert bereits
 * genau die vier Felder, die gebraucht werden (Kurz-Key, Anzeigename, Ansprechperson,
 * Konto-Adresse) plus `application_id`; ein zweiter Lesepfad wäre eine zweite Definition davon, was
 * ein Fachbetrieb ist, für eine Handlung, die ein paar Mal im Jahr vorkommt. Die Tabelle hat die
 * Grössenordnung „Dutzende Zeilen".
 *
 * ── JEDER EFFEKT WIRFT NIE ──────────────────────────────────────────────────────────────────────
 * Das ist die Voraussetzung für die Zusage aus `notify.ts` (der Ablauf wirft nicht) und damit dafür,
 * dass ein Mailproblem eine bereits vollzogene, unumkehrbare Genehmigung nicht als Fehlschlag
 * aussehen lässt. Jeder Fehler wird laut geloggt — ohne die Empfängeradresse: ein Fehlerlog ist kein
 * zulässiger zweiter Speicherort für Personenbezug (B1-2).
 */
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/db-types'
import { readPartnerList } from '@/lib/admin/partners'
import { sendPartnerApprovalMail } from './mail'
import {
  notifyPartner,
  type PartnerNotificationOutcome,
  type PartnerNotificationTarget,
} from './notify'

type Client = SupabaseClient<Database>

/**
 * Benachrichtigt einen Fachbetrieb über seinen Portalzugang. WIRFT NIE.
 *
 * @param supabase Der ANGEMELDETE Client des handelnden Admins (nicht service_role).
 */
export async function notifyPartnerBySlug(
  supabase: Client,
  slug: string,
): Promise<PartnerNotificationOutcome> {
  return notifyPartner(slug, {
    async loadTarget(target): Promise<PartnerNotificationTarget | null> {
      try {
        const { data, error } = await supabase.rpc('admin_list_partners')
        if (error) {
          console.error('[partner-portal] admin_list_partners (Benachrichtigung):', error)
          return null
        }
        const partner = readPartnerList(data)?.find((p) => p.slug === target)
        if (!partner) return null
        return {
          slug: partner.slug,
          displayName: partner.display_name,
          contactFirstName: partner.contact_first_name,
          accountEmail: partner.account_email,
          /*
           * Kam der Betrieb aus einer Bewerbung? Entscheidet GENAU EINEN Satz der Mail (den über
           * das Passwort) — Begründung am Feld in `notify.ts`.
           */
          fromApplication: partner.application_id !== null,
        }
      } catch (cause) {
        console.error('[partner-portal] Fachbetrieb nicht lesbar:', cause)
        return null
      }
    },

    async sendMail(input) {
      try {
        return await sendPartnerApprovalMail(input)
      } catch (cause) {
        // `sendMail` (lib/mail/send.ts) fängt selbst ab; dieser Zweig ist die zweite Sicherung
        // dagegen, dass ein unerwarteter Wurf die Genehmigung umwirft.
        console.error('[partner-portal] Benachrichtigung konnte nicht versendet werden:', cause)
        return { ok: false }
      }
    },

    async markNotified(target) {
      try {
        const { data, error } = await supabase.rpc('admin_mark_partner_notified', { p_slug: target })
        if (error) {
          console.error('[partner-portal] admin_mark_partner_notified:', error)
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
            `[partner-portal] Benachrichtigung versendet, aber notified_at NICHT gesetzt (Status: ${String(status)}).`,
          )
          return false
        }
        return true
      } catch (cause) {
        console.error('[partner-portal] notified_at konnte nicht gesetzt werden:', cause)
        return false
      }
    },
  })
}
