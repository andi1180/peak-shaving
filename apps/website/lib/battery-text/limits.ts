/**
 * Die Grenze der Batterie-Freitexterfassung.
 *
 * ── ⚠ WARUM SIE NICHT IM CLIENT-MODUL STEHT ───────────────────────────────────────────────────
 * Von Anfang an getrennt, statt sie erst nachträglich herauszulösen: die ESLint-Bremse auf den
 * KI-Client greift nur, wenn KEIN Nachbar im selben Verzeichnis einen Grund hat, ihn zu
 * importieren. In Delta 17 Teil 1 wurde gemessen, dass ein RELATIVER Sibling-Import
 * (`./ai-client`) die Pfad-Sperre umgeht — die Server Action, die nur eine Zahl braucht, riss
 * damit die ganze Sperre auf. Hier gibt es diesen Grund gar nicht erst.
 */

/**
 * Obergrenze des Freitexts in Zeichen.
 *
 * Grosszügiger als die Zeilen-Bezeichnung aus Teil 1 (120), weil hier ein Satz erwartet wird und
 * kein Etikett — „Sungrow SBR128, 20 kWh nutzbar, ca. 10 kW, Wirkungsgrad rund 90 %, hat etwa
 * 480 EUR je kWh gekostet" ist der Regelfall und soll vollständig durchgehen. Die Grenze ist
 * trotzdem hart: ein beliebig langer Text im Prompt ist der Ort, an dem jemand versucht, die
 * Anweisung zu überschreiben. Was das Modell antworten DARF, begrenzt ohnehin das Schema (fünf
 * Skalare); die Kürzung nimmt dem Versuch zusätzlich den Platz.
 */
export const MAX_BATTERY_TEXT_CHARS = 400
