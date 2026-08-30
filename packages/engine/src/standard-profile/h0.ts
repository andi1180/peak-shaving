import type { DataQuality } from '../parser/types'
import type { LoadProfile } from 'shared'

import { toIsoUtc, utcMsToLocalFields, zonedWallToUtcMs } from '../parser/datetime'

/**
 * Standardlastprofil (Delta 8, Delta 9b-1) — ein SYNTHETISCHER Lastgang aus Jahresverbrauch und
 * Kundenklasse, für Kunden ohne echten Lastgang.
 *
 * ── WARUM DAS HIER UND NICHT IM PARSER STEHT ────────────────────────────────────────────────────
 * Der Parser LIEST einen Lastgang; dieses Modul ERZEUGT einen. Beide münden auf denselben
 * `LoadProfile`-Contract, und nachgelagert verzweigt bewusst nichts darüber (Delta 9b: „drei
 * gleichwertige Startpunkte, keine UI-Verzweigung danach") — bis auf die eine Stelle, an der es
 * verzweigen MUSS: die Leistungspreis-Dimension (s. `peakShavingBlockers`, Delta 3/8).
 *
 * ── ES GIBT KEINEN ZUFALL IN DIESEM GENERATOR, UND DAS IST EINE FACHLICHE ENTSCHEIDUNG ──────────
 * Die Demo-Fixtures in `dev-fixtures/` streuen ihre Werte über einen gesäten PRNG, weil sie eine
 * ECHTE Messreihe nachstellen sollen. Hier wäre dasselbe ein Fehler: ein Standardlastprofil IST
 * definitionsgemäss eine Durchschnittskurve, und aufgestreutes Rauschen erzeugte genau das, was
 * dieses Profil nicht behaupten darf — eine individuelle Lastspitze. Sie liefe anschliessend in die
 * Spitzenkappungs-Rechnung und sähe dort aus wie eine gemessene (Prinzip 1/Prinzip 7). Die Kurve ist
 * deshalb glatt, und die Leistungspreis-Dimension wird zusätzlich hart abgeschaltet.
 *
 * ── REFERENZPARAMETER ───────────────────────────────────────────────────────────────────────────
 * Aus dem Methodik-Abschnitt „Lastprofil Haushalt" der Ladeoptimierungs-Simulationsstudie
 * (H0-Haushaltsprofil): Referenzmittel 10 kWh/Tag, Winter/Sommer-Verhältnis 1,32, Doppelspitze
 * Morgen/Abend, flacherer Verlauf am Wochenende. Das Referenzmittel ist dabei KEIN Rechenparameter —
 * die Kurve wird linear auf den eingegebenen Jahresverbrauch skaliert; es ist die Grössenordnung,
 * gegen die der Generator geprüft wird (3.650 kWh/Jahr ≈ 10 kWh/Tag).
 */

/** Referenzmittel des H0-Profils (Studie) — Prüfgrösse, kein Rechenparameter. */
export const H0_REFERENCE_DAILY_KWH = 10

/** Verhältnis des mittleren Tagesverbrauchs Winter (Dez/Jän/Feb) zu Sommer (Jun/Jul/Aug), Studie. */
export const H0_WINTER_SUMMER_RATIO = 1.32

/**
 * Kundenklasse des Standardprofils.
 *
 * `kleingewerbe` ist ABSICHTLICH deklariert und NICHT befüllt: Delta 8 lässt offen, welches
 * G-Profil in Österreich üblich ist (`[MARTIN, welche Quelle/welches Profilsystem]`). Ein aus dem
 * H0 abgeleitetes „Gewerbe-Profil" wäre eine erfundene Kurve mit einem seriösen Etikett — genau der
 * Fehler, den B11 bei einem fehlenden Tarifsatz vermeidet. Der Typ steht hier, damit die Oberfläche
 * die Klasse SICHTBAR und deaktiviert anbieten kann statt sie zu verschweigen (Delta 9,
 * Transparenz gilt auch für Unfertiges).
 */
export type StandardProfileCustomerClass = 'privat' | 'kleingewerbe'

