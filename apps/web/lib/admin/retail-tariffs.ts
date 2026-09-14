/**
 * Vokabular und Zeilen-Typ des Admin-Abschnitts „Lieferanten-Tarife".
 *
 * REIN: kein `server-only`, kein `next/*`, kein Supabase-Client — die Server-Seite liest die Typen,
 * das Client-Formular die Beschriftungen. Gleiche Aufteilung wie `lib/admin/grid-tariffs.ts`
 * (B21-2b) und `lib/admin/analyses.ts` (B14-2).
 *
 * ── WAS DIESER ABSCHNITT IST UND WAS ER NICHT IST ──────────────────────────────────────────────
 * `public.retail_tariffs` führt LISTENPREISE von Stromanbietern zum Vergleich — die Antwort auf
 * „was verlangen andere Anbieter heute?". Er ist ausdrücklich NICHT der Ort für die individuellen
 * Vertragswerte eines Kunden (die kommen aus seiner eigenen Rechnung, Delta 9b-2) und nicht für
 * Börsenpreise (`public.spot_prices`, Delta 7). Begründung in voller Länge im Kopf der Migration
 * `20260913120000`.
 *
 * ── WARUM DAS VOKABULAR HIER STEHT UND NICHT AUS `./grid-tariffs` KOMMT ────────────────────────
 * `price_basis` trägt in beiden Tabellen dieselben zwei Werte (Delta 6), und die Versuchung, sie
 * einmal zu deklarieren, ist naheliegend. Sie ist trotzdem falsch: `lib/admin/grid-tariffs.ts`
 * importiert `shared` (Betreiberliste, Kollisionsprüfung), und ein Import von dort zöge `shared` in
 * das Bündel dieses Formulars — für zwei Zeichenketten. Genau diese Überlegung steht bereits im
 * Kopf von `lib/admin/grid-tariffs-schema.ts`.
 *
 * Dieselbe Entscheidung hat die Datenbank für sich getroffen: drei gleichlautende CHECKs statt eines
 * geteilten Enums (s. Migration). Wer einen dritten Wert einführt, ändert beide Stellen gemeinsam.
 */
import { formatDate } from './format'

/** Basispfad des Abschnitts — ohne Locale-Präfix, wie der ganze Admin-Bereich. */
export const RETAIL_TARIFFS_HREF = '/admin/lieferanten-tarife'

// ── Vokabular ────────────────────────────────────────────────────────────────────────────────────
//
// Spiegel der CHECKs auf `public.retail_tariffs`. Als Konstanten zulässig aus demselben Grund wie
// bei den Netzbetreiber-Tarifen: kurze feste Listen, deren Werte im Anwendungscode eigene Bedeutung
// haben. Weicht eine Liste ab, lehnt die Datenbank den Wert ohnehin ab — die Konstante entscheidet
// nur, was die Oberfläche überhaupt anbietet.

/**
 * Spiegel des CHECK `segment in ('privat','betrieb')`.
 *
 * ⚠ WORTGLEICH zu `platform.projects.segment` — und das ist der Zweck: Ein Projekt soll seinen
 * Vergleichstarif ohne Übersetzungstabelle finden. Eine hier abweichende Schreibweise („gewerbe")
 * würde von der Datenbank abgewiesen, und selbst wenn nicht, fände die Zuordnung nie statt.
 */
export const RETAIL_SEGMENTS = ['privat', 'betrieb'] as const
export type RetailSegment = (typeof RETAIL_SEGMENTS)[number]

export const RETAIL_SEGMENT_LABELS: Record<RetailSegment, string> = {
  privat: 'Privat (Haushalt)',
  betrieb: 'Betrieb (Gewerbe)',
}

/** Spiegel des CHECK `price_basis in ('net','gross')` — Delta 6. */
export const RETAIL_PRICE_BASES = ['net', 'gross'] as const
export type RetailPriceBasis = (typeof RETAIL_PRICE_BASES)[number]

export const RETAIL_PRICE_BASIS_LABELS: Record<RetailPriceBasis, string> = {
  net: 'netto (ohne USt.)',
  gross: 'brutto (inkl. USt.)',
}

