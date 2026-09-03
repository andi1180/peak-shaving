import { Font } from '@react-pdf/renderer'

import { PDF_FONT_SOURCES, PDF_TYPE } from './theme'

/**
 * B23a — Registrierung der Report-Schrift.
 *
 * ── ⚠ `next/font` HILFT HIER NICHT, UND DAS IST GEMESSEN (Spike §2.2, „Falle 2") ────────────────
 * `.next/static/media/` enthält ausschliesslich **woff2** (10 Dateien, alle `.woff2`). fontkit — der
 * Font-Unterbau von react-pdf — verarbeitet TTF/OTF/WOFF, aber KEIN woff2. Die vom Bildschirm-Layout
 * benutzten Dateien sind für das PDF also unbrauchbar; es braucht ein eigenes Asset.
 *
 * Hinterlegt sind drei Schnitte als WOFF in `public/report-fonts/` (Inter, latin-ext-Untermenge von
 * Google Fonts, je ~65 kB). latin-ext und nicht die volle Zeichentabelle (~140 kB): der Report ist
 * deutschsprachig, und die Untermenge deckt Umlaute, ß, €, „ ", · und – vollständig ab.
 *
 * ── FONTWEG: URL-FETCH AUF DIE EIGENE HERKUNFT, KEINE DATA-URI ─────────────────────────────────
 * Der Spike hat beide Wege gemessen (§6, offener Punkt (b)) und die Entscheidung offen gelassen.
 * Sie fällt hier auf den URL-Fetch:
 *
 *   - Es sind gemessen **nur die tatsächlich benutzten Schnitte**, die geholt werden — im Spike zwei
 *     von drei registrierten. Eine Data-URI trüge alle drei bedingungslos im Bündel.
 *   - Die Dateien sind statische Assets der EIGENEN Herkunft (`/report-fonts/…`). Es geht nichts an
 *     einen fremden Server; Prinzip 4 ist unberührt, es verlässt nichts den Browser.
 *   - 3 × 65 kB als base64 im Bündel wären rund 260 kB, die JEDE Erzeugung mitschleppt, auch wenn
 *     der Nutzer nie exportiert. Der Lazy-Chunk ist ohnehin schon der teure Teil (Spike §3).
 *
 * ⚠ FOLGE, DIE MAN KENNEN MUSS: die ERSTE Erzeugung macht Netzwerk-Anfragen (Fonts + Emblem, alle
 * auf die eigene Herkunft). Jede weitere macht keine — react-pdf hält beides im Cache. Das ist der
 * gemessene Zustand, kein Nebenbefund; s. den Verifikationsteil im Handover.
 *
 * ── HYPHENATION AUS ────────────────────────────────────────────────────────────────────────────
 * react-pdf trennt Wörter standardmässig mit einem englischen Silbenalgorithmus. Auf deutschen
 * Komposita („Wirtschaftlichkeitsbetrachtung", „Viertelstunden-Lastgang") erzeugt das Trennungen,
 * die falsch sind — und auf einem Blatt, das ein Installateur beim Kunden dalässt, fällt genau das
 * auf. Ein Wort ungetrennt in die nächste Zeile zu schieben ist der kleinere Fehler.
 */


let registered = false

/**
 * Idempotent. Mehrfaches `Font.register` mit derselben Familie überschreibt in react-pdf still den
 * vorherigen Eintrag — harmlos, aber die Sperre macht sichtbar, dass die Registrierung eine
 * einmalige Einrichtung ist und kein Teil des Renderns.
 */
export function registerReportFonts(): void {
  if (registered) return
  registered = true

  /*
   * Die Liste steht seit B23b in `theme.ts`: `chart-raster.ts` bettet DIESELBEN Dateien als
   * Data-URI in das serialisierte Chart-SVG ein. Zwei Listen liefen auseinander, und dann stünde
   * im PDF ein Chart in einer anderen Schrift neben nativem Text.
   */
  Font.register({ family: PDF_TYPE.family, fonts: [...PDF_FONT_SOURCES] })

  Font.registerHyphenationCallback((word) => [word])
}
