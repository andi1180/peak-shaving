'use server'

/**
 * Server Actions des Admin-Bereichs (T4-4).
 *
 * KEIN service_role hier (anders als beim Stripe-Checkout, der Zahlungs-Spiegel schreiben muss):
 * alle neun `admin_*`-Wrapper sind authenticated-only und prüfen `platform.is_admin()` INTERN als
 * erste Anweisung. Die Autorisierung hängt damit nicht an dieser Datei — selbst ein Fehler hier
 * (vergessene Schranke, falscher Pfad) kann keinem Nicht-Admin Schreibzugriff verschaffen, weil die
 * Datenbank ihn ablehnt. Das geschützte Layout ist die zweite, nicht die einzige Linie.
 *
 * Alle Wrapper geben `jsonb` mit einem `status`-Feld zurück, nie eine Exception im Regelbetrieb
 * (Muster wie `redeem_code`). Diese Datei übersetzt den Status in einen Satz für die Oberfläche —
 * ein roher DB-String erreicht den Bildschirm nicht.
 *
 * ── WARUM JEDE ACTION IHREN RPC SELBST AUFRUFT ───────────────────────────────────────────────────
 * Ein gemeinsamer Helfer `callRpc(name, args)` mit variablem Funktionsnamen wäre kürzer, verliert
 * aber die Typprüfung der ARGUMENTNAMEN: supabase-js leitet die Signatur nur aus einem literalen
 * Namen ab, bei einer Variablen fällt es auf „Couldn't infer function definition" zurück. Ein
 * Tippfehler wie `p_targt_id` wäre dann erst zur Laufzeit sichtbar — in einem Bereich, der Rollen
 * und Zugänge verwaltet, die schlechteste Stelle für einen stillen Fehlschlag. Geteilt sind
 * deshalb nur Session-Prüfung und Antwort-Auswertung, nicht der Aufruf selbst.
 */
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ADMIN_ANMELDEN_HREF, ADMIN_HREF, PRODUCT_LABELS } from './config'
import {
  codeSchema,
  roleByEmailSchema,
  roleSchema,
  scrapeTargetSchema,
  toFieldErrors,
  toggleSchema,
  type AdminState,
} from './schema'

/** Was jeder Wrapper mindestens zurückgibt. Weitere Felder (id, …) interessieren die Actions nicht. */
type RpcResult = { status?: unknown; [key: string]: unknown }

/**
 * Meldung, wenn die Datenbank einen Nicht-Admin ablehnt. Sollte im Normalbetrieb NIE erscheinen
 * (das Layout hat vorher schon abgewiesen) — sie deckt den Fall ab, dass die Rolle zwischen
 * Seitenaufbau und Absenden entzogen wurde.
 */
const FORBIDDEN = 'Keine Berechtigung. Bitte laden Sie die Seite neu.'
const GENERIC = 'Das hat nicht geklappt. Bitte versuchen Sie es erneut.'

/** Client holen und Session sicherstellen. null = keine Session (z. B. zwischenzeitlich abgelaufen). */
async function sessionClient() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user ? supabase : null
}

/**
 * Übersetzt die Antwort eines Wrappers in einen Fachstatus. Trennt drei Fälle sauber: echter
 * Infrastrukturfehler (→ geloggt, `null`), unerwartete Form (→ geloggt, `null`) und ein erwarteter
 * Fachstatus (→ an den Aufrufer). Muster wie `lib/redemption/actions.ts`.
 */
function interpret(fn: string, data: unknown, error: unknown): string | null {
  if (error) {
    console.error(`[admin] ${fn}:`, error)
    return null
  }
  const result = (data ?? {}) as RpcResult
  if (typeof result.status !== 'string') {
    console.error(`[admin] ${fn}: unerwartete Antwort`, data)
    return null
  }
  return result.status
}

/** Nach jeder erfolgreichen Änderung: die Seite mit den neuen Listen neu rendern. */
function refresh(): void {
  revalidatePath(ADMIN_HREF)
}

/**
 * Wandelt die naive Ortszeit aus einem `datetime-local`-Feld in einen eindeutigen UTC-Zeitpunkt um,
 * gelesen als **Europe/Vienna**.
 *
 * Ohne diesen Schritt läge das Ablaufdatum daneben: Der Browser liefert „2026-08-01T12:00" ohne
 * Zonenangabe, und Postgres würde das in der Zeitzone der Verbindung (UTC) auslegen — der Code
 * verfiele im Sommer zwei Stunden früher als eingegeben. Die Umrechnung ermittelt den Versatz für
 * genau diesen Zeitpunkt (nicht pauschal +1/+2 h), Sommerzeit-Umstellung inklusive.
 */
