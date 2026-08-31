/**
 * DER VERTRAG DES TARIFBLATT-SCANS — das Zielschema und die Auswertung seiner Antwort.
 *
 * Rein: kein `server-only`, kein `next/*`, kein SDK, kein Netz. Die einzige Abhängigkeit ist das
 * Vokabular nebenan (`./grid-tariffs`) — dieselbe Aufteilung wie `grid-tariffs-schema.ts`.
 *
 * ── ⚠ WARUM DIES EIN EIGENES SCHEMA IST UND KEINE ERWEITERUNG DES RECHNUNGS-SCANS ─────────────
 * Der Rechnungs-Scan (`packages/shared/src/invoice-scan.ts`, Delta 9b-2a) liest ein Dokument, das
 * ein KUNDE bekommen hat. Hier wird ein Dokument gelesen, das ein NETZBETREIBER veröffentlicht.
 * Das ist nicht dieselbe Frage in einer anderen Kulisse — die Felder gehen auseinander, und zwar
 * an vier Stellen, die jede für sich schon gegen eine gemeinsame Struktur sprechen:
 *
 *   1. DER BETREIBER IST DORT EIN GESCHLOSSENES ENUM (drei Werte, Spiegel von
 *      `NETZBETREIBER_IDS`). Dieses Formular ist ausdrücklich OFFEN: `operatorOptions`
 *      (./grid-tariffs) führt die bekannten Kennungen UND jede bereits eingetragene, und Delta 5
 *      nennt 9-10 Betreiber als Ziel. Unter dem Rechnungs-Enum wäre ein Preisblatt von Linz Netz
 *      nicht lesbar — für genau die Betreiber, für die dieses Formular gebaut wurde.
 *   2. `leistungspreisEurPerKwYear` KODIERT DIE EINHEIT IM FELDNAMEN. Ein Tarifblatt trennt
 *      Betrag und Einheit (`grundpreis_amount` / `grundpreis_unit`), und die Unterscheidung ist
 *      fachlich tragend: `eur_per_year` heisst Leistungspreis 0 EUR/kW·a und damit der Pfad ganz
 *      OHNE Spitzenkappung (Delta 3). Eine Tagespauschale liesse sich im Rechnungsfeld nur als
 *      `null` oder falsch ausdrücken.
 *   3. DAS RECHNUNGS-SCHEMA HAT KEIN DATUMSFELD UND KEIN ARRAY. Beides ist hier die eigentliche
 *      Fracht: der Gültigkeitsbeginn und die Zeitfensterliste.
 *   4. `priceBasis` und das Netzverlustentgelt fehlen dort ganz (`arbeitspreisNetzCtPerKwh` ist
 *      der Arbeitspreis der Netznutzung, NICHT das Netzverlustentgelt — zwei Posten).
 *
 * Gemeinsam sind genau `netzebene` und `meteringVariant`. Ein zusammengelegter Typ hiesse: je nach
 * Dokumentart sind zwei Drittel der Felder strukturell immer `null`, und die Auswertung müsste
 * verzweigen. Zusätzlich wird `invoice-scan.ts` vom ÖFFENTLICHEN Rechner gebündelt — Preisbasis,
 * Gültigkeitsbeginn und Fensterliste sind Admin-Begriffe und haben dort nichts verloren.
 *
 * ── WARUM HIER UND NICHT IN `packages/shared` ─────────────────────────────────────────────────
 * Der Rechnungs-Scan liegt dort aus EINEM Grund: `apps/website` hat keinen eigenen Testlauf, der
 * prüfbare Teil wäre in der App unprüfbar. Diese Zwangslage gibt es hier nicht — `apps/web` hat
 * seit B1-2 einen Testlauf, der die Testdateien unter `lib` einschliesst.
 *
 * Es spricht sogar etwas dagegen: Die Listen, mit denen dieses Schema übereinstimmen MUSS
 * (`NETZEBENEN`, `METERING_VARIANTS`, `GRUNDPREIS_UNITS`, `PRICE_BASES`), liegen in
 * `./grid-tariffs` — also in dieser App. Hier kann das Schema sie IMPORTIEREN. In `shared` abgelegt
 * müsste es sie ein zweites Mal ausschreiben, und der Abgleich wäre wieder ein Test statt einer
 * Tatsache. Der Rechnungs-Scan musste genau das tun und hat es sich mit drei Spiegel-Tests
 * erkauft; dieser Schritt braucht sie nicht.
 *
 * ── ⚠ DIE FACHLICHE REGEL, DIE ALLES TRÄGT — UND SIE WIEGT HIER SCHWERER ALS BEIM KUNDEN ──────
 * „Lieber nichts als geraten" gilt wie beim Rechnungs-Scan. Der Einsatz ist aber ein anderer: Ein
 * hier eingetragener Tarifstand ist NACHTRÄGLICH NICHT MEHR ÄNDERBAR (kein Bearbeiten, kein
 * Löschen, kein `delete`-Grant — B21-2b), und er ist die Grundlage, auf der der Kalkulator FREMDEN
 * Kunden eine Wirtschaftlichkeit ausrechnet. Ein falsch abgelesener Satz beim Rechnungs-Scan
 * betrifft eine Person, die ihre eigene Rechnung danebenliegen hat; ein falsch abgelesenes
 * Tarifblatt betrifft jede künftige Analyse dieser Netzebene.
 *
 * Deshalb ist jedes Feld einzeln `Wert ODER null`, und die Auswertung unten setzt zurück statt zu
 * retten. Zwei Regeln gehen darüber hinaus und sind unten an Ort und Stelle begründet:
 * Betrag+Einheit gelten nur ALS PAAR, und ein unvollständiges Zeitfenster wird VERWORFEN.
 */
