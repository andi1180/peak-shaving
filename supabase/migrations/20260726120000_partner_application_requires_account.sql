-- B16-3-Nachbesserung — eine Bewerbung entsteht nicht mehr ohne aufgelöstes Konto.
--
-- Kein neuer Funktionsumfang. Korrektur eines in PRODUKTION gemessenen Fehlers.
--
-- ── DER BEFUND ──────────────────────────────────────────────────────────────────────────────────
-- B16-3 hat `public.submit_partner_application` bewusst so gebaut, dass der Antrag AUCH DANN
-- entsteht, wenn sich kein Konto auflösen lässt: „eine verlorene Bewerbung wiegt schwerer als eine
-- fehlende Verknüpfung". Real aufgetreten ist daraufhin genau der Fall, den diese Abwägung nicht
-- bedacht hat: die Kontoanlage scheiterte am Rate-Limit des Mailversands (429
-- `over_email_send_rate_limit`, rund 33 s nach einem vorherigen Versuch), es entstand KEIN Konto,
-- die Adresse war folglich auch nicht auflösbar — und der Antrag wurde trotzdem geschrieben. Weil
-- der Bewerbungsweg Fehler zur Enumerationsvermeidung verschluckt, sah der Bewerber „Danke, wir
-- melden uns".
--
-- Das Ergebnis ist ein Antrag, der zu keinem Konto führt, über das sich je jemand anmelden könnte.
-- B16-4a hat ihn deshalb als nicht genehmigbar abgewiesen (`no_account`) — das war die richtige
-- Notbremse, aber die Bewerbung war zu diesem Zeitpunkt bereits verloren, nur eben unbemerkt: der
-- Bewerber wartet auf eine Antwort, und im Prüf-Eingang liegt eine Zeile, mit der niemand etwas
-- anfangen kann.
--
-- ── DIE ENTSCHEIDUNG: DER SCHREIBWEG BRICHT AB, STATT HALB ZU SCHREIBEN ─────────────────────────
-- Lässt sich kein Konto auflösen, entsteht KEIN Antrag und der Bewerber bekommt einen echten,
-- wiederholbaren Fehler. Die ursprüngliche Abwägung wird damit nicht umgeworfen, sondern zu Ende
-- gedacht: Ein Antrag ohne Konto ist keine „gerettete" Bewerbung, sondern eine, die still
-- verlorengegangen ist — nur mit einer Zeile in der Datenbank als Beleg des Gegenteils. Ein
-- sichtbarer Fehler, den derselbe Mensch in fünf Minuten wiederholen kann, ist der bessere Ausgang.
--
-- AUSDRÜCKLICH UNVERÄNDERT bleibt der Fall „die Adresse hat bereits ein Konto": er wird weiterhin
-- aufgelöst, der Antrag entsteht und wird mit dem BESTEHENDEN Konto verknüpft, das Passwort wird
-- nicht gesetzt. Das ist kein Fehlerfall, sondern gewolltes Verhalten aus B16-3.
--
-- ── ⚠ WARUM DIE INVARIANTE EIN TRIGGER IST UND KEIN `NOT NULL` AUF DER SPALTE ────────────────────
-- Ein Spalten-`NOT NULL` war der naheliegende Weg und ist GEMESSEN AUSGESCHIEDEN. `user_id` trägt
-- `on delete set null`, und diese referentielle Aktion IST SELBST EIN UPDATE — dieselbe Falle, an
-- der in diesem Repo schon `leads.last_edited_by` (B2-1), `email_events.lead_id` (B2-2) und
-- `analyses.lead_id`/`created_by` (B14-1) hängen geblieben sind. Gemessen in einer zurückgerollten
-- Transaktion gegen PostgreSQL 17.6, mit echtem Konto und echtem Antrag:
--
--   `NOT NULL` + `on delete set null` → `delete from auth.users` scheitert mit 23502.
--                                       Das Konto ist UNLÖSCHBAR, sobald irgendein Antrag daran
--                                       hängt — ausgerechnet gegen ein Löschverlangen.
--   `NOT NULL` + `on delete cascade`  → das Löschen VERNICHTET den offenen Antrag (B16-3 hatte
--                                       ausdrücklich entschieden, dass ein gelöschtes Konto keine
--                                       Geschäftsunterlage löscht), und sobald aus dem Antrag ein
--                                       Partner geworden ist, scheitert es mit 23503 an
--                                       `partners_application_id_fkey` (`on delete restrict`,
--                                       B16-4a) — das Konto ist dann wieder unlöschbar.
--
-- Beide Wege brechen also entweder die Löschbarkeit eines Kontos oder die Aufbewahrung des
-- Antrags. Die Invariante, um die es tatsächlich geht, ist aber enger als „diese Spalte ist nie
-- null": Ein Antrag darf nicht ohne Konto ENTSTEHEN. Dass die Verknüpfung SPÄTER entfällt, weil
-- die Person ihr Konto löscht, ist kein illegitimer Antrag, sondern ein legitimer, dessen Konto es
-- nicht mehr gibt — genau der Zustand, für den `on delete set null` da ist.
--
-- Der Trigger setzt deshalb dieselbe ASYMMETRISCHE AUSNAHME durch wie die drei Fälle oben:
--   INSERT mit user_id null          → abgewiesen.
--   UPDATE, das user_id SETZT        → abgewiesen (null → Wert).
--   UPDATE, das user_id UMHÄNGT      → abgewiesen (Wert → anderer Wert).
--   UPDATE, das user_id NULLT        → ERLAUBT, sofern die Zeile sonst bit-identisch bleibt.
--   UPDATE ohne user_id-Änderung     → läuft durch (Status, reviewed_by, reviewed_at).
--
-- Er greift auch gegen `service_role` und `postgres`: die Invariante ist eine Eigenschaft der
-- Datenbank, keine Übereinkunft des Anwendungscodes.
--
-- ── WAS HIER AUSDRÜCKLICH NICHT ENTSTEHT ────────────────────────────────────────────────────────
-- KEINE Änderung an `platform.partners`, an den B16-4a-Wrappern oder an deren Grants. Der
-- Abweisungsgrund `no_account` in `public.admin_approve_partner_application` BLEIBT bestehen,
-- obwohl er durch diese Migration unerreichbar wird — Tiefenstaffelung: er kostet nichts und ist
-- die zweite Linie, falls je wieder ein Weg entsteht, der an diesem Trigger vorbeischreibt.
--
-- KEIN Umgehen, Erhöhen oder Überdecken des Supabase-Rate-Limits. Dessen Ursache ist Konfiguration
-- (Auth-SMTP) und wird getrennt bearbeitet. Ein Wiederholungsversuch im Code verdeckte sie nur.
--
-- KEIN neuer Status, keine neue Spalte, keine Aufbewahrungsfrist (weiterhin offen, DEPLOYMENT.md §7).

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 0 — Vorbedingung: es darf keinen Altbestand geben
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Der Trigger unten wacht über INSERT und UPDATE, nicht über bereits bestehende Zeilen. Liefe die
-- Migration über einen Bestand mit `user_id is null` hinweg, blieben genau die Anträge stehen, die
-- sie unmöglich machen soll — unsichtbar, weil die neue Invariante ihre Existenz ausschliesst.
-- Deshalb bricht sie LAUT ab, statt still zu löschen: ein solcher Antrag ist eine echte Bewerbung
-- eines echten Betriebs, und was mit ihm geschieht (Konto von Hand anlegen und verknüpfen, oder
-- verwerfen), ist eine Entscheidung eines Menschen und nicht die einer Migration.
--
-- Vor dem Schreiben dieser Migration in der Produktions-Datenbank gemessen: 0 Zeilen insgesamt,
-- davon 0 ohne Konto (die drei Test-Anträge des B16-3-Live-Laufs waren bereits von Hand entfernt).
do $$
declare
  v_offen integer;
