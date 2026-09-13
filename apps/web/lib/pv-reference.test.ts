import { readFileSync } from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * B24, Teil 1 (Phase A) — PRÜFUNG DER PV-REFERENZ-EXTRAKTOREN.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WARUM DIESE DATEI IN `apps/web` LIEGT UND NICHT NEBEN DEM GEPRÜFTEN CODE
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Der geprüfte Code liegt in `packages/extractors/src/pv-reference/`, und dieses Paket hat
 * BEWUSST keinen eigenen Testlauf — der Kommentar in seiner `tsconfig.json` sagt es im Klartext:
 * „`pnpm test` fasst es bewusst nicht an (was hier zu prüfen ist, ist der Weg DURCH die
 * Extraktoren, und der wird in `apps/web` gemessen)". Genau das geschieht hier.
 *
 * Es ist zugleich der Weg, den Phase B nehmen wird: `apps/web` importiert `extractors` über den
 * Barrel, und der Barrel ist der einzige Ausgang (`exports` gibt ausschliesslich `.` frei — ein
 * Deep-Import in das Verzeichnis löst von hier gar nicht auf). Was diese Datei prüft, ist also
 * nicht nur die Funktion, sondern die Erreichbarkeit über dieselbe Grenze wie in Produktion.
 *
 * ⚠ `apps/web` HÄNGT NICHT AN `packages/engine` (Absicht, B24 zweiter Bauschritt: der Chat soll den
 * Rechenkern nicht mitziehen). Deshalb wird hier KEIN Engine-Fixture importiert — weder
 * `__fixtures__/synthetic-series` noch die gekürzte echte PVGIS-Antwort. Die PVGIS-Wetterjahre
 * werden unten selbst erzeugt; das hält die Paketgrenze unangetastet und macht die erwarteten
 * Zahlen zugleich nachrechenbar, statt sie aus einer Fixture-Datei abzulesen.
 */

// `server-only` wirft beim Import ausserhalb einer React-Server-Umgebung. Ersetzt wird NUR diese
// Kante — die geprüften Module laufen echt, inklusive des Engine-Parsers dahinter.
vi.mock('server-only', () => ({}))

const {
  MAX_LOAD_PROFILE_FILE_BYTES,
  PV_REFERENCE_RATE_LIMIT_MAX_CALLS,
  checkPvGeneratorEligibility,
  fetchPvArrayReferenceProfile,
  resetPvReferenceRateLimit,
} = await import('extractors')

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// TEIL 1 — Anbietbarkeit: `checkPvGeneratorEligibility`
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const FIXTURES = new URL('../../../dev-fixtures/', import.meta.url)

function fixture(name: string): string {
  return readFileSync(new URL(name, FIXTURES), 'utf8')
}

function bytesOf(text: string): ArrayBuffer {
  const u8 = new TextEncoder().encode(text)
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
}

/** Zählt Datenzeilen (ohne Kopfzeile) mit negativem Messwert — die Prüfgrösse dieses Abschnitts. */
function negativeRows(csv: string): number {
  return csv.split('\n').filter((line) => /;-/.test(line)).length
}

