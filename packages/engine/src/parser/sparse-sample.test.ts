import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { parseLoadProfile } from './parse'

/**
 * Zwei Eigenschaften, die zusammengehören und beide am Anfang einer Datei hängen:
 *
 *  1. **Sample-Robustheit** — eine Datei mit langem Anfangs-Leerlauf (Zeitstempel da, Wert-Zellen
 *     leer) darf nicht pauschal als „keine Wert-Spalte" abgelehnt werden, nur weil die
 *     Kopf-Stichprobe (die ersten 60 Datenzeilen) nichts trägt.
 *  2. **`largestGapSlots`** — die LÄNGSTE zusammenhängend interpolierte Lücke reist im Contract
 *     mit, damit der Report eine Datei benennen kann, die vollständig AUSSIEHT und es nicht ist.
 *
 * Alle synthetischen Fälle parsen bewusst mit `timezone: 'UTC'`: geprüft wird hier Struktur, nicht
 * Ortszeit — mit Europe/Vienna trüge jeder mehrmonatige Fall zusätzlich die Zeitumstellung
 * (fehlende bzw. doppelte Stunde) und die Slot-Zahlen wären nicht mehr von Hand nachrechenbar.
 */

const pad = (x: number) => String(x).padStart(2, '0')
const STEP_MS = 15 * 60 * 1000
const START_MS = Date.UTC(2025, 5, 1, 0, 0) // 1.6.2025 00:00

/** Naive ISO-Zeitstempel (ohne Zone) im 15-min-Raster. */
function isoNaiveAt(i: number): string {
  const d = new Date(START_MS + i * STEP_MS)
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  )
}

/** CSV mit einer Zeitstempel- und einer Wert-Spalte; `value(i) === null` lässt die Zelle LEER. */
function buildCsv(rows: number, value: (i: number) => number | null, header = 'Zeit,Bezug (kW)') {
  const out: string[] = [header]
  for (let i = 0; i < rows; i++) {
    const v = value(i)
    out.push(`${isoNaiveAt(i)},${v == null ? '' : v}`)
  }
  return out.join('\n')
}

describe('Sample-Robustheit — langer Anfangs-Leerlauf (reale Kundenstruktur)', () => {
  // Nachgebaut nach einem realen Netzbetreiber-Export: durchgehende Zeitstempel, die Wert-Spalte
  // beginnt erst weit hinten. 15.000 leere Zellen vor dem ersten Messwert — die Kopf-Stichprobe
  // (60 Zeilen) sieht davon ausschliesslich Leerzellen.
  const IDLE = 15_000
  const VALID = 1_000
  const csv = buildCsv(IDLE + VALID, (i) => (i < IDLE ? null : 10 + (i % 20)))

  it('wird angenommen statt mit no_value_column abgelehnt', () => {
    const out = parseLoadProfile({ content: csv, format: 'csv' }, { timezone: 'UTC' })
    expect(out.ok).toBe(true)
    if (!out.ok) return

    // Die Wert-Spalte wird gefunden, obwohl in den ersten 60 Datenzeilen KEIN einziger Wert steht.
    expect(out.detection.columns.value).toBe(1)
    expect(out.detection.columns.timestamp).toBe(0)
    // Genau die gültigen Zeilen werden zu Messwerten; der Leerlauf davor ist kein Teil der Reihe.
    expect(out.profile.readings).toHaveLength(VALID)
    // Die Reihe beginnt exakt an der Zeile, in der die Wert-Spalte einsetzt (Zeile 15.000).
    expect(out.profile.readings[0]!.ts).toBe(new Date(START_MS + IDLE * STEP_MS).toISOString())
    expect(out.dataQuality.warnings.some((w) => w.startsWith(`${IDLE} Zeile(n)`))).toBe(true)

    // ⚠ Ein Anfangs-Leerlauf ist KEINE Lücke: die Reihe beginnt beim ersten echten Messwert, es
    // wird nichts zwischen zwei bekannten Werten aufgefüllt.
    expect(out.dataQuality.largestGapSlots).toBe(0)
    expect(out.dataQuality.gapsInterpolated).toBe(0)

    console.log(
      `[Sample-Robustheit] ${IDLE} leere Wert-Zellen vor dem ersten Messwert → ` +
        `readings=${out.profile.readings.length} · source=${out.profile.source} · ` +
        `largestGapSlots=${out.dataQuality.largestGapSlots}`,
    )
  })

  it('etikettiert die Quelle weiterhin über die KOPF-Stichprobe (import_only), nicht über die verteilte', () => {
    // Die Rettung betrifft ausschliesslich die Frage „gibt es hier eine Wert-Spalte?". Die
    // Vorzeichen-Erkennung (`hasNegative`) bleibt unangetastet auf den ersten 60 Zeilen — dort ist
    // alles leer, also greift die dokumentierte sichere Vorgabe. Folgenlos für die Zahlen
    // (`normalizeLoad` klemmt bei `import_only` nichts weg), aber es steht hier fest.
    // Der Leerlauf ist hier kürzer, die Einspeisung dafür DICHT (jede zweite Zeile): so landet die
    // verteilte Stichprobe zwangsläufig auf Negativwerten, und der Test wird rot, sobald jemand sie
    // in `hasNegative` durchreicht. Mit vereinzelten Negativwerten bliebe er zufällig grün.
    const withFeedIn = buildCsv(6_000, (i) => (i < 3_000 ? null : i % 2 === 0 ? 12 : -4))
    const out = parseLoadProfile({ content: withFeedIn, format: 'csv' }, { timezone: 'UTC' })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.profile.source).toBe('import_only')
    // Die negativen Werte stehen unverändert in der Reihe — nur das Etikett ist konservativ.
    expect(out.profile.readings.some((r) => r.gridPowerKw < 0)).toBe(true)
  })

  it('erfindet keine Spalte: eine über die GANZE Datei leere Wert-Spalte bleibt no_value_column', () => {
    const out = parseLoadProfile(
      { content: buildCsv(5_000, () => null), format: 'csv' },
      { timezone: 'UTC' },
    )
    expect(out.ok).toBe(false)
    if (out.ok || out.kind !== 'error') return
    expect(out.error.code).toBe('no_value_column')
  })
})

