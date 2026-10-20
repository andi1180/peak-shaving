-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Leadgen-Umbau Schritt 4b — Anfrage zum Profi-Report (/profi-report)
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- 1. Herkunft 'profi-report-anfrage' (eigene Server Action, kein Formular der Lead-Registry).
-- 2. `platform.profi_report_requests`: die Lastgang-Angabe je Anfrage (hat am Lead keine Spalte)
--    und die Sperre gegen Doppelabsendung — Muster `platform.schnellreport_requests` (3b-2).
-- Keine Einwilligung: eine Anfrage ist eine erbetene Kontaktaufnahme (Vertragsanbahnung), wie das
-- Kontaktformular. Die Nachricht wird nicht gespeichert, sie steht nur in der Benachrichtigung.
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

insert into platform.lead_sources (key, label) values
  ('profi-report-anfrage', 'Profi-Report-Anfrage')
on conflict (key) do nothing;

create table platform.profi_report_requests (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references platform.leads (id) on delete cascade,
  has_load_profile text not null check (has_load_profile in ('ja', 'nein', 'unsicher')),
  created_at timestamptz not null default now()
);

create index profi_report_requests_lead_created_idx
  on platform.profi_report_requests (lead_id, created_at desc);

comment on table platform.profi_report_requests is
  'Leadgen 4b: je Anfrage zum Profi-Report die Lastgang-Angabe. RLS ohne Policy, für keine Rolle '
  'ein Tabellenrecht; geschrieben nur über public.record_profi_report_request.';

alter table platform.profi_report_requests enable row level security;
revoke all on table platform.profi_report_requests from public, anon, authenticated, service_role;

create function public.record_profi_report_request(
  p_lead_id uuid,
  p_has_load_profile text,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_window_seconds is null or p_window_seconds < 0 then
    raise exception 'public.record_profi_report_request: p_window_seconds ungültig'
      using errcode = '22023';
  end if;

  -- Gegen den Doppelklick: zwei gleichzeitige Absendungen desselben Leads laufen nacheinander.
  perform pg_advisory_xact_lock(hashtextextended('profi-report:' || p_lead_id::text, 0));

  if exists (
    select 1 from platform.profi_report_requests r
     where r.lead_id = p_lead_id
       and r.created_at > now() - make_interval(secs => p_window_seconds)
  ) then
    return jsonb_build_object('status', 'duplicate');
  end if;

  insert into platform.profi_report_requests (lead_id, has_load_profile)
  values (p_lead_id, p_has_load_profile)
  returning id into v_id;

  return jsonb_build_object('status', 'created', 'id', v_id);
end;
$$;

comment on function public.record_profi_report_request(uuid, text, integer) is
  'Leadgen 4b: legt eine Zeile in platform.profi_report_requests an — oder antwortet '
  '{status: duplicate}, wenn für denselben Lead innerhalb von p_window_seconds schon eine besteht. '
  '{status: created, id}. service_role-only.';

revoke all on function public.record_profi_report_request(uuid, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.record_profi_report_request(uuid, text, integer)
  to service_role;
