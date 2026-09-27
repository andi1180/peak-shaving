import { z } from 'zod'

export const SUBSIDY_PROGRAMS_MAX = 3
export const SUBSIDY_PROGRAM_LABEL_MAX = 60

/**
 * Ein Förderprogramm „€ pro kWh" (§3.9, Revision Förderung pro kWh): Satz je nutzbarer kWh des
 * Geräts, optional gedeckelt auf eine kWh-Menge und auf einen Anteil der Investition. Beträge netto.
 */
export const subsidyProgramSchema = z.object({
  label: z.string().trim().min(1).max(SUBSIDY_PROGRAM_LABEL_MAX).optional(),
  eurPerKwh: z.number().positive(),
  maxKwh: z.number().positive().optional(),
  /** Prozent (0–100). */
  maxPercent: z.number().positive().max(100).optional(),
})
export type SubsidyProgram = z.infer<typeof subsidyProgramSchema>

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
  /** Programme „€ pro kWh", je Gerät gerechnet (1 bis `SUBSIDY_PROGRAMS_MAX`). */
  subsidyPrograms: z.array(subsidyProgramSchema).min(1).max(SUBSIDY_PROGRAMS_MAX).optional(),
  /** Prozent (0–100). Engine dividiert intern durch 100. */
  investitionsfreibetragPercent: z.number().min(0).max(100).optional(),
  depreciationYears: z.number().positive().optional(), // AfA
  /** Grenzsteuersatz / KöSt in Prozent (0–100). Engine dividiert intern durch 100. */
  taxRatePercent: z.number().min(0).max(100).optional(),
  note: z.string().optional(),
})
export type FinancialParams = z.infer<typeof financialParamsSchema>
