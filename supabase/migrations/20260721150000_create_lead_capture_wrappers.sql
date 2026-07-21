-- B1-2 — Erfassungspfad, Double-Opt-in und Abmeldung (Fahrplan_2026.md, Abschnitt B1).
--
-- B1-1 hat das SCHEMA gebaut (leads/consents/consent_texts/lead_sources/email_suppressions samt
-- Triggern, RLS und den beiden Admin-Lesewrappern). Diese Migration baut den SCHREIBPFAD darauf:
-- Erfassung, Bestätigung, Widerruf, Sperrung — jeweils als EIN public-Wrapper.
--
-- ── WARUM WRAPPER, OBWOHL service_role BYPASSRLS HAT (J3/K2, exakt wie T4-3) ──────────────────────
-- `platform` ist bewusst NICHT in [api].schemas exponiert (`supabase/config.toml`). Ein
-- supabase-js-`.from('platform.…')` mit dem service_role-Key erreicht das Schema über PostgREST gar
-- nicht (PGRST106). Auch für service_role führt der Weg deshalb über SECURITY-DEFINER-Wrapper im
-- exponierten `public`-Schema — eine grantbare Fläche, ein Zugriffsweg.
--
-- ── WARUM capture_lead ATOMAR IST (dieselbe Begründung wie process_stripe_subscription_event) ─────
-- Lead und Einwilligung dürfen nicht getrennt committen. Zwei RPC-Roundtrips wären zwei
-- Transaktionen: bräche der zweite ab, stünde ein Lead ohne die Einwilligung im Bestand, für die er
-- gerade erfasst wurde — und der Anwendungscode hätte trotzdem schon eine Bestätigungsmail
-- ausgelöst oder eben nicht. In EINER Transaktion ist der Ausgang eindeutig, und genau dieser
-- Ausgang (`outcome`) entscheidet, ob eine Mail rausgeht.
--
-- ── KONVENTIONEN (T4-1/T4-3/B1-1) ────────────────────────────────────────────────────────────────
-- SECURITY DEFINER + `SET search_path = ''` (alle Objekte fully-qualified). Erst
-- `revoke all … from public, anon, authenticated, service_role` (Supabase grantet neue
-- public-Funktionen per ALTER DEFAULT PRIVILEGES automatisch an anon/authenticated/service_role),
-- dann gezielt `grant execute … to service_role`. NICHT an `authenticated`: ein eingeloggter Nutzer
-- ist hier niemand — der Erfassungspfad ist anonym und läuft ausschliesslich über den Server.
-- NICHT an `anon`: sonst könnte jeder Browser fremde Adressen in den Bestand schreiben.
--
-- ── ZWEI BEWUSSTE, ADDITIVE ABWEICHUNGEN VON DER AUFGABENSTELLUNG ────────────────────────────────
-- 1. `capture_lead` trägt einen zusätzlichen, defaultenden LETZTEN Parameter `p_locale` (default
--    'de'). Grund: B1-1 führt `consent_texts.locale` ausdrücklich als Teil des Nachweises („man kann
--    keine Zustimmung zu einem Wortlaut belegen, den die Person nie gesehen hat"). Ohne den Parameter
--    müsste die Auswahl der „jüngsten passenden" Textzeile die Sprache raten — bei einer zweiten
--    Sprache (Prinzip 5 der Website: i18n-vorbereitet) würde sie irgendwann die falsche archivieren.
--    Alle in der Aufgabe genannten Parameter behalten Name und Position; jeder Aufruf ohne `p_locale`
--    verhält sich unverändert.
-- 2. Es gibt einen SECHSTEN Wrapper, `public.get_active_consent_text`. Grund: das Formular MUSS den
--    Wortlaut anzeigen, den `capture_lead` anschliessend archiviert. Ohne Lesewrapper wäre die
--    angezeigte Fassung eine zweite Quelle (z. B. in `messages/de.json`) — und damit exakt der
--    Zustand, gegen den B1-1s append-only-Design gebaut ist: der Nachweis behauptet einen Wortlaut,
--    den die Person so nie gesehen haben muss. Der Wrapper liest NUR die Stammdatentabelle
--    `consent_texts` (kein Personenbezug) und ist ebenfalls service_role-only.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — get_active_consent_text: der Wortlaut, der angezeigt UND archiviert wird
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- „Aktiv" = die jüngste Fassung je Zweck und Sprache (höchste version; bei Gleichstand die zuletzt
-- gültig gewordene). Die Auswahlregel steht damit an EINER Stelle und ist identisch mit der, die
-- capture_lead unten für die Archivierung anwendet — zwei abweichende Regeln wären ein
-- Nachweisfehler, kein Anzeigefehler.
create function public.get_active_consent_text(
  p_purpose platform.consent_purpose,
  p_locale text default 'de'
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object(
               'status',  'ok',
               'id',      ct.id,
               'purpose', ct.purpose,
               'version', ct.version,
               'locale',  ct.locale,
               'body',    ct.body
             )
      from platform.consent_texts ct
      where ct.purpose = p_purpose
        and ct.locale  = coalesce(p_locale, 'de')
      order by ct.version desc, ct.valid_from desc
      limit 1
    ),
    jsonb_build_object('status', 'not_found')
  );
