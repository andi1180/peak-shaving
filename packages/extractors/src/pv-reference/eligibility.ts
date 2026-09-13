import 'server-only'

import { parseLoadProfile, pvGeneratorEligibility, type ParseErrorCode } from 'engine'

import { MAX_LOAD_PROFILE_FILE_BYTES } from '../load-profile/limits'

/**
 * B24, Teil 1 — DARF DER PV-GENERATOR FÜR DIESEN LASTGANG ANGEBOTEN WERDEN? (Phase A)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIE FRAGE LÄSST SICH NUR AM VOLLEN LASTGANG BEANTWORTEN — UND DER VERLÄSST DIESE DATEI NIE
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `pvGeneratorEligibility` (`packages/engine/src/pv-generation/couple.ts`) prüft ZWEI Dinge, und
 * das zweite braucht jeden einzelnen Messwert:
 *
 *   1. das Etikett `source` (`net_signed`/`import_export_split` ⇒ Einspeisung liegt vor), und
 *   2. ob IRGENDEIN Messwert negativ ist — über die GANZE Reihe, nicht über eine Stichprobe.
 *
 * Schritt 2 ist kein Gürtel-und-Hosenträger, sondern die Antwort auf einen bekannten, gemessenen
 * Parser-Defekt: die Vorzeichen-Erkennung liest nur die ersten 60 Zeilen (`parser/detect.ts`, dort
 * als `[ANNAHME]` vermerkt). Ein signierter Lastgang, dessen erste Einspeisung spät im Jahr liegt,
 * wird deshalb als `import_only` etikettiert — für die ZAHLEN folgenlos (`normalizeLoad` klemmt bei
 * `import_only` nichts weg), für DIESE Regel nicht: er bekäme den Generator angeboten, obwohl er
 * Einspeisung trägt, und die geschätzte Erzeugung käme zur gemessenen hinzu.
 *
 * ⚠ DARAUS FOLGT DER GANZE ZUSCHNITT DIESER DATEI. Der volle `LoadProfile` (bis zu 35.040 Messwerte)
 * entsteht HIER und endet HIER; heraus kommt eine Antwort mit höchstens einem Grund. Er ist genau
 * die Datei, die dieses Projekt am striktesten schützt — ihn durch eine Server Action und in einen
 * Entwurf zu reichen, nur um eine Ja/Nein-Frage zu beantworten, wäre die teuerste denkbare Form
 * dieser Prüfung.
 *
 * ⚠ UND DESHALB DER **VOLLE** PARSER, NICHT DER METADATEN-LESER. `readLoadProfileMetadata`
 * (`load-profile/extract.ts` nebenan) liefert Zeitraum, Intervall und Lücken — aber KEINE
 * Messwerte, und damit kann es Schritt 2 strukturell nicht beantworten. Wer diese Datei später
 * „vereinfacht", indem er auf den Metadaten-Leser umstellt, bekommt eine Prüfung, die nur noch das
 * Etikett liest: sie bliebe grün, wäre schneller, und liesse genau den Fall durch, gegen den sie
 * gebaut ist.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ BEGRÜNDETE ABWEICHUNG VON DER AUFGABENSTELLUNG: BYTES STATT EINER DOKUMENT-KENNUNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Der Auftrag nannte `checkPvGeneratorEligibility(documentId: string)` und „liest das Dokument über
 * `readProjectDocument`". Das ist von hier aus nicht erreichbar, und zwar strukturell:
 *
 *   `readProjectDocument` liegt in `apps/web/lib/project-documents/documents.ts` und zieht
 *   `@/lib/supabase/server` — also `@supabase/ssr` und `next/headers`. `packages/extractors` hängt
 *   an `@anthropic-ai/sdk`, `engine`, `server-only` und `shared`, an sonst nichts; ein Paket
 *   importiert keine App (kein Alias, keine Workspace-Abhängigkeit). Und es dürfte es auch nicht:
 *   `apps/website` importiert dieses Paket ebenfalls, und eine Abhängigkeit auf den Request-Kontext
 *   von Next zöge sie dort mit hinein.
 *
 * Gebaut ist deshalb dasselbe Verhältnis, das der Lastgang-Leser nebenan seit B24 hat: **die App
 * liest das Dokument, dieses Paket liest die Datei.** `readProjectDocument(documentId)` steht im
 * Aufrufer (Phase B) — genau wie in `data-entry-actions-lastgang.ts`, wo die Action die Bytes holt
 * und `readLoadProfile(bytes, file.name)` ruft. Die Zusage, auf die es ankommt, ist davon
 * unberührt: der volle Lastgang bleibt hinter dieser Paketgrenze.
 *
 * ⚠ SIE IST AUS DEMSELBEN GRUND SYNCHRON. Hier wird nichts geholt und nichts abgewartet; ein
 * `Promise` wäre eine Zusage über eine Aussenwelt, die es in dieser Funktion nicht gibt (dieselbe
 * Überlegung wie beim synchronen `readLoadProfile`-Port des Chats).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WAS DER AUFRUFER SELBST ENTSCHEIDET: DER STANDARDPROFIL-FALL
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ein ERZEUGTES Standardprofil (`profileSource === 'standard'`, kein `source_document_id`) gilt
 * ohne Prüfung als angeboten — es gibt keine Datei, keine Einzelmesswerte, an denen sich
 * Einspeisung erkennen liesse, und es ist per Konstruktion lückenlos und strikt positiv. Diese
 * Fallunterscheidung trifft die Admin-Action (Phase B) an `profileSource`, BEVOR sie hierher kommt:
 * ohne Dokument gibt es nichts zu lesen. Eine Entsprechung in dieser Datei wäre ein Zweig ohne
 * Eingabe.
 */

