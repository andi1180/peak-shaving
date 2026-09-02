'use client'

import { useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Plus, Sun, Trash2 } from 'lucide-react'
import {
  applyEstimatedPv,
  buildEstimatedPvProfile,
  expandReferenceToTimestamps,
  pvGeneratorEligibility,
  type PvReferenceProfile,
  type PvgisArrayDesign,
} from 'engine'
import {
  COMPASS_DIRECTIONS,
  POSTAL_CODE_SOURCE,
  checkPvArray,
  compassDirectionInfo,
  lookupPostalCodeCentroid,
  pvArrayAzimuthDeg,
  summarizeAnnualYields,
  type CompassDirection,
  type EstimatedPvSummary,
  type LoadProfile,
  type PostalCodeCentroid,
  type PvArrayInput,
} from 'shared'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { InfoHint, LabelWithInfo } from '@/components/ui/info-hint'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NumberField } from '@/components/ui/number-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Num } from '@/components/report/num'
import { formatDeg, formatKwh, formatKwp, formatPercent } from '@/lib/format'
import { parseNum } from '@/lib/form-utils'
import { fetchPvReferenceProfileAction } from '@/lib/pvgis/actions'
import type { EstimatedPvResult, ParsedLoad } from './types'

/**
 * B22b — der Formular-Weg des PV-Zeitreihengenerators (Pflichtenheft §3(b), entspricht Delta 9b-1).
 *
 * ── WAS ER TUT ────────────────────────────────────────────────────────────────────────────────
 * Ein Kunde ohne sichtbare PV-Erzeugung im Lastgang gibt seine geplante oder bestehende Anlage an
 * (PLZ, je Modulfläche kWp/Neigung/Ausrichtung). Daraus holt der Proxy je Fläche ein
 * Referenzprofil bei PVGIS, die Flächen werden summiert, auf das 15-min-Gitter des Lastgangs
 * gelegt und vom Verbrauch ABGEZOGEN. Das Ergebnis ist ein signierter Netz-Lastgang mit
 * `pvSource: 'estimated'`, den die Engine ohne jede Änderung verarbeitet.
 *
 * ── ⚠ DIE ZWEI STELLEN, AN DENEN DIESER SCHRITT TEUER FALSCH WERDEN KANN ──────────────────────
 * 1. **Die Azimut-Konvention.** PV*SOL zählt vom Norden, PVGIS von Süden; „Südosten 133 °" ist als
 *    PVGIS-`aspect` −47 und nicht 133. Ungeprüft übernommen zeigt die Anlage nach NORDWESTEN und
 *    die Ersparnis fällt um **56 %** — bei einer Zahl, die völlig plausibel aussieht. Deshalb gibt
 *    es hier **kein rohes Gradfeld**: der Nutzer wählt eine Himmelsrichtung und darf optional eine
 *    KOMPASS-Gradzahl danebenlegen, die gegen die Richtung gegengeprüft wird. Umgerechnet wird an
 *    genau einer Stelle (`pvArrayAzimuthDeg` in `shared`, dort getestet).
 * 2. **Die Prüfung am Jahresertrag.** Sie fängt genau das NICHT: die naive Süd-35°-Annahme liefert
 *    53 % mehr PV-Energie und trotzdem 6 % weniger Ersparnis (Sättigung). Deshalb steht hier keine
 *    Ertrags-Plausibilitätsprüfung; der Ertrag wird ausgewiesen, aber nicht als Wächter benutzt.
 *
 * ── ⚠ VORSCHLAG, KEINE STILLE ÜBERNAHME ───────────────────────────────────────────────────────
 * Zwischen dem Abrufen und dem Rechnen steht eine Vorschau mit den ZURÜCKGESPIEGELTEN
 * PVGIS-Eingaben und ein ausdrückliches „Übernehmen" — dieselbe Haltung wie beim Rechnungs-Scan
 * (Delta 9b-2b) und der Freitext-Batterie (Delta 17 Teil 2), hier zusätzlich deshalb, weil ein
 * einzelner falsch gelesener Winkel die halbe Ersparnis bewegt. Die Vorschau nennt den Azimut in
 * KOMPASS-Richtung zurück, damit der Nutzer prüfen kann, was tatsächlich gerechnet wurde.
 */

