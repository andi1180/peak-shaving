/**
 * PVGIS-Anbindung, REINE Seite (B22a) — Anfrage-Parameter und Auswertung der Antwort.
 *
 * Der Netzaufruf selbst liegt in `apps/website/lib/pvgis/client.ts`; hier steht ausschliesslich,
 * was OHNE Netz prüfbar ist: welche Parameter überhaupt hinausgehen dürfen und wie die Antwort zu
 * lesen ist. Dieselbe Trennung wie zwischen `packages/shared/src/invoice-scan.ts` (Schema +
 * Auswertung, getestet) und `apps/website/lib/invoice-scan/extract.ts` (der Aufruf).
 *
 * ── ⚠ WARUM DIE PARAMETER-PRÜFUNG HIER LIEGT UND NICHT IN DER APP ──────────────────────────────
 * `apps/website` hat keinen eigenen Testlauf (dieselbe Lage wie bei Delta 9b-2a). Eine Prüfkette,
 * die vor jedem externen Aufruf steht, ist aber genau die Stelle, die man gemessen haben will —
 * also gehört sie dorthin, wo sie geprüft werden kann. Sie ist rein: keine Uhr, kein I/O, kein
 * Netz.
 *
 * ── WAS HINAUSGEHT UND WAS NICHT (Prinzip 4) ───────────────────────────────────────────────────
 * Die Anfrage trägt Koordinate, Neigung, Ausrichtung, kWp und den Wetterjahr-Zeitraum. **Kein
 * Lastgang, kein Verbrauchswert, kein Zeitraum des Kunden.** Die Kopplung Verbrauch − Erzeugung
 * geschieht im Browser (`applyEstimatedPv`), nicht auf dem Server — deshalb liefert der Proxy ein
 * Referenzprofil zurück und nimmt keinen Lastgang entgegen.
 *
 * Die Entschärfung ist gemessen (Bestandsaufnahme 2.3): innerhalb einer Stadt (≤ 13 km) liegt der
 * Ertragsunterschied unter 1 %. Eine hausgenaue Koordinate bringt nichts Messbares — die Anwendung
 * muss also nie eine erheben.
 */

/**
 * Die gemittelten Wetterjahre (Pflichtenheft §2.1). KEIN Parameter der Oberfläche — eine Konstante,
 * die genau einmal steht und im Report zitiert wird.
 *
 * ⚠ PVGIS liefert ausschliesslich 2005–2023 (gemessen: `startyear=1990` → HTTP 400 mit genau dieser
 * Auskunft). Der Zeitraum eines 2025/26er-Lastgangs ist damit gar nicht lieferbar; eine Abbildung
 * ist unvermeidlich, und die einzige Frage ist, ob sie benannt wird. Gewählt ist das Zehn-Jahres-
 * Mittel, weil es der Klimanormale entspricht, mit der ein Fachplanungswerkzeug selbst rechnet
 * (PV*SOL/Meteonorm „Wien 11, AUT (1996–2015)"; Gegenrechnung 759,0 gegen 754,31 kWh/kWp = 0,6 %).
 */
export const PVGIS_WEATHER_YEARS = { from: 2014, to: 2023 } as const

/** Untere/obere Grenze der von PVGIS überhaupt gelieferten Wetterjahre (gemessen). */
export const PVGIS_AVAILABLE_YEARS = { from: 2005, to: 2023 } as const

/**
 * Systemverlust in Prozent, wie ihn PVGIS als `loss` erwartet.
 *
 * 14 % ist der Vorgabewert des Dienstes selbst (Verkabelung, Wechselrichter, Verschmutzung,
 * Alterung). Er steht hier als benannte Konstante und nicht als Eingabefeld: eine Auslegung nennt
 * ihn im Regelfall nicht, und ein aus dem Bauch anders gesetzter Wert wäre eine erfundene Zahl mit
 * seriösem Etikett — dieselbe Regel wie bei einem nicht hinterlegten Tarifsatz (B11).
 */
