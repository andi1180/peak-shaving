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

// ── K2b-1: Kenndaten für die Gewerbe-Geräte ────────────────────────────────────────────────────
// Zweiter, unabhängiger Durchgang: er ERGÄNZT recherchierte Werte an bestehenden Zeilen, statt
// Zeilen anzulegen. Eigene Quelldatei, eigene Migration.

const KENNDATEN_CSV = join(root, 'data', 'batteriekatalog', 'kenndaten_gewerbe.csv')
const KENNDATEN_OUT = join(root, 'supabase', 'migrations', '20260922180000_battery_catalog_kenndaten_gewerbe.sql')

const num = (v, label, row) => {
  if (v === '') return 'null'
  if (!/^\d+(\.\d+)?$/.test(v)) throw new Error(`Zeile ${row}: ${label} "${v}" nicht im Dezimalpunkt-Format`)
  return v
}
const bool = (v, label, row) => {
  if (v === '') return 'null'
  if (v !== 'true' && v !== 'false') throw new Error(`Zeile ${row}: ${label} "${v}" ist kein Wahrheitswert`)
  return v
}

const kLines = readFileSync(KENNDATEN_CSV, 'utf8').split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l !== '')
const kHeader = kLines.shift().split(';')
const kExpected = ['memodo_id', 'usable_capacity_kwh', 'max_power_kw', 'round_trip_efficiency',
  'inverter_included', 'extra_inverter_cost_net', 'requires_foundation', 'datasheet_url', 'rechenweg']
if (kHeader.join(';') !== kExpected.join(';')) throw new Error(`Unerwartete Kopfzeile: ${kHeader.join(';')}`)

