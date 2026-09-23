/**
 * Formprüfung des Batteriespeicher-Formulars (K1).
 *
 * REIN: kein `server-only`, kein `next/*` — das Client-Formular liest die Beschriftungen, die
 * Server Action das Schema. Eigene Datei statt `lib/admin/schema.ts` aus demselben Grund wie bei
 * den Tarif-Abschnitten: dort liegen die Schemata ALLER Admin-Formulare, und `ADMIN_INITIAL_STATE`
 * aus derselben Datei wird von jedem Client-Formular importiert — das Vokabular dieses einen
 * Abschnitts hätte in jedem Bündel nichts verloren.
 *
 * ── FAST ALLES IST OPTIONAL, UND DAS IST DER ZWECK ────────────────────────────────────────────
 * Ein Katalog entsteht zeilenweise: Hersteller und Bezeichnung heute, das Datenblatt morgen, der
 * Preis, wenn das Angebot da ist. Pflicht sind deshalb nur die drei Felder, die auch in der
 * Datenbank `not null` sind. Die Vollständigkeit wird dort verlangt, wo sie zählt — beim Aktivieren
 * (CHECK `battery_catalog_active_complete`, Wrapper `admin_set_battery_active`).
 *
 * ── WAS HIER ABSICHTLICH NICHT GEPRÜFT WIRD ───────────────────────────────────────────────────
 * Die fachliche Plausibilität der Werte. 25 statt 2,5 kWh ist eine gültige Zahl und ein falsches
 * Gerät — das fängt kein Schema, sondern nur der Blick ins Datenblatt. Eine erfundene Obergrenze
 * wiese irgendwann einen echten Speicher ab (Prinzip 1). Geprüft wird nur das Unmögliche, und zwar
 * wortgleich zu den CHECKs der Tabelle: nicht negativ, Wirkungsgrad zwischen 0 und 1.
 */
import { z } from 'zod'
import { BATTERY_CONTROL_TYPES, BATTERY_KATEGORIEN, BATTERY_RTE_SOURCES } from './battery-catalog'

/** Ein Pflicht-Text mit Längengrenze. */
function requiredText(label: string, max = 200) {
  return z.string().trim().min(1, `Bitte ${label} angeben.`).max(max, 'Zu lang.')
}

/** Ein optionaler Text: leer ⇒ `undefined` (und damit in der Datenbank `null`). */
function optionalText(max = 2000) {
  return z
    .string()
    .trim()
    .max(max, 'Zu lang.')
    .transform((v) => (v === '' ? undefined : v))
}

/**
 * Eine optionale Zahl. Leer ⇒ `undefined`; das Komma wird als Dezimaltrennzeichen akzeptiert.
 *
 * ⚠ Das Komma ist hier keine Bequemlichkeit, sondern der Regelfall: Datenblätter und Angebote sind
 * deutschsprachig, und „0,9" in ein Feld zu tippen, das still `NaN` daraus macht, wäre die
 * gefährlichste Art, einen Wirkungsgrad zu verlieren.
 */
/**
 * Eine optionale Kennung aus einem Auswahlfeld. Leer ⇒ `undefined` (= keine Zuordnung).
 *
 * Geprüft wird die FORM, nicht die Existenz: ob es den Baustein gibt und ob er die passende Art
 * hat, weiss nur die Datenbank (Fremdschlüssel und Trigger `battery_catalog_guard_components`).
 * Eine Prüfung hier wäre ein zweiter, langsamer Wahrheitsanspruch mit einem Zeitfenster dazwischen.
 */
function optionalUuid(label: string) {
  return z
    .string()
    .trim()
    .transform((v) => (v === '' ? undefined : v))
    .refine(
      (v) => v === undefined || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
      `${label} wurde nicht richtig übergeben. Bitte die Seite neu laden.`,
    )
}

