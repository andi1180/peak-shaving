import {
  DEFAULT_DRAFT_BILLING_MODEL,
  tariffParamsSchema,
  type BillingModel,
  type TariffParams,
} from 'shared'

/**
 * Die vier Entwurfs-Schlüssel des selbst gefundenen VERGLEICHSTARIFS (Tarif-Station,
 * `apps/web/lib/admin/tariff-draft.ts`) — D7-Revision Weg 2.
 *
 * ⚠ ALLE VIER ODER KEINER. Die Leseseite der Station gibt schon heute `null` zurück, sobald eines
 * fehlt; hier gilt dasselbe, weil ein Vergleich ohne Preis oder ohne Preisbasis keiner ist. Ein
 * halber Tarif wird still verworfen statt ergänzt — geraten wird in dieser Datei nichts.
 */
const COMPARISON_DRAFT_KEYS = {
  supplier: 'tariffComparisonProviderName',
  energyPriceCtPerKwh: 'tariffComparisonEnergyPriceCtPerKwh',
  baseFeeEurPerMonth: 'tariffComparisonBaseFeeEurPerMonth',
  priceBasis: 'tariffComparisonPriceBasis',
} as const

/**
 * D3, Baustein 1 — DER WIZARD-ENTWURF WIRD ZU `TariffParams`.
 *
 * ── WARUM DIESE ABBILDUNG ÜBERHAUPT NÖTIG IST ─────────────────────────────────────────────────
 * Der Entwurf eines Zählpunkts (`platform.metering_points.draft`) ist ein `jsonb`-Objekt: er darf
 * unterwegs unvollständig, untypisiert und widersprüchlich sein. Der Rechenkern darf das nicht.
 * Diese Funktion ist die Grenze zwischen beidem — und sie ist REIN: kein I/O, kein Nachschlagen,
 * keine Datenschicht. Gleiche Eingabe, gleiche Ausgabe (Prinzip „Konfiguration an den Rändern,
 * Determinismus im Kern", abgesichert durch `./no-catalog-dependency.test.ts`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ SIE RÄT NICHT. EIN UNVOLLSTÄNDIGER ENTWURF WIRFT.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Vier der fünf Pflichtfelder kommen aus der Netzrechnung des Kunden (Prinzip 1). Fehlt eines,
 * gibt es keinen vertretbaren Ersatzwert: ein Leistungspreis von 0 machte die Spitzenkappung
 * wertlos, eine erfundene Mindestleistung erfände Kosten UND Ersparnis. Der Abbruch ist deshalb
 * das Ergebnis, nicht der Fehlerfall — geprüft wird gegen `tariffParamsSchema` selbst, damit hier
 * keine zweite, abweichende Auslegung desselben Contracts entsteht.
 *
 * ⚠ EINE einzige Ausnahme steht unten im Rumpf: „ohne Leistungsmessung" LEITET einen Leistungspreis
 * von 0 ab. Das ist kein Ersatzwert, sondern die Rechenfolge der Variante selbst — Begründung dort.
 *
 * ── ⚠ WAS NICHT MITKOMMT, UND WARUM ES KEIN PLATZHALTER WIRD ──────────────────────────────────
 * `timeOfUseWindows`, `dynamicPriceProfile` und `benutzungsdauerModel` sind im Contract OPTIONAL
 * und werden vom Wizard heute von keiner Station erhoben. Sie bleiben deshalb WEG statt auf einen
 * „nicht verwendet"-Wert gesetzt zu werden: ein leeres `timeOfUseWindows: []` wäre die Aussage
 * „dieser Kunde hat nachweislich keine Zeitfenster" und damit eine Erhebung, die nie stattfand.
 * `undefined` heisst „keine Angabe" — das ist der Zustand, der zutrifft.
 *
 * ⚠ DER NETZBETREIBER IST DAFÜR DER GEGENFALL: er steht seit D3 im Entwurf
 * (`NETZBETREIBER_DRAFT_KEY`), aber `TariffParams` hat für ihn KEIN Feld — die Herkunftsangaben
 * (`tariffSource`) sind im Delta ausdrücklich als offene Entscheidung geführt. Er wird hier
 * deshalb weder abgebildet noch heimlich in `netzebene` gequetscht; der Weg in den Report ist ein
 * eigener Schritt.
 */