describe('net_signed-Regression — die Vorzeichen-Erkennung ist unverändert', () => {
  it('Negativwerte INNERHALB der Kopf-Stichprobe → net_signed', () => {
    const out = parseLoadProfile(
      { content: buildCsv(96, (i) => (i === 10 ? -3 : 10 + i)), format: 'csv' },
      { timezone: 'UTC' },
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.profile.source).toBe('net_signed')
  })

  it('Negativwerte ERST NACH Zeile 60 → weiterhin import_only (bekannt, B21-3a)', () => {
    // Der eigentliche Wächter dieses Schritts: die verteilte Stichprobe darf NICHT in die
    // Quellen-Erkennung durchschlagen. Täte sie es, kippte hier das Etikett — und damit repoweit
    // das Etikett jedes signierten Lastgangs, dessen erste Einspeisung spät kommt.
    const out = parseLoadProfile(
      { content: buildCsv(4_000, (i) => (i > 2_000 && i % 9 === 0 ? -5 : 10)), format: 'csv' },
      { timezone: 'UTC' },
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.profile.source).toBe('import_only')
  })

  it('die realen Demo-Fixtures behalten ihr Etikett (2023 net_signed · 2025 import_only)', () => {
    const read = (name: string) =>
      readFileSync(new URL(`../../../../dev-fixtures/${name}`, import.meta.url), 'utf8')

    const f2023 = parseLoadProfile({
      content: read('demo-baeckerei-mit-pv-netzlastgang-2023.csv'),
      format: 'csv',
    })
    const f2025 = parseLoadProfile({
      content: read('demo-baeckerei-mit-pv-netzlastgang-2025.csv'),
      format: 'csv',
    })
    expect(f2023.ok && f2023.profile.source).toBe('net_signed')
    expect(f2025.ok && f2025.profile.source).toBe('import_only')
  })
})

describe('largestGapSlots (§3.3) — die LÄNGSTE zusammenhängende Lücke, nicht ihre Summe', () => {
  it('lückenlos → 0', () => {
    const out = parseLoadProfile(
      { content: buildCsv(96, (i) => 10 + i), format: 'csv' },
      { timezone: 'UTC' },
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.dataQuality.largestGapSlots).toBe(0)
  })

  it('mehrere verstreute Lücken → längste, nicht Summe', () => {
    // Fehlend: Slot 5 (1 Stück) und die Slots 20–22 (3 am Stück) ⇒ Summe 4, längste 3.
    const missing = new Set([5, 20, 21, 22])
    const rows = ['Zeit,Bezug (kW)']
    for (let i = 0; i < 96; i++) {
      if (!missing.has(i)) rows.push(`${isoNaiveAt(i)},${10 + i}`)
    }
    const out = parseLoadProfile({ content: rows.join('\n'), format: 'csv' }, { timezone: 'UTC' })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.dataQuality.gapsInterpolated).toBe(4)
    expect(out.dataQuality.largestGapSlots).toBe(3)
  })

  it('„ein Wert, dann monatelang leer" → die Lücke steht als Zahl im Contract', () => {
    // Variante C: Zeile 0 trägt einen Wert (die Kopf-Stichprobe findet die Spalte also ohnehin),
    // danach 14.999 leere Zellen, dann wieder Messwerte. Die Reihe sieht anschliessend lückenlos
    // aus — 14.999 ihrer Slots sind linear zwischen zwei Werten aufgefüllt.
    const GAP = 14_999
    const TAIL = 5_000
    const csv = buildCsv(1 + GAP + TAIL, (i) => (i === 0 || i > GAP ? 10 + (i % 20) : null))
    const out = parseLoadProfile({ content: csv, format: 'csv' }, { timezone: 'UTC' })
    expect(out.ok).toBe(true)
    if (!out.ok) return

    expect(out.profile.readings).toHaveLength(1 + GAP + TAIL)
    expect(out.dataQuality.gapsInterpolated).toBe(GAP)
    expect(out.dataQuality.largestGapSlots).toBe(GAP)
    // Weit über der (vorläufigen) Report-Schwelle von 4 Wochen = 2.688 Slots
    // (`LARGE_GAP_SLOTS_THRESHOLD` in `apps/website/lib/constants.ts`, Delta 14 Punkt 9).
    expect(out.dataQuality.largestGapSlots).toBeGreaterThan(4 * 7 * 96)

    console.log(
      `[largestGapSlots] Variante C: ${GAP} Slots am Stück interpoliert ` +
        `(≈ ${Math.round(GAP / 96)} Tage) · gapsInterpolated=${out.dataQuality.gapsInterpolated} · ` +
        `coveredDays=${out.dataQuality.coveredDays}`,
    )
  })
})
