'use client'

import { useState } from 'react'
import { AlertTriangle, Ban, Loader2, Sparkles, Wand2 } from 'lucide-react'
import {
  buildRecomputeProposal,
  type BillingModel,
  type ProposedChange,
  type ReportRequestCurrent,
  type ReportRequestField,
  type ReportRequestUnsupported,
} from 'shared'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { readReportRequest, type ReportRequestResponse } from '@/lib/report-request/actions'
import { Num } from './num'

/**
 * Delta 18 — „Was soll ich anders rechnen?" als freier Satz.
 *
 * ── ⚠ DIE RANDBEDINGUNG, DIE DEN GANZEN BAUSTEIN TRÄGT ────────────────────────────────────────
 * Dieses Feld ist eine ÜBERSETZUNG in das Annahmen-Panel darunter, keine Erweiterung des Rechners.
 * Es kann GENAU die acht Grössen ändern, die eine Neuberechnung entgegennimmt — und es erfindet
 * weder einen Zeitraum noch eine Batteriegrösse ausserhalb des Katalogs noch einen Schalter für den
 * Börsenpreis-Vergleich. Was am Ende passiert, ist derselbe `onRecompute`-Aufruf, den auch das
 * Panel auslöst.
 *
 * ── ⚠ ES WIRD NICHTS AUTOMATISCH ANGEWENDET ───────────────────────────────────────────────────
 * Zwischen dem Gelesenen und dem Gerechneten steht eine VORSCHAU (Feld: alt → neu) und ein
 * ausdrückliches „Übernehmen" — exakt das Muster der beiden Freitext-Bausteine aus Delta 17. Hier
 * ist es besonders wichtig: der Nutzer sieht ein fertiges Ergebnis vor sich, und ein Satz, der es
 * ohne Rückfrage verändert, macht aus einer Auskunft eine Überraschung.
 *
 * ── ⚠ WAS NICHT GEHT, WIRD GESAGT — NICHT VERSCHWIEGEN ────────────────────────────────────────
 * „Zeig mir nur das zweite Halbjahr" bekommt eine Absage mit Grund, keine stille Nicht-Reaktion und
 * keine erfundene Ausweich-Antwort. Ein ignorierter Wunsch wäre der schlimmere Ausgang: der Nutzer
 * hielte das nächste Ergebnis für die Antwort auf seine Frage.
 */

type ReadError = Extract<ReportRequestResponse, { ok: false }>['error']

const ERROR_TEXT: Record<ReadError, { title: string; message: string }> = {
  no_text: {
    title: 'Nichts eingetragen',
    message: 'Bitte beschreiben Sie kurz, was der Rechner anders annehmen soll.',
  },
  unreadable: {
    title: 'Kein Wunsch erkannt',
    message:
      'Aus dieser Anfrage liess sich nichts lesen, was der Rechner ändern könnte. Hilfreich sind ' +
      'konkrete Angaben wie „15 Jahre Betrachtungszeitraum", „5 % Förderung" oder „mit dem ' +
      'Jahreshöchstwert rechnen". Sie können alle Werte auch unten von Hand einstellen.',
  },
  not_configured: {
    title: 'Nicht verfügbar',
    message:
      'Das Auslesen freier Anfragen ist auf diesem Server nicht eingerichtet. Die Annahmen lassen ' +
      'sich unten unverändert von Hand ändern — es fehlt nur diese Abkürzung.',
  },
  unavailable: {
    title: 'Auslesen fehlgeschlagen',
    message:
      'Wir konnten Ihre Anfrage gerade nicht auslesen. Bitte versuchen Sie es später noch einmal — ' +
      'unten lässt sich alles auch von Hand einstellen.',
  },
}

/**
 * ⚠ DIE ABSAGEN STEHEN HIER UND NICHT IM MODELL. Es wählt aus einer geschlossenen Liste von
 * Gründen; die Sätze schreiben wir. Käme der Text aus der Antwort, stünde im Report eine Auskunft
 * über den Rechner, die niemand geprüft hat.
 *
 * Jeder Satz nennt den GRUND aus der Randbedingung — und, wo es einen gibt, den Weg, der trotzdem
 * ans Ziel führt. Eine Absage ohne Ausweg ist eine Sackgasse; eine Absage mit Ausweg ist eine
 * Auskunft.
 */
