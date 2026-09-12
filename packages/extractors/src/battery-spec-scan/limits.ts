/**
 * Die Grenze des Batterie-Datenblatt-Scans.
 *
 * ── ⚠ WARUM SIE NICHT IM CLIENT-MODUL STEHT ───────────────────────────────────────────────────
 * Von Anfang an getrennt, wie bei `battery-text` und `pv-design-scan` und aus demselben Grund: die
 * Sperre auf den KI-Client greift nur, wenn KEIN Nachbar einen Grund hat, ihn zu importieren. Der
 * Barrel des Pakets MUSS die Grenze exportieren (die Server Action prüft sie) — läge sie im
 * Client-Modul, wäre der Barrel ein zweiter Importeur, und die eine Regel, die dieses Paket
 * zusammenhält, wäre schon beim Anlegen gebrochen.
 */

/**
 * Obergrenze der hochgeladenen Datei in Bytes.
 *
 * ⚠ Grösser als beim Rechnungs-Scan (6 MB) und gleich dem PV-Auslegungs-Scan (8 MB), und der
 * Grund ist die Dokumentart: eine Rechnung ist ein bis wenige Textseiten, ein Batterie-Datenblatt
 * ist eine Produktbroschüre — Titelbild, Anwendungsdiagramme, Masszeichnungen, Kennlinien, oft
 * zwei- bis zwölfseitig und in derselben Grössenordnung wie ein PV-Exposé. Mit 6 MB würde ein
 * Herstellerprospekt regelmässig an unserer eigenen Grenze scheitern, obwohl die API ihn nähme.
 *
 * 8 MB hält die Anfrage weit unter der API-Grenze von 32 MB, auch nach der base64-Aufblähung um
 * rund ein Drittel. Der Wert ist die FACHLICHE Grenze; `serverActions.bodySizeLimit` in
 * `apps/web/next.config.mjs` (24 MB) liegt bewusst darüber, damit die Anwendung ablehnt und mit
 * einem Satz antwortet, statt dass die Plattform die Anfrage vorher abschneidet.
 */
export const MAX_BATTERY_SPEC_FILE_BYTES = 8 * 1024 * 1024
