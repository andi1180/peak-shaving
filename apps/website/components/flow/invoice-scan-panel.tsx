'use client'

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Upload } from 'lucide-react'
import { NETZBETREIBER_LABELS, METERING_VARIANT_LABELS, type InvoiceExtraction } from 'shared'
import type { InvoiceScanResponse } from '@/lib/invoice-scan/actions'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { FileDrop } from './file-drop'
import { StandardProfilePanel } from './standard-profile-panel'
import type { ParsedLoad, TariffPrefill } from './types'
import { scanInvoice } from '@/lib/invoice-scan/actions'

/**
 * Delta 8 / 9b-2b — der dritte Einstieg: eine Stromrechnung als PDF, aus der wir die Tarifangaben
 * und den Jahresverbrauch ablesen.
 *
 * ── ⚠ DAS IST DER EINZIGE EINSTIEG, BEI DEM ETWAS DAS GERÄT VERLÄSST ──────────────────────────
 * Die beiden anderen rechnen vollständig im Browser (Prinzip 4). Dieser nicht: die PDF geht zur
 * Extraktion an Anthropic. Der Hinweis darauf steht deshalb SICHTBAR AM UPLOAD und nicht in einer
 * Fussnote — wer die Datei ablegt, muss vorher gelesen haben, was mit ihr geschieht, nicht danach.
 * Das ist die Auflage aus dem Bau von 9b-2a und keine Stilfrage.
 *
 * ── WAS DIESER SCHRITT MIT DEM ERGEBNIS MACHT ─────────────────────────────────────────────────
 * Der Jahresverbrauch wird zum Standardprofil (9b-1) — KEIN dritter Rechenweg, sondern genau der
 * Generator, den der zweite Einstieg auch benutzt. Die Tarifangaben reisen als `TariffPrefill` in
 * Schritt 2 und belegen dort die Felder vor. Beides bleibt editierbar: der Scan ist ein
 * Abtipp-Ersatz, keine Feststellung.
 *
 * ── LEER BLEIBT LEER ──────────────────────────────────────────────────────────────────────────
 * Ein Feld, das die Rechnung nicht hergibt, kommt als `null` zurück und erzeugt hier NICHTS: kein
 * „0", kein Platzhalter, keine geschätzte Zahl. Der Nutzer sieht ein normales, leeres Eingabefeld
 * und füllt es selbst — genau so, wie er es ohne Scan getan hätte. Eine 0 an dieser Stelle wäre
 * schlimmer als eine Lücke, weil sie wie eine Angabe aussieht (dieselbe Regel, aus der die
 * Extraktion selbst „lieber nichts als geraten" arbeitet).
 */

/**
 * Was der Nutzer zu einem Fehlschlag zu sehen bekommt — je Zustand ein eigener Satz.
 *
 * Der Schlüssel ist die Fehler-Union der Server Action und NICHT `string`: so wird ein neuer
 * Zustand im Backend hier zum Typfehler, statt still in einer Auffang-Meldung zu landen, die dem
 * Nutzer etwas Falsches erzählt.
 */
type ScanError = Extract<InvoiceScanResponse, { ok: false }>['error']