function optionalNumber(label: string, opts: { min?: number; max?: number; gt?: number } = {}) {
  return z
    .string()
    .trim()
    .transform((v) => (v === '' ? undefined : Number(v.replace(',', '.'))))
    .superRefine((v, ctx) => {
      if (v === undefined) return
      if (!Number.isFinite(v)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Bitte ${label} als Zahl angeben.` })
        return
      }
      if (opts.gt !== undefined && v <= opts.gt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} muss grösser als ${opts.gt} sein.`,
        })
      }
      if (opts.min !== undefined && v < opts.min) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} kann nicht negativ sein.` })
      }
      if (opts.max !== undefined && v > opts.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} kann höchstens ${opts.max} sein.`,
        })
      }
    })
}

/**
 * Ein Ja/Nein-Feld mit DREI Zuständen: ja, nein und „noch nicht bekannt".
 *
 * ⚠ Der dritte ist der wichtige. Ein Formular, das nur ja/nein anbietet, müsste sich für einen
 * Vorgabewert entscheiden — und „Wechselrichter enthalten: nein" ist keine harmlose Voreinstellung,
 * sondern eine Behauptung, die einen Aufpreis zur Pflicht macht. Unbekannt bleibt unbekannt, und
 * die Zeile ist so lange nicht aktivierbar.
 */
const optionalBoolean = z
  .string()
  .trim()
  .transform((v) => (v === '' ? undefined : v === 'true'))

/** Eine optionale ganze Zahl > 0 (die Grosshändler-Kennung). */
const optionalPositiveInt = z
  .string()
  .trim()
  .transform((v) => (v === '' ? undefined : Number(v)))
  .superRefine((v, ctx) => {
    if (v === undefined) return
    if (!Number.isInteger(v) || v <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Bitte eine ganze Zahl grösser als 0 angeben.',
      })
    }
  })

const optionalDate = z
  .string()
  .trim()
  .transform((v) => (v === '' ? undefined : v))
  .superRefine((v, ctx) => {
    if (v === undefined) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Bitte ein Datum angeben (JJJJ-MM-TT).',
      })
    }
  })

export const batteryCatalogSchema = z.object({
  kategorie: z.enum(BATTERY_KATEGORIEN, {
    errorMap: () => ({ message: 'Bitte angeben, ob es ein Heim- oder ein Gewerbespeicher ist.' }),
  }),
  hersteller: requiredText('den Hersteller'),
  bezeichnung: requiredText('die Bezeichnung'),
  memodoId: optionalPositiveInt,
  usableCapacityKwh: optionalNumber('Die nutzbare Kapazität', { gt: 0 }),
  maxPowerKw: optionalNumber('Die maximale Leistung', { gt: 0 }),
  /*
   * Round-Trip (Laden UND Entladen zusammen), als Anteil zwischen 0 und 1 — genau die Form, in der
   * `BatteryCandidate.roundTripEfficiency` steht. Eine Prozenteingabe (90 statt 0,9) wäre ein
   * zweites Format für dieselbe Zahl, und die Verwechslung fiele erst an einer um Faktor 100
   * falschen Simulation auf.
   */
  roundTripEfficiency: optionalNumber('Der Wirkungsgrad', { gt: 0, max: 1 }),
  /*
   * K2c: woher der Wert stammt. Geprüft wird hier nur die Form — dass eine Herkunft ohne Wert
   * sinnlos ist, entscheidet die Datenbank (CHECK + benannte Wrapper-Antwort), damit die Regel
   * auch für einen zweiten Schreibweg gilt.
   */
  rteSource: z
    .string()
    .trim()
    .transform((v) => (v === '' ? undefined : v))
    .refine(
      (v) => v === undefined || (BATTERY_RTE_SOURCES as readonly string[]).includes(v),
      'Bitte Datenblatt oder Annahme wählen.',
    ),
  listPriceNet: optionalNumber('Der Listenpreis', { gt: 0 }),
  inverterIncluded: optionalBoolean,
  extraInverterCostNet: optionalNumber('Der Aufpreis für den Wechselrichter', { min: 0 }),
  requiresFoundation: optionalBoolean,
  /*
   * K1b: statt zweier Beträge je Gerät nun die Verweise auf einen Kostenbaustein. Der Preis steht
   * dort EINMAL — dieselbe Bodenplatte trägt neun Aussenschränke, und neun Mal derselbe Betrag
   * wären neun Stellen, an denen er auseinanderlaufen kann. Geprüft wird hier nur die Form; ob der
   * Baustein die passende Art hat, entscheidet der Trigger in der Datenbank.
   */
  foundationComponentId: optionalUuid('Der Fundament-Baustein'),
  installationComponentId: optionalUuid('Der Installations-Baustein'),
  priceAsOf: optionalDate,
  sourceUrl: optionalText(),
  datasheetUrl: optionalText(),
  controlType: z
    .string()
    .trim()
    .transform((v) => (v === '' ? undefined : v))
    .refine(
      (v) => v === undefined || (BATTERY_CONTROL_TYPES as readonly string[]).includes(v),
      'Bitte statisch oder dynamisch wählen.',
    ),
  notes: optionalText(4000),
})

