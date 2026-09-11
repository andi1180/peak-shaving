-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- B24 — platform.projects.draft faellt
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Der Abschluss des Entwurfs-Umzugs aus der Migration 20260911150000. Dort blieb die Spalte stehen
-- und wurde EINGEFROREN — nicht aus Vorsicht, sondern weil in Produktion ein realer Entwurfsbestand
-- darin lag und es dafuer kein Ziel gab (das betroffene Projekt hatte null Zaehlpunkte, ein Backfill
-- haette also einen anlegen muessen, und damit ueber die Struktur eines Betriebs entschieden).
--
-- ⚠ DIE VORAUSSETZUNG IST GEMESSEN, NICHT ANGENOMMEN. Am 11.09.2026 wurde das betroffene Projekt
-- (customer_label = 'test', ein Testlauf) nach ausdruecklicher Bestaetigung aus der Produktion
-- entfernt. Danach gegen die Produktion abgefragt: `select count(*) from platform.projects where
-- draft is not null and draft <> '{}'::jsonb` liefert **0**. Die Spalte traegt keinen Inhalt mehr,
-- und der Grund, aus dem sie stehenblieb, ist damit entfallen.
--
-- Arbeitsregel 1 ist gefahren, BEVOR die Spalte faellt: alle Funktionsruempfe in `public` und
-- `platform` per pg_get_functiondef nach `draft` durchsucht (11.09.2026, gegen die Produktion).
-- Vier Treffer, davon genau EINER auf DIESER Spalte:
--   * public.get_project              → liest pr.draft            ⇒ TEIL 1, zieht mit
--   * public.list_metering_points     → liest mp.draft            ⇒ andere Tabelle, unberuehrt
--   * public.update_metering_point_draft → schreibt mp.draft      ⇒ andere Tabelle, unberuehrt
--   * public.update_project_draft     → nennt `draft` nur im Kommentar, fasst sie seit
--                                       20260911150000 nicht mehr an ⇒ unberuehrt
-- Ohne diesen Durchlauf waere `get_project` beim ERSTEN Aufruf gebrochen, nicht beim Anlegen der
-- Migration — plpgsql prueft Funktionsruempfe nicht beim Anlegen.
--
-- ⚠ WAS DIESE MIGRATION NICHT ANFASST: `platform.metering_points.draft`. Das ist die Spalte, an die
-- der Entwurf umgezogen IST; sie traegt den laufenden Arbeitsstand und bleibt selbstverstaendlich.
-- Wer die beiden verwechselt, loescht den Umzug statt seines Rueckstands.
-- ═════════════════════════════════════════════════════════════════════════════════════════════════


-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — get_project liefert draft nicht mehr mit
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Muss VOR dem drop column stehen: die Funktion fuehrt eine ausgeschriebene Spaltenliste, und ein
-- `drop column` liesse sie unveraendert im Katalog stehen und erst beim naechsten Aufruf brechen.
--
-- Die Spaltenliste ist im Uebrigen WORT FUER WORT die bisherige (Migration 20260910150000), nur
-- ohne `pr.draft` — hier ist nichts inhaltlich entschieden. Signatur unveraendert, also
-- `create or replace`: die Grants bleiben, es gibt nichts nachzusetzen.
--
-- Der TypeScript-Leser ist davon nicht betroffen: `ProjectSnapshot` traegt `draft` seit
-- 20260911150000 nicht mehr, und `to_jsonb` liefert schlicht ein Feld weniger.
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
    select pr.id, pr.account_id, pr.customer_label, pr.segment, pr.industry,
           pr.created_at, pr.updated_at
    from platform.projects pr
    where pr.id = p_id
  ) p;

  return jsonb_build_object('status', 'ok', 'project', v_project);
end;
$$;

comment on function public.get_project(uuid) is
  'B24: EIN Projekt samt segment und industry — eigenes ODER (als Admin) ein beliebiges. Ergaenzt '
  'get_my_project, das unveraendert bleibt und nur die Kundensicht kennt. Liefert bewusst KEIN '
  'created_by (Kundensicht) und seit der Migration 20260911160000 keinen draft mehr — der '
  'ENTWURF liegt am ZAEHLPUNKT (list_metering_points). Fremd und unbekannt liefern denselben '
  'Status not_found. authenticated-only.';


-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — die Spalte faellt
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Ohne `if exists`: die Spalte IST da, und ein stiller Durchlauf auf einer Datenbank, auf der sie
-- fehlt, verdeckte genau den Zustand, den man sehen will.
alter table platform.projects drop column draft;
