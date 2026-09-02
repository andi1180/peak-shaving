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
   * Eigenverbrauchs-Ersparnis: aus PV geladene, später selbst verbrauchte kWh × (Preis des
   * ENTLADE-Intervalls − Einspeisevergütung ÷ Ladewirkungsgrad) — auf ein Jahr hochgerechnet
   * (`× annualizationFactor`, s. `annualization.ts`). Der Ladeverlust steckt seit Delta 19 in der
   * Kosten-Seite (§3.7); der Entladepreis kommt seit §3.7.2 aus derselben Intervallreihe wie bei
   * der Lastverschiebung und nicht mehr aus dem Fixtarif des Kunden.
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
   * ENTHALTEN (§3.7, Delta 19). Für BEIDE Herkünfte massgeblich: 'grid' trägt den Preis ihres
   * Ladeintervalls, 'pv' die entgangene Einspeisevergütung (zeitunabhängig, aber aus demselben
   * Grund hier und nicht als profilweite Konstante daneben). Der NUTZEN einer Entnahme ist in
   * beiden Fällen der Preis ihres ENTLADE-Intervalls, gelesen aus derselben Reihe
   * (§3.7.2 Preisbasis-Vereinheitlichung — s. Entlade-Zweig unten).
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
 *     in genau EINEN Topf: 'pv' → Eigenverbrauch, 'grid' → Lastverschiebung. Der WERT ist in beiden
 *     Fällen derselbe Ausdruck (Entladepreis − Einstandspreis, ≥ 0), s. den Absatz zur Preisbasis.
 * Weil Peak-Entladung keine kWh in einen Energie-Topf legt und jede Eigenverbrauchs-kWh ihrer
 * Herkunft folgt, ist keine kWh doppelt gezählt → Summe = total (Prinzip 2).
 *
 * ── Der Ladeverlust auf der KOSTEN-Seite (Delta 19, §3.7) ───────────────────────────────────────
 * Jede Schicht trägt, was sie je EINGESPEICHERTER kWh gekostet hat — also den Preis der `1/η` kWh,
 * die für sie bezogen (bzw. der Einspeisung entzogen) wurden. Die eingespeicherte Menge bleibt
 * dabei unverändert die des Fahrplans; geändert hat sich allein ihr Preis. Beide Energie-Töpfe
 * fallen dadurch, der Leistungspreis-Anteil nicht (er ist ratenbasiert und kennt keine kWh).
 *
 * ── EINE PREISBASIS FÜR BEIDE ENERGIE-TÖPFE (§3.7.2) ───────────────────────────────────────────
 * Der Nutzen JEDER entnommenen kWh ist der Preis des Intervalls, in dem sie entnommen wird — das
 * hängt an der Entnahme, nicht an der Herkunft. Beide Töpfe lesen dafür dieselbe Reihe
 * (`intervalTariffRates`), und zwar bedingungslos: ohne Tarifoptimierungs-Hebel sind das die
 * Fenster-/Standardpreise, mit Hebel die kombinierten Marktpreise (Delta 4). Die Herkunft
 * entscheidet nur noch über den EINSTANDSPREIS und über den Topf, nicht mehr über die Preiswelt.
 *
 * Zuvor hing der Eigenverbrauch an `tariffParams.energyPriceCtPerKwh` — dem heutigen Fixtarif des
 * Kunden —, während die Lastverschiebung längst über die Reihe lief. Bei aktivem Hebel addierte
 * `totalSavingPerYear` damit zwei Töpfe aus ZWEI VERSCHIEDENEN TARIFWELTEN und trug das über
 * `calculateRoi` in Amortisation und Netto-Ersparnis weiter. Am echten Kundenfall gemessen
 * (209 Tage, 19,2 kWh/10,6 kW/η 0,9, Arbeitspreis 9,5 ct, 10,2 kWp geschätzte PV): 881,3 kWh
 * PV-Entladung, in der Attribution mit 9,50 ct/kWh bewertet, in der Kassen-Rechnung des
 * Monatsvergleichs mit 21,69 ct/kWh — rund 107 € zu niedrig über den Zeitraum.
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
   * ⚠ Diese Reihe ist seit §3.7.2 die EINZIGE Preisquelle der Bewertung — für die Lastverschiebung
   * UND für den Eigenverbrauch. Sie wird bedingungslos gelesen; ein `pricing`-Branch wäre die
   * falsche Antwort gewesen, weil es hier nur EINE Reihe gibt und sie ohne Hebel bereits genau die
   * Preise trägt, mit denen vorher gerechnet wurde.
   *
   * Ist der Hebel angefordert, aber nicht berechenbar, liefert `intervalTariffRates` bewusst
   * durchgehend den Standardpreis: jede Netz-Schicht wurde dann zu demselben Preis geladen, zu dem
   * sie entladen wird, die Lastverschiebung bleibt 0, und der Eigenverbrauch wird mit genau dem
   * Arbeitspreis bewertet, mit dem er auch ohne Hebel bewertet würde.
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
   * ⚠ HIER STAND EINE PROFILWEITE EIGENVERBRAUCHS-RATE — sie ist ersatzlos entfallen (§3.7.2).
   * `max(0, energyPriceCtPerKwh − einspeise/η)` bewertete jede PV-kWh mit dem Fixtarif des Kunden,
   * gleichgültig WANN sie entnommen wurde. Das war schon ohne Hebel ungenau (eine im günstigen
   * Nachtfenster entnommene kWh vermeidet den günstigen Preis, nicht den Tagespreis) und mit
   * aktivem Hebel schlicht die falsche Tarifwelt. Der Wert einer Entnahme hängt am
   * ENTLADE-Intervall und wird deshalb dort gebildet, wo dieses Intervall bekannt ist.
   */

  /*
   * FIFO-Warteschlange. Der Start-SoC (§3.6.1, 50 % [ANNAHME]) trägt keine Herkunft → als neutrale
   * 'grid'-Schicht geführt: er soll den FIFO-Unterlauf verhindern und sonst nichts.
   *
   * ⚠ SEIN EINSTANDSPREIS BLEIBT `std`, AUSDRÜCKLICH AUCH BEI AKTIVEM HEBEL — entschieden, nicht
   * übersehen (§3.7.2). Diese Energie stammt aus der Zeit VOR dem Beobachtungsfenster; es gibt
   * keinen beobachteten Ladezeitpunkt, dem sich ein Slot-Preis zuordnen liesse. `rateCtPerKwh[0]`
   * wäre eine ebenso geratene Zahl, nur mit falscher Präzision: der Marktpreis der ersten
   * Viertelstunde des Lastgangs hat mit dieser Energie nichts zu tun. `std` ist dabei die
   * konservative und nicht die bequeme Wahl (Pessimismus-Prinzip) — ein hoch angesetzter Einstand
   * lässt die Lastverschiebung dieser einen Schicht eher zu klein als zu gross ausfallen.
   *
   * Restposten, gemessen und benannt: am echten Kundenfall trägt sie rund 1 € über den Zeitraum.
   * Sie ist der einzige Ort in dieser Funktion, an dem noch der Fixtarif steht.
   */
  const layers: EnergyLayer[] = []
  if (sim.startSocKwh > EPS) {
    layers.push({ kwh: sim.startSocKwh, origin: 'grid', costCtPerStoredKwh: std * chargeLossFactor })
  }

  let pvCtKwh = 0 // Σ kWh × (Entladepreis − Einspeisevergütung/η) in ct·kWh, am Ende /100 → €
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
        /*
         * DIESELBE FORMEL FÜR BEIDE TÖPFE (§3.7.2): Nutzen der entnommenen kWh — der Preis ihres
         * ENTLADE-Intervalls — minus ihrem Einstandspreis inklusive Ladeverlust. Verschieden ist
         * allein, was sie gekostet hat (PV: entgangene Einspeisevergütung · Netz: Ladepreis) und in
         * welchen Topf sie fällt.
         *
         * `max(0, …)` für beide: bei einem Entladepreis unter dem Einstand ist Zwischenspeichern
         * ein Verlustgeschäft, und ein negativer Beitrag wäre eine Ersparnis mit falschem
         * Vorzeichen — der Dispatch entscheidet nicht preisbasiert (§3.6 Schritt 3). Der Clamp
         * greift dadurch JE INTERVALL statt einmal profilweit: eine Stunde, in der der kombinierte
         * Preis unter der Einspeisevergütung liegt, trägt 0 bei, statt den Topf zu mindern.
         */
        const value = take * Math.max(0, dischargeCt - layer.costCtPerStoredKwh)
        if (layer.origin === 'pv') {
          pvCtKwh += value
        } else {
          // 'grid' → Lastverschiebung: der Aufschlag (teuer jetzt − günstig beim Laden INKLUSIVE
          // Ladeverlust). Der Verlust kann eine Verschiebung ganz aufzehren: bei η = 0,9 lohnt sich
          // 15 → 16 ct nicht mehr, und das ist die Wahrheit, nicht ein Rundungsfehler.
          loadShiftCtKwh += value
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
  const selfConsumptionSavingOverCoveredPeriod = pvCtKwh / 100
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
     * B22 — der Satz nennt AUSDRÜCKLICH beide Hälften: was geschätzt ist (die Erzeugung) und was
     * dadurch nicht mehr beurteilbar ist (die Spitze). „Die PV ist geschätzt" allein liesse offen,
     * warum daraus eine ganze Ersparnis-Dimension entfällt — und genau das ist die Information, die
     * ein Kunde braucht, um zu entscheiden, ob er sich den echten Lastgang besorgt.
     */
    if (blockers.includes('estimated_pv')) {
      warnings.push(
        'Geschätzte PV-Erzeugung: die Erzeugungskurve stammt nicht aus Ihrer Anlage, sondern aus ' +
          'einem Zehn-Jahres-Mittel des EU-Dienstes PVGIS für Ihren Standort und Ihre Auslegung. ' +
          'Sie wurde vom Verbrauch abgezogen — damit ist jede Lastspitze dieses Lastgangs zur ' +
          'Hälfte eine Schätzung, und die Spitzenkappung wird deshalb nicht gerechnet und nicht ' +
          'kreditiert. Eigenverbrauch und Lastverschiebung bleiben aussagekräftig, sind aber ' +
          'ebenfalls eine Schätzung. Für die Leistungspreis-Dimension bitte einen Lastgang mit ' +
          'gemessener Einspeisung hochladen.',
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
