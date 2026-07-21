import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * B11, TEIL 2/TEIL 7 (4) — `packages/engine` hängt NICHT an der Tarifsatz-Datenschicht.
 *
 * ── WARUM DIESER TEST EXISTIERT ─────────────────────────────────────────────────────────────────
 * „Konfiguration an den Rändern, Determinismus im Kern": eine Engine, die ihre eigenen Tarifsätze
 * holt, ist nicht mehr allein aus ihren Eingaben nachvollziehbar. Dasselbe Ergebnis liesse sich
 * dann nicht reproduzieren, ohne den Stand der Datenschicht von damals zu kennen — und genau diese
 * Nachvollziehbarkeit ist die Voraussetzung dafür, dass eine eingefrorene Baseline (B14) 2027 noch
 * etwas belegt.
 *
 * ── WARUM ER DIE IMPORTE LIEST UND NICHT DIE package.json ───────────────────────────────────────
 * Eine Paketgrenze fängt diesen Fehler NICHT: `engine` hängt ohnehin an `shared` (Contract-Typen),
 * und die Datenschicht liegt bewusst dort — aus demselben Grund wie der `DEMO_BATTERY_CATALOG`,
 * nämlich weil BEIDE Apps sie brauchen und `apps/web` kein `engine` kennt. Eine `package.json`
 * verböte ausserdem einen relativen Pfad (`../../shared/src/tariff-catalog`) nicht. Was schützt,
 * ist die Prüfung der tatsächlichen Importe — und zwar sowohl auf den MODULPFAD als auch auf jeden
 * einzelnen exportierten NAMEN, denn über den `shared`-Barrel wären sie sonst erreichbar.
 *
 * Die Namen werden aus der QUELLE der Datenschicht gelesen und nicht importiert: dieser Wächter
 * soll selbst keine Abhängigkeit herstellen, die er verbietet — und ein neuer Export ist damit
 * automatisch mitgeprüft, ohne dass jemand hier eine Liste nachzieht.
 */

const ENGINE_SRC = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const CATALOG_FILE = join(ENGINE_SRC, '..', '..', 'shared', 'src', 'tariff-catalog.ts')

function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectSourceFiles(full))
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

/**
 * Entfernt Kommentare, damit die Prüfung den CODE meint und nicht die Prosa.
 *
 * Ohne das schlüge der Wächter schon an, weil `strategy.ts` die Datenschicht im Kopfkommentar
 * benennt — und ein Test, der das Erklären der Regel als Verstoss wertet, erzieht dazu, die
 * Erklärung wegzulassen. (Beobachtet: genau dieser Fall trat beim Bauen ein.)
 *
 * Bewusst eine Heuristik und kein Parser: ein `//` in einem Zeichenkettenliteral würde den Rest der
 * Zeile mitverschlucken. Für eine Prüfung, die nur MEHR erlauben kann als nötig, ist das die
 * richtige Richtung — sie übersieht dadurch höchstens nichts, was Code wäre.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Jeder Bezeichner, den die Datenschicht öffentlich anbietet — Werte UND reine Typen. */
function catalogExportNames(): string[] {
  const source = readFileSync(CATALOG_FILE, 'utf8')
  const names = new Set<string>()
  for (const match of source.matchAll(
    /^export\s+(?:declare\s+)?(?:const|function|type|interface|enum|class)\s+([A-Za-z_$][\w$]*)/gm,
  )) {
    names.add(match[1]!)
  }
  return [...names]
}

describe('engine hängt nicht an der Tarifsatz-Datenschicht (B11)', () => {
  const files = collectSourceFiles(ENGINE_SRC)
  const catalogNames = catalogExportNames()

  it('findet überhaupt Engine-Quelldateien (sonst prüfte dieser Test nichts)', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('kennt die Bezeichner der Datenschicht (sonst liefe die Namensprüfung leer)', () => {
    // Ein umbenanntes oder verschobenes Modul darf diesen Wächter nicht still entwaffnen.
    expect(catalogNames).toContain('lookupTariffProfile')
    expect(catalogNames).toContain('TARIFF_SETS')
    expect(catalogNames).toContain('PendingTariffProfile')
    expect(catalogNames.length).toBeGreaterThanOrEqual(15)
  })

  it('keine Engine-Datei importiert das Modul der Datenschicht', () => {
    // Nur echte Import-/Export-from-/require-Anweisungen — ein Verweis im Kommentar ist keine
    // Abhängigkeit, sondern die Begründung dafür, dass es keine gibt.
    const importOfCatalog = /(?:^|\n)\s*(?:import|export)[^\n]*['"][^'"\n]*tariff-catalog[^'"\n]*['"]|require\(\s*['"][^'"\n]*tariff-catalog/

    const offenders = files
      .filter((file) => !file.endsWith('no-catalog-dependency.test.ts'))
      .filter((file) => importOfCatalog.test(stripComments(readFileSync(file, 'utf8'))))
    expect(offenders.map((f) => f.slice(ENGINE_SRC.length + 1))).toEqual([])
  })

  it('keine Engine-Datei benutzt einen ihrer Bezeichner (auch nicht über den shared-Barrel)', () => {
    const offenders: string[] = []

    for (const file of files) {
      // Diese Datei selbst nennt die Bezeichner naturgemäss — sie ist der Wächter, nicht der Fall.
      if (file.endsWith('no-catalog-dependency.test.ts')) continue
      const source = stripComments(readFileSync(file, 'utf8'))
      for (const name of catalogNames) {
        if (new RegExp(`\\b${name}\\b`).test(source)) {
          offenders.push(`${file.slice(ENGINE_SRC.length + 1)} → ${name}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