const MAX_ARRAYS = 6

type ArrayDraft = {
  key: number
  peakPowerKwp: string
  slopeDeg: string
  direction: CompassDirection
  compassDeg: string
}

function emptyDraft(key: number): ArrayDraft {
  return { key, peakPowerKwp: '', slopeDeg: '30', direction: 'S', compassDeg: '' }
}

/** Was aus einer Zeile wird, sobald sie vollständig ist — sonst der Grund, warum nicht. */
function draftToArray(d: ArrayDraft): { ok: true; array: PvArrayInput } | { ok: false; field: string; message: string } {
  const peakPowerKwp = parseNum(d.peakPowerKwp)
  const slopeDeg = parseNum(d.slopeDeg)
  const raw = d.compassDeg.trim()
  const compassDeg = raw === '' ? undefined : parseNum(raw)
  const array: PvArrayInput = { peakPowerKwp, slopeDeg, direction: d.direction, ...(compassDeg != null ? { compassDeg } : {}) }
  const check = checkPvArray(array)
  if (check.ok) return { ok: true, array }
  if (check.reason === 'peak_power_invalid') {
    return { ok: false, field: 'peakPowerKwp', message: 'Bitte die Nennleistung in kWp eintragen (grösser als 0).' }
  }
  if (check.reason === 'slope_invalid') {
    return { ok: false, field: 'slopeDeg', message: 'Bitte eine Neigung zwischen 0° (flach) und 90° (senkrecht) eintragen.' }
  }
  /*
   * ⚠ DIE MELDUNG, DIE DEN GANZEN ABSCHNITT TRÄGT. Sie nennt beide Zahlen im Klartext, weil genau
   * hier die 56-%-Verwechslung sitzt: wer die Gradzahl aus einem Planungsdokument übernimmt, hat
   * womöglich eine Zahl in einer ANDEREN Zählweise vor sich. Ein blosses „ungültig" liesse ihn
   * raten, welche der beiden Angaben er ändern soll.
   */
  const info = compassDirectionInfo(d.direction)
  return {
    ok: false,
    field: 'compassDeg',
    message:
      `${raw}° passt nicht zu „${info.label}" (${info.compassDeg}° auf dem Kompass). ` +
      'Bitte entweder die Gradzahl oder die Himmelsrichtung korrigieren — die Gradzahl wird vom ' +
      'NORDEN aus gezählt (0° = Norden, 90° = Osten, 180° = Süden, 270° = Westen).',
  }
}

