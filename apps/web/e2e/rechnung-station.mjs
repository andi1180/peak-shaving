/**
 * Der erste Lauf über die ECHTE Oberfläche einer Zählpunkt-Station (B24, Teil 1).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ER MISST EINE EIGENSCHAFT, DIE KEIN UNIT-TEST DIESES REPOS SEHEN KANN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Die Behauptung lautet: „was die Handeingabe speichert, steht bei der Rückkehr wieder da." Sie
 * hängt an vier Dingen zugleich — die Action schreibt, `revalidatePath` erneuert die Seite, die
 * Server-Komponente reicht den Entwurf herein, und die Client-Komponente setzt ihre Zustände
 * daraus. Jedes einzelne Glied ist für sich richtig zu haben, während die Kette bricht; genau so
 * war es (der Schreibweg war vollständig, der Leseweg fehlte ganz). `apps/web` hat bewusst kein
 * Renderer-Setup (`vitest.config.ts`) — die Aussage ist ausschliesslich im Browser prüfbar.
 *
 * ⚠ DESHALB LIEGT DIE DATEI HIER UND NICHT IM SCRATCHPAD: der Fahrplan führt für Rechnung-,
 * Batterie- und PV-Station „KEINEN Lauf über die echte Oberfläche" als offene Lücke. Ein einmal
 * gefahrener Lauf schliesst sie nicht, ein wiederholbarer schon.
 *
 * ── AUSFÜHREN ────────────────────────────────────────────────────────────────────────────────
 * Playwright ist ABSICHTLICH keine Repo-Abhängigkeit (`apps/web/e2e/README.md` erklärt, warum,
 * und wie man es in einem Wegwerf-Ordner installiert). Der Lauf braucht den lokalen Supabase-Stack
 * und einen laufenden Next-Server:
 *
 *   node apps/web/e2e/rechnung-station.mjs
 *
 * Umgebungsvariablen (alle mit Vorgabewert): BASE · PROJECT_ID · ADMIN_EMAIL · ADMIN_PASSWORD ·
 * DB_CONTAINER. Die Ausgangslage stellt der Lauf SELBST her (`rechnung-station.seed.sql`) — sonst
 * misst der zweite Lauf etwas anderes als der erste.
 *
 * ── DIE FÜNF SCHRITTE ────────────────────────────────────────────────────────────────────────
 * Sie sind der von Andreas berichtete Weg, in genau dieser Reihenfolge, und nicht zu kürzen:
 * ohne das Entfernen (2) stünde die Zusammenfassung der gelesenen Rechnung über dem Formular und
 * verdeckte, dass die Station den Stand sonst nirgends zeigt.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * ⚠ Playwright wird NICHT statisch importiert. Node löst Importe relativ zur SKRIPTDATEI auf,
 * nicht zum Arbeitsverzeichnis — ein `import 'playwright'` scheiterte hier also immer, egal aus
 * welchem Ordner der Lauf gestartet wird (das Paket liegt bewusst ausserhalb des Repos, s.
 * README). `PLAYWRIGHT_MODULE` nimmt deshalb den absoluten Pfad des Wegwerf-Ordners entgegen.
 */
