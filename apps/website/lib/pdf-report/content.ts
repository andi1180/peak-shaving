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
  methodology: 'methodik',
} as const

export const RESULTS_SECTION: ReportSection = {
  id: SECTION_ID.results,
  level: 1,
  title: 'Kernergebnisse',
}

/** Steht unter der Kapitelüberschrift — wörtlich wie im CSS-Weg (`print-methodology.tsx`). */
export const METHODOLOGY_INTRO =
  'Wie diese Zahlen entstanden sind — und wo ihre Grenzen liegen.'

export const METHODOLOGY_SECTION: ReportSection = {
  id: SECTION_ID.methodology,
  level: 1,
  title: 'Methodik & Vorbehalte',
}

/**
 * Die Agenda in Dokumentreihenfolge.
 *
 * ⚠ Sie führt AUSSCHLIESSLICH Abschnitte, die tatsächlich gerendert werden. Ein Eintrag für ein
 * Kapitel, das es noch nicht gibt, wäre ein Verweis ins Leere — und die Seitenzahl daneben eine
 * Zahl, die nichts bezeichnet. Die Liste wächst mit B23c, nicht vorher.
 */
export const REPORT_AGENDA: readonly ReportSection[] = [
  RESULTS_SECTION,
  METHODOLOGY_SECTION,
  ...METHODOLOGY_ITEMS,
]

/** Was die Platzhalter-Seite sagt, solange die Kennzahlen noch im CSS-Weg leben (B23c). */
export const RESULTS_PLACEHOLDER_BODY =
  'Die Kennzahlen, Grafiken und die Speicherempfehlung stehen in dieser Fassung des Dokuments ' +
  'noch nicht. Sie werden in einem eigenen Schritt aus dem bestehenden Report übernommen; bis ' +
  'dahin ist die vollständige Auswertung der Report am Bildschirm und dessen Ausdruck.'
