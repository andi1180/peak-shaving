/**
 * B24, Teil 1 — DER VERTRAG DES BATTERIE-DATENBLATT-SCANS. Die FÜNFTE KI-Anbindung dieses Repos.
 *
 * ── WOZU ES DIESEN BAUSTEIN GIBT ───────────────────────────────────────────────────────────────
 * Die Batterie-Station des Wizards kennt bis hierher genau EINEN Weg zu den vier Kenndaten: einen
 * Satz in eigenen Worten (`battery-text.ts`). Der trägt, solange der Kunde seine Anlage im Kopf
 * hat. Der Regelfall beim betreuten Erfassen ist ein anderer — der Fachbetrieb legt das
 * DATENBLATT des Geräts vor, und der Admin tippt daraus ab.
 *
 * Dieses Modul liest dasselbe aus einem PDF. Es erfindet dabei keinen neuen Mechanismus: heraus
 * kommen exakt dieselben vier Zahlenfelder wie beim Freitext, unter exakt denselben Namen — sie
 * speisen deshalb in dieselben Formularfelder und über `battery-draft.ts` in denselben Entwurf.
 *
 * ── ⚠ DIE FELDNAMEN SIND AN `battery-text.ts` GEBUNDEN, NICHT BLOSS GLEICH GESCHRIEBEN ────────
 * `BATTERY_SPEC_NUMBER_KEYS` trägt eine `satisfies`-Schranke auf `BATTERY_TEXT_NUMBER_KEYS`. Wer
 * dort einen Schlüssel umbenennt, macht diese Datei ROT — statt dass die gelesenen Werte still in
 * keinem Formularfeld mehr ankommen. Dass die beiden Listen auch DECKUNGSGLEICH sind (die Schranke
 * allein liesse eine Teilmenge zu), misst `battery-spec-scan.test.ts`; dieselbe „Spiegel plus
 * Test"-Technik wie zwischen `invoice-scan.ts` und `tariff-catalog.ts`.
 *
 * ⚠ `hasExistingBattery` gibt es hier NICHT, und das ist kein Vergessen: ein Datenblatt sagt
 * nichts darüber, ob der Kunde das Gerät besitzt — es beschreibt ein Produkt. Die Frage steht im
 * Wizard als Weiche über der Station und ist beantwortet, bevor jemand eine Datei wählt.
 *
 * ── WARUM DIESER TEIL IN `shared` LIEGT ────────────────────────────────────────────────────────
 * Wortgleich zu `invoice-scan.ts`, `battery-text.ts` und `pv-design-scan.ts`: hier steht genau der
 * Teil, der sich OHNE einen Modellaufruf prüfen lässt — Zielschema und Auswertung. Die Datei hat
 * bis auf die eine Schranke oben KEINE Importe; kein zod (das JSON-Schema unten ist die
 * WIRE-Fassung, die an die API geht und dort erzwungen wird).
 *
 * ── ⚠ DIE FACHLICHE REGEL, DIE ALLES TRÄGT: LIEBER NICHTS ALS GERATEN ─────────────────────────
 * Aus diesen Zahlen wird ein SIMULIERBARER Speicher gebaut, und die Ersparnis, die der Report
 * anschliessend ausweist, ist die seiner Anlage. Ein Datenblatt ist dafür die gefährlichere Quelle
 * als ein Satz: es steht VOLLER plausibler Zahlen, die fast, aber nicht ganz die gesuchten sind —
 * Brutto- neben nutzbarer Kapazität, Spitzen- neben Dauerleistung, Wechselrichter- neben
 * Round-Trip-Wirkungsgrad, und oft eine ganze Produktfamilie in einer Tabelle. Jede davon sieht
 * im Report aus wie ein Ergebnis. Jedes Feld ist deshalb einzeln `Wert ODER null`, und die
 * Auswertung unten setzt zurück, was nicht sauber ankommt, statt es zu retten.
 */
import { BATTERY_TEXT_NUMBER_KEYS } from './battery-text'

/**
 * Was aus einem Datenblatt gelesen werden kann.
 *
 * Die vier Zahlenfelder sind namensgleich mit `BatteryTextExtraction` — das ist die ganze Pointe
 * dieses Moduls (s. Kopf). `manufacturer` und `model` kommen dazu und gehen in KEIN Feld.
 */
