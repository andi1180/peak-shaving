-- K1b: Fundament- und Installationskosten werden eigene, admin-pflegbare BAUSTEINE.
--
-- Ausgangslage (K2b-1, in Produktion gemessen): neun Gewerbe-Geräte tragen `requires_foundation
-- = true` und sind damit unfreischaltbar, weil `foundation_cost_net` je Gerät einzeln zu pflegen
-- wäre — neun Mal derselbe Preis für dieselbe Bodenplatte. Ein Fundament ist aber keine
-- Eigenschaft des Geräts, sondern eine Leistung, die für eine ganze Gewichts-/Grössenklasse
-- gleich kalkuliert wird. Es gehört deshalb in eine eigene Zeile, die sich EINMAL bepreisen lässt.
--
-- ⚠ Das ist eine BRECHENDE Änderung an zwei Wrapper-Signaturen (`admin_create_battery`,
-- `admin_update_battery`): `p_foundation_cost_net`/`p_installation_cost_net` sind durch
-- `p_foundation_component_id`/`p_installation_component_id` ERSETZT. Ein bestehender Aufruf mit
-- den alten Namen bricht zur LAUFZEIT, nicht beim Anlegen dieser Migration.
--
-- Vor dem Entfernen der beiden Spalten wurden ALLE Funktionsrümpfe per `pg_get_functiondef`
-- durchsucht (Arbeitsregel 1). Treffer: genau `admin_create_battery`, `admin_update_battery` und
-- `admin_set_battery_active` — alle drei werden hier neu gefasst.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — Die Bausteine
-- ════════════════════════════════════════════════════════════════════════════════════════════════

