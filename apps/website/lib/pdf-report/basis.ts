import type { PvOutageMonth } from 'engine'
import {
  AWATTAR_BASE_FEE,
  NETZBETREIBER_LABELS,
  TARIFF_SETS,
  type BatteryCatalogMeta,
  type BatteryRoiEntry,
  type BillingModel,
  type EstimatedPvSummary,
  type LoadProfile,
  type LoadSource,
  type NetzbetreiberId,
  type PvStage,
  reportSectionEnabled,
  type TariffPriceRange,
  type TariffSourceRef,
} from 'shared'

import { formatDateOnly, formatEur, formatEur2, formatPercent } from '@/lib/format'
import { REPORT_SECTIONS, SECTION_ID, type ReportSection } from './content'
import type { ReportBuildContext } from './context'
import { hasPvValueChapter } from './pv-value'
import { block, ref, t, REF_PLACE, type ReportText } from './report-text'
import type {
  ReportNotice,
  ReportRow,
  ReportStatement,
  ReportTable,
  ReportTableRow,
} from './statement'
import { primaryEntryOf, recommendedEntryOf } from './summary'
import { buildWaysChapter, hasWaysChapter } from './ways'
import { TARIFF_SOURCE_UNTRACKED } from './types'
import type {
  PdfReportAnalysis,
  PdfReportInput,
  PdfReportInvoicePeriod,
  PdfReportTariffProvenance,
  PdfReportTariffSource,
} from './types'

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
 * nicht die Tabelle — der Betrachtungshorizont hängt an keinem Gerät. Dasselbe Muster wie am
 * Bildschirm (`{recommended && …}`).
 *
 * ── ⚠ D9: DIE DREI TARIFZEILEN SIND HIER RAUS UND STEHEN JETZT IN DER TARIFKOMPONENTEN-TABELLE ─
 * Abrechnungsmodell, Arbeitspreis und Einspeisevergütung sind `TariffParams`-Felder und gehören zu
 * den übrigen Tarifgrössen, nicht zwischen Horizont und Batteriepreis. Sie SIND dabei
 * zeichengleich umgezogen (dieselben Beschriftungen, dieselbe Formatierung) — stehen gelassen
 * hätten sie dieselbe Zahl zweimal auf einer Seite getragen, und die zweite Fassung liefe beim
 * nächsten Umbau von der ersten weg.
 */
