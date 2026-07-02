import { z } from 'zod'

/**
 * Abrechnungsmodell (§3.5) — bestimmt, welcher kW-Wert abgerechnet wird.
 * Kein hartkodierter „Jahreshöchstwert"; die Strategie ist austauschbar.
 * Das TariffStrategy-*Interface* (Verhalten) gehört in die Engine, nicht hierher.
 */
export const billingModelSchema = z.enum([
  'annual_max', // ein Jahreshöchstwert bestimmt alles
  'monthly_max_average', // Mittelwert der 12 Monatshöchstwerte (AT-Default [ANNAHME])
  'monthly_max_sum', // Summe der 12 Monatshöchstwerte
])
export type BillingModel = z.infer<typeof billingModelSchema>

/** Einfaches HT/NT-Fenster für tarifbewusstes Laden (§3.1, MVP). */
export const timeOfUseWindowSchema = z.object({
  from: z.string(), // "HH:mm"
  to: z.string(),
  ctPerKwh: z.number().nonnegative(),
})
export type TimeOfUseWindow = z.infer<typeof timeOfUseWindowSchema>

/**
 * PROVISORISCH — Benutzungsdauer-Effekt. §3.1 referenziert `BenutzungsdauerModel`,
 * definiert den Typ aber nie; §3.5 deutet nur an: übersteigt die Benutzungsdauer
 * eine Schwelle (z.B. 2500 h), gilt ggf. eine andere Preisspalte. Minimal typisiert,
 * damit das optionale Feld valide ist. Die exakte Umschaltlogik ist fachlich offen
 * und für M1 NICHT nötig — hier steht nur der Vertrags-Platzhalter.
 */
export const benutzungsdauerModelSchema = z.object({
  thresholdHours: z.number().positive(), // z.B. 2500 h
  alternativeLeistungspreisEurPerKwYear: z.number().nonnegative(),
  alternativeArbeitspreisCtPerKwh: z.number().nonnegative().optional(),
})
export type BenutzungsdauerModel = z.infer<typeof benutzungsdauerModelSchema>

/** Tarifparameter aus der Netzrechnung — „Die Rechnung ist die Wahrheit" (§3.1). */
export const tariffParamsSchema = z.object({
  leistungspreisEurPerKwYear: z.number().nonnegative(),
  billingModel: billingModelSchema,
  minBillableKw: z.number().nonnegative(), // Mindestleistung (Sockel, nie unterschreitbar)
  arbeitspreisNetzCtPerKwh: z.number().nonnegative().optional(),
  energyPriceCtPerKwh: z.number().nonnegative(), // Bezugs-Arbeitspreis (Eigenverbrauchswert)
  energyPriceNightCtPerKwh: z.number().nonnegative().optional(), // Nacht-/Niedertarif
  timeOfUseWindows: z.array(timeOfUseWindowSchema).optional(),
  dynamicPriceProfile: z.unknown().optional(), // [v2] Spot-/dynamische Preise (Arbitrage)
  einspeiseverguetungCtPerKwh: z.number().nonnegative(),
  netzebene: z.string().optional(), // Metadatum
  benutzungsdauerModel: benutzungsdauerModelSchema.optional(),
})
export type TariffParams = z.infer<typeof tariffParamsSchema>
