'use server'

/**
 * Server Actions des Abschnitts „Batteriespeicher" (K1) — die Anwendungsseite der sieben
 * K1-Wrapper.
 *
 * ── KEIN `service_role`, UND DAS IST EINE ABWEICHUNG VOM TARIF-MUSTER ─────────────────────────
 * Die beiden Tarif-Pflegewege (`grid-tariffs-actions.ts`, `retail-tariffs-actions.ts`) schreiben
 * über den service_role-Client, weil ihre Tabellen für `authenticated` bewusst kein Schreibrecht
 * haben und die Funktionen SECURITY INVOKER sind — die Rollenprüfung liegt dort im
 * Anwendungscode. Migration 20260828090000 nennt das ausdrücklich „die einzige Stelle des Systems,
 * an der das so ist".
 *
 * Hier trägt diese Begründung nicht: `public.battery_catalog` gibt dem angemeldeten Client nur die
 * AKTIVEN Zeilen frei (die Policy hat eine Bedingung), der Admin braucht also ohnehin einen
 * geprüften Leseweg — und der Einkaufspreis liegt in `platform` und verlangt zwingend einen
 * SECURITY-DEFINER-Wrapper. Beides zusammen macht den Umweg über `service_role` nicht nur
 * überflüssig, sondern zu einer zweiten Ausnahme derselben Art. Die Wrapper prüfen
 * `platform.is_admin()` INTERN als erste Anweisung; ein Fehler in dieser Datei kann keinem
 * Nicht-Admin Schreibzugriff verschaffen. Die `no-restricted-imports`-Erlaubnisliste in der
 * root-`eslint.config.mjs` ist deshalb NICHT angefasst.
 *
 * ── DIE WRAPPER WERFEN (42501), STATT LEER ZU ANTWORTEN ───────────────────────────────────────
 * Wie alle admin_*-Wrapper seit B1-1: „kein Zugriff" darf sich nie als „keine Geräte" lesen lassen.
 * supabase-js liefert das als `error`, nicht als `data` — `interpret` unterscheidet deshalb den
 * Berechtigungsfehler vom Betriebsproblem.
 */
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { BATTERY_CATALOG_HREF, batteryEngineFieldLabel } from './battery-catalog'
import {
  batteryCatalogSchema,
  batteryPurchasePriceSchema,
  readBatteryCatalogForm,
  readBatteryPurchasePriceForm,
} from './battery-catalog-schema'
import { toFieldErrors, type AdminState } from './schema'

const FORBIDDEN = 'Keine Berechtigung. Bitte laden Sie die Seite neu.'
const GENERIC = 'Das hat nicht geklappt. Bitte versuchen Sie es erneut.'
const GONE = 'Dieses Gerät gibt es nicht (mehr).'

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

type Interpreted = { status: string; payload: Record<string, unknown> } | null

function interpret(fn: string, data: unknown, error: unknown): Interpreted {
  if (error) {
    if (isForbidden(error)) return { status: 'forbidden', payload: {} }
    console.error(`[admin/battery-catalog] ${fn}:`, error)
    return null
  }
  const payload = (data ?? {}) as Record<string, unknown>
  const status = payload.status
  if (typeof status !== 'string') {
    console.error(`[admin/battery-catalog] ${fn}: unerwartete Antwort`, data)
    return null
  }
  return { status, payload }
}

/** Die Antworten, die jeder schreibende Wrapper gleich beantwortet. */
function commonFailure(status: string, values?: Record<string, string>): AdminState | null {
  switch (status) {
    case 'forbidden':
      return { formError: FORBIDDEN, values }
    case 'not_found':
      return { formError: GONE, values }
    case 'missing_fields':
      return { formError: 'Bitte Kategorie, Hersteller und Bezeichnung angeben.', values }
    case 'invalid_kategorie':
      return { formError: 'Bitte Heim- oder Gewerbespeicher wählen.', values }
    case 'invalid_control_type':
      return { formError: 'Bitte statisch oder dynamisch wählen.', values }
    case 'duplicate_memodo_id':
      return {
        fieldErrors: {
          memodoId:
            'Diese Memodo-Nummer ist bereits an einem anderen Gerät hinterlegt. Sie ist die ' +
            'Kennung, über die ein späterer Import dieselbe Zeile wiederfindet — zwei Geräte ' +
            'können sie nicht teilen.',
        },
        values,
      }
    case 'invalid_values':
      return {
        formError:
          'Mindestens ein Wert liegt ausserhalb dessen, was die Datenbank zulässt (Kapazität, ' +
          'Leistung und Preis müssen grösser als 0 sein, der Wirkungsgrad zwischen 0 und 1). ' +
          'Ist das Gerät bereits freigegeben, kann ihm ausserdem kein Pflichtwert genommen werden.',
        values,
      }
    default:
      return null
  }
}

