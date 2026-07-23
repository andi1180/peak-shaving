import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ADMIN_ANMELDEN_HREF } from './config'
import { ADMIN_NAV_ITEMS } from './nav'

/**
 * Die zwei Invarianten des Admin-Rahmens (B17) — beide sind Eigenschaften der ABLAGE und des
 * QUELLTEXTS, nicht des Laufzeitverhaltens. Genau deshalb lassen sie sich hier prüfen und nur hier:
 * ein Playwright-Lauf sieht immer nur die Seiten, die er zufällig aufruft, und ein DB-Gate sieht
 * gar keine.
 *
 *   1. JEDE Route unterhalb von `/admin` liegt im geschützten Zweig — mit genau einer benannten
 *      Ausnahme, dem Anmelde-Eingang. Seit B17 sitzt die Zugangsschranke in
 *      `app/admin/(intern)/layout.tsx` statt im Root-Layout; wer eine neue Seite versehentlich
 *      daneben statt darunter anlegt, baut damit eine öffentlich erreichbare Verwaltungsseite.
 *      Das fällt niemandem auf: Sie funktioniert ja.
 *
 *   2. Die NAMEN der Admin-Bereiche stehen in keiner Client-Datei. Ein `'use client'`-Modul wird zu
 *      einem JavaScript-Chunk im Auslieferungsverzeichnis — abrufbar für jeden, der die Adresse
 *      kennt, auch ohne Sitzung und ohne dass je ein HTML sie enthalten hätte. Bis B17 trug
 *      `components/admin/nav.tsx` die Liste selbst.
 *
 * Reine Datei- und Quelltextprüfung: kein React, kein Request, keine Datenbank (s. `vitest.config.ts`).
 */

const APP_DIR = path.resolve(import.meta.dirname, '..', '..', 'app')
const ADMIN_DIR = path.join(APP_DIR, 'admin')
const COMPONENTS_DIR = path.resolve(import.meta.dirname, '..', '..', 'components')

/** Die Route-Group, in der die Zugangsschranke sitzt. Taucht in keiner URL auf. */
const PROTECTED_GROUP = '(intern)'

/**
 * Die einzigen Dateien unterhalb von `app/admin/`, die AUSSERHALB des geschützten Zweigs liegen
 * dürfen — als Pfad relativ zu `app/admin/`.
 *
 * Diese Liste zu erweitern ist eine bewusste Entscheidung über eine öffentlich erreichbare
 * Verwaltungsroute und gehört begründet. Der Anmelde-Eingang steht darin, weil er anonym erreichbar
 * sein MUSS: läge er im geschützten Zweig, leitete die Schranke ihn auf die Kundenanmeldung um.
 */
const PUBLIC_ADMIN_FILES = ['anmelden/page.tsx']

/** Alle `page.tsx`/`route.ts` unter `dir`, relativ zu `dir`. Tests zählen nicht mit. */
function routeFiles(dir: string, prefix = ''): string[] {
  const found: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      found.push(...routeFiles(path.join(dir, entry.name), rel))
    } else if (entry.name === 'page.tsx' || entry.name === 'route.ts') {
      found.push(rel)
    }
  }
  return found
}

/** Alle `.ts`/`.tsx` unter `dir` (absolute Pfade). */
function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) found.push(full)
  }
  return found
}

