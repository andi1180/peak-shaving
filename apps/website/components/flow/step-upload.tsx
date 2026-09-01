'use client'

import { useState } from 'react'
import { AlertTriangle, ArrowRight, ShieldCheck, XCircle } from 'lucide-react'
import { parseLoadProfile } from 'engine'
import type { ColumnMapping, Detection, Unit, ValueColumnInfo } from 'engine'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { rejectIfBeforeAnchor } from '@/lib/anchor-rule'
import { readForParsing, type ParseInput } from '@/lib/file-input'
import { cn } from '@/lib/utils'
import { FileDrop } from './file-drop'
import { InvoiceScanPanel } from './invoice-scan-panel'
import { MappingPanel } from './mapping-panel'
import { MixedUploadPanel } from './mixed-upload-panel'
import { StandardProfilePanel } from './standard-profile-panel'
import type { ParsedLoad, TariffPrefill } from './types'

/**
 * Eine Meldung im Upload-Schritt. `title` ist Teil der Meldung und nicht aus `kind` abgeleitet:
 * ein abgelehnter ZEITRAUM (Delta 15, Regel B) ist kein Lesefehler — „Datei konnte nicht gelesen
 * werden" wäre dort schlicht unwahr und schickte den Nutzer auf die Suche nach einem Formatproblem.
 */
type Notice = { kind: 'warning' | 'error'; title: string; message: string }
// Aktiver Mehrspalten-Mapping-Fall (§3.2): der Nutzer bestätigt die Rollen, dann wird `input` mit den
// gewählten Spalten erneut geparst. `input` bleibt erhalten, um genau diese Datei neu parsen zu können.
type MappingState = {
  input: ParseInput
  fileName: string
  detection: Detection
  valueColumns: ValueColumnInfo[]
}

/**
 * Die vier Einstiege. Beschriftung und Datenschutz-Satz stehen hier BEIEINANDER, damit ein weiterer
 * Modus nicht an der einen Stelle ergänzt und an der anderen vergessen werden kann — genau das
 * passierte sonst beim Satz unten, der vorher eine Ja/Nein-Verzweigung war.
 *
 * ⚠ Die Spaltenzahl der Umschaltleiste weiter unten folgt der LÄNGE dieser Liste und ist als
 * Tailwind-Klasse ausgeschrieben (dynamisch zusammengesetzte Klassennamen entfernt der
 * Build-Schritt). Wer hier einen fünften Eintrag ergänzt, zieht sie mit.
 */
const MODES = [
  {
    value: 'datei',
    label: 'Lastgang-Datei',
    privacy: 'Die Datei wird ausschließlich in Ihrem Browser verarbeitet und nicht hochgeladen.',
  },
  {
    value: 'standardprofil',
    label: 'Standardprofil / Verbrauch',
    privacy: 'Ihre Angaben werden ausschließlich in Ihrem Browser verarbeitet und nicht übertragen.',
  },
  {
    /*
     * ⚠ DER EINZIGE SATZ DIESER LISTE, DER KEINE ZUSICHERUNG IST, SONDERN EINE OFFENLEGUNG.
     * Die beiden Sätze darüber wären hier schlicht UNWAHR: die Rechnung wird sehr wohl übertragen.
     * Ihn wiederzuverwenden wäre deshalb kein Schönheitsfehler, sondern eine falsche Zusage an
     * einer Stelle, an der der Nutzer gerade eine Datei mit seinem Namen darauf ablegt.
     */
    value: 'rechnungsscan',
    label: 'Stromrechnung (PDF)',
    privacy:
      'Ihre Rechnung wird zum Auslesen an Anthropic übertragen und dabei nirgends gespeichert; ' +
      'zurück kommen nur die abgelesenen Werte.',
  },
  {
    /*
     * Delta 17 — der einzige Satz dieser Liste, der ZWEI verschiedene Zusagen macht, weil dieser
     * Einstieg zwei verschiedene Wege enthält: Lastgänge werden im Browser gelesen, PDFs übertragen.
     * Ihn auf die schärfere der beiden zu verkürzen („wird übertragen") wäre unnötig abschreckend,
     * auf die mildere zu verkürzen wäre eine falsche Zusage. Also beide, in einem Satz.
     */
    value: 'gemischt',
    label: 'Mehrere Unterlagen',
    privacy:
      'Lastgang-Dateien (CSV/XLSX) bleiben in Ihrem Browser; PDF-Dateien werden zum Einordnen ' +
      'und Auslesen an Anthropic übertragen und dabei nirgends gespeichert.',
  },
] as const
type Mode = (typeof MODES)[number]['value']

