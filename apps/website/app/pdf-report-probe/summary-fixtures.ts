import {
  buildExistingBatteryCandidate,
  type GridTariffRowInput,
  type LoadProfile,
  type SpotPriceSeriesInput,
  type TariffParams,
  type TariffPricingInputs,
} from 'shared'

import type { CalculatorPayload } from '@/components/flow/types'
import { localMonthIndex } from '@/lib/local-time'
import { buildLoadProfileFixture, buildPartialYearLoadProfileFixture } from './chart-fixtures'
import type { SummaryProbeKind } from './summary-probe-kinds'

/**
 * B23c-1 — die EINGABEN der Prüfläufe der Executive Summary (seit B23c-3b-2 vier).
 *
 * ── ⚠ HIER STEHEN AUSSCHLIESSLICH EINGABEN, KEIN EINZIGES ERGEBNIS ────────────────────────────
 * Das `AnalysisResult`, aus dem die Kernergebnis-Seite entsteht, wird im Browser GERECHNET
 * (`analysis-run.ts` schickt diesen Payload an den echten Analyse-Worker). Eine hier von Hand
 * notierte Ergebniszahl wäre genau der zweite Zahlensatz, den ein Prüfstand nicht haben darf: die
 * Seite sähe dann richtig aus, weil das Ergebnis danebengeschrieben ist — nicht, weil es
 * herauskommt. Dieselbe Haltung wie in `chart-fixtures.ts` („echte Prop-Form, kein vereinfachtes
 * Mock"), einen Schritt weiter getrieben.
 *
 * ── DER LASTGANG IST DER AUS B23b, UNVERÄNDERT ────────────────────────────────────────────────
 * `buildLoadProfileFixture()` — ein voller Jahrgang im 15-min-Gitter (35.040 Werte, ein
 * dominanter Jahreshöchstwert von 50,78 kW). Ein zweiter Lastgang für dieselbe Prüfroute wäre eine
 * zweite Grundlage, gegen die niemand die Chart-Läufe daneben mehr vergleichen könnte.
 *
 * ⚠ B23c-3b-2 nimmt davon KEINE Ausnahme: der Teiljahres-Fall fährt DENSELBEN Lastgang, auf die
 * Monate Jänner bis August gekürzt (`buildPartialYearLoadProfileFixture`). Jeder seiner Messwerte
 * ist Zeichen für Zeichen einer des Volljahrgangs — was daran gemessen wird, bleibt gegen die
 * übrigen Läufe vergleichbar. Gebraucht wird er für den einen Zustand, den ein Volljahrgang nicht
 * herstellen kann: leere Zellen in der Stunden-Heatmap (D15).
 *
 * ⚠ Er trägt KEINE Einspeisung (alle Werte positiv). Der Eigenverbrauchs-Anteil kommt deshalb als
 * echte 0 heraus — eine GERECHNETE Null und kein fehlender Wert. Genau das ist der Unterschied,
 * den die Executive Summary macht: eine gerechnete 0 steht als Zeile da, eine fehlende Grundlage
 * lässt die Aussage ganz entfallen.
 */

/**
 * Netzbetreiber-Tarifzeile: Wiener Netze, Netzebene 3, Preisblatt WN-EX0105 Vers. 2/2026.
 *
 * ⚠ Die Zahlen sind die GEDRUCKTEN (`CLAUDE.md`, B21-2b/B23b: Grundpreis 38,52 EUR/kW·a ·
 * Arbeitspreis 0,49 ct/kWh ganzjährig · Netzverlustentgelt 0,109 ct/kWh) und nicht erfunden — ein
 * Prüfstand mit geratenen Tarifsätzen misst zwar dieselbe Mechanik, aber an einer Preiswelt, die
 * es nicht gibt.
 *
 * `grundpreisUnit: 'eur_per_kw_year'` heisst LEISTUNGSPREIS: er ist bereits die Jahreszahl der
 * Kern-Kennzahl und wird im Monatsvergleich ausdrücklich NICHT mitgeführt (Delta 19).
 */
const GRID_TARIFF_ROWS: GridTariffRowInput[] = [
  {
    validFrom: '2024-01-01',
    validUntil: null,
    netzverlustCtPerKwh: 0.109,
    grundpreisAmount: 38.52,
    grundpreisUnit: 'eur_per_kw_year',
    priceBasis: 'net',
    windows: [
      {
        label: 'normal',
        monthDayFrom: null,
        monthDayTo: null,
        timeFrom: '00:00',
        timeTo: '24:00',
        ctPerKwh: 0.49,
      },
    ],
  },
]

