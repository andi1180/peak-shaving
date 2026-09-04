import type { ReactNode } from 'react'
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

import { PRINT_COMPANY } from '@/lib/company'
import type { ReportChartRasters } from './charts'
import { fitRasterToWidth, type ChartRaster } from './chart-raster'
import {
  BASIS_INTRO,
  BASIS_SECTION,
  buildReportAgenda,
  COMPARISON_INTRO,
  COMPARISON_SECTION,
  DETAIL_INTRO,
  DETAIL_SECTION,
  INSIGHT_INTRO,
  INSIGHT_SECTION,
  METHODOLOGY_INTRO,
  METHODOLOGY_ITEMS,
  METHODOLOGY_SECTION,
  RECOMMENDATION_INTRO,
  RECOMMENDATION_SECTION,
  REPORT_DISCLAIMER,
  RESULTS_FOOTNOTE,
  RESULTS_INTRO,
  RESULTS_SECTION,
  type ReportSection,
} from './content'
import { buildBasisChapter } from './basis'
import { buildComparisonChapter, hasComparisonChapter } from './comparison'
import { buildDetailChapter } from './detail'
import { buildInsightChapter, hasInsightChapter } from './insight'
import { buildRecommendationChapter } from './recommendation'
import {
  recordSectionPage,
  recordTotalPages,
  sectionHasPageNumber,
  type AgendaPageNumbers,
  type PageNumberSink,
} from './page-numbers'
import type {
  ReportNotice,
  ReportRow,
  ReportStatement,
  ReportTable,
  ReportTone,
} from './statement'
import { buildReportSummary } from './summary'
import { PDF_COLORS, PDF_CONTENT_WIDTH_PT, PDF_LAYOUT, PDF_TYPE } from './theme'
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
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  headerMark: { width: 13, height: 13 },
  headerWordmark: {
    fontSize: PDF_TYPE.small,
    fontWeight: 600,
    color: PDF_COLORS.navy,
    letterSpacing: 0.6,
  },
  headerBar: { marginTop: 4, height: 2, backgroundColor: PDF_COLORS.navy },

  /* Fusszeile — im unteren Seitenrand, auf JEDER Seite. */
  footer: {
    position: 'absolute',
    bottom: PDF_LAYOUT.footerBottom,
    left: PDF_LAYOUT.pageHorizontal,
    right: PDF_LAYOUT.pageHorizontal,
    borderTopWidth: 0.5,
    borderTopColor: PDF_COLORS.border,
    paddingTop: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: PDF_TYPE.footer,
    color: PDF_COLORS.textMuted,
  },
  footerRight: { flexDirection: 'row', gap: 4 },

  /** Der Zeilenabstand des Fliesstexts — s. die Warnung an `page`. */
  body: { lineHeight: 1.45 },

  h2: { fontSize: PDF_TYPE.h2, fontWeight: 600, color: PDF_COLORS.ink },
  lead: { marginTop: 3, fontSize: PDF_TYPE.body, color: PDF_COLORS.textMuted },

  /* Deckblatt */
  coverBody: { flexGrow: 1, justifyContent: 'center', lineHeight: 1.45 },
  coverTitle: {
    fontSize: PDF_TYPE.cover,
    fontWeight: 700,
    color: PDF_COLORS.ink,
    lineHeight: 1.2,
  },
  coverSubtitle: {
    marginTop: 8,
    fontSize: PDF_TYPE.coverSub,
    color: PDF_COLORS.textMuted,
    lineHeight: 1.4,
  },
  coverCustomer: {
    marginTop: 30,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: PDF_COLORS.accent,
  },
  coverCustomerLabel: {
    fontSize: PDF_TYPE.small,
    color: PDF_COLORS.textMuted,
    letterSpacing: 0.8,
  },
  coverCompany: { marginTop: 3, fontSize: 13, fontWeight: 600, color: PDF_COLORS.ink },
  coverName: { fontSize: PDF_TYPE.body, color: PDF_COLORS.text },
  coverAddress: { marginTop: 3, fontSize: PDF_TYPE.body, color: PDF_COLORS.text },
  coverMeta: {
    marginTop: 30,
    paddingTop: 12,
    borderTopWidth: 0.5,
    borderTopColor: PDF_COLORS.border,
  },
  coverMetaRow: { flexDirection: 'row', marginBottom: 3 },
  coverMetaLabel: { width: 150, color: PDF_COLORS.textMuted },
  coverMetaValue: { fontWeight: 600, color: PDF_COLORS.ink },
  coverDisclaimer: {
    marginTop: 28,
    paddingTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: PDF_COLORS.border,
    fontSize: PDF_TYPE.small,
    color: PDF_COLORS.textMuted,
  },

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
  agendaChapterLabel: { flexGrow: 1, fontWeight: 600, color: PDF_COLORS.ink },
  /* ⚠ FESTE BREITE, EINZEILIG — s. `measurementsAgree` in `page-numbers.ts`. */
  agendaPageCell: { width: 28, textAlign: 'right', color: PDF_COLORS.textMuted },
  agendaItem: { marginTop: 4, marginLeft: 14, color: PDF_COLORS.textMuted },
  agendaHint: { marginTop: 20, fontSize: PDF_TYPE.small, color: PDF_COLORS.textMuted },

  /* Kapitel-Inhalte */
  itemList: { marginTop: 14 },
  item: { marginBottom: 11 },
  itemTitle: { fontSize: PDF_TYPE.h3, fontWeight: 600, color: PDF_COLORS.ink },
  itemBody: { marginTop: 1, color: PDF_COLORS.textMuted },
  /* Kernergebnisse (B23c-1) */
  headline: {
    marginTop: 14,
    padding: 14,
    backgroundColor: PDF_COLORS.surfaceAlt,
    borderWidth: 0.5,
    borderColor: PDF_COLORS.border,
    flexDirection: 'row',
    gap: 24,
  },
  headlineCell: { flexGrow: 1, flexBasis: 0 },
  headlineValue: { fontSize: 22, fontWeight: 700, color: PDF_COLORS.ink },
  /* Kosten in Rot — dieselbe Farbzuordnung wie `key-metric.tsx` am Bildschirm. */
  headlineValueCost: { fontSize: 22, fontWeight: 700, color: PDF_COLORS.negative },
  headlineCaption: { marginTop: 2, fontSize: PDF_TYPE.small, color: PDF_COLORS.textMuted },

  statement: { marginTop: 14 },
  statementTitle: { fontSize: PDF_TYPE.h3, fontWeight: 600, color: PDF_COLORS.ink },
  statementAmountRow: { marginTop: 3, flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  statementAmount: { fontSize: 15, fontWeight: 700 },
  statementAmountCaption: { fontSize: PDF_TYPE.small, color: PDF_COLORS.textMuted },
  statementBody: { marginTop: 3, color: PDF_COLORS.textMuted },

  rowList: { marginTop: 5 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 2.5,
    paddingBottom: 2.5,
    borderTopWidth: 0.5,
    borderTopColor: PDF_COLORS.border,
  },
  rowTotal: { borderTopWidth: 1, borderTopColor: PDF_COLORS.border },
  rowLabelCell: { flexGrow: 1, flexBasis: 0 },
  rowLabel: { color: PDF_COLORS.textMuted },
  rowLabelTotal: { fontWeight: 600, color: PDF_COLORS.ink },
  rowHint: { fontSize: PDF_TYPE.small, color: PDF_COLORS.textMuted },
  rowValue: { fontWeight: 600 },

  statementNote: { marginTop: 2, fontSize: PDF_TYPE.small, color: PDF_COLORS.warning },

  /*
   * Vergleichstabelle (B23c-3b-2).
   *
   * ⚠ EINE Stufe kleiner als der Fliesstext (`small`, 8,5 pt): sechs Spalten in 499 pt Satzbreite
   * tragen bei 9,5 pt nicht ohne Umbruch, und eine Tabelle, in der die Hälfte der Zellen zweizeilig
   * wird, ist keine Tabelle mehr. Der Fliesstext daneben bleibt unverändert.
   */
  table: { marginTop: 8 },
  tableHeader: {
    flexDirection: 'row',
    gap: 6,
    paddingBottom: 2.5,
    borderBottomWidth: 1,
    borderBottomColor: PDF_COLORS.border,
  },
  tableRow: {
    flexDirection: 'row',
    gap: 6,
    paddingTop: 2.5,
    paddingBottom: 2.5,
    borderBottomWidth: 0.5,
    borderBottomColor: PDF_COLORS.border,
  },
  tableHeaderCell: { fontSize: PDF_TYPE.small, fontWeight: 600, color: PDF_COLORS.ink },
  tableCell: { fontSize: PDF_TYPE.small, color: PDF_COLORS.text },

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
  legendLabel: { fontSize: PDF_TYPE.small, color: PDF_COLORS.textMuted },
  figureCaption: { marginTop: 4, fontSize: PDF_TYPE.small, color: PDF_COLORS.textMuted },
  figureStatement: { marginTop: 4, color: PDF_COLORS.text },
  figureMissing: {
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
  notice: {
    marginTop: 12,
    padding: 10,
    borderLeftWidth: 2,
    backgroundColor: PDF_COLORS.surfaceAlt,
  },
  noticeTitle: { fontSize: PDF_TYPE.h3, fontWeight: 600, color: PDF_COLORS.ink },
  noticeBody: { marginTop: 3, color: PDF_COLORS.textMuted },
  noticeListLabel: { marginTop: 5, fontSize: PDF_TYPE.small, fontWeight: 600, color: PDF_COLORS.ink },
  noticeListItem: { marginTop: 1, color: PDF_COLORS.text },
  noticeHint: { marginTop: 5, color: PDF_COLORS.textMuted },

  /*
   * Die zwei Schlussabsätze des Reports (Tarifherkunft, Preisstand) und der Vorbehalt.
   *
   * ⚠ Kleiner und leiser als der Fliesstext — wortgleich zur Rolle am Bildschirm
   * (`text-xs text-text-muted`): es sind Herkunftsangaben, keine Aussagen über das Ergebnis. Sie
   * stehen trotzdem im Dokument und nicht in einer Fussnote: ohne sie ist eine später archivierte
   * Baseline nicht mehr einzuordnen.
   */
  provenance: { marginTop: 10, fontSize: PDF_TYPE.small, color: PDF_COLORS.textMuted },

  footnote: {
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
function PageFurniture({ sink }: { sink: PageNumberSink }) {
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
          <Text style={styles.headerWordmark}>{PRINT_COMPANY.name}</Text>
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

function Cover({ input }: { input: PdfReportInput }) {
  const customer = input.customer
  const hasCustomer = Boolean(customer?.company || customer?.name || customer?.address)

  return (
    <View style={styles.coverBody}>
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
          {customer?.address &&
            customer.address
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

      {/*
        Wörtlich derselbe Vorbehalt wie auf dem Deckblatt des CSS-Wegs, und aus demselben Grund an
        dieser Stelle: wer den Report weiterreicht, soll ihn sehen, bevor er die Zahlen sieht.

        ⚠ B23c-4: er steht seither in `content.ts` und nicht mehr hier ausgeschrieben — das
        Schlusskapitel trägt ihn ein zweites Mal, und zwei Fassungen desselben Vorbehalts im selben
        Dokument lesen sich wie zwei verschiedene Einschränkungen.
      */}
      <Text style={styles.coverDisclaimer}>{REPORT_DISCLAIMER}</Text>
    </View>
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

function StatementRow({ row }: { row: ReportRow }) {
  return (
    <View style={row.total ? [styles.row, styles.rowTotal] : styles.row}>
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
    <View style={[styles.notice, { borderLeftColor: TONE_COLOR[notice.tone] }]}>
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
function Statement({ statement }: { statement: ReportStatement }) {
  return (
    <View style={styles.statement} wrap={false}>
      <Text style={styles.statementTitle}>{statement.title}</Text>
      {/* Keine Kopfzahl, wo es keine gibt (der Zusatzspeicher-Klarsatz) — s. `summary.ts`. */}
      {statement.amount && (
        <View style={styles.statementAmountRow}>
          <Text style={[styles.statementAmount, { color: TONE_COLOR[statement.amount.tone] }]}>
            {statement.amount.value}
          </Text>
          <Text style={styles.statementAmountCaption}>{statement.amount.caption}</Text>
        </View>
      )}
      {statement.rows.length > 0 && (
        <View style={styles.rowList}>
          {statement.rows.map((row) => (
            <StatementRow key={row.label} row={row} />
          ))}
        </View>
      )}
      <Text style={styles.statementBody}>{statement.body}</Text>
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
function StatementTable({ table }: { table: ReportTable }) {
  return (
    <View style={styles.table} wrap={false}>
      <View style={styles.tableHeader}>
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
      {table.rows.map((row) => (
        <View key={row.key} style={styles.tableRow}>
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
                {cell}
              </Text>
            )
          })}
        </View>
      ))}
    </View>
  )
}

/**
 * B23c-1 — die Kernergebnisse. Bis hierher eine ausdrücklich gekennzeichnete Platzhalter-Seite.
 *
 * ── ⚠ WAS AUF DIESER SEITE STEHT, ENTSCHEIDET `summary.ts` UND NICHT DIESE DATEI ───────────────
 * Hier wird ausschliesslich gerendert, was die Ableitung geliefert hat. Es gibt bewusst KEINE
 * Verzweigung an einem Contract-Feld in diesem JSX: die Frage „darf diese Zahl im Dokument
 * stehen" ist fachlich (Delta 15 Regel C, Delta 3, Prinzip 2) und hätte an zwei Orten zwei
 * Antworten. Fehlt eine Aussage, fehlt sie hier schlicht in der Liste.
 *
 * ⚠ KEIN CHART. B23c-1 ist Text und Zahlen; die Rasterbild-Pipeline (B23b) hängt sich mit B23c-2
 * in diesen Fluss ein. Ein Chart hier hiesse, `rasterizeChart` in den Renderpfad zu ziehen — und
 * der ist synchron und kennt kein DOM.
 *
 * ── ⚠ BEOBACHTET UND OHNE MECHANISCHEN SCHUTZ: DIE FUSSNOTE KANN ALLEIN AUF EINER SEITE LANDEN ─
 * Mit einer um eine Zeile längeren Kern-Kennzahl-Beschriftung füllte der Blocker-Fall Seite 3 so
 * weit, dass die Schlussfussnote als EINZIGER Inhalt auf Seite 4 rutschte. In den drei heutigen
 * Prüfläufen tritt das nicht mehr auf (die Beschriftung ist auf eine Zeile gekürzt, s. `summary.ts`)
 * — aber das ist ein Zustand des Textes, keine Zusage des Layouts.
 *
 * Der naheliegende Schutz `minPresenceAhead` wurde GEMESSEN und ist hier wirkungslos (s.
 * `Statement`). Die zwei Auswege, die wirken würden, sind beide schlechter: die Fussnote in den
 * letzten `wrap={false}`-Block zu ziehen kann einen zu langen Block über den Satzspiegel hinaus
 * abschneiden (Inhaltsverlust statt einer unschönen Seite), und die Abstände so lange zu
 * verkleinern, bis ein Fall passt, hält genau bis zur nächsten Textänderung. Mit B23c-2 kommen
 * Charts in dieses Kapitel und ändern den Umbruch ohnehin — dann ist am erzeugten PDF neu zu
 * messen, ob eine Seite allein mit dieser Fussnote dasteht.
 */
function ResultsChapter({ input }: { input: PdfReportInput }) {
  const summary = buildReportSummary(input.analysis, input.loadProfile, input.estimatedPv)

  return (
    <View style={styles.body}>
      <Text style={styles.h2}>{RESULTS_SECTION.title}</Text>
      <Text style={styles.lead}>{RESULTS_INTRO}</Text>

      <View style={styles.headline}>
        <View style={styles.headlineCell}>
          <Text style={styles.headlineValue}>{summary.headline.peakValue}</Text>
          <Text style={styles.headlineCaption}>{summary.headline.peakCaption}</Text>
        </View>
        <View style={styles.headlineCell}>
          <Text style={styles.headlineValueCost}>{summary.headline.costValue}</Text>
          <Text style={styles.headlineCaption}>{summary.headline.costCaption}</Text>
        </View>
      </View>

      {/*
        ⚠ ZWISCHEN Kopfzahl und Aussagen, nicht darunter oder im Schlusskapitel: sie qualifizieren
        GENAU die Zahl darüber (der abgerechnete Leistungswert eines Standardprofils ist die Spitze
        einer Durchschnittskurve und keine gemessene Spitze). Dieselbe Stellung wie am Bildschirm,
        wo sie unmittelbar unter der Kern-Kennzahl stehen und ausdrücklich NICHT in der
        Datenqualitäts-Box weiter unten — die wurde beim Live-Test überscrollt.

        ⚠ B23c-5: es sind jetzt vier, und ihre REIHENFOLGE ist die des Bildschirms (`buildNotices`)
        — sie entsteht in der Ableitung und nicht hier. Hier durchsortiert stünde dieselbe
        Entscheidung an zwei Orten.
      */}
      {summary.notices.map((notice) => (
        <Notice key={notice.id} notice={notice} />
      ))}

      {summary.statements.map((statement) => (
        <Statement key={statement.id} statement={statement} />
      ))}

      <Text style={styles.footnote}>{RESULTS_FOOTNOTE}</Text>
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
        Genau eine der beiden steht, wo sie einander ausschliessen (Lastgang: die
        Spitzenkappungs-Aussage ODER die Erklärung, warum keine Kapp-Linie im Bild ist). Die
        Entscheidung fällt in der jeweiligen Ableitung und nicht hier — die Frage „darf diese
        Aussage im Dokument stehen" ist fachlich und hätte an zwei Orten zwei Antworten.
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
 * B23c-2 — Empfehlung, Lastgang-Diagramm und Ladesteuerung.
 *
 * ── ⚠ DAS BILD IST HIER SCHON FERTIG ──────────────────────────────────────────────────────────
 * `charts` kommt als fertige Data-URI herein und wird in diesem Baum NICHT erzeugt. Rastern
 * verlangt ein DOM und mehrere Frames; der Dokumentbaum ist synchron und läuft zwei- bis dreimal
 * (`render.tsx`). Ein Chart, der hier entstünde, entstünde je Durchlauf neu — und zwei Bilder mit
 * um einen Bildpunkt abweichender Höhe verschöben den Umbruch, worauf der Agenda-Wächter
 * anschlüge, ohne dass die Ursache irgendwo im Dokument stünde.
 *
 * ── ⚠ WAS AUF DIESER SEITE STEHT, ENTSCHEIDET `recommendation.ts` ─────────────────────────────
 * Hier wird gerendert, was die Ableitung liefert. Keine Verzweigung an einem Contract-Feld in
 * diesem JSX — dieselbe Regel wie beim Kernergebnis-Kapitel: fehlt eine Aussage, fehlt sie schlicht.
 */
function RecommendationChapter({
  input,
  charts,
}: {
  input: PdfReportInput
  charts: ReportChartRasters
}) {
  const chapter = buildRecommendationChapter(input.analysis)

  return (
    <View style={styles.body}>
      <Text style={styles.h2}>{RECOMMENDATION_SECTION.title}</Text>
      <Text style={styles.lead}>{RECOMMENDATION_INTRO}</Text>

      {chapter.recommendation && <Statement statement={chapter.recommendation} />}

      <ChartFigure
        raster={charts.load}
        caption={chapter.chart.caption}
        statement={chapter.chart.capStatement}
        note={chapter.chart.noCapNote}
        missing={figureMissingText('Das Lastgang-Diagramm')}
      />

      {chapter.loadControl && <Statement statement={chapter.loadControl} />}
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
}: {
  input: PdfReportInput
  charts: ReportChartRasters
}) {
  const chapter = buildDetailChapter(input.analysis, { flowDay: charts.flowDay })

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
      {chapter.cost?.statement && <Statement statement={chapter.cost.statement} />}

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
function HeatmapLegend() {
  return (
    <View style={styles.legend}>
      <View style={styles.legendItem}>
        <View style={[styles.legendSwatch, { backgroundColor: PDF_COLORS.accent }]} />
        <Text style={styles.legendLabel}>netto geladen</Text>
      </View>
      <View style={styles.legendItem}>
        <View style={[styles.legendSwatch, { backgroundColor: PDF_COLORS.ink }]} />
        <Text style={styles.legendLabel}>netto entladen</Text>
      </View>
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
}: {
  input: PdfReportInput
  charts: ReportChartRasters
}) {
  const chapter = buildInsightChapter(input.analysis)

  return (
    <View style={styles.body}>
      <Text style={styles.h2}>{INSIGHT_SECTION.title}</Text>
      <Text style={styles.lead}>{INSIGHT_INTRO}</Text>

      <ChartFigure
        raster={charts.hourFlow}
        caption={chapter.hourFlow?.figure.caption ?? ''}
        legend={<HeatmapLegend />}
        /* `hourFlowMissing` steht, wenn es für diesen Fall gar kein Raster gibt; sonst ist ein
           fehlendes Bild ein Fehlschlag der Rasterung und bekommt den Fehlschlag-Satz. */
        missing={chapter.hourFlowMissing ?? figureMissingText('Die Stunden-Heatmap')}
      />
      {chapter.hourFlow && <Statement statement={chapter.hourFlow.statement} />}

      <ChartFigure
        raster={charts.chargePrice}
        caption={chapter.chargePrice?.figure.caption ?? ''}
        note={chapter.chargePrice?.figure.note}
        missing={chapter.chargePriceMissing ?? figureMissingText('Der Ø-Ladepreis')}
      />
      {chapter.chargePrice && <Statement statement={chapter.chargePrice.statement} />}
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
 * ⚠ Die Kurve steht ÜBER der Aussage und nicht darunter: rechnet sich keines der Geräte, ist sie
 * die Begründung des Klarsatzes, und eine Begründung, die man erst nach der Feststellung sieht,
 * liest sich wie ein Nachtrag. Dieselbe Reihenfolge wie am Bildschirm.
 */
function ComparisonChapter({
  input,
  charts,
}: {
  input: PdfReportInput
  charts: ReportChartRasters
}) {
  const chapter = buildComparisonChapter(input.analysis)

  return (
    <View style={styles.body}>
      <Text style={styles.h2}>{COMPARISON_SECTION.title}</Text>
      <Text style={styles.lead}>{COMPARISON_INTRO}</Text>

      <ChartFigure
        raster={charts.comparison}
        caption={chapter.figure?.caption ?? ''}
        note={chapter.figure?.note}
        /* `figureMissing` steht, wenn es für diesen Fall gar keine Kurve gibt; sonst ist ein
           fehlendes Bild ein Fehlschlag der Rasterung und bekommt den Fehlschlag-Satz. */
        missing={chapter.figureMissing ?? figureMissingText('Die Grenznutzen-Kurve')}
      />

      <Statement statement={chapter.statement} />
      {chapter.table && <StatementTable table={chapter.table} />}
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
 * ⚠ Das Kapitel ist eine eigene `<Page>` (D5, Regel 1) und ausdrücklich KEIN drittes bedingtes
 * Kapitel: Annahmen, Tarifherkunft und Vorbehalt gibt es in jedem Report.
 */
function BasisChapter({ input }: { input: PdfReportInput }) {
  const chapter = buildBasisChapter(input)

  return (
    <View style={styles.body}>
      <Text style={styles.h2}>{BASIS_SECTION.title}</Text>
      <Text style={styles.lead}>{BASIS_INTRO}</Text>

      <Statement statement={chapter.assumptions} />
      {chapter.dataQuality && <Notice notice={chapter.dataQuality} />}
      {chapter.blocker && <Notice notice={chapter.blocker} />}

      <Text style={styles.provenance}>{chapter.tariffSource}</Text>
      {chapter.tariffVintage && <Text style={styles.provenance}>{chapter.tariffVintage}</Text>}

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
  agenda,
  sink,
}: {
  input: PdfReportInput
  /**
   * Die fertigen Chart-Bilder — EINMAL je Dokument erzeugt (`render.tsx` → `charts.ts`), nicht je
   * Durchlauf. Bit-identisch über alle Durchläufe und damit derselbe Umbruch; s. `ChartFigure`.
   */
  charts: ReportChartRasters
  agenda: AgendaPageNumbers
  sink: PageNumberSink
}) {
  /*
   * ⚠ EINMAL ENTSCHIEDEN, ZWEIMAL GELESEN (B23c-3b-1): die Agenda führt den Eintrag genau dann,
   * wenn die `<Page>` darunter entsteht. Zwei getrennte Auswertungen ergäben entweder einen
   * Eintrag mit dauerhaft leerer Zahlenspalte (kein Sentinel meldet je) oder ein Kapitel, das die
   * Agenda verschweigt — beides sähe man dem Dokument nicht an.
   */
  const hasInsight = hasInsightChapter(input.analysis)
  const hasComparison = hasComparisonChapter(input.analysis)

  return (
    <Document
      title={input.title}
      subject={input.subtitle}
      author={PRINT_COMPANY.name}
      creator={PRINT_COMPANY.name}
      producer={PRINT_COMPANY.name}
      language="de-AT"
    >
      <Page size="A4" style={styles.page}>
        <PageFurniture sink={sink} />
        <Cover input={input} />
      </Page>

      <Page size="A4" style={styles.page}>
        <PageFurniture sink={sink} />
        <SectionAnchor id="agenda" sink={sink} />
        <Agenda
          sections={buildReportAgenda({ insight: hasInsight, comparison: hasComparison })}
          pages={agenda}
        />
      </Page>

      <Page size="A4" style={styles.page}>
        <PageFurniture sink={sink} />
        <SectionAnchor id={RESULTS_SECTION.id} sink={sink} />
        <ResultsChapter input={input} />
      </Page>

      <Page size="A4" style={styles.page}>
        <PageFurniture sink={sink} />
        <SectionAnchor id={RECOMMENDATION_SECTION.id} sink={sink} />
        <RecommendationChapter input={input} charts={charts} />
      </Page>

      <Page size="A4" style={styles.page}>
        <PageFurniture sink={sink} />
        <SectionAnchor id={DETAIL_SECTION.id} sink={sink} />
        <DetailChapter input={input} charts={charts} />
      </Page>

      {hasInsight && (
        <Page size="A4" style={styles.page}>
          <PageFurniture sink={sink} />
          <SectionAnchor id={INSIGHT_SECTION.id} sink={sink} />
          <InsightChapter input={input} charts={charts} />
        </Page>
      )}

      {hasComparison && (
        <Page size="A4" style={styles.page}>
          <PageFurniture sink={sink} />
          <SectionAnchor id={COMPARISON_SECTION.id} sink={sink} />
          <ComparisonChapter input={input} charts={charts} />
        </Page>
      )}

      <Page size="A4" style={styles.page}>
        <PageFurniture sink={sink} />
        <SectionAnchor id={METHODOLOGY_SECTION.id} sink={sink} />
        <MethodologyChapter />
      </Page>

      <Page size="A4" style={styles.page}>
        <PageFurniture sink={sink} />
        <SectionAnchor id={BASIS_SECTION.id} sink={sink} />
        <BasisChapter input={input} />
      </Page>
    </Document>
  )
}
