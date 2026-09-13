/**
 * B24, Teil 1 — DER VERTRAG DER PV-ANLAGEN-FREITEXTERFASSUNG.
 *
 * ── WOZU ES DIESEN BAUSTEIN GIBT ───────────────────────────────────────────────────────────────
 * Die PV-Station des Wizards kennt bis hierher genau EINEN Weg zur Erzeugung: eine hochgeladene
 * Datei mit gemessenen Werten. Der trägt, wo ein Wechselrichter-Portal sie hergibt. Der häufigere
 * Fall beim betreuten Erfassen ist ein anderer — der Kunde HAT eine Anlage, aber keine Zeitreihe;
 * er weiss, wie gross sie ist, wohin sie zeigt und wie steil das Dach ist.
 *
 * Genau diese drei Angaben nimmt dieses Modul aus einem Satz in eigenen Worten entgegen. Sie sind
 * die vollständige Eingabe des PVGIS-Verfahrens (B22a/B22b: Standort, kWp, Ausrichtung, Neigung)
 * — der Standort steht bereits am Projekt, die übrigen drei stehen hier.
 *
 * ⚠ ES WIRD IN DIESEM SCHRITT NICHTS GERECHNET. Was hier herauskommt, sind drei Zahlen bzw. eine
 * Himmelsrichtung im Entwurf des Zählpunkts. Der PVGIS-Abruf und die erzeugte Kurve sind ein
 * eigener Bauabschnitt; bis dahin ist dies eine reine Erfassung.
 *
 * ── ⚠ DIE ZWEITE QUELLE DERSELBEN DREI FELDER IST DER PV-AUSLEGUNGS-SCAN ──────────────────────
 * `pvDesignArrayPrefill` (`pv-design-scan.ts`) liefert `peakPowerKwp`, `slopeDeg` und `direction`
 * unter EXAKT denselben Namen. Das ist kein Zufall, sondern der Zuschnitt: beide Wege münden in
 * dieselben drei Formularfelder und über `pv-array-draft.ts` (`apps/web`) in denselben Entwurf.
 * Die Bindung steht dort, wo sie wirkt — die Feldtabelle bindet ihre Schlüssel per Typ an BEIDE
 * Quellen und wird rot, sobald eine von ihnen umbenennt.
 *
 * ⚠ EIN UNTERSCHIED IST WESENTLICH UND KEIN VERSEHEN: dieses Modul hat KEIN `azimuthDeg` und keine
 * `azimuthConvention`. Ein gedrucktes Planungsdokument nennt eine Gradzahl in einer Zählweise, die
 * man ihm nicht ansieht (PV*SOL zählt vom Norden, PVGIS vom Süden — die Verwechslung kostet
 * gemessen 56 % der Ersparnis, s. Kopf von `pv-design-scan.ts`). Deshalb erfasst der SCAN Richtung
 * und Zahl getrennt und kreuzt sie gegeneinander. Ein Satz eines Menschen hat dieses Problem nicht:
 * er sagt „nach Südwesten", und das ist über alle Zählweisen hinweg eindeutig. Eine BLOSSE Gradzahl
 * im Freitext („135 Grad") ist dagegen unauflösbar — sie wird ausdrücklich NICHT übernommen, und
 * der System-Prompt des Extraktors sagt das im Klartext.
 *
 * ── WARUM DIESER TEIL IN `shared` LIEGT ────────────────────────────────────────────────────────
 * Wortgleich zu `invoice-scan.ts`, `battery-text.ts` und `pv-design-scan.ts`: hier steht genau der
 * Teil, der sich OHNE einen Modellaufruf prüfen lässt — Zielschema und Auswertung.
 *
 * ── ⚠ DIE FACHLICHE REGEL, DIE ALLES TRÄGT: LIEBER NICHTS ALS GERATEN ─────────────────────────
 * Aus diesen drei Angaben wird später eine ERZEUGUNGSKURVE, und aus ihr eine Ersparnis. Jede
 * einzelne verschiebt sie unmittelbar: eine um 90° gedrehte Ausrichtung verschiebt die Tagesform,
 * eine erfundene kWp-Zahl die Höhe. Und keine davon sieht im Report falsch aus.
 *
 * Die zwei Schlüsse, die dabei besonders nahe liegen und beide verboten sind:
 *   • aus einem ORT auf eine Ausrichtung („Südhanglage", „Haus an der Südstrasse") — eine Adresse
 *     sagt über die Neigung eines Daches nichts;
 *   • aus einem JAHRESERTRAG auf die Nennleistung („macht 9.000 kWh im Jahr") — das verlangte eine
 *     Annahme über den spezifischen Ertrag, also genau die Zahl, die PVGIS später liefern soll.
 */