describe('B24 Phase A — der PV-Generator wird NICHT angeboten, wo Einspeisung gemessen vorliegt', () => {
  /*
   * ⚠ DIE POSITIV-KONTROLLE IST EIN PAAR AUS EINER EINZIGEN DATEI, nicht aus zwei verschiedenen.
   * Zwei Fixtures unterschieden sich in beliebig vielen Eigenschaften; hier unterscheidet sich
   * GENAU eine — das Vorzeichen. Damit ist die gemessene Wirkung dem Vorzeichen zuzuordnen und
   * nichts anderem.
   */
  const mitEinspeisung = fixture('demo-baeckerei-mit-pv-netzlastgang-2023.csv')
  /** Dieselbe Datei, jedes Minuszeichen entfernt — sonst Zeichen für Zeichen identisch. */
  const ohneEinspeisung = mitEinspeisung.replace(/;-/g, ';')

  it('die Vorbedingung des Paares stimmt: dieselbe Datei, nur das Vorzeichen unterscheidet sich', () => {
    // Ohne diese Prüfung bewiese das Paar nichts — es könnten zwei beliebige Dateien sein.
    expect(negativeRows(mitEinspeisung)).toBeGreaterThan(5000)
    expect(negativeRows(ohneEinspeisung)).toBe(0)
    expect(mitEinspeisung.length - ohneEinspeisung.length).toBe(negativeRows(mitEinspeisung))
    expect(mitEinspeisung.split('\n').length).toBe(ohneEinspeisung.split('\n').length)
  })

  it('MIT negativen Werten: verweigert und begründet (§2.4)', () => {
    expect(
      checkPvGeneratorEligibility(bytesOf(mitEinspeisung), 'netzlastgang.csv'),
    ).toEqual({ offered: false, reason: 'measured_feed_in' })
  })

  it('DIESELBE Datei ohne negative Werte: angeboten', () => {
    expect(checkPvGeneratorEligibility(bytesOf(ohneEinspeisung), 'netzlastgang.csv')).toEqual({
      offered: true,
    })
  })

  it('ein reiner Bezugs-Lastgang wird angeboten — die zweite, unabhängige Positiv-Kontrolle', () => {
    // Eine ANDERE echte Datei, die nie Einspeisung trug: schliesst aus, dass das „angeboten" oben
    // eine Eigenschaft der Ersetzung ist statt eine des Inhalts.
    const csv = fixture('demo-baeckerei-lastgang-2023.csv')
    expect(negativeRows(csv)).toBe(0)
    expect(checkPvGeneratorEligibility(bytesOf(csv), 'lastgang.csv')).toEqual({ offered: true })
  })

  /*
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * ⚠ DER EIGENTLICHE WÄCHTER DIESES ABSCHNITTS
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * Die Vorzeichen-Erkennung des Parsers liest nur die ERSTEN 60 Zeilen (`parser/detect.ts`, dort
   * als `[ANNAHME]` vermerkt). Ein Lastgang, dessen erste Einspeisung spät liegt, wird deshalb als
   * `import_only` etikettiert — und eine Prüfung, die nur das ETIKETT läse, böte ihm den Generator
   * an. Die geschätzte Erzeugung käme dann zur gemessenen hinzu, und das Ergebnis sähe nicht falsch
   * aus, sondern nur besser.
   *
   * Dieser Fall ist zugleich der Wächter gegen die naheliegende „Vereinfachung": wer
   * `parseLoadProfile` durch den Metadaten-Leser (`readLoadProfile`) ersetzt, bekommt eine schnelle
   * Prüfung ohne Messwerte — sie bliebe bei jedem anderen Test hier grün und liesse genau diesen
   * Fall durch.
   */
  it('⚠ verweigert AUCH bei SPÄTER Einspeisung — jenseits der 60-Zeilen-Stichprobe des Parsers', () => {
    const csv = fixture('demo-baeckerei-lastgang-2023.csv')
    const lines = csv.split('\n')
    // Weit hinter der Stichprobe: eine einzige Zeile mitten im Jahr bekommt ein Minuszeichen.
    const target = 20_000
    const line = lines[target]
    expect(line).toBeDefined()
    lines[target] = `${line!.split(';')[0]};-4,20`
    const mutiert = lines.join('\n')

    // Die Vorbedingung, ohne die der Test nichts aussagt: in der Stichprobe ist NICHTS negativ.
    expect(negativeRows(lines.slice(0, 61).join('\n'))).toBe(0)
    expect(negativeRows(mutiert)).toBe(1)

    expect(checkPvGeneratorEligibility(bytesOf(mutiert), 'lastgang.csv')).toEqual({
      offered: false,
      reason: 'measured_feed_in',
    })
  })
})

