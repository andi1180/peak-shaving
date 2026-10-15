-- DE-Erweiterung Schritt 7b: Benutzungsdauer-Stufen an den Netzentgelten.
--
-- Deutsche Netzbetreiber führen je Ebene zwei Preispaare nach Jahresbenutzungsdauer. Stufe 1
-- (unter der Schwelle) ist die bestehende Zeile — Leistungspreis in grundpreis_amount
-- (eur_per_kw_year) plus das Arbeitspreis-Fenster. Stufe 2 (ab der Schwelle) sind die drei neuen
-- Felder. AT-Zeilen lassen sie leer. Gelesen werden sie von der Engine erst in Schritt 8.
--
--   TEIL 1  drei nullbare Spalten + CHECKs auf public.grid_tariffs
--   TEIL 2  create_grid_tariff / backfill_grid_tariff / update_grid_tariff nehmen die Stufen
--           (DROP+CREATE, Grants wie vorher)
--   TEIL 3  add_grid_tariff_rate_window weist ein zweites Fenster an einer Zeile mit Stufen ab
--
-- Regel „Zeile mit Stufen hat genau EIN ganzjähriges, ganztägiges Fenster": in den vier Wrappern
-- statt per Trigger, weil create/update erst die Zeile und danach die Fenster schreiben — ein
-- Trigger auf einer der beiden Tabellen sähe einen Zwischenstand, und die Wrapper sind die
-- einzigen Schreibwege (kein Tabellen-Grant für anon/authenticated).
--
-- guard_grid_tariff_country, country, die Messpreis-Logik und der UNIQUE-Schlüssel bleiben
-- unverändert.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — Spalten
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- num_nonnulls statt OR-Ketten: es liefert nie NULL, ein CHECK kann also nicht über dreiwertige
-- Logik durchrutschen (Lehre aus 20260923190000).
alter table public.grid_tariffs
  add column tier_threshold_hours numeric
    constraint grid_tariffs_tier_threshold_check check (tier_threshold_hours > 0),
  add column tier2_leistungspreis_eur_per_kw_year numeric
    constraint grid_tariffs_tier2_leistungspreis_check check (tier2_leistungspreis_eur_per_kw_year >= 0),
  add column tier2_arbeitspreis_ct_per_kwh numeric
    constraint grid_tariffs_tier2_arbeitspreis_check check (tier2_arbeitspreis_ct_per_kwh >= 0),
  add constraint grid_tariffs_tiers_all_or_none check (
    num_nonnulls(tier_threshold_hours, tier2_leistungspreis_eur_per_kw_year, tier2_arbeitspreis_ct_per_kwh)
      in (0, 3)
  ),
  add constraint grid_tariffs_tiers_require_kw_price check (
    num_nonnulls(tier_threshold_hours, tier2_leistungspreis_eur_per_kw_year, tier2_arbeitspreis_ct_per_kwh) = 0
    or grundpreis_unit = 'eur_per_kw_year'
  );

comment on column public.grid_tariffs.tier_threshold_hours is
  'Benutzungsdauer-Schwelle (h/a, i. d. R. 2500). Darunter gilt Stufe 1 (grundpreis_amount + '
  'Fenster), ab ihr Stufe 2. Alle drei Stufenfelder oder keines; nur bei eur_per_kw_year.';
comment on column public.grid_tariffs.tier2_leistungspreis_eur_per_kw_year is
  'Leistungspreis ab der Benutzungsdauer-Schwelle (€/kW·a).';
comment on column public.grid_tariffs.tier2_arbeitspreis_ct_per_kwh is
  'Arbeitspreis ab der Benutzungsdauer-Schwelle (ct/kWh); ersetzt dann das eine Fenster der Zeile.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — die drei Schreib-Wrapper
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Rumpf wortgleich zur jüngsten Fassung (create/backfill: 20261015090000, update: 20260923230000),
-- ergänzt um die drei Parameter, die Fenster-Prüfung (Status tiers_require_single_window, vor
-- jedem Schreibvorgang) und die Spalten im INSERT/UPDATE.
drop function public.create_grid_tariff(
  text, text, smallint, numeric, text, numeric, text, date, text, jsonb, text, numeric, text, text
);

