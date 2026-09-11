/**
 * Groessengrenze fuer eine Lastgang-Datei, die der Chat einliest.
 *
 * ── ⚠ WARUM SIE HOEHER LIEGT ALS BEI DEN VIER KI-EXTRAKTOREN ──────────────────────────────────
 * `MAX_INVOICE_FILE_BYTES` (6 MB) und `MAX_PV_DESIGN_FILE_BYTES` (8 MB) begrenzen, was als
 * Dokument-Block an ein Modell geht — dort ist die Grenze eine KOSTENBREMSE. Hier geht nichts
 * hinaus: der Leser ist rein und deterministisch, teuer ist allein das Parsen im Speicher. Ein
 * Jahres-Lastgang mit 35.040 Viertelstundenwerten und mehreren Zaehlpunkt-Spalten liegt als CSV
 * regelmaessig ueber 5 MB, als XLSX darueber.
 *
 * ⚠ SIE IST BEWUSST IDENTISCH MIT `DEFAULT_LIMITS.maxBytes` DER ENGINE (25 MB). Die Engine prueft
 * dieselbe Grenze selbst; hier steht sie als Zahl, die ein AUFRUFER lesen kann, BEVOR er eine Datei
 * durch den Leser schickt — laegen die zwei auseinander, waere die eine Ablehnung eine Ueberraschung
 * (die Anwendung liesse etwas zu, das die Engine gleich darauf verwirft, oder umgekehrt).
 *
 * ⚠ Die PLATTFORMGRENZE ist eine andere Zahl und liegt bei 24 MB (`bodySizeLimit` in
 * `apps/web/next.config.mjs`, B14-2). Eine Datei zwischen 24 und 25 MB scheitert deshalb AM RAND,
 * nicht an dieser Pruefung — die Anwendung meldet dann einen Plattformfehler statt eines Satzes.
 * Wer die Zahl hier hebt, hebt sie dort mit.
 */
export const MAX_LOAD_PROFILE_FILE_BYTES = 25 * 1024 * 1024
