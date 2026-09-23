/**
 * Ein Auswahlfeld muss den Formular-Reset überleben — für ALLE Admin-Formulare, nicht nur den
 * Batteriekatalog.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ER MISST EINEN FEHLER, DEN WEDER TYPPRÜFUNG NOCH DB-GATE SEHEN KANN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * React setzt ein Formular zurück, sobald seine Action durchgelaufen ist. Ein `<input>` übersteht
 * das (React schreibt sein `defaultValue` bei jedem Rerender in den DOM nach), ein `<select>`
 * nicht — dort wirkt `defaultValue` nur beim Einhängen, und der Reset fällt auf den Stand des
 * SEITENAUFBAUS zurück. Behoben wird das seit 23.09.2026 im Primitiv (`AdminSelect`,
 * `useSelectValueOnFormReset`); dieser Lauf hält den Nachweis für die drei Bauarten offen, in
 * denen `AdminSelect` im Admin-Bereich vorkommt:
 *
 *   1. Lead bearbeiten     — `defaultValue` kommt aus der SERVERZEILE (nach `revalidatePath`).
 *                            ⚠ Der zweite Speichern-Klick wiegt hier am schwersten: `leer` heisst
 *                            in `admin_update_lead` LÖSCHEN. Der Anzeigefehler löscht also die
 *                            gerade gespeicherte Branche — nachgewiesen an der Datenbank.
 *   2. Kostenbaustein      — dieselbe Bauart mit einem Feld OHNE Leer-Option: das Feld fällt nicht
 *                            auf „nichts" zurück, sondern auf den FALSCHEN Wert („fundament").
 *   3. Lieferanten-Tarif   — Anlegen statt Bearbeiten: `defaultValue` kommt aus `state.values`,
 *                            also aus der ABGELEHNTEN Eingabe. Fällt die Auswahl zurück, tippt
 *                            jemand den Beleg nach und legt einen Tarif mit falscher Kundengruppe
 *                            an — oder wird ein zweites Mal abgewiesen.
 *
 * Ausführen: s. `apps/web/e2e/README.md` (Playwright ist absichtlich keine Repo-Abhängigkeit).
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

const LEAD = '44444444-4444-4444-8444-444444444444'
const COMPONENT = '55555555-5555-4555-8555-555555555555'

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
const reseed = () => psql(readFileSync(path.join(here, 'admin-select-form-reset.seed.sql'), 'utf8'))

const leadRow = () =>
  psql(`select coalesce(industry::text, 'NULL') || '|' || extract(epoch from updated_at)
          from platform.leads where id = '${LEAD}'`)
const componentRow = () =>
  psql(`select art || '|' || extract(epoch from updated_at)
          from public.battery_cost_components where id = '${COMPONENT}'`)

/**
 * Wählt, bis die Auswahl auch nach der Hydration stehenbleibt. Ein Klick VOR ihr setzt nur den
 * DOM-Wert, den React beim Übernehmen des Formulars zurücksetzt — das sähe wie der Fehler aus,
 * den dieser Lauf sucht.
 */
async function pickUntil(page, selector, value) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.selectOption(selector, value).catch(() => {})
    await page.waitForTimeout(800)
    if ((await page.locator(selector).inputValue()) === value) return true
  }
  return false
}

