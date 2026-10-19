import { NETZBETREIBER_IDS, gridTariffRowsHaveTiers, type GridTariffRowInput } from 'shared'

import { invoiceFieldDocumentValues, type InvoiceFieldConflict } from './invoice-field-choices'
import type { KnownOperatorIds } from './invoice-extractions'

/**
 * Leistungspreis bei Benutzungsdauer-Stufen: gerechnet wird mit den Stufen der Netzentgelt-Zeile, der
 * Rechnungswert ist wirkungslos (#522). Unterschiedliche Rechnungswerte sind dann kein Widerspruch,
 * sondern die jeweils geltende Stufe — sie werden nur zur Kontrolle gezeigt, nie zur Wahl.
 */

const FIELD = 'leistungspreisEurPerKwYear'

export type TieredDemandStand = {
  validFrom: string
  validTo?: string
  thresholdHours: number
  belowEurPerKwYear: number
  aboveEurPerKwYear: number
}

export type TieredDemandInvoiceValue = {
  documentId: string
  filename: string
  periodFrom: string | null
  periodTo: string | null
  value: number
}

export type TieredDemandInfo = {
  tiers: TieredDemandStand[]
  invoiceValues: TieredDemandInvoiceValue[]
}

/** Die Stände mit vollständigen Stufensätzen, älteste zuerst. */
export function tieredDemandStands(rows: readonly GridTariffRowInput[]): TieredDemandStand[] {
  return rows
    .flatMap((row): TieredDemandStand[] => {
      const { tierThresholdHours, tier2LeistungspreisEurPerKwYear, grundpreisAmount } = row
      if (tierThresholdHours == null || tier2LeistungspreisEurPerKwYear == null) return []
      if (row.grundpreisUnit !== 'eur_per_kw_year' || grundpreisAmount == null) return []
      return [
        {
          validFrom: row.validFrom,
          ...(row.validUntil ? { validTo: row.validUntil } : {}),
          thresholdHours: tierThresholdHours,
          belowEurPerKwYear: grundpreisAmount,
          aboveEurPerKwYear: tier2LeistungspreisEurPerKwYear,
        },
      ]
    })
    .sort((a, b) => (a.validFrom < b.validFrom ? -1 : 1))
}

/**
 * Trägt die Netzentgelt-Zeile Stufen, verschwindet der Leistungspreis aus den Konfliktoptionen und
 * kommt als Hinweis zurück (nur wenn mindestens eine Rechnung einen nennt). `rows === null` heisst
 * nicht bestimmbar — dann bleibt alles unverändert.
 */
export function withTieredDemand(
  conflicts: InvoiceFieldConflict[],
  draft: Record<string, unknown>,
  rows: readonly GridTariffRowInput[] | null,
  knownOperatorIds: KnownOperatorIds = NETZBETREIBER_IDS,
): { conflicts: InvoiceFieldConflict[]; tieredDemandInfo?: TieredDemandInfo } {
  if (!gridTariffRowsHaveTiers(rows)) return { conflicts }
  const rest = conflicts.filter((conflict) => conflict.field !== FIELD)
  const invoiceValues = invoiceFieldDocumentValues(draft, FIELD, knownOperatorIds).flatMap(
    (option): TieredDemandInvoiceValue[] =>
      typeof option.value === 'number'
        ? [
            {
              documentId: option.documentId,
              filename: option.filename,
              periodFrom: option.periodFrom,
              periodTo: option.periodTo,
              value: option.value,
            },
          ]
        : [],
  )
  if (invoiceValues.length === 0) return { conflicts: rest }
  return { conflicts: rest, tieredDemandInfo: { tiers: tieredDemandStands(rows!), invoiceValues } }
}
