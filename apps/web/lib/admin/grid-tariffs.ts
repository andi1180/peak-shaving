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
import {
  NETZBETREIBER_IDS,
  NETZBETREIBER_LABELS,
  findWindowCollisions,
  type GridTariffWindowInput,
  type NetzbetreiberId,
  type WindowCollision,
} from 'shared'
import { formatDate } from './format'

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
  /**
   * B21-2e: Zeitpunkt, zu dem diese Zeile als HISTORISCHER Stand nachgetragen wurde.
   *
   * `null` heisst „regulär vorwärts angehängt" und ist für jede vor B21-2e entstandene Zeile bereits
   * die zutreffende Aussage — die Spalte hat bewusst keinen Default (s. Migration).
   */
  backfilled_at: string | null
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
  /** B21-2d: Freitext für Menschen — geht in keine Berechnung ein. */
  note: string | null
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

/**
 * Der Rückfragetext vor dem Löschen einer Tarifzeile (B21-2c).
 *
 * ── ⚠ ER MUSS DIE ZEILE EINDEUTIG BENENNEN, UND ZWAR AUS EINEM KONKRETEN GRUND ──────────────────
 * Eine Kombination trägt in der Liste MEHRERE Stände untereinander, die sich in der Kopfzeile nur
 * durch ein Datum unterscheiden. Ein allgemeines „Wirklich löschen?" beantwortete damit die falsche
 * Frage: Es fragt, OB gelöscht werden soll, aber der wahrscheinliche Fehlgriff ist nicht das
 * Löschen an sich — es ist die falsche ZEILE. Der Text nennt deshalb die Kombination, den
 * Gültigkeitszeitraum und, wo es zutrifft, dass es der AKTUELLE Stand ist.
 *
 * Steht hier und nicht in der Seite, weil er Vokabular ist und die Seite ihn sonst als einzige
 * kennte: die Zahlen und Bezeichnungen kommen aus denselben Helfern, die auch die Zeile rendern.
 */
export function deleteConfirmText(
  row: GridTariffRow,
  windows: readonly GridTariffRateWindowRow[],
): string {
  const zeitraum = row.valid_until
    ? `gültig ${formatDate(row.valid_from)} bis ${formatDate(row.valid_until)}`
    : `gültig ab ${formatDate(row.valid_from)} — DER AKTUELLE STAND`
  const fenster = windows.length === 1 ? '1 Zeitfenster' : `${windows.length} Zeitfenster`

  return (
    'Diesen Tarifstand löschen?\n\n' +
    `${combinationLabel(row)}\n` +
    `${zeitraum}\n` +
    `Grundpreis ${row.grundpreis_amount} ${grundpreisUnitLabel(row.grundpreis_unit)} · ${fenster}\n\n` +
    'Die Zeile und ihre Zeitfenster werden entfernt. Ein vollständiger Abzug bleibt im ' +
    'Löschprotokoll erhalten.'
  )
}

// ── Kollisions-Wächter (B21-2d) ──────────────────────────────────────────────────────────────────
//
// ── ⚠ WARUM DIE REGEL AUS `shared` KOMMT UND NICHT HIER STEHT ───────────────────────────────────
// Welches Zeitfenster zu einem Zeitpunkt gilt, entscheidet der Rechenkern (`packages/engine`) über
// `selectRateWindow` — dieselbe Funktion, die `shared/tariff-window-rules.ts` bereitstellt. Eine
// hier nachgebaute Auslegung wäre eine ZWEITE Regel: Die Warnung sagte dann etwas anderes, als der
// Kalkulator später rechnet, und der Admin bekäme eine Zusage, die niemand hält. Dieses Modul
// FORMULIERT den Befund, es ermittelt ihn nicht.

/** Eine gespeicherte Fensterzeile in der Form, in der die Auswahlregel sie liest. */
export function toWindowInput(row: GridTariffRateWindowRow): GridTariffWindowInput {
  return {
    label: row.label,
    monthDayFrom: row.month_day_from,
    monthDayTo: row.month_day_to,
    timeFrom: row.time_from,
    timeTo: row.time_to,
    ctPerKwh: row.ct_per_kwh,
  }
}