begin
  select count(*) into v_offen
    from platform.partner_applications
   where user_id is null;

  if v_offen > 0 then
    raise exception
      'Es stehen % Partner-Anträge ohne verknüpftes Konto im Bestand. Diese Migration bricht ab, '
      'statt sie still zu löschen — sie sind echte Bewerbungen. Bitte je Antrag entscheiden '
      '(Konto anlegen und über public.admin_link_partner_account bzw. von Hand verknüpfen, oder '
      'den Antrag ablehnen und entfernen), danach erneut anwenden.', v_offen
      using errcode = '23502';
  end if;
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — Die Invariante: ein Antrag entsteht nicht ohne Konto
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
create function platform.require_partner_application_account()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.user_id is null then
      raise exception
        'platform.partner_applications: ein Antrag ohne verknüpftes Konto entsteht nicht. Lässt '
        'sich für die Adresse kein Konto auflösen, bricht der Schreibweg ab (B16-3-Nachbesserung).'
        using errcode = '23502';
    end if;
    return new;
  end if;

  -- UPDATE. Der Regelfall (Status, reviewed_by, reviewed_at) fasst user_id nicht an.
  if new.user_id is not distinct from old.user_id then
    return new;
  end if;

  /*
   * user_id ändert sich. Erlaubt ist AUSSCHLIESSLICH das Nullen bei sonst bit-identischer Zeile —
   * das ist die referentielle Aktion `on delete set null`, die selbst ein UPDATE ist. Ohne diese
   * Ausnahme wäre jedes Konto unlöschbar, an dem ein Antrag hängt (gemessen, s. Kopf). Setzen
   * (null → Wert) und Umhängen (Wert → anderer Wert) fallen hier durch: ein Antrag soll sich nicht
   * nachträglich an ein anderes Konto hängen lassen, denn genau daran entscheidet B16-4a, WER
   * freigeschaltet wird.
   */
  if new.user_id is null
     and to_jsonb(new) - 'user_id' = to_jsonb(old) - 'user_id'
  then
    return new;
  end if;

  raise exception
    'platform.partner_applications: user_id lässt sich nicht setzen oder umhängen (% → %). '
    'Erlaubt ist allein das referentielle Nullen beim Löschen des Kontos.',
    coalesce(old.user_id::text, 'null'), coalesce(new.user_id::text, 'null')
    using errcode = '23502';
