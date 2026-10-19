-- Entfernte Rechnungen als 'removed' markieren (Punkt 1, PR 3b-1).
--
-- Die Datenbank ist die Wahrheit darüber, welche Dokumente ein Abschluss zusammenführt: eine im
-- Wizard entfernte Rechnung darf nicht über ihre 'done'-Zeile zurückkommen. Statt der Zeile zu
-- löschen (dann legte ein späterer start sie neu an), bleibt sie als 'removed' stehen.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — Status 'removed'
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
alter table platform.document_extractions
  drop constraint document_extractions_status_check;
alter table platform.document_extractions
  add constraint document_extractions_status_check
  check (status in ('pending', 'running', 'done', 'failed', 'removed'));

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — discard_document_extraction
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Aus jedem Status, auch 'running': ein danach eintreffendes finish antwortet 'not_running', das
-- Ergebnis landet also nicht mehr. Keine Zeile ist kein Fehler (Rechnungen von vor #516).
create function public.discard_document_extraction(
  p_document_id uuid,
  p_kind text
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

  update platform.document_extractions e
     set status      = 'removed',
         finished_at = now(),
         updated_at  = now()
   where e.document_id = p_document_id and e.kind = p_kind
  returning * into v_row;

  if v_row.id is null then
    return jsonb_build_object('status', 'no_row');
  end if;

  return jsonb_build_object('status', 'ok', 'extraction', to_jsonb(v_row));
end;
$$;

comment on function public.discard_document_extraction(uuid, text) is
  'Setzt die Auslese-Zeile (Dokument, Art) auf removed, aus jedem Status. no_row, wenn es keine '
  'gibt. Prüft platform.project_accessible am Projekt des Dokuments. authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — start_document_extraction: 'removed' bleibt stehen
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- create or replace bei unveränderter Signatur — die Grants aus #515 bleiben.
create or replace function public.start_document_extraction(
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

  -- Ein entferntes Dokument wird nicht wieder gelesen.
  if v_row.status = 'removed' then
    return jsonb_build_object('status', 'removed', 'extraction', to_jsonb(v_row));
  end if;

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
  'already_running, solange derselbe Lauf juenger als 10 Minuten ist; removed bleibt unverändert. '
  'Prueft platform.project_accessible am Projekt des Dokuments und dass der Zaehlpunkt dazugehoert. '
  'authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — Grants
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
revoke all on function public.discard_document_extraction(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.discard_document_extraction(uuid, text) to authenticated;
