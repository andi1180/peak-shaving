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

/**
 * Herkunft des Lastgangs. Die ersten drei Werte beschreiben, wie eine HOCHGELADENE Datei die
 * Netzleistung darstellt (§3.1) und werden vom Parser abgeleitet.
 *
 * `standard_profile` (Delta 8) ist der vierte, andersartige Fall: kein Upload, sondern ein aus
 * Jahresverbrauch und Kundenklasse skaliertes SYNTHETISCHES Profil für Kunden ohne echten Lastgang.
 * Alle vier münden auf denselben `LoadProfile`-Contract — nachgelagert verzweigt nichts darüber, und
 * das ist Absicht: die drei Eingabewege (Datei-Upload, Rechnungs-Scan, Standardprofil) sind
 * gleichwertige Startpunkte, keine UI-Verzweigung danach.
 *
 * ⚠ Der Wert ist NICHT folgenlos, sobald die Simulation ihn liest (Delta 3, zweite Anwendung):
 * Ein Standardprofil trägt die Tarif-Arbitrage-Rechnung, aber NICHT die Leistungspreis-
 * Dimensionierung — ohne echten Lastgang lässt sich eine individuelle Spitze nicht seriös schätzen,
 * und eine geschätzte Spitzenlast-Ersparnis wäre eine erfundene Zahl (Prinzip 1/Prinzip 7). Diese
 * Kopplung ist hier bewusst noch NICHT gebaut; sie gehört in die Engine-Ausbaustufe.
 */
export const loadSourceSchema = z.enum([
  'net_signed',
  'import_export_split',
  'import_only',
  'standard_profile',
])
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