/**
 * Die Antwort auf die Anbietbarkeits-Frage. Diskriminiert — der Aufrufer muss verzweigen.
 *
 * ⚠ VIER GRÜNDE, UND GENAU EINER DAVON IST FACHLICH. `measured_feed_in` ist die Auskunft aus
 * Pflichtenheft §2.4 („die Ersparnis steht dort bereits, sie ist gemessen") und gehört dem Kunden
 * gegenüber BEGRÜNDET angezeigt. Die drei übrigen heissen samt und sonders „wir konnten es nicht
 * prüfen" und sind ein Betriebszustand.
 *
 * Sie sind trotzdem EINZELN benannt und nicht zu einem `unknown` zusammengefasst: der Auftrag
 * verlangt „benannt, nicht stumm", und die drei zeigen auf verschiedene Stellen — eine zu grosse
 * Datei auf zwei auseinandergelaufene Konstanten, uneindeutige Spalten auf einen realen
 * Mehrzähler-Export, ein Parser-Fehler auf die Datei selbst. Zusammengefasst stünde im Protokoll
 * dreimal dasselbe Wort und niemand wüsste, wo zu suchen ist.
 *
 * ⚠ ALLE VIER FÜHREN ZU `offered: false`. Fail closed ist hier die einzig vertretbare Richtung:
 * wer im Zweifel anbietet, addiert eine geschätzte Erzeugung auf eine womöglich bereits gemessene
 * — und das Ergebnis sähe nicht falsch aus, sondern nur besser.
 */