const ERROR_TEXT: Record<ScanError, { title: string; message: string }> = {
  no_file: {
    title: 'Keine Datei',
    message: 'Die Datei scheint leer zu sein. Bitte wählen Sie die PDF Ihrer Stromrechnung.',
  },
  wrong_type: {
    title: 'Nur PDF',
    message:
      'Wir können bislang nur PDF-Dateien auslesen. Ein Foto oder Screenshot der Rechnung geht ' +
      'noch nicht — bitte laden Sie die PDF Ihres Lieferanten hoch oder tragen Sie die Werte ' +
      'über einen der anderen beiden Einstiege selbst ein.',
  },
  too_large: {
    title: 'Datei zu gross',
    message:
      'Die Datei ist grösser als 6 MB. Eine Rechnung von ein bis wenigen Seiten liegt normalerweise ' +
      'weit darunter — bitte prüfen Sie, ob Sie versehentlich ein sehr hoch aufgelöstes Scan-Bild ' +
      'hochgeladen haben.',
  },
  unreadable: {
    title: 'Nichts gefunden',
    message:
      'Auf diesem Dokument war keine der gesuchten Angaben zu finden. Das kann an der Bildqualität ' +
      'liegen, aber auch daran, dass es keine Strom- oder Netzrechnung ist. Bitte tragen Sie die ' +
      'Werte über einen der anderen beiden Einstiege ein.',
  },
  not_configured: {
    title: 'Rechnungs-Scan derzeit nicht verfügbar',
    message:
      'Das Auslesen von Rechnungen ist auf diesem Server nicht eingerichtet. Die beiden anderen ' +
      'Einstiege oben funktionieren unverändert.',
  },
  unavailable: {
    title: 'Auslesen fehlgeschlagen',
    message:
      'Wir konnten die Rechnung gerade nicht auslesen. Bitte versuchen Sie es später noch einmal — ' +
      'oder tragen Sie die Werte über einen der anderen beiden Einstiege ein.',
  },
}

/** Nennt in einem Satz, was tatsächlich gelesen wurde. Ohne diese Liste ist der Scan eine Blackbox. */
function readFields(e: InvoiceExtraction): string[] {
  const found: string[] = []
  if (e.netzbetreiber) found.push(`Netzbetreiber (${NETZBETREIBER_LABELS[e.netzbetreiber]})`)
  if (e.netzebene != null) found.push(`Netzebene ${e.netzebene}`)
  if (e.meteringVariant) found.push(METERING_VARIANT_LABELS[e.meteringVariant])
  if (e.annualConsumptionKwh != null) {
    found.push(
      `Jahresverbrauch ${new Intl.NumberFormat('de-AT').format(Math.round(e.annualConsumptionKwh))} kWh`,
    )
  }
  if (e.rates.leistungspreisEurPerKwYear != null) found.push('Leistungspreis')
  if (e.rates.minBillableKw != null) found.push('vereinbarte Leistung')
  if (e.rates.energyPriceCtPerKwh != null) found.push('Arbeitspreis')
  if (e.rates.energyPriceNightCtPerKwh != null) found.push('Nachttarif')
  if (e.rates.einspeiseverguetungCtPerKwh != null) found.push('Einspeisevergütung')
  /*
   * Delta 19 / §3.7.3 — ausdrücklich „Ihres Lieferanten": auf der Rechnung steht daneben der
   * gleichnamige Grundpreis des NETZBETREIBERS, und der Kunde soll an dieser Zeile erkennen
   * können, welchen der beiden Posten wir gelesen haben.
   */
  if (e.rates.supplierBaseFeeEurPerMonth != null) found.push('Grundgebühr Ihres Lieferanten')
  return found
}

