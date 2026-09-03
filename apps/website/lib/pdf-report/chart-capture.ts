import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { rasterizeChart, type ChartRaster, type RasterizeOptions } from './chart-raster'

/**
 * B23b — ein Chart ausserhalb des Sichtfelds mounten und rastern.
 *
 * ── ⚠ WARUM ÜBERHAUPT GEMOUNTET WIRD ───────────────────────────────────────────────────────────
 * Ein Rasterbild entsteht aus einem LAYOUTETEN DOM-Element. Das PDF wird aber typischerweise aus
 * einem Zustand erzeugt, in dem der betreffende Chart gar nicht auf dem Bildschirm steht (eine
 * zugeklappte Sektion, eine andere Batterie, oder — beim späteren Kunden-Knopf — schlicht ein
 * anderer Ausschnitt der Seite). Sich auf das sichtbare DOM zu verlassen hiesse, die Bildqualität
 * von der Scrollposition abhängig zu machen.
 *
 * Gemountet werden die UNVERÄNDERTEN Produktionskomponenten mit ihren ECHTEN Props. Das ist der
 * Kern von Contract-Entscheidung 1 (Delta D2): der Chart im PDF ist derselbe, den der Kunde am
 * Bildschirm sieht. Eine vereinfachte Abschrift wäre eine zweite Wahrheit.
 *
 * ── ⚠ `position: fixed; left: -10000px` UND AUSDRÜCKLICH NICHT `display: none` ─────────────────
 * `display: none` erzeugt keinen Layoutkasten. `ResponsiveContainer` (Recharts) misst dann 0 × 0,
 * rendert seinen `<svg>` gar nicht erst — und `rasterizeChart` bekäme ein Element ohne Ausdehnung.
 * In Chromium ist das KEIN Fehler, sondern ein leeres Bild: dieselbe Klasse stillen Fehlschlags wie
 * die `lineHeight`-Falle aus B23a (Delta D7), nur an anderer Stelle. Abseits positioniert wird
 * dagegen vollständig layoutet.
 *
 * `aria-hidden` und `pointer-events: none` stehen dazu, damit der abseits stehende Baum für die
 * Dauer der Erzeugung weder vorgelesen noch angeklickt werden kann.
 *
 * ── ⚠ DIESES MODUL ZIEHT `@react-pdf/renderer` NICHT ───────────────────────────────────────────
 * Es endet bei der Data-URI, wie `chart-raster.ts`. Wer daraus ein `<Image>` macht, ist der
 * Aufrufer.
 */

/** Der Kasten, in dem gemountet wird. */
export type CaptureOptions = RasterizeOptions & {
  /**
   * Breite des Mount-Kastens in CSS-Pixeln. Sie bestimmt das SEITENVERHÄLTNIS des Bildes und
   * mittelbar dessen Auflösung: bei 760 px und `scale` 3 stehen 2280 Bildpunkte in rund 499 pt
   * Satzbreite, also ~329 dpi (Spike §2.4 mass 288 dpi als „im Druckbild nicht störend").
   *
   * Bewusst KEIN Standardwert aus dem PDF-Layout gerechnet: die Breite ist eine Aussage darüber,
   * wie der Chart AUSSEHEN soll (Recharts entscheidet daran Tickabstände und Beschriftungsdichte),
   * nicht über die Grösse auf dem Papier. Letztere entsteht in `fitRasterToWidth`.
   */
  width?: number
  /**
   * Welches Element im gemounteten Baum gerastert wird. Ohne Angabe: das erste Kind des
   * Mount-Kastens, also die Komponente selbst.
   *
   * ── ⚠ EIN „ODER"-SELEKTOR IST HIER EIN TIMING-ZUFALL, KEIN RÜCKFALL — GEMESSEN ───────────────
   * Der erste Entwurf lautete „nimm `svg.recharts-surface`, sonst das erste Kind". Das ist genau
   * einmal richtig und sonst falsch: `ResponsiveContainer` rendert seinen `<svg>` erst ein paar
   * Frames nach `root.render()`, das erste Kind steht dagegen SOFORT. Die Wartelogik war damit
   * bereits erfüllt, bevor es den Chart gab — gerastert wurde die ganze Karte statt des
   * Zeichenbereichs, und beim Lastgang zusätzlich über den HTML-Weg, was die Kurve ungezeichnet
   * liess. Am Prüfstand gemessen: 2280 × 2643 px statt 2280 × 768 px, und 0 Bildpunkte in jeder
   * erwarteten Farbe. Kein Fehler, keine Warnung — nur ein anderes Bild.
   *
   * Deshalb ist der Standardwert DETERMINISTISCH, und wer den Recharts-Zeichenbereich will, sagt
   * es ausdrücklich (`selectRechartsSurface`). Bleibt der dann aus, läuft die Wartezeit ab und es
   * gibt eine Meldung — statt still eines anderen Bildes.
   */
  select?: (container: HTMLElement) => Element | null
  /**
   * Wird am LEBENDEN Element aufgerufen, unmittelbar bevor gerastert wird — für Messungen, die nur
   * am gerenderten Baum möglich sind (etwa: wie viele Stützpunkte trägt die Lastgang-Kurve
   * tatsächlich, nachdem `downsampleMinMax` gelaufen ist).
   */
  inspect?: (el: Element) => void
  /** Obergrenze für das Warten auf den fertigen Chart. */
  timeoutMs?: number
}

