-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- B3-2 — Einfach-Opt-in korrekt abschliessen (Fahrplan_2026.md B3)
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Diese Migration korrigiert einen FEHLER DER B1-2-SPEZIFIKATION, nicht der Implementierung:
-- `public.capture_lead` legt JEDE Einwilligung mit status='pending' an — auch bei Zwecken, die gar
-- keine Bestätigung verlangen (`platform.purpose_requires_double_opt_in(...) = false`, konkret
-- 'result_delivery').
--
-- Die Folge ist ein sich selbst blockierender Zustand: die Zeile bleibt DAUERHAFT pending, weil es
-- keinen Bestätigungsschritt gibt, der sie je auf 'confirmed' hebt (`public.confirm_consent`
-- braucht einen Token, den es hier nicht gibt). `platform.has_confirmed_consent` liefert damit
-- false, und die Versandprüfung vor jeder Aussendung blockiert genau die Zusendung, um die die
-- Person gerade gebeten hat.
--
-- ── WARUM 'pending' HIER FALSCH IST ──────────────────────────────────────────────────────────────
-- 'pending' heisst „wartet auf Bestätigung". Bei einem Zweck OHNE Bestätigungspflicht wartet
-- nichts — es gibt niemanden und nichts, worauf gewartet würde. Der Zustand wäre damit keine
-- Aussage über die Einwilligung, sondern lediglich eine Sperre gegen ihre eigene Erfüllung.
--
-- Bisher folgenlos, weil B1-2 genau EINEN Einstiegspunkt verdrahtet hat (das Kontaktformular), und
-- der schreibt ausschliesslich 'marketing_email' — einen bestätigungspflichtigen Zweck. Mit B3-2
-- kommt der erste Einstiegspunkt hinzu, der 'result_delivery' schreibt ('rechnerergebnis').
--
-- ── ZWEI AUSGÄNGE STATT EINEM: 'consent_created' vs. 'consent_confirmed' ─────────────────────────
-- Der Rückgabewert `outcome` bekommt einen neuen Wert. Ohne ihn müsste der Anwendungscode aus dem
-- Zweck ZURÜCKRECHNEN, ob eine Bestätigungsmail oder die eigentliche Leistung fällig ist — also die
-- Zuordnung Zweck→Bestätigungspflicht ein zweites Mal auslegen, diesmal in TypeScript. Mit zwei
-- Ausgängen kann er nicht falsch abzweigen:
--   'consent_created'   → Bestätigungsmail (unverändert der B1-2-Pfad)
--   'consent_confirmed' → sofortige Lieferung (die Einwilligung wirkt bereits)
--
-- KEINE Änderung an `platform.purpose_requires_double_opt_in` und keine an
-- `platform.guard_consent_confirmation`: die Zuordnung bleibt, wo sie ist, und der Guard lässt eine
-- Bestätigung ohne Zeitstempel weiterhin nur bei NICHT bestätigungspflichtigen Zwecken zu (dort
-- setzen wir sie trotzdem — s. u.).
--
-- `create or replace` mit UNVERÄNDERTER Signatur: die B3-1-Grants (revoke von public/anon/
-- authenticated/service_role, grant an service_role) bleiben dadurch bestehen. Ein DROP+CREATE wie
-- in B3-1 wäre hier nicht nur unnötig, sondern würde die Rechtefläche neu aufziehen müssen.
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

