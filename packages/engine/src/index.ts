// Rechen-Engine (§3). Parser + Lastgang-Aufbereitung (§3.2/§3.3), TariffStrategy (§3.5),
// Spitzenerkennung/Ist-Kosten (§3.4), SoC-Simulation + Kapp-Suche + Spitzen-Reserve (§3.6/§3.6.1),
// kombinierter Dispatch → benannte Ersparnis-Felder (§3.7), ROI & Förderung (§3.9) und
// Empfehlung/Ranking über den Katalog (§3.8) sind gebaut.
export * from './parser'
export * from './tariff'
export * from './peaks'
export * from './simulation'
export * from './savings'
export * from './roi'
export * from './recommendation'
// Delta 8 / 9b-1: das synthetische Standardlastprofil (H0) für Kunden ohne echten Lastgang.
export * from './standard-profile'
// B22a: der PV-Zeitreihengenerator — PVGIS-Stundenwerte werden zu einem gemittelten
// Referenzprofil und dieses zu einem signierten Netz-Lastgang (Verbrauch − Erzeugung). Der
// Netzaufruf selbst liegt bewusst NICHT hier, sondern als Proxy in `apps/website/lib/pvgis/`.
export * from './pv-generation'
// Vorausschauende Ladesteuerung (vereinfacht, 21.09.2026): der INTERNE Nachweis „was hätte eine
// Steuerung ohne Rückblick erreicht". Reine Berechnung, kein Report und keine Oberfläche.
export * from './foresight'
// D5 (17.09.2026): die PV-Ausfallerkennung — Monate, in denen eine vorhandene Anlage im Lastgang
// keinen Mittagseinbruch zeigt. Rein beobachtend, kein KI-Aufruf (Prinzip 5).
export * from './pv-anomaly'
// D3 (16.09.2026): die vollständige Rechenkette (§3.4–§3.9) — bis dahin app-lokal im Analyse-Worker
// von `apps/website`. Sie liegt hier, damit der Wizard-Entwurf denselben Rechenweg benutzen kann
// statt einer zweiten Kopie (Prinzip 2). Die Typen reisen mit: sie beschreiben die Nutzlast.
export { computeAnalysis } from './compute-analysis'
export type {
  CalculatorPayload,
  EstimatedPvResult,
  ExistingBatteryInput,
  ParsedLoad,
  ParsedPv,
  TariffResult,
} from './compute-analysis'
// D3 Baustein 2 (16.09.2026): die Bestandsbatterie des Wizard-Entwurfs wird zu
// `ExistingBatteryInput` — Gegenstück zu `mapDraftToTariffParams`, ebenso rein.
export { mapDraftToExistingBatteryInput } from './battery-draft-mapping'
export type { DraftExistingBatteryMapping } from './battery-draft-mapping'
