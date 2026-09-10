/**
 * Die Grenze des PV-Auslegungs-Scans.
 *
 * ── ⚠ WARUM SIE MIT DER KONSOLIDIERUNG AUS `ai-client.ts` HERAUSGEWANDERT IST ─────────────────
 * Wortgleiche Begründung wie bei `../invoice-scan/limits.ts`: der Barrel dieses Pakets muss die
 * Grenze exportieren (die Server Action prüft sie), und läge sie im Client-Modul, wäre der Barrel
 * ein zweiter Importeur des KI-Clients. Der eigene Kopf von `ai-client.ts` hatte die Lücke bis
 * hierher offengelegt und auf genau diesen Schritt verwiesen.
 *
 * Der Wert ist unverändert; es ist ein reines Verschieben.
 */

/**
 * Obergrenze der hochgeladenen Datei in Bytes.
 *
 * ⚠ Grösser als beim Rechnungs-Scan (6 MB), und der Grund ist die Dokumentart: eine Rechnung ist
 * ein bis wenige Seiten, ein PV-Exposé sind zwei Dutzend mit Diagrammen und Fotos (das
 * vorliegende: 19 Seiten, 18 Bild-XObjects, 1,1 MB). 8 MB ist dafür grosszügig und hält die
 * Anfrage weit unter der API-Grenze von 32 MB, auch nach der base64-Aufblähung um rund ein
 * Drittel.
 *
 * Der Wert ist die FACHLICHE Grenze; das `bodySizeLimit` in `apps/website/next.config.mjs` liegt
 * bewusst etwas darüber, damit die Anwendung ablehnt und mit einem Satz antwortet, statt dass die
 * Plattform die Anfrage vorher abschneidet (Muster aus B14-2).
 */
export const MAX_PV_DESIGN_FILE_BYTES = 8 * 1024 * 1024
