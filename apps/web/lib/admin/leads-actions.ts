'use server'

/**
 * Server Actions des Lead-Abschnitts (B1-3).
 *
 * KEIN service_role — genau wie die T4-4-Actions: alle Wrapper sind `authenticated`-only und prüfen
 * `platform.is_admin()` INTERN als erste Anweisung. Die Autorisierung hängt damit nicht an dieser
 * Datei; ein Fehler hier kann keinem Nicht-Admin Schreibzugriff verschaffen.
 *
 * ── UNTERSCHIED ZU DEN T4-4-ACTIONS: DIESE WRAPPER WERFEN ────────────────────────────────────────
 * Die neun T4-4-Wrapper geben `{status:'forbidden'}` zurück. Die Lead-Wrapper WERFEN stattdessen
 * SQLSTATE 42501 (B1-1: „kein Zugriff" darf sich nie als „nichts gefunden" lesen lassen). supabase-js
 * liefert das als `error`, nicht als `data`. Deshalb unterscheidet `interpret` hier zusätzlich den
 * Berechtigungsfehler von einem echten Infrastrukturfehler — beide sind `error`, aber nur einer ist
 * ein Betriebsproblem.
 *
 * Ein roher DB-String erreicht den Bildschirm nie; jede Action übersetzt den Fachstatus in einen
 * Satz. Jede Action ruft ihren RPC selbst auf (kein `callRpc(name, args)`-Helfer) — bei einem
 * variablen Funktionsnamen verliert supabase-js die Typprüfung der ARGUMENTNAMEN, und ein Tippfehler
 * fiele erst zur Laufzeit auf. Begründung ausführlich in `lib/admin/actions.ts`.
 */
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { LEADS_HREF, SUPPRESSIONS_HREF } from './leads'
import type { AdminState } from './schema'

const FORBIDDEN = 'Keine Berechtigung. Bitte laden Sie die Seite neu.'
const GENERIC = 'Das hat nicht geklappt. Bitte versuchen Sie es erneut.'
const GONE = 'Diesen Lead gibt es nicht mehr.'
const ANONYMIZED =
  'Dieser Lead ist anonymisiert. Daran lässt sich nichts mehr ändern — das ist Absicht.'

/** SQLSTATE 42501 = insufficient_privilege. Die Rolle wurde zwischen Aufbau und Klick entzogen. */
function isForbidden(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42501'
}

/** Client holen und Session sicherstellen. null = keine Session (z. B. zwischenzeitlich abgelaufen). */
async function sessionClient() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user ? supabase : null
}

/**
 * Übersetzt die Antwort eines Wrappers in einen Fachstatus.
 * `'forbidden'` = die Datenbank hat abgelehnt · `null` = Infrastruktur-/Formfehler (geloggt).
 */
function interpret(fn: string, data: unknown, error: unknown): string | null {
  if (error) {
    if (isForbidden(error)) return 'forbidden'
    console.error(`[admin/leads] ${fn}:`, error)
    return null
  }
  const status = (data as { status?: unknown } | null)?.status
  if (typeof status !== 'string') {
    console.error(`[admin/leads] ${fn}: unerwartete Antwort`, data)
    return null
  }
  return status
}

/**
 * Nach jeder Änderung: Liste UND Detailseite neu rendern. Beide zeigen denselben Zustand
 * (Einwilligungsspalte, Löschfrist, Sperrkennzeichen) — eine veraltete Liste nach einer Aktion auf
 * der Detailseite wäre genau die Art Divergenz, die man erst beim nächsten Versand bemerkt.
 */
function refresh(leadId?: string): void {
  revalidatePath(LEADS_HREF)
  if (leadId) revalidatePath(`${LEADS_HREF}/${leadId}`)
}

function leadIdOf(formData: FormData): string {
  return String(formData.get('leadId') ?? '')
}

// ── Lebenszyklus ─────────────────────────────────────────────────────────────────────────────────

