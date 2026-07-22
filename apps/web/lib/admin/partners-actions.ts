'use server'

/**
 * Server Actions des Partner-Abschnitts (B16-2) — die Anwendungsseite der drei schreibenden
 * B16-1-Wrapper.
 *
 * KEIN service_role, exakt wie die Lead-Actions: `admin_create_partner`, `admin_update_partner` und
 * `admin_set_partner_active` sind `authenticated`-only und prüfen `platform.is_admin()` INTERN als
 * erste Anweisung. Die Autorisierung hängt damit nicht an dieser Datei; ein Fehler hier kann keinem
 * Nicht-Admin Schreibzugriff verschaffen. Die `no-restricted-imports`-Erlaubnisliste in der
 * root-`eslint.config.mjs` wurde NICHT angefasst.
 *
 * ── DIE DREI WRAPPER WERFEN (42501), STATT LEER ZU ANTWORTEN ─────────────────────────────────────
 * Wie alle Lead-/Partner-Wrapper seit B1-1: „kein Zugriff" darf sich nie als „keine Partner" lesen
 * lassen. supabase-js liefert das als `error`, nicht als `data` — `interpret` unterscheidet deshalb
 * den Berechtigungsfehler vom Betriebsproblem.
 *
 * ── ES GIBT BEWUSST KEINE `deletePartnerAction` ─────────────────────────────────────────────────
 * `platform.partners` hat für NIEMANDEN ein `delete`-Grant (B16-1). An einem Fachbetrieb hängen die
 * bereits erfolgten Zuordnungen; ein gelöschter Partner machte sie unerklärbar. Stilllegung läuft
 * über `is_active` — und die wirkt sofort dort, wo es zählt: `public.capture_lead` ordnet einem
 * inaktiven Partner nichts mehr zu, und seine Landingpage antwortet ab diesem Moment mit 404.
 *
 * ── UND KEINEN WEG, EINEN SLUG ZU ÄNDERN ────────────────────────────────────────────────────────
 * `admin_update_partner` hat dafür keinen Parameter, und der Trigger `guard_partner_slug` ist die
 * harte Grenze dahinter. Der Slug steht in bereits verschickten Mails und kann nicht zurückgeholt
 * werden. Ein neuer Schlüssel ist ein neuer Partnereintrag; der alte wird stillgelegt.
 */
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { PARTNERS_HREF } from './partners'
import { partnerSlugSchema, toFieldErrors, type AdminState } from './schema'

const FORBIDDEN = 'Keine Berechtigung. Bitte laden Sie die Seite neu.'
const GENERIC = 'Das hat nicht geklappt. Bitte versuchen Sie es erneut.'
const GONE = 'Diesen Fachbetrieb gibt es nicht (mehr).'
const MISSING = 'Bitte Kurz-Key und Anzeigename angeben.'

/** SQLSTATE 42501 = insufficient_privilege. Die Rolle wurde zwischen Aufbau und Klick entzogen. */
function isForbidden(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42501'
}

async function sessionClient() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user ? supabase : null
}

function interpret(fn: string, data: unknown, error: unknown): string | null {
  if (error) {
    if (isForbidden(error)) return 'forbidden'
    console.error(`[admin/partners] ${fn}:`, error)
    return null
  }
  const status = (data as { status?: unknown } | null)?.status
  if (typeof status !== 'string') {
    console.error(`[admin/partners] ${fn}: unerwartete Antwort`, data)
    return null
  }
  return status
}

function text(formData: FormData, name: string): string | undefined {
  const value = String(formData.get(name) ?? '').trim()
  return value === '' ? undefined : value
}

// ── Anlegen ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Legt einen Fachbetrieb an — NUR anlegen, kein Upsert (`admin_create_partner`, B16-1): ein
 * versehentlich doppelt abgeschicktes Formular darf einen bestehenden Partner nicht stillschweigend
 * umbenennen, während seine Links bereits im Umlauf sind.
 */
