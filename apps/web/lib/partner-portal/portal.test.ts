/**
 * Der Portal-Leser (B16-4b).
 *
 * Der Wrapper gibt `jsonb` zurück; der TypeScript-Typ ist eine Behauptung, kein Beweis. Geprüft wird
 * hier die eine Unterscheidung, die es an keiner anderen Leser-Stelle gibt und die real Schaden
 * anrichten kann, wenn sie fehlt: „es gibt keinen Partnerzugang" gegen „wir konnten nicht
 * nachsehen". Fällt sie zusammen, schickt ein Datenbankausfall einen echten Fachbetrieb auf das
 * Bewerbungsformular.
 */
import { describe, expect, it } from 'vitest'
import { readMyPartner } from './portal'

describe('readMyPartner', () => {
  it('liest den Gutfall und trimmt', () => {
    expect(
      readMyPartner({ status: 'ok', slug: ' raymann ', display_name: ' Raymann GmbH ' }),
    ).toEqual({
      state: 'partner',
      partner: { slug: 'raymann', displayName: 'Raymann GmbH' },
    })
  })

  it('`none` ist ein ZUSTAND, kein Fehler — der Normalfall jedes Kundenkontos', () => {
    expect(readMyPartner({ status: 'none' })).toEqual({ state: 'none' })
  })

  it('⚠ ein Lesefehler ist NICHT „kein Partnerzugang"', () => {
    // Sonst legte ein Datenbankausfall einem echten Fachbetrieb nahe, sich ein zweites Mal zu
    // bewerben — und die Bewerbungstabelle füllte sich mit Zeilen, die keinen Antrag darstellen.
    expect(readMyPartner(null, new Error('weg'))).toEqual({ state: 'error' })
    expect(readMyPartner({ status: 'none' }, new Error('weg'))).toEqual({ state: 'error' })
  })

  it('unerwartete Antworten sind `error`, nie `partner` und nie `none`', () => {
    for (const data of [null, undefined, 'ok', 42, [], { status: 'was-anderes' }]) {
      expect(readMyPartner(data)).toEqual({ state: 'error' })
    }
  })

  it('⚠ ein `ok` ohne Slug oder Anzeigenamen ergibt KEIN Portal', () => {
    /*
     * Ein Portal mit leerem Empfehlungslink wäre schlimmer als eines, das sagt, dass es gerade
     * nicht geht: Der leere Link ginge an Bestandskunden und liesse sich nicht zurückholen.
     */
    expect(readMyPartner({ status: 'ok', display_name: 'Raymann GmbH' })).toEqual({ state: 'error' })
    expect(readMyPartner({ status: 'ok', slug: 'raymann' })).toEqual({ state: 'error' })
    expect(readMyPartner({ status: 'ok', slug: '   ', display_name: 'Raymann GmbH' })).toEqual({
      state: 'error',
    })
  })
})
