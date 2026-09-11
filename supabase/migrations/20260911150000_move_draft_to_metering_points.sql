-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- B24 Teil 1 — DER ENTWURF ZIEHT VOM PROJEKT AN DEN ZAEHLPUNKT
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Was hier passiert:
--   TEIL 1  `platform.metering_points` waechst um `draft`
--   TEIL 2  `public.list_metering_points` liefert `draft` mit
--   TEIL 3  `public.update_metering_point_draft` — der neue Schreibweg
--   TEIL 4  `public.update_project_draft` verliert seinen Entwurfsteil (DROP+CREATE, BRECHEND)
--   TEIL 5  `platform.projects.draft` bleibt stehen — warum, und was daraus folgt
--   TEIL 6  Rechte
--   TEIL 7  Was es hier bewusst NICHT gibt
--
-- ── ⚠ DIE ENTSCHEIDUNG, DIE DEN GANZEN SCHRITT TRAEGT ─────────────────────────────────────────
-- Der Entwurf ist bisher EINE Spalte am Projekt. Gegen ihn geprueft wird `tariffParamsSchema`
-- (`packages/shared/src/tariff.ts`), und dieses Schema besteht zu HUNDERT PROZENT aus Tarif- und
-- Vertragsangaben: Arbeitspreis, Netz-Arbeitspreis, Einspeiseverguetung, Leistungspreis,
-- Mindestleistung, Abrechnungsmodell, Messvariante, Zeitfenster, Grundgebuehr. Kein einziges davon
-- ist eine Eigenschaft des PROJEKTS — jedes einzelne ist eine Eigenschaft des ZAEHLPUNKTS, denn ein
-- Vertrag wird je Zaehlpunkt geschlossen und ein Netzentgelt je Zaehlpunkt verrechnet.
--
-- Am Projekt abgelegt gilt jede dieser Angaben fuer den ganzen Betrieb. Ein Betrieb mit zwei
-- Zaehlpunkten — Delta §2.3 rechnet ausdruecklich damit — traegt dann den Arbeitspreis des einen
-- Zaehlpunkts auch am anderen, und der zweite Schreibvorgang UEBERSCHREIBT den ersten, ohne dass
-- irgendetwas fehlschlaegt. Genau dieselbe Falle hat der Schritt davor fuer den Lastgang-Zeitraum
-- benannt und geschlossen (Migration 20260911120000: „Im Entwurf abgelegt gaelte sie fuer das ganze
-- Projekt, und der zweite Zaehlpunkt ueberschriebe die Aussage des ersten"). Der Zeitraum ist damals
-- an den Zaehlpunkt gewandert, der Entwurf blieb zurueck — dieser Schritt zieht ihn nach.
--
-- ⚠ ES IST EIN FOUNDATIONALER UMBAU UND BEWUSST FRUEH: je mehr auf dem projektweiten Entwurf
-- aufsetzt (Fragenkatalog-Verdrahtung, Konsistenzpruefung, Rollup, Engine-Anbindung), desto teurer
-- wird derselbe Umzug spaeter — und desto laenger stehen Zahlen im Bestand, die an der falschen
-- Ebene erhoben wurden.
--
-- ── WAS SICH AUSDRUECKLICH NICHT AENDERT ──────────────────────────────────────────────────────
-- `segment` und `industry` bleiben am PROJEKT. Sie sind das Gegenbeispiel und belegen die Regel:
-- „Privathaushalt oder Betrieb" und „Hotel oder Tischlerei" sind Eigenschaften des KUNDEN, nicht
-- eines Anschlusses — ein Betrieb hat nicht je Zaehlpunkt eine andere Branche. Ihre Validierung
-- (`invalid_segment`, `invalid_industry`, `industry_requires_betrieb`) bleibt in TEIL 4 Wort fuer
-- Wort dieselbe; geaendert wird dort ausschliesslich, dass die Funktion den Entwurf nicht mehr
-- anfasst.
-- ═════════════════════════════════════════════════════════════════════════════════════════════════


-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — platform.metering_points: `draft`
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Wortgleich zur Spalte, die sie ersetzt (Migration 20260910090000 TEIL 1): `not null default '{}'`
-- plus CHECK auf ein Objekt. Der Default ist der Grund, warum dieser Schritt ohne Backfill
-- auskommt — jeder bestehende Zaehlpunkt bekommt einen leeren Entwurf, und „leer" ist fuer einen
-- Zaehlpunkt, zu dem noch nichts erhoben wurde, die zutreffende Aussage.
--
-- ⚠ DER CHECK IST NICHT DEKORATION. Ein jsonb-Array oder ein blosser Skalar liefe durch jede
-- Schreiboperation und braechte erst den LESER — `Object.entries` auf ein Array ergibt Indizes als
-- Feldnamen, und der Entwurf truege danach Felder namens „0" und „1". Die Grenze steht im Schema,
-- die lesbare Meldung im Wrapper (TEIL 3) — dieselbe Aufteilung wie ueberall in diesem Schema.
alter table platform.metering_points
  add column draft jsonb not null default '{}'::jsonb
    constraint metering_points_draft_is_object check (jsonb_typeof(draft) = 'object');

comment on column platform.metering_points.draft is
  'B24 Teil 1: der laufende Entwurf der Eingabedaten DIESES Zaehlpunkts — das Pendant zu '
  'TariffParams, waehrend es entsteht. Hierher und nicht ans Projekt, weil jedes Feld von '
  'tariffParamsSchema eine Tarif-/Vertragsangabe ist und ein Vertrag je Zaehlpunkt geschlossen '
  'wird; am Projekt abgelegt ueberschriebe der zweite Zaehlpunkt still die Angaben des ersten. '
  'jsonb und nicht getypt, weil er unterwegs unvollstaendig und widerspruechlich sein darf; die '
  'TYPISIERUNG bleibt verbindlich, sie sitzt nur woanders (tariffParamsSchema prueft ihn, wenn er '
  'die Engine erreicht). Die Herkunftsvermerke je Feld (Delta §3.2) liegen als Seiteneintrag '
  '_provenance IM SELBEN Objekt — s. apps/web/lib/project-chat/draft.ts.';


-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — public.list_metering_points liefert `draft` mit
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠ DIESER NACHTRAG IST NICHT OPTIONAL, UND ER FAELLT LEICHT UNTER DEN TISCH. Die Funktion baut
-- ihre Antwort NICHT aus `to_jsonb(mp)` ueber die ganze Zeile, sondern aus einer AUSGESCHRIEBENEN
-- Spaltenliste (Migration 20260911120000 TEIL 3). Eine neu angelegte Spalte erscheint darin also
-- NICHT von selbst — sie fehlte in der Antwort, der Leser bekaeme dauerhaft `{}`, und der Chat
-- ueberschriebe bei jedem Schreibvorgang den kompletten Entwurf mit genau EINEM Feld.
--
-- ⚠ Das waere ein STILLER Datenverlust: kein Fehler, kein Status, keine Ausnahme — nur ein Entwurf,
-- der nach jedem `set_draft_field` genau einen Wert traegt. Die explizite Spaltenliste ist an sich
-- richtig (sie verhindert, dass eine kuenftige interne Spalte ungefragt nach aussen wandert); sie
-- muss nur mitgezogen werden.
--
-- `create or replace` bei UNVERAENDERTER Signatur — die Grants bleiben dadurch stehen.
create or replace function public.list_metering_points(p_project_id uuid)
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

  -- AELTESTE ZUERST: die Reihenfolge, in der die Zaehlpunkte angelegt wurden, ist die einzige, die
  -- ein Mensch wiedererkennt („der erste, den wir angelegt haben"). Dieselbe Sortierung wie
  -- list_project_messages und admin_list_open_questions, und aus verwandtem Grund.
  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at, m.id), '[]'::jsonb)
    into v_rows
  from (
    select mp.id,
           mp.project_id,
           mp.interval_minutes,
           mp.covered_from,
           mp.covered_to,
           mp.gaps,
           mp.source_document_id,
           mp.draft,
           mp.created_at
    from platform.metering_points mp
    where mp.project_id = p_project_id
  ) m;

  return jsonb_build_object('status', 'ok', 'metering_points', v_rows);