const HOUR_MS = 60 * 60 * 1000

/**
 * Eine stündliche Marktpreis-Reihe über den gesamten Lastgang-Zeitraum (Delta 15 Regel A: der
 * Vergleich läuft auf genau dem Zeitraum, den der Lastgang abdeckt).
 *
 * SYNTHETISCH und als solches gekennzeichnet: es liegt für diesen Prüf-Lastgang keine echte
 * aWATTar-Reihe vor, und eine zu erfinden, die wie eine Messung aussieht, wäre der schlechtere
 * Weg. ECHT ist die FORM — ein Tagesgang mit Nachttal und Abendspitze plus ein Jahresgang, also
 * genau die Struktur, aus der die Ladesteuerung überhaupt etwas holen kann. Eine flache Reihe
 * ergäbe eine Lastverschiebung von 0 und prüfte die Aussage nicht, um die es geht.
 *
 * ⚠ Die Reihe MUSS bis zum ENDE des letzten Intervalls reichen, nicht bis zu dessen Beginn — sonst
 * meldet `combinedIntervalPrices` eine Lücke von 15 Minuten und der Hebel gilt als nicht
 * berechenbar. Die Länge wird deshalb aus dem Lastgang abgeleitet und nicht abgezählt.
 */
function buildSpotPrices(profile: LoadProfile): SpotPriceSeriesInput {
  const first = profile.readings[0]!
  const last = profile.readings[profile.readings.length - 1]!
  const startMs = Date.parse(first.ts)
  const endMs = Date.parse(last.ts) + profile.intervalMinutes * 60 * 1000

  const prices = []
  for (let ms = startMs; ms < endMs; ms += HOUR_MS) {
    const hoursIn = (ms - startMs) / HOUR_MS
    const hourOfDay = Math.floor(hoursIn) % 24
    const dayOfYear = Math.floor(hoursIn / 24)
    /* Jahresgang: im Winter teurer. */
    const seasonal = 11 + 4 * Math.cos((2 * Math.PI * dayOfYear) / 365)
    /* Tagesgang: Nachttal um 03:00, Abendspitze um 19:00. */
    const daily = 5.5 * Math.sin(((hourOfDay - 9) / 24) * 2 * Math.PI)
    prices.push({
      tsStart: new Date(ms).toISOString(),
      tsEnd: new Date(ms + HOUR_MS).toISOString(),
      ctPerKwh: Math.round((seasonal + daily) * 1000) / 1000,
      priceBasis: 'net' as const,
    })
  }

  return { prices, complete: true, missingRanges: [] }
}

/*
 * ⚠ ERST BEIM AUFRUF GEBAUT, nicht auf Modulebene: die Reihe hat 8.760 Einträge und zieht dafür den
 * vollen Lastgang (35.040 Werte). Auf Modulebene entstünde beides, sobald irgendetwas diese Datei
 * anfasst — auch dann, wenn niemand einen Lauf startet.
 */
const pricingCache = new Map<LoadProfile, TariffPricingInputs>()

/**
 * ⚠ Die Preisreihe hängt am LASTGANG und wird deshalb je Profil gebildet (Delta 15 Regel A: der
 * Vergleich läuft auf genau dem Zeitraum, den der Lastgang abdeckt). Für den Teiljahres-Fall eine
 * Volljahres-Reihe zu benutzen wäre folgenlos, für den umgekehrten Fall dagegen eine Lücke von vier
 * Monaten — und der Hebel gälte als nicht berechenbar, ohne dass es an den Preisen läge.
 */
function pricingComplete(profile: LoadProfile): TariffPricingInputs {
  let cached = pricingCache.get(profile)
  if (!cached) {
    cached = { gridTariffRows: GRID_TARIFF_ROWS, spotPrices: buildSpotPrices(profile) }
    pricingCache.set(profile, cached)
  }
  return cached
}

/**
 * Dieselbe Netzentgelt-Seite, aber OHNE Marktpreise.
 *
 * ⚠ `spotPrices: null` heisst „angefordert, aber nicht lesbar" und ist etwas anderes als ein
 * fehlendes `tariffPricing` (= „gar nicht angefordert"). Beides führt in der Executive Summary zum
 * selben sichtbaren Ergebnis — die Ladesteuerungs-Aussage entfällt —, aber nur dieser Fall erzeugt
 * den Blocker (`computable: false`), und genau der ist zu prüfen: dass eine nicht berechenbare
 * Grösse keine gedämpfte Ersatzzahl bekommt, sondern gar keine.
 */
