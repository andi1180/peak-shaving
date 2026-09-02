/**
 * B14-2 — Das Analyse-Bündel: das EINE Austauschformat zwischen Rechner und Archiv.
 *
 * ── WARUM ES EIN BÜNDEL GIBT UND KEINEN „SPEICHERN"-KNOPF ───────────────────────────────────────
 * Der Kalkulator (`apps/website`) und der Admin-Bereich (`apps/web`) sind getrennte Anwendungen mit
 * getrennten Sitzungen. Ein Speichern aus dem Rechner heraus verlangte entweder eine Anmeldung in
 * der zweiten Anwendung (das ist B10) oder eine zweite Rechner-Oberfläche im Admin-Bereich. Beides
 * ist hier ausdrücklich nicht gebaut.
 *
 * Zudem ist die Archivierung einer betreuten Analyse eine BEWUSSTE HANDLUNG und soll kein
 * Nebeneffekt jedes Rechenlaufs sein: der öffentliche Rechner läuft täglich mit Probedaten, und ein
 * Archiv, das jeden dieser Läufe mitschreibt, wäre 2027 nicht mehr von den echten Auslegungen zu
 * trennen (genau die Unterscheidung, für die `analysis_kind` existiert).
 *
 * Der öffentliche Rechner behält damit unverändert seine Zusage: die Verbrauchsdaten verlassen den
 * Browser nicht. Das Bündel entsteht LOKAL und wird von einem Menschen weitergegeben.
 *
 * ── WARUM DIESE DATEI IN `shared` LIEGT ──────────────────────────────────────────────────────────
 * Beide Seiten importieren DIESELBE Definition. Eine zweite Beschreibung desselben Formats — etwa
 * ein zod-Schema im Admin-Bereich neben einem TS-Typ im Rechner — wäre genau die Drift, an der ein
 * Bündel erst beim Hochladen scheitert, also nachdem die Analyse gerechnet und der Kunde bedient
 * ist. `shared` ist isomorph und wird von beiden Apps bereits gebündelt.
 *
 * ── DIE PRÜFSUMME IST DER EINZIGE SCHUTZ GEGEN EINE FALSCH ARCHIVIERTE ANALYSE ──────────────────
 * Das Bündel enthält die Ursprungsdatei NICHT (sie wird getrennt hochgeladen). Was beide
 * aneinanderbindet, ist allein `sourceFileSha256` — gerechnet mit `sha256Hex` aus `archive.ts` über
 * die UNKOMPRIMIERTE Datei. Ohne diese Bindung liesse sich eine Analyse mit einem fremden Lastgang
 * archivieren, und der Fehler fiele frühestens 2027 auf, wenn niemand mehr rekonstruieren kann,
 * welche Datei die richtige gewesen wäre.
 *
 * Rein und ohne Seiteneffekte: kein Datei-I/O, kein Datenbankbezug, kein globaler Zustand.
 */
import { sha256Hex } from './archive'
import type { AnalysisResult } from './analysis-result'
import type { BatteryCandidate } from './battery'
import type { FinancialParams } from './financial'
import type { TariffParams } from './tariff'
import type { TariffOverridableField } from './tariff-catalog'

