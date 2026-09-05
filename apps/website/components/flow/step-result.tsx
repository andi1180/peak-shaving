'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, FileJson, Loader2, Printer, RotateCcw } from 'lucide-react'
import { buildTariffSourceRef, type AnalysisResult, type TariffSourceRef } from 'shared'

import { PrintCover } from '@/components/report/print-cover'
import { PrintFrame, PrintRunningFooter } from '@/components/report/print-frame'
import { ReportGateDialog, type ReportGateCustomer } from '@/components/report/report-gate-dialog'
import { Report } from '@/components/report/report'
import { Button } from '@/components/ui/button'
import { buildBundle, bundleFileName, serializeBundle } from '@/lib/bundle-export'
import { buildPerBatteryCsv, downloadTextFile } from '@/lib/csv-export'
/*
 * ⚠ DER EINZIGE STATISCHE IMPORT AUS `lib/pdf-report/` — und er ist erlaubt: `derive.ts` fasst
 * `@react-pdf/renderer` ausdrücklich nicht an (s. Kopf dort) und ist der eine Teil des
 * Verzeichnisses, den ein Bündel statisch lesen darf. Alles Übrige — `download.ts` und damit die
 * ganze Erzeugung — kommt weiter unten als DYNAMISCHER Import, sonst wanderte der Lazy-Chunk
 * (≈ 307 kB gzip) in den First Load von `/rechner`.
 */
import {
  defaultReportTitle,
  formatAnalysisPeriod,
  formatPrintedAt,
  reportSubtitle,
  tariffVintageNote,
} from '@/lib/pdf-report/derive'
import { REACT_PDF_REPORT_ENABLED } from '@/lib/pdf-report-flag'
import type { AnalysisRunInputs } from '@/lib/use-analysis'
import type { CalculatorPayload, ParsedLoad, RecomputeInput } from './types'

/**
 * Cutover Teil 1 — der Zustand des react-pdf-Wegs. Er ist ASYNCHRON und dauert wirklich (D19/D20:
 * 3,4–4,7 s je nach Fall und Cache-Lage), und deshalb genügt hier kein Wahrheitswert wie bei
 * `printRequested`: „läuft" und „fehlgeschlagen" sind zwei sichtbare Zustände mit zwei
 * verschiedenen Bedienangeboten.
 *
 * ⚠ AUSDRÜCKLICH KEIN FORTSCHRITT IN PHASEN ODER PROZENT. Was ein Dokument kostet, hängt an der
 * Zahl der Bilder (fünf oder sechs, D19) und an der Seitenzahl, die erst der Messdurchlauf kennt
 * (D5) — ein Balken, der bei 80 % stehenbleibt, weil dieser Lauf ein Bild mehr trägt, ist
 * schlechter als gar keiner.
 */
type PdfExportState =
  | { kind: 'idle' }
  | { kind: 'running' }
  /** `detail` ist die technische Ursache — untergeordnet gezeigt, nie als Hauptsatz. */
  | { kind: 'failed'; detail: string | null }

