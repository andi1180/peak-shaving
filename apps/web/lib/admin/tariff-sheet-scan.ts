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
 * ── ⚠ EIN BLATT, VIELE TARIFZEILEN — DIE FORM, DIE DIESES MODUL SEIT TEIL B TRÄGT ─────────────
 * Bis zum 01.09.2026 beschrieb dieser Typ GENAU EINEN Tarifstand, und ein Preisblatt mit mehreren
 * Netzebenen nebeneinander — der REGELFALL — lieferte deshalb bewusst nur die blattweiten
 * Angaben: Netzebene, Grundpreis, Netzverlustentgelt und die gesamte Fensterliste blieben leer,
 * weil jede Auswahl EINER Zeile geraten gewesen wäre. Das war ehrlich und teuer: Der Admin tippte
 * das ganze Blatt ab.
 *
 * Die Struktur beantwortet das jetzt, statt die Frage ans Modell zurückzugeben: Ein Blatt zerfällt
 * in BLATTWEITE Angaben (Betreiber, Gültigkeitsbeginn, Preisbasis — sie gelten für jede Zeile
 * dieses Dokuments) und eine LISTE von Kandidaten, von denen jeder genau eine künftige Tarifzeile
 * beschreibt.
 *
 * ── ⚠⚠ DIE IDENTITÄT EINES KANDIDATEN IST DAS PAAR (netzebene, meteringVariant) ────────────────
 * NICHT die Netzebene allein. Das ist die tragende Feststellung dieses Umbaus, und sie ist
 * gemessen und nicht abgeleitet:
 *
 *   - `NETZEBENEN` kennt FÜNF Werte (3 bis 7), `NETZEBENEN_MIT_MESSVARIANTE` genau eine davon (7)
 *     mit DREI Varianten. Die Zahl unterscheidbarer Kombinationen ist damit 4 + 3 = SIEBEN — genau
 *     die sieben Tarifzeilen des Wiener-Netze-Blattes WN-EX0105, an dem der Fall aufgefallen ist.
 *     Ein Kandidaten-Array, das nur nach `netzebene` schlüsselte, klappte dessen drei NE-7-Zeilen
 *     zu einer zusammen und verlöre zwei Leistungspreise.
 *   - Es ist dieselbe Schlüsselform, die auch die Datenbank benutzt: der Constraint
 *     `unique nulls not distinct (operator_id, netzebene, metering_variant, valid_from)` aus
 *     B21-1. Ein Kandidat entspricht 1:1 einer künftigen Zeile, nicht ungefähr.
 *
 * ── ⚠ WAS „VERBINDLICH GESETZT" HIER HEISST — und wo die Vorgabe zu korrigieren war ───────────
 * `netzebene` ist INNERHALB eines Kandidaten nicht nullbar: Ein Eintrag, dessen Ebene unsicher
 * ist, gehört gar nicht in die Liste. Eine unsichere Zuordnung führt zu WENIGER Kandidaten, nie zu
 * einem Kandidaten mit unsicherer Identität — sonst entstünde aus einem Lesefehler eine Tarifzeile
 * unter falscher Ebene, und die ist nachträglich nicht mehr korrigierbar (B21-2b).
 *
 * `meteringVariant` KANN dagegen strukturell nicht nicht-nullbar sein, und das ist kein
 * Weichmacher: `METERING_VARIANTS` führt drei Werte, von denen KEINER „trifft nicht zu" bedeutet.
 * Auf den Netzebenen 3 bis 6 gibt es keine Variante, und genau dort gehört `null` in die
 * Datenbankspalte — der `nulls not distinct`-Constraint beruht darauf. Innerhalb eines Kandidaten
 * bedeutet `null` deshalb ENTSCHIEDEN „diese Kombination hat keine Variante", nicht „unsicher";
 * das Unsichere ist bereits vorher ausgeschieden.
 *
 * ── WAS AUS DER EINZELFASSUNG UNVERÄNDERT BLEIBT ──────────────────────────────────────────────
 * „Lieber nichts als geraten" gilt wie beim Rechnungs-Scan. Der Einsatz ist ein anderer: Ein hier
 * eingetragener Tarifstand ist NACHTRÄGLICH NICHT MEHR ÄNDERBAR (Löschen gibt es seit B21-2c, aber
 * als protokollierter Rückbau für Probeeinträge, nicht als Korrektur), und er ist die Grundlage,
 * auf der der Kalkulator FREMDEN Kunden eine Wirtschaftlichkeit ausrechnet.
 *
 * Jedes Feld bleibt deshalb einzeln `Wert ODER null`, und die Auswertung unten setzt zurück statt
 * zu retten. Die zwei Regeln, die darüber hinausgehen, gelten jetzt JE KANDIDAT statt global:
 * Betrag+Einheit gelten nur ALS PAAR, und ein unvollständiges Zeitfenster wird VERWORFEN. Ein
 * fehlerhafter Kandidat reisst die übrigen ausdrücklich NICHT mit.
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
 * GENAU EINE künftige Tarifzeile — eine Kombination aus Netzebene und Messvariante samt ihren
 * Preisen.
 *
 * ⚠ `netzebene` ist verbindlich, `meteringVariant` ist ENTSCHIEDEN nullbar (s. Kopf). Beides
 * zusammen ist die Identität des Eintrags; zwei Kandidaten mit derselben Kombination sind ein
 * Widerspruch und werden in der Auswertung verworfen.
 */
