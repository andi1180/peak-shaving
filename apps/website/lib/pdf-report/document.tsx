import type { ReactNode } from 'react'
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { reportSectionEnabled, type ReportOptionalSection } from 'shared'

import { PRINT_COMPANY, REPORT_CONTACT } from '@/lib/company'
import type { ReportChartRasters } from './charts'
import { fitRasterToWidth, type ChartRaster } from './chart-raster'
import {
  BASIS_INTRO,
  BASIS_SECTION,
  BASIS_TARIFF_VINTAGE_FOOTNOTE,
  buildReportAgenda,
  COMPARISON_INTRO,
  COMPARISON_SECTION,
  DETAIL_INTRO,
  DETAIL_SECTION,
  INSIGHT_INTRO,
  INSIGHT_SECTION,
  LOAD_INTRO,
  LOAD_SECTION,
  METHODOLOGY_INTRO,
  METHODOLOGY_ITEMS,
  METHODOLOGY_SECTION,
  MONTHLY_INTRO,
  MONTHLY_SECTION,
  PREREQUISITES_INTRO,
  PREREQUISITES_SECTION,
  RECOMMENDATION_INTRO,
  RECOMMENDATION_SECTION,
  REPORT_DISCLAIMER,
  RESULTS_FOOTNOTE,
  RESULTS_INTRO,
  RESULTS_SECTION,
  WAYS_INTRO,
  WAYS_SECTION,
  waysSectionTitle,
  type ReportSection,
} from './content'
import { buildBasisChapter, DATA_SOURCES_TABLE_ID, TARIFF_COMPONENTS_TABLE_ID } from './basis'
import { buildComparisonChapter, CANDIDATE_TABLE_ID } from './comparison'
import type { ReportBuildContext } from './context'
import { buildDetailChapter, buildMonthlyChapter } from './detail'
import { loadChartCaption } from './derive'
import { buildInsightChapter } from './insight'
import { buildPrerequisitesChapter } from './prerequisites'
import { buildRecommendationChapter } from './recommendation'
import type { ReportBaukastenId, ReportBaukastenRegistry } from './registry'
import { buildWaysChapter } from './ways'
import {
  resolveReportSegments,
  resolveReportText,
  type ReportLayout,
  type ReportTextSegment,
} from './report-text'
import {
  recordSectionPage,
  recordTotalPages,
  sectionHasPageNumber,
  type AgendaPageNumbers,
  type PageNumberSink,
} from './page-numbers'
import {
  statementPoints,
  type ReportAmountTone,
  type ReportNotice,
  type ReportRow,
  type ReportStatement,
  type ReportTable,
  type ReportTone,
} from './statement'
import { ADDON_ID, buildReportSummary } from './summary'
import { chartCellColor, PDF_COLORS, PDF_CONTENT_WIDTH_PT, PDF_LAYOUT, PDF_TYPE } from './theme'
import type { PdfReportInput } from './types'

/**
 * B23a — das Dokumentgerüst des neuen PDF-Reports: Deckblatt, Kopf-/Fusszeile mit Seitenzahl,
 * Agenda mit Seitenverweisen, Methodik-Kapitel.
 *
 * ── ⚠ DIESER WEG IST NICHT LIVE, UND DAS IST DER ZUSTAND, DEN DIESE PR HERSTELLT ───────────────
 * Der einzige Export, den ein Kunde erreicht, ist unverändert `window.print()` gegen das
 * Print-Stylesheet (`step-result.tsx`, `print-cover.tsx`, `print-frame.tsx`,
 * `print-methodology.tsx`, Delta 16a/16b). Diese Datei hat dort keinen Aufrufer; erreichbar ist sie
 * ausschliesslich über die unverlinkte Prüfroute `/pdf-report-probe`. Umgeschaltet wird erst, wenn
 * der neue Weg inhaltlich vollständig ist (B23c) — vorher wäre der Report ein Rückschritt: Deckblatt
 * und Methodik ohne Kennzahlen, Grafiken und Empfehlung.
 *
 * ── ⚠ EINE `<Page>` JE KAPITEL — DAS IST KEINE GESTALTUNG, SONDERN DIE BEDINGUNG DER AGENDA ────
 * Gemessen (`page-numbers.ts`, Kopf): Kapitel per Seitenumbruch INNERHALB einer Seite melden alle
 * die Seitenzahl, auf der jene Seite begann. Wer hier ein Kapitel als `<View break>` ergänzt,
 * bekommt in der Agenda eine plausibel aussehende, falsche Zahl — ohne Fehlermeldung.
 *
 * ── DER TEXT IST DERSELBE WIE IM CSS-WEG, ABSICHTLICH DOPPELT ──────────────────────────────────
 * Die Methodik-Punkte stehen als DATEN in `content.ts` und sind von `print-methodology.tsx` wörtlich
 * übernommen; der Hindsight-Hinweis (§6.2, Pflicht) wird aus `lib/report-copy.ts` IMPORTIERT und
 * nicht abgeschrieben. Solange beide Wege nebeneinander stehen, ist die Doppelung des übrigen Textes
 * bewusst — beim Cutover fällt der CSS-Weg samt Doppelung weg.
 *
 * ── DIE FARBEN SIND HEX, UND ES GIBT DAFÜR KEINE WAHL ──────────────────────────────────────────
 * react-pdf kennt weder CSS-Variablen noch `color-mix()` (Spike §2.1, „Falle 1": ein
 * `var(--color-accent)` löst hier nicht auf, und zwar ohne Fehlermeldung). Alle Werte stehen an
 * genau einer Stelle in `theme.ts`, je als wörtliche Abschrift des gleichnamigen Tokens aus
 * `app/globals.css`.
 */

/**
 * ⚠ DER ZEILENABSTAND MUSS AN JEDER TEXTFORM EINZELN STEHEN — gemessen am 06.09.2026, und der
 * Befund erklärt, warum der Fliesstext bis hierher doppelt gesetzt aussah.
 *
 * `@react-pdf/renderer` 4.9.0 vererbt `lineHeight` NICHT von einem `<View>` an ein `<Text>` darin.
 * `fontSize`, `color` und `fontFamily` erbt es sehr wohl — genau deshalb sah der bisherige
 * `body: { lineHeight: 1.45 }` auf dem Kapitel-Wrapper aus, als täte er etwas. Er tat NICHTS: am
 * gerenderten PDF nachgemessen lagen die Zeilen eines Absatzes **22,2 pt** auseinander, bei 9,5 pt
 * Schrift also beim Faktor **2,34** — das ist der Vorgabewert aus den Metriken der eingebetteten
 * Inter-WOFF, nicht 1,45. Die Gegenprobe steht daneben: `coverTitle` (`lineHeight: 1.18`, direkt am
 * `<Text>`) misst 1,18, `outroLead` (1,35) misst 1,33.
 *
 * ⚠ UND ER DARF TROTZDEM NICHT AUF DIE `<Page>` — dort würde er zwar vererbt, löscht aber die
 * fixierte Fusszeile (s. die Warnung an `styles.page`). Zwischen „vererbt nicht" und „löscht die
 * Fusszeile" bleibt genau ein Weg: jede Textform trägt ihn selbst.
 *
 * ⚠ UND ER WIRKT NUR ZUSAMMEN MIT EINEM `fontSize` IM SELBEN STYLE-OBJEKT — zweiter gemessener
 * Befund desselben Tages, und er hat den ersten Anlauf zur Hälfte wirkungslos gemacht. `footnote`
 * (eigenes `fontSize: small`) sprang sofort auf 1,25; `statementBody` (Schriftgrad von der `<Page>`
 * geerbt) blieb bei **2,37** — mit identischem `lineHeight` im selben Stylesheet. react-pdf
 * multipliziert den Faktor offenbar gegen den Schriftgrad, den es im aufgelösten Style FINDET, und
 * ein bloss geerbter zählt dafür nicht.
 *
 * Deshalb trägt diese Konstante BEIDES. Sie steht als erste Eigenschaft jeder Textform; wo ein
 * anderer Grad gilt, überschreibt ihn das `fontSize` DANACH im selben Objekt.
 *
 * ⚠ AUSGENOMMEN SIND KOPF- UND FUSSZEILE. Sie sind einzeilig, und ein `lineHeight` im Teilbaum
 * eines `fixed`-Elements mit `render`-Prop ist die Falle von oben.
 */
const LEADING = { fontSize: PDF_TYPE.body, lineHeight: PDF_TYPE.lineHeight } as const

