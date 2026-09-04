import type { BatteryResultEntry, MonthlyChargePrice } from 'shared'

import { formatKwh1 } from '@/lib/format'
import type { ReportFigure, ReportRow, ReportStatement } from './statement'
import { primaryEntryOf } from './summary'
import type { PdfReportAnalysis } from './types'

/**
 * B23c-3b-1 — das Kapitel „Das Ladeverhalten Ihres Speichers": die Stunden-Heatmap und der
 * Ø-Ladepreis je Monat.
 *
 * ── ⚠ DIESE DATEI DARF WEDER `@react-pdf/renderer` NOCH RECHARTS ANFASSEN ──────────────────────
 * Sie ist die Ableitung, nicht die Darstellung — derselbe Zuschnitt wie `summary.ts`,
 * `recommendation.ts`, `detail.ts` und `derive.ts`. Gerendert wird in `document.tsx`, gerastert in
 * `charts.tsx`; beide lesen die ENTSCHEIDUNG, was entsteht, aus `insightChartPlan`.
 *
 * ── ⚠ DIE EINE BEDINGUNG IST DIE AUS `report.tsx`, NICHT EINE ZWEITE ──────────────────────────
 * Am Bildschirm lautet sie `primaryEntry && (hourFlow || chargePrice)` — reines Vorhandensein der
 * beiden Trace-Felder, ausdrücklich OHNE Zweitprüfung an `tariffOptimization.computable`. Die
 * Engine setzt `monthlyChargePrice` ausschliesslich bei einer echten Preiskurve (`trace.ts`), und
 * eine hier nachgebaute Prüfung könnte davon abweichen; die Frage „darf ich diese Zahlen zeigen"
 * hat einen Ort.
 *
 * ── ⚠ EINE VORBEDINGUNG KOMMT DAZU, UND SIE IST KEINE ZWEITE FACHREGEL ────────────────────────
 * `BatteryFlowHeatmap` rendert bewusst NICHTS, wenn keine einzige Zelle einen von null
 * verschiedenen Wert trägt (`!anyCovered || maxAbs === 0` — ein Speicher, der im ausgewerteten
 * Zeitraum gar nicht arbeitet). Am Bildschirm ist das folgenlos: die Karte fällt weg, daneben
 * steht der Preis-Chart. Auf dem Rasterweg ist es das nicht — `captureChart` wartet auf ein
 * Element mit Ausdehnung und liefe acht Sekunden in eine Zeitüberschreitung, um dann eine
 * technische Meldung an die Stelle zu setzen, an der eine Aussage stehen müsste. Geprüft wird
 * deshalb dieselbe VORBEDINGUNG, die die Komponente prüft, und ausdrücklich nichts darüber hinaus
 * — genau wie `hasRepresentativeDay` in `detail.ts`.
 *
 * ── ⚠ DAS GANZE KAPITEL ENTFÄLLT, WENN BEIDE BILDER ENTFALLEN ─────────────────────────────────
 * Gemessen tritt das ein: im Blocker-Fall (Bestandsanlage, keine Marktpreise) arbeitet der
 * statisch gesteuerte Speicher gar nicht — keine Spitzenkappung, kein PV-Überschuss, kein
 * günstiges Fenster —, die Heatmap trägt nur Nullen und den Ø-Ladepreis gibt es ohne Preiskurve
 * ohnehin nicht. Ein Kapitel, das dann nur sagt, dass es leer ist, wäre ein Agenda-Eintrag auf
 * eine leere Seite (D14). Die Agenda führt es deshalb ebenfalls nur, wenn es entsteht — genau die
 * Regel, die `content.ts` seit B23a für sich in Anspruch nimmt („Sie führt AUSSCHLIESSLICH
 * Abschnitte, die tatsächlich gerendert werden").
 *
 * ── ⚠ WAS NEBEN DEN BILDERN STEHT, WIRD HIER GERECHNET — UND NUR HIER ─────────────────────────
 * Gerastert wird bei der Heatmap ausschliesslich das RASTER (Monatskopf + 24 Zeilen, über den
 * Anker aus `battery-flow-heatmap.tsx`), beim Ladepreis ausschliesslich der
 * Recharts-Zeichenbereich. Legende, Kennzahlen und die erklärenden Absätze der beiden Komponenten
 * liegen AUSSERHALB dieser Ausschnitte und müssen im PDF nativ danebenstehen (D11: Text gehört
 * nicht als Bildpunkte in ein Dokument). Die Zahlen dafür — stärkste Zelle, Hauptladestunde,
 * mengengewichtete Gesamtpreise — entstehen deshalb HIER, EINMAL, und werden von Bildunterschrift
 * UND Fliesstext gemeinsam gelesen.
 *
 * ⚠ Dass die beiden Komponenten dieselben Grössen für den BILDSCHIRM ein zweites Mal bilden, ist
 * die bewusst in Kauf genommene Doppelung zwischen den zwei Rendering-Wegen — dieselbe, die
 * `content.ts` für den Methodik-Text und `detail.ts` für die Leerzustands-Begründungen benennt.
 * Sie über einen Import aus der Komponente aufzulösen ginge nicht, ohne diese Ableitung an React
 * und an die Darstellung zu binden; die Formeln stehen deshalb hier ausgeschrieben und mit einem
 * Verweis auf ihre Zwillinge.
 */

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Der Plan: was gerastert wird
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/** Die Props der Stunden-Heatmap — wortgleich zur Auswahl in `report.tsx`. */
export type InsightHourFlowPlan = {
  grid: (number | null)[][]
  batteryName: string
}