export async function createPartnerAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const values = {
    slug: String(formData.get('slug') ?? ''),
    displayName: String(formData.get('displayName') ?? ''),
    contactFirstName: String(formData.get('contactFirstName') ?? ''),
    contactLastName: String(formData.get('contactLastName') ?? ''),
  }

  /*
   * Die Formprüfung steht hier UND als CHECK in der Datenbank, und das ist keine Verdopplung: Der
   * Wrapper beantwortet einen ungültigen Slug bereits mit `invalid_slug` statt mit 23514 (B16-1) —
   * aber erst nach einem Roundtrip und ohne Bezug auf ein Feld. Die Meldung gehört ANS FELD, bevor
   * jemand einen Slug vergibt, den er nie wieder ändern kann.
   */
  const parsed = partnerSlugSchema.safeParse(values)
  if (!parsed.success) {
    return { fieldErrors: toFieldErrors(parsed.error.issues), values }
  }

  const supabase = await sessionClient()
  if (!supabase) return { formError: FORBIDDEN, values }

  const { data, error } = await supabase.rpc('admin_create_partner', {
    p_slug: parsed.data.slug,
    p_display_name: parsed.data.displayName,
    p_contact_first_name: text(formData, 'contactFirstName'),
    p_contact_last_name: text(formData, 'contactLastName'),
  })

  switch (interpret('admin_create_partner', data, error)) {
    case 'created':
      revalidatePath(PARTNERS_HREF)
      return {
        success:
          `Fachbetrieb „${parsed.data.displayName}" angelegt. Der Empfehlungslink steht in der ` +
          'Liste unten — der Kurz-Key lässt sich danach nicht mehr ändern.',
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
      return { formError: MISSING, values }
    case 'forbidden':
      return { formError: FORBIDDEN, values }
    default:
      return { formError: GENERIC, values }
  }
}

// ── Stammdaten korrigieren ───────────────────────────────────────────────────────────────────────

/**
 * Ändert Anzeigename und Ansprechperson. Der Slug fährt als BEZEICHNER mit (readOnly im Formular),
 * nicht als änderbares Feld.
 *
 * LEER HEISST LÖSCHEN — für die Ansprechperson, nicht für den Anzeigenamen. Dieselbe Regel und
 * dieselbe Ausnahme wie in `admin_update_lead` (B2-1): Ein Bearbeitungsformular schickt immer alle
 * Felder, ein geleertes Feld ist eine Aussage. Beim Anzeigenamen wäre sie es nicht — er ist
 * Pflichtfeld (CHECK gegen den Leerstring), und eine namenlose Zeile in der Partnerliste ist nicht
 * bedienbar.
 */
export async function updatePartnerAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const slug = String(formData.get('slug') ?? '').trim()
  const displayName = String(formData.get('displayName') ?? '').trim()
  if (!slug) return { formError: GONE }
  if (!displayName) {
    return { fieldErrors: { displayName: 'Der Anzeigename ist Pflicht und kann nicht leer sein.' } }
  }

  const supabase = await sessionClient()
  if (!supabase) return { formError: FORBIDDEN }

  const { data, error } = await supabase.rpc('admin_update_partner', {
    p_slug: slug,
    p_display_name: displayName,
    p_contact_first_name: text(formData, 'contactFirstName'),
    p_contact_last_name: text(formData, 'contactLastName'),
  })

  switch (interpret('admin_update_partner', data, error)) {
    case 'ok':
      revalidatePath(PARTNERS_HREF)
      return { success: 'Änderungen gespeichert.' }
    case 'not_found':
      return { formError: GONE }
    case 'missing_fields':
      return { formError: MISSING }
    case 'forbidden':
      return { formError: FORBIDDEN }
    default:
      return { formError: GENERIC }
  }
}

// ── Stilllegen / reaktivieren ────────────────────────────────────────────────────────────────────

/**
 * Das Gegenstück zum fehlenden Löschweg (`admin_set_partner_active`, B16-1).
 *
 * Die Rückmeldung benennt die WIRKUNG, nicht nur den Zustand: Eine Stilllegung lässt die
 * Landingpage des Fachbetriebs ab sofort 404 antworten und beendet die Zuordnung neuer Leads —
 * beides sofort und ohne weiteres Zutun. Wer den Knopf drückt, während eine Serienmail unterwegs
 * ist, soll das wissen, bevor er sich wundert.
 */
export async function setPartnerActiveAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const slug = String(formData.get('slug') ?? '').trim()
  const isActive = String(formData.get('isActive') ?? '') === 'true'
  if (!slug) return { formError: GONE }

  const supabase = await sessionClient()
  if (!supabase) return { formError: FORBIDDEN }

  const { data, error } = await supabase.rpc('admin_set_partner_active', {
    p_slug: slug,
    p_is_active: isActive,
  })

  switch (interpret('admin_set_partner_active', data, error)) {
    case 'ok':
      revalidatePath(PARTNERS_HREF)
      return {
        success: isActive
          ? 'Fachbetrieb reaktiviert. Sein Empfehlungslink wirkt wieder.'
          : 'Fachbetrieb stillgelegt. Sein Empfehlungslink führt ab sofort ins Leere (404), und ' +
            'neue Anfragen werden ihm nicht mehr zugeordnet. Bestehende Zuordnungen bleiben.',
      }
    case 'not_found':
      return { formError: GONE }
    case 'forbidden':
      return { formError: FORBIDDEN }
    default:
      return { formError: GENERIC }
  }
}