create table public.battery_cost_components (
  id            uuid primary key default gen_random_uuid(),

  art           text not null,
  bezeichnung   text not null,

  -- Wofür der Baustein gilt: Einsatzbereich, Gewichts-/Grössenklasse, Annahmen der Kalkulation.
  -- Freitext und bewusst nicht strukturiert — die Abgrenzung zwischen zwei Fundamentklassen ist
  -- ein Satz, keine Zahl, und eine erfundene Ober-/Untergrenze wiese irgendwann ein echtes Gerät ab.
  beschreibung  text,

  -- Nullbar, und das ist der Normalfall beim Anlegen: ein Baustein entsteht als BENANNTE LÜCKE
  -- („dieses Gerät braucht ein Fundament, der Preis fehlt noch") und wird später bepreist.
  -- Ohne Preis ist er öffentlich unsichtbar und trägt keine Freigabe (TEIL 3).
  price_net     numeric,
  price_as_of   date,

  notes         text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint battery_cost_components_art_check
    check (art in ('fundament', 'installation')),
  constraint battery_cost_components_bezeichnung_check
    check (btrim(bezeichnung) <> ''),
  -- Wie bei `battery_catalog`: 0 wäre eine Aussage, negativ ist unmöglich. Ein Fundament, das
  -- nichts kostet, soll sich eintragen lassen.
  constraint battery_cost_components_price_check
    check (price_net is null or price_net >= 0)
);

comment on table public.battery_cost_components is
  'K1b: bepreisbare Kostenbausteine (Fundament, Installation), die ein Katalog-Geraet referenziert '
  'statt sie als eigenen Betrag zu fuehren. Ein Fundament ist eine Leistung je Groessenklasse, '
  'nicht eine Eigenschaft des Geraets. anon/authenticated lesen ausschliesslich Zeilen MIT Preis; '
  'gepflegt wird ueber die admin_*_cost_component-Wrapper (SECURITY DEFINER, platform.is_admin).';
comment on column public.battery_cost_components.price_net is
  'Netto-Preis der Leistung. NULL heisst „noch nicht bepreist" — die Zeile ist dann oeffentlich '
  'unsichtbar und traegt keine Freigabe. Sie kann nicht auf NULL zurueck, solange ein AKTIVES '
  'Geraet sie nutzt (Trigger battery_cost_components_guard_price).';
comment on column public.battery_cost_components.price_as_of is
  'Preisstand — an welchem Tag dieser Preis so galt. KEINE Gueltigkeit, wie bei battery_catalog: '
  'die Tabelle historisiert nicht, ein neuer Preis ueberschreibt.';

create index battery_cost_components_priced_idx
  on public.battery_cost_components (art)
  where price_net is not null;

alter table public.battery_cost_components enable row level security;

-- Dieselbe Bedingung wie bei `battery_catalog.active`, nur an einem anderen Feld aufgehängt: was
-- unfertig ist, verlaesst den Adminbereich nicht. Der Rechner soll einen Baustein ohne Preis gar
-- nicht erst sehen — er koennte ihn sonst mit 0 verrechnen.
create policy battery_cost_components_public_read
  on public.battery_cost_components
  for select
  to anon, authenticated
  using (price_net is not null);

revoke all on table public.battery_cost_components from public, anon, authenticated, service_role;
grant select on table public.battery_cost_components to anon, authenticated;

create trigger battery_cost_components_touch_updated_at
  before update on public.battery_cost_components
  for each row
  execute function public.battery_catalog_touch_updated_at();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — Der Umbau an battery_catalog
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- `on delete restrict`: ein Baustein, auf den ein Geraet zeigt, darf nicht verschwinden. Das ist
-- die Gegenrichtung zu `battery_purchase_prices` (dort `cascade`) und aus demselben Grund richtig:
-- dort haengt der Preis AM Geraet und waere ohne es sinnlos, hier haengt das Geraet am Baustein
-- und verloere seine Kostengrundlage. Ausdruecklich KEIN `set null` — das waere die bekannte
-- Falle (ein referenzielles UPDATE, das an einem Unveraenderlichkeits-Trigger scheitert), und es
-- naehme einem aktiven Geraet im Vorbeigehen die Freigabe-Voraussetzung.
alter table public.battery_catalog
  add column foundation_component_id   uuid references public.battery_cost_components (id) on delete restrict,
  add column installation_component_id uuid references public.battery_cost_components (id) on delete restrict;

comment on column public.battery_catalog.foundation_component_id is
  'K1b: der Fundament-Baustein dieses Geraets. Bei requires_foundation = true und aktivem Geraet '
  'PFLICHT, und der Baustein muss einen Preis tragen (Trigger battery_catalog_guard_components).';
comment on column public.battery_catalog.installation_component_id is
  'K1b: der Installations-Baustein. IMMER optional — die Engine hat fuer Montage/Elektroanschluss '
  'kein Feld (Bestandsaufnahme §2) und rechnet sie nicht mit; die Angabe dient der Angebotslegung.';

create index battery_catalog_foundation_component_idx
  on public.battery_catalog (foundation_component_id)
  where foundation_component_id is not null;
create index battery_catalog_installation_component_idx
  on public.battery_catalog (installation_component_id)
  where installation_component_id is not null;

-- Der CHECK verliert seine Fundament-Zeile: die neue Bedingung liegt ueber ZWEI Tabellen und ist
-- als CHECK nicht formulierbar (ein CHECK sieht nur die eigene Zeile). Sie zieht nach TEIL 3 um.
-- Alles Uebrige bleibt Wort fuer Wort stehen.
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
      and list_price_net is not null
      and inverter_included is not null
      and requires_foundation is not null
      and (inverter_included or extra_inverter_cost_net is not null)
    )
  );

