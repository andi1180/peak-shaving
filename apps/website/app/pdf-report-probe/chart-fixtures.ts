import type { DispatchTrace, LoadProfile, MonthlyTariffComparison } from 'shared'

import { localMonthIndex } from '@/lib/local-time'

/**
 * B23b — Prüfdaten für die drei Chart-Typen des Rasterbild-Prüfstands.
 *
 * ── ⚠ ECHTE PROP-FORM, KEIN VEREINFACHTES MOCK ─────────────────────────────────────────────────
 * Jede Grösse hier hat GENAU den Typ, den die Produktionskomponente in Produktion bekommt
 * (`MonthlyTariffComparison`, `(number|null)[][]`, `LoadProfile` + `DispatchTrace`). Ein
 * vereinfachtes Mock hätte den Prüfstand um genau das gebracht, wofür er da ist: eine Komponente,
 * die unter echten Daten anders rendert als unter Prüfdaten, ist nicht gemessen.
 *
 * ── WOHER DIE ZAHLEN STAMMEN ───────────────────────────────────────────────────────────────────
 * Der Monatsvergleich trägt die DOKUMENTIERTEN Urbanz-Summen (769,73 / 890,07 / 685,85 € über 8
 * gemessene Monate, `CLAUDE.md` 02.09.2026) und die dort einzeln genannten Monatspaare wörtlich;
 * die drei nicht genannten Monate sind synthetisch und so gewählt, dass alle drei Spaltensummen
 * die dokumentierten Werte exakt treffen — dasselbe Vorgehen wie im Spike (§0).
 * Heatmap und Lastgang sind synthetisch und als solche gekennzeichnet: für sie liegt keine
 * dokumentierte Zahlenreihe vor, und eine zu erfinden, die wie eine Messung aussieht, wäre der
 * schlechtere Weg. Was an ihnen ECHT ist, ist die Struktur.
 */

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * 1 — kategorial/Balken: Monatsvergleich (Recharts `BarChart`)
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * ⚠ WÖRTLICH aus `CLAUDE.md` (02.09.2026): Jän 34,59/26,47 · Feb 267,14/245,79 · Jun 16,80/15,91 ·
 * Aug 37,38/35,20 (je Ist-Tarif / mit Speicher) und Apr 87,92 gegen 154,29. Mär, Mai und Jul sind
 * SYNTHETISCH und tragen genau die Differenz zu den dokumentierten Spaltensummen.
 * Sep–Dez sind `null` — kein Messwert, ausdrücklich keine 0 (die sähe aus wie „gemessen, kostet
 * nichts"; die Komponente spart solche Monate aus).
 */
export const MONTHLY_COMPARISON_FIXTURE: MonthlyTariffComparison = {
  currentTariffEur: [34.59, 267.14, 118.4, 154.29, 74.13, 16.8, 67.0, 37.38, null, null, null, null],
  spotWithoutControlEur: [30.0, 340.07, 150.0, 120.0, 95.0, 20.0, 90.0, 45.0, null, null, null, null],
  spotWithBatteryEur: [26.47, 245.79, 128.0, 87.92, 78.56, 15.91, 68.0, 35.2, null, null, null, null],
  coveredMonths: 8,
  /* Ebenfalls dokumentiert (02.09.2026): Netz 30,92 € · Lieferant 0,00 € · aWATTar 33,07 €. */
  fixedCosts: {
    networkBaseFeeEur: 30.92,
    supplierBaseFeeEur: 0,
    awattarBaseFeeEur: 33.07,
    supplierFeeEurPerMonth: 0,
    awattarFeeEurPerMonth: 4.79,
    coveredDays: 210,
  },
}

/** Die dokumentierten Spaltensummen — der Prüfstand rechnet sie nach, statt sie zu behaupten. */
export const MONTHLY_COMPARISON_TOTALS = {
  currentTariffEur: 769.73,
  spotWithoutControlEur: 890.07,
  spotWithBatteryEur: 685.85,
} as const

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * 2 — Raster/Heatmap: Netto-Batteriefluss je Stunde × Monat (CSS-Grid, KEIN SVG)
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * SYNTHETISCH, aber der Form nach dem dokumentierten Befund nachgebildet: die Hauptladestunde
 * wandert zwischen Februar und März von der Nacht in die Mittagszeit (`CLAUDE.md` 02.09.2026,
 * Urbanz: Jän 22h · Feb 23h · Mär 12h · Apr 13h · Mai 13h · Jun 13h · Jul 12h · Aug 11h). Genau
 * diese Wanderung ist die Aussage des Charts — eine gleichverteilte Zufallsmatrix hätte den
 * Prüfstand grün gemacht und die Grafik sinnlos.
 *
 * Sep–Dez sind durchgehend `null`: die leere Zelle (gestrichelter Rand) ist ein eigener Zustand der
 * Komponente und gehört in eine Prüfung, die ihre Darstellung misst.
 */
const PEAK_CHARGE_HOUR = [22, 23, 12, 13, 13, 13, 12, 11] as const

export function buildBatteryFlowFixture(): (number | null)[][] {
  const grid: (number | null)[][] = []
  for (let hour = 0; hour < 24; hour++) {
    const row: (number | null)[] = []
    for (let month = 0; month < 12; month++) {
      const peak = PEAK_CHARGE_HOUR[month]
      if (peak === undefined) {
        row.push(null)
        continue
      }
      /* Abstand zur Hauptladestunde, zyklisch über den Tag. */
      const distance = Math.min(Math.abs(hour - peak), 24 - Math.abs(hour - peak))
      const charge = distance <= 2 ? (3 - distance) * 42 : 0
      /* Entladen am Abend (17–21 Uhr), wenn Last und Preis hoch sind. */
      const discharge = hour >= 17 && hour <= 21 ? -(70 - Math.abs(hour - 19) * 18) : 0
      const net = charge + discharge
      row.push(Math.round(net * 10) / 10)
    }
    grid.push(row)
  }
  return grid
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * 3 — kontinuierlich mit grosser Punktzahl: Jahres-Lastgang (Recharts `ComposedChart`)
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Ein voller Jahrgang im 15-min-Gitter — **35.040 Messwerte**, also die Grösse, um die es geht.
 * Der Spike hat gemessen, dass react-pdf 35.040 Punkte zwar problemlos verarbeitet (85 ms, 170 kB),
 * das gerenderte Blatt aber einen geschlossenen Block zeigt statt einer lesbaren Kurve: bei 300 dpi
 * trägt die Satzbreite höchstens rund 2.150 unterscheidbare X-Positionen. `downsampleMinMax` ist
 * deshalb auf diesem Weg genauso Pflicht wie am Bildschirm (Spike §4, Delta D2).
 *
 * ⚠ Der Prüfstand ruft `downsampleMinMax` NICHT selbst auf. Er mountet `LoadChart` mit dem VOLLEN
 * Profil und zählt danach die Stützpunkte im erzeugten SVG — nur so ist gemessen, dass die
 * Reduktion auf dem ECHTEN Weg zum Chart durchläuft und nicht bloss im Prüfstand nachgestellt wird.
 */
const YEAR_START_MS = Date.parse('2024-12-31T23:00:00.000Z')
const SLOT_MS = 15 * 60 * 1000
const SLOTS_PER_YEAR = 365 * 96

/** Deterministisch — dieselbe Prüfung liefert dasselbe Bild (mulberry32, wie in `dev-fixtures/`). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Der eine dominante Jahreshöchstwert — Slot-Index und Höhe, damit die Prüfung ihn benennen kann. */
const ANNUAL_PEAK_SLOT = 40 * 96 + 25
const ANNUAL_PEAK_KW = 50.78
/** Kapp-Schwelle wie beim Demo-Bäcker unter `annual_max` (`CLAUDE.md`): Spitze − Batterieleistung. */
export const LOAD_FIXTURE_CAP_KW = 20.78

let loadProfileCache: LoadProfile | null = null

export function buildLoadProfileFixture(): LoadProfile {
  if (loadProfileCache) return loadProfileCache

  const random = mulberry32(20260903)
  const readings: LoadProfile['readings'] = []

  for (let slot = 0; slot < SLOTS_PER_YEAR; slot++) {
    const ms = YEAR_START_MS + slot * SLOT_MS
    const dayOfYear = Math.floor(slot / 96)
    const quarter = slot % 96
    const hour = quarter / 4
    /* 31.12.2024 war ein Dienstag; Slot 0 liegt am 01.01. Ortszeit (Mittwoch). */
    const weekday = (dayOfYear + 3) % 7
    const isWeekend = weekday === 0 || weekday === 6

    /* Jahresgang: im Winter mehr Grundlast (Heizung/Beleuchtung). */
    const seasonal = 1 + 0.22 * Math.cos((2 * Math.PI * dayOfYear) / 365)

    let kw = 3.2 * seasonal
    if (!isWeekend) {
      /* Ofen-Anlauf am frühen Morgen, danach Geschäftstag. */
      if (hour >= 4 && hour < 7) kw += 9 + 14 * Math.sin(((hour - 4) / 3) * Math.PI)
      else if (hour >= 7 && hour < 18) kw += 9.5
      else if (hour >= 18 && hour < 21) kw += 3.5
    } else if (hour >= 8 && hour < 14) {
      kw += 3.0
    }
    kw += random() * 1.6

    if (slot === ANNUAL_PEAK_SLOT) kw = ANNUAL_PEAK_KW
    /* Zwei weitere hohe Spitzen, damit die abgefangenen Spitzen im Chart mehr als ein Punkt sind. */
    if (slot === ANNUAL_PEAK_SLOT + 1) kw = 44.2
    if (slot === 205 * 96 + 53) kw = 38.6

    readings.push({ ts: new Date(ms).toISOString(), gridPowerKw: Math.round(kw * 1000) / 1000 })
  }

  loadProfileCache = {
    readings,
    intervalMinutes: 15,
    timezoneMeta: 'Europe/Vienna',
    source: 'net_signed',
  }
  return loadProfileCache
}

/**
 * B23c-3b-2 — DERSELBE Lastgang, auf die Monate Jänner bis August GEKÜRZT.
 *
 * ── ⚠ EINE KÜRZUNG IST KEINE ZWEITE GRUNDLAGE ─────────────────────────────────────────────────
 * `summary-fixtures.ts` begründet, warum es für diese Prüfroute nur EINEN Lastgang gibt: ein
 * zweiter wäre eine zweite Grundlage, gegen die niemand die übrigen Läufe mehr vergleichen könnte.
 * Das gilt hier NICHT — jeder Messwert dieses Profils ist Zeichen für Zeichen einer des vollen
 * Jahrgangs, es fehlen nur die letzten vier Monate. Was daran gemessen wird, ist damit gegen den
 * Volljahres-Lauf unmittelbar vergleichbar.
 *
 * ── ⚠ WOZU ER GEBRAUCHT WIRD ──────────────────────────────────────────────────────────────────
 * Die Stunden-Heatmap unterscheidet eine LEERE Zelle (kein Messwert, durchsichtig mit
 * gestricheltem Rand) von einer GEMESSENEN NULL (hellste Stufe der Skala). Der Unterschied ist bei
 * einem Teiljahres-Lastgang „die halbe Grafik" (so der Kopf der Komponente) — am Volljahrgang gibt
 * es ihn gar nicht zu sehen: dort ist keine einzige Zelle leer (`emptyCells = 0`), und eine
 * Farbprobe könnte nichts finden, was es nicht gibt. D15 hat den Nachweis am B23b-Fixture geführt
 * und als offenen Punkt benannt, dass er an einem ECHTEN, durch den Analyse-Worker gerechneten
 * Teiljahres-Lastgang noch aussteht. Genau dafür ist dieses Profil da.
 *
 * ── GEFILTERT NACH LOKALEM MONAT, NICHT NACH EINER SLOT-ZAHL ──────────────────────────────────
 * Eine abgezählte Zahl von Vierteljahresstunden träfe die Monatsgrenze um Stunden daneben: die
 * Zeitumstellung Ende März verschiebt die Ortszeit gegenüber der gleichmässigen UTC-Achse um eine
 * Stunde, und ein „243 Tage"-Schnitt reichte damit in den September hinein — die Heatmap hätte in
 * der Septemberspalte zwei belegte Zellen und 22 leere, und der Prüflauf müsste erklären, warum.
 * Gefiltert wird deshalb über DIESELBE Wanduhr-Ableitung, mit der die Engine die Heatmap-Spalten
 * bildet (`localMonthIndex` ↔ `utcMsToLocalFields`).
 */
const PARTIAL_YEAR_LAST_MONTH_INDEX = 7 /* August */

let partialProfileCache: LoadProfile | null = null

export function buildPartialYearLoadProfileFixture(): LoadProfile {
  if (partialProfileCache) return partialProfileCache

  const full = buildLoadProfileFixture()
  partialProfileCache = {
    ...full,
    readings: full.readings.filter(
      (r) =>
        localMonthIndex(Date.parse(r.ts), full.timezoneMeta) <= PARTIAL_YEAR_LAST_MONTH_INDEX,
    ),
  }
  return partialProfileCache
}

/**
 * Der Trace zum Lastgang oben.
 *
 * ⚠ `representativeDays` ist LEER, und das ist kein vergessenes Feld: `LoadChart` liest
 * ausschliesslich `capKwByPeriod` und `caughtPeaks` (der Tages-Energiefluss ist ein anderer Chart
 * und gehört zu den vier, die B23c migriert). Ein erfundener Tagesverlauf stünde hier als Datum da,
 * das nichts prüft.
 *
 * `caughtPeaks` wird AUS dem erzeugten Profil abgeleitet statt danebengeschrieben — die Marker
 * sitzen dadurch garantiert auf echten Punkten der Kurve.
 */
export function buildDispatchTraceFixture(): DispatchTrace {
  const profile = buildLoadProfileFixture()
  const top = [...profile.readings]
    .map((r, index) => ({ index, ts: r.ts, kw: r.gridPowerKw }))
    .sort((a, b) => b.kw - a.kw)
    .slice(0, 10)

  return {
    capKwByPeriod: [LOAD_FIXTURE_CAP_KW],
    caughtPeaks: top
      .filter((p) => p.kw > LOAD_FIXTURE_CAP_KW)
      .map((p) => ({
        ts: p.ts,
        originalKw: p.kw,
        residualKw: LOAD_FIXTURE_CAP_KW,
        caught: true,
      })),
    representativeDays: [],
  }
}

/**
 * B23c-4 — DERSELBE Volljahrgang mit EINER grossen, linear interpolierten Lücke.
 *
 * ── ⚠ WOZU ER GEBRAUCHT WIRD ──────────────────────────────────────────────────────────────────
 * Der Datenlücken-Hinweis bei der Kern-Kennzahl hängt an `dataQuality.largestGapSlots` — der
 * LÄNGSTEN zusammenhängenden Lücke, nicht ihrer Summe. Der Volljahrgang trägt keine (er ist
 * lückenlos erzeugt), und die Zahl bloss in die Datenqualität zu schreiben wäre eine Angabe über
 * ein Profil, das sie nicht hat. Hier wird die Lücke tatsächlich gebaut: die Werte des Zeitraums
 * sind linear zwischen seinen Rändern aufgefüllt, genau wie der Parser es täte
 * (`prepareSeries`) — die Zeitstempel bleiben vollständig, der Zeitraum sieht deshalb abgedeckt
 * aus und hat trotzdem keine Substanz. Genau das ist die Aussage des Hinweises.
 *
 * ── DIE LAGE IST GEWÄHLT UND NICHT ZUFÄLLIG ───────────────────────────────────────────────────
 * Sie liegt weit hinter dem dominanten Jahreshöchstwert (Tag 40) und vor der dritten hohen Spitze
 * (Tag 205): keine der drei Spitzen, an denen die übrigen Läufe gemessen werden, fällt in die
 * Lücke. Was sich zwischen diesem Lauf und dem Volljahres-Lauf unterscheidet, ist damit die Lücke
 * und nicht eine verschwundene Spitze.
 *
 * ⚠ 30 Tage = 2.880 Slots, also oberhalb von `LARGE_GAP_SLOTS_THRESHOLD` (2.688 = 4 Wochen). Die
 * Zahl ist bewusst nicht knapp darüber gewählt: eine Lücke von 2.689 Slots prüfte die Schwelle,
 * nicht den Hinweis, und ein Report, in dem „28 Tage" steht, liest sich wie ein Grenzfall.
 */
const GAP_START_SLOT = 100 * 96
export const GAP_LENGTH_SLOTS = 30 * 96

let gapProfileCache: LoadProfile | null = null

export function buildGapLoadProfileFixture(): LoadProfile {
  if (gapProfileCache) return gapProfileCache

  const full = buildLoadProfileFixture()
  const before = full.readings[GAP_START_SLOT - 1]!
  const after = full.readings[GAP_START_SLOT + GAP_LENGTH_SLOTS]!
  const span = GAP_LENGTH_SLOTS + 1

  gapProfileCache = {
    ...full,
    readings: full.readings.map((reading, index) => {
      if (index < GAP_START_SLOT || index >= GAP_START_SLOT + GAP_LENGTH_SLOTS) return reading
      const step = (index - (GAP_START_SLOT - 1)) / span
      const kw = before.gridPowerKw + (after.gridPowerKw - before.gridPowerKw) * step
      return { ts: reading.ts, gridPowerKw: Math.round(kw * 1000) / 1000 }
    }),
  }
  return gapProfileCache
}

/**
 * B23c-4 — DERSELBE Teiljahrgang, verschoben in das LAUFENDE Kalenderjahr.
 *
 * ── ⚠ DER EINZIGE FIXTURE-LASTGANG, DER VON DER UHR ABHÄNGT — UND ER MUSS ES ──────────────────
 * Der Preisstand-Hinweis (`tariffVintageNote`) erscheint genau dann, wenn der ausgewertete
 * Zeitraum in ein noch LAUFENDES Kalenderjahr reicht: dafür gibt es noch keine Jahresrechnung,
 * die eingetragenen Preise stammen also zwangsläufig aus einer älteren. Der Prüf-Lastgang deckt
 * ein abgeschlossenes Jahr ab; an ihm ist der Hinweis strukturell unerreichbar, und der positive
 * Zweig bliebe gebaut und ungemessen. Die Eigenschaft, um die es geht, IST der Bezug zur
 * heutigen Uhr — ein fest datiertes Profil kann sie nicht herstellen.
 *
 * ── VERSCHOBEN WIRD UM GANZE TAGE, UND DAS ENDE LIEGT IMMER IN DER VERGANGENHEIT ──────────────
 * Der letzte Messwert landet auf dem letzten Slot vor dem Beginn des laufenden Monats. Ein
 * Lastgang, der in die Zukunft reicht, wäre kein Prüffall, sondern ein Widerspruch; ganze Tage
 * halten die Ortszeit je Messwert stabil (bis auf die Zeitumstellung, die für die gemessene
 * Aussage ohne Belang ist).
 *
 * ⚠ IM JÄNNER ERSCHEINT DER HINWEIS NICHT, und das ist die richtige Antwort und kein Defekt:
 * die acht Monate vor einem Jänner enden im VORjahr, für das es sehr wohl eine Jahresrechnung
 * gibt. Wer in diesem Monat prüft, misst den negativen Zweig — und der Volljahres-Lauf misst ihn
 * ohnehin das ganze Jahr über.
 */
export function buildCurrentYearPartialLoadProfileFixture(now: Date): LoadProfile {
  const base = buildPartialYearLoadProfileFixture()
  const last = base.readings[base.readings.length - 1]!

  /* Beginn des laufenden Monats in ORTSZEIT — dieselbe Wanduhr, nach der gefiltert wurde. */
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: base.timezoneMeta,
    year: 'numeric',
    month: '2-digit',
  }).format(now)
  const monthStartMs = Date.parse(`${parts}-01T00:00:00Z`)

  const dayMs = 24 * 60 * 60 * 1000
  const shiftDays = Math.round((monthStartMs - Date.parse(last.ts)) / dayMs)
  const shiftMs = shiftDays * dayMs

  return {
    ...base,
    readings: base.readings.map((r) => ({
      ts: new Date(Date.parse(r.ts) + shiftMs).toISOString(),
      gridPowerKw: r.gridPowerKw,
    })),
  }
}