end;
$$;

comment on function platform.require_partner_application_account is
  'B16-3-Nachbesserung: erzwingt, dass ein Partner-Antrag nur MIT aufgelöstem Konto entsteht. '
  'Bewusst ein Trigger und kein NOT NULL auf der Spalte: user_id trägt on delete set null, und '
  'diese referentielle Aktion ist selbst ein UPDATE — mit NOT NULL wäre jedes Konto unlöschbar, '
  'an dem ein Antrag hängt (gemessen, 23502), und mit on delete cascade entweder der Antrag '
  'vernichtet oder das Konto über partners.application_id (on delete restrict, B16-4a) wieder '
  'unlöschbar. Dieselbe asymmetrische Ausnahme wie bei leads.last_edited_by (B2-1), '
  'email_events.lead_id (B2-2) und analyses.lead_id/created_by (B14-1): das Nullen bei sonst '
  'bit-identischer Zeile läuft durch, Setzen und Umhängen bleiben gesperrt. Greift auch gegen '
  'service_role und postgres.';

revoke all on function platform.require_partner_application_account() from public;

-- Einziger Trigger auf dieser Tabelle — die alphabetische Reihenfolge der BEFORE-ROW-Trigger
-- (B1-3) ist hier ohne Wirkung, der Name folgt trotzdem dem Muster <tabelle>_<zweck>.
create trigger partner_applications_require_account
  before insert or update on platform.partner_applications
  for each row execute function platform.require_partner_application_account();

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — public.submit_partner_application: abbrechen statt halb schreiben
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- `create or replace` bei UNVERÄNDERTER Signatur: die Grants aus B16-3 (service_role-only) bleiben
-- damit unangetastet — ein DROP+CREATE hätte sie entfernt (in B3-1 real passiert).
--
-- ── DIE EINE NEUE VERZWEIGUNG ──────────────────────────────────────────────────────────────────
-- Lässt sich kein Konto auflösen, wird NICHTS eingefügt und `{status: no_account}` zurückgegeben.
-- Der Name ist derselbe wie der Abweisungsgrund in `admin_approve_partner_application` (B16-4a) —
-- es ist derselbe Sachverhalt, und zwei Wörter für eine Sache wären zwei Auslegungen.
--
-- ── DER FALL „MEHRERE KONTEN ZUR ADRESSE" WANDERT MIT ──────────────────────────────────────────
-- Er lieferte bisher einen unverknüpften Antrag und liefert jetzt ebenfalls `no_account`. Das ist
-- Absicht und nicht bloss Nebenwirkung: die Antwort unterscheidet AUSDRÜCKLICH NICHT zwischen „kein
-- Konto" und „mehrere Konten". Ein eigener Status wäre für den Aufrufer eine Auskunft über den
-- Kontobestand zu einer fremden Adresse — genau das, was dieser Wrapper seit B16-3 nicht gibt.
--
-- ── ⚠ WAS DAMIT AN ENUMERATIONSSCHUTZ VERLORENGEHT, OFFEN AUSGESPROCHEN ────────────────────────
-- Bis hierher war die Rückgabe für eine bekannte und eine unbekannte Adresse identisch. Ab jetzt
-- ist sie es nicht mehr: `created` heisst, dass ein Konto zur Adresse existiert. Das ist der Preis
-- der Invariante und nicht vermeidbar — „kein Antrag ohne Konto" und „die Antwort verrät nichts
-- über die Existenz einer Adresse" schliessen einander aus, sobald die Kontoanlage scheitert.
--
-- Erreichbar ist der Unterschied nur DORT, wo die Kontoanlage fehlschlägt: Im Normalfall legt der
-- Anwendungscode vor diesem Aufruf ein Konto an, und dann trifft `created` auf beide Fälle zu.
-- Der Wrapper ist zudem service_role-only und hat genau einen Aufrufer
-- (`apps/web/lib/partner-application/store.ts`); von aussen ist er gar nicht erreichbar. Die
-- verbleibende Fläche ist damit das Zeitfenster, in dem der Mailversand am Rate-Limit hängt — also
-- genau die Fehlkonfiguration, die diesen Bauabschnitt ausgelöst hat und die getrennt behoben wird.
create or replace function public.submit_partner_application(
  p_company text,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_message text,
  p_phone text default null,
  p_website text default null,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company    text := nullif(btrim(p_company), '');
  v_first_name text := nullif(btrim(p_first_name), '');
  v_last_name  text := nullif(btrim(p_last_name), '');
  v_email      text := lower(nullif(btrim(p_email), ''));
  v_message    text := nullif(btrim(p_message), '');
  v_phone      text := nullif(btrim(p_phone), '');
  v_website    text := nullif(btrim(p_website), '');
  v_user_id    uuid;
  v_matches    integer;
  v_id         uuid;
begin
  if v_company is null
     or v_first_name is null
     or v_last_name is null
     or v_email is null
     or v_message is null then
    return jsonb_build_object('status', 'missing_fields');
  end if;

  /*
   * Die laufende Sitzung schlägt die Adresse. Wer angemeldet ist, bewirbt sich mit SEINEM Konto —
   * auch dann, wenn er eine abweichende Kontaktadresse einträgt. Ein übergebenes, aber nicht (mehr)
   * existierendes Konto wird stillschweigend verworfen; die Auflösung über die Adresse greift dann
   * weiterhin.
   */
  if p_user_id is not null then
    select au.id into v_user_id from auth.users au where au.id = p_user_id;
  end if;

  if v_user_id is null then
    select count(*) into v_matches from auth.users au where lower(au.email) = v_email;
    if v_matches = 1 then
      select au.id into v_user_id from auth.users au where lower(au.email) = v_email;
    end if;
  end if;

  /*
   * ABBRUCH STATT HALBER SCHREIBVORGANG (B16-3-Nachbesserung). Bis hierher entstand der Antrag
   * auch unverknüpft. Ein solcher Antrag führt zu keinem Konto, über das sich je jemand anmelden
   * könnte, und ist in B16-4a nicht genehmigbar — er sähe im Prüf-Eingang aus wie eine Bewerbung
   * und wäre keine. Es wird deshalb NICHTS eingefügt; der Aufrufer macht daraus eine sichtbare,
   * wiederholbare Fehlermeldung.
   *
   * Der Trigger `partner_applications_require_account` setzt dieselbe Bedingung noch einmal auf
   * Speicherebene durch. Diese Prüfung hier ist keine Doppelung, sondern der Unterschied zwischen
   * einer beantworteten Frage und einer geworfenen Ausnahme: der Aufrufer bekommt einen fachlichen
   * Zustand zurück und muss keinen SQLSTATE auswerten.
   */
  if v_user_id is null then
    return jsonb_build_object('status', 'no_account');
  end if;

  insert into platform.partner_applications
    (company, first_name, last_name, email, phone, website, message, user_id)
  values
    (v_company, v_first_name, v_last_name, v_email, v_phone, v_website, v_message, v_user_id)
  returning id into v_id;

  /*
   * Die Rückgabe trägt die Antrags-ID, weil die interne Benachrichtigungsmail auf die Detailansicht
   * verweisen soll — und SONST NICHTS. Insbesondere nicht, WELCHES Konto verknüpft wurde oder ob es
   * neu ist: das bleibt die Auskunft, die diese Seite niemandem gibt.
   */
  return jsonb_build_object('status', 'created', 'application_id', v_id);
end;
$$;

comment on function public.submit_partner_application(text, text, text, text, text, text, text, uuid) is
  'B16-3 (nachgebessert 26.07.2026): nimmt eine Partner-Bewerbung entgegen. Verknüpft sie mit dem '
  'Auth-Konto — der laufenden Sitzung (p_user_id), sonst dem GENAU EINEN Konto zur Adresse. Lässt '
  'sich KEIN Konto auflösen (auch bei mehreren Treffern, denn auth.users erzwingt keine globale '
  'E-Mail-Eindeutigkeit), entsteht KEIN Antrag und die Rückgabe lautet {status: no_account} — '
  'vorher entstand er unverknüpft, was einen Antrag erzeugte, der zu keinem Login führt und in '
  'B16-4a nicht genehmigbar ist (in Produktion real aufgetreten, Ursache 429 '
  'over_email_send_rate_limit bei der Kontoanlage). Die Rückgabe {status: '
  'created|no_account|missing_fields, application_id} sagt weiterhin nie, WELCHES Konto verknüpft '
  'wurde oder ob es neu ist. Keine Prüfung gegen platform.email_suppressions (die regelt '
  'Aussendungen, nicht eine soeben erbetene Antwort). service_role-only.';
