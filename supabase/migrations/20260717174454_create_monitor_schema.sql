-- Haushalts-Energiemonitor — Schema-Fundament (T2, Pflichtenheft_Monitor_MVP.md §4.2/§7).
-- EIN Supabase-Projekt für die ganze CoolIn-Plattform; Produkt-Trennung läuft über eigene
-- Postgres-Schemas, nicht über separate Projekte. Dieses Schema (`monitor`) gehört ausschließlich
-- dem Monitor-Produkt. KEIN Auth, KEINE User-Tabellen, KEINE Nutzerdaten-RLS hier (T4).

create schema if not exists monitor;

comment on schema monitor is
  'Haushalts-Energiemonitor-Produktschema (Pflichtenheft_Monitor_MVP.md). Getrennt von anderen '
  'CoolIn-Produkt-Schemas im selben Supabase-Projekt.';

-- ── Tarif-Snapshots: historisierende Zeitreihe (§7) — APPEND-ONLY, NIE UPDATE/überschreiben. ──
-- Feldnamen 1:1 semantisch zum T1-Contract `TariffCostObject`
-- (packages/tariff-monitor/src/types.ts), snake_case, plus Provenienz (captured_at/source).

create table monitor.tariff_snapshots (
  id uuid primary key default gen_random_uuid(),
  provider_name text not null,
  tariff_name text not null,
  energy_price_ct_per_kwh numeric not null,
  base_fee_eur_per_year numeric not null,
  bonus_eur numeric not null default 0,
  bonus_condition_text text,
  price_guarantee_months integer, -- null = unbefristet/unbekannt
  contract_commitment_months integer not null default 0,
  billing_cycle text not null check (billing_cycle in ('monthly', 'annual')),
  green_energy boolean not null,
  requires_prepayment boolean not null default false,
  captured_at timestamptz not null default now(), -- Zeitachse der Historisierung (§7)
  source text not null default 'seed_placeholder' -- 'scrape' kommt mit dem T2-Scraper
);

comment on table monitor.tariff_snapshots is
  'Eine Zeile pro erfasstem Tarif-Stand, append-only (§7 — historisierend, nicht überschreibend). '
  'Dedup-/Aktualitäts-Key ist aktuell (provider_name, tariff_name) — s. monitor.current_tariffs. '
  'Ein stabiler EXTERNER Tarif-Key (z. B. vom Scraper vergebene ID) kommt evtl. mit T2 dazu, sobald '
  'reale Scraper-Targets (§12 #6) vorliegen — bewusst noch nicht gebaut, um keinen Key zu raten.';

comment on column monitor.tariff_snapshots.energy_price_ct_per_kwh is
  'NUR Lieferantenanteil (Arbeitspreis), nie Gesamtpreis inkl. Netz/Steuern (§1.4).';

comment on column monitor.tariff_snapshots.price_guarantee_months is
  'null = unbefristet/unbekannt.';

comment on column monitor.tariff_snapshots.source is
  'Provenienz des Snapshots: seed_placeholder (erfundene AT-Fixtures aus T1, s. Seed-Migration) '
  'oder scrape (späterer T2-Scraper).';

-- Trägt exakt die DISTINCT-ON-Sortierung der current_tariffs-View unten (§7).
create index tariff_snapshots_provider_tariff_captured_idx
  on monitor.tariff_snapshots (provider_name, tariff_name, captured_at desc);

-- ── current_tariffs: jeweils neuester Snapshot je Tarif (Dedup-Key vorerst provider+tariff). ──
-- Liest später der Gratis-Check (T3); Analysen/Zeitreihen lesen die volle Snapshot-Tabelle.
-- `security_invoker = true`: die View erbt die RLS-Policies/Rechte der ABFRAGENDEN Rolle statt
-- der des View-Eigentümers (Supabase-Hygiene, vermeidet die "Security Definer View"-Warnung) —
-- hier ohne Verhaltensunterschied, da die SELECT-Policy unten ohnehin für alle lesenden Rollen
-- offen ist, aber die korrekte Grundhaltung für jede künftige View in diesem Schema.
create view monitor.current_tariffs
  with (security_invoker = true) as
select distinct on (provider_name, tariff_name) *
from monitor.tariff_snapshots
order by provider_name, tariff_name, captured_at desc;

comment on view monitor.current_tariffs is
  'Neuester Snapshot je (provider_name, tariff_name) — Gratis-Check (T3) liest diese View, '
  'Analysen lesen monitor.tariff_snapshots direkt.';

-- ── RLS: öffentliche Tarif-Daten (KEINE Nutzerdaten) — öffentlich lesbar, append-only-Schreiben ──
-- nur serverseitig via service_role (Scraper/Cron, T2). anon/authenticated bekommen bewusst KEIN
-- insert/update/delete-Grant.

alter table monitor.tariff_snapshots enable row level security;

create policy tariff_snapshots_public_read
  on monitor.tariff_snapshots
  for select
  to anon, authenticated
  using (true);

grant usage on schema monitor to anon, authenticated, service_role;

grant select on monitor.tariff_snapshots to anon, authenticated;
grant select on monitor.current_tariffs to anon, authenticated;

-- service_role bekommt bewusst NUR select+insert, KEIN update/delete-Grant — Append-only ist
-- Architektur (§7), nicht nur RLS-Policy; s. auch die Trigger unten, die update/delete zusätzlich
-- auf DB-Ebene hart blocken (auch gegen einen Rollen-/Grant-Fehler in einer künftigen Migration).
grant select, insert on monitor.tariff_snapshots to service_role;

-- ── Harte Append-only-Absicherung: blockt UPDATE/DELETE unabhängig von Grants/RLS. ──
-- RLS gilt nicht für Rollen mit BYPASSRLS (z. B. service_role, postgres) — der Trigger ist die
-- einzige Stelle, die die "nie überschreiben"-Invariante (§7) für JEDE Rolle erzwingt, nicht nur
-- für die (ohnehin schon grant-beschränkten) anon/authenticated-Rollen.
create function monitor.reject_tariff_snapshot_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'monitor.tariff_snapshots ist append-only (Pflichtenheft_Monitor_MVP.md §7) — % nicht erlaubt',
    tg_op;
end;
$$;

create trigger tariff_snapshots_no_update
  before update on monitor.tariff_snapshots
  for each row execute function monitor.reject_tariff_snapshot_mutation();

create trigger tariff_snapshots_no_delete
  before delete on monitor.tariff_snapshots
  for each row execute function monitor.reject_tariff_snapshot_mutation();
