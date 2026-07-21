import { describe, expect, it } from 'vitest'

import {
  NETZBETREIBER_IDS,
  NETZEBENEN,
  TARIFF_SETS,
  buildTariffSourceRef,
  deriveTariffOverrides,
  lookupTariffProfile,
  pendingAcrossAllBetreiber,
  tariffDefaultsFromProfile,
  tariffProfileKey,
  tariffSelectionFrom,
  validateTariffSets,
  type TariffSet,
} from './tariff-catalog'

/**
 * B11 — Prüfung der Tarifsatz-Datenschicht.
 *
 * Der wichtigste Test dieser Datei ist nicht der über die Nachschlagefunktion, sondern der über die
 * DATEI SELBST (`validateTariffSets`): er ist der Schutz beim Nachtragen der Verordnungssätze im
 * November unter Zeitdruck. Deshalb wird hier nicht nur geprüft, dass der heutige Bestand sauber
 * ist, sondern auch, dass die Prüfung bei absichtlich kaputten Sätzen tatsächlich anschlägt — eine
 * Prüfung, deren Fehlschlag nie beobachtet wurde, ist keine.
 */

const STICHTAG = '2026-07-21'

describe('Nachschlagen (TEIL 7 (1))', () => {
  it('liefert zum Stichtag das richtige Profil samt Sätzen', () => {
    const result = lookupTariffProfile({
      netzbetreiber: 'wiener_netze',
      netzebene: 3,
      on: STICHTAG,
    })

    expect(result.status).toBe('available')
    if (result.status !== 'available') return
    expect(result.set.id).toBe('at-2026')
    expect(result.set.validFrom).toBe('2026-01-01')
    expect(result.profile.leistungspreisEurPerKwYear).toBe(38.52)
    expect(result.profile.minBillableKw).toBe(0)
    expect(result.profile.billingModel).toBe('monthly_max_average')
  })

  it('liefert für Netzebene 7 ein ausstehendes Profil — bei JEDEM Netzbetreiber', () => {
    for (const netzbetreiber of NETZBETREIBER_IDS) {
      const result = lookupTariffProfile({ netzbetreiber, netzebene: 7, on: STICHTAG })
      expect(result.status).toBe('pending_regulation')
      if (result.status !== 'pending_regulation') continue
      expect(result.profile.reason).toBe('awaiting_tariff_regulation')
      // Der eigentliche Punkt: KEIN Preis. Eine Null hier rechnete still eine Ersparnis von null.
      expect(result.profile.leistungspreisEurPerKwYear).toBeUndefined()
      expect(result.profile.minBillableKw).toBeUndefined()
      expect(result.profile.billingModel).toBeUndefined()
    }
  })

  it('unterscheidet „gibt es noch nicht" von „haben wir noch nicht hinterlegt"', () => {
    const ne7 = lookupTariffProfile({ netzbetreiber: 'wiener_netze', netzebene: 7, on: STICHTAG })
    const ne5 = lookupTariffProfile({ netzbetreiber: 'netz_noe', netzebene: 5, on: STICHTAG })

    expect(ne7.status === 'pending_regulation' && ne7.profile.reason).toBe(
      'awaiting_tariff_regulation',
    )
    expect(ne5.status === 'pending_regulation' && ne5.profile.reason).toBe('not_yet_recorded')
  })

  it('liefert für einen Stichtag VOR der Gültigkeit ein eindeutiges „nicht verfügbar" — keine Näherung', () => {
    const result = lookupTariffProfile({
      netzbetreiber: 'wiener_netze',
      netzebene: 3,
      on: '2025-12-31',
    })
    expect(result).toEqual({ status: 'not_available' })
  })

  it('fällt für eine unbekannte Kombination NICHT auf ein benachbartes Profil zurück', () => {
    // NE 2 ist nicht geführt. Ein hilfsbereiter Rückfall auf NE 3 wäre eine Zahl ohne Deckung.
    const result = lookupTariffProfile({
      netzbetreiber: 'wiener_netze',
      // Absichtlich ausserhalb der geführten Ebenen — der Aufrufer kommt aus einem Formular.
      netzebene: 2 as unknown as (typeof NETZEBENEN)[number],
      on: STICHTAG,
    })
    expect(result).toEqual({ status: 'not_available' })
  })

  it('pendingAcrossAllBetreiber: NE 7 steht überall aus, NE 3 nicht', () => {
    expect(pendingAcrossAllBetreiber(7, STICHTAG)).toBe('awaiting_tariff_regulation')
    // Wiener Netze NE 3 hat einen Satz -> keine gemeinsame Aussage möglich.
    expect(pendingAcrossAllBetreiber(3, STICHTAG)).toBeNull()
  })
})

