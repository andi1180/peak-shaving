import { describe, expect, it } from 'vitest'

import { detectDateFormat, parseTimestamp, toIsoUtc, zonedWallToUtcMs } from './datetime'

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
