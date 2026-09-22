import type { ReportOptionalSection } from 'shared'

import {
  DATA_SOURCES_TABLE_ID,
  TARIFF_COMPONENTS_TABLE_ID,
  buildAssumptions,
  buildBlocker,
  buildDataSources,
  buildLimitations,
  buildTariffComponents,
  pvOutageMethodItem,
  sharedMethodItem,
  timeZoneOf,
  type BasisMethodItem,
} from './basis'
import {
  CANDIDATE_TABLE_ID,
  buildCandidateTable,
  buildTableStatement,
  buildVerdict,
  comparisonSelection,
} from './comparison'
import { SECTION_ID, type ReportSectionKey } from './content'
import type { ReportBuildContext } from './context'
import { buildMonthly, buildMonthlyChapter } from './detail'
import { buildChargePrice, buildHourFlow } from './insight'
import { buildLoadControl, buildRecommendation } from './recommendation'
import { buildPvValueChapter } from './pv-value'
import type { ReportNotice, ReportStatement, ReportTable } from './statement'
import {
  buildAddon,
  buildEstimatedPvNotice,
  buildLargeGapNotice,
  buildPartialYearNotice,
  buildStandardProfileNotice,
} from './summary'
import type { PdfReportInput } from './types'

/**
 * Report-Baukasten B2 — der KATALOG: alle 24 Bausteine eines Reports, über ihre stabile `id`
 * ansprechbar.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ SIE IST HEUTE EIN ZWEITES, GEPRÜFTES ARTEFAKT UND KEIN RENDERING-WEG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `document.tsx` ruft weiterhin die sieben KAPITEL-Fassaden auf und ist die einzige Quelle des
 * ausgelieferten Dokuments. Diese Datei beantwortet eine andere Frage — „welche Bausteine gibt es,
 * und was ergibt Baustein X für DIESEN Fall?" —, die heute nur beantwortbar ist, indem man ein
 * ganzes Kapitel baut und das gesuchte Feld herausgreift. Die Umstellung des Renderers ist ein
 * eigener Schritt; bis dahin sind beide Wege nebeneinander messbar, und genau das ist der Nachweis
 * (`registry.test.ts`: je id derselbe Wert wie über die Fassade, `null` eingeschlossen).
 *
 * ── ⚠ EINE DÜNNE HÜLLE, KEINE ZWEITE ABLEITUNG ────────────────────────────────────────────────
 * Jedes `build()` ruft GENAU den Erzeuger auf, den die zugehörige Kapitel-Fassade heute aufruft,
 * mit genau den Werten, die sie ihm heute gibt. Keine der 26 Signaturen ist angefasst; hinzugekommen
 * ist ausschliesslich das Schlüsselwort `export` und — in `comparison.ts` — die herausgezogene
 * Auswahl `comparisonSelection`, damit die Schwelle `netSavingOverHorizon > 0` nicht zweimal
 * dasteht. Wo hier eine Bedingung steht, ist sie die der Fassade und nicht eine neue.
 *
 * ── ⚠ EIGNUNG BLEIBT AM ERZEUGER: `build()` LIEFERT `null` ────────────────────────────────────
 * Es gibt bewusst KEINE vorgelagerte Prüfung „ist dieser Baustein für diesen Fall zulässig". Für
 * 22 der 26 Bausteine existiert ein solches Prädikat nirgends — die Bedingung lebt als frühes
 * `return null` im Erzeuger, und `basis.ts` benennt das ausdrücklich als Regel („am HINWEIS
 * gemessen, nicht an seinen Vorbedingungen: eine Bedingung, ein Ort"). Sie zu verdoppeln hiesse,
 * 26 Bedingungen an zwei Orten zu führen, von denen der nächste Umbau einen anfasst. Eine
 * content-lose Eignungs-Schicht ist erst nötig, wenn eine KI VOR der Erzeugung auswählen soll;
 * für die geplante manuelle Admin-Auswahl ist „erzeugen und `null` heisst: gibt es nicht" genau
 * richtig.
 *
 * ── ⚠ VIER STELLEN, AN DENEN DIE FASSADE MEHR WEISS ALS DER ERZEUGER ─────────────────────────
 * Sie sind hier nachgebildet, weil der Baustein sonst ERSCHIENE, wo er im Dokument fehlt:
 *   1. Kapitel 1 lässt ALLE vier Aussagen weg, wenn es keinen primären Block gibt (`summary.ts`:
 *      `if (!entry) return { …, statements: [] }`).
 *   2. Kapitel 6 wird gar nicht gerendert, wenn `hasComparison` falsch ist — der Klarsatz
 *      `addon_none` entstünde dort trotzdem.
 *   3. Kapitel 2 wird gar nicht gerendert, wenn `hasRecommendation` falsch ist — seine beiden
 *      Bausteine entstünden dort trotzdem.
 *   4. `monthly_comparison` hat EINEN Erzeuger und zwei Kapitel — s. den Eintrag unten.
 */