const pw = (await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')).default

const BASE = process.env.BASE ?? 'http://127.0.0.1:3977'
const PROJECT = process.env.PROJECT_ID ?? '11111111-1111-4111-8111-111111111111'
const EMAIL = process.env.ADMIN_EMAIL ?? 'e2e-rechnung@example.test'
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'Test-1234-abcd'
const DB_CONTAINER = process.env.DB_CONTAINER ?? 'supabase_db_peak-shaving'
const STATION = `${BASE}/admin/kalkulator-projekte/${PROJECT}/dateneingabe?station=zp1-rechnung`
const OTHER = `${BASE}/admin/kalkulator-projekte/${PROJECT}/dateneingabe?station=zp1-batterie`

/** Die Werte, die Schritt 3 eintippt — inkl. Mindestleistung und Einspeisevergütung. */
const MANUAL = {
  'manual-leistungspreis': '82,92',
  'manual-min-billable': '35',
  'manual-energy-price': '13,081',
  'manual-energy-price-night': '9,5',
  'manual-feed-in': '4,56',
  'manual-base-fee': '3,5',
  'manual-annual-kwh': '48000',
}

const failures = []
function check(name, ok, detail) {
  if (ok) console.log(`  ok   ${name}`)
  else {
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
    failures.push(name)
  }
}

async function setSelect(page, id, value) {
  await page.selectOption(`#${id}`, value)
}

/**
 * Den Umschalter „Werte selbst eintragen" betätigen, bis der Block wirklich steht.
 * Ein Klick kann vor der Hydration landen — dann passiert nichts, und das sähe wie der Fehler aus,
 * den dieser Lauf misst.
 */
async function openManualPanel(page) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await page.locator('#manual-operator').isVisible().catch(() => false)) return true
    const toggle = page.getByRole('button', { name: /Werte selbst eintragen/ })
    if ((await toggle.count()) === 0) return false
    await toggle.first().click()
    await page.waitForTimeout(1000)
  }
  return await page.locator('#manual-operator').isVisible().catch(() => false)
}

/*
 * Ausgangslage jedes Laufs herstellen: an Zählpunkt 1 hängt GENAU EINE gelesene Rechnung.
 *
 * ⚠ Nicht optional. Schritt 2 nimmt sie zurück und Schritt 3 schreibt den Entwurf um — ein
 * zweiter Lauf fände sonst eine Station vor, die bereits durch den ersten verändert wurde, und
 * grüne wie rote Ergebnisse wären gleichermassen bedeutungslos.
 */
const seedSql = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'rechnung-station.seed.sql'),
  'utf8',
)
execFileSync(
  'docker',
  ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
  { input: seedSql, stdio: ['pipe', 'ignore', 'inherit'] },
)

const browser = await pw.chromium.launch({ headless: true })
const page = await browser.newPage()
const consoleErrors = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})

