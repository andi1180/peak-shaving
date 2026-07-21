-- B2-1 — Bestand bearbeitbar machen: Segmentierungsfilter, Korrekturweg, Export
-- (Fahrplan_2026.md, Abschnitt B2 — erster Teil).
--
-- B1 hat den Bestand gebaut (B1-1 Schema, B1-2 Schreibpfad, B1-3 Admin), B3 hat ihn gefüllt und die
-- Segmentierungsdimensionen angelegt, B4 hat die Zeitsteuerung gebracht. Diese Migration macht den
-- Bestand LES- und KORRIGIERBAR: filtern nach den B3-1-Dimensionen, neun Stammdatenfelder von Hand
-- berichtigen, und den Bestand als Datei ausführen — protokolliert.
--
-- NICHT hier: Kampagnenversand, Zustellprotokoll je Kampagne, Rückläufer- und
-- Beschwerdeverarbeitung (alles B2-2), der Betroffenheits-Check (B3-3, blockiert auf die
-- Branchenkennzahlen), `tenant_id` (B13).
--
-- ── DIESE MIGRATION VERSENDET NICHTS ─────────────────────────────────────────────────────────────
-- Der Versand ist der getrennte, unumkehrbare Teil. Was hier entsteht, ist ausschliesslich lesend
-- und korrigierend — mit EINER Ausnahme, die entsprechend behandelt wird: der Export. Eine Datei mit
-- dem Bestand verlässt den Wirkungsbereich des Systems vollständig, und genau deshalb bekommt er als
-- einziger Vorgang dieser Migration ein Protokoll und strukturelle Ausschlüsse in der Abfrage selbst.
--
-- ── KONVENTIONEN (exakt B1-1/B1-2/B1-3/B3-1/B4-1/B4-2/B3-4) ─────────────────────────────────────
-- Alles Fachliche in `platform` (nicht über die REST-API exponiert), Zugriff von aussen
-- ausschliesslich über SECURITY-DEFINER-Wrapper im `public`-Schema, alle Funktionen mit
-- `SET search_path = ''` und vollqualifizierten Objektnamen, erst `revoke all … from public, anon,
-- authenticated, service_role`, dann gezielt grants. `anon` bekommt NIRGENDS etwas.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — last_edited_by: WER zuletzt korrigiert hat
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- EINE Spalte, keine Änderungshistorie — dieselbe Abwägung wie bei `anonymized_by` (B1-3): bei zwei
-- handelnden Personen beantwortet das die einzige Frage, die je gestellt wird („wer hat das
-- geändert, ich war das nicht"). Eine Historientabelle wäre Aufwand ohne Erkenntnis, solange
-- niemand die Frage nach dem VORHERIGEN Wert stellt; entsteht sie später, ist sie additiv nachrüstbar.
--
-- `ON DELETE SET NULL` aus demselben Grund wie dort: `cascade` löschte den LEAD, weil jemand sein
-- Konto schliesst; die Voreinstellung `no action` BLOCKIERTE das Löschen des Kontos an fremden
-- Lead-Zeilen. `set null` lässt das Konto gehen — die Korrektur selbst bleibt (updated_at), nur ihre
-- Zuschreibung entfällt. Die Oberfläche sagt dann „Konto entfernt" statt einer leeren Zelle.
alter table platform.leads
  add column last_edited_by uuid references auth.users (id) on delete set null;

comment on column platform.leads.last_edited_by is
  'B2-1: WER zuletzt eine Stammdatenkorrektur vorgenommen hat (auth.users), gesetzt von '
  'public.admin_update_lead über auth.uid(). EINE Spalte statt einer Änderungshistorie — die '
  'gestellte Frage ist „wer war das", nicht „was stand vorher da". ON DELETE SET NULL wie '
  'anonymized_by (B1-3): das Löschen des handelnden Kontos darf weder den Lead mitreissen noch das '
  'Konto festhalten. NULL heisst entweder „nie von Hand bearbeitet" oder „Konto entfernt" — die '
  'Oberfläche unterscheidet das über updated_at nicht und behauptet es deshalb auch nicht.';

-- ── guard_anonymized_lead: derselbe Grund wie in B3-1 und B4-1 ───────────────────────────────────
-- Ein Schutzmechanismus, der seine eigene Erweiterung nicht abdeckt, läuft an ihr vorbei. Ohne die
-- neue Zeile liesse sich an einem anonymisierten Lead eine Bearbeitung EINTRAGEN, die es nie gab —
-- eine Zuschreibung auf ein Konto, das an einer unveränderlichen Zeile gar nichts geändert haben kann.
--
-- ── DIE REGEL IST BEWUSST ASYMMETRISCH: SETZEN VERBOTEN, NULLEN ERLAUBT ─────────────────────────
-- `last_edited_by` trägt `ON DELETE SET NULL`, und diese referentielle Aktion ist selbst ein UPDATE
-- auf die Lead-Zeile. Ein vollständiger Schutz (`is distinct from`) blockierte damit das Löschen
-- eines Kontos, sobald irgendein ANONYMISIERTER Lead auf dieses Konto zeigt — genau der Fall, den
-- B1-3 bei `anonymized_by` vermeiden wollte und dort mit dem völligen Verzicht auf Schutz gelöst hat.
--
-- Hier geht beides: geprüft wird nur der Übergang auf einen NICHT-NULL-Wert. Damit läuft
-- `ON DELETE SET NULL` (neuer Wert = null) unverändert durch, und trotzdem kann niemand einem
-- anonymisierten Lead nachträglich einen Bearbeiter anheften. Das ist strikt mehr Schutz als bei
-- `anonymized_by`, ohne dessen Preis.
create or replace function platform.guard_anonymized_lead()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.anonymized_at is null then
    return new;
  end if;

  if new.email           is distinct from old.email
     or new.company      is distinct from old.company
     or new.contact_name is distinct from old.contact_name
     or new.phone        is distinct from old.phone
     or new.status       is distinct from old.status
     or new.retention_basis is distinct from old.retention_basis
     or new.anonymized_at   is distinct from old.anonymized_at
     -- B3-1: die Segmentierungsspalten.
     or new.industry               is distinct from old.industry
     or new.postal_code            is distinct from old.postal_code
     or new.annual_consumption_kwh is distinct from old.annual_consumption_kwh
     or new.metering_type          is distinct from old.metering_type
     or new.supplier               is distinct from old.supplier
     or new.contract_end_date      is distinct from old.contract_end_date
     -- B4-1: die Urheberschaft der Anonymisierung.
     or new.anonymized_by_system   is distinct from old.anonymized_by_system
     -- B2-1: der Bearbeiter. NUR das SETZEN ist verboten (s. Begründung oben) — ein Übergang auf
     -- null bleibt möglich, weil ON DELETE SET NULL sonst am Guard scheiterte.
     or (new.last_edited_by is distinct from old.last_edited_by and new.last_edited_by is not null)
  then
    raise exception
      'platform.leads %: der Lead ist seit % anonymisiert — E-Mail, Firma, Name, Telefon, Status, '
      'Aufbewahrungsgrundlage, der Anonymisierungszeitpunkt, sämtliche Segmentierungsmerkmale '
      '(Branche, PLZ, Jahresverbrauch, Messart, Versorger, Vertragsende), die Urheberschaft der '
      'Anonymisierung und die Zuschreibung einer Bearbeitung sind unveränderlich. Anonymisierung '
      'ist endgültig, auch für service_role und für den Admin',
      old.id, old.anonymized_at;
  end if;

  return new;
end;
$$;

comment on function platform.guard_anonymized_lead() is
  'BEFORE UPDATE auf leads: ist anonymized_at gesetzt, sind email, company, contact_name, phone, '
  'status, retention_basis, anonymized_at, (seit B3-1) industry, postal_code, '
  'annual_consumption_kwh, metering_type, supplier, contract_end_date, (seit B4-1) '
  'anonymized_by_system und (seit B2-1) last_edited_by unveränderlich — auch für service_role und '
  'für den Admin. Bei last_edited_by ist nur das SETZEN gesperrt, nicht das Nullen: die Spalte '
  'trägt ON DELETE SET NULL, und diese referentielle Aktion ist selbst ein UPDATE — ein '
  'vollständiger Schutz blockierte das Löschen des handelnden Kontos. anonymized_at steht bewusst '
  'mit in der Liste (sonst liesse sich der Guard durch Nullen seiner eigenen Bedingung abschalten); '
  'anonymized_by bewusst gar nicht (dieselbe ON-DELETE-Begründung, dort ohne Teillösung). '
  'last_interaction_at bleibt änderbar — der B1-1-Trigger touch_lead_on_consent muss weiter laufen '
  'können.';

-- ── public.admin_update_lead: der Korrekturweg ───────────────────────────────────────────────────
-- BEARBEITBAR SIND AUSSCHLIESSLICH NEUN FELDER: company, contact_name, phone, industry,
-- postal_code, annual_consumption_kwh, metering_type, supplier, contract_end_date.
--
-- ── WAS BEWUSST NICHT BEARBEITBAR IST, UND WARUM ─────────────────────────────────────────────────
--
--   * `email`. Sie ist die Adresse, VON DER die Einwilligung erteilt und AN DIE die Bestätigung
--     gesendet wurde. Eine Änderung übertrüge eine bestätigte Einwilligung auf eine Adresse, die nie
--     zugestimmt hat — das ist die B1-3-Regel „der Admin kann widerrufen, nie erteilen" durch die
--     Hintertür, und sie wäre von aussen nicht mehr erkennbar. Der Verzicht kostet nichts: eine
--     falsch eingegebene Adresse bestätigt nie, die Einwilligung bleibt 'pending' und fällt aus
--     jeder Aussendung heraus (has_confirmed_consent ist bei pending ausdrücklich false, B1-1). Ein
--     unerreichbarer Lead wird gekennzeichnet, nicht repariert. Die Spalte trägt zudem den
--     Eindeutigkeitsindex und die Normalisierung — ein Schreibpfad hier hätte drei Baustellen statt
--     einer.
--
--   * `status` und `retention_basis`. Dafür existiert `admin_set_lead_status` (B1-3) samt
--     Einbahnstrassen-Trigger `sync_retention_basis_on_customer`: der Wechsel auf 'customer' hebt
--     die Aufbewahrung dauerhaft, der Rückweg wirft. Ein zweiter Schreibpfad auf dieselben zwei
--     Spalten wäre eine zweite Auslegung derselben Regel.
--
--   * `first_source_key`. Seit B1-1 unveränderlich (Trigger `guard_lead_first_source`) — eine
--     nachträglich umgeschriebene Herkunft wäre keine Herkunft, und die gesamte Rücklauf-Auswertung
--     (B3-4) hinge an einem Wert, den jemand von Hand verschieben kann.
--
--   * `deletion_due_at`. Wird IMMER abgeleitet (Trigger `sync_lead_retention`), nie gesetzt; ein
--     mitgegebener Wert wird ohnehin kommentarlos überschrieben. Ein Eingabefeld dafür wäre eine
--     Requisite ohne Wirkung.
--
-- ── NULL BEDEUTET HIER „SETZE AUF NULL", NICHT „LASSE UNBERÜHRT" ─────────────────────────────────
-- Bewusst ANDERS als bei `capture_lead` (B3-1), wo `coalesce(neu, BESTAND)` gilt. Dort schickt ein
-- Einstiegspunkt nur die Felder, die er erhebt — ein null heisst „weiss ich nicht". Hier schickt ein
-- BEARBEITUNGSFORMULAR immer alle neun Felder, und ein geleertes Feld ist eine Aussage: „diese
-- Angabe war falsch, sie soll weg". Mit COALESCE-Semantik liesse sich kein einziges Feld je löschen
-- — genau das, was ein Korrekturweg können muss. Leerstrings werden zu null normalisiert, damit ein
-- leer abgesendetes Textfeld nicht als Angabe im Bestand landet.
--
-- ── ZWECKBINDUNG WIRD DURCHGESETZT, NICHT VORAUSGESETZT ──────────────────────────────────────────
-- Der Trigger `clear_contract_data_on_withdrawal` (B3-1) LÖSCHT `supplier` und `contract_end_date`
-- beim Widerruf der Vertragsablauf-Erinnerung, weil sie ohne ihren Zweck keine Grundlage haben. Ein
-- Admin, der sie anschliessend von Hand einträgt, umgeht genau diese Zweckbindung — und zwar
-- unsichtbar, denn die Felder sehen danach aus wie erhoben. Der Wrapper WEIST DESHALB AB (Ausnahme,
-- keine stille Nichtbeachtung: eine ignorierte Eingabe liesse den Admin glauben, der Wert stünde
-- jetzt im Bestand).
--
-- 'pending' ist zugelassen, weil `capture_lead` die beiden Felder bereits VOR der Bestätigung
-- schreibt (B1-2/B3-1) — verlangte man 'confirmed', wäre eine Korrektur in genau dem Zeitfenster
-- unmöglich, in dem Tippfehler auffallen. Ein abgelaufener Token bleibt gespeichert 'pending' (B1-2
-- räumt lazy ab) und ist damit ebenfalls zugelassen: er ist kein Widerruf.
--
-- AUF NULL SETZEN (LÖSCHEN) IST IMMER ERLAUBT — das ist die Richtung, die Daten entfernt.
create function public.admin_update_lead(
  p_lead_id uuid,
  p_company text default null,
  p_contact_name text default null,
  p_phone text default null,
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
  v_anonymized_at timestamptz;
  -- Leerstring ist keine Angabe (dieselbe Normalisierung wie capture_lead, B3-1): ohne sie schriebe
  -- ein leer abgesendetes Formularfeld ein '' in den Bestand — das ist kein null, überlebt jedes
  -- COALESCE und liefe in den PLZ-CHECK.
  v_company      text := nullif(btrim(p_company), '');
  v_contact_name text := nullif(btrim(p_contact_name), '');
  v_phone        text := nullif(btrim(p_phone), '');
  v_postal_code  text := nullif(btrim(p_postal_code), '');
  v_metering     text := nullif(btrim(p_metering_type), '');
  v_supplier     text := nullif(btrim(p_supplier), '');
begin
  if not platform.is_admin() then
    raise exception 'public.admin_update_lead: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  if p_lead_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Zeilensperre: zwei gleichzeitig abgesendete Formulare sollen nicht ineinander schreiben.
  select l.anonymized_at into v_anonymized_at
  from platform.leads l
  where l.id = p_lead_id
  for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_anonymized_at is not null then
    -- Der Trigger würde es ohnehin ablehnen — aber als Exception. Ein anonymisierter Lead ist hier
    -- ein fachlicher Zustand („dieser Vorgang ist abgeschlossen"), kein Autorisierungsfehler
    -- (dieselbe Unterscheidung wie in admin_set_lead_status, B1-3).
    return jsonb_build_object('status', 'anonymized');
  end if;

  if (v_supplier is not null or p_contract_end_date is not null)
     and not exists (
       select 1
       from platform.consents c
       join platform.consent_texts ct on ct.id = c.consent_text_id
       where c.lead_id = p_lead_id
         and ct.purpose = 'contract_expiry_reminder'
         and c.status in ('pending', 'confirmed')
     )
  then
    raise exception
      'public.admin_update_lead: Versorger und Vertragsende sind ausschliesslich für die '
      'Vertragsablauf-Erinnerung erhoben. Für Lead % besteht dafür keine Einwilligung (weder offen '
      'noch bestätigt) — ohne Zweck gibt es für diese Daten keine Grundlage. Auf null setzen ist '
      'weiterhin möglich.',
      p_lead_id
      using errcode = '22023';
  end if;

  update platform.leads l
     set company                = v_company,
         contact_name           = v_contact_name,
         phone                  = v_phone,
         industry               = p_industry,
         postal_code            = v_postal_code,
         annual_consumption_kwh = p_annual_consumption_kwh,
         metering_type          = v_metering,
         supplier               = v_supplier,
         contract_end_date      = p_contract_end_date,
         -- auth.uid() funktioniert auch in einer SECURITY-DEFINER-Funktion (es liest die
         -- JWT-Claims der Sitzung, nicht die Datenbankrolle) — der Handelnde ist damit der echte
         -- angemeldete Admin und nicht der Eigentümer der Funktion (Muster wie B1-3).
         last_edited_by         = auth.uid()
   where l.id = p_lead_id;

  return jsonb_build_object('status', 'ok');
end;
$$;

comment on function public.admin_update_lead(
  uuid, text, text, text, platform.industry, text, integer, text, text, date
) is
  'B2-1: Korrekturweg für GENAU NEUN Stammdatenfelder (company, contact_name, phone, industry, '
  'postal_code, annual_consumption_kwh, metering_type, supplier, contract_end_date) und setzt dabei '
  'last_edited_by = auth.uid(). NICHT bearbeitbar und bewusst ohne Parameter: email (eine Änderung '
  'übertrüge eine bestätigte Einwilligung auf eine Adresse, die nie zugestimmt hat), status/'
  'retention_basis (dafür gibt es admin_set_lead_status samt Einbahnstrassen-Trigger), '
  'first_source_key (seit B1-1 unveränderlich), deletion_due_at (immer abgeleitet). NULL heisst '
  'hier SETZE AUF NULL, nicht „lasse unberührt" — anders als bei capture_lead, weil ein '
  'Bearbeitungsformular alle Felder schickt und ein geleertes Feld eine Aussage ist. WIRFT (22023), '
  'wenn supplier oder contract_end_date auf einen Wert ungleich null gesetzt werden sollen und für '
  'den Lead keine Einwilligung zu contract_expiry_reminder im Zustand pending oder confirmed '
  'besteht: der B3-1-Trigger löscht diese Felder beim Widerruf, ein händischer Eintrag umginge '
  'genau diese Zweckbindung. Auf null setzen ist immer erlaubt. WIRFT bei fehlender Adminrolle '
  '(42501); not_found und anonymized sind fachliche Zustände. authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — Die Filter: EINE Definition, zwei Konsumenten
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- `admin_list_leads` (B1-1/B1-3) bekommt die B3-1-Dimensionen dazu, und `admin_export_leads`
-- (TEIL 3) nimmt DIESELBEN Parameter entgegen. Die Filterbedingung wird deshalb GENAU EINMAL
-- geschrieben und von beiden benutzt — sonst gäbe es zwei Auslegungen desselben Filters, und die
-- Abweichung fiele erst an einer Datei auf, die andere Zeilen enthält als die Sicht, aus der sie
-- ausgeführt wurde. Dieselbe Begründung wie bei `leads_due_for_anonymization` (B4-1: eine
-- Definition von „fällig").
--
-- ── GEFILTERT WIRD IN SQL, NICHT IM ANWENDUNGSCODE (B1-3, unverändert gültig) ────────────────────
-- Nachgelagertes Filtern bräche die Seitenaufteilung und die Trefferzahl: die Datenbank lieferte
-- Seite 1, die Anwendung würfe davon einen Teil weg und zeigte den Rest — „Seite 2" überspränge
-- Treffer, und es wanderten mehr personenbezogene Daten über die Verbindung als je angezeigt werden.
--
-- Rückgabe `setof platform.leads`: die Funktion filtert und projiziert NICHT — welche Spalten
-- sichtbar werden, entscheidet der jeweilige Wrapper. Sie ist ausdrücklich kein Zugriffsweg (revoke
-- am Ende) und enthält keine Rechteprüfung; die machen die Wrapper als erste Anweisung.
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
  p_contract_end_to date default null
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
  platform.industry, text, text, integer, integer, date, date
) is
  'B2-1: die EINE Filterbedingung des Lead-Bestands, benutzt von public.admin_list_leads UND '
  'public.admin_export_leads. Zwei eigene WHERE-Klauseln wären zwei Auslegungen desselben Filters, '
  'und die Abweichung fiele erst an einer ausgeführten Datei auf, die andere Zeilen enthält als die '
  'Sicht, aus der sie entstand. Filtert nur — projiziert nicht und prüft keine Rechte (das machen '
  'die Wrapper). PLZ als PRÄFIX (führende Ziffern = Netzgebiet). Kein Zugriffsweg von aussen.';

-- ── platform.lead_filter_summary: der angewandte Filter im Klartext ──────────────────────────────
-- Steht neben `leads_matching` und nicht im Anwendungscode, aus demselben Grund: das Protokoll soll
-- beschreiben, was die DATENBANK angewandt hat, nicht was eine Oberfläche gemeint hat. Ein im
-- Frontend zusammengesetzter Text bliebe stehen, wenn sich der Filter ändert, und behauptete dann
-- rückwirkend etwas Falsches über eine bereits ausgeführte Datei.
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
  p_contract_end_to date default null
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_parts text[] := '{}';
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
  if coalesce(p_due_only, false) then
    v_parts := v_parts || 'nur zur Anonymisierung fällige';
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
  platform.industry, text, text, integer, integer, date, date
) is
  'B2-1: der angewandte Filter als ein Satz für platform.admin_exports.filter_summary. Steht in der '
  'Datenbank und nicht im Anwendungscode, damit das Protokoll beschreibt, was tatsächlich angewandt '
  'wurde. Ein leerer Filter wird ausdrücklich als „alle" protokolliert — es gibt keinen '
  'ungefilterten Export, nur den Filter „alles". Der Zusatz „ohne gesperrte und anonymisierte '
  'Zeilen" nennt die strukturellen Ausschlüsse, die nicht Filter sind, sondern in der Abfrage '
  'stehen.';

-- ── platform.marketing_consent_state: der Einwilligungsstand als EIN Wort ────────────────────────
-- Je Zeile MUSS der Stand zu 'marketing_email' in der ausgeführten Datei stehen: eine Zeile ohne
-- erkennbaren Einwilligungsstand ist die gefährlichste Zeile in der Datei — sie sieht in einem
-- fremden Werkzeug aus wie jede andere und wird angeschrieben.
--
-- 'bestätigt' kommt aus `platform.has_confirmed_consent` und NICHT aus einer eigenen Abfrage: das
-- ist die eine Funktion, die vor jedem Versand befragt wird (B1-1). Zwei Definitionen von „darf
-- angeschrieben werden" wären genau die Divergenz, die erst beim Massenversand auffällt.
--
-- ── EIN ABGELAUFENER BESTÄTIGUNGSLINK ZÄHLT ALS 'keine', NICHT ALS 'offen' ───────────────────────
-- 'offen' liest sich als „da kommt noch was" (B1-3 begründet das für die Anzeige). Ein verfallener
-- Token kann nicht mehr bestätigt werden — es kommt nichts mehr. In einer Datei, die in ein fremdes
-- Werkzeug wandert, ist die vorsichtigere von zwei nicht-sendbaren Aussagen die richtige.
create function platform.marketing_consent_state(p_lead_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select case
           when platform.has_confirmed_consent(p_lead_id, 'marketing_email') then 'bestätigt'
           when exists (
             select 1 from platform.consents c
             join platform.consent_texts ct on ct.id = c.consent_text_id
             where c.lead_id = p_lead_id and ct.purpose = 'marketing_email'
               and platform.consent_effective_status(c.status, c.token_expires_at) = 'pending'
           ) then 'offen'
           when exists (
             select 1 from platform.consents c
             join platform.consent_texts ct on ct.id = c.consent_text_id
             where c.lead_id = p_lead_id and ct.purpose = 'marketing_email'
               and c.status = 'withdrawn'
           ) then 'widerrufen'
           else 'keine'
         end;
$$;

comment on function platform.marketing_consent_state(uuid) is
  'B2-1: der Einwilligungsstand zu marketing_email als eines von vier Worten — bestätigt · offen · '
  'widerrufen · keine. Für den Export PFLICHT je Zeile: eine Zeile ohne erkennbaren '
  'Einwilligungsstand sieht in einem fremden Werkzeug aus wie jede andere und wird angeschrieben. '
  '„bestätigt" kommt aus platform.has_confirmed_consent (die EINE Sendefrage, B1-1), nicht aus '
  'einer zweiten Abfrage. Ein abgelaufener Bestätigungslink zählt als „keine" und nicht als '
  '„offen": bestätigt werden kann er nicht mehr, und „offen" behauptete, da käme noch etwas.';

-- ── public.admin_list_leads: die neuen Filterdimensionen ─────────────────────────────────────────
-- ERWEITERT, nicht ersetzt: die sieben neuen Parameter hängen mit Vorgabewert null HINTEN an, die
-- bestehenden acht bleiben in Bedeutung und Reihenfolge unverändert.
--
-- ── WARUM DROP + CREATE (wie capture_lead in B3-1, anonymize_lead in B4-1) ───────────────────────
-- `create or replace` kann die Parameterliste nicht erweitern; ein blosses CREATE erzeugte eine
-- ZWEITE Überladung, und der bestehende Acht-Argument-Aufruf wäre mehrdeutig („function is not
-- unique") — die Lead-Liste läge lahm. Folge des DROP: Supabases ALTER DEFAULT PRIVILEGES vergeben
-- wieder EXECUTE an anon/authenticated/service_role, und das wird unten erneut entzogen.
--
-- ── NEU IN DER ANTWORT: `export_total` ──────────────────────────────────────────────────────────
-- Die Oberfläche zeigt vor dem Auslösen des Exports, wie viele Zeilen die Datei enthalten wird.
-- `total` taugt dafür NICHT: der Export schliesst gesperrte und anonymisierte Zeilen strukturell aus
-- (TEIL 3), die Trefferzahl der Sicht tut das nicht. Eine Oberfläche, die `total` als
-- Export-Zeilenzahl anbietet, verspricht eine Datei, die es so nicht gibt — und die Differenz fiele
-- niemandem auf, weil beide Zahlen plausibel sind.
drop function if exists public.admin_list_leads(
  integer, integer, text, text, platform.consent_purpose, text, text, boolean
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
  -- B2-1, alle mit Vorgabewert null und ANGEHÄNGT:
  p_industry platform.industry default null,
  p_metering_type text default null,
  p_postal_prefix text default null,
  p_consumption_min integer default null,
  p_consumption_max integer default null,
  p_contract_end_from date default null,
  p_contract_end_to date default null
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
  v_total    integer;
  v_export   integer;
  v_leads    jsonb;
  v_sources  jsonb;
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

  with base as (
    select ld.id, ld.email, ld.company, ld.contact_name, ld.phone, ld.status,
           ld.first_source_key, ld.retention_basis, ld.last_interaction_at,
           ld.deletion_due_at, ld.anonymized_at, ld.anonymized_by, ld.created_at,
           -- B2-1: die Segmentierungsmerkmale fahren in der LISTE mit. Ohne sie liesse sich ein
           -- gesetzter Filter nicht am Ergebnis nachvollziehen — man sähe nur, dass die Menge
           -- kleiner wurde, nicht warum.
           ld.industry, ld.postal_code, ld.annual_consumption_kwh, ld.metering_type,
           ld.supplier, ld.contract_end_date
    from platform.leads_matching(
           p_status, p_source_key, p_consent_purpose, p_consent_status, p_search, p_due_only,
           p_industry, p_metering_type, p_postal_prefix, p_consumption_min, p_consumption_max,
           p_contract_end_from, p_contract_end_to
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

  return jsonb_build_object(
    'status',       'ok',
    'leads',        v_leads,
    'total',        v_total,
    'export_total', v_export,
    'limit',        v_limit,
    'offset',       v_offset,
    'sources',      v_sources
  );
end;
$$;

comment on function public.admin_list_leads(
  integer, integer, text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date
) is
  'B1-1, erweitert in B1-3 und B2-1: paginierte Lead-Liste mit Filtern — Status, Herkunftsquelle, '
  'Einwilligungsstatus je Zweck (inkl. ''none''), Freitext über E-Mail/Firma, „zur Anonymisierung '
  'fällig" sowie (B2-1) Branche, Messart, PLZ-Präfix, Jahresverbrauch von/bis und Vertragsende '
  'von/bis. Die Filterbedingung selbst steht EINMAL in platform.leads_matching und wird von '
  'admin_export_leads mitbenutzt. Gefiltert wird in SQL, nicht in der Anwendung. `total` ist die '
  'Zahl der TREFFER; `export_total` die Zahl der Zeilen, die eine Ausfuhr mit demselben Filter '
  'enthielte (ohne gesperrte und anonymisierte) — die beiden dürfen nicht verwechselt werden, sonst '
  'verspricht die Oberfläche eine Datei, die es so nicht gibt. Je Zeile zusätzlich is_suppressed, '
  'deletion_due, die sechs Segmentierungsmerkmale und die Einwilligungen mit gespeichertem UND '
  'wirksamem Status. Ein unbekannter Filterwert wird als {status: invalid_filter} abgelehnt, nicht '
  'still ignoriert. WIRFT bei fehlender Adminrolle (42501). authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — Exportprotokoll
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── WARUM ES DIESE TABELLE GIBT ─────────────────────────────────────────────────────────────────
-- Eine Datei mit dem Bestand verlässt den Wirkungsbereich des Systems VOLLSTÄNDIG: sie liegt danach
-- in einem Downloads-Ordner, in einem Mailpostfach, in einem fremden Werkzeug. Bei einem
-- Datenvorfall ist „wer hatte wann eine Kopie und wovon" die erste Frage — und sie ist nachträglich
-- nicht mehr beantwortbar, weil an der Datei selbst nichts hängt, das auf ihre Entstehung zeigt.
--
-- Vier Spalten, KEINE Kopie der Daten selbst. Ein Protokoll, das den Inhalt mitschreibt, wäre eine
-- zweite, dauerhafte Kopie genau der Daten, deren Verbreitung es dokumentieren soll.
create table platform.admin_exports (
  id uuid primary key default gen_random_uuid(),
  exported_by uuid references auth.users (id) on delete set null,
  -- clock_timestamp(), NICHT now(): `now()` ist die Transaktionszeit und in einer Transaktion
  -- konstant — zwei Ausfuhren derselben Transaktion wären nicht ordenbar (Befund aus B4-1, dort an
  -- job_runs.started_at/finished_at).
  exported_at timestamptz not null default clock_timestamp(),
  row_count integer not null,
  filter_summary text not null
);

comment on table platform.admin_exports is
  'B2-1: Protokoll der Bestands-Ausfuhren. Eine ausgeführte Datei verlässt den Wirkungsbereich des '
  'Systems vollständig; bei einem Datenvorfall ist „wer hatte wann eine Kopie und wovon" die erste '
  'Frage und nachträglich nicht mehr beantwortbar. Vier Spalten, KEINE Kopie der Daten selbst — ein '
  'inhaltsführendes Protokoll wäre eine zweite dauerhafte Kopie genau der Daten, deren Verbreitung '
  'es dokumentiert. RLS an, keine Policy, für keine Rolle ein Grant: geschrieben wird nur aus '
  'public.admin_export_leads, gelesen nur über public.admin_list_exports (Muster wie '
  'platform.job_runs, B4-1).';

comment on column platform.admin_exports.exported_by is
  'WER ausgeführt hat (auth.uid() zum Zeitpunkt der Ausfuhr). ON DELETE SET NULL wie anonymized_by '
  '(B1-3): das Löschen des Kontos darf weder das Protokoll mitreissen noch das Konto festhalten — '
  'der VORGANG und sein Zeitpunkt bleiben belegt, nur die Zuschreibung entfällt.';

comment on column platform.admin_exports.exported_at is
  'clock_timestamp(), nicht now(): in einer Transaktion ist now() konstant, mehrere Ausfuhren wären '
  'nicht ordenbar (Befund aus B4-1).';

comment on column platform.admin_exports.row_count is
  'Wie viele Zeilen die Datei enthielt — NACH den strukturellen Ausschlüssen (gesperrt/anonymisiert), '
  'also die tatsächliche Grösse der Kopie, nicht die Trefferzahl der Sicht.';

comment on column platform.admin_exports.filter_summary is
  'Der angewandte Filter im Klartext (platform.lead_filter_summary). Ohne ihn beantwortet das '
  'Protokoll nur „wer und wann", nicht „wovon" — und genau das ist bei einem Vorfall die Frage.';

alter table platform.admin_exports enable row level security;

-- Kein Index auf exported_at: die Tabelle wächst mit der Zahl der Ausfuhren (Einzelvorgänge eines
-- Menschen, nicht Datenverkehr), und die einzige Abfrage liest die jüngsten N. Ein Index auf
-- Vorrat wäre hier Aufwand ohne Nutzen — anders als bei job_runs, das täglich automatisch wächst.

-- ── public.admin_export_leads ────────────────────────────────────────────────────────────────────
-- Nimmt DIESELBEN Filterparameter wie `admin_list_leads` (ohne Seitenaufteilung — eine Ausfuhr ist
-- per Definition die ganze Menge), liefert die Zeilen unpaginiert und schreibt dabei den
-- Protokolleintrag. Beides in EINEM Aufruf und damit in EINER Transaktion: ein getrennter
-- „protokolliere jetzt"-Aufruf könnte ausbleiben — versehentlich, bei einem Fehler auf halbem Weg
-- oder weil ein zweiter Aufrufer ihn nicht kennt. Dann gäbe es eine Kopie ohne Spur, und das ist
-- exakt der Zustand, den diese Tabelle verhindern soll.
--
-- ── DIE ZWEI AUSSCHLÜSSE SIND KEINE FILTER, SIE STEHEN IN DER ABFRAGE ────────────────────────────
--   * anonymisierte Leads (`anonymized_at is not null`)
--   * Leads, deren Adresse in `platform.email_suppressions` steht
-- Eine ausgeführte Datei kann in ein beliebiges fremdes Werkzeug eingespielt werden, das die
-- Sperrliste nicht kennt — und in dem sie sich auch nicht nachträglich anwenden lässt, weil die
-- Liste nur Prüfsummen enthält (B1-1). Der Ausschluss muss deshalb in der QUELLE liegen und nicht in
-- einer Einstellung, die jemand versehentlich weglässt. Ein anonymisierter Lead trägt zudem nur noch
-- die Platzhalteradresse `anonymized+…@invalid`; ihn auszuführen erzeugte Zeilen, die nichts
-- bedeuten und trotzdem wie Adressen aussehen.
--
-- KEINE Mengenobergrenze und KEIN LIMIT: eine stillschweigend abgeschnittene Ausfuhr wäre die
-- schlechteste Variante — die Datei sähe vollständig aus. Wächst der Bestand über das, was ein
-- Aufruf tragen kann, ist das eine Entscheidung, die mit dem Massenversand (B2-2) zusammen zu
-- treffen ist, nicht ein stiller Deckel hier.
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
  p_contract_end_to date default null
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

  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb),
         count(*)::integer
    into v_rows, v_count
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
           ld.industry,
           ld.postal_code,
           ld.annual_consumption_kwh,
           ld.metering_type,
           ld.supplier,
           ld.contract_end_date,
           ld.created_at,
           ld.last_interaction_at,
           -- PFLICHTSPALTE: ohne sie ist jede Zeile in einem fremden Werkzeug ununterscheidbar
           -- anschreibbar.
           platform.marketing_consent_state(ld.id) as marketing_consent
    from platform.leads_matching(
           p_status, p_source_key, p_consent_purpose, p_consent_status, p_search, p_due_only,
           p_industry, p_metering_type, p_postal_prefix, p_consumption_min, p_consumption_max,
           p_contract_end_from, p_contract_end_to
         ) ld
    where ld.anonymized_at is null
      and not platform.is_suppressed(ld.email)
  ) r;

  v_summary := platform.lead_filter_summary(
    p_status, p_source_key, p_consent_purpose, p_consent_status, p_search, p_due_only,
    p_industry, p_metering_type, p_postal_prefix, p_consumption_min, p_consumption_max,
    p_contract_end_from, p_contract_end_to
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
  platform.industry, text, text, integer, integer, date, date
) is
  'B2-1: führt den gefilterten Bestand unpaginiert aus und schreibt dabei den Protokolleintrag in '
  'platform.admin_exports (auth.uid(), Zeilenzahl, Filter im Klartext) — beides in EINEM Aufruf, '
  'weil ein getrenntes „protokolliere jetzt" ausbleiben könnte und dann eine Kopie ohne Spur '
  'existierte. Nimmt dieselben Filterparameter wie admin_list_leads und benutzt dieselbe '
  'Filterbedingung (platform.leads_matching). ZWEI STRUKTURELLE AUSSCHLÜSSE, die keine Filter sind, '
  'sondern in der Abfrage stehen: anonymisierte Leads und Adressen auf der Sperrliste — eine Datei '
  'kann in ein fremdes Werkzeug wandern, das die Sperrliste nicht kennt und sie mangels Klartext '
  'auch nicht nachträglich anwenden könnte. Je Zeile fährt der Einwilligungsstand zu '
  'marketing_email als eigene Spalte mit (bestätigt/offen/widerrufen/keine). Kein LIMIT: eine still '
  'abgeschnittene Ausfuhr sähe vollständig aus. WIRFT bei fehlender Adminrolle (42501). '
  'authenticated-only.';

-- ── public.admin_list_exports ────────────────────────────────────────────────────────────────────
-- Das Protokoll ist wertlos, wenn niemand hineinsehen kann. Die Antwort trägt die E-Mail des Kontos
-- mit (wie admin_get_lead bei anonymized_by): eine UUID beantwortet die Frage „wer" nicht.
create function public.admin_list_exports(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit   integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_exports jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_list_exports: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.exported_at desc), '[]'::jsonb)
    into v_exports
  from (
    select ax.id,
           ax.exported_at,
           ax.row_count,
           ax.filter_summary,
           ax.exported_by,
           (select au.email from auth.users au where au.id = ax.exported_by) as exported_by_email
    from platform.admin_exports ax
    order by ax.exported_at desc
    limit v_limit
  ) e;

  return jsonb_build_object('status', 'ok', 'exports', v_exports);
end;
$$;

comment on function public.admin_list_exports(integer) is
  'B2-1: die letzten Ausfuhren mit Zeitpunkt, handelndem Konto (samt E-Mail — eine UUID beantwortet '
  '„wer" nicht; null, wenn das Konto gelöscht wurde), Zeilenzahl und angewandtem Filter. Ein '
  'Protokoll, in das niemand hineinsehen kann, beantwortet im Ernstfall nichts. WIRFT bei fehlender '
  'Adminrolle (42501). authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — admin_get_lead: „zuletzt bearbeitet von" sichtbar machen
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- `create or replace` (gleiche Signatur) — die Grants aus B1-1 bleiben unangetastet.
--
-- Ohne diese zwei Spalten wäre `last_edited_by` eine Spalte, die geschrieben und nie gelesen wird —
-- also kein Nachweis, sondern nur Speicherplatz. Dieselbe Behandlung wie `anonymized_by` in B1-3:
-- die UUID UND die E-Mail des Kontos, damit die Oberfläche „durch ein inzwischen gelöschtes Konto"
-- von „nie bearbeitet" unterscheiden kann.
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
           -- B2-1: der Korrekturweg. UUID und E-Mail, damit „durch ein inzwischen gelöschtes Konto"
           -- von „nie von Hand bearbeitet" unterscheidbar bleibt.
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

  -- B4-2: das Versandprotokoll der Vertragsablauf-Erinnerung, jüngstes Vertragsende zuerst.
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
  'B1-1, erweitert in B1-3, B3-1, B4-1, B4-2 und B2-1: ein Lead samt allen Einwilligungen '
  '(inkl. angezeigtem Textkörper, Version/Sprache und effective_status), den sechs '
  'Segmentierungsmerkmalen, der Urheberschaft einer Anonymisierung (anonymized_by/-_email/'
  '-_by_system), dem Versandprotokoll der Vertragsablauf-Erinnerung und seit B2-1 '
  'last_edited_by samt E-Mail des Kontos (null = nie von Hand bearbeitet ODER Konto gelöscht). '
  'token_hash/token_expires_at fahren bewusst nicht mit. WIRFT bei fehlender Adminrolle (42501); '
  'ein unbekannter Lead ist ein fachlicher Zustand ({status: not_found}). authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 5 — Rechte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Supabase vergibt per ALTER DEFAULT PRIVILEGES auf NEUE public-Funktionen automatisch EXECUTE an
-- anon, authenticated UND service_role (zusätzlich zum PostgreSQL-Default-Grant an PUBLIC) —
-- deshalb erst allen entziehen, dann NUR authenticated gewähren (Muster T4-2/T4-4/B1-1/B1-3).
--
-- service_role bekommt bewusst KEIN Grant: alle vier Wrapper leiten ihre Autorisierung aus
-- auth.uid() ab, das für service_role NULL ist — sie wären dort funktionslos und stets abgelehnt.
-- Beim Export kommt ein zweiter Grund dazu: `exported_by` wäre für einen Maschinenpfad immer null,
-- das Protokoll also strukturell aussagelos.
revoke all on function public.admin_update_lead(
  uuid, text, text, text, platform.industry, text, integer, text, text, date
) from public, anon, authenticated, service_role;

revoke all on function public.admin_list_leads(
  integer, integer, text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date
) from public, anon, authenticated, service_role;

revoke all on function public.admin_export_leads(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date
) from public, anon, authenticated, service_role;

revoke all on function public.admin_list_exports(integer)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_update_lead(
  uuid, text, text, text, platform.industry, text, integer, text, text, date
) to authenticated;

grant execute on function public.admin_list_leads(
  integer, integer, text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date
) to authenticated;

grant execute on function public.admin_export_leads(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date
) to authenticated;

grant execute on function public.admin_list_exports(integer) to authenticated;

-- Die drei platform-Funktionen sind KEIN öffentlicher Zugriffsweg: sie werden ausschliesslich aus
-- den public-Wrappern aufgerufen und laufen dort unter deren Eigentümer. Dieselbe Behandlung wie
-- platform.anonymize_lead (B1-3) und platform.leads_due_for_anonymization (B4-1).
revoke all on function platform.leads_matching(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date
) from public;

revoke all on function platform.lead_filter_summary(
  text, text, platform.consent_purpose, text, text, boolean,
  platform.industry, text, text, integer, integer, date, date
) from public;

revoke all on function platform.marketing_consent_state(uuid) from public;

-- platform.admin_exports bekommt für KEINE Rolle ein Grant (Muster platform.job_runs, B4-1):
-- geschrieben wird nur aus public.admin_export_leads, gelesen nur über public.admin_list_exports —
-- beide SECURITY DEFINER. RLS ist zusätzlich aktiviert; ohne Grant und ohne Policy ist die Tabelle
-- von aussen unerreichbar, und zwar aus zwei unabhängigen Gründen.
