import {
  alignPvGrossToLoad,
  analyzeCurrentPeaks,
  buildDispatchTrace,
  calculateRoi,
  computeBatterySavings,
  evaluateTariffOptimization,
  pvConsistencyWarning,
  pvCoverageWarning,
  recommendBattery,
  simulateBattery,
  topPeaksKw,
} from 'engine'
import {
  DEMO_BATTERY_CATALOG,
  combineBatteries,
  type AddonBatteryScenario,
  type AnalysisResult,
  type BatteryCandidate,
  type BatteryResultEntry,
  type ExistingBatteryAnalysis,
} from 'shared'

import type { AnalysisRequest, WorkerOutbound } from './analysis-protocol'
// B14-2: dieselbe Katalog-Änderung, die auch der Bündel-Export mitschreibt — eine Definition,
// zwei Aufrufer (s. `lib/battery-override.ts`).
import { applyBatteryOverride } from './battery-override'
import { DEFAULT_HORIZON_YEARS } from './constants'
import type { CalculatorPayload } from '@/components/flow/types'

/*
 * Analyse-Worker — läuft OFF-MAIN-THREAD (kein Tab-Freeze, §2.2/§5).
 *
 * ┌─ STAND (Prompt 4, ABGESCHLOSSEN) ──────────────────────────────────────────┐
 * │ `current`/`peaks` (§3.4/§3.5) UND `perBattery`/`recommendation`            │
 * │ (§3.6–§3.8) sind jetzt ECHT: `analyzeCurrentPeaks()` + `recommendBattery()`│
 * │ laufen gegen den echten geparsten Lastgang, die echten Tarifparameter aus  │
 * │ dem Formular und den `DEMO_BATTERY_CATALOG` (packages/shared) — ein        │
 * │ Platzhalter bis Martins echter Katalog vorliegt (§8 OP#2). `dataQuality`   │
 * │ ist seit Prompt 2 echt. `dispatchTrace` ist seit der §6.2-Befüllung        │
 * │ (`recommendBattery` → `buildDispatchTrace`) je perBattery-Eintrag ECHT.    │
 * │                                                                            │
 * │ U2 Prompt C: `computeAnalysis()` bündelt die komplette Berechnung, damit   │
 * │ sowohl `run` (Erstlauf, mit künstlicher Fortschrittsanimation) als auch    │
 * │ `recompute` (Annahmen-Panel, §6.2, ohne Verzögerung — Performance-Fix      │
 * │ macht `recommendBattery` ~650ms für den vollen Katalog) dieselbe, EINE     │
 * │ Rechenkette durchlaufen (Prinzip 2: keine zweite, abweichende Rechnung).   │
 * │ Derselbe Worker bleibt über die gesamte Report-Sitzung am Leben (kein      │
 * │ Neu-Spawn je Annahmen-Änderung) — `ctx.onmessage` verarbeitet beliebig     │
 * │ viele Nachrichten nacheinander.                                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

// `self` im Worker-Scope; als Worker getypt, um unter der DOM-lib ohne
// webworker-lib-Konflikt korrekt postMessage(1 Argument) zu erlauben.
const ctx = self as unknown as Worker

function post(message: WorkerOutbound): void {
  ctx.postMessage(message)
}

/**
 * Die bestehende Anlage des Kunden — und je Katalog-Kandidat das Szenario „zusätzlich dazu".
 *
 * ── ⚠ WARUM DAS NICHT ÜBER `recommendBattery` LÄUFT ───────────────────────────────────────────
 * `recommendBattery` (§3.8) verkettet Simulation → Zuschreibung → ROI und SORTIERT anschliessend
 * nach `netSavingOverHorizon`; daraus entsteht `recommendation`. Der Speicher des Kunden gehört
 * dort nicht hinein: er ist keine Kaufoption, und seine Investitionsfelder sind Platzhalter (die
 * Anschaffung ist bezahlt). Mit einem Platzhalterpreis von 0 wäre seine Netto-Investition 0 und
 * er sortierte sich zwangsläufig auf Platz 1 — der Report spräche eine Kaufempfehlung für ein
 * Gerät aus, das der Kunde bereits besitzt.
 *
 * Aufgerufen werden deshalb dieselben Bausteine EINZELN und in derselben Reihenfolge wie in
 * `rank.ts`: `simulateBattery` (§3.6) → `computeBatterySavings` (§3.7). `calculateRoi` (§3.9)
 * bleibt für die Anlage selbst aus — genau das ist die fachliche Aussage.
 *
 * ── ⚠ DIE KOMBINATION WIRD SIMULIERT, AUSGEWIESEN WIRD DIE DIFFERENZ ──────────────────────────
 * Zwei Speicher am selben Anschluss sind physikalisch EIN Speicher mit addierter Kapazität und
 * Leistung (`combineBatteries`). Simuliert wird deshalb die Kombination — ausgewiesen aber nur,
 * was ÜBER den Bestand hinausgeht (`kombiniert − Bestand allein`). Die Bruttozahl der Kombination
 * enthielte die Ersparnis, die der Kunde ohnehin schon hat; als „Ersparnis durch dieses Gerät"
 * gezeigt wäre sie eine Kaufbegründung mit fremdem Geld.
 *
 * Die Summe wird aus den DREI Differenzen gebildet und nicht als Differenz der beiden Summen: nur
 * so addieren sich die Zeilen der Ersparnis-Aufschlüsselung im Report auf den ausgewiesenen
 * Gesamtwert (bit-genau, ohne ULP-Abweichung). Fachlich sind beide Wege identisch, weil beide
 * Läufe ihre Anteile exakt aufsummieren (§3.7).
 *
 * ── ⚠ DIE INVESTITION IST DIE DES ZUSATZGERÄTS, NIE DIE DER KOMBINATION ───────────────────────
 * `calculateRoi(addon, …)` — nicht `calculateRoi(combined, …)`. Der kombinierte Kandidat trüge die
 * addierte Kapazität zum Zusatzpreis und behauptete damit eine Investition, die es nirgends gibt.
 * Bezahlt wird ausschliesslich das neue Gerät; verglichen wird es an dem, was es zusätzlich bringt.
 */