export interface TariffSheetCandidate {
  netzebene: Netzebene
  meteringVariant: MeteringVariant | null
  grundpreisAmount: number | null
  grundpreisUnit: GrundpreisUnit | null
  netzverlustCtPerKwh: number | null
  /** Kann leer sein — dann hat der Scan für diese Kombination kein Fenster gefunden. */
  windows: TariffSheetWindow[]
}

/**
 * Das vollständige Ergebnis einer Extraktion: die blattweiten Angaben plus die Kandidatenliste.
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
 *
 * ⚠ DIE DREI BLATTWEITEN FELDER SIND GEMESSEN, NICHT AUSGEDACHT: Es sind exakt die drei, die der
 * Scan am 01.09.2026 an WN-EX0105 geliefert hat, als er die ebenenabhängigen noch verweigerte.
 */
export interface TariffSheetExtraction {
  operatorName: string | null
  priceBasis: PriceBasisValue | null
  /** `JJJJ-MM-TT`. */
  validFrom: string | null
  /** Kann leer sein — dann hat der Scan keine einzige Tarifzeile sicher zuordnen können. */
  candidates: TariffSheetCandidate[]
}

/** Ein Ergebnis, in dem NICHTS erkannt wurde. Der Ausgangszustand jeder Auswertung. */
export function emptyTariffSheetExtraction(): TariffSheetExtraction {
  return { operatorName: null, priceBasis: null, validFrom: null, candidates: [] }
}

/**
 * Die Vorbelegung GENAU EINES Anlageformulars: die blattweiten Angaben plus ein Kandidat.
 *
 * ⚠ WARUM DIESE ZUSAMMENFÜHRUNG EINE EIGENE, GETESTETE FUNKTION IST UND KEINE `{...a, ...b}`-Zeile
 * in der Oberfläche: Das Formular legt eine Zeile an, die sich nicht mehr korrigieren lässt. Läge
 * die Zusammenführung an der Verwendungsstelle, gäbe es sie beim nächsten zweiten Aufrufer
 * zweimal — und zwei Fassungen, die auseinanderlaufen, ergäben zwei verschiedene Vorbelegungen für
 * dasselbe Blatt.
 *
 * `netzebene` ist hier — anders als im Kandidaten — nullbar: Es gibt den Fall, dass ein Blatt
 * gelesen wurde, aber keine einzige Zeile sicher zuordenbar war. Dann trägt die Vorbelegung nur
 * die blattweiten Angaben, das Formular zeigt „— bitte wählen —", und der Hinweis darunter sagt
 * genau das. Aus einem KANDIDATEN entsteht dieser Zustand nie.
 */
export interface TariffSheetFormPrefill {
  operatorName: string | null
  priceBasis: PriceBasisValue | null
  validFrom: string | null
  netzebene: Netzebene | null
  meteringVariant: MeteringVariant | null
  grundpreisAmount: number | null
  grundpreisUnit: GrundpreisUnit | null
  netzverlustCtPerKwh: number | null
  windows: TariffSheetWindow[]
}

export function tariffSheetFormPrefill(
  extraction: TariffSheetExtraction,
  candidate: TariffSheetCandidate | null,
): TariffSheetFormPrefill {
  return {
    operatorName: extraction.operatorName,
    priceBasis: extraction.priceBasis,
    validFrom: extraction.validFrom,
    netzebene: candidate?.netzebene ?? null,
    meteringVariant: candidate?.meteringVariant ?? null,
    grundpreisAmount: candidate?.grundpreisAmount ?? null,
    grundpreisUnit: candidate?.grundpreisUnit ?? null,
    netzverlustCtPerKwh: candidate?.netzverlustCtPerKwh ?? null,
    windows: candidate?.windows ?? [],
  }
}

