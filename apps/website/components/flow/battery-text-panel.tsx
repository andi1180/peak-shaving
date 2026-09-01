'use client'

import { useState } from 'react'
import { AlertTriangle, BatteryCharging, CheckCircle2, Loader2, Sparkles } from 'lucide-react'
import { buildExistingBatteryCandidate, type BatteryTextExtraction } from 'shared'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { readBatteryText, type BatteryTextResponse } from '@/lib/battery-text/actions'
import { ASSUMED_EXISTING_ROUND_TRIP_EFFICIENCY } from '@/lib/constants'
import type { ExistingBatteryInput } from './types'

/**
 * Delta 17 Teil 2 — „Haben Sie schon einen Speicher?" als freier Satz.
 *
 * ── ⚠ DIE ANGABE WIRD NICHT MEHR AUF DEN KATALOG GERUNDET (01.09.2026) ────────────────────────
 * Bis dahin wurde eine genannte Kapazität dem NÄCHSTLIEGENDEN der fünf Katalog-Kandidaten
 * zugeordnet, und der Abstand wurde ausdrücklich benannt („19,2 kWh liegt zwischen 15 und 25 —
 * kein exakter Treffer"). Die Begründung war, dass es für eine erfundene Kapazität keinen Preis
 * gibt. Sie trägt weiterhin für die KAUFENTSCHEIDUNG — für die bereits installierte Anlage trägt
 * sie nicht: dort weist der Report gar keinen Preis aus (die Anschaffung ist bezahlt), und übrig
 * blieb eine Ersparnis, die zu einem Gerät gehört, das der Kunde nicht besitzt. Ein benannter
 * Abstand macht eine falsche Zahl nicht richtig, er macht sie nur erklärt.
 *
 * Der Speicher wird deshalb mit seinen EXAKTEN Werten simuliert. Er läuft dafür ausserhalb von
 * `recommendBattery`/`perBattery` (kein Ranking, keine Empfehlung, keine Investition) — die
 * Empfehlung aus dem Katalog bleibt davon unberührt und beantwortet die andere Frage: ob sich
 * ZUSÄTZLICH ein Gerät lohnt.
 *
 * ── ⚠ WAS DAFÜR IM SATZ STEHEN MUSS ───────────────────────────────────────────────────────────
 * Kapazität UND Leistung. Beide bestimmen die Physik (§3.6: kWh und kW), und keine von beiden
 * lässt sich aus der anderen erschliessen — ein 20-kWh-Speicher mit 5 kW ist ein anderes Gerät als
 * einer mit 20 kW. Fehlt eine der beiden, wird NICHTS übernommen und die Oberfläche sagt, was
 * fehlt (statt eine C-Rate zu erfinden). Der Wirkungsgrad ist die einzige Ausnahme: ohne ihn kann
 * gar nicht simuliert werden, deshalb gilt eine dokumentierte Annahme — die im Ergebnis
 * ausdrücklich als „angenommen" ausgewiesen wird.
 *
 * ── ⚠ VORSCHLAG, KEINE STILLE ÜBERNAHME ──────────────────────────────────────────────────────
 * Zwischen dem Gelesenen und dem Gerechneten steht ein ausdrückliches „Übernehmen" — exakt das
 * Muster aus Teil 1. Kein Auto-Submit.
 *
 * ── DAS FELD IST OPTIONAL, UND LEER HEISST UNVERÄNDERT ────────────────────────────────────────
 * Ohne Eingabe passiert nichts Neues: kein Netzaufruf, kein Feld im Payload, und der Rechner
 * empfiehlt wie bisher einen Speicher aus dem Katalog.
 */

type ReadError = Extract<BatteryTextResponse, { ok: false }>['error']

const ERROR_TEXT: Record<ReadError, { title: string; message: string }> = {
  no_text: {
    title: 'Nichts eingetragen',
    message: 'Bitte beschreiben Sie Ihren Speicher kurz — oder lassen Sie das Feld einfach leer.',
  },
  unreadable: {
    title: 'Keine Kenndaten erkannt',
    message:
      'Aus dieser Angabe liessen sich keine Kenndaten lesen. Nötig sind die nutzbare Kapazität in ' +
      'kWh und die Lade-/Entladeleistung in kW; hilfreich ist zusätzlich der Wirkungsgrad. Ohne ' +
      'diese Angabe rechnen wir wie bisher mit einem Speicher aus unserem Katalog.',
  },
  not_configured: {
    title: 'Auslesen derzeit nicht verfügbar',
    message:
      'Das Auslesen freier Angaben ist auf diesem Server nicht eingerichtet. Der Rechner ' +
      'funktioniert unverändert — er empfiehlt Ihnen dann einen Speicher aus dem Katalog.',
  },
  unavailable: {
    title: 'Auslesen fehlgeschlagen',
    message:
      'Wir konnten Ihre Angabe gerade nicht auslesen. Bitte versuchen Sie es später noch einmal — ' +
      'der Rechner funktioniert auch ohne diese Angabe.',
  },
}

