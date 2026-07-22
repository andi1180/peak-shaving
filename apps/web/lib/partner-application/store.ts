/**
 * DER DATENBANK-RAND DER PARTNER-BEWERBUNG (B16-3).
 *
 * Genau dieses Modul ruft `public.submit_partner_application` — und ist damit neben dem Stripe-Pfad,
 * dem Lead-Pfad, den Cron-Endpunkten und dem Resend-Webhook die einzige Stelle, die
 * `lib/supabase/service-role` importieren darf (Allowlist in der root-`eslint.config.mjs`). Die
 * Regel wird ERWEITERT, nicht umgangen: es gibt weiterhin genau EINEN service_role-Client, und ein
 * Import in einer Server-Component oder Page bleibt ein Lint-Fehler.
 *
 * ── WARUM service_role UND NICHT DER RLS-GEBUNDENE CLIENT ───────────────────────────────────────
 * Die Bewerbungsseite ist öffentlich; im Regelfall gibt es keine Sitzung, und selbst im
 * angemeldeten Fall entsteht der Antrag NICHT als „eigene Zeile" eines Nutzers —
 * `platform.partner_applications` hat für `anon` und `authenticated` bewusst gar kein Grant, und
 * der Wrapper ist service_role-only. Derselbe Aufbau wie der Lead-Erfassungspfad (B1-2).
 *
 * ── FEHLERPOLITIK: HIER WIRD GEWORFEN ───────────────────────────────────────────────────────────
 * Wie `lib/leads/store.ts`. Ob ein Fehlschlag den Vorgang umwirft, entscheidet der AUFRUFER — hier
 * `flow.ts`, das daraus die einzige nicht-erfolgreiche Antwort dieser Seite macht.
 */
import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export type SubmitPartnerApplicationInput = {
  company: string
  firstName: string
  lastName: string
  email: string
  phone: string | null
  website: string | null
  message: string
  /** Die laufende Sitzung. `null` → die Datenbank löst über die Adresse auf (s. u.). */
  userId: string | null
}

/**
 * Schreibt den Antrag und liefert seine ID — oder meldet, dass kein Konto aufgelöst werden konnte.
 *
 * ── DIE RÜCKGABE SAGT NICHTS ÜBER DAS KONTO, UND DAS IST ABSICHT ────────────────────────────────
 * `public.submit_partner_application` verknüpft den Antrag selbst mit dem Auth-Konto — der laufenden
 * Sitzung, sonst dem genau einen Konto zur Adresse. WELCHES Konto das ist und ob es neu entstand,
 * erfährt dieser Code nicht: Der Wrapper gibt ausschliesslich `status` und `application_id` zurück.
 * Wer es nicht erfährt, kann es auch nicht weitergeben — genau das ist der Enumerationsschutz, und
 * er steht deshalb in der Datenbank und nicht in der Disziplin dieser Datei.
 *
 * ── `no_account` IST KEIN FEHLER, SONDERN EIN ZUSTAND (B16-3-Nachbesserung) ─────────────────────
 * Lässt sich kein Konto auflösen, schreibt der Wrapper NICHTS und antwortet `no_account`. Das wird
 * bewusst NICHT geworfen: Ein Wurf sähe hier aus wie „die Datenbank war nicht erreichbar", und der
 * Aufrufer könnte die beiden Fälle nicht mehr auseinanderhalten — im Log unterscheiden sie sich
 * aber grundlegend (Fehlkonfiguration des Mailversands gegen Infrastrukturausfall). Nach AUSSEN
 * führen beide zur selben Meldung; im Server-Log nicht.
 */
export type SubmitPartnerApplicationResult =
  | { stored: true; applicationId: string }
  /** Kein Konto zur Adresse auflösbar — es ist KEIN Antrag entstanden. */
  | { stored: false; reason: 'no_account' }

export async function submitPartnerApplication(
  input: SubmitPartnerApplicationInput,
): Promise<SubmitPartnerApplicationResult> {
  const service = createServiceRoleClient()
  const { data, error } = await service.rpc('submit_partner_application', {
    p_company: input.company,
    p_first_name: input.firstName,
    p_last_name: input.lastName,
    p_email: input.email,
    p_message: input.message,
    p_phone: input.phone ?? undefined,
    p_website: input.website ?? undefined,
    p_user_id: input.userId ?? undefined,
  })
  if (error) throw new Error(`submit_partner_application: ${error.message}`)

  const row = data as Record<string, unknown> | null
  if (!row || typeof row !== 'object') {
    throw new Error('submit_partner_application: unerwartete Rückgabe (kein jsonb-Objekt)')
  }

  if (row.status === 'no_account') return { stored: false, reason: 'no_account' }

  if (row.status !== 'created' || typeof row.application_id !== 'string') {
    /*
     * `missing_fields` kann hier nur eintreten, wenn Schema und Wrapper auseinandergelaufen sind —
     * `flow.ts` prüft dieselben Pflichtfelder vorher. Ein solcher Zustand ist ein Defekt und wird
     * geworfen, nicht als „Bewerbung angenommen" quittiert.
     */
    throw new Error(`submit_partner_application: unerwarteter Status ${String(row.status)}`)
  }

  return { stored: true, applicationId: row.application_id }
}