/**
 * Fassung des Bündelformats — die des NEU erzeugten Bündels.
 *
 * Der Upload lehnt eine UNBEKANNTE Fassung ab, statt zu raten. Ein Bündel aus einer neueren
 * Rechner-Fassung enthielte Felder, die dieser Admin-Stand nicht kennt; still zu übernehmen, was er
 * versteht, erzeugte eine eingefrorene Baseline, der genau die Angaben fehlen, wegen derer die
 * Fassung erhöht wurde.
 *
 * ── FASSUNG 2 (B11) ────────────────────────────────────────────────────────────────────────────
 * `inputs` trägt zusätzlich die Herkunft der Tarifsätze (`tariffSetId`, `tariffSetValidFrom`,
 * `tariffProfileKey`, `tariffOverriddenFields`). Die Ergänzung ist rein additiv; die Fassung steigt
 * trotzdem, weil sie beantwortet, WELCHE Angaben ein Leser erwarten darf: fehlt die Herkunft in
 * einem Bündel der Fassung 2, hat der Nutzer keinen Netzbetreiber gewählt — fehlt sie in Fassung 1,
 * konnte es sie gar nicht geben. Ohne die Fassungsnummer wären diese beiden Fälle 2027 nicht mehr
 * zu unterscheiden.
 *
 * ── FASSUNG 3 (Bestandsbatterie) ───────────────────────────────────────────────────────────────
 * `inputs.batteryOverride` trägt zusätzlich `source` — ob die geänderten Batteriewerte den BEREITS
 * VORHANDENEN Speicher des Kunden beschreiben oder eine durchgespielte Katalog-Variante. Dieselbe
 * Überlegung wie bei Fassung 2, nur an einer anderen Zahl: fehlt `source` in einem Bündel der
 * Fassung 3, hat niemand an der Batterie gedreht — fehlt es in Fassung 1 oder 2, konnte die
 * Unterscheidung gar nicht getroffen werden. Und sie ist nicht kosmetisch: bei `existing` weist der
 * Report weder Investition noch Amortisation aus (die Anschaffung ist bereits bezahlt), bei
 * `catalog_preset` beides. Wer 2028 eine archivierte Baseline liest, muss wissen, welche der beiden
 * Aussagen der Kunde damals gesehen hat.
 *
 * ── FASSUNG 4 (Jahres-Hochrechnung der Energie-Töpfe) ──────────────────────────────────────────
 * Die einzige der vier Fassungen, die die BEDEUTUNG eines bereits vorhandenen Feldes ändert — und
 * genau deshalb die wichtigste. `result.perBattery[].selfConsumptionSavingPerYear` und
 * `…loadShiftSavingPerYear` waren bei einem Lastgang unter einem Jahr die rohe Summe über die
 * vorhandenen Tage, trugen aber schon das Jahres-Etikett (s. `savings/annualization.ts`). Ab
 * Fassung 4 sind es echte Jahresgrössen, und die gemessenen Rohwerte stehen als eigene Felder
 * daneben (`…OverCoveredPeriod`, `annualizationFactor`, `coveredDays`).
 *
 * Wer 2028 eine Baseline der Fassung ≤ 3 mit einer der Fassung 4 vergleicht, muss das wissen: bei
 * voller Jahresabdeckung sind beide identisch, bei einem Teiljahres-Lastgang unterscheiden sie sich
 * um genau diesen Faktor — und der Unterschied ist keine bessere Rechnung an denselben Zahlen,
 * sondern eine Korrektur an einer Grösse, die vorher zwei verschiedene Dinge bedeuten konnte.
 *
 * ── FASSUNG 5 (Ladeverluste als Kosten + Grundgebühren im Tarifvergleich) ──────────────────────
 * Die zweite Fassung, die die BEDEUTUNG bestehender Felder ändert — und sie betrifft JEDEN Kunden,
 * nicht nur die mit Teiljahres-Lastgang.
 *
 * 1. `result.perBattery[].selfConsumptionSavingPerYear` und `…loadShiftSavingPerYear` (samt ihren
 *    `…OverCoveredPeriod`-Zwillingen und allem, was daraus folgt: `totalSavingPerYear`,
 *    `amortizationYears`, `netSavingOverHorizon`) bewerten die geladene Energie ab jetzt zum Preis
 *    der TATSÄCHLICH BEZOGENEN Menge — also inklusive Ladeverlust (§3.7, Delta 19). Bis Fassung 4
 *    war jede gespeicherte kWh bezahlt, als hätte sie keine Verluste verursacht; beide Töpfe waren
 *    dadurch systematisch zu hoch, und zwar umso stärker, je schlechter der Wirkungsgrad und je
 *    kleiner der Preisabstand zwischen Laden und Entladen. Wer 2028 eine Baseline der Fassung ≤ 4
 *    mit einer der Fassung 5 vergleicht, vergleicht an dieser Stelle zwei verschiedene
 *    Definitionen — nicht zwei Messungen.
 * 2. `result.tariffOptimization.monthlyComparison` trägt zusätzlich die anteiligen GRUNDGEBÜHREN
 *    (Netz-Jahrespauschale, Lieferant, aWATTar) — die Monatsbalken sind damit vollständige
 *    Monatskosten und nicht mehr nur Arbeitskosten. `inputs.tariff.supplierBaseFeeEurPerMonth` hält
 *    fest, welche Gebühr der Kunde damals angegeben hat (fehlt sie, wurde mit 0 gerechnet).
 *
 * ── FASSUNG 6 (B22: geschätzte PV-Erzeugung) ──────────────────────────────────────────────────
 * `inputs.pvSource` sagt, ob die PV-Komponente des gerechneten Lastgangs GEMESSEN oder GESCHÄTZT
 * war. Rein additiv wie die Fassungen 2 und 3 — und die Fassungsnummer steigt aus genau demselben
 * Grund: `undefined` bedeutet ab Fassung 6 „keine geschätzte PV, der Lastgang ist so gemessen
 * worden", in einer Baseline der Fassung ≤ 5 dagegen „die Unterscheidung gab es noch nicht".
 *
 * ⚠ Das ist keine Kosmetik. Bei geschätzter PV weist der Rechner GAR KEINE
 * Spitzenkappungs-Ersparnis aus (`peakShavingBlockers` → `estimated_pv`), und der
 * Eigenverbrauchs-Anteil beruht auf einem Zehn-Jahres-Mittel des EU-Dienstes PVGIS statt auf einer
 * Messung. Wer 2028 den Wirkungsnachweis gegen eine archivierte Baseline führt, misst sonst gegen
 * eine Zahl, deren Herkunft niemand mehr kennt — genau der Fall, den `analysis_kind` und
 * `engine_commit_sha` für andere Dimensionen bereits verhindern.
 *
 * ⚠ BENANNTE LÜCKE: die AUSLEGUNG (Standort, kWp, Neigung, Ausrichtung je Modulfläche) reist
 * NICHT mit. Das Bündel sagt damit, DASS geschätzt wurde, aber nicht, WOMIT. Das ist bewusst so
 * gebaut und nicht vergessen — es wäre ein eigenes Feld nach der B14-1-Regel „als Werte, nie als
 * Verweis", und es gehört in denselben Schritt, der die Auslegung auch im Report ausweist. Wer es
 * ergänzt, erhöht die Fassung erneut.
 *
 * ── FASSUNG 7 (§3.7.2: eine Preisbasis für beide Energie-Töpfe) ────────────────────────────────
 * `result.perBattery[].selfConsumptionSavingPerYear` (und der gemessene Zwilling
 * `…OverCoveredPeriod`) bedeutet ab hier etwas anderes: der Eigenverbrauch wird mit dem Preis des
 * ENTLADE-Intervalls bewertet und nicht mehr mit `inputs.tariff.energyPriceCtPerKwh`. Kein Feld
 * kommt hinzu, kein Feld fällt weg — genau deshalb braucht es die Fassungsnummer: eine Baseline
 * der Fassung ≤ 6 und eine der Fassung 7 sind an dieser Stelle ZWEI DEFINITIONEN und nicht zwei
 * Messungen, und man sähe es der Zahl nicht an.
 *
 * ⚠ Betroffen ist, wer EINSPEISUNG im Lastgang hat UND den Tarifoptimierungs-Hebel aktiviert hatte
 * — bei aktivem Hebel addierte `totalSavingPerYear` zuvor zwei Töpfe aus zwei Tarifwelten (der
 * Eigenverbrauch am Fixtarif des Kunden, die Lastverschiebung an den kombinierten Marktpreisen).
 * Ohne Einspeisung ist der Eigenverbrauchs-Topf 0 und die Fassung ohne Wirkung; ohne Hebel sind
 * beide Fassungen wertgleich. Über `calculateRoi` reicht der Unterschied bis in
 * `amortizationYears` und `netSavingOverHorizon` — also bis in die Spalten, gegen die der
 * Wirkungsnachweis läuft.
 *
 * ⚠ Und wie bei jeder Fassung davor: eine archivierte Zeile wird NICHT nachgerechnet (B14-1
 * Regel a). Eine 2026 gerechnete Baseline bleibt die Prognose, die 2026 abgegeben wurde.
 */
