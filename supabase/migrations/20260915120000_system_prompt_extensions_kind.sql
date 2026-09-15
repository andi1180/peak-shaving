-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- B24, Station 6 (KI-Check) — `platform.system_prompt_extensions` bekommt eine `kind`-Spalte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Fachlich: `Pflichtenheft_Kalkulator_Delta_KI-Interface.md` (§4 Admin-Frage-Guidelines). Diese
-- Migration legt AUSSCHLIESSLICH die Datenhaltung an — die Admin-Oberfläche, über die ein Mensch den
-- Energieberater-Prompt pflegt, ist ein eigener, nächster Schritt.
--
-- ── DIE ENTSCHEIDUNG: EINE TABELLE, ZWEI UNABHÄNGIGE KETTEN ─────────────────────────────────────
-- Der Energieberater-Prompt (`ki_check`) ist strukturell dasselbe wie die Kunden-Chat-Erweiterung:
-- ein admin-gepflegter Text in datierten Ständen, genau einer davon offen, Korrektur am selben Tag
-- in place, kein Löschweg. Eine zweite Tabelle wäre damit eine zweite RLS-Fläche, ein zweites Paar
-- Wrapper und eine zweite Stelle, an der die Ordnungspflicht gepflegt werden müsste — und beim
-- nächsten Umbau laufen die zwei Fassungen auseinander. Was die zwei Texte trennt, ist WEN sie
-- anweisen, nicht ihre Form: das ist eine Spalte, kein Schema. Unmittelbares Vorbild ist die
-- `kind`-Erweiterung von `platform.project_messages` (20260915090000), einen Schritt zuvor und aus
-- derselben Überlegung.
--
-- ⚠ ZWEI KETTEN HEISST: DIE ORDNUNGSPFLICHT GILT JE KIND UND NUR JE KIND. Der Constraint, der
-- Advisory-Lock-Schlüssel und die Suche nach dem offenen Vorgänger werden deshalb ALLE DREI
-- kind-abhängig (TEIL 1 und TEIL 2). Bliebe auch nur eine davon global, wäre die Wirkung je
-- verschieden und in jedem Fall still: ein globaler Constraint wiese einen am selben Tag begonnenen
-- Energieberater-Stand als Duplikat ab; ein globaler Lock serialisierte zwei unabhängige Ketten
-- ohne Not; eine globale Vorgänger-Suche schlösse oder ERSETZTE den Stand des jeweils ANDEREN
-- Gesprächs — der teuerste der drei, weil dabei ein gepflegter Text ohne jede Meldung verschwindet.
--
-- ⚠ WAS DIESE MIGRATION AUSDRÜCKLICH NICHT ÄNDERT: keine neue RLS-Policy, kein Tabellen-Grant, kein
-- neuer Schreibweg, kein Löschweg. Die Rechtefläche bleibt Zeichen für Zeichen dieselbe — RLS aktiv
-- OHNE Policy, für KEINE Rolle ein Tabellen-Grant, EXECUTE ausschliesslich `authenticated`. Und es
-- gibt weiterhin keinen Weg, eine Erweiterung ABZUSCHALTEN: ein leerer Text bleibt `invalid_text`
-- (Begründung in TEIL 7 der Ursprungsmigration).

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — die Spalte und der Identitäts-Constraint
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
alter table platform.system_prompt_extensions
  add column kind text not null default 'kunde'
    constraint system_prompt_extensions_kind_check check (kind in ('kunde', 'ki_check'));

comment on column platform.system_prompt_extensions.kind is
  'B24 Station 6: WELCHEN Prompt dieser Stand ergaenzt — kunde (der Chat des Kunden, Delta §3.1) '
  'oder ki_check (das admin-interne Energieberater-Gespraech). Vorgabewert kunde, weil jeder vor '
  'diesem Schritt entstandene Stand eine Kunden-Erweiterung IST: es gab bis hierher keine zweite '
  'Art. Der Vorgabewert erledigt damit den Bestand beim Anlegen der Spalte vollstaendig — es braucht '
  'kein nachtraegliches UPDATE, und es gibt keinen Zustand "unbekannter Art".';

