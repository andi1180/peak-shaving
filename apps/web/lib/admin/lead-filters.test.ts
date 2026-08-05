/**
 * Tests für das Filter-Vokabular der Lead-Sicht (`lib/admin/lead-filters.ts`, B2-1/B18-5 und die
 * Spaltenfilter).
 *
 * ── WARUM DAS MODUL EINEN TEST BRAUCHT, OBWOHL ES NUR ZEICHENKETTEN SCHIEBT ──────────────────────
 * Es ist die einzige Stelle, an der die Filternamen stehen — genau damit ein Filter nicht an einer
 * von sechs Stellen wegfällt (Seitenwechsel, Export-Link, RPC-Argumente …). Fällt er weg, ist das
 * Ergebnis nicht falsch, sondern GRÖSSER als angefordert, und niemand sieht es: die Liste zeigt
 * plausible Zeilen, und die ausgeführte Datei enthält mehr Menschen, als der Admin ausgewählt hat.
 * Ein Test, der über FILTER_PARAMS iteriert, statt einzelne Namen abzufragen, ist deshalb der
 * eigentliche Zweck dieser Datei: er wird rot, sobald jemand einen Filter hinzufügt und eine der
 * Stellen vergisst.
 */
import { describe, expect, it } from 'vitest'

import {
  EMPTY_FILTERS,
  FILTER_PARAMS,
  filterRpcArgs,
  filterSearchParams,
  hasAnyFilter,
  PARTNER_ASSIGNMENTS,
  PARTNER_ASSIGNMENT_LABELS,
  readFilters,
  withFilters,
  type FilterParam,
} from './lead-filters'
import { LEAD_SOURCE_CATEGORIES } from './lead-source-categories'

/**
 * Ein gültiger Beispielwert je Filter. Der Typ ist `Record<FilterParam, string>` — ein NEUER
 * Filter bricht damit beim Typecheck, statt still ungetestet zu bleiben.
 */
const SAMPLE: Record<FilterParam, string> = {
  status: 'customer',
  quelle: 'warteliste',
  zweck: 'partner_lead_disclosure',
  einwilligung: 'confirmed',
  suche: 'Kühlhaus Nord',
  faellig: '1',
  branche: 'kuehlhaus',
  messart: 'netzebene_7',
  plz: '11',
  'verbrauch-ab': '100000',
  'verbrauch-bis': '300000',
  'vertragsende-ab': '2027-01-01',
  'vertragsende-bis': '2027-12-31',
  partner: 'assigned',
  firma: 'Bäckerei',
  vorname: 'Anna',
  nachname: 'von der Gruber',
  mail: '@coolin.at',
  telefon: '+43',
  zuordnung: 'Raymann',
  herkunft: 'partner',
  thema: 'peakShaving',
  'thema-leer': '1',
  von: '2026-08-01',
  bis: '2026-08-05',
}

describe('das Vokabular ist vollständig — jeder Filter überlebt den Rundlauf', () => {
  it('jeder einzelne Filter aus FILTER_PARAMS kommt gelesen und wieder ausgegeben zurück', () => {
    /*
     * DER KERNTEST. Er prüft je Filter EINZELN (nicht alle zusammen), damit die Fehlermeldung den
     * verlorenen Namen nennt: `readFilters` muss ihn lesen UND `filterSearchParams` muss ihn wieder
     * ausgeben. Fehlt eine der beiden Hälften, verschwindet der Filter beim Seitenwechsel bzw. im
     * Export-Link — beides still.
     */
    for (const param of FILTER_PARAMS) {
      const filters = readFilters({ [param]: SAMPLE[param] })
      const out = filterSearchParams(filters)
      expect(out.get(param), `„${param}" überlebt readFilters → filterSearchParams`).toBe(
        SAMPLE[param],
      )
      expect([...out.keys()], `„${param}" setzt keinen fremden Parameter`).toEqual([param])
    }
  })

  it('alle Filter gemeinsam gesetzt ergeben genau FILTER_PARAMS — keiner fehlt, keiner zu viel', () => {
    const out = filterSearchParams(readFilters({ ...SAMPLE }))
    expect([...new Set(out.keys())].sort()).toEqual([...FILTER_PARAMS].sort())
  })

  it('EMPTY_FILTERS erzeugt keinen einzigen Parameter — „kein Filter" ist kein Filter', () => {
    expect(filterSearchParams(EMPTY_FILTERS).toString()).toBe('')
    expect(hasAnyFilter(EMPTY_FILTERS)).toBe(false)
  })

  it('readFilters ohne Anfrage liefert exakt EMPTY_FILTERS', () => {
    expect(readFilters({})).toEqual(EMPTY_FILTERS)
  })
})