/** Klickt den Speichern-Knopf, bis die Datenbank die Zeile angefasst hat. */
async function saveUntilWritten(page, label, read) {
  const before = read().split('|')[1]
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const button = page.getByRole('button', { name: label, exact: true })
    if (await button.count()) await button.first().click().catch(() => {})
    await page.waitForTimeout(1500)
    if (read().split('|')[1] !== before) return true
  }
  return false
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

  // ── 1. Lead bearbeiten: die Branche ───────────────────────────────────────
  console.log('Formular 1 — Lead bearbeiten, Branche „Bäckerei"')
  await page.goto(`${BASE}/admin/leads/${LEAD}`, { waitUntil: 'domcontentloaded' })
  const industry = 'select[name="industry"]'
  await page.locator(industry).waitFor({ timeout: 15000 })
  check('Ausgangslage: die Branche ist leer', (await page.locator(industry).inputValue()) === '')

  if (!(await pickUntil(page, industry, 'baeckerei'))) {
    throw new Error('Die Branche liess sich nicht auswählen')
  }
  if (!(await saveUntilWritten(page, 'Änderungen speichern', leadRow))) {
    throw new Error('Das Speichern hat nichts geschrieben')
  }
  check('Die Datenbank trägt die Branche', leadRow().split('|')[0] === 'baeckerei', leadRow())
  check(
    'Das Feld zeigt nach dem Speichern weiterhin „Bäckerei"',
    (await page.locator(industry).inputValue()) === 'baeckerei',
    `Feld steht auf „${await page.locator(industry).inputValue()}"`,
  )

  console.log('  … ein zweites Speichern ohne Änderung')
  if (!(await saveUntilWritten(page, 'Änderungen speichern', leadRow))) {
    throw new Error('Das zweite Speichern hat nichts geschrieben')
  }
  check(
    'Das zweite Speichern löscht die Branche NICHT',
    leadRow().split('|')[0] === 'baeckerei',
    leadRow(),
  )

  // ── 2. Kostenbaustein: die Art ────────────────────────────────────────────
  console.log('Formular 2 — Kostenbaustein bearbeiten, Art „Installation"')
  await page.goto(`${BASE}/admin/kostenbausteine/${COMPONENT}`, { waitUntil: 'domcontentloaded' })
  const art = 'select[name="art"]'
  await page.locator(art).waitFor({ timeout: 15000 })
  check('Ausgangslage: die Art ist „fundament"', (await page.locator(art).inputValue()) === 'fundament')

  if (!(await pickUntil(page, art, 'installation'))) {
    throw new Error('Die Art liess sich nicht auswählen')
  }
  if (!(await saveUntilWritten(page, 'Speichern', componentRow))) {
    throw new Error('Das Speichern hat nichts geschrieben')
  }
  check('Die Datenbank trägt die Art', componentRow().split('|')[0] === 'installation', componentRow())
  check(
    'Das Feld zeigt nach dem Speichern weiterhin „Installation"',
    (await page.locator(art).inputValue()) === 'installation',
    `Feld steht auf „${await page.locator(art).inputValue()}"`,
  )

  console.log('  … ein zweites Speichern ohne Änderung')
  if (!(await saveUntilWritten(page, 'Speichern', componentRow))) {
    throw new Error('Das zweite Speichern hat nichts geschrieben')
  }
  check(
    'Das zweite Speichern setzt die Art NICHT auf „fundament" zurück',
    componentRow().split('|')[0] === 'installation',
    componentRow(),
  )

  // ── 3. Lieferanten-Tarif anlegen: nach einer abgelehnten Eingabe ──────────
  console.log('Formular 3 — Lieferanten-Tarif anlegen, Eingabe wird abgewiesen')
  await page.goto(`${BASE}/admin/lieferanten-tarife`, { waitUntil: 'domcontentloaded' })
  const segment = 'select[name="segment"]'
  const basis = 'select[name="priceBasis"]'
  await page.locator(segment).waitFor({ timeout: 15000 })
  check('Ausgangslage: Kundengruppe und Preisbasis sind unbesetzt',
    (await page.locator(segment).inputValue()) === '' &&
      (await page.locator(basis).inputValue()) === '')

  if (!(await pickUntil(page, segment, 'betrieb'))) throw new Error('Kundengruppe nicht wählbar')
  if (!(await pickUntil(page, basis, 'net'))) throw new Error('Preisbasis nicht wählbar')
  // Der Quellenbeleg bleibt LEER — genau daran wird die Eingabe abgewiesen.
  await page.fill('input[name="energyPriceCtPerKwh"]', '12,34')
  await page.fill('input[name="baseFeeEurPerMonth"]', '3,50')
  await page.fill('input[name="validFrom"]', '2026-01-01')
  await page.getByRole('button', { name: 'Tarifstand anlegen', exact: true }).click()
  await page.waitForTimeout(2500)

  check(
    'Die Eingabe wurde abgewiesen',
    (await page.locator('[role="alert"]').count()) > 0 ||
      (await page.locator('input[name="sourceUrl"][aria-invalid="true"]').count()) > 0,
  )
  check(
    'Die Kundengruppe steht nach der Ablehnung weiterhin auf „Betrieb"',
    (await page.locator(segment).inputValue()) === 'betrieb',
    `Feld steht auf „${await page.locator(segment).inputValue()}"`,
  )
  check(
    'Die Preisbasis steht nach der Ablehnung weiterhin auf „netto"',
    (await page.locator(basis).inputValue()) === 'net',
    `Feld steht auf „${await page.locator(basis).inputValue()}"`,
  )

  check('keine Konsolenfehler', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
} catch (err) {
  console.log('ABBRUCH:', err.message.split('\n').slice(0, 5).join(' | '))
  failures.push('Lauf abgebrochen')
} finally {
  await browser.close()
  // Die Testzeilen dürfen nicht zurückbleiben — `packages/db-tests` pinnt absolute Admin-Zahlen.
  psql(`delete from platform.leads where id = '${LEAD}';
        delete from public.battery_cost_components where id = '${COMPONENT}';
        delete from public.retail_tariffs where provider_id = 'e2e-select';`)
}

console.log('')
console.log(failures.length === 0 ? 'ERGEBNIS: GRÜN' : `ERGEBNIS: ROT (${failures.length} Fehlschläge)`)
process.exit(failures.length === 0 ? 0 : 1)
