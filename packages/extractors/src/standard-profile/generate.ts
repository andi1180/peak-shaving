import {
  standardProfileMetadata,
  type StandardProfileCustomerClass,
  type StandardProfileMetadata,
  type StandardProfileMetadataOutcome,
} from 'engine'

/**
 * B24, Teil 1 — DER STANDARDPROFIL-ZWEIG DES LASTGANG-SCHRITTS.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ EIN REINER RE-EXPORT, UND DAS IST DER GANZE ZWECK DIESER DATEI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Dieselbe Aufteilung wie beim Lastgang-LESER nebenan: die Ableitung liegt in `packages/engine`
 * (`standard-profile/metadata.ts`), hier steht nur die Brücke. Zwei Gründe, beide hart:
 *
 *   1. `apps/web` hängt bewusst NICHT an `packages/engine` — der Chat soll den Rechenkern nicht
 *      mitziehen (B24, zweiter Bauschritt). `packages/extractors` ist die Stelle, über die der
 *      Admin-Bereich an Engine-Fähigkeiten kommt, ohne diese Grenze aufzuweichen.
 *   2. Die einzige Falle der Ableitung — `coveredTo` als obere Kante eines HALBOFFENEN Bereichs —
 *      lässt sich nur am Ergebnis messen, und `packages/extractors` hat keinen Testlauf. Die
 *      Engine hat einen; dort steht die Regel und dort wird sie geprüft.
 *
 * ⚠ KEIN `import 'server-only'`, anders als bei jedem anderen Modul dieses Pakets: hier wird kein
 * Schlüssel gebraucht, kein Dokument gelesen und nichts übertragen — es ist reine, deterministische
 * Rechnung. Ein `server-only` machte sie für den öffentlichen Rechner strukturell unerreichbar,
 * obwohl sie dort (Delta 9b-1) längst läuft.
 *
 * ⚠ KEINE UMBENENNUNG UND KEINE ANPASSUNG DER TYPEN. Ein hier nachgebautes Union-Literal für die
 * Kundenklasse wäre eine zweite Wahrheit über dieselbe Wertemenge — und die erste, die beim
 * Hinzukommen eines G-Profils auseinanderliefe.
 */
export {
  /**
   * Erzeugt das Standardlastprofil und gibt AUSSCHLIESSLICH seine Metadaten zurück — die 35.040
   * Messwerte bleiben hinter dieser Paketgrenze, genau wie beim Leser nebenan die gelesenen.
   *
   * Der Name trägt hier das `generate`-Präfix der übrigen Adapter dieses Pakets (`readLoadProfile`,
   * `extractInvoice`, …): er sagt dem Aufrufer, dass etwas ENTSTEHT statt gelesen zu werden.
   */
  standardProfileMetadata as generateStandardProfileMetadata,
}
export type {
  StandardProfileCustomerClass,
  StandardProfileMetadata,
  StandardProfileMetadataOutcome,
}