export const ANALYSIS_BUNDLE_VERSION = 7

/**
 * Fassungen, die der Upload annimmt.
 *
 * Ältere Fassungen bleiben gültig: es kann bereits ein Bündel exportiert und noch nicht hochgeladen
 * worden sein, und ein Bündel unbrauchbar zu machen, das ein Mensch in der Hand hält, wäre der
 * schlechtere Handel. Bei einer älteren Fassung bleiben die jeweils neueren Felder schlicht leer.
 */
export const SUPPORTED_ANALYSIS_BUNDLE_VERSIONS: readonly number[] = [1, 2, 3, 4, 5, 6, 7]

/**
 * Fassung der Rechen-Engine, VON HAND gepflegt.
 *
 * Sie steht bewusst neben `engineCommitSha` und ersetzt ihn nicht: eine Versionsnummer bleibt still
 * stehen, wenn jemand sie nicht mitzieht (die B14-1-Migration sagt genau das). Der Commit ist die
 * belastbare Angabe, diese hier die menschenlesbare Einordnung.
 *
 * Bei einer Änderung am Rechenkern, die Ergebnisse verschiebt, MITZIEHEN.
 */
export const ENGINE_VERSION = '1.3.0-mvp'

/**
 * Was anstelle des Commits geschrieben wird, wenn die Bauumgebung keinen kennt (lokaler
 * `next dev`/`next build` ohne Vercel-Umgebungsvariable).
 *
 * Ausdrücklich ein erkennbarer Platzhalter und NICHT ein leerer String: `platform.analyses`
 * verlangt `engine_commit_sha not null`, ein leerer Wert liefe also durch die Datenbank und stünde
 * 2027 als Angabe da, die keine ist. Der Upload weist Platzhalter ab — eine Baseline ohne belegbare
 * Engine-Fassung ist beim Wirkungsnachweis nicht verwendbar, und der Fehler fiele beim Speichern
 * niemandem auf.
 */
