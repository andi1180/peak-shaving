import { dispatchMethodText } from '@/lib/report-copy'
import type { PdfReportInput } from './types'

/**
 * B23a — die Kapitel des react-pdf-Reports als DATEN, nicht als JSX.
 *
 * ── WARUM DATEN ────────────────────────────────────────────────────────────────────────────────
 * Die Agenda muss dieselben Überschriften nennen, die weiter hinten stehen, und ihnen Seitenzahlen
 * zuordnen. Zwei getrennte Listen — eine im Kapitel, eine in der Agenda — liefen beim ersten
 * Umformulieren auseinander, und dann verwiese ein Inhaltsverzeichnis auf einen Abschnitt, der
 * anders heisst. Eine Definition, zwei Konsumenten (dasselbe Muster wie `tariff-window-rules.ts`).
 *
 * ── DER METHODIK-INHALT IST DERSELBE WIE IM CSS-DRUCK, WORT FÜR WORT ───────────────────────────
 * Die sechs Punkte stammen aus `components/report/print-methodology.tsx` (Delta 16a) und sind
 * unverändert übernommen — nur die Darstellung wechselt von CSS-Print auf react-pdf. Solange BEIDE
 * Wege nebeneinander im Repo stehen (bis zum Cutover), ist das eine bewusste Doppelung des TEXTES.
 *
 * ⚠ Genau EINE Ausnahme davon: der Absatz zum Fahrplan (§6.2, Pflicht) entsteht je Lauf aus
 * `dispatchMethodText` (`lib/report-copy.ts`), derselben Quelle wie im CSS-Druck und an der
 * Ersparnis-Aufschlüsselung — nur hier mit der Rückblick-Obergrenze als Zahl.
 */

/** Ein Eintrag der Agenda UND zugleich ein Abschnitt im Dokument. */
export type ReportSection = {
  /**
   * Stufe D — wie ein FREMDER Baustein dieses Kapitel benennt, als blosses Nomen („Zusammenfassung").
   *
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * ⚠ ES HAT IHN GENAU EIN KAPITEL, UND DER GRUND IST SEINE UNBEDINGTE ERSTSTELLUNG
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * Der Resolver bildet eine Ortsangabe sonst aus der Leseordnung („oben", „weiter unten") oder
   * benennt das fremde Kapitel generisch („im Kapitel „X""). Für Kapitel 1 braucht es beides
   * nicht: es steht in JEDEM Report, und es steht immer als Erstes — ein Verweis darauf muss
   * nichts berechnen. Der Report benennt es deshalb bei seinem Namen, statt in die generische Form
   * zu fallen.
   *
   * ⚠ KEIN BEDINGTES KAPITEL DARF IHN BEKOMMEN. Kapitel 4, 5 und 6 entstehen nur, wenn ihre Daten
   * es hergeben; ein Satz, der sie beim Namen nennt, zeigte in den übrigen Fällen ins Leere. Und
   * kein Kapitel ausser dem ersten steht an fester Stelle — für die übrigen ist die berechnete
   * Ortsangabe die richtige Antwort, gerade weil Block 3 sie verschiebt.
   *
   * ⚠ DER ARTIKEL STEHT IM SATZ, nicht hier: die Verwendungen brauchen Nominativ („Die
   * Zusammenfassung zeigt"), Genitiv („der Zusammenfassung") und Dativ („auf der
   * Zusammenfassung"). Ein fertiges Satzstück passte in keinen davon. Damit daraus
   * beim Umzug eines Ziels kein grammatischer Unsinn wird („auf der Kapitel „X""), verlangt der
   * Resolver diesen Namen: fehlt er, nimmt der Verweis seine Ersatzformulierung (s. `report-text.ts`).
   */
  reference?: string
  /** Stabil — der Schlüssel, unter dem die gemessene Seitenzahl abgelegt wird. */
  id: string
  title: string
  /**
   * 1 = Kapitel, 2 = Unterpunkt innerhalb eines Kapitels.
   *
   * ⚠ NICHT NUR EINE EINRÜCKUNGSSTUFE: an dieser Zahl hängt, ob der Eintrag in der Agenda eine
   * SEITENZAHL bekommt. Ein Kapitel ist eine eigene `<Page>` und damit messbar; ein Unterpunkt
   * liegt innerhalb einer umbrechenden Seite und ist es nachweislich NICHT — s. die drei
   * Messungen im Kopf von `page-numbers.ts`.
   */
  level: 1 | 2
}

export type MethodologyItem = ReportSection & { body: string }

