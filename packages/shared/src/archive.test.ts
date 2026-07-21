import { describe, expect, it } from 'vitest'

import { gzipCompress, gzipDecompress, packSourceFile, sha256Hex, unpackSourceFile } from './archive'

// B14-1 TEIL 3 — Rundlauf der Archivierungskette.
//
// ── WARUM MIT EINER ECHT GROSSEN DATEI ──────────────────────────────────────────────────────────
// Drei Zeilen beweisen hier nichts: die Grenzfälle dieser Kette treten erst bei realer Grösse auf.
// Ein Web-Stream liefert seine Ausgabe in MEHREREN Blöcken, sobald sie eine interne Puffergrösse
// überschreitet — bei drei Zeilen kommt genau ein Block, und ein fehlerhaftes Zusammensetzen der
// Blöcke bliebe unentdeckt. Ebenso greift `Buffer`-Pooling (eine Uint8Array als Sicht auf einen
// grösseren, fremd belegten Puffer) erst oberhalb bestimmter Grössen.
//
// Ein voller Jahres-Lastgang hat 35.040 Viertelstundenwerte (§3.2); der Testdatensatz liegt mit
// 35.040 Zeilen genau dort und ist deterministisch erzeugt (kein Zufall, keine Uhrzeit).

/** Synthetischer Jahres-Lastgang im Format des Demo-Bäckers: `TT.MM.JJJJ HH:MM;Wert`. */
function syntheticQuarterHourCsv(rows: number): string {
  const lines: string[] = ['Zeitstempel;Wirkleistung [kW]']
  const start = Date.UTC(2026, 0, 1, 0, 0, 0)
  for (let i = 0; i < rows; i++) {
    const t = new Date(start + i * 15 * 60_000)
    const dd = String(t.getUTCDate()).padStart(2, '0')
    const mm = String(t.getUTCMonth() + 1).padStart(2, '0')
    const hh = String(t.getUTCHours()).padStart(2, '0')
    const mi = String(t.getUTCMinutes()).padStart(2, '0')
    // Deterministische, aber nicht triviale Werte: eine reine Konstante liesse sich auf wenige Byte
    // komprimieren und wäre damit kein realistischer Prüfstein für die Kette.
    const kw = (12 + 8 * Math.sin(i / 96) + (i % 37) / 10).toFixed(3).replace('.', ',')
    lines.push(`${dd}.${mm}.${t.getUTCFullYear()} ${hh}:${mi};${kw}`)
  }
  return lines.join('\r\n') + '\r\n'
}

const encoder = new TextEncoder()

describe('archive — Rundlauf mit einem vollen Jahres-Lastgang', () => {
  const csv = syntheticQuarterHourCsv(35_040)
  const original = encoder.encode(csv)

  it('die Testdatei ist realistisch gross (35.040 Viertelstundenwerte, > 500 kB)', () => {
    expect(csv.split('\r\n').filter(Boolean).length).toBe(35_041) // + Kopfzeile
    expect(original.byteLength).toBeGreaterThan(500_000)
  })

  it('komprimieren → dekomprimieren liefert BYTE-IDENTISCH dieselbe Datei', async () => {
    const gzip = await gzipCompress(original)
    const back = await gzipDecompress(gzip)

    expect(back.byteLength).toBe(original.byteLength)
    // Nicht nur Länge und Prüfsumme: der direkte Byte-Vergleich ist der eigentliche Nachweis.
    expect(Buffer.from(back).equals(Buffer.from(original))).toBe(true)
    // Und die Kompression lohnt sich überhaupt — sonst wäre der Blob nur Umstand.
    expect(gzip.byteLength).toBeLessThan(original.byteLength / 2)
  })

  it('die Prüfsumme gilt der UNKOMPRIMIERTEN Fassung und übersteht den Rundlauf unverändert', async () => {
    const before = await sha256Hex(original)
    const packed = await packSourceFile(original)
    const back = await gzipDecompress(packed.gzip)
    const after = await sha256Hex(back)

    expect(packed.sha256).toBe(before)
    expect(after).toBe(before)
    expect(packed.byteLength).toBe(original.byteLength)
    // 64 Hex-Zeichen in Kleinbuchstaben — dieselbe Darstellung wie encode(sha256(...), 'hex') in
    // PostgreSQL. Weicht die Schreibweise ab, schlägt der Vergleich im Wrapper fehl.
    expect(packed.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('unpackSourceFile gibt die Datei zurück, wenn die Prüfsumme stimmt', async () => {
    const packed = await packSourceFile(original)
    const back = await unpackSourceFile(packed.gzip, packed.sha256)
    expect(Buffer.from(back).equals(Buffer.from(original))).toBe(true)
  })

  it('unpackSourceFile WIRFT bei abweichender Prüfsumme (kein stiller Teilerfolg)', async () => {
    const packed = await packSourceFile(original)
    await expect(unpackSourceFile(packed.gzip, 'f'.repeat(64))).rejects.toThrow(/Prüfsumme/)
  })

  it('sha256Hex hasht die DATEI, nicht den umgebenden Puffer', async () => {
    // Die Sicht auf einen grösseren Puffer (Node-Buffer-Pooling, `subarray`) ist der reale Fall:
    // würde blind `.buffer` gehasht, flösse fremder Inhalt mit ein — still und nur bei bestimmten
    // Puffergrössen.
    const big = new Uint8Array(original.byteLength + 128)
    big.fill(0xff)
    big.set(original, 64)
    const view = big.subarray(64, 64 + original.byteLength)

    expect(await sha256Hex(view)).toBe(await sha256Hex(original))
    expect(Buffer.from(await gzipDecompress(await gzipCompress(view))).equals(Buffer.from(original)))
      .toBe(true)
  })
})

describe('archive — Grenzfälle', () => {
  it('lehnt Daten ab, die kein gzip-Datenstrom sind', async () => {
    await expect(gzipDecompress(encoder.encode('Zeitstempel;kW\r\n01.01.2026 00:00;12'))).rejects
      .toThrow(/kein gzip/)
    await expect(gzipDecompress(new Uint8Array([0x1f, 0x8b]))).rejects.toThrow(/kein gzip/)
  })

  it('erkennt eine beschädigte gzip-Nutzlast, statt still eine kürzere Datei zu liefern', async () => {
    const gzip = await gzipCompress(encoder.encode('x'.repeat(50_000)))
    const damaged = gzip.slice()
    // Mitten in den komprimierten Daten kippen — Kennung und Länge bleiben unauffällig.
    damaged[Math.floor(damaged.byteLength / 2)] ^= 0xff
    await expect(gzipDecompress(damaged)).rejects.toThrow()
  })

  it('eine leere Datei bleibt eine leere Datei (und hat die bekannte SHA-256 des Leerworts)', async () => {
    const empty = new Uint8Array(0)
    const packed = await packSourceFile(empty)
    expect(packed.byteLength).toBe(0)
    expect(packed.sha256).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect((await gzipDecompress(packed.gzip)).byteLength).toBe(0)
  })
})
