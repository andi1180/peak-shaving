import 'server-only'

import {
  PVGIS_WEATHER_YEARS,
  buildPvReferenceProfile,
  checkPvgisRequest,
  parseLoadProfile,
  parsePvgisSeries,
  pvgisSeriesCalcParams,
  type AnnualYield,
  type PvgisArrayDesign,
  type PvgisEchoedInputs,
  type PvgisRequestRejection,
} from 'engine'
import {
  PV_TEN_YEAR_SMOOTHING_OPTIMISM_PERCENT,
  summarizeAnnualYields,
  type AnnualYieldSpread,
} from 'shared'

import {
  PVGIS_ENDPOINT,
  PVGIS_TIMEOUT_MS,
  takePvReferenceRateLimitSlot,
} from './limits'
import { buildGeneratedPvSeriesFile, type GeneratedPvSeriesFile } from './generated-series'

/**
 * B24, Teil 1 — DER PVGIS-ABRUF DES ADMIN-WIZARDS (Phase A). EIN Array, EIN Aufruf.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WARUM ES DIESE DATEI ÜBERHAUPT GIBT, OBWOHL `apps/website/lib/pvgis/client.ts` DASSELBE TUT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Der öffentliche Rechner ruft PVGIS seit B22a über einen Proxy in `apps/website`. Der Wizard
 * liegt in `apps/web`, und die zwei Apps importieren einander NIE (kein Pfad-Alias, keine
 * Workspace-Abhängigkeit, kein einziger Import über die Grenze — der Kopf von `src/index.ts`
 * begründet das ausführlich). Es gab damit genau drei Möglichkeiten:
 *
 *   (a) den Aufruf in `apps/web` noch einmal ausschreiben — die Doppelung, gegen die dieses Paket
 *       gebaut wurde;
 *   (b) den Wizard über die Website rufen lassen — eine App-übergreifende Laufzeit-Abhängigkeit
 *       zwischen zwei getrennten Deployments, für einen Aufruf ohne Schlüssel;
 *   (c) die REGEL hierher holen, wo BEIDE Apps sie erreichen.
 *
 * Gebaut ist (c). Was hier steht, ist ausschliesslich der Netzweg; die Regeln, nach denen eine
 * Anfrage gebildet und eine Antwort gelesen wird, liegen unverändert in `packages/engine`
 * (`pv-generation/pvgis.ts` + `reference-profile.ts`) und sind dort geprüft — diese Datei erkennt
 * kein Format, mittelt kein Wetterjahr und rechnet keinen Ertrag.
 *
 * ⚠ `apps/website/lib/pvgis/client.ts` BLEIBT UNANGETASTET. Es ihn durch diesen Weg zu ersetzen
 * wäre naheliegend und ist ausdrücklich NICHT Teil dieses Schritts: jenes Modul ist die geprüfte,
 * live gemessene Fassung des öffentlichen Rechners, und ein Umbau daran gehört in einen eigenen
 * Schritt mit eigener Messung. Solange beide bestehen, ist die Doppelung BENANNT statt still.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ AUS DEM ABRUF KOMMEN KENNZAHLEN — DIE REIHE VERLÄSST DIESES PAKET NUR ALS FERTIGE DATEI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `PvReferenceProfile.hourlyKw` trägt 8.760 Werte. `fetchPvArrayReferenceProfile` lässt sie nicht
 * heraus: 8.760 Zahlen je Fläche durch eine Server Action und in einen `jsonb`-Entwurf zu reichen
 * wäre eine Fracht, die niemand angefordert hat — und der erste Aufrufer, der sie dort vorfindet,
 * speichert sie in den Entwurf.
 *
 * ⚠ DER ZWEITE GRUND, DER HIER STAND, IST GEFALLEN: „was der Wizard speichert, sind Eingaben; die
 * Kurve entsteht zur Rechenzeit neu." Das trägt nicht mehr. Eine zur Rechenzeit neu geholte Kurve
 * wäre ein zweiter PVGIS-Abruf mit womöglich anderen Wetterjahren — die Analyse eines Kunden hinge
 * damit an der Tagesform eines fremden Dienstes, und eine einmal abgegebene Auslegung würde still
 * nachgerechnet (B14-1 Regel a). Die geschätzte Reihe wird deshalb EINMAL gebaut und abgelegt;
 * `generateEstimatedPvSeries` weiter unten ist der Weg dorthin, und heraus kommt eine fertig
 * serialisierte Datei, keine Zahlenreihe im Entwurf.
 *
 * ── WAS HINAUSGEHT (Prinzip 4) ────────────────────────────────────────────────────────────────
 * Koordinate, Neigung, Ausrichtung, kWp und der Wetterjahr-Zeitraum. **Kein Lastgang, kein
 * Verbrauchswert, kein Zeitraum des Kunden, keine Projekt- oder Kontokennung.** Entschärft ist die
 * Koordinaten-Preisgabe gemessen und nicht argumentiert (B22a): innerhalb einer Stadt (≤ 13 km)
 * liegt der Ertragsunterschied unter 1 % — die Anwendung muss nie eine hausgenaue Koordinate
 * erheben, und die PLZ-Zentroide, die der Wizard führt, ist genau darauf ausgelegt.
 */

