/**
 * B24 — DIE KI-EXTRAKTOREN, KONSOLIDIERT. Ein Prompt je Dokumentart, zwei Aufrufer.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WARUM ES DIESES PAKET GIBT — und was der Zustand davor war
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Vier Extraktoren lagen bis hierher in `apps/website/lib/{invoice-scan,pv-design-scan,
 * battery-text,upload-classification}` und waren dort für den Formular-Wizard des öffentlichen
 * Rechners gebaut. Mit dem Projekt-Chat (`apps/web/lib/project-chat`) kam ein ZWEITER Aufrufer
 * dazu, der dieselben Dokumente lesen muss — und drei gemessene Gründe verhinderten den Import:
 *
 *   (a) Der Chat MUSS in `apps/web` liegen. Der Zugriffsschutz aller Projekt-Wrapper hängt an
 *       `auth.uid()` (`platform.project_accessible`), und eine angemeldete Sitzung gibt es nur
 *       dort — `apps/website` führt kein `@supabase/ssr`, keine Middleware, keinen Cookie-Client.
 *   (b) Die zwei Apps importieren einander NIE: kein Pfad-Alias, keine Workspace-Abhängigkeit,
 *       kein einziger Import über die Grenze.
 *   (c) Nach `packages/shared` können die Extraktoren nicht: `shared` wird in das CLIENT-Bündel
 *       des Rechners hineingebaut, und `import 'server-only'` bräche diesen Build hart.
 *
 * Der Chat behalf sich deshalb mit PORTS: `ProjectChatPorts.extractors` war ein handgeschriebener
 * Vertrag, den niemand erfüllen konnte, und die vier Werkzeuge wurden dem Modell schlicht nicht
 * angeboten. Der Chat konnte kein einziges Dokument auslesen.
 *
 * ── DIE AUFLÖSUNG: EIN EIGENES SERVER-ONLY-PAKET ──────────────────────────────────────────────
 * Es hebt (c) auf, ohne (a) oder (b) anzutasten. Beide Apps hängen daran, keine hängt an der
 * anderen. Die Prompts, die Schemata und die Auswertung existieren danach nachweisbar EINMAL —
 * und das ist der ganze Zweck: zwei Fassungen derselben Ableseregel laufen beim nächsten Umbau
 * auseinander, und dann liest derselbe Kunde je nach Einstieg eine andere Zahl von derselben
 * Rechnung.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIESER BARREL IST DER EINZIGE AUSGANG, UND DAS IST EINE HÄRTERE SPERRE ALS EINE ESLINT-REGEL
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `package.json` gibt unter `exports` ausschliesslich `.` frei. Ein
 * `import … from 'extractors/src/invoice-scan/ai-client'` löst deshalb GAR NICHT AUF — weder in
 * TypeScript (`moduleResolution: "Bundler"` wertet `exports` aus) noch in webpack. Die vier
 * KI-Clients sind von ausserhalb des Pakets nicht erreichbar, auch nicht versehentlich, und dafür
 * braucht es keine Regel, die jemand pflegen müsste.
 *
 * Was ESLint durchsetzt, ist die Grenze INNERHALB des Pakets: einen KI-Client darf ausschliesslich
 * das `extract.ts` seines eigenen Verzeichnisses importieren — auch relativ (`./ai-client`), denn
 * genau diese Schreibweise erfasst eine Pfad-Sperre nicht (in Delta 17 Teil 1 als Probe
 * nachgewiesen). Die Blöcke stehen in der root-`eslint.config.mjs`.
 *
 * ⚠ DIESER ABSATZ STAND HIER, BEVOR ES DIE BLÖCKE GAB — beim Anlegen der fünften Anbindung (B24,
 * Batterie-Datenblatt-Scan) als Probe gemessen: die ESLint-Regeln sind sämtlich auf `apps/**`
 * beschränkt und haben dieses Paket seit dem Umzug NIE erreicht; ein `./ai-client`-Import in einer
 * beliebigen Nachbardatei lief sauber durch. Die Blöcke für `packages/extractors/src/**` sind mit
 * jenem Schritt nachgezogen und in drei Richtungen belegt (Nachbardatei · Barrel · fremder
 * Extraktor). Der Satz oben ist damit wahr geworden, statt wahr zu klingen.
 *
 * ⚠ Deshalb steht in diesem Barrel KEIN Import auf ein `ai-client.ts`. Die Grössen- und
 * Längengrenzen, die die Server Actions prüfen, liegen ausnahmslos in `limits.ts` — für
 * `invoice-scan` und `pv-design-scan` ist das die Auflösung der Lücke, die Delta 17 offengelegt
 * und auf „einen eigenen Schritt" vertagt hatte. Sie war keine Aufräumarbeit, sondern die
 * Bedingung: läge eine dieser Konstanten weiterhin im Client-Modul, wäre dieser Barrel ein
 * zweiter Importeur des Clients und die Regel schon beim Anlegen gebrochen.
 *
 * ── ⚠ WAS HIER NICHT LIEGT, UND WARUM ─────────────────────────────────────────────────────────
 * `apps/website/lib/report-request` (Delta 18, übersetzt eine Report-Anfrage in
 * Neuberechnungs-Parameter) und `apps/web/lib/admin/tariff-scan` (B21-2b, liest ein Preisblatt für
 * die Admin-Pflege) sind NICHT mitgezogen. Beide haben genau EINEN Aufrufer in genau EINER App —
 * es gibt für sie keine zweite Fassung, die auseinanderlaufen könnte. Sie hierher zu holen wäre
 * Umzug ohne Anlass; die Zusammenlegung löst eine Doppelung, sie sammelt nicht Anbindungen ein.
 *
 * `apps/web/lib/project-chat/ai-client.ts` bleibt ebenfalls dort: das ist der Client der
 * Chat-SCHLEIFE, nicht eines Extraktors, und er trägt eine eigene Werkzeug-Obergrenze.
 *
 * ── ⚠ DIE VIER `actions.ts` SIND BEWUSST IN `apps/website` GEBLIEBEN ──────────────────────────
 * Sie tragen `'use server'`, prüfen die Datei (Grösse, Medientyp) und übersetzen den Ausgang in
 * eine Antwort für die Oberfläche. Eine Server Action ist ein HTTP-Endpunkt der App, in der sie
 * steht — sie gehört zu ihrem Aufrufer, nicht zur Ableselogik. Hier hätte sie einen zweiten,
 * öffentlich adressierbaren Weg in dieselben abrechenbaren Aufrufe geöffnet, und zwar aus BEIDEN
 * Apps. Verschoben ist ausschliesslich, was liest; wer fragen darf, entscheidet weiterhin die App.
 */

