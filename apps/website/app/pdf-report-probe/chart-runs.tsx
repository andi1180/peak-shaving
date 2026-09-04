import { BatteryFlowHeatmap } from '@/components/report/battery-flow-heatmap'
import { LoadChart } from '@/components/report/load-chart'
import { MonthlyTariffChart } from '@/components/report/monthly-tariff-chart'
import {
  captureChart,
  selectHeatmapGrid,
  selectRechartsSurface,
} from '@/lib/pdf-report/chart-capture'
import type { ChartRaster } from '@/lib/pdf-report/chart-raster'
import { downloadChartProbePdf, type ChartProbeOutcome } from '@/lib/pdf-report/chart-probe'

import {
  buildBatteryFlowFixture,
  buildDispatchTraceFixture,
  buildLoadProfileFixture,
  LOAD_FIXTURE_CAP_KW,
  MONTHLY_COMPARISON_FIXTURE,
  MONTHLY_COMPARISON_TOTALS,
} from './chart-fixtures'

/**
 * B23b — die drei Prüfläufe der Chart-Rasterung, je Chart-TYP einer.
 *
 * ── WARUM DREI UND NICHT EINER ─────────────────────────────────────────────────────────────────
 * Der Spike hat die Rasterung an GENAU EINEM Chart gemessen: einem Recharts-Balkenchart. Balken,
 * Raster und kontinuierliche Kurve mit grosser Punktzahl sind die drei strukturell verschiedenen
 * Muster unter den sieben Report-Charts — trägt die Pipeline an allen dreien, ist sie generisch und
 * nicht zufällig am einfachsten Fall bestätigt. Die verbleibenden vier (Kostenvergleich,
 * Tages-Energiefluss, Grenznutzen-Kurve, Ø-Ladepreis) sind strukturell einem dieser drei ähnlich
 * und folgen mit der Karten-Migration in B23c.
 *
 * ⚠ Was hier gemountet wird, sind die UNVERÄNDERTEN Produktionskomponenten: `monthly-tariff-chart`,
 * `battery-flow-heatmap` und `load-chart` werden gemountet und gelesen, nicht angepasst.
 *
 * ⚠ GENAU EINE AUSNAHME, seit B23c-3b-1: die Heatmap trägt einen ANKER (`data-testid`) um ihr
 * blosses Raster. Er ändert weder Logik noch Farben noch das Verhalten einer Zelle — er benennt
 * den Ausschnitt, der ins Bild gehört. Ohne ihn gäbe es nur „ganze Karte oder nichts", und der
 * Fliesstext der Komponente landete als Bildpunkte im PDF (D11).
 *
 * ── ⚠ DIESES MODUL WIRD NUR DYNAMISCH GELADEN ──────────────────────────────────────────────────
 * Es zieht Recharts UND (über `chart-probe`) `@react-pdf/renderer`. Statisch aus `probe-client.tsx`
 * importiert läge der Lazy-Chunk (Spike §3: ≈ 307 kB gzip) im First Load der Prüfroute.
 */

export type ChartProbeKind = 'monthly' | 'heatmap' | 'load'

/** Eine Farbstichprobe: wie oft steht ein DESIGN.md-Token als Bildpunkt im fertigen Raster. */
export type ColorSample = {
  label: string
  /** Der Wert aus `app/globals.css` bzw. die daraus abgeleitete Mischung. */
  token: string
  hex: string
  /** Zulässige Abweichung je Kanal — 0 für Tokenfarben, 1 für gemischte (s. `ACCENT_MIX`). */
  tolerance: number
  /** Bildpunkte innerhalb der Toleranz. */
  pixels: number
  /** Bildpunkte, die den erwarteten Wert BIT-GENAU treffen. */
  exactPixels: number
  ok: boolean
}

type ExpectedColor = { label: string; token: string; hex: string; tolerance?: number }

