import { tariffParamsSchema } from 'shared'

import { DRAFT_REQUIRED_FIELDS, type DraftValueSource } from './tools'

/**
 * B24 — DER ENTWURF UND SEINE HERKUNFTS-VERMERKE (Delta §3.1/§3.2).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIE ENTSCHEIDUNG, DIE DIESES MODUL TRÄGT: DIE HERKUNFT LIEGT NEBEN DEM WERT, NICHT UM IHN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Delta §3.2 verlangt eine „sichtbare Kennzeichnung Annahme vs. Messwert, durchgehend bis in den
 * Report". Der naheliegende Zuschnitt wäre, jeden Wert einzupacken:
 *
 *     { energyPriceCtPerKwh: { value: 24.5, source: 'measured' } }
 *
 * Das ist FALSCH, und der Grund steht wörtlich im Spaltenkommentar der Migration: „Die TYPISIERUNG
 * bleibt trotzdem verbindlich, sie sitzt nur woanders: tariffParamsSchema (zod) prüft den Entwurf,
 * wenn er die Engine erreicht." Ein eingepackter Wert scheitert an genau dieser Prüfung — der
 * Entwurf wäre nie vollständig, und die Vollständigkeitsprüfung meldete für jedes gefüllte Feld
 * einen Typfehler.
 *
 * Die Vermerke liegen deshalb als SEITENEINTRAG im selben Objekt:
 *
 *     { energyPriceCtPerKwh: 24.5, _provenance: { energyPriceCtPerKwh: { source, note, at } } }
 *
 * Das trägt, weil `tariffParamsSchema` ein gewöhnliches `z.object` ohne `.strict()` ist: zod
 * entfernt unbekannte Schlüssel beim Auswerten und meldet KEINEN Fehler (in `draft.test.ts`
 * gemessen, nicht angenommen). Der Entwurf bleibt also gegen den Contract prüfbar UND trägt seine
 * Herkunft.
 *
 * ⚠ AUFLAGE: `_provenance` darf nie zum Contract-Feldnamen werden. `assertProvenanceKeyIsFree`
 * unten macht daraus eine Prüfung statt einer Hoffnung — sie läuft im Test gegen die echten
 * Schlüssel von `tariffParamsSchema`.
 */
export const DRAFT_PROVENANCE_KEY = '_provenance'

export interface DraftProvenanceEntry {
  source: DraftValueSource
  note?: string
  /** Wann der Vermerk entstand — ISO-8601. Er belegt die Reihenfolge späterer Korrekturen. */
  at: string
}

export type DraftProvenance = Record<string, DraftProvenanceEntry>

/** Der Wert eines Entwurfsfelds. Bewusst eng: Objekte und Arrays gehören hier nicht hinein. */
export type DraftValue = number | string | boolean

/** Liest die Vermerke aus einem Entwurf. Ein fehlender oder kaputter Seiteneintrag ergibt `{}`. */
export function readDraftProvenance(draft: Record<string, unknown>): DraftProvenance {
  const raw = draft[DRAFT_PROVENANCE_KEY]
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}

  const result: DraftProvenance = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
    const entry = value as Record<string, unknown>
    if (entry.source !== 'measured' && entry.source !== 'assumed') continue
    result[key] = {
      source: entry.source,
      ...(typeof entry.note === 'string' && entry.note.trim() !== ''
        ? { note: entry.note.trim() }
        : {}),
      at: typeof entry.at === 'string' ? entry.at : '',
    }
  }
  return result
}

/**
 * Setzt EIN Feld und seinen Vermerk. Reine Funktion — sie gibt einen neuen Entwurf zurück.
 *
 * ⚠ Der Wrapper `update_project_draft` ERSETZT den Entwurf, er verschmilzt ihn nicht (bewusst: eine
 * flache Verschmelzung könnte einen Schlüssel nie wieder entfernen). Der Aufrufer muss also den
 * vollständigen, frisch gelesenen Entwurf hineingeben — deshalb liest der Ausführer vor jedem
 * Schreibvorgang neu, statt eine Kopie über den Turn zu tragen.
 */
export function setDraftField(
  draft: Record<string, unknown>,
  field: string,
  value: DraftValue,
  source: DraftValueSource,
  note: string | undefined,
  now: Date,
): Record<string, unknown> {
  const provenance = readDraftProvenance(draft)
  const trimmedNote = note?.trim()

  const next: Record<string, unknown> = { ...draft, [field]: value }
  next[DRAFT_PROVENANCE_KEY] = {
    ...provenance,
    [field]: {
      source,
      ...(trimmedNote ? { note: trimmedNote } : {}),
      at: now.toISOString(),
    },
  }
  return next
}