const fmt = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 1 })

/** Nennt in einem Satz, was tatsächlich gelesen wurde. Ohne diese Liste ist das Feld eine Blackbox. */
function readFields(e: BatteryTextExtraction): string[] {
  const found: string[] = []
  if (e.capacityKwh != null) found.push(`${fmt.format(e.capacityKwh)} kWh Kapazität`)
  if (e.maxPowerKw != null) found.push(`${fmt.format(e.maxPowerKw)} kW Leistung`)
  if (e.roundTripEfficiencyPercent != null) {
    found.push(`${fmt.format(e.roundTripEfficiencyPercent)} % Wirkungsgrad`)
  }
  if (e.pricePerKwh != null) found.push(`${fmt.format(e.pricePerKwh)} €/kWh`)
  return found
}

/**
 * Baut aus dem Gelesenen den Speicher des Kunden — oder sagt, warum es nicht geht.
 *
 * ⚠ Die Prozent→Bruchteil-Umrechnung geschieht an GENAU DIESER Stelle. Der Text nennt „90 %", die
 * Physik rechnet mit 0,9. Zweimal umgerechnet wäre der Wirkungsgrad 0,9 % — eine Zahl, die durch
 * jede Prüfung liefe und die Ersparnis lautlos vernichtete.
 *
 * `pricePerKwh` wird bewusst NICHT übernommen, auch wenn der Kunde ihn nennt: der Bestandsblock
 * weist keine Investition aus, und ein mitgeführter Preis könnte über einen künftigen Aufrufer in
 * eine Amortisationsrechnung geraten, die es für dieses Gerät nicht gibt.
 */
function buildInput(e: BatteryTextExtraction): ExistingBatteryInput | { missing: string[] } {
  const missing: string[] = []
  if (e.capacityKwh == null || e.capacityKwh <= 0) missing.push('die nutzbare Kapazität in kWh')
  if (e.maxPowerKw == null || e.maxPowerKw <= 0) missing.push('die Lade-/Entladeleistung in kW')
  if (missing.length > 0) return { missing }

  const efficiencyAssumed = e.roundTripEfficiencyPercent == null
  return {
    battery: buildExistingBatteryCandidate({
      usableCapacityKwh: e.capacityKwh!,
      maxPowerKw: e.maxPowerKw!,
      roundTripEfficiency: efficiencyAssumed
        ? ASSUMED_EXISTING_ROUND_TRIP_EFFICIENCY
        : e.roundTripEfficiencyPercent! / 100,
    }),
    efficiencyAssumed,
  }
}

