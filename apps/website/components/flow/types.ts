import type { DataQuality } from 'engine'
import type {
  BatteryCandidate,
  FinancialParams,
  InvoiceExtraction,
  LoadProfile,
  PvProfile,
  TariffParams,
  TariffPricingInputs,
  TariffSelection,
} from 'shared'
import type { BatteryOverride } from '@/lib/analysis-protocol'

// Vom Tarif-Schritt nach oben gereichtes Ergebnis. `pv` ist optional (§3.1/§5 Schritt 2) — liegt es
// vor, trägt es die Brutto-PV in Engine/Trace (echter 4. Strom + Konsistenzprüfung).
export type TariffResult = {
  tariff: TariffParams
  financial?: FinancialParams
  pv: ParsedPv | null
  /**
   * B11: welcher Tarifsatz-Stand die Werte vorbelegt hat, samt der Vorgabewerte von damals.
   * `undefined`, wenn kein Netzbetreiber gewählt wurde — dann kommen die Werte direkt aus der
   * Netzrechnung, und genau das soll später unterscheidbar bleiben.
   *
   * Reist NICHT in die Engine (sie kennt die Datenschicht nicht, TEIL 2), sondern in den Report und
   * in das Analyse-Bündel.
   */
  tariffSelection?: TariffSelection
  // Eine PV-Datei wurde hochgeladen, konnte aber NICHT gelesen werden (parsePvProfile → error/
  // needs_mapping) → `pv` bleibt null. Die Meldung wandert in den Report (dataQuality), damit der
  // Upload nicht still verpufft (§3.1). Nur gesetzt, wenn tatsächlich eine Datei abgelehnt wurde.
  pvError?: string
  /**
   * B21-3b (Delta 4): die beiden Preisseiten für den kombinierten Intervallpreis — Netzbetreiber-
   * Tarifzeilen und Marktpreis-Reihe, geholt für den Zeitraum des Lastgangs (Delta 15 Regel A).
   *
   * `undefined` heisst: der Tarifoptimierungs-Hebel wurde NICHT angefordert. Dann gibt es keinen
   * Netzwerkaufruf und die Engine rechnet unverändert wie vor B21 — das ist kein Fehlerfall.
   * Ist es gesetzt, wurde angefordert; ein `null` DARIN heisst „angefordert, aber nicht lesbar" und
   * führt zur ausdrücklichen Kennzeichnung „nicht berechenbar" statt zu einem stillen Rückfall.
   */
  tariffPricing?: TariffPricingInputs
  /**
   * Delta 17 Teil 2: der vom Nutzer BESTÄTIGTE Speicher, den er bereits besitzt.
   *
   * `undefined` heisst „keine Angabe oder nicht übernommen" — dann verhält sich der Rechner Zeile
   * für Zeile wie vorher: voller Katalog, Empfehlung, Investition, Amortisation.
   */
  existingBattery?: ExistingBatteryInput
}

/**
 * Der bereits installierte Speicher des Kunden, mit seinen EXAKTEN Werten.
 *
 * ── ⚠ SEIT DEM 01.09.2026 KEIN `BatteryOverride` MEHR ─────────────────────────────────────────
 * Bis dahin war dies ein Alias von `BatteryOverride`: die Angabe wurde auf den nächstliegenden
 * KATALOG-Kandidaten abgebildet und nur Wirkungsgrad und Preis übernommen. Wer 19,2 kWh besass,
 * bekam die Ersparnis von 15 kWh zu sehen. Jetzt reist ein fertiger, aus seinen Angaben gebauter
 * Kandidat mit (`buildExistingBatteryCandidate`), der ausserhalb von `perBattery` simuliert wird.
 *
 * ⚠ Er darf NIE in `calculateRoi` gelangen: seine Investitionsfelder sind Platzhalter (die
 * Anschaffung ist bezahlt), s. Kopf von `battery-combination.ts`.
 *
 * ── WARUM DAS DEN VERLUST-DEFEKT VON DELTA 17 TEIL 2 STRUKTURELL BEENDET ───────────────────────
 * Der bestätigte Speicher war als `batteryPreset` ein Override und musste bei jeder
 * Neuberechnung eigens gegen einen ausdrücklichen Override aufgelöst werden — vergass ein
 * Aufrufer das, verschwand die Angabe des Kunden lautlos (gemessener Defekt, 01.09.2026). Als
 * Feld des `CalculatorPayload` reist er jetzt bei JEDER Nachricht unverändert mit: beide
 * Worker-Handler bekommen den vollen Payload, es gibt nichts mehr aufzulösen.
 */
export type ExistingBatteryInput = {
  /** Der simulierbare Kandidat — Kapazität, Leistung und Wirkungsgrad wie angegeben. */
  battery: BatteryCandidate
  /**
   * `true` = der Freitext nannte KEINEN Wirkungsgrad, es gilt die dokumentierte Annahme
   * (`ASSUMED_EXISTING_ROUND_TRIP_EFFICIENCY`). Reist mit, damit der Report die einzige Zahl des
   * Bestandsblocks, die nicht vom Kunden stammt, als solche ausweisen kann — und nicht als seine.
   */
  efficiencyAssumed: boolean
}

