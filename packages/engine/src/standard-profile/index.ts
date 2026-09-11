// Standardlastprofil (Delta 8 / Delta 9b-1) — der dritte Einstieg in den Lastgang-Schritt neben
// Datei-Upload und (später) Rechnungs-Scan. Erzeugt einen `LoadProfile` aus Jahresverbrauch und
// Kundenklasse; rein, deterministisch, ohne Zufall (Begründung im Kopf von `h0.ts`).
export {
  generateStandardLoadProfile,
  H0_REFERENCE_DAILY_KWH,
  H0_WINTER_SUMMER_RATIO,
} from './h0'
export type {
  StandardProfileCustomerClass,
  StandardProfileInput,
  StandardProfileOutcome,
} from './h0'

/*
 * Die METADATEN eines erzeugten Profils — Zeitpunkte und Zahlen über die Reihe, nie die Reihe
 * selbst. Getrennt von `h0.ts`, weil es eine andere Frage beantwortet: jenes erzeugt die Kurve,
 * dieses sagt, was davon an einen Zählpunkt geschrieben wird (B24, Teil 1).
 */
export { standardProfileMetadata } from './metadata'
export type { StandardProfileMetadata, StandardProfileMetadataOutcome } from './metadata'
