'use client'

import { useEffect, useState } from 'react'
import { Download, FileJson, Printer, RotateCcw } from 'lucide-react'
import { buildTariffSourceRef, type AnalysisResult, type TariffSourceRef } from 'shared'

import { PrintCover } from '@/components/report/print-cover'
import { PrintFrame, PrintRunningFooter } from '@/components/report/print-frame'
import { ReportGateDialog, type ReportGateCustomer } from '@/components/report/report-gate-dialog'
import { Report } from '@/components/report/report'
import { Button } from '@/components/ui/button'
import { buildBundle, bundleFileName, serializeBundle } from '@/lib/bundle-export'
import { buildPerBatteryCsv, downloadTextFile } from '@/lib/csv-export'
import type { AnalysisRunInputs } from '@/lib/use-analysis'
import type { CalculatorPayload, ParsedLoad, RecomputeInput } from './types'

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
                <Button variant="outline" size="sm" onClick={() => setPrintRequested(true)}>
                  <Printer className="h-4 w-4" />
                  Als PDF speichern
                </Button>
              ) : (
                <ReportGateDialog
                  onUnlocked={(next) => {
                    setCustomer(next)
                    setPrintRequested(true)
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
