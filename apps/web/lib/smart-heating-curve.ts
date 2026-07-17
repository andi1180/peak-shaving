/*
 * Synthetische Tageskurven „Konventionell vs. Smart Heating" für die Grafik im
 * ersten Inhaltsblock von /leistungen/smart-heating (Prompt 19).
 *
 * ZWEI Gesamtlast-Kurven, KEINE separat ausmodellierte zweite Lastart: jede
 * Kurve ist bereits „übrige Betriebslast + Heizlast" in einer Zahl je Stunde
 * (Vorgabe des Prompts — zwei Serien mit je zwei Anteilen würden die Grafik
 * überladen und die eine Aussage verwässern). Die Aussage steht in der FORM:
 *   - „Konventionell": Heizlast läuft ungesteuert über den ganzen Tag mit —
 *     der Tagesabschnitt liegt dadurch sichtbar höher als bei Smart Heating.
 *   - „Smart Heating": dieselbe Heizenergie läuft (näherungsweise) komplett
 *     im Nachtfenster 22–06 Uhr — die Tageskurve ist dadurch flacher/niedriger,
 *     die Nachtstunden zeigen dafür eine deutliche Ladespitze.
 *
 * Werte sind SCHEMATISCH, relative Einheit (§9.5 — keine Kundenmessung, kein
 * Rechenergebnis, keine erfundene kWh-Zahl). Bewusst deterministisch (keine
 * Zufallszahlen) — Server- und Client-Render müssen identisch sein.
 *
 * KEINE Kappungslinie/Kappungsschwelle: Das ist das Thema von Peak Shaving
 * (`lib/example-load-curve.ts`), nicht von dieser Seite — hier ist die
 * Verschiebung selbst der Mechanismus, keine Kappung.
 *
 * Drei Bausteine je Stunde, damit die Verschiebung nachvollziehbar bleibt statt
 * frei erfunden zu wirken:
 *   BUSINESS       — übrige Betriebslast, in BEIDEN Szenarien identisch.
 *   HEATING_CONV   — Heizlast „konventionell": läuft ganztägig mit, moderat
 *                    höher in den kälteren Morgen-/Abendstunden, aber nie null
 *                    — genau das ist die Aussage „auch tagsüber aktiv".
 *   HEATING_SMART  — dieselbe Heizenergie (Summe grob vergleichbar mit
 *                    HEATING_CONV, keine Verdopplung/kein Verlust — eine
 *                    VERSCHIEBUNG, keine zusätzliche Last), aber auf das
 *                    Nachtfenster 22–06 Uhr konzentriert; tagsüber (07–21) 0.
 */

export type SmartHeatingPoint = {
  hour: number
  conventional: number
  smartHeating: number
}

/** Übrige Betriebslast (relative Einheit) — identisch für beide Szenarien. */
const BUSINESS: number[] = [
  20, 20, 20, 20, 20, 20, 26, 36, 46, 50, 50, 50, 50, 50, 50, 50, 50, 46, 38, 30, 24, 20, 20, 20,
]

/** Heizlast „konventionell": ganztägig, sanftes Minimum mittags, nie null. */
const HEATING_CONV: number[] = [
  34, 35, 35, 34, 32, 30, 28, 26, 24, 22, 20, 19, 18, 18, 19, 20, 22, 25, 28, 31, 33, 34, 35, 35,
]

/** Heizlast „Smart Heating": Ladefenster 22–06 Uhr, tagsüber (07–21 Uhr) 0. */
const HEATING_SMART: number[] = [
  75, 90, 100, 100, 90, 70, 40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 25, 50,
]

export const SMART_HEATING_DATA: SmartHeatingPoint[] = BUSINESS.map((business, hour) => ({
  hour,
  conventional: business + (HEATING_CONV[hour] ?? 0),
  smartHeating: business + (HEATING_SMART[hour] ?? 0),
}))