export type PvGeneratorEligibilityOutcome =
  /** Der Generator darf angeboten werden: reiner Bezugs-Lastgang, kein einziger negativer Messwert. */
  | { offered: true }
  /** Einspeisung liegt GEMESSEN vor (§2.4). Die fachliche Antwort — anzeigen und begründen. */
  | { offered: false; reason: 'measured_feed_in' }
  /**
   * Die Datei überschreitet die Grenze des Lesers.
   *
   * ⚠ Über den Wizard-Weg unerreichbar, solange die ABLAGE bei 20 MB deckelt
   * (`MAX_PROJECT_DOCUMENT_BYTES`) und diese Grenze bei 25 MB liegt: was hier ankommt, war schon
   * beim Hochladen kleiner. Trotzdem behandelt statt ignoriert — die zwei Zahlen liegen in zwei
   * Paketen, und wer die eine hebt, soll hier keine unbeantwortete Antwort vorfinden.
   */
  | { offered: false; reason: 'too_large'; sizeBytes: number; maxBytes: number }
  /**
   * Mehrere plausible Wert-Spalten, keine eindeutige Zuordnung (OP#4, Format A — ein
   * Netzbetreiber-Export mit mehreren Zählpunkten).
   *
   * ⚠ HIER WIRD NICHT GERATEN, und das ist gerade in DIESER Prüfung wesentlich: unter den nicht
   * zugeordneten Spalten kann eine EINSPEISE-Spalte sein. Sie zu übergehen hiesse, den Generator
   * ausgerechnet dem Kunden anzubieten, dessen Einspeisung wir nur nicht aufgelöst haben.
   */
  | { offered: false; reason: 'ambiguous_columns' }
  /**
   * Die Datei liess sich nicht (mehr) lesen. `code` ist der Grund des Parsers und dient der
   * Diagnose — er ist ausdrücklich NICHT für die Anzeige gedacht.
   *
   * ⚠ Der Regelfall dahinter ist unangenehm und real: dieselbe Datei wurde beim Hochladen bereits
   * erfolgreich gelesen. Kommt hier ein Fehler, hat sich etwas am Leser geändert — und das gehört
   * benannt, nicht in ein stilles „kein Generator".
   */
  | { offered: false; reason: 'unreadable'; code: ParseErrorCode }

/**
 * Liest die Lastgang-Datei vollständig und beantwortet ausschliesslich die Anbietbarkeits-Frage.
 *
 * @param bytes    Der rohe Dateiinhalt — in Phase B aus `readProjectDocument(documentId)`.
 * @param fileName Der Name, unter dem die Datei abgelegt wurde; er entscheidet über CSV gegen XLSX
 *                 und über nichts sonst.
 */
export function checkPvGeneratorEligibility(
  bytes: ArrayBuffer,
  fileName: string,
): PvGeneratorEligibilityOutcome {
  if (bytes.byteLength > MAX_LOAD_PROFILE_FILE_BYTES) {
    return {
      offered: false,
      reason: 'too_large',
      sizeBytes: bytes.byteLength,
      maxBytes: MAX_LOAD_PROFILE_FILE_BYTES,
    }
  }

  /*
   * ⚠ CSV MUSS ALS TEXT HEREINKOMMEN, XLSX ALS BYTES — wortgleich zum Lastgang- und PV-Leser
   * nebenan. `extractTable` entscheidet daran, welchen Weg es nimmt; ein CSV als ArrayBuffer
   * übergeben liefe in den XLSX-Leser und schlüge fehl. Die Unterscheidung fällt am DATEINAMEN,
   * weil der `content_type` eines Dokuments eine ANGABE des Browsers ist (Spaltenkommentar
   * `platform.project_documents.content_type`) und für CSV regelmässig `application/vnd.ms-excel`
   * gemeldet wird.
   */
  const isXlsx = /\.xlsx?$/i.test(fileName.trim())

  const parsed = parseLoadProfile({
    content: isXlsx ? bytes : new TextDecoder().decode(bytes),
    fileName,
    format: isXlsx ? 'xlsx' : 'csv',
  })

  if (!parsed.ok) {
    /*
     * `needs_mapping` ist KEIN Fehler der Datei — sie ist lesbar, nur nicht eindeutig. Die
     * Unterscheidung kostet hier eine Zeile und spart dem Aufrufer die falsche Meldung.
     */
    if (parsed.kind === 'needs_mapping') return { offered: false, reason: 'ambiguous_columns' }
    return { offered: false, reason: 'unreadable', code: parsed.error.code }
  }

  /*
   * ⚠ DIE ENTSCHEIDUNG SELBST FÄLLT IN DER ENGINE, NICHT HIER. `pvGeneratorEligibility` ist dort
   * geprüft und trägt die Begründung beider Prüfungen; sie hier nachzubauen wäre eine zweite
   * Fassung derselben Regel — und die erste, die beim nächsten Umbau auseinanderliefe. Diese Datei
   * beschafft die Eingabe und gibt die Antwort weiter, mehr nicht.
   */
  return pvGeneratorEligibility(parsed.profile)
}