/**
 * Eine Zelle des Heatmap-Rasters, an ihrer TATSÄCHLICHEN Position im fertigen Bild abgelesen.
 *
 * ── ⚠ WARUM POSITIONSGENAU UND NICHT ÜBER EINE FARBZÄHLUNG ────────────────────────────────────
 * Die Frage „bleibt eine leere Zelle (kein Messwert) von einer gemessenen Null unterscheidbar?"
 * lässt sich über blosse Farbzählungen nicht beantworten: eine leere Zelle ist DURCHSICHTIG und
 * damit im Bild papierweiss — und Papierweiss steht ohnehin überall (Kartengrund, Zellabstände).
 * Gezählt würde also nicht die Zelle, sondern der Hintergrund.
 *
 * Deshalb wird die Zelle über ihren Rasterindex im DOM aufgesucht (`grid[h][m]` →
 * `zeile[h+1].kind[m+1]`), ihr Mittelpunkt RELATIV zum gerasterten Element gemessen und derselbe
 * Punkt anschliessend im PNG abgelesen. Das beantwortet die Frage direkt: welche Farbe hat GENAU
 * diese Zelle im Bild geworden.
 *
 * `computed` ist der Wert, den der Browser am lebenden Element berechnet hat (bei `color-mix()`
 * eine `color(srgb …)`-Angabe in Fliesskomma) — er steht daneben, weil die Rundung auf 8 Bit erst
 * im Canvas passiert und eine von Hand nachgerechnete Mischfarbe deshalb um eins danebenliegt
 * (D11, Befund 4).
 */
export type CellProbe = {
  label: string
  /** Rasterindex, damit die Probe gegen die Prüfdaten gehalten werden kann. */
  hour: number
  month: number
  /** Der Wert dieser Zelle in den Prüfdaten — `null` = kein Messwert. */
  value: number | null
  /** `background-color` am lebenden Element. */
  computed: string
  /** `border-style` am lebenden Element — die gestrichelte Umrandung der leeren Zellen. */
  borderStyle: string
  /** Die Farbe, die im fertigen PNG an der Mitte dieser Zelle steht. */
  hex: string
}

