-- DE-Erweiterung Schritt 7a: Land an den Netzentgelten.
--
--   TEIL 1  public.grid_tariffs.country + CHECK (wortgleich zu platform.projects.country)
--   TEIL 2  Trigger: eine operator_id gehört genau EINEM Land, das Land ist ab Anlage fest
--   TEIL 3  create_grid_tariff / backfill_grid_tariff nehmen p_country (DROP+CREATE, Grants neu)
--
-- update_grid_tariff bleibt unverändert: es setzt `country` nicht, und sein Protokoll
-- (old_row/new_row über to_jsonb) enthält die neue Spalte von selbst.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — Spalte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Jede bestehende Zeile ist ein österreichisches Preisblatt; der Vorgabewert füllt sie mit 'AT'.
alter table public.grid_tariffs
  add column country text not null default 'AT'
    constraint grid_tariffs_country_check check (country in ('AT', 'DE'));

comment on column public.grid_tariffs.country is
  'Land des Netzbetreibers (ISO 3166-1 alpha-2), Liste wie platform.projects.country. Ab Anlage '
  'unveränderlich; eine operator_id gehört genau einem Land (Trigger grid_tariffs_operator_country). '
  'Der Leser der Analyse filtert auf das Projektland — ein AT-Betreiber im DE-Projekt findet keine Zeile.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — ein Betreiber, ein Land
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Als Trigger statt in den Wrappern, weil er so jeden Schreibweg trifft (create, backfill, update,
-- ein Eingriff von Hand) und es keine zweite Fassung der Regel gibt.
create function public.guard_grid_tariff_country()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.country is distinct from old.country then
    raise exception using errcode = 'P0001', message = 'country_immutable';
  end if;

  -- Zwei gleichzeitige Anlagen derselben Kennung mit verschiedenem Land sähen einander sonst nicht.
  perform pg_advisory_xact_lock(hashtext('grid_tariff_operator:' || new.operator_id));

  if exists (
    select 1
      from public.grid_tariffs t
     where t.operator_id = new.operator_id
       and t.country <> new.country
       and t.id <> new.id
  ) then
    raise exception using errcode = 'P0001', message = 'operator_country_mismatch';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_grid_tariff_country()
  from public, anon, authenticated, service_role;

create trigger grid_tariffs_operator_country
  before insert or update of operator_id, country on public.grid_tariffs
  for each row execute function public.guard_grid_tariff_country();

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — die zwei Anlage-Wrapper
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Rumpf wortgleich zur jüngsten Fassung (create: 20260923190000, backfill: 20260921120000), ergänzt
-- um p_country. Der SQL-Vorgabewert 'AT' existiert nur für Rückwärtskompatibilität bestehender
-- Aufrufer; der Admin-Bereich übergibt das Land immer ausdrücklich.
drop function public.create_grid_tariff(
  text, text, smallint, numeric, text, numeric, text, date, text, jsonb, text, numeric, text
);