export function PvDesignPanel({
  loadProfile,
  dataQuality,
  onApply,
  onClear,
  applied,
}: {
  /** Der Lastgang aus Schritt 1 — Eignungsprüfung und Ziel-Zeitstempel der Kopplung. */
  loadProfile: LoadProfile
  /** Datenqualität des Lastgangs; das erzeugte PV-Profil erbt Abdeckung und Monatszahl. */
  dataQuality: ParsedLoad['dataQuality']
  onApply: (result: EstimatedPvResult) => void
  onClear: () => void
  /** Ist bereits eine Schätzung übernommen? Dann zeigt das Panel sie statt des Formulars. */
  applied: EstimatedPvResult | null
}) {
  const eligibility = pvGeneratorEligibility(loadProfile)

  const nextKey = useRef(1)
  const [drafts, setDrafts] = useState<ArrayDraft[]>(() => [emptyDraft(0)])
  const [postalCode, setPostalCode] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [preview, setPreview] = useState<EstimatedPvResult | null>(null)

  const centroid: PostalCodeCentroid | null = lookupPostalCodeCentroid(postalCode)

  /*
   * ── Pflichtenheft §2.4: NICHT VERBORGEN, SONDERN BEGRÜNDET ──────────────────────────────────
   * Trägt der Lastgang bereits Einspeisung, STEHT die Eigenverbrauchs-Ersparnis dort — sie ist
   * gemessen, und eine Schätzung daneben wäre ein Rückschritt (Prinzip 1). Wer nichts anbietet
   * und nichts sagt, sieht aus wie ein Rechner, der für diesen Kunden nichts kann; dasselbe
   * Muster wie das sichtbar deaktivierte Kleingewerbe-Profil in Delta 9b-1.
   */
  if (!eligibility.offered) {
    return (
      <div className="rounded-lg border border-border bg-surface-alt p-4">
        <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <Sun className="h-4 w-4 shrink-0" />
          PV-Erzeugung schätzen — für diesen Lastgang nicht nötig
        </p>
        <p className="mt-2 text-xs leading-relaxed text-text-muted">
          Ihr Lastgang enthält bereits <strong>gemessene Einspeisung</strong>. Die
          Eigenverbrauchs-Ersparnis im Ergebnis stammt damit aus Ihren echten Zählwerten — eine
          geschätzte Erzeugungskurve daneben wäre gegenüber dieser Messung ein Rückschritt und
          würde zwei Antworten auf dieselbe Frage erzeugen.
        </p>
      </div>
    )
  }

  function setDraft(key: number, patch: Partial<ArrayDraft>) {
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)))
  }

  function addArray() {
    setDrafts((ds) => (ds.length >= MAX_ARRAYS ? ds : [...ds, emptyDraft(nextKey.current++)]))
  }

  function removeArray(key: number) {
    setDrafts((ds) => (ds.length <= 1 ? ds : ds.filter((d) => d.key !== key)))
  }

  async function handleFetch() {
    setFailure(null)
    setPreview(null)
    const errs: Record<string, string> = {}

    if (!centroid) {
      errs.postalCode = postalCode.trim()
        ? 'Diese Postleitzahl kennen wir nicht. Bitte eine vierstellige österreichische PLZ eintragen — wir raten keine Koordinate.'
        : 'Bitte die Postleitzahl des Anlagenstandorts eintragen.'
    }

    const arrays: PvArrayInput[] = []
    for (const d of drafts) {
      const res = draftToArray(d)
      if (res.ok) arrays.push(res.array)
      else errs[`${d.key}_${res.field}`] = res.message
    }

    setErrors(errs)
    if (Object.keys(errs).length > 0 || !centroid) return

    setBusy(true)
    try {
      /*
       * EIN Aufruf JE MODULFLÄCHE. Sie werden EINZELN gerechnet und erst danach summiert — ein
       * zusammengefasster Wert („10,2 kWp bei mittlerer Ausrichtung") wäre eine gerechnete Zahl,
       * die nirgends dasteht, und bei zwei verschieden ausgerichteten Flächen ist die Tagesform
       * der Summe eine andere als die der gemittelten Fläche (Pflichtenheft §3(b)).
       *
       * Nacheinander und nicht parallel: der Aufruf kostet einen fremden, kostenlosen Dienst je
       * Anfrage rund 8 MB und acht Sekunden. Parallel wäre er für den Nutzer schneller und für
       * PVGIS ein Stossbetrieb — dieselbe Fairness-Überlegung wie beim aWATTar-Abruf (B21-2a).
       */
      const profiles: PvReferenceProfile[] = []
      for (const array of arrays) {
        const design: PvgisArrayDesign = {
          latitudeDeg: centroid.lat,
          longitudeDeg: centroid.lon,
          peakPowerKwp: array.peakPowerKwp,
          slopeDeg: array.slopeDeg,
          // Die EINE Umrechnung Kompass → PVGIS (s. Kopf).
          azimuthDeg: pvArrayAzimuthDeg(array),
        }
        const outcome = await fetchPvReferenceProfileAction(design)
        if (!outcome.ok) {
          setFailure(failureMessage(outcome.error))
          return
        }
        profiles.push(outcome.profile)
      }

      const timestamps = loadProfile.readings.map((r) => r.ts)
      /*
       * Summe über die Flächen, Slot für Slot. `expandReferenceToTimestamps` legt jedes Profil auf
       * DIESELBEN Zeitstempel (Treppenfunktion, §2.5) — die Reihen sind damit gleich lang und
       * gleich geordnet, und die Summe braucht keine Zuordnung.
       */
      const generationKw = new Array<number>(timestamps.length).fill(0)
      for (const profile of profiles) {
        const expanded = expandReferenceToTimestamps(profile, timestamps)
        for (let i = 0; i < generationKw.length; i++) {
          generationKw[i] = (generationKw[i] ?? 0) + (expanded[i] ?? 0)
        }
      }

      /*
       * Die Streuung wird über die SUMME der Flächen je Wetterjahr gebildet, nicht je Fläche: der
       * Report nennt eine Angabe für die ganze Anlage, und die Jahre sind über alle Flächen
       * dieselben (ein Aufruf, ein Zeitraum, `buildPvReferenceProfile` prüft den Jahressatz nach).
       */
      const yearTotals = new Map<number, number>()
      for (const profile of profiles) {
        for (const y of profile.annualYields) {
          yearTotals.set(y.year, (yearTotals.get(y.year) ?? 0) + y.kwh)
        }
      }

      const summary: EstimatedPvSummary = {
        postalCode: centroid.postalCode,
        locationName: centroid.name,
        latitudeDeg: centroid.lat,
        longitudeDeg: centroid.lon,
        totalPeakPowerKwp: arrays.reduce((s, a) => s + a.peakPowerKwp, 0),
        arrayCount: arrays.length,
        weatherYears: profiles[0]!.weatherYears,
        spread: summarizeAnnualYields([...yearTotals.values()]),
        // ⚠ Aus der ANTWORT des Dienstes, nicht aus unserer Eingabe — der Nachweis, womit
        // tatsächlich gerechnet wurde (Pflichtenheft §5 Punkt 2).
        echoedAzimuthDeg: profiles.map((p) => p.inputs.azimuthDeg),
        echoedSlopeDeg: profiles.map((p) => p.inputs.slopeDeg),
      }

      setPreview({
        profile: applyEstimatedPv(loadProfile, generationKw),
        pv: {
          fileName: `Geschätzt · PVGIS ${summary.weatherYears.from}–${summary.weatherYears.to}`,
          profile: buildEstimatedPvProfile(loadProfile, generationKw),
          // Das erzeugte Profil trägt DIESELBEN Zeitstempel wie der Lastgang: es deckt genau
          // dessen Zeitraum ab, hat keine Lücke und braucht keine eigene Warnung.
          dataQuality: {
            coveredDays: dataQuality.coveredDays,
            coveredMonths: dataQuality.coveredMonths,
            gapsInterpolated: 0,
            largestGapSlots: 0,
            warnings: [],
          },
        },
        summary,
      })
    } finally {
      setBusy(false)
    }
  }

  if (applied) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-accent bg-accent-subtle p-4">
        <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          PV-Erzeugung wird geschätzt
        </p>
        <AppliedSummary summary={applied.summary} />
        <div>
          <Button variant="outline" size="sm" onClick={onClear}>
            Schätzung entfernen
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface-alt p-4">
      <div className="flex flex-col gap-1">
        <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <Sun className="h-4 w-4 shrink-0" />
          PV-Erzeugung schätzen (optional)
        </p>
        <p className="text-xs leading-relaxed text-text-muted">
          Ihr Lastgang enthält keine Einspeisung — die Eigenverbrauchs-Ersparnis ist damit heute
          € 0. Wenn Sie eine PV-Anlage haben oder planen, schätzen wir ihre Erzeugung aus Standort
          und Auslegung und ziehen sie vom Verbrauch ab. Das Ergebnis ist im Report{' '}
          <strong>durchgehend als Schätzung gekennzeichnet</strong>; die Leistungspreis-Ersparnis
          wird dann gar nicht mehr ausgewiesen, weil auch die Lastspitzen zur Hälfte geschätzt
          wären.
        </p>
      </div>

      {/*
        ⚠ EIGENER DATENSCHUTZ-SATZ, PFLICHT (Pflichtenheft §2.3). Die bestehenden Einstiegs-Sätze
        („wird nicht hochgeladen" / „nicht übertragen") wären hier UNWAHR: für die Erzeugungsrechnung
        gehen Koordinate und Auslegung an den EU-Dienst PVGIS. Was NICHT hinausgeht, ist der
        Lastgang — die Kopplung Verbrauch − Erzeugung geschieht im Browser. Und die Entschärfung ist
        gemessen: eine PLZ genügt (< 1 % Ertragsunterschied innerhalb einer Stadt), deshalb erhebt
        dieser Rechner NIE eine hausgenaue Adresse.
      */}
      <p className="rounded-md border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-text-muted">
        <strong>Was dabei übertragen wird:</strong> Für die Erzeugungsrechnung gehen die Koordinate
        Ihrer Postleitzahl, kWp, Neigung und Ausrichtung an den offenen EU-Dienst{' '}
        <strong>PVGIS</strong> (Joint Research Centre der Europäischen Kommission).{' '}
        <strong>Ihr Lastgang wird nicht übertragen</strong> — er bleibt im Browser, die Verrechnung
        mit der Erzeugung geschieht hier auf Ihrem Gerät. Eine genaue Adresse brauchen wir nicht:
        innerhalb einer Stadt ändert der Standort den Ertrag um weniger als 1 %.
      </p>

      <div className="flex flex-col gap-1.5">
        <LabelWithInfo htmlFor="pvPostalCode" label="Postleitzahl des Standorts">
          Aus der Postleitzahl leiten wir die Koordinate ab, mit der PVGIS den Sonnenstand rechnet.
          Eine hausgenaue Adresse bringt nichts: innerhalb einer Stadt (bis ~13 km) unterscheidet
          sich der Jahresertrag um weniger als 1 %. Über 145 km sind es 6 % — die
          Postleitzahl ist also genau die Auflösung, ab der es zu zählen anfängt.
        </LabelWithInfo>
        <Input
          id="pvPostalCode"
          inputMode="numeric"
          value={postalCode}
          onChange={(e) => setPostalCode(e.target.value)}
          placeholder="z. B. 1100"
          aria-invalid={errors.postalCode ? true : undefined}
          className="max-w-[12rem]"
        />
        {errors.postalCode && <span className="text-xs text-negative">{errors.postalCode}</span>}
        {!errors.postalCode && centroid && (
          <span data-testid="pv-plz-treffer" className="text-xs text-positive">
            {centroid.postalCode} {centroid.name}
          </span>
        )}
      </div>

      {drafts.map((d, i) => {
        const info = compassDirectionInfo(d.direction)
        return (
          <div key={d.key} className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ink">
                Modulfläche {i + 1}
                {drafts.length > 1 ? ` von ${drafts.length}` : ''}
              </span>
              {drafts.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeArray(d.key)}
                  className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-negative"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Entfernen
                </button>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField
                id={`pv${d.key}_kwp`}
                label="Nennleistung"
                unit="kWp"
                value={d.peakPowerKwp}
                onChange={(v) => setDraft(d.key, { peakPowerKwp: v })}
                error={errors[`${d.key}_peakPowerKwp`]}
              />
              <NumberField
                id={`pv${d.key}_slope`}
                label="Neigung (0 = flach, 90 = senkrecht)"
                unit="°"
                value={d.slopeDeg}
                onChange={(v) => setDraft(d.key, { slopeDeg: v })}
                error={errors[`${d.key}_slopeDeg`]}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <LabelWithInfo htmlFor={`pv${d.key}_dir`} label="Ausrichtung">
                  Wohin die Module zeigen — als Himmelsrichtung, nicht als Winkel eines
                  Planungsprogramms. <strong>Der Unterschied ist teuer:</strong> Programme wie
                  PV*SOL zählen den Winkel vom Norden (Südosten = 133°), PVGIS zählt ihn vom Süden
                  (derselbe Südosten = −47°). Wer die Zahl aus einem Planungsdokument ungeprüft
                  übernimmt, richtet die Anlage nach Nordwesten aus — die Gegenrichtung — und die
                  ausgewiesene Ersparnis fällt gemessen um <strong>56 %</strong>, ohne dass die Zahl
                  falsch aussähe. Deshalb wählen Sie hier die Richtung; die Umrechnung machen wir.
                </LabelWithInfo>
                <Select
                  value={d.direction}
                  onValueChange={(v) => setDraft(d.key, { direction: v as CompassDirection })}
                >
                  <SelectTrigger id={`pv${d.key}_dir`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMPASS_DIRECTIONS.map((dir) => (
                      <SelectItem key={dir.key} value={dir.key}>
                        {dir.label} ({dir.compassDeg}°)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`pv${d.key}_deg`}>Genauer Winkel (optional)</Label>
                <div className="relative">
                  <Input
                    id={`pv${d.key}_deg`}
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={d.compassDeg}
                    onChange={(e) => setDraft(d.key, { compassDeg: e.target.value })}
                    placeholder={String(info.compassDeg)}
                    aria-invalid={errors[`${d.key}_compassDeg`] ? true : undefined}
                    className="pr-32"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-text-muted">
                    ° ab Norden
                  </span>
                </div>
                {errors[`${d.key}_compassDeg`] ? (
                  <span className="text-xs text-negative">{errors[`${d.key}_compassDeg`]}</span>
                ) : (
                  <span className="text-xs text-text-muted">
                    Leer lassen = {info.label} ({info.compassDeg}°). Gezählt ab Norden im
                    Uhrzeigersinn.
                  </span>
                )}
              </div>
            </div>
          </div>
        )
      })}

      {drafts.length < MAX_ARRAYS && (
        <div>
          <Button variant="outline" size="sm" onClick={addArray}>
            <Plus className="h-4 w-4" />
            Weitere Modulfläche
          </Button>
        </div>
      )}

      <InfoHint
        label="Mehrere Modulflächen"
        before={<span className="text-xs font-medium text-ink">Warum mehrere Flächen einzeln?</span>}
      >
        Eine Ost-West-Anlage erzeugt über den Tag verteilt, eine Südanlage konzentriert am Mittag —
        und für die Frage, wie viel davon im Speicher landet statt eingespeist zu werden, ist genau
        diese Tagesform entscheidend. Zwei Flächen zu einer gemittelten zusammenzufassen ergäbe eine
        Kurve, die es an Ihrem Dach nicht gibt. Wir rechnen deshalb jede Fläche einzeln und
        addieren erst die Erzeugung.
      </InfoHint>

      {failure && (
        <Alert variant="warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Die Erzeugung konnte nicht abgerufen werden</AlertTitle>
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      )}

      {preview && (
        <div className="flex flex-col gap-3 rounded-md border border-accent bg-accent-subtle p-3">
          <p className="text-sm font-medium text-ink">So würde gerechnet</p>
          <AppliedSummary summary={preview.summary} />
          <p className="text-xs leading-relaxed text-text-muted">
            Stimmen Ausrichtung und Neigung? Dann übernehmen — die Erzeugung wird vom Verbrauch
            abgezogen, und der Report weist die Eigenverbrauchs-Zahl durchgehend als Schätzung aus.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onApply(preview)}>
              Für die Analyse übernehmen
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPreview(null)}>
              Verwerfen
            </Button>
          </div>
        </div>
      )}

      {!preview && (
        <div>
          <Button variant="outline" onClick={() => void handleFetch()} disabled={busy}>
            {busy ? 'Erzeugung wird berechnet …' : 'PV-Erzeugung berechnen'}
          </Button>
          <p className="mt-1.5 text-xs text-text-muted">
            Der Abruf dauert je Modulfläche einige Sekunden — PVGIS liefert dafür zehn volle
            Wetterjahre.
          </p>
        </div>
      )}

      {/*
        ⚠ NAMENSNENNUNG ALS LIZENZBEDINGUNG (CC BY 4.0), nicht als Höflichkeit — die PLZ-Tabelle
        stammt aus dem GeoNames-Datensatz und darf nur mit Nennung und Link verwendet werden.
        Deshalb sichtbar hier und nicht nur im Kopf des Codemoduls.
      */}
      <p className="text-[11px] leading-relaxed text-text-muted">
        Postleitzahl-Koordinaten:{' '}
        <a
          href={POSTAL_CODE_SOURCE.url}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          {POSTAL_CODE_SOURCE.name}
        </a>{' '}
        (
        <a
          href={POSTAL_CODE_SOURCE.licenseUrl}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          {POSTAL_CODE_SOURCE.license}
        </a>
        ). Erzeugungsdaten: PVGIS, Joint Research Centre der Europäischen Kommission.
      </p>
    </div>
  )
}

