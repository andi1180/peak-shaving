import { describe, expect, it } from 'vitest'
import {
  describeWindowCollision,
  draftCollisions,
  draftToWindowInput,
  toWindowInput,
  type GridTariffRateWindowRow,
  type RateWindowDraft,
} from './grid-tariffs'

/**
 * Die Warnung des „Zeitfenster ergänzen"-Formulars (B21-2d) — der Teil, der ohne Browser prüfbar ist.
 *
 * ── ⚠ WARUM DAS HIER STEHT UND NICHT NUR IN `shared` ──────────────────────────────────────────
 * `packages/shared` prüft die REGEL (wer verdrängt wen, in welchem Teilzeitraum). Was hier geprüft
 * wird, ist die Übersetzung dazwischen: aus getippten Zeichenketten wird ein Fenster, aus einem
 * Befund wird ein Satz. Genau in dieser Übersetzung sitzt die Sorte Fehler, die niemandem auffällt —
 * eine halb getippte Uhrzeit, aus der eine Warnung über ein Fenster entsteht, das so nie angelegt
 * wird; oder eine Meldung, die die Überschneidung nennt und die Preisänderung verschweigt.
 */

function row(
  label: string,
  timeFrom: string,
  timeTo: string,
  ctPerKwh: number,
  monthDayFrom: string | null = null,
  monthDayTo: string | null = null,
): GridTariffRateWindowRow {
  return {
    id: `id-${label}`,
    grid_tariff_id: 'tariff',
    label,
    month_day_from: monthDayFrom,
    month_day_to: monthDayTo,
    time_from: timeFrom,
    time_to: timeTo,
    ct_per_kwh: ctPerKwh,
    note: null,
  }
}

/** Die realen Wiener-Netze-Sätze (WN-EX0105, NE 7 ohne Leistungsmessung). */
const NORMAL = row('normal', '00:00:00', '24:00:00', 6.98)
const SNAP = row('snap', '10:00:00', '16:00:00', 5.58, '04-01', '09-30')

function draft(partial: Partial<RateWindowDraft>): RateWindowDraft {
  return {
    label: 'spitze',
    monthDayFrom: '',
    monthDayTo: '',
    timeFrom: '11:00',
    timeTo: '13:00',
    ctPerKwh: '9.9',
    ...partial,
  }
}

describe('eine gespeicherte Zeile wird verlustfrei zur Fenster-Eingabe', () => {
  it('snake_case → camelCase, `null` bleibt `null`', () => {
    // PostgREST liefert `time` mit Sekunden (`10:00:00`); `parseClockMinutes` liest beide Formen.
    expect(toWindowInput(SNAP)).toEqual({
      label: 'snap',
      monthDayFrom: '04-01',
      monthDayTo: '09-30',
      timeFrom: '10:00:00',
      timeTo: '16:00:00',
      ctPerKwh: 5.58,
    })
    expect(toWindowInput(NORMAL).monthDayFrom).toBeNull()
  })
})

describe('ein unvollständiger Entwurf erzeugt KEINE Warnung', () => {
  it('halb getippte Uhrzeit → null', () => {
    /*
     * Der wichtigste dieser Fälle. „1" ist auf dem Weg zu „11:00", und eine daraus gebaute Warnung
     * spräche über ein Fenster, das der Admin nie abschickt — sie wäre nicht bloss nutzlos, sondern
     * falsch. Die Warnung ist eine Auskunft über den FERTIGEN Eintrag, keine Tipp-Begleitung.
     */
    expect(draftToWindowInput(draft({ timeFrom: '1' }))).toBeNull()
    expect(draftToWindowInput(draft({ timeFrom: '' }))).toBeNull()
    expect(draftToWindowInput(draft({ timeTo: '25:00' }))).toBeNull()
  })

  it('fehlender oder unbrauchbarer Preis → null', () => {
    expect(draftToWindowInput(draft({ ctPerKwh: '' }))).toBeNull()
    expect(draftToWindowInput(draft({ ctPerKwh: 'abc' }))).toBeNull()
    expect(draftToWindowInput(draft({ ctPerKwh: '-1' }))).toBeNull()
  })

  it('halb angegebene Saison → null (dieselbe Regel wie im Schema)', () => {
    // „ab 01.04." ohne Ende liesse offen, ob das Fenster einen Tag oder neun Monate gilt.
    expect(draftToWindowInput(draft({ monthDayFrom: '04-01' }))).toBeNull()
    expect(draftToWindowInput(draft({ monthDayTo: '09-30' }))).toBeNull()
    expect(draftToWindowInput(draft({ monthDayFrom: '04-1', monthDayTo: '09-30' }))).toBeNull()
  })

  it('`24:00` ist gültig — das Tagesende, das der Zeitwähler des Browsers nicht kann', () => {
    expect(draftToWindowInput(draft({ timeFrom: '00:00', timeTo: '24:00' }))).not.toBeNull()
  })

  it('ein Dezimalkomma wird gelesen — es ist die österreichische Schreibweise', () => {
    // Ohne diese Umsetzung bliebe die Warnung bei jedem „5,58" stumm, also im Regelfall.
    expect(draftToWindowInput(draft({ ctPerKwh: '5,58' }))?.ctPerKwh).toBe(5.58)
  })
})

describe('die Warnung nennt das verdrängte Fenster, den Zeitraum UND die Preisänderung', () => {
  it('ein ganzjähriges Mittagsfenster trifft im Sommer `snap`, im Winter `normal`', () => {
    const found = draftCollisions(draft({}), [NORMAL, SNAP])
    expect(found).toHaveLength(2)
    expect(found.map(describeWindowCollision)).toEqual([
      'Dieses Fenster verdrängt vom 01.10. bis 31.03. zwischen 11:00 und 13:00 das Fenster ' +
        '„normal" (6,98 → 9,90 ct/kWh).',
      'Dieses Fenster verdrängt vom 01.04. bis 30.09. zwischen 11:00 und 13:00 das Fenster ' +
        '„snap" (5,58 → 9,90 ct/kWh).',
    ])
  })

  it('ganzjährig betroffen heisst „ganzjährig", nicht ein ausgeschriebenes Datumspaar', () => {
    const found = draftCollisions(draft({ timeFrom: '22:00', timeTo: '06:00' }), [NORMAL, SNAP])
    expect(found).toHaveLength(1)
    expect(describeWindowCollision(found[0]!)).toBe(
      'Dieses Fenster verdrängt ganzjährig zwischen 22:00 und 06:00 das Fenster „normal" ' +
        '(6,98 → 9,90 ct/kWh).',
    )
  })

  it('⚠ die Preisänderung steht IM Satz — sonst beschriebe er eine Lage statt einer Folge', () => {
    // „überschneidet sich mit ‚snap'" sagt nicht, was sich für künftige Kunden dieser Netzebene
    // ändert. Genau diese Zahl ist das, was sich nachträglich nicht mehr korrigieren lässt.
    const satz = describeWindowCollision(draftCollisions(draft({}), [SNAP])[0]!)
    expect(satz).toContain('5,58 → 9,90 ct/kWh')
  })

  it('ein Fenster in einer LÜCKE und ein unvollständiger Entwurf warnen beide nicht', () => {
    // Ohne Grundfenster gilt vor 10:00 gar kein Satz — das neue füllt, es ersetzt nicht.
    expect(draftCollisions(draft({ timeFrom: '08:00', timeTo: '09:00' }), [SNAP])).toEqual([])
    expect(draftCollisions(draft({ timeFrom: '1' }), [NORMAL, SNAP])).toEqual([])
  })
})
