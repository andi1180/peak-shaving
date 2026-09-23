/**
 * Die Übersetzung einer `public.battery_catalog`-Zeile in den Typ, den die Engine liest (K3a).
 *
 * ── WARUM ES DIESE DATEI GIBT ───────────────────────────────────────────────────────────────────
 * Gerechnet wird bis heute gegen `DEMO_BATTERY_CATALOG` — sechs frei erfundene Geräte in einem
 * Codemodul. Seit K1/K2 steht der echte Katalog in der Datenbank und wird über `/admin/batterien`
 * gepflegt. Diese Datei ist der Weg von dort in die Rechnung; sie ist dasselbe Muster wie
 * `grid-tariff-prefill.ts` (B21-3d) für die Netzentgelte: eine REINE ÜBERSETZUNG in `shared`,
 * damit sie einen Testlauf hat, und nicht in der Oberfläche, wo sie ungeprüft bliebe.
 *
 * ⚠ K3a hängt sie ausdrücklich NOCH NICHT ein. Kein bestehender Aufrufer (`analysis.worker.ts`,
 * `run-from-draft.ts`, `report.tsx`) ist umgestellt, `DEMO_BATTERY_CATALOG` ist unangetastet. Das
 * Umhängen ist K3b — und dort ist zuerst zu entscheiden, welche Kategorie der öffentliche Rechner
 * überhaupt fragt (s. „Die Kategorie ist ein Parameter" unten).
 *
 * ── SIE FÜHRT KEINEN DATENBANK-CLIENT ───────────────────────────────────────────────────────────
 * `shared` hängt an zod und an nichts sonst; `@supabase/supabase-js` lebt in den Apps. Die Abfrage
 * kommt deshalb als Port herein (`BatteryCatalogSource`), und diese Datei entscheidet alles
 * Übrige. Das ist zugleich der Grund, warum sie prüfbar ist, ohne eine Datenbank zu brauchen.
 *
 * ── ⚠ WAS EINE KATALOGZEILE NICHT HERGIBT — und deshalb hier NICHT erfunden wird ───────────────
 * `battery_catalog` trägt einen GESAMTPREIS (`list_price_net`), `BatteryCandidate` einen Preis JE
 * KILOWATTSTUNDE. Die Division steht hier (so will es der Kopf der Migration 20260922130000) und
 * wird NICHT gerundet: die Engine multipliziert sie sofort wieder mit der Kapazität
 * (`roi.ts:20`), und eine gerundete Zwischenzahl liefe als Abweichung in die Investition.
 *
 * `installation_cost_net` bzw. der Installations-Baustein hat in `BatteryCandidate` KEIN Feld —
 * die Engine rechnet Montage/Elektroanschluss an keiner Stelle mit (Bestandsaufnahme §2). Er wird
 * hier trotzdem aufgelöst und NEBEN dem Kandidaten geliefert (`installationCostNet`), damit ihn
 * die Angebotslegung nicht ein zweites Mal aus der Datenbank holen muss. In den Engine-Typ gehört
 * er nicht: wer ihn in die Investition nimmt, erweitert zuerst `BatteryCandidate`.
 */
import type { BatteryCandidate, ControlType } from './battery'

/** Die beiden Werte, die `battery_catalog.kategorie` annehmen darf (CHECK der Migration). */
export type BatteryCatalogCategory = 'gewerbe' | 'heim'

/**
 * Die Spalten, die der Loader liest — als PostgREST-Auswahl, damit die Abfrage der Apps nicht
 * gegen das driftet, was hier übersetzt wird.
 *
 * ⚠ Die beiden Bausteine müssen über den FREMDSCHLÜSSELNAMEN eingebettet werden. `battery_catalog`
 * zeigt ZWEIMAL auf `battery_cost_components` (Fundament und Installation); ohne `!…_fkey` kann
 * PostgREST die Beziehung nicht auflösen und antwortet mit PGRST201. Die Namen sind die von
 * PostgreSQL vergebenen Vorgabenamen aus der K1b-Migration.
 *
 * Eine zweite Abfrage für die Bausteine wäre ein zweiter Zeitpunkt — und ein Gerät ohne seinen
 * Fundamentpreis ist keine halbe Antwort, sondern eine falsche (dieselbe Überlegung wie bei den
 * eingebetteten Zeitfenstern in `fetchGridTariffs`).
 */
