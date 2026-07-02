import { z } from 'zod'

/**
 * Lastgang (PFLICHT) — Netz-Lastgang am Anschlusspunkt (Pflichtenheft §3.1).
 * Signiert: + = Netzbezug, − = Einspeisung. Enthält den Effekt vorhandener PV
 * (Eigenverbrauch) bereits. Boundary-Typ → zod ist die einzige Quelle.
 */
export const loadReadingSchema = z.object({
  ts: z.string().datetime(), // ISO, UTC
  gridPowerKw: z.number(), // signiert — bewusst NICHT nonnegative
})
export type LoadReading = z.infer<typeof loadReadingSchema>

export const loadSourceSchema = z.enum(['net_signed', 'import_export_split', 'import_only'])
export type LoadSource = z.infer<typeof loadSourceSchema>

export const loadProfileSchema = z.object({
  readings: z.array(loadReadingSchema),
  intervalMinutes: z.literal(15), // MVP nur 15-min; andere → Fehler/Resampling im Parser
  timezoneMeta: z.string(), // z.B. "Europe/Vienna" (nur Metadatum; Speicherung in UTC)
  source: loadSourceSchema,
})
export type LoadProfile = z.infer<typeof loadProfileSchema>

/**
 * PV-Erzeugungsprofil (OPTIONAL) — Brutto-PV-Erzeugung vom Wechselrichter (§3.1).
 * Verbessert die Eigenverbrauchs-Aussage, ist aber nicht zwingend.
 */
export const pvReadingSchema = z.object({
  ts: z.string().datetime(),
  pvGenerationKw: z.number(),
})
export type PvReading = z.infer<typeof pvReadingSchema>

export const pvProfileSchema = z.object({
  readings: z.array(pvReadingSchema),
})
export type PvProfile = z.infer<typeof pvProfileSchema>
