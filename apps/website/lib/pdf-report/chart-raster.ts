/**
 * B23b — die generische Rasterbild-Pipeline für Charts im react-pdf-Report.
 *
 * ── WOZU ÜBERHAUPT EIN RASTERBILD ──────────────────────────────────────────────────────────────
 * Contract-Entscheidung 1 des Deltas (`Pflichtenheft_Kalkulator_Delta_PDF-Report.md`, D2): die
 * Charts im PDF sind Rasterbilder DES BESTEHENDEN Recharts-Charts, keine zweite Zeichenimplementierung
 * auf react-pdf-Primitives. Ausschlaggebend ist nicht der Aufwand, sondern die EINE Definition — der
 * Chart im PDF ist derselbe, den der Kunde am Bildschirm gesehen hat. Zwei Zeichenwege wären zwei
 * Wahrheiten über dieselbe Zahl, und beide sähen für sich plausibel aus.
 *
 * ── ⚠ DIESES MODUL IST BEWUSST FREI VON `@react-pdf/renderer` ──────────────────────────────────
 * Es rastert bis zur Data-URI und hört dort auf; die Einbettung als `<Image>` ist Sache des
 * Aufrufers. Zwei Gründe: (a) das Modul ist damit für sich prüfbar, ohne die PDF-Bibliothek zu
 * laden, und (b) der Lazy-Chunk (Spike §3: ≈ 307 kB gzip) bleibt an genau den Stellen, die ihn
 * ohnehin ziehen. Es ist auch frei von React — was gerastert wird, ist ein DOM-Element.
 *
 * ── ⚠ ES GIBT ZWEI WEGE, NICHT EINEN — UND DAS IST DER BEFUND DIESES ABSCHNITTS ────────────────
 * Der Spike hat Variante 2 an GENAU EINEM Chart gemessen: einem Recharts-Balkenchart, also einem
 * `<svg>`. Die Stunden-Heatmap (`battery-flow-heatmap.tsx`) ist ausdrücklich KEIN SVG — sie ist ein
 * CSS-Grid aus `div`s, und ihr Kopfkommentar begründet das („eine Heatmap ist ein Raster aus
 * Flächen, kein Diagramm mit Achsen und Serien"). `new XMLSerializer().serializeToString(svg)`
 * greift dort ins Leere. Eine Pipeline, die nur SVG kann, wäre also nicht generisch, sondern
 * zufällig am einfachsten Fall bestätigt.
 *
 * Deshalb zwei Wege hinter EINER Funktion (`rasterizeChart`):
 *   • ist das Element ein `<svg>`   → serialisieren, Anstrich aus `getComputedStyle` festschreiben;
 *   • sonst (HTML)                  → in ein `<foreignObject>` verpacken, dabei den VOLLSTÄNDIGEN
 *                                     berechneten Stil je Element festschreiben.
 * Beide münden in denselben Canvas-Schritt und liefern denselben `ChartRaster`.
 *
 * ── ⚠ DIE DREI FALLEN, DIE HIER ABGEDECKT SIND ────────────────────────────────────────────────
 * (1) CSS-Variablen lösen im freistehenden SVG NICHT auf (Spike §2.1, „Falle 1"). Recharts zeichnet
 *     mit `stroke="var(--color-border)"`; ohne Festschreiben käme das Diagramm unbemalt heraus —
 *     ohne Fehlermeldung. Dasselbe gilt für `color-mix()` in der Heatmap.
 * (2) Das Seitenverhältnis muss GERECHNET werden (Spike §2.4, „Falle 3"). Der Spike hat ein
 *     2,539er-Raster mit 2,234 eingebettet: 13,6 % vertikale Streckung, am Bildschirm unsichtbar,
 *     erst im 300-dpi-Vergleich aufgefallen. `fitRasterToWidth` ist die einzige Stelle, an der die
 *     Höhe entsteht — wer sie selbst hinschreibt, verzerrt still.
 * (3) Die Schrift. In einem serialisierten, freistehenden SVG gibt es KEINE `@font-face`-Regeln der
 *     Seite: `font-family: __Inter_xxxx` (so heisst Inter unter `next/font`) löst nicht auf, und der
 *     Text fällt auf eine System-Schrift zurück. Im PDF stünde ein Chart in einer anderen Schrift
 *     neben nativem Inter-Text. Deshalb wird Inter als Data-URI in das serialisierte SVG eingebettet
 *     und die Schriftfamilie im KLON auf `Inter` umgeschrieben — dieselbe Datei, die `fonts.ts` bei
 *     react-pdf registriert (`PDF_FONT_SOURCES`), also dieselbe Schrift auf beiden Wegen.
 */

import { PDF_FONT_SOURCES, PDF_TYPE } from './theme'

