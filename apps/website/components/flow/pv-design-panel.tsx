'use client'

import { useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileText, Loader2, Plus, Sun, Trash2 } from 'lucide-react'
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
  pvDesignPrefill,
  summarizeAnnualYields,
  type CompassDirection,
  type EstimatedPvSummary,
  type LoadProfile,
  type PostalCodeCentroid,
  type PvArrayInput,
  type PvDesignArrayPrefill,
  type PvDesignExtraction,
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
import { scanPvDesign, type PvDesignScanResponse } from '@/lib/pv-design-scan/actions'
import { FileDrop } from './file-drop'
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
  /**
   * B22c: die gelesene Auslegung, aus der diese Zeile vorbelegt wurde — oder `undefined`, wenn
   * sie von Hand entstanden ist.
   *
   * ⚠ SIE BLEIBT AN DER ZEILE STEHEN, WEIL DIE HERKUNFT SONST UNSICHTBAR WÄRE. Ein vorbelegtes
   * Feld ist von einem selbst getippten nicht zu unterscheiden — und ein Vorgabewert, den der
   * Scan NICHT gefüllt hat (die Himmelsrichtung steht auf „Süden", weil das Auswahlfeld nicht
   * leer sein kann), sähe nach einer Angabe aus dem Dokument aus. Genau dieser Defekt ist am
   * 01.09.2026 im Tarifblatt-Scan gemessen worden: dort stand ein Platzhalter neben abgelesenen
   * Werten und war von ihnen nicht zu trennen. Der Vermerk unten nennt deshalb BEIDES — was
   * übernommen wurde und was nicht.
   */
  scan?: PvDesignArrayPrefill
}

function emptyDraft(key: number): ArrayDraft {
  return { key, peakPowerKwp: '', slopeDeg: '30', direction: 'S', compassDeg: '' }
}

/** Eine gelesene Zahl als Feldwert — leer, wo nichts gelesen wurde. */
function draftValue(v: number | null): string {
  return v == null ? '' : String(v)
}

/**
 * Eine GELESENE Zahl in der Vorschau — deutsch geschrieben, aber ausdrücklich UNGERUNDET.
 *
 * ⚠ NICHT `formatKwp`/`formatDeg` VERWENDEN, und der Grund ist der Zweck dieser Vorschau. Sie
 * dient dem Abgleich Feld für Feld gegen das Papier: dort steht „4,25 kWp", und `formatKwp` macht
 * daraus „4,3 kWp" (eine Nachkommastelle). Der Leser könnte dann nicht mehr entscheiden, ob wir
 * 4,25 gelesen haben oder tatsächlich 4,3 — also genau die Frage nicht beantworten, für die die
 * Bestätigungsstufe da ist. In der Zusammenfassung NACH dem PVGIS-Abruf ist eine Nachkommastelle
 * dagegen richtig und bleibt unverändert: dort steht eine gerechnete Summe, kein abgelesener Wert.
 *
 * Im Live-Lauf am 02.09.2026 gemessen: die erste Fassung zeigte „4,3 kWp" und „6 kWp" für die
 * gelesenen 4,25 und 5,95 — die Formularfelder trugen die exakten Werte, die Vorschau nicht.
 */
function formatRead(v: number): string {
  return new Intl.NumberFormat('de-AT', { maximumFractionDigits: 6 }).format(v)
}

/**
 * Eine gelesene Modulfläche als Formularzeile.
 *
 * ⚠ EIN NICHT GELESENES FELD BLEIBT LEER, es fällt NICHT auf den Vorgabewert des leeren Formulars
 * zurück (die Neigung stünde sonst auf „30", ohne dass das im Dokument stünde). Das gilt nicht für
 * die Himmelsrichtung: ihr Auswahlfeld kann nicht leer sein, sie behält deshalb „Süden" — und
 * genau darauf weist der Vermerk an der Zeile ausdrücklich hin.
 */
