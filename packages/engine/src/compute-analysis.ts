import {
  combineBatteries,
  type AddonBatteryScenario,
  type AnalysisResult,
  type BatteryCandidate,
  type BatteryResultEntry,
  type EstimatedPvSummary,
  type ExistingBatteryAnalysis,
  type FinancialParams,
  type LoadProfile,
  type PvProfile,
  type TariffOptimizationStatus,
  type TariffParams,
  type TariffPricingInputs,
} from 'shared'

import type { DataQuality } from './parser'
import { analyzeCurrentPeaks, topPeaksKw } from './peaks'
import { recommendBattery } from './recommendation'
import { computePredictiveControlValue } from './foresight'
import { eagDemandChargePerYear } from './tariff'
import { calculateRoi } from './roi'
import { computeBatterySavings } from './savings'
import {
  alignPvGrossToLoad,
  buildDispatchTrace,
  buildMonthlyTariffComparison,
  evaluateTariffOptimization,
  pvConsistencyWarning,
  pvCoverageWarning,
  simulateBattery,
} from './simulation'

/*
 * Die EINE Rechenkette (§3.4–§3.9) hinter jedem Analyse-Lauf — bis zum 16.09.2026 app-lokal in
 * `apps/website/lib/analysis.worker.ts`. Sie liegt jetzt hier, weil der Wizard-Entwurf (D3) einen
 * zweiten Eingang zur SELBEN Rechnung braucht: eine Kopie in `apps/web` wäre die zweite, abweichende
 * Rechnung, die Prinzip 2 ausschliesst. Der Worker bleibt der Aufrufer, nicht der Eigentümer.
 */

// Ergebnis der optionalen PV-Datei (parsePvProfile, §3.1) — Brutto-PV-Erzeugung.
export type ParsedPv = {
  fileName: string
  profile: PvProfile
  dataQuality: DataQuality
}

/**
 * Der bereits installierte Speicher des Kunden, mit seinen EXAKTEN Werten.
 *
 * ── ⚠ SEIT DEM 01.09.2026 KEIN `BatteryOverride` MEHR ─────────────────────────────────────────
 * Bis dahin war dies ein Alias von `BatteryOverride`: die Angabe wurde auf den nächstliegenden
 * KATALOG-Kandidaten abgebildet und nur Wirkungsgrad und Preis übernommen. Wer 19,2 kWh besass,
 * bekam die Ersparnis von 15 kWh zu sehen. Jetzt reist ein fertiger, aus seinen Angaben gebauter
 * Kandidat mit (`buildExistingBatteryCandidate`), der ausserhalb von `perBattery` simuliert wird.
 *
 * ⚠ Er darf NIE in `calculateRoi` gelangen: seine Investitionsfelder sind Platzhalter (die
 * Anschaffung ist bezahlt), s. Kopf von `battery-combination.ts`.
 *
 * ── WARUM DAS DEN VERLUST-DEFEKT VON DELTA 17 TEIL 2 STRUKTURELL BEENDET ───────────────────────
 * Der bestätigte Speicher war als `batteryPreset` ein Override und musste bei jeder
 * Neuberechnung eigens gegen einen ausdrücklichen Override aufgelöst werden — vergass ein
 * Aufrufer das, verschwand die Angabe des Kunden lautlos (gemessener Defekt, 01.09.2026). Als
 * Feld des `CalculatorPayload` reist er jetzt bei JEDER Nachricht unverändert mit: beide
 * Worker-Handler bekommen den vollen Payload, es gibt nichts mehr aufzulösen.
 */
export type ExistingBatteryInput = {
  /** Der simulierbare Kandidat — Kapazität, Leistung und Wirkungsgrad wie angegeben. */
  battery: BatteryCandidate
  /**
   * `true` = der Freitext nannte KEINEN Wirkungsgrad, es gilt die dokumentierte Annahme
   * (`ASSUMED_EXISTING_ROUND_TRIP_EFFICIENCY`). Reist mit, damit der Report die einzige Zahl des
   * Bestandsblocks, die nicht vom Kunden stammt, als solche ausweisen kann — und nicht als seine.
   */
  efficiencyAssumed: boolean
}