export async function setLeadStatusAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const leadId = leadIdOf(formData)
  const status = String(formData.get('status') ?? '')
  if (!leadId || !status) return { formError: GENERIC }

  const supabase = await sessionClient()
  if (!supabase) return { formError: FORBIDDEN }

  const { data, error } = await supabase.rpc('admin_set_lead_status', {
    p_lead_id: leadId,
    p_status: status,
  })

  switch (interpret('admin_set_lead_status', data, error)) {
    case 'ok': {
      refresh(leadId)
      // Die Antwort trägt zurück, was die TRIGGER gemacht haben. Der Wechsel auf „Kunde" hebt die
      // Aufbewahrung dauerhaft an — das gehört in die Rückmeldung, nicht nur in den Hinweistext
      // davor: es ist die einzige Statusänderung mit einer bleibenden Folge.
      const basis = (data as { retention_basis?: string } | null)?.retention_basis
      return {
        success:
          basis === 'commercial'
            ? 'Status geändert. Die Aufbewahrung steht jetzt dauerhaft auf 7 Jahre (kaufmännisch).'
            : 'Status geändert.',
      }
    }
    case 'not_found':
      return { formError: GONE }
    case 'anonymized':
      return { formError: ANONYMIZED }
    case 'invalid_status':
      // Sollte nie erscheinen: die Auswahl bietet nur setzbare Werte an (SETTABLE_LEAD_STATUSES).
      return { formError: 'Dieser Status lässt sich nicht setzen.' }
    case 'forbidden':
      return { formError: FORBIDDEN }
    default:
      return { formError: GENERIC }
  }
}

// ── Stammdaten korrigieren (B2-1) ────────────────────────────────────────────────────────────────

/**
 * Der Korrekturweg für die NEUN bearbeitbaren Felder.
 *
 * ── LEER HEISST LÖSCHEN, UND ZWAR ABSICHTLICH ────────────────────────────────────────────────────
 * Ein leeres Feld wird als `null` übergeben und setzt die Spalte auf null. Anders als beim
 * Erfassungspfad (`capture_lead`, B3-1: „null lässt unberührt") ist das hier richtig — ein
 * Bearbeitungsformular schickt immer alle neun Felder, und ein geleertes Feld ist eine Aussage:
 * „diese Angabe war falsch, sie soll weg". Mit COALESCE-Semantik liesse sich kein einziges Feld je
 * löschen, und genau das muss ein Korrekturweg können.
 *
 * ── DIE ZWECKBINDUNG WIRD ALS SATZ ÜBERSETZT, NICHT ALS DATENBANKFEHLER GEZEIGT ──────────────────
 * Der Wrapper WIRFT (22023), wenn Versorger oder Vertragsende ohne Einwilligung zur
 * Vertragsablauf-Erinnerung gesetzt werden sollen. Ein roher Datenbanktext erreicht den Bildschirm
 * nie; hier steht der Satz, der sagt, was zu tun ist.
 */
