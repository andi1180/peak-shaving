import type { LoadProfile } from 'shared'

import { utcMsToLocalFields } from '../parser/datetime'
import { type BatteryPhysics } from './helpers'

/**
 * Tages-Rangfolge für Laden und Entladen (§3.6 Schritt 5, Produktentscheidung 02.09.2026).
 *
 * ── DAS PROBLEM, DAS DIESES MODUL LÖST ─────────────────────────────────────────────────────────
 * Die Preisschwelle aus Delta 4 (seit 02.09.2026 gegen das TAGES-Mittel, s. `tou.ts`) beantwortet
 * die Frage „ist diese Stunde überhaupt günstig?" — nicht die Frage „ist sie das Günstigste, was
 * heute noch kommt?". Der Dispatch läuft chronologisch und greedy: er füllt die Batterie in den
 * ERSTEN unterdurchschnittlichen Stunden des Tages und steht danach voll da, auch wenn drei Stunden
 * später die eigentlich billigste Stunde folgt. Spiegelbildlich entlädt Schritt 4 (Eigenverbrauch)
 * bei der ERSTEN Gelegenheit und hat in der teuersten Stunde des Tages womöglich nichts mehr übrig.
 *
 * Bei zwei Preisstufen (HT/NT) ist das unerheblich — dort sind alle Nachtstunden gleich billig. Bei
 * 8.760 echt verschiedenen Stundenpreisen ist es der Unterschied zwischen „irgendwann billig
 * geladen" und „am billigsten geladen".
 *
 * ── DIE REGEL, IN EINEM SATZ ───────────────────────────────────────────────────────────────────
 * Gib eine Ressource — freie Kapazität beim Laden, gespeicherte Energie beim Entladen — nicht zu
 * einem schlechteren Preis her, wenn heute noch ein besserer kommt UND die Ressource bis dahin
 * nicht wieder beschafft werden kann.
 *
 * ⚠ Der zweite Halbsatz ist der entscheidende und war beim Bau die eigentliche Erkenntnis. Eine
 * reine Rangfolge ohne ihn („was später besser ist, gewinnt") ist NACHWEISLICH SCHLECHTER als das
 * bisherige Verhalten: eine reale Spotkurve hat mehrere Täler und Spitzen pro Tag, und ein Speicher
 * schafft darin mehr als einen Zyklus. Wer morgens bei 41 ct nicht entlädt, weil abends 60 ct
 * kommen, verschenkt die 41 ct — obwohl er mittags zu 30 ct hätte nachladen können und am Abend
 * trotzdem voll gewesen wäre. An genau diesem Fall gemessen und als Test festgehalten. Aus
 * demselben Grund ist auch keine feste Zahl der „K günstigsten Stunden" gebildet worden: sie
 * deckelte den Durchsatz auf einen Zyklus je Tag.
 *
 * ── DIE UMSETZUNG: ZWEI SCHRANKEN, KEIN ZWEITER DISPATCH-PFAD ──────────────────────────────────
 *   • **Ladeobergrenze** `chargeCeilingKwh[i]`: Kapazität, die eine strikt GÜNSTIGERE Stunde
 *     desselben Kalendertags später noch braucht und die bis dahin nicht anderweitig frei wird,
 *     bleibt frei. Kommt heute nichts Billigeres mehr, ist die Obergrenze die volle Kapazität.
 *   • **Preis-Untergrenze** `priceFloorKwh[i]`: Energie, die eine strikt TEURERE Stunde desselben
 *     Kalendertags später noch nutzt und die bis dahin nicht nachgeladen werden kann, bleibt
 *     liegen. Kommt heute nichts Teureres mehr, ist die Untergrenze 0.
 *
 * Beide sind reine Ordnungs-Aussagen („strikt günstiger/teurer als jetzt"), keine gesetzte Schwelle
 * und keine erfundene Konstante. Der Dispatch bekommt sie als zwei zusätzliche Reihen und behält
 * seine sechs Schritte unverändert — es entsteht kein zweiter Fahrplan und keine zweite Zahl
 * (Prinzip 2).
 *
 * ── ⚠ WAS AUSDRÜCKLICH UNBERÜHRT BLEIBT ───────────────────────────────────────────────────────
 * Die Spitzenkappung (Schritt 2) kennt keine der beiden Schranken — sie entlädt unbedingt, sobald
 * `draw > cap`. Ebenso wenig die Spitzenbereitschaft (Schritt 5b): sie lädt weiterhin bis zur
 * Spitzen-Reserve `socFloor`, ohne Preisrücksicht. Ein Speicher, der wegen einer Preisregel eine
 * Spitze verpasst, verlöre eine ganze Abrechnungsperiode für ein paar Cent (Priorität
 * `peak_first`, §3.7). Die Preis-Untergrenze wird deshalb mit der Spitzen-Reserve über `max()`
 * kombiniert und ist NICHT deren Ersatz.
 *
 * ── ⚠ DER HORIZONT IST GENAU EIN KALENDERTAG (lokale Wanduhr) ─────────────────────────────────
 * Beide Schranken enden an der Tagesgrenze: was am 3. um 23:45 gilt, weiss nichts vom 4. um 03:00.
 * Das ist die Produktentscheidung vom 02.09.2026 und zugleich die Grenze der Kausalität, die
 * dieses Verfahren beanspruchen darf: aWATTar veröffentlicht den vollen FOLGETAG gegen 14 Uhr
 * vorab — innerhalb eines Kalendertags ist die Rangfolge damit einer realen Steuerung tatsächlich
 * bekannt, über die Tagesgrenze hinaus (in den frühen Morgenstunden) nicht durchgängig.
 * Die Gruppierung läuft über dieselbe lokale Wanduhr wie die Preisschwelle (`tou.ts`) und
 * `coveredMonthlyPeaksKw` (§3.4/§3.5) — DST-Tage (92 bzw. 100 Intervalle) fallen dadurch von
 * selbst richtig.
 *
 * ⚠ Der SoC-Übertrag über die Tagesgrenze bleibt physikalisch (Prinzip 3: die Batterie vergisst
 * ihren Zustand um Mitternacht nicht). Nur die BEWERTUNG endet am Tag. Randartefakt, bewusst in
 * Kauf genommen: eine sehr teure Stunde kurz nach Mitternacht wird von der Untergrenze des Vortags
 * nicht mehr geschützt — dieselbe Art bekannter Vereinfachung wie der Perioden-Übertrag der
 * Kapp-Suche bei `monthly_*` (§3.6.1).
 */
