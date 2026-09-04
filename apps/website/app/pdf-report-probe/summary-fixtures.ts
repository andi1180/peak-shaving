import { generateStandardLoadProfile } from 'engine'
import {
  buildExistingBatteryCandidate,
  lookupTariffProfile,
  tariffSelectionFrom,
  type GridTariffRowInput,
  type LoadProfile,
  type SpotPriceSeriesInput,
  type FinancialParams,
  type TariffParams,
  type TariffPricingInputs,
  type TariffSelection,
} from 'shared'

import type { CalculatorPayload } from '@/components/flow/types'
import { localMonthIndex } from '@/lib/local-time'
import {
  buildCurrentYearPartialLoadProfileFixture,
  buildGapLoadProfileFixture,
  buildLoadProfileFixture,
  buildPartialYearLoadProfileFixture,
  GAP_LENGTH_SLOTS,
} from './chart-fixtures'
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
 * B23c-4 — dieselbe Preisreihe, aber mit einer echten LÜCKE.
 *
 * ── ⚠ DIE LÜCKE IST GEBAUT UND NICHT BLOSS GEMELDET ───────────────────────────────────────────
 * `missingRanges` sagt der Engine, was fehlt; `complete: false` löst den Blocker aus. Die Reihe
 * trägt die betroffenen Stunden deshalb tatsächlich NICHT — eine Meldung über eine Lücke, die es
 * in den Daten nicht gibt, wäre eine Angabe über eine Reihe, die sie nicht hat (dieselbe Haltung
 * wie beim Lastgang mit interpolierter Lücke).
 *
 * Drei Stunden mitten im Juli, weit weg von den Spitzen, an denen die übrigen Läufe gemessen
 * werden — was diesen Lauf von den anderen unterscheidet, ist die Lücke und nicht eine
 * verschwundene Spitze.
 */
const SPOT_GAP_FROM_ISO = '2025-07-04T10:00:00.000Z'
const SPOT_GAP_TO_ISO = '2025-07-04T13:00:00.000Z'

function pricingWithGap(profile: LoadProfile): TariffPricingInputs {
  const full = buildSpotPrices(profile)
  const fromMs = Date.parse(SPOT_GAP_FROM_ISO)
  const toMs = Date.parse(SPOT_GAP_TO_ISO)
  return {
    gridTariffRows: GRID_TARIFF_ROWS,
    spotPrices: {
      prices: full.prices.filter((p) => {
        const ms = Date.parse(p.tsStart)
        return ms < fromMs || ms >= toMs
      }),
      complete: false,
      missingRanges: [{ fromIso: SPOT_GAP_FROM_ISO, toIso: SPOT_GAP_TO_ISO }],
    },
  }
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
 * B23c-4 — der Lastgang je Prüffall, samt der Datenqualität, die der Parser dazu gemeldet hätte.
 *
 * ── ⚠ DIE DATENQUALITÄT IST EINE EINGABE UND KEIN ERGEBNIS ────────────────────────────────────
 * `dataQuality` entsteht im PARSER und reist im Payload zum Worker, der sie unverändert in das
 * Ergebnis übernimmt. Sie hier zu setzen ist damit dasselbe wie einen Lastgang zu setzen — nicht
 * dasselbe wie eine Ergebniszahl danebenzuschreiben (s. Modulkopf).
 *
 * ⚠ WAS DARIN STEHT, IST AM PROFIL ABGEZÄHLT UND NICHT BEHAUPTET: Tage und Monate ergeben sich aus
 * den Messwerten, und die Lückenzahlen des `luecke`-Falls sind die Länge der Lücke, die
 * `buildGapLoadProfileFixture` tatsächlich baut. Eine hier notierte Lückenzahl ohne Lücke im Profil
 * wäre eine Angabe über einen Datensatz, der sie nicht hat.
 */
type ProbeLoad = CalculatorPayload['load']

/**
 * Das Kalenderjahr des Prüf-Lastgangs — aus IHM abgeleitet und nicht danebengeschrieben.
 *
 * ⚠ Über die ORTSZEIT gelesen: der Volljahrgang beginnt bei `2024-12-31T23:00Z`, was in Wien der
 * 1. Jänner ist. Über UTC gelesen ergäbe sich das Vorjahr — und das Standardprofil entstünde für
 * einen Zeitraum, den weder die Preisreihe noch die Netzentgelt-Zeile abdecken.
 */
function probeYear(): number {
  const profile = buildLoadProfileFixture()
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: profile.timezoneMeta,
    year: 'numeric',
  })
  return Number(fmt.format(Date.parse(profile.readings[0]!.ts)))
}