create function public.create_grid_tariff(
  p_operator_id                          text,
  p_operator_name                        text,
  p_netzebene                            smallint,
  p_grundpreis_amount                    numeric,
  p_grundpreis_unit                      text,
  p_netzverlust_ct_per_kwh               numeric,
  p_price_basis                          text,
  p_valid_from                           date,
  p_created_by                           text,
  p_windows                              jsonb,
  p_metering_variant                     text default null,
  p_messpreis_amount                     numeric default null,
  p_messpreis_unit                       text default null,
  p_country                              text default 'AT',
  p_tier_threshold_hours                 numeric default null,
  p_tier2_leistungspreis_eur_per_kw_year numeric default null,
  p_tier2_arbeitspreis_ct_per_kwh        numeric default null
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

  -- Stufen verlangen genau EIN ganzjähriges, ganztägiges Arbeitspreis-Fenster (= Stufe 1).
  if num_nonnulls(p_tier_threshold_hours, p_tier2_leistungspreis_eur_per_kw_year,
                  p_tier2_arbeitspreis_ct_per_kwh) > 0
     and not (
       jsonb_array_length(p_windows) = 1
       and nullif(btrim(p_windows->0->>'month_day_from'), '') is null
       and nullif(btrim(p_windows->0->>'month_day_to'), '') is null
       and p_windows->0->>'time_from' in ('00:00', '00:00:00')
       and p_windows->0->>'time_to' in ('24:00', '24:00:00')
     ) then
    return jsonb_build_object('status', 'tiers_require_single_window');
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
      valid_from, created_by, country,
      tier_threshold_hours, tier2_leistungspreis_eur_per_kw_year, tier2_arbeitspreis_ct_per_kwh
    ) values (
      p_operator_id, p_operator_name, p_netzebene, p_metering_variant,
      p_grundpreis_amount, p_grundpreis_unit, p_messpreis_amount, p_messpreis_unit,
      p_netzverlust_ct_per_kwh, p_price_basis,
      p_valid_from, p_created_by, p_country,
      p_tier_threshold_hours, p_tier2_leistungspreis_eur_per_kw_year, p_tier2_arbeitspreis_ct_per_kwh
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
  text, text, smallint, numeric, text, numeric, text, date, text, jsonb, text, numeric, text, text,
  numeric, numeric, numeric
) is
  'Legt einen Netzentgelt-Stand an und schliesst die offene Vorgängerin derselben Kombination. '
  'Seit 20261015120000 mit Benutzungsdauer-Stufen (alle drei oder keine; mit Stufen genau ein '
  'ganzjähriges, ganztägiges Fenster, sonst Status tiers_require_single_window). '
  'SECURITY INVOKER, service_role-only.';

revoke all on function public.create_grid_tariff(
  text, text, smallint, numeric, text, numeric, text, date, text, jsonb, text, numeric, text, text,
  numeric, numeric, numeric
) from public, anon, authenticated;

grant execute on function public.create_grid_tariff(
  text, text, smallint, numeric, text, numeric, text, date, text, jsonb, text, numeric, text, text,
  numeric, numeric, numeric
) to service_role;

drop function public.backfill_grid_tariff(
  text, smallint, numeric, text, numeric, text, date, text, jsonb, text, numeric, text, text
);

