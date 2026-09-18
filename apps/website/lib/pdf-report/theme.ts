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
  /**
   * Sekundärtext auf Navy (Deck- und Abschlussseite).
   *
   * ⚠ KEIN Token aus `globals.css` — dort gibt es keinen, weil der Bildschirm keine vollflächig
   * navyfarbene Fläche kennt. Der Wert ist GERECHNET und nicht gegriffen: 62 % Weissanteil über
   * `navy` (`24+0,62·231 = 167`, `51+0,62·204 = 177`, `111+0,62·144 = 200`). Kontrast gegen
   * `navy` **5,6:1** — über der WCAG-AA-Schwelle von 4,5:1 für Fliesstext.
   *
   * `textMuted` (#475569) wäre hier unbrauchbar: sein Kontrast gegen Navy liegt bei 1,5:1.
   */
  onNavyMuted: '#a7b1c8',
  /**
   * Der Akzent auf Navy.
   *
   * ⚠ NICHT `accent` (#0f766e): dessen Kontrast gegen `navy` beträgt gemessen **2,2:1** — auf einer
   * navyfarbenen Fläche unlesbar. Dieser Wert ist AUS DER EMBLEM-DATEI GEMESSEN
   * (`public/brand/coolin-emblem.png`, häufigster Ton der beiden Knotenpunkte, 911 teal-Pixel
   * ausgezählt) und damit die eigene Akzentfarbe der Marke statt einer hier erfundenen. Kontrast
   * gegen `navy` **5,6:1**.
   */
  accentOnNavy: '#2cc3c1',
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
  /**
   * Die drei SEMANTISCHEN Töne (B23c-1) — Farbe ist hier Information, kein Dekor (DESIGN.md).
   *
   * `positive` = Ersparnis · `negative` = Kosten · `warning` = ein Betrag, der in die falsche
   * Richtung zeigt (der reine Tarifwechsel ist im gemessenen Realfall negativ). Sie sind bewusst
   * NICHT durch den Akzent ersetzbar: der ist White-Label-Kandidat (s. Kopf), diese drei tragen
   * eine Bedeutung und dürfen sich mit einer Mandantenfarbe nicht mitverschieben.
   */
  positive: '#15803d',
  negative: '#b91c1c',
  warning: '#b45309',

  /* ── D15 Block 1: vier Werte aus dem Urbanz-Zielbild ─────────────────────────────────────────
   * Gemessen in `Report_Baukasten_Optik_Bestandsaufnahme.md` §2.1 — dort ist auch belegt, dass
   * das Zielbild ansonsten EXAKT die Palette oben benutzt. Diese vier sind alles, was fehlte.
   */

  /**
   * `--color-accent-subtle` (Teal 50) — die Fläche, auf der der Akzent als Callout liegt.
   *
   * ⚠ HEUTE OHNE KONSUMENT IM PDF, und das ist kein Versehen. Am Bildschirm trägt dieser Ton die
   * positiven Hinweisflächen; im Report kann er das nicht, weil `ReportNotice.tone` ausdrücklich
   * `Exclude<ReportTone, 'positive'>` ist (`statement.ts`) — ein Hinweis stellt fest, er freut
   * sich nicht. Die teal Kästen des Zielbildes sind dort `ReportStatement`s, und die tragen im
   * Report keine Fläche. Der Wert steht hier, weil er zur Palette gehört und sonst beim nächsten
   * Bedarf ein zweites Mal erfunden würde; verwendet wird er erst, wenn es einen Baustein gibt,
   * der ihn ehrlich tragen kann.
   */
  accentSubtle: '#f0fdfa',
  /**
   * Die Fläche des Warnhinweises (Amber 50) — das Gegenstück zu `accentSubtle`.
   *
   * ⚠ KEIN Token aus `globals.css`: dort gibt es `--color-accent-subtle`, aber kein
   * `--color-warning-subtle`. Der Wert ist damit PDF-eigen wie `onNavyMuted` und `accentOnNavy`.
   * Kontrast von `text` (#1e293b) darauf: 14,9:1.
   */
  warningSubtle: '#fffbeb',
  /**
   * Die Trennlinie auf der navyfarbenen Abschlussseite.
   *
   * ⚠ `border` (#e2e8f0) wäre dort ein heller Strich auf dunklem Grund und damit lauter als der
   * Text darüber; `onNavyMuted` war es bisher und ist dieselbe Farbe wie die Fusszeile selbst —
   * eine Linie soll leiser sein als das, was sie trennt. Dieser Wert ist Navy, um 26 % aufgehellt.
   */
  navyRule: '#2a4180',
  /**
   * Der helle Akzent-Ton der DIAGRAMME (Zielbild: „rechnerisches Optimum", „ohne PV").
   *
   * ⚠ HEUTE OHNE KONSUMENT, und er wird hier auch keinen bekommen: die Chart-Komponenten lesen
   * ihre Farben aus `globals.css` (CSS-Variablen), nicht aus diesem Objekt — sie werden als
   * Rasterbild eingebettet, nicht von react-pdf gezeichnet. Der Wert steht hier als ERGEBNIS der
   * Messung (Bestandsaufnahme §2.1: die Diagramme des Zielbildes benutzen genau EINEN Tint, der
   * heutige Chart-Satz vier ungleiche `color-mix()`-Aufhellungen). Wer den Chart-Strang baut,
   * legt ihn in `globals.css` an und räumt ihn hier weg.
   */
  chartTint: '#99d8d3',
} as const