export const METHODOLOGY_ITEMS: readonly MethodologyItem[] = [
  {
    id: 'methodik-grundlage',
    level: 2,
    title: 'Grundlage ist Ihr echter Lastgang',
    body:
      'Gerechnet wird auf den Viertelstundenwerten, die Sie hochgeladen haben, und auf den ' +
      'Tarifwerten Ihrer Netzrechnung. Wo uns ein Wert fehlt, weisen wir das aus, statt ihn zu ' +
      'schätzen — eine geratene Zahl fällt später niemandem als Fehler auf, sondern als Ergebnis.',
  },
  {
    id: 'methodik-ein-fahrplan',
    level: 2,
    title: 'Ein Fahrplan, keine addierten Einzelrechnungen',
    body:
      'Spitzenkappung, Eigenverbrauch und tarifbewusstes Laden konkurrieren um dieselbe ' +
      'Batteriekapazität. Sie werden deshalb in einer einzigen Simulation gemeinsam gefahren und ' +
      'erst danach in Leistungspreis- und Energie-Anteil aufgeteilt — nie getrennt gerechnet und ' +
      'addiert. Der Energie-Anteil ist die volle Kostendifferenz Ihres Netzbezugs ohne und mit ' +
      'Speicher, Ladeverluste eingeschlossen; beide Anteile ergeben zusammen genau die ' +
      'ausgewiesene Gesamtersparnis.',
  },
  {
    id: 'methodik-simulation',
    level: 2,
    title: 'Physikalische Simulation, kein Hochrechnen von Spitzen',
    body:
      'Die Batterie wird über den gesamten Zeitraum chronologisch mit Ladestand, Leistungsgrenze ' +
      'und Wirkungsgrad durchgerechnet. Der Ladestand bleibt dabei jederzeit innerhalb der ' +
      'nutzbaren Kapazität; eine Spitze gilt nur dann als abgefangen, wenn zu diesem Zeitpunkt ' +
      'tatsächlich genug Energie und Leistung vorhanden waren.',
  },
  {
    id: 'methodik-fahrplan',
    level: 2,
    title: 'Wie der Fahrplan entsteht',
    /* Platzhalter für die Agenda; den Text setzt `methodologyItemsFor` je Lauf. */
    body: '',
  },
  {
    id: 'methodik-degradation',
    level: 2,
    title: 'Konstante Batterieeigenschaften über den Betrachtungszeitraum',
    body:
      'Nutzbare Kapazität und Wirkungsgrad werden über den gesamten Horizont als unverändert ' +
      'angenommen. Reale Speicher verlieren mit den Jahren an Kapazität. Diese Alterung ist hier ' +
      'bewusst nicht modelliert — eine erfundene Alterungskurve wäre schlechter als eine ' +
      'offengelegte Vereinfachung. Die ausgewiesene Ersparnis der späteren Jahre ist dadurch eher ' +
      'optimistisch.',
  },
  {
    id: 'methodik-prinzip4',
    level: 2,
    title: 'Ihre Verbrauchsdaten haben Ihren Rechner nicht verlassen',
    body:
      'Lastgang und Messwerte wurden vollständig in Ihrem Browser verarbeitet; sie wurden nicht ' +
      'übertragen und nicht gespeichert. Auch dieses Dokument ist lokal auf Ihrem Gerät ' +
      'entstanden.',
  },
]

/**
 * `METHODOLOGY_ITEMS`, angepasst an diesen Lauf — s. `PdfReportOrigin` (`types.ts`).
 *
 * Dieselbe Liste geht an die Agenda UND an das Kapitel (Kopf oben): ein Punkt, der hier entfällt,
 * fehlt damit auch im Inhaltsverzeichnis, ohne dass beide Stellen einzeln gepflegt werden müssen.
 */
export function methodologyItemsFor(
  input: Pick<PdfReportInput, 'analysis' | 'origin'> & { loadProfile?: Pick<PdfReportInput['loadProfile'], 'source'> },
): readonly MethodologyItem[] {
  const dispatch = dispatchMethodText({
    analysis: input.analysis,
    isStandardProfile: input.loadProfile?.source === 'standard_profile',
    withUpperBound: true,
  })

  return METHODOLOGY_ITEMS.filter(
    (item) => item.id !== 'methodik-prinzip4' || input.origin === 'client',
  ).map((item) => (item.id === 'methodik-fahrplan' ? { ...item, body: dispatch } : item))
}

/** Die Demo-Fusszeile — ausschliesslich am Prüfstand/Demo-Fixture, s. `PdfReportOrigin`. */
export function reportDisclaimer(origin: PdfReportInput['origin']): string | null {
  return origin === 'demo' ? REPORT_DISCLAIMER : null
}

/** Kapitel-Kennungen, damit die Dokument-Bausteine sie nicht als Zeichenkette ausschreiben. */
export const SECTION_ID = {
  results: 'zusammenfassung',
  prerequisites: 'voraussetzungen',
  load: 'lastgang',
  ways: 'wege',
  annualScenario: 'jahreshochrechnung',
  pvValue: 'pv-anlage',
  recommendation: 'empfehlung',
  detail: 'kostenverlauf',
  monthly: 'monatsvergleich',
  insight: 'ladeverhalten',
  comparison: 'geraetewahl',
  methodology: 'methodik',
  advice: 'vorschlag',
  basis: 'grundlage',
} as const

export const RESULTS_SECTION: ReportSection = {
  id: SECTION_ID.results,
  level: 1,
  title: 'Zusammenfassung',
  reference: 'Zusammenfassung',
}

/**
 * Das Kapitel zwischen Zusammenfassung und Empfehlung: welche Anlage der Kunde hat, welcher Rahmen
 * für seinen Anschluss gilt (Leistungspreis ja/nein), und worauf die heutigen Kosten beruhen.
 *
 * ⚠ Unbedingtes Kapitel wie `RESULTS_SECTION`/`BASIS_SECTION`: der Netzanschluss-Block und der
 * Rahmen-Satz stehen in jedem Report, egal ob es eine Bestandsanlage oder eine PV-Anlage gibt.
 */
export const PREREQUISITES_SECTION: ReportSection = {
  id: SECTION_ID.prerequisites,
  level: 1,
  title: 'Voraussetzungen',
}

/** Steht unter der Kapitelüberschrift. Sagt, worum es geht, nicht was auf der Seite steht. */
export const PREREQUISITES_INTRO =
  'Womit gerechnet wird — Ihre Anlage, Ihr Netzanschluss, und der Rahmen, in dem sich Ihre ' +
  'Ersparnis bewegt.'

/**
 * Das Kapitel zwischen Voraussetzungen und Empfehlung: die gemessene Kurve, sonst nichts.
 *
 * ── ⚠ EIN EIGENES KAPITEL UND KEIN BILD IM EMPFEHLUNGS-KAPITEL MEHR ───────────────────────────
 * Der Lastgang ist die Grundlage JEDER Zahl dieses Reports und nicht nur die Anschauung zur
 * Kaufaussage. Als Bild im Empfehlungs-Kapitel las er sich wie deren Beleg — und trug dafür eine
 * Kapp-Linie samt Deutung, also eine Bewertung über einer Messung. Hier steht die Messung für
 * sich: keine Kapp-Schwelle, keine markierten Spitzen, keine Aussage über eine Ersparnis.
 *
 * ⚠ Unbedingtes Kapitel wie `RESULTS_SECTION`/`PREREQUISITES_SECTION`: es gibt keinen Report ohne
 * Lastgang. Misslingt die Rasterung, steht an der Stelle des Bildes die Fehlmeldung (`ChartFigure`)
 * — ein Kapitel, das dann ganz entfiele, nähme dem Leser die Grundlage kommentarlos weg.
 *
 * ⚠ Eigene `<Page>` (D5, Regel 1). Als `<View break>` bekäme es in der Agenda die Seitenzahl des
 * vorigen Kapitels — plausibel aussehend und falsch.
 */
