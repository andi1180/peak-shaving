-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- B24, Station 6 (KI-Check) — `platform.project_messages` bekommt eine `kind`-Spalte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Fachlich: `Pflichtenheft_Kalkulator_Delta_KI-Interface.md` (§2.2 Chat-Zustand, §3.1 freies
-- Gespräch). Diese Migration legt AUSSCHLIESSLICH die Datenhaltung an — System-Prompt, Werkzeugliste
-- und Oberfläche des Energieberater-Gesprächs sind ein eigener, späterer Schritt.
--
-- ── DIE ENTSCHEIDUNG: EINE TABELLE, EIN SATZ FUNKTIONEN, GEFILTERT STATT VERDOPPELT ─────────────
-- Der admin-interne Energieberater-Chat ist strukturell dasselbe wie das Kunden-Gespräch: ein
-- Turn-für-Turn-Verlauf aus Blöcken, der ins Modell wiedereingespielt wird, an EINEM Projekt hängt
-- und über `platform.project_accessible` autorisiert wird. Eine zweite Tabelle wäre damit eine
-- zweite RLS-Fläche, ein zweites Paar Wrapper und eine zweite Stelle, an der die
-- Rollen-/Block-Invarianten (`project_messages_role_check`, `project_messages_content_is_array`)
-- gepflegt werden müssten — und beim nächsten Umbau laufen die zwei Fassungen auseinander. Was die
-- zwei Gespräche trennt, ist WER sie führt und WAS sie behandeln, nicht ihre Form: das ist eine
-- Spalte, kein Schema.
--
-- ⚠ WAS DIESE MIGRATION AUSDRÜCKLICH NICHT ÄNDERT: keine neue RLS-Policy, kein Tabellen-Grant, kein
-- neuer Schreibweg. Die Rechtefläche bleibt Zeichen für Zeichen dieselbe — einziger Schreibweg auf
-- `platform.project_messages` bleibt `public.append_project_message`, einziger Leseweg
-- `public.list_project_messages`, beide `authenticated`-only und beide autorisiert über
-- `platform.project_accessible` (eigenes Projekt ODER Adminrolle). Der Energieberater-Chat ist
-- damit für einen Admin auf JEDEM Projekt erreichbar und für einen Kunden auf keinem fremden —
-- ohne dass dafür eine einzige Zeile Zugriffsentscheidung neu geschrieben wird.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — die Spalte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
alter table platform.project_messages
  add column kind text not null default 'kunde'
    constraint project_messages_kind_check check (kind in ('kunde', 'ki_check'));

comment on column platform.project_messages.kind is
  'B24 Station 6: WELCHES Gespraech diese Zeile gehoert — kunde (der Chat des Kunden, Delta §3.1) '
  'oder ki_check (das admin-interne Energieberater-Gespraech). Vorgabewert kunde, weil jede vor '
  'diesem Schritt entstandene Zeile eine Kunden-Nachricht IST: es gab bis hierher keine zweite Art. '
  'Der Vorgabewert erledigt damit den Bestand beim Anlegen der Spalte vollstaendig — es braucht kein '
  'nachtraegliches UPDATE, und es gibt keinen Zustand "unbekannter Art".';