export function StepUpload({
  initialLoad,
  onComplete,
}: {
  initialLoad: ParsedLoad | null
  /**
   * Delta 9b-2b: das zweite Argument trägt die aus einer Rechnung abgelesenen Tarifangaben nach
   * Schritt 2. Es ist OPTIONAL, weil es die beiden anderen Einstiege nicht gibt — ein Lastgang und
   * ein von Hand eingetragener Jahresverbrauch sagen über den Tarif nichts, und ein leeres Objekt
   * an ihrer Stelle wäre eine Aussage, die sie nicht treffen.
   */
  onComplete: (load: ParsedLoad, tariffPrefill?: TariffPrefill) => void
}) {
  const [fileName, setFileName] = useState<string | null>(initialLoad?.fileName ?? null)
  const [load, setLoad] = useState<ParsedLoad | null>(initialLoad)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [mapping, setMapping] = useState<MappingState | null>(null)
  const [mappingError, setMappingError] = useState<string | null>(null)
  /*
   * Delta 9b / Delta 17 — welcher der vier Einstiege gerade offen ist. Sie stehen NEBENEINANDER und
   * nicht untereinander: Delta 9b nennt sie ausdrücklich gleichwertige Startpunkte, und als
   * „Notlösung" unter dem Upload versteckt erreichten die neuen genau die Zielgruppe nicht, für die
   * es sie gibt.
   *
   * Die Datei-Seite bleibt der Vorgabewert und ist in ihrem Verhalten UNVERÄNDERT — kein Pfad
   * dieses Zweigs ist angefasst; dasselbe gilt für die beiden Panels der Modi 2 und 3.
   *
   * ⚠ `rechnungsscan` und `gemischt` sind die Modi, in denen etwas das Gerät verlassen KANN. Das
   * ist nicht nur eine Zeile weiter unten sichtbar, sondern trägt je einen eigenen Datenschutz-Satz
   * (s. ganz unten) UND einen eigenen Hinweisblock direkt am Upload (`InvoiceScanPanel` bzw.
   * `MixedUploadPanel`). Im vierten Modus gilt die Zusage für Lastgänge unverändert weiter — dort
   * wird ausschliesslich eine PDF übertragen (Begründung im Kopf des Panels).
   */
  const [mode, setMode] = useState<Mode>('datei')

  async function handleFile(file: File) {
    setFileName(file.name)
    setLoad(null)
    setNotice(null)
    setMapping(null)
    setMappingError(null)

    const input = await readForParsing(file)
    const outcome = parseLoadProfile(input)

    if (outcome.ok) {
      // Delta 15, Regel B — VOR jeder Übernahme in den Flow.
      const tooOld = rejectIfBeforeAnchor(outcome.profile, outcome.detection.timezone)
      if (tooOld) {
        setNotice({ kind: 'error', title: 'Zeitraum nicht auswertbar', message: tooOld })
        return
      }
      setLoad({
        fileName: file.name,
        profile: outcome.profile,
        dataQuality: outcome.dataQuality,
        sourceBytes: input.bytes,
      })
      return
    }
    if (outcome.kind === 'needs_mapping') {
      // Mehrere Wert-Spalten → Bestätigungs-Panel (§3.2). Ohne Spaltenliste (z. B. nur Einheit
      // uneindeutig) fällt es auf die einfache Meldung zurück — dafür gibt es noch keine Korrektur-UI.
      if (outcome.valueColumns && outcome.valueColumns.length > 0) {
        setMapping({
          input,
          fileName: file.name,
          detection: outcome.detection,
          valueColumns: outcome.valueColumns,
        })
        return
      }
      setNotice({
        kind: 'warning',
        title: 'Format unklar',
        message: outcome.issues.map((i) => i.message).join(' '),
      })
      return
    }
    setNotice({
      kind: 'error',
      title: 'Datei konnte nicht gelesen werden',
      message: outcome.error.message,
    })
  }

  // Bestätigte Rollen → erneuter Parser-Aufruf mit den gewählten Spalten. 'ok' → normaler Pfad.
  function handleMappingConfirm(columns: ColumnMapping, unit: Unit | undefined) {
    if (!mapping) return
    setMappingError(null)
    const outcome = parseLoadProfile(mapping.input, { columns, unit })
    if (outcome.ok) {
      // Delta 15, Regel B — auch hier, und nicht nur im stillen Pfad: die bestätigte Zuordnung
      // erzeugt denselben Lastgang, und eine Regel, die nur einen von zwei Wegen abdeckt, ist keine.
      const tooOld = rejectIfBeforeAnchor(outcome.profile, outcome.detection.timezone)
      if (tooOld) {
        setMappingError(tooOld)
        return
      }
      onComplete({
        fileName: mapping.fileName,
        profile: outcome.profile,
        dataQuality: outcome.dataQuality,
        sourceBytes: mapping.input.bytes,
      })
      return
    }
    // Edge Case: Bestätigung führt selbst zu einem Problem → sauber im Panel anzeigen, kein Crash.
    if (outcome.kind === 'needs_mapping') {
      setMappingError(
        `Die Zuordnung ist noch nicht eindeutig: ${outcome.issues.map((i) => i.message).join(' ')}`,
      )
      return
    }
    setMappingError(outcome.error.message)
  }

  function handleCancelMapping() {
    setMapping(null)
    setMappingError(null)
    setFileName(null)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Verbrauchsdaten</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!mapping && (
          <div className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-surface-alt p-1 sm:grid-cols-2 lg:grid-cols-4">
            {MODES.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
                className={cn(
                  'rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  mode === value
                    ? 'bg-surface text-ink shadow-sm'
                    : 'text-text-muted hover:text-ink',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {!mapping && mode === 'standardprofil' && <StandardProfilePanel onComplete={onComplete} />}
        {!mapping && mode === 'rechnungsscan' && <InvoiceScanPanel onComplete={onComplete} />}
        {!mapping && mode === 'gemischt' && <MixedUploadPanel onComplete={onComplete} />}
        {mapping ? (
          <MappingPanel
            detection={mapping.detection}
            valueColumns={mapping.valueColumns}
            error={mappingError}
            onConfirm={handleMappingConfirm}
            onCancel={handleCancelMapping}
          />
        ) : (
          mode === 'datei' && (
          <>
            <FileDrop
              accept=".csv,.xlsx,.xls"
              fileName={fileName}
              onFile={(f) => {
                void handleFile(f)
              }}
              title="CSV/XLSX hierher ziehen oder klicken"
              hint="Netzbetreiber-Export (Wiener Netze, Netz NÖ, Salzburg …) — max. 12 Monate"
            />
            {notice && (
              <Alert variant={notice.kind === 'error' ? 'destructive' : 'warning'}>
                {notice.kind === 'error' ? (
                  <XCircle className="h-4 w-4" />
                ) : (
                  <AlertTriangle className="h-4 w-4" />
                )}
                <AlertTitle>{notice.title}</AlertTitle>
                <AlertDescription>{notice.message}</AlertDescription>
              </Alert>
            )}
            <div className="flex justify-end">
              <Button disabled={!load} onClick={() => load && onComplete(load)}>
                Weiter
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </>
          )
        )}
        {/*
          Der Satz kommt aus `MODES` und nicht aus einer Verzweigung: mit dem dritten Einstieg wäre
          aus der Ja/Nein-Frage eine verschachtelte Bedingung geworden, in der der Vorgabewert
          („nicht hochgeladen") für einen Modus gilt, für den er nicht stimmt.
        */}
        <p className="flex items-start gap-1.5 text-xs text-text-muted">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
          {MODES.find((m) => m.value === mode)?.privacy}
        </p>
      </CardContent>
    </Card>
  )
}