export const LOAD_SECTION: ReportSection = {
  id: SECTION_ID.load,
  level: 1,
  title: 'Ihr Lastgang',
}

/**
 * Steht unter der Kapitelüberschrift.
 *
 * ⚠ Er ist FALLUNABHÄNGIG und beschreibt deshalb ausnahmsweise doch, was auf der Seite steht: auf
 * dieser Seite steht in jedem Report dasselbe — die gemessene Kurve. Die Regel, nach der die
 * übrigen Vorspänne nichts ankündigen (s. `RESULTS_INTRO`), greift dort, wo der Inhalt an der
 * Datenlage hängt; hier tut er das nicht.
 */
export const LOAD_INTRO =
  'Ihr Netzbezug über den ausgewerteten Zeitraum, in Viertelstundenwerten — die tatsächliche ' +
  'Grundlage für alle Zahlen in dieser Auswertung.'

/**
 * D7 — das Kapitel zwischen Lastgang und Empfehlung: die Wege, den heutigen Stromtarif zu
 * verlassen, mit dem Balkendiagramm aus dem Urbanz-Referenz-PDF (S. 5–6, nur Struktur/Optik).
 *
 * ── ⚠ DER TITEL HIER IST EIN PLATZHALTER UND STEHT IN KEINEM FERTIGEN DOKUMENT ────────────────
 * Seit der D7-Revision (21.09.2026) führt das Kapitel je Kunde DREI BIS FÜNF Wege; der Titel zählt
 * sie (`waysSectionTitle`, `ways.ts`) und wird von Agenda und Überschrift aus DERSELBEN Ableitung
 * gebildet. Diese Konstante trägt die Kennung und die Ebene — der Titel darin ist nur der Wert,
 * der dasteht, wenn jemand das Kapitel ohne Zählung einsetzt (heute niemand).
 *
 * ⚠ Ein Querverweis auf dieses Kapitel gibt es nicht: kein Baustein der Registry liegt in ihm
 * (`ReportBaukastenId` führt keine `ways_*`-Kennung), `layout.ts` kann also nie auf diesen Titel
 * auflösen. Sobald ein Baustein hierher zieht, muss der Verweis die gezählte Fassung bekommen.
 *
 * ⚠ Bedingtes Kapitel wie „Ihr Stromtarif im Monatsvergleich" (`MONTHLY_SECTION`): ohne
 * berechenbaren Monatsvergleich gibt es weder die Balken noch die Absätze — s. `hasWaysChapter`.
 */
export const WAYS_SECTION: ReportSection = {
  id: SECTION_ID.ways,
  level: 1,
  title: 'Wege zu weniger Stromkosten',
}

/**
 * D6 Teil 3 — das Kapitel direkt hinter den Wegen: dieselben Wege, gerechnet auf einem vollen Jahr.
 *
 * ⚠ Bedingtes Kapitel: es steht nur, wenn der Lastgang WENIGER als ein Jahr abdeckt UND die
 * Hochrechnung gebildet werden konnte (`hasAnnualScenarioChapter`, `annual-scenario.ts`). Bei
 * einem Lastgang über ein volles Jahr wäre es eine Schätzung ohne Gegenstand.
 *
 * ⚠ Der Titel ist eine FRAGE, und das ist Absicht: er sagt dem Leser im Inhaltsverzeichnis, dass
 * hier gerechnet und nicht gemessen wurde. „Jahres-Hochrechnung" klänge nach einer weiteren
 * Auswertung derselben Daten.
 */
export const ANNUAL_SCENARIO_SECTION: ReportSection = {
  id: SECTION_ID.annualScenario,
  level: 1,
  title: 'Was wäre, wenn wir ein ganzes Jahr hätten?',
}

/**
 * Das Kapitel hinter der Jahres-Hochrechnung: was die BESTEHENDE PV-Anlage wert war.
 *
 * ⚠ Bedingtes Kapitel: es steht nur, wenn die Rekonstruktion gebildet werden konnte
 * (`hasPvValueChapter`, `pv-value.ts`) — also bei einer bestehenden Anlage in einem reinen
 * Bezugslastgang. Bei gemessener Einspeisung und bei einer geplanten Anlage gibt es nichts zu
 * rekonstruieren.
 *
 * ⚠ Der Titel nennt weder „Rekonstruktion" noch „Wert": was auf der Seite steht, hängt daran, ob
 * der Lastgang auffällige Monate zeigt — und ein Kunde sucht im Inhaltsverzeichnis nach seiner
 * Anlage, nicht nach unserer Methode.
 */
export const PV_VALUE_SECTION: ReportSection = {
  id: SECTION_ID.pvValue,
  level: 1,
  title: 'Ihre PV-Anlage',
}

/** Steht unter der Kapitelüberschrift. Sagt, worum es geht, nicht was auf der Seite steht. */
export const PV_VALUE_INTRO =
  'Was Ihre Anlage in diesem Zeitraum beigetragen hat — zurückgerechnet aus Ihrem echten ' +
  'Lastgang, nicht ein zweites Mal gemessen.'

/** Steht unter der Kapitelüberschrift. Sagt, worum es geht, nicht was auf der Seite steht. */
export const ANNUAL_SCENARIO_INTRO =
  'Dieselben Wege, hochgerechnet auf zwölf Monate — eine Schätzung auf Grundlage Ihrer eigenen ' +
  'Messwerte, keine zweite Messung.'

/** Steht unter der Kapitelüberschrift. Sagt, worum es geht, nicht was auf der Seite steht. */
export const WAYS_INTRO =
  'Was Ihr Strom heute kostet — und was jeder der geprüften Wege daran ändern würde.'

const WAYS_NUMBER_WORD: Record<number, string> = { 2: 'Zwei', 3: 'Drei', 4: 'Vier', 5: 'Fünf' }