describe('B24 Phase A — was NICHT geprüft werden kann, wird benannt statt verschwiegen', () => {
  it('mehrere Wert-Spalten: `ambiguous_columns`, es wird NICHT geraten', () => {
    /*
     * Ein echter Netzbetreiber-Export mit mehreren Zählpunkten (OP#4, Format A). Unter den nicht
     * zugeordneten Spalten sind EINSPEISE-Spalten — sie zu übergehen hiesse, den Generator
     * ausgerechnet dem Kunden anzubieten, dessen Einspeisung wir nur nicht aufgelöst haben.
     */
    const csv = fixture('netzbetreiber-eda-juni-2026.csv')
    expect(checkPvGeneratorEligibility(bytesOf(csv), 'eda.csv')).toEqual({
      offered: false,
      reason: 'ambiguous_columns',
    })
  })

  it('unlesbare Datei: `unreadable` MIT dem Grund des Parsers', () => {
    const out = checkPvGeneratorEligibility(bytesOf(''), 'leer.csv')
    expect(out).toEqual({ offered: false, reason: 'unreadable', code: 'empty' })
  })

  it('zu grosse Datei: `too_large`, und der Parser wird gar nicht erst bemüht', () => {
    const out = checkPvGeneratorEligibility(new ArrayBuffer(MAX_LOAD_PROFILE_FILE_BYTES + 1), 'x.csv')
    expect(out).toEqual({
      offered: false,
      reason: 'too_large',
      sizeBytes: MAX_LOAD_PROFILE_FILE_BYTES + 1,
      maxBytes: MAX_LOAD_PROFILE_FILE_BYTES,
    })
  })

  it('jeder Ausgang ausser dem Gutfall trägt einen Grund — nie ein stilles `offered: false`', () => {
    const faelle = [
      checkPvGeneratorEligibility(bytesOf(''), 'a.csv'),
      checkPvGeneratorEligibility(bytesOf('kein lastgang'), 'b.csv'),
      checkPvGeneratorEligibility(bytesOf(fixture('netzbetreiber-eda-juni-2026.csv')), 'c.csv'),
      checkPvGeneratorEligibility(new ArrayBuffer(MAX_LOAD_PROFILE_FILE_BYTES + 1), 'd.csv'),
    ]
    for (const f of faelle) {
      expect(f.offered).toBe(false)
      expect(f.offered === false && typeof f.reason === 'string' && f.reason.length > 0).toBe(true)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// TEIL 2 — PVGIS-Abruf: `fetchPvArrayReferenceProfile`
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Die zehn Wetterjahre als ROHE `seriescalc`-Antwort — in der Form, die PVGIS wirklich liefert.
 *
 * ⚠ DIE ERZEUGUNG IST ABSICHTLICH TRIVIAL: genau eine Stunde je Tag trägt Leistung, und zwar
 * `1000 W × Jahresfaktor`. Damit ist der Jahresertrag von Hand nachrechenbar (Tage × Faktor) —
 * eine realistische Tagesform machte die erwarteten Zahlen zu etwas, das man nur noch ablesen
 * kann. Der Jahresfaktor macht die zehn Jahre unterscheidbar; ohne ihn bliebe ein Test über
 * Mittel und Streuung auch dann grün, wenn nur ein einziges Jahr eingelesen würde.
 */
const YEAR_FROM = 2014
const YEAR_TO = 2023

function yearFactor(year: number): number {
  return 1 + (year - YEAR_FROM) * 0.02
}

/** `20200101:0010` — inklusive des 10-Minuten-Versatzes, den PVGIS wirklich setzt. */
function pvgisTime(ms: number): string {
  const d = new Date(ms)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}:${p(d.getUTCHours())}10`
}

function hourlyRows(): { time: string; P: number }[] {
  const rows: { time: string; P: number }[] = []
  const HOUR = 60 * 60 * 1000
  for (let year = YEAR_FROM; year <= YEAR_TO; year++) {
    const end = Date.UTC(year + 1, 0, 1)
    for (let ms = Date.UTC(year, 0, 1); ms < end; ms += HOUR) {
      const hour = new Date(ms).getUTCHours()
      rows.push({ time: pvgisTime(ms), P: hour === 12 ? 1000 * yearFactor(year) : 0 })
    }
  }
  return rows
}

/*
 * ⚠ DIE ZURÜCKGESPIEGELTEN EINGABEN SIND BEWUSST ANDERE ALS DIE ANGEFRAGTEN.
 * `echoed.slopeDeg`/`azimuthDeg` tragen hier 33/−47, angefragt werden unten 35/0. Nur so ist
 * prüfbar, dass die Zusammenfassung die ANTWORT des Dienstes ausweist und nicht eine Kopie unserer
 * eigenen Anfrage — und genau darauf beruht die Zusage, dass die Konventions-Umrechnung Kompass →
 * PVGIS an diesem Rücklauf end-to-end überprüfbar ist (Pflichtenheft §5 Punkt 2).
 */
const ECHOED_SLOPE = 33
const ECHOED_AZIMUTH = -47

function pvgisResponse(rows = hourlyRows()) {
  return {
    inputs: {
      location: { latitude: 48.2082, longitude: 16.3738, elevation: 186 },
      meteo_data: { radiation_db: 'PVGIS-SARAH3' },
      mounting_system: {
        fixed: { slope: { value: ECHOED_SLOPE }, azimuth: { value: ECHOED_AZIMUTH } },
      },
      pv_module: { peak_power: 10.2, system_loss: 14 },
    },
    outputs: { hourly: rows },
  }
}

const DESIGN = {
  latitudeDeg: 48.2082,
  longitudeDeg: 16.3738,
  peakPowerKwp: 10.2,
  slopeDeg: 35,
  azimuthDeg: 0,
}

/** Eine Attrappe, die den Rumpf NICHT bei jedem Aufruf neu baut (87.672 Zeilen). */
const RESPONSE = pvgisResponse()

/**
 * ⚠ DER PARAMETER IST NICHT SCHMUCK: ohne ihn typt vitest `mock.calls` als leeres Tupel, und der
 * Zugriff auf die aufgerufene URL bricht den Typecheck (TS2493) — bei grünem Testlauf, weil vitest
 * ohne Typprüfung transpiliert. Genau die URL ist hier aber die Prüfgrösse.
 */
function okFetch() {
  return vi.fn(async (_url: string) => ({ ok: true, status: 200, json: async () => RESPONSE }))
}

beforeEach(() => {
  resetPvReferenceRateLimit()
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetPvReferenceRateLimit()
})

describe('B24 Phase A — `fetchPvArrayReferenceProfile`: EIN Array, EIN Aufruf', () => {
  it('fragt GENAU EINMAL, mit allen Auslegungs-Parametern und dem vollen Wetterjahr-Zeitraum', async () => {
    const f = okFetch()
    vi.stubGlobal('fetch', f)

    const out = await fetchPvArrayReferenceProfile(DESIGN)
    expect(out.ok).toBe(true)

    // ⚠ EIN Aufruf für zehn Wetterjahre, nicht zehn — bei Einzelaufrufen könnte einer scheitern,
    // und aus dem Zehn-Jahres-Mittel würde still ein Neun-Jahres-Mittel.
    expect(f).toHaveBeenCalledTimes(1)

    const url = new URL(String(f.mock.calls[0]![0]))
    expect(url.origin + url.pathname).toBe('https://re.jrc.ec.europa.eu/api/v5_3/seriescalc')
    expect(url.searchParams.get('lat')).toBe('48.2082')
    expect(url.searchParams.get('lon')).toBe('16.3738')
    expect(url.searchParams.get('peakpower')).toBe('10.2')
    // ⚠ `angle` ist die Neigung, `aspect` der PVGIS-Azimut. Vertauscht liefe die Anfrage sauber
    // durch und lieferte eine völlig plausible, falsche Zahl.
    expect(url.searchParams.get('angle')).toBe('35')
    expect(url.searchParams.get('aspect')).toBe('0')
    expect(url.searchParams.get('startyear')).toBe(String(YEAR_FROM))
    expect(url.searchParams.get('endyear')).toBe(String(YEAR_TO))
    expect(url.searchParams.get('pvcalculation')).toBe('1')
  })

  it('liefert die Jahreserträge EINZELN — die Grundlage der Streuung über MEHRERE Flächen', async () => {
    vi.stubGlobal('fetch', okFetch())
    const out = await fetchPvArrayReferenceProfile(DESIGN)
    if (!out.ok) throw new Error(`erwartet ok, war ${out.reason}`)

    const { annualYields } = out.summary
    expect(annualYields.map((y) => y.year)).toEqual([
      2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023,
    ])

    // Von Hand nachgerechnet: eine Stunde je Tag zu 1 kW × Jahresfaktor.
    expect(annualYields[0]!.kwh).toBeCloseTo(365 * 1.0, 9) // 2014
    expect(annualYields[2]!.kwh).toBeCloseTo(366 * 1.04, 9) // 2016 — Schaltjahr
    expect(annualYields[9]!.kwh).toBeCloseTo(365 * 1.18, 9) // 2023
  })

  it('fasst die Streuung zusammen und nennt den Glättungs-Aufschlag', async () => {
    vi.stubGlobal('fetch', okFetch())
    const out = await fetchPvArrayReferenceProfile(DESIGN)
    if (!out.ok) throw new Error(`erwartet ok, war ${out.reason}`)

    const kwh = out.summary.annualYields.map((y) => y.kwh)
    const mean = kwh.reduce((s, v) => s + v, 0) / kwh.length
    const min = Math.min(...kwh)
    const max = Math.max(...kwh)

    expect(out.summary.spread.meanKwh).toBeCloseTo(mean, 9)
    expect(out.summary.spread.minKwh).toBeCloseTo(min, 9)
    expect(out.summary.spread.maxKwh).toBeCloseTo(max, 9)
    // Die „± x %"-Angabe des Reports ist die HALBE Spannweite.
    expect(out.summary.spread.spreadPercent).toBeCloseTo(((max - min) / 2 / mean) * 100, 9)

    expect(out.summary.weatherYears).toEqual({ from: YEAR_FROM, to: YEAR_TO })
    /*
     * ⚠ Der systematische Aufschlag der Glättung reist MIT — er ist eine Eigenschaft des
     * Verfahrens und gilt für diesen Weg genauso wie für den öffentlichen Rechner. Ihn dort zu
     * nennen und hier zu verschweigen hiesse, dass derselbe Vorbehalt je nach Einstieg erscheint.
     */
    expect(out.summary.smoothingOptimismPercent).toBe(4.9)
  })

  it('⚠ weist die ZURÜCKGESPIEGELTEN Eingaben aus, nicht unsere eigenen', async () => {
    vi.stubGlobal('fetch', okFetch())
    const out = await fetchPvArrayReferenceProfile(DESIGN)
    if (!out.ok) throw new Error(`erwartet ok, war ${out.reason}`)

    // Die Antwort trägt 33/−47, angefragt wurden 35/0 — eine Kopie der Anfrage sähe hier 35/0.
    expect(out.summary.echoed.slopeDeg).toBe(ECHOED_SLOPE)
    expect(out.summary.echoed.azimuthDeg).toBe(ECHOED_AZIMUTH)
    expect(out.summary.echoed.slopeDeg).not.toBe(DESIGN.slopeDeg)
    expect(out.summary.echoed.azimuthDeg).not.toBe(DESIGN.azimuthDeg)
    expect(out.summary.echoed.radiationDb).toBe('PVGIS-SARAH3')
    expect(out.summary.echoed.elevationM).toBe(186)
    expect(out.summary.echoed.systemLossPercent).toBe(14)
  })

  /*
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * ⚠ DIE ZUSAGE, AUF DIE ES ANKOMMT: KEINE ROHREIHE IM RÜCKGABEWERT
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * `PvReferenceProfile.hourlyKw` trägt 8.760 Werte. Sie enden hinter der Paketgrenze. Geprüft
   * wird das am ERGEBNIS und nicht am Typ: ein Typ-Test bliebe grün, wenn jemand die Reihe unter
   * einem anderen Namen mitschickte.
   */
  it('gibt KEINE Erzeugungsreihe heraus — nur verdichtete Kennzahlen', async () => {
    vi.stubGlobal('fetch', okFetch())
    const out = await fetchPvArrayReferenceProfile(DESIGN)
    if (!out.ok) throw new Error(`erwartet ok, war ${out.reason}`)

    const längsteListe = (v: unknown): number => {
      if (Array.isArray(v)) return Math.max(v.length, ...v.map(längsteListe), 0)
      if (v && typeof v === 'object') return Math.max(0, ...Object.values(v).map(längsteListe))
      return 0
    }
    // Zehn Wetterjahre sind die längste Liste, die hier vorkommen darf.
    expect(längsteListe(out.summary)).toBe(10)

    const serialisiert = JSON.stringify(out.summary)
    expect(serialisiert).not.toContain('hourlyKw')
    // 8.760 Zahlen wären selbst sparsam geschrieben weit über 30 kB.
    expect(serialisiert.length).toBeLessThan(4000)
  })
})

describe('B24 Phase A — was gar nicht erst hinausgeht, und was der Dienst nicht beantworten konnte', () => {
  it('ungültige Auslegung: `invalid_request`, und es wird NICHT gefragt', async () => {
    const f = okFetch()
    vi.stubGlobal('fetch', f)

    const out = await fetchPvArrayReferenceProfile({ ...DESIGN, peakPowerKwp: 0 })
    expect(out).toEqual({
      ok: false,
      reason: 'invalid_request',
      rejection: 'peak_power_out_of_range',
    })
    // ⚠ Die Prüfung steht VOR jedem externen Kontakt — nicht „PVGIS lehnt ab".
    expect(f).not.toHaveBeenCalled()
  })

  it('jeder Ablehnungsgrund der Auslegung kommt benannt zurück', async () => {
    const f = okFetch()
    vi.stubGlobal('fetch', f)

    const faelle: [Partial<typeof DESIGN>, string][] = [
      [{ latitudeDeg: 95 }, 'coordinate_out_of_range'],
      [{ longitudeDeg: 200 }, 'coordinate_out_of_range'],
      [{ peakPowerKwp: 5000 }, 'peak_power_out_of_range'],
      [{ slopeDeg: 120 }, 'slope_out_of_range'],
      [{ azimuthDeg: 400 }, 'azimuth_out_of_range'],
    ]
    for (const [patch, rejection] of faelle) {
      expect(await fetchPvArrayReferenceProfile({ ...DESIGN, ...patch })).toEqual({
        ok: false,
        reason: 'invalid_request',
        rejection,
      })
    }
    expect(f).not.toHaveBeenCalled()
  })

  it('die Frequenzbremse greift VOR dem Aufruf und ist prozesslokal', async () => {
    // Non-200: der Platz im Zeitfenster wird trotzdem verbraucht, aber es wird nichts geparst —
    // so misst der Test die Bremse und nicht die Auswertung.
    const f = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }))
    vi.stubGlobal('fetch', f)

    for (let i = 0; i < PV_REFERENCE_RATE_LIMIT_MAX_CALLS; i++) {
      expect(await fetchPvArrayReferenceProfile(DESIGN)).toEqual({
        ok: false,
        reason: 'pvgis_error',
      })
    }
    expect(f).toHaveBeenCalledTimes(PV_REFERENCE_RATE_LIMIT_MAX_CALLS)

    expect(await fetchPvArrayReferenceProfile(DESIGN)).toEqual({ ok: false, reason: 'rate_limited' })
    // ⚠ Der entscheidende Teil: es ging NICHTS hinaus.
    expect(f).toHaveBeenCalledTimes(PV_REFERENCE_RATE_LIMIT_MAX_CALLS)
  })

  it('jeder Aussenfehler mündet in `pvgis_error` — ohne stillen Rückfall auf eine Ersatzkurve', async () => {
    const faelle: Record<string, () => unknown> = {
      'Non-200': () => vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
      Netzwerkfehler: () =>
        vi.fn(async () => {
          throw new Error('ECONNRESET')
        }),
      'unlesbarer Rumpf': () =>
        vi.fn(async () => ({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError('kein JSON')
          },
        })),
      'fremdes Schema': () => vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })),
    }

    for (const [name, make] of Object.entries(faelle)) {
      resetPvReferenceRateLimit()
      vi.stubGlobal('fetch', make())
      expect(await fetchPvArrayReferenceProfile(DESIGN), name).toEqual({
        ok: false,
        reason: 'pvgis_error',
      })
    }
  })

  it('⚠ ein unvollständiger Jahressatz ist ein Fehler, kein Neun-Jahres-Mittel', async () => {
    // Das letzte Wetterjahr fehlt. Still durchgelassen zitierte der Report eine Grundlage, die es
    // nicht gibt — und die Zahl sähe völlig plausibel aus.
    const neunJahre = hourlyRows().filter((r) => !r.time.startsWith(String(YEAR_TO)))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => pvgisResponse(neunJahre) })),
    )
    expect(await fetchPvArrayReferenceProfile(DESIGN)).toEqual({ ok: false, reason: 'pvgis_error' })
  })

  it('⚠ eine Lücke im Kalender ist ein Fehler, kein Loch in der Erzeugungskurve', async () => {
    // Ein einziger Kalendertag fehlt in ALLEN Jahren — die betroffenen Zellen blieben leer, und
    // der Kunde sähe 24 Stunden ohne Sonne mitten im Juni.
    const mitLücke = hourlyRows().filter((r) => !r.time.slice(4, 8).startsWith('0615'))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => pvgisResponse(mitLücke) })),
    )
    expect(await fetchPvArrayReferenceProfile(DESIGN)).toEqual({ ok: false, reason: 'pvgis_error' })
  })
})
