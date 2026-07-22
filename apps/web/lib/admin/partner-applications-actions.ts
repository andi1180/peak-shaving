'use server'

/**
 * Server Actions des Prüf-Eingangs — die Anwendungsseite von
 * `public.admin_reject_partner_application` (B16-3) und
 * `public.admin_approve_partner_application` (B16-4a).
 *
 * ── ZWEI ACTIONS, UND DIE GENEHMIGUNG BRAUCHT EINEN SLUG ────────────────────────────────────────
 * Bis B16-3 gab es hier bewusst NUR das Ablehnen: Genehmigen erzeugt zusätzlich einen Partner, einen
 * Kurz-Key und die Verknüpfung des Kontos, und eine Schaltfläche, die nur den Status gesetzt hätte,
 * hinterliesse einen genehmigten Antrag OHNE Partner — einen stillen Zustand, der wie Erfolg
 * aussieht. Mit B16-4a ist der Weg da, und die Grenze steht weiterhin tiefer als hier: der Wrapper
 * VERLANGT einen Slug, es gibt also keinen Aufruf, der 'approved' erreicht, ohne dass ein
 * Fachbetrieb entsteht — und beides passiert in derselben Transaktion.
 *
 * KEIN service_role, exakt wie die Lead- und Partner-Actions: beide Wrapper sind
 * `authenticated`-only und prüfen `platform.is_admin()` INTERN als erste Anweisung. Die
 * Autorisierung hängt damit nicht an dieser Datei; ein Fehler hier kann keinem Nicht-Admin
 * Schreibzugriff verschaffen. Bei der Genehmigung kommt ein zweiter Grund dazu: über `service_role`
 * wäre `reviewed_by` strukturell leer, und die Zuschreibung einer unumkehrbaren Handlung ist der
 * halbe Zweck des Protokolls. Die `no-restricted-imports`-Erlaubnisliste wurde für diesen Pfad NICHT
 * erweitert.
 */
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { partnerApprovalSchema, toFieldErrors, type AdminState } from './schema'
import { PARTNER_APPLICATIONS_HREF, PARTNER_APPLICATION_DETAIL_HREF } from './partner-applications'
import { PARTNERS_HREF } from './partners'

const FORBIDDEN = 'Keine Berechtigung. Bitte laden Sie die Seite neu.'
const GENERIC = 'Das hat nicht geklappt. Bitte versuchen Sie es erneut.'
const GONE = 'Diesen Antrag gibt es nicht (mehr).'

/** SQLSTATE 42501 = insufficient_privilege. Die Rolle wurde zwischen Aufbau und Klick entzogen. */
function isForbidden(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42501'
}

/**
 * Lehnt eine Bewerbung ab und hält Prüfer und Zeitpunkt fest.
 *
 * `already_reviewed` bekommt eine eigene Meldung statt des Sammeltextes: Der Fall tritt real ein,
 * wenn zwei Personen dieselbe Liste offen haben — und „das hat nicht geklappt" wäre dort schlicht
 * falsch. Es HAT geklappt, nur nicht durch diesen Klick.
 */
export async function rejectPartnerApplicationAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return { formError: GONE }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { formError: FORBIDDEN }

  const { data, error } = await supabase.rpc('admin_reject_partner_application', { p_id: id })

  if (error) {
    if (isForbidden(error)) return { formError: FORBIDDEN }
    console.error('[admin/partner-applications] admin_reject_partner_application:', error)
    return { formError: GENERIC }
  }

  const status = (data as { status?: unknown } | null)?.status
  switch (status) {
    case 'ok':
      revalidatePath(PARTNER_APPLICATIONS_HREF)
      revalidatePath(PARTNER_APPLICATION_DETAIL_HREF(id))
      return { success: 'Bewerbung abgelehnt. Der Antrag bleibt zur Nachvollziehbarkeit stehen.' }
    case 'already_reviewed':
      return {
        formError:
          'Dieser Antrag wurde bereits geprüft — der Zeitpunkt der ersten Entscheidung bleibt ' +
          'stehen. Bitte laden Sie die Seite neu.',
      }
    case 'not_found':
      return { formError: GONE }
    default:
      console.error('[admin/partner-applications] unerwartete Antwort:', data)
      return { formError: GENERIC }
  }
}

/**
 * Genehmigt eine Bewerbung: legt den Fachbetrieb an, verknüpft Konto und Antrag und setzt den
 * Status — in EINER Transaktion (`public.admin_approve_partner_application`, B16-4a).
 *
 * ── JEDE ABLEHNUNG BEKOMMT IHREN EIGENEN SATZ ───────────────────────────────────────────────────
 * Ein Sammeltext zwänge die Person zu raten, was zu tun ist, und die Antworten sind vollkommen
 * verschieden: einen anderen Kurz-Key wählen · gar nichts tun, weil schon entschieden · erst das
 * Konto klären. Genau dafür gibt es die fünf unterscheidbaren Status im Wrapper; sie hier wieder
 * einzuebnen hiesse, die Unterscheidung zweimal zu bezahlen und einmal zu benutzen.
 *
 * ── DIE ERFOLGSMELDUNG SAGT, WAS NICHT PASSIERT IST ─────────────────────────────────────────────
 * Der Fachbetrieb ist angelegt und mit seinem Konto verknüpft — benachrichtigt ist er NICHT (die
 * Mail und das Portal sind B16-4b). Ohne diesen Satz hielte ein Admin den Vorgang für abgeschlossen,
 * und der Betrieb wartete auf eine Nachricht, die nicht kommt.
 */