/**
 * Die gezählte Kapitelüberschrift (D7-Revision).
 *
 * ⚠ Sie steht HIER und nicht in `ways.ts`, obwohl dort die Zählung entsteht: `content.ts` ist die
 * Heimat der Kapiteltitel, und `ways.ts` hängt über `summary.ts` an diesem Modul — der Titel dort
 * gebildet ergäbe einen Import-Zyklus.
 */
export function waysSectionTitle(wayCount: number): string {
  if (wayCount === 1) return 'Ein Weg zu weniger Stromkosten'
  return `${WAYS_NUMBER_WORD[wayCount] ?? String(wayCount)} Wege zu weniger Stromkosten`
}

/**
 * B23c-2 — das Kapitel, das die Kaufaussage und die Ladesteuerung trägt.
 *
 * ── ⚠ DER TITEL NENNT SEIT DEM LASTGANG-KAPITEL KEINEN LASTVERLAUF MEHR ───────────────────────
 * Er hiess „Empfehlung und Lastverlauf", solange das Diagramm im Fluss zwischen den beiden
 * Textteilen stand. Seit es ein eigenes Kapitel davor ist (`LOAD_SECTION`), versprach die Agenda
 * einen Lastverlauf auf einer Seite, die keinen zeigt. „Wirtschaftlichkeit" an seiner Stelle
 * benennt, was übrig ist und in beiden Fällen dasteht: Investition, Amortisation, Netto über den
 * Horizont — und den Wert der Ladesteuerung.
 *
 * ⚠ NICHT bloss „Empfehlung": der einzige Kapitelverweis auf dieses Kapitel steht im Satz
 * „…derselben Grösse wie die Kurve darüber und wie die Empfehlung im Kapitel „…""
 * (`comparison.ts`), und der löste dann zu „wie die Empfehlung im Kapitel „Empfehlung"" auf.
 *
 * ⚠ Der Titel wird NIRGENDS ausgeschrieben — Verweise bilden ihn aus `REPORT_SECTIONS`
 * (`layout.ts`). Eine Umbenennung wie diese kostet deshalb keine Textstelle, nur Kommentare und
 * die Erwartungen der Proben.
 *
 * ⚠ Das Kapitel ist eine eigene `<Page>` (D5, Regel 1). Als `<View break>` in der Zusammenfassung
 * bekäme es in der Agenda die Seitenzahl JENES Kapitels — plausibel aussehend und falsch.
 */
export const RECOMMENDATION_SECTION: ReportSection = {
  id: SECTION_ID.recommendation,
  level: 1,
  title: 'Empfehlung und Wirtschaftlichkeit',
}

/**
 * Steht unter der Kapitelüberschrift.
 *
 * ⚠ Er kündigt bewusst NICHT an, was auf der Seite steht („Empfehlung, Ladesteuerung"). Was dort
 * steht, hängt davon ab, was gerechnet werden konnte (s. den Kopf von `recommendation.ts`) — eine
 * feste Ankündigung wäre auf jedem Report falsch, dem eine dieser Aussagen fehlt. Dieselbe Regel
 * wie bei `RESULTS_INTRO`.
 *
 * ⚠ DIE ZWEITE HÄLFTE IST MIT DEM BILD GEGANGEN: sie lautete „und wie sich Ihr Lastgang mit ihm
 * liest" und beschrieb das Diagramm, das jetzt ein eigenes Kapitel davor ist (`LOAD_SECTION`) —
 * ein Vorspann, der ein Bild ankündigt, das auf der Seite nicht mehr steht.
 */
export const RECOMMENDATION_INTRO = 'Welches Gerät — und was es kostet.'

/**
 * B23c-3a — das Kapitel mit dem Kostenvergleich und dem Tages-Energiefluss.
 *
 * ── ⚠ EIN EIGENES KAPITEL UND KEIN ANHANG AN „Empfehlung und Wirtschaftlichkeit" ─────────────
 * Jenes Kapitel beantwortet „welches Gerät und was kostet es"; dieses zeigt, wie sich das über die
 * Zeit auswirkt und wie ein einzelner Tag damit aussieht. Zwei Bilder mehr auf jener Seite hätten
 * sie ohnehin über den Satzspiegel getragen — dann stünde in der Agenda ein Kapitel, dessen
 * grösserer Teil auf einer Seite steht, die sie nicht nennt.
 *
 * ⚠ Eigene `<Page>` (D5, Regel 1). Als `<View break>` im Empfehlungs-Kapitel bekäme es in der
 * Agenda die Seitenzahl JENES Kapitels — plausibel aussehend und falsch.
 *
 * ⚠ Der Titel nennt bewusst weder „Monatsvergleich" noch „Kostenvergleich": welcher der beiden
 * steht, hängt an der Datenlage (`detail.ts`), und ein Titel, der einen davon ankündigt, wäre auf
 * jedem zweiten Report falsch. Dieselbe Regel wie bei den beiden Kapitel-Vorspännen.
 */
export const DETAIL_SECTION: ReportSection = {
  id: SECTION_ID.detail,
  level: 1,
  title: 'Kostenverlauf und ein Tag im Detail',
}

/** Steht unter der Kapitelüberschrift. Sagt, worum es geht, nicht was auf der Seite steht. */
export const DETAIL_INTRO =
  'Wie sich die Zahlen über die Zeit auswirken — und wie ein einzelner Tag damit aussieht.'

