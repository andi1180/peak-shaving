import { describe, expect, it } from 'vitest'
import type { GridTariffWindowInput } from './tariff-pricing'
import { selectRateWindow } from './tariff-window-rules'
import { findWindowCollisions } from './tariff-window-collision'

/**
 * Der Kollisions-Wächter: was verdrängt ein NEUES Zeitfenster?
 *
 * ── ⚠ WORAUF DIESE TESTS ZIELEN ────────────────────────────────────────────────────────────────
 * Der naheliegende Kurzschluss wäre „das neue Fenster verdrängt jedes, mit dem es sich
 * überschneidet". Er ist in BEIDE Richtungen falsch, und beide Richtungen stehen unten als eigener
 * Test:
 *
 *   • zu viel — im Schnitt mit dem ganztägigen `normal` liegt im Sommer bereits `snap` und gewinnt
 *     dort; wer `normal` meldet, nennt das falsche Fenster UND die falsche Preisänderung;
 *   • zu wenig — im Schnitt kann das neue Fenster auch VERLIEREN; dort verdrängt es gar nichts.
 *
 * Die gemeldeten Teilzeiträume sind deshalb Zahl für Zahl gepinnt, nicht bloss auf „nicht leer"
 * geprüft. Ein Wächter, der nur sagt, DASS etwas kollidiert, hilft dem Admin nicht: Er muss vor dem
 * Anlegen lesen können, WELCHER Satz WO durch WELCHEN ersetzt wird — es gibt danach kein Bearbeiten
 * und kein Löschen einzelner Fenster.
 *
 * Die Sätze sind die realen Wiener-Netze-Werte (WN-EX0105, NE 7 ohne Leistungsmessung).
 */

function w(
  label: string,
  timeFrom: string,
  timeTo: string,
  ctPerKwh: number,
  monthDayFrom: string | null = null,
  monthDayTo: string | null = null,
): GridTariffWindowInput {
  return { label, monthDayFrom, monthDayTo, timeFrom, timeTo, ctPerKwh }
}

/** Das ganztägige, ganzjährige Grundfenster. */
const NORMAL = w('normal', '00:00:00', '24:00:00', 6.98)
/** Der SNAP-Ausschnitt: Sommerhalbjahr, 10–16 Uhr. */
const SNAP = w('snap', '10:00:00', '16:00:00', 5.58, '04-01', '09-30')

describe('das neue Fenster verdrängt, was an der Stelle HEUTE gilt — nicht das breiteste', () => {
  it('ein ganzjähriges Mittagsfenster trifft im Sommer `snap` und im Winter `normal`', () => {
    /*
     * Der Kernfall. 11:00–13:00 liegt im Sommer INNERHALB von SNAP (10–16) und im Winter nur
     * innerhalb von `normal`. Eine Schnittmengen-Prüfung meldete hier zweimal `normal` — der Admin
     * läse dann „6,98 → 9,90" für einen Zeitraum, in dem tatsächlich 5,58 gilt.
     */
    const found = findWindowCollisions(w('spitze', '11:00', '13:00', 9.9), [NORMAL, SNAP])

    expect(found).toHaveLength(2)
    expect(found[0]).toMatchObject({
      displacedIndex: 0,
      season: { from: '10-01', to: '03-31' },
      clock: { from: '11:00', to: '13:00' },
      fromCtPerKwh: 6.98,
      toCtPerKwh: 9.9,
    })
    expect(found[0]?.displaced.label).toBe('normal')
    expect(found[1]).toMatchObject({
      displacedIndex: 1,
      season: { from: '04-01', to: '09-30' },
      clock: { from: '11:00', to: '13:00' },
      fromCtPerKwh: 5.58,
      toCtPerKwh: 9.9,
    })
    expect(found[1]?.displaced.label).toBe('snap')
  })

  it('dieselbe Saison am neuen Fenster: dann bleibt genau EINE Verdrängung übrig', () => {
    // Gegenprobe zum Test darüber: Wird das Mittagsfenster auf das Sommerhalbjahr begrenzt, fällt
    // die Winter-Meldung weg. Ohne sie wäre nicht belegt, dass die Saison wirklich mitgemessen wird.
    const found = findWindowCollisions(w('sommer', '11:00', '13:00', 9.9, '04-01', '09-30'), [
      NORMAL,
      SNAP,
    ])

    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      displacedIndex: 1,
      season: { from: '04-01', to: '09-30' },
      clock: { from: '11:00', to: '13:00' },
      fromCtPerKwh: 5.58,
      toCtPerKwh: 9.9,
    })
  })

  it('⚠ der gemeldete Teilzeitraum ist LÜCKENHAFT, wo ein engeres Fenster gewinnt', () => {
    /*
     * Der schärfste Fall: Ein zweites ganztägiges, ganzjähriges Fenster hat exakt dieselbe
     * Abdeckung wie `normal` und gewinnt deshalb NUR über den Preis (Gleichstands-Regel). Gegen
     * `snap` verliert es überall — und genau dort darf keine Verdrängung gemeldet werden.
     *
     * Heraus kommen deshalb zwei Teilzeiträume statt eines: im Winter der ganze Tag, im Sommer der
     * Tag OHNE die SNAP-Stunden — als über Mitternacht laufender Bereich 16:00–10:00.
     */
    const found = findWindowCollisions(w('zweitrangig', '00:00', '24:00', 12), [NORMAL, SNAP])

    expect(found).toHaveLength(2)
    expect(found.every((f) => f.displacedIndex === 0)).toBe(true)
    expect(found.map((f) => ({ season: f.season, clock: f.clock }))).toEqual([
      { season: { from: '04-01', to: '09-30' }, clock: { from: '16:00', to: '10:00' } },
      { season: { from: '10-01', to: '03-31' }, clock: { from: '00:00', to: '24:00' } },
    ])
    expect(found.every((f) => f.fromCtPerKwh === 6.98 && f.toCtPerKwh === 12)).toBe(true)
  })
})