function buildExistingBatteryAnalysis(
  payload: CalculatorPayload,
  horizonYears: number,
  catalog: BatteryCandidate[],
): ExistingBatteryAnalysis | undefined {
  const existing = payload.existingBattery?.battery
  if (!existing) return undefined

  const loadProfile = payload.load.profile
  const pvProfile = payload.pv?.profile
  const pricing = payload.tariffPricing
  // Profil-, nicht batterieabhängig — einmal für alle Läufe (dieselbe Menge wie `peaks.top`).
  const topPeaks = topPeaksKw(loadProfile)

  const sim = simulateBattery(loadProfile, existing, payload.tariff, pvProfile, pricing)
  const savings = computeBatterySavings(loadProfile, existing, payload.tariff, sim, pricing)
  const entry: BatteryResultEntry = {
    battery: existing,
    ...savings,
    dispatchTrace: buildDispatchTrace(loadProfile, payload.tariff, sim, topPeaks),
  }

  const addonScenarios: AddonBatteryScenario[] = catalog.map((addon) => {
    const combined = combineBatteries(existing, addon)
    const cSim = simulateBattery(loadProfile, combined, payload.tariff, pvProfile, pricing)
    const cSav = computeBatterySavings(loadProfile, combined, payload.tariff, cSim, pricing)

    const leistungspreisSavingPerYear =
      cSav.leistungspreisSavingPerYear - savings.leistungspreisSavingPerYear
    const selfConsumptionSavingPerYear =
      cSav.selfConsumptionSavingPerYear - savings.selfConsumptionSavingPerYear
    const loadShiftSavingPerYear = cSav.loadShiftSavingPerYear - savings.loadShiftSavingPerYear
    const totalSavingPerYear =
      leistungspreisSavingPerYear + selfConsumptionSavingPerYear + loadShiftSavingPerYear

    return {
      // Das ZUSATZgerät: es wird gekauft, seine Karte zeigt seinen Preis und seine Amortisation.
      battery: addon,
      combined,
      // Absolutwert der Kombination (keine Differenz) — der abgerechnete Leistungswert IST eine
      // absolute Grösse; eine Differenz zweier kW-Werte wäre hier keine sinnvolle Aussage.
      newBilledKw: cSav.newBilledKw,
      leistungspreisSavingPerYear,
      selfConsumptionSavingPerYear,
      loadShiftSavingPerYear,
      selfConsumptionSavingOverCoveredPeriod:
        cSav.selfConsumptionSavingOverCoveredPeriod -
        savings.selfConsumptionSavingOverCoveredPeriod,
      loadShiftSavingOverCoveredPeriod:
        cSav.loadShiftSavingOverCoveredPeriod - savings.loadShiftSavingOverCoveredPeriod,
      // Faktor und abgedeckte Tage hängen am LASTGANG, nicht an der Batterie — beide Läufe liefern
      // denselben Wert, eine Differenz wäre hier sinnlos.
      annualizationFactor: cSav.annualizationFactor,
      coveredDays: cSav.coveredDays,
      totalSavingPerYear,
      /*
       * Die Warnungen des KOMBINIERTEN Laufs (z. B. „statische Steuerung: keine Spitzenkappung").
       * Bewusst nicht die §3.8-Warnungen aus `rank.ts` (Betonsockel, separater Wechselrichter):
       * die stehen für das Zusatzgerät ohnehin als eigene Kostenzeilen in der Investitionsliste
       * der Karte — ein zweites Mal als Warnung wären sie Lärm.
       */
      warnings: cSav.warnings,
      ...calculateRoi(addon, totalSavingPerYear, horizonYears, payload.financial),
    }
  })

  /*
   * Dieselbe Sortierregel wie `rank.ts` (§3.8): primär `netSavingOverHorizon` absteigend, Tie-Break
   * `amortizationYears` aufsteigend — hier auf die INKREMENTELLE Ersparnis angewandt. Zwei
   * verschiedene Rangfolgen im selben Report wären für denselben Leser zwei verschiedene
   * Bedeutungen von „am besten".
   */
  addonScenarios.sort((a, b) =>
    b.netSavingOverHorizon !== a.netSavingOverHorizon
      ? b.netSavingOverHorizon - a.netSavingOverHorizon
      : a.amortizationYears - b.amortizationYears,
  )

  return { entry, addonScenarios }
}

