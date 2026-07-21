/**
 * B14-1 — Archivierung der Quelldatei einer Analyse: gzip-Komprimierung, Dekomprimierung und
 * SHA-256 über die UNKOMPRIMIERTE Fassung.
 *
 * ── WARUM HIER UND NICHT IN /packages/engine ────────────────────────────────────────────────────
 * Archivieren ist keine Rechnung. `engine` ist der Rechenkern; dieses Modul wird vom SCHREIBWEG
 * (B14-2) und vom DB-Gate benutzt, nicht von der Simulation. `shared` ist die Stelle, an der beide
 * Seiten sich treffen — dieselbe Rolle, die es für den Contract (§3.1/§3.10) schon spielt.
 *
 * ── WARUM WEB-STREAMS UND NICHT node:zlib ───────────────────────────────────────────────────────
 * `shared` wird in `apps/website` CLIENT-SEITIG gebündelt (transpilePackages). Ein `node:zlib`- oder
 * `node:crypto`-Import machte das Paket node-gebunden und bräche die Bündelung für den öffentlichen
 * Rechner — genau die Isomorphie-Zusage, unter der Engine und Contract stehen. `CompressionStream`,
 * `DecompressionStream` und `crypto.subtle` sind in Node ≥ 18 UND in jedem Zielbrowser vorhanden
 * und liefern in beiden Umgebungen dasselbe Ergebnis.
 *
 * ── DIE PRÜFSUMME GILT DER UNKOMPRIMIERTEN DATEI ────────────────────────────────────────────────
 * Bewusst nicht dem Blob: gzip ist NICHT bit-deterministisch — Implementierung, Version und
 * Kompressionsstufe dürfen ein anderes, gleichwertiges Ergebnis liefern. Eine Prüfsumme über den
 * Blob wäre damit eine Aussage über den Komprimierer, nicht über die Datei, und ein späterer
 * Wechsel des Laufzeit-Unterbaus liesse jede alte Zeile „falsch" aussehen. Die Identität der Datei
 * darf nicht von der Kompression abhängen.
 *
 * Rein und ohne Seiteneffekte: kein Datei-I/O, kein Datenbankbezug, kein globaler Zustand.
 */

/** Minimale gzip-Länge: 10 Byte Kopf + 8 Byte Abschluss (RFC 1952). */
const GZIP_MIN_LENGTH = 18

/**
 * Ergebnis von {@link packSourceFile} — genau die drei Grössen, die `platform.analyses` für die
 * archivierte Quelldatei führt (`source_file_sha256`, `source_file_gzip`) plus die unkomprimierte
 * Länge, mit der die Datenbank Blob und Prüfsumme aneinander bindet.
 */
export type PackedSourceFile = {
  /** SHA-256 der UNKOMPRIMIERTEN Datei, Kleinbuchstaben-Hex (64 Zeichen). */
  sha256: string
  /** gzip-Fassung — das, was archiviert wird. */
  gzip: Uint8Array
  /** Länge der unkomprimierten Datei in Byte. */
  byteLength: number
}

// Rückgabetyp bewusst INFERIERT statt `: SubtleCrypto`: `packages/engine` typprüft die Quellen
// dieses Pakets mit (Source-Exporte, kein Build-Zwang) und kennt den globalen Typnamen dort nicht —
// die Node-Deklarationen führen ihn unter `webcrypto.SubtleCrypto`. Der Wert ist in beiden
// Umgebungen derselbe, nur sein Name nicht.
function subtle() {
  const c = globalThis.crypto
  if (!c?.subtle) {
    // Laut scheitern statt still auf eine schwächere Prüfsumme auszuweichen: eine Prüfsumme, die
    // je nach Umgebung eine andere Funktion ist, belegt gar nichts.
    throw new Error(
      'archive: WebCrypto (globalThis.crypto.subtle) nicht verfügbar — Node ≥ 18 bzw. ein ' +
        'sicherer Kontext (https/localhost) ist Voraussetzung',
    )
  }
  return c.subtle
}

/** Liest einen Stream vollständig in EINEN zusammenhängenden Puffer. */
async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/**
 * `Uint8Array` → eigenständiger `ArrayBuffer`.
 *
 * Nötig, weil eine `Uint8Array` eine SICHT auf einen möglicherweise grösseren Puffer sein kann
 * (`Buffer.from(x)` in Node teilt sich regelmässig einen Pool-Puffer mit fremden Daten). `.buffer`
 * blind an WebCrypto zu reichen hiesse, über den Pool-Nachbarn mitzuhashen — der Fehler ist still
 * und tritt nur bei bestimmten Puffergrössen auf.
 */
function ownBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}

/** SHA-256 als Kleinbuchstaben-Hex — dieselbe Darstellung wie `encode(sha256(...), 'hex')` in der DB. */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await subtle().digest('SHA-256', ownBuffer(data))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** gzip-Komprimierung (RFC 1952). */
export async function gzipCompress(data: Uint8Array): Promise<Uint8Array> {
  const source = new Blob([ownBuffer(data)]).stream()
  return drain(source.pipeThrough(new CompressionStream('gzip')))
}

/**
 * gzip-Dekomprimierung. Wirft bei beschädigten oder fremden Daten — ein stiller Teilerfolg wäre
 * bei einem Archiv die gefährlichste Antwort (er sähe aus wie eine kürzere Datei).
 */
export async function gzipDecompress(gzip: Uint8Array): Promise<Uint8Array> {
  if (gzip.byteLength < GZIP_MIN_LENGTH || gzip[0] !== 0x1f || gzip[1] !== 0x8b) {
    throw new Error('archive: kein gzip-Datenstrom (Kennung 1f 8b fehlt oder Länge < 18 Byte)')
  }
  const source = new Blob([ownBuffer(gzip)]).stream()
  return drain(source.pipeThrough(new DecompressionStream('gzip')))
}

/**
 * Bereitet eine Quelldatei fürs Archiv auf: Prüfsumme über das ORIGINAL, gzip daneben.
 *
 * Die Reihenfolge ist Bedeutung: die Prüfsumme entsteht vor der Kompression und beschreibt damit
 * die Datei, die der Kunde geschickt hat — nicht das Ergebnis eines Komprimierers.
 */
export async function packSourceFile(data: Uint8Array): Promise<PackedSourceFile> {
  const [sha256, gzip] = await Promise.all([sha256Hex(data), gzipCompress(data)])
  return { sha256, gzip, byteLength: data.byteLength }
}

/**
 * Gegenstück zu {@link packSourceFile}: packt aus UND prüft gegen die erwartete Prüfsumme.
 *
 * Die Prüfung gehört auf den LESEWEG und nicht in den Aufrufer: eine archivierte Datei, die
 * niemand mehr gegen ihre Prüfsumme hält, ist eine Datei ohne Beleg — und der Schaden fiele erst
 * dann auf, wenn sie gebraucht wird (2027, beim Wirkungsnachweis).
 */
export async function unpackSourceFile(
  gzip: Uint8Array,
  expectedSha256: string,
): Promise<Uint8Array> {
  const data = await gzipDecompress(gzip)
  const actual = await sha256Hex(data)
  if (actual !== expectedSha256.trim().toLowerCase()) {
    throw new Error(
      `archive: Prüfsumme der entpackten Datei weicht ab (erwartet ${expectedSha256}, ` +
        `berechnet ${actual})`,
    )
  }
  return data
}
