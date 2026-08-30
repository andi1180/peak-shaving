import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  SPOT_PRICE_ANCHOR_DATE,
  SPOT_PRICE_ANCHOR_ISO,
  analysisWindow,
  standardProfileYear,
  startsBeforeSpotPriceAnchor,
} from './analysis-window'
import type { LoadProfile } from './load-profile'

function profile(timestamps: string[]): LoadProfile {
  return {
    readings: timestamps.map((ts) => ({ ts, gridPowerKw: 1 })),
    intervalMinutes: 15,
    timezoneMeta: 'Europe/Vienna',
    source: 'import_only',
  }
}

describe('Delta 15, Regel A — das Fenster ist der Lastgang selbst', () => {
  it('liefert frühesten und spätesten Zeitstempel', () => {
    const w = analysisWindow(
      profile(['2025-06-01T00:00:00.000Z', '2025-06-01T00:15:00.000Z', '2026-05-31T23:45:00.000Z']),
    )
    expect(w).toEqual({
      startIso: '2025-06-01T00:00:00.000Z',
      endIso: '2026-05-31T23:45:00.000Z',
    })
  })

  it('findet die Grenzen auch bei UNSORTIERTEN Messwerten', () => {
    // Der Parser sortiert — aber ein `standard_profile` (Delta 8) muss das nicht. Eine stillschweigende
    // Sortierungs-Annahme wäre genau die Voraussetzung, die später niemand mehr prüft.
    const w = analysisWindow(
      profile([
        '2025-08-15T12:00:00.000Z',
        '2025-03-02T06:00:00.000Z',
        '2025-12-31T23:45:00.000Z',
        '2025-05-05T18:30:00.000Z',
      ]),
    )
    expect(w?.startIso).toBe('2025-03-02T06:00:00.000Z')
    expect(w?.endIso).toBe('2025-12-31T23:45:00.000Z')
  })

  it('liefert kein erfundenes Fenster für ein leeres Profil', () => {
    expect(analysisWindow(profile([]))).toBeNull()
  })
})

const VIENNA = 'Europe/Vienna'

describe('Delta 15, Regel B — Untergrenze 1.1.2025', () => {
  it('weist einen Lastgang vor dem Anker ab', () => {
    const w = analysisWindow(profile(['2023-01-01T00:00:00.000Z', '2023-12-31T23:45:00.000Z']))!
    expect(startsBeforeSpotPriceAnchor(w, VIENNA)).toBe(true)
  })

  it('lässt einen Lastgang GENAU auf dem Anker durch', () => {
    const w = analysisWindow(profile([SPOT_PRICE_ANCHOR_ISO, '2025-12-31T23:45:00.000Z']))!
    expect(startsBeforeSpotPriceAnchor(w, VIENNA)).toBe(false)
  })

  /*
   * ⚠ DER FALL, DER DIE REGEL DEFINIERT — an einem echten Netzbetreiber-Export gemessen.
   * Ein österreichischer Kalenderjahr-2025-Lastgang beginnt mit `01.01.2025 00:00` ORTSZEIT; in UTC
   * ist das `2024-12-31T23:00:00Z`, eine Stunde VOR dem Anker-Zeitpunkt. Gegen den Zeitpunkt geprüft
   * würde ausgerechnet der Regelfall abgelehnt, für den die Regel gemacht ist.
   */
  it('lässt einen Lastgang durch, der ORTSZEIT am 1.1.2025 beginnt (UTC am Vortag)', () => {
    const w = analysisWindow(profile(['2024-12-31T23:00:00.000Z', '2025-12-31T22:45:00.000Z']))!
    expect(w.startIso.slice(0, 10) < SPOT_PRICE_ANCHOR_DATE).toBe(true) // in UTC am VORTAG …
    expect(startsBeforeSpotPriceAnchor(w, VIENNA)).toBe(false) // … ortszeitlich aber am Anker-Tag
  })

  it('weist den Tag DAVOR ab (31.12.2024 Ortszeit)', () => {
    const w = analysisWindow(profile(['2024-12-30T23:00:00.000Z', '2025-12-31T22:45:00.000Z']))!
    expect(startsBeforeSpotPriceAnchor(w, VIENNA)).toBe(true)
  })

  it('rechnet die Zeitzone wirklich um, statt UTC zu unterstellen', () => {
    // Derselbe Zeitpunkt, zwei Zeitzonen: in Wien ist es bereits der 1.1., in Los Angeles noch der
    // 31.12. Ein Test mit nur einer Zeitzone bliebe auch dann grün, wenn `timezone` ignoriert würde.
    const w = analysisWindow(profile(['2024-12-31T23:30:00.000Z', '2025-12-31T22:45:00.000Z']))!
    expect(startsBeforeSpotPriceAnchor(w, VIENNA)).toBe(false)
    expect(startsBeforeSpotPriceAnchor(w, 'America/Los_Angeles')).toBe(true)
  })

  it('entscheidet am ANFANG, nicht am Ende', () => {
    // Ein Lastgang, der vor dem Anker beginnt und weit danach endet, ist trotzdem abzulehnen —
    // der Vergleich braucht Preise für den GANZEN Zeitraum (Regel A), nicht für einen Teil davon.
    const w = analysisWindow(profile(['2024-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z']))!
    expect(startsBeforeSpotPriceAnchor(w, VIENNA)).toBe(true)
  })

  /*
   * ⚠ DIE BEIDEN ANKER-KONSTANTEN TRAGEN BEWUSST NICHT DASSELBE DATUM. `SPOT_PRICE_ANCHOR_DATE` ist
   * der Kalendertag, gegen den Regel B prüft; `SPOT_PRICE_ANCHOR_ISO` ist der Zeitpunkt, ab dem
   * Preise geführt werden — und der muss die ORTSZEIT-Mitternacht dieses Tages sein, sonst hätte
   * die erste Stunde jedes österreichischen Kalenderjahr-Lastgangs keinen Preis (s. Modulkopf).
   * Ein blosser Vergleich der Datumsanteile wäre hier also falsch; geprüft wird die Kante selbst.
   */
  it('der Anker-Zeitpunkt ist die ORTSZEIT-Mitternacht des Anker-Tags', () => {
    const anchorMs = new Date(SPOT_PRICE_ANCHOR_ISO).getTime()
    const viennaDate = (ms: number) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: VIENNA,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(ms))

    expect(viennaDate(anchorMs)).toBe(SPOT_PRICE_ANCHOR_DATE) // der Anker liegt am Anker-Tag …
    expect(viennaDate(anchorMs - 1) < SPOT_PRICE_ANCHOR_DATE).toBe(true) // … und ist dessen erster Moment
  })

  it('deckt den ersten Messwert eines Kalenderjahr-Lastgangs ab (die Ein-Stunden-Kante)', () => {
    // Genau der Fall, für den der Anker um eine Stunde vorgezogen wurde: der erste Zeitstempel
    // eines österreichischen 2025er-Exports darf nicht VOR dem Preisbestand liegen, sonst wäre der
    // aWATTar-Vergleich für jeden solchen Lastgang „nicht berechenbar" (Regel C).
    const w = analysisWindow(profile(['2024-12-31T23:00:00.000Z', '2025-12-31T22:45:00.000Z']))!
    expect(new Date(w.startIso).getTime()).toBeGreaterThanOrEqual(
      new Date(SPOT_PRICE_ANCHOR_ISO).getTime(),
    )
  })
})

