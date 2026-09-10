-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- B24 — DER SCHREIBWEG FÜR platform.projects.industry
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Fachliche Quelle: `Pflichtenheft_Kalkulator_Delta_KI-Interface.md` §4.1 (Branchen-Pools als OFFENE
-- Liste). Diese Migration schliesst die grösste benannte Lücke des vorigen Schritts: die Migration
-- 20260910120000 hat die Spalte `platform.projects.industry` angelegt UND den Katalog-Leser, der
-- eine Branche entgegennimmt — dazwischen fehlte das Stück, das die Branche überhaupt an ein
-- Projekt schreibt. Der Spaltenkommentar sagt es wörtlich: „Hat in diesem Bauschritt bewusst noch
-- KEINEN Schreibweg."
--
-- Zwei Änderungen, sonst nichts:
--
--   TEIL 1  `public.get_project` liefert `industry` mit (create or replace, SIGNATUR UNVERÄNDERT)
--   TEIL 2  `public.update_project_draft` bekommt `p_industry` (DROP+CREATE, SIGNATUR ÄNDERT SICH)
--
-- Keine neue Tabelle, keine neue Spalte, kein neuer Wrapper, keine Änderung an den zehn übrigen
-- Wrappern des Chat-Zustands und keine an den sieben des Fragenkatalogs.
--
-- ── ⚠ WARUM TEIL 2 EIN DROP+CREATE IST UND KEIN `create or replace` ─────────────────────────────
-- Ein zusätzlicher Parameter ÄNDERT DIE SIGNATUR. `create or replace` legte deshalb keine neue
-- Fassung an, sondern eine ZWEITE, überladene Funktion daneben — und welche von beiden ein Aufrufer
-- trifft, entschiede die Zahl seiner Argumente. Ein Aufruf mit drei Argumenten liefe still in die
-- ALTE Fassung, die `industry` gar nicht kennt: die Branche verschwände, ohne dass irgendetwas
-- fehlschlüge. Nach dem DROP+CREATE sind die Grants weg (sie hängen an der Funktion, nicht am
-- Namen) und werden in TEIL 3 erneut gesetzt — dasselbe Vorgehen und derselbe Grund wie beim
-- Namens-Split (`capture_lead`/`admin_update_lead`, 24.07.2026).
--
-- ⚠ FÜR AUFRUFER: ein bestehender Aufruf mit BENANNTEN Argumenten (`p_id`, `p_draft`, `p_segment`)
-- bleibt gültig — der neue Parameter hat einen Vorgabewert. PostgREST ruft ausschliesslich benannt
-- auf; der einzige Aufrufer im Anwendungscode (`apps/web/lib/project-chat/supabase-ports.ts`) tut
-- das ebenfalls.
--
-- ── DIE EINE FACHLICHE REGEL, DIE DIE DATENBANK HIER DURCHSETZT ─────────────────────────────────
-- Eine Branche gibt es NUR bei einem Betrieb. Ein Privathaushalt hat keine, und eine trotzdem
-- eingetragene bestimmte später, welcher Fragen-Pool geladen wird (`list_question_catalog` nimmt
-- Segment UND Branche) — der Kunde bekäme Fragen aus einem Pool, der für ihn nicht gedacht ist.
-- Der Wrapper weist das deshalb mit `industry_requires_betrieb` ab, und zwar gegen das TATSÄCHLICHE
-- Segment der Zeile (bzw. gegen das, das im selben Aufruf gesetzt wird), nicht gegen eine Angabe
-- des Aufrufers. Das Werkzeug im Chat prüft dasselbe noch einmal, damit das Modell eine lesbare
-- Meldung bekommt statt eines Statuswortes — die Prüfung HIER ist die wirksame.
--
-- ── ⚠ OFFENGELEGT: EINE BEREITS GESETZTE BRANCHE ÜBERLEBT EINEN SEGMENTWECHSEL ──────────────────
-- Wird ein Projekt von `betrieb` auf `privat` korrigiert, NACHDEM eine Branche eingetragen wurde,
-- bleibt sie stehen. Das ist bewusst so und keine Auslassung:
--
--   * Sie beim Segmentwechsel zu NULLEN wäre eine stille Löschung einer Angabe des Kunden — genau
--     die Bewegung, die dieses Schema sonst überall vermeidet (`p_segment = null` heisst hier
--     „unverändert" und nicht „löschen", aus demselben Grund).
--   * Ein Tabellen-CHECK `(segment = 'betrieb' or industry is null)` machte den Segmentwechsel
--     stattdessen zu einem rohen 23514 — `set_segment` schlüge dann fehl, und das Modell könnte
--     den Fehler nicht beheben, weil ihm der Weg zum Nullen fehlt.
--
-- Sichtbar bleibt der Zustand trotzdem: der Zustandsblock des Chats nennt eine gesetzte Branche
-- IMMER und kennzeichnet sie ausdrücklich, wenn sie nicht zum Segment passt. Wer je einen Weg zum
-- Zurücknehmen baut, baut ihn sichtbar (eigener Parameter mit eigener Bedeutung), nicht als
-- Nebenwirkung des Segmentwechsels.
--
-- ── WAS NICHT ENTSTEHT ─────────────────────────────────────────────────────────────────────────
-- Kein Admin-Wrapper für `industry` (der Admin-Weg auf ein Projekt läuft über `get_project`, das die
-- Spalte ab jetzt liest — ein Schreibweg für den Admin hat noch keinen Aufrufer). Keine Befüllung
-- der Branchen-Pools (Delta §4.4: Inhalte sind Fachwissen, Owner Andreas/Martin). Keine Verdrahtung
-- des Fragenkatalogs an die Vollständigkeitsprüfung — das ist der nächste, eigene Schritt.
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — get_project liefert industry mit
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Die Funktion führt eine AUSGESCHRIEBENE Spaltenliste (kein `select *`, kein `to_jsonb(pr)` über
-- die Tabelle) — genau deshalb erschien `industry` bisher nirgends, obwohl die Spalte existiert.
-- Signatur unverändert, also `create or replace`: die Grants bleiben, es gibt nichts nachzusetzen.
--
-- Ohne diesen Teil könnte der Chat eine Branche zwar SETZEN, aber nie wieder LESEN: sein
-- Zustandsblock entsteht aus `get_project`, und was dort fehlt, existiert für das Modell nicht — es
-- fragte die Branche in jedem Turn neu.
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
    select pr.id, pr.account_id, pr.customer_label, pr.segment, pr.industry, pr.draft,
           pr.created_at, pr.updated_at
    from platform.projects pr
    where pr.id = p_id
  ) p;

  return jsonb_build_object('status', 'ok', 'project', v_project);