export type BatteryCatalogInput = z.infer<typeof batteryCatalogSchema>

/** Die Feldnamen des Formulars — eine Liste, damit Action und Formular nicht auseinanderlaufen. */
export const BATTERY_FORM_FIELDS = [
  'kategorie',
  'hersteller',
  'bezeichnung',
  'memodoId',
  'usableCapacityKwh',
  'maxPowerKw',
  'roundTripEfficiency',
  'rteSource',
  'listPriceNet',
  'inverterIncluded',
  'extraInverterCostNet',
  'requiresFoundation',
  'foundationComponentId',
  'installationComponentId',
  'priceAsOf',
  'sourceUrl',
  'datasheetUrl',
  'controlType',
  'notes',
] as const

/**
 * Rohwerte aus dem abgeschickten Formular — noch UNGEPRÜFT, aber bereits in der Form, die
 * `batteryCatalogSchema` erwartet. Reine Funktion über `FormData` (eine Web-Api): sie lässt sich
 * ohne Server, ohne Sitzung und ohne Datenbank prüfen.
 */
export function readBatteryCatalogForm(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const name of BATTERY_FORM_FIELDS) out[name] = String(formData.get(name) ?? '').trim()
  return out
}

// ── Einkaufspreis ────────────────────────────────────────────────────────────────────────────────

/**
 * Der Einkaufspreis ist ein EIGENES Formular mit eigener Prüfung, weil er in einer anderen Tabelle
 * und einem anderen Schema liegt (`platform.battery_purchase_prices`) und über einen eigenen
 * Wrapper läuft.
 *
 * ⚠ Der Stichtag ist Pflicht, SOBALD ein Preis dasteht — ein Einkaufspreis ohne Datum ist in einem
 * Jahr nicht mehr beurteilbar. Ein leerer Preis dagegen ist die Anweisung zu LÖSCHEN, und dafür
 * braucht es kein Datum. Dieselbe Regel steht im Wrapper.
 */
export const batteryPurchasePriceSchema = z
  .object({
    purchasePriceNet: optionalNumber('Der Einkaufspreis', { gt: 0 }),
    purchasePriceAsOf: optionalDate,
  })
  .superRefine((v, ctx) => {
    if (v.purchasePriceNet !== undefined && v.purchasePriceAsOf === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['purchasePriceAsOf'],
        message: 'Bitte angeben, wann dieser Einkaufspreis galt.',
      })
    }
  })

export function readBatteryPurchasePriceForm(formData: FormData): Record<string, unknown> {
  return {
    purchasePriceNet: String(formData.get('purchasePriceNet') ?? '').trim(),
    purchasePriceAsOf: String(formData.get('purchasePriceAsOf') ?? '').trim(),
  }
}
