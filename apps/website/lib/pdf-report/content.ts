import { HINDSIGHT_NOTE } from '@/lib/report-copy'

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
 * ⚠ Genau EINE Ausnahme davon, und sie ist die wichtige: der Hindsight-Hinweis (§6.2, Pflicht) wird
 * NICHT abgeschrieben, sondern aus `lib/report-copy.ts` importiert. Er steht am Bildschirm an der
 * Ersparnis-Aufschlüsselung, im CSS-Druck im Methodik-Kapitel und ab jetzt zusätzlich hier — drei
 * Konsumenten, ein Wortlaut. Eine dritte Abschrift wäre die Drift, gegen die diese Konstante
 * überhaupt angelegt wurde.
 */

/** Ein Eintrag der Agenda UND zugleich ein Abschnitt im Dokument. */
export type ReportSection = {
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
      'anschliessend aufgeschlüsselt — nie getrennt gerechnet und addiert. Die Teilbeträge in der ' +
      'Empfehlung ergeben zusammen genau die ausgewiesene Gesamtersparnis, keine Kilowattstunde ' +
      'zählt doppelt.',
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
    id: 'methodik-bestmarke',
    level: 2,
    title: 'Bestmarke, nicht Alltagsbetrieb',
    /* §6.2-Pflichthinweis — importiert, nicht abgeschrieben. S. Kopf. */
    body: HINDSIGHT_NOTE,
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

/** Kapitel-Kennungen, damit die Dokument-Bausteine sie nicht als Zeichenkette ausschreiben. */
export const SECTION_ID = {
  results: 'kernergebnisse',
  recommendation: 'empfehlung',
  detail: 'kostenverlauf',
  insight: 'ladeverhalten',
  comparison: 'geraetewahl',
  methodology: 'methodik',
} as const

export const RESULTS_SECTION: ReportSection = {
  id: SECTION_ID.results,
  level: 1,
  title: 'Kernergebnisse',
}

/**
 * B23c-2 — das Kapitel, das die Kaufaussage, das Lastgang-Diagramm und die Ladesteuerung trägt.
 *
 * ── ⚠ EIN KAPITEL UND NICHT ZWEI, UND DER GRUND IST DAS BILD ──────────────────────────────────
 * Das Diagramm steht IM FLUSS zwischen den beiden Textteilen: es ist der Beleg für die
 * Kapp-Schwelle, von der die Empfehlung darüber lebt, und der Anschauungsgegenstand für die
 * Ladesteuerung darunter. Als eigene `<Page>` dazwischen wäre es ein Kapitel ohne Aussage; hinter
 * beiden Texten wäre es ein Anhang. Die Agenda führt deshalb EINEN Eintrag — der Titel nennt
 * beides, damit ein Leser, der die Agenda überfliegt, weiss, wo die Empfehlung steht.
 *
 * ⚠ Das Kapitel ist eine eigene `<Page>` (D5, Regel 1). Als `<View break>` im Kernergebnis-Kapitel
 * bekäme es in der Agenda die Seitenzahl JENES Kapitels — plausibel aussehend und falsch.
 */
export const RECOMMENDATION_SECTION: ReportSection = {
  id: SECTION_ID.recommendation,
  level: 1,
  title: 'Empfehlung und Lastverlauf',
}

/**
 * Steht unter der Kapitelüberschrift.
 *
 * ⚠ Er kündigt bewusst NICHT an, was auf der Seite steht („Empfehlung, Diagramm, Ladesteuerung").
 * Was dort steht, hängt davon ab, was gerechnet werden konnte (s. den Kopf von
 * `recommendation.ts`) — eine feste Ankündigung wäre auf jedem Report falsch, dem eine dieser
 * Aussagen fehlt. Dieselbe Regel wie bei `RESULTS_INTRO`.
 */
export const RECOMMENDATION_INTRO =
  'Welches Gerät, was es kostet — und wie sich Ihr Lastgang mit ihm liest.'

/**
 * B23c-3a — das Kapitel mit dem Kostenvergleich und dem Tages-Energiefluss.
 *
 * ── ⚠ EIN EIGENES KAPITEL UND KEIN ANHANG AN „Empfehlung und Lastverlauf" ─────────────────────
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
export const METHODOLOGY_INTRO =
  'Wie diese Zahlen entstanden sind — und wo ihre Grenzen liegen.'

export const METHODOLOGY_SECTION: ReportSection = {
  id: SECTION_ID.methodology,
  level: 1,
  title: 'Methodik & Vorbehalte',
}

/** Welche BEDINGTEN Kapitel dieses Dokument trägt. */
export type ReportChapterPresence = {
  /** `false` = weder Heatmap noch Ø-Ladepreis entstehen — s. `insight.ts`. */
  insight: boolean
  /**
   * `false` = es gibt weder ein Zusatzszenario noch eine Alternative zur Empfehlung — s.
   * `comparison.ts`. Mit dem heutigen Katalog tritt der Fall nicht ein; er ist trotzdem geführt,
   * weil ein leeres Kapitel eine Seitenzahl verspricht, hinter der nichts steht.
   */
  comparison: boolean
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
): readonly ReportSection[] {
  return [
    RESULTS_SECTION,
    RECOMMENDATION_SECTION,
    DETAIL_SECTION,
    ...(presence.insight ? [INSIGHT_SECTION] : []),
    ...(presence.comparison ? [COMPARISON_SECTION] : []),
    METHODOLOGY_SECTION,
    ...METHODOLOGY_ITEMS,
  ]
}

/**
 * B23c-1 — was unter der Kapitelüberschrift steht.
 *
 * Bis zu diesem Schritt stand hier eine ausdrücklich gekennzeichnete PLATZHALTER-Seite
 * (`RESULTS_PLACEHOLDER_BODY`, B23a). Sie ist ersatzlos entfallen: das Kapitel trägt jetzt die
 * gerechneten Zahlen (`summary.ts`). Die Abschnitts-Kennung (`SECTION_ID.results`), der Titel und
 * die Stellung in `REPORT_AGENDA` sind dabei UNVERÄNDERT geblieben — der Agenda-Eintrag zeigt auf
 * denselben Abschnitt wie vorher, nur ist dessen Inhalt jetzt echt.
 *
 * ⚠ Der Satz kündigt bewusst NICHT an, was auf der Seite steht („Ersparnis, Empfehlung, …"). Was
 * dort steht, hängt davon ab, was gerechnet werden konnte (s. den Kopf von `summary.ts`) — eine
 * feste Ankündigung wäre auf jedem Report falsch, dem eine dieser Aussagen fehlt.
 */
export const RESULTS_INTRO = 'Die Zahlen, um die es geht — und wie sie zueinander stehen.'

/**
 * Steht als Fussnote unter den Kernaussagen.
 *
 * ⚠ Er verweist auf das Methodik-Kapitel und wiederholt dessen Inhalt NICHT. Die Vorbehalte stehen
 * an einer Stelle; sie hier zu paraphrasieren hiesse, denselben Vorbehalt in zwei Schärfen in
 * dasselbe Dokument zu setzen — genau das, wogegen `lib/report-copy.ts` angelegt wurde.
 */
export const RESULTS_FOOTNOTE =
  'Alle Beträge netto (ohne USt.). Wie diese Zahlen entstanden sind und wo ihre Grenzen liegen, ' +
  `steht im Kapitel „${METHODOLOGY_SECTION.title}".`
