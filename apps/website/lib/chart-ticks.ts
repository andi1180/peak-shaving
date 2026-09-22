/**
 * Gleichmässige Achsen-Ticks für Achsen mit FEST gesetztem Wertebereich. (22.09.2026)
 *
 * ── ⚠ WARUM DAS ÜBERHAUPT NÖTIG IST ──────────────────────────────────────────────────────────
 * Recharts wählt seine Ticks auf zwei verschiedenen Wegen. Ohne `domain` bestimmt es Bereich UND
 * Schrittweite gemeinsam (`getNiceTickValues`) — das Ergebnis ist immer gleichmässig. Ist der
 * Bereich dagegen von aussen gesetzt, hält Recharts BEIDE Endpunkte fest und rundet nur die
 * inneren Ticks (`getTickValuesFixedDomain`): aus `[-70.000, 0]` werden -70k/-50k/-30k/-10k/0 —
 * die ersten drei Abstände 20k, der letzte 10k. Das Raster sieht dann aus, als sässe oben ein
 * halber Schritt, und lädt dazu ein, eine Stauchung in die Kurve hineinzulesen, die es nicht gibt.
 *
 * Die Reihenfolge ist deshalb hier umgekehrt: erst die Schrittweite wählen, dann den Bereich auf
 * ein Vielfaches davon aufrunden. Dadurch sind alle Abstände gleich, und eine 0 im Bereich liegt
 * automatisch exakt auf einem Tick (jeder Tick ist ein Vielfaches der Schrittweite) — was die
 * Nulllinien der Grenznutzen- und der Lastgang-Grafik brauchen.
 *
 * ── ⚠ DER `ticks`-PROP IST TRAGEND, NICHT DEKORATION ─────────────────────────────────────────
 * Es genügt NICHT, nur den aufgerundeten Bereich zu setzen: Recharts rechnet darin weiter mit
 * seiner eigenen `tickCount` und wird wieder ungleichmässig, sobald die nicht zufällig zu unserer
 * Schrittweite passt (an `[0, 150]` gemessen: 0/40/80/120/150). Bereich und Ticks gehören deshalb
 * zusammen an die Achse.
 *
 * ── ⚠ NICHT FÜR ZEITACHSEN ───────────────────────────────────────────────────────────────────
 * Die Millisekunden-Achsen (Lastgang, Energiefluss) zeigen denselben Effekt, aber nicht dasselbe
 * Problem: eine „runde" Schrittweite in Millisekunden ist kein runder Kalenderabstand und
 * beschriftete die Achse mit beliebigen Uhrzeiten. Dort sind ungleiche Abstände das kleinere Übel
 * — zumal die Charts des Reports nur waagrechte Gitterlinien zeichnen (`vertical={false}`), die
 * X-Ticks also gar kein Raster erzeugen.
 */

/** Mantissen, die ein Leser im Kopf weiterzählen kann. */
const STEP_MANTISSAS = [1, 2, 2.5, 5]

const MIN_TICKS = 3
const MAX_TICKS = 9

export type AxisTicks = { domain: [number, number]; ticks: number[] }

/**
 * Bereich und Ticks mit durchgehend gleicher Schrittweite.
 *
 * Gewählt wird unter allen runden Schrittweiten die, deren Tick-Zahl `tickCount` am nächsten
 * kommt; bei Gleichstand die, die den Bereich am wenigsten über die Daten hinaus aufbläht. Ohne
 * diesen zweiten Massstab gerät eine Achse, die die Null unsymmetrisch überspannt (Lastgang mit
 * Einspeisung, −12,6 bis 88,2 kW), auf eine so grobe Schrittweite, dass ein Drittel der Bildhöhe
 * leer bliebe.
 *
 * `null` für einen Bereich, den eine Achse nicht tragen kann (nicht-endlich, verdreht, oder ein
 * einziger Wert) — dort ist Recharts' eigene Behandlung besser als eine erfundene Spanne.
 */
export function evenAxisTicks(
  min: number,
  max: number,
  { tickCount = 5 }: { tickCount?: number } = {},
): AxisTicks | null {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null

  const exponent = Math.floor(Math.log10(max - min))
  let best: { step: number; loSteps: number; hiSteps: number; count: number; slack: number } | null = null

  for (let e = exponent - 2; e <= exponent + 1; e += 1) {
    for (const mantissa of STEP_MANTISSAS) {
      const step = mantissa * Math.pow(10, e)
      if (!(step > 0)) continue

      const loSteps = Math.floor(min / step)
      const hiSteps = Math.ceil(max / step)
      const count = hiSteps - loSteps + 1
      if (count < MIN_TICKS || count > MAX_TICKS) continue

      const candidate = { step, loSteps, hiSteps, count, slack: (hiSteps - loSteps) * step - (max - min) }
      const better =
        best == null ||
        Math.abs(count - tickCount) < Math.abs(best.count - tickCount) ||
        (Math.abs(count - tickCount) === Math.abs(best.count - tickCount) && candidate.slack < best.slack)
      if (better) best = candidate
    }
  }

  if (best == null) return null

  // Die Multiplikation mit der Schrittweite trägt Fliesskomma-Reste (3 × 0,1 = 0,30000000000000004),
  // die sonst im Tick-Text stünden. Auf die Stellenzahl der Schrittweite zurechtrunden.
  const decimals = Math.max(0, -Math.floor(Math.log10(best.step)) + 1)
  const ticks: number[] = []
  for (let i = best.loSteps; i <= best.hiSteps; i += 1) ticks.push(Number((i * best.step).toFixed(decimals)))

  return { domain: [ticks[0]!, ticks[ticks.length - 1]!], ticks }
}