export async function updateLeadAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const leadId = leadIdOf(formData)
  if (!leadId) return { formError: GENERIC }

  const supabase = await sessionClient()
  if (!supabase) return { formError: FORBIDDEN }

  const text = (name: string): string | undefined => {
    const value = String(formData.get(name) ?? '').trim()
    return value === '' ? undefined : value
  }

  /*
   * Der Jahresverbrauch wird HIER geprüft und nicht der Datenbank überlassen: der Spalten-CHECK
   * verlangt > 0 und lehnt sonst hart ab — als Datenbankfehler, den niemand am Feld sieht. Die
   * Meldung gehört ans Feld (Muster wie `lib/admin/schema.ts`), die DB bleibt trotzdem die harte
   * Grenze.
   */
  const rawConsumption = String(formData.get('annualConsumptionKwh') ?? '').trim()
  let consumption: number | undefined
  if (rawConsumption !== '') {
    const parsed = Number.parseInt(rawConsumption.replace(/[.\s]/g, ''), 10)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return {
        fieldErrors: {
          annualConsumptionKwh:
            'Bitte eine Zahl grösser als 0 angeben — für „nicht bekannt" das Feld leer lassen.',
        },
      }
    }
    consumption = parsed
  }

  const postalCode = text('postalCode')
  if (postalCode !== undefined && !/^[0-9]{4}$/.test(postalCode)) {
    return {
      fieldErrors: { postalCode: 'Eine österreichische Postleitzahl hat genau vier Ziffern.' },
    }
  }

  const contractEnd = text('contractEndDate')
  if (contractEnd !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(contractEnd)) {
    return { fieldErrors: { contractEndDate: 'Bitte ein Datum auswählen.' } }
  }

  const { data, error } = await supabase.rpc('admin_update_lead', {
    p_lead_id: leadId,
    p_company: text('company'),
    p_contact_name: text('contactName'),
    p_phone: text('phone'),
    // Ein unbekannter Wert scheitert am Postgres-Enum — die Datenbank bleibt die harte Grenze; das
    // Auswahlfeld bietet ohnehin nur die zehn Branchen an.
    p_industry: text('industry') as
      | 'baeckerei'
      | 'gastronomie'
      | 'handel'
      | 'hotellerie'
      | 'tischlerei'
      | 'landwirtschaft'
      | 'kuehlhaus'
      | 'metallverarbeitung'
      | 'buero_dienstleistung'
      | 'sonstige'
      | undefined,
    p_postal_code: postalCode,
    p_annual_consumption_kwh: consumption,
    p_metering_type: text('meteringType'),
    p_supplier: text('supplier'),
    p_contract_end_date: contractEnd,
  })

  /*
   * 22023 = invalid_parameter_value: die Zweckbindung hat abgelehnt. Vor `interpret`, weil dort
   * jeder Fehler ausser 42501 als Betriebsproblem geloggt und generisch beantwortet würde — das
   * hier ist aber ein fachlicher, vom Admin auflösbarer Zustand.
   */
  if ((error as { code?: string } | null)?.code === '22023') {
    return {
      formError:
        'Versorger und Vertragsende werden ausschliesslich für die Vertragsablauf-Erinnerung ' +
        'erhoben. Für diesen Lead besteht dafür keine Einwilligung — weder offen noch bestätigt. ' +
        'Ohne diesen Zweck gibt es für die beiden Angaben keine Grundlage; sie lassen sich deshalb ' +
        'nur leeren, nicht setzen. Die übrigen Änderungen wurden NICHT gespeichert.',
    }
  }

  switch (interpret('admin_update_lead', data, error)) {
    case 'ok':
      refresh(leadId)
      return { success: 'Änderungen gespeichert.' }
    case 'not_found':
      return { formError: GONE }
    case 'anonymized':
      return { formError: ANONYMIZED }
    case 'forbidden':
      return { formError: FORBIDDEN }
    default:
      return { formError: GENERIC }
  }
}

// ── Einwilligung widerrufen ──────────────────────────────────────────────────────────────────────

export async function withdrawConsentAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const leadId = leadIdOf(formData)
  const purpose = String(formData.get('purpose') ?? '')
  if (!leadId || !purpose) return { formError: GENERIC }

  const supabase = await sessionClient()
  if (!supabase) return { formError: FORBIDDEN }

  const { data, error } = await supabase.rpc('admin_withdraw_consent', {
    p_lead_id: leadId,
    // Der Zweck kommt aus einem verborgenen Feld, das aus der angezeigten Zeile stammt. Ein
    // unbekannter Wert scheitert am Postgres-Enum — die Datenbank bleibt die harte Grenze.
    p_purpose: purpose as 'marketing_email' | 'contract_expiry_reminder' | 'result_delivery',
  })

  switch (interpret('admin_withdraw_consent', data, error)) {
    case 'ok': {
      refresh(leadId)
      const count = (data as { withdrawn_count?: number } | null)?.withdrawn_count ?? 0
      return {
        success:
          count > 0
            ? `Widerrufen (${count} ${count === 1 ? 'Eintrag' : 'Einträge'}).`
            : 'Für diesen Zweck war nichts mehr offen oder bestätigt.',
      }
    }
    case 'not_found':
      return { formError: GONE }
    case 'anonymized':
      return { formError: ANONYMIZED }
    case 'forbidden':
      return { formError: FORBIDDEN }
    default:
      return { formError: GENERIC }
  }
}

// ── Adresse dauerhaft sperren ────────────────────────────────────────────────────────────────────

