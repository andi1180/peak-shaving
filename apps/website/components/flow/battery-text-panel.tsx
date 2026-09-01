'use client'

import { useState } from 'react'
import { AlertTriangle, BatteryCharging, CheckCircle2, Loader2, Sparkles } from 'lucide-react'
import {
  DEMO_BATTERY_CATALOG,
  matchCatalogByCapacity,
  type BatteryCandidate,
  type BatteryTextExtraction,
} from 'shared'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { readBatteryText, type BatteryTextResponse } from '@/lib/battery-text/actions'
import type { BatteryPreset } from './types'

/**
 * Delta 17 Teil 2 — „Haben Sie schon einen Speicher?" als freier Satz.
 *
 * ── WAS BISHER FEHLTE ─────────────────────────────────────────────────────────────────────────
 * Der Rechner kennt genau EINEN Fall: „keine Batterie, wir empfehlen eine". Einen Umschalter für
 * „ich habe schon eine" gibt es nirgends (repo-weit gemessen). Wer bereits einen Speicher besitzt,
 * bekommt deshalb eine Empfehlung für ein Gerät, das er hat — und keine Stelle, an der er das
 * sagen könnte.
 *
 * ── ⚠ WAS DIESES FELD TUT — UND WAS AUSDRÜCKLICH NICHT ────────────────────────────────────────
 * Es erfindet KEINEN neuen Mechanismus. Was am Ende geschieht, ist genau das, was das
 * Annahmen-Panel (§6.2) seit U2 Prompt C ohnehin kann: ein `batteryOverride` auf GENAU EINEN
 * Katalog-Kandidaten, und ausschliesslich auf Wirkungsgrad und Preis. Der Katalog selbst bleibt
 * fest — es entsteht keine neue Kapazitätsstufe.
 *
 * Daraus folgt die eine Sache, die der Nutzer WISSEN muss und die dieses Panel deshalb ausdrücklich
 * sagt: eine genannte Kapazität führt zur AUSWAHL eines Kandidaten mit einer möglicherweise
 * ANDEREN Kapazität. Wer 20 kWh besitzt, bekommt eine Rechnung über 15 oder 25 kWh zu sehen. Der
 * Abstand wird benannt, nicht weggerundet (`matchCatalogByCapacity`).
 *
 * ── ⚠ VORSCHLAG, KEINE STILLE ÜBERNAHME ──────────────────────────────────────────────────────
 * Zwischen dem Gelesenen und dem Gerechneten steht ein ausdrückliches „Übernehmen" — exakt das
 * Muster aus Teil 1. Kein Auto-Submit, keine Vorauswahl, die sich selbst bestätigt.
 *
 * ── DAS FELD IST OPTIONAL, UND LEER HEISST UNVERÄNDERT ────────────────────────────────────────
 * Ohne Eingabe passiert nichts Neues: kein Netzaufruf, kein Feld im Payload, und der Rechner
 * empfiehlt wie bisher aus dem vollen Katalog.
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
      'Aus dieser Angabe liessen sich keine Kenndaten lesen. Hilfreich sind Kapazität in kWh, ' +
      'Leistung in kW und, falls bekannt, Wirkungsgrad und Preis je kWh. Sie können den Speicher ' +
      'auch unten im Ergebnis von Hand auswählen.',
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

const NO_PRESET = '__keine__'

const fmt = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 1 })

function byId(id: string): BatteryCandidate | undefined {
  return DEMO_BATTERY_CATALOG.find((b) => b.id === id)
}

/** „HomeStore R15 (15 kWh / 7,5 kW)" — die Angaben, an denen der Nutzer die Wahl beurteilt. */
function describe(battery: BatteryCandidate): string {
  return `${battery.name} (${fmt.format(battery.usableCapacityKwh)} kWh / ${fmt.format(battery.maxPowerKw)} kW)`
}

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

