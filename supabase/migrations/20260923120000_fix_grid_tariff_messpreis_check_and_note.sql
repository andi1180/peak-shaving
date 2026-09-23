-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Korrektur zweier Mängel aus 20260921120000 (#295). KEIN neuer Funktionsumfang.
--
--   TEIL 1  grid_tariffs_messpreis_check — der Paar-Zwang griff nicht
--   TEIL 2  public.create_grid_tariff   — die Notiz am Zeitfenster war verloren gegangen
--
-- Beide vom DB-Gate gemeldet (`grid-tariff-write-path.test.ts`, `grid-tariff-add-window.test.ts`);
-- beide auch in Produktion gemessen, nicht nur lokal.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — der Paar-CHECK war für den halben Fall wirkungslos
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Die bisherige Bedingung liess einen Betrag OHNE Einheit durch, und zwar nicht aus Nachlässigkeit,
-- sondern durch die dreiwertige Logik: `messpreis_unit in ('eur_per_month','eur_per_year')` ist bei
-- `null` nicht FALSE, sondern NULL, und ein CHECK gilt als erfüllt, sobald sein Ausdruck NULL
-- ergibt. Gegen PostgreSQL 17.6 gemessen — ein direkter INSERT mit Betrag und ohne Einheit lief
-- durch, und `create_grid_tariff` meldete dafür `created` statt `invalid_input`.
--
-- ⚠ Die Gegenrichtung (Einheit ohne Betrag) war nie betroffen: dort ist `messpreis_amount is not
-- null` schlicht FALSE. Genau diese Asymmetrie hat den Mangel unauffällig gemacht.
--
-- Vor dem Anlegen gegen Produktion gemessen (23.09.2026, Management-API): 9 Zeilen, davon 0 mit
-- halbem Paar in einer der beiden Richtungen — die Bedingung gilt ab sofort ohne Umschreiben von
-- Bestand.
alter table public.grid_tariffs drop constraint grid_tariffs_messpreis_check;

alter table public.grid_tariffs
  add constraint grid_tariffs_messpreis_check
  check (
    (messpreis_amount is null and messpreis_unit is null)
    or (
      messpreis_amount is not null
      and messpreis_unit is not null
      and messpreis_unit in ('eur_per_month', 'eur_per_year')
    )
  );

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — die Notiz am Zeitfenster
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- #295 hat `create_grid_tariff` per DROP+CREATE neu angelegt und dafür die Fassung aus B21-2b
-- (28.08.) als Vorlage genommen — also die VOR B21-2d (02.09., `note` am Zeitfenster). Die zwei
-- Messpreis-Parameter kamen dazu, `note` fiel dabei still wieder heraus: der INSERT lief weiter,
-- die Notiz landete nur nirgends. In Produktion nachgemessen (`pg_get_functiondef` kennt das Feld
-- dort heute nicht).
--
-- Hier deshalb `create or replace` mit UNVERÄNDERTER Signatur — die Grants aus #295 bleiben damit
-- stehen, und es entsteht kein zweiter Weg, auf dem ein `revoke` verloren gehen kann. Geändert ist
-- AUSSCHLIESSLICH der Fenster-INSERT.
create or replace function public.create_grid_tariff(
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
  p_messpreis_unit         text default null
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
  -- Ohne mindestens ein Zeitfenster ist die Tarifzeile unvollständig (Delta 5: die zeitabhängige
  -- Arbeitspreis-Seite des Netzentgelts). Die Prüfung steht VOR jedem Schreibvorgang — es soll
  -- nicht erst eine Vorgängerin geschlossen werden, um dann am letzten Schritt zu scheitern.
  if p_windows is null
     or jsonb_typeof(p_windows) <> 'array'
     or jsonb_array_length(p_windows) = 0 then
    return jsonb_build_object('status', 'no_windows');
  end if;

  -- Serialisiert genau diese Kombination für die Dauer der Transaktion (s. Kopf).
  -- `coalesce` auf den Leerstring, weil `metering_variant` bei NE 3–6 null ist und ein null-Anteil
  -- den ganzen Schlüssel null machte — dieselbe Falle, die das `nulls not distinct` motiviert.
  perform pg_advisory_xact_lock(
    hashtext('grid_tariff:' || p_operator_id || ':' || p_netzebene::text ||
             ':' || coalesce(p_metering_variant, ''))
  );

  -- Die Sperre steht IM Unterausdruck, nicht am Aggregat: `for update` ist neben einer
  -- Aggregatfunktion nicht zulaessig (0A000, beim Messen der Rechteflaeche aufgeschlagen). Der
  -- Advisory-Lock oben serialisiert diese Kombination bereits; das Zeilen-`for update` haelt
  -- zusaetzlich einen Schreiber auf, der an dieser Funktion vorbei ginge.
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
    -- Bewusst OHNE Schreibvorgang zurück: eine abgelehnte Anlage darf die bestehende Lage nicht
    -- verändert haben.
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
      valid_from, created_by
    ) values (
      p_operator_id, p_operator_name, p_netzebene, p_metering_variant,
      p_grundpreis_amount, p_grundpreis_unit, p_messpreis_amount, p_messpreis_unit,
      p_netzverlust_ct_per_kwh, p_price_basis,
      p_valid_from, p_created_by
    )
    returning id into v_new_id;
  exception
    -- Ein bereits ARCHIVIERTER Stand mit genau diesem `valid_from` (die offene Zeile liegt davor,
    -- die Ordnungsprüfung oben greift deshalb nicht). Der Constraint ist die Wahrheit; hier bekommt
    -- er nur einen Namen, mit dem die Oberfläche etwas anfangen kann.
    when unique_violation then
      raise exception using errcode = 'P0001', message = 'duplicate_valid_from';
    -- Ein Wert ausserhalb der CHECKs aus B21-1 (Netzebene, Einheit, Preisbasis). Erreichbar nur an
    -- der Oberfläche vorbei — die Auswahlfelder lassen nichts anderes zu.
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
    -- Eine unbrauchbare Uhrzeit/Zahl im Fenster-Block. Der ganze Aufruf fällt damit weg —
    -- einschliesslich der oben bereits geschlossenen Vorgängerin. Genau dafür ist die Klammer da.
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
