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

export interface DraftCompleteness {
  complete: boolean
  /** Pflichtfelder des Contracts, die im Entwurf gar nicht vorkommen. */
  missing: string[]
  /** Vorhandene Felder, die der Contract so nicht annimmt (Pfad + Grund). */
  invalid: { field: string; problem: string }[]
  /** Felder, die im Entwurf stehen und im Contract nicht vorkommen — nicht falsch, aber ungeprüft. */
  unknown: string[]
  /** Felder ohne Herkunftsvermerk. §3.2 verlangt ihn für jeden Wert. */
  withoutSource: string[]
  /** Felder, die auf einer Annahme beruhen — sie müssen bis in den Report sichtbar bleiben. */
  assumed: string[]
}

/**
 * Prüft den Entwurf gegen `tariffParamsSchema` — read-only.
 *
 * FEHLEND und UNGÜLTIG werden getrennt beantwortet, obwohl `safeParse` beides als Fehler meldet:
 * „du hast noch nicht gefragt" und „die Zahl passt nicht" sind für das Gespräch zwei verschiedene
 * Aufgaben, und ein gemeinsamer Topf zwänge das Modell, sie aus einer zod-Meldung zu erraten.
 *
 * ⚠ `complete` ist NICHT allein die Schema-Prüfung. Ein Entwurf, dessen Werte ohne Herkunft
 * dastehen, ist nach §3.2 nicht fertig — die Kennzeichnung ist Teil der Zusage, nicht Beiwerk.
 * Eine ANNAHME hindert dagegen nicht: mit ihr weiterzurechnen ist ausdrücklich Weg (b).
 */
export function checkDraftCompleteness(draft: Record<string, unknown>): DraftCompleteness {
  const provenance = readDraftProvenance(draft)
  const present = Object.keys(draft).filter((key) => key !== DRAFT_PROVENANCE_KEY)
  const contractFields = new Set(Object.keys(tariffParamsSchema.shape))

  const missing = DRAFT_REQUIRED_FIELDS.filter((key) => !(key in draft))

  const parsed = tariffParamsSchema.safeParse(draft)
  const invalid = parsed.success
    ? []
    : parsed.error.issues
        .map((issue) => ({ field: issue.path.join('.'), problem: issue.message }))
        // Fehlende Pflichtfelder stehen oben schon; hier bleiben die echten Typprobleme.
        .filter((issue) => issue.field !== '' && !missing.includes(issue.field))

  const unknown = present.filter((key) => !contractFields.has(key))
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
