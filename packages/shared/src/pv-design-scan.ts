/**
 * B22c — DER VERTRAG DES PV-AUSLEGUNGS-SCANS (Pflichtenheft §3(c), die SECHSTE KI-Anbindung).
 *
 * Er liest ein Planungsdokument (PV*SOL, PVsyst, Polysun, Hersteller-Konfigurator) und **belegt
 * ausschliesslich die Felder des Formulars aus B22b vor**. Er liefert keine Zeitreihe, keine
 * Koordinate und keine Erzeugungsrechnung — die macht PVGIS (B22a).
 *
 * ── WARUM DIESER TEIL IN `shared` LIEGT UND NICHT IN `apps/website` ────────────────────────────
 * Wortgleich zur Begründung in `invoice-scan.ts` und `report-gate.ts`: `apps/website` hat **keinen
 * eigenen Testlauf**. Was hier steht, ist genau der Teil, der sich ohne einen Aufruf an ein
 * Sprachmodell prüfen lässt — Zielschema, Auswertung und die Regel, wie aus einer Antwort eine
 * Formular-Vorbelegung wird. Läge er in der App, wäre er unprüfbar.
 *
 * ── ⚠ EIN UNTERSCHIED ZU `invoice-scan.ts`: DIESE DATEI IMPORTIERT ─────────────────────────────
 * Dort steht ausdrücklich „NULL Importe", und der Grund war zod: aus einem zod-Schema abgeleitet
 * stünde zwischen der geprüften und der gesendeten Fassung ein Generator. Dieser Grund gilt hier
 * unverändert (auch dieses JSON-Schema ist von Hand geschrieben und führt seine Werte als
 * Literale). Was hier dazukommt, ist ein Import INNERHALB von `shared` auf `./pv-design` — und
 * genau der ist die Auflage dieses Bauabschnitts: `CompassDirection`, `compassDegreeFitsDirection`
 * und `pvgisAzimuthToCompass` sind in B22b gebaut und getestet und werden **wiederverwendet, nicht
 * neu gebaut**. Eine zweite Umrechnung neben der einen bestehenden wäre exakt die Doppelung, gegen
 * die `pv-design.ts` geschrieben ist.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIE EINE STELLE, AN DER DIESER SCAN TEUER FALSCH WERDEN KANN — UND WIE SIE ABGEFANGEN IST
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * PV*SOL zählt den Azimut vom **Norden** (Kompass), PVGIS vom **Süden**. „Ausrichtung Südosten
 * 133 °" ist als PVGIS-`aspect` **−47** und nicht 133; ungeprüft übernommen zeigt die Anlage nach
 * Nordwesten und die Eigenverbrauchs-Ersparnis fällt gemessen um **56 %** — bei einer Zahl, die
 * völlig plausibel aussieht (Bestandsaufnahme 3.3).
 *
 * Daraus folgen drei Regeln, die dieses Modul strukturell durchsetzt:
 *
 *  1. **Himmelsrichtung UND gedruckte Gradzahl werden GETRENNT erfasst.** Ein Extraktor, der nur
 *     „133" liefert, ist strukturell unsicher — die Himmelsrichtung ist der Kreuzcheck gegen die
 *     Zahl, und ohne ihn ist die Konventions-Falle nicht zu fangen.
 *  2. **Die im Dokument verwendete Zählweise ist ein EIGENES Feld** (`azimuthConvention`). Das
 *     Formular kann nur prüfen, ob Richtung und Zahl zusammenpassen; WELCHE Zählweise ein fremdes
 *     Dokument benutzt, weiss es nicht — das muss der Leser des Dokuments sagen.
 *  3. **Es wird NIE still konvertiert und NIE still übernommen.** `pvDesignArrayPrefill` unten
 *     rechnet aus Zahl und Zählweise einen Kompass-KANDIDATEN und lässt ihn ausnahmslos durch
 *     `compassDegreeFitsDirection` laufen. Passt er nicht zur gelesenen Himmelsrichtung, wird das
 *     Gradfeld **nicht** vorbelegt und der Widerspruch benannt — nicht eine der beiden Angaben
 *     stillschweigend bevorzugt.
 *
 * ── ⚠ EIN EXTRAKTOR DARF NIEMALS EINEN PVGIS-`aspect` LIEFERN ──────────────────────────────────
 * `azimuthDeg` unten ist die **im Dokument gedruckte** Zahl, roh und unverändert. Die einzige
 * Umrechnung in die PVGIS-Konvention liegt in `pvArrayAzimuthDeg` (`pv-design.ts`) und wird erst
 * angewandt, nachdem ein Mensch die Vorbelegung bestätigt hat.
 *
 * ── ⚠ WAS AUS DIESEM SCAN KOMMT, IST NIEMALS EINE MESSUNG ──────────────────────────────────────
 * Der Rechnungs-Scan liest eine **Rechnung** — ein Dokument über Vergangenes, dessen Werte auf dem
 * Papier stehen (Prinzip 1). Eine PV-Auslegung ist die **Prognose eines Dritten**, deren
 * Eingangsgrössen (Neigung, Ausrichtung) selbst schon Planungsannahmen sind und die in sich
 * widersprüchlich sein kann (das vorliegende Dokument nennt `Neigung 90 °` bei gleichzeitig
 * `Einbausituation: Dachparallel`). Was daraus gelesen wird, ist deshalb in JEDEM Fall
 * `[ANNAHME]` / `pvSource: 'estimated'` — auch wenn die Extraktion fehlerfrei war.
 */

