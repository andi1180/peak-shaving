/**
 * Delta 9b-2a — DER VERTRAG DES RECHNUNGS-SCANS. Rein, ohne Importe, ohne Netz, ohne Datenbank.
 *
 * ── WARUM DIESER TEIL IN `shared` LIEGT UND NICHT IN `apps/website` ────────────────────────────
 * Wortgleich zur Begründung in `report-gate.ts` (Delta 16b): `apps/website` hat **keinen eigenen
 * Testlauf**. Was hier steht, ist genau der Teil des Rechnungs-Scans, der sich ohne einen Aufruf an
 * ein Sprachmodell prüfen lässt — das Zielschema und die Auswertung seiner Antwort. Läge er in der
 * App, wäre er unprüfbar; hier ist er es nicht.
 *
 * Die Datei hat **NULL Importe** — auch kein zod, obwohl `shared` es führt. Zwei Gründe:
 *   1. Das JSON-Schema unten ist die WIRE-Fassung, die an die API geht und dort erzwungen wird. Aus
 *      einem zod-Schema abgeleitet stünde zwischen dem, was geprüft wird, und dem, was hier steht,
 *      ein Generator — und eine Abweichung fiele erst an einer echten Rechnung auf.
 *   2. `apps/website` führt zod nicht (gemessen, Delta 16b) und soll es dafür nicht bekommen.
 *
 * ── ⚠ DIE FACHLICHE REGEL, DIE ALLES ANDERE TRÄGT: LIEBER NICHTS ALS GERATEN ───────────────────
 * Prinzip 1 sagt „Die Rechnung ist die Wahrheit". Ein aus einer Rechnung GESCHÄTZTER Leistungspreis
 * ist das Gegenteil davon — und er fällt niemandem als Fehler auf, sondern als Ergebnis (dieselbe
 * Gefahr wie der Faktor 10 bei den Spotpreisen, B21-2a). Jedes Feld ist deshalb einzeln
 * `Wert ODER null`, und `null` heisst „auf dieser Rechnung nicht erkennbar" — nie „vermutlich 0".
 * Die Auswertung unten setzt jedes Feld, das nicht sauber als Wert ankommt, auf `null` zurück,
 * statt es zu retten.
 */

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Die Wertebereiche.
 *
 * Sie SPIEGELN `NETZBETREIBER_IDS`/`NETZEBENEN` (tariff-catalog.ts) und `METERING_VARIANTS`
 * (tariff-pricing.ts) und importieren sie bewusst nicht: das JSON-Schema unten muss die Werte als
 * Literale führen, damit die API sie erzwingen kann, und ein Import machte aus einer Liste zwei
 * Ableitungen derselben Liste. Der Abgleich ist stattdessen ein TEST
 * (`invoice-scan.test.ts` — er wird rot, sobald eine der Listen wächst).
 * ────────────────────────────────────────────────────────────────────────────────────────────── */

/** Netzbetreiber, die der Scan benennen darf. Spiegel von `NETZBETREIBER_IDS`. */
export const INVOICE_SCAN_OPERATORS = ['wiener_netze', 'netz_noe', 'salzburg_netz'] as const
export type InvoiceScanOperator = (typeof INVOICE_SCAN_OPERATORS)[number]

/** Netzebenen, die der Scan benennen darf. Spiegel von `NETZEBENEN`. */
export const INVOICE_SCAN_NETZEBENEN = [3, 4, 5, 6, 7] as const
export type InvoiceScanNetzebene = (typeof INVOICE_SCAN_NETZEBENEN)[number]

/** Leistungsmessungs-Varianten. Spiegel von `METERING_VARIANTS`. */
export const INVOICE_SCAN_METERING_VARIANTS = [
  'mit_leistungsmessung',
  'ohne_leistungsmessung',
  'unterbrechbar',
] as const
export type InvoiceScanMeteringVariant = (typeof INVOICE_SCAN_METERING_VARIANTS)[number]