create function public.backfill_grid_tariff(
  p_operator_id                          text,
  p_netzebene                            smallint,
  p_grundpreis_amount                    numeric,
  p_grundpreis_unit                      text,
  p_netzverlust_ct_per_kwh               numeric,
  p_price_basis                          text,
  p_valid_from                           date,
  p_created_by                           text,
  p_windows                              jsonb,
  p_metering_variant                     text default null,
  p_messpreis_amount                     numeric default null,
  p_messpreis_unit                       text default null,
  p_country                              text default 'AT',
  p_tier_threshold_hours                 numeric default null,
  p_tier2_leistungspreis_eur_per_kw_year numeric default null,
  p_tier2_arbeitspreis_ct_per_kwh        numeric default null
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

  if num_nonnulls(p_tier_threshold_hours, p_tier2_leistungspreis_eur_per_kw_year,
                  p_tier2_arbeitspreis_ct_per_kwh) > 0
     and not (
       jsonb_array_length(p_windows) = 1
       and nullif(btrim(p_windows->0->>'month_day_from'), '') is null
       and nullif(btrim(p_windows->0->>'month_day_to'), '') is null
       and p_windows->0->>'time_from' in ('00:00', '00:00:00')
       and p_windows->0->>'time_to' in ('24:00', '24:00:00')
     ) then
    return jsonb_build_object('status', 'tiers_require_single_window');
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
      valid_from, valid_until, created_by, backfilled_at, country,
      tier_threshold_hours, tier2_leistungspreis_eur_per_kw_year, tier2_arbeitspreis_ct_per_kwh
    ) values (
      p_operator_id, v_operator, p_netzebene, p_metering_variant,
      p_grundpreis_amount, p_grundpreis_unit, p_messpreis_amount, p_messpreis_unit,
      p_netzverlust_ct_per_kwh, p_price_basis,
      p_valid_from, v_new_until, p_created_by, now(), p_country,
      p_tier_threshold_hours, p_tier2_leistungspreis_eur_per_kw_year, p_tier2_arbeitspreis_ct_per_kwh
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
  text, smallint, numeric, text, numeric, text, date, text, jsonb, text, numeric, text, text,
  numeric, numeric, numeric
) is
  'Trägt einen historischen Stand VOR dem ältesten vorhandenen nach. Seit 20261015120000 mit '
  'Benutzungsdauer-Stufen (Regeln wie create_grid_tariff). SECURITY INVOKER, service_role-only.';

revoke all on function public.backfill_grid_tariff(
  text, smallint, numeric, text, numeric, text, date, text, jsonb, text, numeric, text, text,
  numeric, numeric, numeric
) from public, anon, authenticated;

grant execute on function public.backfill_grid_tariff(
  text, smallint, numeric, text, numeric, text, date, text, jsonb, text, numeric, text, text,
  numeric, numeric, numeric
) to service_role;

drop function public.update_grid_tariff(
  uuid, text, text, numeric, text, numeric, text, date, date, jsonb, numeric, text
);

