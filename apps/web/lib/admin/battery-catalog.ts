/**
 * Vokabular und Zeilen-Typ des Admin-Abschnitts „Batteriespeicher" (K1).
 *
 * REIN: kein `server-only`, kein `next/*`, kein Supabase-Client — die Server-Seite liest die Typen,
 * das Client-Formular die Beschriftungen. Gleiche Aufteilung wie `lib/admin/grid-tariffs.ts`
 * (B21-2b) und `lib/admin/retail-tariffs.ts`.
 *
 * ── WAS DIESER ABSCHNITT IST ───────────────────────────────────────────────────────────────────
 * `public.battery_catalog` ist der Gerätekatalog des Kalkulators: Kenndaten und Netto-Listenpreise
 * der Speicher, aus denen `recommendBattery` seine Empfehlung wählt. Er löst perspektivisch
 * `DEMO_BATTERY_CATALOG` ab (sechs frei erfundene Geräte im Code) — **in diesem Bauabschnitt aber
 * noch nicht**: K1 legt Tabelle und Pflege an, K2 füllt sie, erst K3 hängt den Rechner um.
 *
 * Er ist ausdrücklich NICHT der Ort für den BESTANDSSPEICHER eines Kunden. Der wird mit seinen
 * exakten Werten simuliert und läuft gar nicht durch `recommendBattery`
 * (`packages/shared/src/battery-combination.ts`); die Wizard-Station schreibt ihn in den
 * Zählpunkt-Entwurf und rundet bewusst NICHT auf einen Katalog-Kandidaten.
 */
import { formatDate } from './format'

/** Basispfad des Abschnitts — ohne Locale-Präfix, wie der ganze Admin-Bereich. */
export const BATTERY_CATALOG_HREF = '/admin/batteriespeicher'

// ── Vokabular ────────────────────────────────────────────────────────────────────────────────────
//
// Spiegel der CHECKs auf `public.battery_catalog`. Als Konstanten zulässig aus demselben Grund wie
// bei den Tarif-Abschnitten: kurze feste Listen, deren Werte im Anwendungscode eigene Bedeutung
// haben. Weicht eine Liste ab, lehnt die Datenbank den Wert ohnehin ab.

/**
 * Spiegel des CHECK `kategorie in ('heim','gewerbe')`.
 *
 * ⚠ Die Engine kennt dieselbe Unterscheidung unter anderem Namen: `BatteryCandidate.class` trägt
 * `residential | commercial`. Die Übersetzung gehört in den Loader (K3) — hier stehen die Wörter,
 * die in der Datenbank stehen, damit die Admin-Seite und der CHECK dieselbe Sprache sprechen.
 */
export const BATTERY_KATEGORIEN = ['heim', 'gewerbe'] as const
export type BatterieKategorie = (typeof BATTERY_KATEGORIEN)[number]

export const BATTERY_KATEGORIE_LABELS: Record<BatterieKategorie, string> = {
  heim: 'Heimspeicher',
  gewerbe: 'Gewerbespeicher',
}

/**
 * Spiegel des CHECK `control_type in ('static','dynamic')`.
 *
 * ⚠ Die Engine LIEST dieses Feld heute an keiner Stelle — es ist Metadatum. Bleibt es leer, gilt im
 * Loader die Konvention aus `packages/shared/src/battery.ts`: heim → static, gewerbe → dynamic.
 * Deshalb ist es auch kein Pflichtfeld zum Aktivieren.
 */
export const BATTERY_CONTROL_TYPES = ['static', 'dynamic'] as const
export type BatterieControlType = (typeof BATTERY_CONTROL_TYPES)[number]

export const BATTERY_CONTROL_TYPE_LABELS: Record<BatterieControlType, string> = {
  static: 'statisch',
  dynamic: 'dynamisch',
}

/**
 * Spiegel des CHECK `rte_source in ('datenblatt','annahme')`.
 *
 * ⚠ Die Herkunft ist zum FREIGEBEN Pflicht, sobald ein Wirkungsgrad dasteht — anders als
 * `control_type`, das reines Metadatum bleibt. Grund: 0,88 ist ein Erfahrungswert, und ohne das
 * Feld daneben sähen Engine und Report einen geratenen Wert wie einen belegten.
 */
export const BATTERY_RTE_SOURCES = ['datenblatt', 'annahme'] as const
export type BatterieRteSource = (typeof BATTERY_RTE_SOURCES)[number]

