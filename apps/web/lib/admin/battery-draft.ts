/**
 * Die Batterie-Angaben im Entwurf eines Zählpunkts (B24, Teil 1).
 *
 * ── ⚠ WARUM DAS EIN EIGENES MODUL IST ─────────────────────────────────────────────────────────
 * Die Feldnamen haben ZWEI Konsumenten mit entgegengesetzter Richtung: die Server Action SCHREIBT
 * sie, die Station LIEST sie für ihre Zusammenfassung. Zweimal ausgeschrieben liefe eine Umbenennung
 * an einer der beiden vorbei — und zwar still: gespeichert würde unter dem neuen Namen, angezeigt
 * der alte, und die Station behauptete, es sei nichts erfasst. Dieselbe Aufteilung wie bei
 * `standard-profile.ts` (`ANNUAL_CONSUMPTION_KWH_KEY`) und `invoice-extractions.ts`.
 *
 * REIN: kein `server-only`, kein `next/*`, kein Supabase-Client — die Client-Komponente importiert
 * von hier, und eine Server-Abhängigkeit bräche ihren Build.
 *
 * ── ⚠ KEINES DIESER FELDER IST EIN `tariffParamsSchema`-FELD, UND DAS IST IN ORDNUNG ──────────
 * Der Entwurf ist eine Sammlung von Angaben, nicht das Contract-Objekt selbst; `tariffParamsSchema`
 * ist ein gewöhnliches `z.object` OHNE `.strict()`, zod entfernt unbekannte Schlüssel beim Auswerten
 * und meldet keinen Fehler (in `draft.test.ts` gemessen). Genau so lebt `annualConsumptionKwh` seit
 * dem Standardprofil-Zweig dort, und genau so leben die `_invoiceExtractions`.
 *
 * ⚠ FOLGE, die man kennen muss: `check_draft_completeness` führt sie als `unknown_fields` — sie
 * zählen also nicht zur Vollständigkeit des Tarif-Contracts. Wer sie später in die Rechnung
 * hineinreicht, tut das über einen eigenen Weg (die bestehende Anlage läuft ausserhalb von
 * `recommendBattery`, s. `packages/shared/src/battery-combination.ts`) — nicht über `TariffParams`.
 *
 * ── ⚠ DER PREIS STEHT HIER, GEHT ABER IN KEINE AMORTISATION EIN ───────────────────────────────
 * Eine bereits installierte Anlage ist bezahlt (Sunk Cost); der Report weist für sie bewusst weder
 * Investition noch Amortisation aus (Delta 17 Teil 2). Der Preis wird trotzdem erfasst, weil ein
 * Mensch ihn nennt und er für einen Vergleich („was hat es damals gekostet?") die einzige Spur ist.
 * Wer ihn je in eine Rechnung zieht, entscheidet damit gegen diese Festlegung und braucht dafür
 * eine eigene Begründung.
 */
import { BATTERY_TEXT_NUMBER_KEYS } from 'shared'


/** „Es gibt bereits einen Speicher" — geschrieben ausschliesslich vom Ja-Zweig. */
export const BATTERY_PRESENT_KEY = 'hasBattery'

/**
 * „Die Analyse soll einen Speichervorschlag enthalten" — geschrieben ausschliesslich vom Nein-Zweig.
 *
 * ⚠ ER IST NICHT DAS GEGENTEIL VON `hasBattery`. Wer keinen Speicher hat, will nicht zwangsläufig
 * einen vorgeschlagen bekommen (manche Projekte fragen ausschliesslich nach Spitzenkappung mit
 * bestehender Anlage, oder es geht zunächst nur um die Datenlage). Die beiden Felder beantworten
 * verschiedene Fragen und stehen deshalb unabhängig nebeneinander.
 */
export const BATTERY_RECOMMENDATION_KEY = 'wantsBatteryRecommendation'

/**
 * Die vier Kenndaten — Entwurfs-Schlüssel, Formularfeld und Beschriftung an EINEM Ort.
 *
 * ⚠ `field` (der Entwurfs-Schlüssel) trägt die Vorsilbe `existingBattery`, `form` nicht: im
 * FORMULAR ist der Zusammenhang durch die Überschrift gegeben, im ENTWURF steht die Angabe neben
 * Tarif- und Lastgang-Feldern und muss für sich sprechen. `form` ist zugleich der Schlüssel der
 * Extraktion (`BatteryTextExtraction`) — die gelesenen Werte wandern damit ohne Umbenennung in die
 * Felder, und ein dritter Name für dieselbe Grösse entsteht gar nicht erst.
 */