-- ── DER IDENTITÄTS-CONSTRAINT WÄCHST UM `kind` ──────────────────────────────────────────────────
-- `unique (valid_from)` war richtig, solange es EINE Kette gab. Mit zwei Ketten wiese er einen
-- Energieberater-Stand ab, der am selben Tag beginnt wie ein Kunden-Stand — und zwar mit
-- `duplicate_valid_from`, also einer Meldung über einen Zustand, den der Admin gar nicht hergestellt
-- hat. Die Identität eines Standes ist ab jetzt `(kind, valid_from)`.
--
-- Kein Datenverlust, und das ist keine Hoffnung: die Spalte ist `not null` mit Vorgabewert 'kunde',
-- jede bestehende Zeile trägt ihn bereits, und ein unter `unique (valid_from)` eindeutiger Bestand
-- ist unter `unique (kind, valid_from)` erst recht eindeutig (der neue Schlüssel ist eine
-- Erweiterung des alten). Die Reihenfolge — erst Spalte, dann Constraint-Tausch — ist Pflicht:
-- umgekehrt gäbe es im Moment des Anlegens noch keine Spalte, auf die er zeigen könnte.
--
-- ⚠ BEIDE SPALTEN SIND `not null`, ein `nulls not distinct` ist hier also weder nötig noch wirksam
-- (anders als bei `grid_tariffs` und `question_catalog_entries`, wo der Nullfall der Regelfall ist).
alter table platform.system_prompt_extensions
  drop constraint system_prompt_extensions_unique_stand;

alter table platform.system_prompt_extensions
  add constraint system_prompt_extensions_unique_stand unique (kind, valid_from);

comment on table platform.system_prompt_extensions is
  'B24: die admin-pflegbaren Ergaenzungen der System-Prompts (Delta §4). ERSETZT NICHT die '
  'Kern-Prompts im Anwendungscode — die tragen weiterhin die Verhaltensanforderungen des Deltas; '
  'diese Tabelle traegt Ton und Feinschliff, die ein Admin ohne PR aendern kann. Seit Station 6 '
  'ZWEI unabhaengige Ketten (Spalte kind: kunde / ki_check), je Kette datierte Staende und genau EIN '
  'offener Eintrag (Invariante im Funktionsrumpf, nicht im Constraint). Es gibt bewusst KEINEN '
  'Loeschweg — die Korrektur am selben Tag ersetzt den Text in place. RLS aktiv OHNE Policy, kein '
  'Tabellen-Grant.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — admin_set_system_prompt_extension um p_kind erweitern
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠ DROP + CREATE, NICHT `create or replace` — ein zusätzlicher Parameter ÄNDERT DIE SIGNATUR.
-- `create or replace` legte eine zweite, überladene Funktion daneben; ein Aufruf mit zwei Argumenten
-- wäre danach zwischen der alten Zwei-Parameter-Fassung und der neuen Drei-Parameter-Fassung mit
-- Vorgabewert MEHRDEUTIG (42725) — und zwar erst zur Laufzeit, nicht beim Anlegen. Das DROP matcht
-- die Signatur EXAKT und ohne `cascade`: gäbe es wider Erwarten schon eine zweite Überladung, soll
-- es scheitern statt die falsche zu treffen. Die Grants hängen an der Funktion, nicht am Namen, und
-- werden deshalb in TEIL 5 erneut gesetzt.
--
-- ⚠ DER VORGABEWERT IST KEINE KOSMETIK, ER IST DIE ABWÄRTSKOMPATIBILITÄT. `p_kind` steht am ENDE
-- der Parameterliste: PostgreSQL verlangt, dass nach einem Parameter mit Vorgabewert alle weiteren
-- einen tragen — weiter vorne stehend verschöbe er ausserdem die Bedeutung jedes positionellen
-- Bestandsaufrufs. Mit `default 'kunde'` übersteht jeder Ein- und Zwei-Argument-Aufruf diese
-- Migration ohne eine Zeile Codeänderung und schreibt weiterhin ausschliesslich Kunden-Stände.
drop function public.admin_set_system_prompt_extension(text, date);

