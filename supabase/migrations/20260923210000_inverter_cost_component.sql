-- H1: Der Wechselrichter wird ein Kostenbaustein, wie Fundament und Installation (K1b).
--
-- Ein Heimspeicher ohne eingebauten Umrichter braucht einen Wechselrichter, und der ist eine
-- Leistungsklasse, keine Eigenschaft des Geräts — dasselbe Argument wie beim Fundament. Aus dem
-- Betrag `battery_catalog.extra_inverter_cost_net` wird deshalb ein Verweis auf einen Baustein der
-- Art `wechselrichter`, der zusätzlich seine Nennleistung trägt: der Wechselrichter begrenzt die
-- Lade-/Entladeleistung des Systems, und der Rechner nimmt das Minimum aus Speicher und Umrichter.
--
-- Vorbedingung (23.09.2026 gegen Produktion gemessen, als `anon` und als Admin über die Wrapper):
-- genau EIN Gerät trug einen Aufpreis — Dyness BF100-C100 (memodo 14646, aktiv, 4.500 €, 64 kW).
-- Alle 33 übrigen aktiven Geräte tragen `inverter_included = true` mit 0. Der Aufpreis wird in
-- TEIL 5 in einen eigenen Baustein überführt, BEVOR die Spalte in TEIL 6 entfällt.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — Die Bausteine bekommen die Art `wechselrichter` und eine Nennleistung
-- ════════════════════════════════════════════════════════════════════════════════════════════════

alter table public.battery_cost_components
  drop constraint battery_cost_components_art_check;

alter table public.battery_cost_components
  add constraint battery_cost_components_art_check
    check (art in ('fundament', 'installation', 'wechselrichter')),
  add column leistung_kw numeric,
  -- Pflicht genau bei `wechselrichter`: ohne Nennleistung liesse sich die Systemleistung nicht
  -- begrenzen, und bei einem Fundament wäre eine kW-Zahl eine Angabe ohne Bedeutung.
  add constraint battery_cost_components_leistung_check
    check ((art = 'wechselrichter') = (leistung_kw is not null) and (leistung_kw is null or leistung_kw > 0));

comment on column public.battery_cost_components.leistung_kw is
  'H1: Nennleistung (AC, kW) eines Wechselrichter-Bausteins. Pflicht bei art = wechselrichter, '
  'sonst NULL (CHECK). Begrenzt im Rechner die Systemleistung: min(max_power_kw, leistung_kw).';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — Das Gerät verweist auf seinen Wechselrichter
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- `on delete restrict` aus demselben Grund wie bei Fundament und Installation (K1b TEIL 2).

alter table public.battery_catalog
  add column inverter_component_id uuid references public.battery_cost_components (id) on delete restrict;

comment on column public.battery_catalog.inverter_component_id is
  'H1: der Wechselrichter-Baustein eines Geräts ohne eingebauten Umrichter. Zum Freigeben Pflicht, '
  'sobald inverter_included = false (Trigger battery_catalog_guard_components); bei '
  'inverter_included = true gesperrt.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — Die beiden K1b-Trigger kennen den dritten Verweis
-- ════════════════════════════════════════════════════════════════════════════════════════════════

create or replace function public.battery_catalog_guard_components()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_art      text;
  v_price    numeric;
  v_leistung numeric;