export const PVGIS_SYSTEM_LOSS_PERCENT = 14

/**
 * Die Auslegung einer Modulfläche, wie sie an PVGIS geht.
 *
 * ⚠ `azimuthDeg` ist die PVGIS-Konvention: **0 = Süd, −90 = Ost, +90 = West**. Ein Kompasswert
 * (0 = Nord, 180 = Süd) ist NICHT dasselbe — die Umrechnung gehört in die Oberfläche (B22b) und
 * geschieht dort an genau einer Stelle. Gemessen kostet die Verwechslung 56 % der ausgewiesenen
 * Ersparnis, und die falsche Zahl sieht völlig plausibel aus.
 */
export type PvgisArrayDesign = {
  latitudeDeg: number
  longitudeDeg: number
  /** Nennleistung der Modulfläche in kWp. PVGIS skaliert `P` bereits damit. */
  peakPowerKwp: number
  /** Neigung gegen die Horizontale, 0–90°. */
  slopeDeg: number
  /** PVGIS-Azimut, −180…180, 0 = Süd. */
  azimuthDeg: number
}

/**
 * Warum eine Anfrage GAR NICHT ERST hinausgeht. Bewusst getrennt von `pvgis_error` (dem einzigen
 * Zustand für einen fehlgeschlagenen externen Aufruf): eine hier abgelehnte Anfrage ist kein
 * Versagen des Dienstes, und sie so zu melden hiesse, PVGIS etwas anzulasten, das bei uns liegt.
 */
export type PvgisRequestRejection =
  | 'coordinate_out_of_range'
  | 'peak_power_out_of_range'
  | 'slope_out_of_range'
  | 'azimuth_out_of_range'

export type PvgisRequestCheck = { ok: true } | { ok: false; reason: PvgisRequestRejection }

/**
 * Obergrenze der Nennleistung.
 *
 * Sie ist eine SPERRE, keine Bedienhilfe: eine Server Action ist über ihre ID aufrufbar, und
 * unbegrenzte Parameter hiessen unbegrenzte Arbeit für einen fremden, kostenlosen Dienst. 2.000 kWp
 * ist weit über jeder Anlage, die dieser Rechner beurteilt (er rechnet den SPEICHER eines
 * Gewerbebetriebs), und schliesst zugleich aus, dass jemand über die Action Grosskraftwerke
 * durchrechnet.
 */
export const MAX_PEAK_POWER_KWP = 2000

/**
 * Prüft die Anfrage-Parameter VOR jedem externen Kontakt. Scheitert sie, entsteht kein Aufruf —
 * nicht „PVGIS lehnt ab", sondern der Dienst wird gar nicht erst befragt (dieselbe Haltung wie in
 * `lib/invoice-scan/actions.ts`).
 *
 * Die Koordinatenschranke ist bewusst der volle Gültigkeitsbereich einer Koordinate und keine
 * Österreich-Box: der Rechner beurteilt heute österreichische Anlagen, aber eine Landesgrenze im
 * Prüfcode wäre eine fachliche Aussage, die hier niemand getroffen hat, und sie brächte beim ersten
 * grenznahen Standort eine Ablehnung ohne erklärbaren Grund.
 */
export function checkPvgisRequest(design: PvgisArrayDesign): PvgisRequestCheck {
  const { latitudeDeg, longitudeDeg, peakPowerKwp, slopeDeg, azimuthDeg } = design
  if (!isFiniteInRange(latitudeDeg, -90, 90) || !isFiniteInRange(longitudeDeg, -180, 180)) {
    return { ok: false, reason: 'coordinate_out_of_range' }
  }
  if (!Number.isFinite(peakPowerKwp) || peakPowerKwp <= 0 || peakPowerKwp > MAX_PEAK_POWER_KWP) {
    return { ok: false, reason: 'peak_power_out_of_range' }
  }
  if (!isFiniteInRange(slopeDeg, 0, 90)) return { ok: false, reason: 'slope_out_of_range' }
  if (!isFiniteInRange(azimuthDeg, -180, 180)) return { ok: false, reason: 'azimuth_out_of_range' }
  return { ok: true }
}

function isFiniteInRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max
}

/**
 * Die Abfrageparameter für `seriescalc`, als Schlüssel/Wert-Paare.
 *
 * ⚠ EIN Aufruf für ALLE zehn Wetterjahre (`startyear`/`endyear`), nicht zehn Aufrufe. Gemessen am
 * 02.09.2026 gegen den echten Dienst: ein Jahr 825.684 Bytes in 1,41 s, zehn Jahre 8.221.105 Bytes
 * in 7,80 s — dieselbe Datenmenge, aber EIN Aufruf statt zehn. Das ist gegenüber einem fremden,
 * kostenlosen Dienst die fairere Form (aWATTar-Fair-Use lässt grüssen), und es ist zugleich die
 * ehrlichere: entweder kommen alle zehn Jahre oder keines. Bei zehn Einzelaufrufen könnte ein
 * einzelner scheitern, und aus dem Zehn-Jahres-Mittel würde still ein Neun-Jahres-Mittel.
 */
export function pvgisSeriesCalcParams(design: PvgisArrayDesign): Record<string, string> {
  return {
    lat: String(design.latitudeDeg),
    lon: String(design.longitudeDeg),
    startyear: String(PVGIS_WEATHER_YEARS.from),
    endyear: String(PVGIS_WEATHER_YEARS.to),
    // Ohne `pvcalculation=1` liefert der Dienst NUR Wetter und kein `P` — dann müsste man
    // Transposition und Temperaturmodell selbst bauen (`tmy` ist aus demselben Grund kein Ersatz).
    pvcalculation: '1',
    peakpower: String(design.peakPowerKwp),
    loss: String(PVGIS_SYSTEM_LOSS_PERCENT),
    angle: String(design.slopeDeg),
    aspect: String(design.azimuthDeg),
    outputformat: 'json',
  }
}

/** Ein ausgewerteter Stundenwert der PVGIS-Reihe. */
export type PvgisHourlySample = {
  /** UTC-Millisekunden des STUNDENBEGINNS — der 10-min-Versatz ist entfernt (s. `parsePvgisTime`). */
  utcMs: number
  /** Wechselrichter-Ausgangsleistung in **kW** (PVGIS liefert `P` in W). */
  pvGenerationKw: number
}

/** Die von PVGIS zurückgespiegelten Eingaben — der Nachweis, mit welchen Annahmen gerechnet wurde. */
export type PvgisEchoedInputs = {
  latitudeDeg: number
  longitudeDeg: number
  elevationM: number
  peakPowerKwp: number
  systemLossPercent: number
  slopeDeg: number
  azimuthDeg: number
  radiationDb: string
}

export type PvgisSeriesParseOutcome =
  | { ok: true; samples: PvgisHourlySample[]; inputs: PvgisEchoedInputs }
  /**
   * `unexpected_shape` — die Antwort hat nicht die Form, die `seriescalc` liefert (fehlende Felder,
   * leere Reihe, unlesbarer Zeitstempel, `P` keine Zahl). Ein einziger Grund und ausdrücklich KEIN
   * „so gut wie möglich retten": eine halb gelesene Erzeugungsreihe wäre eine Kurve mit Löchern, und
   * die Löcher sähen im Ergebnis wie Wolken aus.
   */
  | { ok: false; reason: 'unexpected_shape' }

const RE_PVGIS_TIME = /^(\d{4})(\d{2})(\d{2}):(\d{2})(\d{2})$/

