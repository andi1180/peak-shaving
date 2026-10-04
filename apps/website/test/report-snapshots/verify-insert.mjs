/**
 * Prüft einen Seiteneinschub im PDF-Text-Snapshot: der alte Stand, um `pages` Seiten ab Index `at`
 * verschoben, muss dem neuen Stand ohne die eingefügten Seiten gleichen. Verschoben wird nur auf
 * der alten Seite (Fusszeile „Seite n von N", Agenda-Seitenzahlen); jede andere Seitenzahl, die das
 * Parsing nicht eindeutig zuordnet, ist ein Fehler (fail-closed).
 *
 * Plain JavaScript, damit das CLI unter Node 20 (CI) ohne Übersetzer läuft.
 */

/** Fusszeile jeder Inhaltsseite: „… www.coolin.at · Seite 3 von 16". */
const FOOTER = /^(.*· Seite )(\d+)( von )(\d+)(\s*)$/
/** Agenda-Eintrag: Titel ab Spalte 0, mindestens zwei Leerzeichen, Seitenzahl am Zeilenende. */
const AGENDA_ENTRY = /^(\S.*?\S)(\s{2,})(\d+)$/
const AGENDA_HEADING = 'Inhalt'
/** Alles, was nach einer Seitenzahl aussieht und weder Fusszeile noch Agenda-Eintrag ist. */
const PAGE_NUMBER_LIKE = /(Seiten?|S\.)\s*\d/
const MAX_DIFFERENCES = 10

/** pdftotext schliesst jede Seite mit \f ab; nach dem letzten steht nichts. */
export function splitPages(text) {
  const parts = text.split('\f')
  if (parts.at(-1) !== '') return null
  return parts.slice(0, -1)
}

const collapse = (line) => line.replace(/\s+/g, ' ').trim()

/**
 * Der alte Stand, wie er nach dem Einschub aussehen muss. Zurück kommen je Seite die Zeilen und die
 * Indizes der Zeilen, deren Leerraum beim Vergleich zusammengefasst wird (Fusszeile, Agenda).
 */
export function shiftPages(oldPages, at, pages) {
  const total = oldPages.length
  const problems = []
  const agendaPages = oldPages
    .map((page, i) => (page.split('\n').includes(AGENDA_HEADING) ? i : -1))
    .filter((i) => i >= 0)
  if (agendaPages.length !== 1) {
    problems.push(
      `Agenda nicht eindeutig erkannt (Seiten mit „${AGENDA_HEADING}": ${agendaPages.length})`,
    )
  }
  const agendaIndex = agendaPages.length === 1 ? agendaPages[0] : -1

  const shifted = oldPages.map((page, i) => {
    const collapsed = new Set()
    let footers = 0
    const lines = page.split('\n').map((line, j) => {
      const where = `alt Seite ${i + 1}, Zeile ${j + 1}`
      const footer = FOOTER.exec(line)
      if (footer) {
        footers += 1
        const n = Number(footer[2])
        const of = Number(footer[4])
        if (n !== i + 1 || of !== total) {
          problems.push(
            `${where}: Fusszeile „Seite ${n} von ${of}" passt nicht zu Seite ${i + 1} von ${total}`,
          )
        }
        collapsed.add(j)
        return footer[1] + (i >= at ? n + pages : n) + footer[3] + (of + pages) + footer[5]
      }
      if (i === agendaIndex && /\d\s*$/.test(line)) {
        const entry = AGENDA_ENTRY.exec(line)
        const k = entry ? Number(entry[3]) : NaN
        if (!entry || k < 1 || k > total) {
          problems.push(`${where}: Agenda-Zeile nicht eindeutig erkannt: ${JSON.stringify(line)}`)
          return line
        }
        collapsed.add(j)
        return entry[1] + entry[2] + (k >= at + 1 ? k + pages : k)
      }
      if (PAGE_NUMBER_LIKE.test(line)) {
        problems.push(`${where}: Seitenzahl in unbekanntem Muster: ${JSON.stringify(line.trim())}`)
      }
      return line
    })
    // Deckblatt und Schlussseite tragen keine Fusszeile, jede Seite dazwischen genau eine.
    const expectedFooters = i === 0 || i === total - 1 ? 0 : 1
    if (footers !== expectedFooters) {
      problems.push(`alt Seite ${i + 1}: ${footers} Fusszeilen, erwartet ${expectedFooters}`)
    }
    return { lines, collapsed }
  })
  return { shifted, problems }
}

/** Seitenweiser Vergleich; `pageNumberOf` liefert die Seitenzahl im NEUEN Dokument. */
function comparePages(expected, actual, pageNumberOf) {
  const differences = []
  for (let i = 0; i < expected.length && differences.length < MAX_DIFFERENCES; i++) {
    const { lines, collapsed } = expected[i]
    const got = actual[i].split('\n')
    for (let j = 0; j < Math.max(lines.length, got.length); j++) {
      const e = lines[j]
      const a = got[j]
      const same =
        e !== undefined &&
        a !== undefined &&
        (collapsed.has(j) ? collapse(e) === collapse(a) : e === a)
      if (!same) {
        differences.push(
          `neu Seite ${pageNumberOf(i)}, Zeile ${j + 1}\n  - ${e ?? '(fehlt)'}\n  + ${a ?? '(fehlt)'}`,
        )
        if (differences.length >= MAX_DIFFERENCES) break
      }
    }
  }
  return differences
}

/**
 * @param {string} oldText alter Snapshot
 * @param {string} newText neuer Snapshot
 * @param {{ at: number, pages: number }} options `at` = 0-basierter Index der ersten eingefügten Seite
 * @returns {{ ok: boolean, problems: string[], inserted: string[] }}
 */
export function verifyInsert(oldText, newText, { at, pages }) {
  const oldPages = splitPages(oldText)
  const newPages = splitPages(newText)
  if (!oldPages || !newPages) {
    return {
      ok: false,
      problems: ['Text endet nicht mit einem Seitenvorschub (\\f)'],
      inserted: [],
    }
  }
  if (
    !(Number.isInteger(at) && at >= 1 && at < oldPages.length) ||
    !(Number.isInteger(pages) && pages >= 1)
  ) {
    return { ok: false, problems: [`ungültige Parameter at=${at}, pages=${pages}`], inserted: [] }
  }
  if (newPages.length !== oldPages.length + pages) {
    return {
      ok: false,
      problems: [
        `Seitenzahl: alt ${oldPages.length}, neu ${newPages.length}, erwartet ${oldPages.length + pages}`,
      ],
      inserted: [],
    }
  }

  const inserted = newPages.slice(at, at + pages)
  const rest = [...newPages.slice(0, at), ...newPages.slice(at + pages)]
  const { shifted, problems } = shiftPages(oldPages, at, pages)
  const differences = comparePages(shifted, rest, (i) => (i >= at ? i + pages + 1 : i + 1))
  const all = [...problems, ...differences]
  return { ok: all.length === 0, problems: all, inserted }
}