const styles = StyleSheet.create({
  /*
   * ⚠ HIER STEHT BEWUSST KEIN `lineHeight` — und das ist der teuerste gemessene Befund dieses
   * Abschnitts. `@react-pdf/renderer` 4.9.0 (03.09.2026, `renderToBuffer`, Textextraktion über
   * pdfjs): erbt ein Element mit `render`-Prop einen `lineHeight`, verschwindet das GESAMTE
   * `fixed`-Element, zu dem es gehört, spurlos aus dem Dokument — ohne Fehler, ohne Warnung, und
   * der Rückruf läuft trotzdem (die Gesamtseitenzahl kam im Sink an, während im PDF weder
   * Fusszeile noch Seitenzähler standen).
   *
   * Gemessene Matrix: `lineHeight` auf der Page + statischer Text → rendert · `lineHeight` auf der
   * Page + `render`-Text → Fusszeile WEG · `lineHeight` nur auf der Fusszeile → WEG · gar kein
   * `lineHeight` → rendert. Der Zeilenabstand liegt deshalb auf den INHALTS-Wrappern
   * (`styles.body`, `styles.coverBody`); Kopf- und Fusszeile sind deren Geschwister und erben ihn
   * nicht.
   *
   * ⚠ WER HIER EIN `lineHeight` ERGÄNZT, LÖSCHT DIE FUSSZEILE — auf jeder Seite, unbemerkt.
   */
  page: {
    fontFamily: PDF_TYPE.family,
    fontSize: PDF_TYPE.body,
    color: PDF_COLORS.text,
    paddingTop: PDF_LAYOUT.pageTop,
    paddingBottom: PDF_LAYOUT.pageBottom,
    paddingLeft: PDF_LAYOUT.pageHorizontal,
    paddingRight: PDF_LAYOUT.pageHorizontal,
  },

  /* Kopfzeile — im oberen Seitenrand, absolut positioniert, auf JEDER Seite (`fixed`). */
  header: {
    position: 'absolute',
    top: PDF_LAYOUT.headerTop,
    left: PDF_LAYOUT.pageHorizontal,
    right: PDF_LAYOUT.pageHorizontal,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  headerMarkSpacer: { width: 5 },
  /* Die zweite Hälfte der Wortmarke. Ein eigener `Text`, weil react-pdf keine Teilfärbung
     innerhalb eines Knotens kennt — der Zeilenfluss trägt die beiden trotzdem zusammen. */
  headerWordmarkAccent: {
    fontSize: PDF_TYPE.small,
    fontWeight: 600,
    color: PDF_COLORS.accent,
    letterSpacing: 0.6,
  },
  /* Dokumenttitel am rechten Kopfzeilenrand — was der Leser in der Hand hält, auf jedem Blatt. */
  headerDoc: {
    ...LEADING,
    flexGrow: 1,
    textAlign: 'right',
    fontSize: PDF_TYPE.small,
    color: PDF_COLORS.textMuted,
  },
  headerMark: { width: 13, height: 13 },
  headerWordmark: {
    fontSize: PDF_TYPE.small,
    fontWeight: 600,
    color: PDF_COLORS.navy,
    letterSpacing: 0.6,
  },
  /**
   * ⚠ D15 Block 1, Punkt 7: 2 pt Navy → 1,6 pt Akzent. Der Navy-Balken war so schwer wie die
   * Wortmarke darüber und las sich als Rahmen des Blattes statt als deren Unterkante.
   */
  headerBar: { marginTop: 4, height: 1.6, backgroundColor: PDF_COLORS.accent },

  /* Fusszeile — im unteren Seitenrand, auf JEDER Seite. */
  footer: {
    position: 'absolute',
    bottom: PDF_LAYOUT.footerBottom,
    left: PDF_LAYOUT.pageHorizontal,
    right: PDF_LAYOUT.pageHorizontal,
    borderTopWidth: 0.7,
    borderTopColor: PDF_COLORS.border,
    paddingTop: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: PDF_TYPE.footer,
    color: PDF_COLORS.textMuted,
  },
  footerRight: { flexDirection: 'row', gap: 4 },

  /*
   * Der Kapitel-Wrapper. Er trägt bewusst KEINEN `lineHeight` mehr — er würde nicht vererbt
   * (s. `LEADING` oben) und stünde hier als Zeile, die etwas zu tun scheint und nichts tut.
   */
  body: {},

  h2: { ...LEADING, fontSize: PDF_TYPE.h2, fontWeight: 700, color: PDF_COLORS.ink },
  lead: { ...LEADING, marginTop: 3, fontSize: PDF_TYPE.body, color: PDF_COLORS.textMuted },

  /*
   * ── Deck- und Abschlussseite: vollflächig Navy ────────────────────────────────────────────────
   *
   * ⚠ AUCH HIER KEIN `lineHeight` — dieselbe Falle wie an `styles.page`. Diese zwei Seiten tragen
   * zwar keine `fixed`-Elemente mehr (s. `Cover`/`Outro`), aber die Regel gilt für JEDE `<Page>`:
   * wer hier später eine Fusszeile ergänzt und den Zeilenabstand oben stehen lässt, löscht sie
   * wieder — spurlos und ohne Fehlermeldung.
   *
   * `backgroundColor` auf der `<Page>` färbt die volle Seite einschliesslich der Ränder; ein
   * eingelegter View könnte das nicht (er säße im Satzspiegel und liesse einen weissen Rahmen).
   */
  navyPage: {
    fontFamily: PDF_TYPE.family,
    fontSize: PDF_TYPE.body,
    color: PDF_COLORS.onNavy,
    backgroundColor: PDF_COLORS.navy,
    paddingTop: 52,
    paddingBottom: 52,
    paddingLeft: PDF_LAYOUT.pageHorizontal,
    paddingRight: PDF_LAYOUT.pageHorizontal,
  },

  /*
   * Die Wortmarke oben auf Navy — das Gegenstück zur Kopfzeile der Inhaltsseiten, nur grösser.
   *
   * ⚠ DAS EMBLEM SITZT AUF EINER WEISSEN KACHEL, und das ist kein Dekor: seine eigene Fläche ist
   * gemessen `#112555` und damit fast dieselbe Farbe wie `navy` (#18336f). Direkt aufgelegt löste
   * sich seine Kontur auf, und übrig blieben schwebende weisse Striche. Die Kachel macht daraus
   * eine Bildmarke mit Rand.
   */
  navyLockup: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  navyTile: {
    width: 64,
    height: 64,
    backgroundColor: PDF_COLORS.onNavy,
    borderRadius: 12,
    padding: 7,
  },
  navyMark: { width: '100%', height: '100%' },
  navyWordmark: {
    ...LEADING,
    fontSize: 17,
    fontWeight: 700,
    color: PDF_COLORS.onNavy,
    letterSpacing: 1.6,
  },
  navyWordmarkSub: {
    ...LEADING,
    marginTop: 3,
    fontSize: PDF_TYPE.small,
    color: PDF_COLORS.onNavyMuted,
    letterSpacing: 0.6,
  },

  /* Deckblatt */
  coverBody: { flexGrow: 1, justifyContent: 'center' },
  /** Der schmale Akzentstrich über dem Titel — die einzige Farbe neben Weiss auf dieser Seite. */
  coverRule: { width: 54, height: 3, backgroundColor: PDF_COLORS.accentOnNavy, marginBottom: 18 },
  coverTitle: {
    fontSize: PDF_TYPE.cover,
    fontWeight: 700,
    color: PDF_COLORS.onNavy,
    lineHeight: 1.18,
  },
  coverSubtitle: {
    marginTop: 10,
    fontSize: PDF_TYPE.coverSub,
    color: PDF_COLORS.onNavyMuted,
    lineHeight: 1.35,
  },
  coverCustomer: {
    marginTop: 34,
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: PDF_COLORS.accentOnNavy,
  },
  coverCustomerLabel: {
    ...LEADING,
    fontSize: PDF_TYPE.small,
    fontWeight: 600,
    color: PDF_COLORS.accentOnNavy,
    letterSpacing: 1.2,
  },
  coverCompany: {
    ...LEADING,
    marginTop: 5,
    fontSize: 13,
    fontWeight: 600,
    color: PDF_COLORS.onNavy,
  },
  coverName: { ...LEADING, marginTop: 2, fontSize: PDF_TYPE.body, color: PDF_COLORS.onNavy },
  /** Der Adressblock als GANZES bekommt den Abstand — die Zeilen darin stehen zusammen. */
  coverAddressBlock: { marginTop: 7 },
  coverAddress: { ...LEADING, fontSize: PDF_TYPE.body, color: PDF_COLORS.onNavyMuted },
  /**
   * ⚠ D15 Block 1, Punkt 2: die Trennlinie der navyfarbenen Seiten ist `navyRule` und nicht mehr
   * `onNavyMuted`. Sie hatte damit exakt die Farbe des Textes, den sie trennt — eine Linie, die so
   * laut ist wie ihr Inhalt, trennt nichts, sie kommt dazu. `navyRule` ist aufgehelltes Navy und
   * bleibt hinter beiden Textfarben zurück.
   *
   * Gilt für BEIDE navyfarbenen Seiten (hier und `outroFoot`): es ist dasselbe Element an
   * derselben Stelle, und zwei Fassungen davon wären der Unterschied, den niemand beabsichtigt
   * und jeder sieht (s. `NavyLockup`).
   */
  coverMeta: {
    marginTop: 34,
    paddingTop: 14,
    borderTopWidth: 0.5,
    borderTopColor: PDF_COLORS.navyRule,
  },
  coverMetaRow: { flexDirection: 'row', marginBottom: 4 },
  coverMetaLabel: { ...LEADING, width: 150, color: PDF_COLORS.onNavyMuted },
  coverMetaValue: { ...LEADING, fontWeight: 600, color: PDF_COLORS.onNavy },

  /* Abschlussseite (Outro) */
  outroBody: { flexGrow: 1, justifyContent: 'center' },
  outroHeadline: { fontSize: 20, fontWeight: 700, color: PDF_COLORS.onNavy, lineHeight: 1.25 },
  outroLead: {
    marginTop: 10,
    fontSize: PDF_TYPE.coverSub,
    color: PDF_COLORS.onNavyMuted,
    lineHeight: 1.35,
  },
  outroContact: {
    marginTop: 30,
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: PDF_COLORS.accentOnNavy,
  },
  outroLabel: {
    ...LEADING,
    fontSize: PDF_TYPE.small,
    fontWeight: 600,
    color: PDF_COLORS.accentOnNavy,
    letterSpacing: 1.2,
  },
  outroPerson: {
    ...LEADING,
    marginTop: 5,
    fontSize: 13,
    fontWeight: 600,
    color: PDF_COLORS.onNavy,
  },
  outroRole: { ...LEADING, fontSize: PDF_TYPE.body, color: PDF_COLORS.onNavyMuted },
  /** Telefon und E-Mail stehen als BLOCK unter Name und Rolle — s. `coverAddressBlock`. */
  outroLines: { marginTop: 7 },
  outroLine: { ...LEADING, color: PDF_COLORS.onNavy },
  /* Dieselbe Trennlinie wie `coverMeta` — s. die Begründung dort. */
  outroFoot: {
    marginTop: 34,
    paddingTop: 14,
    borderTopWidth: 0.5,
    borderTopColor: PDF_COLORS.navyRule,
  },
  outroFootLine: { ...LEADING, fontSize: PDF_TYPE.small, color: PDF_COLORS.onNavyMuted },

  /* Agenda */
  agendaList: { marginTop: 16 },
  agendaChapter: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: 12,
    paddingBottom: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: PDF_COLORS.border,
  },
  agendaChapterLabel: { ...LEADING, flexGrow: 1, fontWeight: 600, color: PDF_COLORS.ink },
  /* ⚠ FESTE BREITE, EINZEILIG — s. `measurementsAgree` in `page-numbers.ts`. */
  agendaPageCell: { ...LEADING, width: 28, textAlign: 'right', color: PDF_COLORS.textMuted },
  agendaItem: { ...LEADING, marginTop: 4, marginLeft: 14, color: PDF_COLORS.textMuted },
  agendaHint: { ...LEADING, marginTop: 20, fontSize: PDF_TYPE.small, color: PDF_COLORS.textMuted },

  /* Kapitel-Inhalte */
  itemList: { marginTop: 14 },
  item: { marginBottom: 11 },
  /* D9 — dieselben Bausteine eine Ebene tiefer: die Liste steht INNERHALB eines Blocks mit
     eigener Überschrift und braucht deshalb weniger Luft nach oben als ein Kapitel-Aufmacher. */
  methodList: { marginTop: 6 },
  methodItem: { marginBottom: 8 },
  itemTitle: { ...LEADING, fontSize: PDF_TYPE.h3, fontWeight: 600, color: PDF_COLORS.ink },
  itemBody: { ...LEADING, marginTop: 1, color: PDF_COLORS.text },
  /**
   * Die zwei Kopfzahlen der Zusammenfassung.
   *
   * ⚠ D15 Block 1, Punkt 6: Kasten und Rahmen sind weg, die Zahl steht frei und trägt statt
   * dessen eine Hairline unter sich. Ein Kasten um die wichtigste Zahl des Dokuments macht sie
   * zu einer Notiz am Rand; die grösste Zahl auf dem Blatt braucht keine Umrandung, um gefunden
   * zu werden.
   *
   * ⚠ ZWEI ZELLEN AUCH BEI EINER ZAHL: die zweite bleibt leer, statt die erste über die ganze
   * Breite zu ziehen. Ein Betrag in 27 pt über 500 pt Satzbreite sieht aus wie eine Überschrift,
   * und die Seite verlöre die Form, an der man sie wiedererkennt.
   */
  headline: {
    marginTop: 14,
    paddingBottom: 12,
    borderBottomWidth: 0.8,
    borderBottomColor: PDF_COLORS.border,
    flexDirection: 'row',
    gap: 24,
  },
  headlineCell: { flexGrow: 1, flexBasis: 0 },
  headlineValue: { ...LEADING, fontSize: 27, fontWeight: 700, color: PDF_COLORS.ink },
  /**
   * Die Ersparnis-Spanne im Akzent.
   *
   * ⚠ FARBE IST HIER INFORMATION (DESIGN.md): `ink` steht für das, was heute gezahlt wird, der
   * Akzent für das, was sich sparen liesse. Ausdrücklich NICHT `positive` — die drei semantischen
   * Töne gehören zu Beträgen INNERHALB einer Aufschlüsselung (`TONE_COLOR`); hier stehen zwei
   * Grössen nebeneinander, von denen keine „richtig" oder „falsch" ist.
   */
  headlineValueAccent: { ...LEADING, fontSize: 27, fontWeight: 700, color: PDF_COLORS.accent },
  headlineCaption: {
    ...LEADING,
    marginTop: 2,
    fontSize: PDF_TYPE.small,
    color: PDF_COLORS.textMuted,
  },
  /**
   * Der Fliesstext der Zusammenfassung.
   *
   * ⚠ KEIN `statementBody`: der trägt den Abstand einer Aussage zu IHRER Kopfzahl (6 pt) und stünde
   * hier zu eng unter der Hairline. Und ausdrücklich kein Titel darüber — der Absatz IST die Seite
   * und nicht ein Baustein darauf.
   */
  summaryProse: { ...LEADING, marginTop: 14, color: PDF_COLORS.text },

  statement: { marginTop: 14 },
  /**
   * Der erledigte Nebenstrang (B3-2b) — dieselbe Kastenform wie `notice`, in Teal.
   *
   * ⚠ ES IST DIE FORM DES HINWEISKASTENS UND KEINE ZWEITE DANEBEN: Fläche plus 2,6 pt Kante
   * links, gemessen am Zielbild (S. 2/6/8: `#f0fdfa`, Kante `#0f766e`). Eine eigene Kastenform
   * für dieselbe Rolle liesse den Leser einen Unterschied vermuten, den es nicht gibt — dieselbe
   * Überlegung, aus der `figureMissing` und `notice` sich die Form teilen.
   *
   * ⚠ `marginTop` bleibt das der Aussage (14): der Kasten steht in der Reihe der Kernaussagen und
   * nicht als Anhang darunter.
   */
  statementAside: {
    padding: 10,
    borderLeftWidth: 2.6,
    borderLeftColor: PDF_COLORS.accent,
    backgroundColor: PDF_COLORS.accentSubtle,
  },
  statementTitle: { ...LEADING, fontSize: PDF_TYPE.h3, fontWeight: 600, color: PDF_COLORS.ink },
  /**
   * Das Verdikt (B3-2a) — Frage und Antwort, beide einen Grad über ihrer sonstigen Form.
   *
   * ⚠ Die ÜBERSCHRIFT steht auf `h2` und nicht auf `h3`: sie ist die FRAGE, auf die das Wort
   * darunter antwortet, und auf Bausteingrösse gesetzt läse sie sich als eine Zwischenüberschrift
   * von acht. Das Zielbild setzt sie mit 14 pt fett (S. 10, gemessen).
   *
   * ⚠ Das WORT nimmt den Grad der Kopfzahlen (27 pt, wie `headlineValue`) und ihre Kostenfarbe.
   * Es ist kein zweiter Grad daneben — die Antwort auf die Kernfrage eines Kapitels wiegt so viel
   * wie eine Kernzahl, und genau das sagt der gemeinsame Grad.
   */
  verdictTitle: { ...LEADING, fontSize: PDF_TYPE.h2, fontWeight: 700, color: PDF_COLORS.ink },
  verdictWord: {
    ...LEADING,
    marginTop: 6,
    fontSize: 27,
    fontWeight: 700,
    color: PDF_COLORS.negative,
  },
  statementAmountRow: { marginTop: 3, flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  statementAmount: { ...LEADING, fontSize: 15, fontWeight: 700 },
  statementAmountCaption: { ...LEADING, fontSize: PDF_TYPE.small, color: PDF_COLORS.textMuted },
  statementBody: { ...LEADING, marginTop: 6, color: PDF_COLORS.text },

  rowList: { marginTop: 5 },
  /**
   * Eine Zeile der Aufschlüsselung.
   *
   * ⚠ D15 Block 1, Punkt 5: Zebra und eine Mindesthöhe. Ohne beides zerfiel ein Streifen aus
   * fünf Zeilen optisch in fünf einzelne Absätze — die Hairline allein bindet sie nicht. Die
   * Mindesthöhe ist bewusst eine UNTERgrenze und keine feste Höhe: eine Zeile mit
   * Hinweis-Unterzeile muss weiterhin wachsen dürfen.
   */
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 18,
    paddingTop: 3.5,
    paddingBottom: 3.5,
    paddingLeft: 6,
    paddingRight: 6,
    borderTopWidth: 0.5,
    borderTopColor: PDF_COLORS.border,
  },
  /* Jede zweite Zeile. Derselbe Ton wie bei den Tabellen — ein Streifenmuster im Blatt. */
  rowZebra: { backgroundColor: PDF_COLORS.surfaceAlt },
  rowTotal: { borderTopWidth: 1, borderTopColor: PDF_COLORS.border },
  rowLabelCell: { flexGrow: 1, flexBasis: 0 },
  rowLabel: { ...LEADING, color: PDF_COLORS.text },
  rowLabelTotal: { ...LEADING, fontWeight: 600, color: PDF_COLORS.ink },
  rowHint: { ...LEADING, fontSize: PDF_TYPE.small, color: PDF_COLORS.textMuted },
  rowValue: { ...LEADING, fontWeight: 600 },

  statementNote: { ...LEADING, marginTop: 2, fontSize: PDF_TYPE.small, color: PDF_COLORS.warning },

  /*
   * B3-3 (20a) — die nummerierte Liste. Am Zielbild gemessen (S. 11): Ziffer in `accent` und fett
   * am linken Satzrand, der Text 25,5 pt weiter rechts, zwischen zwei Punkten 11,9 pt Luft. Die
   * 13 pt der Ziffer sind ihr eigener Grad und keiner der Textstufen — sie ist eine Marke am Rand
   * und keine Überschrift.
   */
  pointList: { marginTop: 6 },
  point: { flexDirection: 'row' },
  /*
   * Der Abstand zum Punkt davor. Das Zielbild setzt 11,9 pt auf einen Durchschuss von 14,4 pt
   * (0,83 Zeilen); bei unseren engeren 11,9 pt Zeilenhöhe sind das 9,9.
   */
  pointGap: { marginTop: 10 },
  pointNumber: {
    width: 25.5,
    fontSize: 13,
    /* Der Durchschuss des Fliesstexts statt des eigenen: sonst steht die Ziffer in einer 16,3 pt
       hohen Zeile und ihre Grundlinie 3 pt unter der ersten Textzeile daneben. */
    lineHeight: (PDF_TYPE.body * PDF_TYPE.lineHeight) / 13,
    fontWeight: 700,
    color: PDF_COLORS.accent,
  },
  pointBody: { flexGrow: 1, flexBasis: 0 },
  /*
   * B3-4 — die Leadzeile eines Punkts. Sie nimmt `PDF_TYPE.h3` und ist damit grad- und
   * gewichtsgleich mit `statementTitle`: ein Punkt ist eine Gliederungsstufe des Bausteins, und
   * ein eigener Grad daneben wäre eine vierte Stufe für dieselbe Aufgabe. Ein neuer Token ist
   * deshalb nicht angelegt.
   */
  pointTitle: { ...LEADING, fontSize: PDF_TYPE.h3, fontWeight: 600, color: PDF_COLORS.ink },
  pointText: { ...LEADING, color: PDF_COLORS.text },

  /*
   * Vergleichstabelle (B23c-3b-2).
   *
   * ⚠ EINE Stufe kleiner als der Fliesstext (`small`, 8,5 pt): sechs Spalten in 499 pt Satzbreite
   * tragen bei 9,5 pt nicht ohne Umbruch, und eine Tabelle, in der die Hälfte der Zellen zweizeilig
   * wird, ist keine Tabelle mehr. Der Fliesstext daneben bleibt unverändert.
   */
  table: { marginTop: 8 },
  /**
   * ⚠ D15 Block 1, Punkt 4: der Kopf ist eine gefüllte Navy-Fläche mit weisser Schrift statt
   * einer Zeile mit Unterstrich. Bei acht Zeilen und drei Spalten war vorher nicht auf einen
   * Blick zu sehen, wo die Tabelle anfängt — die Kopfzeile sah aus wie ihre erste Datenzeile.
   */
  tableHeader: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: PDF_COLORS.ink,
    paddingTop: 3.5,
    paddingBottom: 3.5,
    paddingLeft: 6,
    paddingRight: 6,
  },
  tableRow: {
    flexDirection: 'row',
    gap: 6,
    paddingTop: 3,
    paddingBottom: 3,
    paddingLeft: 6,
    paddingRight: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: PDF_COLORS.border,
  },
  /* Jede zweite DATENzeile — Gruppenzeilen zählen nicht mit, s. `StatementTable`. */
  tableRowZebra: { backgroundColor: PDF_COLORS.surfaceAlt },
  tableHeaderCell: {
    ...LEADING,
    fontSize: PDF_TYPE.small,
    fontWeight: 600,
    color: PDF_COLORS.onNavy,
  },
  tableCell: { ...LEADING, fontSize: PDF_TYPE.small, color: PDF_COLORS.text },
  /* D9 — Gruppenüberschrift in der Datenquellen-Tabelle: abgesetzt, ohne Zeilentrenner darunter. */
  tableGroupRow: { paddingTop: 6, paddingBottom: 2, paddingLeft: 6, paddingRight: 6 },
  tableGroupLabel: {
    ...LEADING,
    fontSize: PDF_TYPE.small,
    fontWeight: 600,
    color: PDF_COLORS.ink,
  },

  /* Chart im Fluss (B23c-2) — bewusst KEIN Rahmen und KEIN Kasten, s. `ChartFigure`. */
  figure: { marginTop: 14 },
  /*
   * Legende eines Bildes (B23c-3b-1) — NATIV, nicht als Teil des Rasters.
   *
   * ⚠ Die Farben kommen aus `PDF_COLORS` und sind damit dieselben, die im Bild stehen: die
   * Heatmap zeichnet mit `var(--color-accent)`/`var(--color-ink)`, und `theme.ts` führt beide als
   * wörtliche Abschrift derselben Tokens. Eine hier neu gewählte Farbe wäre eine Legende, die eine
   * andere Grafik beschreibt als die daneben.
   */
  legend: { marginTop: 5, flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendSwatch: { width: 8, height: 8, borderRadius: 1.5 },
  /* Die Farbleiste der Heatmap — eine Zeile, Enden beschriftet, Null in der Mitte. */
  scale: { flexDirection: 'row', alignItems: 'center', gap: 5, width: '100%' },
  scaleEnd: { ...LEADING, fontSize: PDF_TYPE.small, color: PDF_COLORS.textMuted },
  scaleBar: { flexDirection: 'row', flexGrow: 1, height: 6 },
  scaleStep: { flexGrow: 1, flexBasis: 0, height: 6 },
  legendLabel: { ...LEADING, fontSize: PDF_TYPE.small, color: PDF_COLORS.textMuted },
  figureCaption: {
    ...LEADING,
    marginTop: 4,
    fontSize: PDF_TYPE.small,
    color: PDF_COLORS.textMuted,
  },
  figureStatement: { ...LEADING, marginTop: 4, color: PDF_COLORS.text },
  figureMissing: {
    ...LEADING,
    marginTop: 14,
    padding: 10,
    borderLeftWidth: 2,
    borderLeftColor: PDF_COLORS.warning,
    backgroundColor: PDF_COLORS.surfaceAlt,
    fontSize: PDF_TYPE.small,
    color: PDF_COLORS.textMuted,
  },

  /*
   * Ein Hinweis (B23c-4) — ein Kasten mit farbiger Kante links.
   *
   * ⚠ DIESELBE FORM WIE `figureMissing`, und das ist Absicht: beides sind Aussagen ÜBER die
   * Zahlen und nicht welche von ihnen. Eine zweite Kastenform für dieselbe Rolle liesse den Leser
   * einen Unterschied vermuten, den es nicht gibt. Die Kantenfarbe trägt den Ton (`warning` =
   * Mangel an der Datengrundlage, `neutral` = eine Eigenschaft, die man kennen muss) — Farbe ist
   * Information, kein Dekor (DESIGN.md).
   */
  /**
   * Der Hinweiskasten.
   *
   * ⚠ D15 Block 1, Punkt 3: die Fläche hängt jetzt am Ton (`NOTICE_SURFACE`) und ist nicht mehr
   * für alle gleich, die Kante ist von 2 auf 2,6 pt gewachsen. Vorher trugen Warnung und
   * Feststellung dieselbe graue Fläche und unterschieden sich allein in einer 2 pt breiten
   * Kante — auf einem Blatt mit vier Kästen war der warnende nicht als solcher zu finden.
   * `backgroundColor` steht deshalb NICHT mehr hier, sondern wird je Kasten gesetzt.
   */
  notice: {
    marginTop: 12,
    padding: 10,
    borderLeftWidth: 2.6,
  },
  noticeTitle: {
    ...LEADING,
    fontSize: PDF_TYPE.noticeTitle,
    fontWeight: 600,
    color: PDF_COLORS.ink,
  },
  noticeBody: { ...LEADING, marginTop: 5, color: PDF_COLORS.text },
  noticeListLabel: {
    ...LEADING,
    marginTop: 5,
    fontSize: PDF_TYPE.small,
    fontWeight: 600,
    color: PDF_COLORS.ink,
  },
  noticeListItem: { ...LEADING, marginTop: 1, color: PDF_COLORS.text },
  noticeHint: { ...LEADING, marginTop: 5, color: PDF_COLORS.text },

  /*
   * Die zwei Schlussabsätze des Reports (Tarifherkunft, Preisstand) und der Vorbehalt.
   *
   * ⚠ Kleiner und leiser als der Fliesstext — wortgleich zur Rolle am Bildschirm
   * (`text-xs text-text-muted`): es sind Herkunftsangaben, keine Aussagen über das Ergebnis. Sie
   * stehen trotzdem im Dokument und nicht in einer Fussnote: ohne sie ist eine später archivierte
   * Baseline nicht mehr einzuordnen.
   */
  provenance: { ...LEADING, marginTop: 10, fontSize: PDF_TYPE.small, color: PDF_COLORS.textMuted },

  footnote: {
    ...LEADING,
    marginTop: 16,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: PDF_COLORS.border,
    fontSize: PDF_TYPE.small,
    color: PDF_COLORS.textMuted,
  },

  anchor: { height: 0 },
})