begin
  if new.foundation_component_id is not null then
    select art, price_net into v_art, v_price
      from public.battery_cost_components where id = new.foundation_component_id;
    if v_art <> 'fundament' then
      raise exception 'battery_catalog: foundation_component_id verweist auf einen Baustein der Art %, erwartet wird fundament', v_art
        using errcode = '22023';
    end if;
    if new.active and new.requires_foundation is true and v_price is null then
      raise exception 'battery_catalog: das Geraet ist fundamentpflichtig und der zugeordnete Fundament-Baustein hat keinen Preis'
        using errcode = '23514';
    end if;
  end if;

  if new.installation_component_id is not null then
    select art into v_art
      from public.battery_cost_components where id = new.installation_component_id;
    if v_art <> 'installation' then
      raise exception 'battery_catalog: installation_component_id verweist auf einen Baustein der Art %, erwartet wird installation', v_art
        using errcode = '22023';
    end if;
  end if;

  if new.inverter_component_id is not null then
    -- Ein zugeordneter Wechselrichter bei eingebautem Umrichter würde nie gerechnet, hielte den
    -- Baustein aber als „genutzt" fest — gesperrt, statt still mitgeführt.
    if new.inverter_included is true then
      raise exception 'battery_catalog: das Geraet hat einen eingebauten Wechselrichter, ein Wechselrichter-Baustein ist nicht zulaessig'
        using errcode = '22023';
    end if;
    select art, price_net, leistung_kw into v_art, v_price, v_leistung
      from public.battery_cost_components where id = new.inverter_component_id;
    if v_art <> 'wechselrichter' then
      raise exception 'battery_catalog: inverter_component_id verweist auf einen Baustein der Art %, erwartet wird wechselrichter', v_art
        using errcode = '22023';
    end if;
    if new.active and (v_price is null or v_leistung is null) then
      raise exception 'battery_catalog: der zugeordnete Wechselrichter-Baustein hat keinen Preis oder keine Nennleistung'
        using errcode = '23514';
    end if;
  end if;

  if new.active and new.requires_foundation is true and new.foundation_component_id is null then
    raise exception 'battery_catalog: das Geraet ist fundamentpflichtig und hat keinen Fundament-Baustein zugeordnet'
      using errcode = '23514';
  end if;

  if new.active and new.inverter_included is false and new.inverter_component_id is null then
    raise exception 'battery_catalog: das Geraet hat keinen eingebauten Wechselrichter und keinen Wechselrichter-Baustein zugeordnet'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.battery_catalog_guard_components() is
  'K1b/H1: (a) ein zugeordneter Baustein hat die passende Art, immer; (b) ein AKTIVES '
  'fundamentpflichtiges Geraet hat einen Fundament-Baustein MIT Preis; (c) ein AKTIVES Geraet ohne '
  'eingebauten Wechselrichter hat einen Wechselrichter-Baustein MIT Preis und Nennleistung, und '
  'ein Geraet MIT eingebautem Wechselrichter hat keinen. Gilt auch fuer service_role und postgres.';

create or replace function public.battery_cost_components_guard_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used_by text;
begin
  if old.price_net is not null and new.price_net is null then
    select string_agg(b.bezeichnung, ', ' order by b.bezeichnung) into v_used_by
      from public.battery_catalog b
     where b.active
       and (b.foundation_component_id = old.id or b.installation_component_id = old.id
            or b.inverter_component_id = old.id);
    if v_used_by is not null then
      raise exception 'battery_cost_components: der Preis kann nicht entfallen, der Baustein wird von aktiven Geraeten genutzt (%)', v_used_by
        using errcode = '23514';
    end if;
  end if;

  if new.art is distinct from old.art
     and exists (select 1 from public.battery_catalog b
                  where b.foundation_component_id = old.id or b.installation_component_id = old.id
                     or b.inverter_component_id = old.id) then
    raise exception 'battery_cost_components: die Art kann nicht geaendert werden, der Baustein ist Geraeten zugeordnet'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — Die Wrapper ziehen nach
-- ════════════════════════════════════════════════════════════════════════════════════════════════