describe('Typseitige Absicherung (TEIL 7 (2))', () => {
  /*
   * DIE TYPSEITIGE PRÜFUNG STEHT NICHT HIER, SONDERN IM MODUL — und das ist wichtig zu wissen:
   * `packages/shared/tsconfig.json` schliesst `src/**\/*.test.ts` vom Typecheck aus, und vitest
   * transpiliert ohne Typprüfung. Ein `@ts-expect-error` an dieser Stelle wäre von NIEMANDEM
   * geprüft worden und hätte eine Sicherheit nur vorgetäuscht (nachgemessen: der Typecheck blieb
   * grün, auch nachdem die Sperre aus `PendingTariffProfile` entfernt war).
   *
   * Der echte Wächter ist deshalb `PendingProfileHasNoPriceFields` in `tariff-catalog.ts`. Er
   * bricht `pnpm typecheck`, sobald ein Preisfeld aus dem ausstehenden Profil verschwindet ODER
   * einen echten Typ bekommt — beide Richtungen wurden beobachtet, nicht angenommen.
   *
   * Hier bleibt die LAUFZEIT-Hälfte desselben Falls: Daten, die von aussen kommen (ein Import aus
   * einem Preisblatt), tragen den Typ nur als Behauptung.
   */
  it('ein ausstehendes Profil mit Preisfeldern wird auch zur Laufzeit beanstandet', () => {
    const broken: TariffSet = {
      id: 'kaputt',
      label: 'Ausstehend mit Preis',
      validFrom: '2026-01-01',
      sourceNote: 'Testfall',
      profiles: [
        {
          netzbetreiber: 'netz_noe',
          netzebene: 6,
          availability: 'pending_regulation',
          reason: 'not_yet_recorded',
          note: 'Testfall',
          leistungspreisEurPerKwYear: 42,
        } as unknown as TariffSet['profiles'][number],
      ],
    }

    expect(validateTariffSets([broken]).join(' ')).toContain('trägt Preisfelder')
  })
})