/**
 * Die Identität eines Kandidaten als Zeichenkette.
 *
 * EINE Definition, ZWEI Aufrufer: die Auswertung erkennt damit Dubletten, und die Oberfläche
 * bildet daraus die eindeutige `id`-Vorsilbe des zugehörigen Formulars. Zwei Fassungen liefen
 * auseinander, und dann trügen zwei Formulare dieselben DOM-Kennungen — der Fokussprung nach einem
 * Feldfehler landete im falschen.
 */
export function candidateIdentityKey(candidate: {
  netzebene: Netzebene
  meteringVariant: MeteringVariant | null
}): string {
  return `ne${candidate.netzebene}-${candidate.meteringVariant ?? 'keine'}`
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
 * erneut ausgeschrieben statt importiert — der Rechnungs-Scan bleibt mit 0 Zeilen Diff
 * unangetastet. Damit die Verdopplung nicht in den Defekt zurückfallen kann, prüft
 * `tariff-sheet-scan.test.ts` das GANZE Schema rekursiv auf die eine Kombination, die ihn erzeugt:
 * Typ-Union UND `enum` an derselben Stelle — ausdrücklich auch innerhalb der `items` der beiden
 * Arrays, die dieses Schema jetzt trägt.
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

/** Die Felder eines Kandidaten, in fester Reihenfolge — ebenso geteilt. */
export const TARIFF_SHEET_CANDIDATE_KEYS = [
  'netzebene',
  'meteringVariant',
  'grundpreisAmount',
  'grundpreisUnit',
  'netzverlustCtPerKwh',
  'windows',
] as const satisfies readonly (keyof TariffSheetCandidate)[]

const WINDOW_SCHEMA = {
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
} as const

export const TARIFF_SHEET_SCAN_JSON_SCHEMA: { [key: string]: unknown } = {
  type: 'object',
  additionalProperties: false,
  required: ['operatorName', 'priceBasis', 'validFrom', 'candidates'],
  properties: {
    operatorName: nullableString(
      'Der Name des Netzbetreibers, GENAU so wie er auf dem Preisblatt gedruckt steht (zum ' +
        'Beispiel "Wiener Netze GmbH"). Erfinde keine Kurzform und keine technische Kennung. ' +
        'null, wenn kein Betreiber auf dem Dokument steht. Gilt für das ganze Blatt.',
    ),
    priceBasis: nullableEnum(
      'string',
      PRICE_BASES,
      'Ob die Beträge des Blattes netto ("net", ohne Umsatzsteuer) oder brutto ("gross") ' +
        'ausgewiesen sind. null, wenn das Blatt dazu nichts sagt. Gilt für das ganze Blatt.',
    ),
    validFrom: nullableString(
      'Der Tag, ab dem dieses Preisblatt gilt, als JJJJ-MM-TT (zum Beispiel "2026-01-01"). ' +
        'null, wenn kein Gültigkeitsbeginn dasteht — rechne ihn NICHT aus einem Druckdatum oder ' +
        'einer Jahreszahl im Titel zurück. Gilt für das ganze Blatt.',
    ),
    candidates: {
      type: 'array',
      description:
        'Eine Liste mit EINEM Eintrag je Tarifzeile des Blattes. Eine Tarifzeile ist genau eine ' +
        'Kombination aus Netzebene und — auf Netzebene 7 — Leistungsmessungs-Variante. Ein Blatt, ' +
        'das die Netzebenen 3 bis 7 führt und Netzebene 7 zusätzlich nach drei Messvarianten ' +
        'aufteilt, hat SIEBEN Einträge. Ein Blatt mit nur einer Netzebene hat GENAU EINEN. ' +
        'Leeres Array, wenn sich keine Zeile sicher zuordnen lässt.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [...TARIFF_SHEET_CANDIDATE_KEYS],
        properties: {
          /*
           * Als EINZIGES Feld des ganzen Schemas nicht nullbar: Die Netzebene ist die Identität
           * des Eintrags. Ein Eintrag ohne sie wäre eine Tarifzeile ohne Adresse — die Anweisung
           * verlangt deshalb, eine unsichere Zeile ganz wegzulassen statt sie mit `null` zu
           * führen. (Ein einzelner `type` mit `enum` ist unproblematisch; die HTTP-400-Falle
           * greift nur bei einer Typ-UNION mit `enum`, s. `nullableEnum`.)
           */
          netzebene: {
            type: 'integer',
            enum: [...NETZEBENEN],
            description:
              'Die Netzebene DIESES Eintrags (3 bis 7) — immer gesetzt, denn jeder Eintrag ' +
              'beschreibt genau eine Kombination. Lässt sich eine Zeile keiner Netzebene sicher ' +
              'zuordnen, lass den ganzen Eintrag weg, statt hier zu raten.',
          },
          meteringVariant: nullableEnum(
            'string',
            METERING_VARIANTS,
            'Die Leistungsmessungs-Variante DIESES Eintrags, erschlossen aus den Formulierungen ' +
              'des Blattes. null, wenn die Zeile keine Variante hat — auf den Netzebenen 3 bis 6 ' +
              'ist das der Regelfall, weil dort ohnehin gemessen wird.',
          ),
          grundpreisAmount: nullableNumber(
            'Der Betrag des Grund-/Leistungspreises der Netznutzung DIESES Eintrags, als reine ' +
              'Zahl ohne Einheit. Die zugehörige Einheit gehört in grundpreisUnit — beide nur ' +
              'gemeinsam.',
          ),
          grundpreisUnit: nullableEnum(
            'string',
            GRUNDPREIS_UNITS,
            'Die Einheit des Grundpreises: "eur_per_kw_year" für einen Betrag je kW und Jahr ' +
              '(ein echter Leistungspreis), "eur_per_year" für eine reine Jahrespauschale ohne ' +
              'kW-Bezug. null, wenn die Einheit nicht eindeutig dasteht.',
          ),
          netzverlustCtPerKwh: nullableNumber(
            'Das Netzverlustentgelt DIESES Eintrags in Cent je kWh. Das ist ein EIGENER Posten ' +
              'und nicht der Arbeitspreis der Netznutzung. Führt das Blatt es je Netzebene, ' +
              'nimm den Wert der Netzebene dieses Eintrags — auch wenn sich mehrere Einträge ' +
              'denselben Wert teilen.',
          ),
          windows: {
            type: 'array',
            description:
              'Die zeitabhängigen Arbeitspreise der Netznutzung DIESES Eintrags — je Preis ein ' +
              'Element. Eine Zeile mit einem einzigen ganztägigen Arbeitspreis hat GENAU EIN ' +
              'Element. Leeres Array, wenn für diese Zeile kein Arbeitspreis ausgewiesen ist.',
            items: WINDOW_SCHEMA,
          },
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
 * Ein Kandidat — oder `null`, wenn seine Identität nicht feststeht.
 *
 * ── ⚠ OHNE NETZEBENE GIBT ES KEINEN EINTRAG ───────────────────────────────────────────────────
 * Das ist die einzige harte Bedingung. Alles Übrige darf fehlen (der Admin trägt es vom Blatt
 * ab), aber eine Tarifzeile ohne Ebene ist keine Tarifzeile: Sie liesse sich weder anlegen noch
 * einer Zeile des Blattes zuordnen, und sie stünde im Formular als leere Auswahl da, die wie ein
 * Ergebnis des Scans aussähe.
 *
 * ── ⚠ EIN FEHLERHAFTER KANDIDAT REISST DIE ÜBRIGEN NICHT MIT ──────────────────────────────────
 * Diese Funktion ist bewusst je Eintrag aufgerufen und wirft nie: Ein unbrauchbarer vierter
 * Eintrag lässt die Einträge eins bis drei und fünf bis sieben unberührt. Die Alternative — bei
 * einem kaputten Eintrag das ganze Blatt zu verwerfen — machte aus einem Lesefehler in einer Zeile
 * ein vollständig abzutippendes Blatt.
 */
function parseCandidate(raw: unknown): TariffSheetCandidate | null {
  const obj = record(raw)

  const netzebene = oneOf(obj.netzebene, NETZEBENEN)
  if (netzebene === null) return null

  /*
   * ── ⚠ BETRAG UND EINHEIT GELTEN NUR ALS PAAR ────────────────────────────────────────────────
   * Ein Betrag ohne Einheit ist keine halbe Angabe, sondern eine gefährliche: Das Formular
   * belegt die Einheit mit `eur_per_kw_year` vor, und ein übernommener Betrag ohne gelesene
   * Einheit behauptete damit einen LEISTUNGSPREIS — auch dann, wenn auf dem Blatt eine
   * Jahrespauschale steht. Der Unterschied ist genau der zwischen „Spitzenkappung lohnt sich" und
   * „Leistungspreis 0, gar keine Spitzenkappung" (Delta 3).
   *
   * Umgekehrt ist eine Einheit ohne Betrag wertlos. Fehlt eines von beiden, fallen beide auf
   * `null`, und der Admin trägt sie vom Blatt ab. Die Regel gilt JE KANDIDAT: Ein Blatt, das für
   * Netzebene 3 beides ausweist und für Netzebene 7 nur einen Betrag, behält den einen und
   * verwirft den anderen.
   */
  const grundpreisAmount = finiteNonNegative(obj.grundpreisAmount)
  const grundpreisUnit = oneOf(obj.grundpreisUnit, GRUNDPREIS_UNITS)
  const grundpreisComplete = grundpreisAmount !== null && grundpreisUnit !== null

  const windows = Array.isArray(obj.windows)
    ? obj.windows.map(parseWindow).filter((window): window is TariffSheetWindow => window !== null)
    : []

  return {
    netzebene,
    meteringVariant: oneOf(obj.meteringVariant, METERING_VARIANTS),
    grundpreisAmount: grundpreisComplete ? grundpreisAmount : null,
    grundpreisUnit: grundpreisComplete ? grundpreisUnit : null,
    netzverlustCtPerKwh: finiteNonNegative(obj.netzverlustCtPerKwh),
    windows,
  }
}

/**
 * Wertet die Antwort des Modells aus — FAIL CLOSED, Feld für Feld und Kandidat für Kandidat.
 *
 * Es wird nichts geworfen und nichts gerettet: was nicht als sauberer Wert ankommt, ist `null`.
 * Auch eine vollständig unbrauchbare Antwort ergibt ein gültiges Ergebnis, in dem schlicht nichts
 * erkannt wurde — genau die Antwort, die ein unlesbares Blatt verdient.
 *
 * ── ⚠ ZWEI KANDIDATEN MIT DERSELBEN IDENTITÄT SIND EIN WIDERSPRUCH, KEINE ZWEITE ZEILE ────────
 * Die Kombination (Netzebene, Messvariante) ist zusammen mit Betreiber und Gültigkeitsbeginn genau
 * der `unique nulls not distinct`-Schlüssel aus B21-1. Zwei Einträge derselben Kombination
 * könnten also gar nicht beide angelegt werden — der zweite liefe in `invalid_valid_from`, und
 * zwar erst NACHDEM der erste bereits in der Datenbank steht. Der spätere wird deshalb hier
 * verworfen: Zwei gleich beschriftete Formulare mit verschiedenen Preisen sind ein Widerspruch,
 * den der Admin am Formular nicht auflösen kann, und eine im Voraus zum Scheitern verurteilte
 * Zeile ist keine Hilfe. Es gewinnt der ERSTE Eintrag — die Reihenfolge des Blattes.
 */
export function parseTariffSheetExtraction(raw: unknown): TariffSheetExtraction {
  const root = record(raw)

  const candidates: TariffSheetCandidate[] = []
  const seen = new Set<string>()
  if (Array.isArray(root.candidates)) {
    for (const entry of root.candidates) {
      const candidate = parseCandidate(entry)
      if (candidate === null) continue
      const key = candidateIdentityKey(candidate)
      if (seen.has(key)) continue
      seen.add(key)
      candidates.push(candidate)
    }
  }

  return {
    operatorName: text(root.operatorName, 200),
    priceBasis: oneOf(root.priceBasis, PRICE_BASES),
    validFrom: isoDate(root.validFrom),
    candidates,
  }
}

/**
 * Hat die Extraktion überhaupt etwas gefunden? Entscheidet den `unreadable`-Ausgang.
 *
 * Leer heisst: keine einzige Tarifzeile UND keine blattweite Angabe. Ein Blatt, von dem nur der
 * Betreibername lesbar war, ist ausdrücklich NICHT leer — es hat etwas geliefert, und der Admin
 * soll sehen, was.
 */
export function tariffSheetExtractionIsEmpty(extraction: TariffSheetExtraction): boolean {
  return (
    extraction.operatorName === null &&
    extraction.priceBasis === null &&
    extraction.validFrom === null &&
    extraction.candidates.length === 0
  )
}