/**
 * D7 — der Monatsvergleich „Ist-Tarif vs. aWATTar", als eigenes Kapitel.
 *
 * ── ⚠ EIGENES KAPITEL UND NICHT ANSTELLE DES KOSTENVERLAUFS ───────────────────────────────────
 * Im BESTANDSFALL steht der Monatsvergleich unverändert IM Detail-Kapitel und ersetzt dort den
 * kumulierten Kostenverlauf — für einen Kunden mit Anlage ist die Kauffrage beantwortet, und die
 * offene lautet „was zahle ich am Netz". Ohne Bestandsanlage ist sie NICHT beantwortet: der
 * Kostenverlauf ist dort das Bild zur Kaufaussage und darf nicht weichen. Der Monatsvergleich
 * beantwortet daneben eine zweite Frage („und was zahlte ich mit einem anderen Stromvertrag") und
 * bekommt dafür eine eigene Seite, statt einer der beiden zu verdrängen.
 *
 * ── ⚠ ES GIBT DIESES KAPITEL NUR OHNE BESTANDSANLAGE ──────────────────────────────────────────
 * Zweites bedingtes Kapitel nach dem „Ladeverhalten" (B23c-3b-1) und nach derselben Mechanik: der
 * Aufrufer entscheidet EINMAL (`hasMonthlyChapter`) und gibt die Antwort an Agenda UND Seitenbaum.
 * Im Bestandsfall entsteht es nicht — der Vergleich steht dort schon im Detail-Kapitel, und zweimal
 * dieselben drei Balken im selben Dokument wären eine Wiederholung, die wie zwei Rechnungen aussieht.
 *
 * ⚠ Eigene `<Page>` (D5, Regel 1). Als `<View break>` im Detail-Kapitel bekäme es in der Agenda die
 * Seitenzahl JENES Kapitels — plausibel aussehend und falsch.
 */
export const MONTHLY_SECTION: ReportSection = {
  id: SECTION_ID.monthly,
  level: 1,
  title: 'Ihr Stromtarif im Monatsvergleich',
}

/** Steht unter der Kapitelüberschrift. Sagt, worum es geht, nicht was auf der Seite steht. */
export const MONTHLY_INTRO =
  'Was Sie heute zahlen — und was es mit einem Börsenpreis-Tarif gewesen wäre.'

/**
 * B23c-3b-1 — das Kapitel mit der Stunden-Heatmap und dem Ø-Ladepreis.
 *
 * ── ⚠ ES IST DAS ERSTE KAPITEL, DAS ES NICHT IMMER GIBT ───────────────────────────────────────
 * Beide Bilder hängen an einer Datenlage, die fehlen kann: die Heatmap zeigt nichts, wenn der
 * Speicher im ausgewerteten Zeitraum gar nicht arbeitet, und den Ø-Ladepreis gibt es nur mit einer
 * echten Börsenpreis-Reihe. Im Blocker-Fall trifft beides zusammen (gemessen, s. `insight.ts`) —
 * dann entsteht das Kapitel NICHT, und die Agenda führt es folgerichtig auch nicht. Deshalb ist
 * `REPORT_AGENDA` seit diesem Schritt keine Konstante mehr, sondern `buildReportAgenda(…)`.
 *
 * ⚠ Eigene `<Page>` (D5, Regel 1). Als `<View break>` im Detail-Kapitel bekäme es in der Agenda
 * die Seitenzahl JENES Kapitels — plausibel aussehend und falsch.
 *
 * ⚠ Der Titel nennt bewusst weder „Heatmap" noch „Ladepreis": welches der beiden Bilder steht,
 * hängt an der Datenlage, und ein Titel, der eines davon ankündigt, wäre auf jedem Report falsch,
 * dem es fehlt. Dieselbe Regel wie bei den drei Kapiteln davor.
 */
export const INSIGHT_SECTION: ReportSection = {
  id: SECTION_ID.insight,
  level: 1,
  title: 'Das Ladeverhalten Ihres Speichers',
}

/** Steht unter der Kapitelüberschrift. Sagt, worum es geht, nicht was auf der Seite steht. */
export const INSIGHT_INTRO =
  'Wann Ihr Speicher arbeitet — und was das über seine Steuerung aussagt.'

/**
 * B23c-3b-2 — das Kapitel mit der Grenznutzen-Kurve und der Kandidatentabelle.
 *
 * ── ⚠ EIN KAPITEL FÜR ZWEI EINANDER AUSSCHLIESSENDE FÄLLE ─────────────────────────────────────
 * Im Bestandsfall steht hier die Zusatzspeicher-Frage (Kurve über die Zusatzgeräte, darunter die
 * Tabelle der wirtschaftlichen ODER der Klarsatz), sonst die Katalog-Kurve mit der Tabelle der
 * übrigen Geräte — genau die Verzweigung, die `report.tsx` am Ende der Seite trifft. Zwei eigene
 * Kapitel wären zwei Agenda-Einträge, von denen einer in jedem Dokument ins Leere zeigte.
 *
 * ⚠ Eigene `<Page>` (D5, Regel 1). Als `<View break>` im Ladeverhalten-Kapitel bekäme es in der
 * Agenda die Seitenzahl JENES Kapitels — plausibel aussehend und falsch.
 *
 * ⚠ Der Titel nennt bewusst weder „Zusatzspeicher" noch „Alternativen": welcher der beiden Fälle
 * steht, hängt daran, ob der Kunde bereits einen Speicher hat, und ein Titel, der einen davon
 * ankündigt, wäre auf jedem zweiten Report falsch. Dieselbe Regel wie bei den Kapiteln davor.
 *
 * ⚠ Es ist das ZWEITE bedingte Kapitel (nach `INSIGHT_SECTION`) — es entfällt, wenn es weder
 * Zusatzszenarien noch eine Alternative zur Empfehlung gibt (s. `hasComparisonChapter`).
 */
export const COMPARISON_SECTION: ReportSection = {
  id: SECTION_ID.comparison,
  level: 1,
  title: 'Speichergrösse und Gerätewahl',
}

/** Steht unter der Kapitelüberschrift. Sagt, worum es geht, nicht was auf der Seite steht. */
export const COMPARISON_INTRO =
  'Was jede weitere Kilowattstunde Speicher noch bringt — und wie die Geräte des Katalogs dabei ' +
  'abschneiden.'

/** Steht unter der Kapitelüberschrift — wörtlich wie im CSS-Weg (`print-methodology.tsx`). */
export const METHODOLOGY_INTRO = 'Wie diese Zahlen entstanden sind — und wo ihre Grenzen liegen.'

