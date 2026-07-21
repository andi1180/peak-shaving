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