const PRICING_WITHOUT_SPOT: TariffPricingInputs = {
  gridTariffRows: GRID_TARIFF_ROWS,
  spotPrices: null,
}

/** Netzebene 3, Wiener Netze — Leistungspreis aus dem Preisblatt, Energiepreise als Rundwerte. */
const TARIFF: TariffParams = {
  leistungspreisEurPerKwYear: 38.52,
  billingModel: 'annual_max',
  minBillableKw: 0,
  energyPriceCtPerKwh: 25,
  einspeiseverguetungCtPerKwh: 8,
  netzebene: '3',
}

/**
 * Der Speicher, den der Kunde bereits hat — die Werte des dokumentierten Referenzfalls
 * (`CLAUDE.md`, 02.09.2026: 19,2 kWh / 10,6 kW / η 0,9).
 *
 * ⚠ `buildExistingBatteryCandidate` setzt `controlType: 'static'` (Pessimismus-Prinzip: aus einer
 * Freitextangabe ist nicht erkennbar, ob eine kappungsfähige Steuerung daran hängt). FOLGE für die
 * Prüfung: im Bestandsfall ist der Spitzenkappungs-Anteil 0, und die entsprechende Kernaussage
 * ENTFÄLLT — nicht als Fehler, sondern als die richtige Antwort. Im Katalog-Fall steht sie, weil
 * die Katalog-Geräte der Gewerbeklasse `dynamic` sind.
 */
const EXISTING_BATTERY = buildExistingBatteryCandidate({
  usableCapacityKwh: 19.2,
  maxPowerKw: 10.6,
  roundTripEfficiency: 0.9,
})

/**
 * B23c-3b-2 — eine KLEINE bestehende Anlage (ein Heimspeicher der untersten Grösse).
 *
 * ⚠ Sie ist nicht „realistischer" als die dokumentierte 19,2-kWh-Anlage, sondern beantwortet eine
 * andere Frage: neben jener rechnet sich KEIN Katalog-Gerät im Betrachtungszeitraum (gemessen —
 * alle fünf Zusatzszenarien liegen unter der Nulllinie), und damit wäre der Tabellen-Zweig des
 * Kapitels gebaut, aber nie gemessen. Der Klarsatz-Zweig ist an ihr weiterhin abgedeckt.
 */
const SMALL_EXISTING_BATTERY = buildExistingBatteryCandidate({
  usableCapacityKwh: 5,
  maxPowerKw: 3,
  roundTripEfficiency: 0.9,
})

/**
 * Der Payload eines Prüflaufs — genau der Typ, den auch der Rechner an den Worker schickt.
 *
 * `sourceBytes` fehlt bewusst: es hängt allein am Analyse-Bündel (B14-2) und hat mit der
 * Executive Summary nichts zu tun. Ein erfundener Byte-Block stünde hier als Angabe da, die nichts
 * bezeichnet.
 */
export function buildSummaryProbePayload(kind: SummaryProbeKind): CalculatorPayload {
  const partial = kind === 'teiljahr'
  const profile = partial ? buildPartialYearLoadProfileFixture() : buildLoadProfileFixture()

  /*
   * ⚠ GEZÄHLT, NICHT ABGESCHRIEBEN. Wie viele Tage und Kalendermonate der gekürzte Lastgang
   * abdeckt, ergibt sich aus seinen Messwerten — eine hier notierte Zahl wäre eine zweite Wahrheit
   * neben dem Profil und liefe beim nächsten Zuschnitt von ihm weg. Der Volljahrgang zählt sich
   * damit ebenfalls selbst und trifft die bisher fest notierten 365/12.
   */
  const coveredMonths = new Set(
    profile.readings.map((r) => localMonthIndex(Date.parse(r.ts), profile.timezoneMeta)),
  ).size
  const coveredDays = Math.round(profile.readings.length / (24 * (60 / profile.intervalMinutes)))

  return {
    load: {
      fileName: partial ? 'pruefstand-teiljahr-jan-aug.csv' : 'pruefstand-jahreslastgang.csv',
      profile,
      dataQuality: {
        coveredDays,
        coveredMonths,
        gapsInterpolated: 0,
        largestGapSlots: 0,
        warnings: [],
      },
    },
    tariff: TARIFF,
    pv: null,
    tariffPricing: kind === 'blocker' ? PRICING_WITHOUT_SPOT : pricingComplete(profile),
    existingBattery:
      kind === 'katalog'
        ? undefined
        : {
            battery: kind === 'zusatz' ? SMALL_EXISTING_BATTERY : EXISTING_BATTERY,
            efficiencyAssumed: false,
          },
  }
}