function computeAnalysis(
  payload: CalculatorPayload,
  horizonYears: number,
  catalog: BatteryCandidate[],
): AnalysisResult {
  const loadProfile = payload.load.profile
  const pvProfile = payload.pv?.profile

  // --- current/peaks: ECHTER Engine-Aufruf (§3.4/§3.5) ---
  const { current, peaks } = analyzeCurrentPeaks(loadProfile, payload.tariff)

  // --- PV-Konsistenz + -Abdeckung (§3.1): Brutto-PV gegen den Netz-Lastgang prüfen (Prinzip 1: Netz
  // gewinnt) UND einen still verpuffenden PV-Upload sichtbar machen. Einmal profil-weit (nicht je
  // Batterie) — die geklemmten/getroffenen Slots hängen nur an Lastgang×PV, nicht an der Batterie.
  // Ein stiller Verlust ist schlimmer als ein sichtbarer Fehler:
  //   • pvProfile vorhanden, überlappt aber nicht/kaum → pvCoverageWarning („ins Leere gelaufen").
  //   • pvProfile vorhanden & überlappt → pvConsistencyWarning bei geklemmten Slots (z. B. unvollständiges
  //     Profil: nur ein von mehreren Wechselrichtern < Summe der Einspeise-Zählpunkte).
  //   • pvError gesetzt (Datei hochgeladen, aber nicht lesbar → pvProfile null) → Ablehnung im Report.
  const pvWarnings: string[] = []
  if (pvProfile != null) {
    const alignment = alignPvGrossToLoad(loadProfile, pvProfile)
    const coverage = pvCoverageWarning(alignment.matchedSlots, loadProfile.readings.length)
    if (coverage) pvWarnings.push(coverage)
    const consistency = pvConsistencyWarning(alignment.inconsistentSlots)
    if (consistency) pvWarnings.push(consistency)
  } else if (payload.pvError) {
    pvWarnings.push(
      `Ein PV-Profil wurde hochgeladen, konnte aber nicht gelesen werden (${payload.pvError}) — die ` +
        'Analyse läuft ohne Brutto-PV; der PV-Eigenverbrauch kann dadurch unterschätzt sein.',
    )
  }

  /*
   * --- Tarifoptimierungs-Hebel (Delta 4/Delta 15 Regel C, B21-3b) ---
   * EINMAL profilweit ausgewertet, genau wie die PV-Konsistenz darüber — der Befund hängt am
   * Lastgang und an den Preisdaten, nicht an der Batterie. `evaluateTariffOptimization` ist
   * dieselbe Rechnung, die auch `intervalTariffRates` im Rechenkern anstellt (keine zweite
   * Prüfung daneben, die auseinanderlaufen könnte).
   *
   * ⚠ Delta 9a: Der Befund reist jetzt als STRUKTURIERTES Feld (`result.tariffOptimization`) und
   * NICHT mehr zusätzlich als Satz in `dataQuality.warnings`. Bis B21-3b war der Text der einzige
   * Weg, weil es keine Anzeige gab, die den Befund hätte auswerten können; seit Delta 9a gibt es
   * die Ergebniskarte, und sie verzweigt an `side`/`kind`/`ranges`. Beide Wege nebeneinander
   * bedeuteten denselben Satz zweimal auf einer Seite — und zwei Orte, die beim nächsten Umbau
   * auseinanderlaufen.
   *
   * `undefined` heisst: nicht angefordert — dann gibt es auch nichts zu melden.
   */
  const tariffOptimization = evaluateTariffOptimization(
    loadProfile,
    payload.tariff,
    payload.tariffPricing,
  )

  // --- perBattery/recommendation: ECHTER Engine-Aufruf (§3.6–§3.8) ---
  // `financial` ist bereits vollständig optional gebaut (§3.9) — fehlt es (Formular sammelt es
  // noch nicht immer), reicht `undefined` einfach durch: `taxEffectsIncluded=false`, `taxBenefit=0`.
  // `pvProfile` (optional) reichert nur den Trace um die echte Brutto-PV an (Dispatch/Ersparnis unverändert).
  const { perBattery, recommendation } = recommendBattery(
    loadProfile,
    payload.tariff,
    catalog,
    horizonYears,
    payload.financial,
    pvProfile,
    payload.tariffPricing,
  )

  return {
    current,
    peaks,
    perBattery,
    recommendation,
    assumptions: {
      // Einzelner Wirkungsgrad-Wert fürs Annahmen-Panel (§6.2): der der EMPFOHLENEN Batterie —
      // jeder Kandidat hat sein eigenes `roundTripEfficiency`, dieses Feld ist ein Report-weiter
      // Anzeigewert, kein Rechenkern-Input. `perBattery` ist über den nicht-leeren
      // `DEMO_BATTERY_CATALOG` nie leer.
      roundTripEfficiency: perBattery[0]!.battery.roundTripEfficiency,
      horizonYears,
      billingModel: payload.tariff.billingModel,
      energyPriceCtPerKwh: payload.tariff.energyPriceCtPerKwh,
      einspeiseverguetungCtPerKwh: payload.tariff.einspeiseverguetungCtPerKwh,
    },
    tariffOptimization,
    /*
     * Die bestehende Anlage des Kunden — ausserhalb von `perBattery`, s. `buildExistingBatteryAnalysis`.
     * `undefined`, wenn keine angegeben wurde: dann ist dieser Report Zeile für Zeile der bisherige.
     *
     * ⚠ Läuft in BEIDEN Handlern (Erstlauf wie Live-Neuberechnung), weil Tarif, Horizont und
     * Förderparameter sowohl die Ersparnis der Anlage als auch die Amortisation jedes
     * Zusatzgeräts verschieben. Nur im Erstlauf gerechnet stünde nach der ersten Änderung im
     * Annahmen-Panel ein Bestandsblock aus einer anderen Rechnung neben dem übrigen Report.
     */
    existingBatteryAnalysis: buildExistingBatteryAnalysis(payload, horizonYears, catalog),
    dataQuality: pvWarnings.length
      ? {
          ...payload.load.dataQuality,
          warnings: [...payload.load.dataQuality.warnings, ...pvWarnings],
        }
      : payload.load.dataQuality,
  }
}