/**
 * Die zurückgespiegelten Rechenannahmen.
 *
 * ⚠ Sie stammen aus der ANTWORT von PVGIS und nicht aus dem Formular — das ist der Punkt. Nur so
 * ist am Bildschirm (und in einer Prüfung) nachvollziehbar, mit welchem Azimut wirklich gerechnet
 * wurde, und die Konventions-Umrechnung ist end-to-end überprüfbar statt bloss behauptet
 * (Pflichtenheft §5 Punkt 2). Angezeigt wird zusätzlich die Kompass-Rückrechnung, weil ein
 * negativer PVGIS-Wert für einen Kunden nichts bedeutet.
 */
function AppliedSummary({ summary }: { summary: EstimatedPvSummary }) {
  return (
    <dl data-testid="pv-summary" className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
      <div className="flex justify-between gap-3">
        <dt className="text-text-muted">Standort</dt>
        <dd className="text-ink">
          {summary.postalCode} {summary.locationName}
        </dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-text-muted">Anlage</dt>
        <dd className="text-ink">
          <Num>{formatKwp(summary.totalPeakPowerKwp)}</Num> ·{' '}
          {summary.arrayCount === 1 ? '1 Fläche' : `${summary.arrayCount} Flächen`}
        </dd>
      </div>
      {summary.echoedAzimuthDeg.map((aspect, i) => (
        <div key={i} className="flex justify-between gap-3">
          <dt className="text-text-muted">
            Fläche {i + 1} — gerechnet mit
          </dt>
          <dd data-testid={`pv-aspect-${i}`} className="text-ink">
            <Num>{formatDeg(summary.echoedSlopeDeg[i] ?? 0)}</Num> Neigung · PVGIS-Azimut{' '}
            <Num>{formatDeg(aspect)}</Num>
          </dd>
        </div>
      ))}
      <div className="flex justify-between gap-3">
        <dt className="text-text-muted">Wetterjahre</dt>
        <dd className="text-ink">
          <Num>
            {summary.weatherYears.from}–{summary.weatherYears.to}
          </Num>{' '}
          (Mittel)
        </dd>
      </div>
      {summary.spread && (
        <div className="flex justify-between gap-3">
          <dt className="text-text-muted">Jahresertrag</dt>
          <dd className="text-ink">
            <Num>{formatKwh(summary.spread.meanKwh)}</Num> ± <Num>{formatPercent(summary.spread.spreadPercent)}</Num>
          </dd>
        </div>
      )}
    </dl>
  )
}

