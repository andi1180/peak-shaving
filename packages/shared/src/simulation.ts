import { z } from 'zod'

/** Simulations-Konfiguration (§3.1). Defaults liegen im UI-Layer, nicht im Rechenkern. */
export const dispatchPrioritySchema = z.literal('peak_first') // MVP-Default; 'co_optimized' ist [v2]
export type DispatchPriority = z.infer<typeof dispatchPrioritySchema>

export const simulationConfigSchema = z.object({
  horizonYears: z.number().int().positive(), // Default 10 (im UI-Layer gesetzt)
  dispatchPriority: dispatchPrioritySchema,
})
export type SimulationConfig = z.infer<typeof simulationConfigSchema>