export const BATTERY_RTE_SOURCE_LABELS: Record<BatterieRteSource, string> = {
  datenblatt: 'Datenblatt',
  annahme: 'Annahme',
}

/** Leerwert der Auswahlfelder ohne Vorgabe. */
export const BATTERY_SELECT_UNSET = ''

// ── Zeilen ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Eine Zeile, wie `public.admin_list_battery_catalog` / `admin_get_battery` sie liefern — also
 * inklusive der beiden Einkaufspreis-Felder aus `platform.battery_purchase_prices`.
 *
 * ⚠ Die EK-Felder stehen NICHT auf `public.battery_catalog`, und das ist der Kern des Abschnitts:
 * aus Listen- und Einkaufspreis ergibt sich die Marge, und der öffentliche Rechner liest den
 * Katalog als `anon`. Sie kommen ausschliesslich über die Definer-Wrapper hierher.
 */
export type BatteryCatalogRow = {
  id: string
  memodo_id: number | null
  kategorie: string
  hersteller: string
  bezeichnung: string
  usable_capacity_kwh: number | null
  max_power_kw: number | null
  round_trip_efficiency: number | null
  rte_source: string | null
  list_price_net: number | null
  inverter_included: boolean | null
  extra_inverter_cost_net: number | null
  requires_foundation: boolean | null
  foundation_component_id: string | null
  installation_component_id: string | null
  price_as_of: string | null
  source_url: string | null
  datasheet_url: string | null
  control_type: string | null
  notes: string | null
  active: boolean
  created_at: string
  updated_at: string
  purchase_price_net: number | null
  purchase_price_as_of: string | null
  /**
   * Bezeichnung und Preis der zugeordneten Kostenbausteine (K1b) — vom Wrapper mitgeliefert, damit
   * die Liste ohne einen zweiten Aufruf je Zeile zeigen kann, ob eine Freigabe scheitern würde.
   * `…_price_net === null` bei gesetzter `…_id` heisst: Baustein da, aber noch nicht bepreist.
   */
  foundation_component_label: string | null
  foundation_component_price_net: number | null
  installation_component_label: string | null
  installation_component_price_net: number | null
}

export function batterieKategorieLabel(value: string): string {
  return BATTERY_KATEGORIE_LABELS[value as BatterieKategorie] ?? value
}

export function batterieControlTypeLabel(value: string | null): string {
  if (!value) return '—'
  return BATTERY_CONTROL_TYPE_LABELS[value as BatterieControlType] ?? value
}

export function batterieRteSourceLabel(value: string | null): string {
  if (!value) return '—'
  return BATTERY_RTE_SOURCE_LABELS[value as BatterieRteSource] ?? value
}

export function batteryLabel(row: Pick<BatteryCatalogRow, 'hersteller' | 'bezeichnung'>): string {
  return `${row.hersteller} ${row.bezeichnung}`
}

// ── Vollständigkeit ──────────────────────────────────────────────────────────────────────────────

/**
 * Die Felder, ohne die eine Zeile nicht aktiviert werden darf — und WARUM.
 *
 * ── ⚠ DAS IST EIN SPIEGEL, NICHT DIE REGEL ────────────────────────────────────────────────────
 * Die Regel steht als CHECK `battery_catalog_active_complete` in der Datenbank und gilt auch für
 * `service_role` und `postgres`. Was hier steht, dient der MELDUNG: der Wrapper
 * `admin_set_battery_active` benennt die fehlenden Felder, und diese Tabelle übersetzt ihre
 * Spaltennamen in Sätze. Wer den CHECK erweitert, erweitert diese Liste mit — sonst zeigt die
 * Oberfläche eine Ablehnung ohne Begründung.
 *
 * Aufgezählt ist genau das, was `packages/engine` aus einem Katalog-Eintrag liest: Kapazität,
 * Leistung und Wirkungsgrad für die Simulation, Preis und die zwei Zuschläge für die ROI-Rechnung.
 */
