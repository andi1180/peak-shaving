-- Haushalts-Energiemonitor — Scraper-Ziele + Lauf-Protokoll (T2, Pflichtenheft_Monitor_MVP.md §7
-- kuratiertes Scraping/historisierend/Robustheits-Alert + §1.7 "Tarif-Tabelle aktuell halten" als
-- einzige laufende Team-Pflicht). Baut auf dem Schema aus
-- 20260717174454_create_monitor_schema.sql auf (gleiches Schema `monitor`, gleiche RLS-/Grant-
-- Konvention). REINHEITSGRENZE gewahrt: packages/tariff-monitor bleibt unberührt — dies ist reine
-- Struktur, in die Scraper-Code (späterer Schritt) erst später schreibt/liest.

-- ── search_path-Fix (Studio-Advisory "function_search_path_mutable") ──
-- Trifft auch die BESTEHENDE Funktion aus der ersten Migration. Per ALTER statt Editieren der
-- alten Datei (Migrationshistorie ist append-only). Empfehlung laut Supabase-Advisory: Funktionen
-- bekommen ein explizites `search_path = ''`, Objektzugriffe im Funktionskörper werden dadurch
-- schema-qualifiziert erzwungen (verhindert Hijacking über ein manipulierbares search_path). Die
-- bestehende Funktion greift auf keine Tabelle zu (nur RAISE EXCEPTION), daher ändert der Fix ihr
-- Verhalten nicht — er schließt nur die Advisory-Lücke.
alter function monitor.reject_tariff_snapshot_mutation() set search_path = '';

-- ── scrape_targets: editierbare, kuratierte Anbieterliste (§7 "Top 15–20") ──
-- Anders als tariff_snapshots bewusst NICHT historisierend, sondern editierbare Betriebs-/
-- Konfigurationsdaten, die das Team pflegt (§1.7) — deshalb updated_at-Trigger statt Append-only.

