import { z } from 'zod'

import { METERING_VARIANTS } from './tariff-pricing'

/**
 * Abrechnungsmodell (§3.5) — bestimmt, welcher kW-Wert abgerechnet wird.
 * Kein hartkodierter „Jahreshöchstwert"; die Strategie ist austauschbar.
 * Das TariffStrategy-*Interface* (Verhalten) gehört in die Engine, nicht hierher.
 */
export const billingModelSchema = z.enum([
  'annual_max', // ein Jahreshöchstwert bestimmt alles
  'monthly_max_average', // Mittelwert der 12 Monatshöchstwerte (AT-Default [ANNAHME])
  'monthly_max_sum', // Summe der 12 Monatshöchstwerte
])
export type BillingModel = z.infer<typeof billingModelSchema>

/** Die drei Modelle in fester Reihenfolge — für jede Auswahl, die sie zur Wahl stellt. */
export const BILLING_MODELS = billingModelSchema.options

/**
 * Das Modell, wenn niemand eines genannt hat.
 *
 * ── ⚠ WARUM ES SEIT DEM 22.09.2026 HIER LIEGT UND NICHT MEHR IN `packages/engine` ─────────────
 * Es stand als `DEFAULT_DRAFT_BILLING_MODEL` in `engine/src/tariff/draft-mapping.ts`, weil nur der
 * Rechenkern es brauchte. Seit die Rechnung-Station das Modell sichtbar zur Bestätigung vorlegt,
 * braucht sie denselben Wert als Vorbelegung — und `apps/web` darf `engine` nicht kennen
 * (gemessen: `apps/web/package.json` führt `shared` und `extractors`, kein `engine`). Dieselbe
 * Verlegung und dieselbe Begründung wie bei `findGridTariffRow` (grid-tariff-row.ts): ein Nachbau
 * in `apps/web` wären zwei Fassungen desselben Vorgabewerts, und das Auseinanderlaufen wäre STILL
 * — das Formular zeigte das eine Modell, gerechnet würde mit dem anderen.
 *
 * `engine` re-exportiert den Wert unverändert weiter; für den Rechenkern ändert sich keine Zeile.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ `monthly_max_sum` — UND AUSDRÜCKLICH NICHT `monthly_max_average`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Es ist der Standardfall der E-Control-SNE-V (Martin bestätigt, 16.09.2026): abgerechnet wird die
 * SUMME der zwölf Monatshöchstwerte. `monthly_max_average` war der hartkodierte Vorgabewert des
 * alten, abgeschalteten Rechners und ist oben als „AT-Default [ANNAHME]" vermerkt — eine Annahme,
 * die nie validiert wurde. Die beiden Modelle unterscheiden sich um den Faktor 12 im abgerechneten
 * kW-Wert; der falsche Vorgabewert ergäbe eine Ersparnis, die plausibel aussieht und es nicht ist.
 */
export const DEFAULT_DRAFT_BILLING_MODEL: BillingModel = 'monthly_max_sum'

/**
 * Womit gerechnet wird, wenn kein Leistungspreis anfällt (`billingModel: null`). Auf keinen Euro
 * wirksam (Leistungspreis 0); gewählt ist der Wert, den der öffentliche Rechner bis dahin in diesem
 * Fall schickte, damit kein angezeigter kW-Wert springt.
 */
export const NO_DEMAND_CHARGE_BILLING_MODEL: BillingModel = 'monthly_max_average'

export function effectiveBillingModel(billingModel: BillingModel | null): BillingModel {
  return billingModel ?? NO_DEMAND_CHARGE_BILLING_MODEL
}

/** Kurzname eines Modells. Eine Formulierung, ein Ort. */
export const BILLING_MODEL_LABELS: Record<BillingModel, string> = {
  annual_max: 'Jahreshöchstwert',
  monthly_max_average: 'Mittel der 12 Monatshöchstwerte',
  monthly_max_sum: 'Summe der 12 Monatshöchstwerte',
}

/**
 * Was die Wahl bedeutet, in einem Satz — die Auswahl ist ohne sie nicht zu treffen.
 *
 * Die drei Modelle unterscheiden sich um bis zum Faktor 12 im abgerechneten kW-Wert, und keiner
 * der Kurznamen sagt, welcher Wert in die Rechnung eingeht. Wer zwischen ihnen wählt, braucht
 * genau diesen Satz und nicht das Wort.
 */
export const BILLING_MODEL_HINTS: Record<BillingModel, string> = {
  annual_max: 'Ein einziger Höchstwert des Jahres bestimmt den Leistungspreis.',
  monthly_max_average:
    'Die zwölf Monatshöchstwerte werden gemittelt; abgerechnet wird dieser eine Mittelwert.',
  monthly_max_sum: 'Jeder Monat wird mit seinem eigenen Höchstwert abgerechnet, alle zwölf addiert.',
}

