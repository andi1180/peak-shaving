-- B2-2: Rückläufer und Beschwerden — der Zustellrand des Systems (Fahrplan_2026.md, Abschnitt B2).
--
-- Diese Migration VERSENDET NICHTS. Sie verarbeitet, was Resend über bereits versendete Mails
-- zurückmeldet: Zustellungen, dauerhafte und vorübergehende Rückläufer, Spam-Beschwerden. Die
-- Kampagnenmechanik (Empfängerliste, gestaffelter Versand, Zustellprotokoll je Kampagne) ist B2-3.
--
-- ── DIE EINE ENTSCHEIDUNG, DIE DIESE MIGRATION TRIFFT ────────────────────────────────────────────
-- Eine BESCHWERDE ist eine Willenserklärung der Person, ein RÜCKLÄUFER ein technisches Ereignis.
-- Beide sperren die Adresse, aber nur die Beschwerde widerruft zusätzlich die Einwilligungen. Wer
-- „Spam" drückt, hat die Erlaubnis faktisch zurückgenommen; wessen Postfach gelöscht wurde, hat
-- gar nichts erklärt — dessen Einwilligung als widerrufen zu führen wäre eine erfundene Handlung
-- (dieselbe Fälschung, die `guard_consent_confirmation` in der Gegenrichtung hart verhindert).
--
-- ── WARUM DER LEDGER KEINE ROHNUTZLAST TRÄGT ────────────────────────────────────────────────────
-- Naheliegend wäre eine `payload jsonb`-Spalte wie bei `platform.stripe_events`. Sie ist hier
-- FALSCH: die Resend-Nutzlast enthält die Empfängeradresse im Klartext (`data.to`) und wäre damit
-- eine ZWEITE, vom Lead unabhängige Kopie personenbezogener Daten. Die müsste bei einer
-- Anonymisierung eigens mitgelöscht werden — und die dafür nötige Ausnahme würde genau den
-- Append-only-Charakter aufweichen, der den Ledger zum Idempotenz-Anker macht. Benannte Spalten
-- statt Rohnutzlast halten die Invariante AUSNAHMSLOS: es gibt keinen Grund, je eine Zeile zu
-- ändern, weil in keiner Zeile je etwas steht, das gelöscht werden müsste.
-- (Der Unterschied zu `stripe_events`: dort ist die Nutzlast bewusst NICHT user-gebunden und der
-- Personenbezug lebt in den kaskadierenden Nutzer-Tabellen. Hier IST der Empfänger der Inhalt.)
--
-- Enthält ein Anbieter-Freitext (`bounce.message`) eine Adresse, wird sie beim SCHREIBEN entfernt —
-- nicht beim Lesen: was nie in der Tabelle steht, kann auch nicht vergessen werden.
--
-- ── KONVENTIONEN (wie B1/B4-1/B2-1) ─────────────────────────────────────────────────────────────
-- Alles im `platform`-Schema (nicht über PostgREST exponiert), Zugriff ausschliesslich über
-- SECURITY-DEFINER-Wrapper in `public`, alle Funktionen `SET search_path = ''`, explizite Grants,
-- `anon` nirgends.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — platform.email_events: der Ereignis-Ledger
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Muster exakt `platform.stripe_events` (T4-1): der Primärschlüssel IST die Ereigniskennung des
-- Anbieters, ein zweites Insert derselben Kennung schlägt fehl — genau der Idempotenz-Mechanismus,
-- den der Webhook braucht. Webhooks wiederholen sich (Resend wiederholt jede Nicht-2xx-Antwort);
-- ein zweimal verarbeitetes Ereignis darf nicht zweimal wirken.
--
-- Die Kennung ist die `svix-id`-Kopfzeile und NICHT ein Feld der Nutzlast: die Resend-Nutzlast trägt
-- gar keine Ereignis-ID (nur `data.email_id`, das die MAIL identifiziert — mehrere Ereignisse
-- derselben Mail teilen sie sich und wären damit nicht unterscheidbar). Die Anbieter-Dokumentation
-- nennt `svix-id` ausdrücklich als „unique identifier for each event delivery. Store processed
-- svix-id values and skip any duplicates."
create table platform.email_events (
  -- Anbieter-Ereigniskennung (svix-id). text, weil das Format dem Anbieter gehört.
  id text primary key,
  -- z. B. 'email.delivered', 'email.bounced', 'email.complained'. Kein Enum und kein CHECK: das
  -- Vokabular gehört dem ANBIETER, nicht uns (Gegenstück zu platform.consent_purpose, wo wir es
  -- kontrollieren). Ein CHECK würde eine künftige neue Ereignisart in eine Datenbankausnahme
  -- verwandeln — und damit in eine 500-Antwort, die Resend endlos wiederholt.
  event_type text not null,
  -- SHA-256 der normalisierten Adresse (platform.email_hash). BEWUSST KEIN KLARTEXT: siehe Kopf.
  -- Dieselbe Funktion wie platform.email_suppressions — ein Ereignis lässt sich damit einem
  -- Sperrlisteneintrag zuordnen, ohne dass eine der beiden Tabellen die Adresse hergibt.
  email_hash text not null,
  -- Beim SCHREIBEN aufgelöst, sofern ein Lead existiert. `on delete set null` und nicht `cascade`:
  -- der Ledger ist ein Protokoll über Vorgänge, nicht über Personen — dass an einem 3. Oktober ein
  -- dauerhafter Rückläufer eintraf, bleibt wahr, auch wenn der Lead später verschwindet. Die
  -- ZUSCHREIBUNG entfällt dann, das Ereignis nicht (dieselbe Lesart wie `anonymized_by`, B1-3).
  -- Anonymisierte Leads werden gar nicht erst getroffen: ihre gespeicherte Adresse ist der
  -- Platzhalter `anonymized+<id>@invalid`, die Verbindung ist absichtlich durchtrennt.
  lead_id uuid references platform.leads (id) on delete set null,
  -- Die Klassifikation des Anbieters, unverändert übernommen: 'Permanent' | 'Transient' |
  -- 'Undetermined' bzw. 'General' | 'NoEmail' | 'Suppressed' | 'MailboxFull' | 'MessageTooLarge' |
  -- 'ContentRejected' | 'AttachmentRejected'. Ohne CHECK, aus demselben Grund wie bei event_type.
  bounce_type text,
  bounce_subtype text,
  -- Freitext des Anbieters, VOR dem Schreiben von Adressen bereinigt (s. platform.strip_emails).
  reason text,
  -- Zeitstempel des ANBIETERS (payload.created_at). Nullable: nicht jede Nutzlast trägt ihn, und
  -- ein erfundener Ersatzwert wäre schlechter als eine ehrliche Lücke.
  occurred_at timestamptz,
  -- Wann WIR es entgegengenommen haben. `clock_timestamp()` und nicht `now()`: `now()` ist die
  -- TRANSAKTIONSzeit und in einer Transaktion konstant — zwei Ereignisse derselben Transaktion
  -- (im DB-Gate der Normalfall) trügen denselben Zeitpunkt und wären nicht mehr ordenbar.
  -- Derselbe Befund wie bei platform.job_runs (B4-1) und platform.admin_exports (B2-1).
  received_at timestamptz not null default clock_timestamp()
);

