import { describe, expect, it } from 'vitest'

import {
  METERING_POINT_COUNT_STATION_ID,
  METERING_POINT_STEPS,
  SEGMENT_STATION_ID,
  STATION_PARAM,
  buildStations,
  defaultStationIndex,
  firstParamValue,
  meteringPointStationId,
  resolveStation,
  stationAfterMeteringPointCount,
  stationAfterSegment,
  stationHref,
  type StationList,
} from './data-entry-stations'
import { projectDataEntryHref } from './projects'

/**
 * B24, Teil 1 — die Stations-Logik des Dateneingabe-Wizards.
 *
 * Reine Rechnung, kein React, kein Request, keine Datenbank (s. `vitest.config.ts`). Das ist der
 * einzige Teil des Wizards, der sich ohne Browser prüfen lässt — und zugleich der, an dem die
 * teuren Fehler sitzen: eine Reihenfolge, die nicht dem Datenbankstand folgt, und eine Adresse,
 * die auf eine Station zeigt, die es für dieses Projekt gar nicht gibt.
 */

const PROJECT = '11111111-2222-3333-4444-555555555555'

/** Der Weg durch die ganze Kette — einmal vorwärts, einmal zurück. */
function walk(stations: StationList): string[] {
  const seen: string[] = []
  for (let i = 0; i < stations.length; i += 1) seen.push(stations[i]?.id ?? '')
  return seen
}

describe('B24 — die Liste bricht ab, wo die Angaben aufhören', () => {
  it('⚠ ohne Segment gibt es GENAU EINE Station', () => {
    // Das ist zugleich der Zugriffsschutz: was nicht in der Liste steht, ist nicht erreichbar.
    const stations = buildStations({ segmentSet: false, meteringPointCount: 0 })
    expect(stations).toHaveLength(1)
    expect(stations[0].id).toBe(SEGMENT_STATION_ID)
  })

  it('⚠ die Zählpunkt-Zahl ändert daran NICHTS, solange das Segment fehlt', () => {
    // Sonst liesse sich der Segment-Schritt überspringen, indem man vorher Zählpunkte anlegt.
    const stations = buildStations({ segmentSet: false, meteringPointCount: 7 })
    expect(walk(stations)).toEqual([SEGMENT_STATION_ID])
  })

  it('mit Segment, ohne Zählpunkte: Segment und Zählpunkt-Zahl', () => {
    const stations = buildStations({ segmentSet: true, meteringPointCount: 0 })
    expect(walk(stations)).toEqual([SEGMENT_STATION_ID, METERING_POINT_COUNT_STATION_ID])
  })

  it('⚠ zwei Zählpunkte ergeben zehn Platzhalter-Stationen in der richtigen Reihenfolge', () => {
    const stations = buildStations({ segmentSet: true, meteringPointCount: 2 })

    // 1 Segment + 1 Zählpunkt-Zahl + 2×5 Schritte + KI-Check + Abbruchprüfung + Ende
    expect(stations).toHaveLength(15)
    expect(walk(stations)).toEqual([
      'segment',
      'zaehlpunkte',
      'zp1-lastgang',
      'zp1-rechnung',
      'zp1-batterie',
      'zp1-pv',
      'zp1-tarif',
      'zp2-lastgang',
      'zp2-rechnung',
      'zp2-batterie',
      'zp2-pv',
      'zp2-tarif',
      'ki-check',
      'abbruchpruefung',
      'ende',
    ])
  })

  it('die fünf Schritte stehen JE ZÄHLPUNKT beisammen, nicht je Schritt über alle Zählpunkte', () => {
    /*
     * Die Gegenform („alle Lastgänge, dann alle Rechnungen") wäre eine ganz andere Arbeitsweise
     * und ist hier ausdrücklich nicht gemeint: ein Zählpunkt wird am Stück erfasst.
     */
    const stations = buildStations({ segmentSet: true, meteringPointCount: 3 })
    const numbers = stations
      .filter((station) => station.kind === 'zaehlpunkt-schritt')
      .map((station) => station.meteringPoint?.number)

    expect(numbers).toEqual([1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3])
  })

  it('jede Zählpunkt-Station trägt Nummer und Schritt in der Überschrift', () => {
    const stations = buildStations({ segmentSet: true, meteringPointCount: 2 })
    const titles = stations
      .filter((station) => station.meteringPoint?.number === 2)
      .map((station) => station.title)

    expect(titles).toEqual([
      'Zählpunkt 2 — Lastgang',
      'Zählpunkt 2 — Rechnung',
      'Zählpunkt 2 — Batterie',
      'Zählpunkt 2 — PV',
      'Zählpunkt 2 — Tarif',
    ])
  })

  it('die Kennungen sind eindeutig — sonst löste `?station=` mehrdeutig auf', () => {
    const stations = buildStations({ segmentSet: true, meteringPointCount: 12 })
    expect(new Set(stations.map((station) => station.id)).size).toBe(stations.length)
  })

  it('die drei Abschluss-Stationen stehen HINTER allen Zählpunkten, nicht je Zählpunkt', () => {
    // Sie beurteilen die Gesamtheit; je Zählpunkt wiederholt wären sie eine andere Aussage.
    const stations = buildStations({ segmentSet: true, meteringPointCount: 3 })
    expect(walk(stations).slice(-3)).toEqual(['ki-check', 'abbruchpruefung', 'ende'])
  })
})

