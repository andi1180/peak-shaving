/**
 * Die PV-Station: DREI Antworten, und die dritte trägt eine gegensätzliche Rechnung (22.09.2026).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WAS HIER GEMESSEN WIRD, UND WARUM KEIN UNIT-TEST ES SEHEN KANN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Die Station fragte bis zum 22.09.2026 nach einer „bereits errichteten ODER FEST BESTELLTEN"
 * Anlage — zwei Fälle unter EINER Antwort. Für den Rechenlauf sind sie gegensätzlich: die
 * errichtete steckt im Netzbetreiber-Lastgang bereits als gesenkter Bezug (eine PVGIS-Schätzung
 * DARF nicht abgezogen werden), die bestellte nicht (sie MUSS abgezogen werden, sonst entsteht
 * ihre Wirkung in keiner einzigen Zahl).
 *
 * Die Kette hängt an vier Dingen zugleich: der Knopf schickt seinen Wert, die Action schreibt
 * `hasPv` UND `pvStage` in EINEM Vorgang, `revalidatePath` erneuert die Seite, und die
 * Client-Komponente liest ihren Zweig aus dem Entwurf. Jedes Glied ist für sich richtig zu haben,
 * während die Kette bricht — `apps/web` hat bewusst kein Renderer-Setup (`vitest.config.ts`).
 *
 * ── AUSFÜHREN ────────────────────────────────────────────────────────────────────────────────
 *   PLAYWRIGHT_MODULE=/tmp/pw/node_modules/playwright/index.js node apps/web/e2e/pv-station.mjs
 *
 * Voraussetzungen und Umgebungsvariablen: s. `apps/web/e2e/README.md`.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pw = (await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')).default

const BASE = process.env.BASE ?? 'http://127.0.0.1:3977'
const PROJECT = process.env.PROJECT_ID ?? '11111111-1111-4111-8111-111111111111'
const EMAIL = process.env.ADMIN_EMAIL ?? 'e2e-rechnung@example.test'
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'Test-1234-abcd'
const DB_CONTAINER = process.env.DB_CONTAINER ?? 'supabase_db_peak-shaving'

const STATION = `${BASE}/admin/kalkulator-projekte/${PROJECT}/dateneingabe?station=zp1-pv`
const OTHER = `${BASE}/admin/kalkulator-projekte/${PROJECT}/dateneingabe?station=zp1-batterie`

const failures = []
function check(name, ok, detail) {
  if (ok) console.log(`  ok   ${name}`)
  else {
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
    failures.push(name)
  }
}

const here = path.dirname(fileURLToPath(import.meta.url))
function psql(sql) {
  return execFileSync(
    'docker',
    ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
    { input: sql, encoding: 'utf8' },
  ).trim()
}
const reseed = () => psql(readFileSync(path.join(here, 'pv-station.seed.sql'), 'utf8'))
const draft = () =>
  psql("select draft - '_provenance' from platform.metering_points where id='22222222-2222-4222-8222-222222222222'")

/** Klickt, bis die Wirkung eintritt — ein Klick VOR der Hydration tut nichts und sähe wie ein Defekt aus. */
async function clickUntil(page, name, done) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await done()) return true
    const button = page.getByRole('button', { name, exact: true })
    if (await button.count()) await button.first().click().catch(() => {})
    await page.waitForTimeout(1200)
  }
  return await done()
}

/** Weg-navigieren und zurück — der eigentliche Prüfschritt: überlebt die Auswahl den Seitenwechsel? */
async function roundTrip(page) {
  await page.goto(OTHER, { waitUntil: 'domcontentloaded' })
  await page.goto(STATION, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: /Photovoltaik|PV/ }).first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(1500)
  return (await page.locator('main').innerText()).replace(/\s+/g, ' ')
}

const browser = await pw.chromium.launch({ headless: true })
const page = await browser.newPage()
const consoleErrors = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})

