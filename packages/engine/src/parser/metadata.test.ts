import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  GAP_TOLERANCE_INTERVALS,
  readLoadProfileMetadata,
  readPvProfileMetadata,
} from './metadata'

/**
 * B24, Teil 1 — der Metadaten-Leser gegen synthetische UND echte Dateien.
 *
 * ── ⚠ DIE ERWARTUNGEN SIND HANDGERECHNET, NICHT AUS DEM CODE ABGELEITET ───────────────────────
 * Die ISO-Zeitpunkte unten stehen als Literale da und werden NICHT aus `readLoadProfileMetadata`
 * zurückgelesen oder mit denselben Helfern gebildet, die die Funktion benutzt. Ein Test, der seine
 * Erwartung aus dem geprüften Code holt, ist eine Tautologie und bliebe auch bei einer verschobenen
 * Zeitzone grün (dieser Fehler ist in diesem Repo schon einmal aufgetreten, s. B21-3c).
 *
 * Gerechnet ist gegen Europe/Vienna: im Juni gilt CEST = UTC+2, im Jänner CET = UTC+1.
 */

const fixture = (name: string) => new URL(`../../../../dev-fixtures/${name}`, import.meta.url)

/** Zweistellig, für die deutsche Datumsschreibweise der Fixture-CSVs. */
function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * Baut einen CSV-Lastgang in LOKALER Schreibweise (`TT.MM.JJJJ HH:MM;Wert`) — dasselbe Format wie
 * `dev-fixtures/demo-baeckerei-lastgang-2025.csv`.
 *
 * `skipDays` lässt ganze Kalendertage WEG (Zeile fehlt komplett), `blankDays` schreibt die Zeile
 * mit LEERER Wertzelle. Das sind zwei verschiedene reale Fälle, und für die Abdeckung müssen beide
 * dasselbe bedeuten: an diesem Zeitpunkt liegt kein Messwert vor.
 *
 * `valueHeader` benennt die Wert-Spalte. Die Vorgabe ist die des Lastgangs — die PV-Fälle weiter
 * unten setzen die Beschriftung einer Erzeugungsdatei, damit im Test keine Datei steht, die es so
 * nirgends gibt. Auf die Erkennung wirkt sie bei zwei Spalten nicht; das ist geprüft, nicht
 * angenommen (dieselbe Datei liest sich unter beiden Beschriftungen gleich).
 */
function buildCsv(options: {
  year: number
  month: number
  firstDay: number
  days: number
  intervalMinutes: number
  skipDays?: number[]
  blankDays?: number[]
  valueHeader?: string
}): string {
  const { year, month, firstDay, days, intervalMinutes } = options
  const skip = new Set(options.skipDays ?? [])
  const blank = new Set(options.blankDays ?? [])
  const perDay = (24 * 60) / intervalMinutes

  const lines = [`Zeitstempel;${options.valueHeader ?? 'Leistung (kW)'}`]
  for (let d = 0; d < days; d++) {
    const day = firstDay + d
    if (skip.has(day)) continue
    for (let slot = 0; slot < perDay; slot++) {
      const minutesOfDay = slot * intervalMinutes
      const stamp =
        `${pad(day)}.${pad(month)}.${year} ` +
        `${pad(Math.floor(minutesOfDay / 60))}:${pad(minutesOfDay % 60)}`
      // Ein sanft schwankender Wert — die Höhe spielt für Metadaten keine Rolle, aber eine
      // konstante Spalte könnte die Wert-Spalten-Erkennung anders behandeln als eine echte Reihe.
      const value = blank.has(day) ? '' : (3 + (slot % 7) * 0.1).toFixed(2).replace('.', ',')
      lines.push(`${stamp};${value}`)
    }
  }
  return lines.join('\n')
}

