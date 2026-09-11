-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- B24 — update_project_draft heisst jetzt update_project_segment_industry
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Reine Umbenennung. SIGNATUR UNVERAENDERT (uuid, text, text), VERHALTEN UNVERAENDERT — der Rumpf
-- ist WORT FUER WORT der aus der Migration 20260911150000 uebernommene, inklusive aller
-- Validierungen (Segment-Werteliste, Branchen-Format, die Pruefung gegen das NACH diesem Aufruf
-- geltende Segment). Hier ist fachlich nichts entschieden.
--
-- ⚠ WARUM UEBERHAUPT: Seit 20260911150000 fasst die Funktion den Entwurf nicht mehr an — sie setzt
-- Segment und Branche. Der alte Name behauptete also das Gegenteil dessen, was sie tut, und die
-- Vorgaengermigration hat diese Umbenennung ausdruecklich als „eigene, jederzeit nachholbare
-- Entscheidung" angekuendigt und die mitzuziehenden Orte aufgezaehlt (supabase-ports.ts, drei
-- DB-Gate-Dateien, database.types.ts). Genau die sind in diesem Schritt nachgezogen.
--
-- ⚠ POSTGRES KENNT KEIN UMBENENNEN EINER FUNKTION, das die Grants mitnimmt. `alter function …
-- rename to …` gibt es zwar, es wuerde hier aber den bestehenden Rumpf unter neuem Namen stehen
-- lassen und die Grants am Objekt behalten — ein Weg, der funktioniert. Gewaehlt ist trotzdem
-- ANLEGEN + DROP, weil der Rumpf dann in der Migration LESBAR danebensteht: wer 2027 fragt, was
-- diese Funktion tut, findet die Antwort hier und nicht drei Migrationen vorher unter einem Namen,
-- den es nicht mehr gibt.
--
-- ⚠ DAS DROP MATCHT DIE SIGNATUR EXAKT. `drop function public.update_project_draft(uuid, text,
-- text)` — nicht `drop function … cascade` und nicht ohne Argumentliste: waere je eine zweite
-- Ueberladung im Katalog, soll das Drop scheitern statt die falsche zu treffen.
-- ═════════════════════════════════════════════════════════════════════════════════════════════════


-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — die neue Funktion
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.update_project_segment_industry(
  p_id uuid,
  p_segment text default null,
  p_industry text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_segment   text := nullif(btrim(coalesce(p_segment, '')), '');
  v_industry  text := nullif(btrim(coalesce(p_industry, '')), '');
  v_effective text;
begin
  if not platform.project_accessible(p_id) then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_segment is not null and v_segment not in ('privat', 'betrieb') then
    return jsonb_build_object('status', 'invalid_segment');
  end if;

  if v_industry is not null then
    if v_industry !~ '^[a-z0-9][a-z0-9_]*$' then
      return jsonb_build_object('status', 'invalid_industry');
    end if;

    -- Das Segment, das NACH diesem Aufruf gilt: das mitgeschickte, sonst das bestehende. Gegen das
    -- bestehende allein geprueft scheiterte der legitime Fall „Segment und Branche in einem Zug".
    select coalesce(v_segment, pr.segment)
      into v_effective
      from platform.projects pr
     where pr.id = p_id;

    if v_effective is distinct from 'betrieb' then
      return jsonb_build_object(
        'status', 'industry_requires_betrieb',
        'segment', v_effective
      );
    end if;
  end if;

  update platform.projects
     set segment  = coalesce(v_segment, segment),
         industry = coalesce(v_industry, industry)
   where id = p_id;

  return jsonb_build_object('status', 'ok');
end;
$$;

comment on function public.update_project_segment_industry(uuid, text, text) is
  'B24: setzt Segment und Branche eines Projekts — beides in einem Zug, damit der legitime Fall '
  '„neues Segment PLUS passende Branche" nicht an der Reihenfolge zweier Aufrufe scheitert. '
  'p_segment und p_industry null heissen UNVERAENDERT (Lesart capture_lead, nicht '
  'admin_update_lead). Eine Branche gibt es NUR bei segment = betrieb (Status '
  'industry_requires_betrieb, geprueft gegen das nach diesem Aufruf geltende Segment); sie wird '
  'NICHT kleingeschrieben, ein Format-Verstoss ist invalid_industry. Eine bereits gesetzte Branche '
  'ueberlebt einen spaeteren Segmentwechsel. Hiess bis zur Migration 20260911170000 '
  'update_project_draft — ein Name, der seit dem Entwurfs-Umzug (20260911150000) das Gegenteil '
  'dessen behauptete, was die Funktion tut. authenticated-only.';


-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — die alte Funktion faellt
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
drop function public.update_project_draft(uuid, text, text);


-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — Rechte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠ ES MUSS `from public, anon, authenticated, service_role` HEISSEN, NICHT NUR `from public`.
-- Supabase vergibt per ALTER DEFAULT PRIVILEGES auf JEDE neue Funktion im `public`-Schema ein
-- EXECUTE an `anon`, `authenticated` UND `service_role` — DIREKT, nicht ueber die Pseudo-Rolle
-- PUBLIC. Ein blosses `revoke ... from public` liesse die drei Supabase-Grants stehen, und die neue
-- Funktion waere fuer `anon` aufrufbar.
--
-- Die Grants sind damit IDENTISCH zur abgeloesten Funktion: anon false, authenticated true,
-- service_role false. `anon` und `service_role` bekommen nichts, weil die Funktion ihre
-- Autorisierung ueber platform.project_accessible aus auth.uid() ableitet — und das ist dort null.
revoke all on function public.update_project_segment_industry(uuid, text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.update_project_segment_industry(uuid, text, text) to authenticated;