/**
 * Die drei Fehlerzustände des Proxys (B22a) in Sätze.
 *
 * ⚠ `invalid_input` und `rate_limited` bedeuten, dass die Anfrage GAR NICHT hinausgegangen ist —
 * sie als „PVGIS antwortet nicht" zu melden hiesse, dem Dienst etwas anzulasten, das bei uns
 * liegt. Und es gibt bewusst KEINEN stillen Rückfall auf eine Ersatzkurve: eine erfundene
 * Erzeugungsreihe wäre eine plausibel aussehende Zahl ohne Grundlage.
 */
function failureMessage(error: 'invalid_input' | 'rate_limited' | 'pvgis_error'): string {
  if (error === 'invalid_input') {
    return 'Die Angaben liegen ausserhalb des zulässigen Bereichs — die Anfrage wurde gar nicht erst gestellt. Bitte Nennleistung, Neigung und Standort prüfen.'
  }
  if (error === 'rate_limited') {
    return 'Es wurden gerade sehr viele Erzeugungsrechnungen angefordert. Bitte in einer Minute noch einmal versuchen — wir gehen mit dem kostenlosen EU-Dienst sparsam um.'
  }
  return 'Der EU-Dienst PVGIS hat nicht geantwortet. Bitte später noch einmal versuchen — wir rechnen bewusst mit keiner Ersatzkurve, weil eine erfundene Erzeugung im Ergebnis wie eine gemessene aussähe.'
}
