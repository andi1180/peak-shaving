/**
 * B24 — DIE KI-EXTRAKTOREN, KONSOLIDIERT. Ein Prompt je Dokumentart, zwei Aufrufer.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WARUM ES DIESES PAKET GIBT — und was der Zustand davor war
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Vier Extraktoren lagen bis hierher in `apps/website/lib/{invoice-scan,pv-design-scan,
 * battery-text,upload-classification}` und waren dort für den Formular-Wizard des öffentlichen
 * Rechners gebaut. Mit dem Projekt-Chat (`apps/web/lib/project-chat`) kam ein ZWEITER Aufrufer
 * dazu, der dieselben Dokumente lesen muss — und drei gemessene Gründe verhinderten den Import:
 *
 *   (a) Der Chat MUSS in `apps/web` liegen. Der Zugriffsschutz aller Projekt-Wrapper hängt an
 *       `auth.uid()` (`platform.project_accessible`), und eine angemeldete Sitzung gibt es nur
 *       dort — `apps/website` führt kein `@supabase/ssr`, keine Middleware, keinen Cookie-Client.
 *   (b) Die zwei Apps importieren einander NIE: kein Pfad-Alias, keine Workspace-Abhängigkeit,
 *       kein einziger Import über die Grenze.
 *   (c) Nach `packages/shared` können die Extraktoren nicht: `shared` wird in das CLIENT-Bündel
 *       des Rechners hineingebaut, und `import 'server-only'` bräche diesen Build hart.
 *
 * Der Chat behalf sich deshalb mit PORTS: `ProjectChatPorts.extractors` war ein handgeschriebener
 * Vertrag, den niemand erfüllen konnte, und die vier Werkzeuge wurden dem Modell schlicht nicht
 * angeboten. Der Chat konnte kein einziges Dokument auslesen.
 *
 * ── DIE AUFLÖSUNG: EIN EIGENES SERVER-ONLY-PAKET ──────────────────────────────────────────────
 * Es hebt (c) auf, ohne (a) oder (b) anzutasten. Beide Apps hängen daran, keine hängt an der
 * anderen. Die Prompts, die Schemata und die Auswertung existieren danach nachweisbar EINMAL —
 * und das ist der ganze Zweck: zwei Fassungen derselben Ableseregel laufen beim nächsten Umbau
 * auseinander, und dann liest derselbe Kunde je nach Einstieg eine andere Zahl von derselben
 * Rechnung.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIESER BARREL IST DER EINZIGE AUSGANG, UND DAS IST EINE HÄRTERE SPERRE ALS EINE ESLINT-REGEL
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `package.json` gibt unter `exports` ausschliesslich `.` frei. Ein
 * `import … from 'extractors/src/invoice-scan/ai-client'` löst deshalb GAR NICHT AUF — weder in
 * TypeScript (`moduleResolution: "Bundler"` wertet `exports` aus) noch in webpack. Die vier
 * KI-Clients sind von ausserhalb des Pakets nicht erreichbar, auch nicht versehentlich, und dafür
 * braucht es keine Regel, die jemand pflegen müsste.
 *
 * Was ESLint weiterhin durchsetzt, ist die Grenze INNERHALB des Pakets: einen KI-Client darf
 * ausschliesslich das `extract.ts` seines eigenen Verzeichnisses importieren — auch relativ
 * (`./ai-client`), denn genau diese Schreibweise erfasst eine Pfad-Sperre nicht (in Delta 17
 * Teil 1 als Probe nachgewiesen). Die Blöcke stehen in der root-`eslint.config.mjs`.
 *
 * ⚠ Deshalb steht in diesem Barrel KEIN Import auf ein `ai-client.ts`. Die Grössen- und
 * Längengrenzen, die die Server Actions prüfen, liegen ausnahmslos in `limits.ts` — für
 * `invoice-scan` und `pv-design-scan` ist das die Auflösung der Lücke, die Delta 17 offengelegt
 * und auf „einen eigenen Schritt" vertagt hatte. Sie war keine Aufräumarbeit, sondern die
 * Bedingung: läge eine dieser Konstanten weiterhin im Client-Modul, wäre dieser Barrel ein
 * zweiter Importeur des Clients und die Regel schon beim Anlegen gebrochen.
 *
 * ── ⚠ WAS HIER NICHT LIEGT, UND WARUM ─────────────────────────────────────────────────────────
 * `apps/website/lib/report-request` (Delta 18, übersetzt eine Report-Anfrage in
 * Neuberechnungs-Parameter) und `apps/web/lib/admin/tariff-scan` (B21-2b, liest ein Preisblatt für
 * die Admin-Pflege) sind NICHT mitgezogen. Beide haben genau EINEN Aufrufer in genau EINER App —
 * es gibt für sie keine zweite Fassung, die auseinanderlaufen könnte. Sie hierher zu holen wäre
 * Umzug ohne Anlass; die Zusammenlegung löst eine Doppelung, sie sammelt nicht Anbindungen ein.
 *
 * `apps/web/lib/project-chat/ai-client.ts` bleibt ebenfalls dort: das ist der Client der
 * Chat-SCHLEIFE, nicht eines Extraktors, und er trägt eine eigene Werkzeug-Obergrenze.
 *
 * ── ⚠ DIE VIER `actions.ts` SIND BEWUSST IN `apps/website` GEBLIEBEN ──────────────────────────
 * Sie tragen `'use server'`, prüfen die Datei (Grösse, Medientyp) und übersetzen den Ausgang in
 * eine Antwort für die Oberfläche. Eine Server Action ist ein HTTP-Endpunkt der App, in der sie
 * steht — sie gehört zu ihrem Aufrufer, nicht zur Ableselogik. Hier hätte sie einen zweiten,
 * öffentlich adressierbaren Weg in dieselben abrechenbaren Aufrufe geöffnet, und zwar aus BEIDEN
 * Apps. Verschoben ist ausschliesslich, was liest; wer fragen darf, entscheidet weiterhin die App.
 */

// ── Rechnungs-Scan (Delta 9b-2a) ──────────────────────────────────────────────────────────────
export { MAX_INVOICE_FILE_BYTES } from './invoice-scan/limits'
export { extractInvoiceData, type InvoiceScanOutcome } from './invoice-scan/extract'

// ── PV-Auslegungs-Scan (B22c) ─────────────────────────────────────────────────────────────────
export { MAX_PV_DESIGN_FILE_BYTES } from './pv-design-scan/limits'
export { extractPvDesign, type PvDesignScanOutcome } from './pv-design-scan/extract'

// ── Batterie-Freitexterfassung (Delta 17 Teil 2) ──────────────────────────────────────────────
export { MAX_BATTERY_TEXT_CHARS } from './battery-text/limits'
export { extractBatteryText, type BatteryTextOutcome } from './battery-text/extract'

// ── Dokument-Zuordnung (Delta 17 Teil 1) ──────────────────────────────────────────────────────
export {
  MAX_UPLOAD_CLASSIFICATION_FILE_BYTES,
  MAX_UPLOAD_LABEL_CHARS,
} from './upload-classification/limits'
export { classifyDocument, type UploadClassificationOutcome } from './upload-classification/extract'