export interface BatterySpecExtraction {
  /**
   * Der Hersteller, wörtlich aus dem Dokument — NUR zur Anzeige.
   *
   * ── ⚠ ER BELEGT KEIN FELD UND ERREICHT DEN ENTWURF NICHT ────────────────────────────────────
   * Dieselbe Behandlung wie `netzbetreiber` beim Rechnungs-Scan: gelesen, gezeigt, nicht
   * geschrieben. Es gibt für ihn keinen Entwurfs-Schlüssel (`BATTERY_VALUE_FIELDS` führt vier
   * Einträge, alle numerisch), und einen anzulegen hiesse, eine Angabe zu speichern, die in keine
   * Rechnung eingeht. Gezeigt wird er trotzdem: „Sungrow SBR128" neben den vier Zahlen ist das
   * Einzige, woran ein Mensch erkennt, ob das RICHTIGE Datenblatt gelesen wurde — bei einer
   * Produktfamilie mit vier Varianten ist genau das die Frage.
   *
   * ── UND ER IST KEIN FREITEXTFELD IM SINN DER REGEL ─────────────────────────────────────────
   * „Kein Freitextfeld in der Rückgabe" (alle bisherigen Anbindungen) verbietet PROSA DES MODELLS
   * — Begründungen, Zusammenfassungen, Einschätzungen der eigenen Sicherheit. Dies ist eine
   * wörtlich abgeschriebene Beschriftung des Dokuments, also gelesene Angabe. Damit sie das
   * bleibt, ist sie in der Länge begrenzt (`MAX_BATTERY_SPEC_LABEL_CHARS`): was darüber
   * hinausgeht, ist kein Herstellername mehr, und die Auswertung verwirft es. Präzedenz:
   * `locationText` in `pv-design-scan.ts`.
   */
  manufacturer: string | null
  /** Die Modell-/Typbezeichnung, wörtlich aus dem Dokument — NUR zur Anzeige, s. `manufacturer`. */
  model: string | null
  /** Nutzbare Kapazität in kWh. Ausdrücklich NICHT die Brutto-/Nennkapazität — s. System-Prompt. */
  capacityKwh: number | null
  /** Dauerhafte Lade-/Entladeleistung in kW. Ausdrücklich NICHT die Spitzenleistung. */
  maxPowerKw: number | null
  /**
   * Round-Trip-Wirkungsgrad in PROZENT (0–100), so wie das Datenblatt ihn schreibt.
   *
   * ⚠ Der Katalog führt ihn als Bruchteil (0,9). Umgerechnet wird an GENAU EINER Stelle, beim
   * Übernehmen in den Override — hier bleibt stehen, was im Dokument stand. Dieselbe Konvention
   * wie in `battery-text.ts`, und sie muss dieselbe sein: beide Wege füllen dasselbe Feld.
   */
  roundTripEfficiencyPercent: number | null
  /** Preis in Euro je kWh Kapazität. Auf einem Datenblatt der Ausnahmefall — s. System-Prompt. */
  pricePerKwh: number | null
}

/**
 * Die vier Zahlenfelder, in fester Reihenfolge — von Schema, Auswertung und Test geteilt.
 *
 * ⚠ Die `satisfies`-Schranke bindet sie an `BATTERY_TEXT_NUMBER_KEYS` (s. Kopf). Sie verhindert
 * eine UMBENENNUNG, nicht ein Auseinanderlaufen der Mengen — dafür gibt es den Gleichheits-Test.
 */
export const BATTERY_SPEC_NUMBER_KEYS = [
  'capacityKwh',
  'maxPowerKw',
  'roundTripEfficiencyPercent',
  'pricePerKwh',
] as const satisfies readonly (typeof BATTERY_TEXT_NUMBER_KEYS)[number][]

/** Die zwei reinen Anzeigefelder, in fester Reihenfolge. */
export const BATTERY_SPEC_LABEL_KEYS = ['manufacturer', 'model'] as const satisfies readonly (
  keyof BatterySpecExtraction
)[]

/**
 * Längengrenze von Hersteller und Modell in Zeichen.
 *
 * Darüber ist es keine Typbezeichnung mehr, sondern ein Satz — und ein Satz an dieser Stelle wäre
 * genau die Modell-Prosa, die das Schema sonst nirgends zulässt. Dieselbe Grenze und dieselbe
 * Begründung wie `MAX_PV_DESIGN_LOCATION_CHARS`.
 */
