-- D12 Teil 1: platform.report_render_requests — die kurzlebige Übergabe eines fertig gerechneten
-- Ergebnisses an den Report-Renderer in `apps/website`.
--
-- ── WOZU ES DIESE TABELLE GIBT ──────────────────────────────────────────────────────────────────
-- `apps/website` kann ein `AnalysisResult` heute nur erzeugen, nicht laden: das Ergebnis lebt
-- ausschliesslich im Worker-State des Browsers, und die einzige Route ist der Rechner selbst. Ein
-- Report, den jemand ANDERES (der Admin-Bereich) gerechnet hat, hat damit keinen Weg in die
-- bestehende PDF-Kette. Diese Tabelle ist dieser Weg — ein Behälter mit Ablaufdatum, kein Archiv.
--
-- ── WARUM NICHT platform.analyses ───────────────────────────────────────────────────────────────
-- Die ist ausdrücklich das Gegenteil: append-only, sieben Jahre, eine bewusste Handlung je Zeile
-- (B14-1). Ein Renderlauf ist keine archivierte Auslegung, und jeden Renderlauf dort abzulegen
-- machte die Unterscheidung „betreute Analyse / Probelauf" wertlos, für die `analysis_kind`
-- existiert. `platform.analyses` wird von dieser Migration NICHT angefasst.
--
-- ── ⚠ DER LESEWEG IST UNANGEMELDET, UND DAS IST DIE ENTSCHEIDUNG DIESER MIGRATION ───────────────
-- `apps/website` hat keine Anmeldung (kein Konto, kein Entitlement, nur anon- und
-- service_role-Schlüssel). `get_report_render_request` prüft deshalb bewusst KEINE Adminrolle. Was
-- den Zugriff begrenzt, sind drei Dinge und sonst nichts:
--   1. die ID ist eine zufällige UUID und das einzige Geheimnis — sie ist nicht ableitbar;
--   2. es gibt KEINE Auflistungsfunktion, also keinen Weg, IDs zu finden;
--   3. `expires_at` — nach Ablauf antwortet die Funktion leer, die Zeile ist nicht mehr lesbar.
-- Wer hier später eine Listen- oder Suchfunktion ergänzt, hebt (2) auf und damit den ganzen Schutz.
--
-- ⚠ Der Inhalt ist ein Kunden-Lastgang. Die TTL ist deshalb keine Aufräum-Bequemlichkeit, sondern
-- die Begrenzung: eine Zeile ohne Ablauf wäre ein dauerhaft offener Lesezugang zu den
-- Verbrauchsdaten eines Geschäftskunden, geschützt allein durch eine URL, die in Verläufen,
-- Weiterleitungen und Logs stehenbleibt.
--
-- KEIN Aufräum-Job: die Prüfung in `get_report_render_request` trägt die Korrektheit; das Löschen
-- abgelaufener Zeilen ist ein späteres, nicht blockierendes Anliegen.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — die Tabelle
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
create table platform.report_render_requests (
  id uuid primary key default gen_random_uuid(),

  -- Wie bei platform.analyses.created_by: ein Renderlauf entsteht durch einen MENSCHEN, der ihn
  -- verantwortet (created_by = auth.uid() im Wrapper) — nicht durch einen signaturbasierten Dienst.
  --
  -- ⚠ ON DELETE CASCADE und NICHT SET NULL, weil die Spalte `not null` ist: die Kombination
  -- `not null` + `on delete set null` macht das Konto unlöschbar (23502) — fünfmal aufgetreten,
  -- zuletzt bei partner_applications.user_id. Cascade ist hier zudem die richtige Aussage: die
  -- Zeile lebt Stunden und trägt keine Aufbewahrungspflicht, anders als eine Analyse.
  created_by uuid not null references auth.users (id) on delete cascade,

  created_at timestamptz not null default now(),
  -- Der Vorgabewert gilt für einen direkten INSERT; der Wrapper setzt ihn aus p_ttl_hours.
  expires_at timestamptz not null default now() + interval '6 hours',

  -- Der vollständige AnalysisResult (§3.10) und der rohe Lastgang, wortgleich wie gerechnet. Der
  -- Lastgang steht getrennt daneben, weil er bewusst NICHT Teil des AnalysisResult ist
  -- (DispatchTrace führt keine Rohreihe) — die Report-Charts brauchen ihn trotzdem.
  analysis_result jsonb not null,
  load_profile jsonb not null,

  -- Offener Behälter für alles, was der Renderer ausser Ergebnis und Lastgang noch braucht
  -- (Deckblatt, Tarif-Herkunft, geschätzte PV). Seine Form legt der SCHREIBENDE Schritt fest —
  -- hier bewusst ohne Struktur, damit diese Migration sie nicht vorwegnimmt.
  report_input_meta jsonb not null default '{}'::jsonb
);

comment on table platform.report_render_requests is
  'D12: kurzlebige Übergabe eines gerechneten Ergebnisses an den Report-Renderer in apps/website. '
  'KEIN Archiv — das ist platform.analyses (append-only, 7 Jahre). Gelesen wird ausschliesslich '
  'über public.get_report_render_request, und zwar UNANGEMELDET: apps/website hat keine Anmeldung. '
  'Der Zugriff ist allein durch die unratbare ID, das Fehlen jeder Auflistungsfunktion und '
  'expires_at begrenzt. Wer eine Listenfunktion ergänzt, hebt diesen Schutz auf.';