export function buildAssumptions(analysis: PdfReportAnalysis): ReportStatement {
  const a = analysis.assumptions
  /* Report-Baukasten B1: dieselbe Rückfallkette wie überall sonst, jetzt aus EINER Funktion. */
  const recommended = recommendedEntryOf(analysis)

  const rows: ReportRow[] = [
    neutralRow('Betrachtungshorizont', `${a.horizonYears} Jahre`),
    ...batteryRows(recommended, a.roundTripEfficiency),
  ]

  return {
    id: 'assumptions',
    title: 'Annahmen & Rechenweise — Stand dieser Berechnung',
    /* Keine Kopfzahl: eine Annahmen-Liste hat keine „eine grosse Zahl". */
    amount: null,
    rows,
    /*
     * ── ⚠ STUFE D: DIE RICHTUNG IST DER GANZE PUNKT (Kante L, Plan §1.6) ────────────────────────
     * „weiter unten" gilt, solange die Annahmen VOR der Tarifkomponenten-Tabelle stehen. Block 3
     * Nr. 21 zieht die Anlagedaten auf eine Voraussetzungs-Seite nach VORNE — dann dreht sich die
     * Richtung, und ein geschriebenes „weiter unten" wäre still falsch. Der Resolver bildet sie
     * aus der Leseordnung (`layout.ts`); heute ergibt das wortgleich „weiter unten".
     *
     * ⚠ Der NAME der Tabelle bleibt geschrieben: eine `ReportTable` trägt keinen Titel, ihre
     * Überschrift steht als Literal im JSX (s. `ReportTable`).
     */
    body: t`Das sind die Werte, mit denen dieser Report gerechnet wurde — zum Zeitpunkt seiner Erstellung. Die Entladetiefe ist dabei fest und geht unverändert aus Ihren Angaben ein; die übrigen Grössen lassen sich im Rechner ändern, und ein danach erzeugter Report trägt dann andere Zahlen als dieser. Die Tarifgrössen selbst stehen ${ref(
      block(TARIFF_COMPONENTS_TABLE_ID),
      `${REF_PLACE} in der Tabelle „Tarifkomponenten"`,
      'in der Tabelle „Tarifkomponenten"',
    )}, mit ihrer Herkunft daneben.`,
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
export function buildDataQuality(analysis: PdfReportAnalysis): ReportNotice | null {
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
const SIDE_LABEL: Record<'grid_tariff' | 'spot_price' | 'levy', string> = {
  grid_tariff: 'Netzentgelte Ihres Netzbetreibers',
  spot_price: 'Börsen-Strompreise',
  levy: 'gesetzliche Abgaben (Elektrizitätsabgabe, EAG, Gebrauchsabgabe)',
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
export function buildBlocker(analysis: PdfReportAnalysis, timeZone: string): ReportNotice | null {
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
 * 3a — was die PV-Anlage im Lastgang gezeigt hat (D5)
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

const MONTH_NAMES = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
]

/** „Februar 2025" — mit Jahr, weil ein Lastgang über einen Jahreswechsel laufen kann. */
function formatOutageMonth(entry: PvOutageMonth): string {
  return `${MONTH_NAMES[entry.month - 1] ?? String(entry.month)} ${entry.year}`
}

/**
 * D5 — Monate, in denen die vorhandene PV-Anlage im Lastgang keinen Mittagseinbruch zeigte.
 *
 * ── ⚠ ZWEI BEDINGUNGEN, UND BEIDE SIND NÖTIG (D4-Matrix, Zeile „PV vorhanden") ────────────────
 * Ohne die Angabe einer Anlage ist ein fehlender Mittagseinbruch kein Befund, sondern der
 * Normalzustand jedes Betriebs ohne PV — der Hinweis stünde dann als Vorwurf an eine Anlage da, die
 * es nicht gibt. Und ohne erkannten Monat gibt es nichts zu melden: ein „alles unauffällig" wäre
 * eine Unbedenklichkeitsbescheinigung, die diese Auswertung nicht ausstellen kann (s. die
 * Referenzbedingung in `detectPvOutageMonths`).
 *
 * ── ⚠ EINE BEOBACHTUNG ÜBER DEN ZEITRAUM, KEINE AUSSAGE ÜBER DIE ANLAGE VON HEUTE ─────────────
 * Der Lastgang ist Vergangenheit, oft ein Jahr und mehr. Was er zeigt, ist, dass in diesen Monaten
 * nichts zu sehen war — nicht, dass die Anlage jetzt steht, und auch nicht, WARUM sie es tat
 * (Ausfall, Verschattung, Schnee, ein Zähler, eine Anlage, die damals noch nicht lief). Der Text
 * sagt deshalb, was gemessen wurde, und stellt die Deutung als FRAGE an den Kunden, der seine
 * Anlage kennt. Ton wie die „Einordnung" im Urbanz-Report: benennen, einordnen, nicht diagnostizieren.
 *
 * ⚠ HIER STEHT KEIN ENTGANGENER ERTRAG IN EURO. Was die Ausfallzeit gekostet hat, ist die
 * PV-Gegenrechnung — ein eigener Baustein, der ein Erzeugungsmodell braucht. Eine hier
 * hingeschriebene Hausnummer wäre genau die Zahl aus anderer Grundlage, vor der Delta 15 warnt:
 * sie fällt niemandem als Fehler auf, sondern als Ergebnis.
 */
/**
 * Titel des PV-Befunds — Singular/Plural EINZIG aus `months.length` abgeleitet, für den Hinweis
 * (`buildPvOutage`) UND den Methodik-Absatz (`pvOutageMethodItem`, `:947-948` verlangt
 * Gleichnamigkeit) — eine Quelle statt zwei getrennt gepflegter Titel.
 */
function pvOutageTitle(months: PvOutageMonth[]): string {
  return months.length > 1
    ? 'Monate ohne erkennbaren PV-Beitrag'
    : 'Ein Monat ohne erkennbaren PV-Beitrag'
}

export function buildPvOutage(
  hasPv: boolean | undefined,
  pvStage: PvStage | undefined,
  months: PvOutageMonth[] | undefined,
  /**
   * Gibt es das Kapitel „Ihre PV-Anlage"? Dann steht die Deutung DORT, und hier bleibt die
   * Datenzeile samt Zeiger — s. den Kopf-Kommentar.
   */
  pvChapterPresent = false,
): ReportNotice | null {
  if (hasPv !== true) return null
  /*
   * ⚠ EINE GEPLANTE ANLAGE KANN NICHT AUSFALLEN. Der Befund entsteht aus einem fehlenden
   * Mittagseinbruch im Lastgang — bei einer Anlage, die es im Messzeitraum noch gar nicht gab, ist
   * genau das der Normalzustand und keine Auffälligkeit. Ihn trotzdem zu melden hiesse, dem Kunden
   * einen Defekt an einer Anlage zu berichten, die noch nicht steht.
   */
  if (pvStage === 'planned') return null
  if (!months || months.length === 0) return null

  const plural = months.length > 1

  /*
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * ⚠ MIT DEM PV-KAPITEL BLEIBT HIER DIE BEOBACHTUNG, NICHT IHRE DEUTUNG
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * Beides nebeneinander wäre derselbe Befund in zwei Ausführlichkeiten, und der Leser müsste
   * raten, welche gilt — genau die Doppelung, die der Report sonst über Verweise auflöst. Was
   * bleibt, ist das, wofür dieses Kapitel da ist: WELCHE Monate betroffen sind, als Angabe zur
   * Datengrundlage. Was daraus folgt und was nicht, steht im PV-Kapitel samt der Zahl dazu.
   *
   * ⚠ DIE LISTE BLEIBT IN BEIDEN FASSUNGEN. Sie ist die Beobachtung selbst; ohne sie stünde hier
   * ein Zeiger ohne Gegenstand, und die Datenquellen-Seite verlöre die einzige Stelle, an der die
   * betroffenen Monate benannt sind.
   *
   * ⚠ DER KAPITELNAME WIRD NICHT AUSGESCHRIEBEN, SONDERN GELESEN (`REPORT_SECTIONS`). Ein
   * `ReportNotice.body` ist eine Zeichenkette und kann keinen aufgelösten Verweis tragen (s.
   * `statement.ts`); die zweitbeste Zusage ist, dass wenigstens der NAME mitwandert, wenn das
   * Kapitel umbenannt wird. Dass es das Kapitel überhaupt gibt, sagt `pvChapterPresent`.
   */
  if (pvChapterPresent) {
    return {
      id: 'pv_outage',
      tone: 'warning',
      title: pvOutageTitle(months),
      body:
        `In ${plural ? 'diesen Monaten' : 'diesem Monat'} Ihres Lastgangs ist der Mittagseinbruch, ` +
        'den eine arbeitende PV-Anlage hinterlässt, an keinem einzigen Tag aufgetreten — in den ' +
        'übrigen Monaten desselben Zeitraums schon. Was daraus folgt und was ausdrücklich nicht, ' +
        `steht im Kapitel „${REPORT_SECTIONS[SECTION_ID.pvValue].title}"; dort ist auch beziffert, ` +
        'was Ihre Anlage in den übrigen Monaten beigetragen hat.',
      list: {
        label: plural ? 'Betroffene Monate' : 'Betroffener Monat',
        items: months.map(formatOutageMonth),
      },
      hints: [],
    }
  }

  return {
    id: 'pv_outage',
    tone: 'warning',
    title: pvOutageTitle(months),
    body:
      'Eine arbeitende PV-Anlage drückt den Netzbezug um die Mittagszeit gegen null und, sobald sie ' +
      `mehr erzeugt als gerade gebraucht wird, darunter. In ${plural ? 'diesen Monaten' : 'diesem Monat'} ` +
      'Ihres Lastgangs ist dieser Mittagseinbruch an keinem einzigen Tag aufgetreten — in den übrigen ' +
      'Monaten desselben Zeitraums schon.',
    list: {
      label: plural ? 'Betroffene Monate' : 'Betroffener Monat',
      items: months.map(formatOutageMonth),
    },
    hints: [
      'Das ist eine Beobachtung an den Messwerten des ausgewerteten Zeitraums und keine Aussage ' +
        'über den heutigen Zustand Ihrer Anlage. Sie sagt auch nicht, woran es lag: ein Stillstand ' +
        'kommt dafür ebenso in Frage wie Verschattung, Schnee, eine Zählerumstellung oder eine ' +
        'Anlage, die damals noch nicht in Betrieb war.',
      'Wenn Sie wissen, was in diesen Monaten war, ist die Frage damit beantwortet. Wenn nicht, ' +
        'lohnt ein Blick in die Ertragsdaten Ihres Wechselrichters für genau diesen Zeitraum.',
      'Alle Zahlen dieses Reports beruhen auf dem Lastgang so, wie er gemessen wurde — der Befund ' +
        'ändert an ihnen nichts. Er sagt, dass Ihr Verbrauch in diesen Monaten ohne PV-Beitrag ' +
        'zustande kam.',
    ],
  }
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * 3b — Report-Baukasten C: die Admin-Auswahl, für die zwei Bausteine dieses Kapitels
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * ⚠ DIE AUSWAHL GREIFT AN DER QUELLE DES HINWEISES UND NICHT ERST IM JSX — und das ist der ganze
 * Grund, warum diese zwei Funktionen existieren.
 *
 * Beide Hinweise dieses Kapitels haben je einen ABHÄNGIGEN, der schon heute „am HINWEIS gemessen"
 * ist und nicht an dessen Vorbedingungen:
 *   • `data_quality` → die Zelle „Zeitraum / Stand" der Lastgang-Zeile in der Datenquellen-Tabelle
 *     verweist auf ihn („wie im Datenqualitäts-Hinweis oben", s. `loadProfileRows`);
 *   • `pv_outage`   → der Methodik-Absatz `method_pv_outage` (s. `buildMethodPerMetric`).
 *
 * Erst im Dokument abgeschaltet blieben beide Abhängigen stehen, und dann verwiese ein Satz auf
 * einen Hinweis, den der Report nicht zeigt — bei der Datenquellen-Tabelle wäre das genau der
 * Fehler, den PR #273 behoben hat, nur durch die Auswahl reaktiviert. Hier gefiltert tragen die
 * bestehenden Kopplungen von selbst: eine Bedingung, ein Ort.
 */
export function dataQualityNoticeOf(input: PdfReportInput): ReportNotice | null {
  if (!reportSectionEnabled(input.optionalSections, 'data_quality')) return null
  return buildDataQuality(input.analysis)
}

/** Der PV-Befund, wie ihn das Dokument zeigt — Auswahl inbegriffen. S. `dataQualityNoticeOf`. */
export function pvOutageNoticeOf(input: PdfReportInput): ReportNotice | null {
  if (!reportSectionEnabled(input.optionalSections, 'pv_outage')) return null
  /*
   * ⚠ Die Frage „gibt es das PV-Kapitel?" wird NICHT hier neu beantwortet, sondern an derselben
   * Stelle gelesen wie überall sonst. Ein `input.analysis.pvValue != null` daneben wäre die zweite
   * Fassung derselben Regel.
   */
  return buildPvOutage(
    input.hasPv,
    input.pvStage,
    input.pvOutageMonths,
    hasPvValueChapter(input.analysis),
  )
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
 *
 * ── ⚠ D12: UND GENAU DESHALB GIBT ES EINEN DRITTEN SATZ ───────────────────────────────────────
 * Der Wizard-Weg weiss die Antwort auf dieselbe Frage nicht (`TARIFF_SOURCE_UNTRACKED`, s.
 * `types.ts`). Der Satz dafür sagt das und behauptet nichts weiter — er nennt weder „Ihre
 * Eingabe" noch einen Tarifstand, weil beides zuträfe oder nicht, ohne dass es jemand wüsste. Eine
 * offen ausgewiesene Unkenntnis ist beim Wirkungsnachweis 2027 brauchbar; eine der beiden anderen
 * Antworten, auf gut Glück gesetzt, wäre es nicht.
 *
 * ── ⚠ D9-VORGRIFF: DER NETZBETREIBER STEHT IM DRITTEN SATZ, UND NUR DORT ──────────────────────
 * Die anderen beiden Sätze nennen ihn bereits oder brauchen ihn nicht: der `TariffSourceRef`-Satz
 * führt ihn samt Netzebene und Stand, der `null`-Satz sagt, dass die Werte aus der Rechnung des
 * Kunden stammen — auf der der Betreiber steht. Nur der dritte Satz liess bisher offen, um wessen
 * Netz es überhaupt geht, und das ist auf einem weitergereichten Blatt nicht mehr zu klären.
 *
 * ⚠ ER MACHT AUS DER UNKENNTNIS KEINE HERKUNFT: welcher Stand gerechnet wurde, bleibt unbenannt,
 * und der Rest des Satzes ist wortgleich. Fehlt der Name, steht er gar nicht da — ein
 * „(Netzbetreiber: unbekannt)" wäre eine Angabe, die nichts bezeichnet.
 */
/*
 * ⚠ DIE SÄTZE BEGINNEN SEIT DEM 22.09.2026 NICHT MEHR MIT „Tarifsätze:" — das Wort steht jetzt als
 * Überschrift darüber (`BASIS_HEADING.tariffSource`, nötig geworden mit dem Agenda-Unterpunkt).
 * Beides nebeneinander läse sich als Doppelung. Der Bildschirmweg (`tariff-source-note.tsx`) trägt
 * seine eigene Fassung MIT Präfix, weil er keine Überschrift hat.
 */
function buildTariffSource(
  source: PdfReportTariffSource,
  netzbetreiber: NetzbetreiberId | undefined,
): string {
  /*
   * ⚠ ZUERST UND ALS GLEICHHEIT GEPRÜFT, NICHT ÜBER `!source`. Der dritte Zustand ist eine
   * nichtleere Zeichenkette und damit WAHRHEITSWERTIG — eine `!source`-Prüfung liesse ihn stillos
   * in den `TariffSourceRef`-Zweig laufen, wo die erste Zeile `source.overriddenFields` läse. Die
   * drei Antworten werden deshalb einzeln und benannt unterschieden (s. `types.ts`).
   */
  if (source === TARIFF_SOURCE_UNTRACKED) {
    const operator = netzbetreiber ? ` (Netzbetreiber: ${NETZBETREIBER_LABELS[netzbetreiber]})` : ''
    return (
      'Herkunft für diese Auswertung nicht im Einzelnen nachverfolgt — gerechnet wurde ' +
      'mit den Leistungspreis-, Abrechnungs- und Mindestleistungswerten, die zu diesem Zählpunkt ' +
      `hinterlegt sind${operator}. Ob sie aus einer Netzrechnung oder aus einem hinterlegten ` +
      'Tarifstand stammen, hält dieser Report nicht fest.'
    )
  }

  if (source === null) {
    return (
      'Kein hinterlegter Stand gewählt — Leistungspreis, Abrechnungsmodell und ' +
      'Mindestleistung stammen unverändert aus Ihrer Eingabe.'
    )
  }

  const overridden = source.overriddenFields.map((field) => TARIFF_FIELD_LABEL[field])
  const tail =
    overridden.length === 0
      ? 'Die Vorgabewerte wurden unverändert übernommen.'
      : `Selbst eingetragen und damit massgeblich: ${overridden.join(', ')}.`

  return (
    `${NETZBETREIBER_LABELS[source.netzbetreiber]}, Netzebene ${source.netzebene} · ` +
    `Stand „${source.tariffSetLabel}", gültig ab ${source.tariffSetValidFrom}. ${tail}`
  )
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * 5 — die Datenquellen-Tabelle (D9 Punkt 1)
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * D9 — „Quelle · was daraus verwendet wurde · Zeitraum/Stand", nach dem Vorbild des
 * Urbanz-Anhangs „Methodik im Detail".
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIE TABELLE BELEGT ODER SIE SAGT, DASS SIE NICHTS ZU BELEGEN HAT — EIN DRITTES GIBT ES NICHT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Eine Datenquellen-Tabelle ist die eine Stelle des Reports, an der eine plausibel aussehende
 * Lücke teurer ist als anderswo: wer hier liest, prüft gerade, wie belastbar die Zahlen sind. Eine
 * Zeile, die eine Quelle NENNT, ohne eine zu haben, nimmt genau diese Prüfung vorweg und beantwortet
 * sie falsch. Deshalb gilt für jede Zelle: entweder ein belegter Wert, oder ausgeschrieben
 * „nicht erfasst"/„nicht nachverfolgt" — nie ein Strich, nie eine leere Zelle, nie eine Formulierung,
 * die offen lässt, ob niemand nachgesehen hat oder ob es nichts gibt.
 *
 * ── ⚠ D8: GENAU EINE ABDECKUNGSZAHL, UND SIE IST BENANNT ──────────────────────────────────────
 * Es gibt im Contract ZWEI Zählungen abgedeckter Tage, und sie weichen regelmässig um eins ab:
 * `dataQuality.coveredDays` = `round(Intervalle / 96)` (Slot-Zählung), gegenüber
 * `MonthlyFixedCosts.coveredDays` = die tatsächlich BERÜHRTEN Kalendertage in Ortszeit, an dem ein
 * am Vormittag endender Lastgang einen Tag mehr belegt (gemessen: 209 gegen 210). Die Tabelle zeigt
 * die Slot-Zählung — dieselbe, die der Datenqualitäts-Kasten eine Sektion weiter oben führt — und
 * schreibt in derselben Zelle dazu, WELCHE es ist. Beide nebeneinander wären zwei Zahlen ohne
 * Zuordnung, und genau das schliesst D8 aus.
 */

/** Wie eine hochgeladene Datei die Netzleistung darstellt — die vier Werte von `LoadSource`. */
const LOAD_SOURCE_LABEL: Record<LoadSource, string> = {
  net_signed: 'hochgeladener Lastgang, vorzeichenbehaftete Netzleistung',
  import_export_split: 'hochgeladener Lastgang, getrennte Bezugs- und Einspeisespalten',
  import_only: 'hochgeladener Lastgang, nur Bezug',
  standard_profile: 'synthetisches Standardprofil aus dem Jahresverbrauch (kein Messwert)',
}

/** Die Antwort, wo es keine Angabe gibt — ausgeschrieben statt weggelassen, s. Kopf. */
const NOT_RECORDED = 'nicht erfasst'

/**
 * ISO `YYYY-MM-DD` → `TT.MM.JJJJ`. Ein unbrauchbarer Wert ergibt `null` statt `Invalid Date`.
 *
 * ⚠ Exportiert, weil das Kapitel „Unser Vorschlag" dieselben Stände in Kurzfassung nennt
 * (`advice.ts`). Zwei Formatierungen desselben Datums ergäben im selben Dokument zwei
 * Schreibweisen für denselben Tag.
 */
export function formatIsoDate(value: string): string | null {
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return null
  return new Intl.DateTimeFormat('de-AT', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(ms)
}

function dataRow(key: string, cells: [ReportText, ReportText, ReportText]): ReportTableRow {
  return { key, cells }
}

/** Eine Gruppenüberschrift. Die übrigen Zellen bleiben leer — s. `ReportTableRow.heading`. */
function groupRow(key: string, label: string): ReportTableRow {
  return { key, cells: [label, '', ''], heading: true }
}

/**
 * Gruppe 1 — der Lastgang.
 *
 * ⚠ Die Dateizeile steht da, OBWOHL sie nichts nennt. Dateiname und Upload-Zeitpunkt existieren im
 * Admin-Bereich, reisen aber nicht mit der Report-Übergabe (`MeteringPointAnalysisRun` führt sie
 * nicht). Sie wegzulassen hiesse, eine Lücke unsichtbar zu machen, die ein Leser sonst für eine
 * nicht gestellte Frage hält; benannt ist sie eine Angabe über den Weg und kein Mangel an den Zahlen.
 */
function loadProfileRows(
  loadProfile: LoadProfile,
  period: string | null,
  coveredDays: number,
  estimatedPv: EstimatedPvSummary | undefined,
): ReportTableRow[] {
  const rows: ReportTableRow[] = [
    groupRow('group_load', 'Lastgang'),
    dataRow('load_readings', [
      'Viertelstundenwerte des Netzbezugs',
      `Grundlage aller Zahlen dieses Reports. Herkunft: ${LOAD_SOURCE_LABEL[loadProfile.source]}. ` +
        `Monats- und Tagesgrenzen in Ortszeit ${loadProfile.timezoneMeta}.`,
      /*
       * ── ⚠ STUFE D: DIE EINZIGE TABELLENZELLE MIT EINEM QUERVERWEIS ──────────────────────────
       * Bis Baukasten C war die Bedingung hier `dq.warnings.length > 0`, also eine NACHBILDUNG der
       * Bedingung von `buildDataQuality` — im warnungsfreien Report zeigte der Verweis ins Leere
       * (behoben mit PR #273). Baukasten C ersetzte sie durch einen durchgereichten `boolean`, den
       * der Aufrufer richtig setzen MUSSTE. Jetzt fragt der Verweis selbst: steht der Hinweis in
       * diesem Dokument? Es gibt keine zweite Bedingung mehr, die jemand falsch setzen kann.
       */
      t`${`${period ?? NOT_RECORDED} · ${coveredDays} abgedeckte Tage `}(Slot-Zählung: Messwerte ÷ 96${ref(
        block('data_quality'),
        `, wie im Datenqualitäts-Hinweis ${REF_PLACE}`,
        '',
      )})`,
    ]),
  ]

  /*
   * ⚠ GEMESSEN AN `pvSource` UND NICHT AN `estimatedPv`: das Feld am Lastgang ist die Aussage, DASS
   * die PV-Hälfte geschätzt ist (gesetzt allein von `applyEstimatedPv`), und sie gilt auch dort, wo
   * die Zusammenfassung mit ihren Wetterjahren diesen Weg nicht mitgereist ist. Umgekehrt gelesen
   * fiele die Zeile genau in dem Fall weg, in dem sie am nötigsten ist.
   */
  if (loadProfile.pvSource === 'estimated') {
    const weather = estimatedPv
      ? `PVGIS, gemittelte Wetterjahre ${estimatedPv.weatherYears.from}–${estimatedPv.weatherYears.to}`
      : NOT_RECORDED
    rows.push(
      dataRow('load_pv', [
        'Geschätzte PV-Erzeugung',
        'Die PV-Hälfte dieses Lastgangs ist NICHT gemessen, sondern aus Standort und Anlagendaten ' +
          'gerechnet und in den Netzbezug eingerechnet.',
        weather,
      ]),
    )
  }

  rows.push(
    dataRow('load_file', [
      'Quelldatei',
      'Dateiname und Upload-Zeitpunkt des Lastgangs.',
      `${NOT_RECORDED} (beides reist nicht mit der Report-Übergabe)`,
    ]),
  )
  return rows
}

/**
 * Gruppe 2 — die Tarifseite.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ZWEI GETRENNTE ZEILEN, WEIL ES ZWEI GETRENNTE QUELLEN SIND
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Das Netzbetreiber-Preisblatt trägt die Netzseite (Leistungspreis, Netz-Arbeitspreis), der
 * Lieferanten-Tarif die Energieseite (Arbeitspreis, Grundgebühr). Sie in eine Zeile zu ziehen
 * hiesse, einen Stand zu nennen, der für die halbe Rechnung nicht gilt.
 *
 * ── ⚠ DER STAND KOMMT AUS DER ECHTEN PREISBLATT-ZEILE, NICHT AUS EINER KONSTANTE ──────────────
 * Bis D9 stand hier für den Wizard-Weg zwangsläufig „nicht nachverfolgt": der Report bekam die
 * Tarifwerte als blanke Zahlen und den dritten Zustand `TARIFF_SOURCE_UNTRACKED` dazu. Der
 * Gültigkeitsbeginn der Preisblatt-Zeile, die für diesen Zählpunkt gepflegt ist, ist aber belegt —
 * er ist in derselben Rechnung gelesen worden (`readGridTariffRowsForAnalysis`) und reist seit D9
 * als Wert mit. „Nicht nachverfolgt" bleibt deshalb genau dort stehen, wo es zutrifft: wenn es
 * keine Zeile gibt.
 *
 * ⚠ ER MACHT AUS DER UNKENNTNIS TROTZDEM KEINE HERKUNFT. Der Satz über `tariffSource` daneben
 * bleibt unverändert: WELCHER Wert am Ende gerechnet wurde — der Vorschlag aus dem Preisblatt, eine
 * abgelesene Netzrechnung oder eine Handeingabe — hält der Wizard-Entwurf nicht fest, und ein
 * Gültigkeitsdatum beantwortet diese Frage nicht. Die Zelle nennt deshalb den STAND, nicht die
 * Herkunft des gerechneten Werts.
 */
function tariffRows(
  source: PdfReportTariffSource,
  provenance: PdfReportTariffProvenance | undefined,
): ReportTableRow[] {
  return [
    groupRow('group_tariff', 'Tarif'),
    dataRow('tariff_grid', [
      'Netzbetreiber-Preisblatt',
      gridTariffUsage(source),
      gridTariffVintage(source, provenance),
    ]),
    dataRow('tariff_supplier', [
      'Lieferanten-Tarif',
      'Arbeitspreis, Grundgebühr und Einspeisevergütung der Energieseite.',
      supplierVintage(provenance),
    ]),
  ]
}

function gridTariffUsage(source: PdfReportTariffSource): string {
  const base =
    'Leistungspreis, Abrechnungsmodell und Mindestleistung; bei berechenbarem Vergleich zusätzlich ' +
    'die Netz-Arbeitspreise je Zeitfenster.'
  if (typeof source === 'object' && source !== null) {
    return `${base} Netzebene ${source.netzebene}.`
  }
  return base
}

/**
 * ⚠ DREI WEGE, UND SIE SIND NACH BELEGKRAFT GEORDNET.
 *
 * Ein geprüfter Stand der B11-Tarifschicht (`TariffSourceRef`) nennt Label, Gültigkeit UND
 * Fundstelle — die `sourceNote` ist eine statische, versionierte Zeichenkette in `tariff-catalog.ts`
 * und wird hier über die Kennung des Stands nachgeschlagen, nicht mitgespeichert (eine gespeicherte
 * Kopie liefe beim nächsten Preisblatt-Nachtrag von ihr weg). Fehlt der Stand im Katalog — eine
 * archivierte Kennung, die es heute nicht mehr gibt —, entfällt genau die Fundstelle und nicht die
 * Zeile.
 *
 * Sonst zählt die gepflegte Preisblatt-Zeile aus `public.grid_tariffs`: ihr Gültigkeitsbeginn ist
 * belegt, Name, Version und Fundstelle des Blatts sind es NICHT (die Tabelle führt dafür keine
 * Spalte) — und das steht ausgeschrieben da.
 *
 * ⚠ MEHRERE ZEILEN WERDEN ALLE GENANNT: ein Zwölf-Monats-Lastgang kann einen Tarifwechsel
 * überqueren, und dann gingen zwei Stände in dieselbe Rechnung ein.
 */
function gridTariffVintage(
  source: PdfReportTariffSource,
  provenance: PdfReportTariffProvenance | undefined,
): string {
  if (typeof source === 'object' && source !== null) {
    const validFrom = formatIsoDate(source.tariffSetValidFrom) ?? source.tariffSetValidFrom
    const note = TARIFF_SETS.find((set) => set.id === source.tariffSetId)?.sourceNote
    const head = `Stand „${source.tariffSetLabel}", gültig ab ${validFrom}.`
    return note ? `${head} Fundstelle: ${note}` : head
  }

  const dates = (provenance?.gridTariffValidFrom ?? [])
    .map((iso) => formatIsoDate(iso))
    .filter((value): value is string => value !== null)

  if (dates.length === 0) {
    return 'nicht nachverfolgt — für diesen Zählpunkt ist keine Preisblatt-Zeile hinterlegt.'
  }

  const head =
    dates.length === 1
      ? `Preisblatt-Zeile, gültig ab ${dates[0]}.`
      : `Zwei Preisblatt-Stände im Auswertungszeitraum, gültig ab ${dates.join(' bzw. ')}.`
  return `${head} Name, Version und Fundstelle des Blatts: ${NOT_RECORDED}.`
}

/**
 * ⚠ DIE KUNDENRECHNUNG SCHLÄGT DEN VERGLEICHSTARIF (Prinzip 1).
 *
 * Liegt ein gelesener Abrechnungszeitraum vor, ist er die Angabe, auf die es ankommt: er sagt,
 * WORAUF sich der abgelesene Arbeitspreis bezieht. Ob er auf dem Papier stand oder aus einer
 * Jahresrechnung abgeleitet wurde, steht dabei — ein abgeleiteter Zeitraum ist eine Annahme und
 * darf nicht wie eine abgelesene Angabe dastehen (`billingPeriodAssumed`).
 *
 * Ohne Rechnung bleibt die Fundstelle des VERGLEICHSTARIFS, und die ist statisch und versioniert
 * (`AWATTAR_BASE_FEE.sourceNote`). Sie steht als Fundstelle der Grundgebühr da und behauptet nicht,
 * der Kunde habe diesen Tarif — deshalb der Zusatz „Vergleichstarif".
 */
function supplierVintage(provenance: PdfReportTariffProvenance | undefined): string {
  const period = (provenance?.invoicePeriods ?? []).find(
    (entry) => entry.from !== null || entry.to !== null,
  )
  if (period) return formatInvoicePeriod(period)

  return (
    `Kundenrechnung: ${NOT_RECORDED}. Vergleichstarif ${AWATTAR_BASE_FEE.supplier}, ` +
    `gültig ab ${formatIsoDate(AWATTAR_BASE_FEE.validFrom) ?? AWATTAR_BASE_FEE.validFrom} — ` +
    `Fundstelle: ${AWATTAR_BASE_FEE.sourceNote}`
  )
}

function formatInvoicePeriod(period: PdfReportInvoicePeriod): string {
  const from = period.from ? (formatIsoDate(period.from) ?? period.from) : NOT_RECORDED
  const to = period.to ? (formatIsoDate(period.to) ?? period.to) : NOT_RECORDED
  const origin = period.assumed
    ? ' (aus einer Jahresrechnung abgeleitet, nicht ausgeschrieben)'
    : ' (auf der Rechnung ausgeschrieben)'
  return `Kundenrechnung, Abrechnungszeitraum ${from} – ${to}${origin}`
}

/**
 * Gruppe 3 — das Gerät.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIE ZEILE STEHT IMMER, UND SIE NENNT IMMER DIE LÜCKE
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `BatteryCandidate` führt Hersteller und Bezeichnung, aber KEIN Herkunfts- und kein Preisfeld: es
 * gibt keine Datenblatt-Fundstelle, kein Abrufdatum und keinen Preisstand (§8: der echte
 * Batteriekatalog steht noch aus, gerechnet wird mit `DEMO_BATTERY_CATALOG`). Ein Gerätename ohne
 * diesen Zusatz sähe in einer Datenquellen-Tabelle aus wie eine geprüfte Quelle — daneben stehen
 * Zeilen, die echte Fundstellen nennen, und genau davon lebt die Täuschung. Der Zusatz steht
 * deshalb in JEDEM Fall da, auch dann, wenn gar kein Gerät ausgewiesen ist.
 *
 * ⚠ GEZEIGT WIRD DER PRIMÄRE BLOCK (`primaryEntryOf`) und nicht die Katalog-Empfehlung: die Frage
 * dieser Tabelle ist, woher die Angaben zu dem Gerät stammen, ÜBER das der Report spricht — im
 * Bestandsfall ist das die Anlage des Kunden. Die Annahmen-Tabelle oben wählt aus einem anderen
 * Grund anders (dort geht es um Preis und Investition, die es nur für ein Katalog-Gerät gibt).
 */
function batteryRowsForSources(
  analysis: PdfReportAnalysis,
  catalogMeta: Record<string, BatteryCatalogMeta> | undefined,
): ReportTableRow[] {
  const entry = primaryEntryOf(analysis)
  const device = entry
    ? `${entry.battery.manufacturer} ${entry.battery.name}`
    : 'kein Gerät ausgewiesen'
  const usage = entry
    ? 'Nutzbare Kapazität, Lade-/Entladeleistung, Wirkungsgrad und Preis je kWh.'
    : 'Es steht kein Kandidat zur Verfügung (leerer Katalog) — es wurde nichts daraus verwendet.'

  /*
   * ⚠ K3b: Die Lücke oben ist für ein KATALOG-Gerät geschlossen — seit die Geräte aus
   * `public.battery_catalog` kommen, gibt es einen Preisstand und eine Aussage darüber, ob der
   * Wirkungsgrad belegt oder angenommen ist. Für den BESTANDSSPEICHER des Kunden bleibt sie
   * bestehen und muss es: dessen Werte hat er selbst genannt, dazu gibt es kein Datenblatt.
   * Deshalb wird am Gerät nachgeschlagen, das die Tabelle ausweist, und nicht am empfohlenen.
   */
  const meta = entry ? catalogMeta?.[entry.battery.id] : undefined
  const provenance = meta
    ? `Katalogstand ${meta.priceAsOf ? `vom ${formatDateOnly(meta.priceAsOf)}` : '(ohne Preisstand)'} — ` +
      'Hardware-Listenpreis netto, exkl. Installation. Wirkungsgrad: ' +
      (meta.rteSource === 'datenblatt'
        ? 'Datenblatt des Herstellers.'
        : meta.rteSource === 'annahme'
          ? 'Erfahrungswert, kein Datenblattwert.'
          : 'Herkunft nicht vermerkt.')
    : 'keine Herkunfts- oder Preisquelle hinterlegt — der Katalog führt weder Datenblatt-Fundstelle ' +
      'noch Abrufdatum noch Preisstand.'

  return [
    groupRow('group_battery', 'Batterie'),
    dataRow('battery_device', [device, usage, provenance]),
  ]
}

/** Report-Baukasten B2 — die stabile Kennung dieser Tabelle (s. `CANDIDATE_TABLE_ID`). */
export const DATA_SOURCES_TABLE_ID = 'table_data_sources'

/**
 * Die Tabelle. Sie steht IMMER — es gibt keinen Report ohne Lastgang, Tarif und Gerätefrage.
 *
 * ⚠ Sie nimmt seit Stufe D nur noch `input`: die Frage „steht der Datenqualitäts-Hinweis in DIESEM
 * Dokument" beantwortet der Verweis in der Zelle selbst, gegen die Beschreibung des
 * zusammengestellten Dokuments (`layout.ts`). Der durchgereichte `boolean` war die letzte Stelle,
 * an der ein Aufrufer sie falsch beantworten konnte.
 */
export function buildDataSources(input: PdfReportInput): ReportTable {
  return {
    /*
     * ⚠ Die Gewichte sind ein VERHÄLTNIS und keine pt-Angaben (s. `ReportTableColumn.width`). Die
     * mittlere und die rechte Spalte tragen ganze Sätze und bekommen deshalb mehr als die linke,
     * in der nur Bezeichnungen stehen.
     */
    columns: [
      { label: 'Quelle', width: 2 },
      { label: 'Was daraus verwendet wurde', width: 3 },
      { label: 'Zeitraum / Stand', width: 3 },
    ],
    rows: [
      ...loadProfileRows(
        input.loadProfile,
        input.period,
        input.analysis.dataQuality.coveredDays,
        input.estimatedPv,
      ),
      ...tariffRows(input.tariffSource, input.tariffProvenance),
      ...batteryRowsForSources(input.analysis, input.batteryCatalogMeta),
    ],
  }
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * 6 — die Tarifkomponenten-Tabelle (D9 Punkt 2)
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * D9 — „Position · Wert · Status" für die Tarifgrössen, nach dem Vorbild der Urbanz-Referenztabelle.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ EINE ZEILE GIBT ES NUR FÜR EIN FELD, DAS DIESEN RENDER-LAUF TATSÄCHLICH ERREICHT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `TariffParams` führt dreizehn Felder; der Report-Eingang trägt sie NICHT als Ganzes (`types.ts`:
 * „Deshalb steht hier auch KEIN `tariff`-Feld"). Erreichbar sind vier über `assumptions` bzw. den
 * Monatsvergleich, einer über die Ist-Kosten und einer über die Tarifauswahl — mehr nicht.
 *
 * ⚠ UND DIE ÜBRIGEN BEKOMMEN AUSDRÜCKLICH KEINE „keine Angabe"-ZEILE. Mindestleistung,
 * Netz-Arbeitspreis, Nachttarif, HT/NT-Fenster, Messvariante und Benutzungsdauer-Modell wurden in
 * der Rechnung sehr wohl verwendet — sie reisen bloss nicht bis hierher. „Keine Angabe" hiesse
 * „nicht angegeben" und wäre für die Mindestleistung schlicht falsch: sie ist ein Pflichtfeld des
 * Schemas. Eine Lücke im Weg als Lücke in der Rechnung auszuweisen ist die teurere der beiden
 * Unwahrheiten — deshalb steht dort gar nichts.
 *
 * „keine Angabe" bleibt damit genau den Feldern vorbehalten, die HIER ankommen und OPTIONAL leer
 * sind — heute die Lieferanten-Grundgebühr. Nie eine 0, auch wo intern mit 0 gerechnet wird:
 * dieselbe Regel wie bei `taxEffectsIncluded`/`subsidyAmount` (§3.9, s. `batteryRows`).
 */

/** Die Antwort in der Wert-Spalte, wo ein erreichbares Feld leer ist — nie eine 0. */
const NOT_SPECIFIED = 'keine Angabe'

/**
 * Die Status-Spalte der NETZSEITE — sie wiederholt nur, was der Tarifquellen-Satz darüber ohnehin
 * sagt, Feld für Feld. Keine zweite Herkunftsermittlung: die drei Antworten und die Liste der
 * überschriebenen Felder stehen fertig im `PdfReportTariffSource` (s. `buildTariffSource`).
 */
function gridFieldStatus(
  source: PdfReportTariffSource,
  field: TariffSourceRef['overriddenFields'][number],
): string {
  /* ⚠ Als Gleichheit geprüft und nicht über `!source` — s. `buildTariffSource`. */
  if (source === TARIFF_SOURCE_UNTRACKED) return 'Herkunft nicht im Einzelnen nachverfolgt'
  if (source === null) return 'unverändert aus Ihrer Eingabe (Netzrechnung)'
  return source.overriddenFields.includes(field)
    ? `selbst eingetragen — abweichend vom Stand „${source.tariffSetLabel}"`
    : `Vorgabewert aus Stand „${source.tariffSetLabel}"`
}

/** Die Status-Spalte der ENERGIESEITE — die Zeile „Lieferanten-Tarif" der Datenquellen daneben. */
const SUPPLIER_STATUS = 'aus Ihren Angaben (Energieseite)'

/**
 * Der Leistungspreis-Satz.
 *
 * ⚠ [ABGELEITET, keine Contract-Zahl] — `leistungspreisCostPerYear / billedKw`, wortgleich zu
 * `charts.tsx` und `report.tsx`: `analyzeCurrentPeaks` setzt Ersteres als Satz × `billedKw`, die
 * Division gibt also exakt den €/kW·a-Satz zurück, unabhängig vom Abrechnungsmodell.
 *
 * ⚠ Bei `billedKw = 0` (leeres oder rein einspeisendes Profil) entfällt die ZEILE und es steht
 * nicht „keine Angabe": der Satz ist angegeben, nur nicht zurückrechenbar — s. Kopf.
 */
function leistungspreisRow(
  analysis: PdfReportAnalysis,
  source: PdfReportTariffSource,
): ReportTableRow[] {
  if (!(analysis.current.billedKw > 0)) return []
  const rate = analysis.current.leistungspreisCostPerYear / analysis.current.billedKw
  return [
    dataRow('tariff_leistungspreis', [
      'Leistungspreis',
      `${formatEur2(rate)} / kW·a`,
      gridFieldStatus(source, 'leistungspreisEurPerKwYear'),
    ]),
  ]
}

/**
 * Die monatliche Grundgebühr des heutigen Lieferanten (Delta 19).
 *
 * ⚠ SIE IST DAS EINE ERREICHBARE FELD, DAS „keine Angabe" BRAUCHT. Der Contract sagt es
 * ausdrücklich (`MonthlyFixedCosts.supplierFeeEurPerMonth`: „0 = keine Angabe"), und intern wird
 * mit dieser 0 gerechnet. Genau das darf hier nicht als Wert stehen: eine Grundgebühr von 0 €
 * behauptete einen Tarif ohne Grundgebühr, und der Leser prüfte die Zahl nicht nach.
 *
 * ⚠ Ohne Monatsvergleich (Hebel aus, oder nicht berechenbar) entfällt die Zeile — dann hat die
 * Angabe diesen Render-Lauf gar nicht erreicht, s. Kopf.
 */
function supplierFeeRow(analysis: PdfReportAnalysis): ReportTableRow[] {
  const comparison =
    analysis.tariffOptimization?.computable === true
      ? analysis.tariffOptimization.monthlyComparison
      : undefined
  if (!comparison) return []

  const fee = comparison.fixedCosts.supplierFeeEurPerMonth
  return [
    dataRow(
      'tariff_supplier_fee',
      fee > 0
        ? ['Grundgebühr Lieferant', `${formatEur2(fee)} / Monat`, SUPPLIER_STATUS]
        : [
            'Grundgebühr Lieferant',
            NOT_SPECIFIED,
            'nicht erfasst — im Tarifvergleich mit 0 gerechnet',
          ],
    ),
  ]
}

/** Die Netzebene — ein Metadatum, und nur die Tarifauswahl trägt es bis hierher. */
function netzebeneRow(source: PdfReportTariffSource): ReportTableRow[] {
  if (typeof source !== 'object' || source === null) return []
  return [
    dataRow('tariff_netzebene', [
      'Netzebene',
      `${source.netzebene}`,
      `aus der Tarifauswahl (${NETZBETREIBER_LABELS[source.netzbetreiber]})`,
    ]),
  ]
}

/** Report-Baukasten B2 — die stabile Kennung dieser Tabelle (s. `CANDIDATE_TABLE_ID`). */
export const TARIFF_COMPONENTS_TABLE_ID = 'table_tariff_components'

/** Die Tabelle. Sie steht IMMER — ohne Abrechnungsmodell und Arbeitspreis gibt es keine Rechnung. */
export function buildTariffComponents(input: PdfReportInput): ReportTable {
  const a = input.analysis.assumptions
  const source = input.tariffSource

  return {
    /* ⚠ Gewichte als VERHÄLTNIS, keine pt-Angaben — s. `buildDataSources`. Der Status trägt ganze
       Halbsätze und bekommt deshalb mehr als die beiden schmalen Spalten links. */
    columns: [
      { label: 'Position', width: 2 },
      { label: 'Wert', width: 2 },
      { label: 'Status', width: 3 },
    ],
    /* Die Reihenfolge ist die des Schemas (`tariffParamsSchema`): Netzseite, dann Energieseite,
       dann die Metadaten. Wer das Schema neben den Report legt, liest beide in derselben Folge. */
    rows: [
      ...leistungspreisRow(input.analysis, source),
      dataRow('tariff_billing_model', [
        'Abrechnungsmodell',
        BILLING_MODEL_LABEL[a.billingModel],
        gridFieldStatus(source, 'billingModel'),
      ]),
      dataRow('tariff_energy_price', [
        'Arbeitspreis',
        `${formatEur2(a.energyPriceCtPerKwh / 100)} / kWh`,
        SUPPLIER_STATUS,
      ]),
      dataRow('tariff_einspeiseverguetung', [
        'Einspeisevergütung',
        `${formatEur2(a.einspeiseverguetungCtPerKwh / 100)} / kWh`,
        SUPPLIER_STATUS,
      ]),
      ...supplierFeeRow(input.analysis),
      ...netzebeneRow(source),
    ],
  }
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * 7 — die Berechnungsmethodik je Kennzahl (D9 Punkt 3)
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * D9 — wie die Zahlen zustande kamen: EIN gemeinsamer Absatz, darunter je Weg die Differenz.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIE SÄTZE SIND AUS DEM CODE ABGELEITET, NICHT AUS DEM URBANZ-ANHANG ÜBERNOMMEN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Das Referenz-PDF beschreibt an mehreren Stellen ein anderes oder ein inzwischen geändertes
 * Verfahren (die Preisschwelle etwa ist seit 02.09.2026 das Tages- und nicht mehr das
 * Perioden-Mittel, `tou.ts`). Eine abgeschriebene Methodik wäre die gefährlichste Sorte Fehler in
 * diesem Kapitel: sie sähe wie eine Erklärung aus und beschriebe eine Rechnung, die nicht
 * stattgefunden hat.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIE WEGE-EINTRÄGE WERDEN HIER NICHT MEHR AUFGEZÄHLT — SIE KOMMEN AUS DEM WEGE-KAPITEL
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bis hierher standen an dieser Stelle drei fest verdrahtete Absätze („Ihr Tarif heute", „aWATTar
 * ohne Steuerung", „Mit Ladesteuerung"), und jeder wiederholte die gemeinsame Rechnung in eigenen
 * Worten. Das hatte drei messbare Folgen: der VERGLEICHSTARIF und die SPITZENKAPPUNG kamen darin
 * gar nicht vor, obwohl das Wege-Kapitel sie führt; die vorausschauende Fassung von Weg 4 war
 * nirgends erwähnt; und ein Weg mehr im Kapitel hiess, an dieser ganz anderen Stelle daran zu
 * denken. Gelesen wird deshalb `buildWaysChapter(...).methodNotes` — dieselbe Liste, aus der auch
 * die Absätze des Kapitels entstehen (`addWay`, `ways.ts`). Eine zweite Aufzählung hier wäre genau
 * die Doppelung, die schon dreimal unvollständig war.
 *
 * ── ⚠ EIN EINTRAG ENTSTEHT NUR, WO DIE KENNZAHL DIESEN REPORT AUCH ERREICHT ───────────────────
 * Ohne berechenbaren Tarifvergleich gibt es kein Wege-Kapitel und damit weder den gemeinsamen
 * Absatz noch eine Differenz; der PV-Befund steht nur dort, wo er oben steht. Eine Methodik zu
 * einer Zahl, die im Dokument nirgends vorkommt, beantwortete eine Frage, die niemand stellt.
 */
export type BasisMethodItem = {
  /** Stabil — zur Wiedererkennung in Prüfläufen, nicht im Dokument sichtbar. */
  id: string
  /** Die Kennzahl, so benannt wie an der Stelle, an der sie im Report steht. */
  title: string
  body: string
  /**
   * Wie der Eintrag gesetzt wird.
   *
   * ⚠ `way` ist eine ZEILE einer Aufzählung (Titel und Text in einer Zeile), `text` ein eigener
   * Absatz mit Überschrift. Der Unterschied ist fachlich und keine Gestaltung: die Wege-Zeilen
   * sind Varianten EINER Rechnung, die darüber einmal ausgeschrieben steht, und lesen sich nur
   * als Aufzählung richtig. Der gemeinsame Absatz, die Spitzenkappung (eine Jahresgrösse, s.
   * `WayMethodNote.aside`) und der PV-Befund sind keine solchen Varianten.
   */
  kind: 'text' | 'way'
}

/**
 * Der gemeinsame Absatz — die Rechnung, die jeder Weg teilt.
 *
 * ⚠ ER NENNT DIE ABGABEN, und das ist gegenüber den drei Vorgängerabsätzen eine Ergänzung und
 * keine Kürzung: seit #295 stecken Elektrizitätsabgabe, EAG-Förderbeitrag, EAG-Pauschale und die
 * Gebrauchsabgabe im kombinierten Intervallpreis bzw. in den anteiligen Fixkosten, und die
 * Methodik erwähnte sie bis hierher an keiner Stelle.
 *
 * ⚠ DER LEISTUNGSPREIS STEHT AUSDRÜCKLICH NICHT DARIN, und der Satz sagt auch, warum — er ist
 * eine Jahresgrösse und zählte in den Viertelstundenkosten ein zweites Mal. Dieselbe Abgrenzung
 * trägt die Kopfzahl der Zusammenfassung („ohne Leistungspreis", `summary.ts`).
 */
const SHARED_METHOD_BODY =
  'Alle Wege entstehen aus DERSELBEN Rechnung, Viertelstunde für Viertelstunde: Ihr Netzbezug mal ' +
  'dem Preis genau dieser Viertelstunde — Arbeitspreis plus das Netzentgelt des Zeitfensters, in ' +
  'das sie fällt, plus Netzverlustaufschlag und die gesetzlichen Abgaben (Elektrizitätsabgabe, ' +
  'EAG-Förderbeitrag und -Pauschale, Gebrauchsabgabe auf den Netzpreis). Dazu die ' +
  'verbrauchsunabhängigen Gebühren — Grundgebühr des Lieferanten, Netz-Grundpreis und Messpreis —, ' +
  'tagesanteilig nach den tatsächlich belegten Kalendertagen und nie als voller Monatsbetrag. ' +
  'Eingespeiste Viertelstunden werden mit Ihrer Einspeisevergütung gegengerechnet. Der ' +
  'Leistungspreis steht in keiner dieser Zahlen: er ist eine Jahresgrösse und würde hier ein ' +
  'zweites Mal zählen. Darunter steht je Weg nur noch, was an ihm anders ist.'

/**
 * Der gemeinsame Absatz, oder `null`, wenn es die Wege nicht gibt.
 *
 * ⚠ Die Bedingung wird am WEGE-KAPITEL gemessen und nicht an `tariffOptimization` daneben: er
 * beschreibt die Rechnung hinter den Wegen, und ohne sie beschriebe er nichts. Eine zweite Fassung
 * derselben Bedingung liefe beim nächsten Umbau von ihr weg (dieselbe Überlegung wie bei
 * `hasPvValueChapter`).
 *
 * ⚠ Exportiert für die Registry (`method_shared`) — eine Bedingung, ein Ort.
 */
export function sharedMethodItem(analysis: PdfReportAnalysis): BasisMethodItem | null {
  if (!hasWaysChapter(analysis)) return null
  return {
    id: 'method_shared',
    kind: 'text',
    title: 'Was für alle Wege gleich gerechnet ist',
    body: SHARED_METHOD_BODY,
  }
}

/**
 * Der PV-Befund — Fundstelle `detectPvOutageMonths` (`pv-anomaly/outage-months.ts`).
 *
 * ⚠ EIN Satz, und er nennt das Signal in der Richtung, in der es gemessen wird: gesucht ist das
 * FEHLEN des erwarteten Mittagseinbruchs, nicht eine lange Strecke nahe null. Die Verwechslung
 * liegt nahe (beides heisst umgangssprachlich „da ist nichts") und führt beim Leser zur falschen
 * Gegenprobe — er sähe in seinen Daten nach etwas, das der Befund gar nicht gezählt hat.
 */
export function pvOutageMethodItem(months: PvOutageMonth[]): BasisMethodItem {
  return {
    id: 'method_pv_outage',
    kind: 'text',
    title: pvOutageTitle(months),
    body:
      'Der Befund misst eine Abwesenheit: gemeldet wird ein Monat, in dem Ihr Netzbezug im ' +
      'Mittagsfenster an keinem einzigen Tag gegen null geht, obwohl eine PV-Anlage angegeben ist ' +
      'und andere Monate desselben Lastgangs diesen Einbruch sehr wohl zeigen — nicht etwa eine ' +
      'lange Strecke nahe null, die für sich genommen nichts über die Anlage aussagt.',
  }
}

/** Die Liste. Leer heisst: keine Kennzahl hat diesen Report erreicht — s. Kopf. */
function buildMethodPerMetric(
  analysis: PdfReportAnalysis,
  pvOutage: ReportNotice | null,
  pvOutageMonths: PvOutageMonth[] | undefined,
): BasisMethodItem[] {
  const items: BasisMethodItem[] = []

  const shared = sharedMethodItem(analysis)
  if (shared) {
    items.push(shared)
    /*
     * ⚠ DIE REIHENFOLGE IST DIE DES WEGE-KAPITELS, weil es dieselbe Liste ist. Hier umsortiert
     * stünde die Methodik in einer anderen Ordnung als die Wege, auf die sie sich bezieht — und
     * der Leser suchte den vierten Eintrag beim dritten Weg.
     */
    for (const note of buildWaysChapter(analysis)?.methodNotes ?? []) {
      items.push({
        /* ⚠ Aus der Kennung des Wegs abgeleitet und nicht frei vergeben: zwei Einträge mit
           derselben Kennung wären im Dokument nicht unterscheidbar. */
        id: `method_${note.id}`,
        kind: note.aside ? 'text' : 'way',
        title: note.title,
        body: note.body,
      })
    }
  }

  /* Am HINWEIS gemessen und nicht an `hasPv`/`pvOutageMonths`: eine Bedingung, ein Ort. */
  if (pvOutage && pvOutageMonths) items.push(pvOutageMethodItem(pvOutageMonths))

  return items
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * 8 — die bekannten Einschränkungen (D9)
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * D9 — was in diesen Zahlen nicht steckt, in der Form, in der ein Leser es braucht.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ER STEHT IN JEDEM REPORT, UND DAS IST DER UNTERSCHIED ZU DEN DREI HINWEISEN DARÜBER
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Datenqualität, Blocker-Befund und PV-Hinweis melden eine Eigenschaft DIESES Datensatzes und
 * schweigen, wo es nichts zu melden gibt (s. dort). Die Einschränkungen hier sind Eigenschaften
 * der RECHNUNG selbst: sie gelten unabhängig davon, was hochgeladen wurde, und sind genau dann am
 * teuersten, wenn niemand sie erwähnt — ein Report ohne den Netto-Satz lässt den Leser seine
 * Jahresrechnung gegen eine Zahl halten, die etwas anderes zählt.
 *
 * ⚠ `tone: 'neutral'` und nicht `warning`: hier ist nichts schiefgegangen. Ein gelber Kasten neben
 * einer korrekt gerechneten Nettozahl läse sich wie ein Mangel des Datensatzes.
 *
 * ── ⚠ DER MITTLERE PUNKT IST BEDINGT UND ERSCHEINT HEUTE IN KEINEM REPORT ─────────────────────
 * `AnalysisResult.annualProjection` (D6 Teil 2b) ist gerechnet, aber von keinem Weg in eine
 * Übergabe an dieses Dokument verdrahtet — das ist D4/D10 und ausdrücklich nicht dieser Schritt.
 * Die Bedingung steht trotzdem hier und nicht als Kommentar „später ergänzen": am Tag der
 * Verdrahtung entsteht der Satz von selbst, und niemand muss daran denken. Umgekehrt darf er nicht
 * unbedingt stehen — eine Hochrechnung zu erwähnen, die der Report nicht zeigt, schickte den Leser
 * nach einer Zahl suchen, die es nicht gibt.
 */
export function buildLimitations(analysis: PdfReportAnalysis): ReportNotice {
  /*
   * ⚠ DER ERSTE SATZ HÄNGT AN DERSELBEN BEDINGUNG WIE DIE MONATSZAHLEN SELBST. Die Abgaben stecken
   * im kombinierten Intervallpreis und in den anteiligen Fixkosten — beides gibt es nur, wenn der
   * Börsenpreis-Vergleich berechenbar war. Unbedingt formuliert behauptete der Satz im Blocker-Fall
   * Posten in Zahlen, die es in diesem Report gar nicht gibt.
   */
  const hints: string[] = [
    analysis.tariffOptimization?.computable === true
      ? 'Gerechnet wird durchgängig netto, also ohne Umsatzsteuer. Die Abgaben auf den Bezug sind ' +
        'dagegen enthalten: Elektrizitätsabgabe, EAG-Förderbeitrag und EAG-Pauschale sowie die ' +
        'Gebrauchsabgabe auf den Netzpreis stecken in den Monatskosten und damit in den ' +
        'Kopfzahlen. Auf den Leistungspreis, der als eigene Jahreszahl ausgewiesen wird, ist die ' +
        'Gebrauchsabgabe nicht aufgeschlagen.'
      : 'Gerechnet wird durchgängig netto. Verbrauchsabgaben — Elektrizitätsabgabe, ' +
        'EAG-Förderbeitrag und, wo sie anfällt, die Gebrauchsabgabe — sind in keiner Zahl dieses ' +
        'Reports enthalten; Ihr tatsächlicher Rechnungsbetrag liegt entsprechend höher.',
  ]

  if (analysis.annualProjection) {
    hints.push(
      'Die Jahres-Hochrechnung bewertet die nicht gemessenen Tage mit einer bewusst konservativen ' +
        'oberen Schranke aus dem kältesten verfügbaren Zeitraum (Dezember, Jänner, Februar; ' +
        'ersatzweise dem verbrauchsstärksten Monat) — nicht mit einem Jahresmittelwert. Sie ist ' +
        'damit eher zu hoch als zu niedrig angesetzt.',
    )
  }

  hints.push(
    'Die Tabelle „Tarifkomponenten" zeigt die erfassten Parameter, nicht alle in der Rechnung ' +
      'verwendeten: einzelne Grössen fliessen ein, ohne eine eigene Zeile zu tragen — die ' +
      'Mindestleistung etwa, die den abgerechneten Leistungswert nach unten begrenzt.',
  )

  return {
    id: 'limitations',
    tone: 'neutral',
    title: 'Bekannte Einschränkungen',
    body: 'Damit die Zahlen dieses Reports richtig gelesen werden, gehört Folgendes dazugesagt.',
    list: null,
    hints,
  }
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
  /** D5 — Monate ohne erkennbaren PV-Beitrag. `null` = keine PV angegeben ODER nichts gefunden. */
  pvOutage: ReportNotice | null
  /** Die Herkunft der Tarifsätze. Steht immer, auch ohne gewählten Stand. */
  tariffSource: string
  /** Der Preisstand-Hinweis, hereingereicht (`derive.ts`). `null` = kein Hinweis. */
  tariffVintage: string | null
  /**
   * D9 — die Tarifgrössen im Einzelnen. Steht immer; eine Zeile gibt es je Feld, das diesen
   * Render-Lauf erreicht (s. `buildTariffComponents`).
   */
  tariffComponents: ReportTable
  /** D9 — die Datenquellen-Tabelle. Steht immer; wo nichts belegt ist, sagt sie das. */
  dataSources: ReportTable
  /**
   * D9 — ein Absatz je Kennzahl, die diesen Report tatsächlich erreicht. Leere Liste = keine; dann
   * entfällt auch die Überschrift (`document.tsx`), statt über einer Leerstelle zu stehen.
   */
  methodPerMetric: BasisMethodItem[]
  /** D9 — was die Rechnung selbst nicht enthält. Steht IMMER, unabhängig vom Datensatz. */
  limitations: ReportNotice
}

export function buildBasisChapter(
  input: PdfReportInput,
  /* Report-Baukasten B1 — s. `buildReportSummary`. Ohne ihn wird wie bisher selbst abgeleitet. */
  context?: ReportBuildContext,
): BasisChapter {
  /*
   * ⚠ EINMAL GEBAUT, ZWEIMAL GELESEN: der Methodik-Absatz zum PV-Befund hängt am HINWEIS und nicht
   * an dessen Vorbedingungen. Zwei getrennte Auswertungen derselben zwei Bedingungen liefen beim
   * nächsten Umbau auseinander — und dann stünde eine Methodik zu einem Befund, der fehlt.
   *
   * ⚠ `context ? … : …` statt `??` — `pvOutage` ist selbst gültig `null`, und mit `??` entstünde
   * der Hinweis in genau dem Fall ein zweites Mal, in dem es ihn gar nicht gibt.
   */
  const pvOutage = context ? context.pvOutage : pvOutageNoticeOf(input)

  /*
   * ⚠ Report-Baukasten C: EINMAL GEBILDET, ZWEIMAL GELESEN — genau wie `pvOutage` darüber und aus
   * demselben Grund. Die Datenquellen-Tabelle verweist auf diesen Hinweis; zwei getrennte
   * Auswertungen derselben Bedingung liefen beim nächsten Umbau auseinander, und dann stünde der
   * Verweis über einer Leerstelle (s. `loadProfileRows`).
   */
  const dataQuality = context ? context.dataQuality : dataQualityNoticeOf(input)

  return {
    assumptions: buildAssumptions(input.analysis),
    dataQuality,
    blocker: buildBlocker(input.analysis, timeZoneOf(input.loadProfile)),
    pvOutage,
    tariffSource: buildTariffSource(input.tariffSource, input.netzbetreiber),
    tariffVintage: input.tariffVintage,
    tariffComponents: buildTariffComponents(input),
    dataSources: buildDataSources(input),
    methodPerMetric: buildMethodPerMetric(input.analysis, pvOutage, input.pvOutageMonths),
    limitations: buildLimitations(input.analysis),
  }
}

/**
 * ⚠ Die Zeitzone kommt aus dem LASTGANG und nicht aus der Umgebung des Browsers: die Zeitbereiche
 * des Blockers beschreiben Stunden im Lastgang des Kunden, und ein Report, der in einer anderen
 * Zeitzone erzeugt wird, muss dieselben Stunden nennen. Dieselbe Quelle wie am Bildschirm
 * (`report.tsx` reicht `loadProfile.timezoneMeta` an die Karte).
 */
export function timeZoneOf(loadProfile: Pick<LoadProfile, 'timezoneMeta'>): string {
  return loadProfile.timezoneMeta
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Die Unterabschnitte — dieselbe Liste, aus der das Kapitel rendert
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Die drei Überschriften, die dieses Kapitel SELBST setzt.
 *
 * ⚠ Die übrigen Abschnitte bringen ihre Überschrift in der Aussage bzw. im Hinweis mit
 * (`ReportStatement.title`, `ReportNotice.title`); für diese drei gäbe es keinen Träger. Sie
 * standen bis zum 22.09.2026 als Literale im JSX — dort belassen hätte das Inhaltsverzeichnis sie
 * ein zweites Mal ausschreiben müssen, und das ist die Doppelung, um die es hier geht.
 */
export const BASIS_HEADING = {
  /**
   * ⚠ NEU MIT DEM INHALTSVERZEICHNIS (22.09.2026): die beiden Herkunftssätze standen bis dahin
   * ohne Überschrift da. Ein Agenda-Eintrag ohne Überschrift im Kapitel zeigt auf nichts, was der
   * Leser wiederfindet — die Überschrift ist die Folge des Eintrags, nicht umgekehrt.
   */
  tariffSource: 'Tarifsätze',
  tariffComponents: 'Tarifkomponenten',
  dataSources: 'Datenquellen',
  methodPerMetric: 'Berechnungsmethodik je Kennzahl',
} as const

/**
 * Die Unterabschnitte dieses Kapitels fürs Inhaltsverzeichnis — GENAU die, die auch gerendert
 * werden.
 *
 * ── ⚠ AUS DEM GEBAUTEN KAPITEL UND NICHT AUS DEN BEDINGUNGEN DARUNTER ─────────────────────────
 * Jeder Eintrag liest den Wert, an dem auch `document.tsx` entscheidet, ob der Abschnitt dasteht:
 * `chapter.dataQuality` ist der Hinweis selbst, `chapter.methodPerMetric.length` die Liste selbst.
 * Die Bedingungen ein zweites Mal zu formulieren wäre dieselbe Drift wie eine zweite Titelliste —
 * ein Unterpunkt für einen Abschnitt, den das Blatt nicht zeigt, und niemand sieht es ihm an.
 *
 * ⚠ Die TITEL kommen ebenso von dort (`assumptions.title`, `limitations.title`, …) und sind hier
 * nirgends ausgeschrieben; die drei Ausnahmen stehen in `BASIS_HEADING` und werden vom JSX aus
 * derselben Konstante gesetzt.
 */
export function basisSubsections(chapter: BasisChapter): readonly ReportSection[] {
  const entries: (readonly [string, string | null])[] = [
    ['grundlage-annahmen', chapter.assumptions.title],
    ['grundlage-datenqualitaet', chapter.dataQuality?.title ?? null],
    ['grundlage-blocker', chapter.blocker?.title ?? null],
    ['grundlage-pv-ausfall', chapter.pvOutage?.title ?? null],
    ['grundlage-tarifsaetze', BASIS_HEADING.tariffSource],
    ['grundlage-tarifkomponenten', BASIS_HEADING.tariffComponents],
    ['grundlage-datenquellen', BASIS_HEADING.dataSources],
    [
      'grundlage-methodik',
      chapter.methodPerMetric.length > 0 ? BASIS_HEADING.methodPerMetric : null,
    ],
    ['grundlage-einschraenkungen', chapter.limitations.title],
  ]

  return entries
    .filter((e): e is readonly [string, string] => e[1] !== null)
    .map(([id, title]) => ({ id, title, level: 2 }))
}
