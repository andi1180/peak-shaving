-- K4: Jedes Gerät bekommt seinen Installations-Baustein, und ohne bepreiste Installation gibt es
-- keine Freigabe mehr.
--
-- Bis hierher war der Installations-Baustein optional und die Engine rechnete ihn nicht mit —
-- jeder Report stand deshalb auf „exkl. Installation". Seit die Engine die Pauschale in die
-- Investition nimmt (`BatteryCandidate.installationCost`), verzerrt ein Gerät OHNE Installation
-- die Reihung: es sähe um die Pauschale billiger aus als seine Nachbarn.
--
-- Vorbedingung (26.09.2026 gegen Produktion gemessen): vier bepreiste Installations-Bausteine
-- („Heim", „Gewerbe 110", „Gewerbe 190–260", „Gewerbe 500"), von 0 Geräten genutzt; 149 Geräte
-- (61 aktiv). Die Zuordnung nach der Regel unten ergibt 115 / 23 / 10 / 1 und ist von Andreas
-- freigegeben — einschliesslich der einen Abweichung: Sungrow PowerKeeper ST50CF (49,9 kWh)
-- bekommt „Gewerbe 110" nach Kapazität, obwohl sein Fundament der Klasse ~190–260 angehört.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — Zuordnung
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Die Bausteine sind im Admin angelegt worden und existieren nur in der Cloud. Fehlt einer (frische
-- lokale DB), unterbleibt die Zuordnung, statt Bausteine ohne Preis zu erfinden.

do $$
declare
  v_heim uuid;
  v_110  uuid;
  v_190  uuid;
  v_500  uuid;
begin
  select id into v_heim from public.battery_cost_components where art = 'installation' and bezeichnung = 'Heim';
  select id into v_110  from public.battery_cost_components where art = 'installation' and bezeichnung = 'Gewerbe 110';
  select id into v_190  from public.battery_cost_components where art = 'installation' and bezeichnung = 'Gewerbe 190–260';
  select id into v_500  from public.battery_cost_components where art = 'installation' and bezeichnung = 'Gewerbe 500';

  if v_heim is null or v_110 is null or v_190 is null or v_500 is null then
    raise notice 'K4: Installations-Bausteine nicht vollständig vorhanden — keine Zuordnung.';
  else
    update public.battery_catalog
       set installation_component_id = case
             when kategorie = 'heim'          then v_heim
             when usable_capacity_kwh < 150   then v_110
             when usable_capacity_kwh <= 400  then v_190
             else v_500
           end
     where installation_component_id is null
       and (kategorie = 'heim' or usable_capacity_kwh is not null);
  end if;

  -- Die Regel aus TEIL 2 muss für den Bestand schon gelten, sonst stünde ein aktives Gerät still
  -- ausserhalb seiner eigenen Freigabe-Bedingung.
  if exists (
    select 1
      from public.battery_catalog b
      left join public.battery_cost_components c on c.id = b.installation_component_id
     where b.active and c.price_net is null
  ) then
    raise exception 'K4: aktive Geräte ohne bepreisten Installations-Baustein — Migration abgebrochen';
  end if;
end $$;

comment on column public.battery_catalog.installation_component_id is
  'K4: der Installations-Baustein. Zum Freigeben PFLICHT und bepreist (Trigger '
  'battery_catalog_guard_components); die Engine rechnet ihn als Installationspauschale in die '
  'Investition.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — Freigabe nur mit bepreister Installation
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
    select art, price_net into v_art, v_price
      from public.battery_cost_components where id = new.installation_component_id;
    if v_art <> 'installation' then
      raise exception 'battery_catalog: installation_component_id verweist auf einen Baustein der Art %, erwartet wird installation', v_art
        using errcode = '22023';
    end if;
    if new.active and v_price is null then
      raise exception 'battery_catalog: der zugeordnete Installations-Baustein hat keinen Preis'
        using errcode = '23514';
    end if;
  end if;

  if new.inverter_component_id is not null then
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

  if new.active and new.installation_component_id is null then
    raise exception 'battery_catalog: das Geraet hat keinen Installations-Baustein zugeordnet'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.battery_catalog_guard_components() is
  'K1b/H1/K4: (a) ein zugeordneter Baustein hat die passende Art, immer; (b) ein AKTIVES '
  'fundamentpflichtiges Geraet hat einen Fundament-Baustein MIT Preis; (c) ein AKTIVES Geraet ohne '
  'eingebauten Wechselrichter hat einen Wechselrichter-Baustein MIT Preis und Nennleistung, und '
  'ein Geraet MIT eingebautem Wechselrichter hat keinen; (d) ein AKTIVES Geraet hat einen '
  'Installations-Baustein MIT Preis. Gilt auch fuer service_role und postgres.';

-- Der Wrapper benennt die fehlenden Felder, bevor der Trigger mit 23514 abweist. Unverändert bis
-- auf den Installationsblock am Ende der Prüfliste.
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

    if v_row.installation_component_id is null then
      v_missing := v_missing || 'installation_component_id'::text;
    else
      select price_net is not null into v_found
        from public.battery_cost_components where id = v_row.installation_component_id;
      if not coalesce(v_found, false) then
        v_missing := v_missing || 'installation_component_price_net'::text;
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