/**
 * Der Sentinel, mit dem der erste Durchlauf misst, auf welcher Seite ein Kapitel beginnt.
 *
 * Er rendert NICHTS (`render` gibt `null` zurück, Höhe 0) und ist ausdrücklich NICHT `fixed` — ein
 * fixiertes Element wiederholt sich auf jeder Seite und meldete dann zuletzt die letzte statt der
 * ersten. Position innerhalb der Seite ist gleichgültig: gemessen meldet jedes nicht-fixierte
 * Element die Seite, auf der SEINE `<Page>` begann (`page-numbers.ts`, Aufbau C) — genau die
 * Grösse, die die Agenda braucht.
 */
function SectionAnchor({ id, sink }: { id: string; sink: PageNumberSink }) {
  return (
    <Text
      style={styles.anchor}
      render={({ pageNumber }) => {
        recordSectionPage(sink, id, pageNumber)
        return null
      }}
    />
  )
}

/** Kopf- und Fusszeile. Auf JEDER Seite, das Deckblatt eingeschlossen. */
function PageFurniture({ sink, docLabel }: { sink: PageNumberSink; docLabel: string | null }) {
  return (
    <>
      <View style={styles.header} fixed>
        <View style={styles.headerRow}>
          {/*
            Die BESTEHENDE Emblem-Datei aus `public/brand/` — dieselbe, die der CSS-Druck benutzt,
            kein zweites Bild. react-pdf holt sie beim ersten Erzeugen per `fetch` von der EIGENEN
            Herkunft; danach liegt sie im Cache (gemessen, s. Handover).
          */}
          <Image src="/brand/coolin-emblem.png" style={styles.headerMark} />
          <View style={styles.headerMarkSpacer} />
          {/*
            ⚠ D15 Block 1, Punkt 7: die Wortmarke ist zweifarbig. `PRINT_COMPANY.name` bleibt die
            EINE Quelle des Wortlauts und wird hier nur an seinem Leerzeichen geteilt — ein zweites
            Mal ausgeschrieben liefen die beiden Hälften beim nächsten Umbenennen auseinander, und
            der Drift-Test in `apps/web` prüft den Wortlaut, nicht seine Darstellung.
          */}
          <Text style={styles.headerWordmark}>{PRINT_COMPANY.name.split(' ')[0]}</Text>
          <Text style={styles.headerWordmarkAccent}>
            {PRINT_COMPANY.name.split(' ').slice(1).join(' ')}
          </Text>
          {/*
            Wessen Report das ist — auf jedem Blatt. Der TITEL steht bewusst nicht hier: er ist
            editierbar und im Realfall zu lang für eine Kopfzeile (der Urbanz-Titel misst 54
            Zeichen), und er steht ohnehin gross auf dem Deckblatt. Was ein weitergereichtes Blatt
            nicht mehr hergibt, ist die Zuordnung zum Kunden.
          */}
          {docLabel && <Text style={styles.headerDoc}>{docLabel}</Text>}
        </View>
        <View style={styles.headerBar} />
      </View>

      <View style={styles.footer} fixed>
        <Text>
          {PRINT_COMPANY.name} · {PRINT_COMPANY.street} · {PRINT_COMPANY.city}
        </Text>
        <View style={styles.footerRight}>
          <Text>{PRINT_COMPANY.web}</Text>
          <Text>·</Text>
          {/*
            Der Seitenzähler.

            Er steht in der Fusszeilen-Zeile und nicht frei darüber, damit er seine Breite aus dem
            Flex-Layout bekommt statt aus einer absoluten Positionierung.

            ⚠ DASS ER ÜBERHAUPT ERSCHEINT, HÄNGT AM FEHLENDEN `lineHeight` AUF DER SEITE — s. die
            Warnung an `styles.page`. Der erste Anlauf dieses Abschnitts lieferte ein PDF ganz OHNE
            Fusszeile; die naheliegende Erklärung (Breite 0 wegen fehlendem `left`) war die
            falsche — nachgemessen war es der geerbte Zeilenabstand.

            ⚠ KONVENTION: das DECKBLATT ZÄHLT MIT — es ist „Seite 1 von N". Die Alternative
            (Deckblatt ungezählt) verlangte eine zweite Zählung neben `pageNumber`, und die stünde
            dann neben der Wahrheit des Seitenbaums. Die Agenda verweist deshalb ebenfalls auf
            gezählte Seiten.

            Derselbe Rückruf nimmt die Gesamtseitenzahl auf — sie ist der Wächter dafür, dass beide
            Durchläufe dasselbe Dokument ergeben (`measurementsAgree`).
          */}
          <Text
            render={({ pageNumber, totalPages }) => {
              recordTotalPages(sink, totalPages)
              return `Seite ${pageNumber} von ${totalPages}`
            }}
          />
        </View>
      </View>
    </>
  )
}

/**
 * Die Wortmarke auf den zwei navyfarbenen Seiten — Emblem auf weisser Kachel plus Schriftzug.
 *
 * EIN Baustein für Deck- UND Abschlussseite: zwei Fassungen derselben Marke auf zwei Seiten
 * desselben Dokuments wären der Unterschied, den niemand beabsichtigt und jeder sieht.
 */
function NavyLockup() {
  return (
    <View style={styles.navyLockup}>
      {/*
        Die BESTEHENDE Emblem-Datei aus `public/brand/` — dieselbe, die Kopfzeile und CSS-Druck
        benutzen, kein zweites Bild.
      */}
      <View style={styles.navyTile}>
        <Image src="/brand/coolin-emblem.png" style={styles.navyMark} />
      </View>
      <View>
        <Text style={styles.navyWordmark}>{PRINT_COMPANY.name}</Text>
        <Text style={styles.navyWordmarkSub}>Peak Shaving &amp; Speicher-Wirtschaftlichkeit</Text>
      </View>
    </View>
  )
}

/**
 * Das Deckblatt — vollflächig Navy, weisse Typografie.
 *
 * ── ⚠ WARUM HIER KEINE KOPF-/FUSSZEILE STEHT ───────────────────────────────────────────────────
 * `PageFurniture` zeichnet eine navyfarbene Wortmarke und eine graue Fusszeile auf weissem Grund;
 * auf einer navyfarbenen Fläche wäre die Wortmarke unsichtbar und die Fusszeile ein grauer Streifen
 * ohne Bezug. Die Seite trägt ihre eigene, grössere Marke oben.
 *
 * ⚠ DIE SEITENZÄHLUNG BLEIBT UNVERÄNDERT: `pageNumber` kommt von react-pdf und nicht von der
 * Fusszeile — das Deckblatt zählt weiterhin mit („Seite 2 von N" auf der Agenda, D5-Konvention),
 * es zeigt seine Zahl nur nicht an. `recordTotalPages` läuft über die Fusszeilen aller übrigen
 * Seiten und ist damit unberührt.
 *
 * ── DER DEMODATEN-VORBEHALT STEHT HIER NICHT MEHR ──────────────────────────────────────────────
 * Er ist nicht entfallen, sondern steht ab jetzt nur noch im Schlusskapitel „Annahmen und
 * Datengrundlage" (`BasisChapter`, dieselbe Konstante `REPORT_DISCLAIMER`). Er gehört inhaltlich
 * dorthin, wo das Dokument seine Grenzen benennt; auf dem Deckblatt stand er als einzige
 * Kleinschrift unter einer sonst repräsentativen Seite. **Aus dem Dokument verschwinden darf er
 * nicht** — §8 verlangt, dass keine ROI-Zahl als „echt" ausgegeben wird, solange nicht gegen einen
 * echten Lastgang und eine echte Netzrechnung validiert wurde.
 */
function Cover({ input }: { input: PdfReportInput }) {
  const customer = input.customer
  const hasCustomer = Boolean(customer?.company || customer?.name || customer?.address)

  return (
    <>
      <NavyLockup />
      <View style={styles.coverBody}>
        <View style={styles.coverRule} />
        <Text style={styles.coverTitle}>{input.title}</Text>
        <Text style={styles.coverSubtitle}>{input.subtitle}</Text>

        {/*
        Jedes Feld nur, wenn es einen Wert hat — dasselbe Muster wie `print-cover.tsx`: ein sichtbar
        leeres Feld oder ein Platzhalterstrich auf einem Deckblatt sieht aus wie ein Fehler beim
        Ausdrucken, nicht wie eine nicht gestellte Frage.
      */}
        {hasCustomer && (
          <View style={styles.coverCustomer}>
            <Text style={styles.coverCustomerLabel}>ERSTELLT FÜR</Text>
            {customer?.company && <Text style={styles.coverCompany}>{customer.company}</Text>}
            {customer?.name && <Text style={styles.coverName}>{customer.name}</Text>}
            {/*
              Mehrzeilig: die Adresse kommt als Freitext, und Zeilenumbrüche sind darin die
              Gliederung. `\n` bricht in react-pdf um; ein einzelner Text-Knoten mit dem Rohwert
              zeigte die Zeilen sonst hintereinander.
            */}
            {customer?.address && (
              <View style={styles.coverAddressBlock}>
                {customer.address
                  .split('\n')
                  .map((line) => line.trim())
                  .filter((line) => line !== '')
                  .map((line, index) => (
                    <Text key={`${index}-${line}`} style={styles.coverAddress}>
                      {line}
                    </Text>
                  ))}
              </View>
            )}
          </View>
        )}

        <View style={styles.coverMeta}>
          {input.period && (
            <View style={styles.coverMetaRow}>
              <Text style={styles.coverMetaLabel}>Ausgewerteter Zeitraum</Text>
              <Text style={styles.coverMetaValue}>{input.period}</Text>
            </View>
          )}
          <View style={styles.coverMetaRow}>
            <Text style={styles.coverMetaLabel}>Erstellt am</Text>
            <Text style={styles.coverMetaValue}>{input.printedAt}</Text>
          </View>
        </View>
      </View>
    </>
  )
}