/**
 * Das Abrechnungsmodell, wenn WEDER der Entwurf noch der Aufrufer eines trägt.
 *
 * ⚠ REVISION 22.09.2026 — ZWEI ÄNDERUNGEN AN EINER ZEILE, DIE HIER EINMAL DER GANZE MECHANISMUS WAR.
 *   1. Der Wert WOHNT JETZT IN `shared` (`tariff.ts`) und wird hier nur weitergereicht — die
 *      Rechnung-Station braucht denselben Vorgabewert als Vorbelegung, und `apps/web` darf
 *      `engine` nicht kennen. Begründung in voller Länge dort.
 *   2. Er ist das LETZTE GLIED, nicht das einzige. Bis hierher schrieb keine Station das Feld, und
 *      dieser Wert entschied deshalb IMMER. Die Reihenfolge ist jetzt
 *      Aufrufer-Override → Entwurf (`billingModel`) → dieser Wert.
 */
export { DEFAULT_DRAFT_BILLING_MODEL }

/** Der Vermerk der Rechnung-Station „ohne Rechnungsdaten fortgefahren" (`INVOICE_SKIPPED_KEY`). */
const INVOICE_SKIPPED_DRAFT_KEY = 'invoiceSkipped'

/**
 * Die Entwurfs-Schlüssel, die namensgleich in den Contract gehen.
 *
 * ⚠ NEUN, UND SIE WERDEN EINZELN AUFGEZÄHLT statt den ganzen Entwurf durchzureichen. zod entfernt
 * unbekannte Schlüssel stillschweigend — der Entwurf würde also auch als Ganzes „passen", und
 * jeder Seiteneintrag (`_provenance`, `_invoiceExtractions`, die PV-Felder) liefe unbemerkt mit
 * hinein. Eine benannte Liste macht aus dem, was in die Rechnung eingeht, eine Entscheidung.
 */
const DRAFT_TARIFF_KEYS = [
  'supplierTariff',
  'netzebene',
  'meteringVariant',
  'leistungspreisEurPerKwYear',
  'minBillableKw',
  'arbeitspreisNetzCtPerKwh',
  'energyPriceCtPerKwh',
  'energyPriceNightCtPerKwh',
  'einspeiseverguetungCtPerKwh',
  'supplierBaseFeeEurPerMonth',
] as const

export type DraftTariffMappingOptions = {
  /**
   * Überschreibt das Abrechnungsmodell für DIESEN Lauf.
   *
   * ⚠ Ein Parameter und ausdrücklich KEINE Oberfläche: wer ihn setzt, entscheidet damit über die
   * Kernzahl der ganzen Analyse — und überstimmt seit dem 22.09.2026 auch die AUSDRÜCKLICHE Wahl
   * des Admins im Entwurf. Er bleibt für Probeläufe und Gegenrechnungen da; im Wizard-Pfad wird er
   * nicht gesetzt.
   */
  billingModelOverride?: BillingModel
}

/**
 * Bildet den Tarif-Teil eines Zählpunkt-Entwurfs auf `TariffParams` ab.
 *
 * @throws wenn der Entwurf ein Pflichtfeld nicht trägt oder einen Wert führt, den der Contract
 *         nicht annimmt. Die Meldung nennt jedes betroffene Feld — der Admin soll wissen, welche
 *         Station er nachzutragen hat.
 */