import {
  MAX_ARRAY_PEAK_POWER_KWP,
  compassDegreeFitsDirection,
  normalizeCompassDeg,
  pvgisAzimuthToCompass,
  type CompassDirection,
} from './pv-design'

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Die Wertebereiche.
 *
 * `PV_DESIGN_SCAN_DIRECTIONS` SPIEGELT `COMPASS_DIRECTIONS` (pv-design.ts) und leitet sie bewusst
 * nicht davon ab: das JSON-Schema unten muss die Werte als Literale führen, damit die API sie
 * erzwingen kann. `satisfies` fängt einen FALSCHEN Wert schon beim Übersetzen; dass die Liste
 * VOLLSTÄNDIG bleibt, prüft `pv-design-scan.test.ts` — er wird rot, sobald eine Himmelsrichtung
 * dazukommt. Dieselbe Aufteilung wie bei `INVOICE_SCAN_OPERATORS`.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */

/** Die Himmelsrichtungen, die der Scan benennen darf. Spiegel von `COMPASS_DIRECTIONS`. */
export const PV_DESIGN_SCAN_DIRECTIONS = [
  'N',
  'NO',
  'O',
  'SO',
  'S',
  'SW',
  'W',
  'NW',
] as const satisfies readonly CompassDirection[]

/**
 * Die Zählweise, in der das Dokument seine Gradzahl angibt.
 *
 * `from_north` ist die Kompass-Zählung (0° = Norden, 180° = Süden) und die von PV*SOL; `from_south`
 * ist die PVGIS-Zählung (0° = Süden, −90° = Osten). **Es gibt bewusst keinen dritten Wert
 * „unbekannt"** — `null` sagt das bereits, und ein eigener Enum-Wert dafür wäre eine zweite
 * Schreibweise für dieselbe Aussage (dieselbe Regel wie bei den `required`-Listen: genau EIN Weg,
 * „nicht erkennbar" auszudrücken).
 */
export const PV_DESIGN_SCAN_CONVENTIONS = ['from_north', 'from_south'] as const
export type PvDesignAzimuthConvention = (typeof PV_DESIGN_SCAN_CONVENTIONS)[number]

/**
 * Eine im Dokument ausgewiesene Modulfläche.
 *
 * ⚠ MEHRERE FLÄCHEN SIND DER NORMALFALL (Pflichtenheft §3(b)/(c); das vorliegende Dokument führt
 * zwei mit 4,25 und 5,95 kWp). Sie werden EINZELN gelesen und EINZELN vorbelegt — ein
 * zusammengefasster Wert („10,2 kWp bei mittlerer Ausrichtung") wäre eine gerechnete Zahl, die
 * nirgends dasteht, und bei zwei verschieden ausgerichteten Flächen ist die Tagesform der Summe
 * eine andere als die der gemittelten Fläche.
 */