/**
 * Preisbasis einer Preisquelle (Delta 6 „Brutto/Netto") — Pflichtangabe an JEDER Quelle:
 * Netzbetreiber-Tarifzeile, Stromanbieter-Tarif, Spotpreis-Reihe.
 *
 * Der Grund ist ein realer Widerspruch zwischen den eigenen Quellen: Netzentgelte stehen im
 * Tarifblatt exklusive Steuern, aWATTar liefert netto, ein verglichener Endkundentarif dagegen
 * brutto. Ohne die Angabe AN DER QUELLE ist jeder Vergleich zweier Zahlen stillschweigend um 20 %
 * falsch — und zwar in einer Richtung, die niemandem auffällt, weil beide Zahlen plausibel aussehen.
 *
 * Gerechnet wird durchgängig NETTO. Die Umsatzsteuer kommt ausschliesslich ganz am Schluss für die
 * brutto-orientierte Ergebnisdarstellung von Privatkunden drauf, nie in der Zwischenrechnung.
 */
export const priceBasisSchema = z.enum(['net', 'gross'])
export type PriceBasis = z.infer<typeof priceBasisSchema>

/** Einfaches HT/NT-Fenster für tarifbewusstes Laden (§3.1, MVP). */
export const timeOfUseWindowSchema = z.object({
  from: z.string(), // "HH:mm"
  to: z.string(),
  ctPerKwh: z.number().nonnegative(),
})
export type TimeOfUseWindow = z.infer<typeof timeOfUseWindowSchema>

/**
 * PROVISORISCH — Benutzungsdauer-Effekt. §3.1 referenziert `BenutzungsdauerModel`,
 * definiert den Typ aber nie; §3.5 deutet nur an: übersteigt die Benutzungsdauer
 * eine Schwelle (z.B. 2500 h), gilt ggf. eine andere Preisspalte. Minimal typisiert,
 * damit das optionale Feld valide ist. Die exakte Umschaltlogik ist fachlich offen
 * und für M1 NICHT nötig — hier steht nur der Vertrags-Platzhalter.
 */
export const benutzungsdauerModelSchema = z.object({
  thresholdHours: z.number().positive(), // z.B. 2500 h
  alternativeLeistungspreisEurPerKwYear: z.number().nonnegative(),
  alternativeArbeitspreisCtPerKwh: z.number().nonnegative().optional(),
})
export type BenutzungsdauerModel = z.infer<typeof benutzungsdauerModelSchema>

/**
 * Der selbst gefundene VERGLEICHSTARIF eines anderen Lieferanten (D7-Revision, 21.09.2026) —
 * Weg 2 der fünf Wege.
 *
 * ── ⚠ ER IST KEIN OPTIMIERUNGSGEGENSTAND ──────────────────────────────────────────────────────
 * Ein Fixtarif hat keine Preisbewegung über den Tag; eine Batterie kann gegen ihn nicht steuern
 * (so begründet die Wizard-Station, die ihn erhebt). Er ist ein von der Batterie UNABHÄNGIGER
 * Hebel, den der Report NENNT — gerechnet wird mit ihm genau eine Reihe: dieselben Netz-, Mess-
 * und Abgabenposten wie im Ist-Tarif, nur der Energiepreis und die Lieferanten-Grundgebühr sind
 * andere.
 *
 * ⚠ `priceBasis` IST PFLICHT UND WIRD NICHT UMGERECHNET. Ein brutto eingetragener Tarif führt zum
 * AUSFALL dieses einen Wegs, nicht zu einer Division durch einen geratenen Steuersatz — dieselbe
 * Haltung wie bei Netzentgelt-Zeilen und Börsenpreisen (`tou.ts`, `kind: 'price_basis'`).
 */
export const comparisonSupplierTariffSchema = z.object({
  /** Wie der Lieferant heisst, so wie der Kunde ihn eingetragen hat. Steht im Report. */
  supplier: z.string().min(1),
  energyPriceCtPerKwh: z.number().nonnegative(),
  baseFeeEurPerMonth: z.number().nonnegative(),
  priceBasis: priceBasisSchema,
})
export type ComparisonSupplierTariff = z.infer<typeof comparisonSupplierTariffSchema>

/**
 * Ist der heutige Liefertarif des Kunden bekannt? — „Eigener Tarif unbekannt" (25.09.2026).
 *
 * `'unknown'` ist eine ANGABE (der Kunde hat keine Stromrechnung), kein fehlender Wert: dann gibt es
 * keinen Arbeitspreis und keine Lieferanten-Grundgebühr, „Ihr Tarif heute" entfällt, und die
 * Speicherbewertung läuft über die aWATTar-Preisreihe. Fehlt das Feld, gilt `'known'` — so lesen
 * sich alle Eingaben von vor dieser Unterscheidung unverändert.
 */