export function mapDraftToTariffParams(
  draft: Record<string, unknown>,
  options: DraftTariffMappingOptions = {},
): TariffParams {
  /*
   * ⚠ DREI STUFEN, UND DER ENTWURF STEHT IN DER MITTE. Ein ungültiger Wert im `jsonb` fällt dabei
   * NICHT still auf den Vorgabewert zurück — er läuft in `tariffParamsSchema` und wird dort mit
   * benanntem Feld abgewiesen. Ein Entwurfswert, den der Contract nicht kennt, ist ein Fehler und
   * keine Abwesenheit; still ersetzt sähe die Rechnung aus, als hätte jemand das Modell gewählt.
   */
  const draftBillingModel = draft.billingModel
  const candidate: Record<string, unknown> = {
    billingModel:
      options.billingModelOverride ??
      (draftBillingModel === undefined || draftBillingModel === null
        ? DEFAULT_DRAFT_BILLING_MODEL
        : draftBillingModel),
  }

  for (const key of DRAFT_TARIFF_KEYS) {
    const value = draft[key]
    // `null` ist im Entwurf kein Wert, sondern die Abwesenheit eines Werts (so schreibt ihn kein
    // Weg; so kommt er aus einem von Hand veränderten `jsonb`). Durchgereicht schlüge er an jedem
    // optionalen Feld als Typfehler auf — gemeint ist „keine Angabe".
    if (value === undefined || value === null) continue
    candidate[key] = value
  }

  /*
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ⚠ DIE EINZIGE ABLEITUNG DIESER FUNKTION — UND SIE FÜLLT NUR EINE LÜCKE
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * „Ohne Leistungsmessung" heisst: der Netzbetreiber rechnet gar keinen Leistungspreis ab (Delta 3
   * der Tarifoptimierung). Die 0 ist hier deshalb kein Ersatzwert für eine fehlende Angabe, sondern
   * die Angabe selbst — die Rechnung des Kunden weist die Zeile nicht aus, weil es sie nicht gibt.
   * Ohne sie bräche die Abbildung an einem Pflichtfeld ab, das für diesen Anschluss nie erhoben
   * werden kann.
   *
   * ⚠ NUR WENN DER WERT FEHLT. Steht er im Entwurf, bleibt er unangetastet — auch ein
   * widersprüchlicher. Ihn auf 0 zu korrigieren hiesse, eine erhobene Zahl still zu überschreiben;
   * der Widerspruch gehört benannt (Energieberater/Rückfrage), nicht weggerechnet.
   */
  if (
    candidate.meteringVariant === 'ohne_leistungsmessung' &&
    !('leistungspreisEurPerKwYear' in candidate)
  ) {
    candidate.leistungspreisEurPerKwYear = 0
  }
  // Ohne Leistungspreis gibt es keinen Sockel, auf den eine Mindestleistung wirken könnte.
  if (candidate.leistungspreisEurPerKwYear === 0 && !('minBillableKw' in candidate)) {
    candidate.minBillableKw = 0
  }

  /*
   * „Ohne Rechnung fortfahren" (`invoiceSkipped`, Rechnung-Station) IST die Aussage „eigener
   * Liefertarif unbekannt" — eine ausdrückliche Angabe, nicht aus leeren Feldern geschlossen. Jeder
   * Schreibweg mit echten Tarifwerten setzt den Vermerk zurück (`INVOICE_SKIPPED_KEY`, apps/web).
   */
  if (draft[INVOICE_SKIPPED_DRAFT_KEY] === true) candidate.supplierTariff = 'unknown'

  /*
   * Weg 2 — der Vergleichstarif reist als GANZES Objekt in den Contract, nicht als vier
   * Einzelfelder: so kann es ihn nur vollständig geben, und `comparisonSupplierTariffSchema`
   * prüft ihn in einem Stück.
   */
  const supplier = draft[COMPARISON_DRAFT_KEYS.supplier]
  const energyPrice = draft[COMPARISON_DRAFT_KEYS.energyPriceCtPerKwh]
  const baseFee = draft[COMPARISON_DRAFT_KEYS.baseFeeEurPerMonth]
  const priceBasis = draft[COMPARISON_DRAFT_KEYS.priceBasis]
  if (
    typeof supplier === 'string' &&
    typeof energyPrice === 'number' &&
    typeof baseFee === 'number' &&
    typeof priceBasis === 'string'
  ) {
    candidate.comparisonSupplier = {
      supplier,
      energyPriceCtPerKwh: energyPrice,
      baseFeeEurPerMonth: baseFee,
      priceBasis,
    }
  }

  const parsed = tariffParamsSchema.safeParse(candidate)
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(Wurzel)'}: ${issue.message}`)
      .join(' · ')
    throw new Error(
      `Der Entwurf ergibt keine gültigen Tarifparameter — ${problems}. ` +
        'Die fehlenden Angaben stammen aus der Netzrechnung und werden in der Rechnung-Station ' +
        'erfasst; geraten wird hier nichts. Gibt es keine Stromrechnung, dort „Ohne Rechnung ' +
        'fortfahren" wählen — dann wird mit unbekanntem Liefertarif gerechnet.',
    )
  }

  return parsed.data
}