/**
 * Was ein PVGIS-Abruf über EINE Modulfläche verrät. Verdichtete Kennzahlen, keine Reihe.
 *
 * ⚠ DIE JAHRESERTRÄGE STEHEN EINZELN DA, UND DAS IST KEINE DEKORATION. Ein Zählpunkt trägt
 * regelmässig MEHRERE Modulflächen (Pflichtenheft §3(b)), und die Streuung über ALLE Flächen lässt
 * sich aus den Streuungen der einzelnen NICHT ableiten: dafür sind die Erträge je WETTERJAHR zu
 * summieren und erst die Summe zusammenzufassen. Wer hier nur `spread` vorfände, müsste den Abruf
 * wiederholen oder eine falsche Zahl bilden.
 */
export type PvArrayReferenceSummary = {
  /** Die gemittelten Wetterjahre, wie PVGIS sie geliefert hat. Gehört in den Report (§2.1). */
  weatherYears: { from: number; to: number }
  /** Jahresertrag je Wetterjahr in kWh, aufsteigend nach Jahr. Zehn Einträge — s. Kopf. */
  annualYields: readonly AnnualYield[]
  /** Mittel, Spanne und die „± x %"-Angabe DIESER Fläche. */
  spread: AnnualYieldSpread
  /**
   * Der systematische Aufschlag der Glättung, in Prozent.
   *
   * ⚠ ER REIST MIT, STATT NUR IM RECHNER ZU STEHEN. Die Zahl ist eine Eigenschaft des VERFAHRENS
   * (ein Zehn-Jahres-Mittel ist glatter als jedes einzelne Jahr, und eine geglättete Erzeugung
   * sättigt Speicher und Verbrauch seltener — B22a, 4,9 % höher als das Mittel der zehn einzeln
   * gerechneten Jahre, und höher als in JEDEM davon). Sie gilt für diesen Weg genauso wie für den
   * öffentlichen Rechner; sie dort zu nennen und hier zu verschweigen hiesse, dass derselbe
   * Vorbehalt je nach Einstieg erscheint oder nicht.
   *
   * Er steht ÜBER der Jahresstreuung, nicht darin: `spread` sagt, wie stark das Wetter schwankt,
   * diese Zahl sagt, dass die Schätzung darüber hinaus leicht optimistisch ist.
   */
  smoothingOptimismPercent: number
  /**
   * Was PVGIS als Eingaben ZURÜCKGESPIEGELT hat.
   *
   * ⚠ Das ist der Nachweis, womit tatsächlich gerechnet wurde — und die einzige Stelle, an der die
   * Konventions-Umrechnung Kompass → PVGIS end-to-end überprüfbar ist (Pflichtenheft §5 Punkt 2).
   * Eine Verwechslung kostet gemessen 56 % der ausgewiesenen Ersparnis, und die falsche Zahl sieht
   * völlig plausibel aus; sie ist nur an diesem Rücklauf zu erkennen.
   */
  echoed: PvgisEchoedInputs
}