/**
 * B22b — das Ergebnis des PV-Zeitreihengenerators, wie es Schritt 2 verlässt.
 *
 * `profile` ist der signierte Netz-Lastgang (Verbrauch − geschätzte Erzeugung) mit
 * `pvSource: 'estimated'`; er ERSETZT den Lastgang aus Schritt 1 für die Rechnung. `pv` ist das
 * zugehörige Brutto-PV-Profil und ausdrücklich BEIWERK DER ANZEIGE (Energiefluss-Chart) — es
 * ändert keine Ersparnis-Zahl (B22a, `couple.ts`). `summary` ist das, was der Report über die
 * Herkunft sagen können muss.
 */
export type EstimatedPvResult = {
  profile: LoadProfile
  pv: ParsedPv
  summary: EstimatedPvSummary
}

/**
 * Vom Tarif-Schritt nach oben gereichtes Ergebnis. `pv` ist optional (§3.1/§5 Schritt 2) — liegt es
 * vor, trägt es die Brutto-PV in Engine/Trace (echter 4. Strom + Konsistenzprüfung).
 *
 * ⚠ `tariffSelection` (B11: welcher Tarifsatz-Stand die Werte vorbelegt hat) steht bewusst NICHT
 * hier, sondern wird in `apps/website` angehängt. Es ist Report-/Bündel-Beiwerk, das die Rechnung
 * nie liest — und sein Typ gehört der Tarifsatz-Datenschicht, die `packages/engine` nicht kennen
 * darf (`tariff/no-catalog-dependency.test.ts`). Ein Feld hierher zu ziehen, nur weil es im selben
 * Objekt mitreist, machte die Engine von der Konfigurationsschicht abhängig.
 */
export type TariffResult = {
  tariff: TariffParams
  financial?: FinancialParams
  pv: ParsedPv | null
  // Eine PV-Datei wurde hochgeladen, konnte aber NICHT gelesen werden (parsePvProfile → error/
  // needs_mapping) → `pv` bleibt null. Die Meldung wandert in den Report (dataQuality), damit der
  // Upload nicht still verpufft (§3.1). Nur gesetzt, wenn tatsächlich eine Datei abgelehnt wurde.
  pvError?: string
  /**
   * B21-3b (Delta 4): die beiden Preisseiten für den kombinierten Intervallpreis — Netzbetreiber-
   * Tarifzeilen und Marktpreis-Reihe, geholt für den Zeitraum des Lastgangs (Delta 15 Regel A).
   *
   * `undefined` heisst: der Tarifoptimierungs-Hebel wurde NICHT angefordert. Dann gibt es keinen
   * Netzwerkaufruf und die Engine rechnet unverändert wie vor B21 — das ist kein Fehlerfall.
   * Ist es gesetzt, wurde angefordert; ein `null` DARIN heisst „angefordert, aber nicht lesbar" und
   * führt zur ausdrücklichen Kennzeichnung „nicht berechenbar" statt zu einem stillen Rückfall.
   */
  tariffPricing?: TariffPricingInputs
  /**
   * Delta 17 Teil 2: der vom Nutzer BESTÄTIGTE Speicher, den er bereits besitzt.
   *
   * `undefined` heisst „keine Angabe oder nicht übernommen" — dann verhält sich der Rechner Zeile
   * für Zeile wie vorher: voller Katalog, Empfehlung, Investition, Amortisation.
   */
  existingBattery?: ExistingBatteryInput
  /**
   * B22b: die geschätzte PV-Erzeugung — der GEKOPPELTE Lastgang und was der Report darüber sagen
   * muss. `undefined` heisst „nicht geschätzt"; dann verhält sich der Rechner Zeile für Zeile wie
   * vor B22.
   *
   * ⚠ Er trägt den fertigen Lastgang und nicht die Erzeugungsreihe: die Kopplung geschieht GENAU
   * EINMAL (im Panel, mit den Zeitstempeln des Lastgangs), und ein zweites Mal aufaddieren ist
   * damit strukturell ausgeschlossen. Wer stattdessen die Reihe weiterreichte, müsste an jeder
   * späteren Stelle wissen, ob sie schon abgezogen wurde.
   */
  estimatedPv?: EstimatedPvResult
}

/**
 * Ergebnis von Schritt 1 (parseLoadProfile, §3.2/§3.3) — die echte, getypte Nutzlast.
 *
 * ⚠ `fileName`/`sourceBytes` liest `computeAnalysis` nie; sie dienen Report und Analyse-Bündel.
 * Der Typ bleibt trotzdem einer — ein Aufspalten brächte zwei Typen für dieselbe Nutzlast.
 */