import {
  GRUNDPREIS_UNITS,
  METERING_VARIANTS,
  NETZEBENEN,
  PRICE_BASES,
  type GrundpreisUnit,
  type MeteringVariant,
  type Netzebene,
  type PriceBasisValue,
} from './grid-tariffs'

/**
 * Obergrenze der hochgeladenen Datei in Bytes.
 *
 * Die API nimmt Anfragen bis 32 MB; base64 bläht eine Datei um rund ein Drittel auf. Ein
 * Preisblatt ist typischerweise umfangreicher als eine einzelne Rechnung (ein Blatt führt oft alle
 * Netzebenen und mehrere Entgeltarten), deshalb grosszügiger als die 6 MB des Rechnungs-Scans —
 * und weiterhin weit unter jeder Plattformgrenze.
 *
 * Der Wert ist die FACHLICHE Grenze; `bodySizeLimit` in `next.config.mjs` steht seit B14-2 auf
 * 24 MB und liegt damit bewusst darüber, sodass die ANWENDUNG ablehnt und mit einem Satz
 * antwortet, statt dass die Plattform die Anfrage vorher abschneidet. Dieselbe Staffelung wie bei
 * `MAX_SOURCE_FILE_BYTES` (20 MB fachlich) und beim Rechnungs-Scan (6 MB fachlich / 8 MB
 * Plattform).
 *
 * ⚠ Sie steht in diesem REINEN Modul und nicht beim Client — anders als beim Rechnungs-Scan, wo
 * sie in `ai-client.ts` liegt. Der Grund ist prüftechnisch und nicht kosmetisch: `ai-client.ts`
 * trägt `import 'server-only'` und ist im Testlauf nur als Attrappe ladbar. Läge die Grenze dort,
 * prüfte der Wächter der Server Action seinen eigenen erfundenen Wert statt des echten.
 */
export const MAX_TARIFF_SHEET_FILE_BYTES = 10 * 1024 * 1024

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Die Zielstruktur.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */

/** Ein Zeitfenster, wie es das Formular als `w{i}_*`-Block erwartet. */
export interface TariffSheetWindow {
  label: string
  /** `MM-TT` oder `null`. Beide Saisongrenzen gelten nur gemeinsam (s. Auswertung). */
  monthDayFrom: string | null
  monthDayTo: string | null
  /** `HH:MM`, Tagesende ausdrücklich `24:00`. */
  timeFrom: string
  timeTo: string
  ctPerKwh: number
}

