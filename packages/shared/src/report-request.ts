/**
 * Delta 18 — DER VERTRAG DER REPORT-ANFRAGE-ÜBERSETZUNG.
 *
 * ── WOZU ES DIESEN BAUSTEIN GIBT ───────────────────────────────────────────────────────────────
 * Das Annahmen-Panel (§6.2) kann acht Grössen ändern, aber es verlangt, dass der Nutzer weiss,
 * welches Feld welche Frage beantwortet. „Was wäre bei 15 Jahren und 5 % Förderung?" ist die Frage,
 * die er tatsächlich hat; „Betrachtungshorizont" und „Förderung" sind unsere Vokabeln.
 *
 * Dieses Modul übersetzt einen Satz in genau jene acht Grössen — und in nichts sonst.
 *
 * ── ⚠ DIE RANDBEDINGUNG, DIE DEN GANZEN BAUSTEIN TRÄGT: ES ENTSTEHT KEIN NEUER PARAMETER ──────
 * Der Rechner bekommt hier keine neue Fähigkeit. Was am Ende passiert, ist exakt derselbe
 * `onRecompute`-Aufruf, den das Annahmen-Panel seit U2 Prompt C auslöst — dieselben Felder,
 * dieselbe Engine, dieselbe Bestätigungspflicht. Das Feld ist eine ÜBERSETZUNG, keine Erweiterung.
 *
 * Daraus folgt der zweite Teil, und er ist genauso wichtig: **alles, wonach ein Nutzer sonst noch
 * fragen könnte, wird ABGELEHNT und begründet** (`ReportRequestUnsupported`). Ein Zeitraum, eine
 * frei gewählte Batteriegrösse, das Umschalten des Börsenpreis-Hebels — für all das gibt es im
 * Rechenweg keinen Eingang, und ein stillschweigend ignorierter Wunsch wäre schlimmer als eine
 * Absage: der Nutzer hielte das nächste Ergebnis für die Antwort auf seine Frage.
 *
 * ── ⚠ ES KOMMT KEIN FREITEXT DES MODELLS ZURÜCK ───────────────────────────────────────────────
 * Dieselbe Regel wie in den vier bestehenden Anbindungen. Das Modell nennt acht Zahlen und eine
 * Liste von GESCHLOSSENEN Ablehnungsgründen; die Sätze dazu schreiben wir. Es gibt kein Feld, in
 * das eine Begründung, eine Empfehlung oder ein Übernahmeversuch aus dem Nutzertext passte.
 *
 * ── WARUM DIESER TEIL IN `shared` LIEGT ────────────────────────────────────────────────────────
 * Wortgleich zu `invoice-scan.ts`, `report-gate.ts`, `upload-classification.ts` und
 * `battery-text.ts`: `apps/website` hat KEINEN eigenen Testlauf. Hier steht genau der Teil, der
 * sich ohne Modellaufruf prüfen lässt — Zielschema, Auswertung und die Vorschlagsbildung. Und
 * anders als beim Drei-Zeichen-Rückfall aus dem Nachtrag zu Delta 17 lohnt das hier: die
 * Vorschlagsbildung ist die Stelle, an der ein Vergleichsfehler eine falsche Vorschau erzeugte.
 *
 * Der einzige Import ist ein TYP-Import (`BillingModel`); er ist zur Laufzeit nicht vorhanden.
 * Kein zod (`apps/website` führt es nicht), und das JSON-Schema ist die WIRE-Fassung.
 */
import type { BillingModel } from './tariff'

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Die acht Grössen.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Die Felder, die eine Neuberechnung tatsächlich entgegennimmt — abgelesen am `RecomputeInput`
 * des Annahmen-Panels, nicht erfunden.
 *
 * Es sind acht: `billingModel` (aus `TariffParams`), `horizonYears`, vier aus `FinancialParams`
 * und zwei aus dem `batteryOverride`. Alles Übrige an `TariffParams` (Arbeitspreis,
 * Einspeisevergütung, Leistungspreis, Mindestleistung) stammt aus der Netzrechnung des Kunden
 * (§3.1/Prinzip 1) und ist auch im Panel bewusst nicht editierbar.
 */
