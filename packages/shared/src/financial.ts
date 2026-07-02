import { z } from 'zod'

/**
 * Förder- & Steuerparameter (§3.1) — alle optional, wirken auf die Amortisation.
 * Vereinfachte Rechnung, KEINE Steuerberatung (§3.9).
 *
 * Einheiten-Konvention der `*Percent`-Felder: **Prozent (0–100), NICHT Anteil (0–1).**
 * Das UI-Formular (§5) nimmt „30" entgegen, nicht „0,3"; der Vertrag spiegelt diese
 * Grenze, damit ein Faktor-100-Fehler an der Boundary sichtbar wird statt erst in einer
 * absurden Amortisation. Die Engine dividiert intern durch 100 (§3.9).
 */
export const financialParamsSchema = z.object({
  fixedSubsidyEur: z.number().nonnegative().optional(),
  /** Prozent (0–100). Engine dividiert intern durch 100. */
  subsidyPercent: z.number().min(0).max(100).optional(),
  /** Prozent (0–100). Engine dividiert intern durch 100. */
  investitionsfreibetragPercent: z.number().min(0).max(100).optional(),
  depreciationYears: z.number().positive().optional(), // AfA
  /** Grenzsteuersatz / KöSt in Prozent (0–100). Engine dividiert intern durch 100. */
  taxRatePercent: z.number().min(0).max(100).optional(),
  note: z.string().optional(),
})
export type FinancialParams = z.infer<typeof financialParamsSchema>
