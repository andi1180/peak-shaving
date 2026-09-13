import { describe, expect, it } from 'vitest'

import { tariffParamsSchema } from 'shared'

import {
  PV_COVERED_FROM_KEY,
  PV_COVERED_TO_KEY,
  PV_INTERVAL_MINUTES_KEY,
  PV_PROFILE_GAPS_KEY,
  PV_PROFILE_SOURCE_KEY,
  PV_SOURCE_DOCUMENT_ID_KEY,
  hasPvProfile,
  pvProfileDraftValues,
  pvProfileKeysCollideWithContract,
  readPvProfileDraft,
  withPvProfileGaps,
  type PvProfileGapRange,
} from './pv-profile-draft'

/**
 * B24, Teil 1 — die gelesene PV-Erzeugungsreihe im Entwurf eines Zählpunkts.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WAS HIER „FUNKTIONIERT", AUCH WENN ES FALSCH IST
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Dieses Modul liegt zwischen zwei Konsumenten mit ENTGEGENGESETZTER Richtung: die Server Action
 * schreibt, die Station liest. Jeder der vier Fehler darunter erzeugt einen Zustand, den weder ein
 * Build noch ein Typecheck noch die Oberfläche als solchen zeigt:
 *
 *   1. EIN FELD UNTER DEM FALSCHEN SCHLÜSSEL. Gespeichert würde es trotzdem — nur läse die Station
 *      es nie wieder und behauptete, es sei nichts eingelesen worden. Genau deshalb gibt es dieses
 *      Modul überhaupt (und nicht zwei ausgeschriebene Schlüssellisten).
 *
 *   2. `hasPvProfile` AN DER DOKUMENT-KENNUNG ODER AN DEN LÜCKEN GEMESSEN. Beide sind legitim
 *      abwesend — die Kennung kann durch ein späteres Löschen des Dokuments verschwinden, eine
 *      leere Lückenliste ist der Normalfall einer sauberen Datei. Die Station stellte ihre Frage
 *      dann erneut, obwohl der Zeitraum gespeichert ist. (Derselbe Fehler, den der Lastgang-Schritt
 *      mit `profileSource` schon einmal hatte.)
 *
 *   3. EIN SCHLÜSSEL, DER EINEN CONTRACT-FELDNAMEN VERDECKT. Er liefe durch die Schema-Prüfung und
 *      behauptete dort eine Tarifangabe, die niemand gemacht hat.
 *
 *   4. EIN HALBER LÜCKEN-EINTRAG, MIT PLATZHALTER GEFÜLLT. Er sähe aus wie eine gemessene Lücke.
 *
 * ⚠ Die Metadaten kommen hier als LITERALE herein, nicht aus `readPvProfileMetadata`: geprüft wird
 * die ZUORDNUNG (welcher gelesene Wert landet unter welchem Schlüssel), und die ist nur dann
 * messbar, wenn die vier Werte voneinander unterscheidbar sind. Was der Leser aus einer echten
 * Datei macht, misst `packages/engine/src/parser/metadata.test.ts`.
 */

const GAPS: PvProfileGapRange[] = [
  { from: '2025-10-26T00:00:00.000Z', to: '2025-10-26T01:00:00.000Z' },
  { from: '2025-11-02T03:00:00.000Z', to: '2025-11-02T06:00:00.000Z' },
]

/** Eine gelesene Reihe, deren vier Angaben paarweise verschieden sind. */
const SCAN = {
  intervalMinutes: 15,
  coveredFrom: '2024-12-31T23:00:00.000Z',
  coveredTo: '2025-12-31T23:00:00.000Z',
  gaps: GAPS,
}

const DOCUMENT_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'