/**
 * Die Abschlussseite — dieselbe navyfarbene Fläche wie das Deckblatt, als Klammer um das Dokument.
 *
 * ── WAS HIER STEHT, UND WARUM GENAU DAS ───────────────────────────────────────────────────────
 * Ein Analyse-Report wird weitergereicht, ausgedruckt und auf einen Tisch gelegt. Die Rückseite
 * beantwortet deshalb die eine Frage, die dann offen ist: **wen rufe ich an?** Sie trägt
 * Ansprechperson mit Rolle, Telefonnummer, E-Mail-Adresse, Web und die Anschrift.
 *
 * Dazu — und das ist die zweite Aufgabe der Seite — die **Wiedererkennung des Dokuments**: Titel
 * und ausgewerteter Zeitraum stehen unten noch einmal. Ein Blatt, das sich vom Stapel löst, ist
 * sonst nicht mehr zuzuordnen; auf dem Deckblatt steht es, aber das liegt dann woanders.
 *
 * ⚠ AUSDRÜCKLICH KEINE ZAHL UND KEINE AUSSAGE ÜBER DAS ERGEBNIS. Eine Rückseite, die eine
 * Ersparnis wiederholt, wäre ein Werbeblatt — und die Zahl stünde ohne die Vorbehalte, unter denen
 * sie im Dokument gilt. Der Vorbehalt selbst steht im Schlusskapitel davor.
 *
 * ⚠ UND KEINE ECG-PFLICHTANGABEN (Firmenbuch, UID, Rechtsträger). Sie gehören ins Impressum; eine
 * Kontaktseite ist eine Absenderangabe, und eine halbe Pflichtangabe wäre schlechter als keine —
 * dieselbe Begründung wie im Kopf von `lib/company.ts`.
 */
function Outro({ input }: { input: PdfReportInput }) {
  return (
    <>
      <NavyLockup />
      <View style={styles.outroBody}>
        <View style={styles.coverRule} />
        <Text style={styles.outroHeadline}>Sprechen wir über Ihre Zahlen.</Text>
        <Text style={styles.outroLead}>
          Diese Auswertung ist der Ausgangspunkt, nicht das Angebot. Wir gehen sie mit Ihnen durch,
          prüfen die Annahmen gegen Ihre Netzrechnung und rechnen die Auslegung auf Ihren Betrieb.
        </Text>

        <View style={styles.outroContact}>
          <Text style={styles.outroLabel}>IHR ANSPRECHPARTNER</Text>
          <Text style={styles.outroPerson}>{REPORT_CONTACT.name}</Text>
          <Text style={styles.outroRole}>{REPORT_CONTACT.role}</Text>
          <View style={styles.outroLines}>
            <Text style={styles.outroLine}>{REPORT_CONTACT.phone}</Text>
            <Text style={styles.outroLine}>{REPORT_CONTACT.email}</Text>
          </View>
        </View>

        <View style={styles.outroFoot}>
          <Text style={styles.outroFootLine}>
            {PRINT_COMPANY.name} · {PRINT_COMPANY.street} · {PRINT_COMPANY.city} ·{' '}
            {PRINT_COMPANY.web}
          </Text>
          {/*
            Die Wiedererkennung des Blattes — kein Ergebnis, nur die Kennzeichnung des Dokuments.
            `period` fehlt bei einem leeren Lastgang; dann steht die Zeile ohne Zeitraum da, statt
            einen Gedankenstrich zu drucken (dasselbe Muster wie auf dem Deckblatt).
          */}
          <Text style={styles.outroFootLine}>
            {input.title}
            {input.period ? ` · Zeitraum ${input.period}` : ''} · Erstellt am {input.printedAt}
          </Text>
        </View>
      </View>
    </>
  )
}

function AgendaRow({ section, pages }: { section: ReportSection; pages: AgendaPageNumbers }) {
  if (!sectionHasPageNumber(section)) {
    return <Text style={styles.agendaItem}>{section.title}</Text>
  }
  const page = pages?.[section.id]
  return (
    <View style={styles.agendaChapter}>
      <Text style={styles.agendaChapterLabel}>{section.title}</Text>
      <Text style={styles.agendaPageCell}>{page === undefined ? '' : String(page)}</Text>
    </View>
  )
}

function Agenda({
  sections,
  pages,
}: {
  /**
   * ⚠ HEREINGEREICHT UND NICHT HIER GEBILDET (B23c-3b-1). Seit dem „Ladeverhalten"-Kapitel gibt es
   * ein Kapitel, das nicht in jedem Dokument entsteht — und die Agenda darf genau dann keinen
   * Eintrag dafür tragen. Die Entscheidung fällt EINMAL in `ReportDocument` und speist Agenda UND
   * Seitenbaum; zwei getrennte Auswertungen ergäben einen Eintrag ohne Kapitel (Zahlenspalte bleibt
   * leer, weil kein Sentinel meldet) oder ein Kapitel ohne Eintrag.
   */
  sections: readonly ReportSection[]
  pages: AgendaPageNumbers
}) {
  return (
    <View style={styles.body}>
      <Text style={styles.h2}>Inhalt</Text>
      <Text style={styles.lead}>
        Was in diesem Dokument steht — und auf welcher Seite es beginnt.
      </Text>
      <View style={styles.agendaList}>
        {sections.map((section) => (
          <AgendaRow key={section.id} section={section} pages={pages} />
        ))}
      </View>
      {/*
        ⚠ DIE EINRÜCKUNG IST DIE AUSSAGE, NICHT EINE FEHLENDE ZAHL. Unterpunkte tragen bewusst keine
        eigene Seitenzahl: gemessen liefert react-pdf für ein Element innerhalb einer umbrechenden
        Seite die Zahl des SEITENANFANGS, nicht die tatsächliche (`page-numbers.ts`, Aufbau C). Die
        Zahl des Kapitels für sie zu wiederholen wäre für jeden Unterpunkt falsch, der eine Seite
        weiter beginnt — und das ist bei sechs Absätzen der Regelfall.
      */}
      <Text style={styles.agendaHint}>
        Unterpunkte sind eingerückt und beginnen im Kapitel darüber.
      </Text>
    </View>
  )
}

/** Die semantischen Töne in Farbe — an EINER Stelle, nicht an jeder Zeile. */
const TONE_COLOR: Record<ReportTone, string> = {
  positive: PDF_COLORS.positive,
  warning: PDF_COLORS.warning,
  neutral: PDF_COLORS.text,
}

/**
 * Die Farbe der EINEN grossen Zahl einer Aussage — B3-2a.
 *
 * ⚠ SIE STEHT NEBEN `TONE_COLOR` UND ERWEITERT ES NICHT, aus demselben Grund wie
 * `NOTICE_SURFACE` darunter: `TONE_COLOR` färbt auch jeden ZEILENWERT einer Aufschlüsselung, und
 * dort gibt es `negative` nicht (eine Kostenzeile ist `warning`). Ein gemeinsames Objekt hätte den
 * vierten Wert an beide Stellen gegeben — s. `ReportAmountTone` in `statement.ts`.
 */
const AMOUNT_COLOR: Record<ReportAmountTone, string> = {
  positive: PDF_COLORS.positive,
  warning: PDF_COLORS.warning,
  negative: PDF_COLORS.negative,
}

/**
 * Fläche und Kante eines HINWEISKASTENS je Ton (D15 Block 1, Punkt 3).
 *
 * ── ⚠ WARUM DAS NICHT `TONE_COLOR` ERWEITERT, SONDERN DANEBEN STEHT ────────────────────────────
 * `TONE_COLOR` färbt drei verschiedene Dinge: den Wert einer Zeile, den Betrag einer Aussage und
 * bisher auch die Kante eines Kastens. Für die ersten beiden ist `neutral` = `text` richtig — ein
 * Betrag ohne Wertung ist schwarz. Für eine 2,6 pt breite Kante ist derselbe Wert zu laut: sie
 * behauptete dann Dringlichkeit, wo nichts Dringendes steht. Ein gemeinsames Objekt hätte diesen
 * Unterschied nur um den Preis verstecken können, dass eine Änderung an einer Stelle zwei andere
 * mitnimmt.
 *
 * ── ⚠ WARUM `neutral` KEINE TEAL FLÄCHE BEKOMMT ──────────────────────────────────
 * Das Zielbild kennt nur teal und amber (Bestandsaufnahme §4.4).
 *
 * ⚠ BERICHTIGT MIT B3-2a: hier stand, teal bedeute dort eine GUTE Nachricht. Nachgemessen stimmt
 * das nicht — alle drei teal Kästen des Zielbildes tragen einen Vorbehalt, und einer TRÄGT DIE
 * ABSAGE SELBST („Ausserdem schon geklärt": „Ein zusätzlicher Batteriespeicher lohnt sich für Sie
 * derzeit nicht", S. 2). Teal markiert dort einen ERLEDIGTEN NEBENSTRANG — eine Bemerkung, die zum
 * Kapitel gehört, aber nicht in seiner Hauptlinie steht — und keine Wertung.
 *
 * ⚠ DIE ENTSCHEIDUNG BLEIBT TROTZDEM, mit dem richtigen Grund: ein `ReportNotice` ist kein
 * Nebenstrang, sondern eine Feststellung ÜBER DIE DATENGRUNDLAGE der Zahlen daneben
 * (`statement.ts`). „PV-Erzeugung geschätzt" oder „Datenqualität" als erledigt zu markieren wäre
 * dieselbe Verwechslung in der anderen Richtung. `neutral` bleibt deshalb auf `surfaceAlt`; die
 * teal Kästen des Zielbildes sind `ReportStatement`s, und dort gehört `accentSubtle` hin (B3-2b).
 */
const NOTICE_SURFACE: Record<ReportNotice['tone'], string> = {
  warning: PDF_COLORS.warningSubtle,
  neutral: PDF_COLORS.surfaceAlt,
}
const NOTICE_EDGE: Record<ReportNotice['tone'], string> = {
  warning: PDF_COLORS.warning,
  neutral: PDF_COLORS.textMuted,
}

function StatementRow({ row, zebra }: { row: ReportRow; zebra: boolean }) {
  return (
    <View
      wrap={false}
      style={[styles.row, zebra ? styles.rowZebra : {}, row.total ? styles.rowTotal : {}]}
    >
      <View style={styles.rowLabelCell}>
        <Text style={row.total ? styles.rowLabelTotal : styles.rowLabel}>{row.label}</Text>
        {/* Der Hinweis steht NUR, wo es einen gibt — eine leere zweite Zeile wäre ein Loch. */}
        {row.hint && <Text style={styles.rowHint}>{row.hint}</Text>}
      </View>
      <Text style={[styles.rowValue, { color: TONE_COLOR[row.tone] }]}>{row.value}</Text>
    </View>
  )
}

/**
 * Ein Hinweis (B23c-4) — eine Feststellung ÜBER die Zahlen.
 *
 * ── ⚠ EIN BAUSTEIN FÜR VIER STELLEN ───────────────────────────────────────────────────────────
 * Die drei Hinweise bei der Kern-Kennzahl (`summary.ts`) und die zwei Kästen des Schlusskapitels
 * (`basis.ts`: Datenqualität, Blocker-Befund) rendern hier durch. Vier eigene Formen für dieselbe
 * Rolle wären genau die Doppelung, die man erst bemerkt, wenn eine davon ein Feld bekommt und der
 * Leser den Unterschied für eine Bedeutung hält.
 *
 * ── ⚠ HIER STEHT BEWUSST KEIN `wrap={false}` — ANDERS ALS BEI `Statement` ─────────────────────
 * Eine Kernaussage trägt eine feste Zahl von Zeilen und ist damit nachweislich kleiner als der
 * Satzspiegel; ein Hinweis nicht: die Aufzählung des Blocker-Befunds führt die betroffenen
 * ZEITBEREICHE, und wie viele es sind, entscheidet die Datenlage. Ein `wrap={false}`-Block, der
 * die Seite sprengt, wird von react-pdf ABGESCHNITTEN statt umgebrochen — bei einem Befund über
 * fehlende Preise wäre das ein stiller Inhaltsverlust an genau der Stelle, die sagt, was fehlt.
 *
 * Der Preis dafür ist ein Hinweis, der im Ungünstigsten über einen Seitenwechsel läuft. Dieselbe
 * Abwägung steht bereits an `ResultsChapter`: eine unschöne Seite ist besser als ein Block, den
 * niemand mehr ganz sieht.
 *
 * ⚠ Fehlt eine Aufzählung oder ein Zusatzabsatz, wird NICHTS gerendert — keine leere Zeile, keine
 * Beschriftung ohne Inhalt. Dasselbe Muster wie beim `hint` einer Zeile und beim leeren
 * Adressfeld des Deckblatts.
 */
function Notice({ notice }: { notice: ReportNotice }) {
  return (
    <View
      style={[
        styles.notice,
        { backgroundColor: NOTICE_SURFACE[notice.tone], borderLeftColor: NOTICE_EDGE[notice.tone] },
      ]}
    >
      <Text style={styles.noticeTitle}>{notice.title}</Text>
      <Text style={styles.noticeBody}>{notice.body}</Text>
      {notice.list && (
        <View>
          {notice.list.label && <Text style={styles.noticeListLabel}>{notice.list.label}</Text>}
          {notice.list.items.map((item) => (
            <Text key={item} style={styles.noticeListItem}>
              · {item}
            </Text>
          ))}
        </View>
      )}
      {notice.hints.map((hint) => (
        <Text key={hint} style={styles.noticeHint}>
          {hint}
        </Text>
      ))}
    </View>
  )
}

/**
 * Eine Kernaussage.
 *
 * ⚠ `wrap={false}`: eine Aussage, deren Kopfzahl auf der einen und deren Aufschlüsselung auf der
 * nächsten Seite steht, ist genau die Trennung, die einen Betrag ohne seinen Vorbehalt dastehen
 * lässt. Umbrechen darf das Kapitel zwischen den Aussagen, nicht innerhalb einer.
 *
 * ⚠ GEMESSEN UND VERWORFEN: `minPresenceAhead` (react-pdfs Waisenschutz) bewegt hier NICHTS — mit
 * 46 pt und mit 56 pt, am `wrap={false}`-Element wie an einem umschliessenden `View`, blieb der
 * Umbruch in allen drei Prüfläufen unverändert. Es steht deshalb nicht im Code: eine Zeile, die
 * einen Schutz behauptet, den sie nicht leistet, ist schlimmer als kein Schutz. Die Folge ist als
 * offener Punkt benannt (s. `ResultsChapter`).
 */
/**
 * Stufe D — der Körper wird HIER aufgelöst und nicht in der Ableitung.
 *
 * ⚠ `statement.id` ist der Ursprung des Verweises, und ohne ihn gibt es kein „oben": eine
 * Ortsangabe ist eine Aussage über ZWEI Bausteine. Deshalb reicht es nicht, den Text zu ersetzen —
 * der Resolver muss wissen, wer spricht.
 */