// ── Rechnungs-Scan (Delta 9b-2a) ──────────────────────────────────────────────────────────────
export { MAX_INVOICE_FILE_BYTES } from './invoice-scan/limits'
export { extractInvoiceData, type InvoiceScanOutcome } from './invoice-scan/extract'

// ── PV-Auslegungs-Scan (B22c) ─────────────────────────────────────────────────────────────────
export { MAX_PV_DESIGN_FILE_BYTES } from './pv-design-scan/limits'
export { extractPvDesign, type PvDesignScanOutcome } from './pv-design-scan/extract'

// ── Batterie-Freitexterfassung (Delta 17 Teil 2) ──────────────────────────────────────────────
export { MAX_BATTERY_TEXT_CHARS } from './battery-text/limits'
export { extractBatteryText, type BatteryTextOutcome } from './battery-text/extract'

/*
 * ── PV-ANLAGEN-Freitexterfassung (B24, Teil 1) ────────────────────────────────────────────────
 * Derselbe Zuschnitt wie die Batterie-Freitexterfassung darüber, für einen anderen Gegenstand: ein
 * Kunde HAT eine PV-Anlage, aber keine gemessene Erzeugungsreihe — er weiss, wie gross sie ist,
 * wohin sie zeigt und wie steil das Dach ist. Genau diese drei Angaben sind die Eingabe des
 * PVGIS-Verfahrens (B22).
 *
 * ⚠ SIE IST DIE ZWEITE QUELLE DERSELBEN DREI FELDER — die erste ist der PV-Auslegungs-Scan
 * (`pv-design-scan` oben), der sie aus einem Planungsdokument liest. Beide liefern
 * `peakPowerKwp`, `direction` und `slopeDeg` unter denselben Namen und speisen deshalb in dieselben
 * Formularfelder und denselben Entwurf, statt einen eigenen Mechanismus zu erfinden.
 *
 * ⚠ EIN UNTERSCHIED IST WESENTLICH: dieser Weg kennt KEINE Gradzahl und keine Azimut-Zählweise.
 * Ein gedrucktes Dokument nennt eine Zahl, deren Zählweise man ihm nicht ansieht (PV*SOL vom
 * Norden, PVGIS vom Süden — 56 % Ersparnis Unterschied); ein Mensch sagt „nach Südwesten", und das
 * ist eindeutig. Eine blosse Gradzahl im Freitext wird ausdrücklich NICHT übernommen.
 */
