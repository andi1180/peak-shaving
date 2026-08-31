/**
 * Vokabular und Zeilen-Typen des Admin-Abschnitts „Netzbetreiber-Tarife" (B21-2b).
 *
 * REIN: kein `server-only`, kein `next/*`, kein Supabase-Client — die Server-Seite liest die Typen,
 * das Client-Formular die Beschriftungen. Gleiche Aufteilung wie `lib/admin/partners.ts` (B16-2)
 * und `lib/admin/analyses.ts` (B14-2).
 *
 * ── UNTERSCHIED ZU DEN ÜBRIGEN ADMIN-ABSCHNITTEN, BEWUSST ────────────────────────────────────────
 * Dort kommt jede Zeile aus einem `admin_*`-Wrapper und ist damit `jsonb` — ein Typ im
 * Anwendungscode wäre eine BEHAUPTUNG über die Migration, und die Leser lesen entsprechend
 * defensiv. Hier liest die Seite die Tabellen `public.grid_tariffs` und
 * `public.grid_tariff_rate_windows` DIREKT über den angemeldeten Client (beide haben seit B21-1
 * `select` für `authenticated`). PostgREST liefert entweder Zeilen oder einen Fehler, und den
 * unterscheidet die Seite an `res.error` — es gibt keinen Zwischenzustand, den ein Leser abfangen
 * müsste.
 */
import { NETZBETREIBER_IDS, NETZBETREIBER_LABELS, type NetzbetreiberId } from 'shared'

/** Basispfad des Abschnitts — ohne Locale-Präfix, wie der ganze Admin-Bereich. */
export const GRID_TARIFFS_HREF = '/admin/netzbetreiber-tarife'

// ── Vokabular ────────────────────────────────────────────────────────────────────────────────────
//
// Spiegel der CHECKs aus B21-1. Als Konstanten zulässig aus demselben Grund wie `ANALYSIS_KINDS`
// (B14-2): kurze feste Listen, deren Werte im Anwendungscode eigene Bedeutung haben. Weicht eine
// Liste ab, lehnt die Datenbank den Wert ohnehin ab — die Konstante entscheidet nur, was die
// Oberfläche überhaupt anbietet.

/** Netzebenen laut CHECK `netzebene between 3 and 7`. */
export const NETZEBENEN = [3, 4, 5, 6, 7] as const
export type Netzebene = (typeof NETZEBENEN)[number]

/**
 * Die Leistungsmessungs-Variante ist laut Delta 5 **nur bei den Netzebenen relevant, die sie
 * anbieten** — nach dem Wiener-Netze-Beispiel ist das NE 7. Bei NE 3–6 steht in der Spalte `null`,
 * und genau darauf ist der `unique nulls not distinct`-Constraint aus B21-1 ausgelegt.
 *
 * Diese Liste ist deshalb keine Kosmetik der Oberfläche: Würde sie ohne Datenlage erweitert,
 * entstünden für NE 3–6 mehrere unterscheidbare Zeilen derselben Kombination — und welche in eine
 * Analyse einginge, entschiede die Sortierreihenfolge einer Abfrage.
 */
export const NETZEBENEN_MIT_MESSVARIANTE: readonly Netzebene[] = [7]

export function hasMeteringVariant(netzebene: number): boolean {
  return NETZEBENEN_MIT_MESSVARIANTE.includes(netzebene as Netzebene)
}

/** Spiegel des CHECK `metering_variant in (…)`. */
export const METERING_VARIANTS = [
  'mit_leistungsmessung',
  'ohne_leistungsmessung',
  'unterbrechbar',
] as const
export type MeteringVariant = (typeof METERING_VARIANTS)[number]

export const METERING_VARIANT_LABELS: Record<MeteringVariant, string> = {
  mit_leistungsmessung: 'mit Leistungsmessung',
  ohne_leistungsmessung: 'ohne Leistungsmessung',
  unterbrechbar: 'unterbrechbare Nutzung',
}

/**
 * Spiegel des CHECK `grundpreis_unit in (…)`.
 *
 * Der Unterschied ist fachlich tragend und nicht bloss eine Einheit am Zahlenrand:
 * `eur_per_kw_year` ist der LEISTUNGSPREIS, an dem die gesamte Peak-Shaving-Rechnung hängt;
 * `eur_per_year` ist eine Jahrespauschale und bedeutet Leistungspreis 0 €/kW·a — also den Pfad
 * ganz OHNE Spitzenkappung (Delta 3).
 */
export const GRUNDPREIS_UNITS = ['eur_per_kw_year', 'eur_per_year'] as const
export type GrundpreisUnit = (typeof GRUNDPREIS_UNITS)[number]

export const GRUNDPREIS_UNIT_LABELS: Record<GrundpreisUnit, string> = {
  eur_per_kw_year: 'EUR / kW und Jahr (Leistungspreis)',
  eur_per_year: 'EUR / Jahr (Pauschale, kein Leistungspreis)',
}

/** Spiegel des CHECK `price_basis in (…)` — Delta 6. */
export const PRICE_BASES = ['net', 'gross'] as const
export type PriceBasisValue = (typeof PRICE_BASES)[number]

