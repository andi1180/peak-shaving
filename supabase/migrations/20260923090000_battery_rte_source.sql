-- K2c: die Herkunft des Wirkungsgrads, zwei Fundament-Nachträge, ein entferntes Bündel.
--
-- ── WARUM EINE EIGENE SPALTE UND NICHT EINE NOTIZ ─────────────────────────────────────────────
-- 0,88 ist ein Erfahrungswert für einen AC-gekoppelten Gewerbespeicher (ein Umrichterdurchgang je
-- Richtung plus Standby), kein Datenblattwert. Ohne ein Feld daneben sieht die Engine — und später
-- der Report — zwei Zahlen gleicher Bauart, von denen eine belegt und die andere geraten ist. Die
-- Unterscheidung gehört deshalb an die Zeile und nicht in den Freitext: `notes` liest kein Programm.
--
-- ── DIE REGEL „KEIN WIRKUNGSGRAD OHNE HERKUNFT" WIRKT AN DER FREIGABE ─────────────────────────
-- Ein ENTWURF darf einen Wirkungsgrad ohne Herkunft tragen — genau in dem Zustand ist heute jede
-- Zeile, und ein `not null` über beide Spalten machte diese Migration zu ihrem eigenen Hindernis.
-- Verlangt wird die Herkunft dort, wo der Wert wirksam wird: in `battery_catalog_active_complete`.
-- Die Gegenrichtung ist dagegen nie sinnvoll und deshalb hart gesperrt — eine Herkunftsangabe ohne
-- Wert belegt nichts.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — Die Spalte
-- ════════════════════════════════════════════════════════════════════════════════════════════════

alter table public.battery_catalog add column rte_source text;

alter table public.battery_catalog
  add constraint battery_catalog_rte_source_known
    check (rte_source is null or rte_source in ('datenblatt', 'annahme')),
  add constraint battery_catalog_rte_source_needs_value
    check (rte_source is null or round_trip_efficiency is not null);

comment on column public.battery_catalog.rte_source is
  'K2c: woher round_trip_efficiency stammt — `datenblatt` (der Hersteller nennt einen System- bzw. '
  'AC-Round-Trip) oder `annahme` (gesetzter Erfahrungswert). Zum Freigeben PFLICHT, sobald ein '
  'Wirkungsgrad dasteht; im Entwurf darf sie fehlen. Eine Herkunft OHNE Wert ist gesperrt.';

-- Die Freigabe-Bedingung bekommt eine Zeile. Alles Uebrige bleibt Wort fuer Wort stehen.
alter table public.battery_catalog
  drop constraint battery_catalog_active_complete;

alter table public.battery_catalog
  add constraint battery_catalog_active_complete
  check (
    not active
    or (
      usable_capacity_kwh is not null
      and max_power_kw is not null
      and round_trip_efficiency is not null
      and rte_source is not null
      and list_price_net is not null
      and inverter_included is not null
      and requires_foundation is not null
      and (inverter_included or extra_inverter_cost_net is not null)
    )
  );

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — Die Wrapper ziehen nach
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Die beiden Leser (`admin_list_battery_catalog`, `admin_get_battery`) selektieren `b.*` und
-- bekommen die Spalte von selbst — sie bleiben unangetastet, samt der Huelle {status, battery}.

drop function public.admin_create_battery(
  text, text, text, integer, numeric, numeric, numeric, numeric, boolean, numeric,
  boolean, uuid, uuid, date, text, text, text, text);