-- ── DER BESTEHENDE INDEX BLEIBT ─────────────────────────────────────────────────────────────────
-- `project_messages_project_created_idx` (project_id, created_at) bedient weiterhin jede Abfrage
-- OHNE kind-Filter. Der neue Index bedient die ab jetzt übliche: EIN Gespräch EINER Art, in
-- Zeitfolge. Ihn nicht als Ersatz zu setzen ist bewusst — ein (project_id, kind, created_at)-Index
-- trägt eine kind-lose Abfrage nur über einen Skip-Scan, und ein Verlauf wird bei jedem Turn
-- vollständig gelesen.
create index project_messages_project_kind_created_idx
  on platform.project_messages (project_id, kind, created_at);

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — append_project_message um p_kind erweitern
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠ DROP + CREATE, NICHT `create or replace` — ein zusätzlicher Parameter ÄNDERT DIE SIGNATUR.
-- `create or replace` legte eine zweite, überladene Funktion daneben; ein Aufruf mit drei Argumenten
-- wäre danach zwischen der alten Drei-Parameter-Fassung und der neuen Vier-Parameter-Fassung mit
-- Vorgabewert MEHRDEUTIG (42725) — und zwar erst zur Laufzeit, nicht beim Anlegen. Das DROP matcht
-- die Signatur EXAKT und ohne `cascade`: gäbe es wider Erwarten schon eine zweite Überladung, soll
-- es scheitern statt die falsche zu treffen. Die Grants hängen an der Funktion, nicht am Namen, und
-- werden deshalb unten erneut gesetzt.
--
-- ⚠ DER VORGABEWERT IST KEINE KOSMETIK, ER IST DIE ABWÄRTSKOMPATIBILITÄT. Der bestehende
-- Kunden-Chat (`apps/web/lib/project-chat/supabase-ports.ts`) ruft beide Funktionen mit BENANNTEN
-- Argumenten und ohne `p_kind` auf. Mit `default 'kunde'` übersteht er diese Migration ohne eine
-- Zeile Codeänderung und schreibt/liest weiterhin ausschliesslich Kunden-Zeilen.
drop function public.append_project_message(uuid, text, jsonb);

create function public.append_project_message(
  p_project_id uuid,
  p_role text,
  p_content jsonb,
  p_kind text default 'kunde'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := nullif(btrim(coalesce(p_role, '')), '');
  v_kind text := nullif(btrim(coalesce(p_kind, 'kunde')), '');
  v_id   uuid;
begin
  if not platform.project_accessible(p_project_id) then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_role is null or v_role not in ('user', 'assistant', 'tool_call', 'tool_result') then
    return jsonb_build_object('status', 'invalid_role');
  end if;

  -- Als STATUS abgewiesen, nicht als roher 23514 aus dem CHECK: ein Constraint-Fehler traegt keinen
  -- Feldbezug, den ein Aufrufer anzeigen koennte. Der CHECK bleibt trotzdem stehen — er ist die
  -- Grenze, dieser Zweig die Meldung (dieselbe Aufteilung wie bei v_role).
  if v_kind is null or v_kind not in ('kunde', 'ki_check') then
    return jsonb_build_object('status', 'invalid_kind');
  end if;

  -- Ein leeres Array wird ABGEWIESEN und nicht durchgelassen: eine Nachricht ohne Bloecke ist beim
  -- Wiedereinspielen in die Messages-API ein Fehler, und sie hier zu speichern hiesse, ihn in den
  -- naechsten Lauf zu vertagen. Die Reihenfolge ist Absicht — erst die Form, dann der Inhalt.
  if p_content is null or jsonb_typeof(p_content) <> 'array' then
    return jsonb_build_object('status', 'invalid_content');
  end if;
  if jsonb_array_length(p_content) = 0 then
    return jsonb_build_object('status', 'empty_content');
  end if;

  insert into platform.project_messages (project_id, role, content, kind)
  values (p_project_id, v_role, p_content, v_kind)
  returning id into v_id;

  return jsonb_build_object('status', 'ok', 'message_id', v_id);
end;
$$;

comment on function public.append_project_message(uuid, text, jsonb, text) is
  'B24: haengt EINE Nachricht an den Verlauf. Der einzige Schreibweg auf platform.project_messages — '
  'es gibt bewusst kein update und kein delete (die Unveraenderlichkeit des Verlaufs sitzt in der '
  'Rechteflaeche, nicht in einem Trigger; ein Trigger wuerde das Kaskadenloeschen des Projekts '
  'abweisen). Verlangt ein nicht-leeres Array von Bloecken: eine Nachricht ohne Bloecke ist beim '
  'Wiedereinspielen in die Messages-API ein Fehler, und ihn zu speichern hiesse, ihn zu vertagen. '
  'p_kind waehlt das Gespraech (kunde / ki_check) und steht auf kunde, damit bestehende '
  'Drei-Argument-Aufrufer unveraendert weiterlaufen. authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — list_project_messages um p_kind erweitern
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Dieselbe DROP+CREATE-Begründung wie in TEIL 2. Hier ist die Mehrdeutigkeit sogar der Regelfall:
-- die Funktion hat bereits zwei Parameter mit Vorgabewert, ein Aufruf mit EINEM Argument träfe bei
-- zwei nebeneinanderstehenden Überladungen garantiert beide.
--
-- ÄLTESTE ZUERST bleibt (der Verlauf wird ins Modell wiedereingespielt, ein Gespräch in umgekehrter
-- Reihenfolge ist kein Gespräch). `p_kind` steht am ENDE der Parameterliste: PostgreSQL verlangt,
-- dass nach einem Parameter mit Vorgabewert alle weiteren einen tragen — weiter vorne stehend
-- verschöbe er ausserdem die Bedeutung jedes positionellen Bestandsaufrufs.
drop function public.list_project_messages(uuid, integer, integer);

create function public.list_project_messages(
  p_project_id uuid,
  p_limit integer default 200,
  p_offset integer default 0,
  p_kind text default 'kunde'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_kind   text    := coalesce(nullif(btrim(coalesce(p_kind, '')), ''), 'kunde');
  v_total  integer;
  v_rows   jsonb;
begin
  if not platform.project_accessible(p_project_id) then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Der Filter sitzt in `base` und NICHT erst in `page`: sonst zaehlte `total` beide Gespraeche
  -- zusammen, und die "letzte n Turns"-Rechnung des Aufrufers (Versatz aus total) liefe ins Leere.
  with base as (
    select m.id, m.project_id, m.role, m.content, m.kind, m.created_at
    from platform.project_messages m
    where m.project_id = p_project_id
      and m.kind = v_kind
  ),
  page as (
    select b.* from base b order by b.created_at, b.id limit v_limit offset v_offset
  )
  select (select count(*)::integer from base),
         coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at, p.id) from page p), '[]'::jsonb)
    into v_total, v_rows;

  return jsonb_build_object('status', 'ok', 'total', v_total, 'messages', v_rows);
