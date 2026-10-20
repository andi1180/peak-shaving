/**
 * Anonymisierungsprüfung des Beispiel-Reports: PDF-Text (pdftotext) und Metadaten (pdfinfo) dürfen
 * keine Kundenangaben tragen; „Gastronomiebetrieb, Wien" muss vorkommen. Gibt je Kategorie nur die
 * Trefferzahl aus, nie den Wert. Exit 1 bei einem Treffer.
 *
 *   node scripts/beispiel-report/pruefen.mjs [--quelle <render-request.json>] [--pdf <datei>]
 *
 * Mit --quelle kommt der Kundenname zusätzlich aus der Render-Anfrage selbst.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const pdf =
  arg('--pdf') ?? path.join(ROOT, 'apps/web/public/beispiel-report/beispiel-profi-report.pdf')
const DISPLAY_NAME = 'Gastronomiebetrieb, Wien'

// Ohne Akzente und Gross-/Kleinschreibung, damit „MULDUR" oder „Müldür" gleich gefunden werden.
const fold = (s) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()

const text = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' })
const info = execFileSync('pdfinfo', ['-meta', pdf], { encoding: 'utf8' })
const fields = execFileSync('pdfinfo', [pdf], { encoding: 'utf8' })
  .split('\n')
  .filter((line) => /^(Title|Author|Subject|Keywords|Creator|Producer):/.test(line))
  .join('\n')
const corpus = `${text}\n${fields}\n${info}`
const folded = fold(corpus)

const names = ['Müldür', 'Muldur', 'Mueldur', 'Müldür KG']
const source = arg('--quelle')
if (source) {
  const parsed = JSON.parse(fs.readFileSync(source, 'utf8'))
  const label = (Array.isArray(parsed) ? parsed[0] : parsed).report_input_meta?.customerLabel
  if (typeof label === 'string' && label.trim() !== '') names.push(label)
}

const count = (re, s) => (s.match(re) ?? []).length
const checks = [
  [
    'Kundenname (Varianten + Name aus der Render-Anfrage)',
    names.reduce((n, v) => n + folded.split(fold(v)).length - 1, 0),
  ],
  // Österreichische Zählpunktnummer: „AT" + 31 Stellen, auch mit Leerzeichen gesetzt.
  ['Zählpunktnummer (AT + 31 Stellen)', count(/AT\d{6}[0-9A-Z]{25}/g, corpus.replace(/\s+/g, ''))],
  [
    'E-Mail-Adresse ausser @coolin.at',
    count(/[\w.+-]+@(?!coolin\.at\b)[\w-]+(\.[\w-]+)+/gi, corpus),
  ],
  [
    'Strassenadresse ausser COOLiN (Karl-Popper-Straße 22)',
    count(/[\p{L}-]+(straße|strasse|gasse|platz|weg|allee|ring|zeile|kai)\s+\d+/giu, corpus) -
      count(/Karl-Popper-Straße\s+22/g, corpus),
  ],
  ['Wiener Postleitzahl ausser 1100 (COOLiN)', count(/\b1(?!100\b)[0-2]\d0\s+Wien\b/g, corpus)],
]

let failed = false
for (const [label, hits] of checks) {
  console.log(`${hits === 0 ? 'ok  ' : 'FEHL'} ${label}: ${hits} Treffer`)
  if (hits !== 0) failed = true
}
const positive = text.split(DISPLAY_NAME).length - 1
console.log(
  `${positive > 0 ? 'ok  ' : 'FEHL'} Positivkontrolle „${DISPLAY_NAME}": ${positive} Vorkommen`,
)
if (positive === 0) failed = true
process.exit(failed ? 1 : 0)
