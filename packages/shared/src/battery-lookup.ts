/**
 * B24, Teil 1 — DER VERTRAG DER MARKE/TYP-RECHERCHE. Die SECHSTE KI-Anbindung dieses Repos, und
 * die ERSTE mit echtem Web-Zugriff.
 *
 * ── WOZU ES DIESEN BAUSTEIN GIBT ───────────────────────────────────────────────────────────────
 * Die Batterie-Station kennt bis hierher zwei Wege zu denselben vier Kenndaten: einen Satz in
 * eigenen Worten (`battery-text.ts`) und ein hochgeladenes Datenblatt (`battery-spec-scan.ts`).
 * Beide setzen voraus, dass der Kunde die Zahlen kennt oder das Papier zur Hand hat. Der häufigste
 * reale Zustand ist ein dritter: Er weiss, WAS dasteht — „ein Sungrow SBR128" — und sonst nichts.
 *
 * Dieses Modul sucht dazu im Web. Es erfindet keinen neuen Mechanismus: heraus kommen exakt
 * dieselben vier Zahlenfelder wie bei den beiden anderen Wegen, unter exakt denselben Namen — sie
 * speisen deshalb in dieselben Formularfelder und über `battery-draft.ts` in denselben Entwurf.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DER UNTERSCHIED ZU DEN FÜNF ANBINDUNGEN DAVOR: ES GIBT KEIN VORGELEGTES DOKUMENT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bei Rechnung, Datenblatt und PV-Exposé ist die Quelle die Datei, und die Regel lautet „lies NUR,
 * was darauf steht". Hier gibt es nichts Vorgelegtes — das Modell besorgt sich die Quelle selbst.
 * Damit entsteht eine Fehlerart, die es vorher nicht gab: **eine Zahl aus dem Trainingswissen, die
 * wie eine recherchierte aussieht.** Sie ist nicht bloss ungenau, sie ist nicht überprüfbar, und
 * sie steht anschliessend als Kenndatum der Anlage des Kunden in einer Wirtschaftlichkeitsrechnung.
 *
 * ── ⚠ DESHALB IST DER BELEG EINE PRÜFUNG UND KEINE BITTE AN DAS MODELL ────────────────────────
 * Der System-Prompt verlangt selbstverständlich einen Beleg. Verlassen kann man sich darauf nicht:
 * eine erfundene URL ist für einen Prompt nicht von einer echten zu unterscheiden. Der eigentliche
 * Schutz sitzt deshalb in `parseBatteryLookupExtraction` und ist STRUKTURELL — sie bekommt die
 * URLs, die die Websuche TATSÄCHLICH geliefert hat (die Server-Werkzeug-Ergebnisse der Antwort,
 * nicht die Behauptung des Modells), und
 *
 *   (a) verwirft jede genannte Quelle, die darin nicht vorkommt — eine Fussnote auf eine Seite,
 *       die nie in einem Suchergebnis stand, ist erfunden;
 *   (b) NULLT ALLE VIER ZAHLEN, wenn danach keine Quelle übrig bleibt oder gar nicht gesucht
 *       wurde. Ohne Beleg keine Zahl — und zwar unabhängig davon, wie überzeugt das Modell klingt.
 *
 * Dieselbe Haltung wie der Kreuzcheck zwischen Himmelsrichtung und Gradzahl im PV-Scan (B22c): die
 * gefährlichste Angabe bekommt eine Prüfung, die ohne das Zutun des Modells auskommt.
 *
 * ── WARUM DIESER TEIL IN `shared` LIEGT ────────────────────────────────────────────────────────
 * Wortgleich zu den fünf Anbindungen davor: hier steht genau der Teil, der sich OHNE einen
 * Modellaufruf prüfen lässt — Zielschema, Auswertung und die Belegprüfung oben. Das EINSAMMELN der
 * tatsächlich gelieferten URLs ist dagegen SDK-Form und liegt im Extraktor; was mit ihnen
 * geschieht, steht hier und ist testbar. Die Datei hat bis auf die eine Schranke unten KEINE
 * Importe; kein zod (das JSON-Schema ist die WIRE-Fassung, die an die API geht).
 *
 * ── ⚠ DIE FELDNAMEN SIND AN `battery-text.ts` GEBUNDEN, NICHT BLOSS GLEICH GESCHRIEBEN ────────
 * `BATTERY_LOOKUP_NUMBER_KEYS` trägt eine `satisfies`-Schranke auf `BATTERY_TEXT_NUMBER_KEYS`. Wer
 * dort einen Schlüssel umbenennt, macht diese Datei ROT — statt dass die recherchierten Werte still
 * in keinem Formularfeld mehr ankommen. Dass die Listen auch DECKUNGSGLEICH sind (die Schranke
 * allein liesse eine Teilmenge zu), misst `battery-lookup.test.ts`; dieselbe „Spiegel plus Test"-
 * Technik wie zwischen `battery-spec-scan.ts` und `battery-text.ts`.
 */
