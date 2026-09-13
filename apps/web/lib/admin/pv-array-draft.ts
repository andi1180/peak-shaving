/**
 * Die PV-ANLAGENDATEN im Entwurf eines Zählpunkts (B24, Teil 1) — als LISTE von Flächen.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ SEIT DIESEM SCHRITT EINE LISTE, VORHER DREI SKALARE FELDER
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Eine Anlage hat oft mehrere Modulflächen (Ost/West, Vorbau, ein nachträglich belegter Nebendach),
 * und der Generator (B22) rechnet PRO Fläche und summiert — eine einzige erfasste Fläche
 * unterschätzte die Erzeugung systematisch, und zwar still: die Zahl im Report sähe deswegen nicht
 * falsch aus. Genau deshalb war die bisherige Fassung (drei Skalarfelder, jeder zweite Klick
 * überschreibt den ersten) der gefährlichere Zustand.
 *
 * Der Seiteneintrag `_pvArrays` folgt demselben Muster wie `_invoiceExtractions` (Rechnung-Station):
 * eine Liste gehört nicht über `setDraftField` (das kennt nur `number | string | boolean`), sondern
 * per direkter Objektzuweisung — hier über `withPvArrays`.
 *
 * ── ⚠ WARUM DAS EIN EIGENES MODUL IST ─────────────────────────────────────────────────────────
 * Dieselben zwei Konsumenten mit entgegengesetzter Richtung wie bei `battery-draft.ts`,
 * `pv-draft.ts` und `pv-profile-draft.ts`: die Server Action SCHREIBT, die Station LIEST für ihre
 * Zusammenfassung. Zweimal ausgeschrieben liefe eine Umbenennung an einer der beiden vorbei — und
 * zwar still: gespeichert würde unter dem neuen Namen, angezeigt der alte, und die Station
 * behauptete, es sei nichts erfasst.
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
 * ── ⚠ DER SEITENEINTRAG IST KEIN `tariffParamsSchema`-FELD, UND DAS IST IN ORDNUNG ────────────
 * Wortgleich zu `_invoiceExtractions` und `_provenance`: der Entwurf wird gegen `tariffParamsSchema`
 * geprüft, sobald er die Engine erreicht; das ist ein gewöhnliches `z.object` OHNE `.strict()`, zod
 * entfernt unbekannte Schlüssel beim Auswerten und meldet keinen Fehler (in `draft.test.ts`
 * gemessen, nicht angenommen). ⚠ AUFLAGE, wortgleich zur dortigen: der Schlüssel darf nie zu einem
 * Contract-Feldnamen werden — `pvArraysKeyCollidesWithContract()` macht daraus eine Prüfung statt
 * einer Hoffnung. Die PV-Seite läuft ohnehin ausserhalb von `TariffParams` (`PvProfile` in
 * `packages/shared`).
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
  tariffParamsSchema,
  type CompassDirection,
  type PvArrayTextExtraction,
  type PvDesignArrayPrefill,
} from 'shared'

/** Der Seiteneintrag mit den erfassten Flächen — eine Liste, deshalb nicht über `setDraftField`. */
export const PV_ARRAYS_KEY = '_pvArrays'

/** Eine erfasste Modulfläche, wie sie im Entwurf steht. */
export type PvArrayEntry = {
  peakPowerKwp: number | null
  direction: CompassDirection | null
  slopeDeg: number | null
}

