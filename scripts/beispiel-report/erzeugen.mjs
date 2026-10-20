/**
 * Beispiel-Report (Leadgen 4a): rendert eine gespeicherte Render-Anfrage mit dem bestehenden
 * Report-Code neu, mit „Gastronomiebetrieb, Wien" statt des Kundennamens, und legt PDF, Seitenbilder
 * und Vorschaubilder unter apps/web/public/beispiel-report/ ab. Anleitung: README.md daneben.
 *
 *   PLAYWRIGHT_MODULE=<abs. Pfad zu playwright/index.js> \
 *     node scripts/beispiel-report/erzeugen.mjs <render-request.json> [--skip-build]
 *
 * Die Quelle bleibt ausserhalb des Repos. Kein Datenbankzugriff: ein lokaler Mock beantwortet den
 * einen RPC der Report-Seite mit der umbenannten Kopie.
 */
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = path.join(ROOT, 'apps/web/public/beispiel-report')
const DISPLAY_NAME = 'Gastronomiebetrieb, Wien'
// Datum des Originalreports — „Erstellt am" und der Tarifstand-Satz bleiben dadurch wie damals.
const PRINTED_AT = new Date('2026-10-08T09:30:00+02:00')
const PAGES = [1, 2, 6, 7, 8, 9, 11, 13, 14, 15, 17]
const MOCK_PORT = 54999
const NEXT_PORT = 3917
const REQUEST_ID = '00000000-0000-4000-8000-000000000004'

const [source, ...flags] = process.argv.slice(2)
if (!source) {
  console.error(
    'Aufruf: node scripts/beispiel-report/erzeugen.mjs <render-request.json> [--skip-build]',
  )
  process.exit(2)
}

const parsed = JSON.parse(fs.readFileSync(source, 'utf8'))
const row = Array.isArray(parsed) ? parsed[0] : parsed
const meta = { ...row.report_input_meta, customerLabel: DISPLAY_NAME }
delete meta.projectId
delete meta.meteringPointId
const body = JSON.stringify([
  { analysis_result: row.analysis_result, load_profile: row.load_profile, report_input_meta: meta },
])

const mock = http
  .createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    if (req.method === 'OPTIONS') return res.writeHead(204).end()
    if (req.url?.startsWith('/rest/v1/rpc/get_report_render_request')) {
      return res.writeHead(200, { 'Content-Type': 'application/json' }).end(body)
    }
    res.writeHead(404).end('[]')
  })
  .listen(MOCK_PORT, '127.0.0.1')

const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'beispiel-report-mock',
}
const website = path.join(ROOT, 'apps/website')
if (!flags.includes('--skip-build')) {
  execFileSync('pnpm', ['build'], { cwd: website, env, stdio: 'inherit' })
}
const server = spawn('npx', ['next', 'start', '-p', String(NEXT_PORT)], { cwd: website, env })

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'beispiel-report-'))
const pdf = path.join(work, 'report.pdf')
try {
  const pw = (await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')).default
  const browser = await pw.chromium.launch()
  const page = await (await browser.newContext({ acceptDownloads: true })).newPage()
  await page.clock.setFixedTime(PRINTED_AT)
  const url = `http://127.0.0.1:${NEXT_PORT}/report/${REQUEST_ID}`
  for (let i = 0; ; i++) {
    try {
      await page.goto(url)
      break
    } catch (error) {
      if (i > 30) throw error
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  const button = page.getByRole('button', { name: 'Report als PDF herunterladen' })
  await button.waitFor({ timeout: 60_000 })
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 300_000 }),
    button.click(),
  ])
  await download.saveAs(pdf)
  await browser.close()
} finally {
  server.kill()
  mock.close()
}

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
fs.copyFileSync(pdf, path.join(OUT, 'beispiel-profi-report.pdf'))
for (const n of PAGES) {
  const nn = String(n).padStart(2, '0')
  const png = path.join(work, `seite-${nn}`)
  // A4 bei 150 dpi = 1240 px Breite.
  execFileSync('pdftoppm', [
    '-f',
    `${n}`,
    '-l',
    `${n}`,
    '-r',
    '150',
    '-png',
    '-singlefile',
    pdf,
    png,
  ])
  execFileSync('cwebp', [
    '-quiet',
    '-q',
    '90',
    `${png}.png`,
    '-o',
    path.join(OUT, `seite-${nn}.webp`),
  ])
  execFileSync('cwebp', [
    '-quiet',
    '-q',
    '85',
    '-resize',
    '160',
    '0',
    `${png}.png`,
    '-o',
    path.join(OUT, `seite-${nn}-vorschau.webp`),
  ])
}
fs.rmSync(work, { recursive: true, force: true })

execFileSync('node', [path.join(ROOT, 'scripts/beispiel-report/pruefen.mjs'), '--quelle', source], {
  stdio: 'inherit',
})