/**
 * Was die Vollständigkeitsprüfung von EINEM Katalog-Eintrag braucht.
 *
 * Bewusst ein struktureller Ausschnitt von `QuestionCatalogRow` (`ports.ts`) und kein Import: diese
 * Datei ist reine Entwurfs-Logik und soll die Port-Schicht nicht kennen. Die Feldnamen sind
 * ABSICHTLICH die des Wrappers — so lässt sich eine Zeile ohne Umbenennung hineingeben, und es gibt
 * keine Zuordnung, bei der man das falsche Feld erwischen kann. Was hier fehlt (`id`, `valid_from`),
 * gehört zum denormalisierten Katalog-Stand aus Delta §4.2 und geht die Prüfung nichts an.
 */
export interface DraftCatalogQuestion {
  question_key: string
  question_text: string
  required: boolean
}

/**
 * Eine Lücke im Entwurf: der Schlüssel, unter dem der Wert erwartet wird — und, wo es ihn gibt, der
 * admin-gepflegte Wortlaut der Frage.
 *
 * ⚠ EINE Liste für beide Herkünfte, nicht zwei. Ein Modell, das nur `missing` liest, dürfte die
 * Katalog-Pflichtfragen sonst still überspringen — genau der Fehler, gegen den der Katalog gebaut
 * ist. Beide werden ausserdem gleich beantwortet: die Antwort geht über `set_draft_field` unter
 * genau diesem Schlüssel in den Entwurf.
 *
 * `question` steht nur bei Katalog-Lücken. Ein Contract-Feldname ist im Werkzeugtext von
 * `set_draft_field` beschrieben; ein Katalog-Schlüssel ist es nirgends — dort ist der Wortlaut die
 * eigentliche Angabe, und der technische Schlüssel allein wäre für ein Gespräch wertlos.
 */
export interface DraftMissingEntry {
  field: string
  question?: string
}

export interface DraftCompleteness {
  complete: boolean
  /** Pflichtangaben, die im Entwurf gar nicht vorkommen — Contract-Felder UND Katalog-Pflichtfragen. */
  missing: DraftMissingEntry[]
  /** Vorhandene Felder, die der Contract so nicht annimmt (Pfad + Grund). */
  invalid: { field: string; problem: string }[]
  /** Felder, die weder im Contract noch im Katalog vorkommen — nicht falsch, aber ungeprüft. */
  unknown: string[]
  /** Felder ohne Herkunftsvermerk. §3.2 verlangt ihn für jeden Wert. */
  withoutSource: string[]
  /** Felder, die auf einer Annahme beruhen — sie müssen bis in den Report sichtbar bleiben. */
  assumed: string[]
}

