import { describe, expect, it } from 'vitest'
import type { GridTariffRowInput, GridTariffWindowInput } from 'shared'
import { coverageScore } from 'shared'
import { findGridTariffWindow } from './grid-tariff-window'

/**
 * Die Fenster-Auswahlregel (Delta 5) — direkt gemessen, nicht über den Intervallpreis.
 *
 * ── ⚠ WARUM DIESE DATEI ÜBERHAUPT NÖTIG WAR ────────────────────────────────────────────────────
 * `findGridTariffWindow` hatte bis zum 02.09.2026 KEINEN eigenen Test. Geprüft war sie nur mittelbar
 * über `tou.test.ts`, und zwar ausschliesslich mit dem realen Zwei-Fenster-Fall (ganztägiges
 * `normal` + saisonales `snap`). Genau die Fälle, in denen die Regel überhaupt eine Entscheidung
 * TRIFFT, waren damit ungeprüft:
 *
 *   A  Grundfall + Kanten — die Regel muss auf die Minute und auf den Kalendertag genau greifen.
 *   B  Gleichstand — bei exakt gleicher Abdeckung gewinnt der HÖHERE Preis, unabhängig von der
 *      Reihenfolge der Liste; bei gleichem Preis das zuerst genannte Fenster.
 *   C  Drei überlappende Fenster — es gewinnt das ENGSTE, nicht das zuletzt eingetragene.
 *   D  Verdrängung — ein neues, engeres Fenster ändert das Ergebnis an einem Punkt, an dem bisher
 *      ein anderes galt. Das ist der Fall, den der Kollisions-Wächter in `shared` meldet; hier
 *      steht er als reine Aussage über die Auswahlregel.
 *
 * Die Zahlen sind gepinnt und nicht bloss verglichen: eine Regel, die nur „irgendein Fenster"
 * liefert, ist keine.
 *
 * ── DIE SÄTZE SIND DIE ECHTEN ──────────────────────────────────────────────────────────────────
 * `normal` 6,98 und `snap` 5,58 ct/kWh sind die realen Wiener-Netze-Werte für NE 7 ohne
 * Leistungsmessung (Preisblatt WN-EX0105, 01.09.2026 gegen die Cloud gemessen). ⚠ SNAP ist dort
 * BILLIGER als der Grundsatz — die Auswahl folgt der Abdeckung und ausdrücklich nicht dem Preis;
 * ein Test mit einem teureren Ausschnitt liesse offen, ob die Regel nicht insgeheim „der teurere
 * gewinnt" lautet.
 */

function row(windows: GridTariffWindowInput[]): GridTariffRowInput {
  return {
    validFrom: '2026-01-01',
    validUntil: null,
    netzverlustCtPerKwh: 0.7,
    priceBasis: 'net',
    windows,
  }
}

function window(
  label: string,
  timeFrom: string,
  timeTo: string,
  ctPerKwh: number,
  monthDayFrom: string | null = null,
  monthDayTo: string | null = null,
): GridTariffWindowInput {
  return { label, monthDayFrom, monthDayTo, timeFrom, timeTo, ctPerKwh }
}

/** Das ganztägige, ganzjährige Grundfenster — auf jedem realen Preisblatt vorhanden. */
const NORMAL = window('normal', '00:00:00', '24:00:00', 6.98)
/** Der SNAP-Ausschnitt: Sommerhalbjahr, 10–16 Uhr (WN-EX0105). */
const SNAP = window('snap', '10:00:00', '16:00:00', 5.58, '04-01', '09-30')

/** Kurzform: welches Fenster gilt am (month, day) um `hh:mm` Ortszeit? */
function at(
  windows: GridTariffWindowInput[],
  month: number,
  day: number,
  clock: string,
): { label: string; ctPerKwh: number } | null {
  const [h, m] = clock.split(':')
  const hit = findGridTariffWindow(row(windows), month, day, Number(h) * 60 + Number(m))
  return hit === null ? null : { label: hit.label, ctPerKwh: hit.ctPerKwh }
}

