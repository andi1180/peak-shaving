/**
 * Delta 17, Teil 2 — DER VERTRAG DER BATTERIE-FREITEXTERFASSUNG.
 *
 * ── WOZU ES DIESEN BAUSTEIN GIBT ───────────────────────────────────────────────────────────────
 * Der Rechner kennt heute genau EINEN Fall: „der Kunde hat keine Batterie, wir empfehlen eine".
 * Ein Umschalter für „ich habe schon eine" existiert nirgends (repo-weit gemessen: 0 Fundstellen).
 * Wer bereits einen Speicher besitzt, findet im Formular deshalb keine Stelle, an der er das sagen
 * könnte — und bekommt eine Empfehlung für ein Gerät, das er hat.
 *
 * Dieses Modul nimmt dafür einen Satz in eigenen Worten entgegen („Sungrow, 20 kWh, 90 %
 * Wirkungsgrad") und macht daraus einen VORSCHLAG. Es erfindet dabei keinen neuen Mechanismus:
 * was am Ende passiert, ist ausschliesslich das, was das Annahmen-Panel (§6.2) seit U2 Prompt C
 * ohnehin kann — ein `batteryOverride` auf GENAU EINEN Katalog-Kandidaten, und zwar nur auf
 * Wirkungsgrad und Preis.
 *
 * ── ⚠ DIE KATALOG-ZUORDNUNG IST AM 01.09.2026 ENTFALLEN ──────────────────────────────────────
 * Bis dahin stand hier `matchCatalogByCapacity`: eine genannte Kapazität führte nicht zu einer
 * neuen Kapazitätsstufe, sondern zur AUSWAHL des nächstliegenden Katalog-Kandidaten, und der
 * Abstand wurde benannt statt weggerundet. Die Begründung war, dass es für eine erfundene
 * Kapazität keinen Preis gibt. Für die KAUFENTSCHEIDUNG trägt sie weiterhin — für die bereits
 * INSTALLIERTE Anlage trägt sie nicht: dort wird gar kein Preis gezeigt (sie ist bezahlt), und
 * übrig blieb eine Rechnung über ein Gerät, das der Kunde nicht besitzt. Wer 19,2 kWh hat, sah
 * die Ersparnis von 15 kWh und hielt sie für seine.
 *
 * Die bestehende Anlage wird deshalb mit ihren EXAKTEN Werten simuliert
 * (`buildExistingBatteryCandidate` in `battery-combination.ts`) und läuft ausdrücklich nicht mehr
 * durch den Katalog. Dieses Modul liest seither nur noch, was im Satz steht.
 *
 * ── WARUM DIESER TEIL IN `shared` LIEGT ────────────────────────────────────────────────────────
 * Wortgleich zu `invoice-scan.ts`, `report-gate.ts` und `upload-classification.ts`:
 * `apps/website` hat KEINEN eigenen Testlauf. Hier steht genau der Teil, der sich ohne einen
 * Modellaufruf prüfen lässt — Zielschema und Auswertung.
 *
 * Die Datei hat NULL Importe. Kein zod (`apps/website` führt es nicht), und das JSON-Schema ist
 * die WIRE-Fassung, die an die API geht.
 */
/**
 * Was aus einem Satz über die eigene Batterie gelesen werden kann. Jedes Feld einzeln:
 * Wert ODER „nicht erkennbar" — nie „vermutlich 0" (dieselbe Regel wie im Rechnungs-Scan).
 */
export interface BatteryTextExtraction {
  /**
   * Sagt der Text, dass bereits eine Batterie vorhanden ist?
   *
   * `true` = vorhanden · `false` = ausdrücklich keine (…„wir haben noch keine, was empfehlt ihr?")
   * · `null` = der Text sagt dazu nichts. Die drei Fälle sind verschieden: nur bei `true` entsteht
   * überhaupt ein Vorschlag, `false` und `null` lassen den Rechner unverändert empfehlen.
   */
  hasExistingBattery: boolean | null
  /** Nutzbare Kapazität in kWh, falls genannt. Bestimmt den vorgeschlagenen Kandidaten. */
  capacityKwh: number | null
  /**
   * Lade-/Entladeleistung in kW, falls genannt.
   *
   * ⚠ Sie ist NICHT überschreibbar und geht in keine Rechnung ein. Sie wird trotzdem gelesen und
   * ANGEZEIGT: ein 20-kWh-Speicher mit 5 kW ist ein anderes Gerät als einer mit 20 kW, und der
   * Nutzer entscheidet über den vorgeschlagenen Kandidaten besser, wenn er sieht, dass wir seine
   * Zahl gelesen und bewusst nicht verwendet haben. Sie stillschweigend wegzuwerfen wäre der
   * schlechtere Umgang mit einer Angabe, die er gemacht hat.
   */
  maxPowerKw: number | null
  /**
   * Wirkungsgrad in PROZENT (0–100), so wie ein Mensch ihn schreibt („90 %").
   *
   * Der Katalog führt ihn als Bruchteil (0,9). Umgerechnet wird an GENAU EINER Stelle, beim
   * Übernehmen in den Override — hier bleibt stehen, was im Text stand.
   */
  roundTripEfficiencyPercent: number | null
  /** Preis in Euro je kWh, falls genannt. Zweites (und letztes) überschreibbares Feld. */
  pricePerKwh: number | null
}