export const METHODOLOGY_SECTION: ReportSection = {
  id: SECTION_ID.methodology,
  level: 1,
  title: 'Methodik & Vorbehalte',
}

/**
 * B23c-4 — das Schlusskapitel: womit gerechnet wurde, woher die Werte stammen, was an diesem
 * Datensatz zu wissen ist.
 *
 * ── ⚠ ES STEHT NACH DER METHODIK, UND DAS IST EINE ANDERE REIHENFOLGE ALS AM BILDSCHIRM ───────
 * Dort liegt der Annahmen-Schnappschuss VOR dem Methodik-Kapitel und die Datenqualitäts-Box
 * dahinter — die beiden gehören dort zu zwei verschiedenen Stellen der Seite. Auf Papier ist das
 * eine Aussage: die Methodik sagt, WIE gerechnet wurde, dieses Kapitel WOMIT und was dabei fehlte.
 * Sie auseinanderzuziehen hiesse, dem Leser zweimal denselben Gedankengang zuzumuten.
 *
 * ⚠ Eigene `<Page>` (D5, Regel 1). Als `<View break>` im Methodik-Kapitel bekäme es in der Agenda
 * die Seitenzahl JENES Kapitels — plausibel aussehend und falsch.
 *
 * ⚠ Es ist AUSDRÜCKLICH KEIN drittes bedingtes Kapitel: Annahmen, Tarifherkunft und der
 * Schluss-Vorbehalt gibt es in jedem Report. Nur die einzelnen Abschnitte darin entfallen, wenn
 * es sie nicht gibt (Datenqualität ohne Warnungen, der Blocker-Befund ohne Blocker, der
 * Preisstand-Hinweis bei einem abgeschlossenen Kalenderjahr) — `ReportChapterPresence` wächst
 * deshalb nicht.
 */
/**
 * Das Kapitel zwischen der Gerätewahl und der Methodik: was wir dem Kunden raten, und worauf sich
 * das stützt — nach dem Vorbild von Seite 11 des Urbanz-Zielbildes.
 *
 * ⚠ ES STAND BIS ZUM 22.09.2026 HINTER DER METHODIK und steht jetzt davor: ein Vorschlag ist eine
 * Aussage an den Kunden, die Methodik und das Schlusskapitel sind der Apparat dahinter. Hinter dem
 * Apparat gelesen wirkte der Vorschlag wie ein Nachtrag zu den Vorbehalten.
 *
 * ⚠ DER TITEL IST NICHT „Unsere Empfehlung", OBWOHL DAS DIE NAHELIEGENDE WAHL WÄRE: das Dokument
 * führt bereits ein Kapitel „Empfehlung und Wirtschaftlichkeit" (`RECOMMENDATION_SECTION`), und
 * dessen Kaufaussage heisst im Katalogfall wörtlich „Unsere Empfehlung: <Gerät>". Zwei
 * Agenda-Einträge mit demselben Wort beantworteten für den Leser zwei verschiedene Fragen unter
 * einem Namen — hier geht es um den WEG, dort um das GERÄT.
 *
 * ⚠ Bedingtes Kapitel: es steht nur, wenn es einen zutreffenden Vorschlag ODER eine belegte
 * Herkunftsangabe gibt (`hasAdviceChapter`, `advice.ts`). Ohne beides wäre es eine Seite, die nur
 * sagt, dass sie leer ist (D14).
 */
export const ADVICE_SECTION: ReportSection = {
  id: SECTION_ID.advice,
  level: 1,
  title: 'Unser Vorschlag',
}

/** Steht unter der Kapitelüberschrift. Sagt, worum es geht, nicht was auf der Seite steht. */
export const ADVICE_INTRO =
  'Was wir Ihnen raten — und worauf sich die Zahlen stützen, die dahinterstehen.'

export const BASIS_SECTION: ReportSection = {
  id: SECTION_ID.basis,
  level: 1,
  title: 'Annahmen und Datengrundlage',
}

/** Die Kennung eines Kapitels — die Werte von `SECTION_ID`. */
export type ReportSectionKey = (typeof SECTION_ID)[keyof typeof SECTION_ID]

/**
 * Die Unterabschnitte je Kapitel, das welche führt — die Grundlage der eingerückten Agenda-Einträge.
 *
 * ── ⚠ EINE LISTE, ZWEI KONSUMENTEN — UND DIE LISTE GEHÖRT DEM KAPITEL ─────────────────────────
 * Die Einträge kommen aus DERSELBEN Aufzählung, aus der das Kapitel seine Abschnitte rendert:
 * `METHODOLOGY_ITEMS` für die Methodik, `basisSubsections(chapter)` für das Schlusskapitel. Eine
 * zweite, eigens gepflegte Liste fürs Inhaltsverzeichnis ist genau die Fehlerklasse, an der die
 * Berechnungsmethodik schon einmal auseinandergelaufen ist: zwei Orte, die synchron bleiben
 * mussten, und niemand sieht es dem Blatt an, wenn sie es nicht mehr sind.
 *
 * ⚠ Ein Kapitel, das hier nicht vorkommt, bekommt keine Unterpunkte — `buildReportAgenda` kennt
 * keinen Kapitelnamen und braucht für ein drittes solches Kapitel keine Zeile.
 *
 * ⚠ Die Einträge MÜSSEN `level: 2` tragen: daran hängt, dass sie eingerückt und OHNE Seitenzahl
 * stehen (`sectionHasPageNumber`, `page-numbers.ts` Aufbau C).
 */
export type ChapterSubsections = Partial<Record<ReportSectionKey, readonly ReportSection[]>>

/**
 * Die acht Kapitel, über ihre Kennung erreichbar.
 *
 * ⚠ Stufe D bildet daraus die Ortsangabe „im Kapitel „X"" (`layout.ts`) — und zwar nach DEMSELBEN
 * Muster, mit dem `RESULTS_FOOTNOTE` schon heute seinen Kapitelnamen bildet (`${METHODOLOGY_SECTION.title}`
 * statt eines Literals). Das war bis Stufe D der EINZIGE aufgelöste Kapitelverweis im ganzen
 * Dokument; die Bausteine schrieben den Titel aus (`comparison.ts`, damals „Empfehlung und
 * Lastverlauf").
 */
