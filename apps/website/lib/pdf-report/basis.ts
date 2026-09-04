import {
  NETZBETREIBER_LABELS,
  type BatteryRoiEntry,
  type BillingModel,
  type LoadProfile,
  type TariffPriceRange,
  type TariffSourceRef,
} from 'shared'

import { formatEur, formatEur2, formatPercent } from '@/lib/format'
import type { ReportNotice, ReportRow, ReportStatement } from './statement'
import type { PdfReportAnalysis, PdfReportInput } from './types'

/**
 * B23c-4 — das Kapitel „Annahmen und Datengrundlage": womit gerechnet wurde, woher die Tarifwerte
 * stammen, was an diesem Datensatz zu wissen ist und was nicht berechnet werden konnte.
 *
 * ── ⚠ DIESE DATEI DARF WEDER `@react-pdf/renderer` NOCH RECHARTS ANFASSEN ──────────────────────
 * Sie ist die Ableitung, nicht die Darstellung — derselbe Zuschnitt wie `summary.ts`,
 * `recommendation.ts`, `detail.ts`, `insight.ts`, `comparison.ts` und `derive.ts`. Gerendert wird
 * in `document.tsx`.
 *
 * ── ⚠ DIE TEXTE SIND AUS DEN BILDSCHIRM-KOMPONENTEN ÜBERNOMMEN, NICHT IMPORTIERT ───────────────
 * `print-assumptions-snapshot.tsx`, `tariff-source-note.tsx` und `tariff-optimization-card.tsx`
 * tragen dieselben Sätze. Aus ihnen zu importieren hiesse, aus dem PDF-Verzeichnis in eine
 * React-Komponente zu greifen — und die Blocker-Karte zieht über `sumCovered` aus
 * `monthly-tariff-chart.tsx` die gesamte Chart-Bibliothek in den Lazy-Chunk des PDF-Wegs. Es ist
 * dieselbe bewusste Doppelung des TEXTES wie beim Methodik-Kapitel (`content.ts`) und bei den
 * Leerzustands-Begründungen (`detail.ts`): solange beide Rendering-Wege nebeneinander im Repo
 * stehen, gibt es den Wortlaut zweimal; beim Cutover fällt der CSS-Weg samt Doppelung weg.
 *
 * ── ⚠ WAS DIESES KAPITEL AN DIE STELLE EINES DEAD LINKS SETZT ─────────────────────────────────
 * Der Bildschirm verweist an zwei Stellen auf sich selbst — der Annahmen-Schnappschuss auf „das
 * Annahmen-Panel im Bildschirm-Report", die Blocker-Karte auf „die Empfehlung nebenan". Auf einem
 * weitergereichten Blatt gibt es weder ein Panel noch ein Nebenan. Beide Halbsätze sind deshalb
 * durch die AUSSAGE ersetzt, die sie transportieren sollten (was fest steht, und was vom Befund
 * unberührt bleibt) — und nicht ersatzlos gestrichen: der Inhalt ist in beiden Fällen der Punkt,
 * die Ortsangabe war nur der Weg dorthin.
 *
 * ── DIE EINE AUSNAHME: DER PREISSTAND-SATZ WIRD HEREINGEREICHT ────────────────────────────────
 * Er ist der einzige Teil dieses Kapitels, dessen Aussage von der UHR abhängt, und steht deshalb
 * in `derive.ts` (`tariffVintageNote`) — dort, wo alle Ableitungen wohnen, die einen Stichtag
 * brauchen. Er reist als fertige Zeichenkette in `PdfReportInput` mit, genau wie `period` und
 * `subtitle`; die Begründung steht an der Funktion.
 */

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * 1 — die Annahmen
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * ⚠ BEWUSSTE DOPPELUNG ZU `summary.ts` (`BILLING_MODEL_LABEL`) UND ZUM BILDSCHIRM.
 *
 * Die Karte hätte in ein gemeinsames Modul gehen können; sie steht hier ein zweites Mal, weil die
 * beiden Ableitungen sonst über eine Datei gekoppelt wären, die nichts anderes trägt als drei
 * Zeichenketten. Wer eine der Beschriftungen ändert, ändert sie an beiden Stellen — sie stehen im
 * selben Verzeichnis und nebeneinander im selben Dokument, eine Abweichung fiele sofort auf.
 */