/**
 * Die Zahlenfelder, die aus einer Netzrechnung gelesen werden.
 *
 * ── DIE AUSWAHL IST EINE TEILMENGE VON `tariffParamsSchema`, UND DIE LÜCKEN SIND BEGRÜNDET ────
 * Enthalten sind genau die Posten, die auf einem österreichischen Netz-/Energieabrechnungsblatt
 * als BETRAG stehen. Ausdrücklich NICHT enthalten:
 *
 *   `billingModel`  — eine Rechnung zeigt einen abgerechneten kW-Wert, nicht die Regel, nach der er
 *                     entstanden ist. Welches Modell in Österreich gilt, ist eine seit §3.5
 *                     ausdrücklich OFFENE fachliche Frage (die `[ANNAHME]` dort trägt dokumentierten
 *                     Gegenwind, OP#3). Ein Modell aus einem Rechnungsbild zu erschliessen hiesse,
 *                     genau diese offene Frage still über eine Extraktion zu entscheiden.
 *   `timeOfUseWindows`, `benutzungsdauerModel` — Strukturen, keine Beträge; ein halb erkanntes
 *                     Fenster ist schlimmer als keines (es verschöbe jede Ladeentscheidung).
 *   `dynamicPriceProfile` — [v2], hat bis heute null Konsumenten.
 *   `netzebene`     — steht als eigenes, typisiertes Feld weiter oben, nicht als Zahl.
 */
export interface InvoiceScanRates {
  /** Leistungs-/Grundpreis Netznutzung in €/kW und Jahr. */
  leistungspreisEurPerKwYear: number | null
  /** Mindest-/vereinbarte Leistung in kW (Sockel, §3.5 — hebt den abgerechneten Wert nur an). */
  minBillableKw: number | null
  /** Netznutzungs-Arbeitspreis in ct/kWh. */
  arbeitspreisNetzCtPerKwh: number | null
  /** Energie-Arbeitspreis (Bezug) in ct/kWh. */
  energyPriceCtPerKwh: number | null
  /** Nacht-/Niedertarif-Arbeitspreis in ct/kWh. */
  energyPriceNightCtPerKwh: number | null
  /** Einspeisevergütung in ct/kWh. */
  einspeiseverguetungCtPerKwh: number | null
  /**
   * Delta 19 / §3.7.3 — die monatliche Grundgebühr des STROMLIEFERANTEN in €/Monat.
   *
   * ── ⚠ DIE EINE VERWECHSLUNG, DIE DIESES FELD TRÄGT ──────────────────────────────────────────
   * Auf derselben Rechnung stehen ZWEI verbrauchsunabhängige Pauschalen nebeneinander: die
   * Grundgebühr des LIEFERANTEN (Vertrieb) und der Grundpreis des NETZBETREIBERS. Nur die erste
   * gehört hierher. Der Netz-Grundpreis kommt seit B21 aus `public.grid_tariffs` und ist keine
   * Nutzereingabe; hier eingetragen stünde er ein zweites Mal in der Rechnung — und §3.7.3 legt
   * ihn ausdrücklich auf ALLE DREI Vergleichsreihen, während diese Gebühr nur die Reihe „Ihr
   * Tarif heute" trägt. Verwechselt verschöbe sie also genau die Differenz, die der Report
   * ausweist. Die Trennlinie steht deshalb ausformuliert in der Schema-Beschreibung unten (sie
   * geht an das Modell) und im System-Prompt.
   *
   * ⚠ Ebenfalls NICHT hierher gehört der Leistungspreis (€/kW und Jahr) — der steht als eigenes
   * Feld weiter oben und ist verbrauchsunabhängig, aber nicht pauschal.
   */
  supplierBaseFeeEurPerMonth: number | null
}