export type DailyPriceOrder = {
  /**
   * Obergrenze des SoC (kWh) am ENDE von Intervall `i` für das tarifbewusste Laden (Schritt 5a).
   * `usableCapacityKwh`, wenn heute nichts Günstigeres mehr kommt.
   */
  chargeCeilingKwh: number[]
  /**
   * Untergrenze des SoC (kWh) am ENDE von Intervall `i` für den Eigenverbrauch (Schritt 4).
   * 0, wenn heute nichts Teureres mehr kommt. Wird im Dispatch mit der Spitzen-Reserve über
   * `max()` verrechnet, nicht an ihrer Stelle verwendet.
   */
  priceFloorKwh: number[]
}

/** Eingangsgrössen, die alle aus dem bereits gerechneten Kontext von `simulateBattery` stammen. */
export type DailyPriceOrderInputs = {
  loadProfile: LoadProfile
  /** Der kombinierte Intervallpreis (Delta 4) — die Rangfolge misst ausschliesslich daran. */
  rateCtPerKwh: number[]
  /** Die Ladefenster aus der Preisschwelle (`tou.ts`) — nur dort kann Schritt 5a überhaupt laden. */
  preferChargeInterval: boolean[]
  /** Kapp-Schwelle je Intervall (∞ ohne Spitzenkappung). */
  capForInterval: number[]
  /** Signierter Netzbezug je Intervall. */
  draws: number[]
  physics: BatteryPhysics
  /** Intervalldauer in Stunden. */
  deltaH: number
}

