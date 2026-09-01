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
 * ── ⚠ DIE HARTE GRENZE: KAPAZITÄT UND LEISTUNG SIND NICHT ÜBERSCHREIBBAR ──────────────────────
 * Der Katalog bleibt fest (fünf Kandidaten, `demo-battery-catalog.ts`). Eine genannte Kapazität
 * führt deshalb NICHT zu einer neuen Kapazitätsstufe, sondern zur AUSWAHL des nächstliegenden
 * Kandidaten — und der Abstand dazu wird ausdrücklich benannt, statt weggerundet zu werden
 * (`matchCatalogByCapacity` unten). Wer 20 kWh besitzt, bekommt eine Rechnung über 15 oder 25 kWh
 * zu sehen, und er muss das WISSEN: sonst hält er eine Ersparnis für die seiner Anlage, die zu
 * einer anderen gehört.
 *
 * ── WARUM DIESER TEIL IN `shared` LIEGT ────────────────────────────────────────────────────────
 * Wortgleich zu `invoice-scan.ts`, `report-gate.ts` und `upload-classification.ts`:
 * `apps/website` hat KEINEN eigenen Testlauf. Hier steht genau der Teil, der sich ohne einen
 * Modellaufruf prüfen lässt — Zielschema, Auswertung und die Zuordnungsregel.
 *
 * Der einzige Import ist ein TYP-Import (`BatteryCandidate`); er ist zur Laufzeit nicht vorhanden
 * und erzeugt keine Kopplung. Kein zod (`apps/website` führt es nicht), und das JSON-Schema ist
 * die WIRE-Fassung, die an die API geht.
 */
import type { BatteryCandidate } from './battery'

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

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Die Zuordnung zum festen Katalog.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Das Ergebnis der Zuordnung einer genannten Kapazität zum FESTEN Katalog.
 *
 * Es trägt bewusst STRUKTUR statt eines fertigen Satzes (dieselbe Entscheidung wie bei
 * `TariffOptimizationBlocker`): die Oberfläche formuliert daraus, ohne eine Meldung parsen zu
 * müssen, und der Abstand bleibt maschinenlesbar.
 */
export type CatalogCapacityMatch = {
  /** Der vorgeschlagene Kandidat. Immer gesetzt — der Katalog ist nie leer. */
  candidateId: string
  /** Trifft die genannte Kapazität einen Kandidaten EXAKT? */
  exact: boolean
  /**
   * Die beiden Nachbarn, zwischen denen die Angabe liegt. Bei einem exakten Treffer beide `null`
   * (dort gibt es keinen Abstand zu benennen), ebenso jeweils der Rand, über den die Angabe
   * hinausragt.
   */
  lowerId: string | null
  upperId: string | null
  /** Liegt die Angabe ausserhalb der Katalogspanne? `null` = sie liegt darin. */
  outside: 'below' | 'above' | null
}

/**
 * Sucht den Katalog-Kandidaten, dessen nutzbare Kapazität einer genannten Kapazität am nächsten
 * liegt — und benennt den Abstand.
 *
 * ── ⚠ BEI GLEICHEM ABSTAND GEWINNT DER KLEINERE, UND DAS IST EINE FACHLICHE ENTSCHEIDUNG ──────
 * 20 kWh liegen genau zwischen 15 und 25. Der kleinere Kandidat rechnet die Ersparnis eher zu
 * NIEDRIG als zu hoch — und das ist die Richtung, in die dieses Projekt bei Unsicherheit irrt
 * (dieselbe Haltung wie „lieber nichts als geraten"). Eine zu hohe Ersparnis fällt niemandem als
 * Fehler auf, sondern als gutes Ergebnis.
 *
 * ⚠ Die Folge ist spürbar und muss in der Oberfläche sichtbar sein: die kleineren Kandidaten des
 * Katalogs sind `residential`/`static` und kappen deshalb GAR KEINE Spitzen (`peakShavingBlockers`,
 * Delta 3) — der Wechsel von 25 auf 15 kWh ist damit nicht bloss „etwas weniger", sondern ein
 * anderer Rechenweg. Genau deshalb ist der Vorschlag ein VORSCHLAG: der Mensch sieht beide
 * Nachbarn samt ihrer Bauart und wählt.
 *
 * @param capacityKwh Muss positiv sein; sonst gibt es nichts zuzuordnen (`null`).
 * @param catalog     Der feste Katalog. Leer → `null` (kein erfundener Kandidat).
 */
export function matchCatalogByCapacity(
  capacityKwh: number | null,
  catalog: readonly BatteryCandidate[],
): CatalogCapacityMatch | null {
  if (capacityKwh === null || !Number.isFinite(capacityKwh) || capacityKwh <= 0) return null
  if (catalog.length === 0) return null

  const sorted = [...catalog].sort((a, b) => a.usableCapacityKwh - b.usableCapacityKwh)

  const exactHit = sorted.find((b) => b.usableCapacityKwh === capacityKwh)
  if (exactHit) {
    return { candidateId: exactHit.id, exact: true, lowerId: null, upperId: null, outside: null }
  }

  const below = [...sorted].reverse().find((b) => b.usableCapacityKwh < capacityKwh) ?? null
  const above = sorted.find((b) => b.usableCapacityKwh > capacityKwh) ?? null

  if (!below && above) {
    // Unterhalb des kleinsten Kandidaten: der kleinste ist der nächstliegende, aber zu gross.
    return { candidateId: above.id, exact: false, lowerId: null, upperId: above.id, outside: 'below' }
  }
  if (below && !above) {
    return { candidateId: below.id, exact: false, lowerId: below.id, upperId: null, outside: 'above' }
  }
  if (!below || !above) return null

  const distanceBelow = capacityKwh - below.usableCapacityKwh
  const distanceAbove = above.usableCapacityKwh - capacityKwh
  // `<=` statt `<`: bei Gleichstand gewinnt der KLEINERE (Begründung oben).
  const candidateId = distanceBelow <= distanceAbove ? below.id : above.id

  return { candidateId, exact: false, lowerId: below.id, upperId: above.id, outside: null }
}
