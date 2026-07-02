import { z } from 'zod'

/** Batterie-Kandidat aus Martins Katalog (§3.1). */
export const batteryClassSchema = z.enum(['residential', 'commercial'])
export type BatteryClass = z.infer<typeof batteryClassSchema>

export const controlTypeSchema = z.enum(['static', 'dynamic'])
export type ControlType = z.infer<typeof controlTypeSchema>

export const batteryCandidateSchema = z.object({
  id: z.string(),
  name: z.string(),
  manufacturer: z.string(),
  class: batteryClassSchema,
  usableCapacityKwh: z.number().positive(), // nutzbare Kapazität (DoD bereits berücksichtigt)
  maxPowerKw: z.number().positive(), // max. Lade-/Entladeleistung (~ C-Rate × Kapazität)
  roundTripEfficiency: z.number().gt(0).max(1), // z.B. 0.88
  pricePerKwh: z.number().nonnegative(),
  inverterIncluded: z.boolean(),
  extraInverterCost: z.number().nonnegative().optional(), // falls separater WR nötig
  requiresFoundation: z.boolean(),
  foundationCost: z.number().nonnegative().optional(),
  controlType: controlTypeSchema, // residential oft static, commercial dynamic
})
export type BatteryCandidate = z.infer<typeof batteryCandidateSchema>