const updates = kLines.map((line, i) => {
  const row = i + 2
  const f = line.split(';')
  if (f.length !== 9) throw new Error(`Zeile ${row}: ${f.length} Felder statt 9`)
  const [memodoId, kwh, kw, rte, invIncl, extraInv, reqFound, datasheet, rechenweg] = f.map((s) => s.trim())
  if (!/^\d+$/.test(memodoId)) throw new Error(`Zeile ${row}: memodo_id "${memodoId}" ist keine Zahl`)
  // Eine befüllte Zeile ohne Beleg gibt es nicht — die Quelle ist Teil des Werts, nicht Beiwerk.
  if (!/^https:\/\//.test(datasheet)) throw new Error(`Zeile ${row}: datasheet_url fehlt oder ist nicht https`)
  if (!rechenweg) throw new Error(`Zeile ${row}: rechenweg fehlt`)
  const e = num(rte, 'round_trip_efficiency', row)
  if (e !== 'null' && !(Number(e) > 0 && Number(e) <= 1)) throw new Error(`Zeile ${row}: Wirkungsgrad ${e} nicht in (0,1]`)

  return `update public.battery_catalog set
  usable_capacity_kwh     = ${num(kwh, 'usable_capacity_kwh', row)},
  max_power_kw            = ${num(kw, 'max_power_kw', row)},
  round_trip_efficiency   = ${e},
  inverter_included       = ${bool(invIncl, 'inverter_included', row)},
  extra_inverter_cost_net = ${num(extraInv, 'extra_inverter_cost_net', row)},
  requires_foundation     = ${bool(reqFound, 'requires_foundation', row)},
  datasheet_url           = ${lit(datasheet)},
  notes                   = nullif(btrim(coalesce(notes || ' · ', '') || ${lit(rechenweg)}), '')
where memodo_id = ${memodoId}
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and inverter_included is null
  and requires_foundation is null;`
})

const kSql = `-- K2b-1: Kenndaten für ${updates.length} Gewerbe-Geräte (SMA, SolarEdge, Sungrow, Fox ESS, Pylontech).
--
-- ERZEUGT — nicht von Hand bearbeiten. Quelle: data/batteriekatalog/kenndaten_gewerbe.csv,
-- Generator: scripts/battery-catalog/csv-to-sql.mjs.
--
-- Jeder Wert stammt aus dem Datenblatt des Herstellers; der Weg dorthin steht als Rechenweg in
-- \`notes\` und die Quelle in \`datasheet_url\`. Was ein Datenblatt nicht hergibt, bleibt null —
-- ein geschätzter Wirkungsgrad wäre von einem belegten nicht mehr zu unterscheiden und liefe
-- anschliessend durch jede Viertelstunde der Simulation.
--
-- ⚠ DIE WHERE-BEDINGUNG IST DIE SICHERUNG: geändert wird nur eine Zeile, die noch GAR KEINE
-- Kenndaten trägt — also genau den Zustand aus K2a. Hat ein Mensch im Admin auch nur ein Feld
-- gepflegt, läuft das UPDATE an ihr vorbei. Daraus folgt zugleich die Idempotenz: ein zweiter
-- Lauf findet seine eigenen Zeilen nicht mehr und hängt den Rechenweg nicht ein zweites Mal an.
--
-- Fundament- und Installationskosten werden ausdrücklich NICHT gesetzt (nicht recherchiert).
-- Für die Geräte mit \`requires_foundation = true\` heisst das: \`battery_catalog_active_complete\`
-- lässt eine Freigabe nicht zu, solange die Fundamentkosten fehlen. Das ist gewollt.

${updates.join('\n\n')}

-- Freigabe — ausschliesslich für Zeilen, die ALLE Engine-Pflichtfelder tragen. Die Bedingung ist
-- wortgleich der CHECK \`battery_catalog_active_complete\`: was hier nicht durchkommt, würde beim
-- Setzen von \`active\` ohnehin abgewiesen. Die Aufzählung steht hier zum zweiten Mal, weil eine
-- Migration, die an ihrem eigenen CHECK scheitert, die Bedingung nicht mehr erklären kann.
update public.battery_catalog set active = true
where kategorie = 'gewerbe'
  and not active
  and usable_capacity_kwh is not null
  and max_power_kw is not null
  and round_trip_efficiency is not null
  and list_price_net is not null
  and inverter_included is not null
  and requires_foundation is not null
  and (inverter_included or extra_inverter_cost_net is not null)
  and (not requires_foundation or foundation_cost_net is not null);
`

writeFileSync(KENNDATEN_OUT, kSql, 'utf8')
console.log(`${updates.length} Kenndaten-Zeilen → ${KENNDATEN_OUT}`)

// ── H2-A/H2-B: Kenndaten + Freigabe für Heimgeräte ────────────────────────────────────────────
// Eigenes Spaltenformat: seit K2c gehört `rte_source` zum Wert, und seit H1 liegt der
// Wechselrichter als Baustein an der Zeile — `inverter_included`/`inverter_component_id` fasst
// dieser Durchgang nicht an.

function heimPass({ tag, csvName, outName, families, powerNote }) {
  const HEIM_CSV = join(root, 'data', 'batteriekatalog', csvName)
  const HEIM_OUT = join(root, 'supabase', 'migrations', outName)

  const hLines = readFileSync(HEIM_CSV, 'utf8').split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l !== '')
  const hHeader = hLines.shift().split(';')
  const hExpected = ['memodo_id', 'usable_capacity_kwh', 'max_power_kw', 'round_trip_efficiency', 'rte_source',
    'requires_foundation', 'datasheet_url', 'rechenweg']
  if (hHeader.join(';') !== hExpected.join(';')) throw new Error(`Unerwartete Kopfzeile: ${hHeader.join(';')}`)

  const heimIds = []
  const heimUpdates = hLines.map((line, i) => {
    const row = i + 2
    const f = line.split(';')
    if (f.length !== 8) throw new Error(`Zeile ${row}: ${f.length} Felder statt 8`)
    const [memodoId, kwh, kw, rte, rteSource, reqFound, datasheet, rechenweg] = f.map((s) => s.trim())
    if (!/^\d+$/.test(memodoId)) throw new Error(`Zeile ${row}: memodo_id "${memodoId}" ist keine Zahl`)
    if (!/^https:\/\//.test(datasheet)) throw new Error(`Zeile ${row}: datasheet_url fehlt oder ist nicht https`)
    if (!rechenweg) throw new Error(`Zeile ${row}: rechenweg fehlt`)
    const e = num(rte, 'round_trip_efficiency', row)
    if (e !== 'null' && !(Number(e) > 0 && Number(e) <= 1)) throw new Error(`Zeile ${row}: Wirkungsgrad ${e} nicht in (0,1]`)
    // Ein Wirkungsgrad ohne Herkunft wäre von einem belegten nicht zu unterscheiden (K2c).
    if ((e === 'null') !== (rteSource === '')) throw new Error(`Zeile ${row}: Wirkungsgrad und rte_source nur gemeinsam`)
    if (rteSource !== '' && rteSource !== 'datenblatt' && rteSource !== 'annahme') {
      throw new Error(`Zeile ${row}: rte_source "${rteSource}" unbekannt`)
    }
    heimIds.push(memodoId)

    return `update public.battery_catalog set
  usable_capacity_kwh   = ${num(kwh, 'usable_capacity_kwh', row)},
  max_power_kw          = ${num(kw, 'max_power_kw', row)},
  round_trip_efficiency = ${e},
  rte_source            = ${rteSource === '' ? 'null' : lit(rteSource)},
  requires_foundation   = ${bool(reqFound, 'requires_foundation', row)},
  datasheet_url         = ${lit(datasheet)},
  notes                 = nullif(btrim(coalesce(notes || ' · ', '') || ${lit(rechenweg)}), '')
where memodo_id = ${memodoId}
  and kategorie = 'heim'
  and usable_capacity_kwh is null
  and max_power_kw is null
  and round_trip_efficiency is null
  and rte_source is null
  and requires_foundation is null
  and datasheet_url is null;`
  })

  const hSql = `-- ${tag}: Kenndaten und Freigabe für ${heimUpdates.length} Heimgeräte (${families}).
--
-- ERZEUGT — nicht von Hand bearbeiten. Quelle: data/batteriekatalog/${csvName},
-- Generator: scripts/battery-catalog/csv-to-sql.mjs.
--
${powerNote}
--
-- ⚠ DIE WHERE-BEDINGUNG IST DIE SICHERUNG: geändert wird nur eine Zeile, deren Kenndatenfelder
-- noch ALLE leer sind. Hat ein Mensch im Admin gepflegt, läuft das UPDATE vorbei; daraus folgt
-- zugleich die Idempotenz.

${heimUpdates.join('\n\n')}

-- Freigabe über denselben Wrapper wie die Oberfläche (samt Bausteinprüfung). Eine unvollständige
-- Zeile bleibt Entwurf und wird gemeldet, statt die Migration abzubrechen.
do $$
declare
  v_admin  uuid;
  v_row    public.battery_catalog%rowtype;
  v_result jsonb;
  v_memodo int;
begin
  select user_id into v_admin from platform.user_roles where role = 'admin' limit 1;
  if v_admin is null then
    raise notice '${tag}: kein Admin-Konto gefunden — die Freigaben unterbleiben.';
    return;
  end if;

  -- NUR die JWT-Angabe, KEIN Rollenwechsel (Begründung im Kopf des K1b-DO-Blocks).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  foreach v_memodo in array array[${heimIds.join(', ')}] loop
    select * into v_row from public.battery_catalog where memodo_id = v_memodo and kategorie = 'heim';
    continue when v_row.id is null or v_row.active;

    v_result := public.admin_set_battery_active(v_row.id, true);
    if v_result->>'status' <> 'activated' then
      raise notice '${tag}: memodo_id % bleibt Entwurf: %', v_memodo, v_result;
    end if;
  end loop;
end $$;
`

  writeFileSync(HEIM_OUT, hSql, 'utf8')
  console.log(`${heimUpdates.length} Heim-Kenndaten-Zeilen → ${HEIM_OUT}`)
}

heimPass({
  tag: 'H2-A',
  csvName: 'kenndaten_heim_a.csv',
  outName: '20260924120000_battery_catalog_kenndaten_heim_a.sql',
  families: 'Fronius Reserva, SMA Home Storage,\n-- BYD Battery-Box HVB, KOSTAL HELIVOR HV',
  powerNote: `-- \`max_power_kw\` ist die Leistung des SPEICHERS laut Blatt; die Begrenzung durch den in H1
-- zugeordneten Wechselrichter-Baustein rechnet der Loader (min(Speicher, Wechselrichter)).
-- Kein Blatt nennt einen System-Round-Trip — alle tragen 0,88 als Annahme (K2c-Regel).`,
})

heimPass({
  tag: 'H2-B',
  csvName: 'kenndaten_heim_b.csv',
  outName: '20260924150000_battery_catalog_kenndaten_heim_b.sql',
  families: 'Sungrow SBR, GoodWe Lynx Home D,\n-- Fox ESS EQ3300, Pylontech Force H3, E3/DC one, SolarEdge Home Battery HV',
  powerNote: `-- \`max_power_kw\` ist die Leistung des SPEICHERS laut Blatt; die Begrenzung durch den in H1
-- zugeordneten Wechselrichter-Baustein rechnet der Loader (min(Speicher, Wechselrichter)).
-- Ausnahme E3/DC one: Umrichter eingebaut, kein Baustein — dort ist es die AC-Nennleistung des
-- Systems laut Blatt. Kein Blatt nennt einen System-Round-Trip — alle tragen 0,88 als Annahme.`,
})