create or replace function public.admin_list_cost_components(p_art text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_list_cost_components: Adminrolle erforderlich' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.art, r.bezeichnung), '[]'::jsonb) into v_rows
  from (
    select c.*,
           (select count(*) from public.battery_catalog b
             where b.foundation_component_id = c.id or b.installation_component_id = c.id
                or b.inverter_component_id = c.id) as used_by_count,
           (select count(*) from public.battery_catalog b
             where b.active and (b.foundation_component_id = c.id or b.installation_component_id = c.id
                                 or b.inverter_component_id = c.id)) as used_by_active_count
      from public.battery_cost_components c
     where p_art is null or c.art = p_art
  ) r;

  return v_rows;
end;
$$;

create or replace function public.admin_get_cost_component(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_get_cost_component: Adminrolle erforderlich' using errcode = '42501';
  end if;

  select to_jsonb(r) into v_row
  from (
    select c.*,
           (select count(*) from public.battery_catalog b
             where b.foundation_component_id = c.id or b.installation_component_id = c.id
                or b.inverter_component_id = c.id) as used_by_count,
           (select count(*) from public.battery_catalog b
             where b.active and (b.foundation_component_id = c.id or b.installation_component_id = c.id
                                 or b.inverter_component_id = c.id)) as used_by_active_count
      from public.battery_cost_components c where c.id = p_id
  ) r;

  if v_row is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  return v_row;
end;
$$;

drop function public.admin_create_cost_component(text, text, text, numeric, date, text);

create function public.admin_create_cost_component(
  p_art text,
  p_bezeichnung text,
  p_beschreibung text default null,
  p_price_net numeric default null,
  p_price_as_of date default null,
  p_notes text default null,
  p_leistung_kw numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_art         text := lower(nullif(btrim(p_art), ''));
  v_bezeichnung text := nullif(btrim(p_bezeichnung), '');
  v_leistung    numeric;
  v_id          uuid;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_create_cost_component: Adminrolle erforderlich' using errcode = '42501';
  end if;
  if v_art is null or v_bezeichnung is null then
    return jsonb_build_object('status', 'missing_fields');
  end if;
  if v_art not in ('fundament', 'installation', 'wechselrichter') then
    return jsonb_build_object('status', 'invalid_art');
  end if;
  if p_price_net is not null and p_price_net < 0 then
    return jsonb_build_object('status', 'invalid_price');
  end if;
  -- Benannt statt als 23514: die Oberfläche soll das kW-Feld markieren können.
  if v_art = 'wechselrichter' and (p_leistung_kw is null or p_leistung_kw <= 0) then
    return jsonb_build_object('status', 'invalid_leistung');
  end if;
  v_leistung := case when v_art = 'wechselrichter' then p_leistung_kw end;

  insert into public.battery_cost_components (art, bezeichnung, beschreibung, price_net, price_as_of, notes, leistung_kw)
  values (v_art, v_bezeichnung, nullif(btrim(p_beschreibung), ''), p_price_net, p_price_as_of,
          nullif(btrim(p_notes), ''), v_leistung)
  returning id into v_id;

  return jsonb_build_object('status', 'created', 'id', v_id);
end;
$$;

drop function public.admin_update_cost_component(uuid, text, text, text, numeric, date, text);

create function public.admin_update_cost_component(
  p_id uuid,
  p_art text,
  p_bezeichnung text,
  p_beschreibung text default null,
  p_price_net numeric default null,
  p_price_as_of date default null,
  p_notes text default null,
  p_leistung_kw numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_art         text := lower(nullif(btrim(p_art), ''));
  v_bezeichnung text := nullif(btrim(p_bezeichnung), '');
  v_leistung    numeric;
  v_count       integer;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_update_cost_component: Adminrolle erforderlich' using errcode = '42501';
  end if;
  if v_art is null or v_bezeichnung is null then
    return jsonb_build_object('status', 'missing_fields');
  end if;
  if v_art not in ('fundament', 'installation', 'wechselrichter') then
    return jsonb_build_object('status', 'invalid_art');
  end if;
  if p_price_net is not null and p_price_net < 0 then
    return jsonb_build_object('status', 'invalid_price');
  end if;
  -- Vor dem UPDATE geprüft: der Leistungs-CHECK schlüge sonst als check_violation durch und
  -- landete unten als `in_use`, was eine falsche Begründung wäre.
  if v_art = 'wechselrichter' and (p_leistung_kw is null or p_leistung_kw <= 0) then
    return jsonb_build_object('status', 'invalid_leistung');
  end if;
  v_leistung := case when v_art = 'wechselrichter' then p_leistung_kw end;

  begin
    update public.battery_cost_components set
      art          = v_art,
      bezeichnung  = v_bezeichnung,
      beschreibung = nullif(btrim(p_beschreibung), ''),
      price_net    = p_price_net,
      price_as_of  = p_price_as_of,
      notes        = nullif(btrim(p_notes), ''),
      leistung_kw  = v_leistung
    where id = p_id;
    get diagnostics v_count = row_count;
  exception when check_violation then
    return jsonb_build_object('status', 'in_use', 'detail', sqlerrm);
  end;

  if v_count = 0 then
    return jsonb_build_object('status', 'not_found');
  end if;
  return jsonb_build_object('status', 'updated');
end;
$$;

-- Die Leser liefern den Wechselrichter wie die beiden anderen Bausteine mit (K1b TEIL 6).
create or replace function public.admin_list_battery_catalog(
  p_kategorie text default null,
  p_active boolean default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_list_battery_catalog: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.hersteller, r.bezeichnung), '[]'::jsonb)
    into v_rows
  from (
    select b.*,
           pp.purchase_price_net,
           pp.as_of as purchase_price_as_of,
           fc.bezeichnung as foundation_component_label,
           fc.price_net   as foundation_component_price_net,
           ic.bezeichnung as installation_component_label,
           ic.price_net   as installation_component_price_net,
           wc.bezeichnung as inverter_component_label,
           wc.price_net   as inverter_component_price_net,
           wc.leistung_kw as inverter_component_leistung_kw
      from public.battery_catalog b
      left join platform.battery_purchase_prices pp on pp.battery_id = b.id
      left join public.battery_cost_components fc on fc.id = b.foundation_component_id
      left join public.battery_cost_components ic on ic.id = b.installation_component_id
      left join public.battery_cost_components wc on wc.id = b.inverter_component_id
      where (p_kategorie is null or b.kategorie = p_kategorie)
        and (p_active is null or b.active = p_active)
  ) r;

  return v_rows;
end;
$$;

create or replace function public.admin_get_battery(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_get_battery: Adminrolle erforderlich' using errcode = '42501';
  end if;

  select to_jsonb(r) into v_row
  from (
    select b.*,
           pp.purchase_price_net,
           pp.as_of as purchase_price_as_of,
           fc.bezeichnung as foundation_component_label,
           fc.price_net   as foundation_component_price_net,
           ic.bezeichnung as installation_component_label,
           ic.price_net   as installation_component_price_net,
           wc.bezeichnung as inverter_component_label,
           wc.price_net   as inverter_component_price_net,
           wc.leistung_kw as inverter_component_leistung_kw
      from public.battery_catalog b
      left join platform.battery_purchase_prices pp on pp.battery_id = b.id
      left join public.battery_cost_components fc on fc.id = b.foundation_component_id
      left join public.battery_cost_components ic on ic.id = b.installation_component_id
      left join public.battery_cost_components wc on wc.id = b.inverter_component_id
     where b.id = p_id
  ) r;

  if v_row is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  return jsonb_build_object('status', 'ok', 'battery', v_row);
end;
$$;

drop function public.admin_create_battery(
  text, text, text, integer, numeric, numeric, numeric, text, numeric, boolean, numeric,
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
  p_inverter_component_id uuid default null,
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
  if v_rte_source is not null and p_round_trip_efficiency is null then
    return jsonb_build_object('status', 'rte_source_without_value');
  end if;

  begin
    insert into public.battery_catalog (
      kategorie, hersteller, bezeichnung, memodo_id, usable_capacity_kwh, max_power_kw,
      round_trip_efficiency, rte_source, list_price_net, inverter_included,
      inverter_component_id, requires_foundation, foundation_component_id,
      installation_component_id, price_as_of, source_url, datasheet_url, control_type, notes
    ) values (
      v_kategorie, v_hersteller, v_bezeichnung, p_memodo_id, p_usable_capacity_kwh, p_max_power_kw,
      p_round_trip_efficiency, v_rte_source, p_list_price_net, p_inverter_included,
      p_inverter_component_id, p_requires_foundation, p_foundation_component_id,
      p_installation_component_id, p_price_as_of, nullif(btrim(p_source_url), ''),
      nullif(btrim(p_datasheet_url), ''), v_control_type, nullif(btrim(p_notes), '')
    ) returning id into v_id;
  exception
    when unique_violation then
      return jsonb_build_object('status', 'duplicate_memodo_id');
    when invalid_parameter_value then
      return jsonb_build_object('status', 'invalid_component', 'detail', sqlerrm);
    when foreign_key_violation then
      return jsonb_build_object('status', 'unknown_component');
    when check_violation then
      return jsonb_build_object('status', 'invalid_values', 'detail', sqlerrm);
  end;

  return jsonb_build_object('status', 'created', 'id', v_id);
end;
$$;

drop function public.admin_update_battery(
  uuid, text, text, text, integer, numeric, numeric, numeric, text, numeric, boolean, numeric,
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
  p_inverter_component_id uuid default null,
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
      inverter_component_id     = p_inverter_component_id,
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
    when check_violation then
      get stacked diagnostics v_constraint = constraint_name;
      -- Der Freigabe-Trigger wirft ohne Constraint-Namen; auch er heisst „einer aktiven Zeile
      -- fehlt jetzt etwas" und nicht „Wert unmöglich".
      if v_constraint = 'battery_catalog_active_complete' or coalesce(v_constraint, '') = '' then
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

create or replace function public.admin_set_battery_active(p_id uuid, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row      public.battery_catalog%rowtype;
  v_found    boolean;
  v_price    numeric;
  v_leistung numeric;
  v_missing  text[] := '{}';
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

    if v_row.inverter_included is false then
      if v_row.inverter_component_id is null then
        v_missing := v_missing || 'inverter_component_id'::text;
      else
        select price_net, leistung_kw into v_price, v_leistung
          from public.battery_cost_components where id = v_row.inverter_component_id;
        if v_price is null then
          v_missing := v_missing || 'inverter_component_price_net'::text;
        end if;
        if v_leistung is null then
          v_missing := v_missing || 'inverter_component_leistung_kw'::text;
        end if;
      end if;
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

-- DROP+CREATE vergibt EXECUTE an PUBLIC — der revoke wird deshalb für jede neu angelegte Funktion
-- mitgeschrieben (K1b-Regression, s. Migration 20260923090000).
revoke all on function public.admin_create_cost_component(text, text, text, numeric, date, text, numeric)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_update_cost_component(uuid, text, text, text, numeric, date, text, numeric)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_create_battery(
  text, text, text, integer, numeric, numeric, numeric, text, numeric, boolean, uuid,
  boolean, uuid, uuid, date, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_update_battery(
  uuid, text, text, text, integer, numeric, numeric, numeric, text, numeric, boolean, uuid,
  boolean, uuid, uuid, date, text, text, text, text) from public, anon, authenticated, service_role;

grant execute on function public.admin_create_cost_component(text, text, text, numeric, date, text, numeric)
  to authenticated;
grant execute on function public.admin_update_cost_component(uuid, text, text, text, numeric, date, text, numeric)
  to authenticated;
grant execute on function public.admin_create_battery(
  text, text, text, integer, numeric, numeric, numeric, text, numeric, boolean, uuid,
  boolean, uuid, uuid, date, text, text, text, text) to authenticated;
grant execute on function public.admin_update_battery(
  uuid, text, text, text, integer, numeric, numeric, numeric, text, numeric, boolean, uuid,
  boolean, uuid, uuid, date, text, text, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 5 — Bestand: Dyness überführen, drei Heim-Klassen anlegen, 27 Heimgeräte zuordnen
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Wie in K1b/K2c über die Wrapper und mit der Admin-JWT (Admin-Entscheidung, derselbe Weg wie die
-- Oberfläche). Heim-Preise: Median der öffentlichen memodo.at-Produktdaten vom 23.09.2026 für
-- 3-phasige Hybrid-Wechselrichter genau dieser Nennleistung von Fronius, SMA, Kostal, Sungrow,
-- GoodWe und Fox ESS; die einbezogenen Artikel stehen in `notes`.

do $$
declare
  v_admin   uuid;
  v_dyness  uuid;
  v_wr5     uuid;
  v_wr8     uuid;
  v_wr10    uuid;
  v_target  uuid;
  v_row     public.battery_catalog%rowtype;
  v_result  jsonb;
  v_memodo  int;
  v_extra   numeric;
begin
  -- Die Vorbedingung wird hier noch einmal durchgesetzt: ein weiterer Aufpreis ginge mit dem
  -- DROP COLUMN in TEIL 6 still verloren.
  if exists (select 1 from public.battery_catalog
              where coalesce(extra_inverter_cost_net, 0) <> 0 and memodo_id is distinct from 14646) then
    raise exception 'H1: weiterer Wechselrichter-Aufpreis ausser memodo 14646 vorhanden — Migration abgebrochen';
  end if;

  select user_id into v_admin from platform.user_roles where role = 'admin' limit 1;
  if v_admin is null then
    raise notice 'H1: kein Admin-Konto gefunden — Bausteine und Zuordnungen unterbleiben.';
    return;
  end if;

  -- ⚠ NUR die JWT-Angabe, KEIN Rollenwechsel (Begründung im Kopf des K1b-DO-Blocks).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- ── Dyness BF100-C100 ────────────────────────────────────────────────────────────────────────
  select * into v_row from public.battery_catalog where memodo_id = 14646;
  v_extra := v_row.extra_inverter_cost_net;
  if v_row.id is not null and coalesce(v_extra, 0) <> 0 then
    if v_row.max_power_kw is null then
      raise exception 'H1: memodo 14646 hat keine max_power_kw — Nennleistung des Bausteins unbestimmt';
    end if;
    v_result := public.admin_create_cost_component(
      p_art         => 'wechselrichter',
      p_bezeichnung => 'Batterie-Wechselrichter für Dyness BF100-C100',
      p_price_net   => v_extra,
      p_price_as_of => date '2026-09-23',
      p_notes       => 'Überführt aus extra_inverter_cost_net (von Andreas im Admin eingetragen, '
                       '23.09.2026); Nennleistung = Geräteleistung, keine eigene WR-Angabe.',
      p_leistung_kw => v_row.max_power_kw
    );
    if v_result->>'status' <> 'created' then
      raise exception 'H1: Dyness-Baustein abgewiesen: %', v_result;
    end if;
    v_dyness := (v_result->>'id')::uuid;

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
      p_inverter_component_id     => v_dyness,
      p_requires_foundation       => v_row.requires_foundation,
      p_foundation_component_id   => v_row.foundation_component_id,
      p_installation_component_id => v_row.installation_component_id,
      p_price_as_of               => v_row.price_as_of,
      p_source_url                => v_row.source_url,
      p_datasheet_url             => v_row.datasheet_url,
      p_control_type              => v_row.control_type,
      p_notes                     => v_row.notes
    );
    if v_result->>'status' <> 'updated' then
      raise exception 'H1: Zuordnung fuer memodo 14646 abgewiesen: %', v_result;
    end if;
  end if;

  -- ── Die drei Heim-Klassen ────────────────────────────────────────────────────────────────────
  v_result := public.admin_create_cost_component(
    p_art          => 'wechselrichter',
    p_bezeichnung  => 'Hybrid-Wechselrichter 3-phasig 5 kW',
    p_beschreibung => 'Zusatz-Wechselrichter für Heimspeicher ohne eingebauten Umrichter bis 7 kWh Nennkapazität.',
    p_price_net    => 1172,
    p_price_as_of  => date '2026-09-23',
    p_notes        => 'Median der öffentlichen memodo.at-Produktdaten (7 Artikel, AC 5 kW, 3-phasig): '
                      '8249 GoodWe ET Plus 16A GW5KN-ET 525; 7179 SMA Sunny Tripower 5.0 Smart Energy 619; '
                      '16359 Sungrow SH5T 885; 14954 GoodWe ESA 5 kW GW5K-ETA-G20 1172; '
                      '15957 Fox ESS Stackable AIO 5.0 kW 1329; 12852 Fox ESS H3-5.0-Smart 1342; '
                      '15144 Fronius Symo GEN24 5.0 Plus SC 1656. Der Shop zeigt „Preis auf Anfrage"; '
                      'der Preis stammt aus dem öffentlich ausgelieferten Produktdatensatz der Seite.',
    p_leistung_kw  => 5
  );
  if v_result->>'status' <> 'created' then raise exception 'H1: 5-kW-Baustein abgewiesen: %', v_result; end if;
  v_wr5 := (v_result->>'id')::uuid;

  v_result := public.admin_create_cost_component(
    p_art          => 'wechselrichter',
    p_bezeichnung  => 'Hybrid-Wechselrichter 3-phasig 8 kW',
    p_beschreibung => 'Zusatz-Wechselrichter für Heimspeicher ohne eingebauten Umrichter über 7 bis 12 kWh Nennkapazität.',
    p_price_net    => 1330.5,
    p_price_as_of  => date '2026-09-23',
    p_notes        => 'Median der öffentlichen memodo.at-Produktdaten (8 Artikel, AC 8 kW, 3-phasig): '
                      '8251 GoodWe ET Plus 16A GW8KN-ET 540; 15541 Sungrow SH8T 1035; '
                      '12854 Fox ESS H3-8.0-Smart 1208; 14966 GoodWe ESA 8 kW GW8K-ETA-G20 1236; '
                      '15958 Fox ESS Stackable AIO 8.0 kW 1425; 7181 SMA Sunny Tripower 8.0 Smart Energy 1599; '
                      '4956 Fronius Symo GEN24 8.0 Plus 2209; 15146 Fronius Symo GEN24 8.0 Plus SC 2271. '
                      'Der Shop zeigt „Preis auf Anfrage"; der Preis stammt aus dem öffentlich '
                      'ausgelieferten Produktdatensatz der Seite.',
    p_leistung_kw  => 8
  );
  if v_result->>'status' <> 'created' then raise exception 'H1: 8-kW-Baustein abgewiesen: %', v_result; end if;
  v_wr8 := (v_result->>'id')::uuid;

  v_result := public.admin_create_cost_component(
    p_art          => 'wechselrichter',
    p_bezeichnung  => 'Hybrid-Wechselrichter 3-phasig 10 kW',
    p_beschreibung => 'Zusatz-Wechselrichter für Heimspeicher ohne eingebauten Umrichter über 12 kWh Nennkapazität.',
    p_price_net    => 1449,
    p_price_as_of  => date '2026-09-23',
    p_notes        => 'Median der öffentlichen memodo.at-Produktdaten (11 Artikel, AC 10 kW, 3-phasig): '
                      '8252 GoodWe ET Plus 16A GW10KN-ET 575; 11106 Sungrow SH10RT-20 795; '
                      '15493 Sungrow SH10T V11 1121; 12856 Fox ESS H3-10.0-Smart 1231; '
                      '14967 GoodWe ESA 10 kW GW10K-ETA-G20 1276; 15959 Fox ESS Stackable AIO 10.0 kW 1449; '
                      '8082 Kostal Plenticore plus 10 G2 1496; 7182 SMA Sunny Tripower 10.0 Smart Energy 1729; '
                      '10282 Fronius Symo GEN24 10.0 SC 1769; 4957 Fronius Symo GEN24 10.0 Plus 2307; '
                      '15147 Fronius Symo GEN24 10.0 Plus SC 2370. Der Shop zeigt „Preis auf Anfrage"; '
                      'der Preis stammt aus dem öffentlich ausgelieferten Produktdatensatz der Seite.',
    p_leistung_kw  => 10
  );
  if v_result->>'status' <> 'created' then raise exception 'H1: 10-kW-Baustein abgewiesen: %', v_result; end if;
  v_wr10 := (v_result->>'id')::uuid;

  -- ── 27 Heimgeräte ────────────────────────────────────────────────────────────────────────────
  -- Klasse nach der Nennkapazität in der Bezeichnung: ≤ 7 kWh → 5 kW, ≤ 12 kWh → 8 kW, sonst 10 kW.
  -- E3/DC one (15713/15744/15745) hat den Umrichter eingebaut und bekommt keinen Baustein.
  foreach v_memodo in array array[
    13189, 10522, 14144, 14483, 12659, 12789, 14468,              -- 5 kW
    13190, 10523, 14147, 14484, 6765, 13061, 14529, 13572, 6598,  -- 8 kW
    13196, 10525, 14148, 14486, 6769, 13063, 14532, 13573,        -- 10 kW
    15713, 15744, 15745                                           -- E3/DC, eingebaut
  ] loop
    v_target := case
      when v_memodo in (13189, 10522, 14144, 14483, 12659, 12789, 14468) then v_wr5
      when v_memodo in (13190, 10523, 14147, 14484, 6765, 13061, 14529, 13572, 6598) then v_wr8
      when v_memodo in (13196, 10525, 14148, 14486, 6769, 13063, 14532, 13573) then v_wr10
    end;

    select * into v_row from public.battery_catalog where memodo_id = v_memodo and kategorie = 'heim';
    if v_row.id is null then
      raise exception 'H1: Heimgeraet memodo % nicht gefunden', v_memodo;
    end if;

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
      p_inverter_included         => v_target is null,
      p_inverter_component_id     => v_target,
      p_requires_foundation       => v_row.requires_foundation,
      p_foundation_component_id   => v_row.foundation_component_id,
      p_installation_component_id => v_row.installation_component_id,
      p_price_as_of               => v_row.price_as_of,
      p_source_url                => v_row.source_url,
      p_datasheet_url             => v_row.datasheet_url,
      p_control_type              => v_row.control_type,
      p_notes                     => v_row.notes
    );
    if v_result->>'status' <> 'updated' then
      raise exception 'H1: Zuordnung fuer memodo % abgewiesen: %', v_memodo, v_result;
    end if;
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 6 — Der Betrag am Gerät entfällt
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Die Freigabe-Bedingung verliert ihre Aufpreis-Zeile; die Wechselrichter-Regel steht seit TEIL 3
-- im Trigger, weil sie wie das Fundament nach dem Preis einer anderen Zeile fragt.

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
    )
  );

alter table public.battery_catalog
  drop column extra_inverter_cost_net;
