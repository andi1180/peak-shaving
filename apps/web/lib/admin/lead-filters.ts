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

import {
  isLeadSourceCategory,
  sourceKeysForCategories,
  type LeadSourceCategory,
} from './lead-source-categories'
import { INDUSTRIES, type Industry } from './leads'

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
  // ── Die Spaltenfilter ──────────────────────────────────────────────────────────────────────────
  // Ein Parameter je SPALTE, benannt wie die Spalte. Wer die Adresse liest, soll die Sicht
  // rekonstruieren können, ohne den Code zu kennen.
  'firma',
  'vorname',
  'nachname',
  'mail',
  'telefon',
  'zuordnung',
  'herkunft',
  'thema',
  'thema-leer',
  'von',
  'bis',
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

/**
 * Die drei Zustände als AUSWAHL, nicht mehr als Reiterleiste.
 *
 * ── WAS SICH GEGENÜBER B18-5 GEÄNDERT HAT, UND WAS NICHT ─────────────────────────────────────────
 * Bis hierher waren das drei Reiter über der Liste. Die Reiter sind weg, die FÄHIGKEIT ist es nicht:
 * dieselben drei Zustände stehen jetzt im Filter-Popover der Zuordnungsspalte. Der leere Wert
 * bleibt der Vorgabewert und damit die Adresse, unter der der GESAMTE Bestand sichtbar ist — die
 * Grundlage der Ausfuhr „ohne Filter — also der gesamte anschreibbare Bestand" (B2-1).
 *
 * Die Beschriftungen sagen jetzt „Fachbetrieb" statt „Partner-Leads"/„Direktanfragen": Der Filter
 * greift auf `partner_slug`, also auf die bestätigte ZUORDNUNG — und in derselben Spalte steht seit
 * dieser Runde auch die formlos genannte Firma und der „empfohlen von"-Freitext. „Direktanfragen"
 * über einer Zeile, die einen Firmennamen zeigt, wäre genau die Falschbeschriftung, gegen die B18-5
 * seinen Filter als `text` mit zwei Literalen gebaut hat.
 */
export const PARTNER_ASSIGNMENT_LABELS: Record<PartnerAssignment, string> = {
  assigned: 'nur mit Fachbetrieb',
  unassigned: 'nur ohne Fachbetrieb',
}

export type LeadFilters = {
  status: string
  sourceKey: string
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
  // ── Die Spaltenfilter ──────────────────────────────────────────────────────────────────────────
  /** Die sechs Textspalten. Substring-Suche, je Spalte einzeln. */
  email: string
  company: string
  firstName: string
  lastName: string
  phone: string
  assignment: string
  /** Die drei Anzeige-Kategorien der Herkunft (nicht die 15 Schlüssel). */
  sourceCategories: LeadSourceCategory[]
  /** Themen-SCHLÜSSEL (`peakShaving`, …) — das Label steht in `messages/de.json`. */
  themaKeys: string[]
  /** „ohne Thema" als eigener Zustand: `thema is null` ist eine Aussage, kein fehlender Filter. */
  themaNone: boolean
  /**
   * Einwilligungen als MEHRFACHauswahl. Die früheren Einzelwerte (`?zweck=`/`?einwilligung=`)
   * werden weiterhin gelesen und landen als einelementige Liste hier — eine gespeicherte Adresse
   * aus der Zeit vor den Spaltenfiltern zeigt damit unverändert dasselbe Ergebnis.
   */
  consentPurposes: string[]
  consentStates: string[]
  /** Anlagedatum, einschliessende Grenzen, „YYYY-MM-DD". */
  createdFrom: string
  createdTo: string
}

export const EMPTY_FILTERS: LeadFilters = {
  status: '',
  sourceKey: '',
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
  email: '',
  company: '',
  firstName: '',
  lastName: '',
  phone: '',
  assignment: '',
  sourceCategories: [],
  themaKeys: [],
  themaNone: false,
  consentPurposes: [],
  consentStates: [],
  createdFrom: '',
  createdTo: '',
}