function scan(content: string) {
  return readLoadProfileMetadata({ content, format: 'csv' }, { timezone: 'Europe/Vienna' })
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('Lücken-Erkennung — die geforderte Positiv-Kontrolle', () => {
  it('⚠ drei fehlende Tage mitten in der Datei ergeben GENAU EINE Lücke mit exakten Rändern', () => {
    // 10 Junitage (01.–10.06.2025), die Tage 04., 05. und 06. fehlen vollständig.
    const out = scan(
      buildCsv({
        year: 2025,
        month: 6,
        firstDay: 1,
        days: 10,
        intervalMinutes: 15,
        skipDays: [4, 5, 6],
      }),
    )
    if (!out.ok || out.needsMapping) throw new Error('ok-Ergebnis ohne Rückfrage erwartet')

    expect(out.intervalMinutes).toBe(15)

    /*
     * Die Ränder sind halboffen: `from` ist der ERSTE Zeitpunkt ohne Messwert (= Ende des letzten
     * vorhandenen Intervalls), `to` der erste Zeitpunkt MIT Messwert danach. Lokal also
     * 04.06. 00:00 bis 07.06. 00:00 — in CEST (UTC+2) zwei Stunden früher.
     */
    expect(out.gaps).toEqual([
      { from: '2025-06-03T22:00:00.000Z', to: '2025-06-06T22:00:00.000Z' },
    ])

    // 7 Tage à 96 Viertelstunden liegen tatsächlich vor.
    expect(out.rowCount).toBe(7 * 96)
    expect(out.coveredFrom).toBe('2025-05-31T22:00:00.000Z') // 01.06. 00:00 Ortszeit
    expect(out.coveredTo).toBe('2025-06-10T22:00:00.000Z') // 10.06. 24:00 Ortszeit
  })

  it('⚠ GEGENPROBE: dieselbe Datei vollständig → gaps ist leer', () => {
    const out = scan(buildCsv({ year: 2025, month: 6, firstDay: 1, days: 10, intervalMinutes: 15 }))
    if (!out.ok || out.needsMapping) throw new Error('ok-Ergebnis ohne Rückfrage erwartet')

    expect(out.gaps).toEqual([])
    // Der Zeitraum ist derselbe — nur die Abdeckung darin ist jetzt lückenlos.
    expect(out.coveredFrom).toBe('2025-05-31T22:00:00.000Z')
    expect(out.coveredTo).toBe('2025-06-10T22:00:00.000Z')
    expect(out.rowCount).toBe(10 * 96)
  })

  it('⚠ eine Zeile mit LEERER Wertzelle zählt als fehlender Messwert, nicht als Abdeckung', () => {
    /*
     * Der reale Fall aus der Sparse-Sample-Runde: der Netzbetreiber liefert durchgehende
     * Zeitstempel, die Wertzellen sind aber leer (Zählpunkt später in Betrieb). Würde der Leser
     * nur die Zeitstempel zählen, sähe die Datei lückenlos aus — und ein Zählpunkt behauptete
     * einen Zeitraum, für den es keine Messung gibt.
     */
    const out = scan(
      buildCsv({
        year: 2025,
        month: 6,
        firstDay: 1,
        days: 10,
        intervalMinutes: 15,
        blankDays: [4, 5, 6],
      }),
    )
    if (!out.ok || out.needsMapping) throw new Error('ok-Ergebnis ohne Rückfrage erwartet')

    expect(out.gaps).toEqual([
      { from: '2025-06-03T22:00:00.000Z', to: '2025-06-06T22:00:00.000Z' },
    ])
    expect(out.rowCount).toBe(7 * 96)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('Lücken-Erkennung — die Toleranzschwelle', () => {
  /**
   * Schneidet aus einem fertigen CSV einzelne Datenzeilen heraus (1-basiert ab der ersten
   * Datenzeile) — so lässt sich eine Lücke auf das einzelne Intervall genau setzen.
   */
  function withoutDataRows(csv: string, indices: number[]): string {
    const drop = new Set(indices)
    const lines = csv.split('\n')
    return lines.filter((_, i) => i === 0 || !drop.has(i)).join('\n')
  }

  const base = buildCsv({ year: 2025, month: 6, firstDay: 1, days: 2, intervalMinutes: 15 })

  it('EIN fehlendes Intervall wird NICHT gemeldet — das ist der Alltag eines Exports', () => {
    const out = scan(withoutDataRows(base, [50]))
    if (!out.ok || out.needsMapping) throw new Error('ok-Ergebnis erwartet')
    expect(out.gaps).toEqual([])
    // Es fehlt trotzdem: die Zahl ist aus rowCount gegen den Zeitraum ableitbar.
    expect(out.rowCount).toBe(2 * 96 - 1)
  })

  it(`ZWEI fehlende Intervalle werden gemeldet — die Schwelle liegt bei ${GAP_TOLERANCE_INTERVALS}`, () => {
    const out = scan(withoutDataRows(base, [50, 51]))
    if (!out.ok || out.needsMapping) throw new Error('ok-Ergebnis erwartet')
    expect(out.gaps).toHaveLength(1)
    expect(out.rowCount).toBe(2 * 96 - 2)
  })

  it('mehrere Lücken kommen in zeitlicher Reihenfolge, auch bei unsortierter Datei', () => {
    const withGaps = withoutDataRows(base, [20, 21, 22, 80, 81])
    const lines = withGaps.split('\n')
    // Datenzeilen absichtlich umdrehen: die Reihenfolge in der Datei darf das Ergebnis nicht ändern.
    const shuffled = [lines[0], ...lines.slice(1).reverse()].join('\n')

    const straight = scan(withGaps)
    const reversed = scan(shuffled)
    if (!straight.ok || straight.needsMapping) throw new Error('ok-Ergebnis erwartet')
    if (!reversed.ok || reversed.needsMapping) throw new Error('ok-Ergebnis erwartet')

    expect(straight.gaps).toHaveLength(2)
    expect(straight.gaps[0]!.from < straight.gaps[1]!.from).toBe(true)
    expect(reversed.gaps).toEqual(straight.gaps)
    expect(reversed.coveredFrom).toBe(straight.coveredFrom)
    expect(reversed.rowCount).toBe(straight.rowCount)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('Doppelte Zeitstempel — Deduplizierung und der Herbst-Artefakt', () => {
  it('⚠ eine wörtlich doppelte Datenzeile zählt EINMAL und erzeugt keine Scheinlücke', () => {
    /*
     * `normalizeLoad` behält die Zeilenreihenfolge der Datei und dedupliziert nichts. Ohne die
     * Deduplizierung in `readLoadProfileMetadata` zählte `rowCount` die Zeile doppelt — und der
     * Abstand 0 zwischen den beiden verfälschte die Intervall-Bestimmung (die häufigste Differenz
     * wäre bei vielen Dubletten 0 statt 15).
     */
    const base = buildCsv({ year: 2025, month: 6, firstDay: 1, days: 2, intervalMinutes: 15 })
    const lines = base.split('\n')
    const doubled = [...lines.slice(0, 41), lines[40]!, ...lines.slice(41)].join('\n')

    const out = scan(doubled)
    if (!out.ok || out.needsMapping) throw new Error('ok-Ergebnis erwartet')

    expect(out.intervalMinutes).toBe(15)
    expect(out.rowCount).toBe(2 * 96)
    expect(out.gaps).toEqual([])
  })

  it('⚠ DER HERBST-ARTEFAKT, gepinnt: die Zeitumstellung erzeugt eine gemeldete Stunden-Lücke', () => {
    /*
     * Am 26.10.2025 kommt die Wanduhr-Stunde 02:00 in Europe/Vienna ZWEIMAL vor, und ein
     * Ortszeit-Export schreibt sie auch zweimal. `zonedWallToUtcMs` löst sie auf GENAU EINEN
     * UTC-Zeitpunkt auf (die erste, sommerzeitliche Belegung); die vier Intervalle der zweiten
     * fallen auf dieselben Zeitstempel und werden dedupliziert. Der UTC-Bereich 01:00–02:00 bleibt
     * dadurch unbelegt und erscheint als Lücke.
     *
     * Das ist eine Eigenschaft der Zeitstempel-Auflösung dieses Parsers, keine Erfindung dieses
     * Lesers — `prepareSeries` dedupliziert identisch und warnt dazu. Sie steht hier als PIN, damit
     * die Zahl niemanden überrascht, der sie in `platform.metering_points.gaps` wiederfindet, und
     * damit ein späterer „Fix" der Zeitzonen-Auflösung sichtbar wird statt still.
     */
    const lines = ['Zeitstempel;Leistung (kW)']
    for (const day of [25, 26, 27]) {
      for (let slot = 0; slot < 96; slot++) {
        const m = slot * 15
        const stamp = `${pad(day)}.10.2025 ${pad(Math.floor(m / 60))}:${pad(m % 60)}`
        lines.push(`${stamp};3,50`)
        // Der Rückfall-Tag trägt die Stunde 02:00 ein zweites Mal — wie ein echter Export.
        if (day === 26 && Math.floor(m / 60) === 2) lines.push(`${stamp};3,60`)
      }
    }

    const out = scan(lines.join('\n'))
    if (!out.ok || out.needsMapping) throw new Error('ok-Ergebnis erwartet')

    expect(out.gaps).toEqual([
      { from: '2025-10-26T00:00:00.000Z', to: '2025-10-26T01:00:00.000Z' },
    ])
    // 3 × 96 statt 3 × 96 + 4: die vier wiederholten Intervalle sind dedupliziert.
    expect(out.rowCount).toBe(288)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('Intervall — 15 und 60 Minuten, sonst nichts', () => {
  it('erkennt Stundenwerte als 60 min — `parseLoadProfile` lehnt genau die ab', () => {
    const out = scan(buildCsv({ year: 2025, month: 6, firstDay: 1, days: 5, intervalMinutes: 60 }))
    if (!out.ok || out.needsMapping) throw new Error('ok-Ergebnis erwartet')

    expect(out.intervalMinutes).toBe(60)
    expect(out.rowCount).toBe(5 * 24)
    // `coveredTo` schlägt die Dauer des LETZTEN Intervalls auf — hier eine Stunde, nicht 15 Minuten.
    expect(out.coveredFrom).toBe('2025-05-31T22:00:00.000Z')
    expect(out.coveredTo).toBe('2025-06-05T22:00:00.000Z')
  })

  it('⚠ bei 60 min ist auch die Lücken-Schwelle eine Stunde je Intervall', () => {
    const hourly = buildCsv({ year: 2025, month: 6, firstDay: 1, days: 5, intervalMinutes: 60 })
    const lines = hourly.split('\n')
    // Zwei Stunden am Stück entfernen (Datenzeilen 30 und 31).
    const out = scan(lines.filter((_, i) => i !== 30 && i !== 31).join('\n'))
    if (!out.ok || out.needsMapping) throw new Error('ok-Ergebnis erwartet')

    expect(out.gaps).toHaveLength(1)
    const gap = out.gaps[0]!
    expect(new Date(gap.to).getTime() - new Date(gap.from).getTime()).toBe(2 * 60 * 60 * 1000)
  })

  it('ein anderes Intervall (5 min) wird ABGEWIESEN statt auf 15 gerundet', () => {
    const out = scan(buildCsv({ year: 2025, month: 6, firstDay: 1, days: 1, intervalMinutes: 5 }))
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error('Fehler erwartet')
    expect(out.error.code).toBe('wrong_interval')
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('Uneindeutige Spalten — kein Raten, kein Absturz', () => {
  it('⚠ ein EDA-Export mit mehreren Zählpunkten liefert needsMapping und KEINE Metadaten', () => {
    /*
     * Die geforderte Positiv-Kontrolle für die zweite Richtung, an einer ECHTEN (anonymisierten)
     * Netzbetreiber-Datei: acht Wert-Spalten, zwei davon Verbrauch. Die Datei EINEM Zählpunkt
     * zuzuordnen wäre falsch — und der Fehler fiele niemandem auf, weil der Zeitraum stimmte.
     */
    const content = readFileSync(fixture('netzbetreiber-eda-juni-2026.csv'), 'utf8')
    const out = readLoadProfileMetadata({ content, format: 'csv' })

    expect(out.ok).toBe(true)
    if (!out.ok || !out.needsMapping) throw new Error('needsMapping erwartet')

    expect(out.ambiguousColumns).toHaveLength(8)
    expect(out.ambiguousColumns.every((c) => c.meteringPointId?.startsWith('AT'))).toBe(true)
    // Die Rollen-Vorschläge reisen mit — Auftrag 3/4 legt sie einem Menschen vor.
    expect(out.ambiguousColumns.filter((c) => c.suggestedRole === 'consumption')).toHaveLength(2)
    expect(out.ambiguousColumns.filter((c) => c.eegAccounting)).toHaveLength(4)

    // ⚠ Und es steht KEINE Metadaten-Aussage daneben: das Typsystem lässt sie gar nicht zu.
    expect('coveredFrom' in out).toBe(false)
    expect('gaps' in out).toBe(false)
  })

  it('mit bestätigter Spaltenzuordnung liest dieselbe Datei ihren Zeitraum', () => {
    // Die Gegenprobe: die Rückfrage ist kein Defekt, sondern ein offener Punkt — beantwortet man
    // ihn, läuft der Leser durch. `columns` ist genau die Bestätigung, die Auftrag 3/4 einsammelt.
    const content = readFileSync(fixture('netzbetreiber-eda-juni-2026.csv'), 'utf8')
    const first = readLoadProfileMetadata({ content, format: 'csv' })
    if (!first.ok || !first.needsMapping) throw new Error('needsMapping erwartet')

    const out = readLoadProfileMetadata(
      { content, format: 'csv' },
      {
        unit: 'kWh',
        columns: {
          timestamp: 0,
          timeColumn: 1,
          consumptionCols: first.ambiguousColumns
            .filter((c) => c.suggestedRole === 'consumption')
            .map((c) => c.index),
          feedInCols: first.ambiguousColumns
            .filter((c) => c.suggestedRole === 'feed_in')
            .map((c) => c.index),
        },
      },
    )
    if (!out.ok || out.needsMapping) throw new Error('ok-Ergebnis erwartet')

    expect(out.intervalMinutes).toBe(15)
    expect(out.rowCount).toBe(7 * 96) // 16.–22.06.2026, eine Woche
    expect(out.gaps).toEqual([])
  })

  it('ein Wechselrichter-/ESS-Log wird fachlich abgelehnt, nicht als Lastgang gelesen', () => {
    const content = readFileSync(fixture('wechselrichter-ess-sys1-juni-2026.xlsx'))
    const out = readLoadProfileMetadata({ content, format: 'xlsx' })
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error('Fehler erwartet')
    expect(out.error.code).toBe('not_a_load_profile')
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('Echter Jahres-Lastgang', () => {
  it('liest den Demo-Lastgang 2025 — Zeitraum, Intervall und Monate', () => {
    const content = readFileSync(fixture('demo-baeckerei-lastgang-2025.csv'), 'utf8')
    const out = readLoadProfileMetadata({ content, format: 'csv' }, { timezone: 'Europe/Vienna' })
    if (!out.ok || out.needsMapping) throw new Error('ok-Ergebnis erwartet')

    expect(out.intervalMinutes).toBe(15)
    expect(out.coveredMonths).toBe(12)
    /*
     * Die Kalenderjahr-Kante: der Lastgang beginnt am 01.01.2025 00:00 ORTSZEIT, in UTC also eine
     * Stunde davor (CET = UTC+1) — genau die Stunde, wegen der `SPOT_PRICE_ANCHOR_ISO` auf
     * 2024-12-31T23:00:00Z liegt (B21-3a).
     */
    expect(out.coveredFrom).toBe('2024-12-31T23:00:00.000Z')
    expect(out.coveredTo).toBe('2025-12-31T23:00:00.000Z')

    /*
     * Die Datei trägt absichtliche Lücken (dev-fixtures/README.md). Der Leser meldet sie, statt
     * sie — wie `parseLoadProfile` es für die Rechnung tut — wegzuinterpolieren; die Abdeckung
     * ist deshalb kleiner als die 35.040 Slots eines lückenlosen Jahres.
     */
    expect(out.rowCount).toBeLessThan(35_040)
    expect(out.gaps.length).toBeGreaterThan(0)
    for (const gap of out.gaps) expect(gap.from < gap.to).toBe(true)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// PV-ERZEUGUNGSREIHE — `readPvProfileMetadata`
// ═════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠ WARUM DIESELBEN FÄLLE HIER EIN ZWEITES MAL STEHEN
 *
 * Die beiden Leser teilen sich den PARSER (Format-Erkennung, Zeitstempel-Auflösung), aber NICHT die
 * Ableitung darüber: `readLoadProfileMetadata` trägt Lücken-, Dedupe- und `coveredTo`-Rechnung bis
 * heute INLINE, die PV-Reihe bekommt sie aus `pvMetadataFromStamps`. Das sind zwei Kopien derselben
 * Regel — im Modul ausdrücklich als solche benannt („wer sie zusammenlegt, tut es als eigenen,
 * messbaren Schritt"). Ein Test, der nur die eine misst, liesse die andere ungeprüft, und die zwei
 * können auseinanderlaufen, ohne dass ein Build oder ein Typecheck es bemerkt.
 *
 * Die Erwartungen sind wieder HANDGERECHNET (s. Kopf dieser Datei), gegen Europe/Vienna.
 */

const PV_VALUE_HEADER = 'PV-Erzeugung (kW)'

/** Wie `buildCsv`, nur mit der Beschriftung einer Erzeugungsdatei. */
function buildPvCsv(options: Parameters<typeof buildCsv>[0]): string {
  return buildCsv({ ...options, valueHeader: PV_VALUE_HEADER })
}

function scanPv(content: string) {
  return readPvProfileMetadata({ content, format: 'csv' }, { timezone: 'Europe/Vienna' })
}

/** Verengt auf den Gutfall und nennt im Fehlerfall den Grund — sonst steht dort nur „undefined". */
function okPv(out: ReturnType<typeof readPvProfileMetadata>) {
  if (!out.ok) throw new Error(`ok-Ergebnis erwartet, kam: ${out.error.code} — ${out.error.message}`)
  return out
}

function errPv(out: ReturnType<typeof readPvProfileMetadata>) {
  if (out.ok) throw new Error('Fehler erwartet, kam ein Ergebnis')
  return out.error
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('PV-Reihe — die echte Jahres-Erzeugungsdatei', () => {
  it('liest Zeitraum, Intervall und Monate des Demo-PV-Jahrgangs 2025', () => {
    const content = readFileSync(fixture('demo-baeckerei-pv-erzeugung-2025.csv'), 'utf8')
    const out = okPv(
      readPvProfileMetadata({ content, format: 'csv' }, { timezone: 'Europe/Vienna' }),
    )

    expect(out.intervalMinutes).toBe(15)
    expect(out.coveredMonths).toBe(12)

    /*
     * Dieselbe Kalenderjahr-Kante wie beim Lastgang: die Datei beginnt am 01.01.2025 00:00
     * ORTSZEIT, in UTC also eine Stunde davor (CET = UTC+1). Und `coveredTo` schlägt die Dauer des
     * LETZTEN Intervalls auf — der letzte Messwert steht auf 31.12. 23:45 Ortszeit (= 22:45Z).
     */
    expect(out.coveredFrom).toBe('2024-12-31T23:00:00.000Z')
    expect(out.coveredTo).toBe('2025-12-31T23:00:00.000Z')
  })

  it('⚠ DIE ZWEI ZEITUMSTELLUNGEN, gepinnt: eine gemeldete Stunden-Lücke und vier Dubletten', () => {
    /*
     * Der Generator schreibt mechanisch 365 × 96 = 35.040 WANDUHR-Zeilen. Die Zeitumstellung macht
     * daraus zwei Artefakte, und beide stehen hier als PIN — sie tauchen im Entwurf eines
     * Zählpunkts wieder auf, und wer sie dort findet, soll sie nicht für einen Datenfehler halten.
     *
     * 30.03.2025 (Vorwärts): die Wanduhr-Stunde 02:00 GIBT ES NICHT. `zonedWallToUtcMs` löst
     *   02:00–02:45 auf 01:00Z–01:45Z auf — genau die Zeitpunkte, auf die auch 03:00–03:45 fallen.
     *   Vier Zeilen sind damit Dubletten und werden dedupliziert: 35.040 − 4 = 35.036.
     *
     * 26.10.2025 (Rückwärts): die Wanduhr-Stunde 02:00 kommt ZWEIMAL vor, die Datei schreibt sie
     *   einmal. Aufgelöst wird sie auf die WINTERLICHE Belegung (UTC+1, also 01:00Z–01:45Z); der
     *   sommerliche UTC-Bereich 00:00Z–01:00Z bleibt dadurch unbelegt und erscheint als Lücke.
     *   Der letzte Messwert davor ist 01:45 Ortszeit CEST = 23:45Z, die Lücke beginnt also ein
     *   Intervall später.
     */
    const content = readFileSync(fixture('demo-baeckerei-pv-erzeugung-2025.csv'), 'utf8')
    const out = okPv(
      readPvProfileMetadata({ content, format: 'csv' }, { timezone: 'Europe/Vienna' }),
    )

    expect(out.rowCount).toBe(365 * 96 - 4)
    expect(out.gaps).toEqual([
      { from: '2025-10-26T00:00:00.000Z', to: '2025-10-26T01:00:00.000Z' },
    ])
  })
})


// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('PV-Reihe — Lücken und die Toleranzschwelle', () => {
  /** 10 Junitage (01.–10.06.2025) im Viertelstunden-Gitter, mit wählbaren Ausfällen. */
  function tenJuneDays(skipDays?: number[]) {
    return buildPvCsv({
      year: 2025,
      month: 6,
      firstDay: 1,
      days: 10,
      intervalMinutes: 15,
      ...(skipDays ? { skipDays } : {}),
    })
  }

  it('⚠ drei fehlende Tage ergeben GENAU EINE Lücke mit exakten Rändern', () => {
    const out = okPv(scanPv(tenJuneDays([4, 5, 6])))

    expect(out.intervalMinutes).toBe(15)

    /*
     * Halboffen: `from` ist der ERSTE Zeitpunkt ohne Messwert (= Ende des letzten vorhandenen
     * Intervalls), `to` der erste Zeitpunkt MIT Messwert danach. Lokal also 04.06. 00:00 bis
     * 07.06. 00:00 — im Juni gilt CEST (UTC+2), in UTC damit zwei Stunden früher.
     */
    expect(out.gaps).toEqual([
      { from: '2025-06-03T22:00:00.000Z', to: '2025-06-06T22:00:00.000Z' },
    ])

    // Sieben Tage à 96 Viertelstunden liegen tatsächlich vor …
    expect(out.rowCount).toBe(7 * 96)
    // … der ZEITRAUM umspannt trotzdem alle zehn: die Lücke liegt innen, nicht am Rand.
    expect(out.coveredFrom).toBe('2025-05-31T22:00:00.000Z') // 01.06. 00:00 Ortszeit
    expect(out.coveredTo).toBe('2025-06-10T22:00:00.000Z') // 10.06. 24:00 Ortszeit
  })

  it('⚠ GEGENPROBE: dieselbe Datei vollständig → gaps ist leer, der Zeitraum unverändert', () => {
    const out = okPv(scanPv(tenJuneDays()))

    expect(out.gaps).toEqual([])
    expect(out.rowCount).toBe(10 * 96)
    expect(out.coveredFrom).toBe('2025-05-31T22:00:00.000Z')
    expect(out.coveredTo).toBe('2025-06-10T22:00:00.000Z')
  })

  it('eine Zeile mit LEERER Wertzelle zählt als fehlender Messwert, nicht als Abdeckung', () => {
    /*
     * Bei einer Erzeugungsreihe ist das der Alltag: ein Wechselrichter, der nachts gar nichts
     * meldet, schreibt keine 0, sondern eine leere Zelle. Zählte der Leser nur die Zeitstempel,
     * sähe die Datei lückenlos aus.
     */
    const out = okPv(
      scanPv(
        buildPvCsv({
          year: 2025,
          month: 6,
          firstDay: 1,
          days: 10,
          intervalMinutes: 15,
          blankDays: [4, 5, 6],
        }),
      ),
    )

    expect(out.gaps).toEqual([
      { from: '2025-06-03T22:00:00.000Z', to: '2025-06-06T22:00:00.000Z' },
    ])
    expect(out.rowCount).toBe(7 * 96)
  })

  it(`EIN fehlendes Intervall wird NICHT gemeldet, ZWEI schon — die Schwelle ist ${GAP_TOLERANCE_INTERVALS}`, () => {
    const base = buildPvCsv({ year: 2025, month: 6, firstDay: 1, days: 2, intervalMinutes: 15 })
    const drop = (indices: number[]) => {
      const gone = new Set(indices)
      return base
        .split('\n')
        .filter((_, i) => i === 0 || !gone.has(i))
        .join('\n')
    }

    const one = okPv(scanPv(drop([50])))
    expect(one.gaps).toEqual([])
    // Es fehlt trotzdem — die Zahl bleibt aus `rowCount` gegen den Zeitraum ableitbar.
    expect(one.rowCount).toBe(2 * 96 - 1)

    const two = okPv(scanPv(drop([50, 51])))
    expect(two.gaps).toHaveLength(1)
    expect(two.rowCount).toBe(2 * 96 - 2)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('PV-Reihe — Intervall', () => {
  it('erkennt Stundenwerte als 60 min und schlägt sie auf `coveredTo` auf', () => {
    const out = okPv(
      scanPv(buildPvCsv({ year: 2025, month: 6, firstDay: 1, days: 5, intervalMinutes: 60 })),
    )

    expect(out.intervalMinutes).toBe(60)
    expect(out.rowCount).toBe(5 * 24)
    expect(out.coveredFrom).toBe('2025-05-31T22:00:00.000Z') // 01.06. 00:00 Ortszeit
    // ⚠ Eine STUNDE aufgeschlagen, nicht 15 Minuten: 05.06. 23:00 Ortszeit + 60 min = 06.06. 00:00.
    expect(out.coveredTo).toBe('2025-06-05T22:00:00.000Z')
  })

  it('⚠ ein anderes Intervall (5 min) wird ABGEWIESEN statt auf 15 gerundet', () => {
    /*
     * Der reale Fall: ein Wechselrichter-Export im 5-Minuten-Raster. Auf 15 gerundet stünde am
     * Zählpunkt ein Intervall, das die Datei nicht hat — und jede spätere Rechnung über die
     * Erzeugungsmenge läge um den Faktor 3 daneben, ohne dass irgendetwas fehlschlüge.
     */
    const error = errPv(
      scanPv(buildPvCsv({ year: 2025, month: 6, firstDay: 1, days: 1, intervalMinutes: 5 })),
    )
    expect(error.code).toBe('wrong_interval')
    // Die Meldung nennt das erkannte Intervall — sonst weiss der Admin nicht, was an der Datei ist.
    expect(error.message).toContain('5 min')
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('PV-Reihe — leere und zu kurze Dateien werden BENANNT, nicht geworfen', () => {
  /*
   * Die Action reicht die Meldung dieses Lesers unverändert an den Admin durch. Ein Wurf käme dort
   * als „Es ist ein Fehler aufgetreten" an — also mit genau der Auskunft weniger, die sagt, WAS an
   * der Datei nicht stimmt. Deshalb ist jeder dieser Ausgänge ein Ergebnis, keine Ausnahme.
   */
  const header = `Zeitstempel;${PV_VALUE_HEADER}`

  it('eine leere Datei', () => {
    expect(errPv(scanPv('')).code).toBe('empty')
  })

  it('nur die Kopfzeile — es gibt keine Zeitstempel-Spalte zu erkennen', () => {
    expect(errPv(scanPv(header)).code).toBe('no_timestamp_column')
  })

  it('eine einzige Datenzeile — aus einem Punkt lässt sich kein Intervall bestimmen', () => {
    const out = errPv(scanPv(`${header}\n01.06.2025 00:00;1,20`))
    expect(out.code).toBe('insufficient_rows')
  })

  it('⚠ ZWEI Zeilen mit DEMSELBEN Zeitstempel sind auch nur ein Punkt', () => {
    /*
     * Der Unterschied zum Fall darüber ist die Reihenfolge im Leser: erst wird gezählt, DANN
     * dedupliziert. Ohne die zweite Prüfung nach dem Deduplizieren käme hier ein Abstand von 0 in
     * die Intervall-Bestimmung — und „0 min" ist kein Intervall, das eine Meldung erklärt.
     */
    const out = errPv(scanPv(`${header}\n01.06.2025 00:00;1,20\n01.06.2025 00:00;1,30`))
    expect(out.code).toBe('insufficient_rows')
    expect(out.message).toContain('unterschiedliche')
  })

  it('freier Text ohne Tabelle wird abgewiesen und stürzt nicht ab', () => {
    expect(() => scanPv('Hallo Welt\nDies ist keine Tabelle')).not.toThrow()
    expect(errPv(scanPv('Hallo Welt\nDies ist keine Tabelle')).code).toBe('no_timestamp_column')
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('PV-Reihe — wo sie sich vom Lastgang-Leser UNTERSCHEIDET', () => {
  it('⚠ derselbe Wechselrichter-Export: der Lastgang lehnt ihn ab, die PV-Reihe LIEST ihn', () => {
    /*
     * Die fachlich wichtigste Abweichung der zwei Leser, an EINER Datei gemessen: ein ESS-Log ist
     * kein Netz-Lastgang (`isInverterExport` weist es ab — ein Bezugsprofil steht dort gar nicht
     * drin), aber seine EINGANGSLEISTUNG IST die Brutto-PV-Kurve. Ein Leser, der beide gleich
     * behandelte, nähme dem Admin genau die Datei weg, die sein Wechselrichter ausgibt.
     */
    const content = readFileSync(fixture('wechselrichter-ess-sys1-juni-2026.xlsx'))

    const asLoad = readLoadProfileMetadata({ content, format: 'xlsx' })
    expect(asLoad.ok).toBe(false)
    if (asLoad.ok) throw new Error('Ablehnung erwartet')
    expect(asLoad.error.code).toBe('not_a_load_profile')

    const asPv = okPv(
      readPvProfileMetadata({ content, format: 'xlsx' }, { timezone: 'Europe/Vienna' }),
    )
    expect(asPv.intervalMinutes).toBe(15)
    expect(asPv.rowCount).toBe(7 * 96) // 16.–22.06.2026, eine volle Woche
    expect(asPv.coveredFrom).toBe('2026-06-15T22:00:00.000Z') // 16.06. 00:00 Ortszeit (CEST)
    expect(asPv.coveredTo).toBe('2026-06-22T22:00:00.000Z') // 23.06. 00:00 Ortszeit
    expect(asPv.gaps).toEqual([])
  })

  it('⚠ mehrere Wert-Spalten fragen NICHT zurück — es gilt die erste', () => {
    /*
     * Der EDA-Export mit acht Wert-Spalten macht den Lastgang-Leser zu `needsMapping`: welche
     * Spalte welcher Zählpunkt ist, entscheidet dort ein Mensch. Eine Erzeugungsreihe hat den Fall
     * nicht — sie beschreibt EINE Anlage —, und der PV-Leser hat deshalb bewusst gar keinen
     * Rückfrage-Ausgang. Er nimmt `valueCols[0]`, dieselbe Wahl wie `parsePvProfile`.
     *
     * Der Test steht hier, weil genau das wie ein Defekt aussieht und beim nächsten Umbau leicht
     * „repariert" wird. Er pinnt die Entscheidung, nicht ihr Ergebnis: gemessen wird, dass DIESELBE
     * Datei auf dem einen Weg zurückfragt und auf dem anderen durchläuft.
     */
    const content = readFileSync(fixture('netzbetreiber-eda-juni-2026.csv'), 'utf8')

    const asLoad = readLoadProfileMetadata({ content, format: 'csv' })
    if (!asLoad.ok || !asLoad.needsMapping) throw new Error('needsMapping erwartet')
    expect(asLoad.ambiguousColumns).toHaveLength(8)

    const asPv = okPv(
      readPvProfileMetadata({ content, format: 'csv' }, { timezone: 'Europe/Vienna' }),
    )
    // Kein `needsMapping`-Feld am Typ — es gibt den Zweig nicht.
    expect('needsMapping' in asPv).toBe(false)
    expect(asPv.intervalMinutes).toBe(15)
    expect(asPv.rowCount).toBe(7 * 96)
    expect(asPv.coveredFrom).toBe('2026-06-15T22:00:00.000Z')
    expect(asPv.coveredTo).toBe('2026-06-22T22:00:00.000Z')
  })
})