export const MAX_BATTERY_SPEC_LABEL_CHARS = 120

/** Ein Ergebnis, in dem nichts erkannt wurde. Der Ausgangszustand jeder Auswertung. */
export function emptyBatterySpecExtraction(): BatterySpecExtraction {
  return {
    manufacturer: null,
    model: null,
    capacityKwh: null,
    maxPowerKw: null,
    roundTripEfficiencyPercent: null,
    pricePerKwh: null,
  }
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Das JSON-Schema, das die API erzwingt.
 *
 * `additionalProperties: false` + vollständige `required`-Liste: das Modell MUSS jedes Feld
 * nennen, und der einzige zulässige Weg, es nicht zu beantworten, ist `null`. Ohne `required`
 * wäre „Feld weggelassen" ein zweiter Ausdruck für dasselbe.
 *
 * ⚠ Es gibt hier KEIN Aufzählungsfeld — also auch nicht die Schreibweise, die am 31.08.2026 den
 * Rechnungs-Scan mit HTTP 400 funktionslos gemacht hat (`type: [..., 'null']` ZUSAMMEN mit `enum`).
 * Die Typ-Union OHNE `enum` ist gegen die echte API als zulässig gemessen. Der rekursive Wächter
 * im Test prüft den ganzen Baum trotzdem — auch für Felder, die es heute nicht gibt.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */

function nullableNumber(description: string) {
  return { type: ['number', 'null'], description } as const
}

function nullableString(description: string) {
  return { type: ['string', 'null'], description } as const
}

export const BATTERY_SPEC_SCAN_JSON_SCHEMA: { [key: string]: unknown } = {
  type: 'object',
  additionalProperties: false,
  required: [...BATTERY_SPEC_LABEL_KEYS, ...BATTERY_SPEC_NUMBER_KEYS],
  properties: {
    manufacturer: nullableString(
      'Der Hersteller des Speichers, wörtlich so wie er im Dokument steht (z. B. "Sungrow", ' +
        '"BYD", "Fronius"). Nicht ausschreiben, nicht ergänzen, nicht aus dem Modellnamen ' +
        'erschliessen. null, wenn er nicht dasteht.',
    ),
    model: nullableString(
      'Die Modell- oder Typbezeichnung, wörtlich so wie sie im Dokument steht (z. B. "SBR128", ' +
        '"Battery-Box Premium HVS 10.2"). Beschreibt das Dokument mehrere Varianten einer ' +
        'Produktfamilie und ist keine davon hervorgehoben, nenne die FAMILIE, so wie sie ' +
        'dasteht. null, wenn keine Bezeichnung dasteht.',
    ),
    capacityKwh: nullableNumber(
      'NUTZBARE Speicherkapazität in Kilowattstunden (kWh). Ausdrücklich NICHT die Brutto-, ' +
        'Nenn- oder Gesamtkapazität und nicht die Zellkapazität — steht nur eine solche da, ist ' +
        'das Feld null. Rechne NICHTS über eine Entladetiefe um. Nicht aus einer Leistungsangabe ' +
        'in kW erschliessen: das sind verschiedene Grössen.',
    ),
    maxPowerKw: nullableNumber(
      'DAUERHAFTE Lade-/Entladeleistung in Kilowatt (kW). Ausdrücklich NICHT die Spitzen-, ' +
        'Peak- oder Boost-Leistung. Unterscheiden sich Lade- und Entladeleistung, nimm die ' +
        'KLEINERE. Nicht aus der Kapazität erschliessen.',
    ),
    roundTripEfficiencyPercent: nullableNumber(
      'ROUND-TRIP-Wirkungsgrad des Speichersystems in PROZENT (0 bis 100) — „90 %" ergibt 90, ' +
        'nicht 0,9. Ausdrücklich NICHT der Wirkungsgrad des Wechselrichters, des Umrichters oder ' +
        'einer Ladung allein; steht nur ein solcher da, ist das Feld null. Ein Wirkungsgrad über ' +
        '100 ist unmöglich; steht dort etwas anderes, ist das Feld ebenfalls null.',
    ),
    pricePerKwh: nullableNumber(
      'Preis in Euro je Kilowattstunde Kapazität, falls das Dokument einen nennt. Ein ' +
        'Gesamtpreis ist NICHT dasselbe — ihn nur dann umrechnen, wenn die nutzbare Kapazität ' +
        'eindeutig danebensteht. Die meisten Datenblätter nennen keinen Preis; dann ist das ' +
        'Feld null.',
    ),
  },
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Die Auswertung.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Eine positive, endliche Zahl — oder `null`.
 *
 * ⚠ `NaN` und `Infinity` sind in JavaScript `typeof 'number'` und liefen ohne diese Prüfung als
 * gültige Angabe durch; `NaN` vergiftet danach jede Rechnung lautlos. Eine Zahl als ZEICHENKETTE
 * wird ausdrücklich NICHT gerettet: wer „20,5" parst, entscheidet zwischen 20,5 und 205.
 *
 * `> 0`, nicht `>= 0`: eine Batterie mit 0 kWh, 0 kW oder 0 % Wirkungsgrad ist keine Batterie.
 * Dieselbe Regel wie in `battery-text.ts` — beide füllen dieselben Felder.
 */
function positiveNumber(value: unknown, max?: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  if (max !== undefined && value > max) return null
  return value
}

/**
 * Eine wörtlich übernommene Beschriftung — oder `null`. Nie gekürzt, nur angenommen oder nicht.
 *
 * ⚠ Zu lang heisst NICHT „kürzen": eine halbierte Typbezeichnung wäre ein Wert, der so nirgends
 * im Dokument steht, und dieselbe Angabe halb dargestellt ist irreführender als gar keine.
 */
function shortLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  // Steuerzeichen und Zeilenumbrüche zu einfachen Leerzeichen: ein Etikett ist einzeilig.
  const cleaned = value.replace(/\s+/g, ' ').trim()
  if (cleaned === '') return null
  if (cleaned.length > MAX_BATTERY_SPEC_LABEL_CHARS) return null
  return cleaned
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * Wertet die Antwort des Modells aus — FAIL CLOSED, Feld für Feld.
 *
 * Es wird nichts geworfen und nichts gerettet. Eine vollständig unbrauchbare Antwort ergibt ein
 * gültiges Ergebnis, in dem nichts erkannt wurde — genau die Antwort, die ein Dokument verdient,
 * das gar kein Batterie-Datenblatt ist. „Unlesbar" ist kein Programmfehler, sondern ein Befund,
 * und der Aufrufer soll ihn zeigen können.
 */
export function parseBatterySpecExtraction(raw: unknown): BatterySpecExtraction {
  const root = record(raw)
  return {
    manufacturer: shortLabel(root.manufacturer),
    model: shortLabel(root.model),
    capacityKwh: positiveNumber(root.capacityKwh),
    maxPowerKw: positiveNumber(root.maxPowerKw),
    // Ein Wirkungsgrad über 100 % ist physikalisch unmöglich — und 0 % wäre keine Batterie.
    roundTripEfficiencyPercent: positiveNumber(root.roundTripEfficiencyPercent, 100),
    pricePerKwh: positiveNumber(root.pricePerKwh),
  }
}

/**
 * Hat die Auswertung überhaupt etwas gefunden?
 *
 * ── ⚠ HERSTELLER UND MODELL ZÄHLEN HIER MIT, OBWOHL SIE KEIN FELD FÜLLEN ──────────────────────
 * Die Frage dieser Funktion ist „hat der Aufruf etwas gelesen?", nicht „ist das Ergebnis
 * brauchbar?". Ein Datenblatt, aus dem Hersteller und Typ hervorgehen, aber keine Kennzahl, ist
 * gelesen worden — es ist nur ein schlechtes Datenblatt. Der Unterschied ist nicht akademisch:
 * DASS die vier Zahlenfelder leer bleiben können, obwohl der Scan lief, prüft die Server Action
 * ein zweites Mal und meldet es dort mit eigenem Satz (wortgleiche Lage wie beim Freitext-Weg,
 * wo `hasExistingBattery` allein denselben Fall erzeugt).
 */
export function batterySpecExtractionIsEmpty(extraction: BatterySpecExtraction): boolean {
  return (
    BATTERY_SPEC_LABEL_KEYS.every((key) => extraction[key] === null) &&
    BATTERY_SPEC_NUMBER_KEYS.every((key) => extraction[key] === null)
  )
}