/**
 * ⚠ ES GIBT BEWUSST KEINEN VORGABEWERT FÜR DIE PREISBASIS — anders als bei den Netzbetreiber-Tarifen.
 *
 * Dort steht `DEFAULT_PRICE_BASIS = 'net'`, und das ist dort richtig: Netzentgelt-Tarifblätter sind
 * durchgängig netto, der Vorgabewert beschreibt die Lage der Quellen. Hier ist die Lage genau
 * umgekehrt uneinheitlich — die Migration hält es fest: Anbieter bewerben gegenüber HAUSHALTEN
 * üblicherweise brutto, gegenüber BETRIEBEN netto.
 *
 * Ein Vorgabewert wäre damit eine Vermutung, die im Formular aussieht wie eine Ablesung. Und der
 * Fehler, den sie erzeugt, ist der teuerste dieses Abschnitts: Ein brutto eingetragener Preis, der
 * als netto geführt wird, macht den Vergleich um den Steuersatz falsch — in einer Richtung, die
 * niemandem als Fehler auffiele, sondern als Ergebnis. Dieselbe Überlegung, aus der die Netzebene
 * in B21-2b ihre Vorauswahl verloren hat.
 *
 * Das Auswahlfeld startet deshalb leer; das Schema verlangt eine ausdrückliche Wahl. Dasselbe gilt
 * für das Segment: es ist Teil der Identität der Zeile, und eine falsch gesetzte Zeile lässt sich
 * NICHT korrigieren (es gibt für `retail_tariffs` keinen Löschweg).
 */
export const RETAIL_SELECT_UNSET = ''

// ── Zeilen ───────────────────────────────────────────────────────────────────────────────────────

export type RetailTariffRow = {
  id: string
  provider_id: string
  provider_name: string
  segment: string
  energy_price_ct_per_kwh: number
  base_fee_eur_per_month: number
  price_basis: string
  source_url: string
  valid_from: string
  valid_until: string | null
  /** Zuletzt bestätigt — unabhängig von `valid_from`. Grundlage der Staleness-Anzeige. */
  checked_at: string
  created_by: string
  created_at: string
}

/**
 * Eine Zeile ist OFFEN, solange `valid_until` nicht gesetzt ist.
 *
 * Wortgleich zu `isOpen` bei den Netzbetreiber-Tarifen, und aus demselben Grund: „offen" heisst, es
 * gibt keinen Nachfolger — nicht, dass das Ende in der Zukunft läge. Ein Stand mit `valid_from` in
 * der Zukunft (ein bereits angekündigter Preis) ist trotzdem der aktuelle offene Eintrag.
 */
export function isOpen(row: RetailTariffRow): boolean {
  return row.valid_until === null
}

export function retailSegmentLabel(value: string): string {
  return RETAIL_SEGMENT_LABELS[value as RetailSegment] ?? value
}

export function retailPriceBasisLabel(value: string): string {
  return RETAIL_PRICE_BASIS_LABELS[value as RetailPriceBasis] ?? value
}

/** Anbieter + Segment — die Kombination, über die die Datenbank datiert. */
export function retailCombinationKey(row: RetailTariffRow): string {
  return `${row.provider_id}::${row.segment}`
}

export function retailCombinationLabel(row: RetailTariffRow): string {
  return `${row.provider_name} · ${retailSegmentLabel(row.segment)}`
}

// ── Anbieter-Auswahl ─────────────────────────────────────────────────────────────────────────────

export type RetailProviderOption = { id: string; name: string }

/**
 * Die Auswahlliste des Formulars: jeder Anbieter, der bereits eingetragen ist.
 *
 * ── ⚠ WARUM ÜBERHAUPT EINE AUSWAHL UND NICHT NUR EIN TEXTFELD ─────────────────────────────────
 * `provider_id` trägt weder Fremdschlüssel noch CHECK. Ein Tippfehler erzeugt deshalb keine
 * Ablehnung, sondern eine ZWEITE Anbieter-Identität: `awattar` und `awatter` sind für den
 * `unique (provider_id, segment, valid_from)`-Constraint zwei verschiedene Anbieter, beide Zeilen
 * bleiben offen, und die Effektiv-Datierung greift zwischen ihnen nie. Der Fehler fiele erst auf,
 * wenn ein Vergleich zwei Preise desselben Anbieters nebeneinander zeigt.
 *
 * Wortgleiche Überlegung wie `operatorOptions` bei den Netzbetreibern — mit einem Unterschied: Dort
 * gibt es eine bekannte Grundmenge aus B11. Hier gibt es keine; die Liste beginnt leer und wächst
 * mit dem, was eingetragen wurde. Ein neuer Anbieter wird also genau EINMAL von Hand erfasst und
 * ist von da an ein Listeneintrag, der sich nicht mehr vertippen lässt.
 *
 * Der Anzeigename folgt der ZULETZT gespeicherten Fassung (die Zeilen kommen absteigend nach
 * `valid_from`): eine Umbenennung setzt sich von selbst durch, ohne dass die stabile Kennung sich
 * ändert.
 */