const BILLING_MODEL_LABEL: Record<BillingModel, string> = {
  monthly_max_average: 'Mittel der 12 Monatshöchstwerte',
  annual_max: 'Jahreshöchstwert',
  monthly_max_sum: 'Summe der 12 Monatshöchstwerte',
}

function neutralRow(label: string, value: string): ReportRow {
  return { label, value, tone: 'neutral' }
}

/**
 * Der Stand, mit dem gerechnet wurde.
 *
 * ── ⚠ DAS GERÄT IST DIE KATALOG-EMPFEHLUNG, NICHT DER PRIMÄRE BLOCK ───────────────────────────
 * Anders als überall sonst in diesem Dokument (`primaryEntryOf`) steht hier im Bestandsfall NICHT
 * die Anlage des Kunden. Der Grund ist der Inhalt der Zeilen: Batteriepreis, Gesamtinvestition und
 * Nettoinvestition gibt es nur für ein Katalog-Gerät — die bestehende Anlage trägt sie
 * ausdrücklich nicht (sie ist bezahlt, und der Report weist für sie weder Investition noch
 * Amortisation aus). Wortgleich zur Auswahl in `print-assumptions-snapshot.tsx`, die aus demselben
 * Grund `recommended` liest.
 *
 * ⚠ Fehlt die Empfehlung (leerer Katalog), entfallen GENAU die vier gerätebezogenen Zeilen und
 * nicht die Tabelle — Abrechnungsmodell, Horizont und die beiden Energiepreise hängen an keinem
 * Gerät. Dasselbe Muster wie am Bildschirm (`{recommended && …}`).
 */
function buildAssumptions(analysis: PdfReportAnalysis): ReportStatement {
  const a = analysis.assumptions
  const recommended =
    analysis.perBattery.find((p) => p.battery.id === analysis.recommendation.batteryId) ??
    analysis.perBattery[0]

  const rows: ReportRow[] = [
    neutralRow('Abrechnungsmodell', BILLING_MODEL_LABEL[a.billingModel]),
    neutralRow('Betrachtungshorizont', `${a.horizonYears} Jahre`),
    neutralRow('Arbeitspreis', `${formatEur2(a.energyPriceCtPerKwh / 100)} / kWh`),
    neutralRow('Einspeisevergütung', `${formatEur2(a.einspeiseverguetungCtPerKwh / 100)} / kWh`),
    ...batteryRows(recommended, a.roundTripEfficiency),
  ]

  return {
    id: 'assumptions',
    title: 'Annahmen & Rechenweise — Stand dieser Berechnung',
    /* Keine Kopfzahl: eine Annahmen-Liste hat keine „eine grosse Zahl". */
    amount: null,
    rows,
    body:
      'Das sind die Werte, mit denen dieser Report gerechnet wurde — zum Zeitpunkt seiner ' +
      'Erstellung. Entladetiefe, Arbeitspreis und Einspeisevergütung sind dabei fest und gehen ' +
      'unverändert aus Ihren Angaben ein; die übrigen Grössen lassen sich im Rechner ändern, und ' +
      'ein danach erzeugter Report trägt dann andere Zahlen als dieser.',
  }
}

/**
 * Die vier gerätebezogenen Zeilen.
 *
 * ⚠ Der Wirkungsgrad ist eine GLOBALE Annahme (`assumptions.roundTripEfficiency`) und wird
 * trotzdem mit dem Gerätenamen beschriftet — wortgleich zum Bildschirm, und aus gutem Grund: es
 * ist der Wirkungsgrad, mit dem GENAU dieses Gerät gerechnet wurde, und ohne den Namen daneben
 * läse man ihn als Eigenschaft aller Kandidaten.
 *
 * ⚠ Die Nettoinvestition steht nur, wo Steuer- und Fördereffekte einbezogen wurden. Sonst steht
 * ausdrücklich „keine Angabe (nicht einbezogen)" und nicht der Bruttowert: eine Nettoinvestition,
 * die der Bruttoinvestition entspricht, behauptete eine Rechnung, die gar nicht stattgefunden hat.
 */