export { MAX_PV_ARRAY_TEXT_CHARS } from './pv-array-text/limits'
export { extractPvArrayText, type PvArrayTextOutcome } from './pv-array-text/extract'

/*
 * ── Batterie-DATENBLATT-Scan (B24, Teil 1) ────────────────────────────────────────────────────
 * Derselbe Gegenstand wie die Freitexterfassung darüber, aus einer anderen Quelle: der Wizard
 * nimmt neben dem Satz in eigenen Worten ein PDF-Datenblatt entgegen. Es ist bewusst ein ZWEITER
 * Extraktor und keine Erweiterung des ersten — die Ableseregeln haben fast nichts gemeinsam (ein
 * Satz erfindet zu wenig Zahlen, ein Datenblatt bietet zu viele falsche an), und die vier
 * bestehenden Anbindungen sollen sich unabhängig voneinander abschalten lassen.
 *
 * Was die beiden verbindet, ist die Rückgabe: dieselben vier Zahlenfelder unter denselben Namen,
 * per `satisfies` aneinander gebunden (`shared/battery-spec-scan.ts`). Sie speisen deshalb in
 * dieselben Formularfelder und über `battery-draft.ts` in denselben Entwurf.
 */
export { MAX_BATTERY_SPEC_FILE_BYTES } from './battery-spec-scan/limits'
export { extractBatterySpec, type BatterySpecScanOutcome } from './battery-spec-scan/extract'

/*
 * ── Marke/Typ-RECHERCHE (B24, Teil 1) ─────────────────────────────────────────────────────────
 * Der DRITTE Weg zu denselben vier Kenndaten und die ERSTE Anbindung dieses Pakets mit echtem
 * Web-Zugriff. Die zwei darüber setzen voraus, dass der Kunde die Zahlen kennt oder das Papier zur
 * Hand hat; der häufigste reale Zustand ist ein anderer — er weiss, WAS dasteht („ein Sungrow
 * SBR128"), und sonst nichts.
 *
 * ⚠ SIE IST DIE EINZIGE, DIE NEBEN DEM MODELLAUFRUF ZUSÄTZLICH SUCHKOSTEN VERURSACHT, und die
 * einzige, deren Quelle nicht vorgelegt, sondern gesucht wird. Daraus folgt eine Fehlerart, die es
 * in den fünf Anbindungen davor nicht gab: eine Zahl aus dem Trainingswissen, die wie eine
 * recherchierte aussieht. Dagegen steht keine Bitte an das Modell, sondern eine PRÜFUNG — jede
 * genannte Quelle wird gegen die tatsächlich gelieferten Suchtreffer gehalten, und ohne Beleg
 * fallen alle vier Zahlen weg (`shared/battery-lookup.ts`).
 *
 * Was sie mit den beiden Wegen darüber verbindet, ist die Rückgabe: dieselben vier Zahlenfelder
 * unter denselben Namen, per `satisfies` aneinander gebunden. Sie speisen deshalb in dieselben
 * Formularfelder und über `battery-draft.ts` in denselben Entwurf.
 */
export {
  MAX_BATTERY_LOOKUP_INPUT_CHARS,
  MAX_BATTERY_LOOKUP_SEARCHES,
} from './battery-lookup/limits'
export { lookupBatterySpec, type BatteryLookupOutcome } from './battery-lookup/extract'

