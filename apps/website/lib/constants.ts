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

/**
 * Delta 16b / §5.1 — die Datenschutzerklärung. PFLICHT-Link an der Einwilligung: §5.1 verlangt die
 * Ankreuzmöglichkeit ausdrücklich „mit Link zur Datenschutzerklärung".
 *
 * ABSOLUT, mit `www`, aus demselben Grund wie `WARTELISTE_URL` darüber: der Rechner ist eine eigene
 * Anwendung auf einer eigenen Herkunft und läuft auf coolin.at zusätzlich im iframe. Ein relativer
 * Pfad zeigte auf den Rechner selbst, wo es die Seite nicht gibt; ohne `www` käme eine Weiterleitung.
 * Er öffnet in einem neuen Tab — aus dem iframe heraus wäre er sonst nicht sichtbar, und ein Klick
 * auf den Datenschutzlink darf ausserdem NIE das halb ausgefüllte Formular verwerfen.
 */
export const DATENSCHUTZ_URL = 'https://www.coolin.at/datenschutz'

/**
 * Delta 9b-1 — Zeitzone der Tagesform eines synthetischen Standardlastprofils.
 *
 * Der Generator verlangt sie als Pflichtparameter (eine stillschweigend angenommene Zeitzone wäre
 * eine zweite Wahrheit neben der des Parsers). Für einen österreichischen Kunden ist es dieselbe,
 * auf die auch der Parser zurückfällt (`DEFAULT_TZ` in `packages/engine/src/parser/parse.ts`) —
 * bewusst NICHT die des Browsers: ein Kunde im Urlaub bekäme sonst ein anderes Lastprofil.
 */
export const STANDARD_PROFILE_TIMEZONE = 'Europe/Vienna'

/**
 * ⚠ VORLÄUFIG, offen für Martin (Delta 14 Punkt 9) — ab welcher Länge eine zusammenhängend
 * interpolierte Datenlücke im Report eigens benannt wird.
 *
 * 4 Wochen × 7 Tage × 96 Viertelstunden = 2.688 Slots. Der Wert ist eine nachvollziehbare
 * Setzung, KEINE fachliche Festlegung: welche Lücke einen Lastgang unbrauchbar macht, hängt am
 * Abrechnungsmodell (bei `monthly_*` kann ein einziger fehlender Monat die Mittelung tragen, bei
 * `annual_max` genügt die eine Woche, in der die Jahresspitze lag). Ein Monat ist die kleinste
 * Lücke, die unter JEDEM der geführten Modelle sicher wehtut — deshalb diese Grösse und nicht
 * eine kleinere, die den Hinweis zur Dauerbegleitung machte.
 *
 * Wer den Wert ersetzt, ersetzt genau diese Zeile: die Auswertung steht an EINER Stelle
 * (`report.tsx`, `showLargeGapWarning`), und die Zahl selbst kommt aus dem Contract
 * (`dataQuality.largestGapSlots`), nicht aus einer zweiten Rechnung.
 */
export const LARGE_GAP_SLOTS_THRESHOLD = 4 * 7 * 96

/**
 * ⚠ [ANNAHME] Wirkungsgrad einer bestehenden Kundenanlage, wenn der Freitext keinen nennt.
 *
 * Eine Simulation braucht ihn zwingend (§3.6: die Physik rechnet mit Leistung, Energie UND
 * Wirkungsgrad) — anders als Kapazität und Leistung lässt er sich also nicht einfach weglassen,
 * ohne den ganzen Bestandsblock aufzugeben. 0,90 liegt in der Mitte dessen, was der Katalog führt
 * (0,88–0,91), und ist ein branchenüblicher Rundwert für einen Lithium-Speicher inklusive
 * Wechselrichter-Verlusten.
 *
 * Er ist damit die EINZIGE Zahl des Bestandsblocks, die nicht vom Kunden stammt — und genau
 * deshalb wird sie in der Oberfläche als „angenommen" ausgewiesen und nicht als seine Angabe
 * getarnt (`ExistingBatteryInput.efficiencyAssumed`). Nennt der Kunde einen Wert, gilt seiner.
 */
export const ASSUMED_EXISTING_ROUND_TRIP_EFFICIENCY = 0.9