const UNSUPPORTED_TEXT: Record<ReportRequestUnsupported, string> = {
  zeitraum:
    'Ein anderer Zeitraum der Verbrauchsdaten: Die Analyse rechnet immer über den ganzen ' +
    'hochgeladenen Lastgang — einen Ausschnitt daraus (Monat, Halbjahr, Jahreszeit) kann sie ' +
    'nicht bilden. Für einen anderen Zeitraum braucht es einen Lastgang dieses Zeitraums.',
  batteriekapazitaet:
    'Eine frei gewählte Speichergrösse: Gerechnet wird gegen einen festen Gerätekatalog. ' +
    'Kapazität und Leistung bestimmen die Physik der Simulation und lassen sich nicht einzeln ' +
    'setzen — Wirkungsgrad und Preis dagegen schon.',
  andere_batterie:
    'Ein anderer Speicher aus dem Katalog: Das geht, aber nicht über dieses Feld — die Auswahl ' +
    'steht im Energiefluss-Chart oben („Tages-Energiefluss"). Wirkungsgrad und Preis, die Sie ' +
    'hier nennen, gelten immer für den dort gerade gewählten Speicher.',
  boersenpreis_hebel:
    'Der Vergleich mit Börsen-Strompreisen: Er wird in Schritt 2 zusammen mit Netzbetreiber und ' +
    'Netzebene eingeschaltet, weil dafür Preisdaten geladen werden müssen. Aus dem fertigen ' +
    'Ergebnis heraus lässt er sich nicht nachträglich zuschalten.',
  energiepreise:
    'Arbeitspreis, Einspeisevergütung, Leistungspreis oder Mindestleistung: Diese Werte stammen ' +
    'aus Ihrer Netzrechnung und sind die Grundlage der Rechnung, nicht eine Annahme darin. Sie ' +
    'lassen sich in Schritt 2 ändern.',
  lastgang:
    'Andere Verbrauchsdaten oder ein PV-Profil: Dafür beginnt eine neue Analyse — der Knopf ' +
    '„Neue Analyse" oben führt zurück zum Upload.',
  sonstiges:
    'Dieser Teil Ihrer Anfrage passt in keine der Stellschrauben, die der Rechner hat. Möglich ' +
    'sind: Abrechnungsmodell, Betrachtungshorizont, Förderung (Prozent oder Betrag), ' +
    'Abschreibungsdauer, Steuersatz sowie Wirkungsgrad und Preis des angezeigten Speichers. ' +
    'Relative Angaben („doppelt so lang") kann der Rechner nicht auflösen — bitte den Zielwert nennen.',
}

const FIELD_LABEL: Record<ReportRequestField, string> = {
  billingModel: 'Abrechnungsmodell',
  horizonYears: 'Betrachtungshorizont',
  subsidyPercent: 'Förderung',
  fixedSubsidyEur: 'Pauschale Förderung',
  depreciationYears: 'Abschreibungsdauer (AfA)',
  taxRatePercent: 'Steuersatz',
  roundTripEfficiencyPercent: 'Wirkungsgrad',
  pricePerKwh: 'Batteriepreis',
}

const FIELD_UNIT: Partial<Record<ReportRequestField, string>> = {
  horizonYears: 'Jahre',
  subsidyPercent: '%',
  fixedSubsidyEur: '€',
  depreciationYears: 'Jahre',
  taxRatePercent: '%',
  roundTripEfficiencyPercent: '%',
  pricePerKwh: '€/kWh',
}

const BILLING_LABEL: Record<BillingModel, string> = {
  annual_max: 'Jahreshöchstwert',
  monthly_max_average: 'Mittel der 12 Monatshöchstwerte',
  monthly_max_sum: 'Summe der 12 Monatshöchstwerte',
}

const fmt = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 2 })

/** „10 Jahre" · „nicht angegeben" · „Jahreshöchstwert" — dieselbe Sprache wie das Panel darunter. */
function formatValue(field: ReportRequestField, value: BillingModel | number | null): string {
  if (value === null) return 'nicht angegeben'
  if (field === 'billingModel') return BILLING_LABEL[value as BillingModel]
  const unit = FIELD_UNIT[field]
  return unit ? `${fmt.format(value as number)} ${unit}` : fmt.format(value as number)
}