/** Das vollständige Ergebnis einer Extraktion. Jedes Feld einzeln: Wert oder „nicht erkennbar". */
export interface InvoiceExtraction {
  netzbetreiber: InvoiceScanOperator | null
  netzebene: InvoiceScanNetzebene | null
  meteringVariant: InvoiceScanMeteringVariant | null
  rates: InvoiceScanRates
  /** Jahresverbrauch in kWh (Delta 9b: der Eingang in den Standardprofil-Generator, 9b-1). */
  annualConsumptionKwh: number | null
}

/** Die Namen der Zahlenfelder, in fester Reihenfolge — von Schema, Auswertung und Test geteilt. */
export const INVOICE_SCAN_RATE_KEYS = [
  'leistungspreisEurPerKwYear',
  'minBillableKw',
  'arbeitspreisNetzCtPerKwh',
  'energyPriceCtPerKwh',
  'energyPriceNightCtPerKwh',
  'einspeiseverguetungCtPerKwh',
  'supplierBaseFeeEurPerMonth',
] as const satisfies readonly (keyof InvoiceScanRates)[]

/** Ein Ergebnis, in dem NICHTS erkannt wurde. Der Ausgangszustand jeder Auswertung. */
export function emptyInvoiceExtraction(): InvoiceExtraction {
  return {
    netzbetreiber: null,
    netzebene: null,
    meteringVariant: null,
    rates: {
      leistungspreisEurPerKwYear: null,
      minBillableKw: null,
      arbeitspreisNetzCtPerKwh: null,
      energyPriceCtPerKwh: null,
      energyPriceNightCtPerKwh: null,
      einspeiseverguetungCtPerKwh: null,
      supplierBaseFeeEurPerMonth: null,
    },
    annualConsumptionKwh: null,
  }
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Das JSON-Schema, das die API erzwingt.
 *
 * `additionalProperties: false` + vollständige `required`-Listen: das Modell MUSS jedes Feld
 * nennen, und der einzige zulässige Weg, es nicht zu beantworten, ist `null`. Ohne `required`
 * wäre „Feld weggelassen" ein zweiter Ausdruck für dasselbe — und zwei Schreibweisen für
 * „nicht erkennbar" laufen beim nächsten Umbau auseinander.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */

function nullableNumber(description: string) {
  return { type: ['number', 'null'], description } as const
}

/**
 * Ein Aufzählungsfeld, das auch `null` sein darf.
 *
 * ── ⚠ WARUM `anyOf` UND NICHT `type: ['string', 'null']` MIT `null` IN DER `enum`-LISTE ────────
 * Die naheliegende Schreibweise ist nach JSON Schema gültig und wird von der API TROTZDEM
 * abgewiesen — mit HTTP 400 und der Meldung
 *   `Invalid schema: Enum value 'wiener_netze' does not match declared type '['string', 'null']'`.
 * Der Validator prüft jeden `enum`-Wert gegen den deklarierten Typ und akzeptiert dort keine
 * Typ-Union. Die Folge war kein Ablesefehler, sondern ein TOTALAUSFALL: JEDER Scan endete in
 * `api_error`, bevor das Modell die Rechnung überhaupt zu sehen bekam.
 *
 * Am 31.08.2026 gegen die ECHTE API gemessen (sieben Schreibweisen, `claude-sonnet-5`):
 *   `type: ['string','null']` + `enum: [...werte, null]`   → 400   ← der Defekt
 *   `type: ['integer','null']` + `enum: [...werte, null]`  → 400   ← derselbe Defekt
 *   `anyOf: [{ type, enum }, { type: 'null' }]`            → 200   ← diese Fassung
 *   `enum: [...werte, null]` ganz OHNE `type`              → 200   (zulässig, aber schwächer:
 *                                                                   der Typ steht dann nirgends)
 *   `type: ['number','null']` OHNE `enum`                  → 200   (deshalb ist `nullableNumber`
 *                                                                   oben unverändert richtig)
 *
 * Die Prüfung `invoice-scan.test.ts` pinnt die Schreibweise, damit sie nicht zurückfällt — ein
 * Stub der Messages-API validiert das Schema NICHT und hat den Defekt genau deshalb durchgelassen.
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

export const INVOICE_SCAN_JSON_SCHEMA: { [key: string]: unknown } = {
  type: 'object',
  additionalProperties: false,
  required: ['netzbetreiber', 'netzebene', 'meteringVariant', 'rates', 'annualConsumptionKwh'],
  properties: {
    netzbetreiber: nullableEnum(
      'string',
      INVOICE_SCAN_OPERATORS,
      'Der Netzbetreiber, der die Rechnung ausgestellt hat. null, wenn er nicht auf dem ' +
        'Dokument steht oder keiner der aufgezählten ist.',
    ),
    netzebene: nullableEnum(
      'integer',
      INVOICE_SCAN_NETZEBENEN,
      'Die Netzebene des Anschlusses (3 bis 7), wenn sie auf der Rechnung ausgewiesen ist. ' +
        'null, wenn sie nicht dasteht — nicht aus der Anschlussleistung erschliessen.',
    ),
    meteringVariant: nullableEnum(
      'string',
      INVOICE_SCAN_METERING_VARIANTS,
      /*
       * ⚠ Der Text lautete bis zum 31.08.2026 „…, wenn die Rechnung sie BENENNT". Das war
       * irreführend: keine österreichische Rechnung benennt die Variante mit dem Codewort dieses
       * Schemas — sie schreibt „pauschale Leistung" oder „nicht gemessene Leistung". Die Anweisung
       * forderte damit wörtlich etwas, das nie eintritt, und das Ergebnis wechselte von Lauf zu
       * Lauf zwischen der wörtlich richtigen (`null`) und der fachlich richtigen Antwort. Welche
       * Formulierungen auf welchen Wert zeigen, steht ausführlich im System-Prompt
       * (`apps/website/lib/invoice-scan/extract.ts`); hier nur so viel, dass die Beschreibung ihm
       * nicht widerspricht.
       */
      'Die Leistungsmessungs-Variante des Bezugs-Zählpunkts, erschlossen aus den Formulierungen ' +
        'der Rechnung (sie nennt diese Begriffe nicht wörtlich). null, wenn keines der bekannten ' +
        'Muster vorkommt — etwa auf einer reinen Einspeise-Abrechnung.',
    ),
    rates: {
      type: 'object',
      additionalProperties: false,
      required: [...INVOICE_SCAN_RATE_KEYS],
      properties: {
        leistungspreisEurPerKwYear: nullableNumber(
          'Leistungspreis / Grundpreis der Netznutzung in Euro je kW und JAHR. Steht die ' +
            'Rechnung auf einen Monatsbetrag, auf das Jahr umrechnen (×12) und nur dann, wenn ' +
            'der Bezugszeitraum eindeutig dasteht.',
        ),
        minBillableKw: nullableNumber(
          'Mindestleistung / vereinbarte Leistung in kW, falls die Rechnung eine nennt.',
        ),
        arbeitspreisNetzCtPerKwh: nullableNumber(
          'Arbeitspreis der Netznutzung in Cent je kWh.',
        ),
        energyPriceCtPerKwh: nullableNumber(
          'Arbeitspreis der Energielieferung (Bezug) in Cent je kWh. Bei getrenntem Hoch-/ ' +
            'Niedertarif der HOCHTARIF.',
        ),
        energyPriceNightCtPerKwh: nullableNumber(
          'Nacht-/Niedertarif-Arbeitspreis in Cent je kWh, falls die Rechnung einen ausweist.',
        ),
        einspeiseverguetungCtPerKwh: nullableNumber(
          'Einspeisevergütung in Cent je kWh, falls die Rechnung eine ausweist.',
        ),
        /*
         * ⚠ Die Beschreibung nennt die Abgrenzung ausdrücklich, weil sie an das Modell geht und
         * dort die eigentliche Arbeit tut. Ein Test pinnt sie (`invoice-scan.test.ts`): wer sie
         * beim nächsten Umformulieren verliert, macht ihn rot — der Netz-Grundpreis in diesem
         * Feld wäre sonst eine Zahl, die plausibel aussieht und die falsche Vergleichsreihe
         * belastet.
         */
        supplierBaseFeeEurPerMonth: nullableNumber(
          'Monatliche Grundgebühr / Grundentgelt des STROMLIEFERANTEN (Vertrieb, Energielieferant) ' +
            'in Euro je MONAT. Ausdrücklich NICHT der Grundpreis / das Grundentgelt des ' +
            'NETZBETREIBERS und NICHT der Leistungspreis — auch dann nicht, wenn beide Posten auf ' +
            'derselben Rechnung stehen. Steht die Gebühr als Jahresbetrag, auf den Monat umrechnen ' +
            '(÷12), und nur dann, wenn der Bezugszeitraum eindeutig dasteht. Steht sie als ' +
            'Tagespauschale, ist das Feld null.',
        ),
      },
    },
    annualConsumptionKwh: nullableNumber(
      'Jahresverbrauch in kWh. Nur, wenn die Rechnung einen Jahreswert ausweist — einen ' +
        'Monats- oder Teilzeitraum NICHT hochrechnen.',
    ),
  },
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Die Auswertung.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Eine Zahl — oder `null`.
 *
 * ⚠ `NaN` und `Infinity` sind in JavaScript `typeof 'number'` und würden ohne diese Prüfung als
 * gültiger Tarifsatz durchlaufen; `NaN` vergiftet danach jede Rechnung lautlos. Negative Werte
 * weist `tariffParamsSchema` ohnehin ab (`nonnegative`) — hier abgefangen heisst: sie erscheinen
 * als „nicht erkennbar" statt später als Schema-Fehler ohne Bezug zur Rechnung.
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

