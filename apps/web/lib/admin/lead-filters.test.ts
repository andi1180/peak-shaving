/**
 * Tests für das Filter-Vokabular der Lead-Sicht (`lib/admin/lead-filters.ts`, B2-1/B18-5).
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
  PARTNER_TABS,
  partnerTabParams,
  readFilters,
  type FilterParam,
} from './lead-filters'

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
    expect([...out.keys()].sort()).toEqual([...FILTER_PARAMS].sort())
  })

  it('EMPTY_FILTERS erzeugt keinen einzigen Parameter — „kein Filter" ist kein Filter', () => {
    expect(filterSearchParams(EMPTY_FILTERS).toString()).toBe('')
    expect(hasAnyFilter(EMPTY_FILTERS)).toBe(false)
  })

  it('readFilters ohne Anfrage liefert exakt EMPTY_FILTERS', () => {
    expect(readFilters({})).toEqual(EMPTY_FILTERS)
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

  it('ein UNBEKANNTER Wert wandert unverändert an die Datenbank — sie lehnt ihn ab', () => {
    /*
     * Die Versuchung wäre, hier gegen PARTNER_ASSIGNMENTS zu prüfen und Unbekanntes auf `undefined`
     * abzubilden. Das wäre der teuerste stille Fehler dieser Schicht: `undefined` heisst „kein
     * Filter", der Admin bekäme den VOLLEN Bestand und hielte ihn für die gefilterte Teilmenge.
     * Die Datenbank antwortet stattdessen mit {status:'invalid_filter'} und sagt welchen — dieselbe
     * Behandlung wie bei Status, Messart und PLZ-Präfix.
     *
     * Genau deshalb ist `p_partner_assignment` in der Datenbank ein `text` mit zwei erlaubten
     * Literalen und kein dreiwertiger `boolean`: auf `boolean` gäbe es diesen Weg nicht.
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

  it('ein mehrfach gesetzter Parameter wird verworfen statt geraten', () => {
    // `?partner=assigned&partner=unassigned` — welcher gälte? Keiner. Dieselbe Behandlung wie bei
    // allen übrigen Filtern (`one()` nimmt nur einfache Zeichenketten).
    expect(readFilters({ partner: ['assigned', 'unassigned'] }).partnerAssignment).toBe('')
  })
})

describe('die Reiter über der Liste (B18-5-Oberfläche)', () => {
  it('es gibt genau drei Reiter, und ihre Werte sind die des Filters plus der leere Zustand', () => {
    /*
     * Der leere Reiter ist Absicht und kein Übersehen: ohne ihn gäbe es keine Adresse mehr, unter
     * der der GESAMTE Bestand sichtbar ist — und damit auch keine Ausfuhr über ihn, obwohl die
     * Ausfuhr genau das seit B2-1 kann. Ein neuer Filterwert ohne Reiter (oder umgekehrt) macht
     * diesen Test rot.
     */
    expect(PARTNER_TABS.map((t) => t.value)).toEqual(['', ...PARTNER_ASSIGNMENTS])
    for (const tab of PARTNER_TABS) {
      expect(tab.label.trim().length, `„${tab.value}" hat eine Beschriftung`).toBeGreaterThan(0)
    }
  })

  it('ein Reiterwechsel behält ALLE übrigen Filter und tauscht nur die Zuordnung', () => {
    /*
     * DER KERNTEST DIESES ABSCHNITTS. Ein Reiter, der die gesetzten Filter abwirft, sähe aus wie
     * eine Ansicht derselben Auswahl und wäre eine andere — und der Export-Link darunter übernähme
     * die Verwechslung wortlos.
     */
    const filters = readFilters({ ...SAMPLE, partner: 'unassigned' })
    const out = partnerTabParams(filters, 'assigned')

    expect(out.get('partner')).toBe('assigned')
    expect([...out.keys()].sort(), 'kein Filter geht verloren').toEqual([...FILTER_PARAMS].sort())
    for (const param of FILTER_PARAMS) {
      if (param === 'partner') continue
      expect(out.get(param), `„${param}" bleibt unverändert`).toBe(SAMPLE[param])
    }
  })

  it('der leere Reiter entfernt den Parameter, statt ihn leer zu setzen', () => {
    const out = partnerTabParams(readFilters({ partner: 'assigned', branche: 'kuehlhaus' }), '')
    expect(
      out.has('partner'),
      'ein leeres partner= wäre ein Wert, den readFilters erst wieder verwirft',
    ).toBe(false)
    expect(out.get('branche'), 'die übrigen Filter bleiben auch hier').toBe('kuehlhaus')
  })

  it('ein Reiterwechsel führt IMMER auf Seite 1', () => {
    /*
     * Der Wechsel ändert die Treffermenge; „Seite 3" der einen ist in der anderen eine andere oder
     * gar keine. Eine mitgeschleppte Seitenzahl zeigte im besten Fall etwas Falsches und im
     * schlechteren eine leere Tabelle, die wie „keine Treffer" aussieht.
     */
    const out = partnerTabParams(readFilters({ seite: '4', partner: 'assigned' }), 'unassigned')
    expect(out.has('seite')).toBe(false)
  })
})