export const BATTERY_CATALOG_SELECT = [
  'id',
  'kategorie',
  'hersteller',
  'bezeichnung',
  'usable_capacity_kwh',
  'max_power_kw',
  'round_trip_efficiency',
  'list_price_net',
  'inverter_included',
  'extra_inverter_cost_net',
  'requires_foundation',
  'control_type',
  'active',
  'foundation_component:battery_cost_components!battery_catalog_foundation_component_id_fkey(art,price_net)',
  'installation_component:battery_cost_components!battery_catalog_installation_component_id_fkey(art,price_net)',
].join(',')

/** Ein eingebetteter Kostenbaustein, so wie PostgREST ihn liefert. */
export type BatteryCostComponentRow = {
  art: string | null
  /** `null` heisst „noch nicht bepreist" (K1b) — die Zeile ist für `anon` dann gar nicht sichtbar. */
  price_net: number | string | null
}

/** Eine Katalogzeile, beschränkt auf die Spalten aus `BATTERY_CATALOG_SELECT`. */
export type BatteryCatalogRow = {
  id: string
  kategorie: string
  hersteller: string
  bezeichnung: string
  usable_capacity_kwh: number | string | null
  max_power_kw: number | string | null
  round_trip_efficiency: number | string | null
  list_price_net: number | string | null
  inverter_included: boolean | null
  extra_inverter_cost_net: number | string | null
  requires_foundation: boolean | null
  control_type: string | null
  active: boolean
  foundation_component: BatteryCostComponentRow | null
  installation_component: BatteryCostComponentRow | null
}

/**
 * Was die Abfrage zurückgibt. Die beiden Fehlergründe sind wörtlich die von `TariffDataFailure`
 * (`apps/website/lib/tariff-data/client.ts`): `not_configured` ist ein Einrichtungsfehler auf
 * unserer Seite, `request_failed` ein vorübergehender. Zwei Fehlerarten, zwei Meldungen.
 */
export type BatteryCatalogSourceResult =
  | { ok: true; rows: BatteryCatalogRow[] }
  | { ok: false; reason: 'not_configured' | 'request_failed'; message: string }

/**
 * Der Port zur Datenbank. Der Aufrufer filtert auf `active = true` und auf die Kategorie — dieser
 * Loader prüft beides NOCHMALS (s. `skipped`), verlässt sich also nicht darauf.
 */
export type BatteryCatalogSource = (
  category: BatteryCatalogCategory,
) => Promise<BatteryCatalogSourceResult>

/**
 * Warum eine gelieferte Zeile nicht in die Rechnung geht.
 *
 * Alle vier Gründe schliessen die DB-Invarianten (`battery_catalog_active_complete`,
 * `battery_catalog_guard_components`) bereits aus. Sie stehen hier, weil ein Eingriff von Hand
 * oder ein künftig gelockerter CHECK sie wieder möglich macht — und dann soll die Zeile
 * AUSFALLEN und BENANNT sein, nicht mit einer stillen 0 in die Investition gehen.
 */
export type SkippedCatalogRow = {
  id: string
  label: string
  reason: 'inactive' | 'wrong_category' | 'incomplete' | 'foundation_price_missing'
}

/**
 * Der Katalogstand — oder warum es keinen gibt.
 *
 * ⚠ `empty` und `failed` sind AUSDRÜCKLICH verschiedene Zustände, nicht zweimal ein leeres Array:
 * „für diese Kategorie ist kein Gerät freigegeben" (heute der reale Stand für `heim`) ist eine
 * gültige Antwort, „wir konnten nicht fragen" ist keine. Ein Aufrufer, der beides gleich
 * behandelte, zeigte bei einem Netzausfall dieselbe Meldung wie bei einem leeren Katalog —
 * dieselbe Vermischung, die B21-3d für die Netzentgelte ausgeschlossen hat.
 *
 * `empty` heisst „keine VERWENDBARE Zeile", nicht „keine Zeile": `skipped` sagt, ob das an einem
 * leeren Katalog lag oder an Zeilen, die ausgefallen sind. Damit hat der Aufrufer genau eine
 * Bedingung zu prüfen und kann den Fall „Zeilen da, aber alle unbrauchbar" nicht übersehen.
 */
