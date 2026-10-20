-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Leadgen-Umbau Schritt 3b-2 — Schnellreport per E-Mail
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- 1. Herkunft 'schnellreport' (eigene Server Action, kein Formular der Lead-Registry).
-- 2. Einwilligungstexte können an eine Herkunft gebunden sein (`consent_texts.source_key`). Der
--    Schnellreport zeigt eigene Wortlaute (Tipp-Mails, Telefonfrage); eine neue allgemeine Fassung
--    von `offer_contact` würde sonst auch im Report-Download von `apps/website` angezeigt und
--    archiviert. Auswahlregel an EINER Stelle: `platform.active_consent_text_id`.
-- 3. `platform.schnellreport_requests`: die Schnellcheck-Werte je versandtem Report (Land, Branche
--    und Rechenwerte haben am Lead keine Spalte) und die Sperre gegen Doppelversand.
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

-- ── TEIL 1 — Herkunft ────────────────────────────────────────────────────────────────────────────
insert into platform.lead_sources (key, label) values
  ('schnellreport', 'Schnellcheck — Schnellreport per E-Mail')
on conflict (key) do nothing;

-- ── TEIL 2 — herkunftsgebundene Einwilligungstexte ───────────────────────────────────────────────
-- Nullable: alle bestehenden Fassungen bleiben allgemein. Das Hinzufügen der Spalte ändert keine
-- Zeile, der Append-only-Trigger greift deshalb nicht.
alter table platform.consent_texts
  add column source_key text references platform.lead_sources (key);

comment on column platform.consent_texts.source_key is
  'Leadgen 3b-2: null = allgemeine Fassung des Zwecks; gesetzt = gilt nur für Einwilligungen aus '
  'dieser Herkunft und hat dort Vorrang. Auswahl ausschliesslich über '
  'platform.active_consent_text_id.';

create function platform.active_consent_text_id(
  p_purpose platform.consent_purpose,
  p_locale text,
  p_source_key text
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ct.id
  from platform.consent_texts ct
  where ct.purpose = p_purpose
    and ct.locale  = coalesce(p_locale, 'de')
    and (ct.source_key is null or ct.source_key = p_source_key)
  order by (ct.source_key is not null) desc, ct.version desc, ct.valid_from desc
  limit 1;
$$;

comment on function platform.active_consent_text_id(platform.consent_purpose, text, text) is
  'Leadgen 3b-2: die anzuzeigende und zu archivierende Textfassung — herkunftsgebundene vor '
  'allgemeiner, je die höchste version. p_source_key null = nur allgemeine Fassungen. Einzige '
  'Auswahlregel für capture_lead, get_active_consent_text und get_source_consent_text.';

revoke all on function platform.active_consent_text_id(platform.consent_purpose, text, text)
  from public, anon, authenticated, service_role;

-- Gleiche Signatur, Grants bleiben. Liefert jetzt ausschliesslich allgemeine Fassungen — sonst
-- zeigte jeder bestehende Aufrufer eine Schnellreport-Fassung an.
create or replace function public.get_active_consent_text(
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
      where ct.id = platform.active_consent_text_id(p_purpose, p_locale, null)
    ),
    jsonb_build_object('status', 'not_found')
  );
$$;

create function public.get_source_consent_text(
  p_purpose platform.consent_purpose,
  p_source_key text,
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
      where ct.id = platform.active_consent_text_id(p_purpose, p_locale, p_source_key)
    ),
    jsonb_build_object('status', 'not_found')
  );
$$;

comment on function public.get_source_consent_text(platform.consent_purpose, text, text) is
  'Leadgen 3b-2: der Wortlaut, den capture_lead für diese Herkunft archivieren wird (dieselbe '
  'Auswahlregel). {status: ok|not_found}. service_role-only.';

