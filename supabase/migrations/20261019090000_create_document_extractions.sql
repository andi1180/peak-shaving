-- Auslesestatus je Dokument (Punkt 1, PR 2 von 3).
--
-- Heute stehen Ausleseergebnisse nur im Zaehlpunkt-Entwurf (`_invoiceExtractions`), und
-- `update_metering_point_draft` ersetzt den ganzen Entwurf — parallele Scans koennen dort nicht je
-- Dokument schreiben. Diese Tabelle haelt Status und Ergebnis je (Dokument, Art); zusammengefuehrt
-- wird spaeter einmal am Ende (PR 3). In diesem Schritt nutzt sie noch kein Ablauf.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — Tabelle
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
create table platform.document_extractions (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null references platform.projects (id) on delete cascade,
  document_id uuid not null references platform.project_documents (id) on delete cascade,
  metering_point_id uuid references platform.metering_points (id) on delete cascade,

  -- Erweiterung um weitere Dokumentarten per Migration (CHECK ersetzen).
  kind text not null check (kind in ('invoice')),
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed')),

  result jsonb,
  error text,
  attempts int not null default 0,
  extractor_version text,

  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (document_id, kind)
);

create index document_extractions_project_mp_kind_idx
  on platform.document_extractions (project_id, metering_point_id, kind);

comment on table platform.document_extractions is
  'Auslesestatus und -ergebnis je Dokument und Art (vorerst nur invoice). Genau eine Zeile je '
  '(document_id, kind); ein erneuter Lauf setzt dieselbe Zeile zurueck und zaehlt attempts hoch. '
  'project_id ist redundant zum Dokument und wird im Wrapper aus ihm abgeleitet, nie uebernommen. '
  'Zugriff nur ueber start_/finish_/list_document_extraction(s).';

-- Muster `metering_points`: RLS an, KEINE Policy, kein Tabellenrecht fuer Client-Rollen.
alter table platform.document_extractions enable row level security;
revoke all on table platform.document_extractions from anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — Wrapper
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- „Gibt es nicht" und „gehoert jemand anderem" liefern denselben Status `not_found` — auch fuer ein
-- Dokument oder einen Zaehlpunkt aus einem anderen Projekt.

create function public.start_document_extraction(
  p_document_id uuid,
  p_metering_point_id uuid,
  p_kind text,
  p_extractor_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_row platform.document_extractions;
begin
  select d.project_id into v_project_id
  from platform.project_documents d
  where d.id = p_document_id;

  if v_project_id is null or not platform.project_accessible(v_project_id) then
    return jsonb_build_object('status', 'not_found');
  end if;

  if p_metering_point_id is not null and not exists (
    select 1 from platform.metering_points mp
    where mp.id = p_metering_point_id and mp.project_id = v_project_id
  ) then
    return jsonb_build_object('status', 'not_found');
  end if;

  if p_kind is null or p_kind not in ('invoice') then
    return jsonb_build_object('status', 'invalid_kind');
  end if;

  -- Anlegen und danach sperren: ein gleichzeitiger zweiter Aufruf wartet am Konflikt bzw. an der
  -- Zeilensperre und sieht dann 'running'.
  insert into platform.document_extractions (project_id, document_id, metering_point_id, kind)
  values (v_project_id, p_document_id, p_metering_point_id, p_kind)
  on conflict (document_id, kind) do nothing;

  select * into v_row
  from platform.document_extractions e
  where e.document_id = p_document_id and e.kind = p_kind
  for update;

  -- Ein seit ueber 10 Minuten laufender Eintrag gilt als abgebrochen und darf neu starten.
  if v_row.status = 'running' and v_row.started_at > now() - interval '10 minutes' then
    return jsonb_build_object('status', 'already_running', 'extraction', to_jsonb(v_row));
  end if;

  update platform.document_extractions e
     set status            = 'running',
         attempts          = e.attempts + 1,
         started_at        = now(),
         finished_at       = null,
         error             = null,
         metering_point_id = p_metering_point_id,
         extractor_version = p_extractor_version,
         updated_at        = now()
   where e.id = v_row.id
  returning * into v_row;

  return jsonb_build_object('status', 'ok', 'extraction', to_jsonb(v_row));
end;
$$;

comment on function public.start_document_extraction(uuid, uuid, text, text) is
  'Legt die Auslese-Zeile (Dokument, Art) an oder setzt sie auf running (attempts + 1). '
  'already_running, solange derselbe Lauf juenger als 10 Minuten ist. Prueft '
  'platform.project_accessible am Projekt des Dokuments und dass der Zaehlpunkt dazugehoert. '
  'authenticated-only.';

create function public.finish_document_extraction(
  p_id uuid,
  p_status text,
  p_result jsonb,
  p_error text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row platform.document_extractions;
begin
  select * into v_row
  from platform.document_extractions e
  where e.id = p_id
  for update;

  if v_row.id is null or not platform.project_accessible(v_row.project_id) then
    return jsonb_build_object('status', 'not_found');
  end if;

  if p_status is null or p_status not in ('done', 'failed') then
    return jsonb_build_object('status', 'invalid_status');
  end if;

  if v_row.status <> 'running' then
    return jsonb_build_object('status', 'not_running', 'extraction', to_jsonb(v_row));
  end if;

  -- Ein Fehlschlag laesst ein frueheres Ergebnis stehen.
  update platform.document_extractions e
     set status      = p_status,
         result      = case when p_status = 'done' then p_result else e.result end,
         error       = case when p_status = 'done' then null else p_error end,
         finished_at = now(),
         updated_at  = now()
   where e.id = p_id
  returning * into v_row;

  return jsonb_build_object('status', 'ok', 'extraction', to_jsonb(v_row));
end;
$$;

comment on function public.finish_document_extraction(uuid, text, jsonb, text) is
  'Schliesst einen laufenden Auslesevorgang mit done oder failed ab (nur aus running). Bei done wird '
  'error genullt, bei failed bleibt result unveraendert. authenticated-only.';

create function public.list_document_extractions(
  p_project_id uuid,
  p_metering_point_id uuid default null,
  p_kind text default null
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
  if not platform.project_accessible(p_project_id) then
    return jsonb_build_object('status', 'not_found');
  end if;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at, e.id), '[]'::jsonb)
    into v_rows
  from platform.document_extractions e
  where e.project_id = p_project_id
    and (p_metering_point_id is null or e.metering_point_id = p_metering_point_id)
    and (p_kind is null or e.kind = p_kind);

  return jsonb_build_object('status', 'ok', 'extractions', v_rows);
end;
$$;

comment on function public.list_document_extractions(uuid, uuid, text) is
  'Die Auslese-Zeilen eines Projekts, aelteste zuerst, optional nach Zaehlpunkt und Art gefiltert. '
  'authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — Grants
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Supabase vergibt in `public` per Default-ACL EXECUTE direkt an anon/authenticated/service_role —
-- ein blosses `revoke ... from public` liesse die stehen.
revoke all on function public.start_document_extraction(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.finish_document_extraction(uuid, text, jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function public.list_document_extractions(uuid, uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.start_document_extraction(uuid, uuid, text, text) to authenticated;
grant execute on function public.finish_document_extraction(uuid, text, jsonb, text) to authenticated;
grant execute on function public.list_document_extractions(uuid, uuid, text) to authenticated;
