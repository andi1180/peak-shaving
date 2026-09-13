import 'server-only'

import {
  PVGIS_WEATHER_YEARS,
  buildPvReferenceProfile,
  checkPvgisRequest,
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
 * ⚠ ES KOMMT KEINE ERZEUGUNGSREIHE HERAUS — dieselbe Zusage wie bei `readPvProfileMetadata`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `PvReferenceProfile.hourlyKw` trägt 8.760 Werte. Sie bleiben hinter dieser Paketgrenze; heraus
 * kommen Kennzahlen ÜBER die Reihe. Zwei Gründe, und der zweite ist der wichtigere:
 *
 *   1. Was der Wizard SPEICHERT, sind Eingaben (PLZ, kWp, Neigung, Richtung), nicht Ergebnisse —
 *      genau wie beim Standardprofil-Zweig, dessen 35.040 erzeugte Messwerte ebenfalls hier
 *      bleiben. Die Kurve entsteht zur Rechenzeit neu aus denselben Eingaben; sie zusätzlich
 *      abzulegen schüfe einen zweiten Speicherort für dieselbe Aussage.
 *   2. 8.760 Zahlen durch eine Server Action und in einen `jsonb`-Entwurf zu reichen wäre eine
 *      Fracht, die niemand angefordert hat — und der erste Aufrufer, der sie dort vorfindet,
 *      speichert sie.
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

  /*
   * ⚠ HIER WIRD `profile.profile.hourlyKw` BEWUSST NICHT WEITERGEREICHT. Die 8.760 Werte enden an
   * dieser Zeile — s. Kopf. Wer sie später doch braucht, holt sie zur RECHENZEIT aus denselben
   * Eingaben, statt sie durch einen Entwurf zu schleifen.
   */
  return {
    ok: true,
    summary: {
      weatherYears: profile.profile.weatherYears,
      annualYields: profile.profile.annualYields,
      spread,
      smoothingOptimismPercent: PV_TEN_YEAR_SMOOTHING_OPTIMISM_PERCENT,
      echoed: profile.profile.inputs,
    },
  }
}