// Ergebnis von Schritt 1 (parseLoadProfile, §3.2/§3.3) — die echte, getypte Nutzlast.
export type ParsedLoad = {
  fileName: string
  profile: LoadProfile
  dataQuality: DataQuality
  /**
   * B14-2: die ROHEN Bytes der hochgeladenen Datei — genau die, die geparst wurden, nicht eine
   * daraus abgeleitete Fassung. Sie werden nirgends verschickt (Prinzip 4) und dienen allein der
   * Prüfsumme des Analyse-Bündels: sie ist das Einzige, was Bündel und Ursprungsdatei beim
   * Archivieren aneinanderbindet.
   *
   * Optional, damit der Fall „liegt nicht mehr vor" ein echter Zustand ist und nicht ein
   * unmöglicher: ohne Bytes wird KEIN Bündel erzeugt (`buildAnalysisBundle` wirft).
   */
  sourceBytes?: Uint8Array
}

/**
 * Delta 8 / 9b-2b — was ein Rechnungs-Scan aus Schritt 1 in Schritt 2 mitnimmt.
 *
 * ── ⚠ `annualConsumptionKwh` FEHLT HIER, UND ZWAR ABSICHTLICH ──────────────────────────────────
 * Der Jahresverbrauch wird bereits in Schritt 1 verbraucht: er ist der Eingang in
 * `generateStandardLoadProfile` (9b-1) und wird dort zum `LoadProfile`. Reiste er zusätzlich nach
 * Schritt 2 mit, gäbe es ihn zweimal — und der zweite Weg wäre genau der „dritte Rechenweg", den
 * Delta 8 ausschliesst. Der `Pick` sagt das im Typ, statt es einem Kommentar zu überlassen.
 *
 * ── ⚠ EIN GELESENES FELD HAT HEUTE KEIN ZIEL: `rates.arbeitspreisNetzCtPerKwh` ────────────────
 * Der Netznutzungs-Arbeitspreis hat in Schritt 2 kein Eingabefeld — er kommt seit B21-3b aus
 * `public.grid_tariffs`, nicht aus dem Formular. Er wird deshalb gelesen und NICHT gesetzt. Das
 * ist keine Lücke dieses Schritts, sondern die Folge davon, dass die Netzentgelt-Seite eine
 * gepflegte Datenquelle ist und keine Nutzereingabe. Wer dafür je ein Feld baut, findet den Wert
 * hier bereits vor.
 *
 * ── DIE GRUNDGEBÜHR DES LIEFERANTEN REIST OHNE EIGENEN EINTRAG MIT ────────────────────────────
 * `rates.supplierBaseFeeEurPerMonth` (Delta 19 / §3.7.3) ist Teil von `rates` und damit vom `Pick`
 * bereits erfasst — es war hier keine Zeile zu ergänzen. Das ist der Grund, warum das Feld in
 * `InvoiceScanRates` steht und nicht als siebtes Feld neben `rates`: Schema, Auswertung, die
 * Vollständigkeitsprüfung (`invoiceExtractionIsEmpty`) und dieser Weg hierher laufen alle über
 * `INVOICE_SCAN_RATE_KEYS`. Ihr Ziel ist Schicht 3 in `buildInitialTariffState` (step-tariff.tsx).
 */
export type TariffPrefill = Pick<
  InvoiceExtraction,
  'netzbetreiber' | 'netzebene' | 'meteringVariant' | 'rates'
>

// Ergebnis der optionalen PV-Datei (parsePvProfile, §3.1) — Brutto-PV-Erzeugung.
export type ParsedPv = {
  fileName: string
  profile: PvProfile
  dataQuality: DataQuality
}

// Was der Worker/Engine bekommt. Seit Prompt 4 (abgeschlossen) berechnet der Worker das
// komplette `AnalysisResult` echt daraus — `current`/`peaks` (§3.4/§3.5) und
// `perBattery`/`recommendation` (§3.6-3.8, gegen den `DEMO_BATTERY_CATALOG`).
export type CalculatorPayload = TariffResult & {
  load: ParsedLoad
}

// Vom editierbaren Annahmen-Panel (§6.2) nach oben gereichte, vollständige Eingabe für eine
// Live-Neuberechnung — `tariff`/`financial` sind bereits mit den editierten Feldern gemergte
// Kopien der Originalwerte (nur `billingModel` bzw. Förderung/Steuer/Abschreibung editierbar,
// s. CLAUDE.md „NICHT: Entladetiefe"-Vermerk zur bewussten Auslassung).
export type RecomputeInput = {
  tariff: TariffParams
  financial?: FinancialParams
  horizonYears: number
  batteryOverride?: BatteryOverride
}