/** Lokaler Kalendertag als Schlüssel — identisch zur Gruppierung der Preisschwelle in `tou.ts`. */
function localDayKey(ms: number, timezoneMeta: LoadProfile['timezoneMeta']): string {
  const { year, month, day } = utcMsToLocalFields(ms, timezoneMeta)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Berechnet Ladeobergrenze und Preis-Untergrenze je Intervall (s. Modulkopf).
 *
 * Die beiden Mengen `chargeableKwh`/`dischargeableKwh` spiegeln GENAU die Bedingungen der
 * Dispatch-Schritte 5a bzw. 4 (`dispatch.ts`) — eine Stunde, in der der Dispatch ohnehin nicht
 * laden bzw. nicht entladen würde, darf weder Kapazität noch Energie für sich beanspruchen und kann
 * auch keine bereitstellen. Läuft die Verzweigung dort je auseinander, rechnet dieses Modul mit
 * einer Gelegenheit, die es nicht gibt — der Kopfkommentar von `runCombinedDispatch` nennt die
 * Reihenfolge der Schritte.
 */
export function dailyPriceOrder(inputs: DailyPriceOrderInputs): DailyPriceOrder {
  const { loadProfile, rateCtPerKwh, preferChargeInterval, capForInterval, draws, physics, deltaH } =
    inputs
  const { usableCapacityKwh, maxPowerKw, roundTripEfficiency: eta } = physics
  const n = draws.length

  const chargeableKwh = new Array<number>(n).fill(0)
  const dischargeableKwh = new Array<number>(n).fill(0)

  for (let i = 0; i < n; i++) {
    const draw = draws[i] ?? 0
    const cap = capForInterval[i] ?? Infinity
    // Schritt 5a und Schritt 4 greifen beide nur bei 0 ≤ draw ≤ cap; davor fangen die
    // Spitzenkappung (draw > cap) und die PV-Ladung (draw < 0) ab.
    if (draw < 0 || draw > cap) continue
    if (preferChargeInterval[i] ?? false) {
      const headroomKw = Math.max(0, cap - draw)
      chargeableKwh[i] = Math.min(maxPowerKw, headroomKw) * deltaH * eta
    } else {
      // Schritt 4 entlädt nie über `draw` hinaus (kein künstlicher Export) — die Reservierung
      // darf deshalb auch nicht mehr für eine Stunde zurücklegen, als deren Last aufnimmt.
      dischargeableKwh[i] = Math.min(draw, maxPowerKw) * deltaH
    }
  }

  const byDay = new Map<string, number[]>()
  for (let i = 0; i < n; i++) {
    const reading = loadProfile.readings[i]
    // Reisst die Preisreihe über die Readings hinaus, bleibt das Intervall ohne Tagesbezug und
    // damit ohne Schranke — dieselbe konservative Lesart wie beim Randfragment in `tou.ts`.
    if (!reading) continue
    const key = localDayKey(Date.parse(reading.ts), loadProfile.timezoneMeta)
    const list = byDay.get(key)
    if (list) list.push(i)
    else byDay.set(key, [i])
  }

  const chargeCeilingKwh = new Array<number>(n).fill(usableCapacityKwh)
  const priceFloorKwh = new Array<number>(n).fill(0)

  for (const positions of byDay.values()) {
    const m = positions.length
    for (let a = 0; a < m; a++) {
      const i = positions[a]!
      const x = rateCtPerKwh[i] ?? Number.NaN

      /*
       * ── DIE ZWEI VORWÄRTS-SCANS ─────────────────────────────────────────────────────────────
       * Für jeden Zeitpunkt `t` nach `i` wird geprüft, wie viel bis dorthin NETTO fehlt: der
       * Bedarf minus dem, was bis dahin von selbst wieder verfügbar wird. Das MAXIMUM über alle
       * `t` ist die Menge, die jetzt zurückgehalten werden muss — nur so zählt eine Gelegenheit
       * erst dann als Ersatz, wenn sie zeitlich VOR dem Bedarf liegt. Eine blosse Summe über alle
       * späteren Intervalle wäre reihenfolgeblind und läge in beide Richtungen falsch: sie hielte
       * zurück, was längst nachgekauft werden könnte, und gäbe her, was erst danach ersetzbar wäre.
       *
       * Preisgleiche Intervalle zählen ausdrücklich NICHT füreinander (strikte Vergleiche): bei
       * einem Tarif mit zwei Preisstufen wären sonst die frühen Nachtstunden gegenüber den späten
       * benachteiligt, obwohl sie exakt dasselbe kosten — eine Rangfolge, wo es keine gibt.
       */
      let floorRunning = 0
      let floorNeeded = 0
      let ceilRunning = 0
      let ceilNeeded = 0
      for (let b = a + 1; b < m; b++) {
        const j = positions[b]!
        const rj = rateCtPerKwh[j] ?? Number.NaN
        if (rj > x) {
          // Teurer als jetzt: braucht Energie (Untergrenze) und macht Kapazität frei (Obergrenze).
          const d = dischargeableKwh[j] ?? 0
          floorRunning += d
          ceilRunning -= d
        } else if (rj < x) {
          // Günstiger als jetzt: braucht Kapazität (Obergrenze) und liefert Energie (Untergrenze).
          const c = chargeableKwh[j] ?? 0
          floorRunning -= c
          ceilRunning += c
        }
        if (floorRunning > floorNeeded) floorNeeded = floorRunning
        if (ceilRunning > ceilNeeded) ceilNeeded = ceilRunning
      }

      priceFloorKwh[i] = Math.min(usableCapacityKwh, floorNeeded)
      chargeCeilingKwh[i] = usableCapacityKwh - Math.min(usableCapacityKwh, ceilNeeded)
    }
  }

  return { chargeCeilingKwh, priceFloorKwh }
}