try {
  // ── Anmelden ──────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/admin/anmelden`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[name="email"]', EMAIL)
  await page.fill('input[name="password"]', PASSWORD)
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await page.waitForURL((u) => !u.pathname.includes('anmelden'), { timeout: 20000 })

  // ── 1. Zählpunkt 1, Rechnung-Station öffnen ───────────────────────────────
  console.log('Schritt 1 — Rechnung-Station öffnen')
  await page.goto(STATION, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: /Rechnung/ }).first().waitFor({ timeout: 15000 })

  // ── 2. Vorhandene Rechnung entfernen ──────────────────────────────────────
  console.log('Schritt 2 — vorhandene Rechnung entfernen')
  const removeButtons = page.getByRole('button', { name: /^Entfernen/ })
  let removed = 0
  while ((await removeButtons.count()) > 0) {
    page.once('dialog', (d) => d.accept())
    await removeButtons.first().click()
    await page.waitForTimeout(1500)
    removed += 1
    if (removed > 5) break
  }
  console.log(`  ${removed} gelesene Rechnung(en) zurückgenommen`)

  // ── 3. Manuelle Eingabe: alle Felder ausfüllen und übernehmen ─────────────
  console.log('Schritt 3 — „Keine Rechnung vorhanden — Werte selbst eintragen"')
  if (!(await openManualPanel(page))) throw new Error('Manuelle Eingabe liess sich nicht öffnen')

  await setSelect(page, 'manual-operator', 'wiener_netze')
  await setSelect(page, 'manual-netzebene', '7')
  await page.locator('#manual-metering-variant').waitFor({ timeout: 5000 })
  await setSelect(page, 'manual-metering-variant', 'mit_leistungsmessung')
  /*
   * ⚠ BEWUSST EIN ANDERER WERT ALS DER VORGABEWERT (`monthly_max_sum`). Mit dem Vorgabewert
   * gewählt wäre der Lauf blind: das Feld stünde nach der Rückkehr auch dann richtig da, wenn
   * gar nichts gespeichert wurde.
   */
  await setSelect(page, 'manual-billing-model', 'annual_max')
  for (const [id, value] of Object.entries(MANUAL)) await page.fill(`#${id}`, value)

  await page.getByRole('button', { name: 'Werte übernehmen' }).click()
  const saved = page.getByText(/Angaben? wurden? übernommen|Angabe wurde übernommen/)
  await saved.first().waitFor({ timeout: 20000 })
  console.log('  gespeichert:', (await saved.first().textContent())?.slice(0, 60), '…')

  // ── 4. „Weiter" klicken, zu einer anderen Station navigieren ──────────────
  console.log('Schritt 4 — Weiter zu einer anderen Station')
  await page.getByRole('link', { name: 'Weiter' }).click()
  await page.waitForURL(/station=zp1-batterie/, { timeout: 15000 })

  // ── 5. Zurück zur Rechnung-Station ────────────────────────────────────────
  console.log('Schritt 5 — zurück zur Rechnung-Station')
  await page.goto(OTHER, { waitUntil: 'domcontentloaded' })
  await page.goto(STATION, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: /Rechnung/ }).first().waitFor({ timeout: 15000 })

  // ── Erwartung: die eingetragenen Werte sind sichtbar / vorbefüllt ─────────
  console.log('Erwartung — die eingetragenen Werte stehen wieder da')
  const manualPanelOpen = await page.locator('#manual-operator').isVisible().catch(() => false)
  check('Die manuelle Eingabe ist bei der Rückkehr sichtbar', manualPanelOpen)

  if (!manualPanelOpen && !(await openManualPanel(page))) {
    throw new Error('Manuelle Eingabe liess sich nach der Rückkehr nicht öffnen')
  }

  check(
    'Netzbetreiber vorbefüllt',
    (await page.inputValue('#manual-operator')) === 'wiener_netze',
    `ist "${await page.inputValue('#manual-operator')}"`,
  )
  check(
    'Netzebene vorbefüllt',
    (await page.inputValue('#manual-netzebene')) === '7',
    `ist "${await page.inputValue('#manual-netzebene')}"`,
  )
  check(
    'Messvariante vorbefüllt',
    (await page.inputValue('#manual-metering-variant')) === 'mit_leistungsmessung',
    `ist "${await page.inputValue('#manual-metering-variant')}"`,
  )
  check(
    'Abrechnungsmodell vorbefüllt',
    (await page.inputValue('#manual-billing-model')) === 'annual_max',
    `ist "${await page.inputValue('#manual-billing-model')}"`,
  )
  /*
   * ⚠ DIE ZWEITE HÄLFTE DERSELBEN AUSSAGE. Das Auswahlfeld zeigt IMMER einen Wert — es hat keinen
   * leeren Zustand. Ohne diese Prüfung wäre „vorbefüllt" allein noch kein Beleg dafür, dass ein
   * Mensch den Wert übernommen hat; erst der Satz daneben unterscheidet „bestätigt" vom blossen
   * Vorschlag, und genau das ist der Zustand, den diese Station sichtbar machen soll.
   */
  const confirmation = await page.getByTestId('billing-model-confirmation').textContent()
  check(
    'Abrechnungsmodell als bestätigt ausgewiesen',
    (confirmation ?? '').includes('Übernommen'),
    `steht "${(confirmation ?? '').slice(0, 60)}…"`,
  )

  for (const [id, expected] of Object.entries(MANUAL)) {
    const actual = await page.inputValue(`#${id}`)
    check(`${id} vorbefüllt (${expected})`, actual === expected, `ist "${actual}"`)
  }

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
