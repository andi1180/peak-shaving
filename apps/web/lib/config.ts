/**
 * Ziele außerhalb dieser App — an EINER Stelle, nicht verstreut im JSX.
 */

/**
 * Der aktuell echte, laufende Peak-Shaving Kalkulator: `apps/website` im selben
 * Monorepo, deployed als eigenständige Vercel-App. Er läuft parallel weiter und
 * ist keine Baustelle (Pflichtenheft §8.1).
 *
 * WARUM EXTERN: `apps/web` importiert bewusst weder `packages/engine` noch die
 * Kalkulator-UI — die Engine gehört dem Pro-Kalkulator, ihr Import würde die
 * Grenze Teaser/Pro (§5.4) verwischen und den Rechenkern ins Marketing-Bundle
 * ziehen. Deshalb läuft der Rechner im iframe statt als Route-Import.
 *
 * PHASE 2 (§8.1): Sobald der Pro-Kalkulator im Portal hinter Login läuft, wird
 * `apps/website` abgelöst. Dann fällt das iframe weg und die eingebettete Route
 * rendert den Rechner direkt. Deshalb steht die URL hier: ein Fundort, ein Umbau.
 */
export const EXTERNAL_CALCULATOR_URL = 'https://peak-shaving-website-ten.vercel.app/'

/**
 * Die iframe-Quelle für `/peak-shaving/kalkulator/rechner`.
 *
 * Zeigt EXAKT auf den Rechner-Flow (`/rechner`), NICHT auf die App-Startseite —
 * wer den CTA klickt, will rechnen, nicht noch eine Marketing-Seite lesen.
 *
 * `?embed=1` schaltet in `apps/website` das App-eigene Chrome (dortiger Header
 * mit „Peak Shaving Kalkulator") ab: im Rahmen tragen coolin.at-Header und
 * -Footer die Marke, eine zweite Headline daneben wäre eine konkurrierende.
 * Der Modus ist dort in `app/rechner/page.tsx` dokumentiert.
 *
 * `new URL(relativ, basis)` statt String-Verkettung: `EXTERNAL_CALCULATOR_URL`
 * endet auf „/", ein `+ '/rechner'` ergäbe die kaputte Doppel-Slash-URL
 * `…vercel.app//rechner`. Die URL-Klasse löst das korrekt auf und normalisiert
 * sie — der Trailing-Slash der Konstante darf sich ändern, ohne dass es bricht.
 */
export const EMBEDDED_CALCULATOR_SRC = new URL(
  'rechner?embed=1',
  EXTERNAL_CALCULATOR_URL,
).toString()

/**
 * Höhe der Rechner-Fläche unterhalb des Headers (`rechner/page.tsx`).
 *
 * Die Konstante entstand in Prompt 26, weil das damalige Soft-Gate an derselben
 * Stelle eine leere Fläche EXAKT dieser Höhe zeigte (sonst sprang beim
 * Entsperren das Layout). Seit B10-2 gibt es weder Gate noch zweiten Nutzer:
 * Wer keinen Zugang hat, sieht eine eigene Seite, keinen Platzhalter in
 * Rechnergrösse. Sie bleibt als benannte Höhe der Rechner-Fläche bestehen.
 */
export const CALCULATOR_FRAME_STYLE = {
  height: 'calc(100dvh - var(--header-h))',
  minHeight: '40rem',
} as const
