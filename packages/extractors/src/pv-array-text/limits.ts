/**
 * Die Grenze der PV-Anlagen-Freitexterfassung.
 *
 * ── ⚠ WARUM SIE NICHT IM CLIENT-MODUL STEHT ───────────────────────────────────────────────────
 * Von Anfang an getrennt, wie bei `../battery-text/limits.ts`: die ESLint-Bremse auf den KI-Client
 * (`eslint.config.mjs`, der Block für `packages/extractors/src/**`) greift nur, wenn KEIN Nachbar
 * im selben Verzeichnis einen Grund hat, ihn zu importieren — auch nicht der Barrel und auch nicht
 * die Server Action, die bloss eine Zahl braucht. Hier gibt es diesen Grund gar nicht erst.
 */

/**
 * Obergrenze des Freitexts in Zeichen.
 *
 * Dieselbe Zahl und dieselbe Begründung wie bei der Batterie-Freitexterfassung: erwartet wird ein
 * Satz und kein Etikett — „ca. 9,8 kWp auf dem Süddach, 30 Grad Neigung, seit 2021 in Betrieb" ist
 * der Regelfall und soll vollständig durchgehen. Die Grenze ist trotzdem hart: ein beliebig langer
 * Text im Prompt ist der Ort, an dem jemand versucht, die Anweisung zu überschreiben. Was das
 * Modell antworten DARF, begrenzt ohnehin das Schema (drei Felder); die Kürzung nimmt dem Versuch
 * zusätzlich den Platz.
 */
export const MAX_PV_ARRAY_TEXT_CHARS = 400
