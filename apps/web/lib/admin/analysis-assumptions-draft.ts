import {
  enteredFromNet,
  readDraftFinancialParams,
  readDraftFixedSubsidyPriceBasis,
  readDraftHorizonYears,
  readDraftSubsidyProgramsPriceBasis,
  readDraftTaxFields,
} from 'shared'

/**
 * Die Annahmen der Wirtschaftlichkeit in der Tarif-Station — Lesen fürs Formular und die
 * Zahlen-Eingabe. Die Entwurfsschlüssel selbst stehen in `shared` (`ANALYSIS_ASSUMPTION_DRAFT_KEYS`),
 * weil `run-from-draft.ts` sie liest.
 */
export const SUBSIDY_MODES = ['percent', 'fixed', 'per_kwh'] as const
export type SubsidyMode = (typeof SUBSIDY_MODES)[number]

export function isSubsidyMode(value: unknown): value is SubsidyMode {
  return (SUBSIDY_MODES as readonly unknown[]).includes(value)
}

/** Eine Programmzeile „€ pro kWh" im Formular — der Satz in der Basis, in der er eingegeben wurde. */
export type SubsidyProgramForm = {
  label: string
  eurPerKwh: number
  maxKwh: number | null
  maxPercent: number | null
}

export type AnalysisAssumptionsForm = {
  horizonYears: number | null
  subsidyMode: SubsidyMode | null
  /** Prozent bzw. Fixbetrag in der Basis, in der er eingegeben wurde. */
  subsidyValue: number | null
  /** Nur im Modus `per_kwh`, sonst leer. */
  subsidyPrograms: SubsidyProgramForm[]
  /** Steuerangaben (nur Gewerbe), einzeln gelesen — auch ohne Steuersatz. */
  investitionsfreibetragPercent: number | null
  taxRatePercent: number | null
  depreciationYears: number | null
}

/** IFB oder Abschreibungsdauer ist eingetragen, der Steuersatz fehlt — dann rechnet der Report keine Steuerwirkung. */
export function taxRateMissing(form: AnalysisAssumptionsForm): boolean {
  return (
    form.taxRatePercent === null &&
    (form.investitionsfreibetragPercent !== null || form.depreciationYears !== null)
  )
}

export function readAnalysisAssumptionsForm(
  draft: Record<string, unknown>,
): AnalysisAssumptionsForm {
  const financial = readDraftFinancialParams(draft)
  const tax = readDraftTaxFields(draft)
  const base = {
    horizonYears: readDraftHorizonYears(draft),
    subsidyPrograms: [] as SubsidyProgramForm[],
    investitionsfreibetragPercent: tax.investitionsfreibetragPercent ?? null,
    taxRatePercent: tax.taxRatePercent ?? null,
    depreciationYears: tax.depreciationYears ?? null,
  }
  if (financial?.subsidyPercent !== undefined) {
    return { ...base, subsidyMode: 'percent', subsidyValue: financial.subsidyPercent }
  }
  if (financial?.fixedSubsidyEur !== undefined) {
    const basis = readDraftFixedSubsidyPriceBasis(draft)
    return {
      ...base,
      subsidyMode: 'fixed',
      subsidyValue: enteredFromNet(financial.fixedSubsidyEur, basis),
    }
  }
  if (financial?.subsidyPrograms !== undefined) {
    const basis = readDraftSubsidyProgramsPriceBasis(draft)
    return {
      ...base,
      subsidyMode: 'per_kwh',
      subsidyValue: null,
      subsidyPrograms: financial.subsidyPrograms.map((p) => ({
        label: p.label ?? '',
        eurPerKwh: enteredFromNet(p.eurPerKwh, basis),
        maxKwh: p.maxKwh ?? null,
        maxPercent: p.maxPercent ?? null,
      })),
    }
  }
  return { ...base, subsidyMode: null, subsidyValue: null }
}

/**
 * Eine Zahl, wie sie in de-AT getippt wird: „5.000" ist ein Betrag von fünftausend, nicht fünf —
 * Tausenderpunkte werden nur als solche gelesen, wenn sie genau Dreiergruppen trennen.
 */
export function parseAmountInput(raw: string): number {
  const value = raw.trim().replace(/[\s€%]/g, '')
  if (value === '') return NaN
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(value)) {
    return Number(value.replace(/\./g, '').replace(',', '.'))
  }
  return Number(value.replace(',', '.'))
}
