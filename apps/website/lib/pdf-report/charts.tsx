import { BatteryFlowHeatmap } from '@/components/report/battery-flow-heatmap'
import { ChargePriceChart } from '@/components/report/charge-price-chart'
import { CostChart } from '@/components/report/cost-chart'
import { EnergyFlowChart } from '@/components/report/energy-flow-chart'
import { LoadChart } from '@/components/report/load-chart'
import { MarginalBenefitChart } from '@/components/report/marginal-benefit-chart'
import { MonthlyTariffChart } from '@/components/report/monthly-tariff-chart'
import { captureChart, selectHeatmapGrid, selectRechartsSurface } from './chart-capture'
import type { ChartRaster } from './chart-raster'
import { comparisonChartPlan } from './comparison'
import { detailChartPlan } from './detail'
import { insightChartPlan } from './insight'
import { primaryEntryOf } from './summary'
import type { PdfReportInput } from './types'

/**
 * B23c-2/B23c-3a — die Chart-Bilder des Reports: GENAU EINMAL je Dokument erzeugt, VOR dem Rendern.
 *
 * ── ⚠ WARUM DAS EINE ORCHESTRIERUNGS- UND KEINE DARSTELLUNGSFRAGE IST ─────────────────────────
 * Der Report wird zwei- bis dreimal gerendert (`render.tsx`: messen, mit Zahlen, im Wächterfall
 * ohne Zahlen). Ein Chart, der IM Dokumentbaum entstünde, entstünde damit zwei- bis dreimal — und
 * das ginge nicht einmal: `pdf(...).toBlob()` ist synchron gegenüber dem Dokumentbaum, während
 * Mounten und Rastern mehrere Frames brauchen (`chart-capture.ts`) und ein DOM voraussetzen.
 * Deshalb: die Bilder entstehen HIER, einmal, und wandern als fertige Data-URIs in alle Durchläufe.
 *
 * Der Nebeneffekt ist der wichtigere: alle Durchläufe bekommen BIT-IDENTISCHE Bilder und damit
 * denselben Umbruch. Würde je Durchlauf neu gerastert, könnte eine um ein Bildpunkt abweichende
 * Höhe den Seitenumbruch verschieben — und dann meldete der Wächter (`measurementsAgree`) eine
 * Abweichung, deren Ursache nirgends im Dokument steht.
 *
 * ── ⚠ B23c-3a: DREI BILDER, ABER NIE MEHR ALS DREI RASTERUNGEN ────────────────────────────────
 * Lastgang · Kostenvergleich (Monatsvergleich ODER kumulierte Kosten — die beiden schliessen
 * einander aus, s. `detail.ts`) · Tages-Energiefluss. Welcher Kosten-Chart entsteht, wird NICHT
 * hier entschieden, sondern in `detailChartPlan` gelesen: die Bildunterschrift im Dokument stammt
 * aus derselben Ableitung, und zwei getrennte Entscheidungen ergäben eine Unterschrift, die ein
 * anderes Bild beschreibt als das darüber.
 *
 * ⚠ `chartBuilds` ist damit NICHT mehr „immer 1", sondern „so viele, wie das Dokument Bilder
 * zeigt" — und weiterhin UNABHÄNGIG von der Zahl der Renderdurchläufe. Genau das ist die Zusage,
 * die der Zähler misst; s. den Kopf von `render.tsx`.
 *
 * ── ⚠ B23c-3b-1: BIS ZU FÜNF BILDER, UND ZWEI DAVON KÖNNEN EINZELN ENTFALLEN ──────────────────
 * Dazu kommen die Stunden-Heatmap und der Ø-Ladepreis. Auch hier wird die ENTSCHEIDUNG gelesen und
 * nicht nachgebaut: `insightChartPlan` sagt, welches der beiden für diesen Fall überhaupt
 * entsteht, und `document.tsx` liest DIESELBE Ableitung für den Text daneben. Die Heatmap ist
 * dabei der EINZIGE Chart des Reports, der über den HTML-Weg gerastert wird (`foreignObject`) —
 * sie ist bewusst kein SVG, und ihr Ausschnitt kommt aus dem Anker `selectHeatmapGrid`.
 *
 * ── ⚠ B23c-3b-2: BIS ZU SECHS BILDER, UND DREI DAVON KÖNNEN EINZELN ENTFALLEN ────────────────
 * Dazu kommt die Grenznutzen-Kurve. Sie ist der EINZIGE Chart, der in beiden Fällen dasselbe
 * Bauteil mit ANDEREN Daten zeigt (`variant: 'addon'` gegen `'catalog'`) — welcher Fall gilt,
 * entscheidet wieder die Ableitung (`comparisonChartPlan`) und nicht dieses Modul, und
 * `document.tsx` liest DIESELBE Ableitung für den Text daneben.
 *
 * ── ⚠ DIESES MODUL ZIEHT RECHARTS ─────────────────────────────────────────────────────────────
 * Es mountet die UNVERÄNDERTEN Produktionskomponenten (Contract-Entscheidung 1, D2: der Chart im
 * PDF ist derselbe, den der Kunde am Bildschirm sieht). Es darf deshalb nur aus dem Lazy-Chunk
 * heraus erreichbar sein — `render.tsx` importiert es, und dorthin führt ausschliesslich der
 * dynamische Import in `download.ts`.
 *
 * ── ⚠ EIN FEHLGESCHLAGENES BILD KOSTET NICHT DAS DOKUMENT ─────────────────────────────────────
 * Scheitert eine Rasterung, bleibt das jeweilige Feld auf `null` und das zugehörige `…Error` trägt
 * den Grund. Das Dokument entsteht trotzdem und sagt an der Stelle des Bildes, dass es fehlt — die
 * Zahlen darüber und darunter sind davon unberührt. Ein geworfener Fehler nähme dem Kunden für ein
 * fehlendes Diagramm den ganzen Report; ein stilles Weglassen liesse ihn nach einem Absatz suchen,
 * der nie kam. Ein Fehlschlag hält die übrigen Bilder NICHT auf.
 */

