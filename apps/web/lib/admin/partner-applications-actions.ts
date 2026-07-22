'use server'

/**
 * Server Action des Prüf-Eingangs (B16-3) — die Anwendungsseite von
 * `public.admin_reject_partner_application`.
 *
 * ── ES GIBT GENAU EINE ACTION, UND SIE KANN NUR ABLEHNEN ────────────────────────────────────────
 * Kein `approvePartnerApplicationAction`, und zwar nicht aus Zeitmangel: Genehmigen erzeugt in
 * B16-4 einen Partner, einen Slug und eine Freischaltung. Eine Schaltfläche, die jetzt nur den
 * Status setzte, hinterliesse einen genehmigten Antrag OHNE Partner — ein stiller Zustand, der wie
 * Erfolg aussieht und den niemand mehr von einem echten unterscheiden kann. Die Grenze steht
 * ausserdem tiefer als hier: In der Datenbank gibt es keinen Wrapper dafür, und
 * `platform.partner_applications` hat für keine Rolle ein Tabellenrecht.
 *
 * KEIN service_role, exakt wie die Lead- und Partner-Actions: `admin_reject_partner_application` ist
 * `authenticated`-only und prüft `platform.is_admin()` INTERN als erste Anweisung. Die Autorisierung
 * hängt damit nicht an dieser Datei; ein Fehler hier kann keinem Nicht-Admin Schreibzugriff
 * verschaffen. Die `no-restricted-imports`-Erlaubnisliste wurde für diesen Pfad NICHT erweitert.
 */
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { AdminState } from './schema'
import { PARTNER_APPLICATIONS_HREF, PARTNER_APPLICATION_DETAIL_HREF } from './partner-applications'

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