/**
 * Die zwei ZAHLEN-Kenndaten — Formularfeld-Name und Beschriftung an EINEM Ort.
 *
 * ⚠ SIE BESCHREIBEN AB JETZT EIN FORMULARFELD, NICHT MEHR EINEN ENTWURFS-SCHLÜSSEL. Den gibt es
 * pro Feld nicht mehr: die Werte leben in einem Listen-Eintrag (`PvArrayEntry`), und dessen
 * Schlüssel sind genau diese Formularnamen. Das frühere `field` (`pvArrayPeakPowerKwp` &c.) ist
 * damit ersatzlos entfallen.
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
    form: 'peakPowerKwp',
    label: 'Nennleistung',
    unit: 'kWp',
    min: undefined,
    max: MAX_ARRAY_PEAK_POWER_KWP,
    hint: 'Die Leistung der MODULE, nicht die des Wechselrichters und nicht der Jahresertrag.',
  },
  {
    form: 'slopeDeg',
    label: 'Neigung',
    unit: '°',
    /** 0 ist eine Angabe (flach aufliegend) und kein leeres Feld — deshalb `0` und nicht `undefined`. */
    min: 0,
    max: MAX_PV_ARRAY_SLOPE_DEG,
    hint: 'In Grad gegen die Waagrechte (0 = flach, 90 = senkrecht). Eine Dachneigung in Prozent ist eine andere Zahl.',
  },
] as const satisfies readonly {
  form: keyof PvArrayTextExtraction & keyof PvDesignArrayPrefill & keyof PvArrayEntry
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
  keyof PvDesignArrayPrefill &
  keyof PvArrayEntry

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

/**
 * Die Flächen aus dem Seiteneintrag.
 *
 * ⚠ DEFENSIV WIE JEDER `jsonb`-LESER DIESES REPOS. Der Typ ist eine Behauptung über das, was die
 * Action einmal geschrieben hat; die Spalte nimmt alles an. Ein Wert, der keine endliche Zahl bzw.
 * keine bekannte Himmelsrichtung ist, wird zu `null` — damit kann ein von Hand verändertes `jsonb`
 * hier keine Angabe erfinden.
 *
 * ⚠ Eine Zeile, in der ALLE DREI Werte fehlen, wird ÜBERSPRUNGEN: sie wäre keine Fläche, sondern
 * ein leerer Eintrag, der nie hätte entstehen dürfen — in der Zusammenfassung erschiene sie als
 * „Fläche 2" ohne eine einzige Angabe und sähe aus wie ein Datenverlust.
 */
export function readPvArraysDraft(draft: Record<string, unknown>): PvArrayEntry[] {
  const raw = draft[PV_ARRAYS_KEY]
  if (!Array.isArray(raw)) return []

  const out: PvArrayEntry[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const row = entry as Record<string, unknown>
    const peakPowerKwp =
      typeof row.peakPowerKwp === 'number' && Number.isFinite(row.peakPowerKwp)
        ? row.peakPowerKwp
        : null
    const direction = isCompassDirection(row.direction) ? row.direction : null
    const slopeDeg =
      typeof row.slopeDeg === 'number' && Number.isFinite(row.slopeDeg) ? row.slopeDeg : null
    if (peakPowerKwp === null && direction === null && slopeDeg === null) continue
    out.push({ peakPowerKwp, direction, slopeDeg })
  }
  return out
}

/**
 * Setzt den Seiteneintrag. Reine Funktion — sie gibt einen neuen Entwurf zurück.
 *
 * ⚠ Der Wrapper `update_metering_point_draft` ERSETZT den Entwurf, er verschmilzt ihn nicht. Der
 * Aufrufer muss also den vollständigen, FRISCH gelesenen Entwurf hineingeben; dieselbe Auflage wie
 * bei `withStoredInvoiceExtractions`, und aus demselben Grund (eine flache Verschmelzung könnte
 * einen Schlüssel nie wieder entfernen).
 */
export function withPvArrays(
  draft: Record<string, unknown>,
  arrays: readonly PvArrayEntry[],
): Record<string, unknown> {
  return { ...draft, [PV_ARRAYS_KEY]: arrays }
}

/** Steht überhaupt eine Fläche im Entwurf? Für die Station: Zusammenfassung zeigen oder nicht. */
export function pvArraysDraftIsEmpty(arrays: readonly PvArrayEntry[]): boolean {
  return arrays.length === 0
}

/** Der ausgeschriebene Name einer Himmelsrichtung — aus dem EINEN Fundort, nicht abgetippt. */
export function compassDirectionLabel(key: CompassDirection): string {
  return COMPASS_DIRECTIONS.find((entry) => entry.key === key)?.label ?? key
}

/**
 * Die Auflage aus dem Kopf, als Prüfung: der Seiteneintrag darf kein Contract-Feld verdecken.
 *
 * Wortgleich zu `invoiceExtractionsKeyCollidesWithContract()`. Träfe der Schlüssel je einen
 * `tariffParamsSchema`-Feldnamen, stünde eine Liste dort, wo die Engine einen Tarifwert erwartet —
 * und zod verwürfe sie beim Auswerten, ohne dass irgendetwas fehlschlüge.
 */
export function pvArraysKeyCollidesWithContract(): boolean {
  return PV_ARRAYS_KEY in tariffParamsSchema.shape
}
