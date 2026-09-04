/**
 * B23c-2 — die Darstellungsform einer Kernaussage, geteilt von allen Kapitel-Ableitungen.
 *
 * ── ⚠ WARUM DIESE DREI TYPEN AUS `summary.ts` HERAUSGEWANDERT SIND ─────────────────────────────
 * Bis B23c-1 gab es genau EINE Ableitung (die Executive Summary), und die Typen konnten dort
 * wohnen. Mit B23c-2 kommt eine zweite hinzu (`recommendation.ts`), und `document.tsx` rendert
 * beide durch DIESELBEN Bausteine. Zwei strukturgleiche Typdefinitionen wären die Sorte Doppelung,
 * die man erst bemerkt, wenn eine der beiden ein Feld bekommt und der Renderer es nur für die eine
 * Hälfte zeigt.
 *
 * Es ist ausdrücklich eine DARSTELLUNGS-Form und kein fachlicher Typ: was in einer Aussage steht,
 * entscheidet die jeweilige Ableitung; wie es aussieht, entscheidet `document.tsx`. Deshalb sind
 * alle Werte hier FERTIG formatierte Zeichenketten — die Rundung fällt in der Ableitung, an einer
 * Stelle, und nicht verstreut im JSX.
 */

/** Farbe ist Information, kein Dekor (DESIGN.md) — s. `PDF_COLORS` in `theme.ts`. */
export type ReportTone = 'positive' | 'warning' | 'neutral'

/**
 * Was unter einem Bild steht: die Bildunterschrift und, wo es etwas zu sagen gibt, ein leiserer
 * Zusatz.
 *
 * ⚠ Steht seit B23c-3b-1 hier und nicht mehr in `detail.ts`: es gibt jetzt zwei Kapitel mit
 * Bildern (`detail.ts`, `insight.ts`), und `document.tsx` rendert beide durch DENSELBEN Baustein
 * (`ChartFigure`). Zwei strukturgleiche Typdefinitionen wären genau die Doppelung, die man erst
 * bemerkt, wenn eine der beiden ein Feld bekommt und der Renderer es nur für die eine Hälfte zeigt
 * — dieselbe Überlegung, aus der `ReportStatement` in B23c-2 hierher gewandert ist.
 */
export type ReportFigure = {
  caption: string
  /** Steht unter der Bildunterschrift, wo es etwas zu sagen gibt. */
  note: string | null
}

/** Eine Zeile einer Aufschlüsselung. */
export type ReportRow = {
  label: string
  /** Zweite, kleinere Zeile unter der Beschriftung. Fehlt, wo die Beschriftung für sich steht. */
  hint?: string
  value: string
  tone: ReportTone
  /** `true` = Abschlusszeile der Aufschlüsselung (abgesetzt, halbfett). */
  total?: boolean
}

/**
 * Eine Kernaussage: Überschrift, optional die eine grosse Zahl, optional eine Aufschlüsselung,
 * und der Satz, ohne den ein Leser die Zahl falsch verwendet.
 *
 * ⚠ `amount` ist `null`-fähig, weil es Aussagen gibt, die KEINE Zahl tragen — der
 * Zusatzspeicher-Klarsatz („lohnt sich derzeit nicht") ist eine davon. Eine erfundene 0 an dieser
 * Stelle wäre eine Zahl, die etwas anderes behauptet als der Satz darunter.
 */
export type ReportStatement = {
  /** Stabil — zur Wiedererkennung in Prüfläufen, nicht im Dokument sichtbar. */
  id: string
  title: string
  amount: { value: string; caption: string; tone: Exclude<ReportTone, 'neutral'> } | null
  rows: ReportRow[]
  body: string
  /**
   * Kurze Zusatzsätze unter dem Fliesstext — je Eintrag eine Zeile.
   *
   * ⚠ Dafür da, dass die §3.8-WARNUNGEN eines Kandidaten (Betonsockel, separater Wechselrichter,
   * „Leistung reicht nicht für alle Spitzen") sichtbar bleiben statt in einem Absatz zu
   * verschwinden. Sie sind Kosten- und Eignungsaussagen und gehören neben die Investition, nicht
   * hinter sie. Leer oder fehlend heisst: es gibt keine — nicht „wir zeigen sie hier nicht".
   */
  notes?: string[]
}