create function public.admin_create_battery(
  p_kategorie text,
  p_hersteller text,
  p_bezeichnung text,
  p_memodo_id integer default null,
  p_usable_capacity_kwh numeric default null,
  p_max_power_kw numeric default null,
  p_round_trip_efficiency numeric default null,
  p_rte_source text default null,
  p_list_price_net numeric default null,
  p_inverter_included boolean default null,
  p_extra_inverter_cost_net numeric default null,
  p_requires_foundation boolean default null,
  p_foundation_component_id uuid default null,
  p_installation_component_id uuid default null,
  p_price_as_of date default null,
  p_source_url text default null,
  p_datasheet_url text default null,
  p_control_type text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kategorie    text := lower(nullif(btrim(p_kategorie), ''));
  v_hersteller   text := nullif(btrim(p_hersteller), '');
  v_bezeichnung  text := nullif(btrim(p_bezeichnung), '');
  v_control_type text := lower(nullif(btrim(p_control_type), ''));
  v_rte_source   text := lower(nullif(btrim(p_rte_source), ''));
  v_id           uuid;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_create_battery: Adminrolle erforderlich' using errcode = '42501';
  end if;
  if v_kategorie is null or v_hersteller is null or v_bezeichnung is null then
    return jsonb_build_object('status', 'missing_fields');
  end if;
  if v_kategorie not in ('heim', 'gewerbe') then
    return jsonb_build_object('status', 'invalid_kategorie');
  end if;
  if v_control_type is not null and v_control_type not in ('static', 'dynamic') then
    return jsonb_build_object('status', 'invalid_control_type');
  end if;
  if v_rte_source is not null and v_rte_source not in ('datenblatt', 'annahme') then
    return jsonb_build_object('status', 'invalid_rte_source');
  end if;
  -- Benannt statt als 23514 durchzuschlagen: die Oberflaeche soll das Feld zeigen koennen, an dem
  -- es haengt, und der CHECK antwortet nur mit seinem Namen.
  if v_rte_source is not null and p_round_trip_efficiency is null then
    return jsonb_build_object('status', 'rte_source_without_value');
  end if;

  begin
    insert into public.battery_catalog (
      kategorie, hersteller, bezeichnung, memodo_id, usable_capacity_kwh, max_power_kw,
      round_trip_efficiency, rte_source, list_price_net, inverter_included,
      extra_inverter_cost_net, requires_foundation, foundation_component_id,
      installation_component_id, price_as_of, source_url, datasheet_url, control_type, notes
    ) values (
      v_kategorie, v_hersteller, v_bezeichnung, p_memodo_id, p_usable_capacity_kwh, p_max_power_kw,
      p_round_trip_efficiency, v_rte_source, p_list_price_net, p_inverter_included,
      p_extra_inverter_cost_net, p_requires_foundation, p_foundation_component_id,
      p_installation_component_id, p_price_as_of, nullif(btrim(p_source_url), ''),
      nullif(btrim(p_datasheet_url), ''), v_control_type, nullif(btrim(p_notes), '')
    ) returning id into v_id;
  exception
    when unique_violation then
      return jsonb_build_object('status', 'duplicate_memodo_id');
    -- Die Art-Prüfung aus K1b wirft 22023; sie wird zur benannten Antwort statt zum Fehler.
    when invalid_parameter_value then
      return jsonb_build_object('status', 'invalid_component', 'detail', sqlerrm);
    when foreign_key_violation then
      return jsonb_build_object('status', 'unknown_component');
    -- K1b-REGRESSION, hier mitbehoben: die Bereichs-CHECKs (Kapazitaet/Leistung/Preis > 0,
    -- Wirkungsgrad in (0,1]) schlugen seither roh als 23514 zum Client durch. Beim ANLEGEN gibt es
    -- keine aktive Zeile, die etwas verlieren koennte — jeder CHECK hier ist ein Wertfehler.
    when check_violation then
      return jsonb_build_object('status', 'invalid_values', 'detail', sqlerrm);
  end;

  return jsonb_build_object('status', 'created', 'id', v_id);
end;
$$;

drop function public.admin_update_battery(
  uuid, text, text, text, integer, numeric, numeric, numeric, numeric, boolean, numeric,
  boolean, uuid, uuid, date, text, text, text, text);

create function public.admin_update_battery(
  p_id uuid,
  p_kategorie text,
  p_hersteller text,
  p_bezeichnung text,
  p_memodo_id integer default null,
  p_usable_capacity_kwh numeric default null,
  p_max_power_kw numeric default null,
  p_round_trip_efficiency numeric default null,
  p_rte_source text default null,
  p_list_price_net numeric default null,
  p_inverter_included boolean default null,
  p_extra_inverter_cost_net numeric default null,
  p_requires_foundation boolean default null,
  p_foundation_component_id uuid default null,
  p_installation_component_id uuid default null,
  p_price_as_of date default null,
  p_source_url text default null,
  p_datasheet_url text default null,
  p_control_type text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kategorie    text := lower(nullif(btrim(p_kategorie), ''));
  v_hersteller   text := nullif(btrim(p_hersteller), '');
  v_bezeichnung  text := nullif(btrim(p_bezeichnung), '');
  v_control_type text := lower(nullif(btrim(p_control_type), ''));
  v_rte_source   text := lower(nullif(btrim(p_rte_source), ''));
  v_constraint   text;
  v_count        integer;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_update_battery: Adminrolle erforderlich' using errcode = '42501';
  end if;
  if v_kategorie is null or v_hersteller is null or v_bezeichnung is null then
    return jsonb_build_object('status', 'missing_fields');
  end if;
  if v_kategorie not in ('heim', 'gewerbe') then
    return jsonb_build_object('status', 'invalid_kategorie');
  end if;
  if v_control_type is not null and v_control_type not in ('static', 'dynamic') then
    return jsonb_build_object('status', 'invalid_control_type');
  end if;
  if v_rte_source is not null and v_rte_source not in ('datenblatt', 'annahme') then
    return jsonb_build_object('status', 'invalid_rte_source');
  end if;
  if v_rte_source is not null and p_round_trip_efficiency is null then
    return jsonb_build_object('status', 'rte_source_without_value');
  end if;

  begin
    update public.battery_catalog set
      kategorie                 = v_kategorie,
      hersteller                = v_hersteller,
      bezeichnung               = v_bezeichnung,
      memodo_id                 = p_memodo_id,
      usable_capacity_kwh       = p_usable_capacity_kwh,
      max_power_kw              = p_max_power_kw,
      round_trip_efficiency     = p_round_trip_efficiency,
      rte_source                = v_rte_source,
      list_price_net            = p_list_price_net,
      inverter_included         = p_inverter_included,
      extra_inverter_cost_net   = p_extra_inverter_cost_net,
      requires_foundation       = p_requires_foundation,
      foundation_component_id   = p_foundation_component_id,
      installation_component_id = p_installation_component_id,
      price_as_of               = p_price_as_of,
      source_url                = nullif(btrim(p_source_url), ''),
      datasheet_url             = nullif(btrim(p_datasheet_url), ''),
      control_type              = v_control_type,
      notes                     = nullif(btrim(p_notes), '')
    where id = p_id;
    get diagnostics v_count = row_count;
  exception
    when unique_violation then
      return jsonb_build_object('status', 'duplicate_memodo_id');
    when invalid_parameter_value then
      return jsonb_build_object('status', 'invalid_component', 'detail', sqlerrm);
    when foreign_key_violation then
      return jsonb_build_object('status', 'unknown_component');
    -- K1b-REGRESSION, hier mitbehoben: K1b beantwortete JEDEN check_violation mit
    -- `would_break_active` und machte damit aus einem Wertfehler eine Aussage ueber die Freigabe.
    -- Unterschieden wird am Namen der Bedingung — nur `battery_catalog_active_complete` sagt
    -- „einer aktiven Zeile fehlt jetzt ein Pflichtwert" (seit K2c auch die Herkunft).
    when check_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'battery_catalog_active_complete' then
        return jsonb_build_object('status', 'would_break_active', 'detail', sqlerrm);
      end if;
      return jsonb_build_object('status', 'invalid_values', 'detail', sqlerrm);
  end;

  if v_count = 0 then
    return jsonb_build_object('status', 'not_found');
  end if;
  return jsonb_build_object('status', 'updated');
end;
$$;

-- ⚠ K1b-REGRESSION, hier mitbehoben: sein DROP+CREATE liess den `revoke` aus K1 weg, und
-- PostgreSQL vergibt EXECUTE an PUBLIC von selbst (dazu ALTER DEFAULT PRIVILEGES an
-- anon/authenticated/service_role). In Produktion gemessen (23.09.2026): `anon` UND
-- `service_role` hatten auf SIEBEN Wrapper EXECUTE — die zwei hier plus die fuenf unten. Die Adminpruefung im Rumpf faengt das ab — aber „laeuft ins Leere" ist
-- keine Zugangsregel, und `service_role` traegt kein JWT und hat hier nichts zu suchen.
-- Wer diese Funktionen erneut per DROP+CREATE ersetzt, schreibt den `revoke` wieder mit.
revoke all on function public.admin_create_battery(
  text, text, text, integer, numeric, numeric, numeric, text, numeric, boolean, numeric,
  boolean, uuid, uuid, date, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_update_battery(
  uuid, text, text, text, integer, numeric, numeric, numeric, text, numeric, boolean, numeric,
  boolean, uuid, uuid, date, text, text, text, text) from public, anon, authenticated, service_role;

grant execute on function public.admin_create_battery(
  text, text, text, integer, numeric, numeric, numeric, text, numeric, boolean, numeric,
  boolean, uuid, uuid, date, text, text, text, text) to authenticated;
grant execute on function public.admin_update_battery(
  uuid, text, text, text, integer, numeric, numeric, numeric, text, numeric, boolean, numeric,
  boolean, uuid, uuid, date, text, text, text, text) to authenticated;

-- Dieselbe Luecke bei den fuenf Baustein-Wrappern aus K1b. Sie werden hier nicht neu geschrieben,
-- nur ihre Rechteflaeche wird auf das K1-Muster zurueckgeholt.
revoke all on function public.admin_list_cost_components(text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_get_cost_component(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_create_cost_component(text, text, text, numeric, date, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_update_cost_component(uuid, text, text, text, numeric, date, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_delete_cost_component(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_list_cost_components(text) to authenticated;
grant execute on function public.admin_get_cost_component(uuid) to authenticated;
grant execute on function public.admin_create_cost_component(text, text, text, numeric, date, text)
  to authenticated;
grant execute on function public.admin_update_cost_component(uuid, text, text, text, numeric, date, text)
  to authenticated;
grant execute on function public.admin_delete_cost_component(uuid) to authenticated;

-- `admin_set_battery_active` bekommt die Herkunft in die Fehlliste: der CHECK antwortet nur mit
-- seinem Namen, benennen muss das fehlende Feld der Wrapper.
create or replace function public.admin_set_battery_active(p_id uuid, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     public.battery_catalog%rowtype;
  v_found   boolean;
  v_missing text[] := '{}';
begin
  if not platform.is_admin() then
    raise exception 'public.admin_set_battery_active: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select * into v_row from public.battery_catalog where id = p_id for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if p_active then
    if v_row.usable_capacity_kwh is null then
      v_missing := v_missing || 'usable_capacity_kwh'::text;
    end if;
    if v_row.max_power_kw is null then
      v_missing := v_missing || 'max_power_kw'::text;
    end if;
    if v_row.round_trip_efficiency is null then
      v_missing := v_missing || 'round_trip_efficiency'::text;
    end if;
    if v_row.rte_source is null then
      v_missing := v_missing || 'rte_source'::text;
    end if;
    if v_row.list_price_net is null then
      v_missing := v_missing || 'list_price_net'::text;
    end if;
    if v_row.inverter_included is null then
      v_missing := v_missing || 'inverter_included'::text;
    end if;
    if v_row.requires_foundation is null then
      v_missing := v_missing || 'requires_foundation'::text;
    end if;
    if v_row.inverter_included is false and v_row.extra_inverter_cost_net is null then
      v_missing := v_missing || 'extra_inverter_cost_net'::text;
    end if;

    if v_row.requires_foundation is true then
      if v_row.foundation_component_id is null then
        v_missing := v_missing || 'foundation_component_id'::text;
      else
        select price_net is not null into v_found
          from public.battery_cost_components where id = v_row.foundation_component_id;
        if not coalesce(v_found, false) then
          v_missing := v_missing || 'foundation_component_price_net'::text;
        end if;
      end if;
    end if;

    if array_length(v_missing, 1) is not null then
      return jsonb_build_object('status', 'incomplete', 'missing', to_jsonb(v_missing));
    end if;
  end if;

  update public.battery_catalog set active = p_active where id = p_id;

  return jsonb_build_object('status', case when p_active then 'activated' else 'deactivated' end);
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — memodo 16259 entfällt
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- „2x SolarEdge CSS-OD 102.4 kWh/50 kW": 184,32 kWh nutzbar / 100 kW für 57.000 €. Memodo 15921
-- („SolarEdge CSS-OD 197 kWh/100 kW") bietet bei gleicher Leistung 187,15 kWh für 47.000 € — mehr
-- Kapazität, 10.000 € billiger, und beides vom selben Hersteller. Die Zeile ist damit in JEDER
-- Auslegung dominiert: der Rechner könnte sie nie empfehlen, und stehenzulassen hiesse, eine
-- Kenndatenpflege und eine Fundament-Entscheidung an ihr zu unterhalten, die nie etwas trägt.
-- Vor dem Backfill, damit sie keine Wirkungsgrad-Annahme mehr bekommt.
delete from public.battery_catalog where memodo_id = 16259;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — Die Herkunft für den Bestand
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- Fox ESS G-Max: das Datenblatt führt „Round Trip Efficiency [%] >89" unter GENERAL DATA, direkt
-- hinter dem AC-DATA-Block — ein Systemwert über beide Richtungen, kein PCS-Spitzenwirkungsgrad.
-- Damit ist es der einzige belegte Wirkungsgrad im ganzen Katalog.
update public.battery_catalog
   set rte_source = 'datenblatt'
 where memodo_id = 12956;

-- Pylontech OPTIM: 0,931 war das Produkt zweier GRENZWERTE (Batterie >95 % x PCS-CEC 98 %) und
-- enthielt nur EINEN Umrichterdurchgang — als beste denkbare Obergrenze also systematisch zu hoch.
-- Der alte Rechenweg bleibt in `notes` lesbar, damit die Ersetzung nachvollziehbar ist.
update public.battery_catalog
   set round_trip_efficiency = 0.88,
       rte_source = 'annahme',
       notes = notes || ' K2c: Wirkungsgrad auf 0,88 gesetzt (Annahme) — ersetzt: Obergrenze, '
                        '1 Umrichterdurchgang.'
 where memodo_id = 14238;

-- Alles Uebrige mit Kenndaten und ohne Wirkungsgrad. Die Datenblaetter dieser Geraete nennen
-- durchweg nur den Spitzenwirkungsgrad des Wechselrichters — eine Zahl, die den Batterie- und den
-- Standby-Anteil gar nicht enthaelt und als Round-Trip um Laengen zu gut waere.
--
-- ⚠ 0,88 steht hier EINMAL und ausdruecklich NICHT als Spaltenvorgabe: eine kuenftige Zeile soll
-- leer bleiben, bis jemand sie beurteilt hat, statt still den Erfahrungswert zu erben.
update public.battery_catalog
   set round_trip_efficiency = 0.88,
       rte_source = 'annahme',
       notes = coalesce(notes || ' ', '')
               || 'K2c: Wirkungsgrad 0,88 als Annahme gesetzt (AC-Systemwirkungsgrad, kein '
                  'Datenblattwert).'
 where usable_capacity_kwh is not null
   and round_trip_efficiency is null;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 5 — Drei Fundament-Urteile nachgetragen
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Bei allen dreien stand „Aufstellungsart im Datenblatt nicht benannt" — das war eine Aussage über
-- das Datenblatt, nicht über das Gerät. Alle drei sind Aussenschränke der mittleren Klasse
-- (Pylontech 260 kWh, Sungrow ST255 257 kWh, Sungrow ST225 225 kWh) und brauchen dieselbe
-- Bodenplatte wie die bereits zugeordneten SMA- und SolarEdge-Schränke dieser Grösse.
--
-- ⚠ Der Weg führt wie in K1b über `public.admin_update_battery`, nicht über ein direktes UPDATE:
-- die Zuordnung ist eine Admin-Entscheidung, und sie soll denselben Weg nehmen wie die Oberfläche
-- (samt Art-Prüfung). Nebenbei ist das der erste echte Aufruf der neuen Signatur (Arbeitsregel 2).

update public.battery_catalog
   set notes = notes || ' K2c: Fundament-Urteil nachgetragen — Aussenschrank der mittleren Klasse.'
 where memodo_id in (14238, 15106, 12957);

do $$
declare
  v_admin  uuid;
  v_mittel uuid;
  v_row    public.battery_catalog%rowtype;
  v_result jsonb;
begin
  select user_id into v_admin from platform.user_roles where role = 'admin' limit 1;
  if v_admin is null then
    raise notice 'K2c: kein Admin-Konto gefunden — die Zuordnung unterbleibt.';
    return;
  end if;

  select id into v_mittel from public.battery_cost_components
   where bezeichnung = 'Outdoor-Schrank ~190–260 kWh';

  -- ⚠ NUR die JWT-Angabe, KEIN Rollenwechsel (Begründung im Kopf des K1b-DO-Blocks).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  for v_row in
    select * from public.battery_catalog where memodo_id in (14238, 15106, 12957) order by memodo_id
  loop
    v_result := public.admin_update_battery(
      p_id                        => v_row.id,
      p_kategorie                 => v_row.kategorie,
      p_hersteller                => v_row.hersteller,
      p_bezeichnung               => v_row.bezeichnung,
      p_memodo_id                 => v_row.memodo_id,
      p_usable_capacity_kwh       => v_row.usable_capacity_kwh,
      p_max_power_kw              => v_row.max_power_kw,
      p_round_trip_efficiency     => v_row.round_trip_efficiency,
      p_rte_source                => v_row.rte_source,
      p_list_price_net            => v_row.list_price_net,
      p_inverter_included         => v_row.inverter_included,
      p_extra_inverter_cost_net   => v_row.extra_inverter_cost_net,
      p_requires_foundation       => true,
      p_foundation_component_id   => v_mittel,
      p_installation_component_id => v_row.installation_component_id,
      p_price_as_of               => v_row.price_as_of,
      p_source_url                => v_row.source_url,
      p_datasheet_url             => v_row.datasheet_url,
      p_control_type              => v_row.control_type,
      p_notes                     => v_row.notes
    );

    if v_result->>'status' <> 'updated' then
      raise exception 'K2c: Zuordnung fuer memodo_id % abgewiesen: %', v_row.memodo_id, v_result;
    end if;
  end loop;
end $$;