describe('die RPC-Argumente', () => {
  it('der vierte Einwilligungszweck kommt durch (B18-6)', () => {
    /*
     * `partner_lead_disclosure` gibt es seit B18-6 im DB-Enum, und die Lead-Liste bietet ihn im
     * Filter an. Die Zuweisung in `filterRpcArgs` ist eine TYPZUSICHERUNG — eine eigene, veraltete
     * Literal-Union hätte hier keinen Typfehler erzeugt, sondern nur behauptet, den Wert gäbe es
     * nicht. Deshalb kommt die Union jetzt aus `./leads`, und dieser Test hält den Wert fest.
     */
    expect(filterRpcArgs(readFilters({ zweck: 'partner_lead_disclosure' })).p_consent_purpose).toBe(
      'partner_lead_disclosure',
    )
  })

  it('unbrauchbare Zahlen und Daten werden verworfen statt zu 0 bzw. an Postgres gereicht', () => {
    const args = filterRpcArgs(
      readFilters({ 'verbrauch-ab': 'viel', 'vertragsende-ab': '01.01.2027' }),
    )
    expect(args.p_consumption_min, '„viel" wäre als 0 ein echter Filter').toBeUndefined()
    expect(args.p_contract_end_from, 'ein unparsbares Datum wäre ein harter DB-Fehler').toBeUndefined()
  })

  it('eine erfundene Branche wird abgefangen, BEVOR sie am Postgres-Enum scheitert', () => {
    expect(filterRpcArgs(readFilters({ branche: 'raumfahrt' })).p_industry).toBeUndefined()
    expect(filterRpcArgs(readFilters({ branche: 'kuehlhaus' })).p_industry).toBe('kuehlhaus')
  })

  it('jeder Filter hat genau ein RPC-Argument, und keines bleibt bei „alles" gesetzt', () => {
    const allSet = filterRpcArgs(readFilters({ ...SAMPLE }))
    const none = filterRpcArgs(EMPTY_FILTERS)

    // `p_due_only` ist der einzige boolesche Filter: „aus" ist dort `false`, nicht `undefined`.
    expect(none.p_due_only).toBe(false)
    for (const [key, value] of Object.entries(none)) {
      if (key === 'p_due_only') continue
      expect(value, `${key} ist ohne Filter nicht gesetzt`).toBeUndefined()
    }
    for (const [key, value] of Object.entries(allSet)) {
      expect(value, `${key} ist mit Filter gesetzt`).toBeDefined()
    }
    expect(
      Object.keys(allSet).length,
      'ein RPC-Argument je Filter (dueOnly zählt mit)',
    ).toBe(FILTER_PARAMS.length)
  })
})