export const PRICE_BASIS_LABELS: Record<PriceBasisValue, string> = {
  net: 'netto (ohne USt.)',
  gross: 'brutto (inkl. USt.)',
}

/**
 * Vorgaben des Formulars. Netzentgelte stehen laut Tarifblatt netto (Delta 6) — das ist die Lage
 * der heutigen Quellen, keine Vermutung; wer eine brutto ausgewiesene Quelle einträgt, stellt um.
 */
export const DEFAULT_PRICE_BASIS: PriceBasisValue = 'net'
export const DEFAULT_GRUNDPREIS_UNIT: GrundpreisUnit = 'eur_per_kw_year'

/**
 * Vorschläge für die Bezeichnung eines Zeitfensters. Bewusst NUR Vorschläge und kein CHECK: Delta 5
 * begründet die Kind-Tabelle gerade damit, dass ein künftiger Saisontyp (der angekündigte
 * Winter-Tarif) OHNE Migration hinzukommen soll. Eine feste Liste nähme genau das zurück.
 */
export const RATE_WINDOW_LABEL_SUGGESTIONS = ['normal', 'snap', 'winter'] as const

// ── Zeilen ───────────────────────────────────────────────────────────────────────────────────────

export type GridTariffRow = {
  id: string
  operator_id: string
  operator_name: string
  netzebene: number
  metering_variant: string | null
  grundpreis_amount: number
  grundpreis_unit: string
  netzverlust_ct_per_kwh: number
  price_basis: string
  valid_from: string
  valid_until: string | null
  created_by: string
  created_at: string
}

export type GridTariffRateWindowRow = {
  id: string
  grid_tariff_id: string
  label: string
  month_day_from: string | null
  month_day_to: string | null
  time_from: string
  time_to: string
  ct_per_kwh: number
}

/** Eine Tarifzeile mit ihren Zeitfenstern — die Einheit, in der die Seite denkt. */
export type GridTariffWithWindows = GridTariffRow & { windows: GridTariffRateWindowRow[] }

/**
 * Eine Tarifzeile ist OFFEN, solange `valid_until` nicht gesetzt ist.
 *
 * Bewusst NICHT „valid_until liegt in der Zukunft": Ein Stand, der abgelöst wurde, ist ab dem
 * Ablösetag Geschichte. Und umgekehrt ist ein Stand mit `valid_from` in der ZUKUNFT (ein bereits
 * veröffentlichtes Preisblatt fürs kommende Jahr) trotzdem der aktuelle offene Eintrag — er wird
 * nur noch nicht angewandt. „Offen" heisst: es gibt keinen Nachfolger.
 */
export function isOpen(row: GridTariffRow): boolean {
  return row.valid_until === null
}

// ── Netzbetreiber-Auswahl ────────────────────────────────────────────────────────────────────────

export type OperatorOption = { id: string; name: string }

/**
 * Die Auswahlliste des Formulars — aus ZWEI Quellen zusammengeführt, plus einem Weg für alles
 * Weitere.
 *
 * ── WARUM NICHT NUR DIE DREI AUS B11 ────────────────────────────────────────────────────────────
 * `packages/shared/src/tariff-catalog.ts` kennt drei Betreiber (`wiener_netze`, `netz_noe`,
 * `salzburg_netz`) — das ist der Stand des Kalkulator-Auswahlfelds, nicht der des Marktes. Delta 5
 * nennt ausdrücklich die 9–10 grössten österreichischen Betreiber als Ziel. Eine auf drei
 * festgenagelte Liste machte dieses Formular für genau die Betreiber unbrauchbar, für die es
 * gebaut wird.
 *
 * ── WARUM AUCH NICHT REINES FREITEXT ────────────────────────────────────────────────────────────
 * `operator_id` trägt keinen Fremdschlüssel und keinen CHECK (B21-1 hat bewusst keine Constraints
 * erfunden, die das Delta nicht vorsieht). Ein Tippfehler erzeugt deshalb keine Ablehnung, sondern
 * eine ZWEITE Betreiber-Identität: `wiener_netze` und `wienernetze` sind für den `unique`-Constraint
 * verschiedene Kombinationen, beide bleiben offen, und die Effektiv-Datierung greift zwischen ihnen
 * nie. Der Fehler fiele erst auf, wenn eine Analyse den falschen Leistungspreis zieht.
 *
 * ── DIE LÖSUNG: WAS EINMAL EINGETRAGEN WURDE, IST DANACH AUSWÄHLBAR ─────────────────────────────
 * Angeboten werden die drei bekannten Kennungen aus B11 UND jede Kennung, die bereits in
 * `grid_tariffs` steht. Ein neuer Betreiber wird also genau EINMAL von Hand eingetragen und ist von
 * da an ein Listeneintrag, der sich nicht mehr vertippen lässt.
 *
 * Der Anzeigename folgt dabei der ZULETZT gespeicherten Fassung (die Zeilen kommen absteigend nach
 * `created_at`): eine Umbenennung setzt sich damit von selbst durch, ohne dass die stabile Kennung
 * sich ändert.
 */