/**
 * Die 18 Katalog-Parameter, aus einer geprüften Eingabe.
 *
 * ⚠ Ein nicht gesetztes Feld wird als `undefined` übergeben und damit gar nicht mitgeschickt
 * (`JSON.stringify` lässt es weg). In der Datenbank greift dann der Vorgabewert — und der ist bei
 * JEDEM dieser Parameter `null`. Genau das ist die „leer heisst löschen"-Regel von
 * `admin_update_battery`; ein `null` an dieser Stelle täte dasselbe, wäre aber nicht der Typ, den
 * der erzeugte Client-Contract führt (Muster `text()` in `partners-actions.ts`).
 */
function catalogParams(input: ReturnType<typeof batteryCatalogSchema.parse>) {
  return {
    p_kategorie: input.kategorie,
    p_hersteller: input.hersteller,
    p_bezeichnung: input.bezeichnung,
    p_memodo_id: input.memodoId ?? undefined,
    p_usable_capacity_kwh: input.usableCapacityKwh ?? undefined,
    p_max_power_kw: input.maxPowerKw ?? undefined,
    p_round_trip_efficiency: input.roundTripEfficiency ?? undefined,
    p_list_price_net: input.listPriceNet ?? undefined,
    p_inverter_included: input.inverterIncluded ?? undefined,
    p_extra_inverter_cost_net: input.extraInverterCostNet ?? undefined,
    p_requires_foundation: input.requiresFoundation ?? undefined,
    p_foundation_cost_net: input.foundationCostNet ?? undefined,
    p_installation_cost_net: input.installationCostNet ?? undefined,
    p_price_as_of: input.priceAsOf ?? undefined,
    p_source_url: input.sourceUrl ?? undefined,
    p_datasheet_url: input.datasheetUrl ?? undefined,
    p_control_type: input.controlType ?? undefined,
    p_notes: input.notes ?? undefined,
  }
}

function formValues(formData: FormData): Record<string, string> {
  return Object.fromEntries(
    [...formData.entries()]
      .filter(([, v]) => typeof v === 'string')
      .map(([k, v]) => [k, String(v)]),
  )
}

// ── Anlegen ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Legt ein Gerät an — IMMER inaktiv. Das Freigeben ist ein eigener Schritt mit eigener Prüfung;
 * `admin_create_battery` hat dafür gar keinen Parameter.
 */
export async function createBatteryAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const values = formValues(formData)

  const parsed = batteryCatalogSchema.safeParse(readBatteryCatalogForm(formData))
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error.issues), values }

  const supabase = await sessionClient()
  if (!supabase) return { formError: FORBIDDEN, values }

  const { data, error } = await supabase.rpc('admin_create_battery', catalogParams(parsed.data))
  const result = interpret('admin_create_battery', data, error)
  if (!result) return { formError: GENERIC, values }

  if (result.status === 'created') {
    revalidatePath(BATTERY_CATALOG_HREF)
    return {
      success:
        `„${parsed.data.hersteller} ${parsed.data.bezeichnung}" angelegt — noch nicht freigegeben. ` +
        'Der Rechner sieht das Gerät erst, wenn alle Kenndaten stehen und es aktiviert wurde.',
      /*
       * Die Eingaben fahren auch im Erfolgsfall mit: Das Formular ersetzt sich danach durch eine
       * Anzeige dessen, was angelegt wurde, und die Felder sind dort unkontrolliert. Dieselbe
       * Entscheidung wie bei den beiden Tarif-Formularen.
       */
      values,
    }
  }

  return commonFailure(result.status, values) ?? { formError: GENERIC, values }
}

// ── Bearbeiten ───────────────────────────────────────────────────────────────────────────────────

/**
 * Schreibt ein Gerät vollständig neu.
 *
 * ⚠ Ein geleertes Feld LÖSCHT den Wert — der Wrapper deutet `null` als Löschen, nicht als
 * „unberührt lassen" (Gegenteil von `capture_lead`). Das ist hier richtig, weil dieses Formular
 * jedes Feld mitschickt: Was leer abgeschickt wird, ist eine Aussage.
 */
export async function updateBatteryAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const values = formValues(formData)
  const id = String(formData.get('id') ?? '')
  if (!id) return { formError: GONE, values }

  const parsed = batteryCatalogSchema.safeParse(readBatteryCatalogForm(formData))
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error.issues), values }

  const supabase = await sessionClient()
  if (!supabase) return { formError: FORBIDDEN, values }

  const { data, error } = await supabase.rpc('admin_update_battery', {
    p_id: id,
    ...catalogParams(parsed.data),
  })
  const result = interpret('admin_update_battery', data, error)
  if (!result) return { formError: GENERIC, values }

  if (result.status === 'updated') {
    revalidatePath(BATTERY_CATALOG_HREF)
    revalidatePath(`${BATTERY_CATALOG_HREF}/${id}`)
    return { success: 'Gespeichert.', values }
  }

  return commonFailure(result.status, values) ?? { formError: GENERIC, values }
}

// ── Freigeben / zurücknehmen ─────────────────────────────────────────────────────────────────────