export const ENGINE_COMMIT_SHA_PLACEHOLDER = 'lokal-unbekannt'

/** Erkennt jede Fassung, die keinen belegbaren Commit trägt (Platzhalter, leer, nur Leerzeichen). */
export function isPlaceholderCommitSha(sha: unknown): boolean {
  if (typeof sha !== 'string') return true
  const value = sha.trim()
  if (value === '') return true
  if (value === ENGINE_COMMIT_SHA_PLACEHOLDER) return true
  // Ein Git-Commit ist eine Hex-Zeichenkette (kurz oder vollständig). Alles andere ist eine
  // Behauptung, keine Fundstelle.
  return !/^[0-9a-f]{7,40}$/i.test(value)
}

/**
 * Woher die geänderten Batteriewerte stammen — und damit, ob der Report für dieses Gerät eine
 * Investition ausweisen darf.
 *
 * `existing`      Der Kunde HAT diesen Speicher bereits (Delta 17 Teil 2, Freitext-Angabe in
 *                 Schritt 2, von ihm bestätigt). Die Anschaffung ist bezahlt: Investition und
 *                 Amortisation beantworten eine Kaufentscheidung, die längst gefallen ist, und
 *                 gehören deshalb nicht an diese Zahlen. Was bleibt, ist die Ersparnis.
 * `catalog_preset` Ein durchgespielter Katalog-Kandidat mit von Hand geänderten Werten
 *                 (Annahmen-Panel §6.2 oder Freitext-Anfrage Delta 18). Eine Anschaffung, die noch
 *                 bevorsteht — Investition und Amortisation sind hier die eigentliche Aussage.
 *
 * ── WARUM DIESER TYP IN `shared` STEHT UND NICHT IN DER APP ────────────────────────────────────
 * Er wird an zwei Orten gebraucht: im Bündel (unten, als eingefrorene Angabe) und im Rechner
 * (`apps/website/lib/analysis-protocol.ts`, als laufender Zustand). Zweimal ausgeschrieben liefen
 * die beiden Wertelisten beim nächsten Zuwachs auseinander — und dann trüge ein Archiv-Eintrag
 * eine Herkunft, die der Leser nicht mehr einordnen kann. Eine Definition, zwei Benutzer.
 */
export type BatteryOverrideSource = 'existing' | 'catalog_preset'

/**
 * Sämtliche Eingangsgrössen der Rechnung — als WERTE, niemals als Verweis auf eine Katalog- oder
 * Tarifzeile.
 *
 * Die Regel stammt aus B14-1 und gilt hier genauso: ein Fremdschlüssel auf eine veränderliche
 * Konfiguration änderte die eingefrorene Baseline STILL mit, sobald jemand die Konfiguration
 * pflegt. Deshalb reist der komplette Batteriekatalog-STAND mit, nicht seine Kennungen — und
 * deshalb wird auch ab B11 kopiert und nicht verlinkt.
 */