create or replace function public.capture_lead(
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
  p_locale text default 'de',
  p_industry platform.industry default null,
  p_postal_code text default null,
  p_annual_consumption_kwh integer default null,
  p_metering_type text default null,
  p_supplier text default null,
  p_contract_end_date date default null
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
  -- damit eine früher erhobene, echte Angabe.
  v_postal_code   text := nullif(btrim(p_postal_code), '');
  v_metering_type text := nullif(btrim(p_metering_type), '');
  v_supplier      text := nullif(btrim(p_supplier), '');
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

  -- ── Lead anlegen oder wiederverwenden ──────────────────────────────────────────────────────────
  -- Konflikt-Ziel ist der AUSDRUCKS-Index aus B1-1 (platform.normalize_email(email)) — also
  -- dieselbe Definition von „dieselbe Adresse", die auch der BEFORE-Trigger anwendet. `do nothing`
  -- statt `do update`, weil der Wiederverwendungsfall unten mehr tut als ein Upsert ausdrücken
  -- könnte (Identitätsfelder nur ERGÄNZEN, Segmentierungsfelder AKTUALISIEREN).
  --
  -- Ein unzulässiger p_metering_type oder eine vierstellenwidrige PLZ wird hier NICHT abgefangen:
  -- der CHECK auf der Spalte lehnt sie ab, und zwar hart. Eine stille Bereinigung („nimm halt
  -- unknown") erzeugte einen Bestand, der geprüfte von geratenen Werten nicht mehr unterscheidet.
  insert into platform.leads (
    email, first_source_key, company, contact_name, phone,
    industry, postal_code, annual_consumption_kwh, metering_type, supplier, contract_end_date
  )
  values (
    p_email,
    p_source_key,
    nullif(btrim(p_company), ''),
    nullif(btrim(p_contact_name), ''),
    nullif(btrim(p_phone), ''),
    p_industry,
    v_postal_code,
    p_annual_consumption_kwh,
    v_metering_type,
    v_supplier,
    p_contract_end_date
  )
  on conflict (platform.normalize_email(email)) do nothing
  returning id into v_lead_id;

  if v_lead_id is null then
    -- Bestehender Lead: last_interaction_at rückt (und mit ihr die Löschfrist, Trigger
    -- sync_lead_retention). Identitätsfelder werden nur GEFÜLLT, wo bisher nichts stand: eine
    -- spätere, knappere Absendung darf eine früher genannte Firma/Telefonnummer nicht löschen.
    -- Die sechs Segmentierungsfelder folgen der umgekehrten Vorrangregel (B3-1): ein übergebener
    -- Wert überschreibt, null lässt unberührt.
    -- first_source_key bleibt unangetastet (Trigger guard_lead_first_source würde es ohnehin
    -- ablehnen) — die Ersterfassungs-Herkunft ist einmalig.
    update platform.leads l
       set last_interaction_at = now(),
           company      = coalesce(l.company,      nullif(btrim(p_company), '')),
           contact_name = coalesce(l.contact_name, nullif(btrim(p_contact_name), '')),
           phone        = coalesce(l.phone,        nullif(btrim(p_phone), '')),
           industry               = coalesce(p_industry,               l.industry),
           postal_code            = coalesce(v_postal_code,            l.postal_code),
           annual_consumption_kwh = coalesce(p_annual_consumption_kwh, l.annual_consumption_kwh),
           metering_type          = coalesce(v_metering_type,          l.metering_type),
           supplier               = coalesce(v_supplier,               l.supplier),
           contract_end_date      = coalesce(p_contract_end_date,      l.contract_end_date)
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
  -- solche Mails entstehen. Bei einem Zweck ohne Bestätigungspflicht gibt es ab dieser Migration
  -- gar keine pending-Zeile mehr; träfe die Prüfung dort noch eine Alt-Zeile (die der Backfill
  -- unten aufräumt), verweigerte sie ausgerechnet die sofortige Lieferung.
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

comment on function public.capture_lead(
  text, text, platform.consent_purpose, text, timestamptz, text, text, text, inet, text, text,
  platform.industry, text, integer, text, text, date
) is
  'B1-2, erweitert in B3-1, korrigiert in B3-2: EIN atomarer Erfassungsaufruf (Lead + optionale '
  'Einwilligung in EINER Transaktion — Lead und Nachweis dürfen nicht getrennt committen). '
  'Rückgabe {outcome, lead_id} mit outcome aus lead_only (kein Zweck übergeben) · consent_created '
  '(bestätigungspflichtiger Zweck: pending + Token, der Anwendungscode versendet die '
  'Bestätigungsmail) · consent_confirmed (NICHT bestätigungspflichtiger Zweck: sofort confirmed '
  'mit confirmed_at, der Anwendungscode liefert unmittelbar; ein übergebener Token wird dabei NICHT '
  'gespeichert) · consent_already_pending (offene, nicht abgelaufene Bestätigung — verhindert, dass '
  'wiederholtes Absenden fremde Adressen mit Bestätigungsmails zudeckt; greift nur bei '
  'bestätigungspflichtigen Zwecken) · suppressed (Adresse gesperrt: KEINE Einwilligung, der Lead '
  'bleibt — eine Anfrage ist keine Einwilligung). Bestätigungspflichtiger Zweck ohne p_token_hash '
  'wirft. ZUSAMMENFÜHRUNG bei wiederholter Erfassung: die sechs Segmentierungsfelder (industry, '
  'postal_code, annual_consumption_kwh, metering_type, supplier, contract_end_date) werden von '
  'einem übergebenen Wert ÜBERSCHRIEBEN, ein null-Wert lässt den bestehenden UNBERÜHRT; '
  'company/contact_name/phone folgen bewusst der umgekehrten Vorrangregel (Bestand gewinnt). '
  'service_role-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- BACKFILL — die Alt-Zeilen, die der Sache nach immer bestätigt waren
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Bestehende pending-Einwilligungen zu NICHT bestätigungspflichtigen Zwecken werden auf 'confirmed'
-- gesetzt, `confirmed_at` auf `granted_at` — NICHT auf now().
--
-- Der Zeitpunkt ist der Punkt: die Person hat ihre Einwilligung damals erteilt, und für diese
-- Zwecke war die Erteilung immer schon der vollständige Vorgang (es gab keinen zweiten Schritt).
-- Ein Zeitstempel von heute behauptete eine Handlung, die heute niemand vorgenommen hat — dieselbe
-- Fälschung, die `guard_consent_confirmation` bei den bestätigungspflichtigen Zwecken hart
-- verhindert. `granted_at` ist der einzige Zeitpunkt, den es hier wirklich gegeben hat.
--
-- IDEMPOTENT: die Bedingung `status = 'pending'` trifft nach dem ersten Lauf auf keine Zeile mehr,
-- und neue solche Zeilen können ab der Funktion oben nicht mehr entstehen. Ein erneutes Anwenden
-- der Migration ist damit wirkungslos.
--
-- ABGRENZUNG: 'withdrawn' und 'expired' werden NICHT angefasst. Ein Widerruf ist eine Handlung der
-- Person und wird nicht durch eine Migration zurückgenommen; 'expired' kann bei diesen Zwecken gar
-- nicht entstehen (kein Token, kein Ablauf) und wäre, wenn doch, ein Zustand mit eigener Geschichte.
--
-- Der Trigger `touch_lead_on_consent` feuert dabei und schiebt die Löschfrist der betroffenen Leads
-- nach. Das ist hier korrekt und keine Nebenwirkung, die man unterdrücken müsste: die Frist zählt
-- ab dem letzten Kontakt, und der Bestand dieser Leads ist unverändert derselbe.
update platform.consents c
   set status       = 'confirmed',
       confirmed_at = c.granted_at
  from platform.consent_texts ct
 where ct.id = c.consent_text_id
   and c.status = 'pending'
   and not platform.purpose_requires_double_opt_in(ct.purpose);