export type ChartProbeReport = ChartProbeOutcome & {
  kind: ChartProbeKind
  label: string
  /** Mount + Layout + Rasterung, in ms. */
  captureMs: number
  colorSamples: ColorSample[]
  /** Nur bei der Heatmap — s. `CellProbe`. */
  cellProbes: CellProbe[] | null
  /**
   * Nur beim Lastgang: die Zahl der Stützpunkte, die die Kurve im erzeugten SVG TATSÄCHLICH trägt —
   * gezählt am gerenderten Pfad, nicht aus der Downsampling-Funktion abgeleitet.
   */
  vertices: { raw: number; drawn: number } | null
  notes: string[]
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Farbstichprobe
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * ⚠ GEMESSEN WIRD AM FERTIGEN BILD, NICHT AM SERIALISIERTEN SVG.
 *
 * Ein Blick in den Klon bewiese nur, dass `inlineComputedPaint` ein Attribut geschrieben hat — nicht,
 * dass die Farbe den Weg über die Data-URI, das `<img>` und den Canvas überstanden hat. Genau
 * dazwischen sitzt Falle 1: ohne das Festschreiben käme das Diagramm unbemalt heraus, und zwar
 * ohne Fehlermeldung. Gezählt werden deshalb EXAKTE Bildpunkte des erwarteten Tons; Kantenglättung
 * erzeugt Mischwerte, aber jede Fläche und jede Linie trägt genügend reine.
 */
async function sampleColors(
  raster: ChartRaster,
  expected: ExpectedColor[],
): Promise<ColorSample[]> {
  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('Rasterbild für die Farbstichprobe nicht lesbar'))
    image.src = raster.dataUrl
  })

  const canvas = document.createElement('canvas')
  canvas.width = raster.widthPx
  canvas.height = raster.heightPx
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Kein 2D-Kontext für die Farbstichprobe')
  ctx.drawImage(image, 0, 0)
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)

  const counts = new Map<number, number>()
  for (let i = 0; i < data.length; i += 4) {
    const key = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const channels = (key: number) => [(key >> 16) & 255, (key >> 8) & 255, key & 255]

  return expected.map((e) => {
    const tolerance = e.tolerance ?? 0
    const want = channels(parseInt(e.hex.slice(1), 16))
    const exactPixels = counts.get(parseInt(e.hex.slice(1), 16)) ?? 0
    let pixels = 0
    if (tolerance === 0) {
      pixels = exactPixels
    } else {
      for (const [key, n] of counts) {
        const got = channels(key)
        if (got.every((v, i) => Math.abs(v - want[i]!) <= tolerance)) pixels += n
      }
    }
    return { label: e.label, token: e.token, hex: e.hex, tolerance, pixels, exactPixels, ok: pixels > 0 }
  })
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Zellprobe der Heatmap: leere Zelle gegen gemessene Null
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/** Wo eine Zelle im gerasterten Element liegt — Mittelpunkt in CSS-Pixeln, relativ zu dessen Ecke. */
type CellSpot = {
  label: string
  hour: number
  month: number
  value: number | null
  x: number
  y: number
  computed: string
  borderStyle: string
}

/** Was `probeHeatmapCells` herausgibt: die Zellen UND die Bezugsbreite, in der sie gemessen wurden. */
type CellSpots = { rootWidthCss: number; spots: CellSpot[] }

/**
 * Sucht drei kennzeichnende Zellen im LEBENDEN Raster und merkt sich ihre Mitte.
 *
 * ⚠ Der Zugriff läuft über den RASTERINDEX und nicht über einen Textinhalt: das Element des Ankers
 * trägt als Kinder die Monats-Kopfzeile und danach die 24 Stundenzeilen, jede mit der
 * Stundenbeschriftung und den zwölf Zellen. `grid[h][m]` steht damit in `kinder[h+1].kinder[m+1]`.
 * Über den `title` zu suchen hiesse, eine formatierte Zeichenkette („0 kWh") zur Schnittstelle zu
 * machen — die ändert sich beim nächsten Formatierungs-Nachtrag, und die Probe griffe still daneben.
 */
function probeHeatmapCells(root: Element, grid: (number | null)[][]): CellSpots {
  const rootRect = root.getBoundingClientRect()
  const rows = root.children

  const pick = (label: string, hour: number, month: number): CellSpot | null => {
    const cell = rows[hour + 1]?.children[month + 1]
    if (!cell) return null
    const rect = cell.getBoundingClientRect()
    const style = window.getComputedStyle(cell)
    return {
      label,
      hour,
      month,
      value: grid[hour]?.[month] ?? null,
      x: rect.left + rect.width / 2 - rootRect.left,
      y: rect.top + rect.height / 2 - rootRect.top,
      computed: style.backgroundColor,
      borderStyle: style.borderTopStyle,
    }
  }

  let empty: [number, number] | null = null
  let zero: [number, number] | null = null
  let max: [number, number] | null = null
  let maxAbs = -1
  let minCell: [number, number] | null = null
  let min = Infinity

  for (let h = 0; h < grid.length; h++) {
    const row = grid[h] ?? []
    for (let m = 0; m < row.length; m++) {
      const value = row[m]
      if (value == null) {
        empty ??= [h, m]
        continue
      }
      if (value === 0) zero ??= [h, m]
      if (Math.abs(value) > maxAbs) {
        maxAbs = Math.abs(value)
        max = [h, m]
      }
      if (value < min) {
        min = value
        minCell = [h, m]
      }
    }
  }

  const spots = [
    empty ? pick('Leere Zelle (kein Messwert)', empty[0], empty[1]) : null,
    zero ? pick('Gemessene Null', zero[0], zero[1]) : null,
    max ? pick('Stärkste Zelle', max[0], max[1]) : null,
    /* Die stärkste ENTLADE-Zelle: sie trägt den Ink-Ton in einer Zwischenstufe. Positionsgenau
       abgelesen und nicht von Hand gemischt — D11, Befund 4. */
    minCell && min < 0 ? pick('Stärkste Entladezelle', minCell[0], minCell[1]) : null,
  ].filter((spot): spot is CellSpot => spot !== null)

  return { rootWidthCss: rootRect.width, spots }
}

/**
 * Liest die Farbe an den gemerkten Stellen aus dem FERTIGEN PNG.
 *
 * ⚠ Der Massstab wird aus dem BILD und der gemessenen Elementbreite gebildet und nicht aus
 * `DEFAULT_RASTER_SCALE` abgeschrieben: `rasterizeChart` rundet die CSS-Breite, bevor es
 * multipliziert, und eine hier zweitgerechnete Zahl liefe bei krummen Breiten um einen Bildpunkt
 * daneben — genug, um bei 16 px hohen Zellen in die Nachbarzeile zu greifen.
 */
async function readCellProbes(raster: ChartRaster, measured: CellSpots): Promise<CellProbe[]> {
  if (measured.spots.length === 0 || measured.rootWidthCss <= 0) return []

  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('Rasterbild für die Zellprobe nicht lesbar'))
    image.src = raster.dataUrl
  })

  const canvas = document.createElement('canvas')
  canvas.width = raster.widthPx
  canvas.height = raster.heightPx
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Kein 2D-Kontext für die Zellprobe')
  ctx.drawImage(image, 0, 0)

  const factor = raster.widthPx / measured.rootWidthCss
  const hex = (x: number, y: number): string => {
    const px = Math.min(raster.widthPx - 1, Math.max(0, Math.round(x * factor)))
    const py = Math.min(raster.heightPx - 1, Math.max(0, Math.round(y * factor)))
    const [r, g, b] = ctx.getImageData(px, py, 1, 1).data
    return `#${[r, g, b].map((v) => (v ?? 0).toString(16).padStart(2, '0')).join('')}`
  }

  return measured.spots.map((spot) => ({
    label: spot.label,
    hour: spot.hour,
    month: spot.month,
    value: spot.value,
    computed: spot.computed,
    borderStyle: spot.borderStyle,
    hex: hex(spot.x, spot.y),
  }))
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Stützpunkte der Lastgang-Kurve
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Zählt die Stützpunkte des Lastgang-Pfads im GERENDERTEN SVG.
 *
 * ⚠ Recharts zeichnet eine Linie als EINEN `<path>` mit einem `d`-Attribut; die Zahl der Punkte ist
 * die Zahl der Koordinatenpaare darin. Genau das ist die Grösse, um die es bei Falle „Downsampling"
 * geht: roh wären es 35.040 (Spike §4: auf 515 pt ein geschlossener Block, keine lesbare Kurve),
 * nach `downsampleMinMax` rund 3.000. Die Zahl hier stammt aus dem DOM und nicht aus einem zweiten
 * Aufruf der Downsampling-Funktion — nur so ist gemessen, dass die Reduktion auf dem echten Weg zum
 * Chart durchläuft.
 */
