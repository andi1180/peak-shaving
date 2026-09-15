-- B24: Admin kann ein Projekt endgültig löschen.
--
-- platform.projects kaskadiert bereits auf project_messages/project_documents/
-- project_open_questions/metering_points (alle vier ON DELETE CASCADE) — ein DELETE auf projects
-- genügt für die Datenbankseite; die Storage-Bytes der Dokumente entfernt die Anwendungsseite VOR
-- diesem Aufruf (SQL kann den Bucket nicht anfassen).
create function public.admin_delete_project(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted_id uuid;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_delete_project: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  delete from platform.projects where id = p_project_id
  returning id into v_deleted_id;

  if v_deleted_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object('status', 'ok', 'project_id', v_deleted_id);
end;
$$;

comment on function public.admin_delete_project(uuid) is
  'Loescht ein Projekt endgueltig samt kaskadierten Zeilen. WIRFT ohne Adminrolle (42501). '
  'authenticated-only.';

-- Supabase vergibt per ALTER DEFAULT PRIVILEGES EXECUTE an anon/authenticated/service_role direkt,
-- nicht ueber PUBLIC — ein blosses `revoke ... from public` liesse die drei Grants stehen.
revoke all on function public.admin_delete_project(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_delete_project(uuid) to authenticated;