create function public.admin_set_system_prompt_extension(
  p_text       text,
  p_valid_from date default current_date,
  p_kind       text default 'kunde'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_text        text := nullif(btrim(coalesce(p_text, '')), '');
  v_from        date := coalesce(p_valid_from, current_date);
  v_kind        text := nullif(btrim(coalesce(p_kind, 'kunde')), '');
  v_open_from   date;
  v_close_ids   uuid[];
  v_replace_ids uuid[];
  v_id          uuid;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_set_system_prompt_extension: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  -- Ein leerer Text ist keine Loeschung. Wer die Erweiterung abschalten will, braucht dafuer einen
  -- eigenen, bewussten Weg — ihn hier ueber einen Leerstring einzubauen hiesse, zwei sehr
  -- verschiedene Vorgaenge unter einen Aufruf zu legen (TEIL 7 der Ursprungsmigration).
  if v_text is null then
    return jsonb_build_object('status', 'invalid_text');
  end if;

  -- Als STATUS abgewiesen, nicht als roher 23514 aus dem CHECK: ein Constraint-Fehler traegt keinen
  -- Feldbezug, den ein Aufrufer anzeigen koennte. Der CHECK bleibt trotzdem stehen — er ist die
  -- Grenze, dieser Zweig die Meldung (dieselbe Aufteilung wie bei append_project_message).
  if v_kind is null or v_kind not in ('kunde', 'ki_check') then
    return jsonb_build_object('status', 'invalid_kind');
  end if;

  -- ⚠ DER SPERRSCHLUESSEL TRAEGT DAS KIND. Global gehalten serialisierte er zwei Ketten
  -- gegeneinander, die einander nichts anhaben koennen — ein Energieberater-Schreibvorgang wartete
  -- dann auf einen Kunden-Schreibvorgang, ohne dass es dafuer einen Grund gaebe.
  perform pg_advisory_xact_lock(hashtext('system_prompt_extension:' || v_kind));

  -- ⚠ `and x.kind = v_kind` IST DIE WICHTIGSTE ZEILE DIESER MIGRATION. Ohne sie faende ein
  -- Energieberater-Schreibvorgang den offenen KUNDEN-Stand als "Vorgaenger" — und schloesse ihn
  -- (bei spaeterem Datum) oder ERSETZTE seinen Text (bei gleichem Datum). Beides ohne Meldung, und
  -- beim Ersetzen waere der urspruengliche Wortlaut danach nirgends mehr zu finden: diese Tabelle
  -- fuehrt keine Historie ueber eine in-place-Korrektur.
  select array_agg(o.id) filter (where o.valid_from < v_from),
         array_agg(o.id) filter (where o.valid_from = v_from),
         max(o.valid_from)
    into v_close_ids, v_replace_ids, v_open_from
    from (
      select x.id, x.valid_from
        from platform.system_prompt_extensions x
       where x.valid_until is null
         and x.kind = v_kind
         for update
    ) o;

  if v_open_from is not null and v_from < v_open_from then
    return jsonb_build_object(
      'status', 'invalid_valid_from',
      'open_valid_from', v_open_from
    );
  end if;

  if v_close_ids is not null then
    update platform.system_prompt_extensions
       set valid_until = v_from - 1
     where id = any(v_close_ids);
  end if;

  if v_replace_ids is not null then
    update platform.system_prompt_extensions
       set extension_text = v_text
     where id = any(v_replace_ids)
    returning id into v_id;

    return jsonb_build_object(
      'status', 'replaced',
      'id', v_id,
      'closed_count', coalesce(array_length(v_close_ids, 1), 0)
    );
  end if;

  begin
    insert into platform.system_prompt_extensions (extension_text, valid_from, kind, created_by)
    values (v_text, v_from, v_kind, auth.uid())
    returning id into v_id;
  exception
    when unique_violation then
      return jsonb_build_object('status', 'duplicate_valid_from');
  end;

  return jsonb_build_object(
    'status', 'created',
    'id', v_id,
    'closed_count', coalesce(array_length(v_close_ids, 1), 0),
    'closed_valid_until', case when v_close_ids is null then null else v_from - 1 end
  );
end;
$$;

comment on function public.admin_set_system_prompt_extension(text, date, text) is
  'B24: setzt die System-Prompt-Erweiterung EINER Art als neuen datierten Stand und schliesst den '
  'offenen Vorgaenger DERSELBEN Art auf valid_from - 1. Beginnt der offene Stand am SELBEN Tag, wird '
  'sein Text in place ersetzt ({status: replaced}) — hier ist das die einzige Korrekturmoeglichkeit, '
  'denn diese Tabelle hat bewusst KEINEN Loeschweg. Ein Stand VOR dem offenen wird abgewiesen '
  '(Ordnungspflicht, je Art unabhaengig). Ein leerer Text ist KEINE Abschaltung, sondern '
  '{status: invalid_text}. p_kind waehlt die Kette (kunde / ki_check) und steht auf kunde, damit '
  'bestehende Ein- und Zwei-Argument-Aufrufer unveraendert weiterlaufen. ERSETZT NICHT die '
  'Kern-Prompts im Anwendungscode. WIRFT ohne Adminrolle (42501).';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — admin_get_system_prompt_extension um p_kind erweitern
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Dieselbe DROP+CREATE-Begründung wie in TEIL 2 — hier sogar zwingend: die Funktion hatte GAR KEINEN
-- Parameter, und `create or replace` kann eine parameterlose Fassung nicht durch eine mit Parameter
-- ersetzen (es entstuende eine zweite Ueberladung, und der parameterlose Aufruf traefe weiterhin die
-- alte, kind-lose Fassung — der Fehler waere also nicht bloss mehrdeutig, sondern still falsch).
--
-- ⚠ LIEST WEITERHIN DEN OFFENEN STAND (`valid_until is null`), NICHT den heute geltenden — der
-- Unterschied zu `get_system_prompt_extension` bleibt unveraendert (Begruendung in der
-- Ursprungsmigration: ein zukuenftig beginnender Stand soll bearbeitbar bleiben).
drop function public.admin_get_system_prompt_extension();

create function public.admin_get_system_prompt_extension(
  p_kind text default 'kunde'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kind text := nullif(btrim(coalesce(p_kind, 'kunde')), '');
  v_row  jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_get_system_prompt_extension: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  -- Wie beim Schreibweg als STATUS abgewiesen: eine unbekannte Art still als {status: none} zu
  -- beantworten hiesse, „diese Art gibt es nicht" und „fuer diese Art ist noch nichts gepflegt"
  -- ununterscheidbar zu machen — und die Oberflaeche bearbeitete dann ein leeres Feld, dessen
  -- Absenden gleich darauf mit invalid_kind scheitert.
  if v_kind is null or v_kind not in ('kunde', 'ki_check') then
    return jsonb_build_object('status', 'invalid_kind');
  end if;

  select to_jsonb(e) || jsonb_build_object(
           'created_by_email',
           (select au.email from auth.users au where au.id = e.created_by)
         )
    into v_row
  from (
    select x.id, x.extension_text, x.kind, x.valid_from, x.valid_until, x.created_by,
           x.created_at, x.updated_at
      from platform.system_prompt_extensions x
     where x.valid_until is null
       and x.kind = v_kind
     order by x.valid_from desc
     limit 1
  ) e;

  if v_row is null then
    return jsonb_build_object('status', 'none');
  end if;

  return jsonb_build_object('status', 'ok', 'extension', v_row);
end;
$$;

comment on function public.admin_get_system_prompt_extension(text) is
  'B24: der aktuell OFFENE Stand der System-Prompt-Erweiterung EINER Art samt aufgeloester '
  'Urheber-Adresse — die Fassung, die der Admin bearbeitet. Bewusst NICHT der heute geltende Stand '
  '(das ist get_system_prompt_extension): ein zukuenftig beginnender Stand soll bearbeitbar bleiben. '
  'p_kind waehlt die Kette (kunde / ki_check) und steht auf kunde, damit bestehende argumentlose '
  'Aufrufer unveraendert weiterlaufen. Noch nie etwas gesetzt → {status: none}. WIRFT ohne '
  'Adminrolle (42501).';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — get_system_prompt_extension um p_kind erweitern
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Dieselbe DROP+CREATE-Begründung wie in TEIL 3.
--
-- ⚠ HIER WIRD EINE UNBEKANNTE ART NICHT ABGEWIESEN, SONDERN FILTERT SICH INS LEERE ({status: none})
-- — bewusst anders als die zwei admin_*-Wrapper darueber, und aus zwei Gruenden. Erstens ist das
-- der Lesepfad EINES CHATS: seine Art ist im Anwendungscode fest verdrahtet und keine Nutzereingabe,
-- es gibt hier also nichts zu melden. Zweitens behandelt jeder Aufrufer {status: none} bereits als
-- Normalzustand und laeuft mit dem Kern-Prompt weiter (fail open, s. supabase-ports.ts) — ein
-- zusaetzlicher Status waere eine Verzweigung, die niemand braucht. Dieselbe Lesart wie
-- list_project_messages (20260915090000 TEIL 3).
--
-- ⚠ BESTEHENDER AUFRUF BLEIBT UNVERAENDERT: apps/web/lib/project-chat/supabase-ports.ts ruft ohne
-- Argument auf und bekommt damit weiterhin ausschliesslich 'kunde'.
drop function public.get_system_prompt_extension();

create function public.get_system_prompt_extension(
  p_kind text default 'kunde'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kind text := coalesce(nullif(btrim(coalesce(p_kind, '')), ''), 'kunde');
  v_id   uuid;
  v_text text;
  v_from date;
begin
  select x.id, x.extension_text, x.valid_from
    into v_id, v_text, v_from
    from platform.system_prompt_extensions x
   where x.kind = v_kind
     and x.valid_from <= current_date
     and (x.valid_until is null or x.valid_until >= current_date)
   order by x.valid_from desc
   limit 1;

  if v_id is null then
    -- „Es gibt keine Erweiterung" ist der Normalzustand, solange niemand eine gepflegt hat — und
    -- ausdruecklich kein Fehler: der Kern-Prompt traegt das Verhalten auch allein.
    return jsonb_build_object('status', 'none');
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'id', v_id,
    'extension_text', v_text,
    'valid_from', v_from
  );
end;
$$;

comment on function public.get_system_prompt_extension(text) is
  'B24: der HEUTE geltende Stand der System-Prompt-Erweiterung EINER Art, fuer die Verdrahtung an '
  'das Modell. Liefert id und valid_from mit, damit festhaltbar ist, welche Fassung ein Gespraech '
  'bestimmt hat. p_kind waehlt die Kette (kunde / ki_check) und steht auf kunde — ein bestehender '
  'argumentloser Aufrufer sieht dadurch unveraendert NUR die Kunden-Kette. Keine gepflegte '
  'Erweiterung → {status: none}, kein Fehler — der Kern-Prompt traegt das Verhalten auch allein. '
  'authenticated-only; ⚠ jede angemeldete Sitzung kann den Text damit lesen (der Chat laeuft als das '
  'Konto des Kunden — es gibt keine engere Rolle). Der Text ist eine Anweisung an das Modell, kein '
  'Geheimnis.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 5 — die Grants der drei neu angelegten Funktionen
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠ Das DROP hat die Grants MITGENOMMEN (sie haengen an der Funktion, nicht am Namen), und Supabase
-- vergibt auf JEDE neue public-Funktion ein direktes EXECUTE an anon, authenticated und service_role
-- zusaetzlich zum PostgreSQL-Default-Grant an PUBLIC. Deshalb wie ueberall: erst allen entziehen,
-- dann gezielt gewaehren. `service_role` bekommt ausdruecklich NICHTS — die zwei admin_*-Wrapper
-- leiten ihre Autorisierung aus platform.is_admin() ab (dort false), und der Lesepfad waere eine
-- Tuer, die den Sitzungsbezug umgeht, den dieses Schema ueberall sonst verlangt.
revoke all on function public.admin_set_system_prompt_extension(text, date, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_get_system_prompt_extension(text)
  from public, anon, authenticated, service_role;
revoke all on function public.get_system_prompt_extension(text)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_set_system_prompt_extension(text, date, text) to authenticated;
grant execute on function public.admin_get_system_prompt_extension(text) to authenticated;
grant execute on function public.get_system_prompt_extension(text) to authenticated;