export const BATTERY_VALUE_FIELDS = [
  {
    field: 'existingBatteryCapacityKwh',
    form: 'capacityKwh',
    label: 'Nutzbare Kapazität',
    unit: 'kWh',
    max: undefined,
    hint: 'Die NUTZBARE Kapazität, nicht die Bruttokapazität der Zellen.',
  },
  {
    field: 'existingBatteryMaxPowerKw',
    form: 'maxPowerKw',
    label: 'Lade-/Entladeleistung',
    unit: 'kW',
    max: undefined,
    hint: 'Eine andere Grösse als die Kapazität — sie lässt sich nicht aus ihr erschliessen.',
  },
  {
    field: 'existingBatteryRoundTripEfficiencyPercent',
    form: 'roundTripEfficiencyPercent',
    label: 'Wirkungsgrad',
    unit: '%',
    /** In PROZENT, wie ein Mensch ihn schreibt — die Umrechnung auf einen Bruchteil geschieht nie hier. */
    max: 100,
    hint: 'In Prozent (z. B. 90), nicht als Bruchteil.',
  },
  {
    field: 'existingBatteryPricePerKwh',
    form: 'pricePerKwh',
    label: 'Anschaffungspreis',
    unit: '€/kWh',
    max: undefined,
    hint: 'Je kWh Kapazität — ein Gesamtpreis ist etwas anderes.',
  },
] as const satisfies readonly {
  field: string
  /**
   * ⚠ Die Schranke bindet das Formularfeld an die EXTRAKTION: `BATTERY_TEXT_NUMBER_KEYS` sind die
   * vier Zahlenfelder von `BatteryTextExtraction` (`packages/shared`). Wer dort eines umbenennt,
   * macht diese Datei rot — statt dass die gelesenen Werte still in keinem Feld mehr ankommen.
   * `hasExistingBattery` steht ausdrücklich nicht in dieser Liste: es wird hier nicht übernommen
   * (Begründung im Kopf des Batterie-Abschnitts der Server Actions).
   */
  form: (typeof BATTERY_TEXT_NUMBER_KEYS)[number]
  label: string
  unit: string
  /** Obergrenze, wo es eine gibt — heute allein der Wirkungsgrad (über 100 % ist unmöglich). */
  max: number | undefined
  hint: string
}[]

export type BatteryValueField = (typeof BATTERY_VALUE_FIELDS)[number]

/**
 * Zahl → Formularwert. Deutsches Dezimalkomma, KEIN Tausendertrennzeichen.
 *
 * ⚠ Bewusst nicht über `Intl.NumberFormat('de-AT')`: das setzt ab 1000 ein schmales geschütztes
 * Leerzeichen, und `parseBatteryNumber` (wie jeder Zahlenleser dieses Bereichs) weist so etwas als
 * unbrauchbar ab. Der vorgeschlagene Wert wäre dann genau der, den das eigene Formular nicht
 * annimmt.
 */
export function formatBatteryNumber(value: number): string {
  return String(value).replace('.', ',')
}

/**
 * Formularwert → Zahl.
 *
 * `undefined` = leer (keine Angabe, kein Fehler) · `null` = eingetippt, aber unbrauchbar.
 * Dieselbe Dreiteilung und dieselbe Komma-Regel wie `readManualNumber` in den Server Actions; eine
 * Zahl mit Tausenderpunkt wird ausdrücklich NICHT geraten („1.234" ist als 1234 oder 1,234 lesbar).
 *
 * ⚠ `> 0`, nicht `>= 0` — anders als bei den Tarifwerten: dort ist eine Mindestleistung von 0 eine
 * echte Angabe, hier wäre eine Batterie mit 0 kWh, 0 kW oder 0 % Wirkungsgrad keine Batterie.
 */
export function parseBatteryNumber(
  raw: string,
  max?: number,
): number | null | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  const value = Number(trimmed.replace(',', '.'))
  if (!Number.isFinite(value) || value <= 0) return null
  if (max !== undefined && value > max) return null
  return value
}

/** Was im Entwurf eines Zählpunkts an Batterie-Angaben steht. */
export type BatteryDraftSummary = {
  /** `true` = der Ja-Zweig wurde gespeichert · `null` = dazu steht nichts im Entwurf. */
  hasBattery: boolean | null
  /** `true`/`false` = der Nein-Zweig wurde beantwortet · `null` = dazu steht nichts im Entwurf. */
  wantsRecommendation: boolean | null
  /** Die erfassten Kenndaten, in der Reihenfolge von `BATTERY_VALUE_FIELDS`. */
  values: { field: string; label: string; unit: string; value: number }[]
}

function readBoolean(draft: Record<string, unknown>, key: string): boolean | null {
  const value = draft[key]
  // Strikt: `'true'` oder `1` sähen wie eine Aussage aus und sind keine (Lesart `parseBatteryTextExtraction`).
  return value === true ? true : value === false ? false : null
}

export function readBatteryDraft(draft: Record<string, unknown>): BatteryDraftSummary {
  const values: BatteryDraftSummary['values'] = []
  for (const entry of BATTERY_VALUE_FIELDS) {
    const value = draft[entry.field]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    values.push({ field: entry.field, label: entry.label, unit: entry.unit, value })
  }
  return {
    hasBattery: readBoolean(draft, BATTERY_PRESENT_KEY),
    wantsRecommendation: readBoolean(draft, BATTERY_RECOMMENDATION_KEY),
    values,
  }
}

/** Steht überhaupt etwas zur Batterie im Entwurf? Für die Station: Zusammenfassung zeigen oder nicht. */
export function batteryDraftIsEmpty(summary: BatteryDraftSummary): boolean {
  return (
    summary.hasBattery === null &&
    summary.wantsRecommendation === null &&
    summary.values.length === 0
  )
}
