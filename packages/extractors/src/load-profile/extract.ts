import 'server-only'

import { readLoadProfileMetadata, type LoadProfileScan } from 'engine'

import { MAX_LOAD_PROFILE_FILE_BYTES } from './limits'

/**
 * B24, Teil 1 — DER LASTGANG-LESER DES CHATS. Der einzige Extraktor dieses Pakets OHNE Modellaufruf.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ HIER STEHT KEINE LESE-LOGIK, UND DAS IST DER GANZE PUNKT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Diese Datei ist ein ADAPTER. Sie prueft die Groesse, macht aus einem Buffer die Eingabe der
 * Engine und reicht das Ergebnis durch — sie erkennt kein Format, parst kein Datum und zaehlt keine
 * Luecke. Das alles steht in `packages/engine/src/parser/metadata.ts`, und der Kopf jener Datei
 * begruendet ausfuehrlich, warum:
 *
 *   (a) Die gesamte Format-Kenntnis eines oesterreichischen Lastgang-Exports liegt bereits im
 *       Parser-Verzeichnis der Engine — Split-Timestamp, deutsche Monatsnamen, Mehrspalten-Mapping
 *       mit Summierung, EEG-Spalten, die Ablehnung von Wechselrichter-Logs. Jede dieser Regeln ist
 *       in OP#4 an ECHTEN Exporten gemessen. Sie hier noch einmal auszuschreiben waere exakt die
 *       Doppelung, gegen die dieses Paket gebaut wurde.
 *   (b) Dieses Paket ist `server-only`. Ein Lastgang-Leser muss browser-faehig bleiben: im
 *       oeffentlichen Rechner verlaesst der Lastgang das Geraet nicht (Prinzip 4), und
 *       `apps/website` liest ihn client-seitig mit genau diesen Modulen. Laege die Logik hinter
 *       `import 'server-only'`, waere sie fuer jenen Weg strukturell unerreichbar.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ES GEHT NICHTS HINAUS — WEDER AN EIN MODELL NOCH SONSTWOHIN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Die vier Geschwister dieses Pakets schicken ein Kundendokument an Anthropic; das ist dort die
 * benannte, begruendete Ausnahme von Prinzip 4. Hier nicht: das Lesen ist DETERMINISTISCH und
 * findet im selben Prozess statt. Ein Lastgang ist ausserdem genau die Datei, die dieses Projekt
 * am striktesten schuetzt — sie an ein Modell zu schicken waere sinnlos (er traegt 35.040 Zahlen
 * und keinen Text) und teuer in jeder Hinsicht. Deshalb hat dieses Verzeichnis KEINEN `ai-client`,
 * und deshalb steht es in keinem ESLint-Block: es gibt hier nichts zu sperren.
 *
 * Heraus kommen Zeitpunkte und Zahlen ueber die Reihe, nie die Reihe selbst — die Bedingung dafuer,
 * dass das Ergebnis in `platform.metering_points` gespeichert werden darf, ohne einen zweiten
 * Speicherort fuer dieselben Verbrauchsdaten zu schaffen.
 */

/** Was aus einem Lastgang-Dokument herauskommen kann. Diskriminiert — der Aufrufer muss verzweigen. */
export type LoadProfileOutcome =
  | { ok: true; scan: LoadProfileScan }
  /**
   * ⚠ NUR die Groesse, und sie wird VOR dem Parsen geprueft. Es gibt bewusst KEIN `not_configured`
   * und KEIN `api_error` (nichts einzurichten, nichts, was ausfallen koennte) — die vier
   * KI-Extraktoren haben beide, und sie hier mitzufuehren waere eine Requisite.
   */
  | { ok: false; reason: 'too_large'; sizeBytes: number; maxBytes: number }

/**
 * Liest Zeitraum, Intervall und Luecken eines Lastgang-Dokuments.
 *
 * @param bytes    Der rohe Dateiinhalt.
 * @param fileName Der Name, unter dem der Kunde die Datei abgelegt hat — er entscheidet ueber
 *                 CSV gegen XLSX und ueber nichts sonst.
 */
export function readLoadProfile(bytes: ArrayBuffer, fileName: string): LoadProfileOutcome {
  if (bytes.byteLength > MAX_LOAD_PROFILE_FILE_BYTES) {
    return {
      ok: false,
      reason: 'too_large',
      sizeBytes: bytes.byteLength,
      maxBytes: MAX_LOAD_PROFILE_FILE_BYTES,
    }
  }

  /*
   * ⚠ CSV MUSS ALS TEXT HEREINKOMMEN, XLSX ALS BYTES. `extractTable` entscheidet daran, welchen
   * Weg es nimmt; ein CSV als ArrayBuffer uebergeben laefe in den XLSX-Leser und schluege fehl.
   * Die Unterscheidung faellt am Dateinamen, weil der `content_type` eines Dokuments eine ANGABE
   * des Kunden ist (Spaltenkommentar `project_documents.content_type`) und der Browser fuer CSV
   * regelmaessig `application/vnd.ms-excel` meldet.
   */
  const isXlsx = /\.xlsx?$/i.test(fileName.trim())

  return {
    ok: true,
    scan: readLoadProfileMetadata({
      content: isXlsx ? bytes : new TextDecoder().decode(bytes),
      fileName,
      format: isXlsx ? 'xlsx' : 'csv',
    }),
  }
}