/** Die Bilder eines Dokuments, samt dem, was beim Erzeugen gemessen wurde. */
export type ReportChartRasters = {
  /** Lastgang mit Kapp-Linie. `null`, wenn kein Bild entstanden ist. */
  load: ChartRaster | null
  /** Warum kein Bild — gesetzt GENAU DANN, wenn `load === null`. */
  loadError: string | null
  /**
   * Stützpunkte, die die Kurve im gerenderten SVG TATSÄCHLICH trägt — am `<path>` gezählt, nicht
   * aus `downsampleMinMax` abgeleitet. Nur so ist gemessen, dass die Reduktion auf dem echten Weg
   * zum Chart durchläuft (dieselbe Prüfung wie in B23b). `null`, wenn kein Bild entstanden ist.
   */
  loadVertices: number | null

  /** Kostenvergleich — welcher, sagt `costKind`. `null`, wenn keiner entstanden ist. */
  cost: ChartRaster | null
  costError: string | null
  /**
   * Welche Fassung gerastert wurde. `null` heisst: es gab keine zu rastern (kein durchgerechnetes
   * Gerät). Reist mit heraus, damit ein Prüflauf die ENTSCHEIDUNG messen kann und nicht nur, dass
   * irgendein Bild entstanden ist.
   */
  costKind: 'monthly' | 'cumulative' | null

  /** Tages-Energiefluss. `null`, wenn die Komponente für diesen Fall keinen Tag hergibt. */
  flow: ChartRaster | null
  flowError: string | null
  /**
   * Die Tagesbeschriftung, die die Komponente beim Rastern TATSÄCHLICH getragen hat — aus dem
   * gerenderten Baum gelesen, nicht abgeleitet (s. `readEnergyFlowDay`). Sie geht in die
   * Bildunterschrift und ist zugleich der Nachweis, WELCHER Tag im Bild steht.
   */
  flowDay: string | null

  /**
   * Stunden-Heatmap. `null`, wenn der Speicher im Zeitraum gar nicht arbeitet — dann rendert die
   * Komponente nichts, und es gibt keinen Ausschnitt zu rastern (s. `insight.ts`).
   */
  hourFlow: ChartRaster | null
  hourFlowError: string | null

  /** Ø-Ladepreis je Monat. `null`, wenn keine echte Preiskurve vorlag. */
  chargePrice: ChartRaster | null
  chargePriceError: string | null

  /**
   * Grenznutzen-Kurve. `null`, wenn weniger als zwei zeichenbare Kandidaten vorliegen — dann
   * rendert die Komponente nichts (s. `comparison.ts`).
   */
  comparison: ChartRaster | null
  comparisonError: string | null
  /**
   * Welche Fassung gerastert wurde: Zusatzgeräte neben einer bestehenden Anlage oder der Katalog.
   * `null` heisst: es gab keine zu rastern. Reist mit heraus, damit ein Prüflauf die ENTSCHEIDUNG
   * messen kann und nicht nur, dass irgendein Bild entstanden ist — dieselbe Rolle wie `costKind`.
   */
  comparisonVariant: 'addon' | 'catalog' | null

  /** Mounten, Layout und Rastern aller Bilder zusammen, in ms. */
  captureMs: number

  /**
   * Dauer JE Bild, in ms.
   *
   * ⚠ `null` heisst „gar nicht gerastert" (der Fall sieht dieses Bild nicht vor) und ausdrücklich
   * nicht „0 ms". Ein fehlgeschlagener Lauf trägt sehr wohl eine Zahl — er hat Zeit gekostet, und
   * beim Rastern ist der teuerste Fall gerade der, der in eine Wartezeit läuft.
   *
   * Reiner DIAGNOSE-Wert wie `captureMs` und `chartBuilds`: er steuert nichts. Er steht hier, weil
   * `captureMs` allein nur sagt, DASS die Rasterung der teure Teil ist, aber nicht, welches Bild
   * ihn ausmacht — und das ist die Zahl, an der eine Optimierung ansetzen müsste.
   */
  figureMs: ReportChartFigureMs
}

