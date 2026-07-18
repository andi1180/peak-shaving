/**
 * Mapping am Leserand (T3-Prompt-Vorgabe: NICHT in `packages/tariff-monitor` —
 * die Engine bleibt rein, kennt keine DB-Zeilen). snake_case (generierte
 * Supabase-Zeile) → camelCase (`TariffCostObject`, T1-Output-Contract).
 *
 * Reine Funktion, kein I/O — kein `server-only` nötig, könnte unverändert auch
 * clientseitig laufen. Wird hier aber ausschließlich serverseitig aufgerufen
 * (`app/(site)/[locale]/strom-check/page.tsx`), das gemappte Ergebnis (bereits
 * camelCase, kein DB-Bezug mehr erkennbar) geht als Prop an die Client-Komponente.
 */
import type { TariffCostObject } from 'tariff-monitor'
import type { Tables } from '@/db-types'

export type CurrentTariffRow = Tables<{ schema: 'monitor' }, 'current_tariffs'>

/**
 * `current_tariffs` ist eine VIEW (`DISTINCT ON`, T2) — der Supabase-Typgenerator
 * markiert bei Views grundsätzlich ALLE Spalten nullable, weil er die
 * NOT-NULL-Constraints der zugrunde liegenden Tabelle an dieser Stelle nicht
 * kennt. Praktisch kann eine Pflichtspalte hier nicht fehlen (die Basistabelle
 * erzwingt es) — trotzdem wird eine unvollständige Zeile hier defensiv
 * verworfen (`null`) statt mit einem stillen `as TariffCostObject`
 * durchgewunken: ein Cast wäre eine unbewiesene Behauptung, ein Skip nicht.
 */
export function mapTariffRowToCostObject(row: CurrentTariffRow): TariffCostObject | null {
  if (
    row.provider_name == null ||
    row.tariff_name == null ||
    row.energy_price_ct_per_kwh == null ||
    row.base_fee_eur_per_year == null ||
    row.bonus_eur == null ||
    row.contract_commitment_months == null ||
    row.billing_cycle == null ||
    row.green_energy == null
  ) {
    return null
  }

  return {
    providerName: row.provider_name,
    tariffName: row.tariff_name,
    energyPriceCtPerKwh: row.energy_price_ct_per_kwh,
    baseFeeEurPerYear: row.base_fee_eur_per_year,
    bonusEur: row.bonus_eur,
    bonusConditionText: row.bonus_condition_text ?? undefined,
    priceGuaranteeMonths: row.price_guarantee_months ?? undefined,
    contractCommitmentMonths: row.contract_commitment_months,
    // `billing_cycle` kommt aus der DB nur als `string` (das CHECK-Constraint
    // ist kein generierter TS-Enum) — eng auf den Contract-Union gefasst,
    // alles außer dem exakten "annual" gilt als "monthly" (der DB-Default).
    billingCycle: row.billing_cycle === 'annual' ? 'annual' : 'monthly',
    greenEnergy: row.green_energy,
    requiresPrepayment: row.requires_prepayment ?? false,
  }
}

export function mapTariffRows(rows: CurrentTariffRow[]): TariffCostObject[] {
  return rows
    .map(mapTariffRowToCostObject)
    .filter((tariff): tariff is TariffCostObject => tariff !== null)
}
