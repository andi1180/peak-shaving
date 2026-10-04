import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { verifyInsert } from './verify-insert.mjs'

const SNAPSHOTS = path.join(import.meta.dirname, '__snapshots__')
const CASES = readdirSync(SNAPSHOTS)
  .filter((name) => name.endsWith('.pdf.txt'))
  .sort()
const FAKE = 'Vorderseite (Testeinschub)\n\nnur zur Prüfung\n'
const OPTIONS = { at: 1, pages: 1 }

/** Index der Agenda-Seite (die mit der Zeile „Inhalt"), unabhängig davon, was davor steht. */
function agendaIndexOf(text: string): number {
  return text.split('\f').findIndex((page) => page.split('\n').includes('Inhalt'))
}

/**
 * Unabhängig vom Prüfer gebaut: Fake-Seite hinter dem Deckblatt, jede „Seite n von N" und jede
 * Agenda-Zahl um 1 erhöht — bei einem Einschub an Index 1 verschiebt sich jede davon.
 */
function insertFakePage(text: string, shift = true): string {
  const pages = text.split('\f')
  const agenda = agendaIndexOf(text)
  const bumped = shift
    ? pages.map((page, i) => {
        const footers = page.replace(
          /Seite (\d+) von (\d+)/g,
          (_, n, of) => `Seite ${+n + 1} von ${+of + 1}`,
        )
        return i === agenda
          ? footers.replace(/^(\S.*\S {2,})(\d+)$/gm, (_, head, k) => `${head}${+k + 1}`)
          : footers
      })
    : pages
  return [bumped[0], FAKE, ...bumped.slice(1)].join('\f')
}

/** Ersetzt in Seite `pageIndex` die erste Zeile, auf die `match` passt. */
function editLine(
  text: string,
  pageIndex: number,
  match: RegExp,
  edit: (line: string) => string,
): string {
  const pages = text.split('\f')
  const lines = pages[pageIndex]!.split('\n')
  const j = lines.findIndex((line) => match.test(line))
  expect(j, `keine passende Zeile auf Seite ${pageIndex + 1}`).toBeGreaterThanOrEqual(0)
  lines[j] = edit(lines[j]!)
  pages[pageIndex] = lines.join('\n')
  return pages.join('\f')
}

describe.each(CASES)('verifyInsert: %s', (name) => {
  const old = readFileSync(path.join(SNAPSHOTS, name), 'utf8')
  const inserted = insertFakePage(old)
  /* Seitenindizes im NEUEN Text: Agenda, Zusammenfassung dahinter, eine Inhaltsseite danach. */
  const agenda = agendaIndexOf(old) + 1
  const fails = (next: string) => expect(verifyInsert(old, next, OPTIONS).ok).toBe(false)

  it('erkennt den korrekt verschobenen Einschub und gibt die eingefügte Seite aus', () => {
    const result = verifyInsert(old, inserted, OPTIONS)
    expect(result.problems).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.inserted).toEqual([FAKE])
  })

  it('(i) ein geänderter Buchstabe im Fliesstext', () => {
    fails(
      editLine(inserted, agenda + 2, /^(?!.*· Seite).*[a-zäöü]{6}/, (line) =>
        line.replace(/[a-zäöü]/, 'X'),
      ),
    )
  })

  it('(ii) eine Agenda-Zahl um 1 falsch', () => {
    fails(
      editLine(inserted, agenda, /^\S.*\S {2,}\d+$/, (line) =>
        line.replace(/\d+$/, (k) => `${+k + 1}`),
      ),
    )
  })

  it('(iii) die Fusszeile einer Seite um 1 falsch', () => {
    fails(
      editLine(inserted, 5, /Seite \d+ von/, (line) =>
        line.replace(/Seite (\d+)/, (_, n) => `Seite ${+n + 1}`),
      ),
    )
  })

  it('(iv) eine Seite fehlt oder ist zu viel', () => {
    const pages = inserted.split('\f')
    fails([...pages.slice(0, 6), ...pages.slice(7)].join('\f'))
    fails([...pages.slice(0, 6), FAKE, ...pages.slice(6)].join('\f'))
  })

  it('(v) Einschub ohne verschobene Seitenzahlen', () => {
    fails(insertFakePage(old, false))
  })

  /* Tabellenzeilen der Zusammenfassung (hinter der Agenda): mit Ziffer, mit Spaltenabstand. */
  const TABLE_LINE = /^(?!.*· Seite)(?=.*\d).*\S {2,}\S/
  const shiftColumn = (line: string) => line.replace(/(\S)( {2,})(\S)/, '$1$2 $3')

  it('Leerraum einer Tabellenzeile um 1 verschoben: Standard OK mit Info, --strict FAIL', () => {
    const shifted = editLine(inserted, agenda + 1, TABLE_LINE, shiftColumn)
    const result = verifyInsert(old, shifted, OPTIONS)
    expect(result.problems).toEqual([])
    expect(result.spacingOnly).toHaveLength(1)
    expect(result.spacingOnly[0]).toMatch(new RegExp(`^neu Seite ${agenda + 2}, Zeile \\d+$`))
    expect(verifyInsert(old, shifted, { ...OPTIONS, strict: true }).ok).toBe(false)
  })

  it('zwei verschmolzene Wörter', () => {
    const word = /[A-Za-zÄÖÜäöüß] [A-Za-zÄÖÜäöüß]/
    fails(
      editLine(inserted, agenda + 1, new RegExp(`^(?!.*· Seite).*${word.source}`), (line) =>
        line.replace(/([A-Za-zÄÖÜäöüß]) ([A-Za-zÄÖÜäöüß])/, '$1$2'),
      ),
    )
  })

  it('eine geänderte Ziffer neben verschobenem Leerraum', () => {
    fails(
      editLine(inserted, agenda + 1, TABLE_LINE, (line) =>
        shiftColumn(line.replace(/\d/, (d) => `${(+d + 1) % 10}`)),
      ),
    )
  })

  it('eine in zwei Zeilen aufgeteilte Zeile', () => {
    fails(editLine(inserted, agenda + 1, TABLE_LINE, (line) => line.replace(/ {2,}/, '\n')))
  })
})

describe('verifyInsert: fail-closed', () => {
  const old = readFileSync(path.join(SNAPSHOTS, CASES[0]!), 'utf8')

  it('meldet eine Seitenzahl im Fliesstext, die weder Fusszeile noch Agenda ist', () => {
    // Positivkontrolle: dasselbe Muster trifft die echte Fusszeile.
    expect(old).toMatch(/Seite \d/)
    const withRef = editLine(
      old,
      3,
      /^(?!.*· Seite).*[a-zäöü]{6}/,
      (line) => `${line} (siehe Seite 7)`,
    )
    const result = verifyInsert(withRef, insertFakePage(withRef), OPTIONS)
    expect(result.ok).toBe(false)
    expect(result.problems.join('\n')).toContain('Seitenzahl in unbekanntem Muster')
  })

  it('meldet eine Agenda-Zahl-Zeile, die das Eintragsmuster nicht trifft', () => {
    const odd = editLine(old, agendaIndexOf(old), /^\S.*\S {2,}\d+$/, (line) =>
      line.replace(/ {2,}(\d+)$/, ' $1'),
    )
    const result = verifyInsert(odd, insertFakePage(odd), OPTIONS)
    expect(result.ok).toBe(false)
    expect(result.problems.join('\n')).toContain('Agenda-Zeile nicht eindeutig erkannt')
  })
})