describe('Delta 15 — der Anker existiert zweimal und darf nicht auseinanderlaufen', () => {
  /*
   * ⚠ Dieser Wächter liest eine Datei einer ANDEREN App. Das ist Absicht und der einzige verfügbare
   * Weg: `apps/web/scripts/backfill-spot-prices.mjs` ist ein Node-Skript ausserhalb jedes Bundlers,
   * es kann `shared` nicht importieren. Delta 15 verlangt ausdrücklich, dass die beiden Zahlen
   * dieselbe bleiben — ohne diesen Test wäre das eine Absichtserklärung ohne Absicherung.
   *
   * Läuft der Backfill-Anker nach vorn, ohne dass die Konstante folgt, nimmt der Rechner Lastgänge
   * an, für die es keine Preise gibt: aus einer dauerhaften Ablehnung (Regel B) würde eine
   * vorübergehende Datenlücke (Regel C) — genau die Verwechslung, die Delta 15 ausschliesst.
   */
  it('stimmt mit BACKFILL_ANCHOR_ISO im Backfill-Skript überein', () => {
    const script = readFileSync(
      new URL('../../../apps/web/scripts/backfill-spot-prices.mjs', import.meta.url),
      'utf8',
    )
    const match = /const BACKFILL_ANCHOR_ISO = '([^']+)'/.exec(script)
    expect(match, 'BACKFILL_ANCHOR_ISO im Backfill-Skript nicht gefunden').not.toBeNull()
    expect(match![1]).toBe(SPOT_PRICE_ANCHOR_ISO)
  })
})

describe('Delta 8 / 9b-1 — Zeitraum eines synthetischen Standardlastprofils', () => {
  /*
   * Das erzeugte Profil muss zwei Bedingungen erfüllen, und beide werden hier gemessen statt
   * angenommen: nicht vor dem Anker (Regel B) und vollständig in der Vergangenheit (sonst rechnete
   * der Marktpreis-Vergleich gegen Preise, die es noch nicht gibt — Regel C).
   */
  it('liefert das zuletzt abgeschlossene Kalenderjahr', () => {
    expect(standardProfileYear(new Date('2026-08-30T00:00:00Z'))).toBe(2025)
    expect(standardProfileYear(new Date('2026-01-01T00:00:00Z'))).toBe(2025)
    expect(standardProfileYear(new Date('2027-06-15T00:00:00Z'))).toBe(2026)
  })

  it('fällt nie unter das Anker-Jahr — ein Profil, das Regel B verletzt, darf nicht entstehen', () => {
    const jahr = standardProfileYear(new Date('2025-05-01T00:00:00Z'))
    expect(jahr).toBe(Number(SPOT_PRICE_ANCHOR_DATE.slice(0, 4)))
    expect(`${jahr}-12-31` >= SPOT_PRICE_ANCHOR_DATE).toBe(true)
  })

  it('hängt NICHT vom Tag innerhalb des Jahres ab — sonst wäre dieselbe Eingabe morgen ein anderes Profil', () => {
    const tage = ['2026-01-01', '2026-03-17', '2026-08-30', '2026-12-31']
    const jahre = new Set(tage.map((t) => standardProfileYear(new Date(`${t}T12:00:00Z`))))
    expect(jahre.size).toBe(1)
  })
})