-- Das Protokoll (old_row/new_row über to_jsonb) enthält die drei neuen Spalten von selbst.
create function public.update_grid_tariff(
  p_tariff_id                            uuid,
  p_reason                               text,
  p_operator_name                        text,
  p_grundpreis_amount                    numeric,
  p_grundpreis_unit                      text,
  p_netzverlust_ct_per_kwh               numeric,
  p_price_basis                          text,
  p_valid_from                           date,
  p_valid_until                          date,
  p_windows                              jsonb,
  p_messpreis_amount                     numeric default null,
  p_messpreis_unit                       text default null,
  p_tier_threshold_hours                 numeric default null,
  p_tier2_leistungspreis_eur_per_kw_year numeric default null,
  p_tier2_arbeitspreis_ct_per_kwh        numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operator_id text;
  v_netzebene   smallint;
  v_variant     text;
  v_conflict    record;
  v_old         jsonb;
  v_new         jsonb;
  v_windows     int;
  v_changed_by  text;
begin
  if not platform.is_admin() then
    raise exception 'public.update_grid_tariff: Adminrolle erforderlich' using errcode = '42501';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception using errcode = 'P0001', message = 'reason_required';
  end if;

  if p_windows is null
     or jsonb_typeof(p_windows) <> 'array'
     or jsonb_array_length(p_windows) = 0 then
    return jsonb_build_object('status', 'no_windows');
  end if;

  if num_nonnulls(p_tier_threshold_hours, p_tier2_leistungspreis_eur_per_kw_year,
                  p_tier2_arbeitspreis_ct_per_kwh) > 0
     and not (
       jsonb_array_length(p_windows) = 1
       and nullif(btrim(p_windows->0->>'month_day_from'), '') is null
       and nullif(btrim(p_windows->0->>'month_day_to'), '') is null
       and p_windows->0->>'time_from' in ('00:00', '00:00:00')
       and p_windows->0->>'time_to' in ('24:00', '24:00:00')
     ) then
    return jsonb_build_object('status', 'tiers_require_single_window');
  end if;

  if p_valid_until is not null and p_valid_until < p_valid_from then
    return jsonb_build_object('status', 'invalid_valid_until');
  end if;

  select operator_id, netzebene, metering_variant
    into v_operator_id, v_netzebene, v_variant
    from public.grid_tariffs
   where id = p_tariff_id;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  perform pg_advisory_xact_lock(
    hashtext('grid_tariff:' || v_operator_id || ':' || v_netzebene::text ||
             ':' || coalesce(v_variant, ''))
  );

  perform 1 from public.grid_tariffs where id = p_tariff_id for update;

  select to_jsonb(t) || jsonb_build_object('rate_windows', coalesce((
           select jsonb_agg(to_jsonb(w) - 'id' - 'grid_tariff_id'
                            order by w.label, w.time_from, w.month_day_from, w.ct_per_kwh)
             from public.grid_tariff_rate_windows w
            where w.grid_tariff_id = t.id), '[]'::jsonb))
    into v_old
    from public.grid_tariffs t
   where t.id = p_tariff_id;

  -- Gültigkeitsräume sind inklusiv (valid_until = letzter Tag, s. create_grid_tariff), null = offen.
  select valid_from, valid_until
    into v_conflict
    from public.grid_tariffs
   where operator_id = v_operator_id
     and netzebene = v_netzebene
     and metering_variant is not distinct from v_variant
     and id <> p_tariff_id
     and daterange(valid_from, valid_until, '[]') && daterange(p_valid_from, p_valid_until, '[]')
   order by valid_from
   limit 1;
  if found then
    return jsonb_build_object(
      'status', 'overlap',
      'conflict_valid_from', v_conflict.valid_from,
      'conflict_valid_until', v_conflict.valid_until
    );
  end if;

  begin
    begin
      update public.grid_tariffs
         set operator_name                        = p_operator_name,
             grundpreis_amount                    = p_grundpreis_amount,
             grundpreis_unit                      = p_grundpreis_unit,
             messpreis_amount                     = p_messpreis_amount,
             messpreis_unit                       = p_messpreis_unit,
             netzverlust_ct_per_kwh               = p_netzverlust_ct_per_kwh,
             price_basis                          = p_price_basis,
             valid_from                           = p_valid_from,
             valid_until                          = p_valid_until,
             tier_threshold_hours                 = p_tier_threshold_hours,
             tier2_leistungspreis_eur_per_kw_year = p_tier2_leistungspreis_eur_per_kw_year,
             tier2_arbeitspreis_ct_per_kwh        = p_tier2_arbeitspreis_ct_per_kwh
       where id = p_tariff_id;
    exception
      when unique_violation then
        raise exception using errcode = 'P0001', message = 'duplicate_valid_from';
      when check_violation or not_null_violation then
        raise exception using errcode = 'P0001', message = 'invalid_input';
    end;

    delete from public.grid_tariff_rate_windows where grid_tariff_id = p_tariff_id;

    begin
      insert into public.grid_tariff_rate_windows (
        grid_tariff_id, label, month_day_from, month_day_to, time_from, time_to, ct_per_kwh, note
      )
      select p_tariff_id, w.label, w.month_day_from, w.month_day_to, w.time_from, w.time_to,
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

    select to_jsonb(t) || jsonb_build_object('rate_windows', coalesce((
             select jsonb_agg(to_jsonb(w) - 'id' - 'grid_tariff_id'
                              order by w.label, w.time_from, w.month_day_from, w.ct_per_kwh)
               from public.grid_tariff_rate_windows w
              where w.grid_tariff_id = t.id), '[]'::jsonb))
      into v_new
      from public.grid_tariffs t
     where t.id = p_tariff_id;

    if v_new = v_old then
      raise exception using errcode = 'GTU01', message = 'unchanged';
    end if;
  exception
    when sqlstate 'GTU01' then
      return jsonb_build_object('status', 'unchanged', 'id', p_tariff_id);
  end;

  select u.email into v_changed_by from auth.users u where u.id = auth.uid();

  insert into platform.grid_tariff_changes (tariff_id, changed_by, reason, old_row, new_row)
  values (p_tariff_id, coalesce(v_changed_by, 'unbekannt'), btrim(p_reason), v_old, v_new);

  return jsonb_build_object('status', 'updated', 'id', p_tariff_id, 'window_count', v_windows);
end;
$$;

comment on function public.update_grid_tariff(
  uuid, text, text, numeric, text, numeric, text, date, date, jsonb, numeric, text,
  numeric, numeric, numeric
) is
  'Ändert eine Netzbetreiber-Tarifzeile samt Zeitfenstern und protokolliert alt/neu in '
  'platform.grid_tariff_changes. Adminrolle (platform.is_admin), Grund Pflicht. Seit '
  '20261015120000 mit Benutzungsdauer-Stufen (null = keine Stufen).';

revoke all on function public.update_grid_tariff(
  uuid, text, text, numeric, text, numeric, text, date, date, jsonb, numeric, text,
  numeric, numeric, numeric
) from public, anon, authenticated, service_role;

grant execute on function public.update_grid_tariff(
  uuid, text, text, numeric, text, numeric, text, date, date, jsonb, numeric, text,
  numeric, numeric, numeric
) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — add_grid_tariff_rate_window
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- create or replace bei unveränderter Signatur: Grants bleiben. Eine Zeile mit Stufen trägt ihr
-- eines Fenster bereits; jedes weitere wäre das zweite.
create or replace function public.add_grid_tariff_rate_window(
  p_tariff_id      uuid,
  p_label          text,
  p_time_from      time,
  p_time_to        time,
  p_ct_per_kwh     numeric,
  p_month_day_from text default null,
  p_month_day_to   text default null,
  p_note           text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_valid_until date;
  v_has_tiers   boolean;
  v_window_id   uuid;
  v_count       int;
begin
  select valid_until,
         num_nonnulls(tier_threshold_hours, tier2_leistungspreis_eur_per_kw_year,
                      tier2_arbeitspreis_ct_per_kwh) > 0
    into v_valid_until, v_has_tiers
    from public.grid_tariffs
   where id = p_tariff_id
     for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;

  if v_valid_until is not null then
    raise exception using errcode = 'P0001', message = 'closed_tariff';
  end if;

  if v_has_tiers then
    raise exception using errcode = 'P0001', message = 'tiers_require_single_window';
  end if;

  insert into public.grid_tariff_rate_windows (
    grid_tariff_id, label, month_day_from, month_day_to, time_from, time_to, ct_per_kwh, note
  ) values (
    p_tariff_id, p_label, p_month_day_from, p_month_day_to, p_time_from, p_time_to, p_ct_per_kwh,
    nullif(btrim(p_note), '')
  )
  returning id into v_window_id;

  select count(*)::int into v_count
    from public.grid_tariff_rate_windows
   where grid_tariff_id = p_tariff_id;

  return jsonb_build_object(
    'status', 'added',
    'id', v_window_id,
    'grid_tariff_id', p_tariff_id,
    'window_count', v_count
  );
end;
$$;
