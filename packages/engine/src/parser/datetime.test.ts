import { describe, expect, it } from 'vitest'

import {
  detectDateFormat,
  detectDateOnlyFormat,
  looksLikeTimeColumn,
  parseSplitTimestamp,
  parseTimestamp,
  toIsoUtc,
  zonedWallToUtcMs,
} from './datetime'

describe('zonedWallToUtcMs (Europe/Vienna DST)', () => {
  it('Winter (UTC+1): 12:00 lokal → 11:00 UTC', () => {
    expect(toIsoUtc(zonedWallToUtcMs(2024, 1, 15, 12, 0, 0, 'Europe/Vienna'))).toBe(
      '2024-01-15T11:00:00.000Z',
    )
  })

  it('Sommer (UTC+2): 12:00 lokal → 10:00 UTC', () => {
    expect(toIsoUtc(zonedWallToUtcMs(2024, 7, 15, 12, 0, 0, 'Europe/Vienna'))).toBe(
      '2024-07-15T10:00:00.000Z',
    )
  })

  it('UTC-Zeitzone bleibt unverändert', () => {
    expect(toIsoUtc(zonedWallToUtcMs(2024, 3, 1, 8, 30, 0, 'UTC'))).toBe('2024-03-01T08:30:00.000Z')
  })
})

describe('detectDateFormat', () => {
  it('erkennt ISO mit Offset', () => {
    expect(detectDateFormat(['2024-01-15T00:00:00Z', '2024-01-15T00:15:00Z'])).toBe('iso_offset')
  })
  it('erkennt ISO naiv', () => {
    expect(detectDateFormat(['2024-01-15T00:00', '2024-01-15 00:15'])).toBe('iso_naive')
  })
  it('erkennt deutsches Format', () => {
    expect(detectDateFormat(['15.01.2024 00:00', '15.01.2024 00:15:00'])).toBe('de_dot')
  })
  it('erkennt Excel-Serial (Zahl im Datumsbereich)', () => {
    expect(detectDateFormat([45306.5, 45306.75])).toBe('excel_serial')
  })
  it('null bei nicht-datumsartigen Werten', () => {
    expect(detectDateFormat(['foo', 'bar', '12'])).toBeNull()
  })
  it('erkennt ausgeschriebenen dt. Monatsnamen (Format B, OP#4)', () => {
    expect(detectDateFormat(['17/März/2026 00:00', '17/März/2026 00:15'])).toBe('de_month_name')
    expect(detectDateFormat(['16/Juni/2026 12:00', '16/Juni/2026 12:15'])).toBe('de_month_name')
  })
  it('reine Datumsspalten matchen NICHT als kombiniertes Format', () => {
    expect(detectDateFormat(['16.06.2026', '17.06.2026'])).toBeNull()
  })
})

describe('detectDateOnlyFormat / looksLikeTimeColumn (Split-Timestamp, OP#4)', () => {
  it('erkennt reines de-Datum und ISO-Datum', () => {
    expect(detectDateOnlyFormat(['16.06.2026', '17.06.2026'])).toBe('de_dot_date')
    expect(detectDateOnlyFormat(['2026-06-16', '2026-06-17'])).toBe('iso_date')
  })
  it('kombinierte Zeitstempel sind KEIN reines Datum', () => {
    expect(detectDateOnlyFormat(['16.06.2026 00:00', '16.06.2026 00:15'])).toBeNull()
  })
  it('erkennt Uhrzeit-Spalten (HH:MM[:SS])', () => {
    expect(looksLikeTimeColumn(['00:00:00', '00:15:00', '23:45:00'])).toBe(true)
    expect(looksLikeTimeColumn(['08:30', '08:45'])).toBe(true)
    expect(looksLikeTimeColumn(['16.06.2026', '17.06.2026'])).toBe(false)
  })
})

describe('parseTimestamp de_month_name / parseSplitTimestamp (OP#4)', () => {
  it('parst "17/März/2026 08:30" wie die naive Wanduhr (Vienna, Sommerzeit UTC+2)', () => {
    expect(parseTimestamp('17/März/2026 08:30', 'de_month_name', 'Europe/Vienna')).toBe(
      zonedWallToUtcMs(2026, 3, 17, 8, 30, 0, 'Europe/Vienna'),
    )
  })
  it('kombiniert getrennte Datums- und Zeitspalte (Intervall-START)', () => {
    expect(parseSplitTimestamp('16.06.2026', '07:15:00', 'de_dot_date', 'Europe/Vienna')).toBe(
      zonedWallToUtcMs(2026, 6, 16, 7, 15, 0, 'Europe/Vienna'),
    )
  })
  it('fehlende Uhrzeit → 00:00', () => {
    expect(parseSplitTimestamp('2026-06-16', '', 'iso_date', 'UTC')).toBe(
      zonedWallToUtcMs(2026, 6, 16, 0, 0, 0, 'UTC'),
    )
  })
})

describe('parseTimestamp Excel-Serial', () => {
  it('interpretiert Serial als lokale Wanduhr (Vienna)', () => {
    // Serial für 2024-06-15 12:00 lokale Wanduhr
    const wallUtcMs = Date.UTC(2024, 5, 15, 12, 0, 0)
    const serial = 25569 + wallUtcMs / 86_400_000
    expect(parseTimestamp(serial, 'excel_serial', 'Europe/Vienna')).toBe(
      zonedWallToUtcMs(2024, 6, 15, 12, 0, 0, 'Europe/Vienna'),
    )
  })
})