describe('B24 — wo der Wizard ohne Stationsangabe startet', () => {
  it('ohne Segment auf der Segment-Station', () => {
    const stations = buildStations({ segmentSet: false, meteringPointCount: 0 })
    expect(resolveStation(stations, null).station.id).toBe(SEGMENT_STATION_ID)
  })

  it('mit Segment, ohne Zählpunkte auf der Zählpunkt-Station', () => {
    const stations = buildStations({ segmentSet: true, meteringPointCount: 0 })
    expect(resolveStation(stations, null).station.id).toBe(METERING_POINT_COUNT_STATION_ID)
  })

  it('⚠ sonst auf dem ERSTEN Zählpunkt-Schritt, NICHT auf der letzten Station', () => {
    /*
     * Die Platzhalter tragen keinen Zustand — wie weit jemand gekommen ist, weiss niemand. Bei
     * „Ende" aufzumachen behauptete einen Fortschritt, den der Wizard nicht kennt.
     */
    const stations = buildStations({ segmentSet: true, meteringPointCount: 2 })
    const { station, index } = resolveStation(stations, null)
    expect(station.id).toBe('zp1-lastgang')
    expect(index).toBe(2)
    expect(defaultStationIndex(stations)).toBe(2)
  })

  it('eine leere Stationsangabe zählt wie keine', () => {
    const stations = buildStations({ segmentSet: true, meteringPointCount: 1 })
    expect(resolveStation(stations, '').station.id).toBe('zp1-lastgang')
  })
})

describe('B24 — eine unbekannte Station leitet um, statt zu scheitern', () => {
  it('⚠ Tarif von Zählpunkt 2 bei nur EINEM Zählpunkt landet auf der letzten vorhandenen Station', () => {
    const stations = buildStations({ segmentSet: true, meteringPointCount: 1 })
    const { station, redirectRequired } = resolveStation(stations, 'zp2-tarif')

    expect(redirectRequired).toBe(true)
    expect(station.id).toBe('ende')
  })

  it('ohne Segment klemmt JEDE Anfrage auf die Segment-Station', () => {
    const stations = buildStations({ segmentSet: false, meteringPointCount: 0 })
    for (const requested of ['zaehlpunkte', 'zp1-lastgang', 'ende', 'ki-check']) {
      const { station, redirectRequired } = resolveStation(stations, requested)
      expect(redirectRequired).toBe(true)
      expect(station.id).toBe(SEGMENT_STATION_ID)
    }
  })

  it('ohne Zählpunkte klemmt ein Zählpunkt-Schritt auf die Zählpunkt-Station', () => {
    const stations = buildStations({ segmentSet: true, meteringPointCount: 0 })
    const { station, redirectRequired } = resolveStation(stations, 'zp1-lastgang')
    expect(redirectRequired).toBe(true)
    expect(station.id).toBe(METERING_POINT_COUNT_STATION_ID)
  })

  it('Unsinn in der Adresse ist ebenfalls nur eine Umleitung, kein Fehler', () => {
    const stations = buildStations({ segmentSet: true, meteringPointCount: 2 })
    for (const requested of ['<script>', '../../admin', 'zp0-lastgang', 'zp1-unbekannt']) {
      expect(resolveStation(stations, requested).redirectRequired).toBe(true)
    }
  })

  it('eine vorhandene Station löst OHNE Umleitung auf', () => {
    const stations = buildStations({ segmentSet: true, meteringPointCount: 2 })
    const { station, index, redirectRequired } = resolveStation(stations, 'zp2-batterie')
    expect(redirectRequired).toBe(false)
    expect(station.id).toBe('zp2-batterie')
    expect(stations[index]).toBe(station)
  })
})

