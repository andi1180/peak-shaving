/*
 * Synthetischer Beispiel-Lastgang „vor/nach Kappung" — die EINE Datenquelle für
 * jedes Diagramm, das dieses Prinzip zeigt (Pflichtenheft §5.2a/§7.5, §9.5).
 *
 * Herausgezogen aus `components/peak-shaving/load-curve-chart.tsx` (dort lag die
 * Kurve ursprünglich allein), weil Prompt 14 eine zweite, kompaktere Ansicht
 * derselben Aussage braucht (Startseiten-Hero). ZWEI Diagramme mit derselben
 * Kurve zu zeigen ist die Aussage „ein Prinzip, zweimal erklärt"; zwei
 * UNABHÄNGIG erzeugte Kurven wären zwei verschiedene Behauptungen und liefen
 * Gefahr, auseinanderzulaufen. Die Werte sind SYNTHETISCH (§9.5) — keine
 * Kundenmessung, kein Rechenergebnis.
 *
 * Bewusst deterministisch (keine Zufallszahlen): Server- und Client-Render
 * müssen identisch sein, sonst wirft React einen Hydration-Mismatch.
 */

/** Kappungsschwelle des Beispiels (kW). */
export const CAP_KW = 140

/** Viertelstunden-Raster: 96 Slots = ein Tag — dasselbe Raster wie ein echter Lastgang. */
export const SLOTS_PER_DAY = 96

/**
 * Beispiellast (kW) je Viertelstunden-Slot.
 *
 * Die Welligkeit kommt aus zwei Sinus-Termen — echte Lastgänge sind nie glatt,
 * eine lineal-gerade Linie würde eine Präzision suggerieren, die es nicht gibt.
 */
export function exampleLoadKw(slot: number): number {
  const hour = slot / 4

  // Grundlast (Kälte, Lüftung, Server) — läuft rund um die Uhr durch.
  let kw = 40
  // Geschäftsbetrieb.
  if (hour >= 5.5 && hour < 19.5) kw += 52
  // Mittagszusatzlast.
  if (hour >= 11 && hour < 14) kw += 22
  // Der Anlauf am frühen Morgen: kurz, hoch, kostenbestimmend. Als Rampe
  // (Sinus-Bogen) statt als flaches Rechteck — Geräte laufen an und klingen
  // ab; ein Kasten sähe konstruiert aus.
  if (hour >= 5.75 && hour < 7.25) {
    kw += 168 * Math.sin(Math.PI * ((hour - 5.75) / 1.5)) ** 1.6
  }
  // Zweite Erhebung am Nachmittag — bleibt UNTER der Schwelle und kostet nichts
  // extra. Sie steht hier, damit sichtbar wird: nicht jede Erhebung ist eine Spitze.
  if (hour >= 16 && hour < 18) {
    kw += 34 * Math.sin(Math.PI * ((hour - 16) / 2))
  }

  kw += 6 * Math.sin(slot * 1.7) + 3 * Math.sin(slot * 0.53)
  return Math.round(kw * 10) / 10
}

export type ExampleLoadPoint = { slot: number; before: number; after: number }

/**
 * Modulweit einmal gerechnet, nicht je Render: Die Daten sind konstant, und ein
 * `useMemo` je Instanz wäre nur Zeremonie um eine reine Funktion.
 */
export const EXAMPLE_LOAD_DATA: ExampleLoadPoint[] = Array.from(
  { length: SLOTS_PER_DAY },
  (_, slot) => {
    const before = exampleLoadKw(slot)
    return { slot, before, after: Math.min(before, CAP_KW) }
  },
)

/** Slot → „06:15" (auch für den angehängten Schlusspunkt bei slot=96 → „24:00"). */
export function slotToTime(slot: number): string {
  const h = Math.floor(slot / 4)
  const m = (slot % 4) * 15
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