export function operatorOptions(existing: readonly GridTariffRow[]): OperatorOption[] {
  const byId = new Map<string, string>()

  for (const id of NETZBETREIBER_IDS) {
    byId.set(id, NETZBETREIBER_LABELS[id as NetzbetreiberId])
  }
  for (const row of existing) {
    if (!byId.has(row.operator_id)) byId.set(row.operator_id, row.operator_name)
  }

  return [...byId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de-AT'))
}

/**
 * Ordnet einen GELESENEN Betreibernamen einer bereits bekannten Kennung zu — oder keiner.
 *
 * ── ⚠ WARUM DIE ZUORDNUNG HIER GESCHIEHT UND NICHT IM MODELL ──────────────────────────────────
 * Der Tarifblatt-Scan liefert ausdrücklich nur den GEDRUCKTEN NAMEN und niemals eine Kennung. Eine
 * vom Modell erfundene `operator_id` erzeugte keine Ablehnung, sondern eine ZWEITE
 * Betreiber-Identität: `wiener_netze` und `wienernetze` sind für den `unique`-Constraint aus B21-1
 * verschiedene Kombinationen, beide blieben offen, und die Effektiv-Datierung griffe zwischen
 * ihnen nie — der Fehler fiele erst auf, wenn eine Analyse den falschen Leistungspreis zieht
 * (ausführlich im Kopf von `operatorOptions`).
 *
 * Deshalb: Findet sich der Name unter den bereits vergebenen Kennungen, wird die BESTEHENDE
 * benutzt. Findet er sich nicht, gibt es hier ausdrücklich keinen Vorschlag — die Oberfläche
 * schaltet auf „Anderer Netzbetreiber …", trägt den Namen ein und lässt das Kennungsfeld LEER.
 * Eine Kennung vergibt ein Mensch.
 *
 * Verglichen wird nachsichtig, aber nicht raten: kleingeschrieben, ohne Satzzeichen und ohne die
 * üblichen Rechtsformzusätze — „Wiener Netze GmbH" auf dem Blatt und „Wiener Netze" in der Liste
 * sind derselbe Betrieb. Ein Präfix-Vergleich in beide Richtungen fängt die Fälle ab, in denen
 * eine Seite einen Zusatz trägt, den die andere nicht kennt.
 */
export function matchOperatorByName(
  name: string | null,
  options: readonly OperatorOption[],
): OperatorOption | null {
  const needle = normalizeOperatorName(name)
  if (needle === '') return null

  const exact = options.find((o) => normalizeOperatorName(o.name) === needle)
  if (exact) return exact

  return (
    options.find((o) => {
      const candidate = normalizeOperatorName(o.name)
      return candidate !== '' && (candidate.startsWith(needle) || needle.startsWith(candidate))
    }) ?? null
  )
}

/** Kleingeschrieben, ohne Satzzeichen, ohne Rechtsformzusatz, mit einfachen Leerzeichen. */
function normalizeOperatorName(name: string | null): string {
  if (!name) return ''
  return name
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\b(gmbh|ag|co|kg|se|ug|mbh|und|&)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Sentinel des Auswahlfelds für „steht nicht in der Liste" — dann tragen zwei Felder die Angaben. */
export const OPERATOR_OTHER = '__andere__'

// ── Anzeige ──────────────────────────────────────────────────────────────────────────────────────

export function meteringVariantLabel(value: string | null): string {
  if (value === null) return 'ohne Variante (NE 3-6)'
  return METERING_VARIANT_LABELS[value as MeteringVariant] ?? value
}

export function grundpreisUnitLabel(value: string): string {
  return GRUNDPREIS_UNIT_LABELS[value as GrundpreisUnit] ?? value
}

export function priceBasisLabel(value: string): string {
  return PRICE_BASIS_LABELS[value as PriceBasisValue] ?? value
}

/** „Wiener Netze · NE 7 · mit Leistungsmessung" — die Kombination, auf der die Datierung beruht. */
export function combinationLabel(row: GridTariffRow): string {
  const parts = [row.operator_name, `NE ${row.netzebene}`]
  if (row.metering_variant !== null) parts.push(meteringVariantLabel(row.metering_variant))
  return parts.join(' · ')
}

/** Gruppierungsschlüssel — GENAU die drei Spalten, über die auch die Datenbank datiert. */
export function combinationKey(row: GridTariffRow): string {
  return `${row.operator_id} ${row.netzebene} ${row.metering_variant ?? ''}`
}

/** Ein Saison-Zeitraum als Text; beides leer heisst ganzjährig. */
export function seasonLabel(from: string | null, to: string | null): string {
  if (!from && !to) return 'ganzjährig'
  return `${from ?? '?'} bis ${to ?? '?'}`
}

/** `14:00:00` wird zu `14:00`. PostgREST liefert `time` mit Sekunden; die Seite zeigt sie nicht. */
export function shortTime(value: string): string {
  return /^\d{2}:\d{2}:\d{2}$/.test(value) ? value.slice(0, 5) : value
}
