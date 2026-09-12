/**
 * Die Grenzen der Marke/Typ-Recherche.
 *
 * ── ⚠ WARUM SIE NICHT IM CLIENT-MODUL STEHEN ──────────────────────────────────────────────────
 * Von Anfang an getrennt, wie bei den fünf Anbindungen davor und aus demselben Grund: die Sperre
 * auf den KI-Client greift nur, wenn KEIN Nachbar einen Grund hat, ihn zu importieren. Der Barrel
 * des Pakets MUSS die Grenzen exportieren (die Server Action prüft sie) — lägen sie im
 * Client-Modul, wäre der Barrel ein zweiter Importeur, und die eine Regel, die dieses Paket
 * zusammenhält, wäre schon beim Anlegen gebrochen. Seit dem Datenblatt-Scan (B24) setzt ESLint das
 * auch durch, und zwar ausdrücklich AUCH für den Barrel.
 */

/**
 * Wie oft die Websuche je Recherche höchstens laufen darf.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIE KOSTENBREMSE DIESES WEGS — und sie ist eine andere als bei den fünf Anbindungen davor
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Dort kostet ein Aufruf genau EINEN Modellaufruf über einer Datei bekannter Grösse. Hier
 * entscheidet das Modell SELBST, wie oft es sucht, und jede Suche kostet zusätzlich Geld — bei
 * Anthropic 10 USD je 1.000 Suchen. Schlimmer als der Suchpreis ist dabei, was die Treffer an
 * Eingabe-Tokens kosten: sie landen im Kontext. Am 12.09.2026 gegen die echte API gemessen (ein
 * realer Speichertyp, 5 Suchen): rund 57.000 Eingabe-Tokens für EINEN Vorschlag — also ungefähr
 * ein Zehntel Euro, ein Vielfaches eines Datenblatt-Scans.
 *
 * Ohne Obergrenze gäbe es dafür keine Decke: ein hartnäckig suchendes Modell kann auf einer
 * mehrdeutigen Eingabe beliebig weitermachen. Acht ist die Grössenordnung eines realen Anlasses
 * (die Messung brauchte fünf, die dynamische Filterung setzt mehrere Suchen parallel ab) mit etwas
 * Luft; es ist ausdrücklich KEINE Qualitätsaussage, sondern eine Decke.
 *
 * ⚠ SIE WIRD VOM SERVER DURCHGESETZT, nicht von uns: die API weist die überzählige Suche mit
 * `max_uses_exceeded` ab, und das Modell antwortet mit dem, was es bis dahin hat. Genau richtig —
 * ein Abbruch wäre schlechter als ein Ergebnis mit weniger Quellen.
 */
export const MAX_BATTERY_LOOKUP_SEARCHES = 8

/**
 * Längengrenze der beiden Eingaben (Hersteller, Modell) in Zeichen.
 *
 * Sie sind der erste NUTZERTEXT dieses Wegs, der ein Modell erreicht — und er löst hier nicht bloss
 * einen Aufruf aus, sondern eine Suche im offenen Web. Eine Typbezeichnung ist kurz; alles darüber
 * ist ein Satz, und ein Satz an dieser Stelle wäre der Versuch, die Suche zu steuern statt ein
 * Produkt zu benennen. Die Server Action KÜRZT auf diese Grenze, bevor irgendetwas hinausgeht.
 */
export const MAX_BATTERY_LOOKUP_INPUT_CHARS = 120
