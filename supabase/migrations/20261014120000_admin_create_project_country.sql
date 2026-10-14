-- Land (und optional PLZ) bei der Projektanlage im Admin.
--
-- Schritt 1b der Vorbereitung deutscher Projekte: das Land bestimmt später die Preisquelle, deshalb
-- soll es schon beim Anlegen bewusst gewählt werden. `admin_create_project` nahm bisher weder Land
-- noch PLZ an; das Projekt entstand mit der Spaltenvorgabe 'AT'.
--
-- Additiv: zwei neue Parameter mit Vorgabewert NULL → ein Aufruf mit den bisherigen Argumenten
-- (`(label)` bzw. `(label, account)`) bleibt gültig und legt wie bisher ein 'AT'-Projekt an. Die
-- Pflicht „Land gewählt" erzwingt die Server Action, nicht dieser Wrapper — die Spaltenvorgabe 'AT'
-- und die Constraints aus 20261014090000 bleiben unverändert.
--
-- DROP+CREATE, weil `create or replace` die Parameterliste nicht erweitern kann und ein blosses
-- CREATE eine zweite Überladung erzeugte. Grants danach wie in 20260909120000 (nur authenticated).

drop function public.admin_create_project(text, uuid);

create function public.admin_create_project(
  p_customer_label text,
  p_account_id uuid default null,
  p_country text default null,
  p_postal_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label       text := nullif(btrim(coalesce(p_customer_label, '')), '');
  v_country     text := nullif(btrim(coalesce(p_country, '')), '');
  v_postal_code text := nullif(btrim(coalesce(p_postal_code, '')), '');
  v_country_effective text;
  v_id          uuid;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_create_project: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  if v_label is null then
    return jsonb_build_object('status', 'invalid_label');
  end if;

  if v_country is not null and v_country not in ('AT', 'DE') then
    return jsonb_build_object('status', 'invalid_country');
  end if;

  -- Ohne Land gilt die Spaltenvorgabe ('AT'); die PLZ wird gegen das wirksame Land geprüft.
  v_country_effective := coalesce(v_country, 'AT');

  if v_postal_code is not null and not (
       (v_country_effective = 'AT' and v_postal_code ~ '^[0-9]{4}$')
    or (v_country_effective = 'DE' and v_postal_code ~ '^[0-9]{5}$')
  ) then
    return jsonb_build_object('status', 'invalid_postal_code');
  end if;

  -- Eine unbekannte Account-Kennung wird BENANNT abgewiesen, nicht als roher 23503 durchgereicht.
  if p_account_id is not null
     and not exists (select 1 from platform.accounts a where a.id = p_account_id) then
    return jsonb_build_object('status', 'unknown_account');
  end if;

  insert into platform.projects (account_id, customer_label, created_by, country, postal_code)
  values (p_account_id, v_label, auth.uid(), v_country_effective, v_postal_code)
  returning id into v_id;

  return jsonb_build_object('status', 'ok', 'project_id', v_id, 'account_id', p_account_id);
end;
$$;

comment on function public.admin_create_project(text, uuid, text, text) is
  'B24: ein Projekt als Admin anlegen. Setzt created_by = auth.uid() (KEIN Parameter fuer den '
  'Urheber). p_account_id optional (NULL = admin-gefuehrt); unbekannte Kennung → unknown_account. '
  'Seit 20261014120000 p_country (AT/DE) und p_postal_code (optional, Format je Land: AT vier, DE '
  'fuenf Ziffern, NICHT normalisiert): beide NULL/leer heisst wie bisher Land AT ohne PLZ — dass '
  'das Land bewusst gewaehlt wurde, erzwingt die Server Action. Status invalid_country bzw. '
  'invalid_postal_code. WIRFT ohne Adminrolle (42501). authenticated-only.';

-- ⚠ DROP+CREATE verliert die Grants, und Supabase vergibt per ALTER DEFAULT PRIVILEGES EXECUTE an
-- anon, authenticated UND service_role direkt: alles zurücknehmen, dann nur authenticated geben.
revoke all on function public.admin_create_project(text, uuid, text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_create_project(text, uuid, text, text) to authenticated;