/**
 * Gibt ein Gerät für den Rechner frei oder nimmt es zurück.
 *
 * ── ⚠ DIE VOLLSTÄNDIGKEITSPRÜFUNG PASSIERT IN DER DATENBANK, NICHT HIER ───────────────────────
 * Der Wrapper vergleicht die Zeile gegen dieselbe Bedingung, die als CHECK
 * `battery_catalog_active_complete` auf der Tabelle steht, und BENENNT die fehlenden Felder. Diese
 * Action übersetzt die Spaltennamen nur in Sätze. Sie prüft absichtlich nicht selbst vor: eine
 * zweite Formulierung derselben Regel liefe beim nächsten Umbau auseinander, und die hier wäre die
 * unverbindlichere von beiden.
 */
export async function setBatteryActiveAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const id = String(formData.get('id') ?? '')
  const active = String(formData.get('active') ?? '') === 'true'
  if (!id) return { formError: GONE }

  const supabase = await sessionClient()
  if (!supabase) return { formError: FORBIDDEN }

  const { data, error } = await supabase.rpc('admin_set_battery_active', {
    p_id: id,
    p_active: active,
  })
  const result = interpret('admin_set_battery_active', data, error)
  if (!result) return { formError: GENERIC }

  switch (result.status) {
    case 'activated':
      revalidatePath(BATTERY_CATALOG_HREF)
      revalidatePath(`${BATTERY_CATALOG_HREF}/${id}`)
      return { success: 'Freigegeben — der Rechner nimmt das Gerät ab sofort in die Auswahl.' }
    case 'deactivated':
      revalidatePath(BATTERY_CATALOG_HREF)
      revalidatePath(`${BATTERY_CATALOG_HREF}/${id}`)
      return { success: 'Zurückgenommen — das Gerät steht in keiner Empfehlung mehr.' }
    case 'incomplete': {
      const missing = Array.isArray(result.payload.missing)
        ? (result.payload.missing as string[]).map(batteryEngineFieldLabel)
        : []
      return {
        formError:
          'Noch nicht freigebbar — es fehlt: ' +
          (missing.length > 0 ? missing.join(', ') : 'mindestens eine Kenngrösse') +
          '. Ohne diese Werte kann die Engine das Gerät weder simulieren noch seine ' +
          'Wirtschaftlichkeit rechnen.',
      }
    }
    default:
      return commonFailure(result.status) ?? { formError: GENERIC }
  }
}

// ── Löschen ──────────────────────────────────────────────────────────────────────────────────────

export async function deleteBatteryAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const id = String(formData.get('id') ?? '')
  if (!id) return { formError: GONE }

  const supabase = await sessionClient()
  if (!supabase) return { formError: FORBIDDEN }

  const { data, error } = await supabase.rpc('admin_delete_battery', { p_id: id })
  const result = interpret('admin_delete_battery', data, error)
  if (!result) return { formError: GENERIC }

  if (result.status === 'deleted') {
    revalidatePath(BATTERY_CATALOG_HREF)
    return { success: 'Gerät entfernt.' }
  }

  return commonFailure(result.status) ?? { formError: GENERIC }
}

// ── Einkaufspreis ────────────────────────────────────────────────────────────────────────────────

/**
 * Setzt den Netto-Einkaufspreis eines Geräts oder entfernt ihn (leeres Preisfeld).
 *
 * ⚠ Er liegt in `platform.battery_purchase_prices` — einer Tabelle, die für KEINE Rolle ein Grant
 * hat. Aus Listen- und Einkaufspreis ergibt sich die Marge, und der öffentliche Rechner liest den
 * Katalog im Browser des Kunden; eine Spalte in `public.battery_catalog` führe über ein
 * `select *` mit, auch wenn keine Oberfläche sie rendert.
 */
export async function setBatteryPurchasePriceAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const values = formValues(formData)
  const id = String(formData.get('id') ?? '')
  if (!id) return { formError: GONE, values }

  const parsed = batteryPurchasePriceSchema.safeParse(readBatteryPurchasePriceForm(formData))
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error.issues), values }

  const supabase = await sessionClient()
  if (!supabase) return { formError: FORBIDDEN, values }

  const { data, error } = await supabase.rpc('admin_set_battery_purchase_price', {
    p_battery_id: id,
    p_purchase_price_net: parsed.data.purchasePriceNet ?? undefined,
    p_as_of: parsed.data.purchasePriceAsOf ?? undefined,
  })
  const result = interpret('admin_set_battery_purchase_price', data, error)
  if (!result) return { formError: GENERIC, values }

  switch (result.status) {
    case 'saved':
      revalidatePath(BATTERY_CATALOG_HREF)
      revalidatePath(`${BATTERY_CATALOG_HREF}/${id}`)
      return { success: 'Einkaufspreis gespeichert.', values }
    case 'cleared':
      revalidatePath(BATTERY_CATALOG_HREF)
      revalidatePath(`${BATTERY_CATALOG_HREF}/${id}`)
      return { success: 'Einkaufspreis entfernt.', values }
    case 'missing_fields':
      return {
        fieldErrors: { purchasePriceAsOf: 'Bitte angeben, wann dieser Einkaufspreis galt.' },
        values,
      }
    default:
      return commonFailure(result.status, values) ?? { formError: GENERIC, values }
  }
}
