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
  results: 'zusammenfassung',
  prerequisites: 'voraussetzungen',
  load: 'lastgang',
  recommendation: 'empfehlung',
  detail: 'kostenverlauf',
  monthly: 'monatsvergleich',
  insight: 'ladeverhalten',
  comparison: 'geraetewahl',
  methodology: 'methodik',
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
 * B23c-2 — das Kapitel, das die Kaufaussage, das Lastgang-Diagramm und die Ladesteuerung trägt.
 *
 * ── ⚠ EIN KAPITEL UND NICHT ZWEI, UND DER GRUND IST DAS BILD ──────────────────────────────────
 * Das Diagramm steht IM FLUSS zwischen den beiden Textteilen: es ist der Beleg für die
 * Kapp-Schwelle, von der die Empfehlung darüber lebt, und der Anschauungsgegenstand für die
 * Ladesteuerung darunter. Als eigene `<Page>` dazwischen wäre es ein Kapitel ohne Aussage; hinter
 * beiden Texten wäre es ein Anhang. Die Agenda führt deshalb EINEN Eintrag — der Titel nennt
 * beides, damit ein Leser, der die Agenda überfliegt, weiss, wo die Empfehlung steht.
 *
 * ⚠ Das Kapitel ist eine eigene `<Page>` (D5, Regel 1). Als `<View break>` in der Zusammenfassung
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
export const BASIS_SECTION: ReportSection = {
  id: SECTION_ID.basis,
  level: 1,
  title: 'Annahmen und Datengrundlage',
}

/** Die Kennung eines Kapitels — die Werte von `SECTION_ID`. */
export type ReportSectionKey = (typeof SECTION_ID)[keyof typeof SECTION_ID]

/**
 * Die acht Kapitel, über ihre Kennung erreichbar.
 *
 * ⚠ Stufe D bildet daraus die Ortsangabe „im Kapitel „X"" (`layout.ts`) — und zwar nach DEMSELBEN
 * Muster, mit dem `RESULTS_FOOTNOTE` schon heute seinen Kapitelnamen bildet (`${METHODOLOGY_SECTION.title}`
 * statt eines Literals). Das war bis Stufe D der EINZIGE aufgelöste Kapitelverweis im ganzen
 * Dokument; die Bausteine schrieben den Titel aus (`comparison.ts`, „Empfehlung und Lastverlauf").
 */
export const REPORT_SECTIONS: Record<ReportSectionKey, ReportSection> = {
  [SECTION_ID.results]: RESULTS_SECTION,
  [SECTION_ID.prerequisites]: PREREQUISITES_SECTION,
  [SECTION_ID.load]: LOAD_SECTION,
  [SECTION_ID.recommendation]: RECOMMENDATION_SECTION,
  [SECTION_ID.detail]: DETAIL_SECTION,
  [SECTION_ID.monthly]: MONTHLY_SECTION,
  [SECTION_ID.insight]: INSIGHT_SECTION,
  [SECTION_ID.comparison]: COMPARISON_SECTION,
  [SECTION_ID.methodology]: METHODOLOGY_SECTION,
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
export function buildReportAgenda(presence: ReportChapterPresence): readonly ReportSection[] {
  return [
    RESULTS_SECTION,
    PREREQUISITES_SECTION,
    LOAD_SECTION,
    RECOMMENDATION_SECTION,
    DETAIL_SECTION,
    ...(presence.monthly ? [MONTHLY_SECTION] : []),
    ...(presence.insight ? [INSIGHT_SECTION] : []),
    ...(presence.comparison ? [COMPARISON_SECTION] : []),
    METHODOLOGY_SECTION,
    ...METHODOLOGY_ITEMS,
    BASIS_SECTION,
  ]
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
