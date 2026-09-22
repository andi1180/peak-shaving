#!/usr/bin/env node
// K2a: erzeugt aus der kuratierten memodo-Liste eine Seed-Migration für public.battery_catalog.
// Alle Zeilen entstehen als INAKTIVE Entwürfe ohne Kenndaten — die Recherche ist K2b.
//
// Aufruf: node scripts/battery-catalog/csv-to-sql.mjs
//   liest  data/batteriekatalog/batteriekatalog_kuratiert.csv
//   schreibt supabase/migrations/20260922160000_seed_battery_catalog.sql

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CSV = join(root, 'data', 'batteriekatalog', 'batteriekatalog_kuratiert.csv')
const OUT = join(root, 'supabase', 'migrations', '20260922160000_seed_battery_catalog.sql')

const SOURCE_URL = {
  heim: 'https://www.memodo.at/photovoltaik/heimspeicher/',
  gewerbe: 'https://www.memodo.at/photovoltaik/gewerbespeicher/',
}

const lit = (v) => (v === null ? 'null' : `'${String(v).replace(/'/g, "''")}'`)

// Die Datei ist semikolongetrennt, ohne Anführungszeichen (geprüft: 0 Vorkommen) und CRLF-
// terminiert — das \r gehört sonst still ans letzte Feld und macht aus einem leeren Hinweis
// einen nicht-leeren.
const lines = readFileSync(CSV, 'utf8').split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l !== '')
const header = lines.shift().split(';')
const expected = ['memodo_id', 'kategorie', 'hersteller', 'bezeichnung', 'listenpreis_netto_eur', 'preisstand', 'hinweis']
if (header.join(';') !== expected.join(';')) throw new Error(`Unerwartete Kopfzeile: ${header.join(';')}`)

const rows = lines.map((line, i) => {
  const f = line.split(';')
  if (f.length !== 7) throw new Error(`Zeile ${i + 2}: ${f.length} Felder statt 7`)
  const [memodoId, kategorieRaw, hersteller, bezeichnung, preis, preisstand, hinweis] = f.map((s) => s.trim())
  const kategorie = { Heim: 'heim', Gewerbe: 'gewerbe' }[kategorieRaw]
  if (!kategorie) throw new Error(`Zeile ${i + 2}: unbekannte Kategorie "${kategorieRaw}"`)
  if (!/^\d+$/.test(memodoId)) throw new Error(`Zeile ${i + 2}: memodo_id "${memodoId}" ist keine Zahl`)
  if (!/^\d+(\.\d+)?$/.test(preis)) throw new Error(`Zeile ${i + 2}: Preis "${preis}" nicht im Dezimalpunkt-Format`)
  return `  (${memodoId}, ${lit(kategorie)}, ${lit(hersteller)}, ${lit(bezeichnung)}, ${preis}, ${lit(preisstand)}, ${lit(hinweis || null)}, ${lit(SOURCE_URL[kategorie])})`
})

const sql = `-- K2a: Import der kuratierten memodo-Liste (${rows.length} Geräte) als INAKTIVE Entwürfe.
--
-- ERZEUGT — nicht von Hand bearbeiten. Quelle: data/batteriekatalog/batteriekatalog_kuratiert.csv,
-- Generator: scripts/battery-catalog/csv-to-sql.mjs.
--
-- Übernommen wird ausschliesslich, was in der Liste steht: Kennung, Kategorie, Hersteller,
-- Bezeichnung, Listenpreis und Preisstand. Alle Kenndatenfelder (Kapazität, Leistung,
-- Wirkungsgrad, Wechselrichter, Fundament) bleiben null — sie sind nicht recherchiert, und ein
-- geschätzter Wert wäre von einem belegten nicht mehr zu unterscheiden (K2b holt sie nach).
-- Daraus folgt: \`active\` bleibt false, und \`battery_catalog_active_complete\` liesse eine
-- Aktivierung dieser Zeilen ohnehin nicht zu.
--
-- ON CONFLICT (memodo_id) DO NOTHING: ein zweiter Lauf legt nichts doppelt an und überschreibt
-- ausdrücklich NICHTS — eine im Admin gepflegte Zeile behält ihren Stand.

insert into public.battery_catalog
  (memodo_id, kategorie, hersteller, bezeichnung, list_price_net, price_as_of, notes, source_url)
values
${rows.join(',\n')}
on conflict (memodo_id) do nothing;
`

writeFileSync(OUT, sql, 'utf8')
console.log(`${rows.length} Zeilen → ${OUT}`)
