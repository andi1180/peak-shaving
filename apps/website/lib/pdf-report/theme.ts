/**
 * B23a — Farb- und Typografie-Tokens des react-pdf-Reports.
 *
 * ── ⚠ WARUM HIER HEX-WERTE STEHEN, OBWOHL DESIGN.md KEIN HEX IM CODE DULDET ─────────────────────
 * `@react-pdf/renderer` kennt weder CSS-Variablen noch `color-mix()`. Der Spike hat das gemessen
 * (§2.1, „Falle 1"): ein `fill="var(--color-accent)"` löst in einem freistehenden PDF-Kontext NICHT
 * auf — und zwar ohne Fehlermeldung, das Element käme schlicht unbemalt heraus. Es gibt hier also
 * keine Wahl; die Frage ist nur, ob die Werte an EINER Stelle stehen oder verstreut.
 *
 * Sie stehen an einer Stelle. Jeder Wert ist die WÖRTLICHE Entsprechung des gleichnamigen Tokens
 * aus `apps/website/app/globals.css` — dort bleibt die Wahrheit, hier steht die Abschrift für einen
 * Kontext, der die Wahrheit nicht lesen kann.
 *
 * ⚠ WER EIN TOKEN IN `globals.css` ÄNDERT, ÄNDERT ES HIER MIT. Es gibt dafür bewusst KEINEN
 * automatischen Abgleich: ein Test, der `globals.css` parst, wäre ein CSS-Parser im Testlauf für
 * sieben Zeichenketten. Der Kopf dieser Datei ist die Bremse.
 *
 * ── DER AKZENT IST HIER NICHT WHITE-LABEL-FÄHIG, UND DAS IST KEINE REGRESSION ───────────────────
 * `--color-accent` ist am Bildschirm überschreibbar (DESIGN.md). Ein PDF trägt kein Stylesheet des
 * Betrachters; der Wert wird beim Erzeugen eingebrannt. Sobald White-Label real wird (MVP §7,
 * heute `[v2]` — `platform.partners` trägt weder Logo noch Farbe), wandert dieses Objekt von einer
 * Konstante zu einem Parameter des Dokuments. Bis dahin ist es COOLiNs Marke, wie der bestehende
 * Druck-Report auch.
 */

/** Statische Assets der EIGENEN Herkunft — s. D6 des Deltas (Fontweg: URL-Fetch, keine Data-URI im Bündel). */
const PDF_FONT_BASE = '/report-fonts'

/**
 * Die Schriftdateien des Reports — Pfad und Gewicht je Schnitt.
 *
 * ── ⚠ WARUM DIESE LISTE IN `theme.ts` STEHT UND NICHT IN `fonts.ts` ────────────────────────────
 * Sie hat seit B23b ZWEI Konsumenten: `fonts.ts` registriert sie bei `@react-pdf/renderer`, und
 * `chart-raster.ts` bettet dieselben Dateien als Data-URI in das serialisierte Chart-SVG ein (dort
 * gibt es kein Stylesheet der Seite, s. den Kopf jener Datei). Zweimal ausgeschrieben liefen die
 * beiden auseinander — und dann stünde im PDF ein Chart in einer anderen Schrift neben nativem
 * Text, ohne dass irgendetwas fehlschlüge. `fonts.ts` zieht `@react-pdf/renderer`; `theme.ts` tut
 * das nicht und ist deshalb der Ort, den beide lesen können.
 *
 * Die Dateien liegen als WOFF unter `public/report-fonts/` — woff2 verarbeitet fontkit nicht
 * (Spike §2.2, „Falle 2"), und `next/font` liefert ausschliesslich woff2.
 */
export const PDF_FONT_SOURCES = [
  { src: `${PDF_FONT_BASE}/Inter-Regular.woff`, fontWeight: 400 },
  { src: `${PDF_FONT_BASE}/Inter-SemiBold.woff`, fontWeight: 600 },
  { src: `${PDF_FONT_BASE}/Inter-Bold.woff`, fontWeight: 700 },
] as const

/** Wörtliche Abschrift der Tokens aus `app/globals.css`. */
export const PDF_COLORS = {
  /** `--color-navy` — Wortmarke/Emblem-Grund. Trägt COOLiNs Marke, NICHT den White-Label-Akzent. */
  navy: '#18336f',
  onNavy: '#ffffff',
  /** `--color-accent` (Teal 700). */
  accent: '#0f766e',
  /** `--color-ink` (Slate 900) — Überschriften. */
  ink: '#0f172a',
  /** `--color-text` (Slate 800) — Fliesstext. */
  text: '#1e293b',
  /** `--color-text-muted` (Slate 600) — Sekundärtext. */
  textMuted: '#475569',
  /** `--color-border` (Slate 200). */
  border: '#e2e8f0',
  /** `--color-surface-alt` (Slate 50). */
  surfaceAlt: '#f8fafc',
} as const

/**
 * Die Seitengeometrie. Kopf- und Fusszeile liegen ABSOLUT positioniert im Seitenrand; die
 * Innenabstände der Seite müssen ihnen deshalb Platz freihalten — sonst läuft der Fliesstext
 * darunter hindurch. Die Zahlen hängen also zusammen und stehen aus genau diesem Grund beieinander.
 *
 * Einheit ist überall pt (react-pdf rechnet in pt; A4 = 595 × 842 pt).
 */
export const PDF_LAYOUT = {
  pageHorizontal: 48,
  /** Muss > `headerTop + headerHeight` sein. */
  pageTop: 78,
  /** Muss > `footerBottom + footerHeight` sein. */
  pageBottom: 62,
  headerTop: 30,
  headerHeight: 26,
  footerBottom: 26,
  /**
   * Der Platz, den die Fusszeile TATSÄCHLICH einnimmt (Trennlinie + Zeile). Sie wird nicht auf eine
   * feste Höhe gezwungen — der Wert steht hier, weil `pageBottom` ihn freihalten muss; wer die
   * Fusszeile um eine Zeile erweitert, zieht ihn und `pageBottom` gemeinsam nach.
   */
  footerHeight: 22,
} as const

/** Schriftgrade. Ein Report, kein Prospekt: wenige Stufen, klarer Abstand dazwischen. */
export const PDF_TYPE = {
  family: 'Inter',
  cover: 26,
  coverSub: 12,
  h2: 14,
  h3: 9.5,
  body: 9.5,
  small: 8.5,
  footer: 7,
} as const
