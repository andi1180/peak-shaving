import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * B21-3b (Delta 4) — `packages/engine` hängt NICHT an der Referenzdaten-Datenschicht.
 *
 * ── WARUM DIESER WÄCHTER JETZT ENTSTEHT ─────────────────────────────────────────────────────────
 * Mit dem kombinierten Intervallpreis bekommt die Engine erstmals Preise, die aus einer DATENBANK
 * stammen (`public.grid_tariffs`, `public.spot_prices`). Der naheliegende nächste Schritt wäre, sie
 * dort auch selbst zu holen — und genau der zerstörte zwei Zusagen auf einmal: die Engine wäre nicht
 * mehr allein aus ihren Eingaben nachvollziehbar (eine 2026 eingefrorene Baseline, B14-1, belegte
 * 2028 nichts mehr), und sie liefe nicht mehr im Browser ohne Netz. Deshalb kommen beide Quellen als
 * PARAMETER herein (`TariffPricingInputs` in `packages/shared`), und dieser Test hält das fest.
 *
 * Zwilling von `no-catalog-dependency.test.ts` (B11) — dieselbe Technik, andere Fläche: dort die
 * Tarifsatz-Datenschicht in `shared`, hier `@supabase/*` und `apps/website/lib/tariff-data`.
 *
 * ── WARUM ER DIE IMPORTE LIEST UND NICHT DIE package.json ───────────────────────────────────────
 * `packages/engine/package.json` führt `@supabase/supabase-js` heute nicht — aber eine
 * `package.json` verbietet weder einen relativen Pfad (`../../../apps/website/lib/tariff-data`) noch
 * die im pnpm-Workspace ohnehin auflösbaren Pakete anderer Arbeitsbereiche. Geprüft wird deshalb der
 * tatsächliche Code: MODULPFAD und jeder exportierte NAME.
 *
 * Die Namen werden aus der QUELLE der Datenschicht gelesen und nicht importiert — der Wächter stellt
 * selbst keine Abhängigkeit her, die er verbietet, und ein neuer Export ist automatisch mitgeprüft.
 */

const ENGINE_SRC = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const DATA_LAYER_DIR = join(ENGINE_SRC, '..', '..', '..', 'apps', 'website', 'lib', 'tariff-data')

function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectSourceFiles(full))
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

/** Kommentare raus: die Prüfung meint den CODE, nicht die Prosa (s. `no-catalog-dependency.test.ts`). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * Zeichenkettenliterale raus — NUR für die Bezeichner-Prüfung. Begründung wortgleich wie beim
 * B11-Wächter: ein Name in einem Anzeigetext ist keine Abhängigkeit, und ein Test, der das ahndet,
 * erzieht dazu, Anzeigetexte zu verstümmeln. Die Modulpfad-Prüfung behält die Literale.
 */
function stripStringLiterals(source: string): string {
  return source
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
}

/** Jeder Bezeichner, den die Datenschicht öffentlich anbietet — Werte UND reine Typen. */
function dataLayerExportNames(): string[] {
  const names = new Set<string>()
  for (const file of collectSourceFiles(DATA_LAYER_DIR)) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(
      /^export\s+(?:declare\s+)?(?:async\s+)?(?:const|function|type|interface|enum|class)\s+([A-Za-z_$][\w$]*)/gm,
    )) {
      names.add(match[1]!)
    }
    // Re-Exporte des Barrels (`export { a, type B } from './x'`) — sonst bliebe `index.ts` stumm.
    for (const match of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
      for (const raw of match[1]!.split(',')) {
        const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]!.trim()
        if (name) names.add(name)
      }
    }
  }
  return [...names]
}

describe('engine hängt nicht an der Referenzdaten-Datenschicht (B21-3b)', () => {
  const files = collectSourceFiles(ENGINE_SRC)
  const dataLayerNames = dataLayerExportNames()

  it('findet überhaupt Engine-Quelldateien (sonst prüfte dieser Test nichts)', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('kennt die Bezeichner der Datenschicht (sonst liefe die Namensprüfung leer)', () => {
    // Ein umbenanntes oder verschobenes Modul darf diesen Wächter nicht still entwaffnen.
    expect(dataLayerNames).toContain('fetchGridTariffs')
    expect(dataLayerNames).toContain('fetchSpotPrices')
    expect(dataLayerNames).toContain('createTariffDataClient')
    expect(dataLayerNames).toContain('analysisWindowToPriceRange')
    expect(dataLayerNames.length).toBeGreaterThanOrEqual(10)
  })

  it('keine Engine-Datei importiert @supabase/* oder die Datenschicht', () => {
    const forbiddenImport =
      /(?:^|\n)\s*(?:import|export)[^\n]*['"][^'"\n]*(?:@supabase\/|tariff-data)[^'"\n]*['"]|require\(\s*['"][^'"\n]*(?:@supabase\/|tariff-data)/

    const offenders = files
      .filter((file) => !file.endsWith('no-data-layer-dependency.test.ts'))
      .filter((file) => forbiddenImport.test(stripComments(readFileSync(file, 'utf8'))))
    expect(offenders.map((f) => f.slice(ENGINE_SRC.length + 1))).toEqual([])
  })

  it('keine Engine-Datei benutzt einen ihrer Bezeichner (auch nicht über einen Barrel)', () => {
    const offenders: string[] = []

    for (const file of files) {
      // Diese Datei selbst nennt die Bezeichner naturgemäss — sie ist der Wächter, nicht der Fall.
      if (file.endsWith('no-data-layer-dependency.test.ts')) continue
      const source = stripStringLiterals(stripComments(readFileSync(file, 'utf8')))
      for (const name of dataLayerNames) {
        if (new RegExp(`\\b${name}\\b`).test(source)) {
          offenders.push(`${file.slice(ENGINE_SRC.length + 1)} → ${name}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('führt `@supabase/*` auch nicht als Abhängigkeit des Pakets', () => {
    // Der Import-Test oben deckt den Code ab; dies deckt die Absicht ab. Eine eingetragene, aber
    // (noch) ungenutzte Abhängigkeit wäre die Einladung, sie zu benutzen.
    const pkg = JSON.parse(readFileSync(join(ENGINE_SRC, '..', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const all = { ...pkg.dependencies, ...pkg.devDependencies }
    expect(Object.keys(all).filter((n) => n.startsWith('@supabase/'))).toEqual([])
  })
})