export type BatteryCatalogResult =
  | {
      kind: 'available'
      category: BatteryCatalogCategory
      /** Genau der Typ, den die Engine liest — Drop-in für `DEMO_BATTERY_CATALOG`. */
      batteries: BatteryCandidate[]
      /** Je Kandidaten-Kennung der aufgelöste Installationspreis, sofern einer gepflegt ist. */
      installationCostNet: Record<string, number>
      skipped: SkippedCatalogRow[]
    }
  | { kind: 'empty'; category: BatteryCatalogCategory; skipped: SkippedCatalogRow[] }
  | { kind: 'failed'; reason: 'not_configured' | 'request_failed'; message: string }

/**
 * Derselbe Zustand mit dem Wartezustand davor — die Form, die eine Oberfläche hält (B21-3d).
 *
 * `loading` sperrt, genau wie dort: solange nicht feststeht, welche Geräte es gibt, gibt es keine
 * Empfehlung, und eine aus einem halben Katalog wäre schlimmer als keine.
 */
export type BatteryCatalogState = { kind: 'loading' } | BatteryCatalogResult

/** Das Ergebnis der Übersetzung EINER Zeile. */
export type BatteryCatalogRowResult =
  | { ok: true; candidate: BatteryCandidate; installationCostNet: number | null }
  | { ok: false; reason: SkippedCatalogRow['reason'] }

/**
 * Eine Katalogzeile in einen `BatteryCandidate` übersetzen — 1:1, ohne Erweiterung und ohne
 * Kürzung des Engine-Typs.
 */
export function batteryCatalogRowToCandidate(row: BatteryCatalogRow): BatteryCatalogRowResult {
  if (row.active !== true) return { ok: false, reason: 'inactive' }
  if (row.kategorie !== 'gewerbe' && row.kategorie !== 'heim') {
    return { ok: false, reason: 'wrong_category' }
  }

  const usableCapacityKwh = num(row.usable_capacity_kwh)
  const maxPowerKw = num(row.max_power_kw)
  const roundTripEfficiency = num(row.round_trip_efficiency)
  const listPriceNet = num(row.list_price_net)

  /*
   * Dieselbe Liste wie `battery_catalog_active_complete`, und in derselben Strenge: eine Kapazität
   * von 0 wäre keine Lücke, sondern eine Division durch null im Preis je kWh.
   */
  if (
    usableCapacityKwh == null ||
    usableCapacityKwh <= 0 ||
    maxPowerKw == null ||
    maxPowerKw <= 0 ||
    roundTripEfficiency == null ||
    roundTripEfficiency <= 0 ||
    roundTripEfficiency > 1 ||
    listPriceNet == null ||
    listPriceNet < 0 ||
    row.inverter_included == null ||
    row.requires_foundation == null
  ) {
    return { ok: false, reason: 'incomplete' }
  }

  const foundationCost = componentPrice(row.foundation_component)

  /*
   * ⚠ Der teuerste stille Fehler dieser Datei, wäre er nicht abgefangen: `calculateTotalInvestment`
   * liest `foundationCost ?? 0` (roi.ts:21). Ein fundamentpflichtiges Gerät ohne Fundamentpreis
   * ginge also mit einer um den Sockel zu NIEDRIGEN Investition in die Amortisation — eine Zahl,
   * die niemandem als Lücke auffiele, sondern als Ergebnis. Die Zeile fällt stattdessen aus.
   */
  if (row.requires_foundation && foundationCost == null) {
    return { ok: false, reason: 'foundation_price_missing' }
  }

  const extraInverterCost = num(row.extra_inverter_cost_net)

  return {
    ok: true,
    candidate: {
      id: row.id,
      name: row.bezeichnung,
      manufacturer: row.hersteller,
      class: row.kategorie === 'heim' ? 'residential' : 'commercial',
      usableCapacityKwh,
      maxPowerKw,
      roundTripEfficiency,
      // Gesamtpreis → Preis je kWh. Ungerundet, s. Kopf.
      pricePerKwh: listPriceNet / usableCapacityKwh,
      inverterIncluded: row.inverter_included,
      ...(extraInverterCost == null ? {} : { extraInverterCost }),
      requiresFoundation: row.requires_foundation,
      ...(foundationCost == null ? {} : { foundationCost }),
      controlType: controlTypeOf(row),
    },
    installationCostNet: componentPrice(row.installation_component),
  }
}