import { BATTERY_TEXT_NUMBER_KEYS } from './battery-text'

/**
 * Warum nichts gefunden wurde — eine GESCHLOSSENE Liste, kein Satz des Modells.
 *
 * ── ⚠ WARUM HIER KEIN FREITEXT STEHT ──────────────────────────────────────────────────────────
 * „Kein Freitextfeld in der Rückgabe" gilt in allen fünf Anbindungen davor und hier erst recht:
 * ein Begründungssatz wäre Prosa des Modells über die eigene Sicherheit, und die Oberfläche würde
 * sie als Auskunft des Rechners anzeigen. Die SÄTZE stehen deshalb bei uns (in der Server Action),
 * die Liste bestimmt nur, WELCHER gilt.
 *
 * ⚠ Die ersten drei kann das Modell selbst vergeben — sie beschreiben, was es beim Suchen gesehen
 * hat, und stehen so im JSON-Schema. `no_evidence` steht dort ABSICHTLICH NICHT: es ist das Urteil
 * der Belegprüfung (s. Kopf) und wird ausschliesslich von `parseBatteryLookupExtraction` gesetzt.
 * Ein Modell, das sich selbst „unbelegt" attestiert, wäre eine Selbsteinschätzung; die Prüfung ist
 * eine Messung.
 */
export const BATTERY_LOOKUP_NOT_FOUND_REASONS = [
  /** Kein Produkt dieses Namens gefunden — Hersteller oder Typ existieren so nicht. */
  'not_identified',
  /** Mehrere Produkte oder Varianten passen; welches gemeint ist, steht nirgends. */
  'ambiguous',
  /** Das Produkt ist gefunden, aber es gab keine verlässlichen Kenndaten dazu. */
  'no_specs',
  /** ⚠ NICHT vom Modell — von der Belegprüfung vergeben: Zahlen ohne nachweisbare Quelle. */
  'no_evidence',
] as const

export type BatteryLookupNotFoundReason = (typeof BATTERY_LOOKUP_NOT_FOUND_REASONS)[number]

/**
 * Die drei Gründe, die das MODELL vergeben darf — genau die aus der Liste oben ohne `no_evidence`.
 * Ausgeschrieben statt gefiltert, damit das JSON-Schema unten ein Literal-Tupel bekommt.
 */
export const BATTERY_LOOKUP_MODEL_REASONS = [
  'not_identified',
  'ambiguous',
  'no_specs',
] as const satisfies readonly BatteryLookupNotFoundReason[]