/**
 * B23c-3b-2 — eine kompakte Vergleichstabelle mehrerer Kandidaten.
 *
 * ── ⚠ WARUM EINE TABELLE UND NICHT DIE EMPFEHLUNGSKARTE JE KANDIDAT ───────────────────────────
 * Am Bildschirm zeigt die Alternativen-Aufklappliste je Gerät eine volle `RecommendationCard` —
 * mit Aufschlüsselung, Hindsight-Vorbehalt und Warnungen. Auf Papier wäre das für fünf Kandidaten
 * ein halbes Dutzend Seiten, auf denen sich derselbe Vorbehalt fünfmal wiederholt und die eine
 * Frage, um die es geht („welches Gerät ist besser?"), zwischen den Wiederholungen verschwindet.
 * Eine Tabelle beantwortet genau diese Frage: sechs Grössen nebeneinander, in einer Zeile je Gerät.
 *
 * ⚠ Es ist ausdrücklich eine DARSTELLUNGS-Form wie `ReportRow`: die Zellen sind FERTIG formatierte
 * Zeichenketten, die Rundung fällt in der Ableitung. `document.tsx` weiss deshalb nicht, welche
 * Tabelle es rendert — und es gibt nur EINE Rendering-Stelle für beide Konsumenten
 * (Zusatzgeräte im Bestandsfall, Katalog-Alternativen sonst).
 */
export type ReportTableColumn = {
  label: string
  /**
   * Relatives Breitengewicht (`flexGrow`), nicht pt.
   *
   * ⚠ Absolute Breiten stünden hier falsch: die Satzbreite ist eine Eigenschaft des Layouts
   * (`PDF_CONTENT_WIDTH_PT`), und eine zweite, hier abgeschriebene Aufteilung liefe beim nächsten
   * Randwechsel von ihr weg. Was die Ableitung weiss, ist das VERHÄLTNIS: ein Gerätename braucht
   * mehr Platz als eine Jahreszahl.
   */
  width: number
  /** Zahlen rechtsbündig — sonst stehen die Beträge einer Spalte nicht untereinander. */
  align?: 'right'
}

export type ReportTableRow = {
  /** Stabil (die Batterie-Kennung) — Reihenfolge und Wiedererkennung in Prüfläufen. */
  key: string
  /** Genau so viele Einträge wie `columns`, in derselben Reihenfolge. */
  cells: string[]
}

export type ReportTable = {
  columns: ReportTableColumn[]
  rows: ReportTableRow[]
}

/**
 * B23c-4 — ein Hinweis: eine Feststellung ÜBER die Zahlen, nicht eine von ihnen.
 *
 * ── ⚠ WARUM DAS KEIN `ReportStatement` IST ────────────────────────────────────────────────────
 * Eine Kernaussage trägt eine Zahl und schlüsselt sie auf; ein Hinweis sagt, was an der Grundlage
 * dieser Zahlen zu wissen ist — er hat keinen Betrag, und einen erfundenen zu ergänzen (etwa eine
 * 0) wäre genau die Zahl, gegen die er warnt. Am Bildschirm sind das `Alert`-Kästen und keine
 * Karten; die Trennung ist also nicht hier erfunden, sondern übernommen.
 *
 * ⚠ `tone` kennt bewusst kein `positive`: ein Hinweis meldet entweder einen Mangel an der
 * Datengrundlage (`warning`) oder eine Eigenschaft, die man kennen muss (`neutral`). „Positiv"
 * gibt es an dieser Stelle nicht — eine grüne Meldung neben der Kern-Kennzahl läse sich wie ein
 * Gütesiegel.
 */
export type ReportNotice = {
  /** Stabil — zur Wiedererkennung in Prüfläufen, nicht im Dokument sichtbar. */
  id: string
  tone: Exclude<ReportTone, 'positive'>
  title: string
  /** Der eine Absatz, der die Feststellung trägt. */
  body: string
  /**
   * Eine Aufzählung darunter (betroffene Zeitbereiche, Datenqualitäts-Warnungen der Engine).
   * `null` heisst: es gibt keine — nicht „wir zeigen sie hier nicht".
   */
  list: { label: string | null; items: string[] } | null
  /**
   * Was der Leser daraus machen kann, und was davon NICHT betroffen ist — je Eintrag ein Absatz.
   *
   * Leer heisst: die Feststellung steht für sich. Bewusst eine LISTE und kein einzelner Satz: der
   * Blocker-Befund trägt zwei Absätze, die Verschiedenes sagen (was zu tun ist, und was unberührt
   * bleibt), und sie in einen zu ziehen liesse den zweiten als Nachsatz des ersten lesen.
   */
  hints: string[]
}