describe('A — Grundfall: der engere Ausschnitt gewinnt, und zwar auf die Minute und den Tag genau', () => {
  it('die Uhrzeit-Kante liegt exakt bei 10:00 und 16:00', () => {
    const set = [NORMAL, SNAP]
    // 15. Juni: mitten in der SNAP-Saison.
    expect(at(set, 6, 15, '09:59')).toEqual({ label: 'normal', ctPerKwh: 6.98 })
    expect(at(set, 6, 15, '10:00')).toEqual({ label: 'snap', ctPerKwh: 5.58 })
    expect(at(set, 6, 15, '15:59')).toEqual({ label: 'snap', ctPerKwh: 5.58 })
    // `timeTo` ist EXKLUSIV — 16:00 gehört bereits wieder zum Grundfenster.
    expect(at(set, 6, 15, '16:00')).toEqual({ label: 'normal', ctPerKwh: 6.98 })
  })

  it('die Saison-Kanten sind BEIDE inklusiv — 01.04. und 30.09. gehören noch dazu', () => {
    const set = [NORMAL, SNAP]
    expect(at(set, 3, 31, '12:00')).toEqual({ label: 'normal', ctPerKwh: 6.98 })
    expect(at(set, 4, 1, '12:00')).toEqual({ label: 'snap', ctPerKwh: 5.58 })
    expect(at(set, 9, 30, '12:00')).toEqual({ label: 'snap', ctPerKwh: 5.58 })
    expect(at(set, 10, 1, '12:00')).toEqual({ label: 'normal', ctPerKwh: 6.98 })
  })

  it('ohne passendes Fenster kommt `null` zurück — nicht ein beliebiges', () => {
    // Eine Tarifzeile ohne Grundfenster ist ein Pflegefehler; die Regel erfindet dafür nichts.
    expect(at([SNAP], 6, 15, '20:00')).toBeNull()
    expect(at([], 6, 15, '12:00')).toBeNull()
  })

  it('die Abdeckungs-Ordnung ist die Begründung — SNAP ist enger, NICHT teurer', () => {
    // Ohne diesen Pin bliebe offen, WORAN die Regel entscheidet: SNAP ist hier der BILLIGERE Satz
    // und gewinnt trotzdem. 183 Saisontage × 360 Minuten gegen 366 × 1440.
    expect(coverageScore(SNAP)).toBe(65_880)
    expect(coverageScore(NORMAL)).toBe(527_040)
    expect(SNAP.ctPerKwh).toBeLessThan(NORMAL.ctPerKwh)
  })
})

describe('A — über Mitternacht und über den Jahreswechsel laufende Fenster', () => {
  it('ein Nachtfenster 22:00–06:00 gilt auf beiden Seiten der Mitternacht', () => {
    const nacht = window('nacht', '22:00:00', '06:00:00', 3.2)
    const set = [NORMAL, nacht]
    // 480 Minuten × 366 Tage = 175 680 — enger als das ganztägige Grundfenster.
    expect(coverageScore(nacht)).toBe(175_680)
    expect(at(set, 1, 15, '21:59')).toEqual({ label: 'normal', ctPerKwh: 6.98 })
    expect(at(set, 1, 15, '22:00')).toEqual({ label: 'nacht', ctPerKwh: 3.2 })
    expect(at(set, 1, 15, '03:00')).toEqual({ label: 'nacht', ctPerKwh: 3.2 })
    expect(at(set, 1, 15, '05:59')).toEqual({ label: 'nacht', ctPerKwh: 3.2 })
    expect(at(set, 1, 15, '06:00')).toEqual({ label: 'normal', ctPerKwh: 6.98 })
  })

  it('eine Wintersaison 10-01…03-31 läuft über den Jahreswechsel — beide Enden inklusiv', () => {
    const winter = window('winter', '17:00:00', '20:00:00', 11.35, '10-01', '03-31')
    const set = [NORMAL, winter]
    // 183 Saisontage × 180 Minuten.
    expect(coverageScore(winter)).toBe(32_940)
    expect(at(set, 9, 30, '18:00')).toEqual({ label: 'normal', ctPerKwh: 6.98 })
    expect(at(set, 10, 1, '18:00')).toEqual({ label: 'winter', ctPerKwh: 11.35 })
    expect(at(set, 1, 15, '18:00')).toEqual({ label: 'winter', ctPerKwh: 11.35 })
    expect(at(set, 3, 31, '18:00')).toEqual({ label: 'winter', ctPerKwh: 11.35 })
    expect(at(set, 4, 1, '18:00')).toEqual({ label: 'normal', ctPerKwh: 6.98 })
  })
})

