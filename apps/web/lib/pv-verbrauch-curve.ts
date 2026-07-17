/*
 * Synthetischer Beispiel-Tag „PV-Erzeugung vs. Verbrauch" für die Hero-Grafik
 * auf /leistungen/pv-speicher (Prompt 16). Zwei Kurven — PV-Erzeugung
 * (glockenförmig, Sonnenstunden) und ein typisches Gewerbeprofil (flacher, mit
 * leichten Morgen-/Abend-Anteilen) — plus die punktweise Überlappung
 * (`eigenverbrauch = min(erzeugung, verbrauch)`), das visuelle Kernargument
 * der Grafik: Was beide Kurven gemeinsam abdecken, muss nicht zugekauft werden.
 *
 * Werte sind SCHEMATISCH, relative Einheit (§9.5 — keine Kundenmessung, kein
 * Rechenergebnis, keine erfundene kWh-Zahl). Bewusst deterministisch (keine
 * Zufallszahlen) — Server- und Client-Render müssen identisch sein.
 *
 * KEINE Lastspitze/Kappungsschwelle hier: anderes Thema (Peak Shaving, s.
 * `lib/example-load-curve.ts`). Diese Grafik zeigt ausschließlich Erzeugung
 * gegen Verbrauch.
 */

export type PvVerbrauchPoint = {
  hour: number
  erzeugung: number
  verbrauch: number
  eigenverbrauch: number
}

/**
 * [Erzeugung, Verbrauch] je Stunde (relative Einheit), Index = Stunde (0–23).
 * Erzeugung: 0 außerhalb der Sonnenstunden, Glockenkurve 7–18 Uhr.
 * Verbrauch: durchlaufende Grundlast (Kühlung, Standby) + Geschäftsbetrieb mit
 * sanften Morgen-/Abend-Übergängen (6/19 Uhr) — bewusst FLACH gegenüber der
 * PV-Kurve, der Kontrast dazu ist die Aussage der Grafik.
 */
const HOURLY: [erzeugung: number, verbrauch: number][] = [
  [0, 18], // 00
  [0, 18], // 01
  [0, 18], // 02
  [0, 18], // 03
  [0, 18], // 04
  [0, 18], // 05
  [0, 38], // 06 — Rampe Richtung Geschäftsbetrieb
  [11, 58], // 07
  [29, 58], // 08
  [46, 58], // 09
  [62, 58], // 10
  [73, 58], // 11
  [79, 58], // 12
  [79, 58], // 13
  [73, 58], // 14
  [62, 58], // 15
  [46, 58], // 16
  [29, 58], // 17
  [11, 58], // 18
  [0, 38], // 19 — Rampe zurück, Sonnenuntergang
  [0, 18], // 20
  [0, 18], // 21
  [0, 18], // 22
  [0, 18], // 23
]

export const PV_VERBRAUCH_DATA: PvVerbrauchPoint[] = HOURLY.map(([erzeugung, verbrauch], hour) => ({
  hour,
  erzeugung,
  verbrauch,
  eigenverbrauch: Math.min(erzeugung, verbrauch),
}))