/** Dauer je Bild, in Dokumentreihenfolge. `null` = für diesen Fall nicht gerastert. */
export type ReportChartFigureMs = {
  load: number | null
  cost: number | null
  flow: number | null
  hourFlow: number | null
  chargePrice: number | null
  comparison: number | null
}

/**
 * Mount-Breite des Lastgangs in CSS-Pixeln. 900 wie im B23b-Prüflauf gemessen: ergibt bei `scale` 3
 * ein Bild von 2700 px Breite, das in 499 pt Satzbreite rund 390 dpi trägt (Spike §2.4 hält 288 dpi
 * für „im Druckbild nicht störend"). Sie bestimmt zugleich, wie dicht Recharts die Achsen
 * beschriftet — es ist eine Aussage darüber, wie der Chart AUSSEHEN soll, nicht über seine Grösse
 * auf dem Papier. Letztere entsteht ausschliesslich in `fitRasterToWidth`.
 */
const LOAD_CHART_WIDTH_PX = 900

/**
 * Mount-Breite der beiden übrigen Charts. 760 wie im B23b-Balkenlauf gemessen (2130 × 768 px,
 * 307 dpi effektiv).
 *
 * ⚠ BEWUSST SCHMALER ALS DER LASTGANG. Der trägt 2.920 Stützpunkte und braucht jede X-Position,
 * die er kriegen kann; diese beiden tragen zwölf Balkengruppen bzw. 96 Viertelstunden. Eine
 * breitere Mount-Fläche brächte ihnen keine zusätzliche Information, machte die Beschriftungen
 * aber relativ kleiner — der Chart würde im PDF auf dieselbe Satzbreite skaliert.
 */
const DETAIL_CHART_WIDTH_PX = 760

