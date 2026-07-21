/**
 * Die ausgeführte Datei muss sich ZURÜCKLESEN lassen (B2-1).
 *
 * ── WARUM DIESER TEST EINEN EIGENEN PARSER MITBRINGT ─────────────────────────────────────────────
 * Die Aussage lautet nicht „die Zeichenkette sieht richtig aus", sondern „ein fremdes Werkzeug
 * gewinnt daraus wieder GENAU die Felder, die hineingegeben wurden". Das lässt sich nur beweisen,
 * indem man die Datei tatsächlich zerlegt — mit einem Parser, der nichts von der Erzeugung weiss.
 * Er steht deshalb HIER und nicht im Produktionsmodul: dort wäre er toter Code, und ein Parser, der
 * dieselben Annahmen teilt wie der Schreiber, bewiese nichts.
 *
 * Der harte Fall ist ein Firmenname mit Semikolon UND Zeilenumbruch: ohne korrektes Quoting
 * verschiebt EINE solche Firma alle folgenden Spalten ihrer Zeile — und in einer Adressdatei heisst
 * „eine Spalte verschoben" irgendwann „falscher Empfänger".
 */
import { describe, expect, it } from 'vitest'

import {
  CSV_BOM,
  CSV_DELIMITER,
  CSV_HEADERS,
  csvChunks,
  csvEscape,
  exportFileName,
  readExportResult,
  type LeadExportRow,
} from './csv'

/**
 * Ein bewusst naiver, aber vollständiger RFC-4180-Leser: Zustandsautomat über die Zeichen, kennt
 * Anführungszeichen, verdoppelte Anführungszeichen, das Semikolon als Trennzeichen und CRLF/LF als
 * Zeilenende. Er kennt die Erzeugung nicht.
 */
function parseCsv(text: string, delimiter = CSV_DELIMITER): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  const body = text.startsWith(CSV_BOM) ? text.slice(CSV_BOM.length) : text

  while (i < body.length) {
    const ch = body[i]!

    if (inQuotes) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (ch === delimiter) {
      row.push(field)
      field = ''
      i += 1
      continue
    }
    if (ch === '\r' || ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += body[i] === '\r' && body[i + 1] === '\n' ? 2 : 1
      continue
    }

    field += ch
    i += 1
  }

  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function row(overrides: Partial<LeadExportRow> = {}): LeadExportRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'max@example.at',
    company: 'Muster GmbH',
    contact_name: 'Max Muster',
    phone: '+43 1 1234567',
    status: 'new',
    first_source_key: 'warteliste',
    first_source_label: 'Warteliste Leistungstarif 2027',
    industry: 'kuehlhaus',
    postal_code: '1100',
    annual_consumption_kwh: 180000,
    metering_type: 'netzebene_7',
    supplier: 'Wien Energie',
    contract_end_date: '2027-03-31',
    created_at: '2026-07-01T08:00:00Z',
    last_interaction_at: '2026-07-02T08:00:00Z',
    marketing_consent: 'bestätigt',
    ...overrides,
  }
}

function build(rows: LeadExportRow[]): string {
  return [...csvChunks(rows)].join('')
}

describe('CSV: Trennzeichen und BOM', () => {
  it('beginnt mit dem UTF-8-BOM und benutzt das Semikolon', () => {
    const text = build([row()])

    // Ohne BOM liest Excel unter deutscher Ländereinstellung Windows-1252 — aus „bestätigt" würde
    // „bestÃ¤tigt", und die Datei wird von Hand repariert (dabei entstehen die Fehler).
    expect(text.startsWith(CSV_BOM)).toBe(true)
    expect(text.codePointAt(0)).toBe(0xfeff)
    // Erste Zeile: die Kopfzeile, semikolongetrennt.
    expect(text.slice(CSV_BOM.length).split('\r\n')[0]).toBe(CSV_HEADERS.join(';'))
  })

  it('die Kopfzeile kommt auch bei null Zeilen', () => {
    const parsed = parseCsv(build([]))
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toEqual([...CSV_HEADERS])
  })
})