import { COMPASS_DIRECTIONS, MAX_ARRAY_PEAK_POWER_KWP, type CompassDirection } from './pv-design'

/**
 * Was aus einem Satz über die eigene PV-Anlage gelesen werden kann. Jedes Feld einzeln:
 * Wert ODER „nicht erkennbar" — nie „vermutlich 0" (dieselbe Regel wie im Rechnungs-Scan).
 */
export interface PvArrayTextExtraction {
  /** Nennleistung der Modulfläche in kWp, falls genannt. */
  peakPowerKwp: number | null
  /**
   * Die Himmelsrichtung, falls der Text sie als WORT nennt.
   *
   * ⚠ NIE aus einer Gradzahl erschlossen (s. Kopf) und nie aus einem Ort.
   */
  direction: CompassDirection | null
  /** Neigung gegen die Horizontale in Grad (0 = flach, 90 = senkrecht), falls genannt. */
  slopeDeg: number | null
}

/**
 * Die Feldnamen, in fester Reihenfolge — von Schema, Auswertung und Test geteilt.
 *
 * ⚠ `direction` steht hier NICHT: es ist kein Zahlenfeld, und die Liste hat genau einen Zweck —
 * sie ist die Menge der Felder, über die eine Zahlenprüfung laufen darf.
 */
export const PV_ARRAY_TEXT_NUMBER_KEYS = [
  'peakPowerKwp',
  'slopeDeg',
] as const satisfies readonly (keyof PvArrayTextExtraction)[]

/**
 * Die Himmelsrichtungen, die der Extraktor benennen darf.
 *
 * ── ⚠ ABGELEITET UND NICHT GESPIEGELT — begründete Abweichung vom Nachbarmodul ────────────────
 * `PV_DESIGN_SCAN_DIRECTIONS` (`pv-design-scan.ts`) schreibt dieselben acht Werte als Literale aus
 * und lässt einen Test prüfen, dass die Liste vollständig bleibt. Eine DRITTE Fassung daneben
 * bräuchte einen dritten solchen Test — und genau den spart die Ableitung: was hier steht, IST
 * `COMPASS_DIRECTIONS`, es kann gar nicht auseinanderlaufen.
 *
 * Für das JSON-Schema unten macht das keinen Unterschied: dort zählt der LAUFZEIT-Inhalt des
 * Arrays, und der ist derselbe. Die Reihenfolge ist die Anzeigereihenfolge der Auswahlliste (sie
 * beginnt bei Süden); für eine `enum`-Liste ist sie ohne Bedeutung.
 */
export const PV_ARRAY_TEXT_DIRECTIONS: readonly CompassDirection[] = COMPASS_DIRECTIONS.map(
  (entry) => entry.key,
)

/**
 * Obergrenze der Neigung in Grad. 90° ist senkrecht (Fassade) — mehr gibt es nicht.
 *
 * Die Untergrenze ist ausdrücklich 0 und nicht „grösser als 0": eine flach aufgelegte Fläche ist
 * eine reale Bauweise, und 0 ist dort eine ANGABE. (Bei der Nennleistung ist das anders — 0 kWp
 * wäre keine Anlage; dort gilt `> 0`.)
 */
export const MAX_PV_ARRAY_SLOPE_DEG = 90