end;
$$;

comment on function public.list_project_messages(uuid, integer, integer, text) is
  'B24: der Verlauf eines Projekts, AELTESTE ZUERST — anders als jede andere Liste dieses Repos, '
  'weil dieser Verlauf ins Modell wiedereingespielt wird und ein Gespraech in umgekehrter Reihenfolge '
  'keines ist. Obergrenze 500 je Aufruf, Gesamtzahl getrennt (wer die letzten n Turns will, rechnet '
  'den Versatz daraus). Zweitsortierung nach id, damit zwei Nachrichten mit identischem Zeitstempel '
  'eine feste Reihenfolge haben. p_kind waehlt das Gespraech und steht auf kunde — ein bestehender '
  'Aufrufer sieht dadurch unveraendert NUR die Kunden-Zeilen. authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — die Grants der zwei neu angelegten Funktionen
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠ Das DROP hat die Grants MITGENOMMEN (sie haengen an der Funktion, nicht am Namen), und Supabase
-- vergibt auf JEDE neue public-Funktion ein direktes EXECUTE an anon, authenticated und service_role
-- zusaetzlich zum PostgreSQL-Default-Grant an PUBLIC. Deshalb wie ueberall: erst allen entziehen,
-- dann gezielt gewaehren. `service_role` bekommt ausdruecklich NICHTS — beide Funktionen leiten ihre
-- Autorisierung aus auth.uid() bzw. platform.is_admin() ab, was dort leer ist.
revoke all on function public.append_project_message(uuid, text, jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function public.list_project_messages(uuid, integer, integer, text)
  from public, anon, authenticated, service_role;

grant execute on function public.append_project_message(uuid, text, jsonb, text) to authenticated;
grant execute on function public.list_project_messages(uuid, integer, integer, text) to authenticated;
