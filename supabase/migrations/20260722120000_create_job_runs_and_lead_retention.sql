-- B4-1 — Scheduling-Infrastruktur und automatische Fristdurchsetzung
-- (Fahrplan_2026.md, Abschnitt B4).
--
-- Dies ist der ERSTE zeitgesteuerte Job im System. Bis hierher wurde jede Schreiboperation von einem
-- Menschen ausgelöst — durch ein abgesendetes Formular (B1-2), einen Klick im Admin-Bereich (B1-3)
-- oder ein Stripe-Ereignis, das seinerseits an einer Nutzerhandlung hing (T4-3). Ab jetzt handelt
-- das System von sich aus, zu einer Zeit, zu der niemand zusieht.
--
-- ── WARUM AUSGERECHNET DIESE AUFGABE DIE ERSTE IST ───────────────────────────────────────────────
-- Der Job versendet KEINE E-Mail; die Vertragsablauf-Erinnerung samt Versand ist B4-2. Das ist
-- Absicht: der erste Cron soll eine Aufgabe haben, die nachweislich keinen realen Menschen erreichen
-- kann. Fällige Löschfristen gibt es zudem vor 2028 keine (24 Monate ab letzter Interaktion, und der
-- Bestand beginnt 2026) — der Lauf findet null Fälle, beweist damit die gesamte Kette von der
-- Plattform-Zeitsteuerung über die Privilegiengrenze bis in die Datenbank, und verändert nichts.
--
-- NICHT hier: die Vertragsablauf-Erinnerung selbst und jeglicher E-Mail-Versand (B4-2), der
-- Betroffenheits-Check (B3-3), gefilterte Sicht/Export/Aussendung (B2), `tenant_id` (B13).
--
-- ── KONVENTIONEN (exakt B1-1/B1-2/B1-3/B3-1) ────────────────────────────────────────────────────
-- Alles Fachliche in `platform` (nicht über die REST-API exponiert), Zugriff von aussen
-- ausschliesslich über SECURITY-DEFINER-Wrapper im `public`-Schema, alle Funktionen mit
-- `SET search_path = ''` und vollqualifizierten Objektnamen, erst `revoke all … from public, anon,
-- authenticated, service_role`, dann gezielt grants. `anon` bekommt NIRGENDS etwas.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — platform.job_runs: das Laufprotokoll
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── WARUM EIN PROTOKOLL DIE ERSTE ZEILE DIESER MIGRATION IST ─────────────────────────────────────
-- Der wahrscheinlichste Fehler eines zeitgesteuerten Jobs ist nicht, dass er scheitert, sondern dass
-- er NICHT LÄUFT. Ein gescheiterter Lauf hinterlässt eine Fehlermeldung; ein ausgebliebener
-- hinterlässt gar nichts. Und „gar nichts" ist von „es war nichts zu tun" nicht unterscheidbar —
-- genau der Zustand, den dieser Job im gesamten Jahr 2026 planmässig hat. Ohne Protokoll wäre ein
-- seit Monaten stiller Cron von einem korrekt arbeitenden nicht zu trennen; auffallen würde es
-- erstmals 2028, an nicht durchgesetzten Löschfristen.
--
-- Deshalb wird die Zeile ZUERST angelegt (beim Start), nicht am Ende geschrieben: ein Lauf, der
-- mitten in der Arbeit stirbt, hinterlässt dann eine Zeile mit `finished_at is null` — sichtbar
-- abgebrochen, nicht spurlos.
--
-- ── WARUM HIER KEIN APPEND-ONLY-SCHUTZ WIE BEI stripe_events (T4-1) ─────────────────────────────
-- `platform.stripe_events` ist gegen UPDATE gesperrt, weil dort eine fremde Aussage archiviert wird:
-- was Stripe gemeldet hat, darf nachträglich niemand umschreiben. Hier ist es umgekehrt — der
-- Datensatz ist EINE Aussage über EINEN Lauf, die zwangsläufig in zwei Schritten entsteht (Start,
-- Ende). Ein UPDATE muss also erlaubt sein; ein Append-only-Trigger machte das Protokoll
-- unmöglich, nicht sicherer. Der Schutz liegt woanders: die Tabelle hat für keine Rolle ein Grant,
-- geschrieben wird ausschliesslich aus platform.run_lead_retention.
create table platform.job_runs (
  id uuid primary key default gen_random_uuid(),
  -- CHECK statt Enum, und zwar nach derselben Regel wie bei platform.leads.status (B1-1): eine
  -- kurze, feste Liste, deren Werte im Anwendungscode je eigene Bedeutung haben. Zunächst nur
  -- 'lead_retention'; B4-2 hängt seinen Schlüssel additiv an.
  job_key text not null check (job_key in ('lead_retention')),
  -- `clock_timestamp()` und NICHT `now()`: `now()` ist die TRANSAKTIONSzeit und innerhalb einer
  -- Transaktion konstant. Zwei Läufe in derselben Transaktion (im DB-Gate der Normalfall) trügen
  -- damit denselben Startzeitpunkt auf die Mikrosekunde — ihre Reihenfolge wäre nicht mehr
  -- bestimmbar, und „der letzte Lauf" ist genau die Frage, die dieses Protokoll beantworten soll.
  -- Dieselbe Überlegung wie bei finished_at (s. platform.run_lead_retention).
  started_at timestamptz not null default clock_timestamp(),
  -- NULL heisst „läuft noch oder ist abgebrochen" — der einzige Zustand, den ein Lauf nicht selbst
  -- protokollieren kann, und deshalb der einzige, der aus der Abwesenheit eines Werts folgt.
  finished_at timestamptz,
  outcome text check (outcome in ('success', 'refused', 'error')),
  items_considered integer,
  items_processed integer,
  detail text
);