/**
 * Den Katalog einer Kategorie laden.
 *
 * ── DIE KATEGORIE IST EIN PARAMETER, UND DAS IST EINE OFFENE FRAGE FÜR K3b ─────────────────────
 * `recommendBattery` filtert NICHT nach `class` — es bewertet, was im übergebenen Array steht
 * (gemessen: kein `\.class`-Zugriff in `packages/engine/src/recommendation/**`). Wer hier `heim`
 * und `gewerbe` zusammenlegte, liesse ein Heimgerät gegen einen Gewerbe-Lastgang antreten; wer
 * nur eine Kategorie lädt, muss die Wahl begründen können. `DEMO_BATTERY_CATALOG` vermischt beide
 * (4 commercial, 2 residential) — die Frage stellt sich also erst mit der Umstellung.
 */
export async function loadBatteryCatalog(
  category: BatteryCatalogCategory,
  source: BatteryCatalogSource,
): Promise<BatteryCatalogResult> {
  const answer = await source(category)
  if (!answer.ok) return { kind: 'failed', reason: answer.reason, message: answer.message }

  const batteries: BatteryCandidate[] = []
  const installationCostNet: Record<string, number> = {}
  const skipped: SkippedCatalogRow[] = []

  for (const row of answer.rows) {
    // Eine Zeile der falschen Kategorie ist ein Abfragefehler des Aufrufers, kein Katalogstand —
    // sie darf auf keinen Fall stillschweigend mitgerechnet werden.
    const translated =
      row.kategorie === category
        ? batteryCatalogRowToCandidate(row)
        : ({ ok: false, reason: 'wrong_category' } as const)

    if (!translated.ok) {
      skipped.push({ id: row.id, label: row.bezeichnung, reason: translated.reason })
      continue
    }
    batteries.push(translated.candidate)
    if (translated.installationCostNet != null) {
      installationCostNet[translated.candidate.id] = translated.installationCostNet
    }
  }

  if (batteries.length === 0) return { kind: 'empty', category, skipped }
  return { kind: 'available', category, batteries, installationCostNet, skipped }
}

/**
 * Die Steuerungsart der Zeile — oder die Konvention aus `battery.ts:23`, wenn keine gepflegt ist.
 *
 * Die Engine liest das Feld heute an keiner Stelle (Bestandsaufnahme §2); es ist deshalb kein
 * Pflichtfeld zum Freischalten, und der Loader darf die Lücke schliessen, statt die Zeile
 * abzuweisen. Der Kopf der Katalog-Migration benennt genau diese Ersatzregel.
 */
function controlTypeOf(row: BatteryCatalogRow): ControlType {
  if (row.control_type === 'static' || row.control_type === 'dynamic') return row.control_type
  return row.kategorie === 'heim' ? 'static' : 'dynamic'
}

/**
 * Der Preis eines Bausteins als reiner WERT — kein Verweis.
 *
 * Dasselbe Kopie-Prinzip, das B11 für die Tarifsätze hält und das B14-1 für abgelegte Analysen
 * ausdrücklich verlangt („KEINE Fremdschlüssel auf veränderliche Konfiguration"): was in die
 * Rechnung geht, ist die Zahl von heute, nicht ein Zeiger, dem 2028 jemand einen anderen Preis
 * unterschiebt.
 */
function componentPrice(component: BatteryCostComponentRow | null): number | null {
  if (!component) return null
  const price = num(component.price_net)
  return price == null || price < 0 ? null : price
}

/**
 * `numeric` kommt je nach Client als Zahl oder als Zeichenkette an.
 *
 * ⚠ `null` bleibt `null` und wird NICHT zu 0 — `Number(null)` wäre 0 und behauptete einen Preis
 * von null, wo in Wahrheit keiner gepflegt ist (dieselbe Falle wie beim Messpreis in
 * `fetchGridTariffs`).
 */
function num(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