export async function suppressLeadAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const leadId = leadIdOf(formData)
  if (!leadId) return { formError: GENERIC }

  const supabase = await sessionClient()
  if (!supabase) return { formError: FORBIDDEN }

  const { data, error } = await supabase.rpc('admin_suppress_lead', { p_lead_id: leadId })

  switch (interpret('admin_suppress_lead', data, error)) {
    case 'ok':
      refresh(leadId)
      return {
        success:
          'Adresse dauerhaft gesperrt, alle Einwilligungen widerrufen. Die Sperre überlebt auch ' +
          'eine spätere Anonymisierung.',
      }
    case 'not_found':
      return { formError: GONE }
    case 'anonymized':
      return {
        formError:
          'Dieser Lead ist bereits anonymisiert — seine Adresse existiert nicht mehr und lässt ' +
          'sich deshalb auch nicht sperren.',
      }
    case 'forbidden':
      return { formError: FORBIDDEN }
    default:
      return { formError: GENERIC }
  }
}

// ── Anonymisieren (unumkehrbar) ──────────────────────────────────────────────────────────────────

export async function anonymizeLeadAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const leadId = leadIdOf(formData)
  if (!leadId) return { formError: GENERIC }

  const supabase = await sessionClient()
  if (!supabase) return { formError: FORBIDDEN }

  const { data, error } = await supabase.rpc('admin_anonymize_lead', { p_lead_id: leadId })

  switch (interpret('admin_anonymize_lead', data, error)) {
    case 'ok': {
      refresh(leadId)
      const outcome = (data as { outcome?: string } | null)?.outcome
      return {
        success:
          outcome === 'already_anonymized'
            ? 'Dieser Lead war bereits anonymisiert.'
            : 'Der Lead ist anonymisiert. Die Einwilligungsnachweise und die Sperrliste bleiben bestehen.',
      }
    }
    case 'not_found':
      return { formError: GONE }
    case 'forbidden':
      return { formError: FORBIDDEN }
    default:
      return { formError: GENERIC }
  }
}

// ── Sperrliste: Einzelabfrage ────────────────────────────────────────────────────────────────────

/**
 * Die Sperrliste hält nur SHA-256-Werte (B1-1: sie darf nicht selbst als Verteilerliste taugen).
 * Eine Liste von Hashes ist für Menschen nicht lesbar — die Einzelabfrage ist deshalb die einzige
 * sinnvolle Darstellung. Das ist eine Folge des Entwurfs, kein Mangel.
 *
 * Trägt die Eingabe über `values` zurück ins Formular: hier hat jemand wirklich etwas getippt.
 */
export async function lookupSuppressionAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const raw = { email: String(formData.get('email') ?? '') }
  if (!raw.email.trim()) {
    return { fieldErrors: { email: 'Bitte eine E-Mail-Adresse angeben.' }, values: raw }
  }

  const supabase = await sessionClient()
  if (!supabase) return { formError: FORBIDDEN, values: raw }

  const { data, error } = await supabase.rpc('admin_is_email_suppressed', { p_email: raw.email })

  switch (interpret('admin_is_email_suppressed', data, error)) {
    case 'ok': {
      const result = data as { is_suppressed?: boolean; normalized_email?: string } | null
      const shown = result?.normalized_email ?? raw.email.trim().toLowerCase()
      // Die Abfrage ändert nichts — trotzdem revalidieren, damit die Sperrzahl daneben aktuell ist,
      // falls in der Zwischenzeit anderswo gesperrt wurde.
      revalidatePath(SUPPRESSIONS_HREF)
      return {
        success: result?.is_suppressed
          ? `${shown} steht auf der Sperrliste. An diese Adresse geht keine Aussendung.`
          : `${shown} steht NICHT auf der Sperrliste.`,
        values: raw,
      }
    }
    case 'invalid_email':
      return { fieldErrors: { email: 'Bitte eine E-Mail-Adresse angeben.' }, values: raw }
    case 'forbidden':
      return { formError: FORBIDDEN, values: raw }
    default:
      return { formError: GENERIC, values: raw }
  }
}