/**
 * Die Seitengeometrie. Kopf- und Fusszeile liegen ABSOLUT positioniert im Seitenrand; die
 * Innenabstände der Seite müssen ihnen deshalb Platz freihalten — sonst läuft der Fliesstext
 * darunter hindurch. Die Zahlen hängen also zusammen und stehen aus genau diesem Grund beieinander.
 *
 * Einheit ist überall pt (react-pdf rechnet in pt; A4 = 595 × 842 pt).
 */
export const PDF_LAYOUT = {
  /**
   * ⚠ D15 Block 2, Punkt 9: 48 → 56,69 pt (= 20 mm). Der Satzspiegel war damit 499 pt breit und
   * die Zeilen entsprechend lang; das Zielbild setzt 481,9 pt (Bestandsaufnahme §2.3).
   *
   * ⚠ DAS ZIEHT DIE CHART-RASTERBREITE MIT — `PDF_CONTENT_WIDTH_PT` ist von diesem Wert
   * ABGELEITET und nicht daneben notiert, und `fitRasterToWidth` skaliert jedes eingebettete
   * Bild darauf. Die Rasterung selbst ändert sich nicht (dieselben Bildpunkte), nur die Breite,
   * in der sie im Blatt landet.
   */
  pageHorizontal: 56.69,
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

/**
 * Nutzbare Satzbreite einer A4-Seite unter diesem Layout: 595 pt − 2 × 48 pt.
 *
 * ⚠ Steht seit B23c-2 hier und nicht mehr in `chart-probe.tsx`: das Report-Dokument
 * (`document.tsx`) bettet Chart-Bilder in genau dieser Breite ein, und der Chart-Prüfstand tut
 * dasselbe. Zweimal ausgeschrieben wären es zwei Satzspiegel, und das Prüf-PDF bewiese dann eine
 * Einbettung, die es im Report so nicht gibt. `chart-probe.tsx` exportiert den Namen weiter.
 */
export const PDF_CONTENT_WIDTH_PT = 595 - 2 * PDF_LAYOUT.pageHorizontal

/**
 * D15 Block 2 — der gemeinsame Farbsatz der sieben Report-DIAGRAMME.
 *
 * ── ⚠ WARUM DIE WERTE JETZT STATISCH SIND UND NICHT MEHR `color-mix()` ─────────────────────────
 * Bis hierher rechnete sich JEDE Chart-Datei ihre Aufhellung selbst, und zwar in vier
 * verschiedenen Verhältnissen: 85 % und 65 % (`cost-chart`), 50 % (`monthly-tariff-chart`), 45 %
 * (`charge-price-chart`). Gemessen lagen die letzten beiden 6 von 255 Stufen auseinander — ein
 * Unterschied, den niemand sieht, der aber zwei verschiedene Reihen in zwei Diagrammen desselben
 * Reports verschieden aussehen liess. Vier Dateien, vier Wahrheiten, keine benannt.
 *
 * Jetzt steht die Leiter EINMAL hier, und die Dateien lesen sie. `color-mix()` kommt in keiner
 * Chart-Datei mehr vor.
 *
 * ⚠ Die Werte sind die bisherigen Mischungen in sRGB, kaufmännisch gerundet — also **dieselbe
 * Farbe auf höchstens eine Stufe je Kanal genau**, nicht bit-genau. Zwei der vier Mischungen
 * fallen rechnerisch auf eine halbe Stufe (50 %: 186,5 und 182,5), und dort rundet Chromium nicht
 * einheitlich; eine Behauptung „identisch" wäre an genau diesen Stellen falsch. Dieselbe Toleranz
 * gilt seit B23b für jede Farbstichprobe auf einen gemischten Ton.
 *
 * ── ⚠ WAS DAS KOSTET, UND WARUM ES TROTZDEM RICHTIG IST ────────────────────────────────────────
 * Statische Werte folgen einem überschriebenen `--color-accent` NICHT mehr. Für die Aufhellungen
 * war White-Label damit schon durch die Anforderung „statisch" entschieden — mit einem
 * gerechneten Zwischenton liesse er sich halten, aber eben nur um den Preis der vier
 * auseinanderlaufenden Verhältnisse. Die Grundfarbe der Reihen (`series`) bleibt der Akzent;
 * ändert ihn ein Mandant, stehen die Stufen daneben nicht mehr in seiner Familie. **Das ist der
 * offene Preis dieses Schritts**, und er gehört auf den Tisch, bevor White-Label real wird
 * (MVP §7, heute `[v2]`).
 *
 * ── ⚠ GRÜN UND ROT STEHEN HIER NICHT ───────────────────────────────────────────────────────────
 * DESIGN.md Zeile 51: „Grün/Rot/Bernstein sind reserviert für Ersparnis / Kosten / Warnung. Nicht
 * als Dekor verwenden, sonst verlieren sie ihre Signalwirkung." Laden und Entladen sind eine
 * RICHTUNG und keine Wertung — die divergierende Skala läuft deshalb Akzent ↔ Bernstein und nicht
 * Grün ↔ Rot, obwohl das Zielbild Letzteres zeigt.
 */
export const CHART_COLORS = {
  /** Die volle Stufe — identisch mit `PDF_COLORS.accent`. */
  series: '#0f766e',
  /** War `color-mix(… accent 85 %, surface)` — `cost-chart`, Segment „Eigenverbrauch". */
  seriesStrong: '#338b84',
  /** War `color-mix(… accent 65 %, surface)` — `cost-chart`, Segment „Tarifbewusstes Laden". */
  seriesMid: '#63a6a1',
  /** War `color-mix(… accent 50 %, surface)` — `monthly-tariff-chart`, mittlere Reihe. */
  seriesSoft: '#87bbb7',
  /** War `color-mix(… accent 45 %, surface)` — `charge-price-chart`, Reihe „Entladen zu". */
  seriesFaint: '#93c1be',

  /**
   * Die beiden Enden der divergierenden Skala (Heatmap, Tages-Batteriereihe).
   * Null liegt in der Mitte und ist `surface` — eine echte 0 ist damit sichtbar hell und nicht
   * weiss wie eine fehlende Zelle (die trägt weiterhin den gestrichelten Rand).
   */
  chargeEnd: '#0f766e',
  dischargeEnd: '#b45309',
  neutralEnd: '#ffffff',

  /**
   * Die Fläche eines MODELLwerts (D15 Block 2, Punkt 14) — im Zielbild die schraffierte Säule
   * „rechnerisches Optimum". Sie trägt die Aussage „Obergrenze, keine Prognose" im Bild selbst,
   * statt sie nur im Text daneben zu behaupten.
   */
  modelTint: '#99d8d3',
} as const

/**
 * Die Farbe einer Heatmap-Zelle auf der divergierenden Skala.
 *
 * ⚠ DIE EINZIGE STELLE, DIE NOCH RECHNET — und sie muss es: eine Heatmap ist eine stufenlose
 * Skala, ein Token je Zelle gäbe es nicht. Sie rechnet dafür an EINEM Ort statt in der Komponente,
 * und sie rechnet in sRGB wie `color-mix(in srgb, …)` es tat, damit der Wechsel die Farben nicht
 * nebenbei verschiebt.
 *
 * Untergrenze 4 %: eine echte 0 bleibt als hellste Stufe sichtbar und verschwimmt nicht mit einer
 * Zelle ohne Messwert.
 */
export function chartCellColor(value: number, maxAbs: number): string {
  const share = maxAbs > 0 ? Math.min(1, Math.abs(value) / maxAbs) : 0
  const p = (4 + share * 96) / 100
  const end = value >= 0 ? CHART_COLORS.chargeEnd : CHART_COLORS.dischargeEnd
  const mix = (from: number, to: number) => Math.round(from * p + to * (1 - p))
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  const parts = [0, 1, 2].map((i) =>
    mix(channel(end, i), channel(CHART_COLORS.neutralEnd, i)).toString(16).padStart(2, '0'),
  )
  return `#${parts.join('')}`
}

/** Schriftgrade. Ein Report, kein Prospekt: wenige Stufen, klarer Abstand dazwischen. */
export const PDF_TYPE = {
  family: 'Inter',
  /**
   * Der Zeilenabstand des FLIESSTEXTS — eine Zahl, zwei Konsumenten (`styles.body` und
   * `styles.coverBody` in `document.tsx`).
   *
   * ⚠ 1,25 und nicht mehr 1,45. Die alte Zahl war für 9,5 pt zu locker: 13,8 pt Durchschuss lassen
   * einen Fliesstext auseinanderfallen und liessen den Report weniger nach Beratungsdokument
   * aussehen als nach Handout. 1,25 ergibt rund 11,9 pt — der Bereich, in dem Berichte dieser Art
   * gesetzt werden: eng genug, dass ein Absatz als Block liest, weit genug, dass die Zeilen sich
   * nicht berühren.
   *
   * ⚠ WER DIESE ZAHL ÄNDERT, ÄNDERT DEN SEITENUMBRUCH DES GANZEN DOKUMENTS — und damit jede
   * Seitenzahl in der Agenda. Das ist ungefährlich (die Zahlen werden gemessen, D5), aber es ist
   * der Grund, warum sie nach einer Änderung neu zu prüfen sind.
   *
   * ⚠ UND SIE GEHÖRT NIEMALS AUF EINE `<Page>` — s. die Warnung an `styles.page` in
   * `document.tsx`: ein geerbter `lineHeight` löscht fixierte Elemente spurlos.
   */
  lineHeight: 1.25,
  cover: 30,
  coverSub: 12,
  h2: 14,
  /**
   * Zwischenüberschrift eines Bausteins (`statementTitle`, `itemTitle`).
   *
   * ⚠ D15 Block 1, Punkt 8: 9,5 → 11,5. Bei 9,5 pt war die Überschrift eines Bausteins
   * zeichengleich mit seinem Fliesstext und unterschied sich allein im Gewicht — auf einem
   * Blatt mit acht Bausteinen je Seite trägt das die Gliederung nicht. Das Zielbild setzt sie
   * mit 11,5 pt (Bestandsaufnahme §2.2).
   */
  h3: 11.5,
  /**
   * Der Titel eines Hinweiskastens — bewusst EIN Grad unter `h3`.
   *
   * ⚠ Ein Hinweis ist eine Feststellung ÜBER die Zahlen, kein eigener Abschnitt; auf 11,5 pt
   * gesetzt zöge er mehr Aufmerksamkeit als die Aussage, zu der er gehört. Zielbild: 10,3 pt.
   */
  noticeTitle: 10.3,
  body: 9.5,
  small: 8.5,
  /**
   * ⚠ D15 Block 1, Punkt 10: 7 → 7,6. 7 pt lag unter dem, was auf Papier im Seitenrand noch
   * sicher lesbar ist; das Zielbild setzt die Fusszeile mit 7,6 pt.
   */
  footer: 7.6,
} as const