/**
 * Die Ausgänge eines Abrufs. Diskriminiert — der Aufrufer muss verzweigen.
 *
 * ⚠ `invalid_request` UND `rate_limited` BEDEUTEN BEIDE: es ist NICHTS hinausgegangen. Sie sind
 * bewusst von `pvgis_error` getrennt, dem einzigen Zustand für einen fehlgeschlagenen externen
 * Aufruf — eine hier abgelehnte Anfrage ist kein Versagen des Dienstes, und sie so zu melden hiesse,
 * PVGIS etwas anzulasten, das bei uns liegt.
 *
 * ⚠ IN `pvgis_error` MÜNDET JEDER AUSSENFEHLER (Netzwerk, Zeitüberschreitung, Non-200, unlesbarer
 * Rumpf, unerwartetes Antwortschema, unvollständige Kalenderabdeckung, unerwarteter Jahressatz).
 * Für den Admin besteht zwischen ihnen kein Unterschied, und die Einzelheit geht ihn nichts an —
 * dieselbe Regel wie `unavailable` beim Rechnungs-Scan.
 *
 * ⚠ ES GIBT AUSDRÜCKLICH KEINEN STILLEN RÜCKFALL auf eine Ersatzkurve und keinen
 * `not_configured`-Zustand: eine erfundene Erzeugungsreihe wäre eine plausibel aussehende Zahl ohne
 * Grundlage (genau der Fehler, den B11 bei einem fehlenden Tarifsatz vermeidet), und einzurichten
 * ist hier nichts — ein solcher Zustand liesse einen Betriebsfehler vermuten, den es nicht geben
 * kann.
 */
export type PvArrayReferenceOutcome =
  | { ok: true; summary: PvArrayReferenceSummary }
  | { ok: false; reason: 'invalid_request'; rejection: PvgisRequestRejection }
  | { ok: false; reason: 'rate_limited' }
  | { ok: false; reason: 'pvgis_error' }

/**
 * Holt die zehn Wetterjahre EINER Modulfläche in EINEM Aufruf und verdichtet sie zu Kennzahlen.
 *
 * ⚠ EIN AUFRUF UND NICHT ZEHN — s. `pvgisSeriesCalcParams`. Gemessen ist es dieselbe Datenmenge
 * (8,2 MB), gegenüber einem fremden, kostenlosen Dienst die fairere Form, und fachlich die
 * ehrlichere: bei zehn Einzelaufrufen könnte einer scheitern, und aus dem Zehn-Jahres-Mittel würde
 * still ein Neun-Jahres-Mittel. Hier ist es alles oder nichts, und `buildPvReferenceProfile` prüft
 * den gelieferten Jahressatz zusätzlich nach.
 *
 * ⚠ EINE FLÄCHE JE AUFRUF, und das ist eine Entscheidung: zwei verschieden ausgerichtete Flächen
 * haben eine andere Tagesform als eine gemittelte, und ein zusammengefasster Wert („10,2 kWp bei
 * mittlerer Ausrichtung") wäre eine gerechnete Zahl, die nirgends dasteht (`PvArrayInput`, B22b).
 * Die Zusammenführung MEHRERER Flächen ist deshalb Sache des Aufrufers (Phase B) und braucht die
 * Erträge je Wetterjahr, die oben einzeln herauskommen.
 */
export async function fetchPvArrayReferenceProfile(
  design: PvgisArrayDesign,
): Promise<PvArrayReferenceOutcome> {
  const outcome = await fetchPvArrayReference(design)
  // Die 8.760 Stundenwerte enden an dieser Zeile — s. Kopf.
  return outcome.ok ? { ok: true, summary: outcome.summary } : outcome
}

/**
 * Derselbe Abruf, MIT der Stundenreihe — paketintern und ausdrücklich NICHT im Barrel.
 *
 * ⚠ DIE ZUSAGE DES KOPFES BLEIBT DAMIT BESTEHEN, sie wird nur genauer: die 8.760 Werte verlassen
 * dieses PAKET nicht (`package.json` gibt unter `exports` allein `.` frei, ein Deep-Import löst
 * gar nicht auf). Innerhalb des Pakets braucht sie genau ein Aufrufer —
 * `generateEstimatedPvSeries` weiter unten, der aus ihnen die abzulegende Reihe baut. Ohne diesen
 * Zwischenschritt müsste entweder die Reihe durch eine Server Action wandern oder der Abruf ein
 * zweites Mal geschehen.
 */