function draftFromScan(key: number, p: PvDesignArrayPrefill): ArrayDraft {
  return {
    key,
    peakPowerKwp: draftValue(p.peakPowerKwp),
    slopeDeg: draftValue(p.slopeDeg),
    direction: p.direction ?? 'S',
    compassDeg: draftValue(p.compassDeg),
    scan: p,
  }
}

/** Was an einer vorbelegten Zeile ÜBERNOMMEN wurde — für den Herkunftsvermerk. */
function adoptedFields(p: PvDesignArrayPrefill): string[] {
  const read: string[] = []
  if (p.peakPowerKwp != null) read.push('Nennleistung')
  if (p.slopeDeg != null) read.push('Neigung')
  if (p.direction != null) read.push('Ausrichtung')
  if (p.compassDeg != null) read.push('Winkel')
  return read
}

/**
 * Was an einer vorbelegten Zeile OFFEN geblieben ist — je Grund ein eigener Satz.
 *
 * ⚠ DER ZWEITE PUNKT IST DER TEURE. Widersprechen sich die gedruckte Gradzahl und die
 * Himmelsrichtung, ist das der Fingerabdruck der Konventions-Verwechslung: PV*SOL zählt vom
 * Norden, PVGIS vom Süden, und dieselbe Fläche trägt je nach Werkzeug 133° oder −47°. Übernommen
 * zeigte die Anlage in die Gegenrichtung und die ausgewiesene Ersparnis fiele gemessen um 56 % —
 * bei einer Zahl, die völlig plausibel aussieht. Übernommen wird deshalb nur die Himmelsrichtung
 * (ein Wort ist über alle Zählweisen hinweg eindeutig), und der Widerspruch wird BENANNT, statt
 * eine der beiden Angaben stillschweigend zu bevorzugen.
 */