export function BatteryTextPanel({
  existing,
  onExisting,
}: {
  existing: ExistingBatteryInput | null
  onExisting: (existing: ExistingBatteryInput | null) => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ title: string; message: string } | null>(null)
  const [extraction, setExtraction] = useState<BatteryTextExtraction | null>(null)

  async function handleRead() {
    setError(null)
    setExtraction(null)
    setBusy(true)
    try {
      const response = await readBatteryText(text)
      if (!response.ok) {
        setError(ERROR_TEXT[response.error])
        return
      }
      setExtraction(response.extraction)
    } catch {
      // Eine Server Action kann auch am Netz scheitern, bevor sie ihren Fehlerzustand bilden kann.
      setError(ERROR_TEXT.unavailable)
    } finally {
      setBusy(false)
    }
  }

  /* ── Bereits übernommen ────────────────────────────────────────────────────────────────────── */
  if (existing) {
    const b = existing.battery
    return (
      <Alert variant="default" data-testid="batterie-uebernommen">
        <CheckCircle2 className="h-4 w-4 text-positive" />
        <AlertTitle>Wir rechnen mit Ihrem Speicher</AlertTitle>
        <AlertDescription>
          <p>
            <strong>
              {fmt.format(b.usableCapacityKwh)} kWh nutzbar · {fmt.format(b.maxPowerKw)} kW ·{' '}
              {fmt.format(b.roundTripEfficiency * 100)} % Wirkungsgrad
            </strong>{' '}
            {existing.efficiencyAssumed
              ? '(Kapazität und Leistung aus Ihrer Angabe, Wirkungsgrad angenommen)'
              : '(Ihre Angaben)'}
          </p>
          <p className="mt-2 text-xs">
            Gerechnet wird mit genau diesen Werten — nicht mit einem ähnlichen Gerät aus unserem
            Katalog. Im Ergebnis steht Ihre Anlage oben, ohne Investition und ohne Amortisation;
            darunter zeigen wir, ob sich ein <strong>zusätzlicher</strong> Speicher lohnen würde.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 px-0"
            onClick={() => {
              onExisting(null)
              setExtraction(null)
            }}
          >
            Auswahl aufheben
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  const found = extraction ? readFields(extraction) : []
  const declinedBattery = extraction?.hasExistingBattery === false
  const built = extraction && !declinedBattery ? buildInput(extraction) : null
  const ready = built != null && 'battery' in built ? built : null
  const missing = built != null && 'missing' in built ? built.missing : null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="batterieAngabe">Haben Sie bereits einen Speicher? (optional)</Label>
        <Textarea
          id="batterieAngabe"
          value={text}
          maxLength={400}
          placeholder="z. B. Sungrow, 19,2 kWh nutzbar, 10,6 kW, Wirkungsgrad rund 90 %"
          onChange={(event) => setText(event.target.value)}
        />
        <p className="text-xs text-text-muted">
          Schreiben Sie es in eigenen Worten. Wir brauchen die <strong>nutzbare Kapazität</strong>{' '}
          (kWh) und die <strong>Lade-/Entladeleistung</strong> (kW); der Wirkungsgrad hilft, ist
          aber nicht zwingend. Ohne Angabe empfehlen wir Ihnen wie bisher einen Speicher aus unserem
          Katalog. Ihre Angabe wird zum Auslesen an Anthropic übertragen und dabei nirgends
          gespeichert.
        </p>
      </div>

      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={text.trim() === '' || busy}
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
              Angabe auslesen
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

      {extraction && (
        <div
          className="flex flex-col gap-3 rounded-lg border border-border bg-surface-alt p-4"
          data-testid="batterie-vorschlag"
        >
          <p className="flex items-start gap-2 text-sm text-ink">
            <BatteryCharging className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <span>
              {declinedBattery ? 'Verstanden: Sie haben noch keinen Speicher.' : 'Gelesen:'}{' '}
              {found.length > 0 ? found.join(' · ') : 'keine Kenndaten'}
            </span>
          </p>

          {/*
            ⚠ Fehlt eine der beiden Physik-Grössen, wird NICHTS übernommen — und es wird gesagt,
            welche. Eine aus der anderen zu erschliessen (etwa über eine angenommene C-Rate) wäre
            genau die erfundene Zahl, die dieser Bauabschnitt beseitigt.
          */}
          {missing && (
            <p className="text-sm text-text-muted" data-testid="batterie-fehlend">
              Für eine Simulation Ihrer Anlage fehlt noch <strong>{missing.join(' und ')}</strong>.
              Bitte ergänzen Sie die Angabe oben und lesen Sie sie erneut aus — oder lassen Sie uns
              wie bisher einen Speicher empfehlen.
            </p>
          )}

          {ready && (
            <>
              <p className="text-sm text-text-muted" data-testid="batterie-exakt">
                Wir rechnen mit <strong>{fmt.format(ready.battery.usableCapacityKwh)} kWh</strong>{' '}
                und <strong>{fmt.format(ready.battery.maxPowerKw)} kW</strong> — Ihren exakten
                Werten, nicht mit einem ähnlichen Katalog-Gerät.
                {ready.efficiencyAssumed && (
                  <>
                    {' '}
                    Ihre Angabe nennt keinen Wirkungsgrad; wir rechnen deshalb mit{' '}
                    <strong>
                      {fmt.format(ASSUMED_EXISTING_ROUND_TRIP_EFFICIENCY * 100)} % (angenommen)
                    </strong>
                    .
                  </>
                )}
              </p>
              <p className="text-xs text-text-muted">
                Wir nehmen dabei an, dass Ihr Speicher <strong>keine Lastspitzen kappt</strong> —
                das setzt eine eigene Steuerung voraus, die eine Bestandsanlage meist nicht hat.
                Eigenverbrauch und tarifbewusstes Laden werden voll gerechnet.
              </p>
              <div>
                <Button type="button" size="sm" onClick={() => onExisting(ready)}>
                  Übernehmen
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