create table monitor.scrape_targets (
  id uuid primary key default gen_random_uuid(),
  provider_name text not null,
  provider_slug text not null unique,
  tariff_page_url text not null,
  is_active boolean not null default true,
  network_area text,
  logo_url text,
  sort_priority integer not null default 100,
  notes text,
  extraction_config jsonb,
  last_scrape_status text check (last_scrape_status in ('ok', 'failed', 'never')),
  last_scrape_at timestamptz,
  last_scrape_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table monitor.scrape_targets is
  'Kuratierte, editierbare Anbieterliste für den Scraper (§7 "Top 15–20"). Interne Betriebs-/'
  'Admin-Daten — anders als tariff_snapshots KEINE öffentliche Tarifinfo, daher kein anon/'
  'authenticated-Zugriff. Bewusst NICHT historisierend: is_active deaktiviert einen Anbieter ohne '
  'Löschen, updated_at trackt die letzte Bearbeitung.';

comment on column monitor.scrape_targets.provider_slug is
  'Stabiler, maschinenlesbarer Kurz-Key (z. B. ''wien-energie'') — Referenz-Anker, unabhängig vom '
  'evtl. wechselnden Anzeigenamen provider_name.';

comment on column monitor.scrape_targets.is_active is
  'An/aus ohne Löschen — ein deaktivierter Anbieter behält seine Konfiguration und sein '
  'scrape_runs-Verlauf.';

comment on column monitor.scrape_targets.sort_priority is
  'Anzeige-/Verarbeitungsreihenfolge, klein = zuerst.';

comment on column monitor.scrape_targets.extraction_config is
  'Technische Extraktions-Regel (z. B. CSS-Selektoren), von der Entwicklung befüllt. '
  'null = noch nicht eingerichtet.';

comment on column monitor.scrape_targets.last_scrape_status is
  'Statuscache des letzten Laufs, vom Scraper aktualisiert (Detail-Log steht in scrape_runs). '
  'null = noch nie versucht.';

-- Generischer BEFORE-UPDATE-Trigger (TG_TABLE_NAME-unabhängig): setzt updated_at auf now(). Für
-- jede editierbare (nicht append-only) Tabelle in diesem Schema wiederverwendbar.
create function monitor.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function monitor.set_updated_at is
  'Generischer BEFORE UPDATE-Trigger: setzt updated_at auf now(). Wiederverwendbar für jede '
  'editierbare Tabelle in diesem Schema.';

create trigger scrape_targets_set_updated_at
  before update on monitor.scrape_targets
  for each row execute function monitor.set_updated_at();

-- ── scrape_runs: Lauf-Protokoll je Scraper-Durchlauf (§7 Robustheits-Alert-Basis) — APPEND-ONLY
-- wie tariff_snapshots (historisches Log, nie überschreiben). ──

create table monitor.scrape_runs (
  id uuid primary key default gen_random_uuid(),
  -- on delete cascade + not null: ein Lauf-Log-Eintrag ist ohne sein Ziel nicht sinnvoll
  -- interpretierbar (kein eigenständiges Objekt) — anders als scrape_targets.is_active (§7: "an/
  -- aus, ohne Löschen") ist ein target_id-loser Lauf fachlich nicht vorgesehen.
  target_id uuid not null references monitor.scrape_targets (id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'ok', 'failed', 'implausible')),
  tariffs_found integer not null default 0,
  error_message text,
  triggered_alert boolean not null default false
);

comment on table monitor.scrape_runs is
  'Eine Zeile pro Scraper-Lauf je Ziel, append-only (§7 — historisches Log, nie überschreiben). '
  'status=ok mit tariffs_found=0 ist der zentrale Alert-Kandidat (Scraper lief durch, fand aber '
  'nichts) — triggered_alert hält fest, ob dafür tatsächlich ein Team-Alert ausgelöst wurde.';

comment on column monitor.scrape_runs.tariffs_found is
  '0 bei einem sonst erfolgreichen Lauf ist der Robustheits-Alert-Kandidat aus §7 '
  '("Scraper liefert 0 Tarife oder unplausible Werte → Team-Alert").';

comment on column monitor.scrape_runs.triggered_alert is
  'true, wenn dieser Lauf tatsächlich einen Team-Alert ausgelöst hat (§7).';

-- Häufigste Abfrage: Läufe eines Ziels chronologisch (Robustheits-Check/Anzeige).
create index scrape_runs_target_started_idx
  on monitor.scrape_runs (target_id, started_at desc);

-- Tabellen-agnostischer Append-only-Schutz (TG_TABLE_SCHEMA/TG_TABLE_NAME dynamisch im
-- Fehlertext) — GLEICHER Trigger-Mechanismus wie monitor.reject_tariff_snapshot_mutation (erste
-- Migration: BEFORE UPDATE/DELETE, RAISE EXCEPTION), aber eine EIGENE Funktion statt deren
-- Wiederverwendung: jene nennt "monitor.tariff_snapshots" fest im Fehlertext, was für scrape_runs
-- irreführend wäre. Diese Fassung ist generisch, damit künftige weitere Append-only-Tabellen in
-- diesem Schema sie ebenfalls nutzen können, statt einer dritten Kopie.
create function monitor.reject_append_only_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    '% ist append-only (Pflichtenheft_Monitor_MVP.md §7) — % nicht erlaubt',
    tg_table_schema || '.' || tg_table_name, tg_op;
end;
$$;

comment on function monitor.reject_append_only_mutation is
  'Tabellen-agnostischer Append-only-Schutz (BEFORE UPDATE/DELETE), analog zu '
  'monitor.reject_tariff_snapshot_mutation, aber generisch statt an einen Tabellennamen '
  'gebunden — für scrape_runs und künftige weitere Append-only-Tabellen in diesem Schema.';

create trigger scrape_runs_no_update
  before update on monitor.scrape_runs
  for each row execute function monitor.reject_append_only_mutation();

create trigger scrape_runs_no_delete
  before delete on monitor.scrape_runs
  for each row execute function monitor.reject_append_only_mutation();

-- ── RLS + Grants: interne Admin-/Betriebsdaten, KEIN anon/authenticated-Zugriff ──
-- Anders als tariff_snapshots (öffentliche Tarifdaten) sind beide Tabellen hier Betriebsdaten —
-- kein "using (true)"-Read-Grant. Nur service_role (RLS-Bypass, serverseitig) liest/schreibt. Eine
-- Admin-Rolle mit Zugriff kommt erst mit T4 — hier bewusst nicht vorgebaut.

alter table monitor.scrape_targets enable row level security;
alter table monitor.scrape_runs enable row level security;

-- Keine expliziten Policies nötig, um anon/authenticated auszusperren: RLS ohne Policy für eine
-- Rolle verweigert dieser Rolle per Postgres-Default ALLE Zeilen, UND es gibt für sie ohnehin
-- keinen Grant unten (doppelte Absicherung, wie schon bei tariff_snapshots' update/delete-Sperre).
-- service_role braucht ebenfalls keine Policy — es hat in Supabase BYPASSRLS.

-- scrape_targets ist editierbar (kein Append-only) — service_role bekommt bewusst KEIN delete:
-- Deaktivieren läuft über is_active ("an/aus, ohne Löschen", s. o.), nicht über DELETE.
grant select, insert, update on monitor.scrape_targets to service_role;

-- scrape_runs ist append-only wie tariff_snapshots — service_role bekommt bewusst NUR
-- select+insert (kein update/delete), der Trigger oben erzwingt es zusätzlich auf DB-Ebene.
grant select, insert on monitor.scrape_runs to service_role;

-- ── Kein Seed hier ──
-- Bewusst KEINE Platzhalter-Targets: die echte Top-15–20-Anbieterliste ist §12 #6 (Andreas/
-- Martin) und noch nicht geliefert. Nur die leere Struktur — seed.sql bleibt für scrape_targets
-- unangetastet.
