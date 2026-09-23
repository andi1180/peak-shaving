/**
 * Die Wirkungsgrad-Quelle muss das Speichern überleben — der dritte Lauf über die echte
 * Oberfläche.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ER MISST EINEN FEHLER, DEN WEDER TYPPRÜFUNG NOCH DB-GATE SEHEN KANN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Kenndaten und Quelle „Datenblatt" eintragen, speichern — die Datenbank trug die Quelle, das Feld
 * zeigte danach wieder „— nicht angegeben —". Ursache ist der Formular-Reset, den React nach jeder
 * abgeschlossenen Action auslöst: ein `<input>` übersteht ihn (React schreibt sein `defaultValue`
 * bei jedem Rerender in den DOM nach), ein `<select>` nicht — dort wirkt `defaultValue` nur beim
 * Einhängen, und der Reset fällt auf den Stand des SEITENAUFBAUS zurück.
 *
 * ⚠ DER ZWEITE SPEICHERN-KLICK IST DER TEIL, DER WEHTUT, UND ER WIEGT AM SCHWERSTEN: Das
 * zurückgefallene Feld schickt beim nächsten Speichern seinen leeren Wert mit, und `leer heisst
 * löschen` (so ist `admin_update_battery` gebaut). Der Anzeigefehler löscht also die gerade
 * gespeicherte Angabe — nachgewiesen wird das an der Datenbank, nicht am Bildschirm.
 *
 * Gegenprobe im selben Lauf: `admin_get_battery` liefert weiterhin die Hülle {status, battery}
 * (K1b-Korrektur 20260922210000 — der Leseweg darf bei der Gelegenheit nicht brechen).
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

const BATTERY = '33333333-3333-4333-8333-333333333333'
const EDIT = `${BASE}/admin/batteriespeicher/${BATTERY}`
const SOURCE = 'select[name="rteSource"]'
const SAVE = 'Änderungen speichern'

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
const reseed = () =>
  psql(readFileSync(path.join(here, 'battery-catalog-rte-source.seed.sql'), 'utf8'))
const row = () =>
  psql(
    `select coalesce(rte_source, 'NULL') || '|' || coalesce(round_trip_efficiency::text, 'NULL')
       || '|' || extract(epoch from updated_at)
       from public.battery_catalog where id = '${BATTERY}'`,
  )

/** Der Leseweg, rollentreu wie die Anwendung ihn geht — in einer zurückgerollten Transaktion. */
const readAsAdmin = () =>
  psql(`begin;
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from auth.users where email = '${EMAIL}'),
                    'role', 'authenticated')::text, true);
set local role authenticated;
select (public.admin_get_battery('${BATTERY}')->>'status')
       || '|' || coalesce(public.admin_get_battery('${BATTERY}')->'battery'->>'rte_source', 'NULL');
rollback;`)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes('|'))
    .pop()

/**
 * Wählt, bis die Auswahl auch nach der Hydration stehenbleibt. Ein Klick VOR ihr setzt nur den
 * DOM-Wert, den React beim Übernehmen des Formulars zurücksetzt — das sähe wie der Fehler aus,
 * den dieser Lauf sucht.
 */
async function pickUntil(page, selector, value) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.selectOption(selector, value).catch(() => {})
    await page.waitForTimeout(1000)
    if ((await page.locator(selector).inputValue()) === value) return true
  }
  return false
}

/** Klickt „Änderungen speichern", bis die Datenbank die Zeile angefasst hat. */
async function saveUntilWritten(page) {
  const before = row().split('|')[2]
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const button = page.getByRole('button', { name: SAVE, exact: true })
    if (await button.count()) await button.first().click().catch(() => {})
    await page.waitForTimeout(1500)
    if (row().split('|')[2] !== before) return true
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

  // ── 1. Kenndaten und Quelle eintragen ─────────────────────────────────────
  console.log('Schritt 1 — Kenndaten und Quelle „Datenblatt" eintragen')
  await page.goto(EDIT, { waitUntil: 'domcontentloaded' })
  await page.locator(SOURCE).waitFor({ timeout: 15000 })
  check('Ausgangslage: die Quelle ist leer', (await page.locator(SOURCE).inputValue()) === '')

  await page.fill('input[name="usableCapacityKwh"]', '60')
  await page.fill('input[name="maxPowerKw"]', '30')
  await page.fill('input[name="roundTripEfficiency"]', '0,9')
  if (!(await pickUntil(page, SOURCE, 'datenblatt'))) {
    throw new Error('Die Quelle liess sich nicht auswählen')
  }
  if (!(await saveUntilWritten(page))) throw new Error('Das Speichern hat nichts geschrieben')

  // ── 2. Was die Datenbank trägt, und was das Feld zeigt ────────────────────
  console.log('Schritt 2 — die Quelle muss das Speichern überleben')
  const [savedSource, savedRte] = row().split('|')
  check('Die Datenbank trägt die Quelle', savedSource === 'datenblatt', row())
  check('Die Datenbank trägt den Wirkungsgrad', savedRte === '0.9', row())
  check(
    'Das Feld zeigt nach dem Speichern weiterhin „Datenblatt"',
    (await page.locator(SOURCE).inputValue()) === 'datenblatt',
    `Feld steht auf „${await page.locator(SOURCE).inputValue()}"`,
  )

  // ── 3. Der zweite Klick darf die Angabe nicht löschen ─────────────────────
  console.log('Schritt 3 — ein zweites Speichern ohne Änderung')
  if (!(await saveUntilWritten(page))) throw new Error('Das zweite Speichern hat nichts geschrieben')
  check(
    'Das zweite Speichern löscht die Quelle NICHT',
    row().split('|')[0] === 'datenblatt',
    row(),
  )

  // ── 4. Nach dem Neuladen ──────────────────────────────────────────────────
  console.log('Schritt 4 — Seite neu laden')
  await page.goto(EDIT, { waitUntil: 'domcontentloaded' })
  await page.locator(SOURCE).waitFor({ timeout: 15000 })
  await page.waitForTimeout(1500)
  check(
    'Nach dem Neuladen steht „Datenblatt" im Feld',
    (await page.locator(SOURCE).inputValue()) === 'datenblatt',
  )

  // ── Gegenprobe: der Leseweg ist unverändert ───────────────────────────────
  console.log('Gegenprobe — admin_get_battery liefert weiterhin {status, battery}')
  const read = readAsAdmin()
  check('Hülle und Wert stehen im Rückgabewert', read === 'ok|datenblatt', read)

  check('keine Konsolenfehler', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
} catch (err) {
  console.log('ABBRUCH:', err.message.split('\n').slice(0, 5).join(' | '))
  failures.push('Lauf abgebrochen')
} finally {
  await browser.close()
  // Das Testgerät darf nicht im Katalog zurückbleiben.
  psql(`delete from public.battery_catalog where id = '${BATTERY}'`)
}

console.log('')
console.log(failures.length === 0 ? 'ERGEBNIS: GRÜN' : `ERGEBNIS: ROT (${failures.length} Fehlschläge)`)
process.exit(failures.length === 0 ? 0 : 1)