async function fetchPvArrayReference(
  design: PvgisArrayDesign,
): Promise<
  | { ok: true; summary: PvArrayReferenceSummary; hourlyKw: readonly number[] }
  | { ok: false; reason: 'invalid_request'; rejection: PvgisRequestRejection }
  | { ok: false; reason: 'rate_limited' }
  | { ok: false; reason: 'pvgis_error' }
> {
  /*
   * DIE PRÜFUNG LÄUFT VOR JEDEM EXTERNEN KONTAKT. Scheitert sie, entsteht kein Aufruf — nicht
   * „PVGIS lehnt ab", sondern der Dienst wird gar nicht erst befragt. Dieselbe Haltung wie in
   * `lib/invoice-scan/actions.ts` und im Proxy des öffentlichen Rechners.
   */
  const check = checkPvgisRequest(design)
  if (!check.ok) return { ok: false, reason: 'invalid_request', rejection: check.reason }
  if (!takePvReferenceRateLimitSlot(Date.now())) return { ok: false, reason: 'rate_limited' }

  const url = `${PVGIS_ENDPOINT}?${new URLSearchParams(pvgisSeriesCalcParams(design)).toString()}`

  /*
   * ⚠ `cache` STEHT NICHT IM `RequestInit` DIESES PAKETS — beim Bauen gemessen, nicht vermutet.
   *
   * `packages/extractors` typt gegen `@types/node` (`"types": ["node"]` in der tsconfig), also
   * gegen das undici-`RequestInit`; dort gibt es das Feld nicht, und ein Objektliteral mit `cache`
   * bricht den Typecheck mit TS2353. Im öffentlichen Rechner fällt das nicht auf: `apps/website`
   * typt gegen die DOM-Lib, in der Next das Feld erweitert — derselbe Aufruf ist dort gültig.
   *
   * Es ist damit die ERSTE Stelle dieses Pakets, die überhaupt `fetch` ruft (ausgezählt), und die
   * erste, an der die zwei Typwelten auseinandergehen. Die Absicht bleibt trotzdem im Code, statt
   * sich auf eine Voreinstellung zu verlassen: Next 15 ruft `fetch` zwar ohnehin ungepuffert, aber
   * das ist eine Framework-Voreinstellung, die sich ändern kann — und die Antwort ist 8 MB gross,
   * also nichts, was je in einen Zwischenspeicher gehört. Ausgedrückt als getypte Erweiterung und
   * ausdrücklich NICHT als `as`-Umgehung: so steht das Feld genau einmal und nachlesbar da.
   */
  const init: RequestInit & { cache?: 'no-store' } = {
    cache: 'no-store',
    signal: AbortSignal.timeout(PVGIS_TIMEOUT_MS),
  }

  let raw: unknown
  try {
    const response = await fetch(url, init)
    if (!response.ok) return { ok: false, reason: 'pvgis_error' }
    raw = await response.json()
  } catch {
    // Netzwerk, Zeitüberschreitung, unlesbarer Rumpf — nach aussen dasselbe.
    return { ok: false, reason: 'pvgis_error' }
  }

  const parsed = parsePvgisSeries(raw)
  if (!parsed.ok) return { ok: false, reason: 'pvgis_error' }

  const profile = buildPvReferenceProfile(parsed.samples, parsed.inputs, PVGIS_WEATHER_YEARS)
  if (!profile.ok) return { ok: false, reason: 'pvgis_error' }

  const spread = summarizeAnnualYields(profile.profile.annualYields.map((y) => y.kwh))
  if (spread === null) {
    /*
     * Strukturell unerreichbar: `buildPvReferenceProfile` hat soeben geprüft, dass GENAU die zehn
     * angeforderten Wetterjahre geliefert wurden — die Liste kann also nicht leer sein. Trotzdem
     * behandelt statt mit `!` behauptet: eine Nicht-Null-Zusicherung wäre eine Aussage über eine
     * fremde Funktion, und `summarizeAnnualYields` liefert `null` für „keine Angabe", nicht für
     * „Streuung 0". Fail closed ist hier billig und die Behauptung wäre es nicht.
     */
    return { ok: false, reason: 'pvgis_error' }
  }

  return {
    ok: true,
    hourlyKw: profile.profile.hourlyKw,
    summary: {
      weatherYears: profile.profile.weatherYears,
      annualYields: profile.profile.annualYields,
      spread,
      smoothingOptimismPercent: PV_TEN_YEAR_SMOOTHING_OPTIMISM_PERCENT,
      echoed: profile.profile.inputs,
    },
  }
}

