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
 * Die Entwurfs-Schlüssel, die eine BESTEHENDE Batterie beschreiben (`battery-draft.ts`).
 *
 * ⚠ `wantsBatteryRecommendation` steht hier NICHT. Es beantwortet eine andere Frage („soll die
 * Analyse einen Speicher vorschlagen?") und ist der Regelfall jeder Analyse — mit aufgeführt
 * sperrte es genau die Läufe, für die dieser Weg gebaut ist.
 */
const EXISTING_BATTERY_DRAFT_KEYS = [
  'hasBattery',
  'existingBatteryCapacityKwh',
  'existingBatteryMaxPowerKw',
  'existingBatteryRoundTripEfficiencyPercent',
  'existingBatteryPricePerKwh',
] as const

/** Die Entwurfs-Schlüssel der PV-Station — Antwort, Modulflächen und Erzeugungsprofil. */
const PV_DRAFT_KEYS = [
  'hasPv',
  '_pvArrays',
  'pvIntervalMinutes',
  'pvCoveredFrom',
  'pvCoveredTo',
  'pvSourceDocumentId',
  '_pvProfileGaps',
  'pvProfileSource',
  'pvEstimatedAnnualKwh',
  'pvEstimatedSpreadPercent',
  'pvEstimatedWeatherYearFrom',
  'pvEstimatedWeatherYearTo',
] as const

/**
 * Alles, was der Analyse-Lauf aus dem Entwurf (D3, Baustein 1) noch NICHT verarbeitet.
 *
 * ⚠ SIE IST EINE SPERRE, KEINE AUSLASSUNG. PV und Bestandsbatterie verschieben jede Zahl des
 * Ergebnisses — die Ersparnis einer bestehenden Anlage steht bereits im Lastgang, und eine
 * geschätzte Erzeugung ändert den Netzbezug jeder Viertelstunde. Weggelassen käme eine Analyse
 * heraus, die vollständig AUSSIEHT und einen Teil der Anlage des Kunden nicht kennt; das ist
 * teurer als ein Abbruch mit Begründung.
 *
 * ⚠ DIE NAMEN SIND DIE DER SCHREIBWEGE IN `apps/web` (`battery-draft.ts`, `pv-draft.ts`,
 * `pv-profile-draft.ts`, `pv-array-draft.ts`). Ein Test dort hält beide Seiten zusammen — er liest
 * die dortigen Listen und verlangt jeden ihrer Schlüssel hier.
 */
export const UNSUPPORTED_ANALYSIS_DRAFT_KEYS: readonly string[] = [
  ...EXISTING_BATTERY_DRAFT_KEYS,
  ...PV_DRAFT_KEYS,
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
 */
export function findUnsupportedAnalysisDraftKeys(draft: Record<string, unknown>): string[] {
  return UNSUPPORTED_ANALYSIS_DRAFT_KEYS.filter((key) => statesSomething(draft[key]))
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