export const SUPPLIER_TARIFF_STATES = ['known', 'unknown'] as const
export const supplierTariffStateSchema = z.enum(SUPPLIER_TARIFF_STATES)
export type SupplierTariffState = z.infer<typeof supplierTariffStateSchema>

/** Tarifparameter aus der Netzrechnung — „Die Rechnung ist die Wahrheit" (§3.1). */
const tariffParamsObjectSchema = z.object({
  /** Bekannter oder unbekannter Liefertarif — s. `SUPPLIER_TARIFF_STATES`. `undefined` = `'known'`. */
  supplierTariff: supplierTariffStateSchema.optional(),
  /** D7-Revision — Weg 2. `undefined` heisst „der Kunde hat keinen angegeben"; dann entfällt der Weg. */
  comparisonSupplier: comparisonSupplierTariffSchema.optional(),
  leistungspreisEurPerKwYear: z.number().nonnegative(),
  /** `null` nur ohne Leistungspreis (`leistungspreisEurPerKwYear === 0`) — dann gibt es kein Modell. */
  billingModel: billingModelSchema.nullable(),
  minBillableKw: z.number().nonnegative(), // Mindestleistung (Sockel, nie unterschreitbar)
  arbeitspreisNetzCtPerKwh: z.number().nonnegative().optional(),
  /** Bezugs-Arbeitspreis — Pflicht bei `supplierTariff: 'known'`, verboten bei `'unknown'`. */
  energyPriceCtPerKwh: z.number().nonnegative().optional(),
  energyPriceNightCtPerKwh: z.number().nonnegative().optional(), // Nacht-/Niedertarif
  timeOfUseWindows: z.array(timeOfUseWindowSchema).optional(),
  dynamicPriceProfile: z.unknown().optional(), // [v2] Spot-/dynamische Preise (Arbitrage)
  /**
   * Nur Pflicht, wenn eingespeist wird (Einspeisung im Lastgang oder PV erfasst) — geprüft in der
   * Engine (`assertFeedInTariffPresent`), weil erst dort der Lastgang bekannt ist.
   */
  einspeiseverguetungCtPerKwh: z.number().nonnegative().optional(),
  /**
   * Monatliche Grundgebühr des heutigen Stromlieferanten (netto, €/Monat) — Delta 19.
   *
   * ── ⚠ SIE GEHT NICHT IN DIE BATTERIE-ERSPARNIS EIN, UND DAS IST KEIN VERSEHEN ─────────────────
   * Eine Grundgebühr ist verbrauchsUNABHÄNGIG: sie fällt mit und ohne Speicher in derselben Höhe
   * an und kürzt sich aus jeder Ersparnis-Differenz heraus. Sie in `totalSavingPerYear` einzurechnen
   * hiesse, eine Zahl zu verändern, an der sich nichts ändert. Ihr einziger Ort ist der
   * TARIFVERGLEICH (§3.7.2, Monatsvergleich Ist vs. aWATTar) — dort ist sie sehr wohl relevant, weil
   * der Kunde beim Wechsel die eine Gebühr gegen die andere tauscht.
   *
   * OPTIONAL mit der Bedeutung „keine Angabe" — dann wird mit 0 gerechnet. Das ist die
   * konservative Richtung: 0 lässt den HEUTIGEN Tarif billiger aussehen als er ist und den
   * aWATTar-Vorteil damit kleiner, nicht grösser.
   */
  supplierBaseFeeEurPerMonth: z.number().nonnegative().optional(),
  /**
   * Leistungsmessungs-Variante des Anschlusses (B24, Delta §3.4).
   *
   * ── ⚠ WARUM DAS FELD ERST JETZT ENTSTEHT ──────────────────────────────────────────────────────
   * Die Variante gab es im Rechner immer schon — aber nur als UI-Zustand in `step-tariff.tsx` und
   * als Abfrage-Dimension der Netzentgelt-Seite (`METERING_VARIANTS`, `tariff-pricing.ts`). In den
   * typisierten Eingabe-Contract war sie NIE gehoben; gemessen in
   * `KI-Interface_Kalkulator_Bestandsaufnahme.md`, Befund A, und im Delta §3.4 als Korrektur
   * festgehalten („wer den Betrieb-Contract entwirft, muss die Leistungsmessungs-Variante NEU ins
   * Contract heben, nicht nur eine bestehende UI-Option wiederverwenden").
   *
   * Warum das für den Chat den Unterschied macht: ein Formular kann eine Angabe im Bildschirmzustand
   * halten, weil der Bildschirm die ganze Zeit da ist. Ein Gespräch kann das nicht — was der Chat
   * erfährt, muss in den Entwurf, sonst ist es beim nächsten Turn weg. Für einen Betrieb ist die
   * Variante zudem die Weiche zwischen zwei verschiedenen Rechnungen: „ohne Leistungsmessung" heisst
   * Leistungspreis 0 und damit gar keine Spitzenkappung (Delta 3 der Tarifoptimierung).
   *
   * ── OPTIONAL, UND `undefined` HEISST „NICHT ANGEGEBEN" ────────────────────────────────────────
   * Nicht „ohne Leistungsmessung" — das ist eine ANGABE mit eigener Rechenfolge. Optional ausserdem,
   * weil es sie auf den Netzebenen 3–6 gar nicht gibt (`NETZEBENEN_MIT_MESSVARIANTE`, heute nur
   * NE 7) und weil ein vor B24 exportiertes Analyse-Bündel sie nicht trägt — dieselbe
   * „undefined heisst: gab es damals noch nicht"-Regel wie bei jedem anderen additiven Contract-Feld
   * dieses Repos.
   *
   * ── EINE QUELLE, KEINE ZWEITE LISTE ───────────────────────────────────────────────────────────
   * Die Werte kommen aus `METERING_VARIANTS` (`./tariff-pricing`) und werden hier NICHT ein zweites
   * Mal ausgeschrieben: die harte Grenze ist der CHECK der Datenbank (B21-1), und eine hier
   * abweichende Liste liesse einen Wert zu, den die Abfrage der Netzentgelt-Seite nie findet.
   * Der Import ist unkritisch: `tariff-pricing.ts` importiert von hier ausschliesslich `import type`
   * — der wird beim Übersetzen entfernt, zur Laufzeit gibt es also keinen Zirkel.
   */
  meteringVariant: z.enum(METERING_VARIANTS).optional(),
  netzebene: z.string().optional(), // Metadatum
  benutzungsdauerModel: benutzungsdauerModelSchema.optional(),
})