describe('B — Gleichstand: bei gleicher Abdeckung gewinnt der HÖHERE Preis', () => {
  const guenstig = window('a-billig', '08:00:00', '12:00:00', 3.0)
  const teuer = window('b-teuer', '08:00:00', '12:00:00', 7.5)

  it('zwei gleich enge Fenster: der teurere Satz gilt', () => {
    expect(coverageScore(guenstig)).toBe(coverageScore(teuer))
    expect(at([NORMAL, guenstig, teuer], 6, 15, '09:00')).toEqual({
      label: 'b-teuer',
      ctPerKwh: 7.5,
    })
  })

  it('und zwar UNABHÄNGIG von der Reihenfolge der Liste', () => {
    /*
     * Der eigentliche Punkt dieses Tests. Ohne die Preis-Bedingung wäre die Auswahl bei Gleichstand
     * die der Sortierreihenfolge einer Abfrage — genau der Zustand, den B21-1 auf der ZEILENebene
     * per `unique nulls not distinct` ausschliesst. Ein Test mit nur EINER Reihenfolge bliebe auch
     * dann grün, wenn schlicht das erste passende Fenster gewönne.
     */
    expect(at([NORMAL, teuer, guenstig], 6, 15, '09:00')).toEqual({
      label: 'b-teuer',
      ctPerKwh: 7.5,
    })
  })

  it('bei gleicher Abdeckung UND gleichem Preis gewinnt das zuerst genannte', () => {
    // Zwei in jeder Hinsicht gleiche Fenster sind ein Pflegefehler ohne Auswirkung auf den Preis;
    // eine zweite, erfundene Ordnung (Bezeichnung? Anlagezeitpunkt?) wäre schlechter als die
    // Reihenfolge, die dasteht.
    const erste = window('erste', '08:00:00', '12:00:00', 4.4)
    const zweite = window('zweite', '08:00:00', '12:00:00', 4.4)
    expect(at([NORMAL, erste, zweite], 6, 15, '09:00')?.label).toBe('erste')
    expect(at([NORMAL, zweite, erste], 6, 15, '09:00')?.label).toBe('zweite')
  })
})

describe('C — drei überlappende Fenster: es gewinnt das ENGSTE', () => {
  /** Ein ganzjähriger Mittags-Ausschnitt, der IN der SNAP-Zeit liegt. */
  const spitze = window('spitze', '11:00:00', '13:00:00', 9.9)
  const set = [NORMAL, SNAP, spitze]

  it('die Ordnung der drei ist gepinnt — sonst sagt „das engste gewinnt" nichts', () => {
    expect(coverageScore(spitze)).toBe(43_920) // 366 × 120
    expect(coverageScore(SNAP)).toBe(65_880) // 183 × 360
    expect(coverageScore(NORMAL)).toBe(527_040) // 366 × 1440
  })

  it('im Sommer greift je nach Uhrzeit ein anderes der drei', () => {
    expect(at(set, 6, 15, '12:00')).toEqual({ label: 'spitze', ctPerKwh: 9.9 }) // alle drei
    expect(at(set, 6, 15, '10:30')).toEqual({ label: 'snap', ctPerKwh: 5.58 }) // normal + snap
    expect(at(set, 6, 15, '17:00')).toEqual({ label: 'normal', ctPerKwh: 6.98 }) // nur normal
  })

  it('im Winter fällt SNAP heraus, das ganzjährige Mittagsfenster bleibt', () => {
    expect(at(set, 1, 15, '12:00')).toEqual({ label: 'spitze', ctPerKwh: 9.9 })
    expect(at(set, 1, 15, '10:30')).toEqual({ label: 'normal', ctPerKwh: 6.98 })
  })

  it('die Reihenfolge der Liste ändert nichts — auch nicht bei drei Fenstern', () => {
    expect(at([spitze, SNAP, NORMAL], 6, 15, '12:00')?.label).toBe('spitze')
    expect(at([SNAP, NORMAL, spitze], 6, 15, '10:30')?.label).toBe('snap')
  })
})

