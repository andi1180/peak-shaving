/**
 * Parser-Regression gegen die ECHTEN abgelegten Kundendateien — nur lokal ausführen.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=… \
 *     npx tsx scripts/parser-regression-real-files.ts /tmp/parser-regression/vorher.jsonl
 *   (nach der Änderung dasselbe mit …/nachher.jsonl, dann `diff` der beiden Dateien)
 *
 * Liest per service_role JEDE tabellarische Datei (CSV/XLS/XLSX, am Dateiinhalt erkannt) aus dem
 * Bucket `project-documents` — eine Obermenge der Lastgang-Dokumente, denn `platform.project_documents`
 * und `platform.metering_points` tragen für service_role keinen Grant. Je Datei eine Zeile mit
 * Kurzsignatur, benannt nur nach Dokument-ID. Ausgabe ausschliesslich unter /tmp: die Signaturen
 * beschreiben Kundendaten und gehören nicht ins Repo.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { PROJECT_DOCUMENTS_BUCKET } from '../packages/shared/src/project-documents'
import { parseLoadProfile } from '../packages/engine/src/parser/parse'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const outPath = resolve(process.argv[2] ?? '')
if (!url || !key) throw new Error('SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY setzen.')
if (!outPath.startsWith('/tmp/') && !outPath.startsWith('/private/tmp/'))
  throw new Error('Ausgabepfad muss unter /tmp liegen (Kundendaten).')

const headers = { apikey: key, Authorization: `Bearer ${key}` }

type StorageEntry = { name: string; id: string | null }

async function list(prefix: string): Promise<StorageEntry[]> {
  const out: StorageEntry[] = []
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${url}/storage/v1/object/list/${PROJECT_DOCUMENTS_BUCKET}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prefix,
        limit: 1000,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      }),
    })
    if (!res.ok) throw new Error(`list ${prefix}: ${res.status} ${await res.text()}`)
    const page = (await res.json()) as StorageEntry[]
    out.push(...page)
    if (page.length < 1000) return out
  }
}

async function download(path: string): Promise<Uint8Array> {
  const res = await fetch(`${url}/storage/v1/object/${PROJECT_DOCUMENTS_BUCKET}/${path}`, {
    headers,
  })
  if (!res.ok) throw new Error(`download ${path}: ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

/** Format am Inhalt: ZIP (xlsx) oder OLE (xls) → 'xlsx' wie in `run-from-draft.ts`; PDF/Bilder → null. */
function tabularFormat(b: Uint8Array): 'csv' | 'xlsx' | null {
  const hex = Buffer.from(b.subarray(0, 4)).toString('hex')
  if (hex === '504b0304' || hex === 'd0cf11e0') return 'xlsx'
  if (hex.startsWith('25504446') || hex.startsWith('89504e47') || hex.startsWith('ffd8'))
    return null
  return 'csv'
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

function signature(id: string, bytes: Uint8Array, format: 'csv' | 'xlsx') {
  const content = format === 'xlsx' ? bytes : new TextDecoder().decode(bytes)
  const r = parseLoadProfile({ content, format })
  if (!r.ok) {
    return {
      id,
      ok: false,
      kind: r.kind,
      code: r.kind === 'error' ? r.error.code : r.issues.map((i) => i.field).join(','),
      columns: r.kind === 'needs_mapping' ? r.detection.columns : null,
    }
  }
  const { readings } = r.profile
  const warnings = r.dataQuality.warnings
  const count = (re: RegExp) => Number(warnings.map((w) => re.exec(w)?.[1]).find(Boolean) ?? 0)
  let sumKwh = 0
  for (const x of readings) sumKwh += x.gridPowerKw * (r.profile.intervalMinutes / 60)
  return {
    id,
    ok: true,
    format: r.detection.format,
    adapterId: r.detection.adapterId,
    columns: r.detection.columns,
    unit: r.detection.unit,
    source: r.profile.source,
    decimal: r.detection.decimal,
    readings: readings.length,
    sumKwh: sumKwh.toFixed(6),
    minTs: readings[0]?.ts ?? null,
    maxTs: readings.at(-1)?.ts ?? null,
    skippedTimestampRows: count(/^(\d+) Zeile\(n\) ohne gültigen Zeitstempel/),
    skippedValueRows: count(/^(\d+) Zeile\(n\) ohne Messwert/),
    warningsSha256: sha(JSON.stringify(warnings)),
    readingsSha256: sha(JSON.stringify(readings)),
  }
}

async function main() {
  const lines: string[] = []
  for (const project of await list('')) {
    if (project.id !== null) continue // nur Projektordner
    for (const doc of await list(project.name)) {
      if (doc.id === null) continue
      const bytes = await download(`${project.name}/${doc.name}`)
      const format = tabularFormat(bytes)
      if (format === null) continue
      lines.push(JSON.stringify(signature(doc.name, bytes, format)))
    }
  }
  lines.sort()
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, lines.join('\n') + '\n')
  console.log(`${lines.length} tabellarische Dokumente → ${outPath}`)
}

void main()