describe('die Mehrfachauswahl-Filter', () => {
  it('mehrere Werte überleben als mehrere Parameter derselben Adresse', () => {
    const filters = readFilters({
      herkunft: ['partner', 'admin'],
      thema: ['peakShaving', 'esg'],
      einwilligung: ['confirmed', 'none'],
    })
    expect(filters.sourceCategories).toEqual(['partner', 'admin'])
    expect(filters.themaKeys).toEqual(['peakShaving', 'esg'])
    expect(filters.consentStates).toEqual(['confirmed', 'none'])

    const out = filterSearchParams(filters)
    expect(out.getAll('herkunft')).toEqual(['partner', 'admin'])
    expect(out.getAll('thema')).toEqual(['peakShaving', 'esg'])
    expect(out.getAll('einwilligung')).toEqual(['confirmed', 'none'])
  })

  it('Dubletten und leere Einträge fallen weg', () => {
    /*
     * Eine Ankreuzliste kann denselben Wert nicht zweimal meinen. Zweimal derselbe Wert käme
     * zusätzlich im Ausfuhrprotokoll an (`platform.lead_filter_summary` schreibt die Menge
     * wörtlich) und sähe dort aus wie ein Fehler.
     */
    const filters = readFilters({ thema: ['esg', 'esg', '  ', 'peakShaving'] })
    expect(filters.themaKeys).toEqual(['esg', 'peakShaving'])
  })

  it('eine ALTE Adresse mit Einzelwert wird unverändert weiter verstanden', () => {
    /*
     * `?zweck=marketing_email` stammt aus der Zeit vor den Spaltenfiltern (B1-3 bot genau einen
     * Zweck an). Eine gespeicherte Adresse muss dasselbe Ergebnis zeigen wie damals — sonst wäre
     * ein Lesezeichen still zu einer anderen Auswahl geworden.
     */
    const filters = readFilters({ zweck: 'marketing_email', einwilligung: 'pending' })
    expect(filters.consentPurposes).toEqual(['marketing_email'])
    expect(filters.consentStates).toEqual(['pending'])
    expect(filterRpcArgs(filters).p_consent_purposes).toEqual(['marketing_email'])
    expect(filterRpcArgs(filters).p_consent_states).toEqual(['pending'])
  })

  it('ein unbekannter Herkunfts-KATEGORIEWERT wird verworfen — als einziger Filter', () => {
    /*
     * Die Ausnahme von der Regel „unbekannte Werte wandern zur Datenbank und werden dort
     * abgelehnt": Die drei Kategorien sind eine Erfindung DIESER Oberfläche. Die Datenbank kennt
     * sie nicht und bekommt ohnehin eine Schlüsselmenge — ein unbekannter Kategoriename hätte darin
     * gar keine Entsprechung und könnte deshalb auch nicht als `invalid_filter` zurückkommen.
     */
    expect(readFilters({ herkunft: ['partner', 'quatsch'] }).sourceCategories).toEqual(['partner'])
    expect(readFilters({ herkunft: 'quatsch' }).sourceCategories).toEqual([])
  })
})