end;
$$;

comment on function public.get_project(uuid) is
  'B24: EIN Projekt samt segment, industry und draft — eigenes ODER (als Admin) ein beliebiges. '
  'Ergaenzt get_my_project, das unveraendert bleibt und nur die Kundensicht kennt. Liefert bewusst '
  'KEIN created_by (Kundensicht). Fremd und unbekannt liefern denselben Status not_found. '
  'authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — update_project_draft nimmt die Branche entgegen
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Die Branche fährt aus demselben Grund hier mit wie das Segment: sie wird IM SELBEN MOMENT vom
-- SELBEN Akteur bestimmt (das Gespräch erkennt „Hotel" und trägt zugleich die ersten Betriebsfelder
-- ein). Ein eigener Wrapper wäre eine zweite Transaktion für einen Vorgang.
--
-- ⚠ `p_industry = null` HEISST „UNVERÄNDERT", NICHT „LÖSCHEN" — wortgleich zu `p_segment` und aus
-- demselben Grund (Lesart `capture_lead`, nicht `admin_update_lead`): eine einmal bestimmte Branche
-- verliert man nicht dadurch, dass ein Aufrufer den Parameter weglässt. Ohne diese Lesart löschte
-- jeder gewöhnliche Entwurfs-Schreibvorgang die Branche mit, und niemand sähe es.
--
-- ⚠ ES WIRD NICHTS STILL KLEINGESCHRIEBEN. „Hotel" wird als `invalid_industry` ABGEWIESEN und nicht
-- zu `hotel` normalisiert — dieselbe Entscheidung wie in `admin_create_question_catalog_entry` und
-- aus demselben Grund: was der Aufrufer eingetragen hat und was gespeichert wurde, soll dasselbe
-- sein. Der Format-CHECK an der Spalte bleibt die Grenze, die Meldung entsteht hier (dieselbe
-- Aufteilung wie bei `invalid_draft`/`invalid_segment` darunter: ein roher 23514 trägt keinen
-- Feldbezug, den eine Oberfläche anzeigen könnte).
drop function public.update_project_draft(uuid, jsonb, text);