/*
 * ── Lastgang-Leser (B24, Teil 1 Baustein 1) ───────────────────────────────────────────────────
 * ⚠ DER EINZIGE EXTRAKTOR DIESES PAKETS OHNE MODELLAUFRUF, und damit eine benannte Ausweitung
 * seines Zuschnitts: die Ueberschrift lautete „server-only KI-Extraktoren". Der Grund ist die
 * ZWEITE Haelfte jener Ueberschrift, die weiterhin gilt — EIN Ausgang fuer alles, was ein
 * Kundendokument liest, damit die Apps ihn ueber denselben Weg bekommen.
 *
 * Die LESE-Logik liegt trotzdem nicht hier, sondern in `packages/engine/src/parser/metadata.ts`:
 * sie ist isomorph und muss es bleiben (der oeffentliche Rechner liest den Lastgang im Browser,
 * Prinzip 4), und hinter `import 'server-only'` waere sie fuer jenen Weg unerreichbar. Was hier
 * steht, ist der duenne server-only Adapter samt Groessengrenze.
 */
export { MAX_LOAD_PROFILE_FILE_BYTES } from './load-profile/limits'
export { readLoadProfile, type LoadProfileOutcome } from './load-profile/extract'

/*
 * ── PV-Erzeugungs-Leser (B24, Teil 1 — der Ja-Zweig der PV-Station) ───────────────────────────
 * Der ZWEITE Extraktor ohne Modellaufruf und aus denselben Gruenden wie der Lastgang-Leser
 * darueber: EIN Ausgang fuer alles, was ein Kundendokument liest — die LESE-Logik bleibt in
 * `packages/engine/src/parser/metadata.ts`, weil sie isomorph bleiben muss (der oeffentliche
 * Rechner liest ein PV-Profil im Browser, Prinzip 4).
 */
export { MAX_PV_PROFILE_FILE_BYTES } from './pv-profile/limits'
export { readPvProfile, type PvProfileOutcome } from './pv-profile/extract'

/*
 * ── Standardprofil-Erzeuger (B24, Teil 1 — der „Nein"-Zweig des Lastgang-Schritts) ────────────
 * ⚠ DIE ZWEITE benannte Ausweitung des Zuschnitts, und sie braucht eine EIGENE Begruendung: der
 * Lastgang-Leser darueber ist damit gerechtfertigt, dass EIN Ausgang fuer alles gilt, was ein
 * KUNDENDOKUMENT liest — hier wird gar kein Dokument angefasst, sondern eine Kurve erzeugt.
 *
 * Was traegt, steht ausfuehrlich im Kopf des Moduls und in einem Satz hier: `apps/web` haengt
 * bewusst nicht an `packages/engine`, und heraus kommen NUR Metadaten — die 35.040 erzeugten
 * Messwerte bleiben hinter dieser Paketgrenze, genau wie beim Leser nebenan die gelesenen.
 */
export {
  generateStandardProfileMetadata,
  type StandardProfileMetadata,
  type StandardProfileMetadataOutcome,
  type StandardProfileCustomerClass,
} from './standard-profile/generate'