export type StandardProfileInput = {
  /** Jahresverbrauch in kWh/Jahr — die einzige kundenseitige Zahl. */
  annualConsumptionKwh: number
  customerClass: StandardProfileCustomerClass
  /** Kalenderjahr, das das erzeugte Profil abdeckt (Delta 15 Regel A/B — s. `standardProfileYear`). */
  year: number
  /** Zeitzone der Tagesform (Wanduhr). Pflichtparameter — eine stillschweigend angenommene wäre eine zweite Wahrheit. */
  timeZone: string
}

export type StandardProfileOutcome =
  | {
      ok: true
      profile: LoadProfile
      dataQuality: DataQuality
    }
  | {
      ok: false
      /**
       * `no_profile_for_class` — für diese Kundenklasse gibt es (noch) keine Profilkurve.
       * `invalid_consumption` — Jahresverbrauch nicht endlich oder ≤ 0.
       * `invalid_year` — Jahr ausserhalb des Kalenderbereichs, den der Generator abbildet.
       */
      reason: 'no_profile_for_class' | 'invalid_consumption' | 'invalid_year'
    }

const SLOT_MINUTES = 15
const SLOT_HOURS = SLOT_MINUTES / 60

function gauss(x: number, mu: number, sigma: number): number {
  return Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma))
}

/** Sanfte Kante (logistisch) — ein Haushalt steht nicht schlagartig auf. */
function plateau(x: number, start: number, end: number, edge: number): number {
  const up = 1 / (1 + Math.exp(-(x - start) / edge))
  const down = 1 / (1 + Math.exp((x - end) / edge))
  return up * down
}

/**
 * Tagesform des H0-Profils in RELATIVEN Einheiten (der Absolutwert entsteht erst durch die
 * Skalierung auf den Jahresverbrauch). `h` ist die Wanduhrzeit als Dezimalstunde.
 *
 * Werktag: schmale Morgenspitze (Aufstehen/Frühstück) und eine deutlich grössere, breitere
 * Abendspitze (Kochen/Beleuchtung/Unterhaltung) — die Doppelspitze der Studie. Tagsüber sinkt die
 * Kurve ab, weil das Haus leer ist.
 *
 * Wochenende: FLACHER, und zwar nicht „gleicher Verlauf mit kleineren Zahlen", sondern strukturell —
 * die Morgenspitze wandert nach hinten und schrumpft, das Tagesplateau steigt (jemand ist zu Hause),
 * die Abendspitze wird breiter. Das Verhältnis Spitze zu Tagesmittel sinkt dadurch messbar.
 */
function dailyShape(h: number, weekday: number): number {
  const isWeekend = weekday >= 5
  if (isWeekend) {
    return (
      0.32 +
      0.35 * plateau(h, 8.5, 23, 0.9) +
      0.45 * gauss(h, 9.2, 1.8) +
      1.05 * gauss(h, 18.8, 2.4)
    )
  }
  return (
    0.3 + 0.2 * plateau(h, 6.3, 22.5, 0.7) + 0.85 * gauss(h, 6.8, 1.0) + 1.55 * gauss(h, 19, 1.9)
  )
}

/**
 * Mittelwert von `cos(2π(m−1)/12)` über die drei Wintermonate (Dez/Jän/Feb) = (1 + √3)/3.
 * Über die drei Sommermonate (Jun/Jul/Aug) ist er exakt das Negative davon — daher genügt eine Zahl.
 */
const WINTER_COS_MEAN = (1 + Math.sqrt(3)) / 3

/**
 * Saisonfaktor als Kosinus über das Kalenderjahr, Maximum im Jänner.
 *
 * Die Amplitude ist NICHT geschätzt, sondern aus dem Zielverhältnis der Studie zurückgerechnet:
 * mit `f(m) = 1 + A·cos(2π(m−1)/12)` ist Winter/Sommer = (1 + A·c)/(1 − A·c) mit `c = WINTER_COS_MEAN`,
 * also `A = (r−1) / ((r+1)·c)`. Wer das Verhältnis ändert, ändert genau eine Konstante.
 *
 * ⚠ Das am erzeugten Profil GEMESSENE Energieverhältnis weicht davon minimal ab (Zehntelprozent):
 * Winter- und Sommermonate tragen nicht exakt gleich viele Wochenendtage, und ein Wochenendtag hat
 * eine andere Tagessumme als ein Werktag. Der Test misst deshalb das echte Verhältnis und lässt
 * eine kleine Toleranz zu, statt eine Zahl zu behaupten, die nur die Formel kennt.
 */