export const BATTERY_ENGINE_FIELD_LABELS: Record<string, string> = {
  usable_capacity_kwh: 'Nutzbare Kapazität',
  max_power_kw: 'Maximale Leistung',
  round_trip_efficiency: 'Wirkungsgrad',
  // K2c: ein geratener Wirkungsgrad sieht aus wie ein belegter, solange nichts daneben steht.
  rte_source: 'Herkunft des Wirkungsgrads',
  list_price_net: 'Listenpreis (netto)',
  inverter_included: 'Wechselrichter enthalten?',
  requires_foundation: 'Fundament nötig?',
  extra_inverter_cost_net: 'Aufpreis Wechselrichter (netto)',
  // K1b: aus einem Betrag sind zwei Zustände geworden, und sie verlangen verschiedene Handgriffe
  // an verschiedenen Stellen — „ordne einen Baustein zu" gegen „trage im Baustein einen Preis ein".
  foundation_component_id: 'Fundament-Baustein',
  foundation_component_price_net: 'Preis des Fundament-Bausteins',
}

export function batteryEngineFieldLabel(column: string): string {
  return BATTERY_ENGINE_FIELD_LABELS[column] ?? column
}

/**
 * Welche Engine-Pflichtfelder dieser Zeile fehlen — dieselbe Bedingung wie im CHECK, in derselben
 * Reihenfolge wie im Wrapper.
 *
 * Gebraucht für die ANZEIGE (die Liste markiert unvollständige Entwürfe, bevor jemand vergeblich
 * auf „Aktivieren" klickt). Die Entscheidung selbst fällt in der Datenbank.
 */
export function missingEngineFields(row: BatteryCatalogRow): string[] {
  const missing: string[] = []
  if (row.usable_capacity_kwh === null) missing.push('usable_capacity_kwh')
  if (row.max_power_kw === null) missing.push('max_power_kw')
  if (row.round_trip_efficiency === null) missing.push('round_trip_efficiency')
  if (row.rte_source === null) missing.push('rte_source')
  if (row.list_price_net === null) missing.push('list_price_net')
  if (row.inverter_included === null) missing.push('inverter_included')
  if (row.requires_foundation === null) missing.push('requires_foundation')
  // Die zwei BEDINGTEN: genau die zwei Zuschläge, die `roi.ts` addiert. Ohne sie wäre die
  // Investition zu niedrig und die Amortisation zu gut — ein Fehler, der wie ein Ergebnis aussieht.
  if (row.inverter_included === false && row.extra_inverter_cost_net === null) {
    missing.push('extra_inverter_cost_net')
  }
  if (row.requires_foundation === true) {
    if (row.foundation_component_id === null) {
      missing.push('foundation_component_id')
    } else if (row.foundation_component_price_net === null) {
      missing.push('foundation_component_price_net')
    }
  }
  return missing
}

// ── Rückfragen ───────────────────────────────────────────────────────────────────────────────────

/**
 * Die Rückfrage vor dem Löschen — sie benennt das Gerät und die Folge.
 *
 * ⚠ Sie ist eine Rückfrage an einen Menschen, KEINE Prüfung: die Autorisierung liegt im Wrapper
 * (`platform.is_admin()`). Dass eine abgelegte Analyse unberührt bleibt, steht dabei ausdrücklich
 * im Text — sonst klänge das Löschen gefährlicher, als es ist, und jemand liesse eine falsche Zeile
 * stehen.
 */
export function batteryDeleteConfirmText(row: BatteryCatalogRow): string {
  return (
    `„${batteryLabel(row)}" endgültig aus dem Katalog entfernen?\n\n` +
    (row.purchase_price_net !== null
      ? 'Der hinterlegte Einkaufspreis wird dabei mit gelöscht. '
      : '') +
    'Bereits abgelegte Analysen bleiben unverändert — sie tragen den damaligen Katalogstand als ' +
    'eigene Kopie. Rückgängig machen lässt sich der Vorgang nicht.'
  )
}

/** Was beim Zurücknehmen einer aktiven Zeile passiert. */
export function batteryDeactivateConfirmText(row: BatteryCatalogRow): string {
  return (
    `„${batteryLabel(row)}" aus dem Rechner zurücknehmen?\n\n` +
    'Das Gerät steht danach in keiner Empfehlung mehr zur Auswahl. Die Zeile bleibt erhalten und ' +
    'lässt sich jederzeit wieder freigeben.'
  )
}

/** „zuletzt geändert am …" — eine Zeile für die Liste. */
export function batteryPriceStand(row: BatteryCatalogRow): string {
  return row.price_as_of ? `Preisstand ${formatDate(row.price_as_of)}` : 'kein Preisstand angegeben'
}
