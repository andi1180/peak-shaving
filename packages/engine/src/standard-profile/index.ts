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
