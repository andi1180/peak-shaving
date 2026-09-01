'use client'

import * as React from 'react'
import { Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { scanTariffSheet, type TariffSheetScanResponse } from '@/lib/admin/tariff-scan/actions'
import {
  MAX_TARIFF_SHEET_FILE_BYTES,
  type TariffSheetExtraction,
} from '@/lib/admin/tariff-sheet-scan'
import { AdminError, AdminPanel } from './ui'

/**
 * Der Tarifblatt-Scan über dem Anlagebereich.
 *
 * ── ⚠ ER FÜLLT DIE FORMULARE, ER SENDET SIE NICHT AB ──────────────────────────────────────────
 * Es gibt hier bewusst KEIN automatisches Absenden und keine Abkürzung dorthin — auch dann nicht,
 * wenn ein Blatt sieben Tarifzeilen auf einmal liefert. Ein Tarifstand ist nachträglich nicht mehr
 * korrigierbar (B21-2b: kein Bearbeiten, keine Update-Funktion; das Löschen aus B21-2c ist ein
 * protokollierter Rückbau für Probeeinträge) und geht in JEDE künftige Analyse SEINER Netzebene
 * ein. Was das Modell gelesen hat, ist ein VORSCHLAG; verantwortlich ist der Mensch, der ihn
 * bestätigt — je Zeile einzeln (s. `tariff-scan-candidates.tsx`).
 *
 * Deshalb sagt die Rückmeldung nach einem Scan zwei Dinge: was übernommen wurde UND dass jedes
 * Feld gegen das Blatt zu prüfen ist, bevor es abgeschickt wird.
 *
 * ── OHNE SCAN ÄNDERT SICH NICHTS ──────────────────────────────────────────────────────────────
 * Schlägt der Scan fehl oder ist er nicht eingerichtet, bleibt das Formular unverändert von Hand
 * ausfüllbar — es gibt keinen Zustand, in dem der Scan das Anlegen blockiert. Der Datei-Eingang
 * steht ausserhalb des `<form>`: ein verschachteltes Formular gibt es in HTML nicht, und die PDF
 * darf auf keinen Fall im Rumpf eines Tarif-Formulars mitfahren.
 */
export function TariffScanPanel({
  onExtracted,
}: {
  onExtracted: (extraction: TariffSheetExtraction) => void
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [summary, setSummary] = React.useState<string | null>(null)

  async function run() {
    const file = inputRef.current?.files?.[0] ?? null
    setError(null)
    setSummary(null)
    setPending(true)
    try {
      const result = await scanTariffSheet(file)
      if (!result.ok) {
        setError(ERROR_TEXTS[result.error])
        return
      }
      onExtracted(result.extraction)
      setSummary(describe(result.extraction))
    } catch {
      /*
       * Ein Netzabbruch oder ein Fehler der Server Action selbst. Der Zustand ist derselbe wie
       * `unavailable` — das Formular bleibt unberührt und von Hand ausfüllbar.
       */
      setError(ERROR_TEXTS.unavailable)
    } finally {
      setPending(false)
    }
  }

  return (
    <AdminPanel className="bg-surface-sunken">
      <h4 className="text-small font-semibold text-ink">Preisblatt auslesen (optional)</h4>
      <p className="mt-1 max-w-prose text-caption text-text-muted">
        Laden Sie das veröffentlichte Preisblatt als PDF hoch. Für jede erkannte Tarifzeile —
        Netzebene und, wo das Blatt sie unterscheidet, Messvariante — entsteht darunter ein eigenes,
        vorbelegtes Formular. <span className="font-medium text-text">Abgeschickt wird nichts</span>;
        jede Zeile wird einzeln geprüft und einzeln angelegt. Ein einmal angelegter Tarifstand lässt
        sich nicht mehr korrigieren.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          aria-label="Preisblatt als PDF"
          onChange={() => {
            setError(null)
            setSummary(null)
          }}
          className="text-small text-text file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-small file:text-ink hover:file:bg-surface-sunken"
        />
        <Button type="button" variant="secondary" size="sm" onClick={run} disabled={pending}>
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
          ) : (
            <Upload className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          )}
          {pending ? 'Wird gelesen …' : 'Preisblatt auslesen'}
        </Button>
      </div>

      <p className="mt-2 text-caption text-text-muted">
        Nur PDF, höchstens {MAX_TARIFF_SHEET_FILE_BYTES / (1024 * 1024)} MB. Die Datei wird zur
        Auswertung an Anthropic übertragen und dort nicht gespeichert.
      </p>

      <span role="status" aria-live="polite" className="sr-only">
        {pending ? 'Preisblatt wird gelesen …' : ''}
      </span>

      {error && <div className="mt-4">{<AdminError>{error}</AdminError>}</div>}

      {summary && (
        <div
          role="status"
          className="mt-4 rounded-md border border-accent-border bg-accent-subtle p-3 text-small text-ink"
        >
          {summary}
        </div>
      )}
    </AdminPanel>
  )
}