create function public.create_grid_tariff(
  p_operator_id            text,
  p_operator_name          text,
  p_netzebene              smallint,
  p_grundpreis_amount      numeric,
  p_grundpreis_unit        text,
  p_netzverlust_ct_per_kwh numeric,
  p_price_basis            text,
  p_valid_from             date,
  p_created_by             text,
  p_windows                jsonb,
  p_metering_variant       text default null,
  p_messpreis_amount       numeric default null,
  p_messpreis_unit         text default null,
  p_country                text default 'AT'
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_latest_open  date;
  v_closed_until date := p_valid_from - 1;
  v_closed_ids   uuid[];
  v_new_id       uuid;
  v_windows      int;
begin
  if p_windows is null
     or jsonb_typeof(p_windows) <> 'array'
     or jsonb_array_length(p_windows) = 0 then
    return jsonb_build_object('status', 'no_windows');
  end if;

  if p_country is null or p_country not in ('AT', 'DE') then
    return jsonb_build_object('status', 'invalid_country');
  end if;

  perform pg_advisory_xact_lock(
    hashtext('grid_tariff:' || p_operator_id || ':' || p_netzebene::text ||
             ':' || coalesce(p_metering_variant, ''))
  );

  select array_agg(id), max(valid_from)
    into v_closed_ids, v_latest_open
    from (
      select id, valid_from
        from public.grid_tariffs
       where operator_id = p_operator_id
         and netzebene = p_netzebene
         and metering_variant is not distinct from p_metering_variant
         and valid_until is null
         for update
    ) offen;

  if v_latest_open is not null and p_valid_from <= v_latest_open then
    return jsonb_build_object(
      'status', 'invalid_valid_from',
      'open_valid_from', v_latest_open
    );
  end if;

  if v_closed_ids is not null then
    update public.grid_tariffs
       set valid_until = v_closed_until
     where id = any(v_closed_ids);
  end if;

  begin
    insert into public.grid_tariffs (
      operator_id, operator_name, netzebene, metering_variant,
      grundpreis_amount, grundpreis_unit, messpreis_amount, messpreis_unit,
      netzverlust_ct_per_kwh, price_basis,
      valid_from, created_by, country
    ) values (
      p_operator_id, p_operator_name, p_netzebene, p_metering_variant,
      p_grundpreis_amount, p_grundpreis_unit, p_messpreis_amount, p_messpreis_unit,
      p_netzverlust_ct_per_kwh, p_price_basis,
      p_valid_from, p_created_by, p_country
    )
    returning id into v_new_id;
  exception
    when unique_violation then
      raise exception using errcode = 'P0001', message = 'duplicate_valid_from';
    when check_violation then
      raise exception using errcode = 'P0001', message = 'invalid_input';
  end;

  begin
    insert into public.grid_tariff_rate_windows (
      grid_tariff_id, label, month_day_from, month_day_to, time_from, time_to, ct_per_kwh, note
    )
    select v_new_id, w.label, w.month_day_from, w.month_day_to, w.time_from, w.time_to,
           w.ct_per_kwh, nullif(btrim(w.note), '')
      from jsonb_to_recordset(p_windows) as w(
        label          text,
        month_day_from text,
        month_day_to   text,
        time_from      time,
        time_to        time,
        ct_per_kwh     numeric,
        note           text
      );
    get diagnostics v_windows = row_count;
  exception
    when data_exception or not_null_violation then
      raise exception using errcode = 'P0001', message = 'invalid_window';
  end;

  return jsonb_build_object(
    'status', 'created',
    'id', v_new_id,
    'window_count', v_windows,
    'closed_count', coalesce(array_length(v_closed_ids, 1), 0),
    'closed_valid_until', case when v_closed_ids is null then null else v_closed_until end
  );
end;
$$;

comment on function public.create_grid_tariff(
  text, text, smallint, numeric, text, numeric, text, date, text, jsonb, text, numeric, text, text
) is
  'Legt einen Netzentgelt-Stand an und schliesst die offene Vorgängerin derselben Kombination. '
  'Seit 20261015090000 mit p_country (AT|DE, Status invalid_country); ein Land, das der Kennung '
  'widerspricht, endet in P0001 operator_country_mismatch (Trigger). SECURITY INVOKER, service_role-only.';

revoke all on function public.create_grid_tariff(
  text, text, smallint, numeric, text, numeric, text, date, text, jsonb, text, numeric, text, text
) from public, anon, authenticated;

grant execute on function public.create_grid_tariff(
  text, text, smallint, numeric, text, numeric, text, date, text, jsonb, text, numeric, text, text
) to service_role;

drop function public.backfill_grid_tariff(
  text, smallint, numeric, text, numeric, text, date, text, jsonb, text, numeric, text
);

create function public.backfill_grid_tariff(
  p_operator_id            text,
  p_netzebene              smallint,
  p_grundpreis_amount      numeric,
  p_grundpreis_unit        text,
  p_netzverlust_ct_per_kwh numeric,
  p_price_basis            text,
  p_valid_from             date,
  p_created_by             text,
  p_windows                jsonb,
  p_metering_variant       text default null,
  p_messpreis_amount       numeric default null,
  p_messpreis_unit         text default null,
  p_country                text default 'AT'
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_oldest_from  date;
  v_oldest_id    uuid;
  v_operator     text;
  v_new_until    date;
  v_new_id       uuid;
  v_windows      int;
begin
  if p_windows is null
     or jsonb_typeof(p_windows) <> 'array'
     or jsonb_array_length(p_windows) = 0 then
    return jsonb_build_object('status', 'no_windows');
  end if;

  if p_country is null or p_country not in ('AT', 'DE') then
    return jsonb_build_object('status', 'invalid_country');
  end if;

  perform pg_advisory_xact_lock(
    hashtext('grid_tariff:' || p_operator_id || ':' || p_netzebene::text ||
             ':' || coalesce(p_metering_variant, ''))
  );

  select id, valid_from, operator_name
    into v_oldest_id, v_oldest_from, v_operator
    from public.grid_tariffs
   where operator_id = p_operator_id
     and netzebene = p_netzebene
     and metering_variant is not distinct from p_metering_variant
   order by valid_from asc
   limit 1
     for update;

  if not found then
    return jsonb_build_object('status', 'no_existing_stand');
  end if;

  if p_valid_from >= v_oldest_from then
    return jsonb_build_object(
      'status', 'not_before_oldest',
      'min_valid_from', v_oldest_from
    );
  end if;

  v_new_until := v_oldest_from - 1;

  begin
    insert into public.grid_tariffs (
      operator_id, operator_name, netzebene, metering_variant,
      grundpreis_amount, grundpreis_unit, messpreis_amount, messpreis_unit,
      netzverlust_ct_per_kwh, price_basis,
      valid_from, valid_until, created_by, backfilled_at, country
    ) values (
      p_operator_id, v_operator, p_netzebene, p_metering_variant,
      p_grundpreis_amount, p_grundpreis_unit, p_messpreis_amount, p_messpreis_unit,
      p_netzverlust_ct_per_kwh, p_price_basis,
      p_valid_from, v_new_until, p_created_by, now(), p_country
    )
    returning id into v_new_id;
  exception
    when unique_violation then
      raise exception using errcode = 'P0001', message = 'duplicate_valid_from';
    when check_violation then
      raise exception using errcode = 'P0001', message = 'invalid_input';
  end;

  begin
    insert into public.grid_tariff_rate_windows (
      grid_tariff_id, label, month_day_from, month_day_to, time_from, time_to, ct_per_kwh, note
    )
    select v_new_id, w.label, w.month_day_from, w.month_day_to, w.time_from, w.time_to,
           w.ct_per_kwh, nullif(btrim(w.note), '')
      from jsonb_to_recordset(p_windows) as w(
        label          text,
        month_day_from text,
        month_day_to   text,
        time_from      time,
        time_to        time,
        ct_per_kwh     numeric,
        note           text
      );
    get diagnostics v_windows = row_count;
  exception
    when data_exception or not_null_violation then
      raise exception using errcode = 'P0001', message = 'invalid_window';
  end;

  return jsonb_build_object(
    'status', 'backfilled',
    'id', v_new_id,
    'window_count', v_windows,
    'new_valid_until', v_new_until,
    'preceded_id', v_oldest_id,
    'preceded_valid_from', v_oldest_from
  );
end;
$$;

comment on function public.backfill_grid_tariff(
  text, smallint, numeric, text, numeric, text, date, text, jsonb, text, numeric, text, text
) is
  'Trägt einen historischen Stand VOR dem ältesten vorhandenen nach. Seit 20261015090000 mit '
  'p_country; es muss das Land der bestehenden Kombination sein (sonst P0001 '
  'operator_country_mismatch). SECURITY INVOKER, service_role-only.';

revoke all on function public.backfill_grid_tariff(
  text, smallint, numeric, text, numeric, text, date, text, jsonb, text, numeric, text, text
) from public, anon, authenticated;

grant execute on function public.backfill_grid_tariff(
  text, smallint, numeric, text, numeric, text, date, text, jsonb, text, numeric, text, text
) to service_role;