export const REPORT_REQUEST_FIELDS = [
  'billingModel',
  'horizonYears',
  'subsidyPercent',
  'fixedSubsidyEur',
  'depreciationYears',
  'taxRatePercent',
  'roundTripEfficiencyPercent',
  'pricePerKwh',
] as const

export type ReportRequestField = (typeof REPORT_REQUEST_FIELDS)[number]

/** Die drei Abrechnungsmodelle — gespiegelt aus `billingModelSchema`, s. Test zur Gleichheit. */
export const REPORT_REQUEST_BILLING_MODELS = [
  'annual_max',
  'monthly_max_average',
  'monthly_max_sum',
] as const satisfies readonly BillingModel[]

/**
 * Wonach ein Nutzer fragen kann, das dieser Rechenweg NICHT hergibt.
 *
 * ── ⚠ EINE GESCHLOSSENE LISTE, KEIN FREITEXT — und das ist der Kern des Entwurfs ──────────────
 * Das Modell wählt aus diesen Werten; die Erklärung dazu steht bei uns (`apps/website`). Liesse
 * man es begründen, stünde im Report ein Satz, den niemand geprüft hat — und der Nutzer läse ihn
 * als Auskunft des Rechners über sich selbst.
 *
 * `sonstiges` ist der Auffangwert und ausdrücklich erwünscht: „ich habe verstanden, dass da ein
 * Wunsch war, und er passt in keine der Kategorien" ist eine ehrlichere Antwort als Schweigen.
 */
export const REPORT_REQUEST_UNSUPPORTED = [
  /** Ein anderer Zeitraum, Monat, Halbjahr, Jahr — der Lastgang ist der Lastgang. */
  'zeitraum',
  /** Eine frei gewählte Speichergrösse in kWh oder kW. Der Katalog ist fest. */
  'batteriekapazitaet',
  /** Ein anderer Katalog-Kandidat als der gerade angezeigte. */
  'andere_batterie',
  /** Den Börsenpreis-Vergleich ein- oder ausschalten. */
  'boersenpreis_hebel',
  /** Arbeitspreis, Einspeisevergütung, Leistungspreis, Mindestleistung. */
  'energiepreise',
  /** Andere Verbrauchsdaten, PV-Profil, neue Datei. */
  'lastgang',
  /** Ein Wunsch, der in keine der Kategorien passt. */
  'sonstiges',
] as const

export type ReportRequestUnsupported = (typeof REPORT_REQUEST_UNSUPPORTED)[number]

/**
 * Was aus einem Satz gelesen werden kann. Jedes Feld einzeln: Wert ODER „nicht genannt" — nie
 * „vermutlich 0" (dieselbe Regel wie in den vier bestehenden Anbindungen).
 */
export interface ReportRequestExtraction {
  billingModel: BillingModel | null
  horizonYears: number | null
  subsidyPercent: number | null
  fixedSubsidyEur: number | null
  depreciationYears: number | null
  taxRatePercent: number | null
  /**
   * Wirkungsgrad in PROZENT (0–100), so wie ein Mensch ihn schreibt.
   *
   * Der Katalog führt ihn als Bruchteil (0,9). Umgerechnet wird an GENAU EINER Stelle, beim
   * Anwenden des Vorschlags — hier bleibt stehen, was im Satz stand. Dieselbe Vorkehrung wie in
   * `battery-text.ts`: zweimal umgerechnet wäre der Wirkungsgrad 0,9 %, eine Zahl, die durch jede
   * Schemaprüfung liefe und die Ersparnis lautlos vernichtete.
   */
  roundTripEfficiencyPercent: number | null
  pricePerKwh: number | null
  /** Wünsche, für die es in diesem Rechenweg keinen Eingang gibt. Ohne Dubletten. */
  unsupported: ReportRequestUnsupported[]
}