function one(query: RawQuery, name: FilterParam): string {
  const value = query[name]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Ein mehrfach gesetzter Parameter (`?herkunft=partner&herkunft=admin`).
 *
 * Bewusst KEINE Komma-Trennung: ein Wert, der selbst ein Komma enthält, wäre damit nicht mehr
 * darstellbar, und die Regel „ein Parameter = ein Wert" gilt in dieser Anwendung überall sonst.
 * Leere Einträge fallen weg, Dubletten ebenfalls — eine Ankreuzliste kann denselben Wert nicht
 * zweimal meinen, und zweimal derselbe Wert im Ausfuhrprotokoll sähe aus wie ein Fehler.
 */
function many(query: RawQuery, name: FilterParam): string[] {
  const value = query[name]
  const raw = typeof value === 'string' ? [value] : Array.isArray(value) ? value : []
  return [...new Set(raw.map((v) => v.trim()).filter(Boolean))]
}

export function readFilters(query: RawQuery): LeadFilters {
  return {
    status: one(query, 'status'),
    sourceKey: one(query, 'quelle'),
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
    email: one(query, 'mail'),
    company: one(query, 'firma'),
    firstName: one(query, 'vorname'),
    lastName: one(query, 'nachname'),
    phone: one(query, 'telefon'),
    assignment: one(query, 'zuordnung'),
    /*
     * Ein unbekannter Kategoriewert wird VERWORFEN und nicht durchgereicht — der einzige Filter,
     * bei dem das richtig ist: Die Kategorien sind eine Erfindung DIESER Oberfläche, die Datenbank
     * kennt sie nicht und könnte sie folglich auch nicht als `invalid_filter` ablehnen. Was
     * ankommt, ist eine Schlüsselmenge; ein unbekannter Kategoriename hätte darin gar keine
     * Entsprechung. Verworfen wird er sichtbar: die Ankreuzliste zeigt ihn nicht als gesetzt.
     */
    sourceCategories: many(query, 'herkunft').filter(isLeadSourceCategory),
    themaKeys: many(query, 'thema'),
    themaNone: one(query, 'thema-leer') === '1',
    consentPurposes: many(query, 'zweck'),
    consentStates: many(query, 'einwilligung'),
    createdFrom: one(query, 'von'),
    createdTo: one(query, 'bis'),
  }
}

/** Genau die gesetzten Filter als Query-String — Grundlage für Seitenwechsel UND Export-Link. */
export function filterSearchParams(filters: LeadFilters): URLSearchParams {
  const sp = new URLSearchParams()
  if (filters.status) sp.set('status', filters.status)
  if (filters.sourceKey) sp.set('quelle', filters.sourceKey)
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
  if (filters.email) sp.set('mail', filters.email)
  if (filters.company) sp.set('firma', filters.company)
  if (filters.firstName) sp.set('vorname', filters.firstName)
  if (filters.lastName) sp.set('nachname', filters.lastName)
  if (filters.phone) sp.set('telefon', filters.phone)
  if (filters.assignment) sp.set('zuordnung', filters.assignment)
  for (const category of filters.sourceCategories) sp.append('herkunft', category)
  for (const key of filters.themaKeys) sp.append('thema', key)
  if (filters.themaNone) sp.set('thema-leer', '1')
  for (const purpose of filters.consentPurposes) sp.append('zweck', purpose)
  for (const state of filters.consentStates) sp.append('einwilligung', state)
  if (filters.createdFrom) sp.set('von', filters.createdFrom)
  if (filters.createdTo) sp.set('bis', filters.createdTo)
  return sp
}

/**
 * Der Filterstand mit GEÄNDERTEM Wert einer einzelnen Spalte — die Grundlage jedes Popovers und
 * jedes „Filter entfernen"-Links.
 *
 * Die SEITE hängt bewusst nicht mit dran (`filterSearchParams` führt sie ohnehin nicht): eine
 * Filteränderung ändert die Treffermenge, und „Seite 3" der einen Menge ist in der anderen entweder
 * eine andere oder gar keine. Jede Änderung führt deshalb auf Seite 1.
 */
export function withFilters(
  filters: LeadFilters,
  patch: Partial<LeadFilters>,
): URLSearchParams {
  return filterSearchParams({ ...filters, ...patch })
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
    // ── Die Spaltenfilter ────────────────────────────────────────────────────────────────────────
    // Die sechs Textfilter gehen ROH weiter — die Maskierung der LIKE-Sonderzeichen steht in der
    // Datenbank (`platform.like_pattern`), damit sie für Liste UND Ausfuhr dieselbe ist. Hier zu
    // maskieren hiesse, sie ein zweites Mal auszulegen.
    p_email: filters.email || undefined,
    p_company: filters.company || undefined,
    p_first_name: filters.firstName || undefined,
    p_last_name: filters.lastName || undefined,
    p_phone: filters.phone || undefined,
    p_assignment: filters.assignment || undefined,
    /*
     * Die drei Anzeige-Kategorien werden HIER zu Herkunftsschlüsseln aufgelöst, nicht in der
     * Datenbank: `lead_sources` ist eine Tabelle, die laufend wächst, und eine Kategorienregel dort
     * wäre eine zweite Taxonomie neben der Anzeige (ausführlich in `lead-source-categories.ts`).
     * Vollständige oder leere Auswahl ergibt `undefined` — beides heisst „keine Einschränkung", und
     * ein Filter, der alles durchlässt, gehört nicht ins Ausfuhrprotokoll.
     */
    p_source_keys: sourceKeysForCategories(filters.sourceCategories),
    p_thema_keys: filters.themaKeys.length > 0 ? filters.themaKeys : undefined,
    p_thema_none: filters.themaNone,
    /*
     * Die frühere Einzelauswahl (`p_consent_purpose`/`p_consent_status`) wird bewusst NICHT MEHR
     * gesetzt: Eine alte Adresse (`?zweck=marketing_email`) landet über `readFilters` als
     * einelementige Liste in der Mehrfachauswahl, und die Mengenform beantwortet dieselbe Frage
     * (`exists` mit `= any(...)` statt `=`). Zwei Wege für denselben Filter nebeneinander wären
     * zwei Stellen, an denen er sich ändern kann. Die Skalare bleiben in der Datenbank bestehen —
     * dort kostet ihr Verbleib nichts und ein Entfernen brauchte einen eigenen Grund.
     */
    p_consent_purposes: filters.consentPurposes.length > 0 ? filters.consentPurposes : undefined,
    p_consent_states: filters.consentStates.length > 0 ? filters.consentStates : undefined,
    p_created_from: dateOrUndefined(filters.createdFrom),
    p_created_to: dateOrUndefined(filters.createdTo),
  }
}