/**
 * Das vollständige Ergebnis einer Extraktion.
 *
 * ⚠ `operatorName` IST FREITEXT UND AUSDRÜCKLICH KEINE KENNUNG. Das Modell darf die stabile
 * `operator_id` NICHT erfinden: sie trägt weder Fremdschlüssel noch CHECK, und ein Tippfehler
 * erzeugt keine Ablehnung, sondern eine ZWEITE Betreiber-Identität — `wiener_netze` und
 * `wienernetze` sind für den `unique`-Constraint aus B21-1 verschiedene Kombinationen, beide
 * bleiben offen, und die Effektiv-Datierung greift zwischen ihnen nie. Der Fehler fiele erst auf,
 * wenn eine Analyse den falschen Leistungspreis zieht (ausführlich im Kopf von `operatorOptions`,
 * ./grid-tariffs).
 *
 * Das Modell liefert deshalb NUR den gedruckten Namen. Die Zuordnung zu einer bestehenden Kennung
 * trifft die Oberfläche über einen Namensvergleich; findet sie keine, wählt sie „Anderer
 * Netzbetreiber …" und lässt das Kennungsfeld LEER — ein Mensch vergibt sie.
 */
export interface TariffSheetExtraction {
  operatorName: string | null
  netzebene: Netzebene | null
  meteringVariant: MeteringVariant | null
  grundpreisAmount: number | null
  grundpreisUnit: GrundpreisUnit | null
  netzverlustCtPerKwh: number | null
  priceBasis: PriceBasisValue | null
  /** `JJJJ-MM-TT`. */
  validFrom: string | null
  /** Kann leer sein — dann hat der Scan kein Fenster gefunden. */
  windows: TariffSheetWindow[]
}