function Statement({ statement, layout }: { statement: ReportStatement; layout: ReportLayout }) {
  /*
   * B3-2a — das VERDIKT ist die einzige Aussage, deren Kopfzahl ein Wort ist: die Antwort auf
   * eine Frage als Überschrift, im Kostenton (`ReportAmountTone`, `statement.ts`). Es steht am
   * Ton und nicht an einer Kennung — was diese Form bekommt, entscheidet die Ableitung.
   */
  const verdict = statement.amount?.tone === 'negative' ? statement.amount : null

  /*
   * B3-2b — der erledigte Nebenstrang steht im teal Kasten, und sein Titel eine Stufe kleiner:
   * er ist eine Bemerkung zum Kapitel und kein neunter Abschnitt darin (`PDF_TYPE.noticeTitle`
   * ist aus genau diesem Grund schon da). Auch das entscheidet die Ableitung, nicht eine Kennung.
   */
  const aside = statement.aside === true

  const body = resolveReportSegments(statement.body, layout, statement.id)
  /* B3-3 — aufgelöst und nicht in der Ableitung gezählt: s. `statementPoints`. */
  const points = statementPoints(statement, layout)
  /* Ein einzelner Punkt ist keine Liste — s. unten. */
  const lonePoint = points.length === 1 ? points[0] : undefined

  /* Ein ausgezeichnetes Stück trägt den Ton der Kopfzahl — ohne Kopfzahl läuft es im Text mit. */
  const marked = (segments: ReportTextSegment[]) =>
    segments.map((segment, index) =>
      segment.accent && statement.amount ? (
        <Text key={index} style={{ color: AMOUNT_COLOR[statement.amount.tone] }}>
          {segment.text}
        </Text>
      ) : (
        segment.text
      ),
    )

  return (
    <View style={aside ? [styles.statement, styles.statementAside] : styles.statement} wrap={false}>
      <Text
        style={verdict ? styles.verdictTitle : aside ? styles.noticeTitle : styles.statementTitle}
      >
        {statement.title}
      </Text>
      {/* Keine Kopfzahl, wo es keine gibt (der Zusatzspeicher-Klarsatz) — s. `summary.ts`. */}
      {verdict ? (
        /* Ohne Bezugsgrösse: sie steht als Satz im Fliesstext darunter (s. `buildVerdict`). */
        <Text style={styles.verdictWord}>{verdict.value}</Text>
      ) : (
        statement.amount && (
          <View style={styles.statementAmountRow}>
            <Text style={[styles.statementAmount, { color: AMOUNT_COLOR[statement.amount.tone] }]}>
              {statement.amount.value}
            </Text>
            <Text style={styles.statementAmountCaption}>{statement.amount.caption}</Text>
          </View>
        )
      )}
      {statement.rows.length > 0 && (
        <View style={styles.rowList}>
          {statement.rows.map((row, index) => (
            <StatementRow key={row.label} row={row} zebra={index % 2 === 1} />
          ))}
        </View>
      )}
      {/*
        B3-2a — der Körper kommt in STÜCKEN und nicht als eine Zeichenkette: eines davon darf
        AUSGEZEICHNET sein (`ReportAccent`, `report-text.ts`). Die Farbe dazu ist die der Kopfzahl
        — ein Betrag, der die Aussage belegt, trägt ihren Ton; ohne Kopfzahl gibt es keinen, und
        das Stück läuft im Fliesstext mit.

        ⚠ Nur, wo es einen gibt: eine Aussage in Listenform (B3-3) lässt `body` leer, und ein
        leerer Absatz stünde dort als Loch zwischen Aufschlüsselung und Liste.
      */}
      {body.length > 0 && <Text style={styles.statementBody}>{marked(body)}</Text>}
      {/*
        B3-3 (20a) — die nummerierte Liste. Ein einzelner Punkt bekommt KEINE Ziffer: eine „1"
        ohne „2" behauptet eine Aufzählung, von der etwas fehlt.
      */}
      {lonePoint && (
        <View style={styles.pointList}>
          <Text style={styles.pointTitle}>{lonePoint.title}</Text>
          <Text style={styles.pointText}>{marked(lonePoint.segments)}</Text>
        </View>
      )}
      {points.length > 1 && (
        <View style={styles.pointList}>
          {points.map((point, index) => (
            <View key={index} style={index === 0 ? styles.point : [styles.point, styles.pointGap]}>
              <Text style={styles.pointNumber}>{index + 1}</Text>
              <View style={styles.pointBody}>
                <Text style={styles.pointTitle}>{point.title}</Text>
                <Text style={styles.pointText}>{marked(point.segments)}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
      {/*
        Die §3.8-Warnungen, je eine Zeile. Sie stehen NEBEN der Investition und nicht in ihr:
        „Betonsockel nötig (+€1800)" ist bereits in der Gesamtsumme enthalten — wer den Satz
        überliest, hält die Summe für zu hoch. Fehlt die Liste, gibt es keine Warnung; eine leere
        Zeile wäre hier ein Loch.
      */}
      {statement.notes?.map((note) => (
        <Text key={note} style={styles.statementNote}>
          · {note}
        </Text>
      ))}
    </View>
  )
}

/**
 * Eine Vergleichstabelle (B23c-3b-2).
 *
 * ── ⚠ RELATIVE BREITEN, KEINE PT-ANGABEN ──────────────────────────────────────────────────────
 * Die Spaltengewichte kommen als `flexGrow` aus der Ableitung; die tatsächliche Breite ergibt sich
 * aus dem Satzspiegel. Eine hier abgeschriebene pt-Aufteilung liefe beim nächsten Randwechsel von
 * `PDF_LAYOUT` weg, und die Tabelle stünde entweder über den Rand hinaus oder als Streifen in der
 * Seitenmitte.
 *
 * ⚠ `flexBasis: 0` neben `flexGrow`: ohne das verteilt Flex den RESTPLATZ nach dem Inhalt, und
 * eine Zeile mit einem langen Gerätenamen bekäme andere Spaltenbreiten als die Zeile darunter —
 * die Zahlen einer Spalte stünden dann nicht mehr untereinander.
 *
 * ⚠ `wrap={false}`: eine Tabelle, deren Kopfzeile auf der einen und deren Zeilen auf der nächsten
 * Seite stehen, ist eine Zahlenkolonne ohne Beschriftung. Sie ist mit höchstens fünf Zeilen weit
 * kleiner als der Satzspiegel — die Gefahr eines abgeschnittenen `wrap={false}`-Blocks besteht
 * hier nicht.
 */
function StatementTable({
  table,
  from,
  layout,
  allowPageBreak = false,
}: {
  table: ReportTable
  /**
   * Stufe D — die Kennung DIESER Tabelle. Sie steht nicht im `ReportTable` (die drei Tabellen
   * tragen ihre Überschrift ebenfalls im JSX, s. `ReportTable`), wird aber gebraucht: eine Zelle
   * kann auf einen anderen Baustein zeigen, und „oben" ist eine Aussage über zwei.
   */
  from: ReportBaukastenId
  layout: ReportLayout
  /**
   * D9 — DIESE EINE TABELLE DARF UMBRECHEN.
   *
   * Die Vergleichstabelle trägt höchstens fünf einzeilige Zeilen und ist damit nachweislich kleiner
   * als der Satzspiegel; die Datenquellen-Tabelle trägt bis zu neun Zeilen mit ganzen Sätzen darin,
   * und wie hoch sie wird, entscheidet die Länge einer Fundstelle. Ein `wrap={false}`-Block, der die
   * Seite sprengt, wird von react-pdf ABGESCHNITTEN statt umgebrochen — ausgerechnet in der Tabelle,
   * die sagt, worauf die Zahlen beruhen, wäre das ein stiller Inhaltsverlust. Dieselbe Abwägung wie
   * bei `Notice`: eine unschöne Seite ist besser als ein Block, den niemand mehr ganz sieht.
   *
   * ⚠ Der Preis ist eine Kopfzeile, die nach einem Umbruch nicht wiederkehrt. `fixed` wäre der
   * naheliegende Griff und hier der falsche: es wiederholte die Zeile auf JEDER Folgeseite des
   * Dokuments, nicht nur auf denen der Tabelle.
   */
  allowPageBreak?: boolean
}) {
  return (
    <View style={styles.table} wrap={allowPageBreak}>
      {/*
        ⚠ `wrap={false}` — seit die Kopfzeile eine gefüllte Fläche trägt (D15 Block 1, Punkt 4),
        darf sie nicht mehr über einen Seitenumbruch laufen. Gemessen in D15 Block 2: die schmalere
        Textspalte (Punkt 9) schob den Umbruch mitten in den Kopf, und auf der Folgeseite stand ein
        3,5 pt hoher navyfarbener Streifen ohne Text — der Rest seines Innenabstands. Vorher fiel
        das nicht auf, weil eine Kopfzeile ohne Fläche beim Brechen nichts hinterlässt.
      */}
      <View style={styles.tableHeader} wrap={false}>
        {table.columns.map((column) => (
          <Text
            key={column.label}
            style={[
              styles.tableHeaderCell,
              { flexGrow: column.width, flexBasis: 0 },
              column.align === 'right' ? { textAlign: 'right' } : {},
            ]}
          >
            {column.label}
          </Text>
        ))}
      </View>
      {/*
        ⚠ Der Zebra-Zähler läuft über die DATENzeilen und nicht über den Index der Schleife:
        eine Gruppenzeile (D9, `heading`) trägt keine Fläche und darf deshalb auch keinen Streifen
        verbrauchen — sonst kippte das Muster hinter jeder Gruppe, und die Tabelle sähe aus, als
        fehlte dort eine Zeile.
      */}
      {(() => {
        let dataRow = -1
        return table.rows.map((row) =>
          /* D9 — eine Gruppenüberschrift ist EINE Zelle über die volle Breite: die leeren Zellen
           daneben mitzurendern ergäbe Spaltenlinien unter einer Überschrift, die sie nicht führt. */
          row.heading ? (
            <View key={row.key} style={styles.tableGroupRow}>
              <Text style={styles.tableGroupLabel}>
                {resolveReportText(row.cells[0] ?? '', layout, from)}
              </Text>
            </View>
          ) : (
            <View
              key={row.key}
              /* Dieselbe Überlegung wie am Kopf: eine gebrochene Zeile hinterlässt ihren Zebra-Ton
               als Streifen auf der Folgeseite. Eine Tabellenzeile gehört ohnehin auf ein Blatt. */
              wrap={false}
              style={[styles.tableRow, (dataRow += 1) % 2 === 1 ? styles.tableRowZebra : {}]}
            >
              {row.cells.map((cell, index) => {
                const column = table.columns[index]
                return (
                  <Text
                    key={column?.label ?? String(index)}
                    style={[
                      styles.tableCell,
                      { flexGrow: column?.width ?? 1, flexBasis: 0 },
                      column?.align === 'right' ? { textAlign: 'right' } : {},
                    ]}
                  >
                    {resolveReportText(cell, layout, from)}
                  </Text>
                )
              })}
            </View>
          ),
        )
      })()}
    </View>
  )
}

/**
 * Die Zusammenfassung — das erste inhaltliche Kapitel.
 *
 * ── ⚠ WAS AUF DIESER SEITE STEHT, ENTSCHEIDET `summary.ts` UND NICHT DIESE DATEI ───────────────
 * Hier wird ausschliesslich gerendert, was die Ableitung geliefert hat. Es gibt bewusst KEINE
 * Verzweigung an einem Contract-Feld in diesem JSX: die Frage „darf diese Zahl im Dokument
 * stehen" ist fachlich (Delta 15 Regel C, Delta 3, Prinzip 2) und hätte an zwei Orten zwei
 * Antworten.
 *
 * ── DIE REIHENFOLGE IST EINE AUSSAGE ──────────────────────────────────────────────────────────
 * Zwei Kopfzahlen → Hinweise zu ihrer Grundlage → der Absatz, der sie erklärt → der Satz zur
 * PV-Anlage → der teal Kasten mit dem, was schon geklärt ist. Wer nur diese eine Seite liest,
 * bekommt die Zahl, ihre Grenzen und den Weg dorthin in genau dieser Folge.
 *
 * ⚠ KEIN CHART. Die Rasterbild-Pipeline (B23b) hängt sich erst ab dem Empfehlungs-Kapitel in den
 * Fluss ein; ein Chart hier hiesse, `rasterizeChart` in den Renderpfad zu ziehen — und der ist
 * synchron und kennt kein DOM.
 */
function ResultsChapter({
  input,
  context,
  layout,
}: {
  input: PdfReportInput
  context: ReportBuildContext
  layout: ReportLayout
}) {
  const summary = buildReportSummary(input, context)
  const overview = resolveReportSegments(summary.overview, layout, 'overview')
  const pvPointer = summary.pvPointer
    ? resolveReportSegments(summary.pvPointer, layout, 'pv_pointer')
    : []

  return (
    <View style={styles.body}>
      <Text style={styles.h2}>{RESULTS_SECTION.title}</Text>
      <Text style={styles.lead}>{RESULTS_INTRO}</Text>

      {/* ⚠ Leer = der Tarifvergleich war nicht rechenbar; dann gibt es BEIDE Zahlen nicht, und der
          Absatz darunter sagt warum (s. `summaryWaysOf`). */}
      {summary.kpis.length > 0 && (
        <View style={styles.headline}>
          {summary.kpis.map((kpi) => (
            <View key={kpi.id} style={styles.headlineCell}>
              <Text
                style={kpi.tone === 'accent' ? styles.headlineValueAccent : styles.headlineValue}
              >
                {kpi.value}
              </Text>
              {kpi.caption.map((line) => (
                <Text key={line} style={styles.headlineCaption}>
                  {line}
                </Text>
              ))}
            </View>
          ))}
          {/* Die leere zweite Zelle — s. `styles.headline`. */}
          {summary.kpis.length === 1 && <View style={styles.headlineCell} />}
        </View>
      )}

      {/*
        ⚠ ZWISCHEN Kopfzahlen und Fliesstext, nicht im Schlusskapitel: sie schränken GENAU die
        Grundlage ein, auf der die zwei Zahlen darüber beruhen. Dieselbe Stellung wie am
        Bildschirm, wo sie unmittelbar unter der Kern-Kennzahl stehen und ausdrücklich NICHT in der
        Datenqualitäts-Box weiter unten — die wurde beim Live-Test überscrollt.

        ⚠ Ihre REIHENFOLGE ist die des Bildschirms (`buildNotices`) — sie entsteht in der Ableitung
        und nicht hier. Hier durchsortiert stünde dieselbe Entscheidung an zwei Orten.
      */}
      {summary.notices.map((notice) => (
        <Notice key={notice.id} notice={notice} />
      ))}

      {/*
        ⚠ DER ABSATZ IST KEIN `Statement`: er trägt keinen Titel, keine Kopfzahl und keine
        Aufschlüsselung, und ein `Statement` mit leerem Titel setzte eine leere Zeile über ihn.
        Aufgelöst wird er trotzdem über dieselbe Stufe-D-Auflösung wie jeder Baustein — er zeigt je
        nach Fall auf den Blocker-Befund bzw. auf das Empfehlungs-Kapitel, und beide können fehlen.
      */}
      <Text style={styles.summaryProse}>{overview.map((segment) => segment.text)}</Text>

      {/* Nur mit angegebener PV-Anlage — s. `buildPvPointer`. */}
      {pvPointer.length > 0 && (
        <Text style={styles.summaryProse}>{pvPointer.map((segment) => segment.text)}</Text>
      )}

      {/*
        Report-Baukasten C (B3-2b) — `addon` ist abwählbar, und die Auswahl greift HIER und nicht in
        der Ableitung: `buildReportLayout` bildet seine Beschreibung aus derselben Bedingung, und
        die zwei Wege müssen dieselbe Antwort geben (s. `reportBlockSelected`). Fällt der Zeiger,
        fällt mit ihm der Satz im Empfehlungs-Kapitel, der auf ihn zeigt — er trägt dafür seine
        leere Ersatzfassung (`recommendation.ts`, Kante E).
      */}
      {summary.statements
        .filter((s) => s.id !== ADDON_ID || reportSectionEnabled(input.optionalSections, ADDON_ID))
        .map((statement) => (
          <Statement key={statement.id} statement={statement} layout={layout} />
        ))}

      <Text style={styles.footnote}>{RESULTS_FOOTNOTE}</Text>
    </View>
  )
}

/**
 * „Voraussetzungen" — zwischen Zusammenfassung und Empfehlung.
 *
 * ── ⚠ WAS AUF DIESER SEITE STEHT, ENTSCHEIDET `prerequisites.ts` UND NICHT DIESE DATEI ─────────
 * Dieselbe Regel wie bei `ResultsChapter`: hier wird ausschliesslich gerendert, was die Ableitung
 * geliefert hat.
 *
 * ⚠ Unbedingtes Kapitel: die Übersichts-Aussage, der Rahmen-Hinweis und der Verbrauchs-Block
 * stehen immer; nur einzelne ZEILEN der Übersicht (Batterie/PV) und der Preisgrundlage-Hinweis
 * entfallen fallweise — s. `prerequisites.ts`.
 */
function PrerequisitesChapter({ input, layout }: { input: PdfReportInput; layout: ReportLayout }) {
  const chapter = buildPrerequisitesChapter(input)

  return (
    <View style={styles.body}>
      <Text style={styles.h2}>{PREREQUISITES_SECTION.title}</Text>
      <Text style={styles.lead}>{PREREQUISITES_INTRO}</Text>

      <Statement statement={chapter.overview} layout={layout} />
      <Notice notice={chapter.framing} />
      <Statement statement={chapter.consumption} layout={layout} />
      {chapter.priceBasis && <Notice notice={chapter.priceBasis} />}
    </View>
  )
}

/**
 * Ein Diagramm im Fluss — Bild, Bildunterschrift und die Sätze, die dazugehören.
 *
 * ── ⚠ KEIN KASTEN, KEIN RAHMEN — und das ist eine Entscheidung, keine Auslassung ───────────────
 * Am Bildschirm steht ein Chart in einer umrahmten Karte, weil er dort neben anderen Karten liegt
 * und sich von ihnen abgrenzen muss. Auf einem Blatt gibt es diese Nachbarn nicht: ein Rahmen um
 * ein Diagramm, das ohnehin allein zwischen zwei Absätzen steht, ist ein Strich ohne Aufgabe. Das
 * Bild läuft deshalb frei im Satzspiegel, mit der Bildunterschrift direkt darunter.
 *
 * ── ⚠ DIE HÖHE KOMMT AUS `fitRasterToWidth` UND NIRGENDS SONST ────────────────────────────────
 * Falle 3 des Spikes (§2.4): eine von Hand gesetzte Höhe streckt oder staucht das Bild, ohne dass
 * irgendetwas kaputt aussieht — gemessen 13,6 % vertikale Streckung, am Bildschirm unsichtbar und
 * erst im 300-dpi-Vergleich aufgefallen.
 *
 * ⚠ `wrap={false}` um Bild UND Unterschrift: eine Bildunterschrift auf der Folgeseite gehört zu
 * einem Bild, das der Leser nicht mehr sieht. Die Blöcke sind mit rund 160–180 pt Bildhöhe
 * deutlich kleiner als der Satzspiegel — ein `wrap={false}`-Block, der die Seite sprengt, würde
 * abgeschnitten statt umzubrechen.
 *
 * ⚠ B23c-3a: EIN Baustein für alle drei Bilder. Vorher war er auf den Lastgang zugeschnitten; mit
 * dem zweiten und dritten Bild wären daraus drei strukturgleiche Bausteine geworden, von denen der
 * nächste Umbau zwei anfasst und einen vergisst. `statement` und `note` bilden dabei genau die
 * beiden Textsorten ab, die es unter einem Bild gibt: eine Aussage in Fliesstextfarbe und ein
 * Hinweis in der Farbe der Bildunterschrift.
 */
function ChartFigure({
  raster,
  caption,
  legend,
  statement,
  note,
  missing,
}: {
  raster: ChartRaster | null
  caption: string
  /**
   * B23c-3b-1 — die Legende, NATIV und unmittelbar unter dem Bild.
   *
   * ⚠ Sie steht hier und nicht im Bild, weil sie im gerasterten Ausschnitt gar nicht vorkommt: die
   * Heatmap wird auf ihr blosses Raster zugeschnitten (`selectHeatmapGrid`), ihre Legende liegt
   * darunter in der Karte. Ohne sie stünde ein Farbraster ohne Schlüssel im Dokument. Sie erscheint
   * ausschliesslich MIT Bild — unter einer Fehlmeldung wäre sie ein Schlüssel zu nichts.
   */
  legend?: ReactNode
  /** Die fachliche Aussage zum Bild — steht in Fliesstextfarbe. */
  statement?: string | null
  /** Der leisere Zusatz — steht in der Farbe der Bildunterschrift. */
  note?: string | null
  /** Was an der Stelle des Bildes steht, wenn keines entstanden ist. */
  missing: string
}) {
  if (!raster) {
    /*
     * Ein fehlgeschlagenes oder für diesen Fall gar nicht vorgesehenes Bild kostet nicht das
     * Dokument (s. `charts.tsx`) — aber es wird BENANNT. Still weggelassen suchte der Leser nach
     * einem Absatz, der nie kam; und die Zahlen um diese Stelle herum sind davon nachweislich
     * unberührt, weil sie aus dem Ergebnis stammen und nicht aus dem Bild.
     */
    /*
     * ⚠ `wrap={false}`: gemessen bricht dieser Absatz sonst mitten im Satz auf die Folgeseite um
     * und lässt dort seine zweite Hälfte ohne die Aussage stehen, zu der sie gehört. Er ist mit
     * rund fünf Zeilen weit kleiner als der Satzspiegel — die Gefahr eines abgeschnittenen
     * `wrap={false}`-Blocks besteht hier nicht.
     */
    return (
      <Text style={styles.figureMissing} wrap={false}>
        {missing}
      </Text>
    )
  }

  const box = fitRasterToWidth(raster, PDF_CONTENT_WIDTH_PT)
  return (
    <View style={styles.figure} wrap={false}>
      <Image src={raster.dataUrl} style={{ width: box.width, height: box.height }} />
      {legend}
      <Text style={styles.figureCaption}>{caption}</Text>
      {/*
        Beide sind optional; welche steht, entscheidet die jeweilige Ableitung und nicht dieses
        JSX — die Frage „darf diese Aussage im Dokument stehen" ist fachlich und hätte an zwei
        Orten zwei Antworten. Das Lastgang-Kapitel übergibt keine von beiden: unter einer reinen
        Messung steht die Bildunterschrift und sonst nichts.
      */}
      {statement && <Text style={styles.figureStatement}>{statement}</Text>}
      {note && <Text style={styles.figureCaption}>{note}</Text>}
    </View>
  )
}

/** Was an der Stelle eines fehlgeschlagenen Bildes steht. */
function figureMissingText(what: string): string {
  return (
    `${what} konnte auf diesem Gerät nicht erzeugt werden. Die Zahlen in diesem Dokument sind ` +
    'davon nicht betroffen — sie stammen aus der Berechnung, nicht aus der Abbildung.'
  )
}

/**
 * Das Lastgang-Kapitel — Überschrift, ein fallunabhängiger Satz, das Bild, der Zeitraum.
 *
 * ── ⚠ ES LEITET NICHTS AB, UND DAS IST DER PUNKT ──────────────────────────────────────────────
 * Es gibt keine `buildLoadChapter`-Ableitung neben den sieben anderen: auf dieser Seite hängt
 * nichts an der Datenlage. Der Vorspann ist eine Konstante (`LOAD_INTRO`), die Bildunterschrift
 * formatiert den bereits abgeleiteten Zeitraum (`loadChartCaption`) — es gibt keine Entscheidung
 * „welche Aussage bleibt bei welchem fehlenden Wert aus", die eine eigene Datei lesbar machen
 * müsste.
 *
 * ⚠ KEIN `statement`, KEIN `note` an `ChartFigure`: unter diesem Bild steht die Bildunterschrift
 * und sonst nichts. Eine Kapp-Schwelle, eine markierte Spitze oder ein gedeuteter Verlauf wären
 * eine Bewertung über einer Messung — und für den gedeuteten Verlauf gibt es überdies keine
 * Rechnung (s. `loadChartCaption`).
 */
function LoadChapter({ input, charts }: { input: PdfReportInput; charts: ReportChartRasters }) {
  return (
    <View style={styles.body}>
      <Text style={styles.h2}>{LOAD_SECTION.title}</Text>
      <Text style={styles.lead}>{LOAD_INTRO}</Text>

      <ChartFigure
        raster={charts.load}
        caption={loadChartCaption(input.period)}
        missing={figureMissingText('Das Lastgang-Diagramm')}
      />
    </View>
  )
}

/**
 * D7 — das Kapitel „… Wege zu weniger Stromkosten": drei bis vier Balken, drei bis fünf Absätze.
 *
 * ── ⚠ DIE ÜBERSCHRIFT ZÄHLT, UND ZWAR AUS DEMSELBEN WERT WIE DIE AGENDA ───────────────────────
 * `context.waysCount` entsteht EINMAL je Dokument; Agenda (`buildReportAgenda`) und diese
 * Überschrift bilden ihren Titel beide daraus (`waysSectionTitle`). Zwei getrennte Zählungen
 * ergäben eine Agenda, die ein anderes Kapitel ankündigt, als danach dasteht — und das sähe man
 * dem Blatt nicht an.
 *
 * ── ⚠ ES GIBT DIESES KAPITEL NICHT IN JEDEM DOKUMENT ──────────────────────────────────────────
 * Nur mit berechenbarem Monatsvergleich (`hasWaysChapter`). Dieselbe Mechanik wie beim
 * „Ladeverhalten"- und „Monatsvergleich"-Kapitel: der Aufrufer entscheidet EINMAL
 * (`context.hasWays`) und lässt die `<Page>` sonst ganz weg, samt Agenda-Eintrag.
 *
 * ⚠ Welche Absätze entstehen, entscheidet `ways.ts`. Keine Verzweigung an einem Contract-Feld in
 * diesem JSX — dieselbe Regel wie bei der Zusammenfassung: fehlt ein Weg, fehlt er schlicht.
 */
function WaysChapter({
  input,
  charts,
  context,
  layout,
}: {
  input: PdfReportInput
  charts: ReportChartRasters
  context: ReportBuildContext
  layout: ReportLayout
}) {
  const chapter = buildWaysChapter(input.analysis)

  return (
    <View style={styles.body}>
      <Text style={styles.h2}>{waysSectionTitle(context.waysCount)}</Text>
      <Text style={styles.lead}>{WAYS_INTRO}</Text>

      <ChartFigure
        raster={charts.ways}
        caption={chapter?.figure.caption ?? ''}
        note={chapter?.figure.note}
        missing={figureMissingText('Das Balkendiagramm')}
      />
      {chapter?.statements.map((statement) => (
        <Statement key={statement.id} statement={statement} layout={layout} />
      ))}
    </View>
  )
}

/**
 * B23c-2 — Empfehlung und Ladesteuerung.
 *
 * ⚠ DAS LASTGANG-BILD IST HIER RAUS und steht als eigenes Kapitel davor (`LoadChapter`). Der Rest
 * der Seite — Kaufaussage und Ladesteuerung — ist unverändert.
 *
 * ── ⚠ WAS AUF DIESER SEITE STEHT, ENTSCHEIDET `recommendation.ts` ─────────────────────────────
 * Hier wird gerendert, was die Ableitung liefert. Keine Verzweigung an einem Contract-Feld in
 * diesem JSX — dieselbe Regel wie bei der Zusammenfassung: fehlt eine Aussage, fehlt sie schlicht.
 */
function RecommendationChapter({
  input,
  context,
  layout,
}: {
  input: PdfReportInput
  context: ReportBuildContext
  layout: ReportLayout
}) {
  const chapter = buildRecommendationChapter(input.analysis, context)

  return (
    <View style={styles.body}>
      <Text style={styles.h2}>{RECOMMENDATION_SECTION.title}</Text>
      <Text style={styles.lead}>{RECOMMENDATION_INTRO}</Text>

      {chapter.recommendation && <Statement statement={chapter.recommendation} layout={layout} />}
      {chapter.loadControl && <Statement statement={chapter.loadControl} layout={layout} />}
    </View>
  )
}

/**
 * B23c-3a — Kostenverlauf und Tages-Energiefluss.
 *
 * ── ⚠ WAS AUF DIESER SEITE STEHT, ENTSCHEIDET `detail.ts` ─────────────────────────────────────
 * Hier wird gerendert, was die Ableitung liefert — keine Verzweigung an einem Contract-Feld in
 * diesem JSX. Insbesondere WELCHER Kostenvergleich steht (Monatsvergleich oder kumulierte Kosten)
 * ist dort entschieden, und `charts.tsx` hat das Bild aus DERSELBEN Entscheidung gerastert. Zwei
 * getrennte Verzweigungen ergäben eine Bildunterschrift, die ein anderes Bild beschreibt als das
 * darüber, und man sähe es der Seite nicht an.
 *
 * ── ⚠ EIN FEHLENDES BILD IST HIER EIN REGELFALL, KEIN FEHLER ──────────────────────────────────
 * Der Tages-Energiefluss entsteht nur, wenn die Simulation überhaupt einen Tag hergibt (keine
 * abgefangene Spitze UND keine PV-Einspeisung ⇒ keiner). Dann steht an seiner Stelle die
 * Begründung — ausgeschrieben in `detail.ts`, nicht hier: „was fehlt und warum" ist eine
 * fachliche Aussage.
 */
function DetailChapter({
  input,
  charts,
  context,
  layout,
}: {
  input: PdfReportInput
  charts: ReportChartRasters
  context: ReportBuildContext
  layout: ReportLayout
}) {
  /* ⚠ `flowDay` kommt weiterhin aus der RASTERUNG und nicht aus dem Kontext — s. `context.ts`. */
  const chapter = buildDetailChapter(input.analysis, { flowDay: charts.flowDay }, context)

  return (
    <View style={styles.body}>
      <Text style={styles.h2}>{DETAIL_SECTION.title}</Text>
      <Text style={styles.lead}>{DETAIL_INTRO}</Text>

      <ChartFigure
        raster={charts.cost}
        caption={chapter.cost?.figure.caption ?? ''}
        note={chapter.cost?.figure.note}
        /* `costMissing` steht, wenn es gar nichts zu vergleichen gab; sonst ist ein fehlendes
           Bild ein Fehlschlag der Rasterung, und der bekommt den Fehlschlag-Satz. */
        missing={chapter.costMissing ?? figureMissingText('Der Kostenvergleich')}
      />
      {chapter.cost?.statement && <Statement statement={chapter.cost.statement} layout={layout} />}

      <ChartFigure
        raster={charts.flow}
        caption={chapter.flow?.caption ?? ''}
        note={chapter.flow?.note}
        missing={chapter.flowMissing ?? figureMissingText('Der Tages-Energiefluss')}
      />
    </View>
  )
}

/**
 * D7 — der Monatsvergleich als eigenes Kapitel.
 *
 * ── ⚠ ES GIBT DIESES KAPITEL NICHT IN JEDEM DOKUMENT ──────────────────────────────────────────
 * Nur ohne Bestandsanlage (`hasMonthlyChapter`); mit einer steht derselbe Vergleich im
 * Detail-Kapitel an der Stelle des Kostenverlaufs. Der Aufrufer entscheidet das EINMAL und lässt
 * die `<Page>` sonst ganz weg — samt Agenda-Eintrag, wie beim „Ladeverhalten".
 *
 * ⚠ Bildunterschrift und Zeilen kommen aus DERSELBEN Ableitung wie im Bestandsfall
 * (`buildMonthly`), nur mit dem anderen Wortlaut für die dritte Reihe. Zwei Fassungen liefen beim
 * nächsten Umformulieren auseinander.
 */
function MonthlyChapter({
  input,
  charts,
  layout,
}: {
  input: PdfReportInput
  charts: ReportChartRasters
  layout: ReportLayout
}) {
  const chapter = buildMonthlyChapter(input.analysis)

  return (
    <View style={styles.body}>
      <Text style={styles.h2}>{MONTHLY_SECTION.title}</Text>
      <Text style={styles.lead}>{MONTHLY_INTRO}</Text>

      <ChartFigure
        raster={charts.monthly}
        caption={chapter?.figure.caption ?? ''}
        note={chapter?.figure.note}
        missing={figureMissingText('Der Monatsvergleich')}
      />
      {chapter && <Statement statement={chapter.statement} layout={layout} />}
    </View>
  )
}

/**
 * Die Legende der Stunden-Heatmap — drei Farbmuster, nativ.
 *
 * ── ⚠ SIE IST NICHT TEIL DES BILDES, UND DAS IST DER PUNKT DIESES SCHRITTS ────────────────────
 * Gerastert wird ausschliesslich das Raster (D11: Text gehört nativ neben das Bild). Die Legende
 * der Komponente liegt darunter in der Karte und käme deshalb im PDF gar nicht vor — ein
 * Farbraster ohne Schlüssel. Sie wird hier aus DENSELBEN Tokens gebaut, mit denen die Komponente
 * zeichnet (`PDF_COLORS.accent`/`ink`/`border` sind die wörtliche Abschrift von
 * `--color-accent`/`--color-ink`/`--color-border`, s. `theme.ts`).
 *
 * ⚠ Das dritte Muster ist LEER mit gestricheltem Rand — genau wie eine Zelle ohne Messwert. Der
 * Unterschied zu einer gemessenen Null (hellste Stufe der Skala) ist bei einem Teiljahres-Lastgang
 * die halbe Grafik; eine Legende, die ihn nicht führt, liesse den Leser beides für dasselbe halten.
 */
/**
 * Die Farbleiste der Heatmap (D15 Block 2, Punkt 12).
 *
 * ── ⚠ WARUM SIE HIER STEHT UND NICHT IM BILD (Punkt 17 ausdrücklich NICHT umgesetzt) ───────────
 * Die Bestandsaufnahme notiert unter Punkt 17 „Legende ins Bild statt als react-pdf-Block
 * darunter", weil das Zielbild sie im Bild führt. Das wäre hier ein RÜCKSCHRITT: der Rasteranker
 * `stunden-heatmap-raster` schneidet Titel, Beschreibung und Legende bewusst AUS dem Bild heraus
 * (B23c-3b-1, D11), damit dieser Text im PDF durchsuchbar und kopierbar bleibt statt als
 * Bildpunkte dazuliegen. Das Zielbild ist ein von Hand gesetztes PDF und kannte diese Trennung
 * nicht. Was Punkt 12 wirklich verlangt — eine BESCHRIFTETE Skala statt zweier Farbtupfer —
 * lässt sich nativ genauso haben, und genau das steht hier.
 */
function HeatmapScale() {
  /* Sieben Stufen: die beiden Enden, die Null in der Mitte, dazwischen je zwei Zwischenstufen. */
  const steps = [-1, -0.66, -0.33, 0, 0.33, 0.66, 1]
  return (
    <View style={styles.scale}>
      <Text style={styles.scaleEnd}>mehr entladen</Text>
      <View style={styles.scaleBar}>
        {steps.map((step) => (
          <View
            key={step}
            style={[styles.scaleStep, { backgroundColor: chartCellColor(step, 1) }]}
          />
        ))}
      </View>
      <Text style={styles.scaleEnd}>mehr geladen</Text>
    </View>
  )
}

function HeatmapLegend() {
  return (
    <View style={styles.legend}>
      <HeatmapScale />
      <View style={styles.legendItem}>
        <View
          style={[
            styles.legendSwatch,
            {
              borderWidth: 0.75,
              borderColor: PDF_COLORS.border,
              borderStyle: 'dashed',
            },
          ]}
        />
        <Text style={styles.legendLabel}>keine Messwerte</Text>
      </View>
    </View>
  )
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Report-Baukasten C — die abwählbaren Bausteine
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Ein Baustein aus dem KATALOG, sofern die Admin-Auswahl ihn zeigt.
 *
 * ── ⚠ DIE EINZIGEN STELLEN, AN DENEN DAS DOKUMENT ÜBER DIE REGISTRY GEHT ──────────────────────
 * Die übrigen Bausteine kommen weiterhin aus ihrer Kapitel-Fassade. Das ist kein halber Umbau,
 * sondern der Zuschnitt dieses Schritts: `document.tsx` ganz auf den Katalog umzustellen ist ein
 * eigener Weg mit eigenem Nachweis (`registry.ts`: „Die Umstellung des Renderers ist ein eigener
 * Schritt"), und er hat mit der Auswahl nichts zu tun.
 *
 * ── ⚠ WARUM DER `form`-VERGLEICH DASTEHT ──────────────────────────────────────────────────────
 * Er verengt den Rückgabetyp von `build()` — ohne ihn liefert der Eintrag die Union aller vier
 * Formen, und `<Statement>` bekäme womöglich eine Tabelle. Träte der Fall je ein (eine Kennung
 * wechselt die Form), fällt der Baustein hier still weg statt das Dokument zu kosten; gemessen
 * wird die Zuordnung in `registry.test.ts`.
 */
function selectedStatement(
  registry: ReportBaukastenRegistry,
  input: PdfReportInput,
  id: ReportOptionalSection,
): ReportStatement | null {
  if (!reportSectionEnabled(input.optionalSections, id)) return null
  const entry = registry.get(id)
  return entry.form === 'statement' ? entry.build() : null
}

/** Wie `selectedStatement`, für die zwei Hinweise des Schlusskapitels. */
function selectedNotice(
  registry: ReportBaukastenRegistry,
  input: PdfReportInput,
  id: ReportOptionalSection,
): ReportNotice | null {
  if (!reportSectionEnabled(input.optionalSections, id)) return null
  const entry = registry.get(id)
  return entry.form === 'notice' ? entry.build() : null
}

/**
 * Wie `selectedStatement`, für die Kandidatentabelle (B3-1).
 *
 * ⚠ ÜBER DIE REGISTRY UND NICHT ÜBER `chapter.table`: `layout.ts` bildet die Beschreibung aus
 * derselben Registry, und die zwei Wege müssen dieselbe Antwort geben — sonst löst ein Satz
 * seinen Verweis gegen eine Tabelle auf, die das Blatt nicht zeigt. Dass beide Wege denselben
 * Wert liefern, misst `registry.test.ts`.
 */
function selectedTable(
  registry: ReportBaukastenRegistry,
  input: PdfReportInput,
  id: ReportOptionalSection,
): ReportTable | null {
  if (!reportSectionEnabled(input.optionalSections, id)) return null
  const entry = registry.get(id)
  return entry.form === 'table' ? entry.build() : null
}

/**
 * B23c-3b-1 — das Ladeverhalten: Stunden-Heatmap und Ø-Ladepreis.
 *
 * ── ⚠ DIESES KAPITEL GIBT ES NICHT IN JEDEM DOKUMENT ──────────────────────────────────────────
 * Es entsteht nur, wenn wenigstens eines der beiden Bilder entsteht (`hasInsightChapter`). Der
 * Aufrufer entscheidet das EINMAL und lässt die `<Page>` sonst ganz weg — samt Agenda-Eintrag. Ein
 * Kapitel, das nur sagt, dass es leer ist, wäre ein Agenda-Eintrag auf eine leere Seite (D14).
 *
 * ── ⚠ WAS AUF DIESER SEITE STEHT, ENTSCHEIDET `insight.ts` ────────────────────────────────────
 * Hier wird gerendert, was die Ableitung liefert — keine Verzweigung an einem Contract-Feld in
 * diesem JSX, und insbesondere keine Zweitprüfung an `tariffOptimization`. `charts.tsx` hat die
 * Bilder aus DERSELBEN Ableitung gerastert; zwei getrennte Entscheidungen ergäben eine Legende und
 * Kennzahlen, die zu einem anderen Bild gehören als dem darüber.
 */
function InsightChapter({
  input,
  charts,
  context,
  registry,
  layout,
}: {
  input: PdfReportInput
  charts: ReportChartRasters
  context: ReportBuildContext
  registry: ReportBaukastenRegistry
  layout: ReportLayout
}) {
  const chapter = buildInsightChapter(input.analysis, context)

  /*
   * ⚠ Report-Baukasten C: BILD UND AUSSAGE FALLEN GEMEINSAM. Nur den `<Statement>` abzuschalten
   * liesse die `<ChartFigure>` stehen — und die rendert ohne Raster ihren `missing`-Satz, der den
   * fachlichen Grund für ein fehlendes Bild nennt. Bei einer ABGEWÄHLTEN Grafik gibt es keinen
   * fachlichen Grund; der Satz behauptete dann etwas über die Daten, das nicht stimmt. Gerastert
   * wird sie deshalb auch gar nicht erst (`charts.tsx`).
   */
  const showHourFlow = reportSectionEnabled(input.optionalSections, 'hour_flow')
  const showChargePrice = reportSectionEnabled(input.optionalSections, 'charge_price')
  const hourFlow = selectedStatement(registry, input, 'hour_flow')
  const chargePrice = selectedStatement(registry, input, 'charge_price')

  return (
    <View style={styles.body}>
      <Text style={styles.h2}>{INSIGHT_SECTION.title}</Text>
      <Text style={styles.lead}>{INSIGHT_INTRO}</Text>

      {showHourFlow && (
        <ChartFigure
          raster={charts.hourFlow}
          caption={chapter.hourFlow?.figure.caption ?? ''}
          legend={<HeatmapLegend />}
          /* `hourFlowMissing` steht, wenn es für diesen Fall gar kein Raster gibt; sonst ist ein
             fehlendes Bild ein Fehlschlag der Rasterung und bekommt den Fehlschlag-Satz. */
          missing={chapter.hourFlowMissing ?? figureMissingText('Die Stunden-Heatmap')}
        />
      )}
      {hourFlow && <Statement statement={hourFlow} layout={layout} />}

      {showChargePrice && (
        <ChartFigure
          raster={charts.chargePrice}
          caption={chapter.chargePrice?.figure.caption ?? ''}
          note={chapter.chargePrice?.figure.note}
          missing={chapter.chargePriceMissing ?? figureMissingText('Der Ø-Ladepreis')}
        />
      )}
      {chargePrice && <Statement statement={chargePrice} layout={layout} />}
    </View>
  )
}

/**
 * B23c-3b-2 — Speichergrösse und Gerätewahl: die Grenznutzen-Kurve und die Vergleichstabelle.
 *
 * ── ⚠ DIESES KAPITEL GIBT ES NICHT IN JEDEM DOKUMENT ──────────────────────────────────────────
 * Es ist das zweite bedingte Kapitel (nach dem Ladeverhalten): ohne Zusatzszenario und ohne
 * Alternative zur Empfehlung entfällt es samt Agenda-Eintrag. Der Aufrufer entscheidet das EINMAL
 * und lässt die `<Page>` sonst ganz weg.
 *
 * ── ⚠ WAS AUF DIESER SEITE STEHT, ENTSCHEIDET `comparison.ts` ─────────────────────────────────
 * Hier wird gerendert, was die Ableitung liefert — keine Verzweigung an einem Contract-Feld in
 * diesem JSX. Insbesondere ob unter der Kurve eine TABELLE oder der KLARSATZ steht, ist dort
 * entschieden; `charts.tsx` hat das Bild aus DERSELBEN Ableitung gerastert.
 *
 * ⚠ Die Kurve steht ÜBER der Aussage — ausser im Klarsatz-Fall, wo sie darunter rückt (B3-2a).
 * Die Einleitung einer Tabelle nach der Tabelle zu lesen wäre ein Nachtrag; das VERDIKT dagegen
 * ist die Antwort auf die Kapitelfrage, und eine Antwort gehört vor ihren Beleg. Die Kurve bleibt
 * genau deshalb stehen: sie zeigt, dass die Linie über alle Grössen unter der Nulllinie bleibt
 * (`comparison.ts`) — das Zielbild lässt sie auf seiner Verdikt-Seite weg und hat den Beleg dann
 * nirgends.
 */
function ComparisonChapter({
  input,
  charts,
  context,
  registry,
  layout,
}: {
  input: PdfReportInput
  charts: ReportChartRasters
  context: ReportBuildContext
  registry: ReportBaukastenRegistry
  layout: ReportLayout
}) {
  const chapter = buildComparisonChapter(input.analysis, context)
  /* Report-Baukasten C: abgewählt fällt mit der Tabelle auch die Navy-Kopfzeile und das Zebra weg
     — beides lebt in `StatementTable` und nicht daneben. Die Klarsätze darüber bleiben und nennen
     sie dann nicht mehr (`comparison.ts`, `tableRef`). */
  const table = selectedTable(registry, input, CANDIDATE_TABLE_ID)
  /* B3-2a — das Verdikt führt die Seite an, die Einleitung einer Tabelle nicht. Die Bedingung ist
     die dokumentierte Invariante aus `comparison.ts`: `table === null` GENAU DANN, wenn die Aussage
     der Klarsatz ist — und ausdrücklich NICHT `selectedTable` daneben, die auch die ABWAHL der
     Tabelle trifft (dann bleibt die Einleitung eine Einleitung und steht weiter unter der Kurve). */
  const verdictLeads = chapter.table === null

  return (
    <View style={styles.body}>
      <Text style={styles.h2}>{COMPARISON_SECTION.title}</Text>
      <Text style={styles.lead}>{COMPARISON_INTRO}</Text>

      {verdictLeads && <Statement statement={chapter.statement} layout={layout} />}

      <ChartFigure
        raster={charts.comparison}
        caption={chapter.figure?.caption ?? ''}
        note={chapter.figure?.note}
        /* `figureMissing` steht, wenn es für diesen Fall gar keine Kurve gibt; sonst ist ein
           fehlendes Bild ein Fehlschlag der Rasterung und bekommt den Fehlschlag-Satz. */
        missing={chapter.figureMissing ?? figureMissingText('Die Grenznutzen-Kurve')}
      />

      {!verdictLeads && <Statement statement={chapter.statement} layout={layout} />}
      {table && <StatementTable table={table} from={CANDIDATE_TABLE_ID} layout={layout} />}
    </View>
  )
}

function MethodologyChapter() {
  return (
    <View style={styles.body}>
      <Text style={styles.h2}>{METHODOLOGY_SECTION.title}</Text>
      <Text style={styles.lead}>{METHODOLOGY_INTRO}</Text>
      <View style={styles.itemList}>
        {METHODOLOGY_ITEMS.map((item) => (
          <View key={item.id} style={styles.item} wrap={false}>
            <Text style={styles.itemTitle}>{item.title}</Text>
            <Text style={styles.itemBody}>{item.body}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

/**
 * B23c-4 — Annahmen und Datengrundlage: das Schlusskapitel.
 *
 * ── ⚠ WAS AUF DIESER SEITE STEHT, ENTSCHEIDET `basis.ts` ──────────────────────────────────────
 * Hier wird gerendert, was die Ableitung liefert — keine Verzweigung an einem Contract-Feld in
 * diesem JSX. Ob es einen Datenqualitäts-Kasten gibt, ob ein Blocker-Befund dasteht und ob der
 * Preisstand-Hinweis erscheint, ist dort (bzw. in `derive.ts`) entschieden. Fehlt einer, fehlt er
 * hier schlicht in der Liste.
 *
 * ── DIE REIHENFOLGE IST DIE DES BILDSCHIRMS ───────────────────────────────────────────────────
 * Erst womit gerechnet wurde (Annahmen), dann was an den Daten war (Qualität), dann was NICHT
 * gerechnet werden konnte (Blocker), dann die Herkunft der Tarifwerte und ihr Preisstand, zuletzt
 * der Vorbehalt. Vom Bekannten zum Fehlenden — wer bis hierher liest, sucht die Grenzen.
 *
 * ⚠ D9 SETZT ZWEI ABSCHNITTE ANS ENDE DIESER FOLGE, NICHT DAZWISCHEN: erst die Methodik je
 * Kennzahl (wie die Zahlen davor entstanden sind), dann die bekannten Einschränkungen (was in
 * ihnen nicht steckt), dann der Vorbehalt. Vor die Tabellen gezogen stünden beide vor den Werten,
 * über die sie sprechen.
 *
 * ⚠ Das Kapitel ist eine eigene `<Page>` (D5, Regel 1) und ausdrücklich KEIN drittes bedingtes
 * Kapitel: Annahmen, Tarifherkunft und Vorbehalt gibt es in jedem Report.
 */
function BasisChapter({
  input,
  context,
  registry,
  layout,
}: {
  input: PdfReportInput
  context: ReportBuildContext
  registry: ReportBaukastenRegistry
  layout: ReportLayout
}) {
  const chapter = buildBasisChapter(input, context)

  /*
   * ⚠ Report-Baukasten C: DIE AUSWAHL HAT HIER SCHON GEGRIFFEN, BEVOR SIE GELESEN WIRD. Beide
   * Hinweise entstehen im Kontext (`context.ts` → `dataQualityNoticeOf`/`pvOutageNoticeOf`), und
   * daran hängen zwei Abhängige, die im JSX gar nicht vorkommen: der Verweis „wie im
   * Datenqualitäts-Hinweis oben" in der Datenquellen-Tabelle und der Methodik-Absatz
   * `method_pv_outage`. Erst hier abgeschaltet blieben beide stehen und verwiesen auf einen
   * Hinweis, den dieses Dokument nicht zeigt.
   */
  const dataQuality = selectedNotice(registry, input, 'data_quality')
  const pvOutage = selectedNotice(registry, input, 'pv_outage')

  return (
    <View style={styles.body}>
      <Text style={styles.h2}>{BASIS_SECTION.title}</Text>
      <Text style={styles.lead}>{BASIS_INTRO}</Text>

      <Statement statement={chapter.assumptions} layout={layout} />
      {dataQuality && <Notice notice={dataQuality} />}
      {chapter.blocker && <Notice notice={chapter.blocker} />}
      {/* D5 — was die PV-Anlage im Lastgang gezeigt hat. Auch das eine Feststellung ÜBER die
          Datengrundlage und keine Zahl: sie steht deshalb bei den anderen beiden und nicht in
          einem eigenen Kapitel. Ob sie erscheint, entscheidet `basis.ts`. */}
      {pvOutage && <Notice notice={pvOutage} />}

      <Text style={styles.provenance}>{chapter.tariffSource}</Text>
      {/*
        ⚠ NICHT `chapter.tariffVintage` selbst — der volle Satz steht seit PR #298 bereits als
        eigener Hinweiskasten im Kapitel „Voraussetzungen" (`prerequisites.ts`,
        `buildPriceBasisNotice`). Die BEDINGUNG bleibt dieselbe (ein Treffer heisst: der
        ausgewertete Zeitraum reicht in ein laufendes Kalenderjahr); nur der TEXT ist jetzt ein
        Zeiger dorthin, wortgleiches Muster zu `RESULTS_FOOTNOTE`.
      */}
      {chapter.tariffVintage && (
        <Text style={styles.provenance}>{BASIS_TARIFF_VINTAGE_FOOTNOTE}</Text>
      )}

      {/* D9 — die Tarifgrössen im Einzelnen. Sie steht direkt unter den beiden Herkunftssätzen,
          weil ihre Status-Spalte genau deren Aussage Feld für Feld wiederholt: erst der Satz über
          den Stand, dann die Zeilen, für die er gilt. */}
      <View style={styles.statement}>
        <Text style={styles.statementTitle}>Tarifkomponenten</Text>
        <StatementTable
          table={chapter.tariffComponents}
          from={TARIFF_COMPONENTS_TABLE_ID}
          layout={layout}
          allowPageBreak
        />
      </View>

      {/* D9 — woher die Angaben stammen, Zeile für Zeile. Sie steht NACH den beiden
          Herkunftssätzen und vor dem Vorbehalt: die Sätze sagen, welcher Tarifstand gerechnet
          wurde, die Tabelle belegt ihn und alles daneben. */}
      <View style={styles.statement}>
        <Text style={styles.statementTitle}>Datenquellen</Text>
        <StatementTable
          table={chapter.dataSources}
          from={DATA_SOURCES_TABLE_ID}
          layout={layout}
          allowPageBreak
        />
      </View>

      {/* D9 — wie die einzelnen Zahlen zustande kamen. Die Überschrift hängt an der Liste und nicht
          daneben: ohne einen einzigen erreichbaren Absatz stünde sie über einer Leerstelle. Welche
          Kennzahl einen Absatz bekommt, entscheidet `basis.ts`. */}
      {chapter.methodPerMetric.length > 0 && (
        <View style={styles.statement}>
          <Text style={styles.statementTitle}>Berechnungsmethodik je Kennzahl</Text>
          <View style={styles.methodList}>
            {chapter.methodPerMetric.map((item) => (
              <View key={item.id} style={styles.methodItem} wrap={false}>
                <Text style={styles.itemTitle}>{item.title}</Text>
                <Text style={styles.itemBody}>{item.body}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* D9 — was die Rechnung selbst nicht enthält. UNBEDINGT und als letzter der vier Hinweise
          dieses Kapitels: die drei darüber melden Eigenschaften DIESES Datensatzes und schweigen
          ohne Befund, dieser gilt für jeden Report. Er steht hinter der Methodik, weil er die
          Grenzen genau der Rechnung benennt, die eine Zeile davor erklärt wurde. */}
      <Notice notice={chapter.limitations} />

      {/*
        ⚠ Derselbe Vorbehalt wie auf dem Deckblatt, aus DERSELBEN Konstante — s. `REPORT_DISCLAIMER`
        in `content.ts`. Dass er zweimal steht, ist Absicht (ein weitergereichter Report wird von
        beiden Enden gelesen); dass er zweimal ANDERS stünde, wäre es nicht. Der CSS-Weg trägt ihn
        ebenso zweimal.
      */}
      <Text style={styles.footnote}>{REPORT_DISCLAIMER}</Text>
    </View>
  )
}

/**
 * Das Dokument.
 *
 * `agenda` trägt die im ERSTEN Durchlauf gemessenen Seitenzahlen; `null` heisst „noch nicht
 * gemessen" (erster Durchlauf) oder „bewusst ohne Zahlen" (der dokumentierte Rückfall). In beiden
 * Fällen bleibt die Zahlenspalte an ihrem Platz und leer — der Umbruch ist dadurch in beiden
 * Durchläufen derselbe, und genau darauf beruht die Richtigkeit der gedruckten Zahlen.
 */
export function ReportDocument({
  input,
  charts,
  context,
  registry,
  layout,
  agenda,
  sink,
}: {
  input: PdfReportInput
  /**
   * Die fertigen Chart-Bilder — EINMAL je Dokument erzeugt (`render.tsx` → `charts.ts`), nicht je
   * Durchlauf. Bit-identisch über alle Durchläufe und damit derselbe Umbruch; s. `ChartFigure`.
   */
  charts: ReportChartRasters
  /**
   * Report-Baukasten B1 — die Zwischenwerte, EINMAL je Dokument gebildet (`render.tsx` →
   * `context.ts`), nicht je Durchlauf. Dieselbe Zusage und derselbe Zeitpunkt wie bei `charts`:
   * alle Durchläufe rechnen mit bit-identischen Werten.
   */
  context: ReportBuildContext
  /**
   * Report-Baukasten B2/C — der Katalog, EINMAL je Dokument gebildet (`render.tsx` →
   * `registry.ts`). Gelesen werden daraus genau die vier abwählbaren Bausteine; die übrigen 24
   * kommen weiterhin aus ihrer Kapitel-Fassade (s. `selectedStatement`).
   */
  registry: ReportBaukastenRegistry
  /**
   * Stufe D — die Beschreibung des zusammengestellten Dokuments, EINMAL je Erzeugung gebildet
   * (`render.tsx` → `layout.ts`). Gegen sie lösen `Statement` und `StatementTable` ihre
   * Querverweise auf; dieselbe Zusage und derselbe Zeitpunkt wie bei `context` und `registry`.
   */
  layout: ReportLayout
  agenda: AgendaPageNumbers
  sink: PageNumberSink
}) {
  /*
   * ⚠ EINMAL ENTSCHIEDEN, ZWEIMAL GELESEN (B23c-3b-1): die Agenda führt den Eintrag genau dann,
   * wenn die `<Page>` darunter entsteht. Zwei getrennte Auswertungen ergäben entweder einen
   * Eintrag mit dauerhaft leerer Zahlenspalte (kein Sentinel meldet je) oder ein Kapitel, das die
   * Agenda verschweigt — beides sähe man dem Dokument nicht an.
   *
   * ⚠ B1: entschieden wird jetzt im KONTEXT, einmal je Dokument statt einmal je Durchlauf. Diese
   * Funktion läuft zwei- bis dreimal (`render.tsx`) — sie LIEST die Antwort nur noch.
   */
  const { hasWays, hasMonthly, hasComparison } = context

  /*
   * ⚠ Report-Baukasten C: KAPITEL 5 FÄLLT MIT SEINEN BEIDEN BAUSTEINEN. Sind beide abgewählt,
   * bliebe sonst eine Seite mit Überschrift, Vorspann und nichts darunter — samt Agenda-Eintrag,
   * der genau dorthin verweist (D14: „Ein Kapitel, das nur sagt, dass es leer ist"). Die Grösse
   * wird weiterhin GENAU EINMAL gebildet und von Agenda und Seitenbaum gemeinsam gelesen.
   */
  const hasInsight =
    context.hasInsight &&
    (reportSectionEnabled(input.optionalSections, 'hour_flow') ||
      reportSectionEnabled(input.optionalSections, 'charge_price'))

  /*
   * Die Zuordnung in der Kopfzeile (D15 Block 1, Punkt 7). `null`, wenn kein Kunde erfasst ist —
   * ein Platzhalterstrich auf jedem Blatt sähe aus wie ein Fehler beim Erzeugen, dieselbe
   * Überlegung wie auf dem Deckblatt.
   */
  const docLabel = input.customer?.company || input.customer?.name || null

  return (
    <Document
      title={input.title}
      subject={input.subtitle}
      author={PRINT_COMPANY.name}
      creator={PRINT_COMPANY.name}
      producer={PRINT_COMPANY.name}
      language="de-AT"
    >
      {/*
        ⚠ `navyPage` statt `page`, und OHNE `PageFurniture` — s. den Kopf von `Cover`. Die
        Seitenzählung bleibt davon unberührt: sie kommt aus react-pdf, nicht aus der Fusszeile.
      */}
      <Page size="A4" style={styles.navyPage}>
        <Cover input={input} />
      </Page>

      <Page size="A4" style={styles.page}>
        <PageFurniture sink={sink} docLabel={docLabel} />
        <SectionAnchor id="agenda" sink={sink} />
        <Agenda
          sections={buildReportAgenda({
            ways: hasWays,
            waysCount: context.waysCount,
            monthly: hasMonthly,
            insight: hasInsight,
            comparison: hasComparison,
          })}
          pages={agenda}
        />
      </Page>

      <Page size="A4" style={styles.page}>
        <PageFurniture sink={sink} docLabel={docLabel} />
        <SectionAnchor id={RESULTS_SECTION.id} sink={sink} />
        <ResultsChapter input={input} context={context} layout={layout} />
      </Page>

      <Page size="A4" style={styles.page}>
        <PageFurniture sink={sink} docLabel={docLabel} />
        <SectionAnchor id={PREREQUISITES_SECTION.id} sink={sink} />
        <PrerequisitesChapter input={input} layout={layout} />
      </Page>

      <Page size="A4" style={styles.page}>
        <PageFurniture sink={sink} docLabel={docLabel} />
        <SectionAnchor id={LOAD_SECTION.id} sink={sink} />
        <LoadChapter input={input} charts={charts} />
      </Page>

      {hasWays && (
        <Page size="A4" style={styles.page}>
          <PageFurniture sink={sink} docLabel={docLabel} />
          <SectionAnchor id={WAYS_SECTION.id} sink={sink} />
          <WaysChapter input={input} charts={charts} context={context} layout={layout} />
        </Page>
      )}

      <Page size="A4" style={styles.page}>
        <PageFurniture sink={sink} docLabel={docLabel} />
        <SectionAnchor id={RECOMMENDATION_SECTION.id} sink={sink} />
        <RecommendationChapter input={input} context={context} layout={layout} />
      </Page>

      <Page size="A4" style={styles.page}>
        <PageFurniture sink={sink} docLabel={docLabel} />
        <SectionAnchor id={DETAIL_SECTION.id} sink={sink} />
        <DetailChapter input={input} charts={charts} context={context} layout={layout} />
      </Page>

      {hasMonthly && (
        <Page size="A4" style={styles.page}>
          <PageFurniture sink={sink} docLabel={docLabel} />
          <SectionAnchor id={MONTHLY_SECTION.id} sink={sink} />
          <MonthlyChapter input={input} charts={charts} layout={layout} />
        </Page>
      )}

      {hasInsight && (
        <Page size="A4" style={styles.page}>
          <PageFurniture sink={sink} docLabel={docLabel} />
          <SectionAnchor id={INSIGHT_SECTION.id} sink={sink} />
          <InsightChapter
            input={input}
            charts={charts}
            context={context}
            registry={registry}
            layout={layout}
          />
        </Page>
      )}

      {hasComparison && (
        <Page size="A4" style={styles.page}>
          <PageFurniture sink={sink} docLabel={docLabel} />
          <SectionAnchor id={COMPARISON_SECTION.id} sink={sink} />
          <ComparisonChapter
            input={input}
            charts={charts}
            context={context}
            registry={registry}
            layout={layout}
          />
        </Page>
      )}

      <Page size="A4" style={styles.page}>
        <PageFurniture sink={sink} docLabel={docLabel} />
        <SectionAnchor id={METHODOLOGY_SECTION.id} sink={sink} />
        <MethodologyChapter />
      </Page>

      <Page size="A4" style={styles.page}>
        <PageFurniture sink={sink} docLabel={docLabel} />
        <SectionAnchor id={BASIS_SECTION.id} sink={sink} />
        <BasisChapter input={input} context={context} registry={registry} layout={layout} />
      </Page>

      {/*
        Die Abschlussseite — bewusst OHNE `SectionAnchor` und ohne Eintrag in der Agenda: sie ist
        kein Kapitel, sondern die Rückseite des Dokuments. Ein Agenda-Eintrag „Kontakt" verspräche
        einen Inhalt, den man nachschlägt; diese Seite findet man, indem man das Blatt umdreht.
      */}
      <Page size="A4" style={styles.navyPage}>
        <Outro input={input} />
      </Page>
    </Document>
  )
}
