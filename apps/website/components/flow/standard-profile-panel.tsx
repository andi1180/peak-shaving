'use client'

import { useState } from 'react'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import { generateStandardLoadProfile, type StandardProfileCustomerClass } from 'engine'
import { analysisWindow, standardProfileYear, startsBeforeSpotPriceAnchor } from 'shared'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { InfoHint, LabelWithInfo } from '@/components/ui/info-hint'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { STANDARD_PROFILE_TIMEZONE } from '@/lib/constants'
import { parseNum } from '@/lib/form-utils'
import type { ParsedLoad } from './types'

/**
 * Delta 8 / Delta 9b-1 — der dritte Einstieg in den Lastgang-Schritt: Standardprofil aus einer
 * manuellen Verbrauchsangabe, für Kunden ohne echten Lastgang.
 *
 * ── ER STEHT NEBEN DEM UPLOAD, NICHT DAHINTER ───────────────────────────────────────────────────
 * Delta 9b nennt die Startpunkte ausdrücklich GLEICHWERTIG. Als „Notlösung" unter dem Upload
 * versteckt erreichte er genau die Zielgruppe nicht, für die er da ist: einen Privatkunden, der
 * seinen Lastgang gar nicht kennt und beim Wort „Lastgang" abbricht.
 *
 * ── UND ER IST TROTZDEM NICHT GLEICHWERTIG IN DEM, WAS ER TRÄGT ─────────────────────────────────
 * Ein synthetisches Profil trägt die Tarif-Arbitrage, aber NICHT die Leistungspreis-Dimension
 * (Delta 3/8). Das steht hier VOR dem Absenden im Klartext — nicht erst im Report, wenn die Zahl
 * schon dasteht. Die Sperre selbst sitzt in der Engine (`peakShavingBlockers`), nicht in dieser
 * Oberfläche: eine Zusage, die nur ein Formular gibt, hält der nächste Umbau nicht.
 */
