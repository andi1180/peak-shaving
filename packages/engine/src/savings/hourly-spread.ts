/**
 * D6 Teil 2a — eine Tagesmenge flach auf 24 Stunden verteilen.
 *
 * Gedacht als Eingang für die Bewertung einer HOCHGERECHNETEN Menge mit Stundenpreisen: für die
 * fehlenden Tage aus `estimateAnnualConsumption` gibt es keine gemessene Tageskurve, und eine
 * erfundene (typisches Lastprofil, Nachbartag) wäre eine zweite Schätzung über der ersten. Die
 * flache Verteilung behauptet nichts, was nicht in der Tagesmenge schon steht.
 *
 * ⚠ Sie ist damit ausdrücklich KEIN Lastprofil und darf keines ersetzen: wo echte Viertelstunden
 * vorliegen, wird mit ihnen gerechnet.
 */

/** Stunden eines Tages — die Länge des Ergebnisses. */
const HOURS_PER_DAY = 24

/**
 * `kwhPerDay` gleichmässig auf 24 Stundenwerte (kWh je Stunde).
 *
 * ⚠ Der LETZTE Wert trägt den Rundungsrest und ist deshalb um bis zu ein paar 1e-16 von den
 * übrigen 23 verschieden. Das ist Absicht: `kwhPerDay / 24` 24-mal aufaddiert ergibt in
 * Fliesskomma NICHT wieder `kwhPerDay` (gemessen: 365 → 364,99999999999994), und eine
 * Energiemenge, die sich beim Verteilen ändert, wäre in einer Jahresrechnung ein stiller
 * Fehlbetrag. Erhaltung der Menge geht hier vor bit-identischen Stunden.
 */
export function spreadDailyConsumptionHourly(kwhPerDay: number): number[] {
  if (!Number.isFinite(kwhPerDay) || kwhPerDay < 0) {
    throw new Error(`spreadDailyConsumptionHourly: ${kwhPerDay} ist keine gültige Tagesmenge in kWh.`)
  }

  const perHour = kwhPerDay / HOURS_PER_DAY
  const hours = new Array<number>(HOURS_PER_DAY)
  let assigned = 0
  for (let i = 0; i < HOURS_PER_DAY - 1; i += 1) {
    hours[i] = perHour
    assigned += perHour
  }
  hours[HOURS_PER_DAY - 1] = kwhPerDay - assigned
  return hours
}