/** Ein Ergebnis, in dem nichts erkannt wurde. Der Ausgangszustand jeder Auswertung. */
export function emptyPvArrayTextExtraction(): PvArrayTextExtraction {
  return { peakPowerKwp: null, direction: null, slopeDeg: null }
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Das JSON-Schema, das die API erzwingt.
 *
 * `additionalProperties: false` + vollständige `required`-Liste: das Modell MUSS jedes Feld
 * nennen, und der einzige zulässige Weg, es nicht zu beantworten, ist `null`.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */

function nullableNumber(description: string) {
  return { type: ['number', 'null'], description } as const
}

/**
 * Ein Aufzählungsfeld, das auch `null` sein darf.
 *
 * ── ⚠ `anyOf` UND NICHT `type: ['string','null']` MIT `null` IN DER `enum`-LISTE ───────────────
 * Die naheliegende Schreibweise ist nach JSON Schema gültig und wird von der API TROTZDEM mit
 * HTTP 400 abgewiesen — BEVOR das Modell den Text sieht. Am 31.08.2026 hat genau das den
 * Rechnungs-Scan in Produktion vollständig funktionslos gemacht (jeder Aufruf endete in
 * `api_error`), und ein Stub der Messages-API validiert das Schema NICHT und liess es durch.
 * Der rekursive Wächter im Test hält die Schreibweise für das GANZE Schema fest, auch für Felder,
 * die es heute noch nicht gibt.
 */
function nullableEnum<T extends string>(values: readonly T[], description: string) {
  return { anyOf: [{ type: 'string', enum: [...values] }, { type: 'null' }], description } as const
}

export const PV_ARRAY_TEXT_JSON_SCHEMA: { [key: string]: unknown } = {
  type: 'object',
  additionalProperties: false,
  required: ['peakPowerKwp', 'direction', 'slopeDeg'],
  properties: {
    peakPowerKwp: nullableNumber(
      'Nennleistung der Modulfläche in Kilowatt-Peak (kWp), wenn der Text eine nennt. Steht die ' +
        'Leistung je Modul in Wp oder W UND die Modulzahl daneben, darfst du multiplizieren und ' +
        'durch 1000 teilen (10 Module à 425 Wp = 4,25 kWp) — beide Zahlen müssen dafür dastehen. ' +
        'NICHT aus einem Jahresertrag in kWh erschliessen, NICHT aus einer Dachfläche in m², und ' +
        'NICHT aus der Leistung des Wechselrichters (die steht in kW und ist eine andere Grösse).',
    ),
    direction: nullableEnum(
      PV_ARRAY_TEXT_DIRECTIONS,
      'Die Himmelsrichtung, in die die Module zeigen: N, NO, O, SO, S, SW, W, NW. Nur eintragen, ' +
        'wenn der Text die Richtung als WORT nennt („nach Südwesten", „Ostausrichtung"). NICHT ' +
        'aus einer blossen Gradzahl erschliessen — in welcher Zählweise sie gemeint ist, steht ' +
        'in einem freien Satz nirgends. NICHT aus einem Ort, einer Adresse oder einer Lage ' +
        'erschliessen. Nennt der Text mehrere verschiedene Ausrichtungen (Ost-West-Anlage, zwei ' +
        'Dachflächen), ist das Feld null — hier wird genau EINE Fläche beschrieben.',
    ),
    slopeDeg: nullableNumber(
      'Neigung der Modulfläche gegen die Horizontale in GRAD (0 = flach liegend, 90 = senkrecht), ' +
        'wenn der Text eine nennt. Eine in PROZENT angegebene Dachneigung ist NICHT dasselbe ' +
        '(45 % sind rund 24°) — dann ist das Feld null. NICHT aus der Dachform erschliessen: aus ' +
        '„Flachdach" folgt keine 0, aus „Satteldach" keine 30.',
    ),
  },
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Die Auswertung — FAIL CLOSED, Feld für Feld.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Eine Zahl im zulässigen Bereich — oder `null`.
 *
 * ⚠ `NaN` und `Infinity` sind in JavaScript `typeof 'number'` und liefen ohne diese Prüfung als
 * gültige Angabe durch; `NaN` vergiftet danach jede Rechnung lautlos. Eine Zahl als ZEICHENKETTE
 * wird ausdrücklich NICHT gerettet — „4,25" zu parsen hiesse, zwischen 4,25 und 425 zu entscheiden
 * (dieselbe Regel wie in `battery-text.ts` und `parsePvDesignExtraction`).
 */
function numberInRange(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * Wertet die Antwort des Modells aus — es wird nichts geworfen und nichts gerettet.
 *
 * Auch eine vollständig unbrauchbare Antwort ergibt ein gültiges Ergebnis, in dem schlicht nichts
 * erkannt wurde — genau die Antwort, die ein Satz ohne Angaben verdient.
 *
 * ⚠ DIE UNTERGRENZEN SIND VERSCHIEDEN, UND DAS IST FACHLICH: die Nennleistung muss GRÖSSER als 0
 * sein (0 kWp wäre keine Anlage), die Neigung darf 0 SEIN (flach aufgelegt ist eine Bauweise).
 * `Number.MIN_VALUE` als Untergrenze schliesst die 0 aus, ohne eine willkürliche Mindestgrösse zu
 * erfinden.
 */
export function parsePvArrayTextExtraction(raw: unknown): PvArrayTextExtraction {
  const root = record(raw)
  return {
    peakPowerKwp: numberInRange(root.peakPowerKwp, Number.MIN_VALUE, MAX_ARRAY_PEAK_POWER_KWP),
    direction:
      typeof root.direction === 'string' &&
      (PV_ARRAY_TEXT_DIRECTIONS as readonly string[]).includes(root.direction)
        ? (root.direction as CompassDirection)
        : null,
    slopeDeg: numberInRange(root.slopeDeg, 0, MAX_PV_ARRAY_SLOPE_DEG),
  }
}

/** Hat die Auswertung überhaupt etwas gefunden? Für die Oberfläche. */
export function pvArrayTextExtractionIsEmpty(extraction: PvArrayTextExtraction): boolean {
  return (
    extraction.peakPowerKwp === null && extraction.direction === null && extraction.slopeDeg === null
  )
}