export type InsightChartPlan = {
  hourFlow: InsightHourFlowPlan | null
  chargePrice: { price: MonthlyChargePrice } | null
}

/**
 * Was die Heatmap aus ihrem Raster ableitet — die zwei Zahlen, die im PDF neben dem Bild stehen.
 *
 * ⚠ `hasData` ist die VORBEDINGUNG der Komponente, nicht eine eigene Regel: sie rendert bei
 * `!anyCovered || maxAbs === 0` nichts. Beides fällt hier zu `maxAbsKwh > 0` zusammen — ohne eine
 * einzige nicht-leere Zelle bleibt das Maximum 0, und tragen alle nicht-leeren Zellen eine echte
 * Null, ebenfalls. Die Äquivalenz ist der Grund, warum hier nur EINE Zahl steht und nicht zwei.
 */
export type HourFlowSummary = {
  /** Betrag der stärksten Zelle, in kWh. */
  maxAbsKwh: number
  /** Stunde mit der grössten Netto-LADUNG über alle Monate (0..23). */
  peakHour: number
  /** Kalendermonate mit mindestens einem Messwert. */
  coveredMonths: number
  /** Zellen ohne Messwert — die gestrichelten. */
  emptyCells: number
  hasData: boolean
}

const HOURS = 24
const MONTHS = 12

/**
 * ⚠ WORTGLEICH ZUR RECHNUNG IN `battery-flow-heatmap.tsx` — s. Modulkopf.
 *
 * Die Hauptladestunde ist das Maximum der SPALTENSUMME je Stunde über alle Monate (nicht der
 * grösste Einzelwert): gefragt ist, wann der Speicher über den ganzen Zeitraum am meisten Energie
 * aufnimmt, nicht in welcher einzelnen Zelle einmal am meisten floss. Bei Gleichstand gewinnt die
 * frühere Stunde — der strikte Vergleich hält den zuerst gefundenen.
 */