/** Was eine Recherche ergeben kann. */
export interface BatteryLookupExtraction {
  /**
   * Der Hersteller des GEFUNDENEN Produkts, wörtlich wie auf der Quelle — NUR zur Anzeige.
   *
   * ⚠ Er belegt kein Feld und erreicht den Entwurf nicht (dieselbe Behandlung wie beim
   * Datenblatt-Scan). Gezeigt wird er trotzdem: „BYD Battery-Box Premium HVS 10.2" neben den vier
   * Zahlen ist das Einzige, woran ein Mensch erkennt, ob das Gesuchte gefunden wurde — und bei
   * einer Produktfamilie mit vier Varianten ist genau das die Frage.
   *
   * Dass es KEIN Freitextfeld im Sinn der Regel ist, gilt wortgleich wie dort: eine abgeschriebene
   * Produktbezeichnung ist eine gelesene Angabe, keine Prosa. Damit sie das bleibt, ist sie in der
   * Länge begrenzt (`MAX_BATTERY_LOOKUP_LABEL_CHARS`).
   */
  manufacturer: string | null
  /** Die Modell-/Typbezeichnung des gefundenen Produkts — NUR zur Anzeige, s. `manufacturer`. */
  model: string | null
  /** Nutzbare Kapazität in kWh. Ausdrücklich NICHT die Brutto-/Nennkapazität. */
  capacityKwh: number | null
  /** Dauerhafte Lade-/Entladeleistung in kW. Ausdrücklich NICHT die Spitzenleistung. */
  maxPowerKw: number | null
  /**
   * Round-Trip-Wirkungsgrad in PROZENT (0–100), so wie die Quelle ihn schreibt.
   *
   * ⚠ Der Katalog führt ihn als Bruchteil (0,9). Umgerechnet wird an GENAU EINER Stelle, beim
   * Übernehmen in den Override — hier bleibt stehen, was dort stand. Dieselbe Konvention wie in
   * `battery-text.ts` und `battery-spec-scan.ts`; sie MUSS dieselbe sein, weil alle drei Wege
   * dasselbe Feld füllen.
   */
  roundTripEfficiencyPercent: number | null
  /** Preis in Euro je kWh Kapazität. Bei einer Recherche der Ausnahmefall — s. System-Prompt. */
  pricePerKwh: number | null
  /**
   * Die Quellen, aus denen die Zahlen stammen — GEPRÜFT, nicht bloss behauptet (s. Kopf).
   *
   * ⚠ Sie sind NUR zur Anzeige und gehen in kein Entwurfsfeld. Ihr Zweck ist die Kontrolle durch
   * einen Menschen, BEVOR die Zahlen mit „Speichern" zu Kenndaten der Anlage werden: ein Klick auf
   * die Quelle zeigt, ob dort wirklich steht, was hier vorgeschlagen wird. Ohne sie wäre dieser
   * Weg der einzige der drei, bei dem sich der Vorschlag gar nicht nachprüfen liesse.
   */
  sourceUrls: string[]
  /** Warum nichts (oder nichts Belastbares) gefunden wurde. `null`, wenn es einen Treffer gab. */
  notFound: BatteryLookupNotFoundReason | null
}

/**
 * Die vier Zahlenfelder, in fester Reihenfolge — von Schema, Auswertung und Test geteilt.
 *
 * ⚠ Die `satisfies`-Schranke bindet sie an `BATTERY_TEXT_NUMBER_KEYS` (s. Kopf). Sie verhindert
 * eine UMBENENNUNG, nicht ein Auseinanderlaufen der Mengen — dafür gibt es den Gleichheits-Test.
 */
export const BATTERY_LOOKUP_NUMBER_KEYS = [
  'capacityKwh',
  'maxPowerKw',
  'roundTripEfficiencyPercent',
  'pricePerKwh',
] as const satisfies readonly (typeof BATTERY_TEXT_NUMBER_KEYS)[number][]

/** Die zwei reinen Anzeigefelder, in fester Reihenfolge. */
export const BATTERY_LOOKUP_LABEL_KEYS = ['manufacturer', 'model'] as const satisfies readonly (
  keyof BatteryLookupExtraction
)[]

/**
 * Längengrenze von Hersteller und Modell in Zeichen. Darüber ist es keine Typbezeichnung mehr,
 * sondern ein Satz — und ein Satz an dieser Stelle wäre genau die Prosa, die das Schema sonst
 * nirgends zulässt. Dieselbe Grenze und Begründung wie `MAX_BATTERY_SPEC_LABEL_CHARS`.
 */
export const MAX_BATTERY_LOOKUP_LABEL_CHARS = 120

/**
 * Wie viele Quellen höchstens ausgewiesen werden.
 *
 * Nicht als Sparmassnahme, sondern als Anzeigegrenze: eine Zeile mit fünfzehn Links liest niemand,
 * und die Kontrolle, für die sie da sind, findet dann gar nicht statt. Die Reihenfolge ist die des
 * Modells — es nennt die tragende Quelle zuerst.
 */
export const MAX_BATTERY_LOOKUP_SOURCE_URLS = 4

/** Längengrenze einer einzelnen Quellen-URL. Darüber ist es keine Adresse, die jemand anklickt. */
export const MAX_BATTERY_LOOKUP_URL_CHARS = 500

