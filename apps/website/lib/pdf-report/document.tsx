import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

import { PRINT_COMPANY } from '@/lib/company'
import {
  METHODOLOGY_INTRO,
  METHODOLOGY_ITEMS,
  METHODOLOGY_SECTION,
  REPORT_AGENDA,
  RESULTS_FOOTNOTE,
  RESULTS_INTRO,
  RESULTS_SECTION,
  type ReportSection,
} from './content'
import {
  recordSectionPage,
  recordTotalPages,
  sectionHasPageNumber,
  type AgendaPageNumbers,
  type PageNumberSink,
} from './page-numbers'
import {
  buildReportSummary,
  type SummaryRow,
  type SummaryStatement,
  type SummaryTone,
} from './summary'
import { PDF_COLORS, PDF_LAYOUT, PDF_TYPE } from './theme'
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
      */}
      <Text style={styles.coverDisclaimer}>
        Demo-Berechnung mit Beispieldaten. Die Zahlen sind noch nicht gegen einen echten Lastgang und
        eine echte Netzrechnung validiert.
      </Text>
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

function Agenda({ pages }: { pages: AgendaPageNumbers }) {
  return (
    <View style={styles.body}>
      <Text style={styles.h2}>Inhalt</Text>
      <Text style={styles.lead}>
        Was in diesem Dokument steht — und auf welcher Seite es beginnt.
      </Text>
      <View style={styles.agendaList}>
        {REPORT_AGENDA.map((section) => (
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
const TONE_COLOR: Record<SummaryTone, string> = {
  positive: PDF_COLORS.positive,
  warning: PDF_COLORS.warning,
  neutral: PDF_COLORS.text,
}

function StatementRow({ row }: { row: SummaryRow }) {
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
function Statement({ statement }: { statement: SummaryStatement }) {
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
  const summary = buildReportSummary(input.analysis)

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

      {summary.statements.map((statement) => (
        <Statement key={statement.id} statement={statement} />
      ))}

      <Text style={styles.footnote}>{RESULTS_FOOTNOTE}</Text>
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
 * Das Dokument.
 *
 * `agenda` trägt die im ERSTEN Durchlauf gemessenen Seitenzahlen; `null` heisst „noch nicht
 * gemessen" (erster Durchlauf) oder „bewusst ohne Zahlen" (der dokumentierte Rückfall). In beiden
 * Fällen bleibt die Zahlenspalte an ihrem Platz und leer — der Umbruch ist dadurch in beiden
 * Durchläufen derselbe, und genau darauf beruht die Richtigkeit der gedruckten Zahlen.
 */
export function ReportDocument({
  input,
  agenda,
  sink,
}: {
  input: PdfReportInput
  agenda: AgendaPageNumbers
  sink: PageNumberSink
}) {
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
        <Agenda pages={agenda} />
      </Page>

      <Page size="A4" style={styles.page}>
        <PageFurniture sink={sink} />
        <SectionAnchor id={RESULTS_SECTION.id} sink={sink} />
        <ResultsChapter input={input} />
      </Page>

      <Page size="A4" style={styles.page}>
        <PageFurniture sink={sink} />
        <SectionAnchor id={METHODOLOGY_SECTION.id} sink={sink} />
        <MethodologyChapter />
      </Page>
    </Document>
  )
}