/** Ein fertiges Rasterbild samt der Zahlen, ohne die es nicht verzerrungsfrei eingebettet werden kann. */
export type ChartRaster = {
  /** `data:image/png;base64,…` — direkt als `src` eines react-pdf-`<Image>` verwendbar. */
  dataUrl: string
  /** Breite des PNG in Bildpunkten (bereits mit `scale` multipliziert). */
  widthPx: number
  /** Höhe des PNG in Bildpunkten. */
  heightPx: number
  /**
   * `widthPx / heightPx`. Die eine Zahl, um die es bei Falle 3 geht — sie steht hier, damit ein
   * Aufrufer sie nachrechnen kann, statt sie aus zwei anderen Feldern selbst zu bilden.
   */
  aspectRatio: number
}

/**
 * Vergrösserungsfaktor der Rasterung. 3 ist der im Spike gemessene Wert: 650 px × 3 ergaben in
 * 487 pt Breite **288 dpi effektiv**, und der 300-dpi-Ausschnittsvergleich zeigte die
 * Rasterbeschriftung als „geringfügig weicher, im Druckbild aber nicht störend". Bei 2 wären es
 * 192 dpi — sichtbar weich.
 */
export const DEFAULT_RASTER_SCALE = 3

/**
 * Papierweiss als Bildgrund. Ein Canvas ist ohne Füllung durchsichtig, und PNG mit Alpha bettet
 * react-pdf zwar ein — auf einem Blatt, das jemand ausdruckt, ist „durchsichtig" aber kein
 * definierter Zustand, sondern das, was der Betrachter darunter zeichnet.
 */
const DEFAULT_BACKGROUND = '#ffffff'

