/**
 * Ziele außerhalb dieser App — an EINER Stelle, nicht verstreut im JSX.
 */

/**
 * Der aktuell echte, laufende Peak-Shaving Kalkulator: `apps/website` im selben
 * Monorepo, deployed als eigenständige Vercel-App. Er läuft parallel weiter und
 * ist keine Baustelle (Pflichtenheft §8.1).
 *
 * WARUM EXTERN (und damit `target="_blank"`): `apps/web` importiert bewusst
 * weder `packages/engine` noch die Kalkulator-UI — die Engine gehört dem
 * Pro-Kalkulator, ihr Import würde die Grenze Teaser/Pro (§5.4) verwischen und
 * den Rechenkern ins Marketing-Bundle ziehen.
 *
 * PHASE 2 (§8.1): Sobald der Pro-Kalkulator im Portal hinter Login läuft, wird
 * `apps/website` abgelöst. Dann wird diese Konstante durch die konsolidierte
 * INTERNE Route ersetzt — und mit ihr fallen `target="_blank"`, das
 * „öffnet in neuem Tab"-Signal und der externe Hinweis auf der Produktseite weg.
 * Deshalb steht die URL hier: ein Fundort, ein Umbau.
 */
export const EXTERNAL_CALCULATOR_URL = 'https://peak-shaving-website-ten.vercel.app/'