export interface PvDesignArrayExtraction {
  /** Nennleistung dieser Fläche in kWp. */
  peakPowerKwp: number | null
  /** Neigung gegen die Horizontale in Grad. */
  slopeDeg: number | null
  /** Die im Dokument genannte HIMMELSRICHTUNG — der Kreuzcheck gegen die Gradzahl. */
  direction: CompassDirection | null
  /**
   * Die im Dokument GEDRUCKTE Gradzahl, roh und unverändert.
   *
   * ⚠ NIE ein PVGIS-`aspect` und nie etwas Umgerechnetes. Wie sie zu lesen ist, sagt
   * `azimuthConvention`; ob sie übernommen wird, entscheidet `pvDesignArrayPrefill`.
   */
  azimuthDeg: number | null
  /**
   * Zahl der Module dieser Fläche.
   *
   * ⚠ SIE BELEGT KEIN FORMULARFELD und geht in keine Rechnung ein — der Rechner braucht kWp,
   * Neigung und Ausrichtung, sonst nichts. Sie wird trotzdem gelesen, weil Pflichtenheft §3(c) sie
   * nennt und weil sie in der Vorschau den Feld-für-Feld-Abgleich gegen das Papier trägt: „10 ×
   * Module, 4,25 kWp" ist für einen Menschen die Zeile, an der er erkennt, ob die richtige Fläche
   * gelesen wurde. Reine Anzeige, ausdrücklich kein Rechenweg.
   */
  moduleCount: number | null
}

/** Das vollständige Ergebnis einer Extraktion. Jedes Feld einzeln: Wert oder „nicht erkennbar". */
export interface PvDesignExtraction {
  arrays: PvDesignArrayExtraction[]
  /** Die im Dokument verwendete Zählweise der Gradzahl — s. Kopf, Regel 2. */
  azimuthConvention: PvDesignAzimuthConvention | null
  /**
   * Der Standort, **als Freitext** und wortwörtlich aus dem Dokument.
   *
   * ── ⚠ ER BELEGT DAS PLZ-FELD NICHT, UND DAS IST EINE ENTSCHEIDUNG ──────────────────────────
   * Das Dokument trägt keine Koordinate; es nennt den Namen eines Klimadatensatzes („Wien 11, AUT
   * (1996 - 2015)"). Daraus eine Postleitzahl abzuleiten wäre dieselbe Art Rateleistung, die für
   * die PLZ-Zentroiden ausdrücklich ausgeschlossen ist (B22b: kein Geocoding, kein Fremddienst,
   * kein Treffer ⇒ `null`) — und eine falsch geratene PLZ verschöbe die Koordinate, ohne dass die
   * Zahl falsch aussähe. Der Text wird deshalb ANGEZEIGT („Erkannt: … — bitte PLZ selbst
   * eintragen") und sonst nichts.
   *
   * ── UND ER IST KEIN FREITEXTFELD IM SINN DER REGEL ─────────────────────────────────────────
   * „Kein Freitextfeld in der Rückgabe" (alle fünf bestehenden Anbindungen) verbietet **Prosa des
   * MODELLS** — Begründungen, Zusammenfassungen, Einschätzungen. Dies hier ist eine wörtlich
   * abgeschriebene Beschriftung des Dokuments, also gelesene Angabe und nicht Kommentar. Damit sie
   * das bleibt, ist sie in der Länge begrenzt (`MAX_PV_DESIGN_LOCATION_CHARS`): was darüber
   * hinausgeht, ist keine Ortsbezeichnung mehr, und die Auswertung verwirft es.
   */
  locationText: string | null
}

/** Die Feldnamen einer Modulfläche, in fester Reihenfolge — von Schema, Auswertung und Test geteilt. */
export const PV_DESIGN_ARRAY_KEYS = [
  'peakPowerKwp',
  'slopeDeg',
  'direction',
  'azimuthDeg',
  'moduleCount',
] as const satisfies readonly (keyof PvDesignArrayExtraction)[]

/**
 * Obergrenze der ausgewerteten Modulflächen.
 *
 * Sie ist eine SICHERHEITSGRENZE gegen eine ausufernde Antwort, keine fachliche Aussage — das
 * Formular fasst sechs (`MAX_ARRAYS` in `pv-design-panel.tsx`), und wenn ein Dokument mehr führt,
 * sagt die Oberfläche das im Klartext, statt still abzuschneiden. Sie steht bewusst NICHT als
 * `maxItems` im JSON-Schema: eine Schema-Konstruktion, die nicht gegen die ECHTE API gemessen ist,
 * ist in diesem Projekt eine Verbindlichkeit (der HTTP-400-Totalausfall vom 31.08.2026), und die
 * Auswertung unten ist die Stelle, die geprüft wird.
 */