try {
  await page.goto(`${BASE}/admin/anmelden`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[name="email"]', EMAIL)
  await page.fill('input[name="password"]', PASSWORD)
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await page.waitForURL((u) => !u.pathname.includes('anmelden'), { timeout: 20000 })

  // ── Die drei Antworten, jede einzeln über Seitenwechsel geprüft ───────────
  const CASES = [
    {
      label: 'geplant oder bestellt',
      button: 'Ja, aber geplant oder bestellt',
      hasPv: 'true',
      stage: 'planned',
      vermerkt: 'Vermerkt: PV-Anlage geplant oder bestellt',
      wirkung: 'vom gemessenen Netzbezug abgezogen',
    },
    {
      label: 'in Betrieb',
      button: 'Ja, sie ist in Betrieb',
      hasPv: 'true',
      stage: 'existing',
      vermerkt: 'Vermerkt: PV-Anlage in Betrieb',
      wirkung: 'NICHT abgezogen',
    },
    {
      label: 'keine Anlage',
      button: 'Nein',
      hasPv: 'false',
      stage: null,
      vermerkt: 'Vermerkt: keine PV-Anlage vorhanden',
      wirkung: null,
    },
  ]

  for (const c of CASES) {
    console.log(`\nZustand „${c.label}" — antworten, weg, zurück`)
    /*
     * ⚠ Vor JEDEM Fall zurücksetzen. Die Frage erscheint nur bei unbeantworteter Station; ohne
     * Reseed liesse sich die zweite Antwort gar nicht geben, und der Lauf prüfte dreimal dieselbe.
     */
    reseed()
    await page.goto(STATION, { waitUntil: 'domcontentloaded' })
    if (!(await clickUntil(page, c.button, async () => draft().includes('hasPv')))) {
      throw new Error(`Die Antwort „${c.button}" wurde nicht gespeichert`)
    }

    const saved = draft()
    check(`[${c.label}] hasPv im Entwurf`, saved.includes(`"hasPv": ${c.hasPv}`), saved)
    check(
      `[${c.label}] Stufe im Entwurf`,
      c.stage === null ? !saved.includes('pvStage') : saved.includes(`"pvStage": "${c.stage}"`),
      saved,
    )

    const text = await roundTrip(page)
    check(`[${c.label}] Auswahl überlebt den Seitenwechsel`, text.includes(c.vermerkt))
    check(
      `[${c.label}] Die Frage wird nicht erneut gestellt`,
      !text.includes('Gibt es eine PV-Anlage für Zählpunkt'),
    )
    if (c.wirkung) {
      /*
       * ⚠ DER SATZ, DER DIE ASYMMETRIE SICHTBAR MACHT: der Wizard BIETET die PVGIS-Schätzung in
       * beiden Ja-Fällen an, der Rechenlauf ZIEHT sie nur bei „geplant" ab. Ohne ihn erzeugt ein
       * Admin eine Schätzung und sieht sie im Report nirgends wieder.
       */
      check(`[${c.label}] Die Station sagt, was mit der Schätzung geschieht`, text.includes(c.wirkung))
    }
  }

  // ── Gegenprobe: die drei Antworten sind wirklich drei ─────────────────────
  console.log('\nGegenprobe — die Frage bietet genau drei Antworten')
  reseed()
  await page.goto(STATION, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: /Photovoltaik|PV/ }).first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(1500)
  for (const name of ['Ja, sie ist in Betrieb', 'Ja, aber geplant oder bestellt', 'Nein']) {
    check(`Knopf „${name}" da`, (await page.getByRole('button', { name, exact: true }).count()) > 0)
  }
  check(
    'Die alte Ja/Nein-Fassung ist weg',
    (await page.getByRole('button', { name: 'Ja', exact: true }).count()) === 0,
  )

  check('keine Konsolenfehler', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
} catch (err) {
  console.log('ABBRUCH:', err.message.split('\n').slice(0, 5).join(' | '))
  failures.push('Lauf abgebrochen')
} finally {
  await browser.close()
}

console.log('')
console.log(failures.length === 0 ? 'ERGEBNIS: GRÜN' : `ERGEBNIS: ROT (${failures.length} Fehlschläge)`)
process.exit(failures.length === 0 ? 0 : 1)