describe('B24 — Zurück und Weiter tragen durch die ganze Kette', () => {
  const stations = buildStations({ segmentSet: true, meteringPointCount: 2 })

  it('⚠ die allererste Station hat KEINEN Zurück-Weg, jede andere schon', () => {
    expect(stations.findIndex((station) => station.id === SEGMENT_STATION_ID)).toBe(0)
    for (let i = 1; i < stations.length; i += 1) {
      expect(stations[i - 1]).toBeDefined()
    }
  })

  it('vorwärts erreicht jede Station genau einmal und endet am Ende', () => {
    let index = resolveStation(stations, null).index
    const seen = [stations[index]?.id]
    while (index < stations.length - 1) {
      index += 1
      seen.push(stations[index]?.id)
    }
    expect(seen[seen.length - 1]).toBe('ende')
    // Vom Startpunkt (erster Zählpunkt-Schritt) bis zum Ende sind es 13 Stationen.
    expect(seen).toHaveLength(13)
  })

  it('rückwärts vom Ende führt bis zur Segment-Station', () => {
    let index = stations.length - 1
    const seen: string[] = []
    while (index > 0) {
      index -= 1
      seen.push(stations[index]?.id ?? '')
    }
    expect(seen[seen.length - 1]).toBe(SEGMENT_STATION_ID)
    expect(seen).toHaveLength(stations.length - 1)
  })

  it('jeder Schritt zurück ist die Umkehrung eines Schritts vorwärts', () => {
    for (let i = 1; i < stations.length; i += 1) {
      const back = stations[i - 1]
      const forward = stations.indexOf(back!) + 1
      expect(stations[forward]).toBe(stations[i])
    }
  })
})

describe('B24 — die Umleitungsziele der beiden echten Schritte gibt es wirklich', () => {
  it('nach dem Segment folgt die Zählpunkt-Station', () => {
    const stations = buildStations({ segmentSet: true, meteringPointCount: 0 })
    expect(stations.some((station) => station.id === stationAfterSegment())).toBe(true)
  })

  it('⚠ nach der Zählpunkt-Zahl folgt der erste Schritt des ersten Zählpunkts', () => {
    /*
     * `admin_set_metering_point_count` lässt nur Werte ab 1 zu — nach einem erfolgreichen Aufruf
     * gibt es diese Station also immer. Liefe das Ziel ins Leere, spränge der Wizard nach dem
     * Speichern ans Ende statt einen Schritt weiter.
     */
    const stations = buildStations({ segmentSet: true, meteringPointCount: 1 })
    const target = stationAfterMeteringPointCount()
    expect(target).toBe(meteringPointStationId(1, METERING_POINT_STEPS[0].id))
    expect(stations.some((station) => station.id === target)).toBe(true)
    expect(resolveStation(stations, target).redirectRequired).toBe(false)
  })
})

describe('B24 — Adressen', () => {
  it('die Station steht als Suchparameter, nicht im Pfad', () => {
    expect(stationHref(PROJECT, 'zp2-tarif')).toBe(
      `${projectDataEntryHref(PROJECT)}?${STATION_PARAM}=zp2-tarif`,
    )
  })

  it('ein mehrfach gesetzter Parameter wird nicht als „nicht gesetzt" gelesen', () => {
    // Sonst spränge der Wizard auf die Startstation zurück, statt die erste Angabe zu nehmen.
    expect(firstParamValue(['zp1-pv', 'ende'])).toBe('zp1-pv')
    expect(firstParamValue('zp1-pv')).toBe('zp1-pv')
    expect(firstParamValue(undefined)).toBeNull()
    expect(firstParamValue([])).toBeNull()
  })
})
