-- B18-5 — „hat einen Fachbetrieb zugeordnet" bzw. „hat keinen" als eigener Filter.
--
-- Der Admin-Bereich soll die Partner-Leads als Menge sehen können, nicht nur die eines EINZELNEN
-- Fachbetriebs. Das ist eine andere Frage als die, die B16-1 beantwortet hat, und deshalb ein
-- eigener Parameter statt einer zweiten Bedeutung für `p_partner_slug`.
--
-- ── WAS BEREITS DA WAR, UND DESHALB HIER NICHT NOCH EINMAL ENTSTEHT ──────────────────────────────
-- `partner_slug` FÄHRT SEIT B16-1 IN BEIDEN RÜCKGABEN MIT (in `admin_list_leads` in der base-CTE,
-- in `admin_export_leads` samt Anzeigename und Freitext), und BEIDE Wrapper reichen `p_partner_slug`
-- bereits an `platform.leads_matching` durch. Vor dieser Migration am laufenden Stand nachgemessen
-- (`pg_get_functiondef`), nicht aus der Aufgabenstellung übernommen. Was fehlte, ist ausschliesslich
-- der Vorhanden/Nicht-vorhanden-Umschalter — und, auf der Anwendungsseite, dass `lib/admin/
-- lead-filters.ts` überhaupt einen Partner-Filter kennt.
--
-- ── WARUM DER FILTER IN `leads_matching` LANDET UND NICHT IN DEN ZWEI WRAPPERN ───────────────────
-- Die naheliegende Abkürzung wäre ein `where partner_slug is not null` in `admin_list_leads` und
-- dasselbe noch einmal in `admin_export_leads`. Das ist genau die Verdopplung, gegen die B2-1 diese
-- Schicht gebaut hat: eine Filterbedingung mit zwei Fundorten hat zwei Auslegungen, und die
-- Abweichung fiele erst an einer ausgeführten Datei auf, die andere Zeilen enthält als die Sicht,
-- aus der sie entstand. In B16-1 ist derselbe Fall schon einmal entschieden worden.
--
-- Der übliche Einwand gegen einen neuen Parameter — „er hilft nur EINEM Aufrufer und weicht die
-- gemeinsame Funktion auf" — trägt hier nicht: `platform.leads_matching` hat GENAU ZWEI Aufrufer
-- (geprüft über alle Funktionsrümpfe in `public` und `platform`), und beide brauchen diesen Filter.
-- Der Export braucht ihn sogar zwingend, weil er die Filter der Sicht übernimmt.
--
-- ── WARUM `text` MIT ZWEI LITERALEN UND KEIN DREIWERTIGER `boolean` ──────────────────────────────
-- Ein `p_has_partner boolean default null` (null/true/false) wäre die idiomatischere SQL-Form und
-- ist trotzdem die schlechtere: Der Anwendungscode liest seine Filter aus der URL, also aus
-- Zeichenketten. Er müsste sie auf `boolean` abbilden, und ein unbekannter Wert (`?partner=quatsch`)
-- könnte dabei nur zu `null` werden — also zu „kein Filter". Der Admin bekäme den UNGEFILTERTEN
-- Bestand und hielte ihn für gefiltert. Genau diesen stillen Ausfall vermeidet diese Schicht seit
-- B2-1 an jeder anderen Stelle, indem ein unbekannter Wert UNVERÄNDERT durchgereicht und hier als
-- `invalid_filter` ABGELEHNT wird. Mit `text` gilt das auch für diesen Filter, ohne Sonderweg.
-- Vorbild ist `p_consent_status`: ebenfalls text, ebenfalls eine feste Wertemenge, ebenfalls im
-- Wrapper geprüft — und ebenfalls mit einem umkehrenden Wert (`'none'`).
--
-- Die Werte heissen `assigned`/`unassigned` und nicht `mit`/`ohne`: Filterwerte sind in diesem
-- System durchgehend DATENBANKwerte (`new`, `confirmed`, `netzebene_7`), nur die Parameternamen der
-- URL sind deutsch. Eine deutsche Wertemenge wäre der erste Fundort einer zweiten Konvention.
--
-- ── DIE EINE KOMBINATION, DIE ABGEWIESEN WIRD ───────────────────────────────────────────────────
-- `p_partner_slug` gesetzt UND `p_partner_assignment = 'unassigned'` ist ein Widerspruch: Die Menge
-- ist per Konstruktion leer, und eine leere Menge läse sich als „dieser Fachbetrieb hat niemanden
-- gebracht" — dieselbe Fehlauskunft, gegen die B16-1 den unbekannten Slug ablehnt statt ihn leer
-- zu beantworten. Der Fall ist nicht theoretisch: Sobald der geplante Reiter „Partner-Leads" eine
-- Auswahlliste einzelner Betriebe bekommt, steht daneben genau dieser Umschalter.
-- `'assigned'` + Slug ist dagegen zulässig — redundant, aber widerspruchsfrei und mit einem
-- richtigen Ergebnis.
--
-- Geprüft wird das in den WRAPPERN, nicht in `leads_matching`: die filtert nur und prüft nichts
-- (B2-1), und alle übrigen Filterprüfungen stehen ebenfalls dort.
--
-- ── FORM DER ÄNDERUNG ───────────────────────────────────────────────────────────────────────────
-- Alle vier Funktionen per DROP + CREATE: die Parameterliste wächst, `create or replace` kann das
-- nicht, und ein blosses CREATE erzeugte eine zweite Überladung (ein Aufruf mit der bisherigen
-- Argumentzahl wäre dann mehrdeutig). Der neue Parameter hängt HINTEN an und hat einen Vorgabewert
-- — bestehende Aufrufe bleiben gültig, benannte wie positionale (Muster `p_locale`/B3-1,
-- `p_partner_slug`/B16-1).
--
-- FOLGE: Der DROP entfernt die Grants der beiden `public`-Wrapper. Sie werden am Ende erneut
-- gesetzt (in B3-1 real einmal übersehen worden). Die zwei `platform`-Funktionen tragen keine
-- Grants; der Entzug wird trotzdem erneut ausgesprochen, damit die Aussage in dieser Datei gesetzt
-- und nicht vorausgesetzt ist.
--
-- ── ARBEITSREGEL 1 ──────────────────────────────────────────────────────────────────────────────
-- Es wird keine Spalte umbenannt oder entfernt; alle Funktionsrümpfe in `public` und `platform`
-- wurden vorab nach `leads_matching`/`lead_filter_summary` durchsucht, um die vollständige
-- Aufruferliste zu kennen (Ergebnis: die zwei Wrapper dieser Datei, sonst nichts).
--
-- NICHT Teil dieser Migration: eine Oberfläche für den Filter, ein Reiter „Partner-Leads",
-- Spaltenänderungen in der Anzeige, `get_my_partner`/`get_my_partner_leads` (anderer Bereich:
-- der Partner selbst, nicht der Admin), `tenant_id`.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — platform.leads_matching: die EINE Filterbedingung
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
drop function platform.leads_matching(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text
);

