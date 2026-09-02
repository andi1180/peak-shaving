import type { BatteryCandidate, LoadProfile, TariffParams, TariffPricingInputs } from 'shared'

import {
  capForIntervalSeries,
  drawSeries,
  intervalHours,
  periodIndexByInterval,
} from '../simulation/helpers'
import { peakShavingBlockers } from '../simulation/peak-shaving'
import { simulateBattery, type BatterySimulationResult } from '../simulation/simulate'
import { intervalTariffRates } from '../simulation/tou'
import { getTariffStrategy } from '../tariff/strategy'
import { annualizationFactor, coveredDaysOf } from './annualization'

/**
 * Kombinierter Dispatch → benannte Ersparnis-Felder (§3.7). EIN Simulationslauf (§3.6), aus dem alle
 * drei Ersparnis-Anteile durch reine BUCHHALTUNG über den erzeugten Fahrplan gewonnen werden — kein
 * zweiter Dispatch (Prinzip 2: „Ein Dispatch, eine ehrliche Zahl"). Die Anteile sind DISJUNKT: jede
 * geladene bzw. entladene kWh landet in genau einem Topf (s. Herkunfts-Tag-Regel unten), also gilt
 * `totalSavingPerYear === leistungspreis + selfConsumption + loadShift` exakt (per Konstruktion getestet).
 */
export type BatterySavings = {
  /** ABGERECHNETER kW-Wert, wie er im Report ausgewiesen wird (bei `static` = alter Wert, s. controlType). */
  newBilledKw: number
  /** Leistungspreis-Ersparnis = (alter − neuer billedKw) × Leistungspreis. `static` → 0 (nicht kreditiert). */
  leistungspreisSavingPerYear: number
  /**
   * Eigenverbrauchs-Ersparnis: aus PV geladene, später selbst verbrauchte kWh × (Arbeitspreis −
   * Einspeisevergütung ÷ Ladewirkungsgrad) — auf ein Jahr hochgerechnet (`× annualizationFactor`,
   * s. `annualization.ts`). Der Ladeverlust steckt seit Delta 19 in der Kosten-Seite (§3.7).
   */
  selfConsumptionSavingPerYear: number
  /**
   * Lastverschiebungs-Ersparnis: im günstigen Fenster geladene, im teuren Fenster genutzte kWh ×
   * (teuer − günstig ÷ Ladewirkungsgrad). 0 ohne Tarif-Fenster — ebenfalls auf ein Jahr
   * hochgerechnet. Der Ladeverlust steckt seit Delta 19 in der Kosten-Seite (§3.7).
   */
  loadShiftSavingPerYear: number
  /** Der GEMESSENE Eigenverbrauchs-Wert über den tatsächlich abgedeckten Zeitraum (nicht hochgerechnet). */
  selfConsumptionSavingOverCoveredPeriod: number
  /** Der GEMESSENE Lastverschiebungs-Wert über den tatsächlich abgedeckten Zeitraum (nicht hochgerechnet). */
  loadShiftSavingOverCoveredPeriod: number
  /** `365 / coveredDays` bei einem echten Teilzeitraum-Lastgang, sonst exakt `1` (s. `annualizationFactor`). */
  annualizationFactor: number
  /** Abgedeckte Tage des Lastgangs — die Bezugsgrösse des Faktors, damit der Report sie benennen kann. */
  coveredDays: number
  /** Summe der drei Anteile aus DEMSELBEN Fahrplan. */
  totalSavingPerYear: number
  /** Contract-Warnungen (z.B. static-Steuerung: Spitzenkappung nicht kreditiert). */
  warnings: string[]
}

