/**
 * Kenndaten nachtragen — der zweite Lauf über die echte Oberfläche einer Zählpunkt-Station.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ER MISST EINE ZUSAGE, DIE DIE STATION SELBST GIBT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Wer „Ja, es gibt einen Speicher" ohne Kenndaten speichert, bekommt die Antwort „sie lassen sich
 * hier jederzeit nachtragen". Die Zusage hing an einer Sichtbarkeitsbedingung, die genau dieselbe
 * Antwort als „erfasst" wertete und die vier Felder daraufhin ausblendete — der einzige Weg zu
 * ihnen führte über „Batterie-Angaben löschen", also über das Zurücknehmen der gerade gegebenen
 * Antwort. Gemessen wurde das am 22.09.2026 im Browser, nicht aus dem Code geschlossen.
 *
 * ⚠ DER ZWEITE TEIL IST DIE GEGENPROBE UND WIEGT GLEICH SCHWER: sobald ein Kenndatenfeld gesetzt
 * ist, muss das Formular WEG sein. Ein Formular neben der Zusammenfassung wäre ein zweiter Platz
 * für dieselben vier Werte — und der Platz, an dem man sie versehentlich ändert.
 *
 * Ausführen: s. `apps/web/e2e/README.md` (Playwright ist absichtlich keine Repo-Abhängigkeit).
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

const STATION = `${BASE}/admin/kalkulator-projekte/${PROJECT}/dateneingabe?station=zp1-batterie`
const OTHER = `${BASE}/admin/kalkulator-projekte/${PROJECT}/dateneingabe?station=zp1-pv`
const CAPACITY = '#dateneingabe-batterie-capacityKwh'

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
const reseed = () => psql(readFileSync(path.join(here, 'batterie-station.seed.sql'), 'utf8'))
const draft = () =>
  psql("select draft - '_provenance' from platform.metering_points where id='22222222-2222-4222-8222-222222222222'")

/**
 * Klickt, bis die Wirkung eintritt. Ein Klick VOR der Hydration tut nichts und sähe sonst wie ein
 * Defekt der Station aus — dieselbe Falle wie im Rechnungs-Lauf.
 */
async function clickUntil(page, name, done) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await done()) return true
    const button = page.getByRole('button', { name, exact: true })
    if (await button.count()) await button.first().click().catch(() => {})
    await page.waitForTimeout(1200)
  }
  return await done()
}

reseed()

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

  // ── 1. „Ja" ohne Kenndaten speichern ──────────────────────────────────────
  console.log('Schritt 1 — „Ja" ohne Kenndaten speichern')
  await page.goto(STATION, { waitUntil: 'domcontentloaded' })
  if (!(await clickUntil(page, 'Ja', async () => (await page.locator(CAPACITY).count()) > 0))) {
    throw new Error('Der Ja-Zweig liess sich nicht öffnen')
  }
  if (!(await clickUntil(page, 'Angaben übernehmen', async () => draft().includes('hasBattery')))) {
    throw new Error('Die Antwort wurde nicht gespeichert')
  }
  console.log('  Entwurf:', draft())

  // ── 2./3. Weg-navigieren und zurückkehren ─────────────────────────────────
  console.log('Schritt 2 — zu einer anderen Station und zurück')
  await page.goto(OTHER, { waitUntil: 'domcontentloaded' })
  await page.goto(STATION, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: /Batterie/ }).first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(2000)

  console.log('Erwartung — die Kenndaten lassen sich nachtragen')
  const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
  check('Die Zusammenfassung steht da', text.includes('Erfasst für Zählpunkt'))
  check('Sie benennt die fehlenden Kenndaten', text.includes('nachtragen'))
  check(
    'Die Kenndatenfelder sind editierbar sichtbar',
    (await page.locator(CAPACITY).count()) > 0 && (await page.locator(CAPACITY).isEditable()),
  )
  check(
    'Die beantwortete Frage wird nicht erneut gestellt',
    !text.includes('Haben Sie bereits einen Batteriespeicher'),
  )

  // ── 4. Nachtragen, ohne vorher zu löschen ─────────────────────────────────
  console.log('Schritt 3 — nachtragen, ohne den Löschweg zu benutzen')
  await page.fill(CAPACITY, '19,2')
  await page.fill('#dateneingabe-batterie-maxPowerKw', '9,6')
  if (
    !(await clickUntil(page, 'Angaben übernehmen', async () =>
      draft().includes('existingBatteryCapacityKwh'),
    ))
  ) {
    throw new Error('Die nachgetragenen Kenndaten wurden nicht gespeichert')
  }
  const saved = draft()
  check('Kapazität im Entwurf', saved.includes('"existingBatteryCapacityKwh": 19.2'), saved)
  check('Leistung im Entwurf', saved.includes('"existingBatteryMaxPowerKw": 9.6'), saved)

  // ── Gegenprobe: mit Kenndaten ist das Formular WEG ────────────────────────
  console.log('Gegenprobe — mit Kenndaten zeigt die Station nur die Zusammenfassung')
  await page.goto(OTHER, { waitUntil: 'domcontentloaded' })
  await page.goto(STATION, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: /Batterie/ }).first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(2000)

  const after = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
  check('Die erfassten Werte stehen da', /19,2\s*kWh/.test(after) && /9,6\s*kW/.test(after))
  check('Kein zweiter Platz für dieselben Werte', (await page.locator(CAPACITY).count()) === 0)
  check('Der Hinweis auf fehlende Kenndaten ist weg', !after.includes('nachtragen'))
  check('Der Löschweg steht weiterhin zur Verfügung', after.includes('Batterie-Angaben löschen'))

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
