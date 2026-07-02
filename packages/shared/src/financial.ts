import { z } from 'zod'

/**
 * Förder- & Steuerparameter (§3.1) — alle optional, wirken auf die Amortisation.
 * Vereinfachte Rechnung, KEINE Steuerberatung (§3.9).
 *
 * Einheiten-Konvention der `*Percent`-Felder (Anteil 0..1 vs. Prozent 0..100) ist
 * im Pflichtenheft NICHT eindeutig: Feldname „Percent" vs. Formel `subsidyPercent ×
 * totalInvestment` (§3.9) implizieren Unterschiedliches. Bewusst KEIN Upper-Bound
 * erzwungen — die Festlegung ist eine fachliche Entscheidung und gehört in die Engine
 * (§3.9), nicht in den Boundary-Contract.
 */
export const financialParamsSchema = z.object({
  fixedSubsidyEur: z.number().nonnegative().optional(),
  subsidyPercent: z.number().nonnegative().optional(),
  investitionsfreibetragPercent: z.number().nonnegative().optional(),
  depreciationYears: z.number().positive().optional(), // AfA
  taxRatePercent: z.number().nonnegative().optional(), // Grenzsteuersatz / KöSt
  note: z.string().optional(),
})
export type FinancialParams = z.infer<typeof financialParamsSchema>
