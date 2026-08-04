import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * WÄCHTER: eine `'use server'`-Datei darf AUSSCHLIESSLICH async Funktionen exportieren.
 *
 * ── ⚠ ER STEHT HIER, WEIL DER FEHLER REAL AUFGETRETEN IST (B18-4, Portal-Oberfläche) ────────────
 * Ein daneben exportierter WERT (dort: der Startzustand eines Formulars) lässt `build`, `typecheck`
 * UND `lint` unbeeindruckt durchlaufen und wirft erst zur LAUFZEIT, beim Rendern der Seite:
 *
 *     Error: A "use server" file can only export async functions, found object.
 *
 * Gemessen gegen den Production-Build: Die Seite antwortete mit HTTP 500 und „Application error",
 * sobald das Formular abgesendet wurde. Kein Gate hat ihn gefangen — genau die Sorte Fehler, für
 * die dieses Repo Wächter schreibt.
 *
 * ── WAS ERLAUBT BLEIBT ──────────────────────────────────────────────────────────────────────────
 * `export type` und `export interface` verschwinden beim Kompilieren und sind unbedenklich; ein
 * `export async function` ist der Regelfall. Alles Übrige (`export const`, `let`, `var`, `class`,
 * `enum`, eine NICHT-async Funktion) bricht zur Laufzeit und wird hier abgewiesen.
 *
 * Kommentare werden vor der Prüfung entfernt — sonst wertete der Wächter das ERKLÄREN der Regel
 * als Verstoss (die B11-Falle).
 */

const ROOTS = ['lib', 'app', 'components']

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function walk(dir: string, out: string[]): string[] {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

const appRoot = path.resolve(import.meta.dirname, '..')
const files = ROOTS.flatMap((root) => walk(path.join(appRoot, root), []))

const serverActionFiles = files.filter((file) =>
  /^\s*['"]use server['"]/.test(fs.readFileSync(file, 'utf8')),
)

describe("Wächter — 'use server'-Dateien", () => {
  it('es gibt überhaupt welche (sonst prüft dieser Test nichts)', () => {
    expect(serverActionFiles.length).toBeGreaterThan(0)
  })

  it('⚠ exportieren ausschliesslich async Funktionen (Werte brechen erst zur Laufzeit)', () => {
    const verstoesse: string[] = []

    for (const file of serverActionFiles) {
      const source = stripComments(fs.readFileSync(file, 'utf8'))
      for (const match of source.matchAll(/^export\s+(?!type\b|interface\b)(\S+)/gm)) {
        const rest = source.slice(match.index)
        // Der Regelfall — und die einzige zulässige Form eines Laufzeit-Exports.
        if (/^export\s+async\s+function\b/.test(rest)) continue
        verstoesse.push(`${path.relative(appRoot, file)}: export ${match[1]}`)
      }
    }

    expect(
      verstoesse,
      'Eine "use server"-Datei darf nur async Funktionen exportieren — ein Wert daneben wirft erst ' +
        'zur Laufzeit ("A \'use server\' file can only export async functions"). Typ und Startwert ' +
        'gehören in eine gewöhnliche Datei daneben.',
    ).toEqual([])
  })
})
