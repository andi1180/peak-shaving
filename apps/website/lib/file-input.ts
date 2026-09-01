/**
 * Eine hochgeladene Datei so einlesen, dass Prüfsumme und geparster Inhalt AUS DERSELBEN Lesung
 * stammen.
 *
 * ── WARUM DAS EIN EIGENES MODUL IST (Delta 17) ────────────────────────────────────────────────
 * Bis hierher stand diese Funktion als lokale Hilfe in `components/flow/step-upload.tsx`. Mit dem
 * vierten Einstieg gibt es einen zweiten Aufrufer (`mixed-upload-panel.tsx`), und eine zweite
 * Abschrift wäre genau an der Stelle entstanden, an der es am meisten kostet: die Bytes sind das
 * Einzige, was ein Analyse-Bündel an seine Ursprungsdatei bindet (B14-2). Zwei Lesewege, die
 * auseinanderlaufen, erzeugten eine Prüfsumme über eine andere Fassung als die gerechnete — und
 * der Fehler fiele erst beim Archivieren auf, also nachdem der Kunde bedient ist.
 *
 * Verhaltensgleich zur bisherigen Fassung; nur der Ort hat sich geändert.
 */

export type ParseInput = {
  content: string | ArrayBuffer
  fileName: string
  format: 'csv' | 'xlsx'
  /**
   * B14-2: die rohen Bytes derselben Datei. Sie werden mitgeführt, damit die Prüfsumme des
   * Analyse-Bündels über die TATSÄCHLICH verarbeitete Ursprungsdatei entsteht — auch im
   * Mapping-Fall, in dem dieselbe Datei ein zweites Mal geparst wird.
   */
  bytes: Uint8Array
}

export async function readForParsing(file: File): Promise<ParseInput> {
  const isXlsx = /\.(xlsx|xls)$/i.test(file.name)
  /*
   * EINMAL lesen, zweimal verwenden: der Puffer geht als `bytes` in die Prüfsumme und — bei CSV —
   * als daraus dekodierter Text in den Parser. `new TextDecoder()` liefert dasselbe wie
   * `file.text()` (beides ist UTF-8-Dekodierung samt BOM-Entfernung, so die Datei-API-Spezifikation);
   * zweimal zu lesen hiesse dagegen, dass Prüfsumme und geparster Inhalt aus zwei Lesevorgängen
   * stammen — bei einer Datei, die sich zwischendurch ändert, wären sie verschiedene Dateien.
   */
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const content = isXlsx ? buffer : new TextDecoder().decode(bytes)
  return { content, fileName: file.name, format: isXlsx ? 'xlsx' : 'csv', bytes }
}