export function BatteryTextPanel({
  preset,
  onPreset,
}: {
  preset: BatteryPreset | null
  onPreset: (preset: BatteryPreset | null) => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ title: string; message: string } | null>(null)
  const [extraction, setExtraction] = useState<BatteryTextExtraction | null>(null)
  /** Die Auswahl in der Bestätigungsstufe — vorbelegt aus der Zuordnung, frei änderbar. */
  const [choice, setChoice] = useState<string>(NO_PRESET)

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
      /*
       * Die Zuordnung belegt die Auswahl VOR — sie bestätigt sich damit aber nicht selbst: der
       * Vorschlag steht in einem Auswahlfeld, und erst „Übernehmen" wirkt.
       *
       * Sagt der Text ausdrücklich, dass KEIN Speicher vorhanden ist, wird gar nichts vorbelegt:
       * dann ist die Empfehlung aus dem vollen Katalog genau das Richtige.
       */
      const match =
        response.extraction.hasExistingBattery === false
          ? null
          : matchCatalogByCapacity(response.extraction.capacityKwh, DEMO_BATTERY_CATALOG)
      setChoice(match?.candidateId ?? NO_PRESET)
    } catch {
      // Eine Server Action kann auch am Netz scheitern, bevor sie ihren Fehlerzustand bilden kann.
      setError(ERROR_TEXT.unavailable)
    } finally {
      setBusy(false)
    }
  }

  function handleApply() {
    if (choice === NO_PRESET) {
      onPreset(null)
      return
    }
    const battery = byId(choice)
    if (!battery) return
    onPreset({
      batteryId: battery.id,
      /*
       * ⚠ DIE EINE STELLE IM GANZEN RECHNER, AN DER `existing` ENTSTEHT. Hier — und nur hier —
       * hat ein Mensch bestätigt, dass er diesen Speicher BEREITS HAT. Der Report weist für ihn
       * deshalb weder Investition noch Amortisation aus: beide beantworten eine Kaufentscheidung,
       * die längst gefallen ist, und ihre Anschaffungskosten sind ausgegeben.
       */
      source: 'existing',
      /*
       * ⚠ DIE EINZIGE STELLE, AN DER PROZENT ZU BRUCHTEIL WIRD. Der Text nennt „90 %", der Katalog
       * führt 0,9. Zweimal umgerechnet wäre der Wirkungsgrad 0,9 % — eine Zahl, die durch jede
       * Schemaprüfung liefe und die Ersparnis lautlos vernichtete.
       *
       * Nur gesetzt, wenn der Text tatsächlich einen Wert nannte: sonst bleibt der Kandidat bei
       * SEINEM Wirkungsgrad, und `applyBatteryOverride` lässt ihn unangetastet.
       */
      ...(extraction?.roundTripEfficiencyPercent != null
        ? { roundTripEfficiency: extraction.roundTripEfficiencyPercent / 100 }
        : {}),
      ...(extraction?.pricePerKwh != null ? { pricePerKwh: extraction.pricePerKwh } : {}),
    })
  }

  /* ── Bereits übernommen ────────────────────────────────────────────────────────────────────── */
  if (preset) {
    const battery = byId(preset.batteryId)
    return (
      <Alert variant="default" data-testid="batterie-uebernommen">
        <CheckCircle2 className="h-4 w-4 text-positive" />
        <AlertTitle>Wir rechnen mit Ihrem Speicher</AlertTitle>
        <AlertDescription>
          <p>
            Ausgewählt: <strong>{battery ? describe(battery) : preset.batteryId}</strong>
            {preset.roundTripEfficiency != null &&
              ` · Wirkungsgrad ${fmt.format(preset.roundTripEfficiency * 100)} % (Ihre Angabe)`}
            {preset.pricePerKwh != null &&
              ` · ${fmt.format(preset.pricePerKwh)} €/kWh (Ihre Angabe)`}
          </p>
          <p className="mt-2 text-xs">
            Der Rechner vergleicht weiterhin alle Speicher des Katalogs — Ihrer ist danach im
            Ergebnis vorausgewählt, und Sie können dort jederzeit umschalten.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 px-0"
            onClick={() => {
              onPreset(null)
              setExtraction(null)
              setChoice(NO_PRESET)
            }}
          >
            Auswahl aufheben
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  const match = extraction
    ? matchCatalogByCapacity(extraction.capacityKwh, DEMO_BATTERY_CATALOG)
    : null
  const lower = match?.lowerId ? byId(match.lowerId) : undefined
  const upper = match?.upperId ? byId(match.upperId) : undefined
  const found = extraction ? readFields(extraction) : []

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="batterieAngabe">Haben Sie bereits einen Speicher? (optional)</Label>
        <Textarea
          id="batterieAngabe"
          value={text}
          maxLength={400}
          placeholder="z. B. Sungrow, 20 kWh nutzbar, ca. 10 kW, Wirkungsgrad rund 90 %"
          onChange={(event) => setText(event.target.value)}
        />
        <p className="text-xs text-text-muted">
          Schreiben Sie es in eigenen Worten — Kapazität, Leistung, Wirkungsgrad, Preis, soweit Sie
          es wissen. Ohne Angabe empfehlen wir Ihnen wie bisher einen Speicher aus unserem Katalog.
          Ihre Angabe wird zum Auslesen an Anthropic übertragen und dabei nirgends gespeichert.
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
              {extraction.hasExistingBattery === false
                ? 'Verstanden: Sie haben noch keinen Speicher.'
                : 'Gelesen:'}{' '}
              {found.length > 0 ? found.join(' · ') : 'keine Kenndaten'}
            </span>
          </p>

          {/*
            ⚠ DER ABSTAND WIRD BENANNT, NICHT WEGGERUNDET. Der Katalog ist fest; eine genannte
            Kapazität, die keinen Kandidaten trifft, führt zu einer Rechnung über eine ANDERE
            Kapazität. Wer das nicht sieht, hält die Ersparnis für die seiner Anlage.
          */}
          {match && !match.exact && lower && upper && (
            <p className="text-sm text-text-muted" data-testid="batterie-abstand">
              {fmt.format(extraction.capacityKwh ?? 0)} kWh liegt zwischen{' '}
              <strong>{describe(lower)}</strong> und <strong>{describe(upper)}</strong> —{' '}
              <strong>kein exakter Treffer</strong>. Wir rechnen mit der Kapazität des gewählten
              Katalog-Geräts, nicht mit Ihrer Angabe.
            </p>
          )}
          {match && !match.exact && match.outside && (
            <p className="text-sm text-text-muted" data-testid="batterie-abstand">
              {fmt.format(extraction.capacityKwh ?? 0)} kWh liegt{' '}
              {match.outside === 'below' ? 'unter' : 'über'} allem, was unser Katalog führt (
              {fmt.format(byId(match.candidateId)?.usableCapacityKwh ?? 0)} kWh ist der{' '}
              {match.outside === 'below' ? 'kleinste' : 'grösste'} Speicher) —{' '}
              <strong>kein exakter Treffer</strong>. Wir rechnen mit der Kapazität des gewählten
              Katalog-Geräts, nicht mit Ihrer Angabe.
            </p>
          )}
          {match?.exact && (
            <p className="text-sm text-text-muted" data-testid="batterie-abstand">
              Ihre Angabe trifft <strong>{describe(byId(match.candidateId)!)}</strong> genau.
            </p>
          )}
          {!match && extraction.hasExistingBattery !== false && (
            <p className="text-sm text-text-muted">
              Ohne Kapazitätsangabe können wir keinen Speicher vorschlagen — bitte wählen Sie
              selbst, oder lassen Sie uns wie bisher empfehlen.
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="batterieAuswahl">Womit sollen wir rechnen?</Label>
            <Select value={choice} onValueChange={setChoice}>
              <SelectTrigger id="batterieAuswahl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PRESET}>
                  Keine Vorauswahl — empfehlen Sie mir einen
                </SelectItem>
                {DEMO_BATTERY_CATALOG.map((battery) => (
                  <SelectItem key={battery.id} value={battery.id}>
                    {describe(battery)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-text-muted">
              Übernommen werden aus Ihrer Angabe nur <strong>Wirkungsgrad</strong> und{' '}
              <strong>Preis</strong>. Kapazität und Leistung sind die des Katalog-Geräts — beide
              bestimmen die Physik der Simulation und lassen sich nicht frei setzen.
            </p>
          </div>

          <div>
            <Button type="button" size="sm" onClick={handleApply}>
              Übernehmen
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