/**
 * Die Lastgang-Datei, aus der die ECHTEN Zeitstempel stammen.
 *
 * ⚠ SIE KOMMT ALS BYTES HEREIN UND NICHT ALS DOKUMENT-KENNUNG — dieselbe Aufteilung wie bei
 * `checkPvGeneratorEligibility` nebenan und aus demselben Grund: `readProjectDocument` zieht
 * `@supabase/ssr` und `next/headers`, und ein Paket importiert keine App. Die App liest das
 * Dokument, dieses Paket liest die Datei.
 */
export type EstimatedPvSeriesLoadProfile = { bytes: ArrayBuffer; fileName: string }

export type EstimatedPvSeriesOutcome =
  | {
      ok: true
      /** Je Fläche eine Zusammenfassung, in der Reihenfolge der übergebenen Auslegungen. */
      summaries: PvArrayReferenceSummary[]
      /**
       * Die abzulegende Reihe — `null`, wenn kein Lastgang übergeben wurde.
       *
       * ⚠ DAS IST HEUTE DER STANDARDPROFIL-ZWEIG, und die Lücke ist benannt statt still: ein
       * erzeugtes Standardprofil hat keine Datei, aus der sich Zeitstempel lesen liessen, und aus
       * `coveredFrom` + Intervall rekonstruiert wären sie an jedem Sommerzeit-Tag falsch. Die
       * Kennzahlen entstehen trotzdem — nur die Reihe nicht. Solange der Analyse-Lauf ein
       * Standardprofil ohnehin ablehnt (`run-from-draft.ts`, `no_uploaded_load_profile`), fehlt
       * dadurch nichts, was sonst gerechnet würde.
       */
      file: GeneratedPvSeriesFile | null
    }
  /** Die übergebene Lastgang-Datei liess sich nicht lesen. Es ist NICHTS hinausgegangen. */
  | { ok: false; reason: 'load_profile_unreadable' }
  | {
      ok: false
      reason: 'invalid_request' | 'rate_limited' | 'pvgis_error'
      /** 1-basiert, in der Reihenfolge der übergebenen Flächen — die Nummer der Oberfläche. */
      arrayNumber: number
      rejection?: PvgisRequestRejection
    }

/**
 * Holt ALLE Modulflächen, summiert ihre Stundenreihen und legt die Summe auf die Zeitstempel des
 * Lastgangs — heraus kommt die Datei, die der Wizard ablegt, plus die Kennzahlen je Fläche.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ALLES ODER NICHTS. Scheitert EINE Fläche, ist das Ergebnis ein Fehlschlag — nicht die Summe
 * der übrigen. Eine Anlage mit drei Flächen, von denen eine fehlt, ergäbe eine Zahl in völlig
 * plausibler Grössenordnung, der niemand ansieht, dass ihr ein Drittel fehlt (dieselbe Regel, die
 * `generatePvProfileAction` schon für unvollständig erfasste Flächen durchsetzt).
 *
 * ⚠ DER LASTGANG WIRD ZUERST GELESEN, VOR DEM ERSTEN EXTERNEN KONTAKT. Eine unlesbare Datei soll
 * PVGIS nicht N Anfragen kosten — dieselbe Reihenfolge wie bei der Anfrageprüfung im Abruf selbst.
 *
 * ⚠ ER WIRD DABEI EIN ZWEITES MAL GEPARST (die Anbietbarkeits-Prüfung hat es schon getan), und das
 * ist Absicht: die beiden Prüfungen haben verschiedene Aufgaben und verschiedene Zeitpunkte —
 * „darf überhaupt geschätzt werden?" fällt VOR dem Abruf, „auf welche Zeitstempel?" gehört zum
 * Ergebnis. Zusammengelegt käme die Anbietbarkeit nach den PVGIS-Aufrufen zu stehen und eine
 * abgelehnte Schätzung kostete sie trotzdem.
 */
