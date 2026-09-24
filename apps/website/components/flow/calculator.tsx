'use client'

import { useEffect, useState } from 'react'
import { displayPriceBasisFor, type BatteryCatalogState } from 'shared'

import {
  batteryCategoryFor,
  tariffComparisonDefaultFor,
  type BatteryCategoryInput,
} from '@/lib/battery-catalog/category'
import { fetchBatteryCatalog } from '@/lib/battery-catalog/source'
import { useAnalysis } from '@/lib/use-analysis'
import {
  SpeicherkatalogImAufbau,
  SpeicherkatalogNichtAbrufbar,
} from './speicherkatalog-hinweise'
import { Stepper } from './stepper'
import { StepAnalyzing } from './step-analyzing'
import { StepResult } from './step-result'
import { StepTariff } from './step-tariff'
import { StepUpload } from './step-upload'
import type { CalculatorPayload, ParsedLoad, TariffPrefill, TariffResult } from './types'

type Step = 1 | 2 | 3 | 4

// Orchestriert den 4-Schritt-Flow (§5). Hält Schritt-State + gesammelte Daten im Client.
export function Calculator() {
  const [step, setStep] = useState<Step>(1)
  const [load, setLoad] = useState<ParsedLoad | null>(null)
  /*
   * Delta 9b-2b: die aus einer Rechnung abgelesenen Tarifangaben. Sie hängen NICHT an `ParsedLoad`,
   * obwohl sie im selben Schritt entstehen — ein `LoadProfile` ist der Verbrauch, und ein
   * Tarifsatz gehört nicht hinein. In `ParsedLoad` mitgeführt reiste er ausserdem in das
   * Analyse-Bündel (B14-2), wo die Tarifwerte längst denormalisiert stehen; er stünde dort ein
   * zweites Mal und könnte von den gerechneten abweichen.
   */
  const [tariffPrefill, setTariffPrefill] = useState<TariffPrefill | undefined>(undefined)
  // Original-Payload (Tarif/Finanzen/PV) — für das Annahmen-Panel (§6.2): `recompute()` braucht
  // die unveränderten `load`/`pv`, um sie mit editierten `tariff`/`financial` neu zu verschicken.
  const [payload, setPayload] = useState<CalculatorPayload | null>(null)
  /*
   * ── K3b: DER SPEICHERKATALOG WIRD GENAU EINMAL GELADEN ────────────────────────────────────────
   * Er liegt hier und nicht im Worker, aus zwei Gründen. (1) Der Worker hat keinen Supabase-Client
   * und soll keinen bekommen — er ist der Rechenkern, und eine Abfrage darin wäre ein zweiter Ort,
   * an dem eine Netzstörung auftreten kann, ohne dass die Oberfläche es benennen könnte. (2) Der
   * ERSTLAUF und jede Neuberechnung im Annahmen-Panel müssen denselben Stand sehen: würde der
   * Worker je Nachricht neu abfragen, könnte eine Live-Änderung am Wirkungsgrad gegen einen
   * inzwischen gepflegten Katalog laufen, und der Report zeigte zwei Läufe gegen zwei Kataloge.
   * Der Stand reist deshalb als WERTKOPIE in beiden Nachrichten mit (`analysis-protocol.ts`).
   */
  const [categoryInput, setCategoryInput] = useState<BatteryCategoryInput>({ entry: 'upload' })
  const [catalog, setCatalog] = useState<BatteryCatalogState>({ kind: 'loading' })
  /** H3: Privatkunden sehen Beträge inkl. USt und geben Preise per Vorgabe brutto ein. */
  const priceDisplay = displayPriceBasisFor(batteryCategoryFor(categoryInput))
  /** Hochgezählt vom „Erneut versuchen"-Knopf — die einzige Möglichkeit, erneut abzufragen. */
  const [catalogRetry, setCatalogRetry] = useState(0)
  const analysis = useAnalysis()

  /*
   * Geladen wird, sobald die Kategorie feststeht — also nach Schritt 1. Ein Lauf, der schon auf der
   * Startseite begänne, fragte für jeden Besucher den Gewerbe-Katalog ab, auch für den, der gleich
   * ein Standardprofil erzeugt; der zweite Abruf wäre dann der eigentliche.
   *
   * `mounted`-Ref statt eines `cancelled`-Flags: eine noch laufende Abfrage, deren Kategorie sich
   * inzwischen geändert hat, darf ihr Ergebnis nicht mehr schreiben — sie würde sonst den Stand der
   * NEUEN Kategorie überschreiben (dieselbe Falle wie bei der PV-Erzeugung, s. Handover).
   */
  const catalogNeeded = step !== 1
  useEffect(() => {
    if (!catalogNeeded) return
    let current = true
    setCatalog({ kind: 'loading' })
    void fetchBatteryCatalog(batteryCategoryFor(categoryInput)).then((result) => {
      if (current) setCatalog(result)
    })
    return () => {
      current = false
    }
  }, [catalogNeeded, categoryInput, catalogRetry])

  // Analyse fertig → automatisch zum Ergebnis.
  useEffect(() => {
    if (step === 3 && analysis.status === 'done') setStep(4)
  }, [step, analysis.status])

  function handleUpload(l: ParsedLoad, prefill?: TariffPrefill, origin?: BatteryCategoryInput) {
    setLoad(l)
    /*
     * K3b: Die Herkunft entscheidet über die Katalog-Kategorie. Fehlt sie, ist dieser Lastgang
     * hochgeladen (Datei, Rechnungs-Scan, mehrzeiliger Upload) — nur das Standardprofil-Panel
     * kennt eine Kundenklasse und setzt sie. `setCategoryInput` ohne `if` ist auch hier das
     * Zurücksetzen: wer zurückgeht und statt des Standardprofils eine Datei wählt, darf nicht mit
     * dem Heim-Katalog weiterrechnen.
     */
    setCategoryInput(origin ?? { entry: 'upload' })
    /*
     * Auch das LEERE Ergebnis wird übernommen: wer zurückgeht und statt der Rechnung eine
     * Lastgang-Datei wählt, darf nicht die Tarifwerte der vorigen Rechnung im Formular vorfinden.
     * `setTariffPrefill(prefill)` statt `if (prefill)` — die Zuweisung IST das Zurücksetzen.
     */
    setTariffPrefill(prefill)
    setStep(2)
  }

  function handleTariff(result: TariffResult) {
    if (!load) return
    /*
     * ── B22b: DER GERECHNETE LASTGANG IST DER GEKOPPELTE ────────────────────────────────────────
     * Hat der Nutzer eine PV-Schätzung übernommen, ist ab hier ihr Ergebnis der Lastgang: Verbrauch
     * minus geschätzte Erzeugung, signiert, mit `pvSource: 'estimated'`. Er ersetzt das Profil im
     * PAYLOAD und nicht im `load`-State — der behält den Stand aus Schritt 1, damit ein Rücksprung
     * nach Schritt 2 wieder von der ungekoppelten Fassung ausgeht und die Erzeugung nicht ein
     * zweites Mal abgezogen wird.
     *
     * Dateiname und Rohbytes bleiben unverändert: die Prüfsumme des Analyse-Bündels bindet die
     * URSPRUNGSDATEI, und die ist dieselbe geblieben. Dass mit einer geschätzten PV gerechnet
     * wurde, sagt das Bündel über `inputs.pvSource` (Fassung 6).
     */
    const effectiveLoad: ParsedLoad = result.estimatedPv
      ? { ...load, profile: result.estimatedPv.profile }
      : load
    /*
     * ── K3b-2: EIN LEERER KATALOG HÄLT DIE ANALYSE NICHT MEHR AUF ───────────────────────────────
     * Bis hierher galt „ohne verwendbaren Katalog wird nicht gerechnet", weil `recommendBattery`
     * auf einem leeren Array warf. Das tut es nicht mehr: `recommendation` ist `null`, der Grund
     * reist als `noRecommendationReason` mit, und alles ohne Speicher Belegbare (Ist-Kosten,
     * Spitzen, Tarifvergleich) wird unverändert gerechnet.
     *
     * ⚠ `failed` und `loading` halten weiterhin an — und zwar aus dem ANDEREN Grund: dort ist
     * unbekannt, ob es Geräte gibt. Eine Analyse „ohne Speichervorschlag" behauptete dann, es
     * gäbe keinen, obwohl bloss die Abfrage nicht durchkam.
     */
    if (catalog.kind !== 'available' && catalog.kind !== 'empty') return
    const p: CalculatorPayload = { ...result, load: effectiveLoad }
    setPayload(p)
    setStep(3)
    // Off-Main-Thread; komplettes AnalysisResult echt (§3.4-3.8, Prompt 4 abgeschlossen).
    /* K3b-2: `empty` startet mit leerem Array — die Engine antwortet dann mit `recommendation:
       null` und `noRecommendationReason`, statt zu werfen. */
    analysis.start(p, catalog.kind === 'available' ? catalog.batteries : [])
  }

  function handleRestart() {
    analysis.reset()
    setCategoryInput({ entry: 'upload' })
    setLoad(null)
    setPayload(null)
    setTariffPrefill(undefined)
    setStep(1)
  }

  // Schritte 1–3 schmal & fokussiert; das Ergebnis (Report) nutzt die volle Breite.
  const narrow = step !== 4

  return (
    <div className="flex flex-col gap-8 py-8">
      <div className="mx-auto w-full max-w-2xl px-4 sm:px-6 print:hidden">
        <Stepper current={step} />
      </div>

      {narrow ? (
        <div className="mx-auto w-full max-w-2xl px-4 sm:px-6">
          {step === 1 && <StepUpload initialLoad={load} onComplete={handleUpload} />}
          {step === 2 && load && (
            <StepTariff
              // B21-3b: nur für den ZEITRAUM der Preisabfragen (Delta 15 Regel A) — die Messwerte
              // selbst bleiben im Browser (Prinzip 4).
              loadProfile={load.profile}
              // B22b: dieselbe Abdeckung erbt das erzeugte Brutto-PV-Profil (§3.1).
              loadDataQuality={load.dataQuality}
              // Delta 9b-2b: vorbelegt aus dem Rechnungs-Scan, sonst `undefined` (= wie vorher).
              prefill={tariffPrefill}
              defaultPriceBasis={priceDisplay}
              defaultTariffOptimization={tariffComparisonDefaultFor(batteryCategoryFor(categoryInput))}
              onBack={() => setStep(1)}
              onComplete={handleTariff}
              /* K3b-2: gesperrt, solange der Katalog lädt oder ausfällt — NICHT mehr, wenn er
                 für diese Kategorie leer ist: das ist eine Antwort, keine Störung, und die
                 Analyse läuft dann ohne Speichervorschlag (s. `handleTariff`). */
              catalogBlocked={catalog.kind === 'loading' || catalog.kind === 'failed'}
              catalogLoading={catalog.kind === 'loading'}
              catalogNotice={
                catalog.kind === 'failed' ? (
                  <SpeicherkatalogNichtAbrufbar
                    reason={catalog.reason}
                    onRetry={() => setCatalogRetry((n) => n + 1)}
                  />
                ) : catalog.kind === 'empty' ? (
                  <SpeicherkatalogImAufbau />
                ) : null
              }
            />
          )}
          {step === 3 && <StepAnalyzing progress={analysis.progress} status={analysis.status} />}
        </div>
      ) : (
        analysis.displayResult &&
        load &&
        payload && (
          <StepResult
            result={analysis.displayResult}
            priceDisplay={priceDisplay}
            // B14-2: die Eingaben GENAU zu `displayResult` — der Hook führt beide paarweise, damit
            // ein Bündel keine Eingaben zu einem anderen Ergebnis mitschreiben kann.
            inputs={analysis.displayInputs}
            /*
             * B22b: der Lastgang, gegen den TATSÄCHLICH gerechnet wurde — bei geschätzter PV also
             * der gekoppelte. Report-Chart, Druck-Deckblatt und Analyse-Bündel lesen ihn; eine
             * zweite Fassung daneben zeigte eine andere Kurve, als die Zahlen darüber beschreiben.
             */
            load={payload.load}
            payload={payload}
            /* K3b: derselbe Stand, gegen den gerechnet wurde — Archiv, Annahmen-Panel, Report. */
            batteryCatalog={catalog.kind === 'available' ? catalog.batteries : []}
            batteryCatalogMeta={catalog.kind === 'available' ? catalog.meta : {}}
            recomputing={analysis.recomputing}
            recomputeError={analysis.recomputeError}
            isLive={analysis.isLive}
            onRecompute={(input) =>
              /*
               * K3b: DERSELBE geladene Stand wie im Erstlauf — kein zweiter Abruf. Der Zweig ist
               * nur erreichbar, wenn oben `available` galt; der Rückfall auf ein leeres Array ist
               * der Typ-Abschluss und kann nicht eintreten (der Worker stünde sonst vor demselben
               * leeren Katalog wie in `handleTariff`).
               */
              analysis.recompute(
                { ...payload, tariff: input.tariff, financial: input.financial },
                input.horizonYears,
                catalog.kind === 'available' ? catalog.batteries : [],
                input.batteryOverride,
              )
            }
            onResetAssumptions={analysis.resetLive}
            onRestart={handleRestart}
          />
        )
      )}
    </div>
  )
}