/** Ein vollständig befüllter Entwurf, wie ihn die Action hinterlässt. */
function filledDraft(): Record<string, unknown> {
  let draft = withPvProfileGaps({}, SCAN.gaps)
  for (const { field, value } of pvProfileDraftValues(SCAN, DOCUMENT_ID)) {
    draft = { ...draft, [field]: value }
  }
  return draft
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('pvProfileDraftValues — die Zuordnung gelesener Wert → Schlüssel', () => {
  it('⚠ ordnet die vier Skalare einzeln zu — und `coveredFrom` nicht `coveredTo`', () => {
    const values = pvProfileDraftValues(SCAN, DOCUMENT_ID)
    const byField = Object.fromEntries(values.map(({ field, value }) => [field, value]))

    expect(byField[PV_INTERVAL_MINUTES_KEY]).toBe(15)
    expect(byField[PV_COVERED_FROM_KEY]).toBe('2024-12-31T23:00:00.000Z')
    expect(byField[PV_COVERED_TO_KEY]).toBe('2025-12-31T23:00:00.000Z')
    expect(byField[PV_SOURCE_DOCUMENT_ID_KEY]).toBe(DOCUMENT_ID)

    /*
     * ⚠ Vertauschte Zeitgrenzen wären der teuerste Fehler dieser Funktion: ein Zeitraum, der
     * rückwärts läuft, sieht in jeder Anzeige aus wie ein Zeitraum. Die zwei Werte sind deshalb
     * absichtlich verschieden und werden EINZELN geprüft, nicht als Paar.
     */
    expect(byField[PV_COVERED_FROM_KEY]).not.toBe(byField[PV_COVERED_TO_KEY])
  })

  it('⚠ liefert GENAU diese fünf Felder — die Lücken sind NICHT dabei', () => {
    /*
     * Sie sind eine LISTE, und `setDraftField` nimmt ausdrücklich nur `number | string | boolean`.
     * Käme hier ein weiterer Eintrag mit dem Lücken-Array, landete es als Wert in einem Skalarfeld
     * — gespeichert würde es trotzdem, und `readPvProfileDraft` fände dort nie wieder eine Lücke.
     *
     * ⚠ DIE HERKUNFT IST DAS FÜNFTE FELD, seit es neben der hochgeladenen auch eine GESCHÄTZTE
     * Reihe gibt. Sie wird ausdrücklich mitgeschrieben statt aus der Dokument-Kennung erschlossen:
     * die Kennung kann legitim fehlen (`on delete set null`), und ohne eigenes Feld hiesse ein
     * solcher Entwurf still „geschätzt" — die teuerste Verwechslung dieses Bereichs, weil eine
     * gemessene Reihe damit den Vorbehalt einer Schätzung trüge oder umgekehrt.
     */
    expect(pvProfileDraftValues(SCAN, DOCUMENT_ID).map((entry) => entry.field)).toEqual([
      PV_INTERVAL_MINUTES_KEY,
      PV_COVERED_FROM_KEY,
      PV_COVERED_TO_KEY,
      PV_SOURCE_DOCUMENT_ID_KEY,
      PV_PROFILE_SOURCE_KEY,
    ])
    expect(
      pvProfileDraftValues(SCAN, DOCUMENT_ID).some(
        (entry) => entry.field === PV_PROFILE_GAPS_KEY,
      ),
    ).toBe(false)
  })

  it('reicht ein 60-min-Intervall unverändert durch, statt auf 15 zu normieren', () => {
    const values = pvProfileDraftValues({ ...SCAN, intervalMinutes: 60 }, DOCUMENT_ID)
    const interval = values.find((entry) => entry.field === PV_INTERVAL_MINUTES_KEY)
    expect(interval?.value).toBe(60)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('withPvProfileGaps — der Seiteneintrag', () => {
  it('⚠ RUNDWEG: geschrieben und wieder gelesen steht derselbe Inhalt da', () => {
    const draft = withPvProfileGaps({}, GAPS)
    expect(readPvProfileDraft(draft).gaps).toEqual(GAPS)

    // Und er übersteht den Weg durch `jsonb` — die Spalte speichert JSON, nichts anderes.
    const roundTripped = JSON.parse(JSON.stringify(draft)) as Record<string, unknown>
    expect(readPvProfileDraft(roundTripped).gaps).toEqual(GAPS)
  })

  it('lässt den übrigen Entwurf unangetastet und verändert die Eingabe nicht', () => {
    /*
     * Der Wrapper `update_metering_point_draft` ERSETZT den Entwurf. Verschluckte diese Funktion
     * einen bestehenden Schlüssel, nähme der nächste Schreibvorgang die Angabe einer anderen
     * Station mit — still, weil dort nichts fehlschlägt.
     */
    const before = { energyPriceCtPerKwh: 24.5, _provenance: { energyPriceCtPerKwh: {} } }
    const after = withPvProfileGaps(before, GAPS)

    expect(after.energyPriceCtPerKwh).toBe(24.5)
    expect(after._provenance).toBe(before._provenance)
    // Rein: die Eingabe hat den Seiteneintrag NICHT bekommen.
    expect(before).not.toHaveProperty(PV_PROFILE_GAPS_KEY)
  })

  it('eine leere Liste ist eine ANGABE, kein fehlender Schlüssel', () => {
    // „Keine Lücke über der Schwelle" ist das Ergebnis einer sauberen Datei — und muss sich von
    // „hier wurde nie etwas eingelesen" unterscheiden lassen.
    const draft = withPvProfileGaps({}, [])
    expect(draft).toHaveProperty(PV_PROFILE_GAPS_KEY)
    expect(readPvProfileDraft(draft).gaps).toEqual([])
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('readPvProfileDraft — defensiv wie jeder jsonb-Leser', () => {
  it('ein leerer Entwurf ergibt lauter `null` und eine leere Lückenliste', () => {
    expect(readPvProfileDraft({})).toEqual({
      intervalMinutes: null,
      coveredFrom: null,
      coveredTo: null,
      // `null` heisst hier „es gibt keine Reihe" — nicht „hochgeladen" und nicht „geschätzt".
      source: null,
      sourceDocumentId: null,
      estimate: null,
      gaps: [],
    })
  })

  it('liest einen vollständig befüllten Entwurf Feld für Feld zurück', () => {
    expect(readPvProfileDraft(filledDraft())).toEqual({
      intervalMinutes: 15,
      coveredFrom: '2024-12-31T23:00:00.000Z',
      coveredTo: '2025-12-31T23:00:00.000Z',
      source: 'upload',
      sourceDocumentId: DOCUMENT_ID,
      // ⚠ Bei einer HOCHGELADENEN Reihe sind die PVGIS-Kennzahlen `null` — und zwar auch dann,
      // wenn im Entwurf welche stünden. Eine gemessene Reihe hat keine geschätzte Streuung.
      estimate: null,
      gaps: GAPS,
    })
  })

  it('⚠ ein Intervall, das keine endliche Zahl ist, gilt als KEINE Angabe', () => {
    /*
     * `jsonb` nimmt alles an, was einmal jemand hineingeschrieben hat — der Typ ist eine
     * Behauptung, keine Zusage. Eine Zeichenkette „15" durchzulassen wäre der gefährlichere Fall:
     * sie sähe in der Anzeige richtig aus und ergäbe in jeder Rechnung darüber `NaN`.
     */
    for (const broken of ['15', null, undefined, {}, [], true, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(readPvProfileDraft({ [PV_INTERVAL_MINUTES_KEY]: broken }).intervalMinutes).toBe(null)
    }
    // Gegenprobe: die echte Zahl kommt durch.
    expect(readPvProfileDraft({ [PV_INTERVAL_MINUTES_KEY]: 60 }).intervalMinutes).toBe(60)
  })

  it('ein leerer oder nur aus Leerzeichen bestehender Zeitpunkt gilt als KEINE Angabe', () => {
    for (const broken of ['', '   ', 42, null, {}]) {
      expect(readPvProfileDraft({ [PV_COVERED_FROM_KEY]: broken }).coveredFrom).toBe(null)
    }
  })

  it('⚠ ein halber Lücken-Eintrag wird ÜBERSPRUNGEN, nicht mit einem Platzhalter gefüllt', () => {
    /*
     * Eine Lücke „von — bis —" sähe aus wie eine gemessene und wäre keine. Übersprungen fehlt sie
     * ehrlich; der Zeitraum daneben sagt weiterhin die Wahrheit.
     */
    const draft = {
      [PV_PROFILE_GAPS_KEY]: [
        GAPS[0],
        { from: '2025-01-01T00:00:00.000Z' }, // `to` fehlt
        { to: '2025-01-02T00:00:00.000Z' }, // `from` fehlt
        { from: 1, to: 2 }, // keine Zeichenketten
        null,
        'keine Lücke',
        ['from', 'to'], // ein Array ist kein Eintrag, auch wenn `typeof` es „object" nennt
        GAPS[1],
      ],
    }
    expect(readPvProfileDraft(draft).gaps).toEqual(GAPS)
  })

  it('ein Seiteneintrag, der gar keine Liste ist, ergibt eine leere Lückenliste', () => {
    for (const broken of [{ from: 'a', to: 'b' }, 'nichts', 7, null, true]) {
      expect(readPvProfileDraft({ [PV_PROFILE_GAPS_KEY]: broken }).gaps).toEqual([])
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('hasPvProfile — woran „es liegt eine Reihe vor" gemessen wird', () => {
  const full = () => readPvProfileDraft(filledDraft())

  it('true, sobald alle DREI Zeitraum-Angaben stehen', () => {
    expect(hasPvProfile(full())).toBe(true)
  })

  it('⚠ NICHT an der Dokument-Kennung gemessen — sie kann legitim fehlen', () => {
    /*
     * Sie ist der Bezug zur Datei und kann durch ein späteres Löschen des Dokuments verschwinden.
     * Wäre sie das Kriterium, stellte die Station ihre Frage danach erneut — und der Admin läse
     * „noch nichts eingelesen" über einem gespeicherten Zeitraum.
     */
    expect(hasPvProfile({ ...full(), sourceDocumentId: null })).toBe(true)
  })

  it('⚠ NICHT an den Lücken gemessen — eine leere Liste ist der Normalfall', () => {
    expect(hasPvProfile({ ...full(), gaps: [] })).toBe(true)
  })

  it('false, sobald EINE der drei Zeitraum-Angaben fehlt', () => {
    /*
     * Einzeln geprüft und nicht als Gruppe: eine Bedingung, die nur eines der drei Felder liest,
     * bliebe bei einem Gruppen-Test grün — und die Station zeigte einen halben Zeitraum an.
     */
    expect(hasPvProfile({ ...full(), intervalMinutes: null })).toBe(false)
    expect(hasPvProfile({ ...full(), coveredFrom: null })).toBe(false)
    expect(hasPvProfile({ ...full(), coveredTo: null })).toBe(false)
  })

  it('false für einen leeren Entwurf', () => {
    expect(hasPvProfile(readPvProfileDraft({}))).toBe(false)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('kein Schlüssel verdeckt ein Contract-Feld', () => {
  it('keiner der Schlüssel steht in `tariffParamsSchema`', () => {
    expect(pvProfileKeysCollideWithContract()).toEqual([])
  })

  it('⚠ POSITIV-KONTROLLE: die Prüfung läuft gegen ein nicht-leeres Schema', () => {
    /*
     * Ohne diese Zeile wäre der Test darüber auch dann grün, wenn `tariffParamsSchema.shape` leer
     * wäre oder die Funktion gegen das falsche Objekt prüfte — „keine Kollision" ist über einer
     * leeren Menge trivial wahr.
     */
    const contractKeys = Object.keys(tariffParamsSchema.shape)
    expect(contractKeys.length).toBeGreaterThan(5)
    expect(contractKeys).toContain('energyPriceCtPerKwh')
  })
})