export async function approvePartnerApplicationAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return { formError: GONE }

  const values = { slug: String(formData.get('slug') ?? '') }

  /*
   * Die Formprüfung steht hier UND als CHECK in der Datenbank, und das ist keine Verdopplung: Der
   * Wrapper beantwortet einen ungültigen Slug bereits mit `invalid_slug` — aber erst nach einem
   * Roundtrip und ohne Bezug auf ein Feld. Die Meldung gehört ANS FELD, bevor jemand einen
   * Schlüssel bestätigt, den er nie wieder ändern kann.
   */
  const parsed = partnerApprovalSchema.safeParse(values)
  if (!parsed.success) {
    return { fieldErrors: toFieldErrors(parsed.error.issues), values }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { formError: FORBIDDEN, values }

  const { data, error } = await supabase.rpc('admin_approve_partner_application', {
    p_id: id,
    p_slug: parsed.data.slug,
  })

  if (error) {
    if (isForbidden(error)) return { formError: FORBIDDEN, values }
    console.error('[admin/partner-applications] admin_approve_partner_application:', error)
    return { formError: GENERIC, values }
  }

  const result = (data ?? {}) as { status?: unknown; current?: unknown; partner_slug?: unknown }
  switch (result.status) {
    case 'ok':
      revalidatePath(PARTNER_APPLICATIONS_HREF)
      revalidatePath(PARTNER_APPLICATION_DETAIL_HREF(id))
      revalidatePath(PARTNERS_HREF)
      return {
        success:
          `Bewerbung genehmigt. Der Fachbetrieb ist unter dem Kurz-Key „${parsed.data.slug}" ` +
          'angelegt und mit dem Konto des Antrags verknüpft. ' +
          'ER IST NOCH NICHT BENACHRICHTIGT — es geht keine automatische Nachricht raus; das ' +
          'Partner-Portal und die Mail dazu kommen im nächsten Bauabschnitt. Bis dahin bitte selbst ' +
          'Kontakt aufnehmen. Der Kurz-Key lässt sich nicht mehr ändern.',
      }
    case 'already_reviewed':
      return {
        formError:
          result.current === 'approved'
            ? 'Dieser Antrag ist bereits genehmigt — ein zweiter Fachbetrieb entsteht dadurch ' +
              'nicht. Bitte laden Sie die Seite neu.'
            : 'Dieser Antrag wurde bereits abgelehnt und lässt sich nicht nachträglich genehmigen. ' +
              'Der Zeitpunkt der ersten Entscheidung bleibt stehen.',
        values,
      }
    case 'no_account':
      return {
        /*
         * Real aufgetreten: `submit_partner_application` legt den Antrag auch dann an, wenn die
         * Kontoanlage scheitert (gemessen am Rate-Limit des Mailversands) — bewusst, denn eine
         * verlorene Bewerbung wiegt schwerer. Genehmigt entstünde daraus ein Partner ohne Login,
         * und der Kurz-Key wäre unwiderruflich verbraucht. Der Text nennt deshalb den Ausweg.
         */
        formError:
          'Mit diesem Antrag ist kein Konto verknüpft — genehmigt entstünde ein Fachbetrieb, in ' +
          'dessen Zugang sich niemand einloggen könnte, und der Kurz-Key wäre verbraucht. Bitte ' +
          'zuerst klären: den Betrieb sich unter /partner-werden erneut bewerben lassen (dann ' +
          'entsteht das Konto), oder ihn unter „Partner" von Hand anlegen und dort sein ' +
          'bestehendes Konto verknüpfen.',
        values,
      }
    case 'account_taken':
      return {
        formError:
          `Das Konto dieses Antrags gehört bereits zum Fachbetrieb „${String(result.partner_slug)}". ` +
          'Ein Konto kann derzeit nur an einem Betrieb hängen. Bitte prüfen, ob es sich um ' +
          'dieselbe Firma handelt — dann ist hier nichts zu tun.',
        values,
      }
    case 'duplicate_slug':
      return {
        fieldErrors: {
          slug:
            'Diesen Kurz-Key gibt es bereits. Er identifiziert einen bestehenden Fachbetrieb und ' +
            'wird nicht überschrieben — bitte einen anderen wählen.',
        },
        values,
      }
    case 'invalid_slug':
      return {
        fieldErrors: {
          slug: 'Nur Kleinbuchstaben, Ziffern und Bindestriche — keine Unterstriche, keine Umlaute.',
        },
        values,
      }
    case 'missing_fields':
      return { fieldErrors: { slug: 'Bitte einen Kurz-Key angeben.' }, values }
    case 'not_found':
      return { formError: GONE, values }
    default:
      console.error('[admin/partner-applications] unerwartete Antwort:', data)
      return { formError: GENERIC, values }
  }
}