/**
 * Mount-Breite der Stunden-Heatmap. Bewusst SCHMALER als die übrigen, und der Grund ist kein
 * Auflösungs-, sondern ein Proportionsgrund.
 *
 * Das Raster hat feste Zeilenhöhen (16 px je Stunde, 24 Zeilen), aber elastische Spaltenbreiten
 * (`1fr`). Eine breitere Mount-Fläche macht die Zellen also nicht grösser, sondern flacher: bei
 * 760 px trüge jede rund 60 × 16 px, ein Verhältnis von fast 4:1, und das Raster läse sich wie ein
 * Streifenmuster statt wie ein Raster. Am Bildschirm steht die Karte in einer halben Spalte
 * (rund 500 px, davon 452 px Rasterbreite) und die Zellen liegen bei rund 2:1 — 620 px Mount
 * (abzüglich der 48 px Kartenpolsterung: 572 px Raster) kommt dem am nächsten, ohne die Schrift
 * der Monatsköpfe relativ zu klein werden zu lassen.
 *
 * ⚠ Die Grösse auf dem PAPIER entsteht davon unabhängig in `fitRasterToWidth` — diese Zahl
 * entscheidet nur, wie das Bild AUSSIEHT.
 */
const HEATMAP_CHART_WIDTH_PX = 620

/**
 * Zählt die Stützpunkte des Lastgang-Pfads im GERENDERTEN SVG — wortgleich zum B23b-Prüfstand.
 * Recharts zeichnet eine Linie als EINEN `<path>`; die Zahl der Punkte ist die Zahl der
 * Koordinatenbefehle darin.
 */
function countLineVertices(svg: Element): number {
  const path = svg.querySelector('path.recharts-curve.recharts-line-curve')
  const d = path?.getAttribute('d') ?? ''
  if (!d) return 0
  return (d.match(/[ML]/g) ?? []).length
}

/**
 * Liest die Tagesbeschriftung aus dem GERENDERTEN Energiefluss-Baum.
 *
 * ── ⚠ GELESEN, NICHT NACHGEBAUT — und das ist der ganze Punkt ─────────────────────────────────
 * Welcher Tag gilt, entscheidet `EnergyFlowChart` (`worst_caught_peak`, sonst `pv_strong`). Diese
 * Regel hier ein zweites Mal auszuschreiben hiesse, im Dokument ein Datum zu behaupten, das mit
 * dem Bild darüber auseinanderlaufen kann, sobald sich die Komponente ändert — und man sähe es
 * dem Blatt nicht an. Gelesen wird deshalb die Zeile, die die Komponente SELBST gerendert hat.
 *
 * Sie enthält das formatierte Datum und, wo beide Tage vorliegen, zusätzlich welcher gilt (die
 * Komponente führt das als `hidden print:inline`-Span; `textContent` trägt es unabhängig von der
 * Sichtbarkeit). Genau das ist die Angabe, die im PDF sonst verloren ginge: die Zeitachse des
 * Bildes zeigt Uhrzeiten, kein Datum.
 *
 * ⚠ FAIL CLOSED. Findet sich die Zeile nicht (Umbau der Komponente) oder ist sie unplausibel lang,
 * kommt `null` zurück und die Bildunterschrift lässt den Halbsatz weg. Ein aus einem fremden
 * Element gegriffener Text unter einem Bild wäre schlimmer als keine Angabe — dieselbe Regel wie
 * bei `locationText` im PV-Auslegungs-Scan (B22c).
 */
const MAX_FLOW_DAY_CHARS = 120

function readEnergyFlowDay(svg: Element): string | null {
  const chartBox = svg.closest('.recharts-responsive-container')?.parentElement
  const label = chartBox?.previousElementSibling
  if (!label || label.tagName !== 'P') return null
  const text = label.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  if (!text || text.length > MAX_FLOW_DAY_CHARS) return null
  return text
}

/**
 * Wie oft in dieser Sitzung gerastert wurde.
 *
 * ⚠ Ein DIAGNOSE-Zähler, und er steht hier aus einem Grund: die Zusage „je Bild einmal pro
 * Dokument, nicht je Renderdurchlauf" ist der architektonische Punkt dieses Schritts, und eine
 * Zusage, die niemand messen kann, ist eine Behauptung. Er sitzt bewusst an der RASTERUNG und
 * nicht an ihrem Aufrufer — zöge jemand die Erzeugung in den Dokumentbaum, verdoppelte oder
 * verdreifachte er sich, und genau das soll sichtbar werden.
 */