/**
 * Prüft den Entwurf gegen `tariffParamsSchema` UND gegen den admin-gepflegten Fragenkatalog —
 * read-only.
 *
 * FEHLEND und UNGÜLTIG werden getrennt beantwortet, obwohl `safeParse` beides als Fehler meldet:
 * „du hast noch nicht gefragt" und „die Zahl passt nicht" sind für das Gespräch zwei verschiedene
 * Aufgaben, und ein gemeinsamer Topf zwänge das Modell, sie aus einer zod-Meldung zu erraten.
 *
 * ⚠ `complete` ist NICHT allein die Schema-Prüfung. Ein Entwurf, dessen Werte ohne Herkunft
 * dastehen, ist nach §3.2 nicht fertig — die Kennzeichnung ist Teil der Zusage, nicht Beiwerk.
 * Eine ANNAHME hindert dagegen nicht: mit ihr weiterzurechnen ist ausdrücklich Weg (b).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DER KATALOG BEANTWORTET ZWEI FRAGEN, UND DESHALB WIRD ER GANZ ÜBERGEBEN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Der Aufrufer reicht ALLE geltenden Einträge herein, nicht nur die mit `required`. Gefiltert wird
 * hier, weil dieselbe Liste zwei verschiedene Fragen beantwortet — genau die Aufteilung, die
 * `tools.ts` für `DRAFT_CONTRACT_FIELDS`/`DRAFT_REQUIRED_FIELDS` schon trifft („dieselbe Quelle,
 * andere Frage"):
 *
 *   (a) WAS FEHLT?    → nur `required === true`.
 *   (b) WAS IST BEKANNT? → JEDER Katalog-Schlüssel, auch der eines blossen Hinweises.
 *
 * Nur gefiltert übergeben liefe (b) falsch: der Admin hat die Frage ausdrücklich in den Katalog
 * gestellt, das Modell hat sie gestellt und die Antwort abgelegt — und bekäme dafür „gehört nicht
 * zum Eingabe-Contract" zu hören. Ein zweites Mal übergeben wäre die Alternative und damit zwei
 * Listen, die auseinanderlaufen können.
 *
 * Der Vorgabewert `[]` heisst „für dieses Projekt gibt es keinen Katalog" — der heutige
 * Normalzustand (die Kataloge sind bewusst leer, Delta §4.4) und zugleich der Fall eines Projekts
 * ohne bestimmtes Segment.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ NICHT JEDE ANTWORT LANDET IM ENTWURF — `answeredOnProject`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Zwei Angaben leben als eigene SPALTE am Projekt und nicht im Entwurf: `segment` und `industry`.
 * Der Kommentar an `question_catalog_entries.question_key` rechnet ausdrücklich damit, dass ein
 * Katalog genau danach fragt („Das Segment 'betrieb' MUSS damit z. B. eine Baseline-Frage nach der
 * Branche tragen koennen"). Beantwortet werden diese Fragen über `set_segment`/`set_industry` —
 * beide fassen den Entwurf nicht an.
 *
 * Ohne diesen Parameter bliebe so eine Pflichtfrage deshalb DAUERHAFT in `missing` stehen, obwohl
 * die Angabe längst erhoben ist: das Modell fragte den Kunden immer wieder nach seiner Branche, und
 * `complete` wäre für jedes Betriebs-Projekt unerreichbar. Der Aufrufer nennt hier also die
 * Schlüssel, deren Antwort er ANDERSWO stehen sieht. Bewusst als LISTE des Aufrufers und nicht als
 * fest eingebaute Sonderbehandlung für zwei Namen: welche Spalten es am Projekt gibt, weiss der
 * Ausführer — diese Datei kennt nur Entwürfe.
 */
export function checkDraftCompleteness(
  draft: Record<string, unknown>,
  catalog: readonly DraftCatalogQuestion[] = [],
  answeredOnProject: readonly string[] = [],
): DraftCompleteness {
  const provenance = readDraftProvenance(draft)
  const present = Object.keys(draft).filter((key) => key !== DRAFT_PROVENANCE_KEY)
  const contractFields = new Set(Object.keys(tariffParamsSchema.shape))
  const catalogKeys = new Set(catalog.map((entry) => entry.question_key))
  const answeredElsewhere = new Set(answeredOnProject)

  const missing: DraftMissingEntry[] = DRAFT_REQUIRED_FIELDS.filter((key) => !(key in draft)).map(
    (field) => ({ field }),
  )
  for (const entry of catalog) {
    if (!entry.required) continue
    if (entry.question_key in draft) continue
    if (answeredElsewhere.has(entry.question_key)) continue
    /*
     * Ein Katalog-Schlüssel, der zufällig ein Contract-Pflichtfeld ist, steht schon oben. Ihn ein
     * zweites Mal zu nennen liesse dieselbe Lücke wie zwei aussehen.
     */
    if (missing.some((gap) => gap.field === entry.question_key)) continue
    missing.push({ field: entry.question_key, question: entry.question_text })
  }

  const parsed = tariffParamsSchema.safeParse(draft)
  const invalid = parsed.success
    ? []
    : parsed.error.issues
        .map((issue) => ({ field: issue.path.join('.'), problem: issue.message }))
        // Fehlende Pflichtfelder stehen oben schon; hier bleiben die echten Typprobleme.
        .filter(
          (issue) => issue.field !== '' && !missing.some((gap) => gap.field === issue.field),
        )

  const unknown = present.filter((key) => !contractFields.has(key) && !catalogKeys.has(key))
  const withoutSource = present.filter((key) => provenance[key] === undefined)
  const assumed = present.filter((key) => provenance[key]?.source === 'assumed')

  return {
    complete: missing.length === 0 && invalid.length === 0 && withoutSource.length === 0,
    missing,
    invalid,
    unknown,
    withoutSource,
    assumed,
  }
}

/**
 * ⚠ Der Seiteneintrag darf keinen Contract-Feldnamen verdecken. Als Funktion statt als Kommentar,
 * damit der Test sie gegen die echten Schlüssel laufen lassen kann.
 */
export function provenanceKeyCollidesWithContract(): boolean {
  return DRAFT_PROVENANCE_KEY in tariffParamsSchema.shape
}