const DEFAULT_WIDTH = 760
const DEFAULT_TIMEOUT_MS = 5000

/**
 * Der Standardwert: die gemountete Komponente selbst. Trägt jeden Chart, der KEIN SVG ist — die
 * Stunden-Heatmap ist ein CSS-Grid aus `div`s, und ein Standardwert, der nur `svg` kennt, wäre für
 * sie ein stiller Fehlschlag.
 */
function selectFirstChild(container: HTMLElement): Element | null {
  return container.firstElementChild
}

/**
 * Der Zeichenbereich eines Recharts-Charts — ohne die Karte, den Erklärtext und die Legende
 * drumherum. Ausdrücklich zu übergeben; s. die Warnung an `select`.
 */
export function selectRechartsSurface(container: HTMLElement): Element | null {
  return container.querySelector('svg.recharts-surface')
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()))
}

/**
 * Wartet, bis das Zielelement da IST und eine Ausdehnung HAT.
 *
 * ⚠ Beides ist nötig, und das zweite ist der eigentliche Punkt: `ResponsiveContainer` rendert seinen
 * `<svg>` erst, nachdem ein `ResizeObserver` die Breite gemeldet hat. Zwischen `root.render()` und
 * diesem Zeitpunkt liegen mehrere Frames — wer nur auf die Existenz prüft, greift ein leeres oder
 * halb gemessenes SVG ab und bekommt ein Bild, das je nach Maschinenlast anders aussieht.
 */
async function waitForLayout(
  container: HTMLElement,
  select: (c: HTMLElement) => Element | null,
  timeoutMs: number,
): Promise<Element> {
  const deadline = performance.now() + timeoutMs
  for (;;) {
    const el = select(container)
    if (el) {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) return el
    }
    if (performance.now() > deadline) {
      throw new Error(
        'Das Chart hat im Mount-Kasten keine Ausdehnung bekommen — vermutlich rendert es unter den ' +
          'übergebenen Props nichts (mehrere Chart-Komponenten geben bei fehlenden Daten bewusst ' +
          '`null` zurück, statt eine leere Box zu zeigen).',
      )
    }
    await nextFrame()
  }
}

/**
 * Mountet `node` abseits des Sichtfelds, rastert das ausgewählte Element und räumt wieder ab.
 *
 * ⚠ Das Abräumen läuft in `finally` — bleibt der Kasten nach einem Fehlschlag stehen, sammelt jede
 * weitere Erzeugung einen weiteren unsichtbaren React-Baum an, der ResizeObserver und Zustand hält.
 */
export async function captureChart(
  node: ReactNode,
  options: CaptureOptions = {},
): Promise<ChartRaster> {
  const width = options.width ?? DEFAULT_WIDTH
  const select = options.select ?? selectFirstChild

  const container = document.createElement('div')
  container.setAttribute('aria-hidden', 'true')
  container.style.position = 'fixed'
  container.style.left = '-10000px'
  container.style.top = '0'
  container.style.width = `${width}px`
  container.style.pointerEvents = 'none'
  /* Der Kasten ist ein Ausschnitt der Seite und erbt deren Schrift und Farben — er hängt deshalb
     am `<body>` und nicht an einem eigenen Dokument. */
  document.body.appendChild(container)

  let root: Root | null = null
  try {
    root = createRoot(container)
    root.render(node)
    const el = await waitForLayout(container, select, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    options.inspect?.(el)
    return await rasterizeChart(el, options)
  } finally {
    /* `unmount()` innerhalb desselben Ticks wie `render()` warnt in React 18/19 — hier liegen
       mindestens ein Frame und ein `await` dazwischen. */
    root?.unmount()
    container.remove()
  }
}
