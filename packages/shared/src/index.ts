// Domain-Contract (§3.1 Eingaben, §3.10 Ausgabe) — geteilt zwischen Engine und beiden UIs.
// Feldnamen sind VERBATIM aus dem Pflichtenheft (inkl. Einheiten-Suffixe) und die
// gemeinsame Übereinkunft; Umbenennen bricht Engine/UI-Verträge und jedes Handover.
export * from './load-profile'
export * from './tariff'
export * from './battery'
export * from './financial'
export * from './simulation'
export * from './analysis-result'
export * from './demo-battery-catalog'
// B14-1: Archivierung der Quelldatei (gzip + SHA-256). Kein Contract-Typ, aber isomorph und von
// Schreibweg (B14-2) wie DB-Gate gebraucht — deshalb hier und nicht in `engine` (Rechenkern).
export * from './archive'
// B14-2: das Analyse-Bündel — EIN Austauschformat für Rechner (Export) und Admin (Upload). Steht
// bewusst neben `archive.ts`: beide Seiten importieren dieselbe Definition, es gibt keine zweite
// Beschreibung desselben Formats.
export * from './analysis-bundle'
// B11: die Tarifsatz-Datenschicht (Vorgabewerte je Netzbetreiber/Netzebene). Liegt hier und nicht
// in `engine`, weil der Rechenkern sie NICHT lesen darf — Konfiguration an den Rändern,
// Determinismus im Kern. Dieselbe Aufteilung wie beim `DEMO_BATTERY_CATALOG`: ein Katalog, den die
// App der Engine als Parameter hineinreicht. Abgesichert durch
// `packages/engine/src/tariff/no-catalog-dependency.test.ts`.
export * from './tariff-catalog'
// Delta 15 (Regeln A und B): das Zeitfenster einer Analyse und seine Untergrenze. Steht hier und
// nicht in `engine`, weil der Rechenkern mit dem Profil rechnet, das er bekommt — WELCHES Profil er
// bekommen darf, entscheiden die Ränder (Upload-Schritt). Dieselbe Aufteilung wie bei `tariff-catalog`.
export * from './analysis-window'
// Delta 4 (B21-3b): die Eingaben des kombinierten Intervallpreises — Netzbetreiber-Tarifzeilen und
// Marktpreis-Reihe. Aus demselben Grund hier wie `tariff-catalog`: der Rechenkern bekommt sie als
// PARAMETER und darf die Datenschicht nicht kennen (Wächter in `engine/src/tariff/`).
export * from './tariff-pricing'
// Delta 16b: das Name/Firma-Gate vor dem Report-Download — Herkunftsschlüssel, Einwilligungszweck
// und die EINE Prüfregel für Formular (Rückmeldung), Server Action (Wahrheit) und DB-Gate
// (Abgleich mit `platform.lead_sources`). Bewusst importfrei; Begründung im Kopf der Datei.
export * from './report-gate'