/**
 * Die vier Formen, die ein Baustein hat.
 *
 * ⚠ Sie sind KEINE Geschmacksfrage, sondern vier verschiedene Renderer in `document.tsx`
 * (`Statement`, `Notice`, `Table`, und das `itemTitle`/`itemBody`-Paar der Methodik-Absätze). Eine
 * Auswahl-Oberfläche, die eine Tabelle für eine Aussage hält, böte Felder an, die es nicht gibt.
 */
export type ReportBaukastenForm = 'statement' | 'notice' | 'table' | 'method'

/**
 * Die 24 stabilen Kennungen.
 *
 * ⚠ EIN LITERAL-UNION UND KEIN `string` — dieselbe Überlegung wie bei `SummaryStatement['id']`
 * (`summary.ts`): ein Tippfehler in einer Kennung ist damit ein Compile-Fehler und nicht ein
 * Baustein, den niemand wiederfindet.
 *
 * ⚠ `addon` hat zwei Erzeugungsstellen INNERHALB einer Funktion, `addon_table`/
 * `catalog_alternatives` teilen sich eine (s. dort), und die drei Tabellen hatten bis B2 gar keine.
 *
 * ⚠ DIE ZWEI TEXTBLÖCKE DER ZUSAMMENFASSUNG STEHEN NICHT HIER, und das ist dieselbe Grenze wie bei
 * den zwei Kopfzahlen: sie tragen weder Titel noch Betrag noch Zeilen und sind damit keine der vier
 * Formen, die `document.tsx` rendert. Ein Katalog-Eintrag für sie wäre eine Auswahl-Zusage, die die
 * Seite nicht einlösen kann — der Fliesstext ist die Seite, nicht ein Baustein darauf.
 */
export type ReportBaukastenId =
  /* Kapitel 1 — Zusammenfassung */
  | 'addon'
  | 'standard_profile'
  | 'estimated_pv'
  | 'partial_year'
  | 'large_gap'
  /* Kapitel 2 — Empfehlung und Wirtschaftlichkeit */
  | 'recommendation'
  | 'load_control'
  /* Kapitel „Ihre PV-Anlage" */
  | 'pv_value_finding'
  /* Kapitel 3 oder 4 — der Monatsvergleich (ein Erzeuger, zwei Orte) */
  | 'monthly_comparison'
  /* Kapitel 5 — Ladeverhalten */
  | 'hour_flow'
  | 'charge_price'
  /* Kapitel 6 — Speichergrösse und Gerätewahl */
  | 'addon_none'
  | 'addon_table'
  | 'catalog_alternatives'
  | 'table_candidates'
  /* Kapitel 8 — Annahmen und Datengrundlage */
  | 'assumptions'
  | 'data_quality'
  | 'tariff_blocker'
  | 'pv_outage'
  | 'limitations'
  | 'table_data_sources'
  | 'table_tariff_components'
  | 'method_shared'
  | 'method_pv_outage'

/**
 * Ein Eintrag: Kennung, Form und die nullstellige Erzeugung.
 *
 * ⚠ Die Union verzweigt an `form`, damit der Rückgabetyp von `build()` ohne Typprüfung zur Hand
 * ist — dasselbe Muster wie `DetailCostPlan` (`detail.ts`) und `ComparisonVariant`.
 *
 * ⚠ `build()` ist NULLSTELLIG: alles, was der Erzeuger braucht, steckt bereits in der Closure
 * (Eingabe und Kontext des Dokuments). Ein Parameter hier wäre die Einladung, einen Baustein mit
 * anderen Werten zu bauen als den, den das Dokument zeigt.
 */
