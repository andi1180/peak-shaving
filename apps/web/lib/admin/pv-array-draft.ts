/**
 * Die PV-ANLAGENDATEN im Entwurf eines Zählpunkts (B24, Teil 1).
 *
 * ── ⚠ WARUM DAS EIN EIGENES MODUL IST ─────────────────────────────────────────────────────────
 * Dieselben zwei Konsumenten mit entgegengesetzter Richtung wie bei `battery-draft.ts`,
 * `pv-draft.ts` und `pv-profile-draft.ts`: die Server Action SCHREIBT die Felder, die Station LIEST
 * sie für ihre Zusammenfassung. Zweimal ausgeschrieben liefe eine Umbenennung an einer der beiden
 * vorbei — und zwar still: gespeichert würde unter dem neuen Namen, angezeigt der alte, und die
 * Station behauptete, es sei nichts erfasst.
 *
 * ── ⚠ ES IST NICHT `pv-draft.ts`, UND DAS IST EINE ABGRENZUNG ────────────────────────────────
 * Dort steht GENAU EINE Angabe: „gibt es überhaupt eine PV-Anlage?" — die Antwort auf die Frage der
 * Station, geschrieben von ihren zwei Knöpfen. Hier stehen die Kenndaten dieser Anlage, und sie
 * entstehen aus einer von zwei Quellen (Satz oder Datenblatt). Zwei Fragen, zwei Schreibwege, zwei
 * Module — dieselbe Aufteilung wie zwischen `pv-draft.ts` und `pv-profile-draft.ts`.
 *
 * REIN: kein `server-only`, kein `next/*`, kein Supabase-Client, KEIN Import aus
 * `packages/extractors` (das ist `server-only` und bräche den Build der Client-Komponente). Die
 * Client-Komponente importiert von hier.
 *
 * ── ⚠ KEINES DIESER FELDER IST EIN `tariffParamsSchema`-FELD, UND DAS IST IN ORDNUNG ──────────
 * Wortgleich zu den drei Entwurfs-Modulen daneben: der Entwurf ist eine Sammlung von Angaben, nicht
 * das Contract-Objekt selbst; `tariffParamsSchema` ist ein gewöhnliches `z.object` OHNE `.strict()`,
 * zod entfernt unbekannte Schlüssel beim Auswerten und meldet keinen Fehler (in `draft.test.ts`
 * gemessen). ⚠ Folge: `check_draft_completeness` führt sie als `unknown_fields` — sie zählen nicht
 * zur Vollständigkeit des Tarif-Contracts. Die PV-Seite läuft ohnehin ausserhalb von `TariffParams`
 * (`PvProfile` in `packages/shared`).
 *
 * ── ⚠ WAS HIER NICHT STEHT: DIE GRADZAHL ─────────────────────────────────────────────────────
 * `pvDesignArrayPrefill` (`packages/shared`) liefert neben den drei Werten auch `compassDeg`,
 * `degreeConflict` und `unverifiedDeg`. Keines davon wird gespeichert: sie sind die AUSKUNFT über
 * genau eine Ablesung („die gedruckte Zahl passt nicht zur genannten Richtung") und gelten nur in
 * dem Moment, in dem der Eintragende sie sieht. Im Entwurf abgelegt stünden sie neben einer
 * Richtung, die er danach womöglich von Hand korrigiert hat — und behaupteten einen Widerspruch,
 * den es nicht mehr gibt.
 *
 * ⚠ Die RICHTUNG ist damit die einzige Ausrichtungsangabe, die den Entwurf erreicht. Sie ist über
 * alle Azimut-Zählweisen hinweg eindeutig; genau deshalb ist sie es und nicht die Zahl (die
 * Begründung im Kopf von `pv-design-scan.ts`).
 */
import {
  COMPASS_DIRECTIONS,
  MAX_ARRAY_PEAK_POWER_KWP,
  MAX_PV_ARRAY_SLOPE_DEG,
  type CompassDirection,
  type PvArrayTextExtraction,
  type PvDesignArrayPrefill,
} from 'shared'

/** Nennleistung der Modulfläche in kWp. */
export const PV_ARRAY_PEAK_POWER_KWP_KEY = 'pvArrayPeakPowerKwp'

/** Himmelsrichtung der Modulfläche — eine der acht Kennungen aus `COMPASS_DIRECTIONS`. */
export const PV_ARRAY_DIRECTION_KEY = 'pvArrayDirection'

/** Neigung gegen die Horizontale in Grad. */
export const PV_ARRAY_SLOPE_DEG_KEY = 'pvArraySlopeDeg'

/**
 * Die zwei ZAHLEN-Kenndaten — Entwurfs-Schlüssel, Formularfeld und Beschriftung an EINEM Ort.
 *
 * ⚠ `field` trägt die Vorsilbe `pvArray`, `form` nicht: im FORMULAR ist der Zusammenhang durch die
 * Überschrift gegeben, im ENTWURF steht die Angabe neben Tarif-, Lastgang- und Batteriefeldern und
 * muss für sich sprechen (dieselbe Aufteilung wie in `battery-draft.ts`).
 *
 * ⚠ DIE SCHRANKE AUF `form` BINDET DAS FELD AN BEIDE QUELLEN: `PvArrayTextExtraction` (der Satz in
 * eigenen Worten) UND `PvDesignArrayPrefill` (das ausgelesene Datenblatt). Wer in einem der beiden
 * Module einen Schlüssel umbenennt, macht diese Datei ROT — statt dass die gelesenen Werte still in
 * keinem Formularfeld mehr ankommen.
 *
 * ⚠ Die Untergrenzen sind VERSCHIEDEN, und das ist fachlich: 0 kWp wäre keine Anlage, 0° Neigung
 * dagegen eine reale Bauweise (flach aufliegend). `min: 0` heisst „0 ist eine Angabe".
 */