export type AnalysisBundleInputs = {
  /** Tarifparameter aus der Netzrechnung (§3.1) — enthält `billingModel` (das Abrechnungsmodell). */
  tariff: TariffParams
  /** Förder-/Steuerparameter (§3.9). Fehlt, wenn das Formular nichts geliefert hat. */
  financial?: FinancialParams
  /** Betrachtungszeitraum der ROI-Rechnung (§3.9) — im Annahmen-Panel editierbar (§6.2). */
  horizonYears: number
  /**
   * Der Batteriekatalog-STAND, gegen den gerechnet wurde — vollständig, in der Reihenfolge, in der
   * die Engine ihn bekommen hat, und MIT einer etwaigen Änderung aus dem Annahmen-Panel
   * (Wirkungsgrad/Preis). Genau dieses Array ging in `recommendBattery`.
   */
  batteryCatalog: BatteryCandidate[]
  /**
   * Die an genau EINEM Kandidaten geänderten Werte — zusätzlich zum bereits geänderten
   * `batteryCatalog`, damit später erkennbar bleibt, dass hier von Hand eingegriffen wurde und
   * nicht der Katalog selbst so aussah.
   *
   * `source` fehlt in jedem Bündel der Fassungen 1 und 2 (s. `ANALYSIS_BUNDLE_VERSION`); ab
   * Fassung 3 ist es gesetzt, sobald es einen Override gibt.
   */
  batteryOverride?: {
    batteryId: string
    roundTripEfficiency?: number
    pricePerKwh?: number
    source?: BatteryOverrideSource
  }
  /** Name der optionalen Brutto-PV-Datei (§3.1); `null`, wenn keine hochgeladen wurde. */
  pvFileName: string | null
  /**
   * B22 (Fassung 6) — war die PV-Komponente des gerechneten Lastgangs GESCHÄTZT?
   *
   * `'estimated'` heisst: die Erzeugungskurve stammt aus einem Zehn-Jahres-Mittel des EU-Dienstes
   * PVGIS für Standort und Auslegung des Kunden und wurde vom Verbrauch abgezogen. Der Wert ist
   * wortgleich `LoadProfile.pvSource` des Lastgangs, gegen den gerechnet wurde — er wird von dort
   * ÜBERNOMMEN und nicht neben ihm geführt, damit es keine zweite Wahrheit gibt.
   *
   * `undefined` heisst „keine geschätzte PV" — und ausdrücklich nicht „unbekannt": der Verbrauch
   * daneben kann sehr wohl gemessen sein (`source: 'import_only'` + geschätzte PV ist der
   * Regelfall dieses Wegs). Genau deshalb steht es orthogonal zu `inputs.tariff`/`result` und
   * nicht als fünfter `source`-Wert (Pflichtenheft §2.2).
   */
  pvSource?: 'estimated'

  // ── B11: Herkunft der Tarifsätze (Fassung 2) ─────────────────────────────────────────────────
  //
  // ES IST EINE HERKUNFTSANGABE, KEIN ERSATZ FÜR DIE WERTE. Leistungspreis, Abrechnungsmodell und
  // Mindestbemessung stehen unverändert als WERTE in `inputs.tariff` — die B14-1-Regel (b) gilt
  // wörtlich weiter und war schon dort ausdrücklich auf B11 gemünzt: „das gilt ausdrücklich auch
  // für B11, wenn die Tarifschicht konfigurierbar wird (ein Verweis änderte die eingefrorene
  // Baseline still mit)". Wer 2027 `tariffSetId` nachschlägt und den heutigen Stand der Datei
  // liest, sieht womöglich andere Zahlen; massgeblich ist und bleibt, was in `inputs.tariff` steht.
  //
  // Alle vier Felder fehlen, wenn kein Netzbetreiber gewählt wurde (die Werte kamen dann direkt aus
  // der Netzrechnung) — und in jedem Bündel der Fassung 1.
  /** Kennung des Tarifsatz-Stands, z. B. `at-2026`. */
  tariffSetId?: string
  /** Menschenlesbare Bezeichnung — damit das Bündel 2027 ohne den Code einzuordnen ist. */
  tariffSetLabel?: string
  /** Beginn der Gültigkeit des Stands, ISO-Datum. */
  tariffSetValidFrom?: string
  /** Stabiler Schlüssel der Kombination, z. B. `wiener_netze:NE3`. */
  tariffProfileKey?: string
  /**
   * Welche Preisfelder der Nutzer gegenüber dem Vorgabewert geändert hat. Leeres Array heisst
   * „unverändert übernommen" — und das ist eine ANDERE Aussage als ein fehlendes Feld (kein
   * Netzbetreiber gewählt). Ohne diese Unterscheidung wäre 2027 nicht mehr zu sagen, ob eine
   * Baseline auf unserer Tabelle oder auf der echten Netzrechnung des Kunden beruht.
   */
  tariffOverriddenFields?: TariffOverridableField[]
}