comment on table platform.email_events is
  'B2-2: Append-only-Ledger der Zustellereignisse von Resend (Versand, Zustellung, Rückläufer, '
  'Beschwerde). PK = Ereigniskennung des Anbieters (svix-id-Kopfzeile) — ein zweites Insert '
  'derselben Kennung scheitert, und genau das ist die Idempotenz des Webhooks. UPDATE/DELETE sind '
  'zusätzlich per Trigger geblockt. Trägt BEWUSST KEINE Rohnutzlast: die enthielte die '
  'Empfängeradresse im Klartext und wäre eine zweite, eigens zu löschende Kopie personenbezogener '
  'Daten — die dafür nötige Ausnahme würde den Append-only-Charakter aufweichen.';

comment on column platform.email_events.id is
  'Die Ereigniskennung des Anbieters (svix-id-Kopfzeile). NICHT data.email_id: das identifiziert die '
  'MAIL, und mehrere Ereignisse derselben Mail teilen sie sich — als Idempotenzschlüssel würde es '
  'die Zustellung einer Mail und ihren späteren Rückläufer als Duplikat verwerfen.';

comment on column platform.email_events.email_hash is
  'SHA-256 der normalisierten Empfängeradresse (platform.email_hash) — dieselbe Funktion wie '
  'platform.email_suppressions. Kein Klartext: der Ledger soll kein zweiter Adressbestand sein.';

comment on column platform.email_events.lead_id is
  'Beim Schreiben aufgelöst, sofern ein Lead mit dieser Adresse existiert; sonst null. Der Webhook '
  'legt NIEMALS einen Lead an. ON DELETE SET NULL: das Ereignis bleibt wahr, auch wenn der Lead '
  'verschwindet — nur die Zuschreibung entfällt.';

comment on column platform.email_events.reason is
  'Freitext des Anbieters (bounce.message). Von Adressen bereinigt (platform.strip_emails) BEVOR er '
  'gespeichert wird — nicht erst beim Anzeigen: was nie in der Tabelle steht, muss auch nie '
  'vergessen werden.';

comment on column platform.email_events.received_at is
  'Zeitpunkt der Entgegennahme. clock_timestamp() statt now(): zwei Ereignisse derselben '
  'Transaktion wären mit der Transaktionszeit nicht ordenbar (Befund aus B4-1).';

