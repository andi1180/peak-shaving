'use server'

/**
 * Server Actions der Kostenbausteine (K1b) — die Anwendungsseite der fünf
 * admin_*_cost_component-Wrapper.
 *
 * Kein `service_role`, aus demselben Grund wie im Katalog (s. `battery-catalog-actions.ts`): die
 * Wrapper prüfen `platform.is_admin()` INTERN als erste Anweisung und WERFEN bei fehlender Rolle
 * (42501) statt leer zu antworten — „kein Zugriff" darf sich nie als „keine Bausteine" lesen.
 */
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { BATTERY_CATALOG_HREF } from './battery-catalog'
import { COST_COMPONENTS_HREF } from './cost-components'
import { costComponentSchema, readCostComponentForm } from './cost-components-schema'
import { toFieldErrors, type AdminState } from './schema'

const FORBIDDEN = 'Keine Berechtigung. Bitte laden Sie die Seite neu.'
const GENERIC = 'Das hat nicht geklappt. Bitte versuchen Sie es erneut.'
const GONE = 'Diesen Kostenbaustein gibt es nicht (mehr).'

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

function interpret(fn: string, data: unknown, error: unknown) {
  if (error) {
    if (isForbidden(error)) return { status: 'forbidden' as const }
    console.error(`[admin/cost-components] ${fn}:`, error)
    return null
  }
  const payload = (data ?? {}) as Record<string, unknown>
  if (typeof payload.status !== 'string') {
    console.error(`[admin/cost-components] ${fn}: unerwartete Antwort`, data)
    return null
  }
  return { status: payload.status }
}

function values(formData: FormData): Record<string, string> {
  return Object.fromEntries(
    [...formData.entries()].filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, String(v)]),
  )
}

/**
 * Beide Seiten neu laden: ein geänderter Bausteinpreis entscheidet darüber, ob ein GERÄT
 * freigegeben werden kann — die Geräteliste zeigt das an und wäre sonst veraltet.
 */
function revalidateBoth() {
  revalidatePath(COST_COMPONENTS_HREF)
  revalidatePath(BATTERY_CATALOG_HREF)
}

function commonFailure(status: string, v?: Record<string, string>): AdminState | null {
  switch (status) {
    case 'forbidden':
      return { formError: FORBIDDEN, values: v }
    case 'not_found':
      return { formError: GONE, values: v }
    case 'missing_fields':
      return { formError: 'Bitte Art und Bezeichnung angeben.', values: v }
    case 'invalid_art':
      return { formError: 'Bitte Fundament oder Installation wählen.', values: v }
    case 'invalid_price':
      return { formError: 'Der Preis kann nicht negativ sein.', values: v }
    default:
      return null
  }
}

export async function createCostComponentAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const v = values(formData)
  const parsed = costComponentSchema.safeParse(readCostComponentForm(formData))
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error.issues), values: v }

  const supabase = await sessionClient()
  if (!supabase) return { formError: FORBIDDEN, values: v }

  const { data, error } = await supabase.rpc('admin_create_cost_component', {
    p_art: parsed.data.art,
    p_bezeichnung: parsed.data.bezeichnung,
    p_beschreibung: parsed.data.beschreibung ?? undefined,
    p_price_net: parsed.data.priceNet ?? undefined,
    p_price_as_of: parsed.data.priceAsOf ?? undefined,
    p_notes: parsed.data.notes ?? undefined,
  })
  const result = interpret('admin_create_cost_component', data, error)
  if (!result) return { formError: GENERIC, values: v }

  if (result.status === 'created') {
    revalidateBoth()
    return { success: `„${parsed.data.bezeichnung}" angelegt.` }
  }
  return commonFailure(result.status, v) ?? { formError: GENERIC, values: v }
}

export async function updateCostComponentAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const v = values(formData)
  const id = String(formData.get('id') ?? '')
  const parsed = costComponentSchema.safeParse(readCostComponentForm(formData))
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error.issues), values: v }

  const supabase = await sessionClient()
  if (!supabase) return { formError: FORBIDDEN, values: v }

  const { data, error } = await supabase.rpc('admin_update_cost_component', {
    p_id: id,
    p_art: parsed.data.art,
    p_bezeichnung: parsed.data.bezeichnung,
    p_beschreibung: parsed.data.beschreibung ?? undefined,
    p_price_net: parsed.data.priceNet ?? undefined,
    p_price_as_of: parsed.data.priceAsOf ?? undefined,
    p_notes: parsed.data.notes ?? undefined,
  })
  const result = interpret('admin_update_cost_component', data, error)
  if (!result) return { formError: GENERIC, values: v }

  if (result.status === 'updated') {
    revalidateBoth()
    return { success: 'Gespeichert.' }
  }
  /*
   * ⚠ `in_use` deckt ZWEI Abweisungen desselben Triggers ab: den entzogenen Preis und den
   * gewechselten Art. Beide sagen dasselbe — der Baustein wird bereits benutzt — und beide werden
   * nicht hier entschieden, sondern in der Datenbank, auch gegen `service_role`.
   */
  if (result.status === 'in_use') {
    return {
      formError:
        'Dieser Baustein wird bereits von Geräten genutzt: Solange ein freigegebenes Gerät daran ' +
        'hängt, kann der Preis nicht entfallen, und die Art kann gar nicht wechseln. Nehmen Sie ' +
        'zuerst die Freigabe der betroffenen Geräte zurück.',
      values: v,
    }
  }
  return commonFailure(result.status, v) ?? { formError: GENERIC, values: v }
}

export async function deleteCostComponentAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const id = String(formData.get('id') ?? '')

  const supabase = await sessionClient()
  if (!supabase) return { formError: FORBIDDEN }

  const { data, error } = await supabase.rpc('admin_delete_cost_component', { p_id: id })
  const result = interpret('admin_delete_cost_component', data, error)
  if (!result) return { formError: GENERIC }

  if (result.status === 'deleted') {
    revalidateBoth()
    return { success: 'Kostenbaustein gelöscht.' }
  }
  if (result.status === 'in_use') {
    return {
      formError:
        'Dieser Baustein ist Geräten zugeordnet und kann deshalb nicht gelöscht werden. Lösen ' +
        'Sie zuerst die Zuordnungen im jeweiligen Gerät.',
    }
  }
  return commonFailure(result.status) ?? { formError: GENERIC }
}