/** Die Feldnamen, in fester Reihenfolge — von Schema, Auswertung und Test geteilt. */
export const BATTERY_TEXT_NUMBER_KEYS = [
  'capacityKwh',
  'maxPowerKw',
  'roundTripEfficiencyPercent',
  'pricePerKwh',
] as const satisfies readonly (keyof BatteryTextExtraction)[]

/** Ein Ergebnis, in dem nichts erkannt wurde. Der Ausgangszustand jeder Auswertung. */
export function emptyBatteryTextExtraction(): BatteryTextExtraction {
  return {
    hasExistingBattery: null,
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
 * nennen, und der einzige zulässige Weg, es nicht zu beantworten, ist `null`.
 *
 * ⚠ Es gibt hier KEIN Aufzählungsfeld — also auch nicht die Schreibweise, die am 31.08.2026 den
 * Rechnungs-Scan mit HTTP 400 funktionslos gemacht hat (`type: [..., 'null']` ZUSAMMEN mit `enum`).
 * Die Typ-Union OHNE `enum` ist gegen die echte API als zulässig gemessen. Der rekursive Wächter
 * im Test prüft den ganzen Baum trotzdem — auch für Felder, die es heute nicht gibt.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */

function nullableNumber(description: string) {
  return { type: ['number', 'null'], description } as const
}

function nullableBoolean(description: string) {
  return { type: ['boolean', 'null'], description } as const
}

export const BATTERY_TEXT_JSON_SCHEMA: { [key: string]: unknown } = {
  type: 'object',
  additionalProperties: false,
  required: ['hasExistingBattery', ...BATTERY_TEXT_NUMBER_KEYS],
  properties: {
    hasExistingBattery: nullableBoolean(
      'true, wenn der Text sagt, dass bereits ein Batteriespeicher vorhanden oder bestellt ist. ' +
        'false, wenn er ausdrücklich sagt, dass keiner vorhanden ist. null, wenn der Text dazu ' +
        'nichts sagt.',
    ),
    capacityKwh: nullableNumber(
      'Nutzbare Speicherkapazität in Kilowattstunden (kWh), wenn der Text eine nennt. Nicht aus ' +
        'einer Leistungsangabe in kW erschliessen — das sind verschiedene Grössen.',
    ),
    maxPowerKw: nullableNumber(
      'Maximale Lade-/Entladeleistung in Kilowatt (kW), wenn der Text eine nennt. Nicht aus der ' +
        'Kapazität erschliessen.',
    ),
    roundTripEfficiencyPercent: nullableNumber(
      'Wirkungsgrad in PROZENT (0 bis 100), wenn der Text einen nennt — „90 %" ergibt 90, nicht ' +
        '0,9. Ein Wirkungsgrad über 100 ist unmöglich; steht dort etwas anderes, ist das Feld null.',
    ),
    pricePerKwh: nullableNumber(
      'Preis in Euro je Kilowattstunde Speicherkapazität, wenn der Text einen nennt. Ein ' +
        'Gesamtpreis für die Anlage ist NICHT dasselbe — ihn nur dann umrechnen, wenn die ' +
        'Kapazität eindeutig danebensteht.',
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
 */
function positiveNumber(value: unknown, max?: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  if (max !== undefined && value > max) return null
  return value
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
 * gültiges Ergebnis, in dem nichts erkannt wurde — genau die Antwort, die ein Satz ohne Angaben
 * verdient.
 */
export function parseBatteryTextExtraction(raw: unknown): BatteryTextExtraction {
  const root = record(raw)
  return {
    // Strikt: nur echte Wahrheitswerte. `'true'` oder `1` sähen wie eine Aussage aus und sind keine.
    hasExistingBattery:
      root.hasExistingBattery === true ? true : root.hasExistingBattery === false ? false : null,
    capacityKwh: positiveNumber(root.capacityKwh),
    maxPowerKw: positiveNumber(root.maxPowerKw),
    // Ein Wirkungsgrad über 100 % ist physikalisch unmöglich — und 0 % wäre keine Batterie.
    roundTripEfficiencyPercent: positiveNumber(root.roundTripEfficiencyPercent, 100),
    pricePerKwh: positiveNumber(root.pricePerKwh),
  }
}

/** Hat die Auswertung überhaupt etwas gefunden? Für die Oberfläche. */
export function batteryTextExtractionIsEmpty(extraction: BatteryTextExtraction): boolean {
  return (
    extraction.hasExistingBattery === null &&
    BATTERY_TEXT_NUMBER_KEYS.every((key) => extraction[key] === null)
  )
}