export function StepResult({
  result,
  inputs,
  load,
  payload,
  recomputing,
  recomputeError,
  isLive,
  onRecompute,
  onResetAssumptions,
  onRestart,
}: {
  result: AnalysisResult
  /**
   * B14-2: die Eingangsgrössen GENAU dieses Ergebnisses (§6.2-Neuberechnung eingeschlossen).
   * `null`, solange sie noch nicht feststehen — dann ist kein Bündel möglich.
   */
  inputs: AnalysisRunInputs | null
  load: ParsedLoad
  payload: CalculatorPayload
  recomputing: boolean
  recomputeError: string | null
  isLive: boolean
  onRecompute: (input: RecomputeInput) => void
  onResetAssumptions: () => void
  onRestart: () => void
}) {
  const [bundleError, setBundleError] = useState<string | null>(null)

  /*
   * Delta 16b — das Name/Firma-Gate. `customer` ist `null`, solange niemand es durchlaufen hat;
   * dann bleibt das Deckblatt namenlos (`PrintCover` rendert den Block dann gar nicht) und der
   * PDF-Knopf öffnet das Formular statt zu drucken.
   *
   * Der Zustand lebt HIER und nicht im Dialog: er überdauert dessen Schliessen, sodass ein zweiter
   * Ausdruck nicht erneut fragt. Er überdauert bewusst NICHT die Seite — es gibt keinen Speicher
   * auf dem Endgerät (§165 TKG, dieselbe Überlegung wie in `lib/tariff-data/client.ts`).
   */
  const [customer, setCustomer] = useState<ReportGateCustomer | null>(null)
  const [printRequested, setPrintRequested] = useState(false)

  /*
   * ⚠ WARUM DER DRUCK ÜBER EINEN EFFEKT LÄUFT UND NICHT DIREKT IM RÜCKRUF: `window.print()`
   * unmittelbar nach `setCustomer` aufgerufen druckte die Seite VOR dem Re-Render — das Deckblatt
   * trüge dann genau den Namen nicht, für den das Gate da ist. Der Effekt läuft erst, nachdem React
   * den neuen Zustand ausgegeben hat.
   */
  useEffect(() => {
    if (!printRequested) return
    setPrintRequested(false)
    window.print()
  }, [printRequested])

  /*
   * B11 — die Herkunft der Tarifsätze zum ANGEZEIGTEN Lauf. EINE Ableitung, zwei Abnehmer: der
   * Report zeigt sie, das Bündel speichert sie. Zwei getrennte Ableitungen liefen auseinander,
   * sobald das Annahmen-Panel (§6.2) das Abrechnungsmodell ändert — dann stünde im Report „unverändert
   * übernommen" und im Archiv etwas anderes.
   *
   * Massgeblich sind die Werte des angezeigten Laufs (`inputs.tariff`), nicht die aus Schritt 2: eine
   * Live-Neuberechnung kann `billingModel` nachträglich vom Vorgabewert wegbewegen. `inputs` ist nur
   * theoretisch `null` (der Hook füllt es im selben Schritt, in dem das Ergebnis entsteht) — dann
   * bleibt der Formularstand von Schritt 2 die beste verfügbare Aussage.
   */
  const activeTariff = inputs?.tariff ?? payload.tariff
  const tariffSource: TariffSourceRef | null = payload.tariffSelection
    ? buildTariffSourceRef(payload.tariffSelection, {
        leistungspreisEurPerKwYear: activeTariff.leistungspreisEurPerKwYear,
        billingModel: activeTariff.billingModel,
        minBillableKw: activeTariff.minBillableKw,
      })
    : null

  /*
   * ── Cutover Teil 1 — der react-pdf-Weg, hinter `REACT_PDF_REPORT_ENABLED` ────────────────────
   *
   * Zwei Zustände, und sie tun Verschiedenes: `pdfState` ist das, was der Nutzer SIEHT (Knopf
   * gesperrt, Hinweis, Fehlermeldung), `pdfRequested` ist der AUSLÖSER für den Effekt darunter.
   * Zusammengelegt liefe die Erzeugung erneut an, sobald `pdfState` aus einem anderen Grund neu
   * gesetzt wird.
   */
  const [pdfState, setPdfState] = useState<PdfExportState>({ kind: 'idle' })
  const [pdfRequested, setPdfRequested] = useState(false)

  /*
   * ⚠ EIN `mounted`-VERMERK, UND AUSDRÜCKLICH KEIN `cancelled`-FLAG AUS DER EFFEKT-AUFRÄUMUNG.
   *
   * Die erste Fassung führte ein `let cancelled = false` im Effekt und setzte es in dessen
   * Aufräumfunktion. Das war falsch, und der Live-Lauf hat es gefangen: der Effekt setzt als
   * Erstes `setPdfRequested(false)`, damit ändert sich seine eigene Abhängigkeit, React räumt auf
   * und startet ihn neu — die Aufräumung läuft also MITTEN in der Erzeugung, nicht erst beim
   * Verschwinden der Komponente. Gemessen: das PDF wurde fertig erzeugt und heruntergeladen, aber
   * `setPdfState({ kind: 'idle' })` wurde übersprungen; der Knopf blieb dauerhaft auf „Report wird
   * erzeugt …" stehen, und ein zweiter Export war unmöglich.
   *
   * Ein Ref hält, was gemeint ist: „gibt es diese Komponente noch". Es ändert sich nur beim
   * Ausbau (z. B. „Neue Analyse" mitten in der Erzeugung) und nicht bei jeder Zustandsänderung.
   */
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  /*
   * ⚠ WARUM AUCH DIESER WEG ÜBER EINEN EFFEKT LÄUFT — und aus einem ZWEITEN Grund als der Druck
   * darüber.
   *
   * Der erste ist derselbe: nach `setCustomer` muss React den neuen Zustand ausgegeben haben,
   * bevor etwas mit ihm geschieht.
   *
   * Der zweite ist neu und wiegt hier schwerer: `downloadReportPdf` läuft SYNCHRON im selben
   * Thread, sobald der Lazy-Chunk da ist (Rasterung + zwei Renderdurchläufe, D19/D20). Unmittelbar
   * im Klick-Rückruf gestartet, könnte die Auflösung des dynamischen Imports auf einem Microtask
   * VOR dem ersten Paint liegen — dann würde der Ladezustand zwar gesetzt, aber nie gezeigt, und
   * der Nutzer sähe mehrere Sekunden lang einen Knopf, der nichts tut. Ein `useEffect` (kein
   * `useLayoutEffect`) läuft nach dem Paint; der Hinweis steht also nachweislich auf dem Schirm,
   * bevor die Arbeit beginnt.
   *
   * Die Ableitungen für den Eingang stehen ALLE in diesem Effekt und nicht im Rendern: sie kosten
   * nichts, solange niemand exportiert, und `printedAt`/`tariffVintage` hängen an der Uhr — im
   * Rendern gebildet trüge das Dokument den Zeitpunkt des letzten Re-Renders statt den des Klicks.
   */
  useEffect(() => {
    if (!pdfRequested) return
    setPdfRequested(false)
    if (!customer) return

    void (async () => {
      try {
        /* Erst hier — der Import IST der Lazy-Chunk (s. Kopf von `download.ts`). */
        const { downloadReportPdf } = await import('@/lib/pdf-report/download')
        const now = new Date()
        await downloadReportPdf(
          {
            /*
             * Ein geleertes Titelfeld fällt auf den Vorschlag zurück statt eine leere Zeile zu
             * drucken: der Titel ist die einzige Angabe des Deckblatts, die es immer geben muss.
             */
            title: customer.title?.trim() || defaultReportTitle(result),
            subtitle: reportSubtitle(load.profile),
            customer: {
              name: customer.name,
              company: customer.company,
              address: customer.address,
            },
            period: formatAnalysisPeriod(load.profile),
            printedAt: formatPrintedAt(now),
            analysis: result,
            loadProfile: load.profile,
            tariffSource,
            /*
             * ⚠ `payload.tariff` und NICHT `activeTariff`: der Preisstand-Satz beschreibt, woher die
             * EINGETRAGENEN Werte stammen (die Grundgebühr aus Schritt 2) — genau dieselbe Quelle,
             * die der Bildschirm-Report benutzt (`report.tsx` reicht `originalTariff` an
             * `TariffVintageNote`). Eine Live-Neuberechnung ändert die Herkunft der Rechnung nicht.
             */
            tariffVintage: tariffVintageNote(load.profile, payload.tariff, now),
            /*
             * `undefined` heisst „nicht geschätzt" — dann fehlt der Hinweis im Dokument ganz, und
             * das ist die richtige Antwort (D18).
             */
            estimatedPv: payload.estimatedPv?.summary,
          },
          now,
        )
        if (mountedRef.current) setPdfState({ kind: 'idle' })
      } catch (cause) {
        /*
         * ⚠ KEIN STILLER RÜCKFALL AUF `window.print()`. Die zwei Wege tragen verschiedene Felder
         * (Titel und Adresse gibt es nur hier) und verschiedene Seitenumbrüche; ein Ausdruck, der
         * nach einem Fehlschlag heimlich der andere ist, wäre ein anderes Dokument unter demselben
         * Knopf. Der Nutzer entscheidet — und kann es unverändert erneut versuchen.
         */
        if (!mountedRef.current) return
        /*
         * Die technische Ursache wird MITGEFÜHRT, aber nicht zum Hauptsatz gemacht: „Loading chunk
         * 429 failed" sagt einem Bäcker nichts, einem Support-Anruf dagegen alles. Der erste Satz
         * ist deshalb die Handlungsanweisung, der zweite die Herkunft — und ohne verwertbare
         * Meldung fehlt er ganz, statt eine leere Klammer zu drucken.
         */
        setPdfState({
          kind: 'failed',
          detail: cause instanceof Error && cause.message ? cause.message : null,
        })
      }
    })()
  }, [pdfRequested, customer, result, load, payload, tariffSource])

  /*
   * EIN Auslöser für beide Anlässe (erster Export nach dem Gate, jeder weitere und der erneute
   * Versuch nach einem Fehler). Der Ladezustand wird HIER gesetzt und nicht im Effekt: so ist er
   * Teil desselben Renderdurchlaufs wie der Klick, und der Effekt findet ihn bereits ausgegeben
   * vor.
   */
  function requestPdf() {
    setPdfState({ kind: 'running' })
    setPdfRequested(true)
  }

  /*
   * ⚠ Gemessen und deshalb hier festgehalten: mit AUSGESCHALTETEM Schalter wird dies KEINE
   * Bauzeit-Konstante. Next ersetzt `NEXT_PUBLIC_*` nur textuell, WENN die Variable beim Bauen
   * gesetzt ist; ist sie es nicht, bleibt der Zugriff als Laufzeit-Nachschlag stehen (er liefert
   * dann `undefined`, der Vergleich also `false`). Die neuen Zweige stehen damit auch im
   * ausgeschalteten Bündel — gemessen +3.438 Bytes roh auf `/rechner`, bei unveränderten 19
   * Chunks und `@react-pdf` weiterhin 0×. Der Kurzschluss steht hier trotzdem: er sagt, dass es
   * ohne den neuen Weg keinen laufenden Vorgang geben KANN, und im eingeschalteten Bau faltet
   * ihn der Minifizierer wirklich weg (jener Bau ist gemessen 100 Bytes KLEINER).
   */
  const pdfRunning = REACT_PDF_REPORT_ENABLED && pdfState.kind === 'running'

  function handleExportCsv() {
    const csv = buildPerBatteryCsv(result.perBattery, result.assumptions.horizonYears)
    downloadTextFile('peak-shaving-ergebnis.csv', csv, 'text/csv;charset=utf-8')
  }

  /*
   * B14-2 — das Analyse-Bündel (§6.2). Rein im Browser erzeugt, kein Netzwerkaufruf; die
   * Verbrauchsdaten verlassen den Browser weiterhin nicht (Prinzip 4).
   *
   * Die Prüfsumme entsteht über die TATSÄCHLICH verarbeitete Ursprungsdatei. Liegt sie nicht mehr
   * vor, wird KEIN Bündel erzeugt und die Oberfläche sagt das: ein Bündel mit einer Prüfsumme, die
   * nichts bindet, liesse sich archivieren und hinge dann an irgendeiner Datei.
   */
  async function handleExportBundle() {
    setBundleError(null)
    if (!inputs) {
      setBundleError(
        'Die Eingangsgrössen dieses Ergebnisses stehen noch nicht fest. Bitte warten Sie, bis die ' +
          'Neuberechnung abgeschlossen ist.',
      )
      return
    }
    try {
      const bundle = await buildBundle({ result, inputs, load, pv: payload.pv, tariffSource })
      downloadTextFile(
        bundleFileName(bundle),
        serializeBundle(bundle),
        'application/json;charset=utf-8',
      )
    } catch (err) {
      setBundleError(err instanceof Error ? err.message : 'Das Bündel konnte nicht erzeugt werden.')
    }
  }

  const bundleBlocked = !load.sourceBytes
  /*
   * Delta 9b-1: „kein Bündel" hat jetzt ZWEI Gründe, und sie verlangen zwei verschiedene Sätze.
   * Bei einem Standardprofil gibt es GAR KEINE Ursprungsdatei — „liegt nicht mehr vor … bitte
   * erneut hochladen" behauptete dort einen Verlust, den es nie gab, und schickte den Nutzer eine
   * Datei suchen, die er nicht hat. Es ist ausserdem kein Fehler, sondern eine Eigenschaft dieses
   * Einstiegs; deshalb in der neutralen Textfarbe statt in Rot.
   */
  const bundleBlockedBecauseSynthetic = bundleBlocked && load.profile.source === 'standard_profile'
  const bundleBlockedText = bundleBlockedBecauseSynthetic
    ? 'Ein Analyse-Bündel gibt es für ein Standardprofil nicht: es bindet eine Analyse an ihre ' +
      'Ursprungsdatei, und die gibt es hier nicht — die Zahlen stammen aus Ihrer Verbrauchsangabe, ' +
      'nicht aus einer Messdatei. PDF und CSV stehen unverändert zur Verfügung.'
    : 'Ein Analyse-Bündel ist für diesen Lauf nicht möglich: die Ursprungsdatei liegt nicht ' +
      'mehr vor. Ohne sie liesse sich keine Prüfsumme rechnen — und ein Bündel ohne ' +
      'Prüfsumme bindet die Analyse an keine Datei. Bitte laden Sie den Lastgang erneut hoch.'

  return (
    /*
     * Der Druck-Rahmen (Kopf-/Fusszeile auf jeder Seite). Am Bildschirm ein durchsichtiger
     * Wrapper — er rendert dort nichts als seinen Inhalt; s. `print-frame.tsx`.
     *
     * Die Fusszeile steht als `position: fixed` NEBEN dem Rahmen und nicht darin: in einer
     * Tabellenzelle ist `fixed` in Chromium nicht zuverlässig positioniert.
     */
    <>
      <PrintRunningFooter />
      <PrintFrame>
        <div className="flex flex-col gap-4">
          {/*
        Delta 16a — Deckblatt, ausschliesslich im Druck. Es steht hier und nicht im `Report`, weil
        es zum DOKUMENT gehört und nicht zur Auswertung: der Report ist auch die Bildschirmansicht,
        das Deckblatt gibt es nur auf Papier. `customer` füllt seit Delta 16b das Name/Firma-Gate —
        ohne dessen Durchlauf bleibt der Block leer, statt eine Platzhalterzeile zu zeigen.
      */}
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <PrintCover loadProfile={load.profile} customer={customer ?? undefined} />
          </div>

          <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <h1 className="text-2xl font-semibold text-ink">Ihr Ergebnis</h1>
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <Button variant="outline" size="sm" onClick={handleExportCsv}>
                <Download className="h-4 w-4" />
                Als CSV exportieren
              </Button>
              {/*
               * Delta 16b — zwei Zustände, EIN Knopf an derselben Stelle. Vor dem Gate öffnet er das
               * Formular (der Dialog bringt seinen Auslöser mit), danach druckt er direkt: ein zweites
               * Mal nach denselben Angaben zu fragen wäre eine Hürde ohne Ertrag, die Einwilligung
               * steht bereits im Bestand.
               */}
              {customer ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    REACT_PDF_REPORT_ENABLED ? requestPdf() : setPrintRequested(true)
                  }
                  disabled={pdfRunning}
                >
                  {pdfRunning ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                      Report wird erzeugt …
                    </>
                  ) : (
                    <>
                      <Printer className="h-4 w-4" />
                      Als PDF speichern
                    </>
                  )}
                </Button>
              ) : (
                <ReportGateDialog
                  /*
                   * Cutover Teil 1 — Titel und Adresse fürs Deckblatt gibt es NUR mit dem neuen Weg.
                   * Der CSS-Weg (`print-cover.tsx`) kennt beide Felder nicht; sie dort zu erheben
                   * wäre genau die „Requisite", die der Kopf des Dialogs ausschliesst — erhoben,
                   * angezeigt und ohne jede Wirkung.
                   */
                  documentFields={
                    REACT_PDF_REPORT_ENABLED
                      ? { defaultTitle: defaultReportTitle(result) }
                      : undefined
                  }
                  onUnlocked={(next) => {
                    setCustomer(next)
                    if (REACT_PDF_REPORT_ENABLED) requestPdf()
                    else setPrintRequested(true)
                  }}
                />
              )}
              {/*
               * Bewusst unauffällig (ghost) und als letzter der drei Ausgabewege: PDF und CSV sind für
               * den Kunden, das Bündel ist für das Archiv. Es steht trotzdem hier und nicht hinter einer
               * Zugangshürde — es entsteht eine lokale Datei, kein Datenabfluss.
               */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleExportBundle()}
                disabled={bundleBlocked || recomputing}
                title={bundleBlocked ? bundleBlockedText : undefined}
              >
                <FileJson className="h-4 w-4" />
                Analyse-Bündel (JSON)
              </Button>
              <Button variant="outline" size="sm" onClick={onRestart}>
                <RotateCcw className="h-4 w-4" />
                Neue Analyse
              </Button>
            </div>
          </div>

          {/*
            Cutover Teil 1 — der Ladezustand und der Fehlerfall des react-pdf-Wegs. Sie stehen hier
            und nicht in der Knopfreihe darüber: der Hinweis ist ein ganzer Satz, und eine Reihe aus
            Knöpfen ist der falsche Ort für einen Satz, den man lesen soll.

            `print:hidden` wie der Rest der Bedienelemente — auf dem Blatt gibt es weder einen
            laufenden Vorgang noch einen Knopf zum Wiederholen.
          */}
          {REACT_PDF_REPORT_ENABLED && pdfState.kind !== 'idle' && (
            <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 print:hidden">
              {pdfState.kind === 'running' ? (
                <p role="status" className="text-sm text-text-muted">
                  Der Report wird erzeugt — das dauert einige Sekunden. Bitte lassen Sie dieses
                  Fenster geöffnet; der Download startet von selbst.
                </p>
              ) : (
                <div role="alert" className="flex flex-col items-start gap-2">
                  <p className="text-sm text-negative">
                    Der Report konnte nicht erzeugt werden. Ihre Eingaben sind erhalten — Sie können
                    es erneut versuchen. CSV-Export und Analyse-Bündel sind davon nicht betroffen.
                  </p>
                  {pdfState.detail && (
                    <p className="text-xs text-text-muted">
                      Technischer Hinweis: {pdfState.detail}
                    </p>
                  )}
                  <Button variant="outline" size="sm" onClick={requestPdf}>
                    <RotateCcw className="h-4 w-4" />
                    Erneut versuchen
                  </Button>
                </div>
              )}
            </div>
          )}

          {(bundleError || bundleBlocked) && (
            <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 print:hidden">
              <p
                role="alert"
                className={
                  bundleError || !bundleBlockedBecauseSynthetic
                    ? 'text-sm text-negative'
                    : 'text-sm text-text-muted'
                }
              >
                {bundleError ?? bundleBlockedText}
              </p>
            </div>
          )}

          <Report
            result={result}
            loadProfile={load.profile}
            tariffSource={tariffSource}
            originalTariff={payload.tariff}
            originalFinancial={payload.financial}
            recomputing={recomputing}
            recomputeError={recomputeError}
            isLive={isLive}
            /*
             * Delta 17 Teil 2: der in Schritt 2 bestätigte Speicher. Das GERECHNETE Ergebnis dazu steht
             * im Contract (`result.existingBatteryAnalysis`); mitgereicht wird hier nur, ob der
             * Wirkungsgrad eine Annahme war — die einzige Zahl des Bestandsblocks, die nicht vom
             * Kunden stammt, und deshalb im Report als solche auszuweisen.
             */
            existingBattery={payload.existingBattery}
            /*
             * B22b: die Zusammenfassung der geschätzten PV-Erzeugung. Sie kommt aus dem PAYLOAD und
             * nicht aus `load.profile.pvSource`: das Feld sagt nur, DASS geschätzt wurde — der
             * Report-Hinweis nennt Standort, Auslegung, Wetterjahre und die an DIESER Anlage
             * gemessene Streuung.
             */
            estimatedPv={payload.estimatedPv?.summary}
            /*
             * Delta 18: die Eingangsgrössen des ANGEZEIGTEN Laufs — Bezugspunkt der Freitext-Vorschau
             * und Grundlage jeder daraus gebauten Neuberechnung. Dieselbe Quelle, aus der auch das
             * Analyse-Bündel schöpft; zwei getrennte Ableitungen liefen auseinander.
             */
            effectiveInputs={inputs}
            onRecompute={onRecompute}
            onResetAssumptions={onResetAssumptions}
          />
        </div>
      </PrintFrame>
    </>
  )
}
