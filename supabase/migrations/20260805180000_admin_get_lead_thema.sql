-- Die Detailansicht eines Leads zeigt das Thema — `public.admin_get_lead` nachgezogen.
--
-- ⚠ MASSGEBLICH FÜR DEN STAND DIESER REIHE IST DER HANDOVER IN `apps/web/CLAUDE.md`.
--
-- ── DER ANLASS: EIN FELD, DAS GESCHRIEBEN, ABER NIRGENDS GELESEN WERDEN KANN ────────────────────
-- Mit der Vorgänger-Migration (`20260805150000_create_lead_thema.sql`) trägt `platform.leads` die
-- Spalte `thema`, und der Kontaktweg befüllt sie. Im selben Schritt bekommen `admin_list_leads` und
-- `admin_export_leads` die Spalte mit — `admin_get_lead` NICHT: der Wrapper baut seine Spaltenliste
-- explizit auf und übernimmt eine neue Spalte deshalb nicht von selbst (in der Vorgänger-Migration
-- ausdrücklich als offener Punkt für genau diesen Schritt vermerkt).
--
-- Jetzt bekommt auch das interne Aufnahmeformular („Lead anlegen", B19) eine Themen-Auswahl. Ohne
-- diese eine Zeile wäre das Thema dort EINGEBBAR und auf der Detailseite UNSICHTBAR — also genau
-- das Muster, das B19 an anderer Stelle ausdrücklich vermeidet: ein Feld ohne Speicherort war dort
-- der Grund, es wegzulassen; hier wäre es ein Speicherort ohne Sicht. Beides ist eine Requisite.
--
-- ── WAS SICH ÄNDERT: EINE ZEILE IN DER AUSWAHLLISTE ─────────────────────────────────────────────
-- `create or replace` bei UNVERÄNDERTER Signatur — die Grants bleiben (authenticated-only), es gibt
-- keinen DROP und damit nichts wiederherzustellen. Die Rückgabe wächst rein ADDITIV um `thema` im
-- `lead`-Objekt; kein bestehender Leser bricht daran.
--
-- ── WAS AUSDRÜCKLICH NICHT ENTSTEHT ─────────────────────────────────────────────────────────────
-- Keine neue Spalte, kein CHECK, kein Enum, kein Index, kein neuer Wrapper. Keine Änderung an
-- `public.capture_lead`, `admin_list_leads`, `admin_export_leads` (die tragen die Spalte seit der
-- Vorgänger-Migration), `admin_update_lead` (das Thema ist die ANGABE des Absenders, kein Urteil
-- eines Admins — dieselbe Trennlinie wie zwischen `referred_by_text` und `partner_slug`),
-- `platform.leads_matching`/`lead_filter_summary`, `platform.anonymize_lead`,
-- `platform.guard_anonymized_lead` (das Thema steht dort seit der Vorgänger-Migration) und
-- `public.get_my_partner_leads` (ein Fachbetrieb sieht das Thema nicht).
--
-- ── ARBEITSREGEL 1 ──────────────────────────────────────────────────────────────────────────────
-- Es wird keine Spalte umbenannt oder entfernt. Der Rumpf ist wortgleich der der
-- B19-Nachbesserung (`20260805120000_create_mentioned_businesses.sql`), erweitert um genau eine
-- Zeile — kein zweiter Fundort, keine stille Abweichung.

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
           ld.first_name,
           ld.last_name,
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
           -- B16-1: Zuordnung, Anzeigename und Freitext. Der Anzeigename fährt mit, damit die
           -- Detailansicht keinen zweiten Aufruf braucht, um einen Namen statt eines Schlüssels zu
           -- zeigen; is_active dazu, weil „zugeordnet zu einem stillgelegten Fachbetrieb" ein
           -- Zustand ist, den man sehen muss, statt ihn aus dem Ausbleiben zu schliessen.
           ld.partner_slug,
           (select p.display_name from platform.partners p where p.slug = ld.partner_slug)
             as partner_display_name,
           (select p.is_active from platform.partners p where p.slug = ld.partner_slug)
             as partner_is_active,
           ld.referred_by_text,
           -- B19-Nachbesserung: die formlose Firmenerwähnung. Steht NEBEN der Partner-Zuordnung und
           -- ersetzt sie nicht — sie trägt kein Zugriffsrecht (s. TEIL 2).
           -- Das Thema der Anfrage: der SCHLÜSSEL aus apps/web/lib/kontakt/themen.ts, nicht das
           -- übersetzte Label — die Anzeige löst ihn über dieselbe Liste auf, die das Dropdown
           -- füllt. Ein hier gebildetes Label wäre eine zweite Übersetzung neben messages/*.json.
           ld.thema,
           ld.mentioned_business_id,
           (select mb.name from platform.mentioned_businesses mb
             where mb.id = ld.mentioned_business_id) as mentioned_business_name,
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
  'B1-1, erweitert in B1-3, B3-1, B4-1, B4-2, B2-1, B2-2, B16-1, der B19-Nachbesserung und um thema: '
  'ein Lead samt allen Einwilligungen (inkl. angezeigtem Textkörper, Version/Sprache und '
  'effective_status), den sechs Segmentierungsmerkmalen, der Urheberschaft einer Anonymisierung, dem '
  'Versandprotokoll der Vertragsablauf-Erinnerung, last_edited_by samt Konto-E-Mail, dem GRUND einer '
  'Sperre (suppression_reason), der Partner-Attribution (partner_slug, partner_display_name, '
  'partner_is_active, referred_by_text), der formlosen Firmenerwähnung (mentioned_business_id samt '
  'mentioned_business_name — eine Beobachtung ohne Zugriffswirkung, ausdrücklich nicht dasselbe wie '
  'partner_slug) und dem Thema der Anfrage (thema — der SCHLÜSSEL aus lib/kontakt/themen.ts, nicht '
  'das übersetzte Label; ohne diese Zeile wäre das Feld über das interne Aufnahmeformular eingebbar '
  'und nirgends lesbar). Der Kontaktname kommt seit der Auftrennung als first_name und last_name. '
  'token_hash/token_expires_at fahren bewusst nicht mit. WIRFT bei fehlender Adminrolle (42501); ein '
  'unbekannter Lead ist ein fachlicher Zustand. authenticated-only.';
