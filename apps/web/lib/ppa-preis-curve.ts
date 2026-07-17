/*
 * Synthetisches JAHRES-Preisschema „Spotmarktpreis vs. PPA-Preis" für die Grafik
 * im ersten Inhaltsblock von /leistungen/ppa (Prompt 20).
 *
 * ERSTE Grafik im Projekt mit JAHRES- statt Tagesachse: Die X-Achse ist ein
 * illustrativer Vertragshorizont „Jahr 1 bis Jahr 5" — KEINE echten Kalenderjahre.
 *
 * ZWEI Kurven, dieselbe relative Einheit:
 *   - „Spotmarktpreis": volatil, gezackt, mit leichtem Aufwärtstrend — das
 *     Marktpreis-Risiko. Über die Vertragslaufzeit schwankt er um den festen
 *     PPA-Preis und läuft im Trend über ihn hinaus (Preisrisiko nach oben).
 *   - „PPA-Preis": flach/stabil — ein über die Laufzeit fixierter Preis. Die
 *     Aussage steht in der FORM (ruhige Linie vs. Zacken), nicht in Zahlen.
 *
 * Werte sind SCHEMATISCH, relative Einheit (§9.5 — keine Kundenmessung, kein
 * Rechenergebnis, KEIN €/ct-Wert, KEIN historischer Preisverlauf, KEINE
 * Jahreszahl). Bewusst deterministisch (KEIN Math.random) — Server- und
 * Client-Render müssen identisch sein.
 *
 * KEINE Kappungslinie/Kappungsschwelle: Das ist das Thema von Peak Shaving
 * (`lib/example-load-curve.ts`), nicht von dieser Seite — hier geht es um die
 * Preissicherheit eines Abnahmevertrags, nicht um Lastspitzen.
 */

export type PpaPreisPoint = {
  /** Laufindex 0…29 — 6 Stützpunkte je Jahr über 5 Jahre. */
  step: number
  spot: number
  ppa: number
}

/** 6 Stützpunkte je Jahr × 5 Jahre — dicht genug für sichtbare Zacken,
 *  grob genug, dass die Zacken lesbar bleiben (kein Monats-Rauschen). */
export const STEPS_PER_YEAR = 6
export const YEARS = 5
const STEPS = STEPS_PER_YEAR * YEARS

/** Der über die Laufzeit fixierte PPA-Preis (relative Einheit) — flach. */
const PPA_LEVEL = 52

/**
 * Deterministische, gezackte Schwankung des Spotpreises (relative Einheit).
 * Fixe Tabelle mit wechselndem Vorzeichen und variabler Amplitude — cycled über
 * die Laufzeit, ergibt die „volatile" Zackenform. KEIN Math.random.
 */
const SPOT_JITTER = [5, -7, 9, -4, 6, -9, 4, -6, 8, -3, 7, -8]

export const PPA_PREIS_DATA: PpaPreisPoint[] = Array.from({ length: STEPS }, (_, i) => {
  // Leichter Aufwärtstrend über die Laufzeit: startet knapp unter dem PPA-Preis,
  // läuft im Trend darüber hinaus — das ist das Preisrisiko nach oben.
  const trend = 44 + (i / (STEPS - 1)) * 20
  const jitter = SPOT_JITTER[i % SPOT_JITTER.length] ?? 0
  return {
    step: i,
    spot: Math.round((trend + jitter) * 10) / 10,
    ppa: PPA_LEVEL,
  }
})

/** Tick-Positionen: Mitte jedes Jahres-Bands (0-indexiert). */
export const YEAR_TICKS = Array.from(
  { length: YEARS },
  (_, y) => y * STEPS_PER_YEAR + (STEPS_PER_YEAR - 1) / 2,
)

/** Tick-Wert → Jahresnummer 1…5. */
export function stepToYear(step: number): number {
  return Math.floor(step / STEPS_PER_YEAR) + 1
}