function viennaLocalToUtcIso(local: string): string {
  const asIfUtc = new Date(`${local}Z`)
  // Wanduhrzeit, die Wien zu diesem UTC-Zeitpunkt zeigt (sv-SE liefert ISO-nahes „YYYY-MM-DD HH:mm:ss").
  const viennaWall = new Date(
    `${asIfUtc.toLocaleString('sv-SE', { timeZone: 'Europe/Vienna' }).replace(' ', 'T')}Z`,
  )
  const offsetMs = viennaWall.getTime() - asIfUtc.getTime()
  return new Date(asIfUtc.getTime() - offsetMs).toISOString()
}

// ── Teil 1: Scraper-Ziele ────────────────────────────────────────────────────────────────────────

export async function upsertScrapeTargetAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const raw = {
    providerSlug: String(formData.get('providerSlug') ?? ''),
    providerName: String(formData.get('providerName') ?? ''),
    tariffPageUrl: String(formData.get('tariffPageUrl') ?? ''),
    networkArea: String(formData.get('networkArea') ?? ''),
    sortPriority: String(formData.get('sortPriority') ?? '100'),
    notes: String(formData.get('notes') ?? ''),
  }
  const parsed = scrapeTargetSchema.safeParse({ ...raw, isActive: formData.get('isActive') === 'on' })
  if (!parsed.success) {
    return { fieldErrors: toFieldErrors(parsed.error.issues), values: raw }
  }
  const v = parsed.data

  const supabase = await sessionClient()
  if (!supabase) return { formError: FORBIDDEN, values: raw }

  const { data, error } = await supabase.rpc('admin_upsert_scrape_target', {
    p_provider_slug: v.providerSlug,
    p_provider_name: v.providerName,
    p_tariff_page_url: v.tariffPageUrl,
    p_is_active: v.isActive,
    // `p_extraction_config` wird BEWUSST nicht mitgeschickt: die Extraktionsregel pflegt die
    // Entwicklung, nicht dieses Formular. Der Wrapper liest ein fehlendes Feld als „nicht anfassen"
    // (coalesce), eine bestehende Regel überlebt die Bearbeitung also.
    // Weggelassen statt `null`: der SQL-Default IST NULL, die Wirkung ist identisch — und der
    // generierte Typ markiert Parameter-mit-Default als optional, nicht als nullbar.
    p_network_area: v.networkArea || undefined,
    p_sort_priority: v.sortPriority,
    p_notes: v.notes || undefined,
  })

  switch (interpret('admin_upsert_scrape_target', data, error)) {
    case 'created':
      refresh()
      return { success: `Ziel „${v.providerSlug}“ angelegt.` }
    case 'updated':
      refresh()
      return { success: `Ziel „${v.providerSlug}“ aktualisiert.` }
    case 'missing_fields':
      return { formError: 'Kurz-Key, Anbietername und Tarifseite sind Pflichtfelder.', values: raw }
    case 'invalid_slug':
      return {
        fieldErrors: { providerSlug: 'Nur Kleinbuchstaben, Ziffern und Bindestriche.' },
        values: raw,
      }
    case 'forbidden':
      return { formError: FORBIDDEN, values: raw }
    default:
      return { formError: GENERIC, values: raw }
  }
}

export async function setScrapeTargetActiveAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const parsed = toggleSchema.safeParse({
    id: String(formData.get('id') ?? ''),
    isActive: formData.get('isActive') === 'true',
  })
  if (!parsed.success) return { formError: GENERIC }

  const supabase = await sessionClient()
  if (!supabase) return { formError: FORBIDDEN }

  const { data, error } = await supabase.rpc('admin_set_scrape_target_active', {
    p_target_id: parsed.data.id,
    p_is_active: parsed.data.isActive,
  })

  switch (interpret('admin_set_scrape_target_active', data, error)) {
    case 'ok':
      refresh()
      return { success: parsed.data.isActive ? 'Ziel aktiviert.' : 'Ziel deaktiviert.' }
    case 'not_found':
      return { formError: 'Dieses Ziel gibt es nicht mehr.' }
    case 'forbidden':
      return { formError: FORBIDDEN }
    default:
      return { formError: GENERIC }
  }
}

// ── Teil 2: Rollen ───────────────────────────────────────────────────────────────────────────────

