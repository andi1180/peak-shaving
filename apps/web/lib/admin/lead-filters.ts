/**
 * Die Filter der Lead-Sicht als EIN Vokabular (B2-1).
 *
 * REIN: kein `server-only`, kein `next/*`, keine Datenbank — die Lead-Liste (Server Component), die
 * Export-Route (Route Handler) und der Export-Link im Formular lesen alle von hier.
 *
 * ── WARUM DAS EIN EIGENES MODUL IST ──────────────────────────────────────────────────────────────
 * Der Export übernimmt die Filter aus der Anfrage — dieselben, die die Sicht gerade zeigt. Stünden
 * die Parameternamen an zwei Stellen (einmal in der Seite, einmal in der Route), reichte ein
 * Tippfehler in einem Namen, damit die ausgeführte Datei EINE Einschränkung weniger enthält als die
 * Sicht, aus der sie ausgelöst wurde. Sichtbar wäre das nur an der Zeilenzahl — und die liest
 * niemand gegen. Ein Filter, der still wegfällt, ist beim Export der teuerste aller stillen Fehler.
 *
 * ── ES GIBT KEINEN „OHNE FILTER"-ZUSTAND ─────────────────────────────────────────────────────────
 * Eine leere Filtermenge ist der Filter „alles" und wird als solcher übergeben und protokolliert
 * (platform.lead_filter_summary). Es gibt bewusst keinen Schalter, der die Filter für den Export
 * umgeht.
 */

import { INDUSTRIES, type ConsentPurpose, type Industry } from './leads'

/** Wie die Filter in der URL heissen. Deutsche Schlüssel — die Routen sind es auch. */
export const FILTER_PARAMS = [
  'status',
  'quelle',
  'zweck',
  'einwilligung',
  'suche',
  'faellig',
  'branche',
  'messart',
  'plz',
  'verbrauch-ab',
  'verbrauch-bis',
  'vertragsende-ab',
  'vertragsende-bis',
  // B18-5. Deutscher Schlüssel wie die übrigen, WERTE aber englisch (`assigned`/`unassigned`) —
  // in diesem System sind Filterwerte durchgehend Datenbankwerte (`new`, `confirmed`,
  // `netzebene_7`), und eine deutsche Wertemenge wäre der erste Fundort einer zweiten Konvention.
  'partner',
] as const

export type FilterParam = (typeof FILTER_PARAMS)[number]

/** Rohform einer Anfrage: `searchParams` einer Seite oder `URLSearchParams` einer Route. */
export type RawQuery = { [key: string]: string | string[] | undefined }

/**
 * Die drei Zustände des Partner-Filters (B18-5).
 *
 * `''` ist KEIN eigener Wert, sondern die Abwesenheit des Filters — dieselbe Konvention wie bei
 * Status, Branche und Messart. Die zwei gesetzten Werte sind die der Datenbank
 * (`p_partner_assignment`), damit der Filter nirgends übersetzt werden muss: eine Abbildung
 * deutsch→englisch wäre eine zweite Stelle, an der ein unbekannter Wert still zu „kein Filter"
 * werden könnte, und genau das darf hier nicht passieren (s. `filterRpcArgs`).
 */
export const PARTNER_ASSIGNMENTS = ['assigned', 'unassigned'] as const
export type PartnerAssignment = (typeof PARTNER_ASSIGNMENTS)[number]

export type LeadFilters = {
  status: string
  sourceKey: string
  consentPurpose: string
  consentStatus: string
  search: string
  dueOnly: boolean
  industry: string
  meteringType: string
  postalPrefix: string
  consumptionMin: string
  consumptionMax: string
  contractEndFrom: string
  contractEndTo: string
  /** '' = alle · 'assigned' = nur mit Fachbetrieb · 'unassigned' = nur ohne (B18-5). */
  partnerAssignment: string
}

export const EMPTY_FILTERS: LeadFilters = {
  status: '',
  sourceKey: '',
  consentPurpose: '',
  consentStatus: '',
  search: '',
  dueOnly: false,
  industry: '',
  meteringType: '',
  postalPrefix: '',
  consumptionMin: '',
  consumptionMax: '',
  contractEndFrom: '',
  contractEndTo: '',
  partnerAssignment: '',
}

function one(query: RawQuery, name: FilterParam): string {
  const value = query[name]
  return typeof value === 'string' ? value.trim() : ''
}

export function readFilters(query: RawQuery): LeadFilters {
  return {
    status: one(query, 'status'),
    sourceKey: one(query, 'quelle'),
    consentPurpose: one(query, 'zweck'),
    consentStatus: one(query, 'einwilligung'),
    search: one(query, 'suche'),
    dueOnly: one(query, 'faellig') === '1',
    industry: one(query, 'branche'),
    meteringType: one(query, 'messart'),
    postalPrefix: one(query, 'plz'),
    consumptionMin: one(query, 'verbrauch-ab'),
    consumptionMax: one(query, 'verbrauch-bis'),
    contractEndFrom: one(query, 'vertragsende-ab'),
    contractEndTo: one(query, 'vertragsende-bis'),
    partnerAssignment: one(query, 'partner'),
  }
}