export type ReportBaukastenEntry =
  | {
      id: ReportBaukastenId
      section: ReportSectionKey
      form: 'statement'
      build: () => ReportStatement | null
    }
  | {
      id: ReportBaukastenId
      section: ReportSectionKey
      form: 'notice'
      build: () => ReportNotice | null
    }
  | {
      id: ReportBaukastenId
      section: ReportSectionKey
      form: 'table'
      build: () => ReportTable | null
    }
  | {
      id: ReportBaukastenId
      section: ReportSectionKey
      form: 'method'
      build: () => BasisMethodItem | null
    }

export type ReportBaukastenRegistry = {
  /**
   * Alle 24 Einträge, in Kapitel- und Leserichtung.
   *
   * ⚠ Stufe D LIEST diese Reihenfolge als die Leseordnung des Dokuments (`layout.ts`) — bis dahin
   * war sie eine Ordnungshilfe. Sie muss deshalb der Folge im JSX entsprechen; `limitations` stand
   * bis Stufe D vor den beiden Tabellen und steht im Dokument hinter ihnen.
   */
  entries: readonly ReportBaukastenEntry[]
  /** ⚠ Total: die Kennungen sind ein geschlossener Union, es gibt kein `undefined`. */
  get: (id: ReportBaukastenId) => ReportBaukastenEntry
}

/**
 * In welchem Kapitel ein Baustein steht.
 *
 * ⚠ EINE TABELLE UND KEIN ARGUMENT JE EINTRAG: die Zuordnung ist eine Eigenschaft der Kennung und
 * gehört neben den Union, nicht 25-mal in die Einträge. `monthly_comparison` ist die Ausnahme —
 * ein Erzeuger, zwei einander ausschliessende Kapitel — und bekommt seins beim Bauen übergeben.
 */
const SECTION_OF: Record<ReportBaukastenId, ReportSectionKey> = {
  addon: SECTION_ID.results,
  standard_profile: SECTION_ID.results,
  estimated_pv: SECTION_ID.results,
  partial_year: SECTION_ID.results,
  large_gap: SECTION_ID.results,
  pv_value_finding: SECTION_ID.pvValue,
  recommendation: SECTION_ID.recommendation,
  load_control: SECTION_ID.recommendation,
  monthly_comparison: SECTION_ID.detail,
  hour_flow: SECTION_ID.insight,
  charge_price: SECTION_ID.insight,
  addon_none: SECTION_ID.comparison,
  addon_table: SECTION_ID.comparison,
  catalog_alternatives: SECTION_ID.comparison,
  table_candidates: SECTION_ID.comparison,
  assumptions: SECTION_ID.basis,
  data_quality: SECTION_ID.basis,
  tariff_blocker: SECTION_ID.basis,
  pv_outage: SECTION_ID.basis,
  limitations: SECTION_ID.basis,
  table_tariff_components: SECTION_ID.basis,
  table_data_sources: SECTION_ID.basis,
  method_shared: SECTION_ID.basis,
  method_pv_outage: SECTION_ID.basis,
}

const statement = (
  id: ReportBaukastenId,
  build: () => ReportStatement | null,
  section: ReportSectionKey = SECTION_OF[id],
): ReportBaukastenEntry => ({ id, section, form: 'statement', build })

const notice = (id: ReportBaukastenId, build: () => ReportNotice | null): ReportBaukastenEntry => ({
  id,
  section: SECTION_OF[id],
  form: 'notice',
  build,
})

const table = (id: ReportBaukastenId, build: () => ReportTable | null): ReportBaukastenEntry => ({
  id,
  section: SECTION_OF[id],
  form: 'table',
  build,
})

const method = (
  id: ReportBaukastenId,
  build: () => BasisMethodItem | null,
): ReportBaukastenEntry => ({ id, section: SECTION_OF[id], form: 'method', build })

/**
 * Bildet die Registry. EINMAL je Erzeugung aufrufen, unmittelbar nach `buildReportContext` —
 * derselbe Zeitpunkt und dieselbe Zusage wie bei Kontext und Bildern (`render.tsx`).
 *
 * ── ⚠ WARUM SIE `input` UND KONTEXT NIMMT UND NICHT NUR DEN KONTEXT ───────────────────────────
 * `ReportBuildContext` führt ausschliesslich ABGELEITETE Zwischenwerte und ausdrücklich nicht die
 * Eingabe (s. `context.ts`) — sieben der 25 Bausteine lesen aber direkt am Eingang: der Lastgang
 * (`standard_profile`), die geschätzte PV (`estimated_pv`), die Zeitzone (`tariff_blocker`), die
 * PV-Monate (`method_pv_outage`) und die beiden Tabellen des Schlusskapitels. Den Eingang in den
 * Kontext zu heben wäre eine Erweiterung von B1 für eine Frage, die B1 nicht stellt; an der
 * Aufrufstelle stehen beide ohnehin nebeneinander.
 */