/** Die Rohwerte des Formulars, wie sie im Browser stehen — alle als Zeichenkette. */
export type RateWindowDraft = {
  label: string
  monthDayFrom: string
  monthDayTo: string
  timeFrom: string
  timeTo: string
  ctPerKwh: string
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/
const MONTH_DAY_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

/**
 * Ein noch unvollständiges Formular ergibt `null` — dann gibt es nichts zu prüfen.
 *
 * ⚠ Die Prüfungen sind bewusst DIESELBEN Muster wie in `gridTariffWindowSchema`, und sie sind
 * absichtlich streng: Aus einer halb getippten Uhrzeit („1") entstünde sonst ein Fenster, dessen
 * gemeldete Verdrängung mit dem nichts zu tun hat, was der Admin gleich abschickt. Lieber KEINE
 * Warnung als eine über ein Fenster, das so nie angelegt wird — die Warnung ist eine Auskunft über
 * den fertigen Eintrag, keine Tipp-Begleitung.
 */
export function draftToWindowInput(draft: RateWindowDraft): GridTariffWindowInput | null {
  const timeFrom = draft.timeFrom.trim()
  const timeTo = draft.timeTo.trim()
  if (!TIME_RE.test(timeFrom) || !TIME_RE.test(timeTo)) return null

  const ct = Number(draft.ctPerKwh.trim().replace(',', '.'))
  if (!Number.isFinite(ct) || ct < 0 || draft.ctPerKwh.trim() === '') return null

  const from = draft.monthDayFrom.trim()
  const to = draft.monthDayTo.trim()
  // Eine halb angegebene Saison ist keine Angabe (dieselbe Regel wie `requireSeasonPair`).
  if ((from === '') !== (to === '')) return null
  if (from !== '' && (!MONTH_DAY_RE.test(from) || !MONTH_DAY_RE.test(to))) return null

  return {
    label: draft.label.trim(),
    monthDayFrom: from === '' ? null : from,
    monthDayTo: to === '' ? null : to,
    timeFrom,
    timeTo,
    ctPerKwh: ct,
  }
}

/** Welche bestehenden Fenster würde der Entwurf verdrängen? Leer, solange er unvollständig ist. */
export function draftCollisions(
  draft: RateWindowDraft,
  existing: readonly GridTariffRateWindowRow[],
): WindowCollision[] {
  const candidate = draftToWindowInput(draft)
  if (candidate === null) return []
  return findWindowCollisions(candidate, existing.map(toWindowInput))
}

/** `04-01` → `01.04.` — die Schreibweise, in der die Liste Zeiträume ohnehin zeigt. */
function monthDayText(monthDay: string): string {
  const [month, day] = monthDay.split('-')
  return `${day}.${month}.`
}

/** de-AT mit mindestens zwei Nachkommastellen — Netzentgelte werden in ct/kWh mit Cent genannt. */
const CT = new Intl.NumberFormat('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 3 })

/**
 * Ein Kollisionsbefund als Satz.
 *
 * ── ⚠ ER MUSS DIE PREISÄNDERUNG NENNEN, NICHT NUR DIE ÜBERSCHNEIDUNG ──────────────────────────
 * „Dieses Fenster überschneidet sich mit ‚snap'" beschreibt eine Lage; entschieden wird aber über
 * einen SATZ. Erst „5,58 → 9,90 ct/kWh" macht sichtbar, was sich für jeden künftigen Kunden dieser
 * Netzebene ändert — und genau das lässt sich nachträglich nicht mehr korrigieren.
 */
export function describeWindowCollision(collision: WindowCollision): string {
  const zeitraum =
    collision.season === null
      ? 'ganzjährig'
      : `vom ${monthDayText(collision.season.from)} bis ${monthDayText(collision.season.to)}`

  return (
    `Dieses Fenster verdrängt ${zeitraum} zwischen ${collision.clock.from} und ` +
    `${collision.clock.to} das Fenster „${collision.displaced.label}" ` +
    `(${CT.format(collision.fromCtPerKwh)} → ${CT.format(collision.toCtPerKwh)} ct/kWh).`
  )
}

// ── Früheren Stand nachtragen (B21-2e) ───────────────────────────────────────────────────────────

/**
 * Der Tag VOR `iso` — das Ende, das ein nachgetragener Stand bekommt.
 *
 * ⚠ Gerechnet wird über `Date.UTC`, nicht über die lokale Zeit: `new Date('2026-01-01')` liegt in
 * UTC, ein anschliessendes `setDate` läuft aber in der Zeitzone des Servers. In Wien (UTC+1/+2)
 * ergäbe das für einen Monatsersten den VORLETZTEN Tag des Vormonats — ein um einen Tag falscher
 * Bestätigungstext neben einem korrekt rechnenden Wrapper wäre der schlechteste Fall: er behauptete
 * eine Lücke, die es nicht gibt.
 *
 * Die massgebliche Rechnung steht in `public.backfill_grid_tariff` (`valid_from - 1`); diese hier
 * dient AUSSCHLIESSLICH der Anzeige vor dem Absenden.
 */
export function previousDay(iso: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!match) return null
  const ms =
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - 24 * 60 * 60 * 1000
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

/**
 * Der Satz, der VOR dem Absenden sagt, welchen Zeitraum der nachgetragene Stand abdeckt.
 *
 * ── ⚠ ER MUSS BEIDE ENDEN NENNEN ───────────────────────────────────────────────────────────────
 * Der Eintragende gibt nur den BEGINN an; das Ende ergibt sich aus der bestehenden ältesten Zeile
 * und ist damit die einzige Angabe des Vorgangs, die er nicht selbst getippt hat. Ohne sie bliebe
 * offen, ob der neue Stand bis heute gilt — und genau das ist der Fehler, gegen den der ganze
 * Abschnitt gebaut ist (ein offener Stand in der Vergangenheit).
 *
 * Ebenso gehört hinein, dass die neue Zeile NICHT der aktuelle Stand wird: „Tarifstand angelegt"
 * liest sich sonst wie „ab jetzt gilt das hier".
 */
export function backfillRangeText(validFrom: string, oldestValidFrom: string): string | null {
  const until = previousDay(oldestValidFrom)
  if (until === null || previousDay(validFrom) === null) return null

  return (
    `Dieser Stand gilt vom ${formatDate(validFrom)} bis ${formatDate(until)} — unmittelbar vor dem ` +
    `bisher ältesten Stand dieser Kombination (ab ${formatDate(oldestValidFrom)}). Er wird dadurch ` +
    'NICHT zum aktuellen Stand.'
  )
}

/**
 * Ab wann ein OFFENER Stand als lange unverändert gilt — reine Anzeige, kein Blocker.
 *
 * ── ⚠ WARUM 15 MONATE UND NICHT 12 ─────────────────────────────────────────────────────────────
 * Netzentgelt-Preisblätter gelten kalenderjahrweise, und der Stand fürs Folgejahr wird typischerweise
 * im Spätherbst erfasst — zwischen zwei Erfassungen liegen also regelmässig knapp zwölf Monate. Bei
 * einer 12-Monats-Schwelle stünde der Hinweis deshalb im Normalbetrieb jedes Jahr für ein paar Wochen
 * da und wäre nach kurzer Zeit ein Möbelstück, das niemand mehr liest.
 *
 * 15 Monate liegen sicher hinter einem vollständigen Jahreszyklus samt Quartal Puffer: Eine gepflegte
 * Kombination erreicht die Schwelle nie, eine, die einen ganzen Preisblatt-Zyklus verpasst hat, schon.
 *
 * ⚠ Gemessen wird an `created_at` (WANN wurde die Zeile eingetragen), NICHT an `valid_from`: Ein
 * Stand, der ab 01.01.2027 gilt und im November 2026 erfasst wurde, ist frisch gepflegt — an
 * `valid_from` gemessen sähe er nach über einem Jahr Stillstand aus, und der Hinweis wäre falsch.
 */
export const STALE_OPEN_STAND_MONTHS = 15

/**
 * Wie viele volle Monate liegt `createdAt` zurück — oder `null`, wenn die Schwelle nicht erreicht ist.
 *
 * `now` ist ein PFLICHTPARAMETER: eine Funktion, die selbst auf die Uhr sieht, lässt sich nicht gegen
 * einen Stichtag prüfen (dieselbe Regel wie bei `standardProfileYear` im Kalkulator).
 */
export function staleOpenStandMonths(createdAt: string, now: Date): number | null {
  const created = new Date(createdAt)
  if (Number.isNaN(created.getTime())) return null

  const months =
    (now.getUTCFullYear() - created.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - created.getUTCMonth()) -
    (now.getUTCDate() < created.getUTCDate() ? 1 : 0)

  return months >= STALE_OPEN_STAND_MONTHS ? months : null
}