/** Ein Ergebnis, in dem nichts gefunden wurde. Der Ausgangszustand jeder Auswertung. */
export function emptyBatteryLookupExtraction(): BatteryLookupExtraction {
  return {
    manufacturer: null,
    model: null,
    capacityKwh: null,
    maxPowerKw: null,
    roundTripEfficiencyPercent: null,
    pricePerKwh: null,
    sourceUrls: [],
    notFound: null,
  }
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Das JSON-Schema, das die API erzwingt.
 *
 * `additionalProperties: false` + vollständige `required`-Liste: das Modell MUSS jedes Feld
 * nennen, und der einzige zulässige Weg, es nicht zu beantworten, ist `null` (bzw. die leere Liste
 * bei den Quellen). Ohne `required` wäre „Feld weggelassen" ein zweiter Ausdruck für dasselbe.
 *
 * ⚠ `notFound` ist das ERSTE Aufzählungsfeld einer Batterie-Anbindung, und damit ist hier zum
 * ersten Mal in diesem Bereich die Schreibweise einschlägig, die am 31.08.2026 den Rechnungs-Scan
 * mit HTTP 400 funktionslos gemacht hat: `type: [..., 'null']` ZUSAMMEN mit `enum`. Sie steht
 * deshalb als `anyOf` — gegen die ECHTE API gemessen, nicht abgeleitet. Der rekursive Wächter im
 * Test prüft den ganzen Baum, auch für Felder, die es heute nicht gibt.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */

function nullableNumber(description: string) {
  return { type: ['number', 'null'], description } as const
}

function nullableString(description: string) {
  return { type: ['string', 'null'], description } as const
}

export const BATTERY_LOOKUP_JSON_SCHEMA: { [key: string]: unknown } = {
  type: 'object',
  additionalProperties: false,
  required: [
    ...BATTERY_LOOKUP_LABEL_KEYS,
    ...BATTERY_LOOKUP_NUMBER_KEYS,
    'sourceUrls',
    'notFound',
  ],
  properties: {
    manufacturer: nullableString(
      'Der Hersteller des GEFUNDENEN Produkts, wörtlich wie auf der Quelle (z. B. "Sungrow", ' +
        '"BYD"). Nicht die Eingabe zurückgeben, wenn nichts gefunden wurde — dann null.',
    ),
    model: nullableString(
      'Die Modell- oder Typbezeichnung des GEFUNDENEN Produkts, wörtlich wie auf der Quelle ' +
        '(z. B. "SBR128", "Battery-Box Premium HVS 10.2"). Wurde nur die Produktfamilie gefunden ' +
        'und nicht die konkrete Variante, nenne die Familie und setze notFound auf "ambiguous". ' +
        'null, wenn nichts gefunden wurde.',
    ),
    capacityKwh: nullableNumber(
      'NUTZBARE Speicherkapazität in Kilowattstunden (kWh), abgelesen von einer tatsächlich ' +
        'gefundenen Quelle. Ausdrücklich NICHT die Brutto-, Nenn- oder Gesamtkapazität. Nicht aus ' +
        'einer Leistungsangabe in kW erschliessen: das sind verschiedene Grössen. null, wenn du ' +
        'sie nicht auf einer Quelle gelesen hast.',
    ),
    maxPowerKw: nullableNumber(
      'DAUERHAFTE Lade-/Entladeleistung in Kilowatt (kW), abgelesen von einer tatsächlich ' +
        'gefundenen Quelle. Ausdrücklich NICHT die Spitzen-, Peak- oder Boost-Leistung. NICHT aus ' +
        'Strom und Spannung ausrechnen und nicht aus der Kapazität erschliessen — steht keine ' +
        'kW-Angabe da, ist das Feld null.',
    ),
    roundTripEfficiencyPercent: nullableNumber(
      'ROUND-TRIP-Wirkungsgrad des Speichersystems in PROZENT (0 bis 100) — „90 %" ergibt 90, ' +
        'nicht 0,9. Ausdrücklich NICHT der Wirkungsgrad des Wechselrichters, der Zellen oder der ' +
        'Ladeelektronik; steht nur ein solcher da, ist das Feld null. Über 100 ist unmöglich.',
    ),
    pricePerKwh: nullableNumber(
      'Preis in Euro je Kilowattstunde Kapazität. ⚠ NUR ein vom HERSTELLER genannter Listenpreis ' +
        'zählt. Ein Händler-, Shop- oder Angebotspreis ist KEINE Herstellerangabe — dann null, ' +
        'und das ist der Normalfall.',
    ),
    sourceUrls: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Die Adressen der Seiten, von denen du die Zahlen TATSÄCHLICH abgelesen hast — wörtlich ' +
        'so, wie sie im Suchergebnis standen. Die wichtigste zuerst. Leere Liste, wenn du keine ' +
        'Zahl übernommen hast. Nenne KEINE Adresse, die nicht in einem Suchergebnis stand: solche ' +
        'Angaben werden verworfen, und mit ihnen die Zahlen, die sich auf sie stützen.',
    },
    notFound: {
      anyOf: [
        { type: 'string', enum: [...BATTERY_LOOKUP_MODEL_REASONS] },
        { type: 'null' },
      ],
      description:
        'null, wenn du das Produkt eindeutig identifiziert hast. Sonst der Grund: ' +
        '"not_identified" = kein Produkt dieses Namens gefunden; "ambiguous" = mehrere Produkte ' +
        'oder Varianten passen und es steht nirgends, welches gemeint ist; "no_specs" = das ' +
        'Produkt ist gefunden, aber es gab keine verlässlichen Kenndaten dazu.',
    },
  },
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Die Auswertung.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Was die Websuche tatsächlich geliefert hat — der BELEG, gegen den geprüft wird.
 *
 * Er kommt aus den Server-Werkzeug-Ergebnissen der Modellantwort, nicht aus dem, was das Modell
 * über sich selbst sagt. Eingesammelt wird er im Extraktor (SDK-Form), bewertet wird er hier.
 */
export interface BatteryLookupEvidence {
  /** Die URLs aller Suchtreffer dieses Laufs, in beliebiger Reihenfolge, Dubletten erlaubt. */
  readonly searchedUrls: readonly string[]
  /** Wie oft die Suche gelaufen ist. ⚠ 0 heisst: es wurde gar nicht gesucht. */
  readonly searchCount: number
}

/**
 * Eine positive, endliche Zahl — oder `null`.
 *
 * ⚠ `NaN` und `Infinity` sind in JavaScript `typeof 'number'` und liefen ohne diese Prüfung als
 * gültige Angabe durch; `NaN` vergiftet danach jede Rechnung lautlos. Eine Zahl als ZEICHENKETTE
 * wird ausdrücklich NICHT gerettet: wer „20,5" parst, entscheidet zwischen 20,5 und 205.
 *
 * `> 0`, nicht `>= 0`: eine Batterie mit 0 kWh, 0 kW oder 0 % Wirkungsgrad ist keine Batterie.
 * Dieselbe Regel wie in `battery-text.ts` und `battery-spec-scan.ts` — alle drei füllen dieselben
 * Felder.
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
 * steht, und dieselbe Angabe halb dargestellt ist irreführender als gar keine.
 */
function shortLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/\s+/g, ' ').trim()
  if (cleaned === '') return null
  if (cleaned.length > MAX_BATTERY_LOOKUP_LABEL_CHARS) return null
  return cleaned
}