function loadFor(kind: SummaryProbeKind, now: Date): ProbeLoad {
  /*
   * Das Standardprofil kommt aus DEM Generator, den auch der Rechner benutzt (Delta 9b-1) — samt
   * der Datenqualitäts-Warnung, die er selbst formuliert. Es ist der einzige Fall, der einen
   * ANDEREN Lastgang braucht und nicht bloss einen Ausschnitt des einen: `source` ist die
   * Eigenschaft, um die es geht, und sie einem gemessenen Profil anzuheften wäre eine Behauptung
   * über seine Herkunft.
   *
   * ⚠ Das Jahr ist das des Prüf-Lastgangs und nicht `standardProfileYear(now)`: nur so decken die
   * Preisreihe und die Netzentgelt-Zeile denselben Zeitraum ab wie in den übrigen Läufen.
   */
  if (kind === 'standardprofil') {
    const year = probeYear()
    const outcome = generateStandardLoadProfile({
      annualConsumptionKwh: 4_500,
      customerClass: 'privat',
      year: year,
      timeZone: 'Europe/Vienna',
    })
    if (!outcome.ok) throw new Error(`Standardprofil nicht erzeugbar: ${outcome.reason}`)
    return {
      fileName: `Standardprofil ${year} · 4.500 kWh/Jahr`,
      profile: outcome.profile,
      dataQuality: outcome.dataQuality,
    }
  }

  if (kind === 'luecke') {
    const profile = buildGapLoadProfileFixture()
    return {
      fileName: 'pruefstand-jahreslastgang-mit-luecke.csv',
      profile,
      dataQuality: {
        ...countedQuality(profile),
        gapsInterpolated: GAP_LENGTH_SLOTS,
        largestGapSlots: GAP_LENGTH_SLOTS,
        /*
         * ⚠ WORTGLEICH ZU DEM, WAS `prepareSeries` SCHRIEBE (`packages/engine/src/parser`), samt
         * der dortigen Schwelle von 4 Intervallen. Ein eigener Satz an dieser Stelle wäre eine
         * Warnung, die im echten Betrieb so nie erschiene.
         */
        warnings: [
          '1 größere Datenlücke(n) interpoliert (> 4 Intervalle) — im Report als ' +
            'Datenqualitäts-Hinweis kennzeichnen.',
        ],
      },
    }
  }

  if (kind === 'teiljahr_monat') {
    const profile = buildCurrentYearPartialLoadProfileFixture(now)
    return {
      fileName: 'pruefstand-teiljahr-laufendes-jahr.csv',
      profile,
      dataQuality: { ...countedQuality(profile), gapsInterpolated: 0, largestGapSlots: 0, warnings: [] },
    }
  }

  const partial = kind === 'teiljahr'
  const profile = partial ? buildPartialYearLoadProfileFixture() : buildLoadProfileFixture()
  return {
    fileName: partial ? 'pruefstand-teiljahr-jan-aug.csv' : 'pruefstand-jahreslastgang.csv',
    profile,
    dataQuality: { ...countedQuality(profile), gapsInterpolated: 0, largestGapSlots: 0, warnings: [] },
  }
}

/**
 * ⚠ GEZÄHLT, NICHT ABGESCHRIEBEN. Wie viele Tage und Kalendermonate ein Lastgang abdeckt, ergibt
 * sich aus seinen Messwerten — eine hier notierte Zahl wäre eine zweite Wahrheit neben dem Profil
 * und liefe beim nächsten Zuschnitt von ihm weg. Der Volljahrgang zählt sich damit ebenfalls
 * selbst und trifft die bisher fest notierten 365/12.
 */
function countedQuality(profile: LoadProfile): { coveredDays: number; coveredMonths: number } {
  const coveredMonths = new Set(
    profile.readings.map((r) => localMonthIndex(Date.parse(r.ts), profile.timezoneMeta)),
  ).size
  const coveredDays = Math.round(profile.readings.length / (24 * (60 / profile.intervalMinutes)))
  return { coveredDays, coveredMonths }
}

/**
 * B23c-4 — der gewählte Tarifsatz-Stand (B11), aus dem der Report seine Herkunftsangabe bildet.
 *
 * ── ⚠ ER WIRD NACHGESCHLAGEN UND NICHT ERFUNDEN, UND ZWAR ZUM SELBEN STICHTAG WIE IM RECHNER ──
 * `lookupTariffProfile` + `tariffSelectionFrom` sind DIE Funktionen, die auch der Tarif-Schritt
 * benutzt, und der schlägt zum HEUTIGEN Tag nach (`step-tariff.tsx`: `stichtag = new Date()…`) und
 * nicht zum Zeitraum des Lastgangs. Eine hier von Hand notierte Auswahl trüge eine
 * Stand-Bezeichnung und ein Gültigkeitsdatum, die es in `tariff-catalog.ts` gar nicht geben muss;
 * ein anderer Stichtag ergäbe eine Herkunftsangabe, die im Rechner so nie entstünde.
 *
 * ⚠ BEIDE ZWEIGE DER HERKUNFTSANGABE SIND DAMIT GEMESSEN, OHNE EINEN GEDREHTEN KNOPF: der
 * Katalog-Vorgabewert für Wiener Netze NE 3 ist `monthly_max_average` (38,52 · 0). Die Prüf-Fixtur
 * rechnet mit `annual_max` — also weist die Angabe das Abrechnungsmodell korrekt als „selbst
 * eingetragen" aus. Der Fall `teiljahr_monat` rechnet mit DEM Vorgabewert und trifft den anderen
 * Zweig („unverändert übernommen").
 */