-- In Produktion vor dem Umbau gemessen: beide Spalten tragen 0 Werte ungleich null. Es geht
-- also nichts verloren, und es gibt nichts zu ueberfuehren.
alter table public.battery_catalog
  drop column foundation_cost_net,
  drop column installation_cost_net;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — Die Freigabe-Regel als Trigger
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠ WARUM EIN TRIGGER UND KEIN CHECK: die Bedingung fragt nach dem PREIS EINER ANDEREN ZEILE
-- („traegt der zugeordnete Baustein einen Preis?"). Ein CHECK darf das nicht — er sieht nur die
-- eigene Zeile, und ein Unterabfrage-CHECK ist in PostgreSQL nicht erlaubt. Der Trigger hat
-- dieselbe Reichweite wie der CHECK, den er ersetzt: er gilt auch fuer `service_role` und
-- `postgres`, weil er an der TABELLE haengt und nicht an einem Wrapper.

create function public.battery_catalog_guard_components()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_art   text;
  v_price numeric;
begin
  -- Ein Baustein der falschen Art waere eine stille Verwechslung: ein Installationspreis, der als
  -- Fundament durchgeht. Die Pruefung gilt IMMER, nicht nur beim Aktivieren — ein Entwurf mit
  -- vertauschten Bausteinen wuerde sonst erst bei der Freigabe auffallen.
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

  -- Die eigentliche Freigabe-Bedingung. Sie steht hier und nicht im CHECK, s. Kopf dieses Teils.
  -- Der Installations-Baustein wird ausdruecklich NICHT verlangt: die Engine rechnet ihn nicht mit.
  if new.active and new.requires_foundation is true and new.foundation_component_id is null then
    raise exception 'battery_catalog: das Geraet ist fundamentpflichtig und hat keinen Fundament-Baustein zugeordnet'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.battery_catalog_guard_components() is
  'K1b: setzt zwei Invarianten auf Speicherebene durch — (a) ein zugeordneter Baustein hat die '
  'passende Art, immer; (b) ein AKTIVES fundamentpflichtiges Geraet hat einen Fundament-Baustein '
  'MIT Preis. (b) ist die Fortsetzung von battery_catalog_active_complete ueber die Tabellengrenze '
  'hinweg, die ein CHECK nicht leisten kann. Gilt auch fuer service_role und postgres.';

create trigger battery_catalog_guard_components
  before insert or update on public.battery_catalog
  for each row
  execute function public.battery_catalog_guard_components();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — Der Preis darf einem aktiven Geraet nicht unter den Fuessen weggezogen werden
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Ohne diesen Trigger liesse sich die Regel aus TEIL 3 von der anderen Seite aushebeln: erst
-- zuordnen und aktivieren, dann den Preis des Bausteins leeren. Das Geraet bliebe aktiv und der
-- Rechner saehe ein fundamentpflichtiges Geraet ohne Fundamentpreis — genau der Zustand, den
-- TEIL 3 verhindern soll. Das LOESCHEN des Bausteins faengt dagegen schon der Fremdschluessel ab
-- (`on delete restrict`), dafuer braucht es hier nichts.

create function public.battery_cost_components_guard_price()
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
       and (b.foundation_component_id = old.id or b.installation_component_id = old.id);
    if v_used_by is not null then
      raise exception 'battery_cost_components: der Preis kann nicht entfallen, der Baustein wird von aktiven Geraeten genutzt (%)', v_used_by
        using errcode = '23514';
    end if;
  end if;

  -- Ein Artwechsel an einem bereits zugeordneten Baustein bräche die Art-Zusage aus TEIL 3, ohne
  -- dass dort etwas geschrieben wird — der Trigger auf battery_catalog feuert nicht mit. Deshalb
  -- hier gesperrt, sobald IRGENDEIN Geraet darauf zeigt (nicht nur ein aktives).
  if new.art is distinct from old.art
     and exists (select 1 from public.battery_catalog b
                  where b.foundation_component_id = old.id or b.installation_component_id = old.id) then
    raise exception 'battery_cost_components: die Art kann nicht geaendert werden, der Baustein ist Geraeten zugeordnet'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.battery_cost_components_guard_price() is
  'K1b: verhindert, dass die Freigabe-Regel aus TEIL 3 von der Baustein-Seite ausgehebelt wird — '
  'ein Preis kann nicht entfallen, solange AKTIVE Geraete den Baustein nutzen, und die Art kann '
  'nicht wechseln, solange irgendein Geraet darauf zeigt. Gilt auch fuer service_role und postgres.';

create trigger battery_cost_components_guard_price
  before update on public.battery_cost_components
  for each row
  execute function public.battery_cost_components_guard_price();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 5 — Die Wrapper für die Bausteine
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Alle nach dem K1-Muster: SECURITY DEFINER, `set search_path = ''`, erste ausführbare Zeile
-- `if not platform.is_admin() then raise ... 42501`, Grant NUR an `authenticated`. `service_role`
-- bekommt ausdrücklich KEINEN — ein Preis ist die Entscheidung eines Menschen.

create function public.admin_list_cost_components(p_art text default null)
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

  -- Die Nutzungszahl fährt HIER mit und nicht in einem zweiten Aufruf: die Liste muss zeigen, ob
  -- ein Löschen abgewiesen würde, und zwei Abfragen könnten dazwischen auseinanderlaufen.
  select coalesce(jsonb_agg(to_jsonb(r) order by r.art, r.bezeichnung), '[]'::jsonb) into v_rows
  from (
    select c.*,
           (select count(*) from public.battery_catalog b
             where b.foundation_component_id = c.id or b.installation_component_id = c.id) as used_by_count,
           (select count(*) from public.battery_catalog b
             where b.active and (b.foundation_component_id = c.id or b.installation_component_id = c.id)) as used_by_active_count
      from public.battery_cost_components c
     where p_art is null or c.art = p_art
  ) r;

  return v_rows;
end;
$$;

create function public.admin_get_cost_component(p_id uuid)
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
             where b.foundation_component_id = c.id or b.installation_component_id = c.id) as used_by_count,
           (select count(*) from public.battery_catalog b
             where b.active and (b.foundation_component_id = c.id or b.installation_component_id = c.id)) as used_by_active_count
      from public.battery_cost_components c where c.id = p_id
  ) r;

  if v_row is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  return v_row;