/** Ein Ergebnis, in dem NICHTS erkannt wurde. Der Ausgangszustand jeder Auswertung. */
export function emptyTariffSheetExtraction(): TariffSheetExtraction {
  return {
    operatorName: null,
    netzebene: null,
    meteringVariant: null,
    grundpreisAmount: null,
    grundpreisUnit: null,
    netzverlustCtPerKwh: null,
    priceBasis: null,
    validFrom: null,
    windows: [],
  }
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Das JSON-Schema, das die API erzwingt.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */

function nullableNumber(description: string) {
  return { type: ['number', 'null'], description } as const
}

function nullableString(description: string) {
  return { type: ['string', 'null'], description } as const
}

/**
 * Ein Aufzählungsfeld, das auch `null` sein darf.
 *
 * ── ⚠ `anyOf` UND NICHT `type: [..., 'null']` MIT `null` IN DER `enum`-LISTE ──────────────────
 * Die naheliegende Schreibweise ist nach JSON Schema gültig und wird von der API TROTZDEM mit
 * HTTP 400 abgewiesen (`Enum value '…' does not match declared type`). Am 31.08.2026 hat genau
 * das den Rechnungs-Scan in Produktion VOLLSTÄNDIG funktionslos gemacht: der Fehler fällt VOR dem
 * Modellaufruf, jeder Scan endete in `api_error`, und ein Stub der Messages-API validiert das
 * Schema nicht und liess es anstandslos durch.
 *
 * Diese Fassung ist die gemessene (dort aus sieben Schreibweisen ermittelt) und hier bewusst
 * erneut ausgeschrieben statt importiert — der Rechnungs-Scan bleibt in diesem Schritt mit 0
 * Zeilen Diff unangetastet. Damit die Verdopplung nicht in den Defekt zurückfallen kann, prüft
 * `tariff-sheet-scan.test.ts` das GANZE Schema rekursiv auf die eine Kombination, die ihn erzeugt:
 * Typ-Union UND `enum` an derselben Stelle.
 */
function nullableEnum<T extends string | number>(
  type: 'string' | 'integer',
  values: readonly T[],
  description: string,
) {
  return {
    anyOf: [{ type, enum: [...values] }, { type: 'null' }],
    description,
  } as const
}

/** Die Felder eines Zeitfensters, in fester Reihenfolge — von Schema, Auswertung und Test geteilt. */
export const TARIFF_SHEET_WINDOW_KEYS = [
  'label',
  'monthDayFrom',
  'monthDayTo',
  'timeFrom',
  'timeTo',
  'ctPerKwh',
] as const satisfies readonly (keyof TariffSheetWindow)[]

export const TARIFF_SHEET_SCAN_JSON_SCHEMA: { [key: string]: unknown } = {
  type: 'object',
  additionalProperties: false,
  required: [
    'operatorName',
    'netzebene',
    'meteringVariant',
    'grundpreisAmount',
    'grundpreisUnit',
    'netzverlustCtPerKwh',
    'priceBasis',
    'validFrom',
    'windows',
  ],
  properties: {
    operatorName: nullableString(
      'Der Name des Netzbetreibers, GENAU so wie er auf dem Preisblatt gedruckt steht (zum ' +
        'Beispiel "Wiener Netze GmbH"). Erfinde keine Kurzform und keine technische Kennung. ' +
        'null, wenn kein Betreiber auf dem Dokument steht.',
    ),
    netzebene: nullableEnum(
      'integer',
      NETZEBENEN,
      'Die Netzebene (3 bis 7), für die dieses Preisblatt gilt. null, wenn das Blatt keine ' +
        'Netzebene ausweist oder mehrere zugleich behandelt, ohne dass eine erkennbar gemeint ist.',
    ),
    meteringVariant: nullableEnum(
      'string',
      METERING_VARIANTS,
      'Die Leistungsmessungs-Variante, für die dieser Tarif gilt, erschlossen aus den ' +
        'Formulierungen des Blattes. null, wenn das Blatt nicht danach unterscheidet.',
    ),
    grundpreisAmount: nullableNumber(
      'Der Betrag des Grund-/Leistungspreises der Netznutzung, als reine Zahl ohne Einheit. ' +
        'Die zugehörige Einheit gehört in grundpreisUnit — beide nur gemeinsam.',
    ),
    grundpreisUnit: nullableEnum(
      'string',
      GRUNDPREIS_UNITS,
      'Die Einheit des Grundpreises: "eur_per_kw_year" für einen Betrag je kW und Jahr (ein ' +
        'echter Leistungspreis), "eur_per_year" für eine reine Jahrespauschale ohne kW-Bezug. ' +
        'null, wenn die Einheit nicht eindeutig dasteht.',
    ),
    netzverlustCtPerKwh: nullableNumber(
      'Das Netzverlustentgelt in Cent je kWh. Das ist ein EIGENER Posten und nicht der ' +
        'Arbeitspreis der Netznutzung.',
    ),
    priceBasis: nullableEnum(
      'string',
      PRICE_BASES,
      'Ob die Beträge des Blattes netto ("net", ohne Umsatzsteuer) oder brutto ("gross") ' +
        'ausgewiesen sind. null, wenn das Blatt dazu nichts sagt.',
    ),
    validFrom: nullableString(
      'Der Tag, ab dem dieses Preisblatt gilt, als JJJJ-MM-TT (zum Beispiel "2026-01-01"). ' +
        'null, wenn kein Gültigkeitsbeginn dasteht — rechne ihn NICHT aus einem Druckdatum oder ' +
        'einer Jahreszahl im Titel zurück.',
    ),
    windows: {
      type: 'array',
      description:
        'Die zeitabhängigen Arbeitspreise der Netznutzung — je Preis ein Eintrag. Ein Blatt mit ' +
        'einem einzigen ganztägigen Arbeitspreis hat GENAU EINEN Eintrag. Leeres Array, wenn das ' +
        'Blatt keinen Arbeitspreis ausweist.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [...TARIFF_SHEET_WINDOW_KEYS],
        properties: {
          label: nullableString(
            'Kurze Bezeichnung des Fensters in Kleinbuchstaben, wie das Blatt es nennt: ' +
              '"normal" für den Regel-/Grundpreis, "snap" für ein Hochlastfenster (auch ' +
              '"Spitzenzeit", "Hochtarif"), "winter" für ein reines Winterfenster. Steht dort ' +
              'ein anderer Name, nimm ihn in Kleinbuchstaben.',
          ),
          monthDayFrom: nullableString(
            'Beginn der Saison als MM-TT (zum Beispiel "10-01"), wenn das Fenster nur in einem ' +
              'Teil des Jahres gilt. null, wenn es ganzjährig gilt. Ohne Jahreszahl.',
          ),
          monthDayTo: nullableString(
            'Ende der Saison als MM-TT (zum Beispiel "03-31"). null, wenn ganzjährig. Gib beide ' +
              'Saisongrenzen an oder keine.',
          ),
          timeFrom: nullableString(
            'Beginn der Tageszeit als HH:MM (zum Beispiel "17:00"). Ein ganztägiges Fenster ' +
              'beginnt um "00:00".',
          ),
          timeTo: nullableString(
            'Ende der Tageszeit als HH:MM. Ein ganztägiges Fenster endet um "24:00" — nicht ' +
              '"23:59" und nicht "00:00".',
          ),
          ctPerKwh: nullableNumber('Der Arbeitspreis dieses Fensters in Cent je kWh.'),
        },
      },
    },
  },
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Die Auswertung — fail closed, Feld für Feld.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Eine Zahl — oder `null`.
 *
 * ⚠ `NaN` und `Infinity` sind in JavaScript `typeof 'number'` und liefen ohne diese Prüfung als
 * gültiger Tarifsatz durch; `NaN` vergiftet danach jede Rechnung lautlos. Negative Beträge weist
 * `gridTariffSchema` ohnehin ab — hier abgefangen erscheinen sie als „nicht erkannt" statt später
 * als Formularfehler ohne Bezug zum Blatt.
 *
 * Eine Zahl als ZEICHENKETTE wird ausdrücklich NICHT gerettet: wer `"38,52"` parst, entscheidet
 * zwischen 38,52 und 3852.
 */
function finiteNonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function oneOf<T extends string | number>(value: unknown, allowed: readonly T[]): T | null {
  return allowed.includes(value as T) ? (value as T) : null
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** Eine nicht-leere Zeichenkette in vernünftiger Länge — sonst `null`. */
function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null
}

/**
 * Ein Muster-geprüfter Text. Die drei Ausdrücke sind WORTGLEICH die aus `grid-tariffs-schema.ts` —
 * was hier durchkommt, muss dort ebenfalls durchkommen, sonst befüllt der Scan ein Feld mit einem
 * Wert, den das Formular sofort wieder ablehnt.
 */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/
const MONTH_DAY_PATTERN = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function matching(value: unknown, pattern: RegExp): string | null {
  const trimmed = text(value, 32)
  return trimmed !== null && pattern.test(trimmed) ? trimmed : null
}

/**
 * Ein Kalendertag als `JJJJ-MM-TT`.
 *
 * Die Musterprüfung allein genügt nicht: `2026-02-31` passt darauf und ist kein Tag. Der
 * Rückweg über `toISOString` fängt das ab — er liefert für den 31. Februar den 3. März, und der
 * Vergleich schlägt fehl. Ohne diese Prüfung ginge ein solcher Wert in ein `date`-Feld des
 * Formulars, das ihn stillschweigend verschöbe.
 */
function isoDate(value: unknown): string | null {
  const raw = matching(value, DATE_PATTERN)
  if (raw === null) return null
  const parsed = new Date(`${raw}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10) === raw ? raw : null
}

/**
 * Ein Zeitfenster — oder `null`, wenn es unvollständig ist.
 *
 * ── ⚠ EIN HALB GELESENES FENSTER WIRD VERWORFEN, NICHT ERGÄNZT ────────────────────────────────
 * Bezeichnung, beide Uhrzeiten und der Arbeitspreis müssen dastehen. Fehlt eines, ist der ganze
 * Eintrag weg. Die Versuchung wäre, eine fehlende Uhrzeit auf „00:00"/„24:00" zu setzen — das
 * erfände ein GANZTÄGIGES Fenster aus einem, dessen Zeitraum unbekannt ist, und der Arbeitspreis
 * eines Hochlastfensters gälte plötzlich rund um die Uhr. Ein fehlendes Fenster sieht der Admin;
 * ein erfundenes sieht er nicht.
 *
 * ── DIE SAISON GILT NUR ALS PAAR ──────────────────────────────────────────────────────────────
 * Genau wie im Formular (`gridTariffWindowSchema.refine`): „ab 01.04." ohne Ende liesse offen, ob
 * das Fenster einen Tag oder neun Monate gilt. Halb gelesen wird deshalb zu ganzjährig — dem
 * Zustand, den der Admin auf dem Blatt sofort widerlegen kann.
 */
function parseWindow(raw: unknown): TariffSheetWindow | null {
  const obj = record(raw)

  const label = text(obj.label, 64)
  const timeFrom = matching(obj.timeFrom, TIME_PATTERN)
  const timeTo = matching(obj.timeTo, TIME_PATTERN)
  const ctPerKwh = finiteNonNegative(obj.ctPerKwh)

  if (label === null || timeFrom === null || timeTo === null || ctPerKwh === null) return null

  const monthDayFrom = matching(obj.monthDayFrom, MONTH_DAY_PATTERN)
  const monthDayTo = matching(obj.monthDayTo, MONTH_DAY_PATTERN)
  const seasonComplete = monthDayFrom !== null && monthDayTo !== null

  return {
    label,
    monthDayFrom: seasonComplete ? monthDayFrom : null,
    monthDayTo: seasonComplete ? monthDayTo : null,
    timeFrom,
    timeTo,
    ctPerKwh,
  }
}

/**
 * Wertet die Antwort des Modells aus — FAIL CLOSED, Feld für Feld.
 *
 * Es wird nichts geworfen und nichts gerettet: was nicht als sauberer Wert ankommt, ist `null`.
 * Auch eine vollständig unbrauchbare Antwort ergibt ein gültiges Ergebnis, in dem schlicht nichts
 * erkannt wurde — genau die Antwort, die ein unlesbares Blatt verdient.
 */
export function parseTariffSheetExtraction(raw: unknown): TariffSheetExtraction {
  const root = record(raw)

  /*
   * ── ⚠ BETRAG UND EINHEIT GELTEN NUR ALS PAAR ────────────────────────────────────────────────
   * Ein Betrag ohne Einheit ist keine halbe Angabe, sondern eine gefährliche: Das Formular
   * belegt die Einheit mit `eur_per_kw_year` vor, und ein übernommener Betrag ohne gelesene
   * Einheit behauptete damit einen LEISTUNGSPREIS — auch dann, wenn auf dem Blatt eine
   * Jahrespauschale steht. Der Unterschied ist genau der zwischen „Spitzenkappung lohnt sich" und
   * „Leistungspreis 0, gar keine Spitzenkappung" (Delta 3).
   *
   * Umgekehrt ist eine Einheit ohne Betrag wertlos. Fehlt eines von beiden, fallen beide auf
   * `null`, und der Admin trägt sie vom Blatt ab.
   */
  const grundpreisAmount = finiteNonNegative(root.grundpreisAmount)
  const grundpreisUnit = oneOf(root.grundpreisUnit, GRUNDPREIS_UNITS)
  const grundpreisComplete = grundpreisAmount !== null && grundpreisUnit !== null

  const windows = Array.isArray(root.windows)
    ? root.windows.map(parseWindow).filter((window): window is TariffSheetWindow => window !== null)
    : []

  return {
    operatorName: text(root.operatorName, 200),
    netzebene: oneOf(root.netzebene, NETZEBENEN),
    meteringVariant: oneOf(root.meteringVariant, METERING_VARIANTS),
    grundpreisAmount: grundpreisComplete ? grundpreisAmount : null,
    grundpreisUnit: grundpreisComplete ? grundpreisUnit : null,
    netzverlustCtPerKwh: finiteNonNegative(root.netzverlustCtPerKwh),
    priceBasis: oneOf(root.priceBasis, PRICE_BASES),
    validFrom: isoDate(root.validFrom),
    windows,
  }
}

/** Hat die Extraktion überhaupt etwas gefunden? Entscheidet den `unreadable`-Ausgang. */
export function tariffSheetExtractionIsEmpty(extraction: TariffSheetExtraction): boolean {
  return (
    extraction.operatorName === null &&
    extraction.netzebene === null &&
    extraction.meteringVariant === null &&
    extraction.grundpreisAmount === null &&
    extraction.grundpreisUnit === null &&
    extraction.netzverlustCtPerKwh === null &&
    extraction.priceBasis === null &&
    extraction.validFrom === null &&
    extraction.windows.length === 0
  )
}
