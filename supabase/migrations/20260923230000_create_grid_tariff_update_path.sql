-- Bearbeiten einer Netzbetreiber-Tarifzeile, mit Änderungsprotokoll.
--   TEIL 1  platform.grid_tariff_changes            — Protokoll: wer, wann, warum, alt, neu
--   TEIL 2  public.update_grid_tariff(...)          — EIN Aufruf: prüfen, ändern, protokollieren
--   TEIL 3  public.admin_list_grid_tariff_changes() — Lesen des Protokolls für die Admin-Seite
--
-- Bisher galt „nie in-place überschreiben" (B21-1), damit eine archivierte Analyse später noch
-- sagen kann, welcher Stand ihr zugrunde lag. Das tragen heute zwei andere Dinge: `platform.analyses`
-- friert `inputs`/`result` als Werte ein und rechnet nie nach (B14-1), und dieses Protokoll hält
-- jeden überschriebenen Stand vollständig fest (`old_row`). Ein Tippfehler im Preisblatt ist damit
-- korrigierbar, ohne die Zeile löschen und neu anlegen zu müssen.
--
-- Anders als `create_grid_tariff` (SECURITY INVOKER, service_role, Prüfung im Anwendungscode) ist
-- dieser Weg SECURITY DEFINER mit `platform.is_admin()` im Rumpf, nur für `authenticated` — so
-- entsteht `changed_by` aus der Sitzung selbst und nicht aus einem Parameter.
--
-- Nicht änderbar: die Kombination (operator_id, netzebene, metering_variant) — eine falsch
-- zugeordnete Zeile ist ein Löschen + Neuanlegen, keine Korrektur eines Werts.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — platform.grid_tariff_changes
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Kein Fremdschlüssel auf grid_tariffs: das Protokoll soll ein späteres Löschen der Zeile überleben
-- (dieselbe Überlegung wie bei public.grid_tariff_deletions).
create table platform.grid_tariff_changes (
  id         uuid primary key default gen_random_uuid(),
  tariff_id  uuid not null,
  -- Adresse statt Kennung, wie grid_tariffs.created_by — und damit keine ON-DELETE-SET-NULL-Falle.
  changed_by text not null,
  changed_at timestamptz not null default now(),
  reason     text not null,
  old_row    jsonb not null,
  new_row    jsonb not null,
  constraint grid_tariff_changes_reason_check check (btrim(reason) <> '')
);

create index grid_tariff_changes_tariff_idx
  on platform.grid_tariff_changes (tariff_id, changed_at desc);

comment on table platform.grid_tariff_changes is
  'Änderungsprotokoll der Netzbetreiber-Tarifzeilen. old_row/new_row = Zeile samt rate_windows. '
  'RLS aktiv, keine Policy, für keine Rolle ein Grant — Schreiben nur über public.update_grid_tariff, '
  'Lesen nur über public.admin_list_grid_tariff_changes.';

alter table platform.grid_tariff_changes enable row level security;

revoke all on table platform.grid_tariff_changes
  from public, anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — public.update_grid_tariff
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Dieselben Fehlerfälle wie die jüngste create_grid_tariff-Fassung (20260923190000: no_windows,
-- invalid_input, invalid_window, duplicate_valid_from, Fenster inkl. note) plus overlap,
-- invalid_valid_until, not_found, unchanged und reason_required. Jede Abweisung endet VOR dem
-- Protokoll oder rollt es mit zurück — ein abgewiesener Aufruf hinterlässt nichts.
create function public.update_grid_tariff(
  p_tariff_id              uuid,
  p_reason                 text,
  p_operator_name          text,
  p_grundpreis_amount      numeric,
  p_grundpreis_unit        text,
  p_netzverlust_ct_per_kwh numeric,
  p_price_basis            text,
  p_valid_from             date,
  p_valid_until            date,
  p_windows                jsonb,
  p_messpreis_amount       numeric default null,
  p_messpreis_unit         text default null
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

  -- Derselbe Schlüssel wie in create_grid_tariff/backfill_grid_tariff: die drei Wege serialisieren
  -- sich gegenseitig je Kombination.
  perform pg_advisory_xact_lock(
    hashtext('grid_tariff:' || v_operator_id || ':' || v_netzebene::text ||
             ':' || coalesce(v_variant, ''))
  );

  perform 1 from public.grid_tariffs where id = p_tariff_id for update;

  -- Snapshot ohne Fenster-Kennungen: die Fenster werden unten ersetzt und bekommen neue ids, der
  -- Vergleich alt/neu soll nur Inhalte sehen.
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
         set operator_name          = p_operator_name,
             grundpreis_amount      = p_grundpreis_amount,
             grundpreis_unit        = p_grundpreis_unit,
             messpreis_amount       = p_messpreis_amount,
             messpreis_unit         = p_messpreis_unit,
             netzverlust_ct_per_kwh = p_netzverlust_ct_per_kwh,
             price_basis            = p_price_basis,
             valid_from             = p_valid_from,
             valid_until            = p_valid_until
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

    -- Ohne inhaltliche Änderung kein Protokolleintrag; die Ausnahme rollt das Neuschreiben der
    -- Fenster bis zum Beginn dieses Blocks zurück.
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
  uuid, text, text, numeric, text, numeric, text, date, date, jsonb, numeric, text
) is
  'Ändert eine Netzbetreiber-Tarifzeile samt Zeitfenstern und protokolliert alt/neu in '
  'platform.grid_tariff_changes. Adminrolle (platform.is_admin), Grund Pflicht.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — public.admin_list_grid_tariff_changes
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create function public.admin_list_grid_tariff_changes()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not platform.is_admin() then
    raise exception 'public.admin_list_grid_tariff_changes: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(c) order by c.changed_at desc)
      from platform.grid_tariff_changes c
  ), '[]'::jsonb);
end;
$$;

-- K1b-Lehre: EXECUTE geht beim Anlegen an PUBLIC — ausdrücklich entziehen, dann gezielt vergeben.
revoke all on function public.update_grid_tariff(
  uuid, text, text, numeric, text, numeric, text, date, date, jsonb, numeric, text
) from public, anon, authenticated, service_role;
revoke all on function public.admin_list_grid_tariff_changes()
  from public, anon, authenticated, service_role;

grant execute on function public.update_grid_tariff(
  uuid, text, text, numeric, text, numeric, text, date, date, jsonb, numeric, text
) to authenticated;
grant execute on function public.admin_list_grid_tariff_changes() to authenticated;