comment on table platform.job_runs is
  'Laufprotokoll der zeitgesteuerten Jobs (B4-1). Existiert, weil der wahrscheinlichste Fehler '
  'eines Cron-Jobs nicht das Scheitern ist, sondern das AUSBLEIBEN: ein nicht gelaufener Job '
  'erzeugt keine Fehlermeldung, und sein Ausbleiben ist von „nichts zu tun" nicht unterscheidbar — '
  'ausgerechnet der Normalzustand dieses Jobs bis 2028. Die Zeile entsteht beim START des Laufs und '
  'wird beim Ende genau einmal vervollständigt; ein UPDATE ist deshalb bewusst erlaubt (anders als '
  'bei platform.stripe_events, wo eine fremde Aussage archiviert wird). Kein Grant für irgendeine '
  'Rolle: geschrieben wird nur aus platform.run_lead_retention, gelesen nur über '
  'public.admin_list_job_runs.';

comment on column platform.job_runs.job_key is
  'Welcher Job. CHECK statt Enum (Muster wie leads.status): kurze feste Liste, jeder Wert hat im '
  'Anwendungscode eigene Bedeutung. Zunächst nur ''lead_retention''; B4-2 hängt additiv an.';

comment on column platform.job_runs.finished_at is
  'NULL = der Lauf ist nie zu Ende gekommen (Abbruch, Timeout, Prozesstod). Der einzige Zustand, '
  'den ein Lauf nicht selbst protokollieren kann — er folgt aus der Abwesenheit des Werts.';

comment on column platform.job_runs.outcome is
  'success | refused | error. ''refused'' ist KEIN Fehler, sondern das vorgesehene Verhalten '
  'oberhalb der Mengenobergrenze (s. platform.run_lead_retention) — die Begründung steht dann im '
  'Klartext in detail.';

comment on column platform.job_runs.items_considered is
  'Wie viele Fälle der Lauf SAH (alle fälligen, ungeachtet der Stapelgrenze). Zusammen mit '
  'items_processed macht das den Unterschied zwischen „nichts zu tun" und „abgeschnitten" sichtbar.';

comment on column platform.job_runs.items_processed is
  'Wie viele Fälle der Lauf tatsächlich BEARBEITETE. Bei ''refused'' immer 0 — oberhalb der '
  'Obergrenze wird nicht die erste Teilmenge abgearbeitet, sondern gar nichts.';

comment on column platform.job_runs.detail is
  'Klartextbegründung, insbesondere bei ''refused'' und ''error''. Kein Fehlercode, sondern ein '
  'Satz, den der Admin-Bereich unverändert anzeigt — wer ihn liest, sucht nicht die Ursache, '
  'sondern will wissen, was zu tun ist.';

-- Ein Index auf (job_key, started_at desc) und nicht auf started_at allein: jede Abfrage dieser
-- Tabelle fragt nach EINEM Job (den letzten Lauf des Fristenlaufs, nicht den letzten Lauf
-- irgendeines Jobs) — spätestens ab B4-2, wenn ein zweiter Schlüssel dazukommt.
create index job_runs_job_key_started_at_idx on platform.job_runs (job_key, started_at desc);

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — Urheberschaft der Anonymisierung eindeutig machen
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── WARUM DIESE SPALTE VOR DEM JOB KOMMT ─────────────────────────────────────────────────────────
-- B1-3 stellt `anonymized_by = null` in der Oberfläche als „durch ein inzwischen gelöschtes Konto"
-- dar. Das war richtig, solange nur Menschen anonymisieren konnten: die Spalte trägt ON DELETE SET
-- NULL, ein leerer Wert konnte nur aus einem gelöschten Konto stammen. Sobald ein Systemlauf
-- anonymisiert, wird dieselbe Aussage falsch — und zwar still, an der einen Stelle, an der ein
-- Mensch nachträglich rekonstruieren muss, wer einen unumkehrbaren Vorgang ausgelöst hat.
--
-- Die Unterscheidung gehört deshalb ins DATENMODELL, nicht in eine Vermutung der Oberfläche. Eine
-- Oberfläche, die aus einem NULL-Wert auf die Ursache schliesst, rät; sie kann nicht anders, weil
-- die Zeile die Antwort nicht enthält.
alter table platform.leads
  add column anonymized_by_system boolean not null default false;