export const MAX_PV_DESIGN_ARRAYS = 12

/** Längengrenze der Standort-Beschriftung — darüber ist es keine Ortsangabe mehr, s. `locationText`. */
export const MAX_PV_DESIGN_LOCATION_CHARS = 120

/** Obergrenze der Modulzahl je Fläche. Reine Plausibilitätsschranke gegen eine unsinnige Antwort. */
export const MAX_PV_DESIGN_MODULE_COUNT = 10000

/**
 * Ab dieser Neigung gilt eine Fläche als ungewöhnlich steil und wird in der Vorschau angemerkt.
 *
 * ⚠ DER ANLASS IST GEMESSEN, NICHT ERFUNDEN: Das vorliegende Dokument nennt `Neigung 90 °` und
 * gleichzeitig `Einbausituation: Dachparallel` bei einem Dokument mit dem Titel „PV am Hausdach".
 * Der Widerspruch ist aus dem Dokument NICHT auflösbar (Pflichtenheft §4, offener Punkt) — und
 * genau deshalb darf ein Extraktor einen solchen Wert **nicht stillschweigend übernehmen**. Er
 * wird übernommen (er kann echt sein — eine Fassadenanlage), aber sichtbar markiert.
 *
 * 60° ist die Grenze, oberhalb derer keine übliche Dachneigung mehr liegt. Sie sperrt nichts.
 */
export const PV_DESIGN_STEEP_SLOPE_DEG = 60

