import { describe, expect, it } from 'vitest'

import { readMeteringPointList } from './metering-points'

/**
 * B24, Teil 1 — der Leser der Zählpunkt-Liste.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DER PRÜFPUNKT IST `profileSource`, UND ER WAR BIS ZUM STANDARDPROFIL-ZWEIG EIN BOOLEAN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `hasLoadProfile` hing an `source_document_id`. Das ging mit dem zweiten Weg kaputt:
 * `set_metering_point_standard_profile` setzt die Quelle ausdrücklich auf `null` (ein erzeugtes
 * Profil hat keine Datei) und füllt trotzdem Intervall und Zeitraum. Ein Flag an der Quelle
 * meldete danach „kein Lastgang", während der Zählpunkt einen vollständigen Zeitraum trägt — die
 * Station stellte ihre Ja/Nein-Frage erneut, und die Übersicht zählte den Zählpunkt als leer.
 *
 * Nichts daran schlägt fehl, und genau deshalb steht es hier als Test.
 */

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    project_id: '22222222-2222-4222-8222-222222222222',
    interval_minutes: null,
    covered_from: null,
    covered_to: null,
    gaps: [],
    source_document_id: null,
    draft: {},
    created_at: '2026-09-11T08:00:00.000Z',
    ...overrides,
  }
}

/**
 * Eine `ok`-Antwort mit diesen Zeilen — und der Leser darf dabei NICHT `null` liefern.
 *
 * Das Werfen ist Absicht: `null` heisst „der Wrapper hat nicht ok gemeldet", und an einer selbst
 * gebauten `ok`-Antwort wäre das ein Fehler im Test, kein zu prüfendes Verhalten. Die Prüfung auf
 * `null` steht getrennt, mit einer echten Nicht-`ok`-Antwort.
 */
function listOf(...rows: Record<string, unknown>[]) {
  const list = readMeteringPointList({ status: 'ok', metering_points: rows })
  if (list === null) throw new Error('Leser hat eine ok-Antwort abgelehnt')
  return list
}

describe('readMeteringPointList — profileSource trägt die HERKUNFT, nicht ein Flag', () => {
  it('gesetzte Quelle → upload', () => {
    const list = listOf(
      row({
        source_document_id: '33333333-3333-4333-8333-333333333333',
        interval_minutes: 15,
        covered_from: '2025-01-01T00:00:00.000Z',
        covered_to: '2026-01-01T00:00:00.000Z',
      }),
    )
    expect(list[0]?.profileSource).toBe('upload')
  })

  it('⚠ Zeitraum OHNE Quelle → standard, NICHT null', () => {
    // Genau der Zustand, den `set_metering_point_standard_profile` herstellt.
    const list = listOf(
      row({
        source_document_id: null,
        interval_minutes: 15,
        covered_from: '2024-12-31T23:00:00.000Z',
        covered_to: '2025-12-31T23:00:00.000Z',
      }),
    )
    expect(list[0]?.profileSource).toBe('standard')
  })

  it('weder Quelle noch Zeitraum → null', () => {
    expect(listOf(row())[0]?.profileSource).toBeNull()
  })

  it('⚠ die Quelle entscheidet ZUERST — ein Dokument schlägt einen vorhandenen Zeitraum', () => {
    /*
     * Über die Wrapper nicht herstellbar (`set_metering_point_load_profile` ERSETZT alle Angaben
     * gemeinsam), aber die Reihenfolge ist die Aussage: nur der Upload-Weg schreibt eine Quelle,
     * und wo eine steht, ist der Zeitraum aus genau dieser Datei gelesen.
     */
    const list = listOf(
      row({
        source_document_id: '33333333-3333-4333-8333-333333333333',
        covered_from: '2025-01-01T00:00:00.000Z',
      }),
    )
    expect(list[0]?.profileSource).toBe('upload')
  })

  it('gelesen wird `covered_from`, nicht `interval_minutes`', () => {
    // Der CHECK der Tabelle verlangt die zwei Zeitgrenzen gemeinsam oder gar nicht; das Intervall
    // steht ohne eigene Bedingung daneben und taugt deshalb nicht als Diskriminator.
    expect(listOf(row({ interval_minutes: 15 }))[0]?.profileSource).toBeNull()
  })
})

describe('readMeteringPointList — der Entwurf reist mit', () => {
  it('übernimmt ihn roh', () => {
    const draft = { annualConsumptionKwh: 3_650, _provenance: { annualConsumptionKwh: {} } }
    expect(listOf(row({ draft }))[0]?.draft).toEqual(draft)
  })

  it.each([
    ['fehlend', undefined],
    ['null', null],
    ['Array', []],
    ['Zeichenkette', 'nope'],
  ])('%s → leeres Objekt, nie `undefined`', (_name, draft) => {
    // Der Leser der Station ruft `readStandardProfileConsumption(point.draft)` ohne Guard — ein
    // `undefined` wäre dort ein Absturz statt „keine Angabe".
    expect(listOf(row({ draft }))[0]?.draft).toEqual({})
  })
})

describe('readMeteringPointList — unverändertes Verhalten des Bestands', () => {
  it('`null` bei nicht-`ok`, und das heisst NICHT „keine Zählpunkte"', () => {
    expect(readMeteringPointList({ status: 'not_found' })).toBeNull()
    expect(readMeteringPointList(null)).toBeNull()
  })

  it('leere Liste bleibt leere Liste', () => {
    expect(readMeteringPointList({ status: 'ok', metering_points: [] })).toEqual([])
  })

  it('eine Zeile ohne Kennung wird übersprungen, nicht gezählt', () => {
    const list = listOf(row({ id: null }), row())
    expect(list).toHaveLength(1)
  })

  it('die Reihenfolge der Datenbank bleibt — sie IST die Zählpunkt-Nummer', () => {
    const a = row({ id: 'aaaaaaaa-1111-4111-8111-111111111111' })
    const b = row({ id: 'bbbbbbbb-1111-4111-8111-111111111111' })
    expect(listOf(a, b).map((p) => p.id)).toEqual([a.id, b.id])
  })
})
