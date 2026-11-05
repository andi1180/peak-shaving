/** Zwei Blöcke von je sechs Monaten, jährlich wiederholt — mehr gibt der Plan nicht her. */
export type SwitchRules = {
  blockMonths: 6
  /** Beide Schwellen müssen erreicht sein, sonst bleibt es beim besten Einzeltarif. */
  minSavingShare: number
  minSavingEur: number
}

export type SwitchPlanBlock = {
  tariffId: string
  /** Kalendermonate, Index 0 = Jänner; Block 2 läuft über den Jahreswechsel weiter. */
  months: number[]
}

export type SwitchPlanSingle = { tariffId: string; annualEur: number }

export type SwitchPlanSwitch = {
  startMonth: number
  blocks: [SwitchPlanBlock, SwitchPlanBlock]
  annualEur: number
}

export type SwitchPlanVariant =
  ({ kind: 'single' } & SwitchPlanSingle) | ({ kind: 'switch' } & SwitchPlanSwitch)

export type SwitchPlanInsufficientReason = 'missing_months' | 'short_period' | 'overlap'

/**
 * Der günstigste Plan über zwölf Kalendermonate: ein Tarif ganzjährig oder zwei Halbjahresblöcke.
 * Beträge wie die Eingangsreihen, ohne Speicher und ohne Leistungspreis.
 */
export type TariffSwitchPlan =
  | { status: 'insufficient_data'; reason: SwitchPlanInsufficientReason }
  | {
      status: 'ok'
      singles: SwitchPlanSingle[]
      bestSingle: SwitchPlanSingle
      bestSwitch: SwitchPlanSwitch
      /** Negativ, wenn jeder Wechsel teurer ist als der beste Einzeltarif. */
      savingVsBestSingleEur: number
      /** `null`, wenn der beste Einzeltarif nichts kostet oder Erlös bringt: dort trägt kein Prozentsatz. */
      savingShare: number | null
      result: { kind: 'single'; tariffId: string } | { kind: 'switch'; blocks: SwitchPlanBlock[] }
      variants: SwitchPlanVariant[]
    }
