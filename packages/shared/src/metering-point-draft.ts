/**
 * D3 — WAS DER ENTWURF EINES ZÄHLPUNKTS (`platform.metering_points.draft`) FÜR EINEN ANALYSE-LAUF
 * MITBRINGEN MUSS, UND WAS IHN DAFÜR SPERRT.
 *
 * Der Entwurf ist ein `jsonb`-Objekt ohne Schlüssel-Bedingung: die Typisierung sitzt woanders
 * (`tariffParamsSchema`, s. Spaltenkommentar der Migration `20260911150000`). Was hier steht, sind
 * die zwei Angaben, die der Wizard schreibt, ohne dass der Contract sie kennt — und die Frage, ob
 * ein Entwurf für den heutigen Analyse-Weg überhaupt vollständig verarbeitbar ist.
 *
 * ── WARUM IN `shared` UND NICHT IN `apps/web` ─────────────────────────────────────────────────
 * Geschrieben wird der Entwurf in `apps/web` (Wizard-Stationen), GELESEN wird er seit D3 in
 * `packages/extractors` auf dem Weg zur Engine. Die beiden kennen einander nicht; `shared` ist das
 * einzige Paket, das beide führen. Zwei Listen derselben Schlüsselnamen liefen beim nächsten
 * Stationsumbau auseinander — und der Fehlschlag wäre still: eine PV-Anlage stünde im Entwurf, die
 * Sperre unten fände ihren Schlüssel nicht mehr, und die Analyse liefe OHNE sie durch und sähe
 * vollständig aus.
 */
import { tariffParamsSchema } from './tariff'

/**
 * Der Netzbetreiber im Entwurf.
 *
 * ── ⚠ ER WAR BIS ZUM 16.09.2026 AUSDRÜCKLICH NICHT IM ENTWURF ─────────────────────────────────
 * `invoice-extractions.ts` und `saveMeteringPointManualTariffAction` begründeten das gleichlautend:
 * er ist kein `tariffParamsSchema`-Feld und „würde beim nächsten Auswerten stillschweigend
 * entfernt". Das stimmte, solange der Entwurf nur als GANZES gegen den Contract geprüft wurde.
 * Seit D3 liest ihn eine benannte Abbildung Feld für Feld (`mapDraftToTariffParams`), und die
 * Alternative wäre die teurere: die Zuständigkeit stünde dann ausschliesslich im Formularzustand
 * eines Bildschirms, der beim Neuladen weg ist — dieselbe Feststellung, aus der `meteringVariant`
 * in den Contract gehoben wurde (B24, Delta §3.4).
 *
 * ⚠ ER GEHT TROTZDEM NICHT IN DIE RECHNUNG EIN, und das ist kein Versehen: `TariffParams` hat für
 * ihn kein Feld, und D3 hält die Herkunftsangaben (`tariffSource`, sieben Felder) ausdrücklich als
 * offene Entscheidung fest. Er steht im Entwurf als ANGABE, nicht als Rechengrösse — der Weg in
 * den Report ist ein eigener Schritt.
 */
export const NETZBETREIBER_DRAFT_KEY = 'netzbetreiber'

/**
 * Die Netzebene aus dem Entwurf zurück als ZAHL — `null` heisst „keine brauchbare Angabe".
 *
 * ── ⚠ WARUM ES DIE RÜCKUMFORMUNG ÜBERHAUPT BRAUCHT ────────────────────────────────────────────
 * Im Entwurf steht die Netzebene als TEXT (`NE 5`, s. `netzebeneDraftValue` in
 * `apps/web/lib/admin/invoice-extractions.ts`) — `tariffParamsSchema.netzebene` ist ein String, und
 * eine Zahl dort wäre ein Schema-Verstoss. Die Netzentgelt-Abfrage braucht sie dagegen als Zahl
 * (`grid_tariffs.netzebene` ist `integer`). Genau eine Stelle formt deshalb zurück.
 *
 * ⚠ SIE STEHT IN `shared` UND NICHT IN EINER DER BEIDEN APPS: `apps/web` liest sie für die Abfrage,
 * `packages/extractors` für die Entscheidung über die Messvariante. Zweimal geschrieben liefen die
 * beiden beim nächsten Schreibformat auseinander — und der Fehlschlag wäre still: die Abfrage fände
 * keine Zeile, und der Hebel fiele mit „keine Netzentgelt-Daten" aus, obwohl sie gepflegt ist.
 *
 * ── WAS SIE ANNIMMT ───────────────────────────────────────────────────────────────────────────
 * `NE 5`, `NE5`, `5` und die blanke Zahl `5`. Die Form ohne Präfix ist kein Zugeständnis an
 * Bequemlichkeit, sondern der reale Bestand: ein Entwurf kann von Hand oder über das Chat-Werkzeug
 * (`set_draft_field`) geschrieben sein, und dort schreibt niemand ein Präfix. Alles andere ergibt
 * `null` — geworfen wird NIE: ein von Hand veränderter `jsonb` darf einen Analyse-Lauf nicht mit
 * einem Ausnahmefehler abbrechen, er darf ihn nur ohne Netzentgelt-Seite rechnen lassen.
 *
 * Die Grenze 3–7 ist der CHECK der Tabelle. Ein Wert ausserhalb ist in der Datenbank nicht
 * auffindbar; ihn durchzureichen ergäbe eine Abfrage, die garantiert leer antwortet.
 */