export function StandardProfilePanel({
  initialAnnualKwh = null,
  onComplete,
}: {
  /**
   * Delta 9b-2b: ein aus einer Rechnung ABGELESENER Jahresverbrauch, der das Feld vorbelegt.
   *
   * `null` heisst „nicht erkennbar" und belegt bewusst NICHTS vor — das Feld bleibt leer, wie es
   * ohne Scan wäre. Eine 0 oder ein Platzhalter sähe hier aus wie eine Angabe, und der Nutzer
   * bemerkte die Lücke nicht mehr. Der Wert steht als INITIALWERT im State und nicht in einem
   * Effekt: er ist eine Vorbelegung, keine Vorschrift, und was der Nutzer daraufhin tippt, darf
   * kein späterer Render wieder überschreiben.
   */
  initialAnnualKwh?: number | null
  onComplete: (load: ParsedLoad) => void
}) {
  const [annual, setAnnual] = useState(() =>
    initialAnnualKwh != null && Number.isFinite(initialAnnualKwh) && initialAnnualKwh > 0
      ? String(initialAnnualKwh)
      : '',
  )
  const [customerClass, setCustomerClass] = useState<StandardProfileCustomerClass>('privat')
  const [error, setError] = useState<string | null>(null)

  // Das abzubildende Kalenderjahr steht fest, sobald die Seite läuft — und wird angezeigt, statt
  // still gewählt zu werden: der Report rechnet gegen die Marktpreise GENAU dieses Jahres.
  const year = standardProfileYear(new Date())

  function handleSubmit() {
    setError(null)
    const kwh = parseNum(annual)
    if (!Number.isFinite(kwh) || kwh <= 0) {
      setError('Bitte einen Jahresverbrauch in kWh eintragen — er steht auf Ihrer Stromrechnung.')
      return
    }
    /*
     * Eine sichtbare Obergrenze, statt eine unsinnige Zahl durchzurechnen: 100.000 kWh/Jahr ist
     * kein Haushalt mehr, und für diese Grössenordnung ist ein Standardprofil ohnehin die falsche
     * Grundlage. Kein stilles Kappen — der Nutzer soll wissen, dass wir seine Zahl nicht nehmen.
     */
    if (kwh > 100_000) {
      setError(
        'Über 100.000 kWh im Jahr ist ein Haushalts-Standardprofil keine belastbare Grundlage ' +
          'mehr. Für diese Grössenordnung bitte einen echten Lastgang hochladen.',
      )
      return
    }

    const outcome = generateStandardLoadProfile({
      annualConsumptionKwh: kwh,
      customerClass,
      year,
      timeZone: STANDARD_PROFILE_TIMEZONE,
    })
    if (!outcome.ok) {
      setError(
        outcome.reason === 'no_profile_for_class'
          ? 'Für diese Kundenklasse gibt es noch kein hinterlegtes Standardprofil.'
          : 'Die Eingabe ergibt kein auswertbares Profil. Bitte prüfen Sie den Jahresverbrauch.',
      )
      return
    }

    /*
     * Delta 15, Regel B — dieselbe Prüfung wie im Upload-Pfad, und aus demselben Grund: eine Regel,
     * die nur einen von mehreren Wegen abdeckt, ist keine. Sie kann hier nicht greifen, solange
     * `standardProfileYear` das Anker-Jahr als Untergrenze führt; genau deshalb steht sie da — sie
     * fängt den Tag ab, an dem jemand das Jahr anders bestimmt.
     */
    const window = analysisWindow(outcome.profile)
    if (!window || startsBeforeSpotPriceAnchor(window, STANDARD_PROFILE_TIMEZONE)) {
      setError('Für dieses Jahr liegen keine Börsen-Strompreise vor.')
      return
    }

    onComplete({
      fileName: `Standardprofil ${year} · ${new Intl.NumberFormat('de-AT').format(Math.round(kwh))} kWh/Jahr`,
      profile: outcome.profile,
      dataQuality: outcome.dataQuality,
      // Kein `sourceBytes`: es gibt keine Ursprungsdatei. Das Analyse-Bündel (B14-2) bleibt für
      // diesen Lauf deshalb bewusst gesperrt — eine Prüfsumme über nichts bände auch nichts.
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface-alt p-4">
        <div className="flex flex-col gap-1.5">
          <LabelWithInfo htmlFor="annualConsumption" label="Jahresverbrauch">
            Die Kilowattstunden, die Sie in einem Jahr verbrauchen — die Zahl steht auf Ihrer
            Jahresabrechnung, meist gross als „Verbrauch" oder „Gesamtverbrauch in kWh". Ein
            Zwei-Personen-Haushalt liegt typischerweise bei 2.500–4.000 kWh, ein Haus mit Wärmepumpe
            deutlich darüber. Aus dieser einen Zahl bilden wir einen durchschnittlichen
            Tagesverlauf — je genauer sie stimmt, desto belastbarer der Vergleich.
          </LabelWithInfo>
          <div className="relative">
            <Input
              id="annualConsumption"
              type="number"
              inputMode="decimal"
              step="any"
              min={0}
              value={annual}
              onChange={(e) => setAnnual(e.target.value)}
              placeholder="z. B. 3650"
              aria-invalid={error ? true : undefined}
              className="pr-24"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-text-muted">
              kWh/Jahr
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <LabelWithInfo htmlFor="customerClass" label="Kundenklasse">
            Sie entscheidet, welche Tagesform wir annehmen. <strong>Privat</strong> heisst
            Haushaltsprofil: wenig Verbrauch tagsüber, eine Spitze am Morgen und eine grössere am
            Abend, am Wochenende gleichmässiger.{' '}
            <strong>Kleingewerbe</strong> hat einen ganz anderen Verlauf (Geschäftszeiten statt
            Abendspitze) — dafür ist bei uns noch keine Kurve hinterlegt, und eine aus dem
            Haushaltsprofil abgeleitete wäre geraten.
          </LabelWithInfo>
          <Select
            value={customerClass}
            onValueChange={(v) => setCustomerClass(v as StandardProfileCustomerClass)}
          >
            <SelectTrigger id="customerClass">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="privat">Privat (Haushalt, H0)</SelectItem>
              {/*
                Delta 9, Transparenz gilt auch für Unfertiges: SICHTBAR und deaktiviert, nicht
                versteckt. Wer den Punkt sucht, soll sehen, dass es ihn gibt und warum er (noch)
                nicht wählbar ist — statt zu vermuten, der Rechner sei nichts für ihn.
              */}
              <SelectItem value="kleingewerbe" disabled>
                Kleingewerbe — noch nicht verfügbar
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-text-muted">
            <strong>Kleingewerbe</strong> ist noch nicht wählbar: das passende Gewerbe-Lastprofil
            ist fachlich noch nicht festgelegt. Wir raten keins zusammen — bis dahin bitte einen
            echten Lastgang hochladen.
          </p>
        </div>

        {/*
          Kein Formularfeld, sondern die Einordnung des ganzen Einstiegs — deshalb `before` mit
          einer eigenen Zeile statt `LabelWithInfo` (ein `<label>` ohne Feld wäre falsches Markup,
          und ein alleinstehender Infobutton ohne Text sähe aus wie ein Anzeigefehler).
        */}
        <InfoHint
          label="Was ein Standardprofil kann und was nicht"
          before={
            <span className="text-sm font-medium text-ink">
              Was ein Standardprofil kann — und was nicht
            </span>
          }
        >
          Ein Standardprofil ist ein <strong>Durchschnittsverlauf</strong>, keine Messung. Für den
          Vergleich verschiedener Stromtarife reicht das: dafür zählt, WANN im Tagesverlauf Strom
          verbraucht wird. Für die <strong>Leistungspreis-Ersparnis</strong> reicht es nicht — sie
          hängt an Ihrer höchsten gemessenen Viertelstunde, und die kennt ein Durchschnittsprofil
          nicht. Der Rechner weist sie deshalb gar nicht erst aus, statt sie zu schätzen.
        </InfoHint>

        <p className="text-xs text-text-muted">
          Gerechnet wird gegen die tatsächlichen Marktpreise des Jahres {year} — das letzte
          vollständig abgeschlossene Kalenderjahr.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Eingabe unvollständig</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end">
        <Button onClick={handleSubmit}>
          Weiter mit Standardprofil
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