export const REPORT_SECTIONS: Record<ReportSectionKey, ReportSection> = {
  [SECTION_ID.results]: RESULTS_SECTION,
  [SECTION_ID.prerequisites]: PREREQUISITES_SECTION,
  [SECTION_ID.load]: LOAD_SECTION,
  [SECTION_ID.ways]: WAYS_SECTION,
  [SECTION_ID.annualScenario]: ANNUAL_SCENARIO_SECTION,
  [SECTION_ID.pvValue]: PV_VALUE_SECTION,
  [SECTION_ID.recommendation]: RECOMMENDATION_SECTION,
  [SECTION_ID.detail]: DETAIL_SECTION,
  [SECTION_ID.monthly]: MONTHLY_SECTION,
  [SECTION_ID.insight]: INSIGHT_SECTION,
  [SECTION_ID.comparison]: COMPARISON_SECTION,
  [SECTION_ID.methodology]: METHODOLOGY_SECTION,
  [SECTION_ID.advice]: ADVICE_SECTION,
  [SECTION_ID.basis]: BASIS_SECTION,
}

/** Steht unter der Kapitelüberschrift. Sagt, worum es geht, nicht was auf der Seite steht. */
export const BASIS_INTRO =
  'Womit gerechnet wurde, woher die Tarifwerte stammen — und was an diesem Datensatz zu wissen ist.'

/**
 * Ersetzt seit PR #298 den vollen Preisstand-Satz an der Tarifkomponenten-Tabelle im Schlusskapitel
 * — derselbe Zeiger wie `RESULTS_FOOTNOTE` (`${…SECTION.title}` statt eines Literals).
 *
 * ⚠ Der volle Satz (`tariffVintageNote`, `derive.ts`) steht seit dem Kapitel „Voraussetzungen"
 * bereits prominent dort, als eigener Hinweiskasten samt Netzkosten-/Abgaben-Zusatz. Ihn hier ein
 * zweites Mal auszuschreiben wäre dieselbe Verwechslung, vor der `RESULTS_FOOTNOTE` schon warnt:
 * derselbe Vorbehalt in zwei Schärfen im selben Dokument. Die BEDINGUNG bleibt unverändert
 * (`chapter.tariffVintage`, `basis.ts`) — nur der TEXT, der bei einem Treffer steht.
 */
export const BASIS_TARIFF_VINTAGE_FOOTNOTE = `Details zum Preisstand dieser Tarifsätze stehen im Kapitel „${PREREQUISITES_SECTION.title}".`

/**
 * Der Vorbehalt, der auf dem Deckblatt UND am Schluss steht.
 *
 * ── ⚠ EINE DEFINITION, ZWEI KONSUMENTEN — und die Doppelung im Dokument ist Absicht ───────────
 * Der CSS-Weg trägt ihn ebenso zweimal (`print-cover.tsx` und der Schlussabsatz in `report.tsx`),
 * und der Grund ist derselbe: ein weitergereichter Report wird von beiden Enden gelesen. Wer die
 * Zahlen sucht, schlägt vorne auf; wer nach der Grundlage fragt, hinten.
 *
 * ⚠ Er steht deshalb HIER und nicht zweimal ausgeschrieben. Zwei Fassungen desselben Vorbehalts
 * im selben Dokument — der Bildschirm hat wörtlich zwei, die sich um ein „Die" unterscheiden —
 * lesen sich wie zwei verschiedene Einschränkungen. Es ist ein Vorbehalt und keine Zahl (D16):
 * dass er zweimal steht, ist richtig; dass er zweimal ANDERS stünde, wäre es nicht.
 *
 * Nicht verhandelbar (CLAUDE.md): keine ROI-Zahl als „echt", bevor gegen einen echten Lastgang
 * und eine echte Netzrechnung validiert wurde.
 */
export const REPORT_DISCLAIMER =
  'Demo-Berechnung mit Beispieldaten. Die Zahlen sind noch nicht gegen einen echten Lastgang und ' +
  'eine echte Netzrechnung validiert.'

/** Welche BEDINGTEN Kapitel dieses Dokument trägt. */
export type ReportChapterPresence = {
  /**
   * `true` = das Kapitel „Zwei Wege zu weniger Stromkosten" steht — s. `hasWaysChapter` (`ways.ts`).
   * `false` ohne berechenbaren Monatsvergleich (dieselbe Bedingung wie die Spanne der
   * Zusammenfassung).
   */
  ways: boolean
  /**
   * Wie viele Wege das Kapitel führt (D7-Revision) — die Agenda trägt damit denselben gezählten
   * Titel wie die Kapitelüberschrift. `0`, wenn es das Kapitel nicht gibt.
   */
  waysCount: number
  /**
   * `true` = das Kapitel „Was wäre, wenn wir ein ganzes Jahr hätten?" steht — s.
   * `hasAnnualScenarioChapter` (`annual-scenario.ts`). `false` bei einem Lastgang über ein volles
   * Jahr und immer dann, wenn die Hochrechnung nicht gebildet werden konnte.
   */
  annualScenario: boolean
  /**
   * `true` = das Kapitel „Ihre PV-Anlage" steht — s. `hasPvValueChapter` (`pv-value.ts`). `false`
   * ohne bestehende Anlage, bei gemessener Einspeisung und immer dann, wenn die Rekonstruktion
   * nicht gebildet werden konnte.
   */
  pvValue: boolean
  /**
   * `true` = das Kapitel „Kostenverlauf und ein Tag im Detail" steht.
   *
   * ⚠ K3b-2: Es ist das letzte Kapitel, das diese Auswahlschicht noch nicht kannte — es stand
   * IMMER. Solange es Kandidaten gibt, trägt es auch immer mindestens den Kostenvergleich; ohne
   * Speicher blieben nur seine beiden Ersatzsätze übrig, und einer davon sprach von „dem zugrunde
   * gelegten Speicher". Die Bedingung liest den bereits gebauten `detailPlan` (`context.ts`) und
   * formuliert nichts zweitmalig.
   */
  detail: boolean
  /**
   * `false` = das Kapitel „Empfehlung und Wirtschaftlichkeit" entfällt — s.
   * `hasRecommendationChapter` (`recommendation.ts`). Der Fall entsteht ausschliesslich mit
   * Bestandsanlage, deren Gerätewahl „Nein" sagt: die Kaufaussage widerspräche dort dem Verdikt
   * zwei Kapitel weiter.
   */
  recommendation: boolean
  /**
   * `true` = der Monatsvergleich steht als eigenes Kapitel — s. `hasMonthlyChapter` (`detail.ts`).
   * Im Bestandsfall `false`: dort steht er im Detail-Kapitel an der Stelle des Kostenverlaufs.
   */
  monthly: boolean
  /** `false` = weder Heatmap noch Ø-Ladepreis entstehen — s. `insight.ts`. */
  insight: boolean
  /**
   * `false` = es gibt weder ein Zusatzszenario noch eine Alternative zur Empfehlung — s.
   * `comparison.ts`. Mit dem heutigen Katalog tritt der Fall nicht ein; er ist trotzdem geführt,
   * weil ein leeres Kapitel eine Seitenzahl verspricht, hinter der nichts steht.
   */
  comparison: boolean
  /**
   * `true` = das Kapitel „Unser Vorschlag" steht — s. `hasAdviceChapter` (`advice.ts`). `false`,
   * wenn weder ein Vorschlag zutrifft noch eine Herkunftsangabe belegt ist. Seine Stelle ist VOR
   * der Methodik (22.09.2026).
   */
  advice: boolean
}