export function retailProviderOptions(
  existing: readonly RetailTariffRow[],
): RetailProviderOption[] {
  const byId = new Map<string, string>()
  for (const row of existing) {
    if (!byId.has(row.provider_id)) byId.set(row.provider_id, row.provider_name)
  }
  return [...byId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de-AT'))
}

// ── Staleness ────────────────────────────────────────────────────────────────────────────────────

/**
 * Ab wie vielen Tagen ein OFFENER Stand als „lange nicht mehr nachgesehen" gilt — reine Anzeige,
 * kein Blocker.
 *
 * ── ⚠ DIESE ZAHL IST EIN PLATZHALTER, KEINE MESSUNG ───────────────────────────────────────────
 * Sie ist gesetzt, nicht erhoben: Es gibt bislang KEINE Erfahrung darüber, wie oft österreichische
 * Stromanbieter ihre Listenpreise ändern — die Tabelle ist leer, und die erste Befüllung steht
 * aus. 60 Tage sind die Grössenordnung „etwa zweimonatlich nachsehen", nicht mehr. Wer sie ersetzt,
 * ersetzt genau diese eine Zeile; sobald der Katalog ein paar Monate läuft, lässt sich aus den
 * Ständen selbst ablesen, wie schnell sie veralten.
 *
 * ── ⚠ WARUM TAGE UND NICHT MONATE WIE BEI DEN NETZBETREIBERN ──────────────────────────────────
 * Dort sind es 15 MONATE, und das hat einen fachlichen Grund: Netzentgelt-Preisblätter gelten
 * kalenderjahrweise, zwischen zwei Erfassungen liegen regelmässig knapp zwölf Monate. Endkunden-
 * Listenpreise folgen keinem solchen Rhythmus — sie ändern sich, wann der Anbieter es will. Eine
 * Monatsschwelle wäre hier so grob, dass sie den Zweck der Spalte verfehlte.
 *
 * ── ⚠ GEMESSEN WIRD AN `checked_at`, NICHT AN `created_at` ────────────────────────────────────
 * Genau dafür gibt es die Spalte (s. Migration `20260913120000`, TEIL 1): `valid_from` sagt, ab wann
 * der Preis gilt, `created_at`, wann die Zeile entstand — nur `checked_at` sagt, wann zuletzt jemand
 * nachgesehen hat, dass er noch dasteht. Ein Stand vom 1. Jänner kann heute frisch bestätigt sein;
 * an einer der beiden anderen Spalten gemessen sähe er nach neun Monaten Stillstand aus.
 */
export const STALE_RETAIL_TARIFF_DAYS = 60

/**
 * Wie viele volle Tage liegt `checkedAt` zurück — oder `null`, wenn die Schwelle nicht erreicht ist.
 *
 * `now` ist ein PFLICHTPARAMETER: eine Funktion, die selbst auf die Uhr sieht, lässt sich nicht
 * gegen einen Stichtag prüfen (dieselbe Regel wie bei `staleOpenStandMonths` und
 * `standardProfileYear`).
 *
 * ⚠ Gerechnet wird auf der ZEITACHSE (Millisekunden), nicht über Kalenderfelder wie beim
 * Monats-Gegenstück: `checked_at` ist ein `timestamptz`, also ein Zeitpunkt und kein Datum — eine
 * Zerlegung in Jahr/Monat/Tag müsste sich für eine Zeitzone entscheiden, und der Unterschied wäre
 * eine reine Erfindung. Ein in der ZUKUNFT liegendes Prüfdatum ergibt eine negative Zahl und damit
 * `null`; es soll gar nicht entstehen (`confirm_retail_tariff` nimmt `now()` und keinen Parameter),
 * und wenn doch, ist „nicht veraltet" die richtige Aussage.
 */
export function staleRetailTariffDays(checkedAt: string, now: Date): number | null {
  const checked = new Date(checkedAt)
  if (Number.isNaN(checked.getTime())) return null

  const days = Math.floor((now.getTime() - checked.getTime()) / 86_400_000)
  return days >= STALE_RETAIL_TARIFF_DAYS ? days : null
}

/**
 * Die Rückfrage vor dem Bestätigen — sie benennt die Zeile eindeutig.
 *
 * ⚠ WARUM ES SIE HIER GIBT, obwohl der Vorgang harmlos aussieht: Zwei Stände unterscheiden sich in
 * der Liste nur durch ein Datum, und der Knopf steht an jeder Zeile. Ein Fehlklick lässt sich nicht
 * zurücknehmen — es gibt keinen Weg, `checked_at` auf einen früheren Wert zu setzen. Die Folge ist
 * mild (der Veraltet-Hinweis verschwindet für weitere 60 Tage), aber sie ist unumkehrbar, und der
 * Satz kostet nichts.
 *
 * Sie ist eine Rückfrage an einen Menschen, KEINE Prüfung — die Autorisierung liegt in der Server
 * Action.
 */
export function retailConfirmText(row: RetailTariffRow): string {
  return (
    `„${row.provider_name}" · ${retailSegmentLabel(row.segment)} · gültig ab ` +
    `${formatDate(row.valid_from)} als weiterhin zutreffend bestätigen?\n\n` +
    'Damit wird ausschliesslich der Prüfzeitpunkt auf heute gesetzt — Preis, Grundgebühr und ' +
    'Gültigkeit bleiben unverändert. Der bisherige Prüfzeitpunkt lässt sich danach nicht mehr ' +
    'wiederherstellen.'
  )
}