/** Genau die gesetzten Filter als Query-String — Grundlage für Seitenwechsel UND Export-Link. */
export function filterSearchParams(filters: LeadFilters): URLSearchParams {
  const sp = new URLSearchParams()
  if (filters.status) sp.set('status', filters.status)
  if (filters.sourceKey) sp.set('quelle', filters.sourceKey)
  if (filters.consentPurpose) sp.set('zweck', filters.consentPurpose)
  if (filters.consentStatus) sp.set('einwilligung', filters.consentStatus)
  if (filters.search) sp.set('suche', filters.search)
  if (filters.dueOnly) sp.set('faellig', '1')
  if (filters.industry) sp.set('branche', filters.industry)
  if (filters.meteringType) sp.set('messart', filters.meteringType)
  if (filters.postalPrefix) sp.set('plz', filters.postalPrefix)
  if (filters.consumptionMin) sp.set('verbrauch-ab', filters.consumptionMin)
  if (filters.consumptionMax) sp.set('verbrauch-bis', filters.consumptionMax)
  if (filters.contractEndFrom) sp.set('vertragsende-ab', filters.contractEndFrom)
  if (filters.contractEndTo) sp.set('vertragsende-bis', filters.contractEndTo)
  if (filters.partnerAssignment) sp.set('partner', filters.partnerAssignment)
  return sp
}

export function hasAnyFilter(filters: LeadFilters): boolean {
  return filterSearchParams(filters).toString().length > 0
}

/** Ganzzahl oder `undefined` — ein unlesbarer Wert wird nicht zu 0 (das wäre ein echter Filter). */
function intOrUndefined(value: string): number | undefined {
  if (!value) return undefined
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Datum im Format „YYYY-MM-DD" (das, was `<input type="date">` liefert) — alles andere wird
 * verworfen statt an Postgres weitergereicht: ein unparsbares Datum wäre dort ein harter Fehler und
 * die ganze Seite eine Fehlermeldung, obwohl nur ein Feld unsinnig ist.
 */
function dateOrUndefined(value: string): string | undefined {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined
}

/**
 * Nur bekannte Branchen werden weitergereicht.
 *
 * Grund ist nicht Bequemlichkeit: `platform.industry` ist ein Postgres-ENUM, ein unbekannter Wert
 * scheitert schon beim Casten der Argumente — also mit einem Datenbankfehler statt mit der
 * `invalid_filter`-Antwort, die die anderen Filter für genau diesen Fall haben. Der Abgleich hier
 * stellt die einheitliche Behandlung her, ohne die Datenbank als Grenze aufzuweichen.
 */
function industryOrUndefined(value: string): Industry | undefined {
  return (INDUSTRIES as readonly string[]).includes(value) ? (value as Industry) : undefined
}

/**
 * Die Filter als RPC-Argumente — GENAU EINMAL geschrieben, benutzt von `admin_list_leads` (dort um
 * limit/offset ergänzt) und von `admin_export_leads`. Ein unbekannter Wert bei Status, Messart,
 * PLZ-Präfix oder Partner-Zuordnung wandert bewusst UNVERÄNDERT weiter: die Datenbank lehnt ihn als
 * `invalid_filter` ab und sagt welchen — still zu bereinigen hiesse, ein ungefiltertes Ergebnis für
 * gefiltert zu halten.
 *
 * Genau deshalb ist `p_partner_assignment` in der Datenbank ein `text` mit zwei erlaubten Literalen
 * und kein dreiwertiger `boolean` (B18-5): auf `boolean` abgebildet könnte ein unbekannter Wert nur
 * zu `undefined` werden — also zu „kein Filter" —, und der Admin bekäme den vollen Bestand und
 * hielte ihn für die gefilterte Teilmenge.
 */
export function filterRpcArgs(filters: LeadFilters) {
  return {
    p_status: filters.status || undefined,
    p_source_key: filters.sourceKey || undefined,
    /*
     * Der Zweck ist ein Postgres-ENUM, supabase-js erwartet dafür die Literal-Union. Sie kommt aus
     * `./leads` und wird hier NICHT ein zweites Mal aufgezählt: eine eigene Liste hätte den seit
     * B18-6 vierten Wert (`partner_lead_disclosure`) nicht mitbekommen, und die Zuweisung ist eine
     * Typzusicherung — der Typfehler wäre also gar nicht aufgefallen, nur der Filter hätte an einer
     * Stelle gefehlt, die niemand ansieht.
     */
    p_consent_purpose: (filters.consentPurpose || undefined) as ConsentPurpose | undefined,
    p_consent_status: filters.consentStatus || undefined,
    p_search: filters.search || undefined,
    p_due_only: filters.dueOnly,
    p_industry: industryOrUndefined(filters.industry),
    p_metering_type: filters.meteringType || undefined,
    p_postal_prefix: filters.postalPrefix || undefined,
    p_consumption_min: intOrUndefined(filters.consumptionMin),
    p_consumption_max: intOrUndefined(filters.consumptionMax),
    p_contract_end_from: dateOrUndefined(filters.contractEndFrom),
    p_contract_end_to: dateOrUndefined(filters.contractEndTo),
    p_partner_assignment: filters.partnerAssignment || undefined,
  }
}