/** Herkunft einer im Speicher liegenden kWh-Schicht — bestimmt, in welchen Ersparnis-Topf ihre Nutzung fällt. */
type EnergyLayer = {
  /** Verbleibende Energie dieser Schicht (kWh, auf SoC-Ebene — nach Ladewirkungsgrad). */
  kwh: number
  /** 'pv' = aus Einspeisung/PV-Überschuss geladen; 'grid' = aus dem Netz geladen. */
  origin: 'pv' | 'grid'
  /**
   * Was diese Schicht je EINGESPEICHERTER kWh gekostet hat (ct) — der LADEVERLUST IST DARIN
   * ENTHALTEN (§3.7, Delta 19). Nur für 'grid' benutzt; die PV-Seite bewertet über eine eigene,
   * profilweite Rate (s. `pvSelfConsumptionCtPerKwh`), weil ihr Preis nicht am Ladeintervall hängt.
   */
  costCtPerStoredKwh: number
}

const EPS = 1e-9

/**
 * Rechnet die §3.6-Simulation eines Kandidaten in die benannten Ersparnis-Felder des
 * `AnalysisResult.perBattery`-Contracts um (§3.7). Optional kann ein bereits gerechnetes
 * `BatterySimulationResult` übergeben werden (spart den Doppellauf, wenn der Aufrufer die Physik
 * ohnehin schon hat) — sonst wird es hier via `simulateBattery` erzeugt.
 *
 * ── Attribution ohne Doppelzählung ──────────────────────────────────────────────────────────────
 * Ein einziger Buchhaltungs-Durchlauf über den Fahrplan (`dispatch`) führt eine FIFO-Warteschlange
 * herkunftsmarkierter Energieschichten mit (§3.7-Zuordnungsregel „Herkunfts-Tag pro geladener kWh"):
 *   • Laden bei `draw < 0`  → 'pv'-Schicht   (Schritt 3, PV-Überschuss).
 *   • Laden bei `draw ≥ 0`  → 'grid'-Schicht (Schritt 5), mit dem Arbeitspreis des Ladeintervalls.
 *   • Entladen bei `draw > cap` → SPITZENKAPPUNG: verbraucht FIFO-Schichten, erzeugt aber KEINEN
 *     Energie-Topf — dieser Anteil steckt vollständig in `leistungspreisSaving` (via billedKw).
 *   • Entladen bei `draw ≤ cap` → EIGENVERBRAUCH: die entnommenen Schichten fließen je nach Herkunft
 *     in genau EINEN Topf: 'pv' → Eigenverbrauch, 'grid' → Lastverschiebung (Wert = teuer − günstig).
 * Weil Peak-Entladung keine kWh in einen Energie-Topf legt und jede Eigenverbrauchs-kWh ihrer
 * Herkunft folgt, ist keine kWh doppelt gezählt → Summe = total (Prinzip 2).
 *
 * ── Der Ladeverlust auf der KOSTEN-Seite (Delta 19, §3.7) ───────────────────────────────────────
 * Jede Schicht trägt, was sie je EINGESPEICHERTER kWh gekostet hat — also den Preis der `1/η` kWh,
 * die für sie bezogen (bzw. der Einspeisung entzogen) wurden. Die eingespeicherte Menge bleibt
 * dabei unverändert die des Fahrplans; geändert hat sich allein ihr Preis. Beide Energie-Töpfe
 * fallen dadurch, der Leistungspreis-Anteil nicht (er ist ratenbasiert und kennt keine kWh).
 *
 * ⚠ Die für die SPITZENKAPPUNG geladene Energie bleibt weiterhin unbepreist — sie legt keine kWh
 * in einen Topf, weder auf der Nutzen- noch auf der Kostenseite. Das ist unverändert und
 * ausdrücklich kein Nebeneffekt dieser Änderung: der Wert der Spitzenkappung ist der Leistungspreis,
 * nicht eine Preisdifferenz, und ein Kostenposten allein auf dieser Seite ergäbe einen vierten
 * (negativen) Topf, den §3.7 nicht kennt.
 */