/** Ein Ergebnis, in dem NICHTS erkannt wurde. Der Ausgangszustand jeder Auswertung. */
export function emptyPvDesignExtraction(): PvDesignExtraction {
  return { arrays: [], azimuthConvention: null, locationText: null }
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Das JSON-Schema, das die API erzwingt.
 *
 * `additionalProperties: false` + vollständige `required`-Listen: das Modell MUSS jedes Feld
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
 * HTTP 400 abgewiesen — BEVOR das Modell das Dokument sieht. Am 31.08.2026 hat genau das den
 * Rechnungs-Scan in Produktion vollständig funktionslos gemacht (jeder Aufruf endete in
 * `api_error`), und ein Stub der Messages-API validiert das Schema NICHT und liess es durch.
 * Die Messreihe gegen die echte API steht im Kopf von `invoice-scan.ts`; der rekursive Wächter in
 * `pv-design-scan.test.ts` hält die Schreibweise für das GANZE Schema fest, auch für Felder, die
 * es heute noch nicht gibt.
 */
function nullableEnum<T extends string>(values: readonly T[], description: string) {
  return { anyOf: [{ type: 'string', enum: [...values] }, { type: 'null' }], description } as const
}

export const PV_DESIGN_SCAN_JSON_SCHEMA: { [key: string]: unknown } = {
  type: 'object',
  additionalProperties: false,
  required: ['arrays', 'azimuthConvention', 'locationText'],
  properties: {
    arrays: {
      type: 'array',
      description:
        'Alle im Dokument ausgewiesenen Modulflächen, EINZELN und in der Reihenfolge des ' +
        'Dokuments. Führt das Dokument nur eine Anlage ohne Aufteilung, ist das genau ein ' +
        'Eintrag. Fasse mehrere Flächen NIEMALS zu einer zusammen und rechne keine Summe — eine ' +
        'zusammengefasste Fläche steht nirgends im Dokument. Leere Liste, wenn keine Modulfläche ' +
        'erkennbar ist.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [...PV_DESIGN_ARRAY_KEYS],
        properties: {
          peakPowerKwp: nullableNumber(
            'Nennleistung DIESER Modulfläche in kWp. Nicht die Gesamtleistung der Anlage, wenn ' +
              'das Dokument sie je Fläche ausweist. Steht die Leistung in Wp oder W, durch 1000 ' +
              'teilen (425 Wp × 10 Module = 4,25 kWp).',
          ),
          slopeDeg: nullableNumber(
            'Neigung dieser Fläche gegen die Horizontale in Grad (0 = flach, 90 = senkrecht). ' +
              'Übernimm den Wert so, wie er dasteht — auch wenn er ungewöhnlich wirkt; rechne ' +
              'ihn nicht auf eine plausible Dachneigung um.',
          ),
          direction: nullableEnum(
            PV_DESIGN_SCAN_DIRECTIONS,
            'Die HIMMELSRICHTUNG dieser Fläche, wie das Dokument sie benennt: N, NO, O, SO, S, ' +
              'SW, W, NW. „Südosten" ist SO, „Süd-West" ist SW. Nur eintragen, wenn das Dokument ' +
              'die Richtung als WORT nennt — NICHT aus der Gradzahl erschliessen, denn dafür ' +
              'müsste die Zählweise feststehen, und genau die ist die offene Frage. null, wenn ' +
              'keine Himmelsrichtung ausgeschrieben dasteht.',
          ),
          azimuthDeg: nullableNumber(
            'Die im Dokument GEDRUCKTE Gradzahl der Ausrichtung, unverändert übernommen — bei ' +
              '„Ausrichtung Südosten 133 °" also 133. Rechne sie NICHT um, drehe sie nicht, ' +
              'ändere ihr Vorzeichen nicht. In welcher Zählweise sie zu lesen ist, gehört in das ' +
              'Feld azimuthConvention.',
          ),
          moduleCount: nullableNumber(
            'Zahl der Module dieser Fläche, falls das Dokument sie nennt („10 × Modul XY").',
          ),
        },
      },
    },
    azimuthConvention: nullableEnum(
      PV_DESIGN_SCAN_CONVENTIONS,
      'Wie das Dokument seine Gradzahlen zählt. "from_north" = vom Norden im Uhrzeigersinn ' +
        '(0° = Norden, 90° = Osten, 180° = Süden, 270° = Westen) — so zählen PV*SOL und die ' +
        'meisten Planungswerkzeuge; erkennbar daran, dass eine als „Südosten" bezeichnete Fläche ' +
        'rund 135° trägt. "from_south" = vom Süden (0° = Süden, −90° = Osten, +90° = Westen) — so ' +
        'zählt PVGIS; erkennbar an negativen Werten oder daran, dass „Südosten" rund −45° trägt. ' +
        'null, wenn sich das aus dem Dokument nicht sicher sagen lässt. Rate NICHT.',
    ),
    locationText: {
      type: ['string', 'null'],
      description:
        'Der Standort, WORTWÖRTLICH so, wie das Dokument ihn beschriftet — etwa die Bezeichnung ' +
        'des Klimadatensatzes („Wien 11, AUT (1996 - 2015)") oder eine Ortsangabe im Kopf des ' +
        'Dokuments. Keine eigene Beschreibung, keine Zusammenfassung, keine Koordinate und keine ' +
        'daraus abgeleitete Postleitzahl. null, wenn keine Ortsangabe dasteht.',
    },
  },
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Die Auswertung — FAIL CLOSED, Feld für Feld.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Eine Zahl im zulässigen Bereich — oder `null`.
 *
 * ⚠ `NaN` und `Infinity` sind in JavaScript `typeof 'number'` und liefen ohne diese Prüfung als
 * gültige Auslegung durch; `NaN` vergiftet danach jede Rechnung lautlos. Eine Zahl als
 * ZEICHENKETTE wird ausdrücklich NICHT gerettet — „4,25" zu parsen hiesse, zwischen 4,25 und 425
 * zu entscheiden (dieselbe Regel wie in `battery-text.ts` und `parseInvoiceExtraction`).
 */
function numberInRange(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** Eine wörtlich übernommene Beschriftung — oder `null`. Nie gekürzt, nur angenommen oder nicht. */
function shortLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  // Steuerzeichen und Zeilenumbrüche zu einfachen Leerzeichen: ein Etikett ist einzeilig.
  const cleaned = value.replace(/\s+/g, ' ').trim()
  if (cleaned === '') return null
  /*
   * Zu lang heisst NICHT „kürzen". Eine gekürzte Beschriftung wäre ein Wert, der so nirgends im
   * Dokument steht — und dieselbe Angabe halb dargestellt ist irreführender als gar keine.
   */
  if (cleaned.length > MAX_PV_DESIGN_LOCATION_CHARS) return null
  return cleaned
}

/**
 * Eine Modulfläche aus der Antwort.
 *
 * Die Gradzahl wird bewusst NICHT auf [0, 360) begrenzt: die PVGIS-Zählweise kennt negative Werte,
 * und die Zahl ist hier noch roh. Begrenzt ist sie auf einen vollen Umlauf in beide Richtungen —
 * darüber ist es keine Ausrichtung mehr.
 */
function parseArray(raw: unknown): PvDesignArrayExtraction {
  const obj = record(raw)
  return {
    peakPowerKwp: numberInRange(obj.peakPowerKwp, 0, MAX_ARRAY_PEAK_POWER_KWP),
    slopeDeg: numberInRange(obj.slopeDeg, 0, 90),
    direction: oneOf(obj.direction, PV_DESIGN_SCAN_DIRECTIONS),
    azimuthDeg: numberInRange(obj.azimuthDeg, -360, 360),
    moduleCount: numberInRange(obj.moduleCount, 1, MAX_PV_DESIGN_MODULE_COUNT),
  }
}

/** Trägt diese Fläche überhaupt eine Angabe? Eine durchweg leere ist Rauschen, kein Ergebnis. */
function arrayHasAnyValue(a: PvDesignArrayExtraction): boolean {
  return PV_DESIGN_ARRAY_KEYS.some((key) => a[key] !== null)
}

/**
 * Wertet die Antwort des Modells aus — es wird nichts geworfen und nichts gerettet.
 *
 * Auch eine vollständig unbrauchbare Antwort (kein Objekt, leer, falsch getippt) ergibt ein
 * gültiges Ergebnis, in dem schlicht nichts erkannt wurde — genau die Antwort, die ein
 * unlesbares Dokument verdient. „Unlesbar" ist kein Programmfehler, sondern ein Befund, und der
 * Aufrufer soll ihn zeigen können.
 */
export function parsePvDesignExtraction(raw: unknown): PvDesignExtraction {
  const root = record(raw)
  const rawArrays = Array.isArray(root.arrays) ? root.arrays : []

  const arrays = rawArrays
    // Zuerst kappen, dann auswerten: die Obergrenze ist eine Schranke gegen eine ausufernde
    // Antwort und darf nicht davon abhängen, wie viele Einträge sich als leer herausstellen.
    .slice(0, MAX_PV_DESIGN_ARRAYS)
    .map(parseArray)
    .filter(arrayHasAnyValue)

  return {
    arrays,
    azimuthConvention: oneOf(root.azimuthConvention, PV_DESIGN_SCAN_CONVENTIONS),
    locationText: shortLabel(root.locationText),
  }
}

/**
 * Hat die Extraktion etwas gefunden, das sich vorbelegen lässt?
 *
 * ⚠ Massgeblich sind AUSSCHLIESSLICH die Modulflächen. Ein Dokument, aus dem nur der Standort
 * gelesen wurde, belegt kein einziges Formularfeld (die PLZ wird ausdrücklich nicht abgeleitet,
 * s. `locationText`) — es wäre ein „Erfolg", nach dem der Nutzer alles selbst eintippt, während
 * die Oberfläche behauptet, das Dokument sei gelesen worden. Das ist der Fall `unreadable`.
 */
export function pvDesignExtractionIsEmpty(extraction: PvDesignExtraction): boolean {
  return extraction.arrays.length === 0
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Von der Antwort zur Vorbelegung — hier sitzt der Fang der Konventions-Falle.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */

/** Eine gelesene Gradzahl, die der gelesenen Himmelsrichtung widerspricht. */
export type PvDesignDegreeConflict = {
  /** Die Zahl, wie sie im Dokument steht. */
  printedDeg: number
  /** Was daraus unter der gelesenen Zählweise als Kompassgrad würde. */
  candidateCompassDeg: number
  /** Die gelesene Himmelsrichtung, gegen die geprüft wurde. */
  direction: CompassDirection
}

/** Was aus einer gelesenen Fläche im Formular ankommt. */
export type PvDesignArrayPrefill = {
  peakPowerKwp: number | null
  slopeDeg: number | null
  direction: CompassDirection | null
  /**
   * Der Kompassgrad für das Feld „Genauer Winkel" — **nur, wenn er zur Richtung passt**. Sonst
   * `null`, und der Nutzer sieht statt einer Zahl den Widerspruch.
   */
  compassDeg: number | null
  /** Gesetzt, wenn Gradzahl und Himmelsrichtung einander widersprechen. */
  degreeConflict: PvDesignDegreeConflict | null
  /**
   * Gesetzt, wenn eine Gradzahl gelesen wurde, aber KEINE Himmelsrichtung dazu.
   *
   * Dann fehlt der Kreuzcheck vollständig: ohne Richtung ist nicht entscheidbar, ob 133 „Südosten"
   * oder „Nordwesten" heisst — die beiden liegen 180° auseinander und kosten gemessen 56 % der
   * Ersparnis. Die Zahl wird deshalb angezeigt und NICHT übernommen.
   */
  unverifiedDeg: number | null
  /** Ungewöhnlich steile Neigung — s. `PV_DESIGN_STEEP_SLOPE_DEG`. Ein Hinweis, keine Sperre. */
  steepSlope: boolean
  /** Reine Anzeige, s. `PvDesignArrayExtraction.moduleCount`. */
  moduleCount: number | null
}

/**
 * Rechnet die gedruckte Gradzahl unter der gelesenen Zählweise in einen KOMPASS-Grad um.
 *
 * `from_south` ist die PVGIS-Zählung; die Rückrichtung dafür ist `pvgisAzimuthToCompass`
 * (`pv-design.ts`) — **die eine Stelle, die diese Umrechnung kennt**, hier wiederverwendet statt
 * neu geschrieben. Ohne Angabe oder bei `from_north` gilt die Zahl als Kompassgrad: das ist die
 * bei Planungswerkzeugen weitaus häufigere Zählweise, und die Annahme ist ungefährlich, weil
 * jeder Kandidat unten ausnahmslos gegen die Himmelsrichtung geprüft wird. Liegt das Dokument
 * tatsächlich in der anderen Zählweise, passt der Kandidat nicht — und das Feld bleibt leer,
 * statt um 180° verdreht vorbelegt zu werden.
 */
function candidateCompassDeg(printedDeg: number, convention: PvDesignAzimuthConvention | null): number {
  return convention === 'from_south'
    ? pvgisAzimuthToCompass(printedDeg)
    : normalizeCompassDeg(printedDeg)
}

/**
 * Die eine Regel, nach der aus einer gelesenen Fläche eine Vorbelegung wird.
 *
 * ⚠ SIE BEVORZUGT NIEMALS EINE DER BEIDEN ANGABEN. Widersprechen sich Gradzahl und
 * Himmelsrichtung, wird die Richtung vorbelegt (sie ist ein WORT und über alle Zählweisen hinweg
 * eindeutig) und die Zahl NICHT — samt einer Meldung, die beide nennt. Die Zahl stillschweigend
 * zu nehmen kostete gemessen 56 % der Ersparnis; die Richtung stillschweigend zu überschreiben
 * wäre derselbe Fehler mit umgekehrtem Vorzeichen.
 */
export function pvDesignArrayPrefill(
  array: PvDesignArrayExtraction,
  convention: PvDesignAzimuthConvention | null,
): PvDesignArrayPrefill {
  const base = {
    peakPowerKwp: array.peakPowerKwp,
    slopeDeg: array.slopeDeg,
    direction: array.direction,
    moduleCount: array.moduleCount,
    steepSlope: array.slopeDeg != null && array.slopeDeg >= PV_DESIGN_STEEP_SLOPE_DEG,
  }

  if (array.azimuthDeg == null) {
    return { ...base, compassDeg: null, degreeConflict: null, unverifiedDeg: null }
  }

  const candidate = candidateCompassDeg(array.azimuthDeg, convention)

  // Ohne Himmelsrichtung gibt es keinen Kreuzcheck — die Zahl wird gezeigt, nicht übernommen.
  if (array.direction == null) {
    return { ...base, compassDeg: null, degreeConflict: null, unverifiedDeg: array.azimuthDeg }
  }

  if (compassDegreeFitsDirection(array.direction, candidate)) {
    return { ...base, compassDeg: candidate, degreeConflict: null, unverifiedDeg: null }
  }

  return {
    ...base,
    compassDeg: null,
    degreeConflict: {
      printedDeg: array.azimuthDeg,
      candidateCompassDeg: candidate,
      direction: array.direction,
    },
    unverifiedDeg: null,
  }
}

/** Alle Flächen einer Extraktion, in der Reihenfolge des Dokuments. */
export function pvDesignPrefill(extraction: PvDesignExtraction): PvDesignArrayPrefill[] {
  return extraction.arrays.map((array) => pvDesignArrayPrefill(array, extraction.azimuthConvention))
}