/** Ein Ergebnis, in dem nichts erkannt wurde. Der Ausgangszustand jeder Auswertung. */
export function emptyReportRequestExtraction(): ReportRequestExtraction {
  return {
    billingModel: null,
    horizonYears: null,
    subsidyPercent: null,
    fixedSubsidyEur: null,
    depreciationYears: null,
    taxRatePercent: null,
    roundTripEfficiencyPercent: null,
    pricePerKwh: null,
    unsupported: [],
  }
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Das JSON-Schema, das die API erzwingt.
 *
 * ⚠ `billingModel` steht als `anyOf` und NICHT als `type: ['string','null']` mit `enum`. Diese
 * Schreibweise ist nach JSON Schema gültig und wird von der API mit HTTP 400 abgewiesen, VOR dem
 * Modellaufruf — genau das hat am 31.08.2026 den Rechnungs-Scan in Produktion vollständig
 * funktionslos gemacht. Der rekursive Wächter im Test prüft den GANZEN Baum darauf, auch Felder,
 * die es heute nicht gibt.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */

function nullableNumber(description: string) {
  return { type: ['number', 'null'], description } as const
}

export const REPORT_REQUEST_JSON_SCHEMA: { [key: string]: unknown } = {
  type: 'object',
  additionalProperties: false,
  required: [...REPORT_REQUEST_FIELDS, 'unsupported'],
  properties: {
    billingModel: {
      anyOf: [
        { type: 'string', enum: [...REPORT_REQUEST_BILLING_MODELS] },
        { type: 'null' },
      ],
      description:
        'Das gewünschte Abrechnungsmodell für den Leistungspreis, wenn der Satz eines nennt. ' +
        '"annual_max" = ein Jahreshöchstwert. "monthly_max_average" = Mittel der zwölf ' +
        'Monatshöchstwerte. "monthly_max_sum" = Summe der zwölf Monatshöchstwerte. Sonst null.',
    },
    horizonYears: nullableNumber(
      'Betrachtungszeitraum der Wirtschaftlichkeitsrechnung in Jahren, wenn der Satz einen nennt ' +
        '("rechne auf 15 Jahre"). NICHT der Zeitraum der Verbrauchsdaten — der lässt sich nicht ' +
        'ändern. Nicht aus der Abschreibungsdauer erschliessen.',
    ),
    subsidyPercent: nullableNumber(
      'Förderung als PROZENTSATZ der Investition (0 bis 100), wenn der Satz einen nennt ' +
        '("30 % Förderung" ergibt 30). Ein Förderbetrag in Euro gehört NICHT hierher.',
    ),
    fixedSubsidyEur: nullableNumber(
      'Pauschale Förderung als BETRAG in Euro, wenn der Satz einen nennt ("5000 Euro ' +
        'Investitionszuschuss"). Ein Prozentsatz gehört NICHT hierher.',
    ),
    depreciationYears: nullableNumber(
      'Abschreibungsdauer (AfA) in Jahren, wenn der Satz eine nennt. NICHT dasselbe wie der ' +
        'Betrachtungszeitraum — nicht das eine aus dem anderen erschliessen.',
    ),
    taxRatePercent: nullableNumber(
      'Steuersatz (Grenzsteuersatz oder Körperschaftsteuer) in Prozent (0 bis 100), wenn der ' +
        'Satz einen nennt. Die Umsatzsteuer ist NICHT gemeint.',
    ),
    roundTripEfficiencyPercent: nullableNumber(
      'Round-Trip-Wirkungsgrad des Speichers in PROZENT (0 bis 100), wenn der Satz einen nennt — ' +
        '"90 %" ergibt 90, nicht 0,9. Über 100 ist unmöglich; dann null. Ein Wirkungsgrad, der ' +
        'ausdrücklich zum Wechselrichter oder zur PV-Anlage gehört, zählt hier NICHT.',
    ),
    pricePerKwh: nullableNumber(
      'Preis des Speichers in Euro je Kilowattstunde KAPAZITÄT, wenn der Satz einen nennt. Ein ' +
        'Gesamtpreis für die Anlage ist NICHT dasselbe — ihn nur umrechnen, wenn die Kapazität ' +
        'eindeutig danebensteht.',
    ),
    unsupported: {
      type: 'array',
      description:
        'Wünsche aus dem Satz, für die es oben KEIN Feld gibt. Für jeden erkannten solchen Wunsch ' +
        'genau einen Wert eintragen, ohne Dubletten. Leeres Array, wenn der Satz nichts darüber ' +
        'hinaus verlangt. Lieber diese Liste benutzen als einen Wunsch in ein Feld zu pressen, ' +
        'in das er nicht gehört.',
      items: {
        type: 'string',
        enum: [...REPORT_REQUEST_UNSUPPORTED],
      },
    },
  },
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Die Auswertung — FAIL CLOSED, Feld für Feld.
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

/**
 * Wie `positiveNumber`, lässt aber die ECHTE 0 zu.
 *
 * „keine Förderung" und „0 % Steuersatz" sind Angaben, keine Lücken — und sie sind eine sinnvolle
 * Frage („was, wenn die Förderung wegfällt?"). Bei Wirkungsgrad und Preis wäre 0 dagegen keine
 * Angabe, sondern ein kaputtes Gerät; die laufen deshalb über `positiveNumber`.
 */
function nonNegativeNumber(value: unknown, max?: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  if (max !== undefined && value > max) return null
  return value
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * Wertet die Antwort des Modells aus.
 *
 * Es wird nichts geworfen und nichts gerettet. Eine vollständig unbrauchbare Antwort ergibt ein
 * gültiges Ergebnis, in dem nichts erkannt wurde — genau die Antwort, die ein Satz ohne Wünsche
 * verdient.
 *
 * Die Grenzen sind DIESELBEN wie in `financialParamsSchema` (0–100 für die beiden Prozentsätze,
 * positiv für Abschreibung und Pauschalförderung). Hier abgefangen erscheint eine unmögliche Zahl
 * gar nicht erst im Vorschlag, statt später als Schema-Fehler ohne Bezug zur Frage des Nutzers.
 */
export function parseReportRequestExtraction(raw: unknown): ReportRequestExtraction {
  const root = record(raw)

  const billingModel = REPORT_REQUEST_BILLING_MODELS.find((m) => m === root.billingModel) ?? null

  const seen = new Set<string>()
  const unsupported: ReportRequestUnsupported[] = []
  if (Array.isArray(root.unsupported)) {
    for (const entry of root.unsupported) {
      const hit = REPORT_REQUEST_UNSUPPORTED.find((u) => u === entry)
      if (hit && !seen.has(hit)) {
        seen.add(hit)
        unsupported.push(hit)
      }
    }
  }

  return {
    billingModel,
    horizonYears: positiveNumber(root.horizonYears),
    // 0 ist hier eine Angabe („ohne Förderung", „steuerfrei"), s. `nonNegativeNumber`.
    subsidyPercent: nonNegativeNumber(root.subsidyPercent, 100),
    fixedSubsidyEur: nonNegativeNumber(root.fixedSubsidyEur),
    depreciationYears: positiveNumber(root.depreciationYears),
    taxRatePercent: nonNegativeNumber(root.taxRatePercent, 100),
    // Über 100 % ist physikalisch unmöglich, 0 % wäre keine Batterie.
    roundTripEfficiencyPercent: positiveNumber(root.roundTripEfficiencyPercent, 100),
    pricePerKwh: positiveNumber(root.pricePerKwh),
    unsupported,
  }
}

/** Hat die Auswertung überhaupt etwas gefunden? Für die Oberfläche. */
export function reportRequestExtractionIsEmpty(e: ReportRequestExtraction): boolean {
  return (
    e.billingModel === null &&
    e.unsupported.length === 0 &&
    e.horizonYears === null &&
    e.subsidyPercent === null &&
    e.fixedSubsidyEur === null &&
    e.depreciationYears === null &&
    e.taxRatePercent === null &&
    e.roundTripEfficiencyPercent === null &&
    e.pricePerKwh === null
  )
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Der Vorschlag.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Der aktuell WIRKSAME Stand — der Bezugspunkt jedes Vergleichs.
 *
 * ── ⚠ „AKTUELL" HEISST: DIE EINGABEN DES ANGEZEIGTEN LAUFS, NICHT DIE AUS SCHRITT 2 ───────────
 * Das Annahmen-Panel misst seine Abweichung gegen `original*` (Schritt 2 bzw. den Erstlauf) und
 * hat dafür einen eigenen Grund: `original*` ist sein Ziel für „Zurücksetzen". Für eine VORSCHAU
 * ist derselbe Bezugspunkt falsch — sie soll zeigen, was sich gegenüber dem ändert, was der Nutzer
 * gerade vor sich sieht. Der Aufrufer bildet diesen Stand deshalb aus `AnalysisRunInputs`
 * (`displayInputs`), also aus den Eingaben, die GENAU das angezeigte Ergebnis erzeugt haben.
 *
 * `null` bei den vier Finanzgrössen heisst „nicht angegeben" und ist von 0 zu unterscheiden:
 * „keine Förderung angegeben" und „Förderung ausdrücklich 0 %" sind zwei Aussagen, und nur die
 * zweite ist eine Änderung, die man vorschlagen kann.
 */
export type ReportRequestCurrent = {
  billingModel: BillingModel
  horizonYears: number
  subsidyPercent: number | null
  fixedSubsidyEur: number | null
  depreciationYears: number | null
  taxRatePercent: number | null
  /** Wirkungsgrad der ANGEZEIGTEN Batterie, in Prozent (0–100). */
  roundTripEfficiencyPercent: number
  /** Preis der ANGEZEIGTEN Batterie in €/kWh. */
  pricePerKwh: number
}

/** Eine einzelne vorgeschlagene Änderung. `from === null` heisst „war nicht angegeben". */
export type ProposedChange = {
  field: ReportRequestField
  from: BillingModel | number | null
  to: BillingModel | number
}

export type RecomputeProposal = {
  /** Nur echte Änderungen — was schon so eingestellt ist, steht hier NICHT. */
  changes: ProposedChange[]
  /** Wünsche ohne Eingang in diesem Rechenweg. */
  unsupported: ReportRequestUnsupported[]
}

/**
 * Bildet aus einer Auswertung und dem aktuellen Stand den Vorschlag.
 *
 * ── ⚠ NUR ECHTE ÄNDERUNGEN, UND OHNE TOLERANZ ─────────────────────────────────────────────────
 * Ein Feld, dessen gewünschter Wert dem aktuellen entspricht, ist KEINE Änderung und erscheint
 * nicht in der Vorschau — sonst zeigte sie „15 Jahre → 15 Jahre" und der Nutzer bestätigte einen
 * Lauf, der nichts tut. Verglichen wird mit `!==` und ohne Rundung: dieselbe Regel, nach der das
 * Annahmen-Panel entscheidet, ob es einen `batteryOverride` emittiert.
 *
 * ── DIE REIHENFOLGE IST DIE DES SCHEMAS, NICHT DIE DER ANTWORT ────────────────────────────────
 * `REPORT_REQUEST_FIELDS` gibt sie vor. Andernfalls hinge die Reihenfolge der Vorschau daran, in
 * welcher Reihenfolge das Modell die Felder gefüllt hat — dieselbe Frage ergäbe dann bei zwei
 * Läufen zwei verschieden sortierte Listen.
 */
export function buildRecomputeProposal(
  extraction: ReportRequestExtraction,
  current: ReportRequestCurrent,
): RecomputeProposal {
  const changes: ProposedChange[] = []

  for (const field of REPORT_REQUEST_FIELDS) {
    const to = extraction[field]
    if (to === null) continue
    const from = current[field]
    if (from === to) continue
    changes.push({ field, from, to })
  }

  return { changes, unsupported: extraction.unsupported }
}