export const PV_ARRAY_NUMBER_FIELDS = [
  {
    field: PV_ARRAY_PEAK_POWER_KWP_KEY,
    form: 'peakPowerKwp',
    label: 'Nennleistung',
    unit: 'kWp',
    min: undefined,
    max: MAX_ARRAY_PEAK_POWER_KWP,
    hint: 'Die Leistung der MODULE, nicht die des Wechselrichters und nicht der Jahresertrag.',
  },
  {
    field: PV_ARRAY_SLOPE_DEG_KEY,
    form: 'slopeDeg',
    label: 'Neigung',
    unit: '°',
    /** 0 ist eine Angabe (flach aufliegend) und kein leeres Feld — deshalb `0` und nicht `undefined`. */
    min: 0,
    max: MAX_PV_ARRAY_SLOPE_DEG,
    hint: 'In Grad gegen die Waagrechte (0 = flach, 90 = senkrecht). Eine Dachneigung in Prozent ist eine andere Zahl.',
  },
] as const satisfies readonly {
  field: string
  form: keyof PvArrayTextExtraction & keyof PvDesignArrayPrefill
  label: string
  unit: string
  /** Untergrenze, wo 0 eine Angabe ist — sonst `undefined` („grösser als 0"). */
  min: number | undefined
  max: number
  hint: string
}[]

export type PvArrayNumberField = (typeof PV_ARRAY_NUMBER_FIELDS)[number]

/**
 * Der Formularname des Richtungsfeldes.
 *
 * ⚠ AUCH ER IST AN BEIDE QUELLEN GEBUNDEN, über dieselbe Schranke wie die Zahlenfelder — er steht
 * nur nicht in ihrer Tabelle, weil er kein Zahlenfeld ist und über keine Zahlenprüfung laufen darf.
 */
export const PV_ARRAY_DIRECTION_FORM_FIELD = 'direction' satisfies keyof PvArrayTextExtraction &
  keyof PvDesignArrayPrefill

/** Ist dies eine der acht bekannten Himmelsrichtungen? Für Formular UND Entwurfs-Leser. */
export function isCompassDirection(value: unknown): value is CompassDirection {
  return typeof value === 'string' && COMPASS_DIRECTIONS.some((entry) => entry.key === value)
}

/**
 * Zahl → Formularwert. Deutsches Dezimalkomma, KEIN Tausendertrennzeichen.
 *
 * ⚠ Bewusst nicht über `Intl.NumberFormat('de-AT')`: das setzt ab 1000 ein schmales geschütztes
 * Leerzeichen, und `parsePvArrayNumber` (wie jeder Zahlenleser dieses Bereichs) weist so etwas als
 * unbrauchbar ab. Der vorgeschlagene Wert wäre dann genau der, den das eigene Formular nicht
 * annimmt.
 */
export function formatPvArrayNumber(value: number): string {
  return String(value).replace('.', ',')
}

/**
 * Formularwert → Zahl.
 *
 * `undefined` = leer (keine Angabe, kein Fehler) · `null` = eingetippt, aber unbrauchbar.
 * Dieselbe Dreiteilung und dieselbe Komma-Regel wie `parseBatteryNumber`; eine Zahl mit
 * Tausenderpunkt wird ausdrücklich NICHT geraten („1.234" ist als 1234 oder 1,234 lesbar).
 */
export function parsePvArrayNumber(
  raw: string,
  field: Pick<PvArrayNumberField, 'min' | 'max'>,
): number | null | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  const value = Number(trimmed.replace(',', '.'))
  if (!Number.isFinite(value)) return null
  // `min: undefined` heisst „grösser als 0" — 0 wäre dort keine Angabe, sondern keine Anlage.
  if (field.min === undefined ? value <= 0 : value < field.min) return null
  if (value > field.max) return null
  return value
}

/** Was im Entwurf eines Zählpunkts an PV-Anlagendaten steht. */
export type PvArrayDraftSummary = {
  /** Die erfassten Zahlen, in der Reihenfolge von `PV_ARRAY_NUMBER_FIELDS`. */
  values: { field: string; label: string; unit: string; value: number }[]
  /** Die erfasste Himmelsrichtung, oder `null`. */
  direction: CompassDirection | null
}

export function readPvArrayDraft(draft: Record<string, unknown>): PvArrayDraftSummary {
  const values: PvArrayDraftSummary['values'] = []
  for (const entry of PV_ARRAY_NUMBER_FIELDS) {
    const value = draft[entry.field]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    values.push({ field: entry.field, label: entry.label, unit: entry.unit, value })
  }
  const direction = draft[PV_ARRAY_DIRECTION_KEY]
  return { values, direction: isCompassDirection(direction) ? direction : null }
}

/** Steht überhaupt etwas zur Anlage im Entwurf? Für die Station: Zusammenfassung zeigen oder nicht. */
export function pvArrayDraftIsEmpty(summary: PvArrayDraftSummary): boolean {
  return summary.values.length === 0 && summary.direction === null
}

/** Der ausgeschriebene Name einer Himmelsrichtung — aus dem EINEN Fundort, nicht abgetippt. */
export function compassDirectionLabel(key: CompassDirection): string {
  return COMPASS_DIRECTIONS.find((entry) => entry.key === key)?.label ?? key
}