create function platform.leads_matching(
  p_status text default null,
  p_source_key text default null,
  p_consent_purpose platform.consent_purpose default null,
  p_consent_status text default null,
  p_search text default null,
  p_due_only boolean default false,
  p_industry platform.industry default null,
  p_metering_type text default null,
  p_postal_prefix text default null,
  p_consumption_min integer default null,
  p_consumption_max integer default null,
  p_contract_end_from date default null,
  p_contract_end_to date default null,
  p_partner_slug text default null,
  -- B18-5, angehängt mit Vorgabewert null:
  p_partner_assignment text default null
)
returns setof platform.leads
language sql
stable
set search_path = ''
as $$
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
           -- LIKE-Sonderzeichen maskieren, damit ein getipptes „%" nicht plötzlich alles trifft
           -- (B1-3): der Admin sucht eine Adresse, er schreibt kein Muster.
           case
             when nullif(btrim(coalesce(p_search, '')), '') is null then null
             else '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_')
                      || '%'
           end                                               as f_pattern
  )
  select ld.*
  from platform.leads ld, args a
  where (a.f_status is null or ld.status = a.f_status)
    and (a.f_source is null or ld.first_source_key = a.f_source)
    -- „Zur Anonymisierung fällig": Frist erreicht UND noch nicht anonymisiert. Ohne die zweite
    -- Bedingung stünden bereits erledigte Fälle dauerhaft in der Arbeitsliste.
    and (not a.f_due or (ld.deletion_due_at <= now() and ld.anonymized_at is null))
    and (
      a.f_pattern is null
      or ld.email ilike a.f_pattern escape '\'
      or coalesce(ld.company, '') ilike a.f_pattern escape '\'
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
    -- erwähnt". Der Freitext ist über die bestehende Freitextsuche ohnehin nicht erreichbar (sie
    -- geht über E-Mail und Firma) — das ist Absicht und wird hier nicht nebenbei geändert.
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
    );