function seasonFactor(month: number): number {
  const amplitude =
    (H0_WINTER_SUMMER_RATIO - 1) / ((H0_WINTER_SUMMER_RATIO + 1) * WINTER_COS_MEAN)
  return 1 + amplitude * Math.cos((2 * Math.PI * (month - 1)) / 12)
}

/**
 * Erzeugt das Standardlastprofil. REIN und deterministisch: gleiche Eingabe → bit-identische
 * Ausgabe, kein Zufall, kein I/O, keine Uhr (das Jahr ist ein Parameter).
 *
 * Das Gitter läuft von der ORTSZEIT-Mitternacht des 1.1. bis zur Ortszeit-Mitternacht des 1.1. des
 * Folgejahres, in 15-Minuten-Schritten über die UTC-Achse — dadurch trägt ein DST-Tag von selbst
 * 92 bzw. 100 Slots, und die Tagesform folgt der Wanduhr (ein Haushalt kocht um 19 Uhr Ortszeit,
 * nicht um 19 Uhr UTC).
 *
 * Die Skalierung ist EXAKT: die Summe `Σ kW · 0,25 h` über alle Slots ergibt den eingegebenen
 * Jahresverbrauch (bis auf Fliesskomma-Rundung), weil der Skalierungsfaktor genau aus dieser Summe
 * gebildet wird — nicht aus einer angenommenen Tages- oder Jahreslänge.
 */
export function generateStandardLoadProfile(input: StandardProfileInput): StandardProfileOutcome {
  const { annualConsumptionKwh, customerClass, year, timeZone } = input

  if (customerClass !== 'privat') return { ok: false, reason: 'no_profile_for_class' }
  if (!Number.isFinite(annualConsumptionKwh) || annualConsumptionKwh <= 0) {
    return { ok: false, reason: 'invalid_consumption' }
  }
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return { ok: false, reason: 'invalid_year' }

  const startMs = zonedWallToUtcMs(year, 1, 1, 0, 0, 0, timeZone)
  const endMs = zonedWallToUtcMs(year + 1, 1, 1, 0, 0, 0, timeZone)
  const stepMs = SLOT_MINUTES * 60 * 1000

  const timestamps: number[] = []
  const shapes: number[] = []
  let rawEnergyKwh = 0
  for (let ms = startMs; ms < endMs; ms += stepMs) {
    const { month, hour, minute, weekday } = utcMsToLocalFields(ms, timeZone)
    const shape = dailyShape(hour + minute / 60, weekday) * seasonFactor(month)
    timestamps.push(ms)
    shapes.push(shape)
    rawEnergyKwh += shape * SLOT_HOURS
  }

  const scale = annualConsumptionKwh / rawEnergyKwh
  const readings = timestamps.map((ms, i) => ({
    ts: toIsoUtc(ms),
    gridPowerKw: (shapes[i] ?? 0) * scale,
  }))

  const days = new Set<string>()
  const months = new Set<number>()
  for (const ms of timestamps) {
    const { year: y, month, day } = utcMsToLocalFields(ms, timeZone)
    days.add(`${y}-${month}-${day}`)
    months.add(month)
  }

  return {
    ok: true,
    profile: {
      readings,
      intervalMinutes: 15,
      timezoneMeta: timeZone,
      source: 'standard_profile',
    },
    dataQuality: {
      coveredDays: days.size,
      coveredMonths: months.size,
      // Es gibt keine Lücke, die zu füllen wäre — es gibt gar keine Messung.
      gapsInterpolated: 0,
      warnings: [
        `Synthetisches Standardlastprofil (H0, Privathaushalt) für das Jahr ${year}, linear auf ` +
          `${new Intl.NumberFormat('de-AT').format(Math.round(annualConsumptionKwh))} kWh/Jahr ` +
          'skaliert. Es sind KEINE gemessenen Werte: die Tagesform ist ein Durchschnittsverlauf, ' +
          'die ausgewiesenen Leistungswerte sind daher keine gemessene Lastspitze. Für die ' +
          'Leistungspreis-Dimension bitte einen echten Lastgang hochladen.',
      ],
    },
  }
}
