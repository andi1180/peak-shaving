-- K1b-Korrektur: `public.admin_get_battery` gibt wieder die Hülle {status, battery} zurück.
--
-- In K1b ist die Funktion neu gefasst worden, um die Bausteine mitzuliefern (TEIL 6) — dabei ist
-- aus `jsonb_build_object('status','ok','battery', …)` versehentlich die nackte Zeile geworden.
-- Der Aufrufer `apps/web/lib/admin/battery-catalog-data.ts` prüft `payload.status === 'ok'` und
-- hätte für JEDES Gerät `null` gelesen: die Bearbeiten-Seite wäre stumm zu einer 404 geworden.
--
-- Eigene Migration statt einer Korrektur in der K1b-Datei: die K1b-Migration ist bereits
-- angewandt, und `supabase_migrations.schema_migrations` hält ihren Wortlaut fest. Eine
-- nachträgliche Änderung dort liesse Datei und Historie auseinanderlaufen.
--
-- Gefunden, weil der Rückgabe-Vertrag der ERSETZTEN Funktion gegen den Aufrufer geprüft wurde,
-- nicht weil ein Test angeschlagen hätte — die Signatur ist unverändert, und der Typ `jsonb`
-- trägt die Hülle so gut wie ihr Fehlen.

create or replace function public.admin_get_battery(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_get_battery: Adminrolle erforderlich' using errcode = '42501';
  end if;

  select to_jsonb(r) into v_row
  from (
    select b.*,
           pp.purchase_price_net,
           pp.as_of as purchase_price_as_of,
           fc.bezeichnung as foundation_component_label,
           fc.price_net   as foundation_component_price_net,
           ic.bezeichnung as installation_component_label,
           ic.price_net   as installation_component_price_net
      from public.battery_catalog b
      left join platform.battery_purchase_prices pp on pp.battery_id = b.id
      left join public.battery_cost_components fc on fc.id = b.foundation_component_id
      left join public.battery_cost_components ic on ic.id = b.installation_component_id
     where b.id = p_id
  ) r;

  if v_row is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  return jsonb_build_object('status', 'ok', 'battery', v_row);
end;
$$;