describe('D — Verdrängung: ein neues, engeres Fenster ersetzt still ein bestehendes', () => {
  it('derselbe Zeitpunkt liefert vor und nach dem Hinzufügen einen ANDEREN Satz', () => {
    /*
     * Der Fall, um den es beim Pflegeweg geht: Am 15. Juni um 12:00 gilt heute `snap` mit 5,58
     * ct/kWh. Wird ein Mittagsfenster 11:00–13:00 hinzugefügt, gilt dort 9,90 — `snap` steht
     * unverändert in der Liste und wird trotzdem nicht mehr angewandt. Nichts wurde gelöscht,
     * nichts geändert; der Preis ist ein anderer.
     */
    const vorher = [NORMAL, SNAP]
    const spitze = window('spitze', '11:00:00', '13:00:00', 9.9)
    const nachher = [...vorher, spitze]

    expect(at(vorher, 6, 15, '12:00')).toEqual({ label: 'snap', ctPerKwh: 5.58 })
    expect(at(nachher, 6, 15, '12:00')).toEqual({ label: 'spitze', ctPerKwh: 9.9 })

    // Ausserhalb des neuen Ausschnitts ändert sich NICHTS — die Verdrängung ist örtlich begrenzt.
    expect(at(nachher, 6, 15, '10:30')).toEqual({ label: 'snap', ctPerKwh: 5.58 })
    expect(at(nachher, 6, 15, '17:00')).toEqual({ label: 'normal', ctPerKwh: 6.98 })
    // Im Winter verdrängt dasselbe Fenster nicht `snap` (das gilt dort nicht), sondern `normal`.
    expect(at(vorher, 1, 15, '12:00')).toEqual({ label: 'normal', ctPerKwh: 6.98 })
    expect(at(nachher, 1, 15, '12:00')).toEqual({ label: 'spitze', ctPerKwh: 9.9 })
  })

  it('ein WEITERES Fenster verdrängt nichts, wenn es überall verliert', () => {
    // Gegenprobe zur Verdrängung: ein ganztägiges, ganzjähriges Zweitfenster ist nirgends enger als
    // `snap` oder `spitze` und ändert deshalb an keinem der drei Punkte etwas.
    const spitze = window('spitze', '11:00:00', '13:00:00', 9.9)
    const vorher = [NORMAL, SNAP, spitze]
    const nachher = [...vorher, window('zweitrangig', '00:00:00', '24:00:00', 12.0)]

    // ⚠ Ausser dort, wo bisher NUR `normal` galt: gleiche Abdeckung, höherer Preis — Fall B greift.
    expect(at(nachher, 6, 15, '12:00')).toEqual({ label: 'spitze', ctPerKwh: 9.9 })
    expect(at(nachher, 6, 15, '10:30')).toEqual({ label: 'snap', ctPerKwh: 5.58 })
    expect(at(nachher, 6, 15, '17:00')).toEqual({ label: 'zweitrangig', ctPerKwh: 12.0 })
  })
})