export function buildReportRegistry(
  input: PdfReportInput,
  context: ReportBuildContext,
): ReportBaukastenRegistry {
  const analysis = input.analysis

  /*
   * ⚠ Die Fassade von Kapitel 1 lässt `addon` weg, wenn es keinen primären Block gibt (leerer
   * Katalog). Die Bedingung ist beweisbar folgenlos (ohne Bestandsanlage gibt es keinen primären
   * Block, und ohne primären Block gibt es keine Bestandsanlage), sie steht hier trotzdem: geprüft
   * wird gegen die Fassade, und eine Abweichung „die heute nichts ausmacht" ist genau die Sorte,
   * die morgen etwas ausmacht.
   */
  const entry = context.primaryEntry

  const comparison = comparisonSelection(analysis)
  const hasTable = comparison.shown.length > 0

  const entries: ReportBaukastenEntry[] = [
    /*
     * ── Kapitel 1 ─────────────────────────────────────────────────────────────────────────────
     *
     * ⚠ DIE VIER HINWEISE STEHEN VOR `addon`, weil sie im Dokument davor stehen: `ResultsChapter`
     * rendert Kopfzahlen → Hinweise → Fliesstext → Kasten. Seit `layout.ts` aus dieser Liste die
     * LESEORDNUNG liest, wäre eine andere Reihenfolge ein Verweis, der „weiter unten" sagt, wo
     * „oben" richtig ist — derselbe stille Fehler wie bei `limitations`.
     */
    notice('standard_profile', () =>
      buildStandardProfileNotice(input.loadProfile, analysis.current),
    ),
    notice('estimated_pv', () => buildEstimatedPvNotice(input.estimatedPv)),
    notice('partial_year', () => buildPartialYearNotice(analysis)),
    notice('large_gap', () => buildLargeGapNotice(analysis)),
    statement('addon', () => (entry ? buildAddon(analysis) : null)),

    /*
     * ── Kapitel „Ihre PV-Anlage" ──────────────────────────────────────────────────────────────
     *
     * ⚠ DER EINZIGE BAUSTEIN DIESES KAPITELS, UND ER IST HIER, WEIL EIN FREMDER SATZ AUF IHN
     * ZEIGT. Die Zusammenfassung verweist auf den PV-Befund; solange kein Baustein des Kapitels
     * im Katalog stand, konnte der Verweis dorthin gar nicht auflösen (`WAYS_SECTION` benennt
     * genau diese Bedingung). Die übrigen Absätze des Kapitels bleiben bewusst draussen — sie
     * werden von nirgends adressiert, und ein Katalog-Eintrag für sie wäre eine Auswahl-Zusage,
     * die die Seite nicht einlöst (dieselbe Grenze wie bei den Textblöcken der Zusammenfassung).
     *
     * ⚠ ER HÄNGT AM BEFUND UND NICHT AM KAPITEL. Ohne auffälligen Monat gibt es das Kapitel sehr
     * wohl, diesen Absatz aber nicht — und der Satz in der Zusammenfassung, der einen „Befund"
     * ankündigt, muss dann ebenfalls entfallen.
     */
    statement('pv_value_finding', () => pvValueFinding()),

    /*
     * ── Kapitel 2 ─────────────────────────────────────────────────────────────────────────────
     *
     * ⚠ BEIDE BAUSTEINE TRAGEN DEN KAPITEL-SCHALTER (`hasRecommendation`): sagt die Gerätewahl im
     * Bestandsfall „Nein", wird das Kapitel nicht gerendert — die zwei Aussagen entstünden sonst
     * trotzdem, und ein Verweis auf sie zeigte auf eine Seite, die es nicht gibt.
     */
    statement('recommendation', () => {
      const recommended = context.recommendedEntry
      return context.hasRecommendation && recommended
        ? buildRecommendation(analysis, recommended)
        : null
    }),
    statement('load_control', () =>
      context.hasRecommendation ? buildLoadControl(analysis, context.primaryEntry) : null,
    ),

    /*
     * ── Kapitel 3 ODER 4: EIN Eintrag, zwei Quellen ───────────────────────────────────────────
     *
     * ⚠ Der Baustein hat eine Kennung, einen Erzeuger und ZWEI Rendering-Orte, die einander
     * ausschliessen: mit Bestandsanlage steht er in Kapitel 3 an der Stelle des Kostenverlaufs
     * (aus `detailPlan.cost`), ohne sie als eigenes Kapitel 4 (aus `monthlyComparisonOf`). Zwei
     * Einträge wären eine Kennung zu viel — und sie behaupteten eine Wahl, die es nicht gibt.
     *
     * ⚠ Die Verzweigung ist dieselbe, die auch die beiden Fassaden trennt: `detailChartPlan` wählt
     * `kind: 'monthly'` ausschliesslich im Bestandsfall, `monthlyComparisonOf` liefert
     * ausschliesslich ohne ihn. Der `isExisting`-Parameter des Erzeugers folgt daraus und wird
     * nicht ein zweites Mal abgeleitet.
     */
    statement(
      'monthly_comparison',
      () => {
        if (analysis.existingBatteryAnalysis) {
          const cost = context.detailPlan.cost
          return cost?.kind === 'monthly'
            ? buildMonthly(cost.comparison, analysis.current).statement
            : null
        }
        return buildMonthlyChapter(analysis)?.statement ?? null
      },
      analysis.existingBatteryAnalysis ? SECTION_ID.detail : SECTION_ID.monthly,
    ),

    /* ── Kapitel 5 ─────────────────────────────────────────────────────────────────────────── */
    statement('hour_flow', () => {
      const plan = context.insightPlan.hourFlow
      return plan ? buildHourFlow(plan).statement : null
    }),
    statement('charge_price', () => {
      const plan = context.insightPlan.chargePrice
      return plan ? buildChargePrice(plan.price).statement : null
    }),

    /*
     * ── Kapitel 6: zwei Kennungen aus EINEM Erzeuger mit Variantenparameter ───────────────────
     *
     * ⚠ `variant` ist eindeutig aus dem Ergebnis ableitbar und die beiden Fälle schliessen einander
     * aus: `candidatesOf` verzweigt allein an `existingBatteryAnalysis` — mit Bestandsanlage die
     * Zusatzszenarien (`addon`), sonst der Katalog-Lauf (`catalog`). Es gibt keinen Zustand, in dem
     * beide zuträfen; deshalb liefert im Regelfall genau EINER der beiden Einträge einen Wert, und
     * bei leerer Tabelle (Klarsatz) keiner von beiden.
     *
     * ⚠ `addon_none` braucht als einziger Baustein dieses Kapitels den Kapitel-Schalter: der
     * Klarsatz entstünde auch dann, wenn `hasComparison` falsch ist — dann wird das Kapitel aber
     * gar nicht gerendert. Für die beiden Tabellen-Einträge ist das nicht nötig: eine nichtleere
     * Tabelle zieht `hasComparison` in beiden Varianten nach sich.
     */
    statement('addon_none', () =>
      context.hasComparison && !hasTable
        ? buildVerdict(comparison.considered, comparison.horizonYears)
        : null,
    ),
    statement('addon_table', () =>
      hasTable && comparison.variant === 'addon'
        ? buildTableStatement('addon', comparison.considered, comparison.horizonYears)
        : null,
    ),
    statement('catalog_alternatives', () =>
      hasTable && comparison.variant === 'catalog'
        ? buildTableStatement('catalog', comparison.considered, comparison.horizonYears)
        : null,
    ),
    table(CANDIDATE_TABLE_ID, () =>
      hasTable ? buildCandidateTable(comparison.shown, comparison.horizonYears) : null,
    ),

    /* ── Kapitel 8 ─────────────────────────────────────────────────────────────────────────── */
    statement('assumptions', () => buildAssumptions(analysis)),
    /* ⚠ Aus dem Kontext und NICHT neu gebaut: die Datenquellen-Tabelle unten hängt am HINWEIS. */
    notice('data_quality', () => context.dataQuality),
    notice('tariff_blocker', () => buildBlocker(analysis, timeZoneOf(input.loadProfile))),
    /* ⚠ Aus dem Kontext und NICHT neu gebaut: der PV-Methodik-Absatz unten hängt am HINWEIS. */
    notice('pv_outage', () => context.pvOutage),
    table(TARIFF_COMPONENTS_TABLE_ID, () => buildTariffComponents(input)),
    table(DATA_SOURCES_TABLE_ID, () => buildDataSources(input)),

    /*
     * ⚠ NUR DER GEMEINSAME ABSATZ STEHT IM KATALOG, DIE WEGE-ZEILEN NICHT. Wie viele es davon gibt
     * und welche, entscheidet das Wege-Kapitel je Kunde (`methodNotes`, `ways.ts`) — eine feste
     * Kennung je Zeile wäre eine Behauptung über eine Anzahl, die es nicht gibt, und eine
     * Auswahl-Zusage, die die Seite nicht einlösen kann (dieselbe Grenze wie bei den Textblöcken
     * der Zusammenfassung und den übrigen Absätzen des PV-Kapitels).
     */
    method('method_shared', () => sharedMethodItem(analysis)),
    method('method_pv_outage', () =>
      context.pvOutage && input.pvOutageMonths ? pvOutageMethodItem(input.pvOutageMonths) : null,
    ),
    /* ⚠ ZULETZT, weil er im Dokument zuletzt steht — s. `entries` im Kopf dieser Datei. */
    notice('limitations', () => buildLimitations(analysis)),
  ]

  /**
   * Der Befund-Absatz des PV-Kapitels — `null`, wenn es das Kapitel nicht gibt ODER es keinen
   * auffälligen Monat führt. Herausgegriffen über die Kennung und nicht über den Index: eine
   * andere Reihenfolge im Erzeuger bliebe sonst unbemerkt (wie bei den Tarif-Absätzen unten).
   */
  function pvValueFinding(): ReportStatement | null {
    return (
      buildPvValueChapter(analysis)?.statements.find((s) => s.id === 'pv_value_finding') ?? null
    )
  }

  const byId = new Map<ReportBaukastenId, ReportBaukastenEntry>(entries.map((e) => [e.id, e]))

  return {
    entries,
    /*
     * ⚠ Der `!` ist hier keine Behauptung, sondern eine Folgerung: `entries` deckt den Union
     * vollständig ab, und `REPORT_BAUKASTEN_IDS` misst das (`registry.test.ts`).
     */
    get: (id) => byId.get(id)!,
  }
}

