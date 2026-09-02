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