export function parseNetzebeneDraftValue(raw: unknown): number | null {
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw : null
  if (text === null) return null
  const match = /^(?:NE\s*)?([3-7])$/i.exec(text.trim())
  return match === null ? null : Number(match[1])
}

/**
 * Der Betrachtungshorizont (Jahre) eines Analyse-Laufs aus dem Wizard-Entwurf.
 *
 * ⚠ EIGENER WERT NEBEN `DEFAULT_HORIZON_YEARS` (`apps/website/lib/constants.ts`), NICHT DESSEN
 * ERSATZ. Jener ist der Vorgabewert des öffentlichen Rechners und zugleich das Reset-Ziel seines
 * Annahmen-Panels — er gehört dem Bildschirm, auf dem der Kunde ihn verstellt. Hier gibt es kein
 * Panel; der Wizard-Weg braucht die Zahl, bevor irgendjemand sie verstellen könnte. Beide stehen
 * heute auf 10 und werden bewusst getrennt gepflegt: eine Zusammenlegung machte aus zwei
 * Entscheidungen eine, und ein verstellter Rechner-Default verschöbe still jede Wizard-Analyse.
 */
export const DRAFT_ANALYSIS_HORIZON_YEARS = 10

/**
 * Die Entwurfs-Schlüssel der BESTEHENDEN Batterie, die der Analyse-Lauf liest
 * (`battery-draft.ts` in `apps/web`).
 *
 * ⚠ SIE STANDEN BIS ZUM 16.09.2026 IN DER SPERRE UNTEN. Seit D3 Baustein 2 werden sie verarbeitet
 * (`mapDraftToExistingBatteryInput`, `packages/engine`) — aus gesperrten Namen sind gelesene
 * geworden, und genau deshalb bleiben sie hier benannt: eine Umbenennung in `apps/web` liefe sonst
 * still an der Abbildung vorbei, und der Speicher des Kunden verschwände aus der Rechnung, ohne
 * dass das Ergebnis unvollständig AUSSÄHE.
 *
 * ⚠ ZWEI SCHLÜSSEL DER STATION FEHLEN HIER ABSICHTLICH: `existingBatteryPricePerKwh` (eine
 * installierte Anlage ist bezahlt — sie bekommt ihre Investitionsfelder ausschliesslich über
 * `NO_INVESTMENT_FIELDS`) und `wantsBatteryRecommendation` (`computeAnalysis` rechnet `perBattery`
 * ohnehin immer über den vollen Katalog).
 */
export const EXISTING_BATTERY_DRAFT_KEYS = {
  present: 'hasBattery',
  capacityKwh: 'existingBatteryCapacityKwh',
  maxPowerKw: 'existingBatteryMaxPowerKw',
  roundTripEfficiencyPercent: 'existingBatteryRoundTripEfficiencyPercent',
} as const

/**
 * Die Entwurfs-Schlüssel der PV-Station, die der Analyse-Lauf für eine HOCHGELADENE Erzeugungsreihe
 * liest (`pv-draft.ts`/`pv-profile-draft.ts` in `apps/web`).
 *
 * ⚠ `profileSource` steht in BEIDEN Rollen da: `'upload'` ist der Weg, den dieser Lauf geht,
 * `'generated'` sperrt ihn (s. `findUnsupportedAnalysisDraftKeys`). Der Schlüssel entscheidet also
 * über den Zweig und ist nicht bloss eine Angabe neben anderen.
 */