function countLineVertices(svg: Element): number {
  /* Die erste Linie ist der Lastgang; die zweite (falls vorhanden) ist die Kapp-Schwelle. */
  const path = svg.querySelector('path.recharts-curve.recharts-line-curve')
  const d = path?.getAttribute('d') ?? ''
  if (!d) return 0
  return (d.match(/[ML]/g) ?? []).length
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Die drei Läufe
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

const ACCENT = { label: 'Akzent (aWATTar mit Speicher)', token: '--color-accent', hex: '#0f766e' }
const TEXT_MUTED = { label: 'Sekundärton (Ihr Tarif heute)', token: '--color-text-muted', hex: '#475569' }
const WARNING = { label: 'Bernstein (abgefangene Spitze)', token: '--color-warning', hex: '#b45309' }
/**
 * Die Zwischenstufe des Monatsvergleichs: `color-mix(in srgb, var(--color-accent) 50%,
 * var(--color-surface))` = 50 % #0f766e auf #ffffff. react-pdf kennt `color-mix()` nicht — im
 * Rasterbild muss der Browser sie also bereits aufgelöst haben, und genau das prüft diese Probe.
 *
 * ── ⚠ TOLERANZ 1, UND DER GRUND IST GEMESSEN ─────────────────────────────────────────────────
 * Der Spike (§2.1) nennt den von Hand nachgerechneten Wert **#87bab6**. Im Bild steht **#87bbb6** —
 * im Grünkanal um eins daneben. Ursache: `getComputedStyle` liefert für `color-mix()` keinen
 * `rgb()`-Wert, sondern `color(srgb 0.529412 0.731373 0.715686)`, also Fliesskomma; die Rundung auf
 * 8 Bit passiert erst im Canvas, und 0,731373 × 255 = 186,5001 landet auf 187, während
 * 0,715686 × 255 = 182,4999 auf 182 landet. Eine gemischte Farbe ohne Toleranz zu prüfen heisst
 * also, die Rundung zu messen statt die Farbe. Für die Tokenfarben selbst bleibt die Toleranz 0 —
 * dort gibt es nichts zu runden.
 */
const ACCENT_MIX = {
  label: 'Akzent 50 % (aWATTar ohne Steuerung)',
  token: 'color-mix(accent 50 %, surface)',
  hex: '#87bab6',
  tolerance: 1,
}

/**
 * Die HELLSTE Stufe der Heatmap-Skala: `color-mix(in srgb, var(--color-accent) 4 %,
 * var(--color-surface))` — die Farbe einer GEMESSENEN Null.
 *
 * ⚠ Sie ist der eigentliche Gegenstand der Regel „leere Zelle ≠ ruhender Speicher": eine Zelle
 * ohne Messwert bleibt durchsichtig (im Bild papierweiss, `#ffffff`) und trägt einen gestrichelten
 * Rand, eine gemessene Null dagegen diesen kaum sichtbaren, aber vorhandenen Teal-Anflug. Verlöre
 * das Rastern den Unterschied, wäre das bei einem Teiljahres-Lastgang die halbe Grafik — und
 * niemandem als Fehler anzusehen.
 *
 * Toleranz 1 wie bei jeder gemischten Farbe (D11, Befund 4): der Browser liefert `color-mix()` als
 * Fliesskomma, die Rundung auf 8 Bit passiert erst im Canvas.
 */
/**
 * `--color-border` — der gestrichelte Rand einer Zelle OHNE Messwert.
 *
 * ⚠ Er ist die zweite Hälfte des Nachweises „leer ≠ gemessene Null": die Füllung einer leeren
 * Zelle ist durchsichtig und im Bild damit papierweiss — genau wie der Kartengrund. Erst der Rand
 * macht sie sichtbar, und nur wenn er das Rastern übersteht, bleibt der Unterschied im PDF
 * erkennbar.
 */
const BORDER = { label: 'Rahmen der leeren Zellen', token: '--color-border', hex: '#e2e8f0' }

const ACCENT_LIGHTEST = {
  label: 'Akzent 4 % (gemessene Null)',
  token: 'color-mix(accent 4 %, surface)',
  hex: '#f5faf9',
  tolerance: 1,
}

export async function runChartProbe(kind: ChartProbeKind): Promise<ChartProbeReport> {
  const started = performance.now()

  if (kind === 'monthly') {
    const raster = await captureChart(<MonthlyTariffChart comparison={MONTHLY_COMPARISON_FIXTURE} />, {
      width: 760,
      /* Der Zeichenbereich, nicht die Karte — ausdrücklich, s. die Warnung an `CaptureOptions.select`. */
      select: selectRechartsSurface,
    })
    const captureMs = performance.now() - started
    const colorSamples = await sampleColors(raster, [ACCENT, ACCENT_MIX, TEXT_MUTED])
    const outcome = await downloadChartProbePdf(
      {
        title: 'Chart-Rasterung — kategorial (Balken)',
        lead:
          'Monatsvergleich „Ist-Tarif vs. aWATTar ohne Steuerung vs. aWATTar mit Speicher". ' +
          'Gerastert wird der unveränderte Recharts-Zeichenbereich der Produktionskomponente.',
        raster,
      },
      'b23b-chart-balken.pdf',
    )
    return {
      ...outcome,
      kind,
      label: 'Kategorial (Balken) — Monatsvergleich',
      captureMs,
      colorSamples,
      cellProbes: null,
      vertices: null,
      notes: [
        `Spaltensummen der Prüfdaten: Ist ${MONTHLY_COMPARISON_TOTALS.currentTariffEur} € · ` +
          `aWATTar ohne ${MONTHLY_COMPARISON_TOTALS.spotWithoutControlEur} € · ` +
          `aWATTar mit Speicher ${MONTHLY_COMPARISON_TOTALS.spotWithBatteryEur} €.`,
        'Ausgewählt wurde `svg.recharts-surface` — der Zeichenbereich, nicht die Karte drumherum.',
      ],
    }
  }

  if (kind === 'heatmap') {
    /*
     * ⚠ HIER GREIFT DER HTML-WEG. Die Heatmap ist ein CSS-Grid aus `div`s und hat gar kein `<svg>`;
     * serialisiert wird deshalb HTML in einem `<foreignObject>`, mit dem vollständigen berechneten
     * Stil je Element. Eine Pipeline, die nur SVG serialisiert, wäre hier still leer geblieben.
     *
     * ⚠ B23c-3b-1: gerastert wird jetzt das BLOSSE RASTER (`selectHeatmapGrid`) und nicht mehr die
     * ganze Karte. Der offene Punkt aus D11 ist damit entschieden — Titel, Beschreibung, Legende
     * und die zwei erklärenden Absätze stehen im Report NATIV daneben (`insight.ts`,
     * `document.tsx`), statt als Bildpunkte im PDF zu landen.
     */
    const grid = buildBatteryFlowFixture()
    let cells: CellSpots = { rootWidthCss: 0, spots: [] }
    const raster = await captureChart(
      <BatteryFlowHeatmap grid={grid} batteryName="PeakStore C25 (Prüfdaten)" />,
      {
        width: 620,
        select: selectHeatmapGrid,
        /* Am LEBENDEN Raster, unmittelbar vor der Rasterung — s. `probeHeatmapCells`. */
        inspect: (el) => {
          cells = probeHeatmapCells(el, grid)
        },
      },
    )
    const captureMs = performance.now() - started
    const colorSamples = await sampleColors(raster, [ACCENT, ACCENT_LIGHTEST, BORDER])
    const cellProbes = await readCellProbes(raster, cells)
    const outcome = await downloadChartProbePdf(
      {
        title: 'Chart-Rasterung — Raster (Heatmap)',
        lead:
          'Netto-Batteriefluss je Stunde und Kalendermonat, auf das blosse Raster zugeschnitten. ' +
          'Die Komponente ist ein CSS-Grid aus div-Elementen und ausdrücklich kein SVG — gerastert ' +
          'über den foreignObject-Weg.',
        raster,
      },
      'b23b-chart-heatmap.pdf',
    )
    return {
      ...outcome,
      kind,
      label: 'Raster (Heatmap) — Stunden × Monate',
      captureMs,
      colorSamples,
      cellProbes,
      vertices: null,
      notes: [
        'Kein `<svg>` im Baum — serialisiert wurde HTML in einem `<foreignObject>`, mit dem ' +
          'vollständigen berechneten Stil je Element (im foreignObject gibt es kein Stylesheet).',
        'Ausgewählt wurde der Anker `stunden-heatmap-raster` — Monatskopf und die 24 Datenzeilen, ' +
          'ohne Titel, Beschreibung, Legende und die beiden Absätze. Sie stehen im Report nativ ' +
          'daneben (D11).',
        'Die drei Zellproben lesen die Farbe an der TATSÄCHLICHEN Position je einer leeren, einer ' +
          'auf null gemessenen und der stärksten Zelle — die einzige Messung, die „leer" von ' +
          '„gemessene Null" trennt, weil eine leere Zelle im Bild papierweiss ist und Papierweiss ' +
          'ohnehin überall steht.',
      ],
    }
  }

  const profile = buildLoadProfileFixture()
  const trace = buildDispatchTraceFixture()
  let drawn = 0
  const raster = await captureChart(
    <LoadChart
      loadProfile={profile}
      dispatchTrace={trace}
      billingModel="annual_max"
      leistungspreisRatePerKwYear={82.92}
    />,
    {
      width: 900,
      select: selectRechartsSurface,
      /* Am LEBENDEN SVG gezählt, unmittelbar vor der Rasterung. */
      inspect: (el) => {
        drawn = countLineVertices(el)
      },
    },
  )
  const captureMs = performance.now() - started
  const colorSamples = await sampleColors(raster, [TEXT_MUTED, ACCENT, WARNING])
  const outcome = await downloadChartProbePdf(
    {
      title: 'Chart-Rasterung — kontinuierlich (Lastgang)',
      lead:
        `Jahres-Lastgang mit ${profile.readings.length.toLocaleString('de-AT')} Viertelstundenwerten, ` +
        `Kapp-Schwelle ${LOAD_FIXTURE_CAP_KW} kW und ${trace.caughtPeaks.length} abgefangenen Spitzen. ` +
        'Die Kurve läuft auf dem echten Weg durch `downsampleMinMax`.',
      raster,
    },
    'b23b-chart-lastgang.pdf',
  )
  return {
    ...outcome,
    kind,
    label: 'Kontinuierlich (Lastgang) — 35.040 Punkte',
    captureMs,
    colorSamples,
    cellProbes: null,
    vertices: { raw: profile.readings.length, drawn },
    notes: [
      'Die Stützpunktzahl ist am gerenderten `<path>` gezählt, nicht aus `downsampleMinMax` ' +
        'abgeleitet — gemessen wird, was der Chart tatsächlich zeichnet.',
      `${trace.caughtPeaks.length} abgefangene Spitzen als Marker; sie kommen unabhängig von der ` +
        'downgesampelten Kurve exakt aus dem Trace.',
    ],
  }
}