/*
 * Es gibt hier KEINE `grantRoleAction` (Vergabe über eine ausgewählte user_id) mehr — bewusst
 * entfernt, nicht vergessen. Sie hing an der abgelösten Gesamtliste aller Konten: nur dort gab es
 * eine Zeile mit „Admin geben". In der neuen Rollen-Liste stehen ausschließlich Konten, die schon
 * eine Rolle haben — ein Vergabe-Knopf wäre dort sinnlos. Die Vergabe läuft über
 * `grantRoleByEmailAction`. Der SQL-Wrapper `admin_grant_role(uuid, text)` bleibt in der Datenbank
 * (er ist die Grundlage, auf die `admin_grant_role_by_email` aufsetzt), hat aber keinen Aufrufer
 * mehr in dieser Anwendung.
 */

/**
 * Rollenvergabe über die E-MAIL statt über eine ausgewählte Zeile.
 *
 * Nötig, seit die Rollen-Liste (`admin_list_admins`) nur noch Rollenträger zeigt: der Kollege, der
 * gerade Admin werden SOLL, steht darin per Definition noch nicht. Die E-Mail ist das, was man von
 * ihm ohnehin hat.
 *
 * Als einzige Rollen-Action trägt sie `values` zurück ins Formular: hier hat der Nutzer wirklich
 * etwas getippt, das bei einer Ablehnung („diese Adresse kennen wir nicht") nicht verloren gehen
 * darf. Die beiden Knopf-Actions daneben haben nichts, was man neu tippen müsste.
 */
export async function grantRoleByEmailAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const raw = { email: String(formData.get('email') ?? '') }
  const parsed = roleByEmailSchema.safeParse({ ...raw, role: String(formData.get('role') ?? '') })
  if (!parsed.success) {
    return { fieldErrors: toFieldErrors(parsed.error.issues), values: raw }
  }

  const supabase = await sessionClient()
  if (!supabase) return { formError: FORBIDDEN, values: raw }

  const { data, error } = await supabase.rpc('admin_grant_role_by_email', {
    p_email: parsed.data.email,
    p_role: parsed.data.role,
  })

  switch (interpret('admin_grant_role_by_email', data, error)) {
    case 'ok':
      refresh()
      return { success: `Administrator-Rolle an ${parsed.data.email} vergeben.` }
    case 'user_not_found':
      // Die häufigste echte Ursache ist ein Tippfehler ODER ein Konto, das es noch gar nicht gibt —
      // der Text nennt beides, damit niemand vergeblich die Schreibweise sucht.
      return {
        fieldErrors: {
          email:
            'Zu dieser Adresse gibt es kein Konto. Die Person muss sich zuerst selbst registrieren.',
        },
        values: raw,
      }
    case 'ambiguous_email':
      return {
        formError:
          'Zu dieser Adresse gibt es mehrere Konten. Bitte melden — die Rolle wird hier bewusst ' +
          'nicht auf gut Glück vergeben.',
        values: raw,
      }
    case 'missing_fields':
      return { fieldErrors: { email: 'Bitte eine E-Mail-Adresse angeben.' }, values: raw }
    case 'invalid_role':
      return { formError: 'Unbekannte Rolle.', values: raw }
    case 'forbidden':
      return { formError: FORBIDDEN, values: raw }
    default:
      return { formError: GENERIC, values: raw }
  }
}

export async function revokeRoleAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const parsed = roleSchema.safeParse({
    userId: String(formData.get('userId') ?? ''),
    role: String(formData.get('role') ?? ''),
  })
  if (!parsed.success) return { formError: GENERIC }

  const supabase = await sessionClient()
  if (!supabase) return { formError: FORBIDDEN }

  const { data, error } = await supabase.rpc('admin_revoke_role', {
    p_target_user_id: parsed.data.userId,
    p_role: parsed.data.role,
  })

  switch (interpret('admin_revoke_role', data, error)) {
    case 'ok':
      refresh()
      return { success: 'Rolle entzogen.' }
    case 'last_admin':
      // Der Lockout-Schutz. Bewusst als KLARE Ansage, nicht als generischer Fehler: der Admin soll
      // verstehen, warum es nicht geht, und was er vorher tun muss.
      return {
        formError:
          'Das ist die letzte Administrator-Rolle. Vergeben Sie sie zuerst an ein weiteres Konto, ' +
          'sonst könnte niemand mehr auf diesen Bereich zugreifen.',
      }
    case 'not_assigned':
      return { formError: 'Dieses Konto hat die Rolle nicht.' }
    case 'invalid_role':
      return { formError: 'Unbekannte Rolle.' }
    case 'forbidden':
      return { formError: FORBIDDEN }
    default:
      return { formError: GENERIC }
  }
}

// ── Teil 3: Gutscheincodes ───────────────────────────────────────────────────────────────────────