$$;

comment on function platform.leads_matching(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text
) is
  'B2-1, erweitert in B16-1 und B18-5: die EINE Filterbedingung des Lead-Bestands, benutzt von '
  'public.admin_list_leads UND public.admin_export_leads. Zwei eigene WHERE-Klauseln wären zwei '
  'Auslegungen desselben Filters, und die Abweichung fiele erst an einer ausgeführten Datei auf, die '
  'andere Zeilen enthält als die Sicht, aus der sie entstand. Filtert nur — projiziert nicht und '
  'prüft keine Rechte (das machen die Wrapper). PLZ als PRÄFIX (führende Ziffern = Netzgebiet). '
  'ZWEI Partner-Filter, weil zwei Fragen: p_partner_slug = „genau dieser Fachbetrieb" (B16-1), '
  'p_partner_assignment = „irgendeiner" (assigned) bzw. „keiner" (unassigned, B18-5). Beide greifen '
  'auf partner_slug (die bestätigte Zuordnung), NICHT auf referred_by_text — gefragt ist „wem '
  'zugeschrieben", nicht „wer wurde erwähnt". Kein Zugriffsweg von aussen.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — platform.lead_filter_summary: der angewandte Filter als ein Satz
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Zieht mit, weil sonst eine Ausfuhr mit gesetztem Partner-Filter im Protokoll als „alle" stünde —
-- ein Protokoll, das eine grössere Menge behauptet als ausgeführt wurde, ist schlimmer als keins.
drop function platform.lead_filter_summary(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text
);

