/**
 * Der Portal-Leser (B16-4b, erweitert in B18-3).
 *
 * Der Wrapper gibt `jsonb` zurück; der TypeScript-Typ ist eine Behauptung, kein Beweis. Geprüft wird
 * hier die eine Unterscheidung, die es an keiner anderen Leser-Stelle gibt und die real Schaden
 * anrichten kann, wenn sie fehlt: „es gibt keinen Partnerzugang" gegen „wir konnten nicht
 * nachsehen". Fällt sie zusammen, schickt ein Datenbankausfall einen echten Fachbetrieb auf das
 * Bewerbungsformular.
 *
 * Seit B18-3 kommt die zweite Unterscheidung dazu, die genauso still schiefgehen kann: „keine
 * Ansprechperson hinterlegt" (`null`) gegen „das Feld kam gar nicht mit" (`undefined`) gegen „heisst
 * zufällig nichts" (Leerstring) — und die Zusicherung, dass die drei neuen Felder das Portal NICHT
 * sperren können, wenn sie fehlen.
 */
import fs from 'node:fs'
import path from 'node:path'
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

/* ─── B18-3: Ansprechperson und Beitrittsdatum ───────────────────────────────────────────────── */

describe('readMyPartner — die drei mit B18-3 ergänzten Felder', () => {
  const ok = (extra: Record<string, unknown>) =>
    readMyPartner({ status: 'ok', slug: 'raymann', display_name: 'Raymann GmbH', ...extra })

  it('liest Ansprechperson und Beitrittsdatum und trimmt die Namen', () => {
    expect(
      ok({
        contact_first_name: ' Anna ',
        contact_last_name: ' Gruber ',
        created_at: '2026-07-26T09:00:00+00:00',
      }),
    ).toEqual({
      state: 'partner',
      partner: {
        slug: 'raymann',
        displayName: 'Raymann GmbH',
        contactFirstName: 'Anna',
        contactLastName: 'Gruber',
        partnerSince: '2026-07-26T09:00:00+00:00',
      },
    })
  })

  it('⚠ NULL bleibt NULL — und wird NICHT zu einem leeren String', () => {
    /*
     * `platform.partners.contact_first_name`/`_last_name` sind nullable, und ein von Hand
     * aufgenommener Betrieb ohne Ansprechperson ist der reale Normalfall. Als `''` durchgereicht
     * sähe „nicht hinterlegt" in jeder Oberfläche wie ein hinterlegter, aber unsichtbarer Name aus.
     */
    const state = ok({ contact_first_name: null, contact_last_name: null })
    expect(state).toMatchObject({ state: 'partner' })
    if (state.state !== 'partner') throw new Error('unreachable')
    expect(state.partner.contactFirstName).toBeNull()
    expect(state.partner.contactLastName).toBeNull()
  })

  it('ein Leerstring und reine Leerzeichen zählen als „nicht hinterlegt"', () => {
    const state = ok({ contact_first_name: '', contact_last_name: '   ' })
    if (state.state !== 'partner') throw new Error('unreachable')
    expect(state.partner.contactFirstName).toBeNull()
    expect(state.partner.contactLastName).toBeNull()
  })

  it('nur EINE Hälfte des Namens ist ein zulässiger Zustand', () => {
    const state = ok({ contact_first_name: 'Anna', contact_last_name: null })
    if (state.state !== 'partner') throw new Error('unreachable')
    expect(state.partner.contactFirstName).toBe('Anna')
    expect(state.partner.contactLastName).toBeNull()
  })

  it('⚠ fehlende oder unbrauchbare neue Felder sperren das Portal NICHT', () => {
    /*
     * Der eigentliche Zweck dieser Datei ist der Empfehlungslink, und der hängt an Slug und
     * Anzeigename. Eine Antwort ohne die B18-3-Felder — etwa aus einer Datenbank, auf der die
     * Migration noch nicht liegt — muss weiterhin ein Portal ergeben; sie als `error` zu werten
     * hiesse, einen funktionierenden Zugang wegen einer Nebenangabe zu schliessen.
     */
    for (const extra of [
      {},
      { contact_first_name: 42, contact_last_name: [], created_at: 1750000000 },
      { created_at: null },
    ]) {
      const state = ok(extra)
      expect(state, JSON.stringify(extra)).toMatchObject({
        state: 'partner',
        partner: { slug: 'raymann', displayName: 'Raymann GmbH' },
      })
      if (state.state !== 'partner') throw new Error('unreachable')
      // Nicht mitgeliefert heisst `undefined` — ausdrücklich nicht `null` („nichts hinterlegt").
      expect(state.partner.partnerSince).toBeUndefined()
    }
  })

  it('das Beitrittsdatum wird durchgereicht, nicht umformatiert', () => {
    // Formatiert wird in der Oberfläche (Locale, Zeitzone). Ein hier erzeugtes zweites Format wäre
    // ein zweiter Fundort für dieselbe Angabe.
    const state = ok({ created_at: '2026-07-26T09:00:00+00:00' })
    if (state.state !== 'partner') throw new Error('unreachable')
    expect(state.partner.partnerSince).toBe('2026-07-26T09:00:00+00:00')
  })
})

/**
 * ⚠ DIE MARKETING-SEITE DARF DIE NEUEN FELDER NICHT MITFÜHREN (B18-3, Punkt 4).
 *
 * `partner-portal-page.tsx` ist eine Server-Komponente. Was sie liest, kann im ausgelieferten HTML
 * bzw. im Flight-Payload landen, sobald es durch eine Komponentengrenze wandert — auch dann, wenn
 * niemand es rendert. Die drei Felder sind für die kommende „Allgemein"-Seite gedacht, nicht für
 * diese; sie hier beiläufig mitzunehmen wäre genau die Art Ausweitung, die niemandem auffällt, weil
 * die Seite danach unverändert aussieht.
 *
 * Ein Laufzeittest kann das nicht sehen: Die Seite rendert die Felder ja gerade NICHT, ihre Ausgabe
 * ist mit und ohne Zugriff identisch. Deshalb am Quelltext festgehalten — dieselbe Haltung wie in
 * `lib/admin/guard.test.ts` und `lib/portal-host.test.ts`.
 */
describe('die bestehende Portal-Seite liest die B18-3-Felder nicht', () => {
  /** Kommentare weg, sonst wertete der Wächter das ERKLÄREN der Regel als Verstoss (B11-Falle). */
  const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  const read = (...segments: string[]): string =>
    stripComments(
      fs.readFileSync(path.resolve(import.meta.dirname, '..', '..', ...segments), 'utf8'),
    )

  it('weder die Seite noch die Route nennen eines der drei Felder', () => {
    for (const file of [
      'components/partner-portal/partner-portal-page.tsx',
      'components/partner-portal/partner-portal-route.tsx',
      'app/(site)/[locale]/partner-portal/page.tsx',
    ]) {
      const source = read(file)
      for (const field of [
        'contactFirstName',
        'contactLastName',
        'partnerSince',
        'contact_first_name',
        'contact_last_name',
        'created_at',
      ]) {
        expect(source, `${file} nennt ${field}`).not.toContain(field)
      }
    }
  })

  it('die Seite reicht unverändert nur `state` und `referralUrl` durch', () => {
    const route = read('components/partner-portal/partner-portal-route.tsx')
    expect(route).toMatch(/<PartnerPortalPage state=\{state\} referralUrl=\{referralUrl\} \/>/)
  })
})
