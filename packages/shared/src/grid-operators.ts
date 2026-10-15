/**
 * Netzbetreiber und Netzebenen-Beschriftung je Land.
 *
 * Gespeichert wird für alle Länder dieselbe Form: die Netzebene als Zahl 3–7 (`NETZEBENEN`), der
 * Betreiber als global eindeutige Kennung. Je Land verschieden ist nur, wie die Ebene HEISST und
 * welche Betreiber zur Auswahl stehen. Rein, ohne Abhängigkeiten ausser den Nachbarmodulen.
 */
import type { Country } from './country'
import {
  NETZBETREIBER_IDS,
  NETZBETREIBER_LABELS,
  NETZEBENEN,
  type Netzebene,
} from './tariff-catalog'

/** AT nennt die Ebene beim Namen der Ebene; DE beim Spannungsbereich (StromNEV). */
export const NETZEBENE_LABELS: Record<Country, Record<Netzebene, string>> = {
  AT: {
    3: 'Netzebene 3',
    4: 'Netzebene 4',
    5: 'Netzebene 5',
    6: 'Netzebene 6',
    7: 'Netzebene 7',
  },
  DE: {
    3: 'Hochspannung',
    4: 'Umspannung HS/MS',
    5: 'Mittelspannung',
    6: 'Umspannung MS/NS',
    7: 'Niederspannung',
  },
}

/** Beschriftung einer Ebene im Land; eine Zahl ausserhalb 3–7 bleibt als „Netzebene n" lesbar. */
export function netzebeneLabel(country: Country, netzebene: number): string {
  return (NETZEBENEN as readonly number[]).includes(netzebene)
    ? NETZEBENE_LABELS[country][netzebene as Netzebene]
    : `Netzebene ${netzebene}`
}

export type GridOperatorOption = { id: string; label: string }

/** Die im Code bekannten Betreiber je Land; DE ist leer, bis Betreiber im Admin gepflegt sind. */
export const GRID_OPERATOR_CATALOG: Record<Country, readonly GridOperatorOption[]> = {
  AT: NETZBETREIBER_IDS.map((id) => ({ id, label: NETZBETREIBER_LABELS[id] })),
  DE: [],
}

/** Das Land, in dessen Katalog eine Kennung steht — `null`, wenn keiner sie führt. */
export function catalogCountryOfOperator(operatorId: string): Country | null {
  for (const [country, options] of Object.entries(GRID_OPERATOR_CATALOG) as [
    Country,
    readonly GridOperatorOption[],
  ][]) {
    if (options.some((option) => option.id === operatorId)) return country
  }
  return null
}

/** Eine Betreiber-Kennung samt Anzeigename aus `grid_tariffs` (Zeilen eines Landes). */
export type GridOperatorRow = { operator_id: string; operator_name: string }

/**
 * Auswahl eines Landes: erst der Katalog in seiner Reihenfolge, dann die übrigen Betreiber aus den
 * Netzentgelt-Zeilen dieses Landes nach Namen sortiert, ohne Duplikate.
 *
 * Der Katalogname gewinnt gegen den Zeilennamen, damit dieselbe Kennung überall gleich heisst; für
 * eine Kennung ausserhalb des Katalogs gilt der Name der ersten Zeile (der Aufrufer liefert die
 * jüngste zuerst).
 */
export function gridOperatorOptionsFor(
  country: Country,
  rows: readonly GridOperatorRow[],
): GridOperatorOption[] {
  const catalog = GRID_OPERATOR_CATALOG[country]
  const known = new Set(catalog.map((option) => option.id))
  const extra = new Map<string, string>()
  for (const row of rows) {
    if (!known.has(row.operator_id) && !extra.has(row.operator_id)) {
      extra.set(row.operator_id, row.operator_name)
    }
  }
  const extras = [...extra.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'de'))
  return [...catalog, ...extras]
}