describe('Prüfung der Datei selbst (TEIL 7 (3))', () => {
  it('der ausgelieferte Bestand ist beanstandungsfrei', () => {
    expect(validateTariffSets(TARIFF_SETS)).toEqual([])
  })

  it('jede Kombination aus Netzbetreiber und Netzebene ist genau einmal geführt', () => {
    const keys = TARIFF_SETS.flatMap((s) =>
      s.profiles.map((p) => tariffProfileKey(p.netzbetreiber, p.netzebene)),
    )
    expect(keys).toHaveLength(NETZBETREIBER_IDS.length * NETZEBENEN.length)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('schlägt bei doppelter Kennung an', () => {
    const one: TariffSet = {
      id: 'doppelt',
      label: 'A',
      validFrom: '2026-01-01',
      validUntil: '2026-06-30',
      sourceNote: 'Testfall',
      profiles: [],
    }
    const two: TariffSet = { ...one, label: 'B', validFrom: '2026-07-01', validUntil: undefined }
    expect(validateTariffSets([one, two]).join(' ')).toContain('Doppelte Tarifsatz-Kennung')
  })

  it('schlägt bei überschneidenden Gültigkeitszeiträumen derselben Kombination an', () => {
    const alt: TariffSet = {
      id: 'at-2026',
      label: 'Stand 2026',
      validFrom: '2026-01-01',
      sourceNote: 'Testfall',
      profiles: [
        {
          netzbetreiber: 'wiener_netze',
          netzebene: 3,
          availability: 'available',
          billingModel: 'annual_max',
          leistungspreisEurPerKwYear: 38.52,
          minBillableKw: 0,
        },
      ],
    }
    // Kein `validUntil` am alten Stand -> beide gelten ab 2027 gleichzeitig für dieselbe Kombination.
    const neu: TariffSet = { ...alt, id: 'at-2027', label: 'Stand 2027', validFrom: '2027-01-01' }

    const problems = validateTariffSets([alt, neu]).join(' ')
    expect(problems).toContain('Überschneidende Gültigkeit')
    expect(problems).toContain('wiener_netze:NE3')
  })

  it('lässt einen sauber abgegrenzten Nachfolge-Stand durch (der Regelfall im November)', () => {
    const alt: TariffSet = {
      id: 'at-2026',
      label: 'Stand 2026',
      validFrom: '2026-01-01',
      validUntil: '2026-12-31',
      sourceNote: 'Testfall',
      profiles: [
        {
          netzbetreiber: 'wiener_netze',
          netzebene: 3,
          availability: 'available',
          billingModel: 'monthly_max_average',
          leistungspreisEurPerKwYear: 38.52,
          minBillableKw: 0,
        },
      ],
    }
    const neu: TariffSet = { ...alt, id: 'at-2027', validFrom: '2027-01-01', validUntil: undefined }
    expect(validateTariffSets([alt, neu])).toEqual([])
  })

  it('schlägt bei einem unvollständigen „available"-Profil an', () => {
    const broken: TariffSet = {
      id: 'unvollstaendig',
      label: 'Ohne Preis',
      validFrom: '2026-01-01',
      sourceNote: 'Testfall',
      profiles: [
        {
          netzbetreiber: 'salzburg_netz',
          netzebene: 4,
          availability: 'available',
          billingModel: 'annual_max',
          // Der Fall, den ein hastiges Kopieren erzeugt: das Feld bleibt leer.
          leistungspreisEurPerKwYear: undefined as unknown as number,
          minBillableKw: 0,
        },
      ],
    }
    expect(validateTariffSets([broken]).join(' ')).toContain(
      'leistungspreisEurPerKwYear fehlt oder ist keine Zahl',
    )
  })

  it('schlägt bei einem ausstehenden Profil ohne Vermerk an', () => {
    const broken: TariffSet = {
      id: 'ohne-vermerk',
      label: 'Stumm',
      validFrom: '2026-01-01',
      sourceNote: 'Testfall',
      profiles: [
        {
          netzbetreiber: 'netz_noe',
          netzebene: 3,
          availability: 'pending_regulation',
          reason: 'not_yet_recorded',
          note: '   ',
        },
      ],
    }
    expect(validateTariffSets([broken]).join(' ')).toContain('ohne Vermerk')
  })

  it('schlägt bei fehlender Fundstelle an', () => {
    const broken: TariffSet = {
      id: 'ohne-quelle',
      label: 'Woher?',
      validFrom: '2026-01-01',
      sourceNote: '',
      profiles: [],
    }
    expect(validateTariffSets([broken]).join(' ')).toContain('ohne Fundstelle')
  })
})

describe('Vorgabewerte und Überschreibungen', () => {
  const profile = (() => {
    const r = lookupTariffProfile({ netzbetreiber: 'wiener_netze', netzebene: 3, on: STICHTAG })
    if (r.status !== 'available') throw new Error('Fixture erwartet ein verfügbares Profil')
    return r
  })()

  it('meldet keine Überschreibung, wenn der Vorgabewert unangetastet bleibt', () => {
    const defaults = tariffDefaultsFromProfile(profile.profile)
    expect(deriveTariffOverrides(defaults, defaults)).toEqual([])
  })

  it('benennt genau die geänderten Felder', () => {
    const defaults = tariffDefaultsFromProfile(profile.profile)
    const changed = deriveTariffOverrides(
      { ...defaults, leistungspreisEurPerKwYear: 91, billingModel: 'annual_max' },
      defaults,
    )
    expect(changed).toEqual(['leistungspreisEurPerKwYear', 'billingModel'])
    expect(changed).not.toContain('minBillableKw')
  })

  it('baut die Herkunftsangabe mit stabilem Schlüssel und den Überschreibungen', () => {
    const selection = tariffSelectionFrom(profile.set, profile.profile)
    const ref = buildTariffSourceRef(selection, {
      ...tariffDefaultsFromProfile(profile.profile),
      minBillableKw: 15,
    })

    expect(ref).toEqual({
      tariffSetId: 'at-2026',
      tariffSetLabel: 'Netznutzung Österreich, Stand 2026',
      tariffSetValidFrom: '2026-01-01',
      tariffProfileKey: 'wiener_netze:NE3',
      netzbetreiber: 'wiener_netze',
      netzebene: 3,
      overriddenFields: ['minBillableKw'],
    })
  })
})