/** Die Felder, die allein am bekannten Liefertarif hängen. */
type SupplierTariffFields =
  | 'supplierTariff'
  | 'energyPriceCtPerKwh'
  | 'energyPriceNightCtPerKwh'
  | 'timeOfUseWindows'
  | 'supplierBaseFeeEurPerMonth'

const SUPPLIER_ONLY_FIELDS = [
  'energyPriceCtPerKwh',
  'energyPriceNightCtPerKwh',
  'timeOfUseWindows',
  'supplierBaseFeeEurPerMonth',
] as const

/**
 * Der Typ trennt die beiden Zustände, damit jeder Leser des Arbeitspreises an `supplierTariff`
 * verzweigen muss — ein `number | undefined` liesse ihn still als 0 oder NaN weiterrechnen.
 */
export type TariffParams = Omit<z.infer<typeof tariffParamsObjectSchema>, SupplierTariffFields> &
  (
    | {
        supplierTariff?: 'known'
        energyPriceCtPerKwh: number
        energyPriceNightCtPerKwh?: number
        timeOfUseWindows?: TimeOfUseWindow[]
        supplierBaseFeeEurPerMonth?: number
      }
    | {
        supplierTariff: 'unknown'
        energyPriceCtPerKwh?: undefined
        energyPriceNightCtPerKwh?: undefined
        timeOfUseWindows?: undefined
        supplierBaseFeeEurPerMonth?: undefined
      }
  )

/** Die bekannte Variante — für Wege, die ausschliesslich mit einem Arbeitspreis rechnen. */
export type KnownSupplierTariffParams = Extract<TariffParams, { energyPriceCtPerKwh: number }>

export const tariffParamsSchema = Object.assign(
  tariffParamsObjectSchema
    .superRefine((t, ctx) => {
      if (t.supplierTariff === 'unknown') {
        for (const key of SUPPLIER_ONLY_FIELDS) {
          if (t[key] !== undefined) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [key],
              message: 'Widerspricht „eigener Liefertarif unbekannt" (supplierTariff: unknown).',
            })
          }
        }
      } else if (t.energyPriceCtPerKwh === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['energyPriceCtPerKwh'], message: 'Required' })
      }
      if (t.billingModel === null && t.leistungspreisEurPerKwYear !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['billingModel'],
          message: 'Ohne Abrechnungsmodell nur bei Leistungspreis 0.',
        })
      }
    })
    .transform((t) => t as TariffParams),
  // `.shape` bleibt erreichbar: Feldlisten (Chat-Werkzeuge, Entwurfsprüfungen) lesen die Schlüssel.
  { shape: tariffParamsObjectSchema.shape },
)