/**
 * Die Rückmeldung nach einem gelaufenen Scan.
 *
 * ── SIE ZÄHLT, WAS ANKAM — UND BENENNT, WAS FEHLT ─────────────────────────────────────────────
 * Zwei Zahlen genügen hier nicht. Ein Blatt zerfällt seit der Mehr-Ebenen-Extraktion in zwei ganz
 * verschiedene Dinge: die TARIFZEILEN (je eine Kombination aus Netzebene und Messvariante) und die
 * drei BLATTWEITEN Angaben, die für alle gemeinsam gelten. Fehlt eine der drei, fehlt sie in JEDEM
 * Formular darunter — das ist eine andere Aussage als „eine Zeile weniger gefunden" und wird
 * deshalb getrennt genannt, mit Namen statt als Zahl.
 *
 * Ebenfalls ausdrücklich genannt: Zeilen ohne Zeitfenster. Ein Tarifstand ohne Arbeitspreis lässt
 * sich gar nicht anlegen (`create_grid_tariff` antwortet `no_windows`) — wer das erst beim
 * Absenden erfährt, hat vorher alles andere geprüft.
 *
 * Der Prüfsatz steht in jedem Fall dabei.
 */
const SHEET_WIDE_FIELDS = [
  { key: 'operatorName', label: 'Netzbetreiber' },
  { key: 'priceBasis', label: 'Preisbasis' },
  { key: 'validFrom', label: 'Gültig ab' },
] as const satisfies readonly { key: keyof TariffSheetExtraction; label: string }[]

/** „A", „A und B", „A, B und C" — eine Aufzählung, die sich vorlesen lässt. */
function germanList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} und ${items[items.length - 1]}`
}

function describe(extraction: TariffSheetExtraction): string {
  const rows = extraction.candidates.length
  const rowText =
    rows === 0
      ? 'keine Tarifzeile sicher zuordenbar'
      : `${rows} ${rows === 1 ? 'Tarifzeile' : 'Tarifzeilen'} erkannt`

  const present = SHEET_WIDE_FIELDS.filter((field) => extraction[field.key] !== null)
  const missing = SHEET_WIDE_FIELDS.filter((field) => extraction[field.key] === null)

  const sheetWide =
    missing.length === 0
      ? `Blattweit übernommen: ${germanList(SHEET_WIDE_FIELDS.map((f) => f.label))}.`
      : present.length === 0
        ? 'Blattweit wurde nichts erkannt — Netzbetreiber, Preisbasis und Gültig ab sind zu ergänzen.'
        : `Blattweit übernommen: ${germanList(present.map((f) => f.label))}; es fehlt ` +
          `${germanList(missing.map((f) => f.label))}.`

  const withoutWindows = extraction.candidates.filter((c) => c.windows.length === 0).length
  const windowNote =
    withoutWindows === 0
      ? ''
      : ` ${withoutWindows} ${withoutWindows === 1 ? 'Zeile trägt' : 'Zeilen tragen'} kein ` +
        'Zeitfenster — ohne mindestens eines lässt sich ein Tarifstand nicht anlegen.'

  const closing =
    rows === 0
      ? ' Bitte die Werte von Hand ergänzen.'
      : ' Bitte jeden übernommenen Wert gegen das Blatt prüfen; jede Zeile wird einzeln angelegt.'

  return `Preisblatt gelesen: ${rowText}. ${sheetWide}${windowNote}${closing}`
}

/** Die Zustände, die der Scan melden kann — aus der Antwort abgeleitet, nicht abgetippt. */
type ScanError = Extract<TariffSheetScanResponse, { ok: false }>['error']

/**
 * Je Zustand ein eigener Satz. „Nicht eingerichtet" ist kein Fehler des Blattes.
 *
 * Die Liste ist über die Zustands-Union getypt: ein neuer Ausgang der Server Action macht diese
 * Stelle rot, statt dem Admin ein leeres Fehlerfeld zu zeigen.
 */
const ERROR_TEXTS: Record<ScanError, string> = {
  forbidden: 'Keine Berechtigung. Bitte laden Sie die Seite neu.',
  no_file: 'Bitte zuerst eine PDF-Datei auswählen.',
  wrong_type: 'Nur PDF-Dateien. Ein Foto oder ein Screenshot lässt sich hier nicht auslesen.',
  too_large: `Die Datei ist zu gross (höchstens ${MAX_TARIFF_SHEET_FILE_BYTES / (1024 * 1024)} MB).`,
  not_configured:
    'Der Tarifblatt-Scan ist derzeit nicht eingerichtet. Das Formular darunter lässt sich ' +
    'unverändert von Hand ausfüllen.',
  unreadable:
    'Auf diesem Blatt war nichts zu finden. Möglicherweise ist es kein Netz-Preisblatt oder die ' +
    'Seiten sind nicht lesbar. Bitte von Hand ausfüllen.',
  unavailable:
    'Das Auslesen ist fehlgeschlagen. Bitte erneut versuchen — oder das Formular darunter von ' +
    'Hand ausfüllen.',
}
