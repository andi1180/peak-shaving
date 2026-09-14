/**
 * B24, Teil 1 — Barrel der Dateneingabe-Actions.
 *
 * Die eigentlichen Actions liegen stationsweise in `./data-entry-actions-*.ts`, s. dort. Diese
 * Datei leitet nur weiter, damit die Importe der Stations-Komponenten unverändert gültig bleiben.
 *
 * ⚠ `./data-entry-actions-shared` wird bewusst NICHT re-exportiert: es trägt Konstanten und
 * synchrone Helfer und ist rein intern. Hier re-exportiert wäre jeder davon über den Barrel
 * erreichbar, obwohl ihn ausserhalb dieses Verzeichnisses niemand braucht.
 *
 * ⚠ KEIN `'use server'`. Die Direktive gehört in die Datei, in der eine Action DEFINIERT wird —
 * die sechs Stations-Dateien tragen sie je selbst. Hier stünde sie über einem `export *`, das Next
 * nicht statisch als „ausschliesslich asynchrone Exporte" prüfen kann.
 */
export * from './data-entry-actions-segment'
export * from './data-entry-actions-lastgang'
export * from './data-entry-actions-rechnung'
export * from './data-entry-actions-batterie'
export * from './data-entry-actions-pv'
export * from './data-entry-actions-tarif'
