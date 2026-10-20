-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Leadgen-Umbau Schritt 5 — Herkunft (UTM, Einstiegspfad, Referrer-Host) an Lead und Anfrage
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- 1. `platform.leads.first_*`: der first touch — gesetzt bei der ersten Absendung mit erfasster
--    Herkunft, danach nie überschrieben. Spalten statt Verweis, damit Liste und Filter ohne Join
--    auskommen (`leads_matching` liefert `setof platform.leads`).
-- 2. `platform.lead_attributions`: je Absendung (Schnellreport, Profi-Report-Anfrage,
--    Kontaktformular) die Herkunft DIESER Absendung. Eine Tabelle für alle drei Wege — das
--    Kontaktformular hat keine eigene Anfragetabelle.
-- 3. `public.record_lead_attribution` (service_role-only) schreibt beides in einer Transaktion.
-- 4. `public.admin_get_lead_attribution` / `admin_list_profi_report_requests` (authenticated-only,
--    42501 ohne Admin) für die Lead-Detailseite.
-- 5. Filter `p_utm_source` in `leads_matching`, `lead_filter_summary`, `admin_list_leads`,
--    `admin_export_leads` (DROP+CREATE, Parameter angehängt; Rümpfe sonst unverändert aus
--    `pg_get_functiondef` übernommen, Rechte danach neu gesetzt).
--
-- Keine personenbezogenen Daten: UTM-Werte, Pfad und Host werden im Anwendungscode geprüft und
-- gekürzt (`lib/attribution/parse.ts`), die CHECKs hier sind die zweite Grenze. Die Werte bleiben bei
-- der Anonymisierung stehen (wie `partner_slug`): Kampagnenstatistik soll die 24-Monats-Frist
-- überdauern. `guard_anonymized_lead` und `anonymize_lead` sind deshalb unverändert; der
-- Schreib-Wrapper fasst anonymisierte Leads nicht an.
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

alter table platform.leads
  add column first_touch_at timestamptz,
  add column first_utm_source text check (char_length(first_utm_source) <= 100),
  add column first_utm_medium text check (char_length(first_utm_medium) <= 100),
  add column first_utm_campaign text check (char_length(first_utm_campaign) <= 100),
  add column first_utm_content text check (char_length(first_utm_content) <= 100),
  add column first_utm_term text check (char_length(first_utm_term) <= 100),
  add column first_landing_path text check (char_length(first_landing_path) <= 200),
  add column first_referrer_host text check (char_length(first_referrer_host) <= 253);

comment on column platform.leads.first_touch_at is
  'Leadgen 5: Zeitpunkt des first touch. null = für diesen Lead wurde noch keine Herkunft erfasst '
  '(auch „direkt" setzt den Zeitpunkt). Gesetzt nur von public.record_lead_attribution.';

create table platform.lead_attributions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references platform.leads (id) on delete cascade,
  channel text not null check (channel in ('schnellreport', 'profi_report', 'kontakt')),
  utm_source text check (char_length(utm_source) <= 100),
  utm_medium text check (char_length(utm_medium) <= 100),
  utm_campaign text check (char_length(utm_campaign) <= 100),
  utm_content text check (char_length(utm_content) <= 100),
  utm_term text check (char_length(utm_term) <= 100),
  landing_path text check (char_length(landing_path) <= 200),
  referrer_host text check (char_length(referrer_host) <= 253),
  created_at timestamptz not null default now()
);

create index lead_attributions_lead_created_idx
  on platform.lead_attributions (lead_id, created_at desc);

comment on table platform.lead_attributions is
  'Leadgen 5: je Absendung (Schnellreport, Profi-Report-Anfrage, Kontaktformular) die Herkunft '
  'dieser Absendung. RLS ohne Policy, für keine Rolle ein Tabellenrecht; geschrieben nur über '
  'public.record_lead_attribution, gelesen nur über public.admin_get_lead_attribution.';

alter table platform.lead_attributions enable row level security;
revoke all on table platform.lead_attributions from public, anon, authenticated, service_role;

-- Leere Zeichenketten werden zu null — „nicht angegeben" hat genau eine Darstellung.
create function public.record_lead_attribution(
  p_lead_id uuid,
  p_channel text,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_utm_content text default null,
  p_utm_term text default null,
  p_landing_path text default null,
  p_referrer_host text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source   text := nullif(btrim(p_utm_source), '');
  v_medium   text := nullif(btrim(p_utm_medium), '');
  v_campaign text := nullif(btrim(p_utm_campaign), '');
  v_content  text := nullif(btrim(p_utm_content), '');
  v_term     text := nullif(btrim(p_utm_term), '');
  v_path     text := nullif(btrim(p_landing_path), '');
  v_host     text := lower(nullif(btrim(p_referrer_host), ''));
  v_first    boolean;
begin
  insert into platform.lead_attributions (
    lead_id, channel, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    landing_path, referrer_host
  ) values (
    p_lead_id, p_channel, v_source, v_medium, v_campaign, v_content, v_term, v_path, v_host
  );

  -- First touch: nur, solange noch keiner erfasst ist, und nie an einem anonymisierten Lead.
  update platform.leads l
     set first_touch_at      = now(),
         first_utm_source    = v_source,
         first_utm_medium    = v_medium,
         first_utm_campaign  = v_campaign,
         first_utm_content   = v_content,
         first_utm_term      = v_term,
         first_landing_path  = v_path,
         first_referrer_host = v_host
   where l.id = p_lead_id
     and l.first_touch_at is null
     and l.anonymized_at is null;
  v_first := found;

  return jsonb_build_object('status', 'created', 'first_touch', v_first);
end;
$$;

comment on function public.record_lead_attribution(
  uuid, text, text, text, text, text, text, text, text
) is
  'Leadgen 5: legt die Herkunft einer Absendung in platform.lead_attributions an und setzt den '
  'first touch am Lead, solange keiner erfasst ist. {status: created, first_touch}. '
  'service_role-only.';

revoke all on function public.record_lead_attribution(
  uuid, text, text, text, text, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.record_lead_attribution(
  uuid, text, text, text, text, text, text, text, text
) to service_role;

create function public.admin_get_lead_attribution(p_lead_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_first   jsonb;
  v_touches jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_get_lead_attribution: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select case when l.first_touch_at is null then null else jsonb_build_object(
           'created_at',    l.first_touch_at,
           'utm_source',    l.first_utm_source,
           'utm_medium',    l.first_utm_medium,
           'utm_campaign',  l.first_utm_campaign,
           'utm_content',   l.first_utm_content,
           'utm_term',      l.first_utm_term,
           'landing_path',  l.first_landing_path,
           'referrer_host', l.first_referrer_host
         ) end
    into v_first
  from platform.leads l
  where l.id = p_lead_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',            a.id,
           'channel',       a.channel,
           'created_at',    a.created_at,
           'utm_source',    a.utm_source,
           'utm_medium',    a.utm_medium,
           'utm_campaign',  a.utm_campaign,
           'utm_content',   a.utm_content,
           'utm_term',      a.utm_term,
           'landing_path',  a.landing_path,
           'referrer_host', a.referrer_host
         ) order by a.created_at desc), '[]'::jsonb)
    into v_touches
  from platform.lead_attributions a
  where a.lead_id = p_lead_id;

  return jsonb_build_object('first_touch', v_first, 'touches', v_touches);