export const PV_UPLOAD_DRAFT_KEYS = {
  present: 'hasPv',
  /**
   * ⚠ DIE FRAGE, DIE `hasPv` NICHT BEANTWORTET — und deren Fehlen ein gemessener Defekt war.
   *
   * `hasPv: true` hiess bis zum 22.09.2026 zweierlei zugleich, weil der Wizard wörtlich nach einer
   * „bereits errichteten ODER FEST BESTELLTEN" Anlage fragte. Für den Rechenlauf sind das aber
   * gegensätzliche Fälle: die errichtete Anlage steckt im Netzbetreiber-Lastgang bereits als
   * gesenkter Bezug (`pv_already_in_grid_profile` — ein Abzug wäre Doppelzählung), die bestellte
   * steckt dort NICHT, und ihre Wirkung entsteht nur, wenn die Schätzreihe abgezogen WIRD.
   * Dieselbe Antwort löste also die falsche Behandlung des jeweils anderen Falls aus.
   *
   * ⚠ FEHLT DER SCHLÜSSEL, GILT `existing`. Jeder vor dieser Änderung beantwortete Zählpunkt
   * rechnet damit unverändert weiter (s. `pvIsInLoadProfile`) — eine stille Umdeutung bestehender
   * Angaben wäre die teurere Richtung: sie änderte Zahlen, ohne dass jemand etwas angefasst hat.
   */
  stage: 'pvStage',
  sourceDocumentId: 'pvSourceDocumentId',
  profileSource: 'pvProfileSource',
} as const

/**
 * Steht die Anlage schon, oder ist sie geplant?
 *
 * ⚠ AUSDRÜCKLICH KEIN DATUM UND KEIN ALTER. Gefragt ist nicht, WANN die Anlage gebaut wurde,
 * sondern ob ihre Erzeugung im hochgeladenen Lastgang bereits wirkt — das ist die einzige
 * Unterscheidung, die der Rechenlauf braucht. Ein Inbetriebnahmedatum wäre eine zweite Angabe, aus
 * der sich dieselbe Antwort ableiten liesse, und die erste, die dem Lastgang widerspricht (er kann
 * aus einem Zeitraum davor stammen).
 */
export const PV_STAGES = ['existing', 'planned'] as const
export type PvStage = (typeof PV_STAGES)[number]

/** Was gilt, wenn `hasPv: true` ohne Stufe dasteht — s. `PV_UPLOAD_DRAFT_KEYS.stage`. */
export const DEFAULT_PV_STAGE: PvStage = 'existing'

/** Die Stufe eines Entwurfs, `null` wenn es gar keine Anlage gibt oder nichts beantwortet wurde. */
export function readPvStage(draft: Record<string, unknown>): PvStage | null {
  if (draft[PV_UPLOAD_DRAFT_KEYS.present] !== true) return null
  const raw = draft[PV_UPLOAD_DRAFT_KEYS.stage]
  return (PV_STAGES as readonly unknown[]).includes(raw) ? (raw as PvStage) : DEFAULT_PV_STAGE
}

/**
 * Steckt die Erzeugung dieser Anlage im hochgeladenen Lastgang schon drin?
 *
 * ⚠ DIE EINE ABLEITUNG, AN DER DER ABZUG HÄNGT — bewusst hier in `shared` und nicht an der
 * Aufrufstelle: sie wird vom Rechenlauf (`packages/extractors`) UND von der Station
 * (`apps/web`) gelesen, und `apps/web` darf `engine` nicht kennen. Zwei Fassungen liefen still
 * auseinander: die Station schriebe „wird abgezogen", gerechnet würde ohne Abzug.
 *
 * `false` für eine GEPLANTE Anlage — dann darf und muss die Schätzreihe abgezogen werden.
 */
export function pvIsInLoadProfile(draft: Record<string, unknown>): boolean {
  return readPvStage(draft) === 'existing'
}

/** Der Wert von `pvProfileSource`, der eine GESCHÄTZTE (PVGIS-)Reihe bezeichnet. */
export const PV_GENERATED_PROFILE_SOURCE = 'generated'

/**
 * Die Entwurfs-Schlüssel der GESCHÄTZTEN (PVGIS-)PV-Erzeugung — geschrieben in
 * `pv-profile-draft.ts` (`apps/web`), gelesen in `packages/extractors`.
 */
export const PV_GENERATED_DRAFT_KEYS = {
  /**
   * Die Kennung des Dokuments mit der GESCHÄTZTEN Erzeugungsreihe (`PV_GENERATED_DOCUMENT_ID_KEY`
   * in `apps/web`) — der Weg ZUR Reihe, während die vier Kennzahlen daneben Angaben ÜBER sie sind.
   *
   * ⚠ SIE STEHT BEWUSST NICHT IN DER SPERRE UNTEN, und das ist kein Vergessen: gesperrt wird der
   * geschätzte Weg am `pvProfileSource` und an den Kennzahlen. Die Kennung ist die Voraussetzung
   * des künftigen Zweigs (wie `sourceDocumentId` beim Upload) und benannt, damit Leser und Sperre
   * denselben Namen benutzen — eine Umbenennung in `apps/web` liefe sonst still an beiden vorbei.
   */
  documentId: 'pvGeneratedDocumentId',
  estimatedAnnualKwh: 'pvEstimatedAnnualKwh',
  estimatedSpreadPercent: 'pvEstimatedSpreadPercent',
  weatherYearFrom: 'pvEstimatedWeatherYearFrom',
  weatherYearTo: 'pvEstimatedWeatherYearTo',
} as const