export function summarizeHourFlow(grid: (number | null)[][]): HourFlowSummary {
  let maxAbsKwh = 0
  let emptyCells = 0
  let peakHour = 0
  let peakSum = -Infinity
  const monthCovered = new Array<boolean>(MONTHS).fill(false)

  for (let h = 0; h < HOURS; h++) {
    const row = grid[h] ?? []
    let sum = 0
    for (let m = 0; m < MONTHS; m++) {
      const value = row[m]
      if (value == null) {
        emptyCells += 1
        continue
      }
      monthCovered[m] = true
      sum += value
      const abs = Math.abs(value)
      if (abs > maxAbsKwh) maxAbsKwh = abs
    }
    if (sum > peakSum) {
      peakSum = sum
      peakHour = h
    }
  }

  return {
    maxAbsKwh,
    peakHour,
    coveredMonths: monthCovered.filter(Boolean).length,
    emptyCells,
    hasData: maxAbsKwh > 0,
  }
}

/**
 * Die Gesamtzahlen des Ladepreis-Charts.
 *
 * ⚠ WORTGLEICH ZUR RECHNUNG IN `charge-price-chart.tsx` — s. Modulkopf. MENGENGEWICHTET über alle
 * Monate (`Σ(Preis × Menge) / Σ Menge`) und ausdrücklich nicht als arithmetisches Mittel der
 * Monatspreise: dort wöge jeder Monat gleich schwer, egal wie viel er trägt, und ein einzelner
 * schwacher Monat kippte die Aussage.
 */
export type ChargePriceSummary = {
  chargeCtPerKwh: number | null
  chargedKwh: number
  dischargeCtPerKwh: number | null
  dischargedKwh: number
  /** Monate mit Messwerten (an `averageCtPerKwh` erkannt — s. `MonthlyChargePrice`). */
  measuredMonths: number
  /** Davon jene, in denen der Ladepreis unter dem Monatsdurchschnitt lag. */
  betterThanAverage: number
}

export function summarizeChargePrice(price: MonthlyChargePrice): ChargePriceSummary {
  let chargedKwh = 0
  let chargeCost = 0
  let dischargedKwh = 0
  let dischargeCost = 0
  let measuredMonths = 0
  let betterThanAverage = 0

  for (let i = 0; i < MONTHS; i++) {
    const avg = price.averageCtPerKwh[i]
    if (avg != null) measuredMonths += 1

    const charge = price.chargeCtPerKwh[i]
    const kwh = price.chargedKwh[i]
    if (charge != null && kwh != null && kwh > 0) {
      chargedKwh += kwh
      chargeCost += charge * kwh
      if (avg != null && charge < avg) betterThanAverage += 1
    }

    const discharge = price.dischargeCtPerKwh[i]
    const dischargeKwh = price.dischargedKwh[i]
    if (discharge != null && dischargeKwh != null && dischargeKwh > 0) {
      dischargedKwh += dischargeKwh
      dischargeCost += discharge * dischargeKwh
    }
  }

  return {
    chargeCtPerKwh: chargedKwh > 0 ? chargeCost / chargedKwh : null,
    chargedKwh,
    dischargeCtPerKwh: dischargedKwh > 0 ? dischargeCost / dischargedKwh : null,
    dischargedKwh,
    measuredMonths,
    betterThanAverage,
  }
}

/**
 * Der PRIMÄRE Block — im Bestandsfall die Anlage des Kunden, sonst die Empfehlung.
 *
 * ⚠ Über DIESELBE Funktion wie der Lastgang-Chart und die Executive Summary (`primaryEntryOf`):
 * zwei Ableitungen desselben „primären" Geräts ergäben eine Heatmap, die zu einer anderen Batterie
 * gehört als die Bildunterschrift darunter.
 */
export function insightChartPlan(analysis: PdfReportAnalysis): InsightChartPlan {
  const entry: BatteryResultEntry | undefined = primaryEntryOf(analysis)
  const trace = entry?.dispatchTrace
  const grid = trace?.batteryFlowByHourMonth
  const price = trace?.monthlyChargePrice

  return {
    hourFlow:
      entry && grid && summarizeHourFlow(grid).hasData
        ? { grid, batteryName: entry.battery.name }
        : null,
    chargePrice: entry && price ? { price } : null,
  }
}