/**
 * Kommentare entfernen, bevor der Quelltext geprüft wird.
 *
 * Ohne das wäre ein Test entstanden, der das ERKLÄREN der Regel als Verstoss wertet — die Datei
 * begründet ja, warum die Bereichsnamen nicht in ihr stehen dürfen. Genau diese Falle ist in B11
 * schon einmal zugeschlagen (`packages/engine/src/tariff/no-catalog-dependency.test.ts`), und die
 * Lehre daraus gilt hier unverändert: ein Wächter, der die Begründung bestraft, erzieht dazu, sie
 * wegzulassen.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('Admin-Routen liegen im geschützten Zweig (B17)', () => {
  const files = routeFiles(ADMIN_DIR)

  it('findet überhaupt Routen — sonst prüfte der Test nichts', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it('legt jede Route unter (intern) ab, ausser den benannten Ausnahmen', () => {
    const unprotected = files.filter(
      (rel) => !rel.startsWith(`${PROTECTED_GROUP}/`) && !PUBLIC_ADMIN_FILES.includes(rel),
    )
    expect(unprotected).toEqual([])
  })

  it('hält die Ausnahmeliste an der Wirklichkeit — jeder Eintrag existiert', () => {
    // Andernfalls liefe die Liste beim ersten Umbenennen leer und der Test oben wäre wirkungslos:
    // er prüfte dann eine Ausnahme, die es nicht mehr gibt (dieselbe Beidseitigkeit wie
    // `assertRoutesMatchDisk` in `lib/routes.ts`).
    for (const rel of PUBLIC_ADMIN_FILES) {
      expect(files, `${rel} steht in PUBLIC_ADMIN_FILES, liegt aber nicht auf der Platte`).toContain(
        rel,
      )
    }
  })

  it('führt den Anmelde-Eingang unter genau dem Pfad, den ADMIN_ANMELDEN_HREF nennt', () => {
    // Der Ordner liesse sich umbenennen, ohne dass irgendetwas bricht — der Rahmen leitete beim
    // Abmelden dann auf eine 404. Deshalb wird die Konstante gegen die Ablage geprüft.
    const fromHref = `${ADMIN_ANMELDEN_HREF.replace('/admin/', '')}/page.tsx`
    expect(files).toContain(fromHref)
  })

  it('hält die Zugangsschranke im geschützten Zweig — und NUR dort', () => {
    const inner = stripComments(
      fs.readFileSync(path.join(ADMIN_DIR, PROTECTED_GROUP, 'layout.tsx'), 'utf8'),
    )
    const eingang = stripComments(
      fs.readFileSync(path.join(ADMIN_DIR, 'anmelden', 'layout.tsx'), 'utf8'),
    )
    expect(inner).toContain('isCurrentUserAdmin')
    // Am Eingang wäre sie eine Schranke vor der Anmeldung — die Seite leitete auf die
    // Kundenanmeldung um und wäre damit unerreichbar.
    expect(eingang).not.toContain('isCurrentUserAdmin')
  })

  /*
   * ⚠ GEMESSEN, NICHT ABGELEITET — der Grund für die zwei getrennten Root-Layouts.
   *
   * Mit einem GEMEINSAMEN `app/admin/layout.tsx` über beiden Zweigen hat Next in das anonym
   * ausgelieferte HTML des Eingangs zusätzlich das Skript-Bündel der Admin-Übersicht geschrieben
   * (`chunks/app/admin/(intern)/page-….js`, darin die Namen ihrer Server Actions). Ohne
   * gemeinsames Elternteil verschwindet die Kopplung. Die Datei darf deshalb nicht zurückkommen —
   * sie sähe wie eine harmlose Aufräumarbeit aus („die Hülle steht doppelt"), und der Rückfall
   * wäre in keinem Test und in keinem Build sichtbar. Vollständige Begründung samt Gegenprobe:
   * `components/admin/root-shell.tsx`.
   */
  it('hat KEIN gemeinsames Root-Layout über Eingang und geschütztem Zweig', () => {
    expect(fs.existsSync(path.join(ADMIN_DIR, 'layout.tsx'))).toBe(false)
    expect(fs.existsSync(path.join(ADMIN_DIR, PROTECTED_GROUP, 'layout.tsx'))).toBe(true)
    expect(fs.existsSync(path.join(ADMIN_DIR, 'anmelden', 'layout.tsx'))).toBe(true)
  })
})

describe('Der Rahmen verrät die Bereichsstruktur nicht (B17)', () => {
  const clientFiles = [...sourceFiles(COMPONENTS_DIR), ...sourceFiles(APP_DIR)].filter((file) =>
    /^\s*(['"])use client\1/.test(fs.readFileSync(file, 'utf8')),
  )

  it('findet überhaupt Client-Dateien — sonst prüfte der Test nichts', () => {
    expect(clientFiles.length).toBeGreaterThan(10)
  })

  /*
   * `import type` ist ausdrücklich erlaubt und kein Schlupfloch: eine reine Typ-Einfuhr wird beim
   * Übersetzen ERSATZLOS entfernt und kann deshalb nichts in ein Bündel tragen. Die Navigation
   * bezieht `AdminNavItem` genau so. Geprüft wird der WERT-Import — der einzige, der die Liste
   * mitnähme. Die Schreibweise `import { type X }` gilt hier bewusst als Verstoss: sie wäre zwar
   * ebenfalls harmlos, aber die Unterscheidung „alle Bindungen sind Typen" hinge dann am Compiler
   * statt am Quelltext, und ein später hinzugefügter Wert fiele nicht mehr auf.
   */
  it('lässt keine Client-Datei die Bereichsliste als Wert importieren', () => {
    const offenders = clientFiles.filter((file) =>
      /\bimport\s+(?!type\b)[^;\n]*?from\s+['"](?:@\/lib\/admin\/nav|(?:\.{1,2}\/)+lib\/admin\/nav)['"]/.test(
        stripComments(fs.readFileSync(file, 'utf8')),
      ),
    )
    expect(offenders.map((f) => path.relative(COMPONENTS_DIR, f))).toEqual([])
  })

  it('nennt in der Client-Navigation keinen einzigen Bereichsnamen', () => {
    const source = stripComments(
      fs.readFileSync(path.join(COMPONENTS_DIR, 'admin', 'nav.tsx'), 'utf8'),
    )
    for (const item of ADMIN_NAV_ITEMS) {
      expect(source, `"${item.label}" steht im Client-Bündel der Navigation`).not.toContain(
        item.label,
      )
    }
  })

  it('rendert den Rahmen ausschliesslich aus dem geschützten Layout heraus', () => {
    // Der Anmelde-Eingang darf ihn nicht zeigen: er wird anonym ausgeliefert.
    const consumers = [...sourceFiles(APP_DIR), ...sourceFiles(COMPONENTS_DIR)].filter((file) =>
      /from\s+['"](@\/components\/admin\/shell|\.\/shell)['"]/.test(
        stripComments(fs.readFileSync(file, 'utf8')),
      ),
    )
    expect(consumers.map((f) => path.relative(APP_DIR, f))).toEqual([
      path.join('admin', PROTECTED_GROUP, 'layout.tsx'),
    ])
  })
})