$$;

comment on function public.get_active_consent_text(platform.consent_purpose, text) is
  'B1-2: die JÜNGSTE Fassung des Einwilligungstextes je Zweck+Sprache (höchste version, bei '
  'Gleichstand zuletzt gültig geworden) — derselbe Auswahlsatz, den public.capture_lead zur '
  'Archivierung benutzt. Existiert damit, damit der ANGEZEIGTE und der ARCHIVIERTE Wortlaut nicht '
  'zwei Quellen sind (B1-1: append-only, der Nachweis ist der Wortlaut). Liest nur Stammdaten, '
  'keinen Personenbezug. {status: ok|not_found}. service_role-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — capture_lead: EIN atomarer Erfassungsaufruf
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ABLAUF: Lead anlegen ODER wiederverwenden (über die NORMALISIERTE Adresse) → ohne Zweck fertig →
-- sonst Sperrliste → sonst laufende Bestätigung → sonst neue pending-Einwilligung.
--
-- ── WARUM DIE PRÜFUNG AUF EINE LAUFENDE BESTÄTIGUNG KEIN KOMFORT IST ─────────────────────────────
-- Ohne sie könnte jemand eine fremde Adresse in ein Formular tippen und durch wiederholtes Absenden
-- beliebig viele Bestätigungsmails dorthin auslösen — das Formular wäre ein Mail-Verstärker. Mit ihr
-- entsteht je Lead+Zweck höchstens EINE offene Bestätigung, bis deren Token abläuft.
--
-- ── WARUM 'suppressed' EINEN LEAD HINTERLÄSST ────────────────────────────────────────────────────
-- Eine gesperrte Adresse bedeutet „schreibt mir keine Werbung", nicht „ich existiere nicht". Wer das
-- Kontaktformular absendet, stellt eine Anfrage — die Anfrage selbst ist von der Sperre nicht
-- betroffen (sie ist Vertragsanbahnung, keine Einwilligung). Gesperrt wird die EINWILLIGUNG: es
-- entsteht keine, und der Aufrufer schickt folglich keine Bestätigungsmail.
--
-- ── retention_basis BLEIBT AUF DEM B1-1-DEFAULT ('marketing', 24 Monate) ─────────────────────────
-- Bewusst kein Parameter: eine längere Frist ist eine ESKALATION der Speicherdauer und hängt am noch
-- offenen Löschkonzept (Fahrplan_2026.md, offene Entscheidung 1). Die kürzere Frist ist die
-- datensparsame Voreinstellung; sie lässt sich später je Lead heraufsetzen (der Trigger
-- sync_lead_retention zieht deletion_due_at automatisch nach), der umgekehrte Weg wäre eine
-- rückwirkend zu lange Speicherung.
create function public.capture_lead(
  p_email text,
  p_source_key text,
  p_purpose platform.consent_purpose default null,
  p_token_hash text default null,
  p_token_expires_at timestamptz default null,
  p_company text default null,
  p_contact_name text default null,
  p_phone text default null,
  p_source_ip inet default null,
  p_user_agent text default null,
  p_locale text default 'de'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead_id         uuid;
  v_consent_text_id uuid;
  v_consent_id      uuid;
begin
  if p_email is null or btrim(p_email) = '' then
    raise exception 'public.capture_lead: p_email ist Pflicht' using errcode = '22023';
  end if;

  -- Ein bestätigungspflichtiger Zweck OHNE Token erzeugte eine pending-Einwilligung, die niemand je
  -- bestätigen kann — ein stiller Dauerzustand, der im Bestand wie eine offene Bestätigung aussieht
  -- und zugleich jede weitere Erfassung dieses Zwecks blockiert (s. Prüfung unten). Lieber laut.
  if p_purpose is not null
     and platform.purpose_requires_double_opt_in(p_purpose)
     and (p_token_hash is null or btrim(p_token_hash) = '')
  then
    raise exception
      'public.capture_lead: Zweck % ist bestätigungspflichtig — p_token_hash ist dann Pflicht',
      p_purpose
      using errcode = '22023';
  end if;

  -- ── Lead anlegen oder wiederverwenden ──────────────────────────────────────────────────────────
  -- Konflikt-Ziel ist der AUSDRUCKS-Index aus B1-1 (platform.normalize_email(email)) — also
  -- dieselbe Definition von „dieselbe Adresse", die auch der BEFORE-Trigger anwendet. `do nothing`
  -- statt `do update`, weil der Wiederverwendungsfall unten mehr tut als ein Upsert ausdrücken
  -- könnte (Identitätsfelder nur ERGÄNZEN, nie überschreiben).
  insert into platform.leads (email, first_source_key, company, contact_name, phone)
  values (
    p_email,
    p_source_key,
    nullif(btrim(p_company), ''),
    nullif(btrim(p_contact_name), ''),
    nullif(btrim(p_phone), '')
  )
  on conflict (platform.normalize_email(email)) do nothing
  returning id into v_lead_id;

  if v_lead_id is null then
    -- Bestehender Lead: last_interaction_at rückt (und mit ihr die Löschfrist, Trigger
    -- sync_lead_retention). Identitätsfelder werden nur GEFÜLLT, wo bisher nichts stand: eine
    -- spätere, knappere Absendung darf eine früher genannte Firma/Telefonnummer nicht löschen.
    -- first_source_key bleibt unangetastet (Trigger guard_lead_first_source würde es ohnehin
    -- ablehnen) — die Ersterfassungs-Herkunft ist einmalig.
    update platform.leads l
       set last_interaction_at = now(),
           company      = coalesce(l.company,      nullif(btrim(p_company), '')),
           contact_name = coalesce(l.contact_name, nullif(btrim(p_contact_name), '')),
           phone        = coalesce(l.phone,        nullif(btrim(p_phone), ''))
     where platform.normalize_email(l.email) = platform.normalize_email(p_email)
    returning l.id into v_lead_id;
  end if;

  if v_lead_id is null then
    -- Weder angelegt noch gefunden: darf nicht vorkommen (der Insert scheitert nur am
    -- E-Mail-UNIQUE, und dann findet das UPDATE die Zeile). Nicht still weiterlaufen.
    raise exception 'public.capture_lead: Lead für die übergebene Adresse konnte nicht ermittelt werden';
  end if;

  if p_purpose is null then
    return jsonb_build_object('outcome', 'lead_only', 'lead_id', v_lead_id);
  end if;

  -- ── Sperrliste (B1-1: die zweite Pflichtfrage vor jedem Versand) ───────────────────────────────
  if platform.is_suppressed(p_email) then
    return jsonb_build_object('outcome', 'suppressed', 'lead_id', v_lead_id);
  end if;

  -- ── Läuft für diesen Lead und diesen Zweck schon eine Bestätigung? ─────────────────────────────
  -- Der Zweck kommt über den verknüpften Text (B1-1: es gibt keine zweite, denormalisierte
  -- Zweck-Angabe an der Einwilligung, die davon abweichen könnte).
  if exists (
    select 1
    from platform.consents c
    join platform.consent_texts ct on ct.id = c.consent_text_id
    where c.lead_id = v_lead_id
      and ct.purpose = p_purpose
      and c.status = 'pending'
      and (c.token_expires_at is null or c.token_expires_at > now())
  ) then
    return jsonb_build_object('outcome', 'consent_already_pending', 'lead_id', v_lead_id);
  end if;

  -- ── Jüngste passende Textfassung (identische Regel wie get_active_consent_text) ────────────────
  select ct.id into v_consent_text_id
  from platform.consent_texts ct
  where ct.purpose = p_purpose
    and ct.locale  = coalesce(p_locale, 'de')
  order by ct.version desc, ct.valid_from desc
  limit 1;

  if v_consent_text_id is null then
    -- Ohne Wortlaut keine Einwilligung. Ein Fallback auf eine andere Sprache wäre ein Nachweis über
    -- einen Text, den die Person nicht gesehen hat.
    raise exception
      'public.capture_lead: kein Einwilligungstext für Zweck % in Sprache % vorhanden',
      p_purpose, coalesce(p_locale, 'de')
      using errcode = '22023';
  end if;

  insert into platform.consents (
    lead_id, consent_text_id, source_key, status, token_hash, token_expires_at, source_ip, user_agent
  )
  values (
    v_lead_id, v_consent_text_id, p_source_key, 'pending', p_token_hash, p_token_expires_at,
    p_source_ip, p_user_agent
  )
  returning id into v_consent_id;

  return jsonb_build_object(
    'outcome',    'consent_created',
    'lead_id',    v_lead_id,
    'consent_id', v_consent_id
  );
end;
$$;

comment on function public.capture_lead(
  text, text, platform.consent_purpose, text, timestamptz, text, text, text, inet, text, text
) is
  'B1-2: EIN atomarer Erfassungsaufruf (Lead + optionale Einwilligung in EINER Transaktion — Lead '
  'und Nachweis dürfen nicht getrennt committen). Rückgabe {outcome, lead_id} mit outcome aus '
  'lead_only (kein Zweck übergeben) · consent_created · consent_already_pending (offene, nicht '
  'abgelaufene Bestätigung — verhindert, dass wiederholtes Absenden fremde Adressen mit '
  'Bestätigungsmails zudeckt) · suppressed (Adresse gesperrt: KEINE Einwilligung, der Lead bleibt — '
  'eine Anfrage ist keine Einwilligung). NUR bei consent_created versendet der Anwendungscode eine '
  'Mail. Bestätigungspflichtiger Zweck ohne p_token_hash wirft. service_role-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — get_pending_consent_by_token: der GET-Pfad der Bestätigungsseite (schreibt NICHT)
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- STABLE und ohne jeden Schreibvorgang — auch nicht „nebenbei" das Setzen von 'expired' bei einem
-- abgelaufenen Token. Grund: Mailscanner in Unternehmen rufen Links vorab ab. Ein GET, der den
-- Datenbestand ändert, macht aus einem Sicherheits-Scan einen fachlichen Vorgang. Das Abräumen
-- abgelaufener Einwilligungen erledigt confirm_consent (der echte POST-Pfad), lazy.
--
-- 'withdrawn' antwortet bewusst wie 'not_found' (und ohne Wortlaut): ein widerrufener Nachweis ist
-- kein Zustand, den eine Bestätigungsseite anbieten soll.
create function public.get_pending_consent_by_token(p_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v record;
  v_outcome text;
begin
  if p_token_hash is null or btrim(p_token_hash) = '' then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  select c.id, c.status, c.token_expires_at, c.confirmed_at, c.lead_id,
         ct.purpose, ct.body, ct.version, ct.locale
    into v
  from platform.consents c
  join platform.consent_texts ct on ct.id = c.consent_text_id
  where c.token_hash = p_token_hash;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  v_outcome := case
    when v.status = 'confirmed' then 'already_confirmed'
    when v.status = 'withdrawn' then 'not_found'
    when v.status = 'expired'   then 'expired'
    when v.token_expires_at is not null and v.token_expires_at <= now() then 'expired'
    else 'valid'
  end;

  if v_outcome = 'not_found' then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  return jsonb_build_object(
    'outcome',              v_outcome,
    'purpose',              v.purpose,
    'consent_text_body',    v.body,
    'consent_text_version', v.version,
    'consent_text_locale',  v.locale,
    'expires_at',           v.token_expires_at,
    'confirmed_at',         v.confirmed_at
  );
end;
$$;

comment on function public.get_pending_consent_by_token(text) is
  'B1-2: was die Bestätigungsseite ANZEIGEN muss (Zweck, Wortlaut samt Version/Sprache, Ablauf) — '
  'STABLE, kein Schreibvorgang, auch nicht das Setzen von expired. Grund: Mailscanner rufen Links '
  'vorab ab; ein schreibender GET macht aus einem Scan einen fachlichen Vorgang. outcome: valid | '
  'expired | already_confirmed | not_found (auch für widerrufene Nachweise — die gehören nicht auf '
  'eine Bestätigungsseite). service_role-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — confirm_consent: der einzige Weg zu status='confirmed'
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Setzt confirmed_at MIT — ohne den Zeitstempel liesse der B1-1-Trigger guard_consent_confirmation
-- den Statuswechsel bei bestätigungspflichtigen Zwecken gar nicht zu (die Sperre gilt auch für
-- service_role und für diesen Wrapper).
--
-- IDEMPOTENT: ein zweiter Klick auf denselben Link ist Erfolg ohne zweite Wirkung — confirmed_at
-- bleibt der ERSTE Zeitpunkt (das ist der Nachweis; ein Nachschreiben wäre eine Fälschung des
-- Datums). `for update of c` serialisiert zwei gleichzeitige Klicks.
--
-- ABGELAUFEN wird LAZY behandelt (kein Hintergrundjob — vor B4 gibt es im System keine
-- Zeitsteuerung): der Aufruf selbst setzt status='expired' und bestätigt NICHT.
create function public.confirm_consent(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
begin
  if p_token_hash is null or btrim(p_token_hash) = '' then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  select c.id, c.status, c.token_expires_at, c.lead_id, ct.purpose
    into v
  from platform.consents c
  join platform.consent_texts ct on ct.id = c.consent_text_id
  where c.token_hash = p_token_hash
  for update of c;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if v.status = 'confirmed' then
    return jsonb_build_object(
      'outcome', 'already_confirmed', 'lead_id', v.lead_id, 'purpose', v.purpose
    );
  end if;

  -- Ein Widerruf ist keine Vorstufe der Bestätigung: derselbe Link darf ihn nicht rückgängig machen.
  if v.status = 'withdrawn' then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if v.status = 'expired'
     or (v.token_expires_at is not null and v.token_expires_at <= now())
  then
    update platform.consents c
       set status = 'expired'
     where c.id = v.id
       and c.status <> 'expired';
    return jsonb_build_object('outcome', 'expired');
  end if;

  update platform.consents c
     set status       = 'confirmed',
         confirmed_at = now()
   where c.id = v.id;

  return jsonb_build_object('outcome', 'confirmed', 'lead_id', v.lead_id, 'purpose', v.purpose);
end;
$$;

comment on function public.confirm_consent(text) is
  'B1-2: der einzige Weg zu status=confirmed — setzt confirmed_at mit (ohne ihn liesse der '
  'B1-1-Trigger guard_consent_confirmation den Wechsel gar nicht zu). Idempotent: bereits bestätigt '
  '→ Erfolg ohne zweite Wirkung, confirmed_at bleibt der ERSTE Zeitpunkt. Abgelaufen wird LAZY '
  'behandelt (status=expired, keine Bestätigung) — vor B4 gibt es bewusst keinen zeitgesteuerten '
  'Job. outcome: confirmed | already_confirmed | expired | not_found. service_role-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 5 — withdraw_consent: Widerruf EINES Zwecks
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Betrifft alle offenen UND bestätigten Zeilen dieses Zwecks (mehrere sind der Normalfall, B1-1:
-- kein UNIQUE auf (lead_id, purpose)) — ein Widerruf, der nur die jüngste Zeile trifft, liesse eine
-- ältere bestätigte stehen, und platform.has_confirmed_consent sagte weiter „darf senden".
--
-- NEUTRALE RÜCKGABE: outcome ist IMMER 'withdrawn', auch bei unbekanntem Lead oder null. Der
-- Abmeldelink darf nicht beantworten, ob es die Adresse gibt. (`withdrawn_count` ist Betriebswissen
-- fürs Server-Log — die Seite zeigt in jedem Fall dieselbe Bestätigung.)
create function public.withdraw_consent(
  p_lead_id uuid,
  p_purpose platform.consent_purpose
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if p_lead_id is null or p_purpose is null then
    return jsonb_build_object('outcome', 'withdrawn', 'withdrawn_count', 0);
  end if;

  with target as (
    select c.id
    from platform.consents c
    join platform.consent_texts ct on ct.id = c.consent_text_id
    where c.lead_id = p_lead_id
      and ct.purpose = p_purpose
      and c.status in ('pending', 'confirmed')
  )
  update platform.consents c
     set status       = 'withdrawn',
         withdrawn_at = now()
    from target t
   where c.id = t.id;

  get diagnostics v_count = row_count;

  return jsonb_build_object('outcome', 'withdrawn', 'withdrawn_count', v_count);
end;
$$;

comment on function public.withdraw_consent(uuid, platform.consent_purpose) is
  'B1-2: Widerruf EINES Zwecks — setzt ALLE offenen und bestätigten Zeilen dieses Zwecks auf '
  'withdrawn (mehrere je Lead+Zweck sind laut B1-1 der Normalfall; eine übersehene bestätigte Zeile '
  'liesse platform.has_confirmed_consent weiter „darf senden" sagen). Idempotent. outcome ist IMMER '
  '''withdrawn'', auch bei unbekanntem Lead — ein Abmeldelink darf nicht verraten, ob es die Adresse '
  'gibt. service_role-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 6 — suppress_email_and_withdraw_all: „keine E-Mails mehr", dauerhaft
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Widerruft ALLE Zwecke und schreibt die Adresse als HASH in die Sperrliste. Der Sperrlisten-Eintrag
-- trägt keinen Klartext und hat keinen FK auf leads (B1-1) — er überlebt damit jede spätere
-- Lead-Löschung, und genau das ist die Zusage: wer sich abmeldet, steht nach Löschung und nächstem
-- Import nicht wieder im Verteiler.
--
-- Reihenfolge (Widerruf zuerst, Sperre danach) ist innerhalb einer Transaktion ohne Folge; sie steht
-- so, weil der Widerruf die Zeilen betrifft, die es geben KANN, und die Sperre die Zusage ist, die
-- unabhängig davon gilt.
create function public.suppress_email_and_withdraw_all(p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_count integer := 0;
begin
  if p_lead_id is null then
    return jsonb_build_object('outcome', 'suppressed', 'withdrawn_count', 0);
  end if;

  select l.email into v_email
  from platform.leads l
  where l.id = p_lead_id;

  if v_email is null then
    -- Ohne bekannten Lead gibt es keine Adresse, die man sperren könnte. Trotzdem dieselbe Antwort:
    -- ein manipulierter Abmeldelink darf nicht die Auskunft „diesen Lead gibt es nicht" liefern.
    return jsonb_build_object('outcome', 'suppressed', 'withdrawn_count', 0);
  end if;

  update platform.consents c
     set status       = 'withdrawn',
         withdrawn_at = now()
   where c.lead_id = p_lead_id
     and c.status in ('pending', 'confirmed');

  get diagnostics v_count = row_count;

  insert into platform.email_suppressions (email_hash, reason)
  values (platform.email_hash(v_email), 'unsubscribed')
  on conflict (email_hash) do nothing;

  return jsonb_build_object('outcome', 'suppressed', 'withdrawn_count', v_count);
end;
$$;

comment on function public.suppress_email_and_withdraw_all(uuid) is
  'B1-2: „keine E-Mails mehr von COOLiN" — widerruft ALLE Zwecke des Leads und schreibt die Adresse '
  'als SHA-256 (platform.email_hash) mit reason=unsubscribed in die Sperrliste. Der Eintrag trägt '
  'nur den Hash und hat keinen FK auf leads: er überlebt jede spätere Lead-Löschung, sonst stünde '
  'die Person nach dem nächsten Import wieder im Verteiler. Neutrale Rückgabe auch bei unbekanntem '
  'Lead. service_role-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 7 — Rechte: erst alles entziehen, dann NUR service_role
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Kein Grant an `authenticated` (der Erfassungspfad ist anonym und kennt keinen eingeloggten
-- Nutzer) und keiner an `anon` (ein Browser-Grant machte das Formular zum offenen Schreibzugang auf
-- den Lead-Bestand). Der Server ruft ausschliesslich mit dem service_role-Key, exakt wie der
-- Stripe-Pfad (T4-3).
revoke all on function public.get_active_consent_text(platform.consent_purpose, text)
  from public, anon, authenticated, service_role;
revoke all on function public.capture_lead(
  text, text, platform.consent_purpose, text, timestamptz, text, text, text, inet, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.get_pending_consent_by_token(text)
  from public, anon, authenticated, service_role;
revoke all on function public.confirm_consent(text)
  from public, anon, authenticated, service_role;
revoke all on function public.withdraw_consent(uuid, platform.consent_purpose)
  from public, anon, authenticated, service_role;
revoke all on function public.suppress_email_and_withdraw_all(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.get_active_consent_text(platform.consent_purpose, text)
  to service_role;
grant execute on function public.capture_lead(
  text, text, platform.consent_purpose, text, timestamptz, text, text, text, inet, text, text
) to service_role;
grant execute on function public.get_pending_consent_by_token(text) to service_role;
grant execute on function public.confirm_consent(text) to service_role;
grant execute on function public.withdraw_consent(uuid, platform.consent_purpose) to service_role;
grant execute on function public.suppress_email_and_withdraw_all(uuid) to service_role;