create function public.update_project_draft(
  p_id uuid,
  p_draft jsonb,
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

  -- Als STATUS abgewiesen, nicht als roher 23514 aus dem CHECK: ein Constraint-Fehler traegt keinen
  -- Feldbezug, den eine Oberflaeche anzeigen koennte (dieselbe Aufteilung wie bei den
  -- grid_tariff-Wrappern und bei create_my_project — Grenze im Schema, Meldung im Rumpf).
  if p_draft is null or jsonb_typeof(p_draft) <> 'object' then
    return jsonb_build_object('status', 'invalid_draft');
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
     set draft    = p_draft,
         segment  = coalesce(v_segment, segment),
         industry = coalesce(v_industry, industry)
   where id = p_id;

  return jsonb_build_object('status', 'ok');
end;
$$;

comment on function public.update_project_draft(uuid, jsonb, text, text) is
  'B24: schreibt den laufenden Entwurf und, falls uebergeben, Segment und Branche. ERSETZT den '
  'Entwurf statt ihn zu verschmelzen — eine flache Verschmelzung koennte einen Schluessel nie wieder '
  'entfernen, und genau das loest eine Korrektur im Gespraech aus. p_segment und p_industry null '
  'heissen UNVERAENDERT (Lesart capture_lead, nicht admin_update_lead). Eine Branche gibt es NUR bei '
  'segment = betrieb (Status industry_requires_betrieb, geprueft gegen das nach diesem Aufruf '
  'geltende Segment); sie wird NICHT kleingeschrieben, ein Format-Verstoss ist invalid_industry. '
  'Eine bereits gesetzte Branche ueberlebt einen spaeteren Segmentwechsel — das Nullen waere eine '
  'stille Loeschung (s. Migrationskopf). Ungueltige Eingaben werden als Status abgewiesen, nicht als '
  'roher CHECK-Fehler. authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — Rechte der neu angelegten Funktion
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠ DAS DROP HAT DIE GRANTS MITGENOMMEN — sie haengen an der Funktion, nicht am Namen. Ohne diesen
-- Block waere `update_project_draft` fuer `authenticated` nicht ausfuehrbar, und der Chat koennte ab
-- dieser Migration weder Entwurf noch Segment schreiben.
--
-- Und wie ueberall: Supabase vergibt per ALTER DEFAULT PRIVILEGES auf NEUE public-Funktionen
-- automatisch EXECUTE an anon, authenticated UND service_role. Erst allen entziehen, dann gezielt
-- gewaehren. `anon` und `service_role` bekommen nichts — die Funktion leitet ihre Autorisierung aus
-- auth.uid() ab, was dort null ist.
revoke all on function public.update_project_draft(uuid, jsonb, text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.update_project_draft(uuid, jsonb, text, text) to authenticated;
