import { BatteryFlowHeatmap } from '@/components/report/battery-flow-heatmap'
import { LoadChart } from '@/components/report/load-chart'
import { MonthlyTariffChart } from '@/components/report/monthly-tariff-chart'
import { captureChart, selectRechartsSurface } from '@/lib/pdf-report/chart-capture'
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
 * ⚠ Was hier gemountet wird, sind die UNVERÄNDERTEN Produktionskomponenten — diese PR ändert an
 * `monthly-tariff-chart.tsx`, `battery-flow-heatmap.tsx` und `load-chart.tsx` keine Zeile. Sie
 * werden gemountet und gelesen, nicht angepasst.
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

export type ChartProbeReport = ChartProbeOutcome & {
  kind: ChartProbeKind
  label: string
  /** Mount + Layout + Rasterung, in ms. */
  captureMs: number
  colorSamples: ColorSample[]
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
const INK = { label: 'Ink (Entladen)', token: '--color-ink', hex: '#0f172a' }
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
     * der Standard-Selektor fällt deshalb auf das erste Kind des Mount-Kastens zurück — die Karte
     * selbst. Eine Pipeline, die nur SVG serialisiert, wäre an dieser Stelle still leer geblieben.
     */
    const raster = await captureChart(
      <BatteryFlowHeatmap grid={buildBatteryFlowFixture()} batteryName="PeakStore C25 (Prüfdaten)" />,
      { width: 620 },
    )
    const captureMs = performance.now() - started
    const colorSamples = await sampleColors(raster, [ACCENT, INK])
    const outcome = await downloadChartProbePdf(
      {
        title: 'Chart-Rasterung — Raster (Heatmap)',
        lead:
          'Netto-Batteriefluss je Stunde und Kalendermonat. Die Komponente ist ein CSS-Grid aus ' +
          'div-Elementen und ausdrücklich kein SVG — gerastert über den foreignObject-Weg.',
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
      vertices: null,
      notes: [
        'Kein `<svg>` im Baum — serialisiert wurde HTML in einem `<foreignObject>`, mit dem ' +
          'vollständigen berechneten Stil je Element (im foreignObject gibt es kein Stylesheet).',
        'Gerastert ist die GANZE Karte samt Fliesstext: die Komponente trägt heute keinen stabilen ' +
          'Anker für den blossen Rasterbereich, und sie in dieser PR anzufassen war ausgeschlossen. ' +
          'Welcher Ausschnitt ins Bild gehört und welcher als nativer Text danebensteht, entscheidet B23c.',
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
    vertices: { raw: profile.readings.length, drawn },
    notes: [
      'Die Stützpunktzahl ist am gerenderten `<path>` gezählt, nicht aus `downsampleMinMax` ' +
        'abgeleitet — gemessen wird, was der Chart tatsächlich zeichnet.',
      `${trace.caughtPeaks.length} abgefangene Spitzen als Marker; sie kommen unabhängig von der ` +
        'downgesampelten Kurve exakt aus dem Trace.',
    ],
  }
}