function batteryRows(
  recommended: BatteryRoiEntry | undefined,
  roundTripEfficiency: number,
): ReportRow[] {
  if (!recommended) return []
  const name = recommended.battery.name
  return [
    neutralRow(`Wirkungsgrad (${name})`, formatPercent(roundTripEfficiency * 100)),
    neutralRow(`Batteriepreis (${name})`, `${formatEur2(recommended.battery.pricePerKwh)} / kWh`),
    neutralRow('Gesamtinvestition', formatEur(recommended.totalInvestment)),
    neutralRow(
      'Nettoinvestition (nach Förderung/Steuervorteil)',
      recommended.taxEffectsIncluded
        ? formatEur(recommended.netInvestment)
        : 'keine Angabe (nicht einbezogen)',
    ),
  ]
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * 2 — die Datenqualität
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Was der Parser über diesen Datensatz gemeldet hat.
 *
 * ── ⚠ NUR MIT WARNUNGEN — UND DIE ZEILE „Abgedeckt/Lücken" HÄNGT MIT DARAN ────────────────────
 * Wortgleich zum Bildschirm: die ganze Box erscheint dort nur bei `warnings.length > 0`, die
 * Kopfzeile eingeschlossen. Sie herauszulösen und immer zu zeigen wäre eine eigene Entscheidung —
 * und sie stünde dann in fast jedem Report als Kasten da, der nichts meldet („Abgedeckt: 365 Tage
 * · interpolierte Lücken: 0"). Eine Meldung ohne Befund liest man ein zweites Mal nicht mehr.
 *
 * ⚠ GEMESSEN AN `warnings` UND NICHT AN `gapsInterpolated`: ein Datensatz kann interpolierte
 * Lücken tragen, ohne dass der Parser sie für meldenswert hält (er warnt erst oberhalb seiner
 * eigenen Schwelle). Dann steht die Zahl in keinem Kasten — und das ist richtig: die grosse Lücke
 * hat ihren eigenen Hinweis bei der Kern-Kennzahl, wo sie die Zahl qualifiziert.
 */
function buildDataQuality(analysis: PdfReportAnalysis): ReportNotice | null {
  const dq = analysis.dataQuality
  if (dq.warnings.length === 0) return null

  return {
    id: 'data_quality',
    tone: 'neutral',
    title: 'Datenqualität',
    body: `Abgedeckt: ${dq.coveredDays} Tage · interpolierte Lücken: ${dq.gapsInterpolated}`,
    list: { label: null, items: dq.warnings },
    hints: [],
  }
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * 3 — der Blocker-Befund
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Wortgleich aus `tariff-optimization-card.tsx` — welche Seite betroffen ist.
 *
 * ⚠ Es ist bewusst eine GESCHLOSSENE Zuordnung über die zwei Werte, die der Contract kennt, und
 * kein Freitext aus dem Befund: `TariffOptimizationBlocker` trägt `side` als Aufzählung, damit die
 * Anzeige nicht an einem Satz erkennen muss, worum es geht.
 */
const SIDE_LABEL: Record<'grid_tariff' | 'spot_price', string> = {
  grid_tariff: 'Netzentgelte Ihres Netzbetreibers',
  spot_price: 'Börsen-Strompreise',
}

/** Was der Nutzer daraus machen kann — je Grund verschieden, und keiner davon ist sein Fehler. */
const KIND_HINT: Record<'gap' | 'unavailable' | 'price_basis', string> = {
  gap:
    'Für einen Teil Ihres Zeitraums fehlen uns Preise. Eine Lücke zu überbrücken hiesse, Preise zu ' +
    'erfinden — das tun wir nicht. Wir tragen fehlende Marktpreise laufend nach; ein Lastgang aus ' +
    'einem anderen Zeitraum rechnet in der Regel sofort.',
  unavailable:
    'Wir konnten die Preise für diesen Vergleich nicht abrufen. Häufigster Grund: Netzbetreiber ' +
    'oder Netzebene sind nicht gewählt — ohne beides gibt es keine Netzentgelt-Seite. Sonst fehlt ' +
    'der Preisstand bei uns noch und wird nachgetragen.',
  price_basis:
    'Die vorliegenden Preise sind nicht netto ausgewiesen. Wir rechnen sie nicht um: dafür bräuchte ' +
    'es einen Steuersatz, und einen anzunehmen wäre dieselbe Erfindung wie eine geratene Tarifzahl.',
}

/** Ein Zeitbereich in Ortszeit — der Befund trägt UTC-ISO, ein Leser denkt in seiner Uhr. */
function formatRange(range: TariffPriceRange, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('de-AT', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${fmt.format(Date.parse(range.fromIso))} – ${fmt.format(Date.parse(range.toIso))}`
}

/**
 * Warum der Vergleich mit Börsen-Strompreisen nicht berechenbar war.
 *
 * ── ⚠ DAS IST DIE LÜCKE, DIE `recommendation.ts` BENANNT UND HIERHER VERWIESEN HAT ────────────
 * Dort entfällt die Ladesteuerungs-Aussage vollständig, wenn der Hebel nicht berechenbar ist
 * (Delta 15 Regel C) — und der STRUKTURIERTE Befund (`side`/`kind`/`ranges`) erschien im PDF damit
 * gar nicht. Er gehört zu den „was fehlt und warum"-Aussagen und damit hierher, nicht unter eine
 * Überschrift, die einen Wert ankündigt.
 *
 * ⚠ ENTWEDER EINE ZAHL ODER EINE BEGRÜNDUNG, NIE BEIDES: hier steht ausdrücklich KEIN Betrag —
 * auch kein gedämpfter, kein „vorläufiger", keiner aus dem statischen Fensterschema. Genau davor
 * warnt Delta 15: eine Vergleichszahl aus einer anderen Grundlage fällt niemandem als Fehler auf,
 * sondern als Ergebnis.
 *
 * ⚠ `undefined` (Hebel gar nicht angefordert) führt zu KEINEM Befund — „nicht gefragt" ist kein
 * Befund und braucht keine Fläche. Dieselbe Regel wie bei der Karte am Bildschirm.
 *
 * ⚠ Der Schlusssatz ist gegenüber dem Bildschirm angepasst: dort steht „Die Empfehlung nebenan
 * gilt unverändert", und ein „nebenan" gibt es auf einem Blatt nicht. Die Aussage — die
 * Spitzenkappung hängt am Leistungspreis und nicht an den Börsenpreisen — bleibt wortgleich.
 */
function buildBlocker(
  analysis: PdfReportAnalysis,
  timeZone: string,
): ReportNotice | null {
  const status = analysis.tariffOptimization
  if (!status || status.computable) return null

  return {
    id: 'tariff_blocker',
    tone: 'warning',
    title: 'Vergleich mit Börsen-Strompreisen: nicht berechenbar',
    body: `Für diesen Teil zeigen wir bewusst keine Zahl. Betroffen ist die Seite „${SIDE_LABEL[status.side]}".`,
    list:
      status.ranges.length > 0
        ? {
            label: 'Betroffener Zeitraum',
            items: status.ranges.map((r) => formatRange(r, timeZone)),
          }
        : null,
    hints: [
      KIND_HINT[status.kind],
      'Ihre Spitzenkappung ist davon nicht betroffen — sie hängt am Leistungspreis Ihres ' +
        'Netzbetreibers und nicht an den Börsenpreisen. Die Empfehlung und alle Zahlen der ' +
        'vorigen Kapitel gelten unverändert.',
    ],
  }
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * 4 — die Herkunft der Tarifsätze
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/** Anzeigenamen der überschreibbaren Felder — dieselben Bezeichnungen wie in den Formularen. */
const TARIFF_FIELD_LABEL: Record<TariffSourceRef['overriddenFields'][number], string> = {
  leistungspreisEurPerKwYear: 'Leistungspreis',
  billingModel: 'Abrechnungsmodell',
  minBillableKw: 'Mindestleistung',
}

/**
 * Welcher Tarifsatz-Stand dieser Rechnung zugrunde lag — und was davon überschrieben wurde (B11).
 *
 * ── ⚠ ER STEHT IMMER, UND „KEINE AUSWAHL" IST EINE AUSSAGE UND KEINE LEERSTELLE ───────────────
 * Wortgleich zu `tariff-source-note.tsx`: wer keinen Netzbetreiber gewählt hat, hat die Werte aus
 * seiner Rechnung eingetragen — das ist die BESSERE Grundlage, nicht die schlechtere (Prinzip 1).
 * Deshalb steht auch dann etwas da, statt dass der Absatz verschwindet.
 *
 * ⚠ Ohne diese Angabe ist eine später archivierte Baseline nicht einzuordnen: 2027 liesse sich
 * sonst nicht mehr sagen, ob die Zahlen auf unserer Tabelle oder auf der echten Netzrechnung des
 * Kunden beruhten — und das ist beim Wirkungsnachweis genau die Frage, die zuerst gestellt wird.
 */
function buildTariffSource(source: TariffSourceRef | null): string {
  if (!source) {
    return (
      'Tarifsätze: kein hinterlegter Stand gewählt — Leistungspreis, Abrechnungsmodell und ' +
      'Mindestleistung stammen unverändert aus Ihrer Eingabe.'
    )
  }

  const overridden = source.overriddenFields.map((field) => TARIFF_FIELD_LABEL[field])
  const tail =
    overridden.length === 0
      ? 'Die Vorgabewerte wurden unverändert übernommen.'
      : `Selbst eingetragen und damit massgeblich: ${overridden.join(', ')}.`

  return (
    `Tarifsätze: ${NETZBETREIBER_LABELS[source.netzbetreiber]}, Netzebene ${source.netzebene} · ` +
    `Stand „${source.tariffSetLabel}", gültig ab ${source.tariffSetValidFrom}. ${tail}`
  )
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Das Kapitel
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

export type BasisChapter = {
  /** Die Annahmen-Tabelle. Steht immer — gerechnet wurde in jedem Fall mit etwas. */
  assumptions: ReportStatement
  /** Was der Parser gemeldet hat. `null` = keine Warnung, dann steht kein Kasten. */
  dataQuality: ReportNotice | null
  /** Warum der Börsenpreis-Vergleich nicht berechenbar war. `null` = er war es (oder war nicht gefragt). */
  blocker: ReportNotice | null
  /** Die Herkunft der Tarifsätze. Steht immer, auch ohne gewählten Stand. */
  tariffSource: string
  /** Der Preisstand-Hinweis, hereingereicht (`derive.ts`). `null` = kein Hinweis. */
  tariffVintage: string | null
}

export function buildBasisChapter(input: PdfReportInput): BasisChapter {
  return {
    assumptions: buildAssumptions(input.analysis),
    dataQuality: buildDataQuality(input.analysis),
    blocker: buildBlocker(input.analysis, timeZoneOf(input.loadProfile)),
    tariffSource: buildTariffSource(input.tariffSource),
    tariffVintage: input.tariffVintage,
  }
}

/**
 * ⚠ Die Zeitzone kommt aus dem LASTGANG und nicht aus der Umgebung des Browsers: die Zeitbereiche
 * des Blockers beschreiben Stunden im Lastgang des Kunden, und ein Report, der in einer anderen
 * Zeitzone erzeugt wird, muss dieselben Stunden nennen. Dieselbe Quelle wie am Bildschirm
 * (`report.tsx` reicht `loadProfile.timezoneMeta` an die Karte).
 */
function timeZoneOf(loadProfile: Pick<LoadProfile, 'timezoneMeta'>): string {
  return loadProfile.timezoneMeta
}