export function InvoiceScanPanel({
  onComplete,
}: {
  onComplete: (load: ParsedLoad, prefill: TariffPrefill) => void
}) {
  const [fileName, setFileName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ title: string; message: string } | null>(null)
  const [extraction, setExtraction] = useState<InvoiceExtraction | null>(null)

  async function handleFile(file: File) {
    setFileName(file.name)
    setError(null)
    setExtraction(null)
    setBusy(true)
    try {
      const response = await scanInvoice(file)
      if (!response.ok) {
        setError(ERROR_TEXT[response.error])
        return
      }
      setExtraction(response.extraction)
    } catch {
      /*
       * Eine Server Action kann auch am Netz scheitern, bevor sie ihren eigenen Fehlerzustand
       * bilden kann. Dann gilt dieselbe Meldung wie bei `unavailable` — und ausdrücklich KEIN
       * Weiterreichen der technischen Ursache: sie sagt dem Absender nichts und dem Angreifer etwas.
       */
      setError(ERROR_TEXT.unavailable)
    } finally {
      setBusy(false)
    }
  }

  const found = extraction ? readFields(extraction) : []

  return (
    <div className="flex flex-col gap-4">
      {/*
        ⚠ DER HINWEIS STEHT VOR DEM UPLOAD, NICHT DARUNTER. Er ist die Bedingung dafür, dass dieser
        Einstieg überhaupt live gehen darf — und er sagt die drei Dinge, die zählen: WOHIN die Datei
        geht, dass sie NIRGENDS gespeichert wird, und was zurückkommt.
      */}
      <div className="rounded-lg border border-border bg-surface-alt p-4 text-sm text-text">
        <p className="mb-2 font-medium text-ink">Was mit Ihrer Rechnung geschieht</p>
        <p className="text-text-muted">
          Anders als beim Lastgang und beim Standardprofil verlässt diese Datei Ihren Browser:
          Ihre Rechnung wird zum Auslesen an <strong>Anthropic</strong> übertragen, den Anbieter des
          Sprachmodells, das sie liest. Sie wird dabei <strong>nirgends gespeichert</strong> — weder
          bei uns noch in einer Datenbank oder einem Protokoll. Zurück kommen ausschliesslich die
          abgelesenen Zahlen, die Sie gleich vor sich sehen und jederzeit ändern können. Wenn Sie
          das nicht möchten, nutzen Sie einen der beiden anderen Einstiege — sie kommen zum selben
          Ergebnis, nur tippen Sie die Werte selbst ein.
        </p>
      </div>

      <FileDrop
        accept=".pdf,application/pdf"
        fileName={fileName}
        onFile={(file) => {
          void handleFile(file)
        }}
        title="Stromrechnung als PDF hierher ziehen oder klicken"
        hint="Jahresabrechnung Ihres Lieferanten — max. 6 MB"
      />

      {busy && (
        <p className="flex items-center gap-2 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
          Die Rechnung wird gelesen — das dauert einen Moment.
        </p>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{error.title}</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {extraction && (
        <>
          <Alert variant="default">
            <CheckCircle2 className="h-4 w-4 text-positive" />
            <AlertTitle>Rechnung gelesen</AlertTitle>
            <AlertDescription>
              {found.length > 0 ? (
                <>
                  Erkannt: {found.join(' · ')}. Alles Übrige stand nicht eindeutig auf der Rechnung
                  und bleibt leer — bitte tragen Sie es hier und im nächsten Schritt selbst ein.
                </>
              ) : (
                <>
                  Es liessen sich nur einzelne Angaben lesen. Bitte ergänzen Sie die fehlenden Werte
                  hier und im nächsten Schritt selbst.
                </>
              )}
            </AlertDescription>
          </Alert>

          {/*
            Der Jahresverbrauch geht in denselben Generator wie beim zweiten Einstieg — deshalb
            steht hier dessen Panel und keine zweite, eigene Eingabemaske. Wurde er gelesen, ist er
            vorbelegt; wurde er es nicht (etwa auf einer Teilabrechnung, die gar keinen Jahreswert
            ausweist), ist das Feld schlicht leer und der Nutzer trägt ihn ein.
          */}
          <StandardProfilePanel
            initialAnnualKwh={extraction.annualConsumptionKwh}
            onComplete={(load) =>
              onComplete(load, {
                netzbetreiber: extraction.netzbetreiber,
                netzebene: extraction.netzebene,
                meteringVariant: extraction.meteringVariant,
                rates: extraction.rates,
              })
            }
          />
        </>
      )}

      {!extraction && !busy && (
        <p className="flex items-start gap-1.5 text-xs text-text-muted">
          <Upload className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Aus der Rechnung lesen wir Netzbetreiber, Netzebene, Ihre Tarifsätze und den
          Jahresverbrauch. Aus dem Jahresverbrauch bilden wir dann dasselbe Standardprofil wie beim
          Einstieg daneben.
        </p>
      )}
    </div>
  )
}
