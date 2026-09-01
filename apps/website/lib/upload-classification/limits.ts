/**
 * Die Grenzen der Dokument-Zuordnung — Grösse einer Datei und Länge der Bezeichnung.
 *
 * ── ⚠ WARUM SIE NICHT IM CLIENT-MODUL STEHEN (und das ist ein gemessener Befund) ──────────────
 * Naheliegend wäre, sie neben `createUploadClassificationClient` zu legen; die beiden bestehenden
 * Anbindungen tun das (`MAX_INVOICE_FILE_BYTES` in `invoice-scan/ai-client.ts`). Genau daraus
 * entsteht aber eine Lücke in der ESLint-Bremse: die Server Action muss die Grösse kennen, zieht
 * dafür `./ai-client` — und diese RELATIVE Schreibweise erfasst die Pfad-Sperre nicht (sie kennt
 * nur `@/lib/…`). Beim Bau von Delta 17 als Probe nachgewiesen.
 *
 * Getrennt gelegt, kostet die Sperre nichts: die Action importiert eine Datei, die keinen Schlüssel
 * lesen kann, und der Client bleibt für ALLE anderen Dateien gesperrt — auch relativ.
 */

/**
 * Obergrenze der eingeordneten Datei in Bytes.
 *
 * ⚠ Der Wert ist ABSICHTLICH derselbe wie `MAX_INVOICE_FILE_BYTES` (6 MB) und wird bewusst NICHT
 * von dort importiert: `@/lib/invoice-scan/ai-client` ist für dieses Verzeichnis gesperrt, und die
 * Sperre für einen Zahlenwert aufzuweichen gäbe ihm zugleich den Schlüssel. Die beiden Zahlen
 * MÜSSEN zusammenbleiben — eine hier grosszügigere Grenze liesse eine Datei durch die Zuordnung,
 * die der Rechnungs-Scan gleich darauf mit `too_large` abweist, und der Nutzer bekäme die Absage
 * erst nach der Bestätigung, für die er sich schon entschieden hat.
 */
export const MAX_UPLOAD_CLASSIFICATION_FILE_BYTES = 6 * 1024 * 1024

/**
 * Obergrenze der Bezeichnung, die der Nutzer der Zeile gegeben hat.
 *
 * Die Bezeichnung ist Freitext und geht mit in den Aufruf (sie ist der halbe Hinweis: „Rechnung
 * 01/25" sagt mehr als jede Seitenzahl). Sie wird deshalb hart gekürzt, bevor sie das Haus
 * verlässt — nicht aus Kostengründen, sondern weil ein beliebig langer Text im Prompt der Ort ist,
 * an dem jemand versucht, die Anweisung zu überschreiben. Was das Modell antworten DARF, begrenzt
 * ohnehin das Schema (drei Wahrheitswerte); die Kürzung nimmt dem Versuch zusätzlich den Platz.
 */
export const MAX_UPLOAD_LABEL_CHARS = 120