describe('kein Fund heisst: es wird nichts verdrängt', () => {
  it('ein Fenster in einer LÜCKE verdrängt nichts', () => {
    // Ohne Grundfenster gilt vor 10:00 gar kein Satz — das neue füllt, es ersetzt nicht.
    expect(findWindowCollisions(w('frueh', '08:00', '09:00', 4.0), [SNAP])).toEqual([])
  })

  it('ein Fenster, das überall VERLIERT, verdrängt nichts', () => {
    /*
     * Gleiche Abdeckung wie `normal`, aber billiger — die Gleichstands-Regel gibt dem Bestand den
     * Vorrang. Ergebnis: leer, also keine Warnung.
     *
     * ⚠ Damit ist „leer" zweideutig: Es heisst „füllt eine Lücke" ODER „bleibt wirkungslos". Die
     * Unterscheidung ist hier bewusst NICHT gebaut (s. Kopf des Moduls); wer sie braucht, ergänzt
     * sie als eigene Prüfung und nicht als stille Nebenbedeutung dieses Rückgabewerts.
     */
    expect(findWindowCollisions(w('billiger', '00:00', '24:00', 3.0), [NORMAL])).toEqual([])
  })

  it('ohne bestehende Fenster gibt es nichts zu verdrängen', () => {
    expect(findWindowCollisions(w('erstes', '00:00', '24:00', 6.98), [])).toEqual([])
  })

  it('ein Fenster ohne Dauer (von = bis) gilt nirgends und verdrängt nichts', () => {
    expect(findWindowCollisions(w('leer', '12:00', '12:00', 9.9), [NORMAL])).toEqual([])
  })
})

describe('die Ränder: über Mitternacht und über den Jahreswechsel', () => {
  it('ein Nachtfenster wird als EIN Bereich 22:00–06:00 gemeldet, nicht als zwei', () => {
    const found = findWindowCollisions(w('nacht', '22:00', '06:00', 3.2), [NORMAL, SNAP])

    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      displacedIndex: 0,
      // Ganzjährig: SNAP (10–16) überschneidet sich mit 22–06 an keinem Punkt.
      season: null,
      clock: { from: '22:00', to: '06:00' },
      fromCtPerKwh: 6.98,
      toCtPerKwh: 3.2,
    })
  })

  it('eine Wintersaison wird als EIN Zeitraum 10-01…03-31 gemeldet, nicht als zwei Jahresenden', () => {
    const found = findWindowCollisions(w('winter', '17:00', '20:00', 11.35, '10-01', '03-31'), [
      NORMAL,
    ])

    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      season: { from: '10-01', to: '03-31' },
      clock: { from: '17:00', to: '20:00' },
    })
  })

  it('ein ganzjähriges Fenster meldet `season: null`, kein 01-01…12-31', () => {
    // „ganzjährig" ist die Aussage, die auch in der Datenbank steht (beide Saisonspalten null) —
    // ein ausgeschriebenes Datumspaar sähe aus wie eine gesetzte Saison.
    const found = findWindowCollisions(w('mittag', '11:00', '13:00', 9.9), [NORMAL])
    expect(found).toHaveLength(1)
    expect(found[0]?.season).toBeNull()
  })
})

