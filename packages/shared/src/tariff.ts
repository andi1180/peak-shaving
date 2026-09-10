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

/** Tarifparameter aus der Netzrechnung — „Die Rechnung ist die Wahrheit" (§3.1). */
export const tariffParamsSchema = z.object({
  leistungspreisEurPerKwYear: z.number().nonnegative(),
  billingModel: billingModelSchema,
  minBillableKw: z.number().nonnegative(), // Mindestleistung (Sockel, nie unterschreitbar)
  arbeitspreisNetzCtPerKwh: z.number().nonnegative().optional(),
  energyPriceCtPerKwh: z.number().nonnegative(), // Bezugs-Arbeitspreis (Eigenverbrauchswert)
  energyPriceNightCtPerKwh: z.number().nonnegative().optional(), // Nacht-/Niedertarif
  timeOfUseWindows: z.array(timeOfUseWindowSchema).optional(),
  dynamicPriceProfile: z.unknown().optional(), // [v2] Spot-/dynamische Preise (Arbitrage)
  einspeiseverguetungCtPerKwh: z.number().nonnegative(),
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
export type TariffParams = z.infer<typeof tariffParamsSchema>