export async function createCodeAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const raw = {
    code: String(formData.get('code') ?? ''),
    productKey: String(formData.get('productKey') ?? ''),
    maxRedemptions: String(formData.get('maxRedemptions') ?? ''),
    expiresAt: String(formData.get('expiresAt') ?? ''),
    note: String(formData.get('note') ?? ''),
  }
  const parsed = codeSchema.safeParse(raw)
  if (!parsed.success) {
    return { fieldErrors: toFieldErrors(parsed.error.issues), values: raw }
  }
  const v = parsed.data

  const supabase = await sessionClient()
  if (!supabase) return { formError: FORBIDDEN, values: raw }

  const { data, error } = await supabase.rpc('admin_create_code', {
    p_code: v.code,
    p_product_key: v.productKey,
    p_max_redemptions: v.maxRedemptions ?? undefined,
    p_expires_at: v.expiresAt ? viennaLocalToUtcIso(v.expiresAt) : undefined,
    p_note: v.note || undefined,
  })

  switch (interpret('admin_create_code', data, error)) {
    case 'created':
      refresh()
      return { success: `Code „${v.code}“ für ${PRODUCT_LABELS[v.productKey]} angelegt.` }
    case 'duplicate_code':
      // Der Unique-Index liegt auf `lower(code)` OHNE product_key — Codes sind also GLOBAL
      // eindeutig, nicht je Produkt. Das muss dastehen: sonst liest sich die Ablehnung eines
      // Codes, den es „nur beim anderen Produkt" gibt, wie ein Fehler statt wie die Regel.
      return {
        fieldErrors: {
          code:
            'Diesen Code gibt es schon. Codes sind über ALLE Produkte hinweg eindeutig — ' +
            'Groß-/Kleinschreibung zählt dabei nicht.',
        },
        values: raw,
      }
    case 'invalid_code':
      return { fieldErrors: { code: 'Der Code darf keine Leerzeichen enthalten.' }, values: raw }
    case 'invalid_max_redemptions':
      return {
        fieldErrors: { maxRedemptions: 'Mindestens 1 — oder leer für unbegrenzt.' },
        values: raw,
      }
    case 'missing_fields':
      return { fieldErrors: { code: 'Bitte einen Code angeben.' }, values: raw }
    case 'forbidden':
      return { formError: FORBIDDEN, values: raw }
    default:
      return { formError: GENERIC, values: raw }
  }
}

export async function setCodeActiveAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const parsed = toggleSchema.safeParse({
    id: String(formData.get('id') ?? ''),
    isActive: formData.get('isActive') === 'true',
  })
  if (!parsed.success) return { formError: GENERIC }

  const supabase = await sessionClient()
  if (!supabase) return { formError: FORBIDDEN }

  const { data, error } = await supabase.rpc('admin_set_code_active', {
    p_code_id: parsed.data.id,
    p_is_active: parsed.data.isActive,
  })

  switch (interpret('admin_set_code_active', data, error)) {
    case 'ok':
      refresh()
      return { success: parsed.data.isActive ? 'Code aktiviert.' : 'Code deaktiviert.' }
    case 'not_found':
      return { formError: 'Diesen Code gibt es nicht mehr.' }
    case 'forbidden':
      return { formError: FORBIDDEN }
    default:
      return { formError: GENERIC }
  }
}

/**
 * Abmelden aus dem Admin-Bereich (B17) — dieselbe Sitzung, dieselbe Abmeldung, anderes Ziel.
 *
 * ── WARUM NICHT `signOutAction` AUS `lib/auth/actions.ts` ────────────────────────────────────────
 * Sie tut fachlich dasselbe (`supabase.auth.signOut()`), leitet aber über `redirectToLocalized` auf
 * die Startseite. Beides passt hier nicht: Das Ziel ist der Admin-Eingang, und der liegt AUSSERHALB
 * der Sprach-Struktur — `redirectToLocalized` schickte ihn durch `getPathname`, das bei einer
 * zweiten Sprache `/en/admin/anmelden` erzeugte, eine Route, die es nicht gibt (dieselbe
 * Überlegung, aus der `components/admin/nav.tsx` `next/link` statt des locale-bewussten Links
 * benutzt). Deshalb hier der schlichte `redirect` mit dem wörtlichen Pfad.
 *
 * Das ist KEIN zweiter Abmeldeweg im Sinne eines zweiten Auth-Systems: es gibt weiterhin genau eine
 * Sitzung und genau einen Aufruf, der sie beendet. Verschieden ist allein, wohin der Nutzer danach
 * geschickt wird — und ein Admin, der sich abmeldet, gehört an seinen Eingang zurück und nicht auf
 * die Marketing-Startseite.
 */
export async function adminSignOutAction(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect(ADMIN_ANMELDEN_HREF)
}