function selectionFor(kind: SummaryProbeKind, now: Date): TariffSelection | undefined {
  /*
   * ⚠ EIN FALL BLEIBT BEWUSST OHNE AUSWAHL. Der `null`-Zweig der Herkunftsangabe ist eine eigene
   * AUSSAGE — „die Werte stammen aus Ihrer Netzrechnung", also die BESSERE Grundlage (Prinzip 1) —
   * und wäre sonst gebaut und nie gemessen. Der Katalog-Fall trägt ihn, weil er ohnehin der Lauf
   * ohne bestehende Anlage ist: ein Kunde, der weder einen Speicher noch einen hinterlegten
   * Tarifstand mitbringt, ist kein konstruierter, sondern der einfachste Fall.
   */
  if (kind === 'katalog') return undefined

  /* ⚠ `Netzebene` ist eine ZAHL; `TariffParams.netzebene` daneben ist ein Metadaten-String. */
  const on = now.toISOString().slice(0, 10)
  const found = lookupTariffProfile({ netzbetreiber: 'wiener_netze', netzebene: 3, on })
  return found.status === 'available' ? tariffSelectionFrom(found.set, found.profile) : undefined
}

/**
 * B23c-4 — Förderung und Steuervorteil, für GENAU EINEN Prüffall.
 *
 * ── ⚠ WOZU: SONST SIND ZWEI FELDER DER ANNAHMEN-TABELLE NICHT UNTERSCHEIDBAR ──────────────────
 * Ohne Finanzparameter meldet `calculateRoi` `taxEffectsIncluded: false`, und `netInvestment` ist
 * dann Zahl für Zahl gleich `totalInvestment`. Die Tabelle liest beide — und eine Wächter-Probe,
 * die das eine gegen das andere tauscht, bliebe an solchen Daten GRÜN (gemessen). Erst mit einer
 * echten Förderung trennen sich die Werte, und erst dann ist die Zeile „Nettoinvestition" gegen
 * die richtige Grösse geprüft.
 *
 * ⚠ Damit wird zugleich der ZWEITE Zweig dieser Zeile erreicht: ohne Steuereffekte steht dort
 * ausdrücklich „keine Angabe (nicht einbezogen)" statt des Bruttowerts (den auszuweisen eine
 * Rechnung behauptete, die nicht stattgefunden hat). Die übrigen acht Läufe messen jenen Zweig.
 *
 * Die Zahlen sind gerundete Grössenordnungen einer österreichischen Investitionsförderung und als
 * PRÜFEINGABE gekennzeichnet — sie sind kein Förderungsstand, auf den sich jemand berufen könnte.
 */
const PROBE_FINANCIAL: FinancialParams = {
  subsidyPercent: 20,
  taxRatePercent: 25,
  depreciationYears: 10,
}

/**
 * Der Payload eines Prüflaufs — genau der Typ, den auch der Rechner an den Worker schickt.
 *
 * `sourceBytes` fehlt bewusst: es hängt allein am Analyse-Bündel (B14-2) und hat mit der
 * Executive Summary nichts zu tun. Ein erfundener Byte-Block stünde hier als Angabe da, die nichts
 * bezeichnet.
 *
 * ⚠ `now` ist ein PARAMETER: genau ein Prüffall (`teiljahr_monat`) hängt an der heutigen Uhr, weil
 * die Eigenschaft, die er misst, der Bezug zum LAUFENDEN Kalenderjahr ist (s.
 * `buildCurrentYearPartialLoadProfileFixture`). Eine Fixtur, die selbst auf die Uhr sieht, liesse
 * sich gegen keinen Stichtag prüfen.
 */
export function buildSummaryProbePayload(kind: SummaryProbeKind, now: Date): CalculatorPayload {
  const load = loadFor(kind, now)

  return {
    load,
    /*
     * ⚠ Der Teiljahres-Hinweis erscheint NUR unter einem monatsbasierten Abrechnungsmodell
     * (§3.5) — der Prüf-Tarif rechnet sonst durchgehend mit `annual_max`, und genau deshalb ist
     * der bestehende `teiljahr`-Lauf frei von ihm, obwohl er acht Monate abdeckt.
     */
    tariff:
      kind === 'teiljahr_monat' ? { ...TARIFF, billingModel: 'monthly_max_average' } : TARIFF,
    tariffSelection: selectionFor(kind, now),
    financial: kind === 'foerderung' ? PROBE_FINANCIAL : undefined,
    pv: null,
    tariffPricing:
      kind === 'blocker'
        ? PRICING_WITHOUT_SPOT
        : kind === 'blocker_luecke'
          ? pricingWithGap(load.profile)
          : pricingComplete(load.profile),
    existingBattery:
      kind === 'katalog' || kind === 'standardprofil'
        ? undefined
        : {
            battery: kind === 'zusatz' ? SMALL_EXISTING_BATTERY : EXISTING_BATTERY,
            efficiencyAssumed: false,
          },
  }
}
