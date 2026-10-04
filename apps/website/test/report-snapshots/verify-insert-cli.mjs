/**
 * pnpm --filter website report:snapshots:verify-insert --base <git-ref> [--at 1] [--pages 1] [--strict]
 *
 * Vergleicht jeden PDF-Text-Snapshot des Arbeitsstands mit seinem Stand in <git-ref> nach
 * `verify-insert.mjs`. Exit-Code 1, sobald ein Fall nicht passt oder eine Datei auf einer Seite fehlt.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

import { verifyInsert } from './verify-insert.mjs'

const SNAPSHOTS = path.join(import.meta.dirname, '__snapshots__')

const { values } = parseArgs({
  // pnpm reicht ein „--" vor den Argumenten mitunter durch.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    base: { type: 'string' },
    at: { type: 'string', default: '1' },
    pages: { type: 'string', default: '1' },
    strict: { type: 'boolean', default: false },
  },
})
if (!values.base) {
  console.error(
    'Aufruf: report:snapshots:verify-insert --base <git-ref> [--at 1] [--pages 1] [--strict]',
  )
  process.exit(2)
}
const at = Number(values.at)
const pages = Number(values.pages)

const git = (...args) =>
  execFileSync('git', ['-C', SNAPSHOTS, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 })
const isPdfText = (name) => name.endsWith('.pdf.txt')

const baseFiles = git('ls-tree', '--name-only', values.base, './').split('\n').filter(isPdfText)
const workFiles = readdirSync(SNAPSHOTS).filter(isPdfText)

let failed = 0
for (const name of [...new Set([...baseFiles, ...workFiles])].sort()) {
  if (!baseFiles.includes(name) || !workFiles.includes(name)) {
    failed += 1
    console.log(
      `FAIL ${name}\n  nur ${baseFiles.includes(name) ? `in ${values.base}` : 'im Arbeitsstand'}`,
    )
    continue
  }
  const result = verifyInsert(
    git('show', `${values.base}:./${name}`),
    readFileSync(path.join(SNAPSHOTS, name), 'utf8'),
    { at, pages, strict: values.strict },
  )
  if (!result.ok) failed += 1
  console.log(`${result.ok ? 'OK  ' : 'FAIL'} ${name}`)
  for (const problem of result.problems) console.log(`  ${problem.replace(/\n/g, '\n  ')}`)
  if (result.spacingOnly.length > 0) {
    console.log(
      `  Info: ${result.spacingOnly.length} Zeile(n) nur im Leerraum verschoben (normalisiert gleich): ` +
        result.spacingOnly.slice(0, 10).join('; '),
    )
  }
  result.inserted.forEach((page, k) => {
    console.log(`  eingefügte Seite ${at + k + 1} (zur Information, nicht geprüft):`)
    console.log(page.replace(/\s+$/, '').replace(/^/gm, '    | '))
  })
}
console.log(failed === 0 ? '\nAlle Fälle OK.' : `\n${failed} Fall/Fälle FAIL.`)
process.exit(failed === 0 ? 0 : 1)
