/**
 * Groessengrenze fuer eine PV-Erzeugungsdatei, die der Wizard einliest.
 *
 * ── ⚠ WARUM SIE DIESELBE ZAHL TRAEGT WIE DER LASTGANG-LESER ───────────────────────────────────
 * Nicht aus Bequemlichkeit: sie ist bewusst IDENTISCH mit `DEFAULT_LIMITS.maxBytes` der Engine
 * (25 MB), und der Grund ist derselbe wie bei `MAX_LOAD_PROFILE_FILE_BYTES` — die Engine prueft
 * dieselbe Grenze selbst, und laegen die zwei auseinander, waere die eine Ablehnung eine
 * Ueberraschung: die Anwendung liesse etwas zu, das die Engine gleich darauf verwirft, oder
 * umgekehrt.
 *
 * Eine KLEINERE Zahl waere fachlich begruendbar — eine Erzeugungsreihe traegt dieselbe Zahl an
 * Zeilen wie ein Lastgang (35.040 Viertelstundenwerte im Jahr), aber typischerweise weniger
 * Spalten. Sie kaufte hier allerdings nichts: wirksam ist ohnehin die kleinere von zwei Grenzen,
 * und das ist die ABLAGE (`MAX_PROJECT_DOCUMENT_BYTES`, 20 MB) — die Datei wird im Projekt
 * abgelegt, bevor ihre Metadaten am Zaehlpunkt landen. Eine dritte Zahl dazwischen waere eine
 * weitere Stelle, an der jemand die falsche nennt.
 *
 * ⚠ Die PLATTFORMGRENZE ist noch eine andere und liegt bei 24 MB (`bodySizeLimit` in
 * `apps/web/next.config.mjs`, B14-2). Wer die Zahl hier hebt, hebt sie dort mit — sonst scheitert
 * eine Datei zwischen 24 und 25 MB AM RAND, und die Anwendung meldet einen Plattformfehler statt
 * eines Satzes.
 *
 * ⚠ EIGENE KONSTANTE UND KEIN RE-EXPORT DER LASTGANG-ZAHL. Die zwei beschreiben verschiedene
 * Dateien, und sie duerfen sich unabhaengig bewegen: wer die PV-Grenze senkt, soll dabei nicht den
 * Lastgang mitziehen.
 */
export const MAX_PV_PROFILE_FILE_BYTES = 25 * 1024 * 1024