export function ReportRequestPanel({
  current,
  batteryName,
  recomputing,
  onApply,
}: {
  /** Der aktuell WIRKSAME Stand — aus den Eingaben des angezeigten Laufs, nicht aus Schritt 2. */
  current: ReportRequestCurrent
  /** Name der Batterie, für die Wirkungsgrad und Preis gelten. */
  batteryName: string
  recomputing: boolean
  /** Übergibt GENAU die bestätigten Änderungen; die Übersetzung in eine Neuberechnung macht der Report. */
  onApply: (changes: ProposedChange[]) => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ title: string; message: string } | null>(null)
  const [changes, setChanges] = useState<ProposedChange[] | null>(null)
  const [unsupported, setUnsupported] = useState<ReportRequestUnsupported[]>([])
  /** Nach dem Übernehmen: was tatsächlich angewandt wurde. Sonst stünde dort weiter ein Vorschlag. */
  const [applied, setApplied] = useState<ProposedChange[] | null>(null)

  async function handleRead() {
    setError(null)
    setChanges(null)
    setUnsupported([])
    setApplied(null)
    setBusy(true)
    try {
      const response = await readReportRequest(text)
      if (!response.ok) {
        setError(ERROR_TEXT[response.error])
        return
      }
      /*
       * Der Vergleich mit dem Ist-Stand passiert HIER, nicht im Modell: es kennt den Stand gar
       * nicht (er wird bewusst nicht mitgeschickt) und soll ihn auch nicht kennen. `buildRecompute-
       * Proposal` ist rein und geprüft — und lässt Felder weg, die ohnehin schon so eingestellt
       * sind, damit die Vorschau nicht „15 Jahre → 15 Jahre" zeigt.
       */
      const proposal = buildRecomputeProposal(response.extraction, current)
      setChanges(proposal.changes)
      setUnsupported(proposal.unsupported)
    } catch {
      // Eine Server Action kann auch am Netz scheitern, bevor sie ihren Fehlerzustand bilden kann.
      setError(ERROR_TEXT.unavailable)
    } finally {
      setBusy(false)
    }
  }

  function handleApply() {
    if (!changes || changes.length === 0) return
    setApplied(changes)
    setChanges(null)
    setUnsupported([])
    onApply(changes)
  }

  const batteryFields = changes?.filter(
    (c) => c.field === 'roundTripEfficiencyPercent' || c.field === 'pricePerKwh',
  )

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6 print:hidden">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reportAnfrage" className="flex items-center gap-2 text-base">
          <Wand2 className="h-4 w-4 text-accent" aria-hidden="true" />
          Was soll ich anders rechnen?
        </Label>
        <p className="text-sm text-text-muted">
          Beschreiben Sie es in eigenen Worten — der Rechner stellt danach genau die Annahmen um,
          die Sie unten unter „Annahmen &amp; Rechenweise" auch von Hand ändern könnten. Nichts wird
          übernommen, bevor Sie es bestätigt haben.
        </p>
        <Textarea
          id="reportAnfrage"
          value={text}
          maxLength={400}
          placeholder="z. B. Rechne mit 15 Jahren Horizont und 5 % Förderung"
          onChange={(event) => setText(event.target.value)}
        />
        <p className="text-xs text-text-muted">
          Ihre Anfrage wird zum Auslesen an Anthropic übertragen und dabei nirgends gespeichert. Es
          gehen ausschliesslich diese Zeilen hinaus — weder Ihr Lastgang noch Ihr Ergebnis.
        </p>
      </div>

      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={text.trim() === '' || busy || recomputing}
          onClick={() => void handleRead()}
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              Wird gelesen …
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Anfrage lesen
            </>
          )}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{error.title}</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {/* ── Die Vorschau: Feld, alt, neu — und erst danach ein Knopf. ───────────────────────── */}
      {changes && changes.length > 0 && (
        <div
          className="flex flex-col gap-3 rounded-lg border border-border bg-surface-alt p-4"
          data-testid="anfrage-vorschau"
        >
          <p className="text-sm font-medium text-ink">
            Das würde sich ändern — bitte bestätigen:
          </p>
          <ul className="flex flex-col divide-y divide-border">
            {changes.map((c) => (
              <li
                key={c.field}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm"
              >
                <span className="text-text-muted">{FIELD_LABEL[c.field]}</span>
                <span className="flex items-baseline gap-2">
                  <Num className="text-text-muted line-through">
                    {formatValue(c.field, c.from)}
                  </Num>
                  <span aria-hidden="true" className="text-text-muted">
                    →
                  </span>
                  <Num className="font-medium text-ink">{formatValue(c.field, c.to)}</Num>
                </span>
              </li>
            ))}
          </ul>
          {batteryFields && batteryFields.length > 0 && (
            <p className="text-xs text-text-muted">
              Wirkungsgrad und Preis gelten für den gerade angezeigten Speicher{' '}
              <strong>{batteryName}</strong>. Einen anderen wählen Sie oben im Energiefluss-Chart.
            </p>
          )}
          <div>
            <Button type="button" size="sm" onClick={handleApply} disabled={recomputing}>
              {recomputing ? 'Rechnet neu …' : 'Übernehmen und neu rechnen'}
            </Button>
          </div>
        </div>
      )}

      {/* Verstanden, aber nichts zu tun — eine eigene Aussage, kein Fehler. */}
      {changes && changes.length === 0 && unsupported.length === 0 && (
        <Alert data-testid="anfrage-ohne-aenderung">
          <AlertTitle>Nichts zu ändern</AlertTitle>
          <AlertDescription>
            Der Rechner rechnet bereits mit diesen Annahmen — Ihre Anfrage würde am Ergebnis nichts
            verändern.
          </AlertDescription>
        </Alert>
      )}

      {/* ── Die Absagen: was nicht geht, und warum. ────────────────────────────────────────── */}
      {unsupported.length > 0 && (
        <Alert data-testid="anfrage-abgelehnt">
          <Ban className="h-4 w-4" />
          <AlertTitle>
            {changes && changes.length > 0
              ? 'Einen Teil Ihrer Anfrage kann ich nicht umsetzen'
              : 'Das kann ich nicht ändern'}
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-2 pl-4">
              {unsupported.map((reason) => (
                <li key={reason}>{UNSUPPORTED_TEXT[reason]}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {applied && (
        <Alert data-testid="anfrage-uebernommen">
          <AlertTitle>Übernommen</AlertTitle>
          <AlertDescription>
            Neu gerechnet mit:{' '}
            {applied
              .map((c) => `${FIELD_LABEL[c.field]} ${formatValue(c.field, c.to)}`)
              .join(' · ')}
            . Die Zahlen oben sind aktualisiert; „Zurücksetzen" unter „Annahmen &amp; Rechenweise"
            führt zum ursprünglichen Ergebnis zurück.
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