end;
$$;
comment on function public.list_metering_points(uuid) is
  'B24 Teil 1: die Zaehlpunkte eines Projekts samt Lastgang-Metadaten UND ihrem laufenden Entwurf, '
  'AELTESTE ZUERST. Prueft platform.project_accessible — der Chat laeuft als das Konto des Kunden, '
  'nicht als Admin. „Gibt es nicht" und „gehoert jemand anderem" liefern beide not_found. Ohne '
  'Seitung, weil admin_set_metering_point_count die Menge bei 100 deckelt. ⚠ Die Spaltenliste ist '
  'AUSGESCHRIEBEN: eine neue Spalte erscheint hier NICHT von selbst und ist beim Anlegen '
  'nachzutragen. authenticated-only.';


-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — public.update_metering_point_draft
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Der Schreibweg. ERSETZT den Entwurf, er verschmilzt ihn nicht — dieselbe Entscheidung und
-- dieselbe Begruendung wie beim Vorgaenger am Projekt: eine flache Verschmelzung koennte einen
-- Schluessel nie wieder ENTFERNEN, und genau das loest eine Korrektur im Gespraech aus („doch keine
-- Leistungsmessung"). Der Aufrufer liest deshalb vor jedem Schreibvorgang frisch.
--
-- ── ⚠ DIE ZUGRIFFSPRUEFUNG GEHT UEBER DAS PROJEKT DES ZAEHLPUNKTS, NICHT UEBER DEN ZAEHLPUNKT ──
-- `platform.project_accessible` kennt nur Projekte. Der Zaehlpunkt wird deshalb zuerst auf sein
-- Projekt aufgeloest und dieses geprueft — wortgleich zu `set_metering_point_load_profile`
-- (Migration 20260911120000 TEIL 4), und aus demselben Grund in dieser Reihenfolge: erst „gibt es
-- das und darf ich?", dann die Form der Argumente. Umgekehrt verriete eine Argument-Fehlermeldung,
-- dass die Kennung existiert.
--
-- ── ES GIBT HIER KEIN SEGMENT UND KEINE BRANCHE ───────────────────────────────────────────────
-- Der Vorgaenger buendelte Entwurf UND Klassifizierung in einer Funktion, weil beides am Projekt
-- lag. Jetzt liegen sie auf zwei Ebenen, und eine Funktion, die beide anfasst, muesste einen
-- Zaehlpunkt und ein Projekt gleichzeitig entgegennehmen — zwei Zugriffspruefungen, zwei
-- Fehlerfamilien und die Frage, was gilt, wenn die eine Haelfte durchgeht und die andere nicht.
create function public.update_metering_point_draft(
  p_metering_point_id uuid,
  p_draft jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
begin
  select mp.project_id into v_project_id
  from platform.metering_points mp
  where mp.id = p_metering_point_id;

  if v_project_id is null or not platform.project_accessible(v_project_id) then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Als STATUS abgewiesen, nicht als roher 23514 aus dem CHECK: ein Constraint-Fehler traegt keinen
  -- Feldbezug, den eine Oberflaeche anzeigen koennte (dieselbe Aufteilung wie beim Vorgaenger).
  if p_draft is null or jsonb_typeof(p_draft) <> 'object' then
    return jsonb_build_object('status', 'invalid_draft');
  end if;

  update platform.metering_points mp
     set draft = p_draft
   where mp.id = p_metering_point_id;

  return jsonb_build_object(
    'status', 'ok',
    'metering_point_id', p_metering_point_id,
    'project_id', v_project_id
  );
end;
$$;
comment on function public.update_metering_point_draft(uuid, jsonb) is
  'B24 Teil 1: schreibt den laufenden Entwurf EINES Zaehlpunkts. ERSETZT ihn statt ihn zu '
  'verschmelzen — eine flache Verschmelzung koennte einen Schluessel nie wieder entfernen, und '
  'genau das loest eine Korrektur im Gespraech aus. Prueft platform.project_accessible ueber das '
  'Projekt des Zaehlpunkts; „gibt es nicht" und „gehoert jemand anderem" liefern beide not_found. '
  'Kein Segment und keine Branche — die liegen am PROJEKT (update_project_draft) und damit auf '
  'einer anderen Ebene. authenticated-only.';


-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — public.update_project_draft verliert seinen Entwurfsteil
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠ BRECHEND, UND ZWAR ZUR LAUFZEIT, NICHT BEIM ANLEGEN. `p_draft` faellt weg, die Signatur wechselt
-- von (uuid, jsonb, text, text) auf (uuid, text, text). Ein bestehender Aufruf mit `p_draft` findet
-- die Funktion danach nicht mehr — er bricht beim ERSTEN AUFRUF, nicht beim Anlegen der Migration
-- (Arbeitsregel 1). Im Repo gibt es genau zwei Aufrufer: `supabase-ports.ts` und das DB-Gate; beide
-- sind in diesem Schritt nachgezogen.
--
-- ⚠ DER NAME BLEIBT — UND ER IST DAMIT HISTORISCH. `update_project_draft` fasst ab dieser Migration
-- KEINEN Entwurf mehr an; sie setzt Segment und Branche. Der Name wird bewusst nicht mitgezogen:
-- eine Umbenennung ist eine eigene, jederzeit nachholbare Entscheidung, waehrend ein Umbenennen
-- NEBENBEI die Aenderung an dieser Stelle groesser machte als die fachliche Bewegung dahinter. Wer
-- ihn umbenennt, zieht `supabase-ports.ts`, drei DB-Gate-Dateien und `database.types.ts` mit.
--
-- Die Validierung von Segment und Branche ist WORT FUER WORT die bestehende (Migration
-- 20260910150000) — hier ist nichts inhaltlich entschieden, nur der Entwurfsteil entfernt.
drop function public.update_project_draft(uuid, jsonb, text, text);

create function public.update_project_draft(
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

  -- ⚠ `draft` steht hier NICHT mehr. Die Spalte existiert weiter (TEIL 5) und wird von dieser
  -- Funktion ab jetzt nicht mehr angefasst — weder geschrieben noch geleert.
  update platform.projects
     set segment  = coalesce(v_segment, segment),
         industry = coalesce(v_industry, industry)
   where id = p_id;

  return jsonb_build_object('status', 'ok');
end;
$$;
comment on function public.update_project_draft(uuid, text, text) is
  'B24: setzt Segment und Branche eines Projekts. ⚠ DER NAME IST HISTORISCH — der ENTWURF liegt '
  'seit der Migration 20260911150000 am ZAEHLPUNKT (update_metering_point_draft), und diese '
  'Funktion fasst platform.projects.draft nicht mehr an. p_segment und p_industry null heissen '
  'UNVERAENDERT (Lesart capture_lead, nicht admin_update_lead). Eine Branche gibt es NUR bei '
  'segment = betrieb (Status industry_requires_betrieb, geprueft gegen das nach diesem Aufruf '
  'geltende Segment); sie wird NICHT kleingeschrieben, ein Format-Verstoss ist invalid_industry. '
  'Eine bereits gesetzte Branche ueberlebt einen spaeteren Segmentwechsel. authenticated-only.';


-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 5 — ⚠ platform.projects.draft WIRD NICHT GEDROPPT
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Der naheliegende Abschluss dieses Umzugs waere `drop column`. Er unterbleibt, und der Grund ist
-- GEMESSEN und nicht abgeleitet: am 11.09.2026 gegen die PRODUKTION abgefragt trug genau EINES von
-- zwei Projekten einen nicht-leeren Entwurf — neun Felder samt vollstaendigen Herkunftsvermerken,
-- abgelesen aus einer echten Jahresabrechnung (Arbeitspreis, Netz-Arbeitspreis,
-- Einspeiseverguetung, Grundgebuehr, Mindestleistung, Netzebene, Messvariante, Zeitfenster).
--
-- ⚠ UND ES GIBT NIRGENDWO HIN, WO MAN IHN RETTEN KOENNTE: dasselbe Projekt hat NULL Zaehlpunkte.
-- Ein Backfill muesste also einen Zaehlpunkt ANLEGEN — und wie viele Zaehlpunkte ein Betrieb hat,
-- ist genau die fachliche Frage, die dieses Schema an keiner Stelle selbst beantwortet (Migration
-- 20260911120000 TEIL 6: das entscheidet ein Mensch ueber admin_set_metering_point_count, damit
-- nicht die Maschine ueber die Struktur eines Betriebs entscheidet). Ein hier erfundener Zaehlpunkt
-- waere genau dieser Griff.
--
-- Die Spalte bleibt deshalb stehen und wird EINGEFROREN: kein Wrapper schreibt sie mehr, der
-- Anwendungscode liest sie nicht mehr. Sie ist ab jetzt ein Archivstand.
--
-- ⚠ `get_project` liefert sie WEITERHIN mit, und das ist Absicht: sonst waere der eine reale
-- Bestand ueber keinen Wrapper mehr erreichbar. Der TypeScript-Leser ignoriert das Feld
-- (`ProjectSnapshot` traegt es nicht mehr) — die Ebene, auf der es verschwindet, ist der
-- Anwendungscode, nicht die Datenbank.
--
-- WER SIE SPAETER DROPPT, entscheidet vorher, was mit diesem Bestand geschieht, und faehrt
-- Arbeitsregel 1: alle Funktionsruempfe per pg_get_functiondef nach `draft` durchsuchen, bevor die
-- Spalte faellt (`get_project` traegt sie, und das faellt sonst erst beim ersten Aufruf auf).
comment on column platform.projects.draft is
  'B24 — ⚠ EINGEFROREN seit der Migration 20260911150000. Der laufende Entwurf liegt seit dort am '
  'ZAEHLPUNKT (platform.metering_points.draft), weil jedes Feld von tariffParamsSchema eine '
  'Tarif-/Vertragsangabe ist und ein Vertrag je Zaehlpunkt geschlossen wird. Diese Spalte wird von '
  'KEINEM Wrapper mehr geschrieben und vom Anwendungscode nicht mehr gelesen. Sie steht nur noch, '
  'weil in Produktion ein realer Entwurfsbestand darin liegt und es dafuer kein Ziel gibt: das '
  'betroffene Projekt hat null Zaehlpunkte, und ein Backfill muesste einen anlegen — also genau die '
  'Struktur-Entscheidung treffen, die hier ausdruecklich einem Menschen vorbehalten ist. get_project '
  'liefert sie weiterhin mit, damit dieser Bestand erreichbar bleibt. Vor einem spaeteren drop '
  'column: Arbeitsregel 1 (alle Funktionsruempfe nach dem Spaltennamen durchsuchen).';


-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 6 — Rechte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── ⚠ ES MUSS `from public, anon, authenticated, service_role` HEISSEN, NICHT NUR `from public` ─
-- Supabase vergibt per ALTER DEFAULT PRIVILEGES auf JEDE neue Funktion im `public`-Schema ein
-- EXECUTE an `anon`, `authenticated` UND `service_role` — DIREKT, nicht ueber die Pseudo-Rolle
-- PUBLIC. Ein blosses `revoke ... from public` liesse die drei Supabase-Grants stehen.
--
-- ⚠ UND DAS DROP IN TEIL 4 HAT DIE GRANTS MITGENOMMEN — sie haengen an der Funktion, nicht am
-- Namen. Ohne den zweiten Block waere `update_project_draft` fuer `authenticated` nicht mehr
-- ausfuehrbar, und der Chat koennte ab dieser Migration weder Segment noch Branche setzen.
--
-- `anon` und `service_role` bekommen nichts: beide Funktionen leiten ihre Autorisierung aus
-- auth.uid() ab, und das ist dort null. Die Tabellen-Grants bleiben unangetastet —
-- `platform.metering_points` hat fuer KEINE Rolle ein Tabellenrecht.
revoke all on function public.update_metering_point_draft(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.update_project_draft(uuid, text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.update_metering_point_draft(uuid, jsonb) to authenticated;
grant execute on function public.update_project_draft(uuid, text, text) to authenticated;


-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 7 — Was es hier BEWUSST NICHT GIBT
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
--   * KEIN BACKFILL des bestehenden Entwurfs an einen Zaehlpunkt — s. TEIL 5. Er braeuchte einen
--     Zaehlpunkt, den es nicht gibt, und den anzulegen ist eine fachliche Entscheidung.
--   * KEIN `drop column platform.projects.draft` — s. TEIL 5.
--   * KEINE Rollup-Schicht ueber mehrere Zaehlpunkt-Entwuerfe (Delta §2.4). Ein Betrieb mit zwei
--     Zaehlpunkten traegt ab jetzt ZWEI Entwuerfe; wie daraus EINE Rechnung wird, ist ein eigener
--     Schritt. Ihn hier nebenbei zu entscheiden hiesse, die Zusammenfuehrung zu erfinden, bevor
--     jemand entschieden hat, ob summiert, gemittelt oder je Zaehlpunkt gerechnet wird.
--   * KEINE Kopie eines Entwurfs von einem Zaehlpunkt auf einen anderen. Sie waere bequem („beide
--     haengen am selben Vertrag") und genau die Abkuerzung, gegen die dieser Schritt gebaut ist:
--     dass zwei Zaehlpunkte denselben Tarif haben, ist eine Aussage des Kunden und keine Annahme
--     des Systems.
--   * KEINE Aufbewahrungsfrist. `platform.run_lead_retention` (B4-1) fasst die Tabelle nicht an.
--     ⚠ Sie traegt ab jetzt Tarifangaben eines Kunden — die offene juristische Frage
--     (`DEPLOYMENT.md` §7) waechst damit.