export async function generateEstimatedPvSeries(input: {
  designs: readonly PvgisArrayDesign[]
  /** `null` = kein hochgeladener Lastgang (Standardprofil) — dann entsteht keine Reihe, s. oben. */
  loadProfile: EstimatedPvSeriesLoadProfile | null
}): Promise<EstimatedPvSeriesOutcome> {
  let timestamps: string[] | null = null
  if (input.loadProfile !== null) {
    timestamps = readLoadProfileTimestamps(input.loadProfile)
    if (timestamps === null) return { ok: false, reason: 'load_profile_unreadable' }
  }

  const outcomes = await Promise.all(input.designs.map((design) => fetchPvArrayReference(design)))

  const summaries: PvArrayReferenceSummary[] = []
  const hourlySeries: (readonly number[])[] = []
  for (const [index, outcome] of outcomes.entries()) {
    if (!outcome.ok) {
      return outcome.reason === 'invalid_request'
        ? { ok: false, reason: outcome.reason, arrayNumber: index + 1, rejection: outcome.rejection }
        : { ok: false, reason: outcome.reason, arrayNumber: index + 1 }
    }
    summaries.push(outcome.summary)
    hourlySeries.push(outcome.hourlyKw)
  }

  const first = summaries[0]
  if (timestamps === null || first === undefined) return { ok: true, summaries, file: null }

  return {
    ok: true,
    summaries,
    file: buildGeneratedPvSeriesFile({
      hourlySeries,
      timestamps,
      /*
       * Die Wetterjahre der ERSTEN Fläche — sie gelten für alle: angefordert wird für jede derselbe
       * Satz, und `buildPvReferenceProfile` weist eine Antwort ab, die nicht genau ihn trägt. Der
       * Glättungs-Aufschlag ist eine Eigenschaft des VERFAHRENS und damit ohnehin für alle gleich.
       */
      weatherYears: first.weatherYears,
      smoothingOptimismPercent: first.smoothingOptimismPercent,
    }),
  }
}

/**
 * Die Zeitstempel des Lastgangs, in seiner Reihenfolge — `null`, wenn die Datei nicht eindeutig
 * lesbar ist.
 *
 * ⚠ ES IST DERSELBE PARSER, DEN DER ANALYSE-LAUF SPÄTER AUF DIESELBE DATEI ANWENDET
 * (`run-from-draft.ts`). Nur deshalb ist die Zuordnung Erzeugung ↔ Verbrauch per Konstruktion
 * vollständig: beide Seiten tragen dieselben Zeichenketten, und `alignPvGrossToLoad` vergleicht
 * exakt (s. Kopf von `pv-generation/couple.ts`). Eine eigene, „leichtere" Zeitstempel-Lesung wäre
 * eine zweite Fassung derselben Regel und die erste, die auseinanderliefe.
 *
 * ⚠ CSV ALS TEXT, XLSX ALS BYTES — die Unterscheidung fällt am DATEINAMEN; ausführlich begründet
 * im Kopf von `eligibility.ts` nebenan (der `content_type` ist eine Angabe des Browsers).
 */
function readLoadProfileTimestamps(file: EstimatedPvSeriesLoadProfile): string[] | null {
  const isXlsx = /\.xlsx?$/i.test(file.fileName.trim())
  const parsed = parseLoadProfile({
    content: isXlsx ? file.bytes : new TextDecoder().decode(file.bytes),
    fileName: file.fileName,
    format: isXlsx ? 'xlsx' : 'csv',
  })
  if (!parsed.ok) return null
  return parsed.profile.readings.map((reading) => reading.ts)
}