let chartBuildCount = 0

export function reportChartBuildCount(): number {
  return chartBuildCount
}

/**
 * Ein Rasterlauf, der das Dokument nicht kostet.
 *
 * ⚠ `ms` ist `null` GENAU DANN, wenn gar nicht gerastert wurde — nicht bei einem Fehlschlag. Der
 * kostet Zeit wie ein Erfolg (beim Rastern sogar mehr: ein Fehlschlag ist im Regelfall eine
 * abgelaufene Wartezeit), und ihn mit 0 zu führen machte aus einer teuren Zeile eine unsichtbare.
 */
type Attempt = { raster: ChartRaster | null; error: string | null; ms: number | null }

/** Für einen Fall, der dieses Bild gar nicht vorsieht — kein Lauf, keine Zeit, kein Zähler. */
const NOT_RASTERIZED: Attempt = { raster: null, error: null, ms: null }

async function attempt(run: () => Promise<ChartRaster>): Promise<Attempt> {
  chartBuildCount += 1
  const started = performance.now()
  try {
    return { raster: await run(), error: null, ms: performance.now() - started }
  } catch (cause) {
    return {
      raster: null,
      error: cause instanceof Error ? cause.message : 'Unbekannter Fehler',
      ms: performance.now() - started,
    }
  }
}

/**
 * Erzeugt die Chart-Bilder eines Dokuments. EINMAL je Erzeugung aufrufen, vor dem ersten Rendern.
 *
 * ⚠ Der Lastgang hängt am PRIMÄREN Block — im Bestandsfall an der Anlage des Kunden, sonst an der
 * Empfehlung. Dieselbe Auswahl wie `report.tsx` und `recommendation.ts`, und über DIESELBE
 * Funktion: zwei Ableitungen desselben „primären" Geräts ergäben ein Bild, dessen Kapp-Linie zu
 * einer anderen Batterie gehört als die Bildunterschrift darunter.
 *
 * ⚠ Die drei Läufe laufen NACHEINANDER und nicht nebenläufig. `captureChart` hängt seinen
 * Mount-Kasten an den `<body>` und wartet auf Layout-Frames; drei gleichzeitig gemountete
 * Recharts-Bäume konkurrierten um dieselben Frames, und die Wartezeiten (5 s je Lauf) hingen dann
 * aneinander statt für sich zu gelten.
 */