end;
$$;

create function public.admin_create_cost_component(
  p_art text,
  p_bezeichnung text,
  p_beschreibung text default null,
  p_price_net numeric default null,
  p_price_as_of date default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_art         text := lower(nullif(btrim(p_art), ''));
  v_bezeichnung text := nullif(btrim(p_bezeichnung), '');
  v_id          uuid;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_create_cost_component: Adminrolle erforderlich' using errcode = '42501';
  end if;
  if v_art is null or v_bezeichnung is null then
    return jsonb_build_object('status', 'missing_fields');
  end if;
  if v_art not in ('fundament', 'installation') then
    return jsonb_build_object('status', 'invalid_art');
  end if;
  if p_price_net is not null and p_price_net < 0 then
    return jsonb_build_object('status', 'invalid_price');
  end if;

  insert into public.battery_cost_components (art, bezeichnung, beschreibung, price_net, price_as_of, notes)
  values (v_art, v_bezeichnung, nullif(btrim(p_beschreibung), ''), p_price_net, p_price_as_of,
          nullif(btrim(p_notes), ''))
  returning id into v_id;

  return jsonb_build_object('status', 'created', 'id', v_id);
end;
$$;

create function public.admin_update_cost_component(
  p_id uuid,
  p_art text,
  p_bezeichnung text,
  p_beschreibung text default null,
  p_price_net numeric default null,
  p_price_as_of date default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_art         text := lower(nullif(btrim(p_art), ''));
  v_bezeichnung text := nullif(btrim(p_bezeichnung), '');
  v_count       integer;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_update_cost_component: Adminrolle erforderlich' using errcode = '42501';
  end if;
  if v_art is null or v_bezeichnung is null then
    return jsonb_build_object('status', 'missing_fields');
  end if;
  if v_art not in ('fundament', 'installation') then
    return jsonb_build_object('status', 'invalid_art');
  end if;
  if p_price_net is not null and p_price_net < 0 then
    return jsonb_build_object('status', 'invalid_price');
  end if;

  -- Die beiden Trigger-Abweisungen aus TEIL 4 kommen als benannter Status zurück statt als
  -- Datenbankfehler: die Oberfläche soll sagen können, WARUM, ohne einen SQLSTATE zu deuten.
  begin
    update public.battery_cost_components set
      art          = v_art,
      bezeichnung  = v_bezeichnung,
      beschreibung = nullif(btrim(p_beschreibung), ''),
      price_net    = p_price_net,
      price_as_of  = p_price_as_of,
      notes        = nullif(btrim(p_notes), '')
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

create function public.admin_delete_cost_component(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_delete_cost_component: Adminrolle erforderlich' using errcode = '42501';
  end if;

  -- `on delete restrict` würde das ohnehin abweisen; hier wird daraus eine Antwort, die die
  -- Oberfläche anzeigen kann. Die harte Grenze bleibt der Fremdschlüssel.
  begin
    delete from public.battery_cost_components where id = p_id;
    get diagnostics v_count = row_count;
  exception when foreign_key_violation then
    return jsonb_build_object('status', 'in_use');
  end;

  if v_count = 0 then
    return jsonb_build_object('status', 'not_found');
  end if;
  return jsonb_build_object('status', 'deleted');
end;
$$;

grant execute on function public.admin_list_cost_components(text) to authenticated;
grant execute on function public.admin_get_cost_component(uuid) to authenticated;
grant execute on function public.admin_create_cost_component(text, text, text, numeric, date, text) to authenticated;
grant execute on function public.admin_update_cost_component(uuid, text, text, text, numeric, date, text) to authenticated;
grant execute on function public.admin_delete_cost_component(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 6 — Die Geräte-Wrapper ziehen nach
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Die beiden Leser (`admin_list_battery_catalog`, `admin_get_battery`) selektieren `b.*` und
-- bekämen die neuen Spalten von selbst — aber nur als nackte UUID. Sie liefern deshalb zusätzlich
-- Bezeichnung und Preis des zugeordneten Bausteins mit: die Geräteliste muss zeigen, ob eine
-- Freigabe scheitern würde, und ein zweiter Aufruf je Zeile wäre eine Abfrage je Gerät.

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
           ic.price_net   as installation_component_price_net
      from public.battery_catalog b
      left join platform.battery_purchase_prices pp on pp.battery_id = b.id
      left join public.battery_cost_components fc on fc.id = b.foundation_component_id
      left join public.battery_cost_components ic on ic.id = b.installation_component_id
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
           ic.price_net   as installation_component_price_net
      from public.battery_catalog b
      left join platform.battery_purchase_prices pp on pp.battery_id = b.id
      left join public.battery_cost_components fc on fc.id = b.foundation_component_id
      left join public.battery_cost_components ic on ic.id = b.installation_component_id
     where b.id = p_id
  ) r;

  if v_row is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  return v_row;
end;
$$;

-- ── admin_create_battery / admin_update_battery ─────────────────────────────────────────────────
-- BRECHEND: DROP+CREATE, weil sich der TYP zweier Parameter ändert (numeric → uuid) und damit
-- auch die Signatur. Die Grants werden danach erneut gesetzt.

drop function public.admin_create_battery(
  text, text, text, integer, numeric, numeric, numeric, numeric, boolean, numeric,
  boolean, numeric, numeric, date, text, text, text, text);

create function public.admin_create_battery(
  p_kategorie text,
  p_hersteller text,
  p_bezeichnung text,
  p_memodo_id integer default null,
  p_usable_capacity_kwh numeric default null,
  p_max_power_kw numeric default null,
  p_round_trip_efficiency numeric default null,
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

  begin
    insert into public.battery_catalog (
      kategorie, hersteller, bezeichnung, memodo_id, usable_capacity_kwh, max_power_kw,
      round_trip_efficiency, list_price_net, inverter_included, extra_inverter_cost_net,
      requires_foundation, foundation_component_id, installation_component_id, price_as_of,
      source_url, datasheet_url, control_type, notes
    ) values (
      v_kategorie, v_hersteller, v_bezeichnung, p_memodo_id, p_usable_capacity_kwh, p_max_power_kw,
      p_round_trip_efficiency, p_list_price_net, p_inverter_included, p_extra_inverter_cost_net,
      p_requires_foundation, p_foundation_component_id, p_installation_component_id, p_price_as_of,
      nullif(btrim(p_source_url), ''), nullif(btrim(p_datasheet_url), ''), v_control_type,
      nullif(btrim(p_notes), '')
    ) returning id into v_id;
  exception
    when unique_violation then
      return jsonb_build_object('status', 'duplicate_memodo_id');
    -- Die Art-Prüfung aus TEIL 3 wirft 22023; sie wird zur benannten Antwort statt zum Fehler.
    when invalid_parameter_value then
      return jsonb_build_object('status', 'invalid_component', 'detail', sqlerrm);
    when foreign_key_violation then
      return jsonb_build_object('status', 'unknown_component');
  end;

  return jsonb_build_object('status', 'created', 'id', v_id);
end;
$$;

drop function public.admin_update_battery(
  uuid, text, text, text, integer, numeric, numeric, numeric, numeric, boolean, numeric,
  boolean, numeric, numeric, date, text, text, text, text);

create function public.admin_update_battery(
  p_id uuid,
  p_kategorie text,
  p_hersteller text,
  p_bezeichnung text,
  p_memodo_id integer default null,
  p_usable_capacity_kwh numeric default null,
  p_max_power_kw numeric default null,
  p_round_trip_efficiency numeric default null,
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

  begin
    update public.battery_catalog set
      kategorie                 = v_kategorie,
      hersteller                = v_hersteller,
      bezeichnung               = v_bezeichnung,
      memodo_id                 = p_memodo_id,
      usable_capacity_kwh       = p_usable_capacity_kwh,
      max_power_kw              = p_max_power_kw,
      round_trip_efficiency     = p_round_trip_efficiency,
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
    -- Ein AKTIVES Gerät, dem hier der Fundament-Baustein genommen würde: TEIL 3 weist das ab.
    when check_violation then
      return jsonb_build_object('status', 'would_break_active', 'detail', sqlerrm);
  end;

  if v_count = 0 then
    return jsonb_build_object('status', 'not_found');
  end if;
  return jsonb_build_object('status', 'updated');
end;
$$;

-- ── admin_set_battery_active ────────────────────────────────────────────────────────────────────
-- Die Fundament-Zeile der Vollständigkeitsprüfung wird ZWEI Zeilen: der Baustein kann fehlen ODER
-- unbepreist sein. Beides muss die Oberfläche unterscheiden können — „ordne einen Baustein zu" und
-- „trage im Baustein einen Preis ein" sind verschiedene Handgriffe an verschiedenen Stellen.
create or replace function public.admin_set_battery_active(p_id uuid, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     public.battery_catalog%rowtype;
  v_price   numeric;
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

grant execute on function public.admin_create_battery(
  text, text, text, integer, numeric, numeric, numeric, numeric, boolean, numeric,
  boolean, uuid, uuid, date, text, text, text, text) to authenticated;
grant execute on function public.admin_update_battery(
  uuid, text, text, text, integer, numeric, numeric, numeric, numeric, boolean, numeric,
  boolean, uuid, uuid, date, text, text, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 7 — Drei Fundament-Bausteine, OHNE Preis, und die eindeutigen Zuordnungen
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Die drei Klassen sind eine Einteilung nach Grösse/Gewicht, nicht nach Hersteller: dieselbe
-- Bodenplatte trägt einen 107-kWh-Schrank von SMA wie einen von SolarEdge. Sie entstehen OHNE
-- Preis und sind damit eine BENANNTE LÜCKE — die neun fundamentpflichtigen Geräte sagen danach
-- „mir fehlt der Preis DIESES Bausteins" statt „mir fehlt irgendein Betrag".
--
-- ⚠ Die Zuordnung läuft über `public.admin_update_battery`, nicht über ein direktes UPDATE — die
-- Zuordnung ist eine Admin-Entscheidung, und der Weg dorthin soll derselbe sein, den die
-- Oberfläche nimmt (samt Art-Prüfung aus TEIL 3). Dafür nimmt der Block eine Admin-Sitzung an:
-- gibt es kein Admin-Konto (frische Datenbank, CI), bleibt die Zuordnung aus und die Bausteine
-- stehen trotzdem da.

insert into public.battery_cost_components (art, bezeichnung, beschreibung) values
  ('fundament', 'Outdoor-Schrank bis ~110 kWh',
   'Bodenplatte für einen einzelnen Aussenschrank der kleinen Klasse (bis rund 110 kWh '
   'Nennkapazität, Gerätegewicht bis rund 1,5 t). Preis noch offen.'),
  ('fundament', 'Outdoor-Schrank ~190–260 kWh',
   'Bodenplatte für einen einzelnen Aussenschrank der mittleren Klasse (rund 190 bis 260 kWh '
   'Nennkapazität, Gerätegewicht rund 2 bis 3 t). Preis noch offen.'),
  ('fundament', 'Outdoor ≥ 500 kWh',
   'Bodenplatte für Aussenaufstellung ab rund 500 kWh Nennkapazität (Container- oder '
   'Mehrschrank-Aufbau). Heute keinem Gerät zugeordnet. Preis noch offen.');

do $$
declare
  v_admin  uuid;
  v_klein  uuid;
  v_mittel uuid;
  v_rows   public.battery_catalog[];
  v_ziele  uuid[];
  v_row    public.battery_catalog%rowtype;
  v_result jsonb;
  i        integer;
begin
  select user_id into v_admin from platform.user_roles where role = 'admin' limit 1;
  if v_admin is null then
    raise notice 'K1b: kein Admin-Konto gefunden — die Bausteine stehen, die Zuordnung unterbleibt.';
    return;
  end if;

  select id into v_klein  from public.battery_cost_components where bezeichnung = 'Outdoor-Schrank bis ~110 kWh';
  select id into v_mittel from public.battery_cost_components where bezeichnung = 'Outdoor-Schrank ~190–260 kWh';

  -- Eindeutig nach Nennkapazität. Bewusst NICHT dabei: memodo 16259 („2x SolarEdge CSS-OD 102.4")
  -- — zwei getrennte Schränke der kleinen Klasse sind weder ein Gerät der mittleren Klasse noch
  -- ein Baustein; welche der beiden Lesarten gilt, entscheidet ein Mensch.
  select array_agg(b order by b.memodo_id),
         array_agg(case when t.klasse = 'klein' then v_klein else v_mittel end order by b.memodo_id)
    into v_rows, v_ziele
    from (values
      (12650, 'klein'), (15687, 'klein'), (15823, 'klein'), (15824, 'klein'),
      (15920, 'mittel'), (15921, 'mittel'), (15826, 'mittel'), (12956, 'mittel')
    ) as t(memodo_id, klasse)
    join public.battery_catalog b on b.memodo_id = t.memodo_id;

  if coalesce(array_length(v_rows, 1), 0) = 0 then
    raise notice 'K1b: keines der acht Geräte gefunden — die Zuordnung unterbleibt.';
    return;
  end if;

  -- ⚠ NUR die JWT-Angabe wird gesetzt, NICHT die Rolle gewechselt. `platform.is_admin()` liest
  -- ausschliesslich `auth.uid()` aus `request.jwt.claims`; die aufrufende Rolle prüft sie nicht.
  -- Ein `set local role authenticated` wäre also nutzlos und zugleich schädlich: die Migration
  -- liefe danach als `authenticated` weiter, und der Supabase-CLI kann seinen eigenen Eintrag in
  -- `supabase_migrations.schema_migrations` dann nicht mehr schreiben (42501, gemessen — der Lauf
  -- bricht ganz am Ende ab und rollt alles zurück).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  for i in 1 .. array_length(v_rows, 1) loop
    v_row := v_rows[i];

    v_result := public.admin_update_battery(
      p_id                        => v_row.id,
      p_kategorie                 => v_row.kategorie,
      p_hersteller                => v_row.hersteller,
      p_bezeichnung               => v_row.bezeichnung,
      p_memodo_id                 => v_row.memodo_id,
      p_usable_capacity_kwh       => v_row.usable_capacity_kwh,
      p_max_power_kw              => v_row.max_power_kw,
      p_round_trip_efficiency     => v_row.round_trip_efficiency,
      p_list_price_net            => v_row.list_price_net,
      p_inverter_included         => v_row.inverter_included,
      p_extra_inverter_cost_net   => v_row.extra_inverter_cost_net,
      p_requires_foundation       => v_row.requires_foundation,
      p_foundation_component_id   => v_ziele[i],
      p_installation_component_id => v_row.installation_component_id,
      p_price_as_of               => v_row.price_as_of,
      p_source_url                => v_row.source_url,
      p_datasheet_url             => v_row.datasheet_url,
      p_control_type              => v_row.control_type,
      p_notes                     => v_row.notes
    );

    if v_result->>'status' <> 'updated' then
      raise exception 'K1b: Zuordnung fuer memodo_id % abgewiesen: %', v_row.memodo_id, v_result;
    end if;
  end loop;
end $$;