describe('die Identität des verdrängten Fensters', () => {
  it('zwei strukturell IDENTISCHE Bestandsfenster werden über ihre Position unterschieden', () => {
    /*
     * Es gibt keinen Unique-Constraint über die Fensterfelder — zwei gleiche Zeilen sind ein
     * möglicher Pflegefehler. Verdrängt wird nach der Auswahlregel das ZUERST genannte (es gewinnt
     * den vollständigen Gleichstand); ohne die Position im Ergebnis wäre nicht sagbar, welche der
     * beiden Zeilen gemeint ist.
     */
    const a = w('doppelt', '10:00', '12:00', 5.0)
    const b = w('doppelt', '10:00', '12:00', 5.0)
    const found = findWindowCollisions(w('enger', '10:30', '11:00', 8.0), [NORMAL, a, b])

    expect(found).toHaveLength(1)
    expect(found[0]?.displacedIndex).toBe(1)
    expect(found[0]?.displaced).toBe(a)
  })
})

describe('der Wächter benutzt DIESELBE Regel wie die Rechnung', () => {
  it('an jedem gemeldeten Punkt kippt die Auswahl tatsächlich — Stichproben gegen selectRateWindow', () => {
    /*
     * Die eigentliche Zusage dieses Bauabschnitts: Was die Warnung ankündigt, ist genau das, was
     * die Engine danach rechnet. Geprüft wird deshalb nicht die Meldung gegen sich selbst, sondern
     * gegen `selectRateWindow` — die Funktion, die im Intervallpreis (Delta 4) läuft.
     */
    const candidate = w('spitze', '11:00', '13:00', 9.9)
    const existing = [NORMAL, SNAP]
    const after = [...existing, candidate]

    // Sommer, 12:00 — die Meldung sagt: `snap` (5,58) weicht `spitze` (9,90).
    expect(selectRateWindow(existing, 6, 15, 12 * 60)?.ctPerKwh).toBe(5.58)
    expect(selectRateWindow(after, 6, 15, 12 * 60)?.ctPerKwh).toBe(9.9)

    // Winter, 12:00 — dort weicht `normal` (6,98).
    expect(selectRateWindow(existing, 1, 15, 12 * 60)?.ctPerKwh).toBe(6.98)
    expect(selectRateWindow(after, 1, 15, 12 * 60)?.ctPerKwh).toBe(9.9)

    // Direkt AUSSERHALB der gemeldeten Bereiche bleibt alles, wie es war.
    for (const [month, day, minute] of [
      [6, 15, 10 * 60 + 59],
      [6, 15, 13 * 60],
      [1, 15, 10 * 60 + 59],
    ] as const) {
      expect(selectRateWindow(after, month, day, minute)?.label).toBe(
        selectRateWindow(existing, month, day, minute)?.label,
      )
    }
  })

  it('KEIN Punkt ausserhalb der gemeldeten Bereiche ändert sich — vollständig durchgezählt', () => {
    /*
     * Die Stichproben oben zeigen, dass die Meldung stimmt, wo sie etwas sagt. Dieser Test zeigt
     * das Gegenstück: dass sie nichts AUSLÄSST. Über alle 366 Kalendertage × 24 Stunden wird
     * gezählt, an wie vielen Punkten sich die Auswahl ändert, und dieselbe Zahl aus den gemeldeten
     * Bereichen abgeleitet. Ohne diese Gegenprobe bliebe ein Wächter grün, der die halbe
     * Verdrängung verschweigt.
     */
    const candidate = w('zweitrangig', '00:00', '24:00', 12)
    const existing = [NORMAL, SNAP]
    const after = [...existing, candidate]

    let changed = 0
    for (let month = 1; month <= 12; month++) {
      for (let day = 1; day <= 28; day++) {
        for (let hour = 0; hour < 24; hour++) {
          const before = selectRateWindow(existing, month, day, hour * 60)
          const now = selectRateWindow(after, month, day, hour * 60)
          if (before !== now) changed++
        }
      }
    }

    // Sommer (April–September, hier 6 × 28 Tage) ohne die sechs SNAP-Stunden = 18 Stunden/Tag,
    // Winter (6 × 28 Tage) volle 24 Stunden.
    expect(changed).toBe(6 * 28 * 18 + 6 * 28 * 24)

    const found = findWindowCollisions(candidate, existing)
    const covered = found.reduce((sum, f) => {
      const hours = f.clock.from === '00:00' && f.clock.to === '24:00' ? 24 : 18
      return sum + 6 * 28 * hours
    }, 0)
    expect(covered).toBe(changed)
  })
})