create function platform.lead_filter_summary(
  p_status text default null,
  p_source_key text default null,
  p_consent_purpose platform.consent_purpose default null,
  p_consent_status text default null,
  p_search text default null,
  p_due_only boolean default false,
  p_industry platform.industry default null,
  p_metering_type text default null,
  p_postal_prefix text default null,
  p_consumption_min integer default null,
  p_consumption_max integer default null,
  p_contract_end_from date default null,
  p_contract_end_to date default null,
  p_partner_slug text default null,
  p_partner_assignment text default null
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_parts text[] := '{}';
  v_passign text := lower(nullif(btrim(coalesce(p_partner_assignment, '')), ''));
begin
  if nullif(btrim(coalesce(p_search, '')), '') is not null then
    v_parts := v_parts || ('Suche: ' || btrim(p_search));
  end if;
  if nullif(btrim(coalesce(p_status, '')), '') is not null then
    v_parts := v_parts || ('Status: ' || btrim(p_status));
  end if;
  if nullif(btrim(coalesce(p_source_key, '')), '') is not null then
    v_parts := v_parts || ('Herkunft: ' || btrim(p_source_key));
  end if;
  if p_consent_purpose is not null then
    v_parts := v_parts || ('Einwilligungszweck: ' || p_consent_purpose::text);
  end if;
  if nullif(btrim(coalesce(p_consent_status, '')), '') is not null then
    v_parts := v_parts || ('Einwilligungszustand: ' || btrim(p_consent_status));
  end if;
  -- ⚠ DER CAST IST DIE BEHEBUNG EINES BESTEHENDEN FEHLERS AUS B2-1, kein Stilmittel.
  -- `text[] || 'literal'` ist mehrdeutig: Postgres kann den Operator als `anyarray || anyelement`
  -- ODER als `anyarray || anyarray` auflösen und wählt hier das Array — die untypisierte Zeichenkette
  -- wird dann als Array-Literal gelesen und die Funktion bricht mit 22P02 („malformed array
  -- literal"). Die übrigen Zweige sind nicht betroffen, weil sie eine Verkettung übergeben
  -- (`'Suche: ' || btrim(...)`), die bereits `text` ist — betroffen sind ausschliesslich die
  -- Zweige mit einem NACKTEN Literal.
  -- GEMESSEN, nicht abgeleitet: `platform.lead_filter_summary(p_due_only => true)` scheiterte am
  -- Stand vor dieser Migration mit genau diesem Fehler. WIRKUNG IM BETRIEB: Wer in der Lead-Liste
  -- „nur zur Anonymisierung fällige" ankreuzt und dann exportiert, bekam einen Datenbankfehler statt
  -- einer Datei. Die LISTE war nie betroffen (sie filtert über `leads_matching`, nicht über diese
  -- Funktion) — nur die Ausfuhr, und nur mit diesem einen Filter. Deshalb ist es niemandem
  -- aufgefallen: kein Test hat je mit gesetztem `p_due_only` ausgeführt.
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
  -- ohne Filter, es gibt nur den Filter „alles" (s. TEIL 3).
  if cardinality(v_parts) = 0 then
    return 'alle (kein Filter gesetzt) — ohne gesperrte und anonymisierte Zeilen';
  end if;

  return array_to_string(v_parts, ' · ') || ' — ohne gesperrte und anonymisierte Zeilen';
end;
$$;

comment on function platform.lead_filter_summary(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text
) is
  'B2-1, erweitert in B16-1 und B18-5: der angewandte Filter als ein Satz für '
  'platform.admin_exports.filter_summary. Steht in der Datenbank und nicht im Anwendungscode, damit '
  'das Protokoll beschreibt, was tatsächlich angewandt wurde. Ein leerer Filter wird ausdrücklich '
  'als „alle" protokolliert — es gibt keinen ungefilterten Export, nur den Filter „alles". Der '
  'Partner erscheint als SLUG und nicht als Anzeigename: der Slug ist unveränderlich, der '
  'Anzeigename korrigierbar, und ein Protokoll, dessen Aussage sich mit einer späteren Umbenennung '
  'ändert, ist keins. Die B18-5-Zuordnungsfrage erscheint als eigener Satzteil und nicht als '
  'zweites „Partner: …" — sonst stünde dasselbe Wort für zwei verschiedene Aussagen.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — public.admin_list_leads
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- DROP + CREATE (neunte Erweiterung der Parameterliste). FOLGE: die Grants sind weg und werden
-- unten erneut gesetzt.
drop function public.admin_list_leads(
  integer, integer, text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text
);

create function public.admin_list_leads(
  p_limit integer default 50,
  p_offset integer default 0,
  p_status text default null,
  p_source_key text default null,
  p_consent_purpose platform.consent_purpose default null,
  p_consent_status text default null,
  p_search text default null,
  p_due_only boolean default false,
  p_industry platform.industry default null,
  p_metering_type text default null,
  p_postal_prefix text default null,
  p_consumption_min integer default null,
  p_consumption_max integer default null,
  p_contract_end_from date default null,
  p_contract_end_to date default null,
  p_partner_slug text default null,
  -- B18-5, angehängt:
  p_partner_assignment text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit    integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset   integer := greatest(coalesce(p_offset, 0), 0);
  v_status   text    := nullif(btrim(coalesce(p_status, '')), '');
  v_cstatus  text    := nullif(btrim(coalesce(p_consent_status, '')), '');
  v_metering text    := nullif(btrim(coalesce(p_metering_type, '')), '');
  v_prefix   text    := nullif(btrim(coalesce(p_postal_prefix, '')), '');
  v_partner  text    := lower(nullif(btrim(coalesce(p_partner_slug, '')), ''));
  v_passign  text    := lower(nullif(btrim(coalesce(p_partner_assignment, '')), ''));
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
  if v_status is not null and v_status not in ('new', 'contacted', 'customer', 'anonymized') then
    return jsonb_build_object('status', 'invalid_filter', 'filter', 'status');
  end if;

  if v_cstatus is not null
     and v_cstatus not in ('pending', 'confirmed', 'withdrawn', 'expired', 'none')
  then
    return jsonb_build_object('status', 'invalid_filter', 'filter', 'consent_status');
  end if;

  if v_metering is not null
     and v_metering not in ('leistungsgemessen', 'netzebene_7', 'unknown')
  then
    return jsonb_build_object('status', 'invalid_filter', 'filter', 'metering_type');
  end if;

  -- Der PLZ-Präfix ist eine ZIFFERNfolge von 1 bis 4 Stellen. „11a" oder „11000" könnten nie einen
  -- Treffer haben (der Spalten-CHECK erlaubt nur vier Ziffern) — eine leere Menge sähe aber aus wie
  -- „in diesem Gebiet gibt es niemanden" statt wie „diese Eingabe ergibt keinen Sinn".
  if v_prefix is not null and v_prefix !~ '^[0-9]{1,4}$' then
    return jsonb_build_object('status', 'invalid_filter', 'filter', 'postal_prefix');
  end if;

  -- B16-1, dieselbe Regel: ein Slug, den es nicht gibt, liefert eine leere Menge, und die läse sich
  -- als „dieser Partner hat niemanden gebracht" — die schlechteste Auskunft, die man einem
  -- Fachbetrieb geben kann. Anders als in capture_lead wird hier NICHT verworfen, sondern
  -- abgelehnt: dort steht ein echter Interessent auf dem Spiel, hier nur eine Ansicht.
  -- Ein INAKTIVER Partner ist ausdrücklich filterbar — seine Leads existieren weiter.
  if v_partner is not null
     and not exists (select 1 from platform.partners p where p.slug = v_partner)
  then
    return jsonb_build_object('status', 'invalid_filter', 'filter', 'partner_slug');
  end if;

  -- B18-5, aus demselben Grund: ein Wert, den die Bedingung nicht kennt, filterte nichts und liesse
  -- den vollen Bestand als gefiltert erscheinen.
  if v_passign is not null and v_passign not in ('assigned', 'unassigned') then
    return jsonb_build_object('status', 'invalid_filter', 'filter', 'partner_assignment');
  end if;

  -- B18-5: der eine widersprüchliche Fall. „genau dieser Fachbetrieb" UND „gar kein Fachbetrieb"
  -- ergibt per Konstruktion eine leere Menge — und die läse sich wieder als Aussage über den
  -- Bestand dieses Betriebs statt als Aussage über die Filtereingabe.
  if v_partner is not null and v_passign = 'unassigned' then
    return jsonb_build_object('status', 'invalid_filter', 'filter', 'partner_assignment');
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
           -- genau der Fall, den ein Mensch entscheiden muss. Derselbe Grund trägt den
           -- B18-5-Filter: ohne partner_slug in der Antwort liesse er sich nicht nachvollziehen.
           ld.partner_slug, ld.referred_by_text
    from platform.leads_matching(
           p_status, p_source_key, p_consent_purpose, p_consent_status, p_search, p_due_only,
           p_industry, p_metering_type, p_postal_prefix, p_consumption_min, p_consumption_max,
           p_contract_end_from, p_contract_end_to, p_partner_slug, p_partner_assignment
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
$$;

comment on function public.admin_list_leads(
  integer, integer, text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text
) is
  'B1-1/B1-3, erweitert in B2-1, B16-1 und B18-5: paginierte, gefilterte Lead-Liste (neueste zuerst, '
  'limit 1..200, default 50). Filtert AUSSCHLIESSLICH über platform.leads_matching — dieselbe '
  'Bedingung, die auch public.admin_export_leads benutzt. Je Zeile zusätzlich is_suppressed, '
  'deletion_due, die Einwilligungen mit effective_status, die Segmentierungsmerkmale und seit B16-1 '
  'partner_slug samt referred_by_text (erst ihr Nebeneinander zeigt die zu entscheidenden Fälle). '
  'B18-5: p_partner_assignment (assigned/unassigned) beantwortet „hat irgendeinen Fachbetrieb" bzw. '
  '„hat keinen" — p_partner_slug bleibt für „genau dieser". In der Antwort fahren die '
  'Einstiegspunkte UND die Partner als Auswahllisten mit (beides Tabellen, die der Anwendungscode '
  'nicht als Konstante spiegeln kann). Ein unbekannter Filterwert wird als '
  '{status: invalid_filter, filter} ABGELEHNT und nicht ignoriert — auch ein unbekannter '
  'partner_slug, dessen leere Ergebnismenge sich sonst als „dieser Partner hat niemanden gebracht" '
  'läse, und ebenso die widersprüchliche Kombination Slug + unassigned. WIRFT bei fehlender '
  'Adminrolle (SQLSTATE 42501). authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — public.admin_export_leads
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Ebenfalls DROP + CREATE, und ebenfalls MIT dem neuen Filter: Ein Admin filtert die Sicht auf die
-- Partner-Leads, löst den Export aus — und bekäme sonst eine Datei mit dem GESAMTEN Bestand. Beide
-- Zahlen wären plausibel, die Abweichung fiele erst an der Datei auf, und dann hätte sie das System
-- bereits verlassen. Derselbe Fall, den B16-1 für den Slug-Filter entschieden hat.
drop function public.admin_export_leads(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text
);

create function public.admin_export_leads(
  p_status text default null,
  p_source_key text default null,
  p_consent_purpose platform.consent_purpose default null,
  p_consent_status text default null,
  p_search text default null,
  p_due_only boolean default false,
  p_industry platform.industry default null,
  p_metering_type text default null,
  p_postal_prefix text default null,
  p_consumption_min integer default null,
  p_consumption_max integer default null,
  p_contract_end_from date default null,
  p_contract_end_to date default null,
  p_partner_slug text default null,
  p_partner_assignment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_metering  text := nullif(btrim(coalesce(p_metering_type, '')), '');
  v_prefix    text := nullif(btrim(coalesce(p_postal_prefix, '')), '');
  v_status    text := nullif(btrim(coalesce(p_status, '')), '');
  v_cstatus   text := nullif(btrim(coalesce(p_consent_status, '')), '');
  v_partner   text := lower(nullif(btrim(coalesce(p_partner_slug, '')), ''));
  v_passign   text := lower(nullif(btrim(coalesce(p_partner_assignment, '')), ''));
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

  -- Dieselben Ablehnungen wie in admin_list_leads: ein unbekannter Filterwert darf auch hier nicht
  -- still zu einer GRÖSSEREN Menge führen — bei einer Datei, die das System verlässt, erst recht
  -- nicht.
  if v_status is not null and v_status not in ('new', 'contacted', 'customer', 'anonymized') then
    return jsonb_build_object('status', 'invalid_filter', 'filter', 'status');
  end if;
  if v_cstatus is not null
     and v_cstatus not in ('pending', 'confirmed', 'withdrawn', 'expired', 'none')
  then
    return jsonb_build_object('status', 'invalid_filter', 'filter', 'consent_status');
  end if;
  if v_metering is not null
     and v_metering not in ('leistungsgemessen', 'netzebene_7', 'unknown')
  then
    return jsonb_build_object('status', 'invalid_filter', 'filter', 'metering_type');
  end if;
  if v_prefix is not null and v_prefix !~ '^[0-9]{1,4}$' then
    return jsonb_build_object('status', 'invalid_filter', 'filter', 'postal_prefix');
  end if;
  if v_partner is not null
     and not exists (select 1 from platform.partners p where p.slug = v_partner)
  then
    return jsonb_build_object('status', 'invalid_filter', 'filter', 'partner_slug');
  end if;
  if v_passign is not null and v_passign not in ('assigned', 'unassigned') then
    return jsonb_build_object('status', 'invalid_filter', 'filter', 'partner_assignment');
  end if;
  if v_partner is not null and v_passign = 'unassigned' then
    return jsonb_build_object('status', 'invalid_filter', 'filter', 'partner_assignment');
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
           ld.created_at,
           ld.last_interaction_at,
           -- PFLICHTSPALTE: ohne sie ist jede Zeile in einem fremden Werkzeug ununterscheidbar
           -- anschreibbar.
           platform.marketing_consent_state(ld.id) as marketing_consent
    from platform.leads_matching(
           p_status, p_source_key, p_consent_purpose, p_consent_status, p_search, p_due_only,
           p_industry, p_metering_type, p_postal_prefix, p_consumption_min, p_consumption_max,
           p_contract_end_from, p_contract_end_to, p_partner_slug, p_partner_assignment
         ) ld
    where ld.anonymized_at is null
      and not platform.is_suppressed(ld.email)
  ) r;

  v_summary := platform.lead_filter_summary(
    p_status, p_source_key, p_consent_purpose, p_consent_status, p_search, p_due_only,
    p_industry, p_metering_type, p_postal_prefix, p_consumption_min, p_consumption_max,
    p_contract_end_from, p_contract_end_to, p_partner_slug, p_partner_assignment
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
$$;

comment on function public.admin_export_leads(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text
) is
  'B2-1, erweitert in B16-1 und B18-5: führt den gefilterten Bestand als Zeilen aus und protokolliert '
  'die Ausfuhr in platform.admin_exports (row_count + der von platform.lead_filter_summary erzeugte '
  'Filtertext). Nimmt DIESELBEN Filterparameter entgegen wie public.admin_list_leads und benutzt '
  'DIESELBE Bedingung (platform.leads_matching) — beide Partner-Filter sind hier ausdrücklich '
  'eingeschlossen: eine auf Fachbetrieb-Leads gefilterte Sicht, aus der eine Datei mit dem '
  'GESAMTBESTAND fiele, wäre genau die Divergenz, gegen die diese Schicht gebaut ist. Gesperrte und '
  'anonymisierte Zeilen sind in der ABFRAGE ausgeschlossen, nicht über einen Filter. Je Zeile fahren '
  'der Marketing-Einwilligungsstand (Pflicht), seit B16-1 partner_slug samt Anzeigename und '
  'referred_by_text mit. WIRFT bei fehlender Adminrolle (42501). authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 5 — Rechte nach dem DROP wiederherstellen
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Die zwei neu angelegten Wrapper: NUR authenticated. service_role bekommt bewusst KEIN Grant — sie
-- leiten ihre Autorisierung aus auth.uid() ab, das dort NULL ist; sie wären funktionslos und stets
-- abgelehnt (B2-1).
revoke all on function public.admin_list_leads(
  integer, integer, text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text
) from public, anon, authenticated, service_role;

revoke all on function public.admin_export_leads(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.admin_list_leads(
  integer, integer, text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text
) to authenticated;

grant execute on function public.admin_export_leads(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text
) to authenticated;

-- Die zwei platform-Funktionen sind kein Zugriffsweg von aussen. Der Entzug wird ausgesprochen,
-- damit die Aussage in dieser Datei gesetzt und nicht vorausgesetzt ist (Muster B3-1/B16-1).
revoke all on function platform.leads_matching(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text
) from public, anon, authenticated, service_role;

revoke all on function platform.lead_filter_summary(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date, text, text
) from public, anon, authenticated, service_role;
