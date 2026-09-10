-- B24 — die Kostenbremse des Projekt-Chats.
--
-- Kanonische fachliche Quelle: `Pflichtenheft_Kalkulator_Delta_KI-Interface.md` §6.3 (Kostenbremse:
-- ein Limit pro Konto, admin-editierbar, Admin-Rolle ausgenommen, erste Ausbaustufe = einfache
-- Zaehlung, KEIN Kosten-Tracking in Euro). Reihenfolge/Einordnung `Fahrplan_2026.md`, B24.
-- Vorbild fuer Struktur, Ordnungsmechanik und Rechteflaeche: `platform.system_prompt_extensions`
-- (20260910120000, TEIL 4/5) — genau ein offener Eintrag, Advisory-Lock, Ordnungspflicht im
-- Funktionsrumpf, Korrektur am selben Tag ersetzt in place.
--
-- ── WAS HIER ENTSTEHT ───────────────────────────────────────────────────────────────────────────
--   TEIL 1  `platform.chat_rate_limit_settings` — das admin-pflegbare, datierte Nachrichtenlimit
--   TEIL 2  Der Startwert (ein GESETZTER Stand, kein leerer Bestand — Begruendung dort)
--   TEIL 3  `public.admin_set_chat_rate_limit` / `admin_get_chat_rate_limit`
--   TEIL 4  `public.check_chat_rate_limit` — die Frage, die der Chat vor jedem Turn stellt
--   TEIL 5  RLS und Rechte
--   TEIL 6  Was es hier BEWUSST NICHT GIBT
--
-- ── ⚠ WARUM DIESER SCHRITT UEBERHAUPT DER RICHTIGE MOMENT IST ──────────────────────────────────
-- `apps/web/lib/project-chat/chat.ts` bekommt in derselben PR sein `'use server'`. Damit ist der
-- Chat zum ersten Mal ueber einen echten Endpunkt erreichbar — und jeder Turn loest bis zu neun
-- ABRECHENBARE Modellaufrufe aus. Die Obergrenze in `ai-client.ts` begrenzt EINEN Turn, nicht die
-- Zahl der Turns. Ohne diese Bremse waere der erste oeffentliche Endpunkt des Chats zugleich ein
-- unbegrenzt abrechenbarer; der Kopf von `chat.ts` hat genau diese Reihenfolge seit dem dritten
-- Bauschritt eingefordert.
--
-- ── DIE ENTSCHEIDUNG, DIE DEN ABSCHNITT TRAEGT: DATENBANK STATT CODE-KONSTANTE ──────────────────
-- Jede andere Groessengrenze dieses Repos sitzt fest im Code (`MAX_INVOICE_FILE_BYTES`,
-- `MAX_PV_DESIGN_FILE_BYTES`, `bodySizeLimit`). Delta §6.3 entscheidet hier ausdruecklich anders:
-- die Zahl soll „lernend" nachjustierbar sein. Eine Code-Konstante hiesse „Aenderung = PR eines
-- Entwicklers" — bei einer Zahl, die man nach den ersten echten Gespraechen zwei- oder dreimal
-- korrigieren will, ist das nicht ehrlich vereinbar. Dasselbe Argument, mit dem der Fragenkatalog
-- eine Tabelle geworden ist (Delta §4.2, Gegenbeleg B21-3d).
--
-- ── EINE ORDNUNGSMECHANIK, ZUM DRITTEN MAL — und deshalb wortgleich uebernommen ─────────────────
-- `question_catalog_entries` und `system_prompt_extensions` tragen dieselbe Regel: datierte Staende,
-- Advisory-Lock je Identitaet, Vorgaengerin auf `valid_from - 1` schliessen, Korrektur am selben Tag
-- ersetzt in place. Hier gibt es — wie bei der Prompt-Erweiterung — genau EINE Kette, der Lock
-- traegt deshalb einen konstanten Schluessel. Ein VIERTER Mechanismus fuer dieselbe Sache waere die
-- Stelle, an der die drei beim naechsten Umbau auseinanderlaufen.
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — platform.chat_rate_limit_settings
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── ⚠ „PER DAY" HEISST ROLLIERENDE 24 STUNDEN, NICHT KALENDERTAG ───────────────────────────────
-- Der Spaltenname folgt dem Sprachgebrauch des Deltas; gezaehlt wird in `check_chat_rate_limit` ueber
-- `now() - interval '24 hours'`. Der Unterschied ist Absicht: ein Kalendertag verlangte eine
-- Zeitzone (welche Mitternacht?), und um 23:50 waere das Limit fuenf Mal so schnell erschoepft wie
-- um 00:10 — der Nutzer erlebte dieselbe Zahl als zwei verschiedene Grenzen. Ein rollierendes
-- Fenster hat diese Kante nicht und braucht keine Zeitzonen-Entscheidung.
--
-- ── GENAU EIN OFFENER EINTRAG, UND DER CONSTRAINT SAGT DAS NICHT ────────────────────────────────
-- `unique (valid_from)` schliesst zwei Staende mit demselben Beginn aus, aber nicht zwei OFFENE mit
-- verschiedenem Beginn. Die Invariante „genau ein offener Eintrag" traegt der Funktionsrumpf
-- (Advisory-Lock + Schliessen ALLER offenen Vorgaenger, s. TEIL 3) — wortgleiche Aufteilung wie bei
-- `system_prompt_extensions`, samt der dortigen Begruendung gegen einen partiellen Unique-Index:
-- er wuerde das Heilen eines von Hand entstandenen Doppelzustands blockieren, statt es zuzulassen.
create table platform.chat_rate_limit_settings (
  id uuid primary key default gen_random_uuid(),

  -- ⚠ `> 0`, NICHT `>= 0`. Eine 0 waere kein Limit, sondern ein Not-Aus fuer den gesamten Chat —
  -- und ein Not-Aus soll eine benannte Entscheidung sein, kein Tippfehler in einem Zahlenfeld.
  -- Wer den Chat abschalten will, baut dafuer einen eigenen, als solchen erkennbaren Weg (TEIL 6).
  max_messages_per_account_per_day integer not null
    constraint chat_rate_limit_max_positive
      check (max_messages_per_account_per_day > 0),

  valid_from date not null,
  valid_until date null,

  created_by uuid null references auth.users (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint chat_rate_limit_unique_stand unique (valid_from)
);

comment on table platform.chat_rate_limit_settings is
  'B24: das admin-pflegbare Nachrichtenlimit je Konto und Tag (Delta §6.3). Datierte Staende wie der '
  'Fragenkatalog und die System-Prompt-Erweiterung, genau EIN offener Eintrag (Invariante im '
  'Funktionsrumpf, nicht im Constraint). Erste Ausbaustufe: reine ANZAHL von Nachrichten — kein '
  'Euro-, Token- oder Kosten-Tracking (Delta §6.3). Es gibt bewusst KEINEN Loeschweg — die Korrektur '
  'am selben Tag ersetzt den Wert in place. RLS aktiv OHNE Policy, kein Tabellen-Grant.';

comment on column platform.chat_rate_limit_settings.max_messages_per_account_per_day is
  'Hoechstzahl von `user`-Nachrichten, die EIN Konto ueber ALLE seine Projekte hinweg in den letzten '
  '24 Stunden senden darf. ⚠ „per day" ist ein rollierendes 24-Stunden-Fenster, kein Kalendertag '
  '(Begruendung im Kopf der Migration). Gezaehlt wird die Nachricht des NUTZERS, nicht der '
  'Modellaufruf: ein Turn kann bis zu neun Aufrufe ausloesen, aber der Nutzer entscheidet nur ueber '
  'den Turn — eine Grenze auf etwas, das er nicht steuert, koennte er nicht einhalten.';

comment on column platform.chat_rate_limit_settings.valid_until is
  'Der LETZTE gueltige Tag, INKLUSIV. NULL = aktuell offener Stand.';

create trigger chat_rate_limit_settings_set_updated_at
  before update on platform.chat_rate_limit_settings
  for each row execute function platform.set_updated_at();

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — der Startwert
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── ⚠ HIER STEHT EINE ZAHL, UND DAS IST EINE BEWUSSTE ABWEICHUNG VON DER HAUSREGEL ─────────────
-- Dieses Repo weist an mehreren Stellen ausdruecklich zurueck, „eine Zahl zu setzen, die niemand
-- entschieden hat" (u. a. die fehlende Laengengrenze auf `extension_text`, die leeren Kataloge). Der
-- Unterschied hier ist, dass es KEINEN dritten Zustand gibt: die Tabelle leer zu lassen liesse genau
-- zwei Moeglichkeiten, und beide sind schlechter.
--   * FAIL OPEN (kein Stand ⇒ unbegrenzt): dann waere der mit dieser PR veroeffentlichte Endpunkt
--     bis zur ersten Admin-Eingabe unbegrenzt abrechenbar — also genau der Zustand, dessen
--     Vermeidung der Anlass des ganzen Schritts ist.
--   * FAIL CLOSED (kein Stand ⇒ niemand darf): dann waere der Chat am Tag des Merges fuer jeden
--     Kunden tot, und es gibt in diesem Schritt bewusst KEINE Oberflaeche, ueber die ein Admin ihn
--     wieder aufmachen koennte.
-- Ausserdem ist eine Ratengrenze kein Sachverhalt ueber die Welt (anders als ein Tarifsatz oder eine
-- Pflichtfrage): sie behauptet nichts, sie begrenzt. Zu niedrig ist aergerlich und mit EINEM Aufruf
-- korrigiert; zu hoch ist eine Rechnung.
--
-- ── WIE DIE 100 ZUSTANDE KOMMT ─────────────────────────────────────────────────────────────────
-- Ein vollstaendiges Aufnahme-Gespraech liegt nach heutiger Einschaetzung bei 20 bis 40 Nachrichten.
-- 100 laesst also gut zwei solche Gespraeche am Tag zu und bleibt fuer einen Menschen unauffaellig,
-- begrenzt aber eine ausser Kontrolle geratene Schleife auf eine Groessenordnung, die man am selben
-- Tag bemerkt statt am Monatsende. Delta §6.3 nennt genau diese Richtung („anfangs grosszuegig,
-- iterativ nachjustierbar") — die Zahl ist ein ANFANGSWERT und der erste Kandidat fuer eine
-- Korrektur, sobald echte Gespraeche vorliegen.
--
-- `created_by` bleibt NULL: dieser Stand stammt aus einer Migration, nicht von einem Menschen. Ein
-- eingetragener Urheber waere eine Zuschreibung an jemanden, der ihn nicht gesetzt hat.
-- `valid_from` ist ein LITERAL und nicht `current_date` — der Stand hat an dem Tag begonnen, an dem
-- er geschrieben wurde, und soll in jeder Umgebung denselben Beginn tragen.
insert into platform.chat_rate_limit_settings (max_messages_per_account_per_day, valid_from)
values (100, date '2026-09-10')
on conflict (valid_from) do nothing;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — die Admin-Wrapper
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Beide sind `security definer` + `authenticated` + `platform.is_admin()` — dieselbe Abweichung vom
-- `grid_tariffs`-Vorbild wie beim Fragenkatalog und aus demselben Grund: die Tabelle liegt in
-- `platform`, der Aufrufer ist eine angemeldete Sitzung, und `is_admin()` ist damit ueberhaupt erst
-- beantwortbar. Beide WERFEN bei fehlender Adminrolle (42501) statt leer zu antworten.

-- ── admin_set_chat_rate_limit ───────────────────────────────────────────────────────────────────
-- ⚠ `p_valid_from` HAT EINEN VORGABEWERT (`current_date`), damit der Regelaufruf
-- `admin_set_chat_rate_limit(p_max)` genuegt. Der Parameter existiert trotzdem, und zwar aus
-- demselben Grund wie bei den zwei Vorbildern: ohne ihn koennte die Ordnungspflicht per Konstruktion
-- nie verletzt werden und waere eine Behauptung ohne Gegenprobe.
create function public.admin_set_chat_rate_limit(
  p_max        integer,
  p_valid_from date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max         integer := p_max;
  v_from        date := coalesce(p_valid_from, current_date);
  v_open_from   date;
  v_close_ids   uuid[];
  v_replace_ids uuid[];
  v_id          uuid;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_set_chat_rate_limit: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  -- Die Grenze steht im Schema (CHECK), die MELDUNG steht hier — dieselbe Aufteilung wie bei den
  -- `grid_tariff`-Wrappern. Ein roher 23514 traegt keinen Feldbezug, den eine Oberflaeche anzeigen
  -- koennte, und `0` ist der wahrscheinlichste Tippfehler an genau diesem Feld.
  if v_max is null or v_max < 1 then
    return jsonb_build_object('status', 'invalid_max');
  end if;

  perform pg_advisory_xact_lock(hashtext('chat_rate_limit'));

  select array_agg(o.id) filter (where o.valid_from < v_from),
         array_agg(o.id) filter (where o.valid_from = v_from),
         max(o.valid_from)
    into v_close_ids, v_replace_ids, v_open_from
    from (
      select x.id, x.valid_from
        from platform.chat_rate_limit_settings x
       where x.valid_until is null
         for update
    ) o;

  if v_open_from is not null and v_from < v_open_from then
    return jsonb_build_object(
      'status', 'invalid_valid_from',
      'open_valid_from', v_open_from
    );
  end if;

  if v_close_ids is not null then
    update platform.chat_rate_limit_settings
       set valid_until = v_from - 1
     where id = any(v_close_ids);
  end if;

  -- Ein Stand, der HEUTE beginnt und HEUTE korrigiert wird, hat noch kein Gespraech eines anderen
  -- Tages bestimmt — es ist derselbe Stand, kein zweiter (wortgleiche Ueberlegung wie beim
  -- Fragenkatalog). Und hier waere die Alternative eine Sackgasse: diese Tabelle hat keinen
  -- Loeschweg, ein abgewiesener Gleich-Tag liesse eine Zahl stehen, die niemand mehr korrigieren
  -- koennte.
  if v_replace_ids is not null then
    update platform.chat_rate_limit_settings
       set max_messages_per_account_per_day = v_max
     where id = any(v_replace_ids)
    returning id into v_id;

    return jsonb_build_object(
      'status', 'replaced',
      'id', v_id,
      'max', v_max,
      'closed_count', coalesce(array_length(v_close_ids, 1), 0)
    );
  end if;

  begin
    insert into platform.chat_rate_limit_settings
      (max_messages_per_account_per_day, valid_from, created_by)
    values (v_max, v_from, auth.uid())
    returning id into v_id;
  exception
    when unique_violation then
      return jsonb_build_object('status', 'duplicate_valid_from');
  end;

  return jsonb_build_object(
    'status', 'created',
    'id', v_id,
    'max', v_max,
    'closed_count', coalesce(array_length(v_close_ids, 1), 0),
    'closed_valid_until', case when v_close_ids is null then null else v_from - 1 end
  );
end;
$$;

comment on function public.admin_set_chat_rate_limit(integer, date) is
  'B24: setzt das Chat-Nachrichtenlimit als neuen datierten Stand und schliesst den offenen '
  'Vorgaenger auf valid_from - 1. Beginnt der offene Stand am SELBEN Tag, wird sein Wert in place '
  'ersetzt ({status: replaced}) — hier ist das die einzige Korrekturmoeglichkeit, denn diese Tabelle '
  'hat bewusst KEINEN Loeschweg. Ein Stand VOR dem offenen wird abgewiesen (Ordnungspflicht). Werte '
  '< 1 sind {status: invalid_max}: eine 0 waere ein Not-Aus fuer den ganzen Chat und braucht einen '
  'eigenen, benannten Weg. WIRFT ohne Adminrolle (42501).';

-- ── admin_get_chat_rate_limit ───────────────────────────────────────────────────────────────────
-- ⚠ LIEST DEN OFFENEN STAND (`valid_until is null`), NICHT den heute geltenden — und das ist der
-- Unterschied zu `check_chat_rate_limit` unten (wortgleiche Aufteilung wie
-- admin_get_system_prompt_extension / get_system_prompt_extension). Der Admin bearbeitet den Stand,
-- den er zuletzt gesetzt hat, auch wenn dieser ueber ein zukuenftiges `p_valid_from` heute noch gar
-- nicht gilt. Ihm stattdessen den heute geltenden zu zeigen hiesse, ihn eine Fassung bearbeiten zu
-- lassen, die er gerade abgeloest hat.
create function public.admin_get_chat_rate_limit()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_get_chat_rate_limit: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select to_jsonb(e) || jsonb_build_object(
           'created_by_email',
           (select au.email from auth.users au where au.id = e.created_by)
         )
    into v_row
  from (
    select x.id, x.max_messages_per_account_per_day, x.valid_from, x.valid_until, x.created_by,
           x.created_at, x.updated_at
      from platform.chat_rate_limit_settings x
     where x.valid_until is null
     order by x.valid_from desc
     limit 1
  ) e;

  if v_row is null then
    return jsonb_build_object('status', 'none');
  end if;

  return jsonb_build_object('status', 'ok', 'setting', v_row);
end;
$$;

comment on function public.admin_get_chat_rate_limit() is
  'B24: der aktuell OFFENE Stand des Chat-Nachrichtenlimits samt aufgeloester Urheber-Adresse — die '
  'Fassung, die der Admin bearbeitet. Bewusst NICHT der heute geltende Stand (den liest '
  'check_chat_rate_limit): ein zukuenftig beginnender Stand soll bearbeitbar bleiben. Der '
  'Startwert der Migration traegt created_by = null (kein Mensch hat ihn gesetzt) und damit auch '
  'keine Adresse. WIRFT ohne Adminrolle (42501).';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — check_chat_rate_limit
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Die Frage, die die Chat-Schleife vor ihrem ERSTEN Modellaufruf stellt. Sie liest den HEUTE
-- geltenden Stand (Fenster wie `list_question_catalog`, `valid_until` INKLUSIV).
--
-- ── ⚠ GEZAEHLT WIRD UEBER ALLE PROJEKTE DES KONTOS, NICHT JE PROJEKT ───────────────────────────
-- Delta §6.3 sagt das woertlich („ein Limit pro Konto, nicht zusaetzlich separat pro Projekt"), und
-- der Grund ist die Umgehung: ein Limit je Projekt waere keins, weil `create_my_project` fuer jedes
-- Konto beliebig oft aufrufbar ist. Wer die Grenze erreicht, legte einfach ein zweites Projekt an.
--
-- ── ⚠ ADMIN ZAEHLT GAR NICHT, statt nur nicht abgewiesen zu werden ─────────────────────────────
-- Der Adminzweig steht VOR jedem Lesezugriff. Das ist kein Sparen, sondern die pruefbare Form von
-- „ausgenommen": es gibt fuer eine Admin-Sitzung keinen Zaehlstand, den ein spaeterer Umbau
-- versehentlich auswerten koennte.
--
-- ── FAIL CLOSED, UND ZWAR ANDERS ALS BEI DEN KATALOG-LESERN ────────────────────────────────────
-- `loadSystemPromptExtension` und `listQuestionCatalog` sind bewusst FAIL OPEN: ein gescheiterter
-- Lesevorgang eines admin-gepflegten Textes darf einem Kunden nicht den Chat nehmen, und er kostet
-- nichts. Hier gilt das Gegenteil. Kann diese Funktion nicht antworten, wissen wir nicht, ob das
-- Konto sein Budget ueberschritten hat — und der naechste Schritt gaebe abrechenbares Geld aus. Der
-- Preis ist gering: es ist dieselbe Datenbank, die gleich darauf die Nutzer-Nachricht speichern
-- muss; ist sie weg, endet der Turn ohnehin in einem `storage_error`.
create function public.check_chat_rate_limit(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_max        integer;
  v_used       integer;
begin
  if platform.is_admin() then
    return jsonb_build_object('status', 'ok', 'reason', 'admin');
  end if;

  -- „Gibt es nicht" und „gehoert jemand anderem" liefern DENSELBEN Status — die durchgaengige
  -- Konvention dieses Schemas (get_my_project, get_active_partner, get_project). Die Frage nach dem
  -- Budget eines fremden Projekts soll gar nicht beantwortbar sein.
  if not platform.project_accessible(p_project_id) then
    return jsonb_build_object('status', 'not_found');
  end if;

  select p.account_id into v_account_id
    from platform.projects p
   where p.id = p_project_id;

  -- ⚠ STRUKTURELL UNERREICHBAR, UND TROTZDEM DA. Fuer einen Nicht-Admin verlangt
  -- `project_accessible` bereits `accounts.user_id = auth.uid()`, also ein vorhandenes Konto; ein
  -- admin-gefuehrtes Projekt (account_id null) hat den Aufrufer oben schon in `not_found` geschickt.
  -- Der Zweig bleibt als Tiefenstaffelung stehen — ohne Konto gibt es keine Zaehlgrundlage, und
  -- ohne Zaehlgrundlage ist „erlaubt" geraten. Dieselbe Bauweise wie die unerreichbaren Zweige in
  -- admin_approve_partner_application (B16-4a) und admin_set_system_prompt_extension.
  if v_account_id is null then
    return jsonb_build_object('status', 'no_account');
  end if;

  select x.max_messages_per_account_per_day into v_max
    from platform.chat_rate_limit_settings x
   where x.valid_from <= current_date
     and (x.valid_until is null or x.valid_until >= current_date)
   order by x.valid_from desc
   limit 1;

  -- Ebenfalls Tiefenstaffelung: die Migration setzt einen Startwert, und ein zukuenftig beginnender
  -- Stand kann keine Luecke erzeugen (der Vorgaenger wird auf `valid_from - 1` geschlossen, und das
  -- ist INKLUSIV). Entstuende trotzdem eine, ist „kein Limit bekannt" nicht dasselbe wie „kein
  -- Limit" — s. der Fail-closed-Absatz oben.
  if v_max is null then
    return jsonb_build_object('status', 'no_limit_configured');
  end if;

  -- ⚠ NUR `user`-Zeilen. `assistant`, `tool_call` und `tool_result` entstehen als FOLGE eines Turns
  -- und sind vom Nutzer nicht steuerbar; sie mitzuzaehlen machte aus derselben Zahl je nach
  -- Dokumentenlage ein voellig anderes Limit — ein Turn mit vier Werkzeugaufrufen kostete dann so
  -- viel wie neun Turns ohne.
  select count(*)::integer into v_used
    from platform.project_messages m
    join platform.projects p on p.id = m.project_id
   where p.account_id = v_account_id
     and m.role = 'user'
     and m.created_at >= now() - interval '24 hours';

  if v_used >= v_max then
    return jsonb_build_object('status', 'limit_reached', 'used', v_used, 'max', v_max);
  end if;

  return jsonb_build_object('status', 'ok', 'used', v_used, 'max', v_max);
end;
$$;

comment on function public.check_chat_rate_limit(uuid) is
  'B24: darf dieses Projekt jetzt einen Chat-Turn ausloesen? (Delta §6.3.) Adminrolle → immer ok, '
  'OHNE zu zaehlen. Sonst: Konto ueber das Projekt aufloesen und die `user`-Nachrichten dieses '
  'Kontos ueber ALLE seine Projekte der letzten 24 Stunden gegen den heute geltenden Stand halten. '
  'Fremdes/unbekanntes Projekt → not_found (wie ueberall in diesem Schema nicht unterscheidbar). '
  'FAIL CLOSED: was nicht als `ok` zurueckkommt, darf keinen abrechenbaren Modellaufruf ausloesen — '
  'bewusst anders als die FAIL-OPEN-Leser der admin-gepflegten Texte. authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 5 — RLS und Rechte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Muster platform.accounts/projects, project_messages, question_catalog_entries, analyses, job_runs:
-- RLS an, KEINE Policy, fuer KEINE Rolle ein Tabellen-Grant — auch nicht fuer service_role. Zwei
-- unabhaengige Schichten: ohne Policy saehe selbst eine Rolle nichts, der jemand spaeter
-- versehentlich ein Tabellenrecht gaebe.
alter table platform.chat_rate_limit_settings enable row level security;

-- Supabase vergibt per ALTER DEFAULT PRIVILEGES auf NEUE public-Funktionen automatisch EXECUTE an
-- anon, authenticated UND service_role (zusaetzlich zum PostgreSQL-Default-Grant an PUBLIC). Deshalb
-- wie ueberall: erst allen entziehen, dann gezielt gewaehren.
--
-- `anon` bekommt nichts. `service_role` ebenfalls nicht — und das ist auch hier eine Aussage: alle
-- drei Wrapper leiten ihre Autorisierung aus `platform.is_admin()` bzw. `platform.project_accessible()`
-- ab, und beide lesen `auth.uid()`. Unter service_role waere `is_admin()` false und
-- `project_accessible()` fuer JEDES Projekt false — die zwei Admin-Wrapper waeren dort funktionslos,
-- und `check_chat_rate_limit` antwortete ausnahmslos `not_found`. Ein Grant waere also nicht bloss
-- unnoetig, sondern eine Tuer, die den Sitzungsbezug umgeht, den der ganze Chat-Zugriffsschutz
-- verlangt.
revoke all on function public.admin_set_chat_rate_limit(integer, date)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_get_chat_rate_limit()
  from public, anon, authenticated, service_role;
revoke all on function public.check_chat_rate_limit(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_set_chat_rate_limit(integer, date) to authenticated;
grant execute on function public.admin_get_chat_rate_limit() to authenticated;
grant execute on function public.check_chat_rate_limit(uuid) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 6 — was es hier BEWUSST NICHT GIBT
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- KEIN Euro-, Token- oder Kosten-Tracking. Delta §6.3 legt die erste Ausbaustufe ausdruecklich auf
-- eine einfache Zaehlung fest. Eine Kostenzahl brauchte je Modell und je Tarifstand einen gepflegten
-- Preis, und ein veralteter Preis saehe im Bestand aus wie eine gemessene Ausgabe.
--
-- KEINE Zaehlung von Uploads. §6.3 nennt sie in einem Atemzug mit den Nachrichten, aber ein Upload
-- loest fuer sich noch keinen Modellaufruf aus (`append_project_document` ruft kein Modell); die
-- Extraktion geschieht IM Turn und ist damit ueber die Nachricht bereits begrenzt. Eine zweite
-- Grenze auf denselben Vorgang waere zwei Zahlen fuer eine Sache.
--
-- KEIN LOESCHWEG und KEIN „Limit abschalten". Ein Wert < 1 wird abgewiesen (s. TEIL 3); die
-- Korrektur am selben Tag ersetzt in place. Wer den Chat wirklich stilllegen will, baut dafuer einen
-- eigenen, benannten Weg — „Limit auf 0" saehe im Bestand aus wie ein Zahlendreher.
--
-- ⚠ KEIN LAUFPROTOKOLL und KEIN Vermerk am abgewiesenen Turn. Eine abgelehnte Anfrage hinterlaesst
-- KEINE Zeile — insbesondere wird die Nutzer-Nachricht NICHT gespeichert (das entscheidet der
-- Aufrufer, s. `agent.ts`). Das ist Absicht: eine gespeicherte Ablehnung zaehlte im naechsten
-- Fenster mit und verschoebe die Sperre bei jedem Versuch weiter nach hinten — das Limit zoege sich
-- selbst zu. Wer wissen will, wie oft abgewiesen wurde, braucht dafuer ein eigenes Protokoll mit
-- eigener Aufbewahrungsentscheidung.
--
-- KEINE Oberflaeche. Es gibt in diesem Schritt keinen Admin-Screen fuer das Limit; geaendert wird es
-- bis dahin ueber einen direkten Aufruf von `admin_set_chat_rate_limit` (SQL-Editor, angemeldet als
-- Admin). Dasselbe gilt fuer den Fragenkatalog seit dem vorigen Schritt.
--
-- KEINE Aufbewahrungsfrist. `platform.run_lead_retention` (B4-1) fasst diese Tabelle nicht an — sie
-- traegt keinen Kundentext, einzige personenbezogene Angabe ist die Urheber-Kennung. Die offene
-- juristische Frage aus DEPLOYMENT.md §7 waechst durch diesen Schritt NICHT.