export type ParsedLoad = {
  fileName: string
  profile: LoadProfile
  dataQuality: DataQuality
  /**
   * B14-2: die ROHEN Bytes der hochgeladenen Datei — genau die, die geparst wurden, nicht eine
   * daraus abgeleitete Fassung. Sie werden nirgends verschickt (Prinzip 4) und dienen allein der
   * Prüfsumme des Analyse-Bündels: sie ist das Einzige, was Bündel und Ursprungsdatei beim
   * Archivieren aneinanderbindet.
   *
   * Optional, damit der Fall „liegt nicht mehr vor" ein echter Zustand ist und nicht ein
   * unmöglicher: ohne Bytes wird KEIN Bündel erzeugt (`buildAnalysisBundle` wirft).
   */
  sourceBytes?: Uint8Array
}

// Was die Rechenkette bekommt — der vollständige, an jeder Worker-Nachricht unveränderte Payload.
export type CalculatorPayload = TariffResult & {
  load: ParsedLoad
}

type ExistingBatteryOutcome = {
  analysis: ExistingBatteryAnalysis
  /**
   * Netzbezug nach dem Dispatch der bestehenden Anlage (signiert, + = Bezug) — die Eingangsgrösse
   * der Monatsreihe „aWATTar mit Ladesteuerung".
   *
   * ⚠ Sie reist als Rückgabewert heraus und NICHT als zusätzliches Contract-Feld: eine Rohreihe
   * mit bis zu 35.040 Werten im `AnalysisResult` wäre eine zweite, ungenutzte Kopie des Dispatchs
   * (derselbe Grund, aus dem `DispatchTrace` den Lastgang nicht dupliziert). Aggregiert wird
   * direkt hier, im selben Aufruf, in dem die Simulation ohnehin schon lebt.
   */
  gridAfterKw: number[]
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
): ExistingBatteryOutcome | undefined {
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

  return { analysis: { entry, addonScenarios }, gridAfterKw: sim.dispatch.gridAfterKw }
}