function openPoints(p: PvDesignArrayPrefill): string[] {
  const open: string[] = []
  if (p.peakPowerKwp == null) open.push('Die Nennleistung stand nicht im Dokument — bitte eintragen.')
  if (p.slopeDeg == null) open.push('Die Neigung stand nicht im Dokument — bitte eintragen.')
  if (p.direction == null) {
    open.push(
      'Im Dokument stand keine Himmelsrichtung als Wort. Die Auswahl unten zeigt „Süden" — das ' +
        'ist der Vorgabewert des Formulars und NICHT Ihre Auslegung. Bitte selbst wählen.',
    )
  }
  if (p.degreeConflict) {
    const info = compassDirectionInfo(p.degreeConflict.direction)
    open.push(
      `Das Dokument nennt ${formatRead(p.degreeConflict.printedDeg)}° neben „${info.label}" — das passt nicht ` +
        `zusammen (${info.label} liegt bei ${info.compassDeg}° auf dem Kompass). Vermutlich zählt ` +
        'das Dokument die Grade von einer anderen Richtung aus. Der Winkel wurde deshalb NICHT ' +
        'übernommen, die Himmelsrichtung schon — sie ist eindeutig. Tragen Sie den Winkel nur ' +
        'ein, wenn Sie ihn ab Norden gezählt kennen.',
    )
  }
  if (p.unverifiedDeg != null) {
    open.push(
      `Das Dokument nennt ${formatRead(p.unverifiedDeg)}°, aber keine Himmelsrichtung dazu. Ohne sie lässt ` +
        'sich nicht prüfen, ob die Zahl ab Norden oder ab Süden gezählt ist — die beiden liegen ' +
        '180° auseinander. Der Winkel wurde deshalb nicht übernommen.',
    )
  }
  if (p.steepSlope) {
    open.push(
      `Die Neigung ${formatRead(p.slopeDeg ?? 0)}° ist ungewöhnlich steil (das ist eine Fassade, kein übliches ` +
        'Dach). So steht sie im Dokument und wurde unverändert übernommen — bitte prüfen, ob sie ' +
        'stimmt.',
    )
  }
  return open
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
  /**
   * B22c: die Ortsangabe aus einem gelesenen Planungsdokument — reine Anzeige.
   *
   * ⚠ SIE BELEGT DAS PLZ-FELD AUSDRÜCKLICH NICHT. Ein Planungsdokument trägt keine Koordinate,
   * sondern den Namen eines Klimadatensatzes („Wien 11, AUT (1996 - 2015)"); daraus eine
   * Postleitzahl abzuleiten wäre dieselbe Rateleistung, die für die PLZ-Zentroiden ausdrücklich
   * ausgeschlossen ist (kein Geocoding, kein Fremddienst, kein Treffer ⇒ nichts). Eine falsch
   * geratene PLZ verschöbe die Koordinate, ohne dass die Zahl falsch aussähe.
   */
  const [scanLocation, setScanLocation] = useState<string | null>(null)
  /** Mehr Modulflächen im Dokument als das Formular fasst — wird im Klartext gesagt, nicht still gekappt. */
  const [scanOverflow, setScanOverflow] = useState(0)

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

  /**
   * B22c — die gelesene Auslegung wird in die Formularzeilen übernommen.
   *
   * ⚠ SIE ERSETZT DIE ZEILEN, sie ergänzt sie nicht. Ein Dokument beschreibt EINE Anlage; die
   * gelesenen Flächen neben schon eingetippte zu stellen ergäbe eine Anlage, die es nirgends gibt
   * — und die Summe der Nennleistungen wäre still zu hoch.
   *
   * ⚠ ES WIRD NICHTS GERECHNET. Der Abruf bei PVGIS bleibt ein eigener, ausdrücklicher Klick —
   * dieselbe Haltung wie im Formular-Weg: zwischen dem Gelesenen und dem Gerechneten steht ein
   * Mensch, weil ein einzelner falsch gelesener Winkel die halbe Ersparnis bewegt.
   */
  function adoptScan(extraction: PvDesignExtraction) {
    const prefills = pvDesignPrefill(extraction)
    const taken = prefills.slice(0, MAX_ARRAYS)
    setDrafts(taken.map((p) => draftFromScan(nextKey.current++, p)))
    setScanOverflow(prefills.length - taken.length)
    setScanLocation(extraction.locationText)
    // Ein neuer Vorschlag macht eine frühere Vorschau und frühere Feldfehler gegenstandslos.
    setErrors({})
    setPreview(null)
    setFailure(null)
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

      {/*
        B22c — DER DRITTE EINSTIEG, gleichwertig neben „PLZ eintragen" und „Formular ausfüllen".
        Er füllt dieselben Felder, die ein Mensch sonst abtippt; gerechnet wird danach unverändert
        über denselben Knopf.
      */}
      <PvDesignScanSection onAdopt={adoptScan} />

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
        {scanLocation && (
          /*
            ⚠ REINE ANZEIGE — die PLZ wird daraus NICHT abgeleitet (s. `scanLocation`). Der Satz
            steht trotzdem hier und nicht im Scan-Abschnitt oben: er ist eine Hilfe für GENAU
            dieses Feld, und der Nutzer soll ihn lesen, während er die Postleitzahl eintippt.
          */
          <span data-testid="pv-scan-ort" className="text-xs text-text-muted">
            Im Dokument steht als Standort „{scanLocation}". Wir leiten daraus bewusst keine
            Postleitzahl ab — eine geratene Koordinate verschöbe die ganze Erzeugungsrechnung.
            Bitte die PLZ des Anlagenstandorts selbst eintragen.
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

            {d.scan && <ScanOriginNote scan={d.scan} />}

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

      {scanOverflow > 0 && (
        /*
          ⚠ NICHT STILL GEKAPPT. Das Formular fasst sechs Flächen; ein Dokument mit mehr ergäbe
          sonst eine Anlage, die kleiner ist als die geplante — und die Ersparnis wäre zu niedrig,
          ohne dass jemand den Grund sähe.
        */
        <Alert variant="warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Nicht alle Modulflächen übernommen</AlertTitle>
          <AlertDescription>
            Das Dokument führt {scanOverflow === 1 ? 'eine weitere Modulfläche' : `${scanOverflow} weitere Modulflächen`}
            , als dieses Formular fasst ({MAX_ARRAYS}). Bitte fassen Sie gleich ausgerichtete
            Flächen zusammen oder rechnen Sie sie getrennt — sonst fehlt ihre Erzeugung im
            Ergebnis.
          </AlertDescription>
        </Alert>
      )}

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
 * B22c — der Herkunftsvermerk an einer vorbelegten Zeile.
 *
 * ⚠ ER BLEIBT STEHEN, AUCH WENN DER NUTZER DANACH SELBST TIPPT, und beschreibt damit die
 * VORBELEGUNG, nicht den aktuellen Feldinhalt. Das Wort „übernommen" sagt genau das. Ihn beim
 * Tippen nachzuführen verlangte kontrollierte Felder; die Frage, die er beantwortet, ist ohnehin
 * die umgekehrte — „stand das schon da, oder habe ich es eingetragen?". Dieselbe Entscheidung und
 * dieselbe Begründung wie beim Tarifblatt-Scan (`apps/web`, 01.09.2026).
 */
function ScanOriginNote({ scan }: { scan: PvDesignArrayPrefill }) {
  const adopted = adoptedFields(scan)
  const open = openPoints(scan)

  return (
    <div data-testid="pv-scan-herkunft" className="flex flex-col gap-1 text-xs leading-relaxed">
      <span className="text-accent">
        {adopted.length > 0
          ? `Aus dem Dokument übernommen: ${adopted.join(', ')}.`
          : 'Aus dem Dokument liess sich für diese Fläche nichts übernehmen.'}
        {scan.moduleCount != null && ` Das Dokument nennt dazu ${scan.moduleCount} Module.`}
      </span>
      {open.map((line, i) => (
        <span key={i} className="text-warning">
          {line}
        </span>
      ))}
    </div>
  )
}

/**
 * Was der Nutzer zu einem Fehlschlag zu sehen bekommt — je Zustand ein eigener Satz.
 *
 * Der Schlüssel ist die Fehler-Union der Server Action und NICHT `string`: so wird ein neuer
 * Zustand im Backend hier zum Typfehler, statt still in einer Auffang-Meldung zu landen, die dem
 * Nutzer etwas Falsches erzählt.
 */
type PvScanError = Extract<PvDesignScanResponse, { ok: false }>['error']

const SCAN_ERROR_TEXT: Record<PvScanError, { title: string; message: string }> = {
  no_file: {
    title: 'Keine Datei',
    message: 'Die Datei scheint leer zu sein. Bitte wählen Sie die PDF Ihres Angebots.',
  },
  wrong_type: {
    title: 'Nur PDF',
    message:
      'Wir können bislang nur PDF-Dateien auslesen. Ein Foto oder Screenshot geht noch nicht — ' +
      'bitte laden Sie die PDF Ihres Planers hoch oder tragen Sie die Auslegung unten selbst ein.',
  },
  too_large: {
    title: 'Datei zu gross',
    message:
      'Die Datei ist grösser als 8 MB. Ein Auslegungsdokument liegt normalerweise weit darunter — ' +
      'bitte prüfen Sie, ob Sie versehentlich ein sehr hoch aufgelöstes Scan-Bild hochgeladen haben.',
  },
  unreadable: {
    title: 'Keine Modulfläche gefunden',
    message:
      'In diesem Dokument war keine Modulfläche mit Nennleistung, Neigung oder Ausrichtung zu ' +
      'finden. Das kann daran liegen, dass es ein eingescanntes Bild ohne Text ist, oder dass es ' +
      'gar keine Anlagenauslegung ist. Bitte tragen Sie die Werte unten selbst ein — das Ergebnis ' +
      'ist dasselbe, Sie tippen nur mehr.',
  },
  not_configured: {
    title: 'Dokument-Auslesen derzeit nicht verfügbar',
    message:
      'Das Auslesen von Auslegungsdokumenten ist auf diesem Server nicht eingerichtet. Das ' +
      'Formular unten funktioniert unverändert.',
  },
  unavailable: {
    title: 'Auslesen fehlgeschlagen',
    message:
      'Wir konnten das Dokument gerade nicht auslesen. Bitte versuchen Sie es später noch einmal — ' +
      'oder tragen Sie die Auslegung unten selbst ein.',
  },
}

/**
 * B22c — der Scan-Weg (Pflichtenheft §3(c), entspricht Delta 9b-2). Die SECHSTE KI-Anbindung.
 *
 * ── ER BELEGT VOR, ER RECHNET NICHT ───────────────────────────────────────────────────────────
 * Was er tut, ist genau das, was ein Mensch sonst abtippt: die Modulflächen des Formulars füllen.
 * Er liefert keine Zeitreihe (die Ertragskurve steht im Dokument ausschliesslich als BILD, aus dem
 * Text ist kein Monatswert zu holen — Bestandsaufnahme 3.2), keine Koordinate und keinen
 * PVGIS-Abruf. Der Abruf bleibt ein eigener, ausdrücklicher Klick weiter unten.
 *
 * ── ⚠ VORSCHAU, KEINE STILLE ÜBERNAHME ────────────────────────────────────────────────────────
 * Zwischen dem Gelesenen und dem Formular steht eine Liste und ein ausdrückliches „Übernehmen" —
 * dieselbe Haltung wie beim Rechnungs-Scan, beim Tarifblatt-Scan und bei der Freitext-Batterie,
 * hier zusätzlich deshalb, weil ein einzelner falsch gelesener Winkel gemessen 56 % der Ersparnis
 * bewegt. Nach der Übernahme bleibt jedes Feld editierbar: der Scan ist ein Abtipp-Ersatz, keine
 * Feststellung — und was aus einer PLANUNG gelesen wird, ist ohnehin nie eine Messung.
 */
function PvDesignScanSection({ onAdopt }: { onAdopt: (extraction: PvDesignExtraction) => void }) {
  const [fileName, setFileName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ title: string; message: string } | null>(null)
  const [extraction, setExtraction] = useState<PvDesignExtraction | null>(null)
  const [adopted, setAdopted] = useState(false)

  async function handleFile(file: File) {
    setFileName(file.name)
    setError(null)
    setExtraction(null)
    setAdopted(false)
    setBusy(true)
    try {
      const response = await scanPvDesign(file)
      if (!response.ok) {
        setError(SCAN_ERROR_TEXT[response.error])
        return
      }
      setExtraction(response.extraction)
    } catch {
      /*
       * Eine Server Action kann auch am Netz scheitern, bevor sie ihren eigenen Fehlerzustand
       * bilden kann. Dann gilt dieselbe Meldung wie bei `unavailable` — und ausdrücklich KEIN
       * Weiterreichen der technischen Ursache: sie sagt dem Absender nichts und einem Angreifer
       * etwas.
       */
      setError(SCAN_ERROR_TEXT.unavailable)
    } finally {
      setBusy(false)
    }
  }

  const prefills = extraction ? pvDesignPrefill(extraction) : []

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
        <FileText className="h-4 w-4 shrink-0" />
        Auslegung aus einem Angebot übernehmen (optional)
      </p>
      <p className="text-xs leading-relaxed text-text-muted">
        Wenn Ihnen ein Angebot oder eine Auslegung Ihres Installateurs vorliegt (PV*SOL, PVsyst
        oder ähnlich), lesen wir Nennleistung, Neigung und Ausrichtung je Modulfläche daraus aus
        und belegen die Felder darunter vor. Sie prüfen und korrigieren, bevor gerechnet wird.
      </p>

      {/*
        ⚠ EIGENER DATENSCHUTZ-SATZ, UND ER SAGT ETWAS ANDERES ALS DER ABSATZ DARÜBER.
        Für die Erzeugungsrechnung gehen nur Koordinate und Auslegung an PVGIS; DIESE Datei
        dagegen verlässt den Browser als Ganzes und geht an Anthropic. Ein Angebot trägt
        üblicherweise Name und Adresse im Kopf — wer die Datei ablegt, muss das VORHER gelesen
        haben, nicht danach. Denselben Satz führt der Rechnungs-Scan aus demselben Grund.
      */}
      <p className="rounded-md border border-border bg-surface-alt px-3 py-2 text-xs leading-relaxed text-text-muted">
        <strong>Was mit Ihrem Dokument geschieht:</strong> Anders als Ihr Lastgang verlässt diese
        Datei Ihren Browser — sie wird zum Auslesen an <strong>Anthropic</strong> übertragen, den
        Anbieter des Sprachmodells, das sie liest. Sie wird dabei{' '}
        <strong>nirgends gespeichert</strong>, weder bei uns noch in einer Datenbank oder einem
        Protokoll; zurück kommen ausschliesslich die abgelesenen Werte, die Sie gleich vor sich
        sehen. Ein Angebot trägt oft Ihren Namen und Ihre Adresse im Kopf. Wenn Sie das nicht
        möchten, tragen Sie die vier Angaben je Modulfläche einfach unten selbst ein — das
        Ergebnis ist dasselbe.
      </p>

      <FileDrop
        compact
        accept=".pdf,application/pdf"
        fileName={fileName}
        onFile={(file) => {
          void handleFile(file)
        }}
        title="Angebot oder Auslegung als PDF hierher ziehen oder klicken"
        hint="PV*SOL, PVsyst oder ähnlich — max. 8 MB"
      />

      {busy && (
        <p className="flex items-center gap-2 text-xs text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
          Das Dokument wird gelesen — das dauert einen Moment.
        </p>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{error.title}</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {adopted && (
        <Alert variant="default">
          <CheckCircle2 className="h-4 w-4 text-positive" />
          <AlertTitle>Übernommen</AlertTitle>
          <AlertDescription>
            Die Felder unten sind vorbelegt. Bitte prüfen und bei Bedarf korrigieren — danach die
            Postleitzahl eintragen und die Erzeugung berechnen.
          </AlertDescription>
        </Alert>
      )}

      {extraction && !adopted && (
        <div
          data-testid="pv-scan-vorschau"
          className="flex flex-col gap-3 rounded-md border border-accent bg-accent-subtle p-3"
        >
          <p className="text-sm font-medium text-ink">
            Das haben wir gelesen — bitte gegen Ihr Dokument prüfen
          </p>

          {extraction.locationText && (
            <p className="text-xs text-text-muted">
              Standort laut Dokument: <strong>{extraction.locationText}</strong>. Daraus leiten wir
              bewusst keine Postleitzahl ab — die tragen Sie gleich selbst ein.
            </p>
          )}

          <ol className="flex flex-col gap-2">
            {prefills.map((p, i) => (
              <li key={i} className="rounded-md border border-border bg-surface p-2">
                <p className="text-xs font-medium text-ink">
                  Modulfläche {i + 1}
                  {p.peakPowerKwp != null && (
                    <>
                      {' · '}
                      <Num>{formatRead(p.peakPowerKwp)}</Num> kWp
                    </>
                  )}
                  {p.slopeDeg != null && (
                    <>
                      {' · '}
                      <Num>{formatRead(p.slopeDeg)}</Num>° Neigung
                    </>
                  )}
                  {p.direction != null && ` · ${compassDirectionInfo(p.direction).label}`}
                  {p.compassDeg != null && (
                    <>
                      {' ('}
                      <Num>{formatRead(p.compassDeg)}</Num>° ab Norden)
                    </>
                  )}
                </p>
                <ScanOriginNote scan={p} />
              </li>
            ))}
          </ol>

          <p className="text-xs leading-relaxed text-text-muted">
            Stimmt das mit Ihrem Dokument überein? Dann übernehmen — es wird dabei noch nichts
            gerechnet, und jedes Feld bleibt danach änderbar.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => {
                onAdopt(extraction)
                setAdopted(true)
              }}
            >
              In das Formular übernehmen
            </Button>
            <Button variant="outline" size="sm" onClick={() => setExtraction(null)}>
              Verwerfen
            </Button>
          </div>
        </div>
      )}
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
