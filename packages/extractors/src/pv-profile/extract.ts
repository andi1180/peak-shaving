import 'server-only'

import { readPvProfileMetadata, type PvProfileScan } from 'engine'

import { MAX_PV_PROFILE_FILE_BYTES } from './limits'

/**
 * B24, Teil 1 — DER PV-ERZEUGUNGS-LESER DES WIZARDS. Der zweite Extraktor dieses Pakets OHNE
 * Modellaufruf.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ HIER STEHT KEINE LESE-LOGIK, UND DAS IST DER GANZE PUNKT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Wortgleich zum Lastgang-Adapter nebenan: Diese Datei prueft die Groesse, macht aus einem Buffer
 * die Eingabe der Engine und reicht das Ergebnis durch — sie erkennt kein Format, parst kein Datum
 * und zaehlt keine Luecke. Das alles steht in `packages/engine/src/parser/metadata.ts`, und zwar
 * aus denselben zwei Gruenden:
 *
 *   (a) Die Format-Kenntnis eines oesterreichischen PV-Exports (deutsche Monatsnamen,
 *       Split-Timestamp, Dezimalkomma, XLSX-String-Zellen, der Wechselrichter-/ESS-Export mit
 *       mehreren Leistungsspalten) liegt bereits im Parser-Verzeichnis der Engine und ist in OP#4
 *       an ECHTEN Dateien gemessen. Sie hier noch einmal auszuschreiben waere exakt die Doppelung,
 *       gegen die dieses Paket gebaut wurde.
 *   (b) Dieses Paket ist `server-only`. Ein PV-Leser muss browser-faehig bleiben — im oeffentlichen
 *       Rechner liest `apps/website` das Erzeugungsprofil client-seitig (Prinzip 4, Delta 9b-1);
 *       hinter `import 'server-only'` waere die Logik fuer jenen Weg strukturell unerreichbar.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ES GEHT NICHTS HINAUS — WEDER AN EIN MODELL NOCH SONSTWOHIN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Das Lesen ist DETERMINISTISCH und findet im selben Prozess statt. Eine Erzeugungsreihe traegt
 * 35.040 Zahlen und keinen Text; sie an ein Modell zu schicken waere sinnlos und in jeder Hinsicht
 * teuer. Deshalb hat dieses Verzeichnis KEINEN `ai-client`, und deshalb steht es in keinem
 * ESLint-Block: es gibt hier nichts zu sperren.
 *
 * Heraus kommen Zeitpunkte und Zahlen ueber die Reihe, nie die Reihe selbst — die Bedingung dafuer,
 * dass das Ergebnis im Entwurf eines Zaehlpunkts gespeichert werden darf, ohne einen zweiten
 * Speicherort fuer dieselben Erzeugungsdaten zu schaffen.
 */

/** Was aus einer PV-Erzeugungsdatei herauskommen kann. Diskriminiert — der Aufrufer muss verzweigen. */
export type PvProfileOutcome =
  | { ok: true; scan: PvProfileScan }
  /**
   * ⚠ NUR die Groesse, und sie wird VOR dem Parsen geprueft. Es gibt bewusst KEIN `not_configured`
   * und KEIN `api_error` (nichts einzurichten, nichts, was ausfallen koennte) — sie hier
   * mitzufuehren waere eine Requisite.
   */
  | { ok: false; reason: 'too_large'; sizeBytes: number; maxBytes: number }

/**
 * Liest Zeitraum, Intervall und Luecken einer PV-Erzeugungsdatei.
 *
 * @param bytes    Der rohe Dateiinhalt.
 * @param fileName Der Name, unter dem der Admin die Datei abgelegt hat — er entscheidet ueber
 *                 CSV gegen XLSX und ueber nichts sonst.
 */
export function readPvProfile(bytes: ArrayBuffer, fileName: string): PvProfileOutcome {
  if (bytes.byteLength > MAX_PV_PROFILE_FILE_BYTES) {
    return {
      ok: false,
      reason: 'too_large',
      sizeBytes: bytes.byteLength,
      maxBytes: MAX_PV_PROFILE_FILE_BYTES,
    }
  }

  /*
   * ⚠ CSV MUSS ALS TEXT HEREINKOMMEN, XLSX ALS BYTES. `extractTable` entscheidet daran, welchen
   * Weg es nimmt; ein CSV als ArrayBuffer uebergeben liefe in den XLSX-Leser und schluege fehl.
   * Die Unterscheidung faellt am Dateinamen, weil der `content_type` eines Dokuments eine ANGABE
   * des Browsers ist (Spaltenkommentar `project_documents.content_type`) und fuer CSV regelmaessig
   * `application/vnd.ms-excel` gemeldet wird.
   */
  const isXlsx = /\.xlsx?$/i.test(fileName.trim())

  return {
    ok: true,
    scan: readPvProfileMetadata({
      content: isXlsx ? bytes : new TextDecoder().decode(bytes),
      fileName,
      format: isXlsx ? 'xlsx' : 'csv',
    }),
  }
}