/*
 * ── PV-REFERENZ: Anbietbarkeit + PVGIS-Abruf (B24, Teil 1 — Phase A) ──────────────────────────
 * Der DRITTE und VIERTE Extraktor ohne Modellaufruf, und der erste dieses Pakets mit einem eigenen
 * NETZWEG. Er beantwortet den „Nein"-Zweig der PV-Station: der Kunde HAT eine Anlage, aber keine
 * gemessene Erzeugungsreihe — dann wird sie aus Standort und Auslegung geschätzt (B22).
 *
 * ⚠ ZWEI FUNKTIONEN, ZWEI VERSCHIEDENE ZUSAGEN, UND BEIDE SIND DER GRUND FÜR DEN ORT:
 *
 *   `checkPvGeneratorEligibility` erzeugt den VOLLEN Lastgang (bis zu 35.040 Messwerte), weil die
 *   Frage nur an ihm zu beantworten ist — und lässt ausschliesslich ein Ja/Nein mit höchstens einem
 *   Grund heraus. Der Metadaten-Leser nebenan könnte es strukturell nicht: er trägt keine
 *   Messwerte, und die zweite der beiden Prüfungen braucht jeden einzelnen davon.
 *
 *   `fetchPvArrayReferenceProfile` holt die zehn Wetterjahre EINER Modulfläche und lässt
 *   ausschliesslich Kennzahlen heraus — die 8.760 Stundenwerte bleiben hier, genau wie beim
 *   Standardprofil-Erzeuger die 35.040 erzeugten. Was der Wizard SPEICHERT, sind Eingaben; die
 *   Kurve entsteht zur Rechenzeit neu.
 *
 * ⚠ `apps/website/lib/pvgis/client.ts` TUT DASSELBE UND BLEIBT UNANGETASTET. Die Doppelung ist
 * benannt statt still: jenes Modul ist die live gemessene Fassung des öffentlichen Rechners, und
 * ein Umbau daran gehört in einen eigenen Schritt mit eigener Messung. Geteilt ist, worauf es
 * ankommt — die REGELN (Anfrageprüfung, Antwortauswertung, Mittelung) liegen in `packages/engine`
 * und existieren nur EINMAL.
 *
 * ⚠ DIE FREQUENZBREMSE IST EIGEN UND PROZESSLOKAL. Ein geteilter Zähler wäre zwischen zwei
 * getrennten Vercel-Projekten gar nicht herstellbar, wohl aber behauptbar — s. der Kopf von
 * `pv-reference/limits.ts`.
 */
export {
  PVGIS_TIMEOUT_MS,
  PV_REFERENCE_RATE_LIMIT_MAX_CALLS,
  PV_REFERENCE_RATE_LIMIT_WINDOW_MS,
  /** Nur für Tests/Diagnose — kein Aufrufer im Produktionspfad (s. dortiger Kommentar). */
  resetPvReferenceRateLimit,
} from './pv-reference/limits'
export {
  checkPvGeneratorEligibility,
  type PvGeneratorEligibilityOutcome,
} from './pv-reference/eligibility'
export {
  fetchPvArrayReferenceProfile,
  type PvArrayReferenceOutcome,
  type PvArrayReferenceSummary,
} from './pv-reference/fetch'

/*
 * ── DIE GESCHÄTZTE ERZEUGUNGSREIHE, FERTIG ZUM ABLEGEN ────────────────────────────────────────
 * ⚠ HIER KIPPT EINE ZUSAGE DES ABRUFS DARÜBER, und zwar absichtlich: `fetchPvArrayReferenceProfile`
 * lässt keine Reihe heraus, `generateEstimatedPvSeries` sehr wohl — aber nicht als Zahlenreihe für
 * einen Entwurf, sondern als fertig serialisierte DATEI. Der Grund ist B14-1 Regel a: eine zur
 * Rechenzeit neu geholte Kurve wäre ein zweiter PVGIS-Abruf mit womöglich anderen Wetterjahren und
 * damit ein stilles Nachrechnen einer bereits abgegebenen Auslegung.
 *
 * Die 8.760 Stundenwerte je Fläche bleiben trotzdem hinter dieser Grenze: summiert und auf die
 * Zeitstempel des Lastgangs gelegt wird INNERHALB des Pakets.
 */
export {
  generateEstimatedPvSeries,
  type EstimatedPvSeriesLoadProfile,
  type EstimatedPvSeriesOutcome,
} from './pv-reference/fetch'
export {
  GENERATED_PV_SERIES_FORMAT,
  type GeneratedPvSeriesDocument,
  type GeneratedPvSeriesFile,
} from './pv-reference/generated-series'

/*
 * ── DIESELBE REIHE, ZURÜCKGELESEN UND AN DEN LASTGANG GEKOPPELT ───────────────────────────────
 * Verdrahtet seit D3 (Abschluss): `run-from-draft.ts` geht diesen Weg, sobald der Entwurf eine
 * abgelegte Reihe benennt — ohne Kennung (Entwürfe von vor PR #256) bleibt die Sperre.
 * Gekoppelt wird über die unveränderten Engine-Funktionen — hier entsteht keine zweite Rechnung.
 */