-- Der CHECK macht die dritte, sinnlose Kombination unmöglich: „vom System UND von Konto X". Beides
-- zugleich wäre keine genauere Angabe, sondern zwei widersprechende Urheber in einer Zeile — und
-- eine Oberfläche müsste sich für eine der beiden entscheiden, also wieder raten.
-- (`anonymized_by_system = false` mit `anonymized_by is null` bleibt ausdrücklich erlaubt: das ist
-- der B1-3-Fall „Mensch hat anonymisiert, sein Konto wurde später gelöscht".)
alter table platform.leads
  add constraint leads_anonymized_authorship_check check (
    (anonymized_by_system and anonymized_by is null) or (not anonymized_by_system)
  );

comment on column platform.leads.anonymized_by_system is
  'true = die Anonymisierung stammt aus dem Fristenlauf (B4-1), nicht von einem Menschen; '
  'anonymized_by ist dann per CHECK zwingend null. false = von einem Menschen ausgelöst — ist '
  'anonymized_by dabei null, wurde dessen Konto inzwischen gelöscht (ON DELETE SET NULL). Ohne '
  'diese Spalte wären die beiden Fälle nicht unterscheidbar, und die B1-3-Oberfläche behauptete bei '
  'jedem Systemlauf ein „inzwischen gelöschtes Konto", das es nie gab.';

-- ── guard_anonymized_lead: derselbe Grund wie in B3-1 ────────────────────────────────────────────
-- Ein Schutzmechanismus, der seine eigene Erweiterung nicht abdeckt, läuft an ihr vorbei. Ohne die
-- neue Zeile liesse sich an einem anonymisierten Lead die URHEBERSCHAFT nachträglich umschreiben —
-- aus „automatisch" ein Konto machen oder umgekehrt. Das ist keine Kosmetik: die Zuschreibung eines
-- unumkehrbaren Vorgangs ist genau das, was im Zweifel nachgewiesen werden muss.
--
-- `create or replace` mit unveränderter Signatur — der Trigger leads_protect_anonymized (B1-3)
-- bleibt unangetastet.
create or replace function platform.guard_anonymized_lead()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.anonymized_at is null then
    return new;
  end if;

  if new.email           is distinct from old.email
     or new.company      is distinct from old.company
     or new.contact_name is distinct from old.contact_name
     or new.phone        is distinct from old.phone
     or new.status       is distinct from old.status
     or new.retention_basis is distinct from old.retention_basis
     or new.anonymized_at   is distinct from old.anonymized_at
     -- B3-1: die Segmentierungsspalten.
     or new.industry               is distinct from old.industry
     or new.postal_code            is distinct from old.postal_code
     or new.annual_consumption_kwh is distinct from old.annual_consumption_kwh
     or new.metering_type          is distinct from old.metering_type
     or new.supplier               is distinct from old.supplier
     or new.contract_end_date      is distinct from old.contract_end_date
     -- B4-1: die Urheberschaft. anonymized_by bleibt bewusst weiterhin ungeschützt (ON DELETE SET
     -- NULL muss durchlaufen können, B1-3) — das KENNZEICHEN dagegen ändert sich nie von selbst und
     -- darf sich deshalb auch nicht von Hand ändern lassen.
     or new.anonymized_by_system   is distinct from old.anonymized_by_system
  then
    raise exception
      'platform.leads %: der Lead ist seit % anonymisiert — E-Mail, Firma, Name, Telefon, Status, '
      'Aufbewahrungsgrundlage, der Anonymisierungszeitpunkt, sämtliche Segmentierungsmerkmale '
      '(Branche, PLZ, Jahresverbrauch, Messart, Versorger, Vertragsende) und die Urheberschaft der '
      'Anonymisierung sind unveränderlich. Anonymisierung ist endgültig, auch für service_role und '
      'für den Admin',
      old.id, old.anonymized_at;
  end if;

  return new;
end;
$$;

comment on function platform.guard_anonymized_lead() is
  'BEFORE UPDATE auf leads: ist anonymized_at gesetzt, sind email, company, contact_name, phone, '
  'status, retention_basis, anonymized_at, (seit B3-1) industry, postal_code, '
  'annual_consumption_kwh, metering_type, supplier, contract_end_date UND (seit B4-1) '
  'anonymized_by_system unveränderlich — auch für service_role und für den Admin. anonymized_at '
  'steht bewusst mit in der Liste (sonst liesse sich der Guard durch Nullen seiner eigenen '
  'Bedingung abschalten); anonymized_by bewusst NICHT (die Spalte trägt ON DELETE SET NULL, ein '
  'Schutz blockierte das Löschen des handelnden Kontos). last_interaction_at bleibt änderbar — der '
  'B1-1-Trigger touch_lead_on_consent muss weiter laufen können.';

-- ── anonymize_lead: der dritte Parameter ─────────────────────────────────────────────────────────
-- ── WARUM DROP + CREATE UND NICHT create or replace (wie schon bei capture_lead in B3-1) ─────────
-- `create or replace` kann die Parameterliste nicht erweitern; ein blosses CREATE erzeugte eine
-- ZWEITE Überladung, und der bestehende Zwei-Argument-Aufruf aus public.admin_anonymize_lead wäre
-- mehrdeutig („function is not unique") — der Admin-Pfad läge lahm. Der Vorgabewert `false` sorgt
-- dafür, dass genau dieser Aufruf unverändert weiterläuft und unverändert dasselbe bedeutet.
--
-- Folge des DROP: PostgreSQLs Default-Grant an PUBLIC greift wieder und wird unten erneut entzogen.
drop function if exists platform.anonymize_lead(uuid, uuid);

create function platform.anonymize_lead(
  p_lead_id uuid,
  p_actor uuid,
  p_by_system boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_anonymized_at timestamptz;
  v_by_system     boolean := coalesce(p_by_system, false);
begin
  -- Ein Systemlauf HAT kein handelndes Konto. Käme trotzdem eines mit, wäre entweder der Aufrufer
  -- verwirrt oder die Zuschreibung falsch — beides ist ein Programmierfehler und keine Lage, in der
  -- eine unumkehrbare Operation weiterlaufen soll. Die Ablehnung kommt VOR jeder Wirkung; der CHECK
  -- auf der Tabelle fängt denselben Fall ein zweites Mal ab, dann aber erst beim Schreiben.
  if v_by_system and p_actor is not null then
    raise exception
      'platform.anonymize_lead: p_by_system => true verlangt p_actor => null — ein Systemlauf hat '
      'kein handelndes Konto, und zwei Urheber in einer Zeile sind keine genauere Angabe, sondern '
      'ein Widerspruch';
  end if;

  if p_lead_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Zeilensperre: zwei gleichzeitige Klicks auf „Anonymisieren" sollen nicht beide durchlaufen —
  -- und seit B4-1 auch nicht ein Klick und ein Systemlauf gleichzeitig.
  -- (FOUND unterscheidet „keine Zeile" von „Zeile mit anonymized_at = null" — der Null-Wert allein
  -- wäre mehrdeutig.)
  select l.anonymized_at
    into v_anonymized_at
  from platform.leads l
  where l.id = p_lead_id
  for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- IDEMPOTENT: Erfolg ohne zweite Wirkung. anonymized_at bleibt der ERSTE Zeitpunkt (dasselbe
  -- Prinzip wie confirmed_at in B1-2 — ein nachgeschriebenes Datum wäre eine Fälschung), und der
  -- Guard-Trigger würde ein Überschreiben ohnehin ablehnen. Die Urheberschaft bleibt aus demselben
  -- Grund beim ERSTEN: ein Systemlauf, der über einen bereits vom Admin anonymisierten Lead läuft,
  -- schreibt sich nicht nachträglich als Urheber ein.
  if v_anonymized_at is not null then
    return jsonb_build_object(
      'status', 'ok', 'outcome', 'already_anonymized', 'anonymized_at', v_anonymized_at
    );
  end if;

  -- ZUERST die Einwilligungen, DANN der Lead. Grund: der B1-1-Trigger touch_lead_on_consent
  -- schreibt bei jeder Einwilligungsänderung auf den Lead zurück. In dieser Reihenfolge trifft er
  -- eine noch nicht anonymisierte Zeile; umgekehrt liefe er gegen den frisch gesetzten Guard —
  -- der zwar last_interaction_at durchliesse, aber die Abhängigkeit wäre unnötig fein.
  update platform.consents c
     set source_ip  = null,
         user_agent = null
   where c.lead_id = p_lead_id
     and (c.source_ip is not null or c.user_agent is not null);

  update platform.leads l
     set email         = 'anonymized+' || p_lead_id::text || '@invalid',
         company       = null,
         contact_name  = null,
         phone         = null,
         status        = 'anonymized',
         anonymized_at = now(),
         -- Bei einem Systemlauf ist p_actor per Prüfung oben bereits null; der CASE schreibt die
         -- Regel trotzdem hin, damit sie beim Lesen der Zeile nicht erst hergeleitet werden muss.
         anonymized_by        = case when v_by_system then null else p_actor end,
         anonymized_by_system = v_by_system,
         -- B3-1, lokalisierende Merkmale:
         postal_code       = null,
         supplier          = null,
         contract_end_date = null
   where l.id = p_lead_id;

  return jsonb_build_object(
    'status', 'ok', 'outcome', 'anonymized', 'by_system', v_by_system
  );
end;
$$;

comment on function platform.anonymize_lead(uuid, uuid, boolean) is
  'Anonymisiert einen Lead UNUMKEHRBAR: E-Mail → anonymized+<lead_id>@invalid (RFC 2606, nie '
  'zustellbar, je Lead eindeutig — hält den UNIQUE über die normalisierte Adresse ein), company/'
  'contact_name/phone → null, source_ip/user_agent ALLER Einwilligungen → null, seit B3-1 '
  'zusätzlich postal_code/supplier/contract_end_date → null, status=anonymized, anonymized_at '
  'gesetzt. BLEIBEN: die Einwilligungszeilen selbst (Zweck, Textfassung, Zeitpunkte — ohne '
  'Identitätsmerkmale kein Personenbezug mehr, aber weiterhin der Beleg, dass korrekt gearbeitet '
  'wurde), der Sperrlisten-Eintrag (er MUSS die Löschung überleben, B1-1) sowie industry/'
  'annual_consumption_kwh/metering_type. Die Trennlinie verläuft entlang „lokalisierend" gegen '
  '„grob einordnend". SEIT B4-1: p_by_system => true kennzeichnet den Fristenlauf als Urheber '
  '(anonymized_by null, anonymized_by_system true) und WIRFT, wenn zugleich ein p_actor mitkommt — '
  'zwei Urheber in einer Zeile sind ein Widerspruch, keine genauere Angabe. Bestehende '
  'Zwei-Argument-Aufrufe verhalten sich unverändert. Idempotent: ein bereits anonymisierter Lead '
  'liefert Erfolg ohne zweite Wirkung, und die Urheberschaft bleibt beim ERSTEN. '
  '{status: ok|not_found}, outcome: anonymized|already_anonymized.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — Auswahl und Ausführung liegen in der DATENBANK, nicht im Anwendungscode
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Der Cron-Endpunkt ist Auslöser, nicht Verantwortlicher: er kennt weder die Auswahlregel noch den
-- Schwellwert und zählt nichts. Der Grund ist nicht Geschmack, sondern Reichweite — ein HTTP-Handler
-- ist von aussen erreichbar, eine Datenbankfunktion nicht. Läge die Mengenbegrenzung im Endpunkt,
-- entschiede ein Query-Parameter über die Grösse eines unumkehrbaren Vorgangs.

-- ── leads_due_for_anonymization: EINE Definition von „fällig" ────────────────────────────────────
-- Dieselbe Funktion beantwortet „wie viele sind fällig" (p_limit => null) und „welche bearbeite ich
-- jetzt" (p_limit => Stapelgrösse). Zwei getrennte Abfragen wären zwei Definitionen von fällig, und
-- die zweite fiele erst auf, wenn der Schwellwert gegen eine andere Menge prüft als die, die
-- anschliessend gelöscht wird — also genau im Moment des Schadens.
--
-- `limit null` heisst in SQL „unbegrenzt". Das ist hier tragende Semantik und kein Zufall.
create function platform.leads_due_for_anonymization(p_limit integer)
returns table (lead_id uuid, deletion_due_at timestamptz, retention_basis text)
language sql
stable
set search_path = ''
as $$
  select l.id, l.deletion_due_at, l.retention_basis
  from platform.leads l
  where l.anonymized_at is null
    and l.deletion_due_at <= now()
  -- Älteste zuerst, und der Primärschlüssel als zweites Kriterium: ohne ihn wäre die Reihenfolge
  -- bei gleicher Frist unbestimmt, und ein abgeschnittener Stapel bearbeitete beim nächsten Lauf
  -- womöglich wieder dieselben Zeilen, während andere nie an die Reihe kämen.
  order by l.deletion_due_at asc, l.id asc
  limit p_limit;
$$;

comment on function platform.leads_due_for_anonymization(integer) is
  'Die zur Anonymisierung fälligen Leads (deletion_due_at <= now(), anonymized_at is null), älteste '
  'zuerst, Primärschlüssel als Tie-Break. p_limit => null bedeutet unbegrenzt (SQL-Semantik von '
  'LIMIT NULL) — dieselbe Funktion beantwortet damit „wie viele sind fällig" und „welche bearbeite '
  'ich jetzt", und es gibt nur EINE Definition von fällig. Kein öffentlicher Zugriffsweg: aufgerufen '
  'ausschliesslich aus platform.run_lead_retention.';

-- ── run_lead_retention: die gesamte Entscheidungslogik ───────────────────────────────────────────
-- ── WARUM OBERHALB DES SCHWELLWERTS GAR NICHTS PASSIERT ──────────────────────────────────────────
-- Anonymisierung ist seit B1-3 endgültig — auch für service_role und für postgres; der Guard-Trigger
-- lehnt jede spätere Änderung ab, und die Klartextdaten sind physisch überschrieben. Es gibt keinen
-- Rückweg, auch nicht mit Datenbankrechten.
--
-- Ein Fehler in der Fristableitung (ein falsch gesetztes last_interaction_at, eine versehentlich
-- geänderte retention_months, ein Massenimport mit altem Datum) macht schlagartig den GESAMTEN
-- Bestand fällig. Ein ungebremster Job zerstörte ihn dann in einem einzigen Lauf, nachts, unbemerkt.
--
-- Deshalb wird oberhalb der Obergrenze NICHT die erste Teilmenge abgearbeitet, sondern gar nichts.
-- Eine Teilmenge zu löschen wäre die schlechteste aller Möglichkeiten: sie hätte denselben
-- irreversiblen Charakter, nur in kleineren Portionen, und der Lauf am nächsten Tag setzte fort.
-- Die Abwägung ist asymmetrisch und deshalb eindeutig: ein zu SPÄTER Lauf ist reparabel (man hebt
-- die Grenze bewusst an, nachdem man nachgesehen hat), ein zu GROSSER nicht.
--
-- Die Vorgabewerte (500 / 1000) sind an der erwarteten Grössenordnung bemessen: 2026 ist ein
-- Beschaffungsjahr mit einem Bestand im drei- bis vierstelligen Bereich, und die Fristen laufen ab
-- 2028 gleichmässig verteilt aus. Tausend an einem Tag fällige Leads sind unter diesen Annahmen kein
-- Betriebszustand, sondern ein Befund.
create function platform.run_lead_retention(
  p_max_batch integer default 500,
  p_refuse_above integer default 1000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id       uuid;
  v_started_at   timestamptz;
  v_considered   integer;
  v_processed    integer := 0;
  v_outcome      text;
  v_detail       text;
  v_error        text;
  v_due          record;
  v_result       jsonb;
  v_max_batch    integer := greatest(coalesce(p_max_batch, 500), 0);
  v_refuse_above integer := greatest(coalesce(p_refuse_above, 1000), 0);
  v_finished_at  timestamptz;
begin
  -- (1) Der Laufdatensatz entsteht VOR der Arbeit und AUSSERHALB des Ausnahmeblocks unten. Das ist
  -- der Grund, warum ein abgestürzter Lauf überhaupt eine Spur hinterlässt: der Rücksprung zum
  -- Sicherungspunkt macht nur rückgängig, was INNERHALB des Blocks geschah.
  insert into platform.job_runs (job_key)
  values ('lead_retention')
  returning id, started_at into v_run_id, v_started_at;

  begin
    -- (2) Fällige zählen — über dieselbe Funktion, die gleich auch auswählt.
    select count(*)::integer into v_considered
    from platform.leads_due_for_anonymization(null);

    if v_considered > v_refuse_above then
      -- (3) Verweigerung. Kein Teilbestand, keine Vorsichts-Portion: gar nichts.
      v_outcome := 'refused';
      v_detail := format(
        'Fällig: %s Leads — das übersteigt die Obergrenze von %s. Es wurde NICHTS anonymisiert. '
        'Anonymisierung ist unumkehrbar; ein zu später Lauf ist reparabel, ein zu grosser nicht. '
        'Zuerst die Fristableitung prüfen (last_interaction_at, retention_basis), dann die Grenze '
        'bewusst anheben.',
        v_considered, v_refuse_above
      );
    else
      -- (4) Bis zu p_max_batch Leads anonymisieren. Gezählt wird, was WIRKLICH anonymisiert wurde:
      -- ein zwischenzeitlich vom Admin anonymisierter Lead liefert 'already_anonymized' und darf
      -- nicht als Leistung dieses Laufs erscheinen.
      for v_due in
        select d.lead_id from platform.leads_due_for_anonymization(v_max_batch) d
      loop
        v_result := platform.anonymize_lead(v_due.lead_id, null, true);
        if v_result ->> 'outcome' = 'anonymized' then
          v_processed := v_processed + 1;
        end if;
      end loop;

      v_outcome := 'success';

      -- Eine stille Abschneidung ist eine Lüge in der Kennzahl: „5 bearbeitet" liest sich wie
      -- „fertig", auch wenn 700 offen blieben. Der Satz macht den Rest sichtbar.
      if v_processed < v_considered then
        v_detail := format(
          'Stapelgrenze erreicht: %s von %s fälligen Leads bearbeitet, der Rest folgt in den '
          'nächsten Läufen.',
          v_processed, v_considered
        );
      end if;
    end if;
  exception when others then
    -- Der Rücksprung zum Sicherungspunkt hat JEDE Anonymisierung dieses Laufs zurückgenommen (die
    -- PL/pgSQL-Variable v_processed überlebt ihn dagegen — sie wird deshalb unten auf 0 gesetzt).
    -- Ein halb abgearbeiteter Stapel entsteht dadurch nie: entweder der ganze Lauf oder keiner.
    v_error := coalesce(sqlerrm, 'unbekannter Fehler');
  end;

  if v_error is not null then
    v_outcome := 'error';
    v_processed := 0;
    v_detail := format(
      'Der Lauf ist abgebrochen und wurde vollständig zurückgenommen — es wurde kein Lead '
      'anonymisiert. Ursache: %s',
      v_error
    );
  end if;

  -- (5) Abschluss. Genau ein UPDATE je Lauf, auch beim verweigerten und beim gescheiterten.
  --
  -- `clock_timestamp()` und NICHT `now()`: der gesamte Lauf ist EINE Transaktion, und `now()`
  -- liefert darin unverändert die Transaktionszeit — finished_at wäre auf die Mikrosekunde gleich
  -- started_at, die Dauer jedes Laufs also strukturell null. Ausgerechnet die Dauer ist aber das
  -- erste, was man ansieht, wenn ein Lauf beim nächsten Mal in ein Zeitlimit rennt.
  update platform.job_runs jr
     set finished_at      = clock_timestamp(),
         outcome          = v_outcome,
         items_considered = v_considered,
         items_processed  = v_processed,
         detail           = v_detail
   where jr.id = v_run_id
  returning jr.finished_at into v_finished_at;

  return jsonb_build_object(
    'status',           'ok',
    'run_id',           v_run_id,
    'job_key',          'lead_retention',
    'outcome',          v_outcome,
    'items_considered', v_considered,
    'items_processed',  v_processed,
    'detail',           v_detail,
    'started_at',       v_started_at,
    'finished_at',      v_finished_at
  );
end;
$$;

comment on function platform.run_lead_retention(integer, integer) is
  'Der Fristenlauf (B4-1): legt einen Laufdatensatz an, zählt die fälligen Leads, verweigert '
  'oberhalb von p_refuse_above VOLLSTÄNDIG (outcome=refused, items_processed=0, Begründung im '
  'Klartext) und anonymisiert sonst bis zu p_max_batch Leads über anonymize_lead(…, p_by_system => '
  'true). Vorgabewerte 500 / 1000. Die gesamte Entscheidungslogik liegt HIER und nicht im '
  'Anwendungscode: ein HTTP-Handler ist von aussen erreichbar, eine Datenbankfunktion nicht — läge '
  'die Mengenbegrenzung im Endpunkt, entschiede ein Query-Parameter über die Grösse eines '
  'unumkehrbaren Vorgangs. Ein Fehler nimmt den ganzen Lauf zurück (Sicherungspunkt) und wird als '
  'outcome=error protokolliert; der Laufdatensatz selbst überlebt, weil er VOR dem Ausnahmeblock '
  'entsteht. Rückgabe: {status, run_id, job_key, outcome, items_considered, items_processed, '
  'detail, started_at, finished_at}.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — Die zwei public-Wrapper
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

-- ── run_lead_retention_job: der einzige Weg von aussen an den Job ────────────────────────────────
-- Ausschliesslich an service_role, nicht an authenticated: die Auslösung ist ein Maschinenvorgang.
-- Ein Grant an authenticated machte aus jedem eingeloggten Konto einen möglichen Auslöser, und ab
-- B4-2 hinge daran ein Massenversand.
create function public.run_lead_retention_job(
  p_max_batch integer default 500,
  p_refuse_above integer default 1000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return platform.run_lead_retention(p_max_batch, p_refuse_above);
end;
$$;

comment on function public.run_lead_retention_job(integer, integer) is
  'B4-1: SECURITY-DEFINER-Wrapper um platform.run_lead_retention, service_role-only — der einzige '
  'Weg, den Fristenlauf von aussen auszulösen (Cron-Endpunkt app/api/cron/lead-retention). Enthält '
  'selbst keine Entscheidungslogik. Kein Grant an authenticated: die Auslösung ist ein '
  'Maschinenvorgang, und ab B4-2 hängt daran ein Massenversand.';

-- ── admin_list_job_runs: die Läufe sichtbar machen ───────────────────────────────────────────────
-- Muster wie B1-1/B1-3: SECURITY DEFINER, nur an authenticated, erste Anweisung platform.is_admin(),
-- sonst SQLSTATE 42501. „Kein Zugriff" darf sich nie als „keine Läufe" lesen lassen — ausgerechnet
-- hier wäre die Verwechslung fatal, weil eine leere Liste die Aussage dieses Protokolls IST
-- („der Job läuft nicht").
--
-- `last_success` wird SEPARAT ermittelt und nicht aus `runs` abgeleitet: sonst hinge die Aussage
-- „zuletzt erfolgreich am …" an der Fenstergrösse, und nach p_limit misslungenen Läufen behauptete
-- die Oberfläche „noch nie erfolgreich gelaufen" — die dramatischere Falschaussage von beiden.
create function public.admin_list_job_runs(
  p_job_key text default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_runs         jsonb;
  v_last_success jsonb;
  v_limit        integer := least(greatest(coalesce(p_limit, 20), 1), 200);
begin
  if not platform.is_admin() then
    raise exception 'public.admin_list_job_runs: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.started_at desc), '[]'::jsonb)
    into v_runs
  from (
    select jr.id,
           jr.job_key,
           jr.started_at,
           jr.finished_at,
           jr.outcome,
           jr.items_considered,
           jr.items_processed,
           jr.detail
    from platform.job_runs jr
    where p_job_key is null or jr.job_key = p_job_key
    order by jr.started_at desc
    limit v_limit
  ) r;

  select to_jsonb(r) into v_last_success
  from (
    select jr.id,
           jr.job_key,
           jr.started_at,
           jr.finished_at,
           jr.items_considered,
           jr.items_processed
    from platform.job_runs jr
    where (p_job_key is null or jr.job_key = p_job_key)
      and jr.outcome = 'success'
    order by jr.started_at desc
    limit 1
  ) r;

  return jsonb_build_object('status', 'ok', 'runs', v_runs, 'last_success', v_last_success);
end;
$$;

comment on function public.admin_list_job_runs(text, integer) is
  'B4-1: die letzten Läufe eines Jobs (p_job_key => null: alle), neueste zuerst, plus den zuletzt '
  'ERFOLGREICHEN Lauf als eigenes Feld. Getrennt ermittelt und nicht aus der Liste abgeleitet: '
  'sonst hinge „zuletzt erfolgreich am …" an der Fenstergrösse und behauptete nach p_limit '
  'misslungenen Läufen „noch nie erfolgreich". WIRFT bei fehlender Adminrolle (42501) — eine leere '
  'Liste ist hier eine ECHTE Aussage („der Job läuft nicht") und darf nicht auch fehlenden Zugriff '
  'bedeuten. authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 5 — RLS und Rechte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── DER FRISTENLAUF BEKOMMT KEIN EINZIGES NEUES TABELLEN-GRANT ──────────────────────────────────
-- B1-1 hat service_role bewusst NIRGENDS ein delete gegeben, mit dem Satz: „der Löschjob gehört
-- nicht zu B1-1 und bekommt sein Recht, wenn er gebaut wird". Er ist jetzt gebaut — und die Antwort
-- lautet: er bekommt gar keins. Die Löschung ist ohnehin keine (sie ist ein UPDATE auf denselben
-- Zeilen, B1-1), und der Lauf arbeitet vollständig innerhalb von SECURITY-DEFINER-Funktionen, also
-- unter dem Eigentümer. service_role darf genau eine neue Sache: public.run_lead_retention_job
-- AUFRUFEN. Das ist die kleinste Rechteerweiterung, mit der der Job überhaupt existieren kann.
alter table platform.job_runs enable row level security;

-- Keine Policy und kein Grant — für KEINE Rolle, auch nicht für service_role. Zwei unabhängige
-- Schichten wie bei platform.leads (B1-1): ohne Policy sähe selbst eine Rolle nichts, der jemand
-- später versehentlich ein Tabellen-Grant gäbe. Geschrieben wird ausschliesslich aus
-- platform.run_lead_retention, gelesen ausschliesslich über public.admin_list_job_runs.

-- Die platform-Funktionen sind KEIN öffentlicher Zugriffsweg: PostgreSQL grantet EXECUTE an PUBLIC
-- per Voreinstellung, was hier bei jeder neu angelegten Funktion entzogen wird. (Bei
-- guard_anonymized_lead genügt der bestehende Entzug aus B1-3 — `create or replace` lässt Eigentümer
-- und ACL unangetastet; anonymize_lead dagegen wurde neu ANGELEGT und braucht ihn erneut.)
revoke all on function platform.anonymize_lead(uuid, uuid, boolean) from public;
revoke all on function platform.leads_due_for_anonymization(integer) from public;
revoke all on function platform.run_lead_retention(integer, integer) from public;

-- Die beiden neuen public-Funktionen: Supabases ALTER DEFAULT PRIVILEGES hat ihnen EXECUTE an anon,
-- authenticated UND service_role gegeben (zusätzlich zum PostgreSQL-Default-Grant an PUBLIC). Erst
-- allen entziehen, dann gezielt gewähren.
revoke all on function public.run_lead_retention_job(integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.run_lead_retention_job(integer, integer) to service_role;

revoke all on function public.admin_list_job_runs(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_list_job_runs(text, integer) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 6 — admin_get_lead: die Urheberschaft sichtbar machen
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Ohne diese Zeile bliebe die neue Spalte in der Oberfläche unsichtbar, und die Detailseite zeigte
-- bei jedem Systemlauf weiterhin „durch ein inzwischen gelöschtes Konto" — die falsche Aussage, wegen
-- der TEIL 2 überhaupt existiert. Eine Datenmodell-Korrektur, die den einen Ort nicht erreicht, an
-- dem der Fehler sichtbar war, hat nichts korrigiert.
--
-- `create or replace` (gleiche Signatur) — die Grants aus B1-1 bleiben unangetastet.
create or replace function public.admin_get_lead(p_lead_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lead     jsonb;
  v_consents jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_get_lead: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select to_jsonb(l) into v_lead
  from (
    select ld.id,
           ld.email,
           ld.company,
           ld.contact_name,
           ld.phone,
           ld.status,
           ld.first_source_key,
           (select s.label from platform.lead_sources s where s.key = ld.first_source_key)
             as first_source_label,
           ld.retention_basis,
           ld.last_interaction_at,
           ld.deletion_due_at,
           ld.anonymized_at,
           ld.anonymized_by,
           (select au.email from auth.users au where au.id = ld.anonymized_by)
             as anonymized_by_email,
           -- B4-1: true → die Anonymisierung stammt aus dem Fristenlauf. Die Oberfläche darf aus
           -- anonymized_by = null nicht länger auf ein gelöschtes Konto schliessen.
           ld.anonymized_by_system,
           ld.industry,
           ld.postal_code,
           ld.annual_consumption_kwh,
           ld.metering_type,
           ld.supplier,
           ld.contract_end_date,
           ld.created_at,
           ld.updated_at,
           platform.is_suppressed(ld.email) as is_suppressed,
           (ld.deletion_due_at <= now() and ld.anonymized_at is null) as deletion_due
    from platform.leads ld
    where ld.id = p_lead_id
  ) l;

  if v_lead is null then
    -- Fachlicher Zustand (veralteter Link), kein Autorisierungsfehler → Status, keine Exception.
    return jsonb_build_object('status', 'not_found');
  end if;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.granted_at desc), '[]'::jsonb)
    into v_consents
  from (
    select cs.id,
           ct.purpose,
           cs.status,
           platform.consent_effective_status(cs.status, cs.token_expires_at) as effective_status,
           cs.source_key,
           (select s.label from platform.lead_sources s where s.key = cs.source_key)
             as source_label,
           cs.granted_at,
           cs.confirmed_at,
           cs.withdrawn_at,
           cs.source_ip,
           cs.user_agent,
           ct.version    as consent_text_version,
           ct.locale     as consent_text_locale,
           ct.body       as consent_text_body,
           platform.purpose_requires_double_opt_in(ct.purpose) as requires_double_opt_in
    from platform.consents cs
    join platform.consent_texts ct on ct.id = cs.consent_text_id
    where cs.lead_id = p_lead_id
  ) c;

  return jsonb_build_object('status', 'ok', 'lead', v_lead, 'consents', v_consents);
end;
$$;

comment on function public.admin_get_lead(uuid) is
  'B1-1, erweitert in B1-3, B3-1 und B4-1: ein Lead samt allen Einwilligungen — INKLUSIVE des '
  'jeweils angezeigten Textkörpers und seiner Version/Sprache (ohne den Wortlaut wäre der Nachweis '
  'keiner: die Person hat einen Satz gelesen, keinen Zweckschlüssel), effective_status je '
  'Einwilligung, anonymized_by samt E-Mail des Kontos, seit B4-1 zusätzlich anonymized_by_system '
  '(true = Fristenlauf; ohne dieses Feld läse die Oberfläche jeden Systemlauf als „inzwischen '
  'gelöschtes Konto") sowie den sechs Segmentierungsmerkmalen aus B3-1. token_hash/token_expires_at '
  'fahren bewusst nicht mit. WIRFT bei fehlender Adminrolle (42501); ein unbekannter Lead ist ein '
  'fachlicher Zustand ({status: not_found}). authenticated-only.';