end;
$$;

comment on function public.admin_get_lead_attribution(uuid) is
  'Leadgen 5: first touch und Herkunft je Absendung eines Leads, neueste zuerst. '
  'authenticated-only, 42501 ohne Adminrolle.';

revoke all on function public.admin_get_lead_attribution(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_get_lead_attribution(uuid) to authenticated;

create function public.admin_list_profi_report_requests(p_lead_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_list_profi_report_requests: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',               r.id,
           'created_at',       r.created_at,
           'has_load_profile', r.has_load_profile
         ) order by r.created_at desc), '[]'::jsonb)
    into v_rows
  from platform.profi_report_requests r
  where r.lead_id = p_lead_id;

  return v_rows;
end;
$$;

comment on function public.admin_list_profi_report_requests(uuid) is
  'Leadgen 5: die Profi-Report-Anfragen eines Leads mit Lastgang-Angabe, neueste zuerst. '
  'authenticated-only, 42501 ohne Adminrolle.';

revoke all on function public.admin_list_profi_report_requests(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_list_profi_report_requests(uuid) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Filter nach utm_source — angehängter Parameter, jeder bestehende Aufruf bleibt gültig.
-- Abhängige zuerst entfernen (die Wrapper rufen leads_matching/lead_filter_summary positional).
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

drop function public.admin_list_leads(
  integer, integer, text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text,
  text, text, text, text, text, text, text[], text[], boolean, text[], text[], date, date
);
drop function public.admin_export_leads(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text,
  text, text, text, text, text, text, text[], text[], boolean, text[], text[], date, date
);
drop function platform.leads_matching(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text,
  text, text, text, text, text, text, text[], text[], boolean, text[], text[], date, date
);
drop function platform.lead_filter_summary(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text,
  text, text, text, text, text, text, text[], text[], boolean, text[], text[], date, date
);

CREATE FUNCTION platform.leads_matching(p_status text DEFAULT NULL::text, p_source_key text DEFAULT NULL::text, p_consent_purpose platform.consent_purpose DEFAULT NULL::platform.consent_purpose, p_consent_status text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_due_only boolean DEFAULT false, p_industry platform.industry DEFAULT NULL::platform.industry, p_metering_type text DEFAULT NULL::text, p_postal_prefix text DEFAULT NULL::text, p_consumption_min integer DEFAULT NULL::integer, p_consumption_max integer DEFAULT NULL::integer, p_contract_end_from date DEFAULT NULL::date, p_contract_end_to date DEFAULT NULL::date, p_partner_slug text DEFAULT NULL::text, p_partner_assignment text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_company text DEFAULT NULL::text, p_first_name text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_assignment text DEFAULT NULL::text, p_source_keys text[] DEFAULT NULL::text[], p_thema_keys text[] DEFAULT NULL::text[], p_thema_none boolean DEFAULT false, p_consent_purposes text[] DEFAULT NULL::text[], p_consent_states text[] DEFAULT NULL::text[], p_created_from date DEFAULT NULL::date, p_created_to date DEFAULT NULL::date, p_utm_source text DEFAULT NULL::text)
 RETURNS SETOF platform.leads
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with args as (
    select nullif(btrim(coalesce(p_status, '')), '')         as f_status,
           nullif(btrim(coalesce(p_source_key, '')), '')     as f_source,
           nullif(btrim(coalesce(p_consent_status, '')), '') as f_cstatus,
           nullif(btrim(coalesce(p_metering_type, '')), '')  as f_metering,
           nullif(btrim(coalesce(p_postal_prefix, '')), '')  as f_prefix,
           -- Kleingeschrieben aus demselben Grund wie in capture_lead: jeder gespeicherte Slug ist
           -- per CHECK kleingeschrieben, ein Kleinschreiben der Eingabe kann also nur treffen.
           lower(nullif(btrim(coalesce(p_partner_slug, '')), '')) as f_partner,
           -- B18-5. Kleingeschrieben aus demselben Grund wie oben, und weil die Wrapper gegen
           -- dieselbe kleingeschriebene Fassung prüfen — sonst liesse sich mit „Assigned" an der
           -- Wrapper-Prüfung vorbei ein Filter setzen, der hier nicht mehr greift.
           lower(nullif(btrim(coalesce(p_partner_assignment, '')), '')) as f_passign,
           coalesce(p_due_only, false)                       as f_due,
           -- Die Maskierung steht seit dieser Migration an EINER Stelle (TEIL 0) — sieben
           -- untereinander abgeschriebene replace-Ketten wären sieben Gelegenheiten, sich zu
           -- vertippen, und der Fehler äusserte sich nur als fehlender Treffer.
           platform.like_pattern(p_search)     as f_pattern,
           platform.like_pattern(p_email)      as f_email,
           platform.like_pattern(p_company)    as f_company,
           platform.like_pattern(p_first_name) as f_first,
           platform.like_pattern(p_last_name)  as f_last,
           platform.like_pattern(p_phone)      as f_phone,
           platform.like_pattern(p_assignment) as f_assignment,
           -- Leadgen 5: Substring auf den first touch (utm_source), wie die übrigen Textfilter.
           platform.like_pattern(p_utm_source) as f_utm_source,
           -- Ein LEERES Array ist KEIN Filter, sondern die Abwesenheit eines Filters — nicht die
           -- leere Menge. Die Oberfläche schickt gar nichts, wenn nichts angekreuzt ist; käme
           -- trotzdem ein leeres Array an, wäre „0 Treffer, weil nichts angekreuzt ist" eine
           -- Sackgasse, aus der die Liste selbst nicht mehr herausführt.
           case when p_source_keys is null or cardinality(p_source_keys) = 0
                then null else p_source_keys end             as f_source_keys,
           case when p_thema_keys is null or cardinality(p_thema_keys) = 0
                then null else p_thema_keys end              as f_thema_keys,
           coalesce(p_thema_none, false)                     as f_thema_none,
           case when p_consent_purposes is null or cardinality(p_consent_purposes) = 0
                then null else p_consent_purposes end        as f_purposes,
           case when p_consent_states is null or cardinality(p_consent_states) = 0
                then null else p_consent_states end          as f_states
  )
  select ld.*
  from platform.leads ld, args a
  where (a.f_status is null or ld.status = a.f_status)
    and (a.f_source is null or ld.first_source_key = a.f_source)
    -- Die Mehrzahl-Form daneben, nicht statt dessen: beide sind eigenständige UND-Bedingungen wie
    -- jeder andere Filter auch (s. Kopf dieses Teils).
    and (a.f_source_keys is null or ld.first_source_key = any(a.f_source_keys))
    -- „Zur Anonymisierung fällig": Frist erreicht UND noch nicht anonymisiert. Ohne die zweite
    -- Bedingung stünden bereits erledigte Fälle dauerhaft in der Arbeitsliste.
    and (not a.f_due or (ld.deletion_due_at <= now() and ld.anonymized_at is null))
    and (
      a.f_pattern is null
      or ld.email ilike a.f_pattern escape '\'
      or coalesce(ld.company, '') ilike a.f_pattern escape '\'
    )
    -- ── Die sechs spaltenweisen Textfilter ───────────────────────────────────────────────────────
    -- `coalesce(…, '')` überall dort, wo die Spalte nullable ist: `x ilike y` ist bei x = NULL
    -- selbst NULL und damit nicht wahr — ohne coalesce verhielte sich die Bedingung richtig, aber
    -- die Absicht („ein leeres Feld trifft keinen Suchbegriff") stünde nirgends.
    and (a.f_email   is null or ld.email ilike a.f_email escape '\')
    and (a.f_company is null or coalesce(ld.company, '')    ilike a.f_company escape '\')
    and (a.f_first   is null or coalesce(ld.first_name, '') ilike a.f_first   escape '\')
    and (a.f_last    is null or coalesce(ld.last_name, '')  ilike a.f_last    escape '\')
    and (a.f_phone   is null or coalesce(ld.phone, '')      ilike a.f_phone   escape '\')
    and (a.f_utm_source is null or coalesce(ld.first_utm_source, '') ilike a.f_utm_source escape '\')
    -- ── Zuordnung: EIN Suchbegriff über DREI Quellen ─────────────────────────────────────────────
    -- Die Spalte zeigt je nach Herkunft Verschiedenes (Fachbetrieb · formlos genannte Firma ·
    -- „empfohlen von"-Freitext). Ein Filter, der nur eine davon durchsuchte, fände genau die Zeilen
    -- nicht, die im sichtbaren Text den Suchbegriff tragen — die Liste widerspräche ihrem Filter.
    --
    -- Das ist ausdrücklich etwas ANDERES als `p_partner_slug`/`p_partner_assignment`: die beiden
    -- fragen nach der ZUORDNUNG (dem Urteil), dieser hier nach dem angezeigten Text. Sie stehen
    -- deshalb nebeneinander und ersetzen einander nicht (B16-1: Beobachtung ist nicht Urteil).
    and (
      a.f_assignment is null
      or coalesce(ld.referred_by_text, '') ilike a.f_assignment escape '\'
      or exists (
           select 1 from platform.partners p
            where p.slug = ld.partner_slug
              and p.display_name ilike a.f_assignment escape '\'
         )
      or exists (
           select 1 from platform.mentioned_businesses mb
            where mb.id = ld.mentioned_business_id
              and mb.name ilike a.f_assignment escape '\'
         )
    )
    -- ── Thema: Ankreuzliste, „ohne Thema" als eigener Parameter ──────────────────────────────────
    and (
      case
        when a.f_thema_keys is null and not a.f_thema_none then true
        else (a.f_thema_keys is not null and ld.thema = any(a.f_thema_keys))
             or (a.f_thema_none and ld.thema is null)
      end
    )
    -- ── Anlagedatum, in Wiener Ortszeit und mit einschliessenden Grenzen (s. Kopf) ───────────────
    and (
      p_created_from is null
      or (ld.created_at at time zone 'Europe/Vienna')::date >= p_created_from
    )
    and (
      p_created_to is null
      or (ld.created_at at time zone 'Europe/Vienna')::date <= p_created_to
    )
    -- ── B2-1: die Segmentierungsdimensionen aus B3-1 ─────────────────────────────────────────────
    and (p_industry is null or ld.industry = p_industry)
    and (a.f_metering is null or ld.metering_type = a.f_metering)
    -- PLZ-PRÄFIX statt Gleichheit: die führenden Ziffern einer österreichischen PLZ sind das
    -- Netzgebiet („11" trifft die Wiener Innenbezirke). Ein Gleichheitsfilter zwänge dazu, ein
    -- Gebiet als Aufzählung einzelner Postleitzahlen zu treffen — und eine vergessene wäre nicht
    -- sichtbar, sondern nur eine etwas kleinere Menge.
    and (a.f_prefix is null or ld.postal_code like a.f_prefix || '%')
    and (p_consumption_min is null or ld.annual_consumption_kwh >= p_consumption_min)
    and (p_consumption_max is null or ld.annual_consumption_kwh <= p_consumption_max)
    and (p_contract_end_from is null or ld.contract_end_date >= p_contract_end_from)
    and (p_contract_end_to is null or ld.contract_end_date <= p_contract_end_to)
    -- ── B16-1: die BESTÄTIGTE Zuordnung, nicht der Freitext ──────────────────────────────────────
    -- Gefiltert wird ausschliesslich über partner_slug. Ein Filter, der zusätzlich den Freitext
    -- durchsuchte, vermischte Beobachtung und Urteil genau dort, wo die Trennung zählt: die Frage
    -- lautet „welche Leads sind diesem Fachbetrieb ZUGESCHRIEBEN", nicht „wer hat seinen Namen
    -- erwähnt". Für die zweite Frage gibt es seit dieser Migration `p_assignment` — als eigenen
    -- Parameter, damit die beiden nicht verwechselt werden können.
    and (a.f_partner is null or ld.partner_slug = a.f_partner)
    -- ── B18-5: „irgendein Fachbetrieb" statt „genau dieser" ──────────────────────────────────────
    -- Dieselbe Spalte, andere Frage. Sie steht bewusst als EIGENE Bedingung neben dem Slug-Filter
    -- statt ihn zu ersetzen: die beiden schliessen einander nicht aus, und der Slug-Filter ist der
    -- einzige Weg, die Leads EINES Betriebs zu sehen (Grundlage jeder Partner-Auswertung).
    -- Gefiltert wird auch hier über die ZUORDNUNG, nicht über den Freitext — ein Lead mit Freitext
    -- und ohne Zuordnung gilt als „ohne Fachbetrieb", und das ist genau der Fall, den ein Mensch
    -- noch entscheiden muss.
    and (
      a.f_passign is null
      or (a.f_passign = 'assigned' and ld.partner_slug is not null)
      or (a.f_passign = 'unassigned' and ld.partner_slug is null)
    )
    -- ── Einwilligungen: die Skalare aus B1-3 ─────────────────────────────────────────────────────
    and (
      case
        when p_consent_purpose is null and a.f_cstatus is null then true
        -- 'none' ist die Umkehrung: KEINE (passende) Einwilligung. Ohne Zweck heisst das „gar
        -- keine Einwilligung", mit Zweck „keine für diesen Zweck".
        when a.f_cstatus = 'none' then not exists (
          select 1
          from platform.consents c
          join platform.consent_texts ct on ct.id = c.consent_text_id
          where c.lead_id = ld.id
            and (p_consent_purpose is null or ct.purpose = p_consent_purpose)
        )
        else exists (
          select 1
          from platform.consents c
          join platform.consent_texts ct on ct.id = c.consent_text_id
          where c.lead_id = ld.id
            and (p_consent_purpose is null or ct.purpose = p_consent_purpose)
            and (
              a.f_cstatus is null
              or platform.consent_effective_status(c.status, c.token_expires_at) = a.f_cstatus
            )
        )
      end
    )
    -- ── Einwilligungen: die Mehrfachauswahl daneben ──────────────────────────────────────────────
    -- Verallgemeinerung derselben Frage, deshalb dieselbe Struktur. Der Unterschied ist die
    -- ODER-Verknüpfung INNERHALB einer Ankreuzliste: „bestätigt oder offen" ist eine Auswahl, keine
    -- zwei Filter. `'none'` darf dabei mit echten Zuständen zusammenstehen — dann greift entweder
    -- der eine oder der andere Zweig.
    --
    -- Im zweiten Zweig bleibt `'none'` bewusst im Array stehen, statt herausgefiltert zu werden:
    -- `platform.consent_effective_status` liefert diesen Wert nie, der Vergleich kann also nicht
    -- versehentlich zutreffen — und ein zusätzliches Herausfiltern wäre eine Stelle mehr, an der
    -- die beiden Zweige auseinanderlaufen könnten.
    and (
      case
        when a.f_purposes is null and a.f_states is null then true
        else (
          a.f_states is not null
          and 'none' = any(a.f_states)
          and not exists (
            select 1
            from platform.consents c
            join platform.consent_texts ct on ct.id = c.consent_text_id
            where c.lead_id = ld.id
              and (a.f_purposes is null or ct.purpose::text = any(a.f_purposes))
          )
        )
        or (
          -- Nur wenn überhaupt ein echter Zustand angekreuzt ist (oder gar keiner — dann zählt
          -- jeder Zustand). Ohne diese Bedingung träfe „nur 'none' angekreuzt" auch jeden Lead MIT
          -- Einwilligung, und die Auswahl bewirkte das Gegenteil ihrer Beschriftung.
          (a.f_states is null or exists (select 1 from unnest(a.f_states) s where s <> 'none'))
          and exists (
            select 1
            from platform.consents c
            join platform.consent_texts ct on ct.id = c.consent_text_id
            where c.lead_id = ld.id
              and (a.f_purposes is null or ct.purpose::text = any(a.f_purposes))
              and (
                a.f_states is null
                or platform.consent_effective_status(c.status, c.token_expires_at) = any(a.f_states)
              )
          )
        )
      end
    );
$function$;

comment on function platform.leads_matching(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text,
  text, text, text, text, text, text, text[], text[], boolean, text[], text[], date, date, text
) is
  'B2-1, erweitert in B16-1, B18-5 und um die Spaltenfilter: die EINE Filterbedingung des Lead-Bestands, benutzt von public.admin_list_leads UND public.admin_export_leads. Zwei eigene WHERE-Klauseln wären zwei Auslegungen desselben Filters, und die Abweichung fiele erst an einer ausgeführten Datei auf, die andere Zeilen enthält als die Sicht, aus der sie entstand. Filtert nur — projiziert nicht und prüft keine Rechte (das machen die Wrapper). SECHS spaltenweise Textfilter (p_email, p_company, p_first_name, p_last_name, p_phone, p_assignment) neben dem älteren p_search, das E-Mail UND Firma gemeinsam durchsucht und deshalb für eine spaltenweise Bedienung ungeeignet ist. p_assignment durchsucht die DREI Quellen der Zuordnungsspalte (Anzeigename des Fachbetriebs, Name der formlos genannten Firma, referred_by_text) und ist ausdrücklich etwas anderes als p_partner_slug/p_partner_assignment: die fragen nach dem URTEIL, dieser nach dem angezeigten Text. p_source_keys ist die Mengen-Form von p_source_key (die drei Anzeige-Kategorien werden im Anwendungscode zu Schlüsseln aufgelöst — lead_sources ist eine Tabelle, eine Kategorienregel hier wäre eine zweite Taxonomie). p_thema_keys/p_thema_none sind kategorial, weil gespeichert der Schlüssel und angezeigt das Label ist; die Schlüssel werden NICHT geprüft (thema trägt bewusst keinen CHECK, es gibt kein Vokabular dafür). p_consent_purposes/p_consent_states sind die Mehrfachauswahl-Form der B1-3-Skalare, mit unveränderter ''none''-Bedeutung. p_created_from/-to filtern in EUROPE/VIENNA und mit EINSCHLIESSENDEN Grenzen — dieselbe Zeitzone, in der die Spalte angezeigt wird; in UTC fiele ein nachts erfasster Lead aus dem Filter seines eigenen Anzeigetags. Ein leeres Array ist kein Filter, sondern die Abwesenheit eines Filters. Kein Zugriffsweg von aussen. Leadgen 5: p_utm_source (angehängt) filtert per Substring auf first_utm_source.';

revoke all on function platform.leads_matching(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text,
  text, text, text, text, text, text, text[], text[], boolean, text[], text[], date, date, text
)
  from public, anon, authenticated, service_role;

CREATE FUNCTION platform.lead_filter_summary(p_status text DEFAULT NULL::text, p_source_key text DEFAULT NULL::text, p_consent_purpose platform.consent_purpose DEFAULT NULL::platform.consent_purpose, p_consent_status text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_due_only boolean DEFAULT false, p_industry platform.industry DEFAULT NULL::platform.industry, p_metering_type text DEFAULT NULL::text, p_postal_prefix text DEFAULT NULL::text, p_consumption_min integer DEFAULT NULL::integer, p_consumption_max integer DEFAULT NULL::integer, p_contract_end_from date DEFAULT NULL::date, p_contract_end_to date DEFAULT NULL::date, p_partner_slug text DEFAULT NULL::text, p_partner_assignment text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_company text DEFAULT NULL::text, p_first_name text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_assignment text DEFAULT NULL::text, p_source_keys text[] DEFAULT NULL::text[], p_thema_keys text[] DEFAULT NULL::text[], p_thema_none boolean DEFAULT false, p_consent_purposes text[] DEFAULT NULL::text[], p_consent_states text[] DEFAULT NULL::text[], p_created_from date DEFAULT NULL::date, p_created_to date DEFAULT NULL::date, p_utm_source text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  v_parts text[] := '{}';
  v_passign text := lower(nullif(btrim(coalesce(p_partner_assignment, '')), ''));
begin
  if nullif(btrim(coalesce(p_search, '')), '') is not null then
    v_parts := v_parts || ('Suche: ' || btrim(p_search));
  end if;
  -- Die sechs Spaltenfilter, benannt wie die Spalte, in der sie stehen — wer das Protokoll liest,
  -- soll die Sicht rekonstruieren können, ohne den Anwendungscode zu kennen.
  if nullif(btrim(coalesce(p_email, '')), '') is not null then
    v_parts := v_parts || ('E-Mail enthält: ' || btrim(p_email));
  end if;
  if nullif(btrim(coalesce(p_company, '')), '') is not null then
    v_parts := v_parts || ('Firma enthält: ' || btrim(p_company));
  end if;
  if nullif(btrim(coalesce(p_first_name, '')), '') is not null then
    v_parts := v_parts || ('Vorname enthält: ' || btrim(p_first_name));
  end if;
  if nullif(btrim(coalesce(p_last_name, '')), '') is not null then
    v_parts := v_parts || ('Name enthält: ' || btrim(p_last_name));
  end if;
  if nullif(btrim(coalesce(p_phone, '')), '') is not null then
    v_parts := v_parts || ('Telefon enthält: ' || btrim(p_phone));
  end if;
  if nullif(btrim(coalesce(p_assignment, '')), '') is not null then
    v_parts := v_parts || ('Zuordnung enthält: ' || btrim(p_assignment));
  end if;
  if nullif(btrim(coalesce(p_status, '')), '') is not null then
    v_parts := v_parts || ('Status: ' || btrim(p_status));
  end if;
  if nullif(btrim(coalesce(p_source_key, '')), '') is not null then
    v_parts := v_parts || ('Herkunft: ' || btrim(p_source_key));
  end if;
  -- Die SCHLÜSSEL, nicht die drei Anzeige-Kategorien: die Kategorie ist eine Entscheidung der
  -- Oberfläche und kann sich ändern (ein neuer Einstiegspunkt fällt automatisch in eine davon) —
  -- die Schlüsselmenge ist das, was tatsächlich gefiltert hat.
  if p_source_keys is not null and cardinality(p_source_keys) > 0 then
    v_parts := v_parts || ('Herkunft (Auswahl): ' || array_to_string(p_source_keys, ', '));
  end if;
  if p_consent_purpose is not null then
    v_parts := v_parts || ('Einwilligungszweck: ' || p_consent_purpose::text);
  end if;
  if nullif(btrim(coalesce(p_consent_status, '')), '') is not null then
    v_parts := v_parts || ('Einwilligungszustand: ' || btrim(p_consent_status));
  end if;
  if p_consent_purposes is not null and cardinality(p_consent_purposes) > 0 then
    v_parts := v_parts || ('Einwilligungszwecke: ' || array_to_string(p_consent_purposes, ', '));
  end if;
  if p_consent_states is not null and cardinality(p_consent_states) > 0 then
    v_parts := v_parts || ('Einwilligungszustände: ' || array_to_string(p_consent_states, ', '));
  end if;
  if p_thema_keys is not null and cardinality(p_thema_keys) > 0 then
    v_parts := v_parts || ('Thema: ' || array_to_string(p_thema_keys, ', '));
  end if;
  -- `::text` wie bei den übrigen nackten Literalen (s. u.) — ohne den Cast löst Postgres den
  -- `||`-Operator als `anyarray || anyarray` auf und bricht mit 22P02 ab.
  if coalesce(p_thema_none, false) then
    v_parts := v_parts || 'ohne Thema'::text;
  end if;
  if p_created_from is not null then
    v_parts := v_parts || ('Eingegangen ab ' || to_char(p_created_from, 'DD.MM.YYYY'));
  end if;
  if p_created_to is not null then
    v_parts := v_parts || ('Eingegangen bis ' || to_char(p_created_to, 'DD.MM.YYYY'));
  end if;
  -- ⚠ DER CAST IST DIE BEHEBUNG EINES BESTEHENDEN FEHLERS AUS B2-1, kein Stilmittel.
  -- `text[] || 'literal'` ist mehrdeutig: Postgres kann den Operator als `anyarray || anyelement`
  -- ODER als `anyarray || anyarray` auflösen und wählt hier das Array — die untypisierte Zeichenkette
  -- wird dann als Array-Literal gelesen und die Funktion bricht mit 22P02 („malformed array
  -- literal"). Die übrigen Zweige sind nicht betroffen, weil sie eine Verkettung übergeben
  -- (`'Suche: ' || btrim(...)`), die bereits `text` ist — betroffen sind ausschliesslich die
  -- Zweige mit einem NACKTEN Literal.
  if coalesce(p_due_only, false) then
    v_parts := v_parts || 'nur zur Anonymisierung fällige'::text;
  end if;
  if p_industry is not null then
    v_parts := v_parts || ('Branche: ' || p_industry::text);
  end if;
  if nullif(btrim(coalesce(p_metering_type, '')), '') is not null then
    v_parts := v_parts || ('Messart: ' || btrim(p_metering_type));
  end if;
  if nullif(btrim(coalesce(p_postal_prefix, '')), '') is not null then
    v_parts := v_parts || ('PLZ beginnt mit ' || btrim(p_postal_prefix));
  end if;
  if p_consumption_min is not null then
    v_parts := v_parts || ('Jahresverbrauch ab ' || p_consumption_min::text || ' kWh');
  end if;
  if p_consumption_max is not null then
    v_parts := v_parts || ('Jahresverbrauch bis ' || p_consumption_max::text || ' kWh');
  end if;
  if p_contract_end_from is not null then
    v_parts := v_parts || ('Vertragsende ab ' || to_char(p_contract_end_from, 'DD.MM.YYYY'));
  end if;
  if p_contract_end_to is not null then
    v_parts := v_parts || ('Vertragsende bis ' || to_char(p_contract_end_to, 'DD.MM.YYYY'));
  end if;
  if nullif(btrim(coalesce(p_utm_source, '')), '') is not null then
    v_parts := v_parts || ('utm_source enthält: ' || btrim(p_utm_source));
  end if;
  -- B16-1. Der SLUG wird protokolliert, nicht der Anzeigename: der Slug ist unveränderlich, der
  -- Anzeigename korrigierbar — ein Protokoll, dessen Aussage sich später mit einer Umbenennung
  -- ändert, ist kein Protokoll. (Aus demselben Grund ist die Funktion IMMUTABLE und liest die
  -- Partnertabelle gar nicht erst.)
  if nullif(btrim(coalesce(p_partner_slug, '')), '') is not null then
    v_parts := v_parts || ('Partner: ' || lower(btrim(p_partner_slug)));
  end if;
  -- B18-5. Bewusst als eigenständiger Satzteil und NICHT als „Partner: zugeordnet": neben der
  -- Zeile „Partner: <slug>" wäre das zweimal dasselbe Wort für zwei verschiedene Aussagen, und wer
  -- das Protokoll später liest, müsste raten, ob ein einzelner Betrieb gemeint war. Form wie
  -- „nur zur Anonymisierung fällige".
  -- `::text` aus demselben Grund wie beim Zweig darüber — nacktes Literal, sonst 22P02.
  if v_passign = 'assigned' then
    v_parts := v_parts || 'nur mit Fachbetrieb-Zuordnung'::text;
  elsif v_passign = 'unassigned' then
    v_parts := v_parts || 'nur ohne Fachbetrieb-Zuordnung'::text;
  end if;

  -- „alles" ist eine ANGEWANDTE Auswahl und wird als solche protokolliert — es gibt keinen Export
  -- ohne Filter, es gibt nur den Filter „alles".
  if cardinality(v_parts) = 0 then
    return 'alle (kein Filter gesetzt) — ohne gesperrte und anonymisierte Zeilen';
  end if;

  return array_to_string(v_parts, ' · ') || ' — ohne gesperrte und anonymisierte Zeilen';
end;
$function$;

comment on function platform.lead_filter_summary(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text,
  text, text, text, text, text, text, text[], text[], boolean, text[], text[], date, date, text
) is
  'B2-1, erweitert in B16-1, B18-5 und um die Spaltenfilter: der angewandte Filter als ein Satz für platform.admin_exports.filter_summary. Steht in der Datenbank und nicht im Anwendungscode, damit das Protokoll beschreibt, was tatsächlich angewandt wurde. Ein leerer Filter wird ausdrücklich als „alle" protokolliert — es gibt keinen ungefilterten Export, nur den Filter „alles". Partner, Herkunft und Thema erscheinen als SCHLÜSSEL und nicht als Anzeigename bzw. Kategorie: Schlüssel sind unveränderlich, Anzeigenamen korrigierbar und Kategorien eine Entscheidung der Oberfläche — ein Protokoll, dessen Aussage sich damit ändert, ist keins. Die B18-5-Zuordnungsfrage erscheint als eigener Satzteil und nicht als zweites „Partner: …" — sonst stünde dasselbe Wort für zwei verschiedene Aussagen. Leadgen 5: p_utm_source (angehängt) filtert per Substring auf first_utm_source.';

revoke all on function platform.lead_filter_summary(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text,
  text, text, text, text, text, text, text[], text[], boolean, text[], text[], date, date, text
)
  from public, anon, authenticated, service_role;

CREATE FUNCTION public.admin_list_leads(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_status text DEFAULT NULL::text, p_source_key text DEFAULT NULL::text, p_consent_purpose platform.consent_purpose DEFAULT NULL::platform.consent_purpose, p_consent_status text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_due_only boolean DEFAULT false, p_industry platform.industry DEFAULT NULL::platform.industry, p_metering_type text DEFAULT NULL::text, p_postal_prefix text DEFAULT NULL::text, p_consumption_min integer DEFAULT NULL::integer, p_consumption_max integer DEFAULT NULL::integer, p_contract_end_from date DEFAULT NULL::date, p_contract_end_to date DEFAULT NULL::date, p_partner_slug text DEFAULT NULL::text, p_partner_assignment text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_company text DEFAULT NULL::text, p_first_name text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_assignment text DEFAULT NULL::text, p_source_keys text[] DEFAULT NULL::text[], p_thema_keys text[] DEFAULT NULL::text[], p_thema_none boolean DEFAULT false, p_consent_purposes text[] DEFAULT NULL::text[], p_consent_states text[] DEFAULT NULL::text[], p_created_from date DEFAULT NULL::date, p_created_to date DEFAULT NULL::date, p_utm_source text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_limit    integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset   integer := greatest(coalesce(p_offset, 0), 0);
  v_status   text    := nullif(btrim(coalesce(p_status, '')), '');
  v_cstatus  text    := nullif(btrim(coalesce(p_consent_status, '')), '');
  v_metering text    := nullif(btrim(coalesce(p_metering_type, '')), '');
  v_prefix   text    := nullif(btrim(coalesce(p_postal_prefix, '')), '');
  v_partner  text    := lower(nullif(btrim(coalesce(p_partner_slug, '')), ''));
  v_passign  text    := lower(nullif(btrim(coalesce(p_partner_assignment, '')), ''));
  v_invalid  text;
  v_total    integer;
  v_export   integer;
  v_leads    jsonb;
  v_sources  jsonb;
  v_partners jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_list_leads: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  -- Ein unbekannter Filterwert wird ABGELEHNT und nicht ignoriert: eine still verworfene
  -- Einschränkung zeigte mehr Zeilen, als der Admin angefordert hat — und er hielte das Ergebnis
  -- für gefiltert.
  v_invalid := platform.invalid_lead_filter(
    v_status, v_cstatus, v_metering, v_prefix, v_partner, v_passign,
    p_source_keys, p_consent_purposes, p_consent_states, p_created_from, p_created_to
  );
  if v_invalid is not null then
    return jsonb_build_object('status', 'invalid_filter', 'filter', v_invalid);
  end if;

  with base as (
    select ld.id, ld.email, ld.company, ld.first_name, ld.last_name, ld.phone, ld.status,
           ld.first_source_key, ld.retention_basis, ld.last_interaction_at,
           ld.deletion_due_at, ld.anonymized_at, ld.anonymized_by, ld.created_at,
           -- B2-1: die Segmentierungsmerkmale fahren in der LISTE mit. Ohne sie liesse sich ein
           -- gesetzter Filter nicht am Ergebnis nachvollziehen — man sähe nur, dass die Menge
           -- kleiner wurde, nicht warum.
           ld.industry, ld.postal_code, ld.annual_consumption_kwh, ld.metering_type,
           ld.supplier, ld.contract_end_date,
           -- B16-1: beide Felder, aus demselben Grund — und weil erst ihr NEBENEINANDER die
           -- eigentliche Arbeit sichtbar macht: ein Lead mit Freitext, aber ohne Zuordnung ist
           -- genau der Fall, den ein Mensch entscheiden muss.
           ld.partner_slug, ld.referred_by_text,
           -- Die formlose Firmenerwähnung (B19-Nachbesserung). Bis hierher stand sie NUR in
           -- admin_get_lead, also nur auf der Detailseite — die Zuordnungsspalte der Liste bliebe
           -- ohne sie ausgerechnet bei intern aufgenommenen Anfragen leer.
           ld.mentioned_business_id,
           (select mb.name
              from platform.mentioned_businesses mb
             where mb.id = ld.mentioned_business_id) as mentioned_business_name,
           -- Das Thema der Anfrage. Der SCHLÜSSEL, nicht das Label — die Anzeige löst ihn über
           -- dieselbe Liste auf, die das Dropdown füllt (findThema). Ein hier gebildetes Label wäre
           -- eine zweite Übersetzung neben messages/*.json.
           ld.thema,
           -- Leadgen 5: first touch für die Spalte „Herkunft (UTM)“.
           ld.first_utm_source, ld.first_utm_medium, ld.first_utm_campaign
    from platform.leads_matching(
           p_status, p_source_key, p_consent_purpose, p_consent_status, p_search, p_due_only,
           p_industry, p_metering_type, p_postal_prefix, p_consumption_min, p_consumption_max,
           p_contract_end_from, p_contract_end_to, p_partner_slug, p_partner_assignment,
           p_email, p_company, p_first_name, p_last_name, p_phone, p_assignment,
           p_source_keys, p_thema_keys, p_thema_none, p_consent_purposes, p_consent_states,
           p_created_from, p_created_to, p_utm_source
         ) ld
  ),
  page as (
    select b.*,
           -- Eine Sperre steht im HASH und ist durch keinen Join sichtbar; ohne diese Spalte sähe
           -- ein Admin einen scheinbar anschreibbaren Lead, der abgemeldet ist (B1-1).
           platform.is_suppressed(b.email) as is_suppressed,
           (b.deletion_due_at <= now() and b.anonymized_at is null) as deletion_due,
           coalesce((
             select jsonb_agg(
                      jsonb_build_object(
                        'purpose',          ct.purpose,
                        'status',           c.status,
                        'effective_status',
                          platform.consent_effective_status(c.status, c.token_expires_at),
                        'granted_at',       c.granted_at,
                        'confirmed_at',     c.confirmed_at,
                        'withdrawn_at',     c.withdrawn_at
                      ) order by ct.purpose, c.granted_at desc
                    )
             from platform.consents c
             join platform.consent_texts ct on ct.id = c.consent_text_id
             where c.lead_id = b.id
           ), '[]'::jsonb) as consents
    from base b
    order by b.created_at desc
    limit v_limit offset v_offset
  )
  select (select count(*)::integer from base),
         (select count(*)::integer from base b
           where b.anonymized_at is null and not platform.is_suppressed(b.email)),
         coalesce(
           (select jsonb_agg(to_jsonb(p) order by p.created_at desc) from page p),
           '[]'::jsonb
         )
    into v_total, v_export, v_leads;

  -- Die Einstiegspunkte fahren MIT, statt einen weiteren Wrapper zu brauchen: `lead_sources` ist eine
  -- TABELLE, weil laufend neue Einstiegspunkte dazukommen (B1-1/B3) — die Filterauswahl kann sie
  -- deshalb nicht als Konstante im Anwendungscode spiegeln, sonst fehlte jede neue Quelle im Filter.
  select coalesce(jsonb_agg(jsonb_build_object('key', s.key, 'label', s.label) order by s.label), '[]'::jsonb)
    into v_sources
  from platform.lead_sources s;

  -- B16-1: die Partner aus genau demselben Grund. Zusätzlich `is_active`, damit die Auswahl einen
  -- stillgelegten Fachbetrieb kennzeichnen kann, statt ihn wegzulassen — seine Leads sind ja noch da.
  select coalesce(
           jsonb_agg(
             jsonb_build_object('slug', p.slug, 'display_name', p.display_name,
                                'is_active', p.is_active)
             order by p.display_name
           ),
           '[]'::jsonb
         )
    into v_partners
  from platform.partners p;

  return jsonb_build_object(
    'status',       'ok',
    'leads',        v_leads,
    'total',        v_total,
    'export_total', v_export,
    'limit',        v_limit,
    'offset',       v_offset,
    'sources',      v_sources,
    'partners',     v_partners
  );
end;
$function$;

comment on function public.admin_list_leads(
  integer, integer, text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text,
  text, text, text, text, text, text, text[], text[], boolean, text[], text[], date, date, text
) is
  'B1-1/B1-3, erweitert in B2-1, B16-1, B18-5, um thema und um die Spaltenfilter: paginierte, gefilterte Lead-Liste (neueste zuerst, limit 1..200, default 50). Filtert AUSSCHLIESSLICH über platform.leads_matching — dieselbe Bedingung, die auch public.admin_export_leads benutzt. Je Zeile zusätzlich is_suppressed, deletion_due, die Einwilligungen mit effective_status, die Segmentierungsmerkmale, partner_slug samt referred_by_text, thema sowie mentioned_business_id/-name (die formlose Firmenerwähnung der B19-Nachbesserung, bis dahin nur in admin_get_lead: ohne sie bliebe die Zuordnungsspalte der Liste ausgerechnet bei intern aufgenommenen Anfragen leer). Der Firmenname kommt als Unterabfrage je Zeile und nicht als Nachschlageliste wie die Partner — formlos genannte Firmen sind eine offene Menge, von der je Seite nur eine Handvoll vorkommt. Ein unbekannter Filterwert wird als {status: invalid_filter, filter} ABGELEHNT und nicht ignoriert; die Prüfung steht in platform.invalid_lead_filter und ist mit admin_export_leads geteilt. WIRFT bei fehlender Adminrolle (SQLSTATE 42501). authenticated-only. Leadgen 5: p_utm_source (angehängt) filtert per Substring auf first_utm_source.';

revoke all on function public.admin_list_leads(
  integer, integer, text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text,
  text, text, text, text, text, text, text[], text[], boolean, text[], text[], date, date, text
)
  from public, anon, service_role;
grant execute on function public.admin_list_leads(
  integer, integer, text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text,
  text, text, text, text, text, text, text[], text[], boolean, text[], text[], date, date, text
)
  to authenticated;

CREATE FUNCTION public.admin_export_leads(p_status text DEFAULT NULL::text, p_source_key text DEFAULT NULL::text, p_consent_purpose platform.consent_purpose DEFAULT NULL::platform.consent_purpose, p_consent_status text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_due_only boolean DEFAULT false, p_industry platform.industry DEFAULT NULL::platform.industry, p_metering_type text DEFAULT NULL::text, p_postal_prefix text DEFAULT NULL::text, p_consumption_min integer DEFAULT NULL::integer, p_consumption_max integer DEFAULT NULL::integer, p_contract_end_from date DEFAULT NULL::date, p_contract_end_to date DEFAULT NULL::date, p_partner_slug text DEFAULT NULL::text, p_partner_assignment text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_company text DEFAULT NULL::text, p_first_name text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_assignment text DEFAULT NULL::text, p_source_keys text[] DEFAULT NULL::text[], p_thema_keys text[] DEFAULT NULL::text[], p_thema_none boolean DEFAULT false, p_consent_purposes text[] DEFAULT NULL::text[], p_consent_states text[] DEFAULT NULL::text[], p_created_from date DEFAULT NULL::date, p_created_to date DEFAULT NULL::date, p_utm_source text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_metering  text := nullif(btrim(coalesce(p_metering_type, '')), '');
  v_prefix    text := nullif(btrim(coalesce(p_postal_prefix, '')), '');
  v_status    text := nullif(btrim(coalesce(p_status, '')), '');
  v_cstatus   text := nullif(btrim(coalesce(p_consent_status, '')), '');
  v_partner   text := lower(nullif(btrim(coalesce(p_partner_slug, '')), ''));
  v_passign   text := lower(nullif(btrim(coalesce(p_partner_assignment, '')), ''));
  v_invalid   text;
  v_rows      jsonb;
  v_count     integer;
  v_summary   text;
  v_export_id uuid;
  v_at        timestamptz;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_export_leads: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  -- Dieselben Ablehnungen wie in admin_list_leads, und zwar buchstäblich dieselben: ein unbekannter
  -- Filterwert darf auch hier nicht still zu einer GRÖSSEREN Menge führen — bei einer Datei, die das
  -- System verlässt, erst recht nicht. Seit dieser Migration steht die Prüfung an EINER Stelle;
  -- zwei abgeschriebene Listen hätten sich beim nächsten neuen Filterwert getrennt entwickelt.
  v_invalid := platform.invalid_lead_filter(
    v_status, v_cstatus, v_metering, v_prefix, v_partner, v_passign,
    p_source_keys, p_consent_purposes, p_consent_states, p_created_from, p_created_to
  );
  if v_invalid is not null then
    return jsonb_build_object('status', 'invalid_filter', 'filter', v_invalid);
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb),
         count(*)::integer
    into v_rows, v_count
  from (
    select ld.id,
           ld.email,
           ld.company,
           ld.first_name,
           ld.last_name,
           ld.phone,
           ld.status,
           ld.first_source_key,
           (select s.label from platform.lead_sources s where s.key = ld.first_source_key)
             as first_source_label,
           ld.industry,
           ld.postal_code,
           ld.annual_consumption_kwh,
           ld.metering_type,
           ld.supplier,
           ld.contract_end_date,
           -- B16-1: die Zuordnung samt Anzeigename (ohne ihn wäre die Datei in einem fremden
           -- Werkzeug nur eine Spalte mit Schlüsseln) UND der Freitext als Beleg.
           ld.partner_slug,
           (select p.display_name from platform.partners p where p.slug = ld.partner_slug)
             as partner_display_name,
           ld.referred_by_text,
           ld.thema,
           ld.created_at,
           ld.last_interaction_at,
           -- PFLICHTSPALTE: ohne sie ist jede Zeile in einem fremden Werkzeug ununterscheidbar
           -- anschreibbar.
           platform.marketing_consent_state(ld.id) as marketing_consent
    from platform.leads_matching(
           p_status, p_source_key, p_consent_purpose, p_consent_status, p_search, p_due_only,
           p_industry, p_metering_type, p_postal_prefix, p_consumption_min, p_consumption_max,
           p_contract_end_from, p_contract_end_to, p_partner_slug, p_partner_assignment,
           p_email, p_company, p_first_name, p_last_name, p_phone, p_assignment,
           p_source_keys, p_thema_keys, p_thema_none, p_consent_purposes, p_consent_states,
           p_created_from, p_created_to, p_utm_source
         ) ld
    where ld.anonymized_at is null
      and not platform.is_suppressed(ld.email)
  ) r;

  v_summary := platform.lead_filter_summary(
    p_status, p_source_key, p_consent_purpose, p_consent_status, p_search, p_due_only,
    p_industry, p_metering_type, p_postal_prefix, p_consumption_min, p_consumption_max,
    p_contract_end_from, p_contract_end_to, p_partner_slug, p_partner_assignment,
    p_email, p_company, p_first_name, p_last_name, p_phone, p_assignment,
    p_source_keys, p_thema_keys, p_thema_none, p_consent_purposes, p_consent_states,
    p_created_from, p_created_to, p_utm_source
  );

  insert into platform.admin_exports (exported_by, row_count, filter_summary)
  values (auth.uid(), v_count, v_summary)
  returning id, exported_at into v_export_id, v_at;

  return jsonb_build_object(
    'status',         'ok',
    'rows',           v_rows,
    'row_count',      v_count,
    'filter_summary', v_summary,
    'export_id',      v_export_id,
    'exported_at',    v_at
  );
end;
$function$;

comment on function public.admin_export_leads(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text,
  text, text, text, text, text, text, text[], text[], boolean, text[], text[], date, date, text
) is
  'B2-1, erweitert in B16-1, B18-5, um thema und um die Spaltenfilter: die gefilterte Ausfuhr des Lead-Bestands. Übernimmt GENAU den Filter der Sicht (dieselbe platform.leads_matching) und protokolliert jeden Lauf in platform.admin_exports. Schliesst gesperrte und anonymisierte Zeilen in der ABFRAGE aus, nicht über einen Filter — eine ausgeführte Datei kann in ein fremdes Werkzeug wandern, das die Sperrliste nicht kennt. Bekommt die Spaltenfilter, aber BEWUSST KEINE neue Spalte (mentioned_business): ein Filter schränkt die Zeilenmenge ein, eine Spalte änderte das Dateiformat, auf das ausserhalb dieses Repos jemand baut. WIRFT bei fehlender Adminrolle (SQLSTATE 42501). authenticated-only. Leadgen 5: p_utm_source (angehängt) filtert per Substring auf first_utm_source.';

revoke all on function public.admin_export_leads(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text,
  text, text, text, text, text, text, text[], text[], boolean, text[], text[], date, date, text
)
  from public, anon, service_role;
grant execute on function public.admin_export_leads(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text,
  text, text, text, text, text, text, text[], text[], boolean, text[], text[], date, date, text
)
  to authenticated;