export {
  readGeneratedPvSeries,
  coupleGeneratedPvSeries,
  GeneratedPvSeriesError,
  type CoupledGeneratedPvSeries,
} from './pv-reference/generated-series-read'

// ── Dokument-Zuordnung (Delta 17 Teil 1) ──────────────────────────────────────────────────────
export {
  MAX_UPLOAD_CLASSIFICATION_FILE_BYTES,
  MAX_UPLOAD_LABEL_CHARS,
} from './upload-classification/limits'
export { classifyDocument, type UploadClassificationOutcome } from './upload-classification/extract'

/*
 * ── ANALYSE-LAUF AUS DEM WIZARD-ENTWURF (D3, Baustein 1) ──────────────────────────────────────
 * Die DRITTE benannte Ausweitung des Paket-Zuschnitts, und sie liest wieder ein Kundendokument —
 * nur bis zum Ende: aus dem Entwurf eines Zählpunkts und seiner hochgeladenen Lastgang-Datei
 * entsteht ein vollständiges `AnalysisResult`.
 *
 * ⚠ SIE LIEGT HIER UND NICHT IN `packages/engine`, obwohl sie fast nur Engine-Aufrufe verkettet:
 * der künftige Aufrufer ist `apps/web`, und diese App hängt bewusst NICHT an `engine` (dieselbe
 * Feststellung, aus der der Standardprofil-Erzeuger hier liegt). Die Aussenwelt kommt als PORTS
 * herein — ein Paket importiert keine App.
 *
 * ⚠ Gerechnet wird mit dem UNVERÄNDERTEN `computeAnalysis`. Es gibt keine zweite Rechenkette.
 */
export {
  runAnalysisFromMeteringPointDraft,
  MeteringPointAnalysisError,
  type EstimatedPvSeriesMetadata,
  type MeteringPointAnalysisPorts,
  type MeteringPointAnalysisRun,
  type MeteringPointAnalysisSource,
  type ProjectDocumentFile,
  type RunAnalysisFromDraftOptions,
} from './analysis/run-from-draft'
/* D5 — der Befundtyp reist mit dem Lauf; `apps/web` kennt `engine` nicht und käme sonst nicht daran. */
export type { PvOutageMonth } from 'engine'

/*
 * ── MARKTPREISE MIT LÜCKENFÜLLUNG (D6 Teil 2a) ────────────────────────────────────────────────
 * Liest den gepflegten Bestand, lädt gemeldete Lücken bei aWATTar nach und näht den Rest mit dem
 * Schnitt des nächstgelegenen Monats — jeder Anteil im Rückgabewert benannt. Beide Leser kommen
 * als PORTS herein (D3-Muster); geschrieben wird nichts, auch nicht nach erfolgreichem Nachladen.
 *
 * Noch nicht verdrahtet: die Kosten-Zahl daraus ist Teil 2b.
 */
export {
  resolveGapMarketPrices,
  type MarketPriceCoverage,
  type MarketPriceOrigin,
  type MarketPriceWindowEntry,
  type MarketPriceWindowReader,
  type ResolvedMarketPrices,
  type SpotPriceRangeReader,
} from './analysis/gap-market-prices'

/*
 * ── JAHRES-KOSTEN-HOCHRECHNUNG (D6 Teil 2b) ───────────────────────────────────────────────────
 * Führt Teil 1 (Referenzrate) und Teil 2a (Marktpreise der Lücke) zu zwei Jahreszahlen zusammen:
 * „Ihr Tarif heute" und „aWATTar ungesteuert", je aufgeteilt in gemessenen und geschätzten Anteil.
 * Gerechnet wird mit dem unveränderten `buildMonthlyTariffComparison` — es entsteht keine zweite
 * Preislogik, und die bestehende `tariffOptimization`-Pipeline wird nicht angefasst.
 *
 * Noch nicht verdrahtet: die Anzeige im Report ist D9.
 */
export {
  projectAnnualTariffComparison,
  type AnnualTariffProjectionOptions,
} from './analysis/annual-projection'