describe('CSV: Rücklesen', () => {
  it('Felder mit Semikolon, Anführungszeichen und Zeilenumbruch kommen unverändert zurück', () => {
    const hart = row({
      company: 'Muster; Söhne & Co\nZweigstelle "Nord"',
      contact_name: 'Anna "Anni" Muster',
      phone: '+43 1 111;222',
    })

    const parsed = parseCsv(build([hart]))

    expect(parsed).toHaveLength(2)
    const [header, data] = parsed as [string[], string[]]
    expect(header).toEqual([...CSV_HEADERS])
    // Die Spaltenzahl ist der eigentliche Beweis: ohne Quoting hätte das Semikolon im Firmennamen
    // die Zeile verlängert und alle folgenden Spalten verschoben.
    expect(data).toHaveLength(CSV_HEADERS.length)
    expect(data[header.indexOf('Firma')]).toBe('Muster; Söhne & Co\nZweigstelle "Nord"')
    expect(data[header.indexOf('Ansprechperson')]).toBe('Anna "Anni" Muster')
    expect(data[header.indexOf('Telefon')]).toBe('+43 1 111;222')
    expect(data[header.indexOf('E-Mail')]).toBe('max@example.at')
  })

  it('mehrere Zeilen bleiben getrennt, auch wenn eine davon einen Zeilenumbruch enthält', () => {
    const parsed = parseCsv(
      build([
        row({ company: 'Erste\nZeile GmbH', email: 'a@example.at' }),
        row({ company: 'Zweite GmbH', email: 'b@example.at' }),
      ]),
    )

    expect(parsed).toHaveLength(3)
    const header = parsed[0]!
    expect(parsed[1]![header.indexOf('E-Mail')]).toBe('a@example.at')
    expect(parsed[2]![header.indexOf('E-Mail')]).toBe('b@example.at')
  })

  it('der Einwilligungsstand steht je Zeile — die wichtigste Spalte der Datei', () => {
    const parsed = parseCsv(
      build([
        row({ marketing_consent: 'bestätigt' }),
        row({ marketing_consent: 'offen' }),
        row({ marketing_consent: 'keine' }),
      ]),
    )
    const idx = parsed[0]!.indexOf('Marketing-Einwilligung')
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(parsed.slice(1).map((r) => r[idx])).toEqual(['bestätigt', 'offen', 'keine'])
  })

  it('leere Angaben bleiben LEER und werden nicht zu „—“', () => {
    const parsed = parseCsv(
      build([row({ company: null, supplier: null, contract_end_date: null, industry: null })]),
    )
    const header = parsed[0]!
    const data = parsed[1]!
    // Ein Gedankenstrich ist am Bildschirm eine Lesehilfe, in einer Datei ein Wert — er landete
    // sonst als Firmenname in einem fremden Werkzeug.
    expect(data[header.indexOf('Firma')]).toBe('')
    expect(data[header.indexOf('Versorger')]).toBe('')
    expect(data[header.indexOf('Vertragsende')]).toBe('')
    expect(data[header.indexOf('Branche')]).toBe('')
  })
})

describe('CSV: Kleinteile', () => {
  it('csvEscape quotet nur, wenn nötig', () => {
    expect(csvEscape('einfach')).toBe('einfach')
    expect(csvEscape('mit;Semikolon')).toBe('"mit;Semikolon"')
    expect(csvEscape('mit"Anführung')).toBe('"mit""Anführung"')
    expect(csvEscape('mit\nUmbruch')).toBe('"mit\nUmbruch"')
  })

  it('readExportResult liefert null, wenn der Wrapper nicht `ok` gemeldet hat', () => {
    expect(readExportResult(null)).toBeNull()
    expect(readExportResult({ status: 'invalid_filter' })).toBeNull()
    // „ok mit null Zeilen" ist etwas anderes als „konnte nicht gelesen werden".
    expect(readExportResult({ status: 'ok', rows: [], row_count: 0, filter_summary: 'alle' }))
      .toEqual({ rows: [], rowCount: 0, filterSummary: 'alle', exportedAt: null })
  })

  it('der Dateiname trägt den Zeitpunkt aus der Datenbank', () => {
    expect(exportFileName('2026-07-21T10:11:12Z')).toBe('coolin-leads-2026-07-21-10-11-12.csv')
    expect(exportFileName(null)).toBe('coolin-leads-unbekannt.csv')
  })
})