/**
 * Die Vergleichsform einer URL.
 *
 * ── ⚠ SIE DARF NUR KOSMETIK WEGNEHMEN ─────────────────────────────────────────────────────────
 * Verglichen wird damit die Behauptung des Modells gegen das, was die Suche geliefert hat. Jede
 * Normalisierung, die über Schreibweise hinausgeht, könnte zwei VERSCHIEDENE Seiten gleich machen
 * — und dann bürgte ein echter Suchtreffer für eine Quelle, die nie eine war. Weggenommen werden
 * deshalb ausschliesslich: Gross-/Kleinschreibung von Schema und Hostname (dort bedeutungslos),
 * ein abschliessender Schrägstrich und umschliessende Leerzeichen. Pfad, Abfrage und Fragment
 * bleiben unangetastet — sie unterscheiden Seiten.
 *
 * Nur `http`/`https`: ein `javascript:`- oder `data:`-Eintrag hat in einer Quellenliste nichts
 * verloren, die als Link gerendert wird.
 */
function canonicalUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > MAX_BATTERY_LOOKUP_URL_CHARS) return null

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null

  const path = parsed.pathname.endsWith('/') && parsed.pathname !== '/'
    ? parsed.pathname.slice(0, -1)
    : parsed.pathname
  return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${parsed.search}${parsed.hash}`
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function notFoundReason(value: unknown): BatteryLookupNotFoundReason | null {
  return typeof value === 'string' &&
    (BATTERY_LOOKUP_MODEL_REASONS as readonly string[]).includes(value)
    ? (value as BatteryLookupNotFoundReason)
    : null
}

/**
 * Wertet die Antwort des Modells aus und PRÜFT den Beleg — FAIL CLOSED, Feld für Feld.
 *
 * Es wird nichts geworfen und nichts gerettet. Eine vollständig unbrauchbare Antwort ergibt ein
 * gültiges Ergebnis, in dem nichts gefunden wurde — genau die Antwort, die eine Suche verdient,
 * die ins Leere lief. „Nicht gefunden" ist kein Programmfehler, sondern ein Befund.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIE BELEGPRÜFUNG IST DER ZWECK DIESER FUNKTION, NICHT IHR BEIWERK
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Zwei Schritte, beide ohne Zutun des Modells:
 *
 *   1. Jede genannte Quelle, die in `evidence.searchedUrls` NICHT vorkommt, wird verworfen. Sie
 *      kann nicht gelesen worden sein — sie stand in keinem Suchergebnis.
 *   2. Bleibt danach keine Quelle übrig, ODER wurde überhaupt nicht gesucht, werden ALLE VIER
 *      ZAHLEN genullt und der Grund steht auf `no_evidence`. Was dann noch dasteht, wäre
 *      Trainingswissen — plausibel, unüberprüfbar, und für die Anlage des Kunden womöglich falsch.
 *
 * ⚠ Hersteller und Modell überleben diesen Schritt. Sie füllen kein Feld und gehen in keine
 * Rechnung ein; ob sie ANGEZEIGT werden dürfen, entscheidet die Oberfläche an der Zahl der
 * geprüften Quellen (ohne Quelle steht dort kein „Gefunden: …"). Sie hier zu nullen nähme dem
 * Eintragenden die einzige Auskunft darüber, wonach überhaupt gesucht wurde.
 *
 * ⚠ Ein bereits vom Modell gesetzter Grund wird NICHT überschrieben: „nicht gefunden" ist die
 * genauere Auskunft als „ohne Beleg", und beide treffen dann zu.
 */
export function parseBatteryLookupExtraction(
  raw: unknown,
  evidence: BatteryLookupEvidence,
): BatteryLookupExtraction {
  const root = record(raw)

  const searched = new Set<string>()
  for (const url of evidence.searchedUrls) {
    const canonical = canonicalUrl(url)
    if (canonical !== null) searched.add(canonical)
  }

  const claimed = Array.isArray(root.sourceUrls) ? root.sourceUrls : []
  const sourceUrls: string[] = []
  const taken = new Set<string>()
  for (const candidate of claimed) {
    if (sourceUrls.length >= MAX_BATTERY_LOOKUP_SOURCE_URLS) break
    const canonical = canonicalUrl(candidate)
    // Nicht gesucht ⇒ nicht gelesen. Und jede Quelle nur einmal.
    if (canonical === null || !searched.has(canonical) || taken.has(canonical)) continue
    taken.add(canonical)
    sourceUrls.push(typeof candidate === 'string' ? candidate.trim() : canonical)
  }

  const proven = evidence.searchCount > 0 && sourceUrls.length > 0

  return {
    manufacturer: shortLabel(root.manufacturer),
    model: shortLabel(root.model),
    capacityKwh: proven ? positiveNumber(root.capacityKwh) : null,
    maxPowerKw: proven ? positiveNumber(root.maxPowerKw) : null,
    // Ein Wirkungsgrad über 100 % ist physikalisch unmöglich — und 0 % wäre keine Batterie.
    roundTripEfficiencyPercent: proven
      ? positiveNumber(root.roundTripEfficiencyPercent, 100)
      : null,
    pricePerKwh: proven ? positiveNumber(root.pricePerKwh) : null,
    sourceUrls,
    notFound: notFoundReason(root.notFound) ?? (proven ? null : 'no_evidence'),
  }
}

/**
 * Hat die Recherche überhaupt etwas ergeben?
 *
 * ── ⚠ HERSTELLER UND MODELL ZÄHLEN HIER MIT, OBWOHL SIE KEIN FELD FÜLLEN ──────────────────────
 * Die Frage dieser Funktion ist „hat der Aufruf etwas zutage gefördert?", nicht „ist das Ergebnis
 * brauchbar?". Eine Recherche, die den Typ gefunden hat, aber keine Kennzahl, ist gelaufen — es
 * gab nur nichts Belastbares. DASS die vier Zahlenfelder leer bleiben können, obwohl die Suche
 * lief, prüft die Server Action ein zweites Mal und meldet es dort mit eigenem Satz (wortgleiche
 * Lage wie bei den beiden Wegen daneben).
 */
export function batteryLookupExtractionIsEmpty(extraction: BatteryLookupExtraction): boolean {
  return (
    BATTERY_LOOKUP_LABEL_KEYS.every((key) => extraction[key] === null) &&
    BATTERY_LOOKUP_NUMBER_KEYS.every((key) => extraction[key] === null)
  )
}
