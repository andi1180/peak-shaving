import { tariffParamsSchema, type BillingModel, type TariffParams } from 'shared'

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
 * Das Abrechnungsmodell, wenn der Aufrufer keines vorgibt.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ `monthly_max_sum` — UND AUSDRÜCKLICH NICHT `monthly_max_average`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Es ist der Standardfall der E-Control-SNE-V (Martin bestätigt, 16.09.2026): abgerechnet wird die
 * SUMME der zwölf Monatshöchstwerte. `monthly_max_average` war der hartkodierte Vorgabewert des
 * alten, abgeschalteten Rechners und ist als „AT-Default [ANNAHME]" im Contract vermerkt — eine
 * Annahme, die hier nie validiert wurde. Die beiden Modelle unterscheiden sich um den Faktor 12 im
 * abgerechneten kW-Wert; der falsche Vorgabewert ergäbe eine Ersparnis, die plausibel aussieht und
 * es nicht ist. Das Feld ist im Contract PFLICHT und wird bis heute von keiner Wizard-Station
 * geschrieben (D3, zweites Hindernis) — dieser Wert ist die Antwort darauf.
 */
export const DEFAULT_DRAFT_BILLING_MODEL: BillingModel = 'monthly_max_sum'

/**
 * Die Entwurfs-Schlüssel, die namensgleich in den Contract gehen.
 *
 * ⚠ NEUN, UND SIE WERDEN EINZELN AUFGEZÄHLT statt den ganzen Entwurf durchzureichen. zod entfernt
 * unbekannte Schlüssel stillschweigend — der Entwurf würde also auch als Ganzes „passen", und
 * jeder Seiteneintrag (`_provenance`, `_invoiceExtractions`, die PV-Felder) liefe unbemerkt mit
 * hinein. Eine benannte Liste macht aus dem, was in die Rechnung eingeht, eine Entscheidung.
 */
const DRAFT_TARIFF_KEYS = [
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
   * Kernzahl der ganzen Analyse. Solange keine Station das Modell erhebt, gilt der Vorgabewert —
   * und wer davon abweicht, tut es sichtbar im Code des Aufrufers.
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
  const candidate: Record<string, unknown> = {
    billingModel: options.billingModelOverride ?? DEFAULT_DRAFT_BILLING_MODEL,
  }

  for (const key of DRAFT_TARIFF_KEYS) {
    const value = draft[key]
    // `null` ist im Entwurf kein Wert, sondern die Abwesenheit eines Werts (so schreibt ihn kein
    // Weg; so kommt er aus einem von Hand veränderten `jsonb`). Durchgereicht schlüge er an jedem
    // optionalen Feld als Typfehler auf — gemeint ist „keine Angabe".
    if (value === undefined || value === null) continue
    candidate[key] = value
  }

  const parsed = tariffParamsSchema.safeParse(candidate)
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(Wurzel)'}: ${issue.message}`)
      .join(' · ')
    throw new Error(
      `Der Entwurf ergibt keine gültigen Tarifparameter — ${problems}. ` +
        'Die fehlenden Angaben stammen aus der Netzrechnung und werden in der Rechnung-Station ' +
        'erfasst; geraten wird hier nichts.',
    )
  }

  return parsed.data
}