/**
 * Wertet die Antwort des Modells aus — FAIL CLOSED, Feld für Feld.
 *
 * Es wird nichts geworfen und nichts gerettet: was nicht als sauberer Wert ankommt, ist `null`.
 * Auch eine vollständig unbrauchbare Antwort (kein Objekt, leer, falsch getippt) ergibt damit ein
 * gültiges Ergebnis, in dem schlicht nichts erkannt wurde — genau die Antwort, die eine unlesbare
 * Rechnung verdient. Eine Ausnahme wäre hier falsch: „unlesbar" ist kein Programmfehler, sondern
 * ein Befund, und der Aufrufer soll ihn dem Kunden zeigen können.
 */
export function parseInvoiceExtraction(raw: unknown): InvoiceExtraction {
  const root = record(raw)
  const rawRates = record(root.rates)

  const rates = emptyInvoiceExtraction().rates
  for (const key of INVOICE_SCAN_RATE_KEYS) {
    rates[key] = finiteNonNegative(rawRates[key])
  }

  return {
    netzbetreiber: oneOf(root.netzbetreiber, INVOICE_SCAN_OPERATORS),
    netzebene: oneOf(root.netzebene, INVOICE_SCAN_NETZEBENEN),
    meteringVariant: oneOf(root.meteringVariant, INVOICE_SCAN_METERING_VARIANTS),
    rates,
    annualConsumptionKwh: finiteNonNegative(root.annualConsumptionKwh),
  }
}

/** Hat die Extraktion überhaupt etwas gefunden? Für die Oberfläche (9b-2b), hier schon geprüft. */
export function invoiceExtractionIsEmpty(extraction: InvoiceExtraction): boolean {
  return (
    extraction.netzbetreiber === null &&
    extraction.netzebene === null &&
    extraction.meteringVariant === null &&
    extraction.annualConsumptionKwh === null &&
    INVOICE_SCAN_RATE_KEYS.every((key) => extraction.rates[key] === null)
  )
}