export function computeAnalysis(
  payload: CalculatorPayload,
  horizonYears: number,
  catalog: BatteryCandidate[],
): AnalysisResult {
  const loadProfile = payload.load.profile
  const pvProfile = payload.pv?.profile

  // --- current/peaks: ECHTER Engine-Aufruf (§3.4/§3.5) ---
  const { current, peaks } = analyzeCurrentPeaks(loadProfile, payload.tariff)

  /*
   * Die ZWEITE kW-gebundene Jahresgrösse neben dem Leistungspreis: der Grundpreis-Teil des
   * EAG-Förderbeitrags (21.09.2026). Er steht hier und nicht in `analyzeCurrentPeaks`, weil er an
   * den ABGABENSÄTZEN hängt und nicht am Abrechnungsmodell — `analyzeCurrentPeaks` bekommt
   * `TariffPricingInputs` gar nicht und soll es auch nicht bekommen.
   *
   * ⚠ `undefined` reicht als `undefined` durch und wird NICHT auf 0 gerundet: „nicht bezifferbar"
   * und „fällt nicht an" sind zwei verschiedene Aussagen (s. `eagDemandChargePerYear`).
   */
  const eagGrundpreisCostPerYear = eagDemandChargePerYear(
    loadProfile,
    payload.tariffPricing,
    current.billedKw,
  )

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
  const baseTariffOptimization = evaluateTariffOptimization(
    loadProfile,
    payload.tariff,
    payload.tariffPricing,
  )

  /*
   * Die bestehende Anlage des Kunden — ausserhalb von `perBattery`, s. `buildExistingBatteryAnalysis`.
   * `undefined`, wenn keine angegeben wurde: dann ist dieser Report Zeile für Zeile der bisherige.
   *
   * ⚠ Läuft in BEIDEN Handlern (Erstlauf wie Live-Neuberechnung), weil Tarif, Horizont und
   * Förderparameter sowohl die Ersparnis der Anlage als auch die Amortisation jedes
   * Zusatzgeräts verschieben. Nur im Erstlauf gerechnet stünde nach der ersten Änderung im
   * Annahmen-Panel ein Bestandsblock aus einer anderen Rechnung neben dem übrigen Report.
   */
  const existing = buildExistingBatteryAnalysis(payload, horizonYears, catalog)

  // --- perBattery/recommendation: ECHTER Engine-Aufruf (§3.6–§3.8) ---
  // `financial` ist bereits vollständig optional gebaut (§3.9) — fehlt es (Formular sammelt es
  // noch nicht immer), reicht `undefined` einfach durch: `taxEffectsIncluded=false`, `taxBenefit=0`.
  // `pvProfile` (optional) reichert nur den Trace um die echte Brutto-PV an (Dispatch/Ersparnis unverändert).
  //
  // ⚠ Steht seit D7 VOR dem Monatsvergleich und nicht mehr dahinter: dessen dritte Reihe kann jetzt
  // aus dem Dispatch der empfohlenen Batterie entstehen. Der Aufruf selbst ist unverändert — er
  // hängt an nichts, was dazwischen berechnet wird.
  const { perBattery, recommendation, recommendedGridAfterKw } = recommendBattery(
    loadProfile,
    payload.tariff,
    catalog,
    horizonYears,
    payload.financial,
    pvProfile,
    payload.tariffPricing,
  )

  /*
   * --- Monatsvergleich „Ist vs. aWATTar ohne Steuerung vs. aWATTar mit einem Speicher" ---
   *
   * ⚠ ER HÄNGT AN GENAU ZWEI BEDINGUNGEN, UND BEIDE SIND HART:
   *   1. `computable === true` — sonst ist die Preisreihe des Hebels bewusst durchgehend mit dem
   *      Standard-Arbeitspreis gefüllt (s. `intervalTariffRates`), und eine daraus gebildete
   *      Aggregation zeigte „aWATTar = Ist" statt „nicht berechenbar". Ein Balkenpaar, das
   *      Gleichstand behauptet, ist der stille Rückfall, vor dem Delta 15 warnt.
   *   2. Ein Dispatch, den die dritte Reihe zeigen kann. Ohne ihn gäbe es zwei von drei Reihen,
   *      und der Vergleich hiesse etwas anderes als das, was die Überschrift sagt.
   * Fehlt eine der beiden, entsteht KEINE der drei Reihen (kein Teilzustand) und die Sektion im
   * Report entfällt vollständig.
   *
   * ── ⚠ D7: WESSEN DISPATCH DAS IST ────────────────────────────────────────────────────────────
   * Bis D7 ausschliesslich die BESTEHENDE Anlage — ein Interessent ohne Speicher sah die Sektion
   * deshalb nie, obwohl der Vergleich gerade für ihn die Kauffrage beantwortet. Zweite Quelle ist
   * jetzt die empfohlene Katalog-Batterie, und zwar NUR, wenn sie sich im Betrachtungszeitraum
   * überhaupt rechnet: `netSavingOverHorizon > 0` — dieselbe Schwelle, an der der Report heute
   * schon entscheidet, ob ein Gerät gezeigt wird (`report.tsx`, `pdf-report/summary.ts`,
   * `pdf-report/comparison.ts`, 01.09.2026), und hier bewusst keine eigene. Ohne sie zeigte der
   * Vergleich die Ersparnis eines Speichers, von dem derselbe Report abrät.
   *
   * ⚠ DER BESTAND HAT VORRANG. Er ist der Speicher, den der Kunde tatsächlich fährt; die
   * Katalog-Reihe daneben beantwortete eine Frage, die sich für ihn nicht stellt. Beides zugleich
   * kann es heute nicht geben (ohne Bestandsanlage ist `existing` undefined) — die Reihenfolge
   * steht trotzdem im Code und nicht nur in diesem Absatz.
   */
  const recommendedDispatchKw =
    perBattery[0] && perBattery[0].netSavingOverHorizon > 0 ? recommendedGridAfterKw : undefined
  const comparisonDispatchKw = existing?.gridAfterKw ?? recommendedDispatchKw

  /*
   * ── ⚠ K3b-2: DER VERGLEICH OHNE DRITTE REIHE — UND WANN ER ENTSTEHT ─────────────────────────
   * Ohne Dispatch gab es bis hierher GAR KEINEN Vergleich („kein Teilzustand", s. oben). Das ist
   * richtig, solange es Kandidaten gibt: dann sagt das Fehlen der dritten Reihe „von diesem
   * Speicher raten wir ab", und zwei von drei Reihen zeigten eine Auswahl, die es nicht gibt.
   *
   * Mit leerem KATALOG ist die Lage eine andere: es gibt keinen Speicher, über den etwas zu sagen
   * wäre — die Frage „was kostet mich Strom heute, und was bei aWATTar" steht davon unberührt, und
   * sie unbeantwortet zu lassen verschwiege eine Zahl, die vollständig belegt ist.
   *
   * ⚠ DIE BEDINGUNG IST `perBattery.length === 0` UND NICHT `!comparisonDispatchKw`. Der
   * Unterschied ist genau der Fall „es rechnet sich keiner" (voller Katalog, kein Dispatch) — der
   * bleibt unverändert ohne Vergleich. Ein Bestandsspeicher hat ausserdem Vorrang und trägt die
   * dritte Reihe auch bei leerem Katalog (`existing?.gridAfterKw` steht davor).
   */
  const noCandidates = perBattery.length === 0
  const monthlyComparison =
    baseTariffOptimization?.computable === true &&
    payload.tariffPricing &&
    (comparisonDispatchKw || noCandidates)
      ? buildMonthlyTariffComparison(
          loadProfile,
          payload.tariff,
          payload.tariffPricing,
          comparisonDispatchKw,
        )
      : undefined
  /*
   * ── D7-REVISION WEG 4: DIE VORAUSSCHAUENDE LADESTEUERUNG ─────────────────────────────────────
   * Derselbe Fahrplan wie die dritte Reihe, aber geplant mit der Verbrauchserwartung des Vorabends
   * (`computePredictiveControlValue`, Weg a). Gerechnet wird für DENSELBEN Speicher, dessen
   * Dispatch schon die dritte Reihe trägt — sonst verglichen die beiden Reihen zwei Geräte.
   *
   * ⚠ Nur, wenn es die dritte Reihe überhaupt gibt: ohne sie gäbe es nichts, wogegen Weg 4 stünde.
   * Ein Blocker (synthetischer Lastgang, keine echte Preiskurve, kein Muster) lässt die Reihe
   * ENTFALLEN — der Report zeigt dann die einfache Ladesteuerung und sagt das auch.
   */
  const comparisonBattery = existing?.analysis.entry.battery ?? perBattery[0]?.battery
  const predictive =
    monthlyComparison && payload.tariffPricing && comparisonDispatchKw && comparisonBattery
      ? computePredictiveControlValue({
          loadProfile,
          battery: comparisonBattery,
          tariffParams: payload.tariff,
          pricing: payload.tariffPricing,
        })
      : undefined

  const tariffOptimization: TariffOptimizationStatus | undefined = monthlyComparison
    ? {
        computable: true,
        monthlyComparison:
          predictive?.ok === true
            ? { ...monthlyComparison, spotWithPredictiveControlEur: predictive.predictiveMonthlyEur }
            : monthlyComparison,
      }
    : baseTariffOptimization

  return {
    current:
      eagGrundpreisCostPerYear === undefined
        ? current
        : { ...current, eagGrundpreisCostPerYear },
    peaks,
    perBattery,
    recommendation,
    // K3b-2: gesetzt GENAU DANN, wenn es keine Empfehlung gibt — sonst fehlt das Feld ganz.
    ...(recommendation ? {} : { noRecommendationReason: 'no_candidates' as const }),
    assumptions: {
      // Reiner Anzeigewert, kein Rechenkern-Input: der Wirkungsgrad des Geräts, mit dem die Analyse
      // rechnet — Empfehlung, sonst Bestandsspeicher, sonst `null` (kein Ersatzwert).
      roundTripEfficiency:
        perBattery.find((p) => p.battery.id === recommendation?.batteryId)?.battery
          .roundTripEfficiency ??
        existing?.analysis.entry.battery.roundTripEfficiency ??
        null,
      horizonYears,
      billingModel: payload.tariff.billingModel,
      energyPriceCtPerKwh: payload.tariff.energyPriceCtPerKwh,
      einspeiseverguetungCtPerKwh: payload.tariff.einspeiseverguetungCtPerKwh,
    },
    tariffOptimization,
    existingBatteryAnalysis: existing?.analysis,
    dataQuality: pvWarnings.length
      ? {
          ...payload.load.dataQuality,
          warnings: [...payload.load.dataQuality.warnings, ...pvWarnings],
        }
      : payload.load.dataQuality,
  }
}