/**
 * Die 24 Kennungen als Laufzeitliste.
 *
 * ⚠ Sie steht hier und nicht in der Registry: ein Prüflauf, der die Vollständigkeit der Registry
 * aus der Registry selbst läse, prüfte sie gegen sich. Der Typ `ReportBaukastenId` und diese Liste
 * werden getrennt geführt und gegeneinander gemessen — ein fehlender Eintrag fällt damit auf.
 */
export const REPORT_BAUKASTEN_IDS = [
  'addon',
  'standard_profile',
  'estimated_pv',
  'partial_year',
  'large_gap',
  'recommendation',
  'load_control',
  'pv_value_finding',
  'monthly_comparison',
  'hour_flow',
  'charge_price',
  'addon_none',
  'addon_table',
  'catalog_alternatives',
  'table_candidates',
  'assumptions',
  'data_quality',
  'tariff_blocker',
  'pv_outage',
  'limitations',
  'table_tariff_components',
  'table_data_sources',
  'method_shared',
  'method_pv_outage',
] as const satisfies readonly ReportBaukastenId[]

/*
 * ⚠ Der Beweis, dass die Liste den Union VOLLSTÄNDIG abdeckt — und er steht hier und nicht im
 * Prüflauf: Testdateien sind vom Typecheck ausgenommen, eine dort notierte Typ-Zusage liefe ins
 * Leere. Eine Kennung, die dem Union zugefügt und in der Liste vergessen wird, ist damit ein
 * Compile-Fehler; dass die EINTRÄGE die Liste decken, misst `registry.test.ts` zur Laufzeit.
 */
const _idsAreExhaustive: Exclude<
  ReportBaukastenId,
  (typeof REPORT_BAUKASTEN_IDS)[number]
> extends never
  ? true
  : never = true
void _idsAreExhaustive

/*
 * ⚠ Report-Baukasten C — die abwählbaren Bausteine sind eine TEILMENGE dieses Katalogs, und
 * das steht hier, weil `packages/shared` den Katalog nicht kennen darf (die Liste hat zwei
 * Konsumenten in zwei Apps, s. `report-sections.ts`). Eine dort umbenannte Kennung ist damit ein
 * Compile-Fehler und nicht ein Baustein, der sich stillschweigend nicht mehr abwählen lässt.
 */
const _optionalSectionsAreKnown: Exclude<ReportOptionalSection, ReportBaukastenId> extends never
  ? true
  : never = true
void _optionalSectionsAreKnown
