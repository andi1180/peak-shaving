/**
 * Netztarif-Zeile bearbeiten: Einheit + Betrag ändern, speichern, ein ZWEITES Mal ohne Änderung
 * speichern, neu laden. Der zweite Klick misst den AdminSelect-Reset (s. `admin-select-form-reset.mjs`):
 * fiele die Messpreis-Einheit nach dem ersten Speichern auf „kein Messpreis" zurück, schickte der
 * zweite Klick einen Betrag ohne Einheit.
 *
 * Ausführen: s. `apps/web/e2e/README.md`.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pw = (await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')).default

const BASE = process.env.BASE ?? 'http://127.0.0.1:3977'
const EMAIL = process.env.ADMIN_EMAIL ?? 'e2e-rechnung@example.test'
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'Test-1234-abcd'
const DB_CONTAINER = process.env.DB_CONTAINER ?? 'supabase_db_peak-shaving'

const TARIFF = '44444444-4444-4444-8444-444444444444'
const PAGE = `${BASE}/admin/netzbetreiber-tarife`
const ROW = `li[data-tariff-id="${TARIFF}"]`
const FORM = `${ROW} [data-testid="grid-tariff-edit"]`
const UNIT = `${FORM} select[name="messpreisUnit"]`

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
    [
      'exec',
      '-i',
      DB_CONTAINER,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-t',
      '-A',
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      '-',
    ],
    { input: sql, encoding: 'utf8' },
  ).trim()
}
const row = () =>
  psql(
    `select coalesce(messpreis_amount::text, 'NULL') || '|' || coalesce(messpreis_unit, 'NULL')
       || '|' || netzverlust_ct_per_kwh
       || '|' || (select count(*) from platform.grid_tariff_changes where tariff_id = '${TARIFF}')
       from public.grid_tariffs where id = '${TARIFF}'`,
  )

/** Öffnet „Bearbeiten", bis das Formular nach der Hydration dasteht. */
async function openEdit(page) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await page.locator(UNIT).count()) return
    await page
      .locator(ROW)
      .getByRole('button', { name: 'Bearbeiten', exact: true })
      .click()
      .catch(() => {})
    await page.waitForTimeout(1000)
  }
  throw new Error('Das Bearbeiten-Formular ging nicht auf')
}

async function pickUntil(page, selector, value) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.selectOption(selector, value).catch(() => {})
    await page.waitForTimeout(500)
    if ((await page.locator(selector).inputValue()) === value) return true
  }
  return false
}

async function save(page, reason, expectText) {
  await page.fill(`${FORM} input[name="reason"]`, reason)
  await page.locator(FORM).getByRole('button', { name: 'Änderung speichern' }).click()
  await page.locator(FORM).getByText(expectText).waitFor({ timeout: 15000 })
  await page.waitForTimeout(1000)
}

psql(readFileSync(path.join(here, 'grid-tariff-edit.seed.sql'), 'utf8'))

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

  console.log('Schritt 1 — Messpreis (Betrag + Einheit) und Netzverlust ändern, speichern')
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' })
  await openEdit(page)
  check('Ausgangslage: keine Messpreis-Einheit', (await page.locator(UNIT).inputValue()) === '')
  check(
    'Notiz ist vorbelegt',
    (await page.locator(`${FORM} input[name="w0_note"]`).inputValue()) === 'Preisblatt S. 2',
  )
  await page.fill(`${FORM} input[name="messpreisAmount"]`, '2.4')
  if (!(await pickUntil(page, UNIT, 'eur_per_month'))) throw new Error('Einheit nicht auswählbar')
  await page.fill(`${FORM} input[name="netzverlustCtPerKwh"]`, '0.43')
  await save(page, 'E2E Korrektur Netzverlust', 'Änderung gespeichert und protokolliert.')
  check(
    'Datenbank trägt die neuen Werte + 1 Protokolleintrag',
    row() === '2.4|eur_per_month|0.43|1',
    row(),
  )
  check(
    'Einheit steht nach dem Speichern',
    (await page.locator(UNIT).inputValue()) === 'eur_per_month',
  )

  console.log('Schritt 2 — zweites Speichern ohne Änderung')
  await save(page, 'E2E zweites Speichern', 'Keine Änderung gegenüber dem gespeicherten Stand')
  check(
    'Werte unverändert, kein zweiter Protokolleintrag',
    row() === '2.4|eur_per_month|0.43|1',
    row(),
  )

  console.log('Schritt 3 — neu laden')
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' })
  const log = page.locator(`${ROW} [data-testid="grid-tariff-changes"]`)
  await log.waitFor({ timeout: 15000 })
  const text = await log.innerText()
  check('Protokolleintrag sichtbar (Grund)', text.includes('E2E Korrektur Netzverlust'), text)
  check('Geänderte Felder alt → neu', text.includes('Netzverlust: 0.3 ct/kWh → 0.43 ct/kWh'), text)
  await openEdit(page)
  check(
    'Einheit nach Neuladen erhalten',
    (await page.locator(UNIT).inputValue()) === 'eur_per_month',
  )
  check(
    'Betrag nach Neuladen erhalten',
    (await page.locator(`${FORM} input[name="messpreisAmount"]`).inputValue()) === '2.4',
  )

  check('keine Konsolenfehler', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
} catch (err) {
  console.log('ABBRUCH:', err.message.split('\n').slice(0, 5).join(' | '))
  failures.push('Lauf abgebrochen')
} finally {
  await browser.close()
  psql(`delete from platform.grid_tariff_changes where tariff_id = '${TARIFF}';
        delete from public.grid_tariffs where id = '${TARIFF}';`)
}

console.log('')
console.log(
  failures.length === 0 ? 'ERGEBNIS: GRÜN' : `ERGEBNIS: ROT (${failures.length} Fehlschläge)`,
)
process.exit(failures.length === 0 ? 0 : 1)