describe('der Partner-Zuordnungsfilter (B18-5)', () => {
  it('beide Richtungen werden gelesen und unverändert weitergereicht', () => {
    for (const value of PARTNER_ASSIGNMENTS) {
      const filters = readFilters({ partner: value })
      expect(filters.partnerAssignment).toBe(value)
      expect(filterRpcArgs(filters).p_partner_assignment).toBe(value)
      expect(hasAnyFilter(filters), 'ein gesetzter Partner-Filter IST ein Filter').toBe(true)
    }
  })

  it('beide Zustände haben eine Beschriftung — die Fähigkeit der Reiter bleibt bedienbar', () => {
    /*
     * Die drei Reiter aus B18-5 sind weg, ihre FÄHIGKEIT nicht: dieselben zwei Werte stehen jetzt
     * im Popover der Zuordnungsspalte, der leere Zustand ist wie bisher die Adresse ohne Parameter.
     * Ein Wert ohne Beschriftung wäre ein Ankreuzfeld ohne Text.
     */
    for (const value of PARTNER_ASSIGNMENTS) {
      expect(PARTNER_ASSIGNMENT_LABELS[value].trim().length).toBeGreaterThan(0)
    }
    expect(Object.keys(PARTNER_ASSIGNMENT_LABELS).sort()).toEqual([...PARTNER_ASSIGNMENTS].sort())
  })

  it('ein UNBEKANNTER Wert wandert unverändert an die Datenbank — sie lehnt ihn ab', () => {
    /*
     * Die Versuchung wäre, hier gegen PARTNER_ASSIGNMENTS zu prüfen und Unbekanntes auf `undefined`
     * abzubilden. Das wäre der teuerste stille Fehler dieser Schicht: `undefined` heisst „kein
     * Filter", der Admin bekäme den VOLLEN Bestand und hielte ihn für die gefilterte Teilmenge.
     * Die Datenbank antwortet stattdessen mit {status:'invalid_filter'} und sagt welchen — dieselbe
     * Behandlung wie bei Status, Messart und PLZ-Präfix.
     */
    expect(filterRpcArgs(readFilters({ partner: 'quatsch' })).p_partner_assignment).toBe('quatsch')
    expect(filterRpcArgs(readFilters({ partner: 'true' })).p_partner_assignment).toBe('true')
  })

  it('leer, nur Leerzeichen und fehlend sind dasselbe: kein Filter', () => {
    for (const raw of ['', '   ', undefined]) {
      const filters = readFilters({ partner: raw })
      expect(filters.partnerAssignment, `„${String(raw)}"`).toBe('')
      expect(filterRpcArgs(filters).p_partner_assignment).toBeUndefined()
      expect(filterSearchParams(filters).has('partner')).toBe(false)
    }
  })

  it('ein mehrfach gesetzter EINZELWERT-Parameter wird verworfen statt geraten', () => {
    // `?partner=assigned&partner=unassigned` — welcher gälte? Keiner. Dieselbe Behandlung wie bei
    // allen übrigen Einzelwert-Filtern (`one()` nimmt nur einfache Zeichenketten).
    expect(readFilters({ partner: ['assigned', 'unassigned'] }).partnerAssignment).toBe('')
  })
})

describe('withFilters — die Grundlage jedes Popovers und jeder Filter-Marke', () => {
  it('eine Filteränderung behält ALLE übrigen Filter', () => {
    /*
     * DER KERNTEST DIESES ABSCHNITTS. Ein Popover, das die gesetzten Filter abwirft, zeigte eine
     * GRÖSSERE Menge als angefordert — und der Export-Link darunter übernähme die Verwechslung
     * wortlos. Genau dieser Fehler wäre in B18-5 beinahe entstanden (dort trug ein verstecktes Feld
     * den Reiter mit).
     */
    const filters = readFilters({ ...SAMPLE, partner: 'unassigned' })
    const out = withFilters(filters, { partnerAssignment: 'assigned' })

    expect(out.get('partner')).toBe('assigned')
    expect([...new Set(out.keys())].sort(), 'kein Filter geht verloren').toEqual(
      [...FILTER_PARAMS].sort(),
    )
    for (const param of FILTER_PARAMS) {
      if (param === 'partner') continue
      expect(out.get(param), `„${param}" bleibt unverändert`).toBe(SAMPLE[param])
    }
  })

  it('das Leeren eines Filters entfernt den Parameter, statt ihn leer zu setzen', () => {
    const out = withFilters(readFilters({ partner: 'assigned', firma: 'Bäck' }), {
      partnerAssignment: '',
    })
    expect(
      out.has('partner'),
      'ein leeres partner= wäre ein Wert, den readFilters erst wieder verwirft',
    ).toBe(false)
    expect(out.get('firma'), 'die übrigen Filter bleiben auch hier').toBe('Bäck')
  })

  it('das Entfernen EINES Wertes einer Mehrfachauswahl lässt die übrigen stehen', () => {
    const filters = readFilters({ thema: ['esg', 'peakShaving'] })
    const out = withFilters(filters, { themaKeys: ['peakShaving'] })
    expect(out.getAll('thema')).toEqual(['peakShaving'])
  })

  it('eine Filteränderung führt IMMER auf Seite 1', () => {
    /*
     * Die Änderung ändert die Treffermenge; „Seite 3" der einen ist in der anderen eine andere oder
     * gar keine. Eine mitgeschleppte Seitenzahl zeigte im besten Fall etwas Falsches und im
     * schlechteren eine leere Tabelle, die wie „keine Treffer" aussieht.
     */
    const out = withFilters(readFilters({ seite: '4', partner: 'assigned' }), {
      partnerAssignment: 'unassigned',
    })
    expect(out.has('seite')).toBe(false)
  })
})