/**
 * Das Bündel, wie es als `.json` den Browser verlässt.
 *
 * KEINE Ursprungsdatei: sie wird getrennt hochgeladen. Ein Jahres-Lastgang sind rund 600 kB Text —
 * base64-kodiert in ein JSON eingebettet wären es rund 800 kB, die durch jede Prüfung, jeden
 * Editor und jeden Mailanhang mitreisen. Die Prüfsumme bindet beide ohnehin fester aneinander, als
 * eine Einbettung es täte: eingebettet wäre die Datei das, was das Bündel BEHAUPTET; getrennt ist
 * sie das, was der Mensch tatsächlich vorlegt, und die Prüfsumme entscheidet, ob es dieselbe ist.
 */
export type AnalysisBundle = {
  bundleVersion: number
  engineVersion: string
  engineCommitSha: string
  /** Wann die RECHNUNG lief (nicht wann exportiert wurde) — ISO-8601. */
  computedAt: string
  inputs: AnalysisBundleInputs
  /** Der vollständige `AnalysisResult` (§3.10), wortgleich wie berechnet. */
  result: AnalysisResult
  sourceFileName: string
  /** SHA-256 der UNKOMPRIMIERTEN Ursprungsdatei, Kleinbuchstaben-Hex (64 Zeichen). */
  sourceFileSha256: string
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Die fünf typisierten Auszüge — EINE Ableitung, kein Formularfeld
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Die fünf Spalten, die `platform.analyses` ZUSÄTZLICH zum jsonb führt (B14-1).
 *
 * Sie werden AUS `result` abgeleitet und beim Upload NICHT erfragt. Ein Formularfeld daneben wäre
 * eine zweite, abtippbare Wahrheit — und die Abweichung fiele erst 2027 auf, wenn der
 * Wirkungsnachweis gegen eine Zahl misst, die nie berechnet wurde.
 */
export type BaselineExtracts = {
  billedKwBefore: number
  billedKwAfter: number
  annualSavingEur: number
  recommendedBatteryLabel: string | null
  recommendedCapacityKwh: number | null
}

/**
 * Leitet die fünf Auszüge ab.
 *
 * ── DER FALL „KEINE EMPFEHLUNG" ─────────────────────────────────────────────────────────────────
 * Findet sich zur `recommendation.batteryId` kein Eintrag in `perBattery` (oder ist `perBattery`
 * leer), bleiben Modell und Kapazität `null` — die B14-1-Spalten sind dafür ausdrücklich nullable,
 * „ein Ersatzwert wäre hier eine Behauptung". Die zwei kW-Werte sind dann GLEICH und die Ersparnis
 * 0: ohne empfohlene Batterie ändert sich am abgerechneten Wert nichts. Das ist keine Notlösung,
 * sondern die zutreffende Baseline für „es rechnet sich keiner".
 */
export function deriveBaselineExtracts(result: AnalysisResult): BaselineExtracts {
  const before = result.current.billedKw
  const recommended = result.perBattery.find(
    (e) => e.battery.id === result.recommendation.batteryId,
  )

  if (!recommended) {
    return {
      billedKwBefore: before,
      billedKwAfter: before,
      annualSavingEur: 0,
      recommendedBatteryLabel: null,
      recommendedCapacityKwh: null,
    }
  }

  return {
    billedKwBefore: before,
    billedKwAfter: recommended.newBilledKw,
    annualSavingEur: recommended.totalSavingPerYear,
    recommendedBatteryLabel: recommended.battery.name,
    recommendedCapacityKwh: recommended.battery.usableCapacityKwh,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Erzeugen
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export type BuildAnalysisBundleArgs = {
  engineVersion: string
  engineCommitSha: string
  computedAt: string
  inputs: AnalysisBundleInputs
  result: AnalysisResult
  sourceFileName: string
  /**
   * Die Bytes der TATSÄCHLICH verarbeiteten Ursprungsdatei — nicht einer daraus abgeleiteten
   * Fassung. `null` heisst: sie liegt nicht mehr vor.
   */
  sourceFile: Uint8Array | null
}

/**
 * Baut das Bündel und rechnet dabei die Prüfsumme über die Ursprungsdatei.
 *
 * WIRFT, wenn die Ursprungsdatei fehlt. Lieber kein Bündel als eines mit einer Prüfsumme, die
 * nichts bindet: ein Bündel ohne belastbare Bindung sähe vollständig aus, liesse sich hochladen und
 * archivierte die Analyse zu irgendeiner Datei.
 */
export async function buildAnalysisBundle(args: BuildAnalysisBundleArgs): Promise<AnalysisBundle> {
  if (args.sourceFile == null || args.sourceFile.byteLength === 0) {
    throw new Error(
      'Die Ursprungsdatei liegt nicht mehr vor — ohne sie lässt sich die Prüfsumme nicht rechnen, ' +
        'und ein Bündel ohne Prüfsumme bindet die Analyse an keine Datei.',
    )
  }
  if (args.sourceFileName.trim() === '') {
    throw new Error('Die Ursprungsdatei hat keinen Namen — ohne ihn ist sie nicht wiederzufinden.')
  }

  return {
    bundleVersion: ANALYSIS_BUNDLE_VERSION,
    engineVersion: args.engineVersion,
    engineCommitSha: args.engineCommitSha,
    computedAt: args.computedAt,
    inputs: args.inputs,
    result: args.result,
    sourceFileName: args.sourceFileName.trim(),
    sourceFileSha256: await sha256Hex(args.sourceFile),
  }
}

/** Eingerückt, damit die Datei von einem Menschen gelesen und verglichen werden kann. */
export function serializeAnalysisBundle(bundle: AnalysisBundle): string {
  return JSON.stringify(bundle, null, 2)
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Prüfen
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export type AnalysisBundleParseResult =
  { ok: true; bundle: AnalysisBundle } | { ok: false; message: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Prüft ein eingelesenes Bündel und gibt es UNVERÄNDERT zurück.
 *
 * ── WARUM HIER KEIN VOLLSTÄNDIGES SCHEMA ÜBER `result` LIEGT ────────────────────────────────────
 * `AnalysisResult` ist bewusst ein TS-Typ und kein zod-Schema (§3.10: „ein zweites, parallel
 * gepflegtes Schema würde genau die Drift erzeugen"). Ein hier nachgebautes Schema wäre genau
 * dieses zweite — und es hätte eine zweite, schlimmere Wirkung: es wiese ein Bündel aus einer
 * SPÄTEREN Engine-Fassung ab, deren Ergebnis um ein Feld gewachsen ist. Genau dafür trägt die Zeile
 * `engine_version` und `engine_commit_sha`, und genau dafür gibt es `supersedes_id`.
 *
 * Geprüft wird deshalb, was die ABLAGE braucht: die Kopfdaten, die Eingangsgrössen dem Namen nach,
 * und dass sich die fünf typisierten Auszüge ableiten lassen (sie sind `not null`). Alles Übrige an
 * `result` reist wortgleich mit — es wird gespeichert, nicht ausgewertet.
 *
 * Die Rückgabe ist das ROHE Objekt, nicht eine bereinigte Kopie: `inputs` und `result` müssen
 * unverändert in der Datenbank landen. Ein Schema, das unbekannte Schlüssel abschneidet, machte aus
 * dem Einfrieren ein Umschreiben.
 */
export function parseAnalysisBundle(raw: unknown): AnalysisBundleParseResult {
  if (!isRecord(raw)) {
    return { ok: false, message: 'Die Datei enthält kein Analyse-Bündel (kein JSON-Objekt).' }
  }

  // Zuerst die Fassung: alles Weitere wird unter ihrer Bedeutung gelesen.
  if (!isFiniteNumber(raw.bundleVersion)) {
    return {
      ok: false,
      message:
        'Der Datei fehlt die Angabe „bundleVersion" — sie stammt nicht aus dem Analyse-Export des Rechners.',
    }
  }
  // B11: angenommen werden Fassung 1 UND 2. Ein bereits exportiertes Bündel der Fassung 1 darf
  // nicht unbrauchbar werden — es kann in der Hand eines Menschen liegen, der es noch nicht
  // hochgeladen hat. Bei Fassung 1 fehlt die Tarif-Herkunft schlicht.
  if (!SUPPORTED_ANALYSIS_BUNDLE_VERSIONS.includes(raw.bundleVersion)) {
    return {
      ok: false,
      message:
        `Unbekannte Bündel-Fassung ${raw.bundleVersion} (unterstützt: ` +
        `${SUPPORTED_ANALYSIS_BUNDLE_VERSIONS.join(', ')}). ` +
        'Das Bündel stammt aus einem anderen Stand des Rechners; es wird nichts angelegt.',
    }
  }

  for (const key of [
    'engineVersion',
    'computedAt',
    'sourceFileName',
    'sourceFileSha256',
  ] as const) {
    if (typeof raw[key] !== 'string' || (raw[key] as string).trim() === '') {
      return { ok: false, message: `Im Bündel fehlt das Feld „${key}".` }
    }
  }

  if (typeof raw.engineCommitSha !== 'string') {
    return { ok: false, message: 'Im Bündel fehlt das Feld „engineCommitSha".' }
  }
  if (isPlaceholderCommitSha(raw.engineCommitSha)) {
    return {
      ok: false,
      message:
        'Das Bündel trägt keinen belegbaren Engine-Commit (' +
        `„${raw.engineCommitSha}"). Es stammt aus einem lokalen Rechnerlauf ohne Commit-Angabe. ` +
        'Eine Baseline ohne belegbare Engine-Fassung ist beim Wirkungsnachweis nicht verwendbar — ' +
        'sie wird deshalb nicht archiviert.',
    }
  }

  if (!/^[0-9a-f]{64}$/.test(raw.sourceFileSha256 as string)) {
    return {
      ok: false,
      message:
        'Die Prüfsumme im Bündel hat nicht die Form eines SHA-256 (64 Hex-Zeichen in Kleinschreibung).',
    }
  }

  if (Number.isNaN(Date.parse(raw.computedAt as string))) {
    return { ok: false, message: 'Das Feld „computedAt" ist kein lesbarer Zeitpunkt.' }
  }

  // ── inputs: dem Namen nach, nicht in jeder Tiefe ────────────────────────────────────────────────
  // Was hier zählt, ist, dass die Eingangsgrössen als WERTE vorhanden sind. Ihre fachliche
  // Gültigkeit hat der Rechner geprüft, bevor er damit gerechnet hat; sie hier ein zweites Mal zu
  // prüfen hiesse, eine bereits durchgeführte Rechnung nachträglich für ungültig erklären zu können.
  if (!isRecord(raw.inputs)) {
    return { ok: false, message: 'Im Bündel fehlt der Abschnitt „inputs".' }
  }
  if (!isRecord(raw.inputs.tariff)) {
    return { ok: false, message: 'Im Bündel fehlen die Tarifparameter („inputs.tariff").' }
  }
  if (typeof raw.inputs.tariff.billingModel !== 'string') {
    return {
      ok: false,
      message: 'Im Bündel fehlt das Abrechnungsmodell („inputs.tariff.billingModel").',
    }
  }
  if (!isFiniteNumber(raw.inputs.horizonYears)) {
    return {
      ok: false,
      message: 'Im Bündel fehlt der Betrachtungszeitraum („inputs.horizonYears").',
    }
  }
  if (!Array.isArray(raw.inputs.batteryCatalog)) {
    return {
      ok: false,
      message: 'Im Bündel fehlt der Batteriekatalog-Stand („inputs.batteryCatalog").',
    }
  }

  // ── result: nur so weit, wie die Ablage es braucht ─────────────────────────────────────────────
  if (!isRecord(raw.result)) {
    return { ok: false, message: 'Im Bündel fehlt der Abschnitt „result".' }
  }
  const result = raw.result as unknown as AnalysisResult
  if (!isRecord(raw.result.current) || !isFiniteNumber(result.current?.billedKw)) {
    return {
      ok: false,
      message: 'Im Ergebnis fehlt der abgerechnete Leistungswert („result.current.billedKw").',
    }
  }
  if (!Array.isArray(result.perBattery)) {
    return { ok: false, message: 'Im Ergebnis fehlt die Kandidatenliste („result.perBattery").' }
  }
  if (
    !isRecord(raw.result.recommendation) ||
    typeof result.recommendation?.batteryId !== 'string'
  ) {
    return { ok: false, message: 'Im Ergebnis fehlt die Empfehlung („result.recommendation").' }
  }

  // Die fünf Auszüge sind `not null` — lassen sie sich nicht ableiten, scheiterte sonst erst die
  // Datenbank, und zwar mit einer Meldung, die niemandem sagt, was fehlt.
  const extracts = deriveBaselineExtracts(result)
  if (
    !isFiniteNumber(extracts.billedKwBefore) ||
    !isFiniteNumber(extracts.billedKwAfter) ||
    !isFiniteNumber(extracts.annualSavingEur)
  ) {
    return {
      ok: false,
      message:
        'Aus dem Ergebnis lassen sich die Baseline-Kennzahlen nicht ableiten (abgerechnete Leistung ' +
        'vorher/nachher, Jahresersparnis). Ohne sie ist die Analyse 2027 nicht auswertbar.',
    }
  }

  return { ok: true, bundle: raw as unknown as AnalysisBundle }
}
