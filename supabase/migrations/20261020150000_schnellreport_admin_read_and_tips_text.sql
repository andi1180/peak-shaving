-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Leadgen-Umbau Schritt 3b-3 — Schnellcheck-Werte im Admin, neue Fassung der Tipp-Einwilligung
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

-- ── TEIL 1 — neue Fassung der Tipp-Einwilligung (nennt den Absender) ─────────────────────────────
-- Append-only: die Fassung aus 3b-2 bleibt als Nachweis für bereits erteilte Einwilligungen stehen.
-- platform.active_consent_text_id wählt je Herkunft die höchste Version, also ab hier diese.
insert into platform.consent_texts (purpose, version, locale, body, source_key)
select 'marketing_email',
       coalesce((select max(ct.version) from platform.consent_texts ct
                  where ct.purpose = 'marketing_email' and ct.locale = 'de'), 0) + 1,
       'de',
       'Ja, COOLiN ENERGY darf mir in den nächsten Wochen Tipps für meinen Betrieb per E-Mail '
       'schicken: wie ich meinen Lastgang bekomme, wie ein Profi-Report aussieht, ein echter '
       'Praxisfall. 4 E-Mails, Abmeldung jederzeit.',
       'schnellreport'
where not exists (
  select 1 from platform.consent_texts ct
   where ct.purpose = 'marketing_email' and ct.locale = 'de' and ct.source_key = 'schnellreport'
     and ct.body like 'Ja, COOLiN ENERGY darf mir%'
);

-- ── TEIL 2 — Lesezugriff für die Admin-Lead-Detailseite ─────────────────────────────────────────
-- Je Report die Werte plus zwei abgeleitete Angaben aus den Einwilligungen derselben Herkunft ab
-- dem Zeitpunkt des Reports: Rückruf gewünscht (offer_contact) und Tipp-Mails bestätigt.
create function public.admin_list_schnellreport_requests(p_lead_id uuid)
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
    raise exception 'public.admin_list_schnellreport_requests: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row_data order by created_at desc), '[]'::jsonb)
    into v_rows
  from (
    select r.created_at,
           jsonb_build_object(
             'id',                      r.id,
             'created_at',              r.created_at,
             'country',                 r.country,
             'branche',                 r.branche,
             'annual_kwh',              r.annual_kwh,
             'peak_kw',                 r.peak_kw,
             'peak_kw_entered',         r.peak_kw_entered,
             'bill_eur',                r.bill_eur,
             'demand_price_eur_per_kw', r.demand_price_eur_per_kw,
             'peak_cost_eur',           r.peak_cost_eur,
             'tips_requested',          r.tips_requested,
             'tips_confirmed', exists (
               select 1 from platform.consents c
                 join platform.consent_texts ct on ct.id = c.consent_text_id
                where c.lead_id = r.lead_id and c.source_key = 'schnellreport'
                  and ct.purpose = 'marketing_email' and c.status = 'confirmed'
                  and c.granted_at >= r.created_at
             ),
             'callback_requested', exists (
               select 1 from platform.consents c
                 join platform.consent_texts ct on ct.id = c.consent_text_id
                where c.lead_id = r.lead_id and c.source_key = 'schnellreport'
                  and ct.purpose = 'offer_contact'
                  and c.granted_at >= r.created_at
             )
           ) as row_data
    from platform.schnellreport_requests r
    where r.lead_id = p_lead_id
  ) s;

  return v_rows;
end;
$$;

comment on function public.admin_list_schnellreport_requests(uuid) is
  'Leadgen 3b-3: die Schnellreport-Anforderungen eines Leads (neueste zuerst) samt „Rückruf '
  'gewünscht" und „Tipp-Mails bestätigt". Nur lesend, authenticated-only, wirft 42501 ohne Admin.';

revoke all on function public.admin_list_schnellreport_requests(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_list_schnellreport_requests(uuid) to authenticated;