revoke all on function public.get_source_consent_text(platform.consent_purpose, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_source_consent_text(platform.consent_purpose, text, text)
  to service_role;

-- Die Fassungen des Schnellreports, wortgleich mit dem Prototyp
-- (`docs/prototypes/schnellreport-prototyp.html`, Abschnitt „1 · Formular"). Version = nächste
-- freie je Zweck (UNIQUE purpose, version, locale), idempotent über den Wortlaut.
insert into platform.consent_texts (purpose, version, locale, body, source_key)
select t.purpose, coalesce(
         (select max(ct.version) from platform.consent_texts ct
           where ct.purpose = t.purpose and ct.locale = 'de'), 0) + 1,
       'de', t.body, 'schnellreport'
from (values
  ('result_delivery'::platform.consent_purpose,
   'Mit dem Absenden erhalten Sie Ihren Schnellreport per E-Mail.'),
  ('marketing_email'::platform.consent_purpose,
   'Ja, schicken Sie mir in den nächsten Wochen Tipps für meinen Betrieb: wie ich meinen Lastgang '
   'bekomme, wie ein Profi-Report aussieht, ein echter Praxisfall. 4 E-Mails, Abmeldung jederzeit.'),
  ('offer_contact'::platform.consent_purpose,
   'Sollen wir Ihnen in 15 Minuten am Telefon erklären, was das für Ihren Betrieb bedeutet?')
) as t(purpose, body)
where not exists (
  select 1 from platform.consent_texts ct
   where ct.purpose = t.purpose and ct.locale = 'de'
     and ct.source_key = 'schnellreport' and ct.body = t.body
);

-- capture_lead: `create or replace` bei UNVERÄNDERTER Signatur (Grants bleiben). Einzige Änderung
-- gegenüber der Fassung aus `20260805150000_create_lead_thema.sql`: die Textauswahl ruft
-- platform.active_consent_text_id mit der Herkunft auf.
create or replace function public.capture_lead(
  p_email text,
  p_source_key text,
  p_purpose platform.consent_purpose default null,
  p_token_hash text default null,
  p_token_expires_at timestamptz default null,
  p_company text default null,
  p_first_name text default null,
  p_last_name text default null,
  p_phone text default null,
  p_source_ip inet default null,
  p_user_agent text default null,
  p_locale text default 'de',
  p_industry platform.industry default null,
  p_postal_code text default null,
  p_annual_consumption_kwh integer default null,
  p_metering_type text default null,
  p_supplier text default null,
  p_contract_end_date date default null,
  -- B16-1, beide mit Vorgabewert null und ANGEHÄNGT:
  p_partner_slug text default null,
  p_referred_by_text text default null,
  -- Das Thema der Anfrage, ebenso angehängt und ebenso mit Vorgabewert null:
  p_thema text default null
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
  -- Verlangt DIESER Zweck eine Bestätigung? Einmal gelesen, dreimal gebraucht (Token-Pflicht,
  -- Kollisionsprüfung, Anlage-Zustand) — und ausschliesslich aus der EINEN Zuordnungsfunktion.
  v_requires_doi    boolean := p_purpose is not null
                               and platform.purpose_requires_double_opt_in(p_purpose);
  -- Leerstring ist keine Angabe. Ohne diese Normalisierung schriebe ein leer abgesendetes
  -- Formularfeld ein '' in den Bestand — das ist kein null, überlebt jedes COALESCE und überschriebe
  -- damit eine früher erhobene, echte Angabe. Gilt seit der Namensauftrennung ausdrücklich AUCH für
  -- Vor- und Nachname: das Kontaktformular verlangt beide, andere Einstiegspunkte nicht — ein dort
  -- leer gelassenes Feld darf einen bereits erfassten Namen nicht verdrängen.
  v_first_name    text := nullif(btrim(p_first_name), '');
  v_last_name     text := nullif(btrim(p_last_name), '');
  v_postal_code   text := nullif(btrim(p_postal_code), '');
  v_metering_type text := nullif(btrim(p_metering_type), '');
  v_supplier      text := nullif(btrim(p_supplier), '');
  -- B16-1. Der Slug wird zusätzlich KLEINGESCHRIEBEN: er kommt aus einem Link, den ein Mensch
  -- abtippen kann, und der CHECK auf platform.partners.slug garantiert, dass jeder GESPEICHERTE
  -- Slug bereits kleingeschrieben ist. Das Kleinschreiben kann deshalb nur einen Nicht-Treffer in
  -- den RICHTIGEN Treffer verwandeln, niemals in einen falschen.
  v_partner_slug  text := lower(nullif(btrim(p_partner_slug), ''));
  v_referred_by   text := nullif(btrim(p_referred_by_text), '');
  -- Das Thema. NUR getrimmt — ausdrücklich NICHT kleingeschrieben: anders als der Slug ist es ein
  -- Schlüssel aus einer Liste, die diese Anwendung selbst rendert, und die Schlüssel sind
  -- camelCase ('peakShaving'). Ein lower() machte aus jedem davon einen Wert, den findThema nicht
  -- mehr auflösen kann.
  v_thema         text := nullif(btrim(p_thema), '');
begin
  if p_email is null or btrim(p_email) = '' then
    raise exception 'public.capture_lead: p_email ist Pflicht' using errcode = '22023';
  end if;

  -- Ein bestätigungspflichtiger Zweck OHNE Token erzeugte eine pending-Einwilligung, die niemand je
  -- bestätigen kann — ein stiller Dauerzustand, der im Bestand wie eine offene Bestätigung aussieht
  -- und zugleich jede weitere Erfassung dieses Zwecks blockiert (s. Prüfung unten). Lieber laut.
  if v_requires_doi and (p_token_hash is null or btrim(p_token_hash) = '') then
    raise exception
      'public.capture_lead: Zweck % ist bestätigungspflichtig — p_token_hash ist dann Pflicht',
      p_purpose
      using errcode = '22023';
  end if;

  -- ── Partner-Slug prüfen: unbekannt oder inaktiv wird VERWORFEN, nicht abgewiesen ───────────────
  -- Ein INAKTIVER Partner wird wie ein unbekannter behandelt: die Deaktivierung ist genau die
  -- Ansage, dass Links dieses Fachbetriebs nicht mehr attributieren sollen. Wäre es anders, hätte
  -- `is_active` für den einzigen Pfad, der im Betrieb Zuordnungen erzeugt, keine Wirkung.
  -- (public.admin_update_lead verfährt bewusst anders — dort ist eine historische Zuordnung zu einem
  -- inzwischen inaktiven Partner eine zulässige Feststellung eines Menschen.)
  if v_partner_slug is not null and not exists (
    select 1 from platform.partners p where p.slug = v_partner_slug and p.is_active
  ) then
    v_partner_slug := null;
  end if;

  -- ── Lead anlegen oder wiederverwenden ──────────────────────────────────────────────────────────
  -- Konflikt-Ziel ist der AUSDRUCKS-Index aus B1-1 (platform.normalize_email(email)) — also
  -- dieselbe Definition von „dieselbe Adresse", die auch der BEFORE-Trigger anwendet. `do nothing`
  -- statt `do update`, weil der Wiederverwendungsfall unten mehr tut als ein Upsert ausdrücken
  -- könnte (Identitätsfelder nur ERGÄNZEN, Segmentierungsfelder AKTUALISIEREN).
  --
  -- Ein unzulässiger p_metering_type oder eine vierstellenwidrige PLZ wird hier NICHT abgefangen:
  -- der CHECK auf der Spalte lehnt sie ab, und zwar hart. Eine stille Bereinigung („nimm halt
  -- unknown") erzeugte einen Bestand, der geprüfte von geratenen Werten nicht mehr unterscheidet.
  -- Für `thema` gibt es aus der im Kopf genannten Begründung gar keinen CHECK — geprüft wird an der
  -- Stelle, an der die Werteliste entsteht.
  insert into platform.leads (
    email, first_source_key, company, first_name, last_name, phone,
    industry, postal_code, annual_consumption_kwh, metering_type, supplier, contract_end_date,
    partner_slug, referred_by_text, thema
  )
  values (
    p_email,
    p_source_key,
    nullif(btrim(p_company), ''),
    v_first_name,
    v_last_name,
    nullif(btrim(p_phone), ''),
    p_industry,
    v_postal_code,
    p_annual_consumption_kwh,
    v_metering_type,
    v_supplier,
    p_contract_end_date,
    v_partner_slug,
    v_referred_by,
    v_thema
  )
  on conflict (platform.normalize_email(email)) do nothing
  returning id into v_lead_id;

  if v_lead_id is null then
    -- Bestehender Lead: last_interaction_at rückt (und mit ihr die Löschfrist, Trigger
    -- sync_lead_retention). Identitätsfelder werden nur GEFÜLLT, wo bisher nichts stand: eine
    -- spätere, knappere Absendung darf eine früher genannte Firma/Telefonnummer nicht löschen.
    -- VOR- UND NACHNAME FOLGEN DERSELBEN REGEL wie company/phone (Bestand gewinnt) und
    -- ausdrücklich NICHT der B3-1-Segmentierungsregel: ein Name ist ein Identitätsmerkmal, das sich
    -- selten und dann bewusst ändert — anders als Verbrauch, Versorger oder Vertragsende, wo die
    -- JÜNGERE Angabe die richtige ist. Die beiden Regeln stehen deshalb bewusst gegenläufig
    -- nebeneinander (ausführlich begründet in B3-1).
    --
    -- Die zwei Felder werden EINZELN zusammengeführt, nicht als Paar: ein Einstiegspunkt, der nur
    -- den Nachnamen erhebt, soll ihn ergänzen können, ohne dass ein fehlender Vorname etwas
    -- bewirkt.
    -- first_source_key bleibt unangetastet (Trigger guard_lead_first_source würde es ohnehin
    -- ablehnen) — die Ersterfassungs-Herkunft ist einmalig.
    --
    -- B16-1: partner_slug und referred_by_text folgen der Bestand-gewinnt-Regel. Kommt derselbe
    -- Kontakt später über den Link eines ANDEREN Fachbetriebs, bleibt die ERSTE Zuordnung stehen —
    -- sonst entschiede die zufällige Reihenfolge zweier Formularabsendungen darüber, wer das
    -- Montageprojekt bekommt. Auch hier EINZELN: ein Aufruf, der nur den Freitext trägt, darf ihn
    -- ergänzen, ohne dass ein fehlender Slug etwas bewirkt.
    --
    -- `thema` steht bewusst auf der ANDEREN Seite: der JÜNGERE Wert gewinnt (wie die
    -- Segmentierungsfelder). Es beschreibt das Anliegen dieser Absendung, nicht die Person.
    update platform.leads l
       set last_interaction_at = now(),
           company    = coalesce(l.company,    nullif(btrim(p_company), '')),
           first_name = coalesce(l.first_name, v_first_name),
           last_name  = coalesce(l.last_name,  v_last_name),
           phone      = coalesce(l.phone,      nullif(btrim(p_phone), '')),
           industry               = coalesce(p_industry,               l.industry),
           postal_code            = coalesce(v_postal_code,            l.postal_code),
           annual_consumption_kwh = coalesce(p_annual_consumption_kwh, l.annual_consumption_kwh),
           metering_type          = coalesce(v_metering_type,          l.metering_type),
           supplier               = coalesce(v_supplier,               l.supplier),
           contract_end_date      = coalesce(p_contract_end_date,      l.contract_end_date),
           partner_slug           = coalesce(l.partner_slug,     v_partner_slug),
           referred_by_text       = coalesce(l.referred_by_text, v_referred_by),
           thema                  = coalesce(v_thema,            l.thema)
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
  --
  -- B3-2: NUR NOCH FÜR BESTÄTIGUNGSPFLICHTIGE ZWECKE. Die Prüfung schützt davor, dass wiederholtes
  -- Absenden fremde Adressen mit BESTÄTIGUNGSMAILS zudeckt — sie hat nur dort einen Gegenstand, wo
  -- solche Mails entstehen. Bei einem Zweck ohne Bestätigungspflicht gibt es keine pending-Zeile
  -- mehr; träfe die Prüfung dort noch eine Alt-Zeile, verweigerte sie ausgerechnet die sofortige
  -- Lieferung.
  if v_requires_doi and exists (
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

  -- ── Passende Textfassung: an die Herkunft gebundene vor allgemeiner (Leadgen 3b-2) ─────────────
  v_consent_text_id := platform.active_consent_text_id(p_purpose, coalesce(p_locale, 'de'), p_source_key);

  if v_consent_text_id is null then
    -- Ohne Wortlaut keine Einwilligung. Ein Fallback auf eine andere Sprache wäre ein Nachweis über
    -- einen Text, den die Person nicht gesehen hat.
    raise exception
      'public.capture_lead: kein Einwilligungstext für Zweck % in Sprache % vorhanden',
      p_purpose, coalesce(p_locale, 'de')
      using errcode = '22023';
  end if;

  -- ── Die Einwilligung entsteht — in EINEM von zwei Zuständen ────────────────────────────────────
  -- Bestätigungspflichtig  → 'pending' mit Token und Ablauf (unverändert B1-2).
  -- Nicht bestätigungspflichtig → SOFORT 'confirmed' mit confirmed_at = now().
  --
  -- EIN ÜBERGEBENER TOKEN WIRD IM ZWEITEN FALL NICHT GESPEICHERT — weder Hash noch Ablauf. Er wäre
  -- ein einlösbares Geheimnis ohne Einlösestelle: `public.confirm_consent` findet nur pending-
  -- Zeilen, der Token könnte also nichts mehr bewirken, stünde aber dauerhaft in einer Tabelle, die
  -- genau solche Werte bewusst nicht führen soll (B1-1, Kommentar an consents.token_hash). Dass ein
  -- Aufrufer versehentlich einen mitschickt, darf daher keine Spur hinterlassen; ein db-test pinnt
  -- das.
  insert into platform.consents (
    lead_id, consent_text_id, source_key, status, confirmed_at,
    token_hash, token_expires_at, source_ip, user_agent
  )
  values (
    v_lead_id,
    v_consent_text_id,
    p_source_key,
    case when v_requires_doi then 'pending' else 'confirmed' end,
    case when v_requires_doi then null      else now() end,
    case when v_requires_doi then p_token_hash       else null end,
    case when v_requires_doi then p_token_expires_at else null end,
    p_source_ip,
    p_user_agent
  )
  returning id into v_consent_id;

  return jsonb_build_object(
    'outcome',    case when v_requires_doi then 'consent_created' else 'consent_confirmed' end,
    'lead_id',    v_lead_id,
    'consent_id', v_consent_id
  );
end;
$$;

-- ── TEIL 3 — Schnellcheck-Werte je Report und Doppelversand-Sperre ───────────────────────────────
-- Zahlen statt Freitext, damit sich der Funnel auswerten lässt. Keine Identitätsmerkmale: die
-- stehen am Lead (Anonymisierung nach 24 Monaten), diese Zeilen bleiben danach als Statistik.
create table platform.schnellreport_requests (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references platform.leads (id) on delete cascade,
  country text not null check (country in ('AT', 'DE')),
  branche text not null
    check (branche in ('produktion', 'lebensmittel', 'gastro', 'logistik', 'handel', 'sonstige')),
  annual_kwh integer not null check (annual_kwh > 0),
  peak_kw numeric not null check (peak_kw > 0),
  -- false = Reglerwert (Beispiel), true = vom Besucher eingegeben.
  peak_kw_entered boolean not null,
  bill_eur integer check (bill_eur > 0),
  demand_price_eur_per_kw numeric not null check (demand_price_eur_per_kw > 0),
  peak_cost_eur integer not null check (peak_cost_eur >= 0),
  tips_requested boolean not null,
  created_at timestamptz not null default now()
);

create index schnellreport_requests_lead_created_idx
  on platform.schnellreport_requests (lead_id, created_at desc);

comment on table platform.schnellreport_requests is
  'Leadgen 3b-2: je versandtem Schnellreport die serverseitig nachgerechneten Schnellcheck-Werte. '
  'RLS ohne Policy, für keine Rolle ein Tabellenrecht; geschrieben nur über '
  'public.record_schnellreport_request.';

alter table platform.schnellreport_requests enable row level security;
revoke all on table platform.schnellreport_requests from public, anon, authenticated, service_role;

-- Legt die Zeile an, sofern für denselben Lead im Fenster noch keine besteht. Die Advisory-Sperre
-- serialisiert gleichzeitige Absendungen (Doppelklick), sonst sähen beide „noch keine".
create function public.record_schnellreport_request(
  p_lead_id uuid,
  p_country text,
  p_branche text,
  p_annual_kwh integer,
  p_peak_kw numeric,
  p_peak_kw_entered boolean,
  p_demand_price_eur_per_kw numeric,
  p_peak_cost_eur integer,
  p_tips_requested boolean,
  p_window_seconds integer,
  p_bill_eur integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_window_seconds is null or p_window_seconds < 0 then
    raise exception 'public.record_schnellreport_request: p_window_seconds ungültig'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('schnellreport:' || p_lead_id::text, 0));

  if exists (
    select 1 from platform.schnellreport_requests r
     where r.lead_id = p_lead_id
       and r.created_at > now() - make_interval(secs => p_window_seconds)
  ) then
    return jsonb_build_object('status', 'duplicate');
  end if;

  insert into platform.schnellreport_requests (
    lead_id, country, branche, annual_kwh, peak_kw, peak_kw_entered, bill_eur,
    demand_price_eur_per_kw, peak_cost_eur, tips_requested
  )
  values (
    p_lead_id, p_country, p_branche, p_annual_kwh, p_peak_kw, p_peak_kw_entered, p_bill_eur,
    p_demand_price_eur_per_kw, p_peak_cost_eur, p_tips_requested
  )
  returning id into v_id;

  return jsonb_build_object('status', 'created', 'id', v_id);
end;
$$;

comment on function public.record_schnellreport_request(
  uuid, text, text, integer, numeric, boolean, numeric, integer, boolean, integer, integer
) is
  'Leadgen 3b-2: legt eine Zeile in platform.schnellreport_requests an — oder antwortet '
  '{status: duplicate}, wenn für denselben Lead innerhalb von p_window_seconds schon eine besteht '
  '(kein zweiter Report). {status: created, id}. service_role-only.';

revoke all on function public.record_schnellreport_request(
  uuid, text, text, integer, numeric, boolean, numeric, integer, boolean, integer, integer
) from public, anon, authenticated, service_role;
grant execute on function public.record_schnellreport_request(
  uuid, text, text, integer, numeric, boolean, numeric, integer, boolean, integer, integer
) to service_role;