/**
 * `20200101:0010` → UTC-Millisekunden des STUNDENBEGINNS.
 *
 * ⚠ DER 10-MIN-VERSATZ WIRD ENTFERNT, NICHT ÜBERNOMMEN. `0010` bezeichnet den Beobachtungs-
 * zeitpunkt innerhalb der Stunde, nicht den Stundenanfang (am Sonnenhöhen-Maximum geprüft:
 * 21.06.2020, `11:10` UTC, `H_sun` 65,06° — der wahre Sonnenhöchststand in Wien). Übernommen läge
 * die ganze Erzeugungskurve um zehn Minuten daneben, und auf dem 15-min-Gitter des Rechners
 * verschöbe das jede Stundenkante in die falsche Viertelstunde.
 *
 * Die Minute wird deshalb VERWORFEN, nicht gerundet: der Dienst kann sie in einer künftigen Fassung
 * anders setzen (`:0000`, `:0030`), und eine Rundung machte daraus je nach Wert eine andere Stunde.
 */
export function parsePvgisTime(value: string): number | null {
  const m = RE_PVGIS_TIME.exec(value)
  if (!m) return null
  const [, y, mo, d, h] = m
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), 0, 0)
  return Number.isFinite(ms) ? ms : null
}

/**
 * Wertet die rohe `seriescalc`-Antwort aus. Fail closed: ein einziger unlesbarer Eintrag bricht die
 * ganze Auswertung ab, statt übersprungen zu werden — eine unbemerkte Lücke in der Erzeugungskurve
 * ist schlimmer als eine sichtbar gescheiterte Anfrage (dieselbe Regel wie beim aWATTar-Abruf,
 * B21-2a).
 */
export function parsePvgisSeries(raw: unknown): PvgisSeriesParseOutcome {
  if (!isRecord(raw)) return { ok: false, reason: 'unexpected_shape' }

  const inputs = readEchoedInputs(raw.inputs)
  if (!inputs) return { ok: false, reason: 'unexpected_shape' }

  const outputs = raw.outputs
  if (!isRecord(outputs) || !Array.isArray(outputs.hourly) || outputs.hourly.length === 0) {
    return { ok: false, reason: 'unexpected_shape' }
  }

  const samples: PvgisHourlySample[] = []
  for (const row of outputs.hourly) {
    if (!isRecord(row) || typeof row.time !== 'string' || typeof row.P !== 'number') {
      return { ok: false, reason: 'unexpected_shape' }
    }
    if (!Number.isFinite(row.P) || row.P < 0) return { ok: false, reason: 'unexpected_shape' }
    const utcMs = parsePvgisTime(row.time)
    if (utcMs == null) return { ok: false, reason: 'unexpected_shape' }
    // W → kW. Der Rechner arbeitet durchgehend in kW; die Einheit steht hier an genau einer Stelle.
    samples.push({ utcMs, pvGenerationKw: row.P / 1000 })
  }

  return { ok: true, samples, inputs }
}

function readEchoedInputs(value: unknown): PvgisEchoedInputs | null {
  if (!isRecord(value)) return null
  const location = value.location
  const meteo = value.meteo_data
  const pvModule = value.pv_module
  const mounting = isRecord(value.mounting_system) ? value.mounting_system.fixed : undefined
  if (!isRecord(location) || !isRecord(meteo) || !isRecord(pvModule) || !isRecord(mounting)) {
    return null
  }
  const slope = isRecord(mounting.slope) ? mounting.slope.value : undefined
  const azimuth = isRecord(mounting.azimuth) ? mounting.azimuth.value : undefined
  const fields = {
    latitudeDeg: location.latitude,
    longitudeDeg: location.longitude,
    elevationM: location.elevation,
    peakPowerKwp: pvModule.peak_power,
    systemLossPercent: pvModule.system_loss,
    slopeDeg: slope,
    azimuthDeg: azimuth,
  }
  for (const v of Object.values(fields)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null
  }
  if (typeof meteo.radiation_db !== 'string') return null
  return { ...(fields as Omit<PvgisEchoedInputs, 'radiationDb'>), radiationDb: meteo.radiation_db }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