export function computeBatterySavings(
  loadProfile: LoadProfile,
  battery: BatteryCandidate,
  tariffParams: TariffParams,
  precomputed?: BatterySimulationResult,
  pricing?: TariffPricingInputs,
): BatterySavings {
  const sim = precomputed ?? simulateBattery(loadProfile, battery, tariffParams, undefined, pricing)

  const strategy = getTariffStrategy(tariffParams.billingModel)
  const oldBilledKw = strategy.billedKw(loadProfile, tariffParams)

  const draws = drawSeries(loadProfile)
  const deltaH = intervalHours(loadProfile)
  const eta = battery.roundTripEfficiency
  const periodOfInterval = periodIndexByInterval(loadProfile, tariffParams.billingModel)
  const capForInterval = capForIntervalSeries(sim.capKwByPeriod, periodOfInterval)
  /*
   * Delta 4 (B21-3b): mit `pricing` sind das die KOMBINIERTEN Preise (Marktpreis + Netzentgelt),
   * sonst wie bisher die Fenster-/Standardpreise. Die Buchhaltung darunter ist unverändert — genau
   * das ist die Entscheidung aus Delta 4: das Netzentgelt bekommt KEINEN vierten Ersparnis-Topf,
   * sondern geht in dieselbe Eigenverbrauchs-/Lastverschiebungs-Rechnung ein, die es schon gibt
   * (Prinzip 2, Doppelzählungsrisiko).
   *
   * Ist der Hebel angefordert, aber nicht berechenbar, liefert `intervalTariffRates` bewusst
   * durchgehend den Standardpreis: `dischargeCt - layer.chargeCt` ist dann überall 0, die
   * Lastverschiebung bleibt 0, und der Eigenverbrauch (der ohnehin an `energyPriceCtPerKwh` hängt,
   * nicht an dieser Reihe) ist unberührt.
   */
  const { rateCtPerKwh } = intervalTariffRates(loadProfile, tariffParams, pricing)

  const std = tariffParams.energyPriceCtPerKwh
  const einspeise = tariffParams.einspeiseverguetungCtPerKwh

  /*
   * ── ⚠ DER LADEVERLUST IST EINE KOSTE, NICHT NUR EIN SoC-EFFEKT (Delta 19, §3.7) ───────────────
   * Um EINE kWh einzuspeichern, müssen `1/η` kWh bezogen (bzw. dem Einspeiseerlös entzogen) werden
   * — der Dispatch bildet das physikalisch längst ab (`soc += P·Δ·η`). Bis Delta 19 fehlte die
   * andere Hälfte: die BEWERTUNG lief über den Preis je BEZOGENER kWh, angewandt auf die
   * eingespeicherte Menge. Damit war jede gespeicherte kWh bezahlt, als hätte sie keine Verluste
   * verursacht, und beide Energie-Töpfe waren systematisch zu hoch.
   *
   * Der Faktor korrigiert ausschliesslich die KOSTEN-Seite. Die eingespeicherte und die entnommene
   * Menge bleiben unangetastet (sie sind Physik und stehen im Fahrplan); der Nutzen einer
   * entnommenen kWh bleibt ebenfalls unangetastet (sie ersetzt genau eine bezogene kWh).
   *
   * `roundTripEfficiency` ist im Schema `> 0` (`packages/shared/src/battery.ts`) — die Prüfung
   * steht trotzdem da: sie kostet nichts, und ein `Infinity` an dieser Stelle vergiftete lautlos
   * jede Zahl, die daraus entsteht.
   */
  const chargeLossFactor = eta > 0 ? 1 / eta : 1

  /*
   * Eigenverbrauchs-Wert einer PV-kWh: vermeidet Bezug zum Arbeitspreis, verzichtet dafür auf die
   * Einspeisung der `1/η` kWh, die für sie ins Gerät mussten. Vor Delta 19 stand hier
   * `std - einspeise` — dieselbe Auslassung wie auf der Netz-Seite, nur mit dem Einspeiseerlös als
   * entgangenem Preis. `max(0, …)`: bei einer Einspeisevergütung über dem Arbeitspreis ist
   * Zwischenspeichern ein Verlustgeschäft, und ein negativer Topf wäre eine Ersparnis mit
   * falschem Vorzeichen (der Dispatch entscheidet nicht preisbasiert, s. §3.6 Schritt 3).
   */
  const pvSelfConsumptionCtPerKwh = Math.max(0, std - einspeise * chargeLossFactor)

  // FIFO-Warteschlange. Der Start-SoC (§3.6.1, 50 % [ANNAHME]) trägt keine Herkunft → als neutrale
  // 'grid'-Schicht zum Standardpreis geführt: erzeugt keine Lastverschiebungs-Ersparnis (ihre Kosten
  // liegen mit dem Ladeverlust sogar über jedem realen Entladepreis derselben Preisstufe) und
  // verhindert nur den FIFO-Unterlauf.
  const layers: EnergyLayer[] = []
  if (sim.startSocKwh > EPS) {
    layers.push({ kwh: sim.startSocKwh, origin: 'grid', costCtPerStoredKwh: std * chargeLossFactor })
  }

  let pvSelfConsumedKwh = 0
  let loadShiftCtKwh = 0 // Σ kWh × (teuer − günstig) in ct·kWh, am Ende /100 → €

  const batteryPowerKw = sim.dispatch.batteryPowerKw
  for (let i = 0; i < draws.length; i++) {
    const bk = batteryPowerKw[i] ?? 0
    const draw = draws[i] ?? 0
    const cap = capForInterval[i] ?? Infinity

    if (bk > EPS) {
      // Laden — Herkunft aus dem Vorzeichen der Ausgangslast (deckt sich mit dem Dispatch-Branch).
      const storedKwh = bk * deltaH * eta // exakt wie der Dispatch (soc += P·Δ·η)
      // Bezogen wurden `bk * deltaH` kWh — gespeichert davon `storedKwh`. Der Preis wird deshalb
      // auf die BEZOGENE Menge angewandt und auf die gespeicherte umgelegt (× 1/η, s. o.).
      if (draw < 0) {
        layers.push({ kwh: storedKwh, origin: 'pv', costCtPerStoredKwh: einspeise * chargeLossFactor })
      } else {
        layers.push({
          kwh: storedKwh,
          origin: 'grid',
          costCtPerStoredKwh: (rateCtPerKwh[i] ?? std) * chargeLossFactor,
        })
      }
    } else if (bk < -EPS) {
      // Entladen — FIFO entnehmen und je nach Zweck/Herkunft zuordnen.
      let remaining = -bk * deltaH // Lieferung 1:1 aus dem SoC (soc -= P·Δ)
      const isPeak = draw > cap
      const dischargeCt = rateCtPerKwh[i] ?? std
      while (remaining > EPS && layers.length > 0) {
        const layer = layers[0]!
        const take = Math.min(remaining, layer.kwh)
        layer.kwh -= take
        remaining -= take
        if (layer.kwh <= EPS) layers.shift()

        if (isPeak) continue // Spitzenkappung → steckt in leistungspreisSaving, kein Energie-Topf.
        if (layer.origin === 'pv') {
          pvSelfConsumedKwh += take
        } else {
          // 'grid': Lastverschiebung = nur der Aufschlag (teuer jetzt − günstig beim Laden INKLUSIVE
          // Ladeverlust), ≥ 0. Der Verlust kann eine Verschiebung damit auch ganz aufzehren: bei
          // η = 0,9 lohnt sich 15 → 16 ct nicht mehr, und das ist die Wahrheit, nicht ein Rundungsfehler.
          loadShiftCtKwh += take * Math.max(0, dischargeCt - layer.costCtPerStoredKwh)
        }
      }
    }
  }

  /*
   * ── JAHRES-HOCHRECHNUNG DER BEIDEN ENERGIE-TÖPFE ───────────────────────────────────────────────
   * Was hier steht, ist eine SUMME über die vorhandenen Intervalle — bei einem 209-Tage-Lastgang
   * also die Ersparnis über 209 Tage. Der Leistungspreis-Anteil unten ist dagegen ratenbasiert
   * (€/kW·Jahr) und damit bereits eine Jahresgrösse. Beide in dieselbe `totalSavingPerYear` zu
   * addieren und daraus Amortisation und Netto-Ersparnis über den Horizont zu bilden, hiesse,
   * ungleichartige Grössen wie gleichartige zu behandeln. Der Faktor macht sie gleichartig; die
   * gemessenen Rohwerte bleiben daneben stehen und werden im Report ausgewiesen (Prinzip 5).
   *
   * ⚠ Der Faktor betrifft AUSSCHLIESSLICH diese beiden Zeilen. `leistungspreisSavingPerYear`,
   * `newBilledKw` und alles in `roi.ts` bleiben unangetastet — dort wäre er eine Doppelung.
   */
  const selfConsumptionSavingOverCoveredPeriod = (pvSelfConsumedKwh * pvSelfConsumptionCtPerKwh) / 100
  const loadShiftSavingOverCoveredPeriod = loadShiftCtKwh / 100
  const factor = annualizationFactor(loadProfile)
  const selfConsumptionSavingPerYear = selfConsumptionSavingOverCoveredPeriod * factor
  const loadShiftSavingPerYear = loadShiftSavingOverCoveredPeriod * factor

  // ── Zuschreibung der Spitzenkappung (§3.6/§3.7; Martins Semantik OP#5, Delta 3/8) ───────────────
  // controlType ist eine Frage der STEUERUNGS-Konfiguration, nicht der Batteriezelle.
  //  • 'dynamic' → Spitzenkappung: voller Leistungspreis-Anteil kreditiert (newBilledKw = gekappt).
  //  • 'static'  → NUR Eigenverbrauch/Lastverschiebung, KEINE Spitzenkappung: `leistungspreisSaving = 0`
  //    und newBilledKw = alter (ungekappter) Wert. Der zugrunde liegende Fahrplan ist bereits
  //    reserve-frei simuliert (`simulateBattery`, cap = ∞ / socFloor ≡ 0 für static) → Eigenverbrauch
  //    nutzt die volle Kapazität. Die drei Ersparnis-Töpfe oben stammen aus GENAU diesem Fahrplan, die
  //    Nicht-Doppelzählung (Summe = total) gilt für static unverändert.
  //  • Delta 8 (9b-1): derselbe Zweig gilt für ein SYNTHETISCHES Standardlastprofil, auch bei einer
  //    'dynamic'-Batterie und auch bei einem Leistungspreis > 0. Ohne diese Zurücknahme entstünde
  //    aus dem reserve-freien Fahrplan eine Differenz zum ungekappten `billedKw` — mal positiv, mal
  //    negativ — und die würde als Spitzenkappungs-Ersparnis auf eine erfundene Spitze kreditiert.
  //  • Delta 3 (erste Anwendung): ebenso bei einem Tarif OHNE Leistungspreis. Rechnerisch ändert der
  //    Zweig hier nichts (der `else`-Ausdruck ergäbe × 0 = 0); seine Wirkung liegt in der
  //    SIMULATION, die dadurch reserve-frei läuft — und genau deshalb MUSS die Zuschreibung
  //    denselben Zweig nehmen: derselbe reserve-freie Fahrplan verschiebt `sim.newBilledKw`
  //    gegenüber dem ungekappten Wert, und `newBilledKw` ist eine ausgewiesene Report-Zahl, keine
  //    blosse Zwischengrösse. Sie dürfte nicht behaupten, die Batterie senke den abgerechneten
  //    Leistungswert, wenn gar nicht gekappt wurde.
  //    Die Bedingung selbst steht in `peakShavingBlockers`, damit Simulation und Zuschreibung
  //    nicht getrennt voneinander entscheiden können.
  const warnings: string[] = []
  let newBilledKw: number
  let leistungspreisSavingPerYear: number
  const blockers = peakShavingBlockers(loadProfile, battery, tariffParams)
  if (blockers.length > 0) {
    newBilledKw = oldBilledKw
    leistungspreisSavingPerYear = 0
    /*
     * Je Grund ein eigener Satz, und alle zutreffenden nebeneinander: „statische Steuerung" erklärt
     * einem Kunden mit synthetischem Lastgang nicht, warum auch die dynamische Batterie daneben
     * nichts kappt — und umgekehrt. Ein gemeinsamer, allgemeiner Satz („keine Spitzenkappung")
     * verlöre genau die Information, die den Unterschied ausmacht: der eine Grund ist mit anderer
     * Hardware behebbar, der zweite mit einem echten Lastgang, der dritte gar nicht — dort ist
     * nichts zu beheben, weil nichts fehlt.
     */
    if (blockers.includes('static_control')) {
      warnings.push(
        'Statische Steuerung: nur Eigenverbrauch/Lastverschiebung, keine Spitzenkappung — der ' +
          'Leistungspreis-Anteil wird nicht kreditiert. Mit zusätzlicher Steuerungshardware ' +
          '(z. B. Smartfox/iHome Manager) auf Peak-Shaving aufrüstbar; die Kostenmodellierung dieser ' +
          'Aufrüstung ist offen bis zum realen Katalog (OP#2).',
      )
    }
    if (blockers.includes('standard_profile')) {
      warnings.push(
        'Synthetisches Standardlastprofil: die Spitzenkappung wird nicht gerechnet und nicht ' +
          'kreditiert — ein Durchschnittsprofil trägt keine individuelle Lastspitze, und eine ' +
          'daraus geschätzte Leistungspreis-Ersparnis wäre eine erfundene Zahl. Für diese ' +
          'Dimension bitte einen echten Lastgang hochladen.',
      )
    }
    /*
     * Anders als die beiden Gründe darüber benennt dieser KEINEN Mangel: es fehlt weder Hardware
     * noch ein Messwert, der Tarif hat den Posten schlicht nicht. Der Satz sagt deshalb, dass das
     * Ergebnis vollständig ist, statt zu einer Nachbesserung aufzufordern — und er erklärt die 0 in
     * der Ersparnis-Aufschlüsselung, die sonst wie ein Rechenfehler aussähe. Zugleich ist er der
     * Hinweis darauf, dass die volle Kapazität dem Eigenverbrauch zugutekommt.
     */
    if (blockers.includes('no_demand_charge')) {
      warnings.push(
        'Tarif ohne Leistungspreis: es gibt keinen Leistungspreis-Anteil, der sich kappen liesse — ' +
          'die Spitzenkappung wird deshalb nicht gerechnet und nicht kreditiert. Das ist kein ' +
          'fehlender Wert, sondern eine Eigenschaft Ihrer Abrechnung; die volle Batteriekapazität ' +
          'steht dafür dem Eigenverbrauch und der Lastverschiebung zur Verfügung.',
      )
    }
  } else {
    newBilledKw = sim.newBilledKw
    leistungspreisSavingPerYear = (oldBilledKw - newBilledKw) * tariffParams.leistungspreisEurPerKwYear
  }

  const totalSavingPerYear =
    leistungspreisSavingPerYear + selfConsumptionSavingPerYear + loadShiftSavingPerYear

  return {
    newBilledKw,
    leistungspreisSavingPerYear,
    selfConsumptionSavingPerYear,
    loadShiftSavingPerYear,
    selfConsumptionSavingOverCoveredPeriod,
    loadShiftSavingOverCoveredPeriod,
    annualizationFactor: factor,
    coveredDays: coveredDaysOf(loadProfile),
    totalSavingPerYear,
    warnings,
  }
}
