/**
 * Die Grenze des Rechnungs-Scans.
 *
 * ── ⚠ WARUM SIE MIT DER KONSOLIDIERUNG AUS `ai-client.ts` HERAUSGEWANDERT IST ─────────────────
 * Bis hierher stand sie dort (`MAX_INVOICE_FILE_BYTES` neben `createInvoiceScanClient`), und
 * `DEPLOYMENT.md`/CLAUDE.md führten die Folge als offene Lücke: die Server Action brauchte die
 * Zahl, zog dafür `./ai-client` — und diese RELATIVE Schreibweise erfasste die ESLint-Pfadsperre
 * nicht (in Delta 17 Teil 1 als Probe nachgewiesen). Der Vorsatz lautete, sie „für beide
 * Verzeichnisse gemeinsam in einem eigenen Schritt" herauszulösen.
 *
 * Dieser Schritt ist es, und er hatte keine Wahl: der Barrel dieses Pakets (`src/index.ts`) MUSS
 * die Grenze exportieren, weil `apps/website/lib/invoice-scan/actions.ts` sie prüft. Läge sie
 * weiterhin im Client-Modul, wäre der Barrel ein zweiter Importeur des KI-Clients — und die eine
 * Regel, die dieses Paket zusammenhält („nur `extract.ts` sieht den Client"), wäre am neuen Ort
 * schon beim Anlegen gebrochen. Die Auslagerung ist damit kein Aufräumen, sondern die Bedingung.
 *
 * Der Wert ist unverändert; es ist ein reines Verschieben.
 */

/**
 * Obergrenze der hochgeladenen Datei in Bytes.
 *
 * Die API nimmt Anfragen bis 32 MB; base64 bläht eine Datei um rund ein Drittel auf. Eine
 * Netzrechnung ist ein bis wenige Seiten — 6 MB ist dafür grosszügig und hält die Anfrage weit
 * unter jeder Plattformgrenze. Der Wert ist die FACHLICHE Grenze; das `bodySizeLimit` in
 * `apps/website/next.config.mjs` liegt bewusst etwas darüber, damit die Anwendung ablehnt und mit
 * einem Satz antwortet, statt dass die Plattform die Anfrage vorher abschneidet (Muster aus B14-2).
 *
 * ⚠ `MAX_UPLOAD_CLASSIFICATION_FILE_BYTES` MUSS mit diesem Wert zusammenbleiben — die Begründung
 * steht dort. Die beiden werden bewusst getrennt geführt und nicht voneinander importiert.
 */
export const MAX_INVOICE_FILE_BYTES = 6 * 1024 * 1024
