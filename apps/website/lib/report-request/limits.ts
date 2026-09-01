/**
 * Die Grenze der Report-Anfrage.
 *
 * ── ⚠ WARUM SIE NICHT IM CLIENT-MODUL STEHT ───────────────────────────────────────────────────
 * Von Anfang an getrennt, wie schon bei der Batterie-Erfassung (Delta 17 Teil 2): die ESLint-Bremse
 * auf den KI-Client greift nur, wenn KEIN Nachbar im selben Verzeichnis einen Grund hat, ihn zu
 * importieren. In Delta 17 Teil 1 wurde gemessen, dass ein RELATIVER Sibling-Import
 * (`./ai-client`) die Pfad-Sperre umgeht — die Server Action, die nur eine Zahl braucht, riss damit
 * die ganze Sperre auf. Hier gibt es diesen Grund gar nicht erst.
 */

/**
 * Obergrenze der Anfrage in Zeichen.
 *
 * Dieselbe Zahl wie bei der Batterie-Erfassung, und aus demselben Grund: erwartet wird ein Satz,
 * kein Aufsatz. „Rechne bitte mit 15 Jahren Betrachtungszeitraum, 5 % Förderung und einem
 * Steuersatz von 25 %" ist der Regelfall und soll vollständig durchgehen. Die Grenze ist trotzdem
 * hart: ein beliebig langer Text im Prompt ist der Ort, an dem jemand versucht, die Anweisung zu
 * überschreiben. Was das Modell antworten DARF, begrenzt ohnehin das Schema (acht Skalare plus
 * eine geschlossene Liste); die Kürzung nimmt dem Versuch zusätzlich den Platz.
 */
export const MAX_REPORT_REQUEST_CHARS = 400