ctx.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  const msg = event.data
  if (!msg) return

  if (msg.type === 'run') {
    /*
     * Der Katalog des Erstlaufs ist der UNVERÄNDERTE — es gibt beim ersten Lauf keinen Override
     * (der entsteht erst im Annahmen-Panel, §6.2). Ein bestätigter Bestandsspeicher verändert ihn
     * ausdrücklich NICHT mehr: er ist kein Katalog-Kandidat, sondern wird daneben simuliert
     * (`buildExistingBatteryAnalysis`). Nur so bleiben die Zusatzspeicher-Szenarien ehrlich —
     * verglichen wird gegen echte Katalog-Geräte, nicht gegen ein umetikettiertes.
     */
    const result = computeAnalysis(msg.payload, DEFAULT_HORIZON_YEARS, DEMO_BATTERY_CATALOG)

    // Künstliche Fortschrittsanimation NUR beim Erstlauf (§5 Schritt 3, StepAnalyzing) — kein
    // fachlicher Wert, reine Wahrnehmungs-Geste. `recompute` (unten) überspringt sie bewusst,
    // damit sich die Live-Neuberechnung im Annahmen-Panel tatsächlich live anfühlt.
    const progressSteps = [12, 34, 58, 81, 100]
    let step = 0
    const tick = () => {
      const value = progressSteps[step] ?? 100
      post({ type: 'progress', value })
      step += 1
      if (step < progressSteps.length) {
        setTimeout(tick, 320)
      } else {
        post({ type: 'result', result })
      }
    }
    setTimeout(tick, 250)
    return
  }

  if (msg.type === 'recompute') {
    try {
      /*
       * Der Bestandsspeicher reist im PAYLOAD mit und muss hier nicht aufgelöst werden — anders
       * als bis zum 01.09.2026, als er als `batteryPreset` ein Override war und bei jeder
       * Neuberechnung gegen einen ausdrücklichen Override abzugleichen war (vergass ein Aufrufer
       * das, verschwand die Angabe des Kunden lautlos). `msg.payload` trägt ihn unverändert;
       * `computeAnalysis` liest ihn selbst.
       */
      const catalog = applyBatteryOverride(DEMO_BATTERY_CATALOG, msg.batteryOverride)
      const result = computeAnalysis(msg.payload, msg.horizonYears, catalog)
      post({ type: 'recomputed', result })
    } catch (err) {
      post({
        type: 'error',
        message: err instanceof Error ? err.message : 'Neuberechnung fehlgeschlagen',
      })
    }
  }
}