describe('die RPC-Argumente', () => {
  it('der vierte Einwilligungszweck kommt durch (B18-6)', () => {
    expect(
      filterRpcArgs(readFilters({ zweck: 'partner_lead_disclosure' })).p_consent_purposes,
    ).toEqual(['partner_lead_disclosure'])
  })

  it('die Herkunfts-Kategorien werden zu Schlüsseln aufgelöst, nicht durchgereicht', () => {
    /*
     * Die Datenbank kennt keine Kategorien (`lead_sources` ist eine wachsende Tabelle — eine
     * Kategorienregel dort wäre eine zweite Taxonomie neben der Anzeige). Was ankommt, ist eine
     * Schlüsselmenge.
     */
    const args = filterRpcArgs(readFilters({ herkunft: 'partner' }))
    expect(args.p_source_keys).toEqual(['partner-empfehlung'])

    const admin = filterRpcArgs(readFilters({ herkunft: 'admin' }))
    expect(admin.p_source_keys).toEqual(['telefonanfrage'])
  })

  it('ALLE Kategorien angekreuzt ist kein Filter — sonst stünde „alles" im Ausfuhrprotokoll', () => {
    const args = filterRpcArgs(readFilters({ herkunft: [...LEAD_SOURCE_CATEGORIES] }))
    expect(args.p_source_keys).toBeUndefined()
  })

  it('unbrauchbare Zahlen und Daten werden verworfen statt zu 0 bzw. an Postgres gereicht', () => {
    const args = filterRpcArgs(
      readFilters({ 'verbrauch-ab': 'viel', 'vertragsende-ab': '01.01.2027', von: '5.8.2026' }),
    )
    expect(args.p_consumption_min, '„viel" wäre als 0 ein echter Filter').toBeUndefined()
    expect(
      args.p_contract_end_from,
      'ein unparsbares Datum wäre ein harter DB-Fehler',
    ).toBeUndefined()
    expect(args.p_created_from, 'dasselbe für das Anlagedatum').toBeUndefined()
  })

  it('eine erfundene Branche wird abgefangen, BEVOR sie am Postgres-Enum scheitert', () => {
    expect(filterRpcArgs(readFilters({ branche: 'raumfahrt' })).p_industry).toBeUndefined()
    expect(filterRpcArgs(readFilters({ branche: 'kuehlhaus' })).p_industry).toBe('kuehlhaus')
  })

  it('die Textfilter gehen ROH weiter — die Maskierung steht in der Datenbank', () => {
    /*
     * `platform.like_pattern` maskiert `%`, `_` und `\`, und zwar für Liste UND Ausfuhr gemeinsam.
     * Hier zusätzlich zu maskieren hiesse, dieselbe Regel ein zweites Mal auszulegen — und die
     * doppelte Maskierung fände dann genau die Zeilen nicht, die das Sonderzeichen wirklich tragen.
     */
    const args = filterRpcArgs(readFilters({ firma: '50% Rabatt_GmbH' }))
    expect(args.p_company).toBe('50% Rabatt_GmbH')
  })

  it('jeder Filter hat genau ein RPC-Argument, und keines bleibt bei „alles" gesetzt', () => {
    const allSet = filterRpcArgs(readFilters({ ...SAMPLE }))
    const none = filterRpcArgs(EMPTY_FILTERS)

    // Die zwei booleschen Filter: „aus" ist dort `false`, nicht `undefined`.
    const BOOLEANS = ['p_due_only', 'p_thema_none']
    for (const key of BOOLEANS) {
      expect(none[key as keyof typeof none], `${key} ist ohne Filter false`).toBe(false)
    }
    for (const [key, value] of Object.entries(none)) {
      if (BOOLEANS.includes(key)) continue
      expect(value, `${key} ist ohne Filter nicht gesetzt`).toBeUndefined()
    }
    for (const [key, value] of Object.entries(allSet)) {
      expect(value, `${key} ist mit Filter gesetzt`).toBeDefined()
    }
    expect(
      Object.keys(allSet).length,
      'ein RPC-Argument je Filter (die zwei booleschen zählen mit)',
    ).toBe(FILTER_PARAMS.length)
  })
})