-- Der Zugriffspfad der Detailseite: „die Zustellereignisse DIESES Leads, neueste zuerst".
create index email_events_lead_received_idx
  on platform.email_events (lead_id, received_at desc);

-- Der Zugriffspfad der Auswertung: „wie viele Beschwerden in den letzten 30 Tagen".
create index email_events_type_received_idx
  on platform.email_events (event_type, received_at desc);

-- ── Append-only: Muster reject_stripe_event_mutation (T4-1) ──────────────────────────────────────
-- Kein transaktionslokales Schlupfloch (anders als guard_entitlement_stripe_source, das ein
-- `current_setting`-Flag kennt — dort MUSS ein Trigger schreiben dürfen, hier muss niemand).
-- Zusätzlich zum fehlenden update/delete-Grant, weil das Grant gegen BYPASSRLS-Rollen (service_role)
-- und gegen künftige Grant-Fehler nicht schützt.
--
-- ── DIE EINE, BEGRÜNDETE AUSNAHME: `lead_id` DARF GENULLT WERDEN ────────────────────────────────
-- Beim ersten Testlauf gefunden, nicht vorausgedacht: `lead_id` trägt ON DELETE SET NULL, und diese
-- REFERENTIELLE AKTION IST EIN UPDATE auf die Ledger-Zeile. Ein ausnahmsloser Trigger machte damit
-- jeden Lead, zu dem je ein Zustellereignis einging, UNLÖSCHBAR — also ausgerechnet die Person, an
-- die tatsächlich etwas versendet wurde, und ausgerechnet gegen ein Löschverlangen.
--
-- Strukturell derselbe Fall wie `last_edited_by` in `guard_anonymized_lead` (B2-1), und die Antwort
-- ist dieselbe: die Ausnahme ist so eng wie möglich. Erlaubt ist AUSSCHLIESSLICH das Nullen von
-- `lead_id` bei sonst BIT-IDENTISCHER Zeile (`to_jsonb`-Vergleich ohne dieses eine Feld). Nicht
-- erlaubt: es zu setzen, es auf einen anderen Lead umzuhängen, oder es zu nullen und dabei irgend
-- etwas anderes mitzuändern.
--
-- Die Append-only-Zusage bleibt damit vollständig: sie gilt dem INHALT des Ereignisses — was, wann,
-- an welchen Hashwert. Die Zuschreibung zu einem Lead ist kein Inhalt, sondern ein Verweis, und der
-- verschwindet mit seinem Ziel. Genau das ist die Absicht von ON DELETE SET NULL.
create function platform.reject_email_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.lead_id is null
     and old.lead_id is not null
     and to_jsonb(new) - 'lead_id' = to_jsonb(old) - 'lead_id'
  then
    return new;
  end if;

  raise exception
    'platform.email_events ist append-only (Ereignis-Ledger, B2-2) — % nicht erlaubt',
    tg_op;
end;
$$;

comment on function platform.reject_email_event_mutation is
  'B2-2: blockt UPDATE/DELETE auf email_events hart (append-only Ereignis-Ledger). Greift auch '
  'gegen service_role und postgres. GENAU EINE Ausnahme: das Nullen von lead_id bei sonst '
  'unveränderter Zeile — die referentielle Aktion ON DELETE SET NULL ist selbst ein UPDATE, und '
  'ohne die Ausnahme wäre jeder Lead mit Zustellereignissen unlöschbar (dieselbe Asymmetrie wie bei '
  'last_edited_by in guard_anonymized_lead, B2-1). Das SETZEN und das Umhängen bleiben gesperrt: '
  'die Append-only-Zusage gilt dem INHALT des Ereignisses, nicht dem Verweis auf einen Lead.';

create trigger email_events_no_update
  before update on platform.email_events
  for each row execute function platform.reject_email_event_mutation();

create trigger email_events_no_delete
  before delete on platform.email_events
  for each row execute function platform.reject_email_event_mutation();

-- ── platform.anonymize_lead wird NICHT erweitert ─────────────────────────────────────────────────
-- Bewusste Entscheidung, nicht Vergessen. Zwei Gründe:
--   1. Der Ledger trägt keinen Klartext — es gibt in ihm nichts zu anonymisieren. Der Fremdschlüssel
--      `lead_id` verschwindet ohnehin mit dem Lead (ON DELETE SET NULL); bei der Anonymisierung
--      bleibt er stehen, und genau das ist richtig: die Zeile enthält dann nur noch einen Hash und
--      einen Verweis auf einen Lead, der selbst keine Identitätsmerkmale mehr trägt.
--   2. Der HASHWERT bleibt aus DEMSELBEN Grund bestehen wie der Eintrag in
--      `platform.email_suppressions` (B1-1): bei einem harten Rückläufer steht die Adresse ohnehin
--      dauerhaft auf der Sperrliste — und eine Sperre, die mit dem Lead verschwindet, ist keine.
--      Ein Ledger, der beim Anonymisieren mitgelöscht würde, könnte hinterher nicht mehr belegen,
--      WARUM gesperrt wurde.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — Verarbeitung
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