comment on column platform.report_render_requests.expires_at is
  'Nach diesem Zeitpunkt liefert public.get_report_render_request nichts mehr. Die Zeile bleibt '
  'zunächst stehen (kein Aufräum-Job) — massgeblich ist die Prüfung im Wrapper.';

comment on column platform.report_render_requests.report_input_meta is
  'Offener jsonb-Behälter für die übrigen Eingangsgrössen des Reports. Form bewusst nicht '
  'festgelegt: sie gehört zum Schreibpfad, nicht zum Speicher.';

-- Der einzige Zugriffspfad des Lesers ist die id; ein Index auf expires_at lohnt erst mit einem
-- Aufräum-Job, den es hier bewusst nicht gibt.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — die zwei Wrapper
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

-- ── Schreiben: authenticated + Adminrolle, Muster admin_create_analysis (B14-1) ──────────────────
create function public.create_report_render_request(
  p_analysis_result jsonb,
  p_load_profile jsonb,
  p_report_input_meta jsonb default '{}'::jsonb,
  p_ttl_hours int default 6
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not platform.is_admin() then
    raise exception 'public.create_report_render_request: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  if p_analysis_result is null or p_load_profile is null then
    raise exception
      'public.create_report_render_request: analysis_result und load_profile sind Pflicht'
      using errcode = '22023';
  end if;

  -- Die Obergrenze ist kein Formalismus: die TTL IST der Schutz des unangemeldeten Leseweges
  -- (s. Kopf). Ein frei wählbarer Wert machte daraus einen dauerhaften Zugang.
  if p_ttl_hours is null or p_ttl_hours < 1 or p_ttl_hours > 24 then
    raise exception
      'public.create_report_render_request: ttl_hours muss zwischen 1 und 24 liegen, erhalten: %',
      coalesce(p_ttl_hours::text, '<null>')
      using errcode = '22023';
  end if;

  insert into platform.report_render_requests (
    created_by, expires_at, analysis_result, load_profile, report_input_meta
  )
  values (
    auth.uid(),
    now() + make_interval(hours => p_ttl_hours),
    p_analysis_result,
    p_load_profile,
    coalesce(p_report_input_meta, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.create_report_render_request(jsonb, jsonb, jsonb, int) is
  'D12: legt eine Übergabe für den Report-Renderer an und gibt ihre id zurück. WIRFT bei fehlender '
  'Adminrolle (42501). authenticated-only, ausdrücklich auch ohne service_role-Grant: created_by '
  'ist auth.uid(), über service_role bliebe die Spalte strukturell leer (Muster '
  'admin_create_analysis, B14-1). ttl_hours ist auf 1..24 begrenzt, weil die TTL der einzige '
  'zeitliche Schutz des unangemeldeten Leseweges ist.';

-- ── Lesen: anon UND authenticated, bewusst OHNE Adminprüfung ─────────────────────────────────────
create function public.get_report_render_request(p_id uuid)
returns table (
  analysis_result jsonb,
  load_profile jsonb,
  report_input_meta jsonb
)
language sql
security definer
stable
set search_path = ''
as $$
  -- Eine abgelaufene und eine unbekannte id sind ununterscheidbar — beide liefern nichts. Ein
  -- eigener Zustand für „gab es, ist abgelaufen" wäre eine Auskunft über fremde Renderläufe
  -- (dieselbe Lesart wie get_active_partner bei stillgelegten Fachbetrieben, B16-2).
  select r.analysis_result, r.load_profile, r.report_input_meta
    from platform.report_render_requests r
   where r.id = p_id
     and r.expires_at > now();
$$;

comment on function public.get_report_render_request(uuid) is
  'D12: liefert Ergebnis, Lastgang und Meta einer NICHT abgelaufenen Übergabe — sonst leer. '
  'Bewusst OHNE is_admin()-Prüfung und an anon gegrantet: apps/website hat keine Anmeldung. Der '
  'Schutz liegt in der unratbaren id, im Fehlen jeder Auflistungsfunktion und in expires_at. '
  'Abgelaufen und unbekannt sind ununterscheidbar.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — RLS und Rechte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Muster platform.analyses/job_runs/admin_exports: RLS an, KEINE Policy, für KEINE Rolle ein
-- Tabellenrecht — auch nicht für service_role. Zwei unabhängige Schichten; die Tabelle ist
-- ausschliesslich über die zwei Funktionen oben erreichbar.
alter table platform.report_render_requests enable row level security;

revoke all on table platform.report_render_requests from public, anon, authenticated, service_role;

-- Supabases ALTER DEFAULT PRIVILEGES hat den beiden neuen public-Funktionen EXECUTE an anon,
-- authenticated und service_role gegeben (zusätzlich zum PostgreSQL-Default an PUBLIC). Erst allen
-- entziehen, dann gezielt gewähren.
revoke all on function public.create_report_render_request(jsonb, jsonb, jsonb, int)
  from public, anon, authenticated, service_role;
grant execute on function public.create_report_render_request(jsonb, jsonb, jsonb, int)
  to authenticated;

revoke all on function public.get_report_render_request(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_report_render_request(uuid) to anon, authenticated;
