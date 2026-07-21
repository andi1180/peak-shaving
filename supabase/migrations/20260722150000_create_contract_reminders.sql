-- B4-2 — Vertragsablauf-Erinnerung: Versandprotokoll, Auswahl und Beanspruchung
-- (Fahrplan_2026.md, Abschnitt B4).
--
-- B4-1 hat die Zeitsteuerung gebaut und dabei bewusst eine Aufgabe gewählt, die KEINEN realen
-- Menschen erreichen kann. Mit dieser Migration endet das: hier entsteht die Grundlage für den
-- ERSTEN automatisierten E-Mail-Versand an reale Personen.
--
-- ── WORIN SICH DAS VON B4-1 UNTERSCHEIDET, UND WARUM DAS DIE BAUFORM ÄNDERT ──────────────────────
-- Der Fristenlauf ist vollständig in der Datenbank ausführbar: Auswahl, Wirkung und Protokoll sind
-- ein einziger SQL-Vorgang, den eine Transaktion im Fehlerfall komplett zurücknimmt. Deshalb gibt es
-- dort `platform.run_lead_retention` als EINE Funktion, und der Endpunkt ist reiner Auslöser.
--
-- Hier ist die Wirkung ein Aufruf an einen FREMDEN Dienst (Resend). Der lässt sich nicht
-- zurückrollen: eine versendete Mail ist versendet, auch wenn die Transaktion danach scheitert. Die
-- Ausführung liegt deshalb notwendig ausserhalb der Datenbank, und die Datenbank liefert stattdessen
-- die Bausteine, aus denen der Endpunkt einen nachvollziehbaren Lauf zusammensetzt:
-- Lauf beginnen → beanspruchen → (senden) → Ergebnis festhalten → Lauf abschliessen.
--
-- `platform.run_contract_reminders` gibt es aus genau diesem Grund NICHT. Eine solche Funktion
-- könnte den wirksamen Schritt nicht enthalten und wäre damit eine Hülle, die Vollständigkeit
-- vortäuscht.
--
-- ── WAS TROTZDEM IN DER DATENBANK BLEIBT ─────────────────────────────────────────────────────────
-- Die Frage „darf diese Person angeschrieben werden" (bestätigte Einwilligung, keine Sperre) steht
-- vollständig in der AUSWAHL, nicht im Anwendungscode. Eine Prüfung im Anwendungscode kann
-- übersprungen werden — versehentlich beim Umbau, absichtlich durch einen zweiten Aufrufer. Eine
-- Prüfung in der Auswahl kann das nicht: was sie nicht liefert, kann nicht angeschrieben werden.
--
-- NICHT hier: gefilterte Sicht, Export, Massenaussendung und das kampagnenbezogene Zustellprotokoll
-- (B2), der Betroffenheits-Check (B3-3), Bearbeitbarkeit der Stammdaten (B2), `tenant_id` (B13).
--
-- ── KONVENTIONEN (exakt B1-1/B1-2/B1-3/B3-1/B4-1) ───────────────────────────────────────────────
-- Alles Fachliche in `platform` (nicht über die REST-API exponiert), Zugriff von aussen
-- ausschliesslich über SECURITY-DEFINER-Wrapper im `public`-Schema, alle Funktionen mit
-- `SET search_path = ''` und vollqualifizierten Objektnamen, erst `revoke all … from public, anon,
-- authenticated, service_role`, dann gezielt grants. `anon` bekommt NIRGENDS etwas.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — platform.contract_reminders: das Versandprotokoll je Vertragsende
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── DER ZUSAMMENGESETZTE PRIMÄRSCHLÜSSEL IST DIE DOPPELVERSAND-SPERRE ────────────────────────────
-- Nicht eine Abfrage im Anwendungscode („hat der schon eine bekommen?"), sondern der Schlüssel
-- selbst: zwei gleichzeitige Läufe, ein wiederholter Aufruf, ein doppelt ausgelöster Cron — in jedem
-- Fall gewinnt genau einer, und der zweite bekommt eine Ablehnung von der Datenbank. Eine Prüfung im
-- Anwendungscode hätte zwischen „nachsehen" und „einfügen" ein Zeitfenster, und genau in diesem
-- Fenster entstünde der Doppelversand, den sie verhindern soll.
--
-- ── WARUM DIE KÖRNUNG (lead_id, contract_end_date) UND NICHT (lead_id) IST ───────────────────────
-- Korrigiert die Person später ihr Vertragsende — weil sie sich vertippt hat, verlängert oder
-- gewechselt hat —, entsteht ein ANDERER Schlüssel, und eine erneute Erinnerung ist richtig, nicht
-- ein Duplikat. Sie hat um eine Erinnerung zu einem Vertragsende gebeten, und das ist jetzt ein
-- anderes. Ein Schlüssel allein auf `lead_id` machte die Erinnerung zu einem einmaligen Ereignis je
-- Person und liesse jede Korrektur ins Leere laufen — still, und erst Monate später bemerkbar.
--
-- ── DIES IST NICHT DAS ZUSTELLPROTOKOLL AUS B2 ──────────────────────────────────────────────────
-- Jenes protokolliert KAMPAGNEN samt Rückläufern und Beschwerden; es beantwortet „wie lief die
-- Aussendung vom 12. November". Diese Tabelle beantwortet genau eine andere Frage: „wurde für DIESES
-- Vertragsende bereits erinnert". Zusammengelegt bekäme man eine Tabelle, in der die
-- Doppelversand-Sperre eine Zeile unter Millionen Kampagnenzeilen wäre — und die Sperre ist der
-- einzige Grund, warum es diese Tabelle gibt.
create table platform.contract_reminders (
  lead_id uuid not null references platform.leads(id) on delete cascade,
  contract_end_date date not null,
  -- `clock_timestamp()` und nicht `now()`: derselbe Grund wie bei platform.job_runs (B4-1) — `now()`
  -- ist die TRANSAKTIONSzeit und wäre bei mehreren Beanspruchungen desselben Laufs auf die
  -- Mikrosekunde identisch. Hier interessiert der reale Zeitpunkt des Versandversuchs.
  attempted_at timestamptz not null default clock_timestamp(),
  -- NULL heisst: beansprucht, aber kein bestätigter Versand. Entweder ist der Versand
  -- fehlgeschlagen (dann steht der Grund in `error`) oder der Lauf ist zwischen Beanspruchung und
  -- Rückmeldung gestorben (dann ist auch `error` leer). Beides ist ein Befund, kein Normalzustand.
  delivered_at timestamptz,
  error text,
  primary key (lead_id, contract_end_date)
);

comment on table platform.contract_reminders is
  'Versandprotokoll der Vertragsablauf-Erinnerung (B4-2), eine Zeile je (Lead, Vertragsende). Der '
  'zusammengesetzte PRIMÄRSCHLÜSSEL IST die Doppelversand-Sperre — sie wird von der Datenbank '
  'durchgesetzt, nicht vom Anwendungscode geprüft (eine Prüfung im Code hätte zwischen Nachsehen '
  'und Einfügen ein Zeitfenster, und genau darin entstünde der Doppelversand). Korrigiert die '
  'Person ihr Vertragsende, entsteht ein anderer Schlüssel und eine erneute Erinnerung ist richtig, '
  'nicht ein Duplikat — genau das ist die passende Körnung. NICHT das kampagnenbezogene '
  'Zustellprotokoll aus B2 (Rückläufer/Beschwerden je Aussendung); nicht zusammenlegen. Kein Grant '
  'für irgendeine Rolle: geschrieben ausschliesslich über public.claim_contract_reminder / '
  'public.record_contract_reminder_result, gelesen über public.admin_get_lead und '
  'public.admin_contract_reminder_health.';

comment on column platform.contract_reminders.attempted_at is
  'Zeitpunkt der BEANSPRUCHUNG (nicht der Zustellung). Die Zeile entsteht VOR dem Versand — bricht '
  'der Vorgang danach ab, bleibt sie ohne delivered_at zurück: sichtbar, prüfbar, keine zweite Mail.';

comment on column platform.contract_reminders.delivered_at is
  'Gesetzt, wenn Resend die Mail angenommen hat. NULL = beansprucht, aber nicht bestätigt versendet '
  '(Fehlschlag mit Grund in error, oder Abbruch zwischen Beanspruchung und Rückmeldung). Solche '
  'Zeilen werden NICHT automatisch wiederholt — automatische Wiederholung von E-Mail-Versand '
  'erzeugt Schleifen. Sie sind ein Admin-Befund (public.admin_contract_reminder_health).';

comment on column platform.contract_reminders.error is
  'Klartextgrund eines fehlgeschlagenen Versands. Enthält bewusst keine Empfängeradresse — ein '
  'Fehlertext ist kein zulässiger zweiter Speicherort für Personenbezug (B1-2).';

-- ── job_key: der zweite Schlüssel ────────────────────────────────────────────────────────────────
-- B4-1 hat den CHECK ausdrücklich als additiv erweiterbar angelegt („B4-2 hängt seinen Schlüssel
-- additiv an"). Genau das passiert hier — DROP + ADD, weil ein CHECK sich nicht ergänzen lässt.
alter table platform.job_runs drop constraint job_runs_job_key_check;
alter table platform.job_runs
  add constraint job_runs_job_key_check
  check (job_key in ('lead_retention', 'contract_reminder'));

comment on column platform.job_runs.job_key is
  'Welcher Job. CHECK statt Enum (Muster wie leads.status): kurze feste Liste, jeder Wert hat im '
  'Anwendungscode eigene Bedeutung. Seit B4-2 zwei: ''lead_retention'' (Fristenlauf, 03:15 UTC) und '
  '''contract_reminder'' (Vertragsablauf-Erinnerung, 06:40 UTC).';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — Zweckbindung nachziehen: eine Kopie des Vertragsendes darf seinen Zweck nicht überleben
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- B3-1 hat durchgesetzt, dass Versorger und Vertragsende beim Widerruf der Erinnerung verschwinden.
-- Diese Tabelle trägt das Vertragsende ein ZWEITES Mal — als Teil ihres Primärschlüssels. Ohne die
-- beiden folgenden Erweiterungen bliebe nach einem Widerruf (oder nach einer Anonymisierung) eine
-- Zeile stehen, die das Datum weiterhin enthält. Die Zweckbindung wäre dann an einer Stelle
-- durchgesetzt und an der anderen behauptet.

-- ── clear_contract_data_on_withdrawal (B3-1) ─────────────────────────────────────────────────────
-- Die Erinnerungszeilen gehen beim Widerruf MIT. Das hat neben der Zweckbindung eine zweite,
-- erwünschte Folge: erteilt dieselbe Person später erneut eine Einwilligung und trägt ihr
-- Vertragsende wieder ein, ist der Schlüssel frei — sie bekommt zu Recht eine neue Erinnerung, statt
-- durch eine Zeile aus einem widerrufenen Vorgang dauerhaft gesperrt zu sein.
--
-- `create or replace` mit unveränderter Signatur — der Trigger consents_clear_contract_data (B3-1)
-- bleibt unangetastet.
create or replace function platform.clear_contract_data_on_withdrawal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purpose platform.consent_purpose;
begin
  -- Der Zweck kommt über den verknüpften Text — B1-1: es gibt keine zweite, denormalisierte
  -- Zweck-Angabe an der Einwilligung, die davon abweichen könnte.
  select ct.purpose into v_purpose
    from platform.consent_texts ct
   where ct.id = new.consent_text_id;

  if v_purpose is distinct from 'contract_expiry_reminder' then
    return null;
  end if;

  -- B4-2: ZUERST das Versandprotokoll, DANN die Felder am Lead. Die Reihenfolge ist ohne fachliche
  -- Folge (beide Vorgänge sind unabhängig), aber in dieser Richtung liest sich die Regel wie sie
  -- gemeint ist: erst die Spur des Zwecks, dann die Daten des Zwecks.
  delete from platform.contract_reminders cr
   where cr.lead_id = new.lead_id;

  -- Die zusätzliche Bedingung ist kein Mikro-Optimieren: sie verhindert einen UPDATE auf einen
  -- Lead, an dem sich gar nichts ändert. Bei einem bereits ANONYMISIERTEN Lead (dort sind beide
  -- Felder längst null) feuert dadurch überhaupt kein Schreibvorgang und der B1-3-Guard
  -- guard_anonymized_lead wird nicht einmal befragt.
  update platform.leads l
     set supplier          = null,
         contract_end_date = null
   where l.id = new.lead_id
     and (l.supplier is not null or l.contract_end_date is not null);

  return null;
end;
$$;

comment on function platform.clear_contract_data_on_withdrawal() is
  'AFTER UPDATE auf consents: wechselt eine Einwilligung mit purpose=contract_expiry_reminder auf '
  'status=withdrawn, werden supplier und contract_end_date des Leads genullt UND (seit B4-2) seine '
  'Zeilen in platform.contract_reminders gelöscht. Versorger und Vertragsende werden ausschliesslich '
  'für diesen Zweck erhoben — fällt der Zweck weg, fällt die Grundlage für die Daten weg, und zwar '
  'für JEDE Kopie: das Versandprotokoll trägt das Vertragsende im Primärschlüssel. Erneute '
  'Einwilligung später erzeugt dadurch zu Recht eine neue Erinnerung. BEWUSST NICHT bei '
  'status=expired: ein verfallener Token ist ein technischer Zustand, kein Widerruf. Andere Zwecke '
  'lassen beides unberührt. SECURITY DEFINER wie touch_lead_on_consent (B1-1).';

-- ── anonymize_lead (B1-1/B3-1/B4-1) ──────────────────────────────────────────────────────────────
-- Die Anonymisierung nullt `contract_end_date` seit B3-1. Ohne die neue Zeile bliebe dasselbe Datum
-- im Versandprotokoll stehen — verknüpft mit der lead_id, also genau der Bezug, den die
-- Anonymisierung auflösen soll.
--
-- `create or replace` mit UNVERÄNDERTER Signatur (uuid, uuid, boolean) — anders als in B4-1 ist kein
-- DROP nötig, und die dortigen Grants/Revokes bleiben unangetastet.
create or replace function platform.anonymize_lead(
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

  -- B4-2: das Versandprotokoll trägt das Vertragsende im Primärschlüssel. Es unten mit `null` zu
  -- überschreiben ist unmöglich (Primärschlüssel), also wird die Zeile entfernt — sonst überlebte
  -- ausgerechnet das lokalisierende Merkmal, das die Anonymisierung am Lead gerade löscht. Der
  -- Nachweis, dass korrekt gearbeitet wurde, hängt daran nicht: er steht in den Einwilligungszeilen,
  -- die bewusst bestehen bleiben (B1-1).
  delete from platform.contract_reminders cr
   where cr.lead_id = p_lead_id;

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
  'zusätzlich postal_code/supplier/contract_end_date → null, seit B4-2 werden die Zeilen in '
  'platform.contract_reminders GELÖSCHT (das Vertragsende steht dort im Primärschlüssel und liesse '
  'sich nicht nullen), status=anonymized, anonymized_at gesetzt. BLEIBEN: die Einwilligungszeilen '
  'selbst (Zweck, Textfassung, Zeitpunkte — ohne Identitätsmerkmale kein Personenbezug mehr, aber '
  'weiterhin der Beleg, dass korrekt gearbeitet wurde), der Sperrlisten-Eintrag (er MUSS die '
  'Löschung überleben, B1-1) sowie industry/annual_consumption_kwh/metering_type. Die Trennlinie '
  'verläuft entlang „lokalisierend" gegen „grob einordnend". SEIT B4-1: p_by_system => true '
  'kennzeichnet den Fristenlauf als Urheber (anonymized_by null, anonymized_by_system true) und '
  'WIRFT, wenn zugleich ein p_actor mitkommt. Bestehende Zwei-Argument-Aufrufe verhalten sich '
  'unverändert. Idempotent: ein bereits anonymisierter Lead liefert Erfolg ohne zweite Wirkung, und '
  'die Urheberschaft bleibt beim ERSTEN. {status: ok|not_found}, outcome: anonymized|'
  'already_anonymized.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — Vorlaufzeit und Auswahl
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

-- ── contract_reminder_lead_days: die Vorlaufzeit steht an EINER Stelle ───────────────────────────
-- Muster exakt wie platform.retention_months (B1-1): eine Zahl, die fachlich justiert werden kann,
-- gehört in eine benannte Funktion und nicht verstreut in Abfragen und Anwendungscode. 56 Tage sind
-- acht Wochen — früh genug für eine Kündigungsfrist und einen Anbieterwechsel, spät genug, dass die
-- Erinnerung nicht als beliebige Werbung durchgeht.
--
-- Eine spätere Änderung bleibt dadurch Konfiguration: eine Zeile in einer Migration, und sowohl die
-- Auswahl als auch die Angabe auf der Landingpage („acht Wochen vorher") beziehen sich auf dieselbe
-- Quelle. (Die Landingpage nennt die Zahl als Text — sie steht dort im Nachrichtenkatalog; wer die
-- Vorlaufzeit ändert, ändert beide Stellen, und der Kommentar hier sagt warum.)
create function platform.contract_reminder_lead_days()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 56;
$$;

comment on function platform.contract_reminder_lead_days() is
  'Vorlaufzeit der Vertragsablauf-Erinnerung in Tagen: 56 (acht Wochen). Steht NUR hier — eine '
  'spätere Justierung bleibt damit Konfiguration und wird kein Umbau (Muster wie '
  'platform.retention_months, B1-1). Die Landingpage nennt dieselbe Zahl als Text.';

-- ── leads_due_for_contract_reminder: EINE Definition von „fällig" ────────────────────────────────
-- Dieselbe Funktion beantwortet „wie viele sind fällig" (p_limit => null) und „welche bearbeite ich
-- jetzt" (p_limit => Stapelgrösse) — und, weil `claim_contract_reminder` sie ebenfalls befragt, auch
-- „darf ich diesen einen jetzt anschreiben". Drei Antworten aus EINER Regel. Zwei getrennte
-- Formulierungen wären zwei Definitionen von fällig, und die Abweichung fiele erst auf, wenn die
-- Mengenprüfung gegen eine andere Menge läuft als der Versand.
--
-- ── DIE BEIDEN VERSANDPRÜFUNGEN STEHEN HIER UND NICHT IM ANWENDUNGSCODE ─────────────────────────
-- `has_confirmed_consent` (B1-1: pending ist ausdrücklich false — unbestätigt ist rechtlich wertlos)
-- und `is_suppressed` (B1-1: eine Abmeldung überlebt den Lead und steht deshalb NICHT an der
-- Einwilligung). Eine Prüfung im Anwendungscode kann übersprungen werden — beim Umbau, durch einen
-- zweiten Aufrufer, durch ein vergessenes `if`. Eine Prüfung in der Auswahl kann das nicht: was sie
-- nicht liefert, kann nicht angeschrieben werden.
--
-- ── WARUM „KLEINER ODER GLEICH" UND NICHT „GENAU ACHT WOCHEN VORHER" ────────────────────────────
-- Trägt jemand ein Vertragsende ein, das nur noch drei Wochen entfernt ist, hätte eine Prüfung auf
-- den exakten Stichtag ihn NIE erwischt: der Tag, an dem er acht Wochen entfernt war, liegt in der
-- Vergangenheit. Er bekäme also gar keine Erinnerung — bei einem Menschen, der sie in genau diesem
-- Moment am dringendsten braucht. Mit „kleiner oder gleich" erhält er sie sofort. Dass daraus keine
-- tägliche Wiederholung wird, verhindert der Primärschlüssel und nicht ein zweiter Datumsvergleich.
--
-- `contract_end_date > current_date` (ZUKUNFT, nicht heute): an einem bereits abgelaufenen Vertrag
-- ändert eine Erinnerung nichts mehr; sie wäre eine Mail über einen Vorgang, der vorbei ist.
create function platform.leads_due_for_contract_reminder(p_limit integer)
returns table (lead_id uuid, email text, supplier text, contract_end_date date)
language sql
stable
set search_path = ''
as $$
  select l.id, l.email, l.supplier, l.contract_end_date
  from platform.leads l
  where l.anonymized_at is null
    and l.contract_end_date is not null
    and l.contract_end_date > current_date
    and l.contract_end_date - platform.contract_reminder_lead_days() <= current_date
    and not exists (
      select 1
      from platform.contract_reminders cr
      where cr.lead_id = l.id
        and cr.contract_end_date = l.contract_end_date
    )
    and platform.has_confirmed_consent(l.id, 'contract_expiry_reminder')
    and not platform.is_suppressed(l.email)
  -- Älteste Vertragsenden zuerst, Primärschlüssel als Tie-Break: ohne ihn wäre die Reihenfolge bei
  -- gleichem Datum unbestimmt, und ein abgeschnittener Stapel bearbeitete beim nächsten Lauf
  -- womöglich wieder dieselben Zeilen, während andere nie an die Reihe kämen (B4-1).
  order by l.contract_end_date asc, l.id asc
  limit p_limit;
$$;

comment on function platform.leads_due_for_contract_reminder(integer) is
  'Die für eine Vertragsablauf-Erinnerung fälligen Leads: Vertragsende in der ZUKUNFT, Vorlaufzeit '
  'erreicht (contract_end_date - contract_reminder_lead_days() <= current_date, bewusst „kleiner '
  'oder gleich" — ein knapp bevorstehendes Vertragsende soll SOFORT erinnert werden statt nie), '
  'noch keine Zeile in contract_reminders für dieses Paar, nicht anonymisiert, BESTÄTIGTE '
  'Einwilligung für contract_expiry_reminder, Adresse nicht gesperrt. Die beiden Versandprüfungen '
  'stehen bewusst HIER und nicht im Anwendungscode: eine Prüfung im Code kann übersprungen werden, '
  'eine in der Auswahl nicht. p_limit => null bedeutet unbegrenzt (SQL-Semantik von LIMIT NULL) — '
  'dieselbe Funktion beantwortet damit „wie viele sind fällig", „welche bearbeite ich jetzt" und '
  '(über claim_contract_reminder) „darf ich diesen einen jetzt anschreiben". Kein öffentlicher '
  'Zugriffsweg: aufgerufen nur aus den public-Wrappern dieses Bauabschnitts.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — Die public-Wrapper: die Bausteine EINES Laufs
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── WARUM ES HIER VIER SIND UND BEI B4-1 EINER WAR ──────────────────────────────────────────────
-- Nicht aus Geschmack: der wirksame Schritt (der Versand) liegt ausserhalb der Datenbank und kann
-- deshalb nicht Teil derselben Funktion sein. Der Lauf zerfällt dadurch zwangsläufig in Abschnitte,
-- und jeder Abschnitt braucht seinen eigenen, eng geschnittenen Zugang. Die Alternative — ein
-- einziger Wrapper, der irgendwie „alles macht" — könnte den Versand nicht enthalten und wäre eine
-- Hülle, die Vollständigkeit vortäuscht.
--
-- ALLE VIER ausschliesslich an service_role. Kein Grant an authenticated: der Auslöser ist ein
-- Maschinenvorgang, und daran hängt ab jetzt ein Versand an reale Personen.

-- ── start_contract_reminder_run ──────────────────────────────────────────────────────────────────
-- Legt den Laufdatensatz an UND liefert in derselben Antwort die Zahl der Fälligen sowie den zu
-- bearbeitenden Stapel.
--
-- ── WARUM BEIDES IN EINEM AUFRUF ────────────────────────────────────────────────────────────────
-- Der Endpunkt entscheidet über die Mengenobergrenze (s. Kopfkommentar). Bekäme er die GESAMTZAHL
-- aus einem Aufruf und den STAPEL aus einem zweiten, prüfte er den Schwellwert gegen eine andere
-- Menge, als er anschliessend abarbeitet — dazwischen kann ein Lead hinzukommen oder wegfallen. In
-- einem Aufruf stammen beide aus derselben Momentaufnahme.
--
-- `items_considered` wird SOFORT gespeichert und nicht erst beim Abschluss (anders als B4-1): die
-- Zahl ist hier schon vor der Arbeit bekannt, und stirbt der Lauf mittendrin, steht wenigstens im
-- Protokoll, wie viele er vor sich hatte.
create function public.start_contract_reminder_run(p_max_batch integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id      uuid;
  v_started_at  timestamptz;
  v_considered  integer;
  v_due         jsonb;
  v_max_batch   integer := greatest(coalesce(p_max_batch, 200), 0);
begin
  select count(*)::integer into v_considered
  from platform.leads_due_for_contract_reminder(null);

  select coalesce(
           jsonb_agg(to_jsonb(d) order by d.contract_end_date asc, d.lead_id asc),
           '[]'::jsonb
         )
    into v_due
  from platform.leads_due_for_contract_reminder(v_max_batch) d;

  -- Der Laufdatensatz entsteht, BEVOR der Endpunkt irgendetwas versendet — dieselbe Regel wie in
  -- B4-1: ein Lauf, der mitten in der Arbeit stirbt, hinterlässt dann eine Zeile mit
  -- `finished_at is null` (sichtbar abgebrochen) und nicht gar nichts.
  insert into platform.job_runs (job_key, items_considered)
  values ('contract_reminder', v_considered)
  returning id, started_at into v_run_id, v_started_at;

  return jsonb_build_object(
    'status',           'ok',
    'run_id',           v_run_id,
    'started_at',       v_started_at,
    'items_considered', v_considered,
    'due',              v_due
  );
end;
$$;

comment on function public.start_contract_reminder_run(integer) is
  'B4-2: beginnt einen Lauf der Vertragsablauf-Erinnerung. Legt die job_runs-Zeile (job_key='
  '''contract_reminder'') mit items_considered an und liefert in DERSELBEN Antwort die Gesamtzahl '
  'der Fälligen und den Stapel (bis p_max_batch, Vorgabe 200) — beides aus einer Momentaufnahme, '
  'damit der Endpunkt seine Mengenobergrenze nicht gegen eine andere Menge prüft, als er '
  'abarbeitet. Enthält KEINE Mengenentscheidung: die liegt im Endpunkt, weil der wirksame Schritt '
  '(der Versand) ausserhalb der Datenbank liegt. service_role-only.';

-- ── claim_contract_reminder ──────────────────────────────────────────────────────────────────────
-- ── ERST BEANSPRUCHEN, DANN SENDEN, DANN ERGEBNIS FESTHALTEN ────────────────────────────────────
-- Diese Reihenfolge ist die eigentliche Aussage dieser Funktion, und sie ist nicht umkehrbar:
--
--   Bricht der Vorgang zwischen BEANSPRUCHUNG und VERSAND ab (Prozesstod, Zeitlimit, Netzfehler),
--   bleibt eine Zeile ohne `delivered_at` zurück. Sichtbar, prüfbar — und vor allem: keine zweite
--   Mail, weil der Schlüssel belegt ist.
--
--   In der umgekehrten Reihenfolge (senden, dann protokollieren) entstünde im GLEICHEN Fall ein
--   stiller Doppelversand: die Mail ist raus, die Zeile fehlt, der nächste Lauf hält den Fall für
--   unerledigt und sendet erneut. Und zwar täglich.
--
-- Die Abwägung ist asymmetrisch und deshalb eindeutig: eine ausgebliebene Erinnerung ist ärgerlich
-- und nachholbar; eine doppelt oder mehrfach versendete Mail ist nicht zurückholbar und beschädigt
-- die Zustellreputation der Absenderdomain — an der im November die 48-Stunden-Aktivierung hängt.
--
-- ZEILEN OHNE `delivered_at` WERDEN NICHT AUTOMATISCH WIEDERHOLT. Automatische Wiederholung von
-- E-Mail-Versand erzeugt Schleifen: scheitert der Versand aus einem Grund, der beim nächsten Lauf
-- genauso vorliegt, wiederholt sich der Versuch täglich — und im schlechteren Fall kommen die Mails
-- durch, nur die Rückmeldung nicht. Solche Zeilen sind ein ADMIN-BEFUND
-- (public.admin_contract_reminder_health), keine Aufgabe für den Job.
create function public.claim_contract_reminder(
  p_lead_id uuid,
  p_contract_end_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_due      record;
  v_existing record;
begin
  if p_lead_id is null or p_contract_end_date is null then
    return jsonb_build_object('status', 'ok', 'outcome', 'not_eligible');
  end if;

  /*
   * Die Fälligkeit wird über DIESELBE Funktion geprüft, die den Stapel geliefert hat — nicht über
   * eine hier wiederholte Bedingung. Zwischen Auswahl und Beanspruchung können Sekunden liegen, und
   * in diesen Sekunden kann die Einwilligung widerrufen oder die Adresse gesperrt worden sein. Ein
   * eigener, zweiter Ausdruck an dieser Stelle wäre eine zweite Definition von „fällig" und könnte
   * unbemerkt lockerer sein als die erste.
   *
   * `p_limit => null` durchsucht die volle Menge der Fälligen. Das ist bewusst in Kauf genommen:
   * diese Menge ist per Konstruktion genau der kleine Bestand, den der Lauf ohnehin abarbeitet.
   */
  select d.email, d.supplier, d.contract_end_date
    into v_due
  from platform.leads_due_for_contract_reminder(null) d
  where d.lead_id = p_lead_id
    and d.contract_end_date = p_contract_end_date;

  if not found then
    -- Zwei sehr verschiedene Gründe, aus denen die Auswahl den Fall nicht liefert — sie müssen
    -- unterscheidbar bleiben: eine bestehende Zeile heisst „schon erledigt", alles andere heisst
    -- „darf nicht (mehr) angeschrieben werden".
    select cr.attempted_at, cr.delivered_at, cr.error
      into v_existing
    from platform.contract_reminders cr
    where cr.lead_id = p_lead_id
      and cr.contract_end_date = p_contract_end_date;

    if found then
      return jsonb_build_object(
        'status', 'ok',
        'outcome', 'already_claimed',
        'attempted_at', v_existing.attempted_at,
        'delivered_at', v_existing.delivered_at,
        'error', v_existing.error
      );
    end if;

    return jsonb_build_object('status', 'ok', 'outcome', 'not_eligible');
  end if;

  /*
   * `on conflict do nothing` ist die Absicherung gegen ZEITGLEICHE Läufe: die Auswahl oben schliesst
   * bereits beanspruchte Fälle aus, ein Konflikt kann also nur entstehen, wenn ein zweiter Lauf
   * denselben Fall im selben Moment beansprucht hat. Genau dann gewinnt einer, und der andere sendet
   * NICHT — durchgesetzt von der Datenbank, nicht von einer Abfrage im Anwendungscode.
   *
   * Ein bestehender Datensatz wird dabei ausdrücklich NICHT überschrieben: attempted_at bleibt der
   * ERSTE Versuch (dasselbe Prinzip wie confirmed_at in B1-2 und anonymized_at in B1-3 — ein
   * nachgeschriebener Zeitpunkt wäre eine Fälschung).
   */
  insert into platform.contract_reminders (lead_id, contract_end_date)
  values (p_lead_id, p_contract_end_date)
  on conflict (lead_id, contract_end_date) do nothing;

  if not found then
    return jsonb_build_object('status', 'ok', 'outcome', 'already_claimed');
  end if;

  return jsonb_build_object(
    'status',            'ok',
    'outcome',           'claimed',
    'lead_id',           p_lead_id,
    'email',             v_due.email,
    'supplier',          v_due.supplier,
    'contract_end_date', v_due.contract_end_date
  );
end;
$$;

comment on function public.claim_contract_reminder(uuid, date) is
  'B4-2: beansprucht (Lead, Vertragsende) für den Versand und liefert die dafür nötigen Angaben '
  '(E-Mail, Versorger, Vertragsende). REIHENFOLGE: erst beanspruchen, dann senden, dann '
  'record_contract_reminder_result — bricht der Vorgang dazwischen ab, bleibt eine Zeile ohne '
  'delivered_at zurück (sichtbar, prüfbar, KEINE zweite Mail); die umgekehrte Reihenfolge erzeugte '
  'im selben Fall einen stillen, sich täglich wiederholenden Doppelversand. Die Fälligkeit wird über '
  'leads_due_for_contract_reminder geprüft (eine einzige Definition von „fällig", inkl. bestätigter '
  'Einwilligung und Sperrliste) — nicht über eine hier wiederholte Bedingung. Eine bestehende Zeile '
  'wird NIE überschrieben: outcome=already_claimed, attempted_at bleibt der erste Versuch. '
  'outcome: claimed | already_claimed | not_eligible. service_role-only.';

-- ── record_contract_reminder_result ──────────────────────────────────────────────────────────────
-- Hält fest, wie der Versand ausging. Zwei Zustände, kein dritter: `delivered_at` gesetzt (der
-- Dienst hat die Mail angenommen) oder `error` gesetzt (er hat sie abgelehnt oder war nicht
-- erreichbar). Beides zugleich wäre keine genauere Angabe, sondern ein Widerspruch — deshalb löscht
-- ein Fehler ein etwaiges delivered_at und umgekehrt.
create function public.record_contract_reminder_result(
  p_lead_id uuid,
  p_contract_end_date date,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update platform.contract_reminders cr
     set delivered_at = case when p_error is null then clock_timestamp() else null end,
         error        = p_error
   where cr.lead_id = p_lead_id
     and cr.contract_end_date = p_contract_end_date;

  if not found then
    -- Kein fachlicher Normalfall: es wird nur festgehalten, was zuvor beansprucht wurde. Ein
    -- Statuswert statt einer Ausnahme, damit ein einzelner verirrter Aufruf keinen Lauf abbricht.
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'outcome', case when p_error is null then 'delivered' else 'failed' end
  );
end;
$$;

comment on function public.record_contract_reminder_result(uuid, date, text) is
  'B4-2: hält das Ergebnis eines Versandversuchs fest — p_error => null setzt delivered_at, sonst '
  'wird error gesetzt und delivered_at geleert (beides zugleich wäre ein Widerspruch, keine '
  'genauere Angabe). Setzt voraus, dass claim_contract_reminder die Zeile bereits angelegt hat; '
  'ohne Zeile {status: not_found} statt einer Ausnahme, damit ein verirrter Aufruf keinen Lauf '
  'abbricht. service_role-only.';

-- ── finish_contract_reminder_run ─────────────────────────────────────────────────────────────────
-- Schliesst GENAU den eigenen Lauf ab. Die Bedingung `job_key = 'contract_reminder'` ist kein
-- Zierrat: ohne sie könnte ein Fehler im Anwendungscode (eine falsche run_id, ein verwechselter
-- Wert) den Laufdatensatz des FRISTENLAUFS überschreiben — und damit ausgerechnet das Protokoll
-- verfälschen, das beweisen soll, ob Löschfristen durchgesetzt werden.
create function public.finish_contract_reminder_run(
  p_run_id uuid,
  p_outcome text,
  p_items_processed integer default 0,
  p_detail text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_finished_at timestamptz;
begin
  update platform.job_runs jr
     -- `clock_timestamp()` und NICHT `now()`: der Lauf besteht aus mehreren Aufrufen; `now()` wäre
     -- je Aufruf die jeweilige Transaktionszeit und träfe zufällig ungefähr zu — die Dauer eines
     -- Laufs ist aber genau das, was man ansieht, wenn er in ein Zeitlimit rennt (B4-1).
     set finished_at     = clock_timestamp(),
         outcome         = p_outcome,
         items_processed = coalesce(p_items_processed, 0),
         detail          = p_detail
   where jr.id = p_run_id
     and jr.job_key = 'contract_reminder'
  returning jr.finished_at into v_finished_at;

  if v_finished_at is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object('status', 'ok', 'finished_at', v_finished_at);
end;
$$;

comment on function public.finish_contract_reminder_run(uuid, text, integer, text) is
  'B4-2: schliesst den Laufdatensatz der Vertragsablauf-Erinnerung ab (finished_at, outcome, '
  'items_processed, detail). Fasst AUSSCHLIESSLICH Zeilen mit job_key=''contract_reminder'' an — '
  'eine verwechselte run_id soll nicht das Protokoll des Fristenlaufs überschreiben, ausgerechnet '
  'jenes, das belegt, ob Löschfristen durchgesetzt werden. service_role-only.';

-- ── admin_contract_reminder_health: der Befund, der sonst niemandem auffällt ─────────────────────
-- Beansprucht, aber nie bestätigt versendet — das ist der einzige Zustand dieses Bauabschnitts, den
-- niemand von selbst bemerkt: die Person wartet auf eine Erinnerung, der Lauf meldet Erfolg (er hat
-- den Fall ja abgearbeitet), und die Zeile steht still in der Tabelle. Ohne diese Funktion gäbe es
-- keinen Ort, an dem sie sichtbar würde.
--
-- Die 24-Stunden-Schwelle steht HIER und nicht in der Oberfläche, und die Antwort führt sie MIT:
-- die Oberfläche zeigt die Zahl, die die Datenbank benutzt hat, und kann keine andere behaupten.
-- 24 Stunden und nicht 48 (anders als die Ausbleib-Hervorhebung des Laufs selbst): eine Zeile ohne
-- Rückmeldung entsteht innerhalb eines einzigen Laufs — sie wartet nicht auf den nächsten, sie ist
-- bereits abschliessend gescheitert.
create function public.admin_contract_reminder_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_stale_after_hours constant integer := 24;
  v_stale_count       integer;
  v_oldest            timestamptz;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_contract_reminder_health: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select count(*)::integer, min(cr.attempted_at)
    into v_stale_count, v_oldest
  from platform.contract_reminders cr
  where cr.delivered_at is null
    and cr.attempted_at < now() - make_interval(hours => v_stale_after_hours);

  return jsonb_build_object(
    'status',            'ok',
    'stale_count',       v_stale_count,
    'oldest_attempted_at', v_oldest,
    'stale_after_hours', v_stale_after_hours
  );
end;
$$;

comment on function public.admin_contract_reminder_health() is
  'B4-2: wie viele Erinnerungen beansprucht, aber nie bestätigt versendet wurden und älter als 24 '
  'Stunden sind — der einzige Zustand dieses Bauabschnitts, der sonst niemandem auffällt (die '
  'Person wartet, der Lauf meldet Erfolg, die Zeile steht still). Die Schwelle steht in der '
  'Funktion und FÄHRT IN DER ANTWORT MIT (stale_after_hours), damit die Oberfläche keine andere '
  'Zahl behaupten kann als die verwendete. WIRFT bei fehlender Adminrolle (42501). '
  'authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 5 — RLS und Rechte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Wie platform.job_runs (B4-1): RLS an, KEINE Policy, für KEINE Rolle ein Grant — auch nicht für
-- service_role. Zwei unabhängige Schichten: ohne Policy sähe selbst eine Rolle nichts, der jemand
-- später versehentlich ein Tabellen-Grant gäbe. Geschrieben wird ausschliesslich aus den
-- SECURITY-DEFINER-Wrappern oben, gelesen über admin_get_lead und admin_contract_reminder_health.
alter table platform.contract_reminders enable row level security;

-- Die platform-Funktionen sind KEIN öffentlicher Zugriffsweg: PostgreSQL grantet EXECUTE an PUBLIC
-- per Voreinstellung. (clear_contract_data_on_withdrawal und anonymize_lead sind `create or replace`
-- — Eigentümer und ACL bleiben unangetastet, der Entzug aus B3-1/B4-1 gilt weiter.)
revoke all on function platform.contract_reminder_lead_days() from public;
revoke all on function platform.leads_due_for_contract_reminder(integer) from public;

-- Die neuen public-Funktionen: Supabases ALTER DEFAULT PRIVILEGES hat ihnen EXECUTE an anon,
-- authenticated UND service_role gegeben (zusätzlich zum PostgreSQL-Default-Grant an PUBLIC). Erst
-- allen entziehen, dann gezielt gewähren.
revoke all on function public.start_contract_reminder_run(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.start_contract_reminder_run(integer) to service_role;

revoke all on function public.claim_contract_reminder(uuid, date)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_contract_reminder(uuid, date) to service_role;

revoke all on function public.record_contract_reminder_result(uuid, date, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_contract_reminder_result(uuid, date, text) to service_role;

revoke all on function public.finish_contract_reminder_run(uuid, text, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.finish_contract_reminder_run(uuid, text, integer, text)
  to service_role;

revoke all on function public.admin_contract_reminder_health()
  from public, anon, authenticated, service_role;
grant execute on function public.admin_contract_reminder_health() to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 6 — admin_get_lead: den Erinnerungsstand am Lead sichtbar machen
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Ohne diese Erweiterung liesse sich am einzelnen Lead nicht beantworten, ob für sein Vertragsende
-- bereits erinnert wurde — und genau das ist die Frage, die im Zweifel gestellt wird („die Person
-- sagt, sie habe nichts bekommen"). Die Antwort steht in der Tabelle; sie braucht nur einen Weg
-- nach oben.
--
-- Geliefert werden ALLE Zeilen des Leads, nicht nur die zum aktuellen Vertragsende: eine ältere
-- Zeile mit einem anderen Datum ist die sichtbare Spur einer Korrektur und beantwortet die
-- Anschlussfrage „warum bekam er zwei". Die Oberfläche hebt die zum aktuellen Vertragsende hervor.
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
  v_lead      jsonb;
  v_consents  jsonb;
  v_reminders jsonb;
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

  -- B4-2: das Versandprotokoll der Vertragsablauf-Erinnerung.
  select coalesce(jsonb_agg(to_jsonb(r) order by r.contract_end_date desc), '[]'::jsonb)
    into v_reminders
  from (
    select cr.contract_end_date,
           cr.attempted_at,
           cr.delivered_at,
           cr.error
    from platform.contract_reminders cr
    where cr.lead_id = p_lead_id
  ) r;

  return jsonb_build_object(
    'status', 'ok',
    'lead', v_lead,
    'consents', v_consents,
    'contract_reminders', v_reminders
  );
end;
$$;

comment on function public.admin_get_lead(uuid) is
  'B1-1, erweitert in B1-3, B3-1, B4-1 und B4-2: ein Lead samt allen Einwilligungen — INKLUSIVE des '
  'jeweils angezeigten Textkörpers und seiner Version/Sprache (ohne den Wortlaut wäre der Nachweis '
  'keiner: die Person hat einen Satz gelesen, keinen Zweckschlüssel), effective_status je '
  'Einwilligung, anonymized_by samt E-Mail des Kontos, anonymized_by_system (B4-1), den sechs '
  'Segmentierungsmerkmalen aus B3-1 und seit B4-2 contract_reminders: das Versandprotokoll der '
  'Vertragsablauf-Erinnerung (alle Zeilen, nicht nur die zum aktuellen Vertragsende — eine ältere '
  'Zeile ist die sichtbare Spur einer Korrektur). token_hash/token_expires_at fahren bewusst nicht '
  'mit. WIRFT bei fehlender Adminrolle (42501); ein unbekannter Lead ist ein fachlicher Zustand '
  '({status: not_found}). authenticated-only.';