-- ── strip_emails: Adressen aus Anbieter-Freitext entfernen ───────────────────────────────────────
-- Entfernt JEDES adressförmige Token, nicht nur die bekannte Empfängeradresse. Der schärfere Schnitt
-- ist Absicht: eine Bounce-Meldung kann die Adresse in abweichender Schreibweise enthalten, eine
-- Alias-Adresse desselben Postfachs nennen oder gleich die des Postmasters — ein Abgleich gegen die
-- eine bekannte Adresse liesse genau diese Fälle stehen, und zwar unbemerkt.
create function platform.strip_emails(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_text is null then null
    -- 500 Zeichen: die Meldung ist ein Diagnosehinweis, kein Archiv. Der Schnitt steht NACH dem
    -- Entfernen der Adressen — sonst könnte eine abgeschnittene Adresse stehen bleiben.
    else left(regexp_replace(p_text, '[^[:space:]]+@[^[:space:]]+', '[Adresse entfernt]', 'g'), 500)
  end;
$$;

comment on function platform.strip_emails(text) is
  'B2-2: entfernt adressförmige Token aus Anbieter-Freitext, bevor er im Ledger landet. Schneidet '
  'bewusst breiter als „die bekannte Empfängeradresse": eine Bounce-Meldung kann eine abweichende '
  'Schreibweise, einen Alias oder die Postmaster-Adresse enthalten — ein gezielter Abgleich liesse '
  'genau die stehen. Kürzt anschliessend auf 500 Zeichen (Diagnosehinweis, kein Archiv).';

-- ── is_permanent_bounce: EINE Definition von „dauerhaft" ─────────────────────────────────────────
-- Benutzt von record_email_event (entscheidet die SPERRE) UND von admin_email_event_stats (zählt die
-- Frühwarnung). Zwei eigene Bedingungen wären zwei Auslegungen desselben Begriffs, und die
-- Abweichung fiele erst an einer Auswertung auf, die andere Zahlen zeigt als die Wirkung, die sie
-- beschreibt. Dieselbe Begründung wie `platform.leads_matching` (B2-1) und
-- `leads_due_for_contract_reminder` (B4-1).
--
-- ── DIE KLASSIFIKATION DES ANBIETERS, GEGEN DIE DOKUMENTATION GEPRÜFT ───────────────────────────
-- Resend trennt zwei Wege: ein HARTER Rückläufer kommt als `email.bounced` (Dokumentation wörtlich:
-- „the recipient's mail server permanently rejected the email"), ein WEICHER als
-- `email.delivery_delayed` — der trägt gar kein `bounce`-Objekt und ist damit strukturell nie
-- dauerhaft. Innerhalb von `email.bounced` steht die Feinklassifikation in `data.bounce.type`
-- ('Permanent' | 'Transient' | 'Undetermined').
--
-- Fehlt `bounce.type`, gilt der Rückläufer als DAUERHAFT: die Ereignisart selbst ist bereits die
-- Aussage „dauerhaft abgelehnt", eine fehlende Unterklassifikation widerspricht ihr nicht.
-- Steht dort ausdrücklich 'Transient' oder 'Undetermined', gilt sie NICHT: eine ausdrückliche
-- Aussage des Anbieters schlägt die Vorgabe der Ereignisart. 'Undetermined' („die Bounce-Meldung
-- enthielt nicht genug Information") wird dabei wie vorübergehend behandelt — die Abwägung ist
-- asymmetrisch: eine zu Unrecht gesperrte Adresse ist ohne Weg zurück verloren, eine zu spät
-- gesperrte erzeugt beim nächsten harten Rückläufer die richtige Sperre.
create function platform.is_permanent_bounce(p_event_type text, p_bounce_type text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_event_type = 'email.bounced'
     and (p_bounce_type is null or lower(p_bounce_type) = 'permanent');
$$;

comment on function platform.is_permanent_bounce(text, text) is
  'B2-2: die EINE Definition von „dauerhafter Rückläufer" — benutzt von public.record_email_event '
  '(Sperre) und public.admin_email_event_stats (Frühwarnung). email.bounced, sofern bounce.type '
  'fehlt oder Permanent lautet. Ein weicher Rückläufer kommt bei Resend als email.delivery_delayed '
  'und trägt gar kein bounce-Objekt; ein ausdrückliches Transient/Undetermined schlägt die Vorgabe '
  'der Ereignisart (lieber zu spät sperren als eine echte Adresse unwiederbringlich verlieren).';

-- ── record_email_event: EIN atomarer Wrapper ─────────────────────────────────────────────────────
-- Ledger-Eintrag UND Wirkung in DERSELBEN Transaktion — dieselbe Begründung wie beim Stripe-Wrapper
-- (T4-3): zwei getrennte Aufrufe wären zwei Transaktionen, und schlüge die Wirkung nach dem bereits
-- committeten Ledger-Eintrag fehl, sähe die Wiederholung des Anbieters ein Duplikat und übersprünge
-- die Wirkung ENDGÜLTIG. Hier hiesse das: eine Beschwerde ist protokolliert, aber die Adresse nicht
-- gesperrt — und niemand erführe je davon.
--
-- ── DER WEBHOOK LEGT NIEMALS EINEN LEAD AN ──────────────────────────────────────────────────────
-- Ist die Adresse unbekannt, entstehen die Ledger-Zeile und gegebenenfalls der Sperreintrag über den
-- HASHWERT — mehr nicht. Ein Lead ist ein Kontakt, den jemand hinterlassen hat; aus einem
-- Zustellfehler einen zu erzeugen hiesse, einen Bestand aus Adressen aufzubauen, die uns nie jemand
-- gegeben hat. Genau für diesen Fall ist `platform.email_suppressions` seit B1-1 ohne Fremdschlüssel
-- gebaut: die Sperre braucht keinen Lead.
create function public.record_email_event(
  p_event_id text,
  p_event_type text,
  p_email text,
  p_occurred_at timestamptz default null,
  p_bounce_type text default null,
  p_bounce_subtype text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead_id   uuid;
  v_effect    text := 'none';
  v_withdrawn integer := 0;
  v_result    jsonb;
begin
  -- Ohne Kennung gäbe es keine Idempotenz, ohne Adresse keinen Hash: beides ist Voraussetzung, nicht
  -- Beiwerk. Laut scheitern statt eine wirkungslose Zeile anzulegen — der Endpunkt antwortet dann
  -- 500 und der Anbieter wiederholt (was bei einer fehlerhaften Nutzlast folgenlos bleibt, aber
  -- sichtbar).
  if p_event_id is null or p_event_type is null or coalesce(trim(p_email), '') = '' then
    raise exception
      'public.record_email_event: Ereigniskennung, Ereignisart und Empfängeradresse sind Pflicht'
      using errcode = '22023';
  end if;

  -- Zuordnung VOR dem Insert, damit die Ledger-Zeile sie trägt. Über den normalisierten Wert (der
  -- gespeicherte ist bereits normalisiert, B1-1) — das ist zugleich der eindeutige Index.
  select l.id into v_lead_id
  from platform.leads l
  where platform.normalize_email(l.email) = platform.normalize_email(p_email);

  -- 1. IDEMPOTENZ ZUERST (Muster T4-3): die Kennung ist der PK. Greift der Konflikt, ist FOUND
  --    false — das Ereignis war schon da, und es passiert NICHTS weiter.
  insert into platform.email_events (
    id, event_type, email_hash, lead_id, bounce_type, bounce_subtype, reason, occurred_at
  )
  values (
    p_event_id,
    p_event_type,
    platform.email_hash(p_email),
    v_lead_id,
    p_bounce_type,
    p_bounce_subtype,
    platform.strip_emails(p_reason),
    p_occurred_at
  )
  on conflict (id) do nothing;

  if not found then
    return jsonb_build_object('outcome', 'duplicate', 'effect', 'none');
  end if;

  -- 2. Wirkung je Art.
  if p_event_type = 'email.complained' then
    -- BESCHWERDE: sperren UND alle Einwilligungen widerrufen. Wer eine Beschwerde ausgelöst hat, hat
    -- die Einwilligung faktisch widerrufen; der fortgesetzte Empfang ist genau das, was eine
    -- Absenderdomain sperren lässt. Kein Schwellwert, keine Zählung — eine einzige Beschwerde
    -- genügt, weil sie eine Erklärung ist und keine Messung.
    --
    -- REIHENFOLGE IST HIER BEDEUTUNG, NICHT GESCHMACK: der Sperreintrag entsteht ZUERST mit
    -- reason='complaint'. Danach übernimmt public.suppress_email_and_withdraw_all (B1-2) den
    -- Widerruf — dessen eigener Sperr-Insert läuft dann in den Konflikt und tut nichts. Umgekehrt
    -- stünde in der Sperrliste 'unsubscribed', und der Grund für die schärfste Wirkung des Systems
    -- wäre falsch protokolliert. Der Widerruf läuft trotzdem über den BESTEHENDEN Pfad: „alle
    -- offenen und bestätigten Zeilen jedes Zwecks" ist dort definiert, und zwei Definitionen von
    -- „widerrufen" fielen erst beim ersten Massenversand auf.
    insert into platform.email_suppressions (email_hash, reason)
    values (platform.email_hash(p_email), 'complaint')
    on conflict (email_hash) do nothing;

    if v_lead_id is not null then
      select coalesce((public.suppress_email_and_withdraw_all(v_lead_id) ->> 'withdrawn_count')::int, 0)
        into v_withdrawn;
    end if;

    v_effect := 'suppressed_and_withdrawn';

  elsif platform.is_permanent_bounce(p_event_type, p_bounce_type) then
    -- DAUERHAFTER RÜCKLÄUFER: sperren, aber KEINEN Widerruf. Ein technisches Zustellversagen ist
    -- keine Willenserklärung der Person — sie hat nichts zurückgenommen. Die Einwilligung bleibt
    -- deshalb stehen (und bleibt wirkungslos, solange die Sperre gilt; jede Aussendung fragt seit
    -- B1-1 BEIDE Bedingungen ab). Wird die Adresse später wieder erreichbar, ist das der
    -- Unterschied zwischen „muss neu einwilligen" und „war nie weg".
    insert into platform.email_suppressions (email_hash, reason)
    values (platform.email_hash(p_email), 'bounced')
    on conflict (email_hash) do nothing;

    v_effect := 'suppressed';

  else
    -- VORÜBERGEHENDER RÜCKLÄUFER (email.delivery_delayed bzw. bounce.type <> Permanent),
    -- ZUSTELLUNG und VERSAND: nur Ledger, KEINE Sperre. Ein volles Postfach oder eine kurzzeitige
    -- Störung ist kein dauerhaftes Versagen; eine Sperre darauf verliert echte Kontakte
    -- unwiederbringlich — es gibt für sie bewusst keinen Weg über die Oberfläche zurück (TEIL 5).
    v_effect := 'none';
  end if;

  v_result := jsonb_build_object(
    'outcome', 'recorded',
    'effect', v_effect,
    'lead_known', v_lead_id is not null,
    'withdrawn_count', v_withdrawn
  );

  return v_result;
end;
$$;

comment on function public.record_email_event(text, text, text, timestamptz, text, text, text) is
  'B2-2: nimmt EIN Zustellereignis von Resend entgegen — Ledger-Eintrag und Wirkung atomar in einer '
  'Transaktion (Begründung wie beim Stripe-Wrapper T4-3: getrennt committet gälte ein Ereignis bei '
  'fehlgeschlagener Wirkung als verarbeitet, und die Wiederholung würde als Duplikat verworfen). '
  'Beschwerde → dauerhafte Sperre (reason=complaint) UND Widerruf aller Einwilligungen über den '
  'B1-2-Pfad; dauerhafter Rückläufer → Sperre (reason=bounced) OHNE Widerruf (ein technisches '
  'Zustellversagen ist keine Willenserklärung); vorübergehender Rückläufer, Zustellung, Versand → '
  'nur Ledger. Bekannte Kennung → outcome=duplicate ohne jede Wirkung. LEGT NIEMALS EINEN LEAD AN. '
  'Der Sperreintrag ist idempotent — der zuerst festgestellte Grund bleibt stehen. service_role-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — Lesen: zwei Wrapper, authenticated-only
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Beide WERFEN bei fehlender Adminrolle (42501) statt einer leeren Antwort — dieselbe Regel wie in
-- B1-1: „kein Zugriff" darf sich nie als „keine Ereignisse" lesen lassen. Bei diesen zwei Wrappern
-- ist die leere Antwort sogar eine ECHTE, häufige Aussage („zu diesem Lead ist nichts zurückgekommen"
-- ist der Normalfall) — die Verwechslung wäre also besonders naheliegend.

create function public.admin_list_email_events(
  p_lead_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_events jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_list_email_events: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.received_at desc), '[]'::jsonb)
    into v_events
  from (
    select ev.id,
           ev.event_type,
           ev.lead_id,
           ev.bounce_type,
           ev.bounce_subtype,
           ev.reason,
           ev.occurred_at,
           ev.received_at,
           -- Die Sperrwirkung MIT ausliefern, statt sie in der Oberfläche aus Art und Typ
           -- nachzubauen: dort wäre sie eine dritte Auslegung von „dauerhaft" und könnte von dem
           -- abweichen, was tatsächlich gesperrt hat.
           platform.is_permanent_bounce(ev.event_type, ev.bounce_type) as is_permanent_bounce
    from platform.email_events ev
    where p_lead_id is null or ev.lead_id = p_lead_id
    order by ev.received_at desc
    limit v_limit
  ) e;

  return jsonb_build_object('status', 'ok', 'events', v_events);
end;
$$;

comment on function public.admin_list_email_events(uuid, integer) is
  'B2-2: die Zustellereignisse eines Leads (p_lead_id => null: alle, neueste zuerst). Liefert die '
  'Sperrwirkung (is_permanent_bounce) MIT, damit die Oberfläche sie nicht ein zweites Mal auslegen '
  'muss. Enthält bewusst KEINE Adresse — der Ledger führt nur den Hashwert. WIRFT bei fehlender '
  'Adminrolle (42501): eine leere Liste ist hier die häufigste ECHTE Antwort und darf nicht '
  'zugleich „kein Zugriff" bedeuten. authenticated-only.';

-- ── admin_email_event_stats: die Frühwarnung ─────────────────────────────────────────────────────
-- Eine steigende Beschwerdequote ist die einzige Frühwarnung vor einem Reputationsschaden, und
-- niemand sucht von sich aus danach. Deshalb steht die Zahl auf der Übersichtsseite und nicht in
-- einer eigenen Auswertung, die man erst aufrufen müsste.
--
-- Die Zählung liefert BEIDES: die rohen Zahlen je Ereignisart (was kam an) und die zwei
-- fachlich entscheidenden Grössen — dauerhafte Rückläufer und Beschwerden. Die zweite Gruppe ist
-- NICHT aus der ersten ableitbar: `email.bounced` enthält auch vorübergehende Rückläufer, und die
-- Trennung darf nur an EINER Stelle getroffen werden (platform.is_permanent_bounce).
create function public.admin_email_event_stats(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- 1..365: unter einem Tag wäre der Zeitraum aussagelos, über einem Jahr keine Frühwarnung mehr.
  v_days   integer := least(greatest(coalesce(p_days, 30), 1), 365);
  v_since  timestamptz := now() - make_interval(days => v_days);
  v_counts jsonb;
  v_perm   integer;
  v_compl  integer;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_email_event_stats: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.event_count desc, c.event_type), '[]'::jsonb)
    into v_counts
  from (
    select ev.event_type, count(*)::int as event_count
    from platform.email_events ev
    where ev.received_at >= v_since
    group by ev.event_type
  ) c;

  select count(*) filter (where platform.is_permanent_bounce(ev.event_type, ev.bounce_type))::int,
         count(*) filter (where ev.event_type = 'email.complained')::int
    into v_perm, v_compl
  from platform.email_events ev
  where ev.received_at >= v_since;

  return jsonb_build_object(
    'status', 'ok',
    -- Der VERWENDETE Zeitraum fährt mit, nicht der angefragte: sonst könnte die Oberfläche „letzte
    -- 30 Tage" behaupten, während gezählt wurde, was die Funktion für zulässig hielt. Derselbe
    -- Grund wie bei stale_after_hours in admin_contract_reminder_health (B4-2).
    'days', v_days,
    'since', v_since,
    'counts', v_counts,
    'permanent_bounces', coalesce(v_perm, 0),
    'complaints', coalesce(v_compl, 0)
  );
end;
$$;

comment on function public.admin_email_event_stats(integer) is
  'B2-2: Anzahl je Ereignisart im Zeitraum, plus die zwei fachlich entscheidenden Grössen '
  '(dauerhafte Rückläufer und Beschwerden). Die zweite Gruppe ist NICHT aus der ersten ableitbar — '
  'email.bounced enthält auch vorübergehende Rückläufer, und die Trennung steht nur in '
  'platform.is_permanent_bounce. Der VERWENDETE Zeitraum fährt in der Antwort mit, damit die '
  'Oberfläche keine andere Zahl behaupten kann als die gezählte. WIRFT bei fehlender Adminrolle '
  '(42501). authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — admin_get_lead: den GRUND der Sperre sichtbar machen
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Bisher lieferte der Wrapper nur `is_suppressed` (ja/nein). Das genügt nicht mehr: mit B2-2 gibt es
-- DREI Wege auf die Sperrliste — Abmeldung durch die Person, dauerhafter Rückläufer, Beschwerde —
-- und sie bedeuten Verschiedenes. „Gesperrt, weil sich jemand abgemeldet hat" ist ein normaler
-- Vorgang; „gesperrt, weil eine Beschwerde einging" ist der Anlass, die eigene Aussendung zu
-- überprüfen. Ohne den Grund sähen beide gleich aus, und ausgerechnet die Beschwerde wäre unsichtbar.
--
-- Der Grund kommt aus `platform.email_suppressions` und NICHT aus dem Ereignis-Ledger: eine
-- Abmeldung über den Link erzeugt gar kein Ereignis (B1-2), und die Sperrliste ist ohnehin die eine
-- Stelle, die vor jedem Versand befragt wird. Bei einem ANONYMISIERTEN Lead bleibt der Wert null —
-- die gespeicherte Adresse ist dann der Platzhalter, die Zuordnung ist absichtlich durchtrennt, und
-- die Oberfläche sagt weiterhin „nicht mehr ermittelbar" statt einer erfundenen Auskunft.
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
           ld.anonymized_by_system,
           (select au.email from auth.users au where au.id = ld.anonymized_by)
             as anonymized_by_email,
           ld.last_edited_by,
           (select au.email from auth.users au where au.id = ld.last_edited_by)
             as last_edited_by_email,
           ld.industry,
           ld.postal_code,
           ld.annual_consumption_kwh,
           ld.metering_type,
           ld.supplier,
           ld.contract_end_date,
           ld.created_at,
           ld.updated_at,
           platform.is_suppressed(ld.email) as is_suppressed,
           -- B2-2: WARUM gesperrt. Nicht aus dem Ereignis-Ledger abgeleitet (eine Abmeldung über
           -- den Link erzeugt kein Ereignis), sondern aus der Liste selbst.
           (select s.reason
              from platform.email_suppressions s
             where s.email_hash = platform.email_hash(ld.email)) as suppression_reason,
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
    'status', 'ok', 'lead', v_lead, 'consents', v_consents, 'contract_reminders', v_reminders
  );
end;
$$;

comment on function public.admin_get_lead(uuid) is
  'B1-1, erweitert in B1-3, B3-1, B4-1, B4-2, B2-1 und B2-2: ein Lead samt allen Einwilligungen '
  '(inkl. angezeigtem Textkörper, Version/Sprache und effective_status), den sechs '
  'Segmentierungsmerkmalen, der Urheberschaft einer Anonymisierung, dem Versandprotokoll der '
  'Vertragsablauf-Erinnerung, last_edited_by samt Konto-E-Mail und seit B2-2 dem GRUND einer Sperre '
  '(suppression_reason: unsubscribed | bounced | complaint | manual; null, wenn nicht gesperrt oder '
  'der Lead anonymisiert ist). token_hash/token_expires_at fahren bewusst nicht mit. WIRFT bei '
  'fehlender Adminrolle (42501); ein unbekannter Lead ist ein fachlicher Zustand. authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 5 — RLS und Rechte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Muster platform.job_runs (B4-1) und platform.admin_exports (B2-1): RLS an, KEINE Policy, für
-- KEINE Rolle ein Grant — auch nicht für service_role. Zwei unabhängige Schichten: ohne Policy sähe
-- selbst eine Rolle nichts, der jemand später versehentlich ein Tabellen-Grant gäbe. Geschrieben
-- wird ausschliesslich aus public.record_email_event, gelesen ausschliesslich über die zwei
-- admin-Wrapper.
alter table platform.email_events enable row level security;

-- Die platform-Funktionen sind KEIN öffentlicher Zugriffsweg: PostgreSQL grantet EXECUTE an PUBLIC
-- per Voreinstellung — hier bei jeder neu angelegten Funktion entzogen.
revoke all on function platform.strip_emails(text) from public;
revoke all on function platform.is_permanent_bounce(text, text) from public;
revoke all on function platform.reject_email_event_mutation() from public;

-- Die drei neuen public-Funktionen: Supabases ALTER DEFAULT PRIVILEGES hat ihnen EXECUTE an anon,
-- authenticated UND service_role gegeben (zusätzlich zum PostgreSQL-Default an PUBLIC). Erst allen
-- entziehen, dann gezielt gewähren.
--
-- record_email_event ist service_role-only: der Webhook weist sich mit einer Signatur aus, nicht mit
-- einer Sitzung — er hat keinen eingeloggten Nutzer, und ein Grant an `authenticated` machte die
-- dauerhafte Sperre einer beliebigen Adresse zu einer Funktion, die jedes angemeldete Konto aufrufen
-- könnte. `anon` nirgends.
revoke all on function public.record_email_event(text, text, text, timestamptz, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_email_event(text, text, text, timestamptz, text, text, text)
  to service_role;

revoke all on function public.admin_list_email_events(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_list_email_events(uuid, integer) to authenticated;

revoke all on function public.admin_email_event_stats(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_email_event_stats(integer) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 6 — Was es hier BEWUSST NICHT GIBT
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- KEIN Wrapper, der eine Sperre AUFHEBT. Entsperren ist der Sache nach Erteilen, und die Regel aus
-- B1-3 lautet: der Admin kann widerrufen, nie erteilen. Eine Schaltfläche „doch wieder zustellen"
-- wäre der Weg, auf dem eine Beschwerde — die schärfste Rückmeldung, die eine Person geben kann —
-- mit einem Klick verschwindet. Ein begründeter Einzelfall (nachweislicher Fehl-Bounce eines
-- Firmenpostfachs) bleibt ein bewusster Eingriff in der Datenbank, mit allem, was dazugehört: er
-- muss angefordert, ausgeführt und erklärt werden, statt nebenbei zu passieren.
--
-- KEINE Kampagnenzuordnung. Die Ledger-Zeile weiss nicht, zu welcher Aussendung eine Mail gehörte —
-- das Zustellprotokoll je Kampagne ist B2-3 und braucht ein Kampagnenmodell, das es noch nicht gibt.
-- Ein hier schon angelegtes `campaign_id` wäre eine Spalte, die nie gefüllt wird, und beim Bau von
-- B2-3 stünde sie im Weg (append-only: sie liesse sich nicht nachträglich befüllen).