/** Gibt es das Kapitel überhaupt? — die Bedingung, an der auch der Agenda-Eintrag hängt. */
export function hasInsightChapter(analysis: PdfReportAnalysis): boolean {
  const plan = insightChartPlan(analysis)
  return plan.hourFlow !== null || plan.chargePrice !== null
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Das Kapitel: was neben den Bildern steht
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

export type InsightChapter = {
  /** Was zur Heatmap gehört. `null` = sie entsteht in diesem Fall nicht. */
  hourFlow: { figure: ReportFigure; statement: ReportStatement } | null
  /** Warum sie nicht entsteht. Gesetzt GENAU DANN, wenn `hourFlow === null`. */
  hourFlowMissing: string | null
  /** Was zum Ladepreis-Chart gehört. `null` = er entsteht in diesem Fall nicht. */
  chargePrice: { figure: ReportFigure; statement: ReportStatement } | null
  /** Warum er nicht entsteht. Gesetzt GENAU DANN, wenn `chargePrice === null`. */
  chargePriceMissing: string | null
}

function neutralRow(label: string, value: string): ReportRow {
  return { label, value, tone: 'neutral' }
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00 Uhr`
}

/**
 * Ct/kWh in der Schreibweise des Charts.
 *
 * ⚠ Wortgleich zum `formatCt` der Komponente (de-AT, höchstens zwei Nachkommastellen): die Zahlen
 * im Bild und die Zahlen daneben stehen im selben Blick, und zwei Rundungen derselben Grösse sähen
 * aus wie zwei Messungen. `lib/format.ts` führt keinen ct-Formatierer — ihn dort zu ergänzen wäre
 * eine Änderung an einem Modul, das der Bildschirm-Report ebenfalls liest.
 */
function formatCtPerKwh(value: number): string {
  return `${new Intl.NumberFormat('de-AT', { maximumFractionDigits: 2 }).format(value)} ct/kWh`
}

/**
 * Die Heatmap.
 *
 * ⚠ DIE BILDUNTERSCHRIFT BESCHREIBT DAS BILD, NICHT DIE KARTE. Was gerastert wird, ist das blosse
 * Raster; Titel, Beschreibung, Legende und die zwei erklärenden Absätze der Komponente stehen im
 * PDF nativ daneben. Die Unterschrift muss deshalb sagen, was Zeilen, Spalten, Sättigung und die
 * gestrichelten Zellen bedeuten — am Bildschirm steht das teils in der Legende, teils im Text
 * darüber.
 */
function buildHourFlow(
  plan: InsightHourFlowPlan,
): { figure: ReportFigure; statement: ReportStatement } {
  const summary = summarizeHourFlow(plan.grid)

  const rows: ReportRow[] = [
    neutralRow('Stärkste Zelle', formatKwh1(summary.maxAbsKwh)),
    neutralRow('Am meisten geladen um', formatHour(summary.peakHour)),
  ]
  /*
   * Die Zahl der leeren Zellen nur, wo es welche gibt. „0 Zellen ohne Messwert" wäre eine Zeile
   * über etwas, das es nicht gibt — dieselbe Regel wie bei den Grundgebühren in `detail.ts`.
   */
  if (summary.emptyCells > 0) {
    rows.push(
      neutralRow(
        'Zellen ohne Messwert',
        `${summary.emptyCells} von ${HOURS * MONTHS} (${summary.coveredMonths} von ${MONTHS} Monaten gemessen)`,
      ),
    )
  }

  return {
    figure: {
      caption:
        'Zeilen sind die 24 Stunden des Tages in Ortszeit, Spalten die zwölf Kalendermonate. Die ' +
        'Sättigung einer Zelle steht für die Menge, gemessen an der stärksten Zelle des Rasters: ' +
        'petrol für netto geladene, dunkel für netto entladene Energie. Zellen ohne Messwert sind ' +
        'leer und gestrichelt umrandet — sie sind ausdrücklich etwas anderes als eine gemessene ' +
        'Null, die als hellste Stufe der Skala erscheint.',
      note: null,
    },
    statement: {
      id: 'hour_flow',
      title: `Wann lädt und entlädt ${plan.batteryName}?`,
      /*
       * ⚠ KEINE KOPFZAHL. Die stärkste Zelle ist ein Maßstab für das Bild und keine
       * Ersparnis — als grosse Zahl über einer Grafik gesetzt läse sie sich wie ein Ergebnis.
       */
      amount: null,
      rows,
      body:
        `Gezählt ist die Menge am NETZ, also das, was bezogen bzw. eingespart wurde — nicht die im ` +
        'Speicher ankommende Energie; die liegt auf der Ladeseite um den Wirkungsgrad darunter. ' +
        'Wandert der Ladeschwerpunkt über die Monate, folgt die Steuerung dem Preis: im Winter ' +
        'liegen die günstigen Stunden meist nachts, im Sommer um die Mittagszeit. Die Auflösung ist ' +
        'bewusst stündlich und nicht viertelstündlich — die Börsenpreise, an denen sich die Ladung ' +
        'ausrichtet, gelten je Stunde, und eine feinere Darstellung zeigte Unterschiede, die aus der ' +
        'Last stammen und nicht aus der Steuerung.',
    },
  }
}

/**
 * Der Ø-Ladepreis.
 *
 * ⚠ DIE DREI KENNZAHLEN MÜSSEN NEBEN DEM BILD STEHEN. Gerastert wird der Recharts-Zeichenbereich;
 * die Legende der Komponente — mengengewichteter Gesamt-Lade- und -Entladepreis und die Zahl der
 * Monate unter dem Durchschnitt — liegt ausserhalb davon. Ohne die Zeilen stünden zwölf
 * unbeschriftete Balkenpaare und eine gestrichelte Linie, deren Bedeutung nirgends im Dokument
 * steht.
 */
function buildChargePrice(
  price: MonthlyChargePrice,
): { figure: ReportFigure; statement: ReportStatement } {
  const summary = summarizeChargePrice(price)

  const rows: ReportRow[] = [
    neutralRow(
      'Geladen zu',
      summary.chargeCtPerKwh == null
        ? '—'
        : `${formatCtPerKwh(summary.chargeCtPerKwh)} · ${formatKwh1(summary.chargedKwh)} bezogen`,
    ),
    neutralRow(
      'Entladen zu',
      summary.dischargeCtPerKwh == null
        ? '—'
        : `${formatCtPerKwh(summary.dischargeCtPerKwh)} · ${formatKwh1(summary.dischargedKwh)} abgegeben`,
    ),
    neutralRow(
      'Unter dem Monatsdurchschnitt',
      `in ${summary.betterThanAverage} von ${summary.measuredMonths} gemessenen Monaten`,
    ),
  ]

  return {
    figure: {
      caption:
        'Je Monat zwei Balken: petrol der mengengewichtete Ø-Preis der LADE-Stunden, hell der der ' +
        'Entlade-Stunden. Die gestrichelte Linie ist der Monatsdurchschnitt ALLER Stunden — also ' +
        'der Preis, den ein Speicher zahlte, der blind über den Monat verteilt lädt. Monate ohne ' +
        'Messwert bleiben leer; über eine Lücke wird die Linie nicht durchgezogen.',
      note:
        'Liegt der Ladebalken unter der Linie, hat die Steuerung die günstigen Stunden tatsächlich ' +
        'getroffen. Ohne diesen Vergleichswert wäre der Preis für sich keine Auskunft: teuer oder ' +
        'günstig ist er erst gegenüber dem, was in diesem Monat überhaupt zu zahlen war.',
    },
    statement: {
      id: 'charge_price',
      title: 'Zu welchem Preis wird geladen?',
      /*
       * ⚠ KEINE KOPFZAHL — der Preisvorteil in Euro steht als „Wert der Ladesteuerung" bereits auf
       * der Kernergebnis-Seite und im Empfehlungs-Kapitel. Ein dritter, hier gross gesetzter Betrag
       * derselben Sache lüde dazu ein, ihn zu addieren (dieselbe Regel wie in B23c-2/3a).
       */
      amount: null,
      rows,
      body:
        'Alle Beträge netto (ohne USt.) und mengengewichtet: ein Monat mit wenigen Kilowattstunden ' +
        'und einem sehr guten Preis wiegt entsprechend leicht. Die geladene Menge ist die am Netz ' +
        'BEZOGENE, also die bezahlte. Gerechnet ist das rückblickend auf die tatsächlichen ' +
        'Marktpreise Ihres Zeitraums — kein Versprechen für die Zukunft; und die Ladesteuerung folgt ' +
        'einer einfachen Schwellenregel, die noch nicht gegen ein rechnerisches Optimum geprüft ist: ' +
        'der Abstand zum Durchschnitt gilt als Untergrenze, mit besserer Steuerung eher mehr.',
    },
  }
}

/**
 * Warum keine Heatmap da ist.
 *
 * ⚠ Erreichbar nur, wenn der Ladepreis-Chart steht (sonst gibt es das Kapitel gar nicht) — der
 * Satz erscheint also nie allein auf einer Seite. Er nennt die Vorbedingung im Klartext, statt den
 * Leser nach einem Bild suchen zu lassen, das es nicht gibt.
 */
const HOUR_FLOW_MISSING =
  'Für diesen Report ist keine Stunden-Heatmap abgebildet: im ausgewerteten Zeitraum hat der ' +
  'Speicher in keiner einzigen Stunde Energie aufgenommen oder abgegeben, das Raster wäre ' +
  'durchgehend leer. Die Zahlen dieses Reports sind davon nicht betroffen — sie stammen aus der ' +
  'Simulation, nicht aus der Abbildung.'

/**
 * Warum kein Ladepreis-Chart da ist.
 *
 * ⚠ Delta 15 Regel C, in einem Satz: OHNE echte Preiskurve gibt es keine bewertbare Ladesteuerung,
 * und `intervalTariffRates` füllt die Reihe in diesem Fall bewusst mit dem Standard-Arbeitspreis.
 * Eine daraus gebildete Grafik zeigte in jedem Monat „Ladepreis = Entladepreis = Durchschnitt" und
 * behauptete damit, die Steuerung bringe nichts — statt zu sagen, dass sie nicht bewertbar ist.
 */
const CHARGE_PRICE_MISSING =
  'Für diesen Report ist kein Ø-Ladepreis abgebildet: für den ausgewerteten Zeitraum liegt keine ' +
  'durchgehende Börsenpreis-Reihe vor, und ohne sie gibt es keinen Preis, gegen den sich die ' +
  'Ladestunden vergleichen liessen. Eine Ersatzkurve aus Ihrem Standard-Arbeitspreis zeigte in ' +
  'jedem Monat denselben Wert und behauptete damit, die Ladesteuerung bringe nichts — sie ist ' +
  'hier schlicht nicht bewertbar.'

export function buildInsightChapter(analysis: PdfReportAnalysis): InsightChapter {
  const plan = insightChartPlan(analysis)
  const hourFlow = plan.hourFlow ? buildHourFlow(plan.hourFlow) : null
  const chargePrice = plan.chargePrice ? buildChargePrice(plan.chargePrice.price) : null

  return {
    hourFlow,
    hourFlowMissing: hourFlow ? null : HOUR_FLOW_MISSING,
    chargePrice,
    chargePriceMissing: chargePrice ? null : CHARGE_PRICE_MISSING,
  }
}