/**
 * Die Agenda in Dokumentreihenfolge.
 *
 * ⚠ Sie führt AUSSCHLIESSLICH Abschnitte, die tatsächlich gerendert werden. Ein Eintrag für ein
 * Kapitel, das es in diesem Dokument nicht gibt, wäre ein Verweis ins Leere — und die Zahl daneben
 * bliebe leer, weil kein Sentinel sie je meldet.
 *
 * ⚠ B23c-3b-1: DESHALB EINE FUNKTION UND KEINE KONSTANTE. Bis hierher gab es jedes Kapitel in
 * jedem Dokument, und die Liste konnte fest stehen. Das „Ladeverhalten"-Kapitel entsteht nur, wenn
 * wenigstens eines seiner beiden Bilder entsteht — im Blocker-Fall keines. Der Aufrufer
 * (`document.tsx`) bildet die Entscheidung EINMAL und gibt sie an Agenda UND Seitenbaum; zwei
 * getrennte Auswertungen ergäben einen Eintrag ohne Kapitel oder ein Kapitel ohne Eintrag.
 */
export function buildReportAgenda(
  presence: ReportChapterPresence,
  subsections: ChapterSubsections = {},
): readonly ReportSection[] {
  const chapters: readonly ReportSection[] = [
    RESULTS_SECTION,
    PREREQUISITES_SECTION,
    LOAD_SECTION,
    ...(presence.ways
      ? [{ ...WAYS_SECTION, title: waysSectionTitle(presence.waysCount) }]
      : []),
    ...(presence.annualScenario ? [ANNUAL_SCENARIO_SECTION] : []),
    ...(presence.pvValue ? [PV_VALUE_SECTION] : []),
    ...(presence.recommendation ? [RECOMMENDATION_SECTION] : []),
    ...(presence.detail ? [DETAIL_SECTION] : []),
    ...(presence.monthly ? [MONTHLY_SECTION] : []),
    ...(presence.insight ? [INSIGHT_SECTION] : []),
    ...(presence.comparison ? [COMPARISON_SECTION] : []),
    ...(presence.advice ? [ADVICE_SECTION] : []),
    METHODOLOGY_SECTION,
    BASIS_SECTION,
  ]

  /*
   * ⚠ HIER STEHT KEIN KAPITELNAME. Die Einrückung entsteht daraus, dass ein Kapitel Unterabschnitte
   * MELDET — nicht daraus, dass diese Funktion weiss, welche Kapitel welche haben. Ein künftiges
   * drittes Kapitel mit Unterabschnitten meldet sie genauso und braucht hier keine Zeile.
   */
  return chapters.flatMap((chapter) => [
    chapter,
    ...(subsections[chapter.id as ReportSectionKey] ?? []),
  ])
}

/**
 * Was unter der Kapitelüberschrift steht.
 *
 * ⚠ Der Satz kündigt bewusst NICHT an, was auf der Seite steht („Ersparnis, Empfehlung, …"). Was
 * dort steht, hängt davon ab, was gerechnet werden konnte (s. den Kopf von `summary.ts`) — eine
 * feste Ankündigung wäre auf jedem Report falsch, dem eine dieser Aussagen fehlt.
 */
export const RESULTS_INTRO = 'Die Zahlen, um die es geht — und was sie für Sie bedeuten.'

/**
 * Steht als Fussnote am Fuss der Zusammenfassung.
 *
 * ⚠ Er verweist auf das Methodik-Kapitel und wiederholt dessen Inhalt NICHT. Die Vorbehalte stehen
 * an einer Stelle; sie hier zu paraphrasieren hiesse, denselben Vorbehalt in zwei Schärfen in
 * dasselbe Dokument zu setzen — genau das, wogegen `lib/report-copy.ts` angelegt wurde.
 *
 * ⚠ DIE NETTO-ANGABE STAND HIER UND STEHT JETZT AN DER KOPFZAHL (`buildSummaryKpis`): als
 * Seitenfussnote las sie sich wie ein Kleingedrucktes zum ganzen Blatt, obwohl sie eine Eigenschaft
 * der zwei Zahlen darüber ist. Durchgerechnet wird weiterhin netto — das sagt `limitations` im
 * Schlusskapitel für den ganzen Report.
 */
export const RESULTS_FOOTNOTE =
  'Wie diese Zahlen entstanden sind und wo ihre Grenzen liegen, ' +
  `steht im Kapitel „${METHODOLOGY_SECTION.title}".`