/**
 * Alles, was der Analyse-Lauf aus dem Entwurf noch NICHT verarbeitet — heute allein die GESCHÄTZTE
 * PV-Erzeugung (`pvEstimated*`, `pv-profile-draft.ts`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ SIE IST EINE SPERRE, KEINE AUSLASSUNG — UND SIE IST AM 16.09.2026 GESCHRUMPFT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bestandsbatterie und hochgeladene PV-Reihe werden seit D3 Baustein 2 gerechnet und sind deshalb
 * heraus. Die geschätzte Reihe bleibt: ihr Leser (`readGeneratedPvSeries`/`coupleGeneratedPvSeries`,
 * `packages/extractors`) ist gebaut, aber an keinen Lauf verdrahtet — weggelassen käme eine Analyse
 * heraus, die vollständig AUSSIEHT und die Erzeugung des Kunden nicht kennt, obwohl jeder einzelne
 * Netzbezugswert davon abhängt; das ist teurer als ein Abbruch mit Begründung.
 *
 * ⚠ Die Dokument-Kennung daneben sperrt NICHT (s. `PV_GENERATED_DRAFT_KEYS.documentId`).
 */
export const UNSUPPORTED_ANALYSIS_DRAFT_KEYS: readonly string[] = [
  PV_GENERATED_DRAFT_KEYS.estimatedAnnualKwh,
  PV_GENERATED_DRAFT_KEYS.estimatedSpreadPercent,
  PV_GENERATED_DRAFT_KEYS.weatherYearFrom,
  PV_GENERATED_DRAFT_KEYS.weatherYearTo,
]

/**
 * Trägt der Wert eine AUSSAGE? `hasPv: false` ist eine beantwortete Frage ohne PV-Anlage und darf
 * nicht sperren; ein leeres Flächen-Array ist derselbe Zustand nach dem Entfernen der letzten
 * Fläche. `null`/`undefined` kommen aus einem von Hand veränderten `jsonb` und heissen dasselbe.
 */
function statesSomething(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return false
  if (Array.isArray(value) && value.length === 0) return false
  return true
}

/**
 * Welche der gesperrten Angaben dieser Entwurf tatsächlich trägt — leer heisst „verarbeitbar".
 * Die Namen gehen in die Fehlermeldung des Aufrufers: „PV vorhanden" ohne das Feld wäre für den
 * Admin, der es wieder entfernen soll, keine brauchbare Auskunft.
 *
 * ⚠ `pvProfileSource` SPERRT AM WERT, NICHT AN SEINER ANWESENHEIT — als einziger Schlüssel. Auf
 * `'upload'` ist er die Voraussetzung des PV-Wegs, auf `'generated'` sein Ausschlussgrund. Er wird
 * ZUERST genannt, weil er den Fall benennt; die vier Kennzahlen daneben sind seine Folge und ein
 * Entwurf kann sie aus einem überschriebenen Lauf auch ohne ihn tragen.
 */
export function findUnsupportedAnalysisDraftKeys(draft: Record<string, unknown>): string[] {
  const generatedSource = draft[PV_UPLOAD_DRAFT_KEYS.profileSource] === PV_GENERATED_PROFILE_SOURCE
  return [
    ...(generatedSource ? [PV_UPLOAD_DRAFT_KEYS.profileSource] : []),
    ...UNSUPPORTED_ANALYSIS_DRAFT_KEYS.filter((key) => statesSomething(draft[key])),
  ]
}

/**
 * ⚠ Der Netzbetreiber-Schlüssel darf keinen Contract-Feldnamen verdecken — wortgleiche Vorkehrung
 * wie bei `_provenance` und `_invoiceExtractions`, und hier besonders nötig: er ist der einzige der
 * drei OHNE Unterstrich, steht also mitten zwischen den Contract-Feldern. Als Funktion statt als
 * Kommentar, damit ein Test sie gegen die echten Schlüssel laufen lassen kann.
 */
export function netzbetreiberDraftKeyCollidesWithContract(): boolean {
  return NETZBETREIBER_DRAFT_KEY in tariffParamsSchema.shape
}
