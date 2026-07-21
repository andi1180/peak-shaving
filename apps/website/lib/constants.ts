// Geteilter Default zwischen Worker (Erstlauf) und Annahmen-Panel (§6.2, Reset-Ziel für
// `horizonYears`) — eine Quelle der Wahrheit statt zweier synchron zu haltender Literale.
export const DEFAULT_HORIZON_YEARS = 10

/**
 * B11 — Warteliste zum Leistungstarif 2027. Der einzige ehrliche Weg aus dem Rechner in den
 * Bestand: wo wir nicht rechnen können, bieten wir an, uns zu melden, sobald wir es können.
 *
 * ABSOLUTE Adresse mit `www`, und das ist kein Versehen: der Rechner (`apps/website`) ist eine
 * eigene Anwendung auf einer eigenen Herkunft und läuft auf coolin.at zusätzlich in einem iframe
 * (`/peak-shaving/kalkulator/rechner`). Ein relativer Pfad zeigte auf den Rechner selbst, wo es die
 * Seite nicht gibt; `coolin.at` ohne `www` beantwortet den Aufruf mit einer Weiterleitung. Der Link
 * öffnet deshalb in einem neuen Tab — aus dem iframe heraus wäre er sonst nicht sichtbar.
 */
export const WARTELISTE_URL = 'https://www.coolin.at/warteliste'
