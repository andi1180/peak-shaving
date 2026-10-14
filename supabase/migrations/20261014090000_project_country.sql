-- Land am Projekt (AT/DE) und PLZ-Regel je Land.
--
-- Der Kalkulator soll später auch deutsche Projekte rechnen. Dieser Schritt legt NUR das Land an;
-- keine Rechnung ändert sich. Die Preiszone wird nicht gespeichert — sie folgt aus dem Land.
--
--   TEIL 1  platform.projects.country + PLZ-CHECK je Land (ersetzt projects_postal_code_check)
--   TEIL 2  public.update_project_postal_code nimmt das Land mit (DROP+CREATE, Grants neu)
--   TEIL 3  public.admin_get_project / public.get_project liefern country mit
--
-- ⚠ TEIL 3 IST DIE HÄLFTE DES SCHRITTS: beide Funktionen führen eine AUSGESCHRIEBENE Spaltenliste.
-- Ohne sie stünde das Land in der Datenbank und der Wizard zeigte nach jedem Neuladen wieder
-- „Österreich" — auch bei einem deutschen Projekt.
--
-- Abwärtskompatibel: ein Aufruf von update_project_postal_code mit den bisherigen zwei benannten
-- Argumenten bleibt gültig (p_country hat einen Vorgabewert).

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — Spalte und CHECK
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- NOT NULL DEFAULT 'AT': jedes bestehende Projekt ist ein österreichisches. Die PLZ bleibt wie
-- bisher nullbar („noch nicht erhoben").
alter table platform.projects
  add column country text not null default 'AT'
    constraint projects_country_check check (country in ('AT', 'DE'));

comment on column platform.projects.country is
  'Land des Projektstandorts (ISO 3166-1 alpha-2): AT oder DE. Entscheidet über das PLZ-Format '
  '(AT vier, DE fünf Ziffern) und darüber, ob österreichische PLZ-Regeln (Gebrauchsabgabe, '
  'PLZ-Koordinatentabelle) überhaupt greifen. Die Preiszone wird NICHT gespeichert, sondern aus '
  'dem Land abgeleitet.';

-- Der bisherige CHECK (auto-benannt, nur vier Ziffern) wird durch einen länderabhängigen ersetzt.
alter table platform.projects drop constraint projects_postal_code_check;

alter table platform.projects
  add constraint projects_postal_code_country_check check (
    postal_code is null
    or (country = 'AT' and postal_code ~ '^[0-9]{4}$')
    or (country = 'DE' and postal_code ~ '^[0-9]{5}$')
  );

comment on column platform.projects.postal_code is
  'B24: PLZ des Projektstandorts, Format je Land (projects_postal_code_country_check): AT vier, '
  'DE fünf Ziffern. NULL heisst „noch nicht erhoben", nicht „unbekannter Ort". Gilt PROJEKTWEIT. '
  'Ausdrücklich KEINE Adresse: keine Strasse, keine Hausnummer, kein Geocoding.';


-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — der Schreibweg
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Land und PLZ hängen über den CHECK aneinander: ein Land-Wechsel bei bestehender, nicht passender
-- PLZ würde mit 23514 scheitern. Beide werden deshalb in EINEM Aufruf gesetzt, und der Wrapper
-- prüft die Kombination VOR dem Schreiben und antwortet mit einem benannten Status.
--
-- null/leer heisst wie bisher UNVERÄNDERT (Lesart capture_lead). DROP+CREATE, weil create or
-- replace die Parameterliste nicht erweitern kann und ein blosses CREATE eine zweite Überladung
-- erzeugte.
drop function public.update_project_postal_code(uuid, text);

create function public.update_project_postal_code(
  p_id uuid,
  p_postal_code text default null,
  p_country text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_postal_code text := nullif(btrim(coalesce(p_postal_code, '')), '');
  v_country text := nullif(btrim(coalesce(p_country, '')), '');
  v_current_country text;
  v_current_postal_code text;
  v_country_effective text;
  v_postal_code_effective text;
begin
  if not platform.project_accessible(p_id) then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_country is not null and v_country not in ('AT', 'DE') then
    return jsonb_build_object('status', 'invalid_country');
  end if;

  select pr.country, pr.postal_code
    into v_current_country, v_current_postal_code
  from platform.projects pr
  where pr.id = p_id;

  v_country_effective := coalesce(v_country, v_current_country);
  v_postal_code_effective := coalesce(v_postal_code, v_current_postal_code);

  if v_postal_code_effective is not null and not (
       (v_country_effective = 'AT' and v_postal_code_effective ~ '^[0-9]{4}$')
    or (v_country_effective = 'DE' and v_postal_code_effective ~ '^[0-9]{5}$')
  ) then
    return jsonb_build_object('status', 'invalid_postal_code');
  end if;

  update platform.projects
     set country = v_country_effective,
         postal_code = v_postal_code_effective
   where id = p_id;

  return jsonb_build_object('status', 'ok');
end;
$$;

comment on function public.update_project_postal_code(uuid, text, text) is
  'B24: setzt PLZ und Land des Projektstandorts. p_postal_code/p_country null oder leer heisst '
  'UNVERAENDERT (Lesart capture_lead, nicht admin_update_lead). Geprueft wird das FORMAT der '
  'Kombination (AT vier, DE fuenf Ziffern; Status invalid_postal_code bzw. invalid_country); OB es '
  'die PLZ gibt, entscheidet lookupPostalCodeCentroid im Anwendungscode und nur fuer AT. Es wird '
  'NICHT normalisiert. Fremd und unbekannt liefern denselben Status not_found. authenticated-only.';

-- ⚠ DROP+CREATE verliert die Grants, und Supabase vergibt per ALTER DEFAULT PRIVILEGES EXECUTE an
-- anon, authenticated UND service_role direkt: alles zurücknehmen, dann nur authenticated geben.
revoke all on function public.update_project_postal_code(uuid, text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.update_project_postal_code(uuid, text, text) to authenticated;


-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — die Leser liefern das Land mit
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Spaltenlisten wortgleich zu 20260913090000, ergänzt um `pr.country`. Signatur unverändert, also
-- `create or replace`: die Grants bleiben.
create or replace function public.admin_get_project(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_project jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_get_project: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select to_jsonb(p)
    into v_project
  from (
    select pr.id,
           pr.account_id,
           pr.customer_label,
           pr.segment,
           pr.industry,
           pr.postal_code,
           pr.country,
           pr.created_by,
           (select au.email from auth.users au where au.id = pr.created_by) as created_by_email,
           pr.created_at,
           pr.updated_at
    from platform.projects pr
    where pr.id = p_id
  ) p;

  if v_project is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object('status', 'ok', 'project', v_project);
end;
$$;

comment on function public.admin_get_project(uuid) is
  'B24: EIN Projekt als Admin, unabhaengig von account_id. Liefert created_by UND das dazu '
  'aufgeloeste created_by_email (auth.users ist fuer keine Client-Rolle lesbar, Muster '
  'admin_get_analysis), seit 20260911090000 segment und industry, seit 20260913090000 postal_code '
  'und seit 20261014090000 country. WIRFT ohne Adminrolle (42501), liefert sonst {status: '
  'not_found} fuer eine unbekannte Kennung. authenticated-only.';

create or replace function public.get_project(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_project jsonb;
begin
  if not platform.project_accessible(p_id) then
    return jsonb_build_object('status', 'not_found');
  end if;

  select to_jsonb(p)
    into v_project
  from (
    select pr.id, pr.account_id, pr.customer_label, pr.segment, pr.industry, pr.postal_code,
           pr.country, pr.created_at, pr.updated_at
    from platform.projects pr
    where pr.id = p_id
  ) p;

  return jsonb_build_object('status', 'ok', 'project', v_project);
end;
$$;

comment on function public.get_project(uuid) is
  'B24: EIN Projekt samt segment, industry, postal_code (seit 20260913090000) und country (seit '
  '20261014090000) — eigenes ODER (als Admin) ein beliebiges. Ergaenzt get_my_project, das '
  'unveraendert bleibt und nur die Kundensicht kennt. Liefert bewusst KEIN created_by (Kundensicht) '
  'und keinen draft mehr — der ENTWURF liegt am ZAEHLPUNKT. Fremd und unbekannt liefern denselben '
  'Status not_found. authenticated-only.';