export type RasterizeOptions = {
  scale?: number
  background?: string
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Schrift
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * `@font-face`-Regeln mit eingebetteter Schrift, zum Einsetzen in das serialisierte SVG.
 *
 * ⚠ EINMAL GEHOLT, DANN GEHALTEN. Die Zusage aus D6 („die ERSTE Erzeugung macht Anfragen, jede
 * weitere keine") gilt damit auch für diesen Weg: die WOFF-Dateien sind statische Assets der
 * eigenen Herkunft und werden je Sitzung höchstens einmal geholt.
 *
 * ⚠ NUR REGULAR UND SEMIBOLD. Die Charts benutzen 400 und 500/600; `Inter-Bold` würde die Data-URI
 * um rund 87 kB verlängern, ohne dass ein Glyph davon im Bild landet. Fehlt ein Schnitt, wählt der
 * Browser den nächstgelegenen — das ist der bewusste Rückfall, kein Versehen.
 */
const RASTER_FONT_WEIGHTS = [400, 600] as const

let fontFaceCssPromise: Promise<string> | null = null

async function fetchAsDataUri(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Schriftdatei ${url} nicht ladbar (HTTP ${response.status})`)
  const buffer = new Uint8Array(await response.arrayBuffer())
  let binary = ''
  /* Blockweise, weil `String.fromCharCode(...bytes)` bei ~65 kB den Aufrufstapel sprengt. */
  const CHUNK = 0x8000
  for (let i = 0; i < buffer.length; i += CHUNK) {
    binary += String.fromCharCode(...buffer.subarray(i, i + CHUNK))
  }
  return `data:font/woff;base64,${btoa(binary)}`
}

async function reportFontFaceCss(): Promise<string> {
  if (!fontFaceCssPromise) {
    fontFaceCssPromise = (async () => {
      const faces = await Promise.all(
        RASTER_FONT_WEIGHTS.map(async (weight) => {
          const source = PDF_FONT_SOURCES.find((f) => f.fontWeight === weight)
          if (!source) throw new Error(`Kein Schriftschnitt für Gewicht ${weight} hinterlegt`)
          const uri = await fetchAsDataUri(source.src)
          return `@font-face{font-family:'${PDF_TYPE.family}';font-style:normal;font-weight:${weight};src:url(${uri}) format('woff');}`
        }),
      )
      return faces.join('')
    })().catch((cause) => {
      /*
       * Ein Fehlschlag darf nicht dauerhaft kleben bleiben: sonst bliebe die Schrift für den Rest
       * der Sitzung aus, weil ein einzelner Netzfehler die Zusage gecacht hat.
       */
      fontFaceCssPromise = null
      throw cause
    })
  }
  return fontFaceCssPromise
}

/**
 * Schreibt die Schriftfamilie im KLON auf `Inter` um, wo die Seite Inter meint.
 *
 * ⚠ Der Vergleich läuft über den NAMEN, und das ist Absicht: `next/font` vergibt zur Bauzeit
 * erzeugte Familiennamen (`__Inter_e8ce45`, `__Inter_Fallback_e8ce45`) — es gibt keinen stabilen
 * Bezeichner, gegen den sich prüfen liesse. Was stabil ist, ist das Wort „Inter" darin.
 */
function rewriteFontFamily(value: string): string | null {
  return /inter/i.test(value) ? PDF_TYPE.family : null
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Anstrich festschreiben
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Die SVG-Präsentationseigenschaften, die Recharts über CSS (und damit über CSS-Variablen) setzt.
 *
 * Bewusst eine LISTE und nicht „alles, was `getComputedStyle` hergibt": ein SVG-Element trägt in
 * Chromium rund 340 berechnete Eigenschaften, von denen die allermeisten (Layout, Übergänge,
 * Rasterpositionen) im SVG-Kontext nichts tun. Sie alle als Attribute zurückzuschreiben machte die
 * Data-URI um ein Vielfaches grösser, ohne ein einziges Pixel zu verändern.
 */
const SVG_PAINT_PROPERTIES = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline',
  'visibility',
  'display',
] as const

/**
 * Läuft Original und Klon PARALLEL ab. Der Klon ist strukturgleich, die Kinder stehen also an
 * denselben Stellen.
 *
 * ⚠ Warum nicht einfach am Original arbeiten und danach aufräumen: `getComputedStyle` liefert an
 * einem abgehängten Knoten nichts, gelesen werden MUSS also am lebenden Element. Geschrieben wird
 * trotzdem in den Klon — der sichtbare Chart bleibt dadurch unverändert, und dieselbe Funktion
 * trägt später auch dort, wo der Chart auf dem Bildschirm steht und nicht abseits gemountet wurde.
 */
function walkPairs(source: Element, target: Element, visit: (s: Element, t: Element) => void): void {
  visit(source, target)
  const sourceChildren = source.children
  const targetChildren = target.children
  const count = Math.min(sourceChildren.length, targetChildren.length)
  for (let i = 0; i < count; i++) {
    walkPairs(sourceChildren[i]!, targetChildren[i]!, visit)
  }
}

/**
 * Falle 1 für den SVG-Weg: berechnete Anstrichwerte als feste Attribute in den Klon schreiben.
 *
 * Exportiert, weil das die eine Zeile ist, deren Fehlen einen Chart unbemalt UND fehlerfrei macht —
 * wer den SVG-Weg an anderer Stelle nachbaut, soll dieselbe Funktion benutzen können.
 */
export function inlineComputedPaint(source: Element, target: Element): void {
  walkPairs(source, target, (s, t) => {
    const computed = window.getComputedStyle(s)
    for (const property of SVG_PAINT_PROPERTIES) {
      const value = computed.getPropertyValue(property)
      if (!value) continue
      if (property === 'font-family') {
        const rewritten = rewriteFontFamily(value)
        t.setAttribute(property, rewritten ?? value)
        continue
      }
      t.setAttribute(property, value)
    }
  })
}

/**
 * Dasselbe für den HTML-Weg — hier aber der VOLLSTÄNDIGE berechnete Stil je Element.
 *
 * ⚠ Warum vollständig und nicht wie beim SVG eine Liste: im `<foreignObject>` gibt es kein
 * Stylesheet. Was nicht als Inline-Stil dasteht, existiert nicht — und das betrifft nicht nur
 * Farben, sondern das gesamte LAYOUT (Rasterspalten, Abstände, Zeilenhöhen, Rahmen). Eine Auswahl
 * zu treffen hiesse, das Layout der Heatmap ein zweites Mal zu beschreiben; genau das soll dieser
 * Weg vermeiden.
 *
 * Geschrieben wird EIN `style`-Attribut je Element statt 340 Einzelzuweisungen — messbar schneller
 * und, wichtiger, die Serialisierung übernimmt das Maskieren der Werte (Schriftnamen tragen
 * Anführungszeichen).
 */
export function inlineComputedStyle(source: Element, target: Element): void {
  walkPairs(source, target, (s, t) => {
    const computed = window.getComputedStyle(s)
    const declarations: string[] = []
    for (let i = 0; i < computed.length; i++) {
      const property = computed.item(i)
      /* Eigene Eigenschaften (`--color-*`) sind im Klon wirkungslos — was sie ergaben, steht bereits
         aufgelöst in den Werten daneben. Sie mitzunehmen blähte nur die Data-URI. */
      if (property.startsWith('--')) continue
      let value = computed.getPropertyValue(property)
      if (!value) continue
      if (property === 'font-family') value = rewriteFontFamily(value) ?? value
      declarations.push(`${property}:${value}`)
    }
    t.setAttribute('style', declarations.join(';'))
    /* Klassen tragen im Klon nichts bei (kein Stylesheet) und stehen sonst in jeder Zeile der
       Data-URI — bei einem 24 × 12-Raster sind das ein paar hundert. */
    t.removeAttribute('class')
  })
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Serialisieren und rastern
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

const SVG_NS = 'http://www.w3.org/2000/svg'
const XHTML_NS = 'http://www.w3.org/1999/xhtml'

/** `<`, `&` und `"` in einer Style-Regel — sonst ist das erzeugte SVG kein wohlgeformtes XML. */
function escapeForXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function serializeSvgChart(svg: SVGSVGElement, width: number, height: number, fontCss: string): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  inlineComputedPaint(svg, clone)

  clone.setAttribute('xmlns', SVG_NS)
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${width} ${height}`)

  const style = document.createElementNS(SVG_NS, 'style')
  style.textContent = fontCss
  clone.insertBefore(style, clone.firstChild)

  return new XMLSerializer().serializeToString(clone)
}

function serializeHtmlChart(el: Element, width: number, height: number, fontCss: string): string {
  const clone = el.cloneNode(true) as Element
  inlineComputedStyle(el, clone)
  /* Der Klon steht als eigenes Blockelement bekannter Grösse im `foreignObject` — sonst zöge sein
     berechnetes `width` aus dem Elternraster mit, den es dort nicht gibt. */
  clone.setAttribute(
    'style',
    `${clone.getAttribute('style') ?? ''};box-sizing:border-box;width:${width}px;margin:0`,
  )
  ;(clone as HTMLElement).setAttribute('xmlns', XHTML_NS)

  const body = new XMLSerializer().serializeToString(clone)
  return (
    `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<style>${escapeForXml(fontCss)}</style>` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">${body}</foreignObject>` +
    `</svg>`
  )
}

async function svgSourceToPng(
  source: string,
  width: number,
  height: number,
  scale: number,
  background: string,
): Promise<ChartRaster> {
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`

  const image = new Image()
  image.width = width
  image.height = height
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    /*
     * ⚠ Ein `<img>` mit fehlerhaftem SVG meldet GENAU DAS und nichts weiter — kein Hinweis auf die
     * Stelle, keine Konsolenausgabe. Häufigste Ursache ist unwohlgeformtes XML aus dem
     * `XMLSerializer` (der HTML-Weg ist da empfindlicher als der SVG-Weg).
     */
    image.onerror = () =>
      reject(new Error('Das serialisierte Chart-SVG konnte nicht als Bild geladen werden.'))
    image.src = url
  })

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Kein 2D-Kontext für die Chart-Rasterung verfügbar.')
  ctx.fillStyle = background
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

  return {
    dataUrl: canvas.toDataURL('image/png'),
    widthPx: canvas.width,
    heightPx: canvas.height,
    aspectRatio: canvas.width / canvas.height,
  }
}

/**
 * Rastert ein gemountetes Chart-Element. Der einzige Einstieg — die Verzweigung SVG/HTML liegt
 * darin und nicht beim Aufrufer.
 *
 * ⚠ Das Element muss LAYOUTET sein: `getBoundingClientRect()` liefert unter `display: none` Null,
 * und ein 0 × 0-Canvas ist in Chromium kein Fehler, sondern ein leeres Bild. S. `chart-capture.ts`,
 * das genau deshalb ausserhalb des Sichtfelds mountet statt unsichtbar.
 */
export async function rasterizeChart(
  el: Element,
  options: RasterizeOptions = {},
): Promise<ChartRaster> {
  const scale = options.scale ?? DEFAULT_RASTER_SCALE
  const background = options.background ?? DEFAULT_BACKGROUND

  const rect = el.getBoundingClientRect()
  const width = Math.round(rect.width)
  const height = Math.round(rect.height)
  if (width === 0 || height === 0) {
    throw new Error(
      'Das Chart-Element hat keine Ausdehnung — vermutlich ist es (oder ein Vorfahr) `display: none`.',
    )
  }

  const fontCss = await reportFontFaceCss()
  const source =
    el instanceof SVGSVGElement
      ? serializeSvgChart(el, width, height, fontCss)
      : serializeHtmlChart(el, width, height, fontCss)

  return svgSourceToPng(source, width, height, scale, background)
}

/**
 * Falle 3: die Höhe, mit der ein Rasterbild in einer gegebenen Breite verzerrungsfrei steht.
 *
 * ⚠ DIE EINZIGE STELLE, AN DER EINE BILDHÖHE ENTSTEHEN DARF. Eine von Hand gesetzte Höhe streckt
 * oder staucht das Bild, ohne dass irgendetwas kaputt aussieht — im Spike gemessen: 2,539 gegen
 * 2,234 ergaben 13,6 % vertikale Streckung, am Bildschirm unsichtbar und erst im
 * 300-dpi-Ausschnittsvergleich aufgefallen.
 */
export function fitRasterToWidth(
  raster: ChartRaster,
  widthPt: number,
): { width: number; height: number } {
  return { width: widthPt, height: widthPt / raster.aspectRatio }
}