export async function buildReportCharts(input: PdfReportInput): Promise<ReportChartRasters> {
  const started = performance.now()
  const analysis = input.analysis
  const primary = primaryEntryOf(analysis)
  const plan = detailChartPlan(analysis)
  const insight = insightChartPlan(analysis)

  /*
   * [ABGELEITET, keine Contract-Zahl] Roher Leistungspreis-Satz (€/kW·a) aus den Ist-Kosten —
   * wortgleich zu `report.tsx`. `null` bei `billedKw = 0` (leeres oder rein einspeisendes Profil);
   * dann zeigt das Chart die kontrafaktische Kostengrösse je Spitze nicht, was im PDF ohnehin
   * niemand anklicken kann.
   */
  const rate =
    analysis.current.billedKw > 0
      ? analysis.current.leistungspreisCostPerYear / analysis.current.billedKw
      : null

  /*
   * ⚠ Ein Halter statt einer `let`-Variablen: die Zuweisung geschieht in einem Rückruf, und
   * TypeScript verengt eine `let`-Union nach ihrem Initialisierer, ohne den Rückruf zu kennen.
   */
  const measured: { loadVertices: number | null; flowDay: string | null } = {
    loadVertices: null,
    flowDay: null,
  }

  const load = await attempt(() =>
    captureChart(
      <LoadChart
        loadProfile={input.loadProfile}
        dispatchTrace={primary?.dispatchTrace}
        billingModel={analysis.assumptions.billingModel}
        leistungspreisRatePerKwYear={rate}
      />,
      {
        width: LOAD_CHART_WIDTH_PX,
        /*
         * ⚠ AUSDRÜCKLICH der Recharts-Zeichenbereich und nicht der Standardwert. Ohne ihn käme die
         * ganze Karte samt Erklärtext ins Bild — in B23b gemessen: 2280 × 2643 px statt
         * 2280 × 768 px, ohne Fehler und ohne Warnung. Der Text gehört nativ neben das Bild, nicht
         * als Pixel hinein.
         */
        select: selectRechartsSurface,
        inspect: (el) => {
          measured.loadVertices = countLineVertices(el)
        },
      },
    ),
  )

  /*
   * Der Kostenvergleich in der Fassung, die `detail.ts` bestimmt hat.
   *
   * ⚠ Beim kumulierten Vergleich rastert `selectRechartsSurface` den ERSTEN Zeichenbereich der
   * Komponente, also die Kostenkurve. `CostChart` trägt darunter einen ZWEITEN Chart (die
   * gestapelte Ersparnis-Aufschlüsselung); der bleibt bewusst draussen — seine drei Kategorien
   * stehen als Zeilen auf der Kernergebnis-Seite, und dieselbe Aussage ein drittes Mal im selben
   * Dokument ist keine Information mehr (s. `detail.ts`).
   */
  const costPlan = plan.cost
  const cost: Attempt =
    costPlan === null
      ? NOT_RASTERIZED
      : await attempt(() =>
          captureChart(
            costPlan.kind === 'monthly' ? (
              <MonthlyTariffChart comparison={costPlan.comparison} />
            ) : (
              <CostChart
                entry={costPlan.entry}
                currentLeistungspreisCostPerYear={costPlan.currentLeistungspreisCostPerYear}
                horizonYears={costPlan.horizonYears}
              />
            ),
            { width: DETAIL_CHART_WIDTH_PX, select: selectRechartsSurface },
          ),
        )

  /*
   * Der Tages-Energiefluss.
   *
   * ⚠ OHNE INTERAKTION: die Komponente wird mit ihrem Standardzustand gemountet
   * (`preferredTab = null`), und der liefert bereits `worst_caught_peak` bzw. den dokumentierten
   * Rückfall. `onSelectBattery` ist deshalb eine leere Funktion — im PDF gibt es nichts zu wählen.
   * Ein eigener Auswahl-Code hier wäre eine zweite Fassung derselben Regel.
   *
   * ⚠ `plan.flow === null` heisst: die Komponente hat für diesen Fall gar keinen Tag und würde
   * ihren erklärten Leerzustand rendern — dann gibt es keinen Zeichenbereich, `captureChart` liefe
   * fünf Sekunden in die Zeitüberschreitung, und das Ergebnis wäre ein Fehler, wo es eine Aussage
   * braucht. Die Aussage steht im Dokument (`detail.ts`, `flowMissing`).
   */
  const flowPlan = plan.flow
  const flow: Attempt =
    flowPlan === null
      ? NOT_RASTERIZED
      : await attempt(() =>
          captureChart(
            <EnergyFlowChart
              perBattery={flowPlan.entries}
              selectedBatteryId={flowPlan.selectedBatteryId}
              onSelectBattery={() => {}}
              timeZone={input.loadProfile.timezoneMeta}
            />,
            {
              width: DETAIL_CHART_WIDTH_PX,
              select: selectRechartsSurface,
              inspect: (el) => {
                measured.flowDay = readEnergyFlowDay(el)
              },
            },
          ),
        )

  /*
   * Die Stunden-Heatmap — der EINZIGE Chart des Reports über den HTML-Weg.
   *
   * ⚠ `selectHeatmapGrid` und ausdrücklich nicht der Standardwert: der träfe die ganze Karte samt
   * Titel, Beschreibung, Legende und den zwei erklärenden Absätzen (so lief der B23b-Prüfstand).
   * Diese Texte stehen im PDF NATIV daneben (`insight.ts`) — als Bildpunkte wären sie weder
   * durchsuchbar noch kopierbar und bei jeder Skalierung weicher als der Text ringsum (D11).
   *
   * ⚠ `insight.hourFlow === null` heisst: die Komponente rendert für diesen Fall gar nichts (der
   * Speicher arbeitet im Zeitraum nicht). Dann gäbe es keinen Anker, `captureChart` liefe acht
   * Sekunden in die Zeitüberschreitung, und an der Stelle einer Aussage stünde eine technische
   * Meldung. Die Aussage steht im Dokument (`insight.ts`, `hourFlowMissing`).
   */
  const hourFlowPlan = insight.hourFlow
  const hourFlow: Attempt =
    hourFlowPlan === null
      ? NOT_RASTERIZED
      : await attempt(() =>
          captureChart(
            <BatteryFlowHeatmap
              grid={hourFlowPlan.grid}
              batteryName={hourFlowPlan.batteryName}
            />,
            { width: HEATMAP_CHART_WIDTH_PX, select: selectHeatmapGrid },
          ),
        )

  /*
   * Der Ø-Ladepreis je Monat.
   *
   * ⚠ Wieder nur der Zeichenbereich: die Legende der Komponente (mengengewichteter Gesamtpreis,
   * Zahl der Monate unter dem Durchschnitt) liegt ausserhalb und steht im PDF als Zeilen daneben.
   */
  const chargePricePlan = insight.chargePrice
  const chargePrice: Attempt =
    chargePricePlan === null
      ? NOT_RASTERIZED
      : await attempt(() =>
          captureChart(<ChargePriceChart price={chargePricePlan.price} />, {
            width: DETAIL_CHART_WIDTH_PX,
            select: selectRechartsSurface,
          }),
        )

  /*
   * Die Grenznutzen-Kurve.
   *
   * ⚠ `comparisonPlan === null` heisst: weniger als zwei zeichenbare Punkte, und dann rendert
   * `MarginalBenefitChart` bewusst gar nichts (eine Linie durch einen Punkt ist keine Kurve).
   * Ohne diese Vorbedingung liefe `captureChart` acht Sekunden in die Zeitüberschreitung — wie bei
   * Energiefluss und Heatmap. Die Begründung steht im Dokument (`comparison.ts`, `figureMissing`).
   *
   * ⚠ Gerastert wird UNBEDINGT, auch wenn alle Punkte unter der Nulllinie liegen: die Kurve ist
   * dann die Begründung des Klarsatzes darunter (wortgleich zu `report.tsx`).
   */
  const comparisonPlan = comparisonChartPlan(analysis)
  const comparison: Attempt =
    comparisonPlan === null
      ? NOT_RASTERIZED
      : await attempt(() =>
          captureChart(
            <MarginalBenefitChart
              points={comparisonPlan.points}
              horizonYears={comparisonPlan.horizonYears}
              variant={comparisonPlan.variant}
            />,
            { width: DETAIL_CHART_WIDTH_PX, select: selectRechartsSurface },
          ),
        )

  return {
    load: load.raster,
    loadError: load.error,
    loadVertices: load.raster ? measured.loadVertices : null,
    cost: cost.raster,
    costError: cost.error,
    costKind: plan.cost?.kind ?? null,
    flow: flow.raster,
    flowError: flow.error,
    flowDay: flow.raster ? measured.flowDay : null,
    hourFlow: hourFlow.raster,
    hourFlowError: hourFlow.error,
    chargePrice: chargePrice.raster,
    chargePriceError: chargePrice.error,
    comparison: comparison.raster,
    comparisonError: comparison.error,
    comparisonVariant: comparisonPlan?.variant ?? null,
    captureMs: performance.now() - started,
    figureMs: {
      load: load.ms,
      cost: cost.ms,
      flow: flow.ms,
      hourFlow: hourFlow.ms,
      chargePrice: chargePrice.ms,
      comparison: comparison.ms,
    },
  }
}
