-- B3-1 — Segmentierungsspalten und Erweiterung des Erfassungspfads
-- (Fahrplan_2026.md, Abschnitt B3).
--
-- B1 hat das Lead-Fundament gebaut (B1-1 Schema, B1-2 Schreibpfad, B1-3 Admin) und dabei
-- Segmentierungsspalten AUSDRÜCKLICH ausgeklammert: sie sollten getypt entstehen, sobald feststeht,
-- was der Betroffenheits-Check erhebt (Kommentar in B1-1, TEIL 3). Genau das holt diese Migration
-- nach — die Dimensionen, auf denen B2 später filtert und Trefferzahlen bildet.
--
-- NICHT hier: die Erfassungskomponente und ihre Einsatzorte (B3-2), der Betroffenheits-Check selbst
-- (B3-3, blockiert auf fachlichen Input), gefilterte Sicht/Export/Versand (B2), zeitgesteuerte Jobs
-- (B4), `tenant_id` (B13).
--
-- ── WARUM GETYPTE SPALTEN UND KEIN jsonb ─────────────────────────────────────────────────────────
-- Ein `attributes jsonb` wäre schneller geschrieben und ist hier trotzdem falsch: B2 muss auf diesen
-- Feldern FILTERN und Trefferzahlen in SQL bilden (B1-3 hat begründet, warum nachgelagertes Filtern
-- die Seitenaufteilung bricht). Ein Filter über jsonb hätte weder Typ noch CHECK noch einen
-- brauchbaren Index — „Verbrauch grösser als" wäre ein Textvergleich, und ein Tippfehler im
-- Schlüssel erzeugte still eine leere Menge statt eines Fehlers.
--
-- ── WARUM ALLE SPALTEN NULLABLE SIND ─────────────────────────────────────────────────────────────
-- B3 baut EIN Backend mit VIELEN kontextspezifischen Einstiegspunkten (Fahrplan_2026.md B3) — kein
-- überall gleiches Formular. Der Betroffenheits-Check liefert Branche/PLZ/Verbrauch, die
-- Vertragsablauf-Seite Versorger/Ablaufdatum, ein Artikel-Inline-Feld womöglich nur die Adresse.
-- Eine NOT-NULL-Spalte zwänge jeden Einstiegspunkt, ein Feld zu erfragen, das er fachlich nicht
-- braucht — oder einen Platzhalter zu schreiben, der schlimmer ist als eine Leerstelle.
--
-- ── KONVENTIONEN (exakt B1-1/B1-2/B1-3) ──────────────────────────────────────────────────────────
-- Alles Fachliche in `platform` (nicht über die REST-API exponiert), Zugriff von aussen
-- ausschliesslich über SECURITY-DEFINER-Wrapper im `public`-Schema, alle Funktionen mit
-- `SET search_path = ''` und vollqualifizierten Objektnamen, erst `revoke all … from public, anon,
-- authenticated, service_role`, dann gezielt grants. `anon` bekommt NIRGENDS etwas.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — platform.industry: Enum, nicht Referenztabelle
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Gegenstück zur Regel aus B1-1: `lead_sources` ist eine TABELLE, weil der Anwendungscode die
-- Einstiegspunkte NICHT kennen muss — ein neuer Artikel darf keine Code-Änderung erzwingen.
--
-- Hier ist es umgekehrt. Der Anwendungscode braucht JE BRANCHE eine Vollbenutzungsstunden-Kennzahl,
-- um aus PLZ + Jahresverbrauch + Branche die Betroffenheit ab 2027 abzuleiten (B3-3). Eine neue
-- Branche ist damit zwangsläufig ein GEMEINSAMES Code- und Migrationsereignis. Genau das erzwingt
-- das Enum: es verhindert, dass eine Branche im Auswahlfeld erscheint, für die keine Kennzahl
-- hinterlegt ist — der Fall, der sonst niemandem auffiele, weil die Rechnung trotzdem eine Zahl
-- ausspuckt. Dieselbe Abwägung wie bei platform.consent_purpose und platform.product_key (T4-1).
create type platform.industry as enum (
  'baeckerei',
  'gastronomie',
  'handel',
  'hotellerie',
  'tischlerei',
  'landwirtschaft',
  'kuehlhaus',
  'metallverarbeitung',
  'buero_dienstleistung',
  'sonstige'
);

comment on type platform.industry is
  'Branche eines Leads. Enum (nicht Referenztabelle), weil der Anwendungscode je Branche eine '
  'Vollbenutzungsstunden-Kennzahl braucht (Betroffenheits-Check, B3-3): eine neue Branche ist '
  'dadurch zwangsläufig ein gemeinsames Code- UND Migrationsereignis, und keine Branche kann im '
  'Auswahlfeld erscheinen, für die keine Kennzahl hinterlegt ist. Gegenstück zur B1-1-Regel bei '
  'platform.lead_sources: dort eine Tabelle, weil der Code die Einstiegspunkte NICHT kennen muss.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — Die sechs Spalten auf platform.leads
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
alter table platform.leads
  add column industry platform.industry,
  -- Österreichische PLZ: exakt vier Ziffern. Der CHECK ist keine Formstrenge um ihrer selbst
  -- willen — die PLZ ist eine FILTERdimension (B2: „alle Kühlhäuser im Netzgebiet Wien"), und ein
  -- Wert wie „1100 Wien" oder „A-1100" fiele in keiner Auswertung auf, sondern nur aus ihr heraus.
  add column postal_code text check (postal_code ~ '^[0-9]{4}$'),
  -- Ein Jahresverbrauch von 0 oder weniger ist keine sparsame Angabe, sondern eine fehlende: er
  -- ginge sonst als echte Zahl in die Betroffenheitsrechnung (B3-3) und in jede Mengenauswertung
  -- ein. Für „nicht bekannt" gibt es NULL.
  add column annual_consumption_kwh integer check (annual_consumption_kwh > 0),
  -- ABGELEITET UND GESPEICHERT, nicht bei jedem Lesen neu gerechnet: B2 segmentiert in SQL danach
  -- ('leistungsgemessen' vs. 'netzebene_7' ist die zentrale Zielgruppen-Trennung des Marktstarts
  -- 2027). Eine Ableitung zur Lesezeit wäre in einer WHERE-Klausel nicht indizierbar und änderte
  -- rückwirkend die Zuordnung eines Leads, sobald die Regel justiert wird — der Bestand würde sich
  -- unter der Aussendung wegbewegen. 'unknown' ist ein ECHTES Ergebnis („geprüft, nicht bestimmbar")
  -- und deshalb ein eigener Wert, kein NULL; NULL heisst „nie geprüft".
  add column metering_type text
    check (metering_type in ('leistungsgemessen', 'netzebene_7', 'unknown')),
  add column supplier text,
  add column contract_end_date date;

comment on column platform.leads.industry is
  'Branche (platform.industry). Filterdimension für B2 und Eingang der '
  'Vollbenutzungsstunden-Rechnung des Betroffenheits-Checks (B3-3). Überlebt die Anonymisierung '
  'bewusst — grob einordnend, nicht lokalisierend (s. platform.anonymize_lead).';

comment on column platform.leads.postal_code is
  'Österreichische PLZ, per CHECK auf exakt vier Ziffern. Filterdimension für B2 (Netzgebiet). '
  'Wird bei der Anonymisierung GENULLT: PLZ + Branche + Versorger zusammen lokalisieren einen '
  'Betrieb und sind damit wiedererkennend.';

comment on column platform.leads.annual_consumption_kwh is
  'Jahresverbrauch in kWh, CHECK > 0 (0 oder negativ wäre keine sparsame, sondern eine fehlende '
  'Angabe — dafür ist NULL da). Überlebt die Anonymisierung als statistisches Merkmal.';

comment on column platform.leads.metering_type is
  'leistungsgemessen | netzebene_7 | unknown — vom Betroffenheits-Check ABGELEITET und gespeichert, '
  'nicht bei jedem Lesen neu gerechnet, weil B2 in SQL darauf segmentiert (indizierbar, und die '
  'Zuordnung eines Leads verschiebt sich nicht rückwirkend, wenn die Ableitungsregel justiert '
  'wird). ''unknown'' ist ein geprüftes Ergebnis, NULL heisst „nie geprüft".';

comment on column platform.leads.supplier is
  'Stromversorger — AUSSCHLIESSLICH für die Vertragsablauf-Erinnerung erhoben (Zweck '
  'contract_expiry_reminder). Wird beim Widerruf dieses Zwecks automatisch genullt (Trigger '
  'clear_contract_data_on_withdrawal) und bei der Anonymisierung ebenfalls.';

comment on column platform.leads.contract_end_date is
  'Ende der Strom-Vertragslaufzeit — dieselbe strikte Zweckbindung wie supplier: erhoben nur für '
  'die Vertragsablauf-Erinnerung, genullt bei deren Widerruf und bei der Anonymisierung.';

-- ── Indizes für die B2-Filter ────────────────────────────────────────────────────────────────────
-- B-Tree, PARTIELL auf `anonymized_at is null`: ein anonymisierter Lead taucht in keiner
-- Segmentierung auf (er hat keine Adresse mehr, an die sich senden liesse), gehört also auch nicht
-- in den Index. Der Teilindex bleibt dadurch dauerhaft so gross wie der ANSCHREIBBARE Bestand, nicht
-- wie der Gesamtbestand — und der wächst, weil die Anonymisierung Zeilen nicht löscht (B1-3).
create index leads_industry_idx
  on platform.leads (industry) where anonymized_at is null;

create index leads_metering_type_idx
  on platform.leads (metering_type) where anonymized_at is null;

create index leads_postal_code_idx
  on platform.leads (postal_code) where anonymized_at is null;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — Zweckbindung als Trigger: fällt der Zweck weg, fallen die Daten weg
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Versorger und Vertragsende werden für GENAU EINEN Zweck erhoben (der Einwilligungstext aus B1-1
-- sagt das wörtlich: „Dafür speichert die COOLiN ENERGY GmbH meinen Versorger und mein
-- Vertragsende"). Widerruft die Person diesen Zweck, fällt die Grundlage für die Daten weg — nicht
-- nur die Erlaubnis, sie zu benutzen. Zweckbindung wird hier DURCHGESETZT, nicht behauptet: als
-- Trigger, damit sie auch für service_role, für einen künftigen zweiten Anwendungspfad und für ein
-- `psql` gilt (dieselbe Begründung wie bei allen B1-Invarianten, I2).
--
-- ── BEWUSST NICHT BEI status='expired' ───────────────────────────────────────────────────────────
-- Eine abgelaufene Bestätigung ist ein TECHNISCHER Zustand (der Double-Opt-in-Token verfiel, B1-2
-- räumt lazy ab), kein Widerruf. Die Person hat nichts zurückgenommen und kann die Bestätigung
-- jederzeit erneut anfordern — dann wären die Daten weg, die sie gerade erst angegeben hat. Der
-- Unterschied ist fachlich, nicht formal.
--
-- ── ANDERE ZWECKE LASSEN DIE FELDER UNBERÜHRT ────────────────────────────────────────────────────
-- Ein Widerruf von 'marketing_email' sagt „keine Werbung", nicht „vergesst meinen Vertrag". Nur der
-- Wegfall DIESES Zwecks entzieht DIESEN Daten die Grundlage. (Der vollständige Rückzug über
-- public.suppress_email_and_withdraw_all trifft alle Zwecke — also auch diesen — und räumt die
-- Felder dadurch ebenfalls ab. Das ist gewollt und braucht keinen zweiten Mechanismus.)
create function platform.clear_contract_data_on_withdrawal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purpose platform.consent_purpose;
begin
  -- Der Zweck kommt über den verknüpften Text — B1-1: es gibt keine zweite, denormalisierte
  -- Zweck-Angabe an der Einwilligung, die davon abweichen könnte.
  select ct.purpose into v_purpose
    from platform.consent_texts ct
   where ct.id = new.consent_text_id;

  if v_purpose is distinct from 'contract_expiry_reminder' then
    return null;
  end if;

  -- Die zusätzliche Bedingung ist kein Mikro-Optimieren: sie verhindert einen UPDATE auf einen
  -- Lead, an dem sich gar nichts ändert. Bei einem bereits ANONYMISIERTEN Lead (dort sind beide
  -- Felder längst null) feuert dadurch überhaupt kein Schreibvorgang und der B1-3-Guard
  -- guard_anonymized_lead wird nicht einmal befragt.
  update platform.leads l
     set supplier          = null,
         contract_end_date = null
   where l.id = new.lead_id
     and (l.supplier is not null or l.contract_end_date is not null);

  return null;
end;
$$;

comment on function platform.clear_contract_data_on_withdrawal() is
  'AFTER UPDATE auf consents: wechselt eine Einwilligung mit purpose=contract_expiry_reminder auf '
  'status=withdrawn, werden supplier und contract_end_date des Leads genullt. Versorger und '
  'Vertragsende werden ausschliesslich für diesen Zweck erhoben — fällt der Zweck weg, fällt die '
  'Grundlage für die Daten weg. BEWUSST NICHT bei status=expired: ein verfallener Token ist ein '
  'technischer Zustand, kein Widerruf, und die Person kann die Bestätigung erneut anfordern. Andere '
  'Zwecke lassen die Felder unberührt. SECURITY DEFINER wie touch_lead_on_consent (B1-1), damit die '
  'Durchsetzung nicht an den Grants der schreibenden Rolle hängt.';

-- Die WHEN-Bedingung prüft den ÜBERGANG, nicht den Zustand: eine bereits widerrufene Zeile, die aus
-- anderem Grund erneut geschrieben wird, soll die Felder nicht ein zweites Mal abräumen (sie sind
-- dann ohnehin leer — aber der Trigger soll gar nicht erst laufen).
--
-- Trigger-Reihenfolge auf platform.consents (Postgres feuert je Zeitpunkt ALPHABETISCH nach
-- Triggernamen — die Namen sind seit B1-3 Ablaufsteuerung, nicht Geschmack):
--   consents_guard_confirmation  (B1-1, BEFORE)
--   consents_clear_contract_data (neu,  AFTER)  ← räumt die zweckgebundenen Felder ab
--   consents_touch_lead          (B1-1, AFTER)  ← schiebt last_interaction_at/Löschfrist nach
-- Beide AFTER-Trigger schreiben auf denselben Lead, aber auf disjunkte Spalten; die Reihenfolge ist
-- hier ohne fachliche Folge und nur der Vollständigkeit halber festgehalten.
create trigger consents_clear_contract_data
  after update on platform.consents
  for each row
  when (new.status = 'withdrawn' and old.status is distinct from 'withdrawn')
  execute function platform.clear_contract_data_on_withdrawal();

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — Bestehende Invarianten nachziehen
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

-- ── guard_anonymized_lead: die sechs neuen Spalten MÜSSEN unter denselben Schutz ─────────────────
-- Ohne diese Erweiterung liefe der Guard an seiner eigenen Erweiterung vorbei: ein anonymisierter
-- Lead wäre über Branche, PLZ, Verbrauch, Messart, Versorger und Vertragsende wieder BESCHREIBBAR.
-- Drei davon werden bei der Anonymisierung genullt — sie liessen sich also nachträglich wieder
-- füllen, und ausgerechnet PLZ + Versorger sind die lokalisierenden Merkmale, deren Entfernung die
-- Anonymisierung ausmacht. Die anderen drei bleiben bewusst erhalten, dürfen aber ebenso wenig
-- verändert werden: der Datenbestand soll nach der Anonymisierung stillstehen, nicht teilweise.
--
-- `create or replace` mit unveränderter Signatur — die Trigger, die auf die Funktion zeigen
-- (leads_protect_anonymized, B1-3), bleiben unangetastet.
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
     -- B3-1: die Segmentierungsspalten. Ohne sie wäre ein anonymisierter Lead über genau die
     -- Felder wieder beschreibbar, die die Anonymisierung gerade geräumt hat.
     or new.industry               is distinct from old.industry
     or new.postal_code            is distinct from old.postal_code
     or new.annual_consumption_kwh is distinct from old.annual_consumption_kwh
     or new.metering_type          is distinct from old.metering_type
     or new.supplier               is distinct from old.supplier
     or new.contract_end_date      is distinct from old.contract_end_date
  then
    raise exception
      'platform.leads %: der Lead ist seit % anonymisiert — E-Mail, Firma, Name, Telefon, Status, '
      'Aufbewahrungsgrundlage, der Anonymisierungszeitpunkt und sämtliche Segmentierungsmerkmale '
      '(Branche, PLZ, Jahresverbrauch, Messart, Versorger, Vertragsende) sind unveränderlich. '
      'Anonymisierung ist endgültig, auch für service_role und für den Admin',
      old.id, old.anonymized_at;
  end if;

  return new;
end;
$$;

comment on function platform.guard_anonymized_lead() is
  'BEFORE UPDATE auf leads: ist anonymized_at gesetzt, sind email, company, contact_name, phone, '
  'status, retention_basis, anonymized_at UND (seit B3-1) industry, postal_code, '
  'annual_consumption_kwh, metering_type, supplier, contract_end_date unveränderlich — auch für '
  'service_role und für den Admin. anonymized_at steht bewusst mit in der Liste (sonst liesse sich '
  'der Guard durch Nullen seiner eigenen Bedingung abschalten); anonymized_by bewusst NICHT (die '
  'Spalte trägt ON DELETE SET NULL, ein Schutz blockierte das Löschen des handelnden Kontos). '
  'last_interaction_at bleibt änderbar — der B1-1-Trigger touch_lead_on_consent muss weiter laufen '
  'können.';

-- ── anonymize_lead: die Trennlinie verläuft entlang „lokalisierend" ──────────────────────────────
-- NEU GENULLT: postal_code, supplier, contract_end_date.
-- BLEIBEN: industry, annual_consumption_kwh, metering_type.
--
-- Die Begründung ist nicht „was ist geschäftlich nützlich", sondern „was erkennt einen Betrieb
-- wieder". Eine Postleitzahl in Kombination mit Branche und Versorger LOKALISIERT: in einem
-- 4-Ziffern-Gebiet gibt es selten mehr als eine Tischlerei mit 180.000 kWh — die Zeile wäre wieder
-- zuordenbar, obwohl E-Mail und Firma fehlen. Branche, Verbrauchsgrösse und Messart allein sind das
-- nicht; sie ordnen grob ein und bleiben als statistische Merkmale nutzbar (Mengenauswertung je
-- Branche, Verhältnis leistungsgemessen zu Netzebene 7 — beides ohne Personenbezug).
-- Versorger und Vertragsende gehen zusätzlich aus einem zweiten, unabhängigen Grund: sie sind
-- strikt zweckgebunden (s. TEIL 3), und nach der Anonymisierung gibt es den Zweck nicht mehr.
--
-- `create or replace` mit unveränderter Signatur — der B1-3-`revoke all … from public` bleibt
-- bestehen (CREATE OR REPLACE lässt Eigentümer und Rechte unangetastet); unten wird er trotzdem
-- erneut ausgesprochen, damit die Aussage in dieser Datei nicht nur behauptet, sondern gesetzt ist.
create or replace function platform.anonymize_lead(p_lead_id uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_anonymized_at timestamptz;
begin
  if p_lead_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Zeilensperre: zwei gleichzeitige Klicks auf „Anonymisieren" sollen nicht beide durchlaufen.
  -- (FOUND unterscheidet „keine Zeile" von „Zeile mit anonymized_at = null" — der Null-Wert allein
  -- wäre mehrdeutig.)
  select l.anonymized_at
    into v_anonymized_at
  from platform.leads l
  where l.id = p_lead_id
  for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- IDEMPOTENT: Erfolg ohne zweite Wirkung. anonymized_at bleibt der ERSTE Zeitpunkt (dasselbe
  -- Prinzip wie confirmed_at in B1-2 — ein nachgeschriebenes Datum wäre eine Fälschung), und der
  -- Guard-Trigger würde ein Überschreiben ohnehin ablehnen.
  if v_anonymized_at is not null then
    return jsonb_build_object(
      'status', 'ok', 'outcome', 'already_anonymized', 'anonymized_at', v_anonymized_at
    );
  end if;

  -- ZUERST die Einwilligungen, DANN der Lead. Grund: der B1-1-Trigger touch_lead_on_consent
  -- schreibt bei jeder Einwilligungsänderung auf den Lead zurück. In dieser Reihenfolge trifft er
  -- eine noch nicht anonymisierte Zeile; umgekehrt liefe er gegen den frisch gesetzten Guard —
  -- der zwar last_interaction_at durchliesse, aber die Abhängigkeit wäre unnötig fein.
  update platform.consents c
     set source_ip  = null,
         user_agent = null
   where c.lead_id = p_lead_id
     and (c.source_ip is not null or c.user_agent is not null);

  update platform.leads l
     set email         = 'anonymized+' || p_lead_id::text || '@invalid',
         company       = null,
         contact_name  = null,
         phone         = null,
         status        = 'anonymized',
         anonymized_at = now(),
         anonymized_by = p_actor,
         -- B3-1, lokalisierende Merkmale:
         postal_code       = null,
         supplier          = null,
         contract_end_date = null
   where l.id = p_lead_id;

  return jsonb_build_object('status', 'ok', 'outcome', 'anonymized');
end;
$$;

comment on function platform.anonymize_lead(uuid, uuid) is
  'Anonymisiert einen Lead UNUMKEHRBAR: E-Mail → anonymized+<lead_id>@invalid (RFC 2606, nie '
  'zustellbar, je Lead eindeutig — hält den UNIQUE über die normalisierte Adresse ein), company/'
  'contact_name/phone → null, source_ip/user_agent ALLER Einwilligungen → null, seit B3-1 '
  'zusätzlich postal_code/supplier/contract_end_date → null, status=anonymized, anonymized_at/'
  'anonymized_by gesetzt. BLEIBEN: die Einwilligungszeilen selbst (Zweck, Textfassung, Zeitpunkte — '
  'ohne Identitätsmerkmale kein Personenbezug mehr, aber weiterhin der Beleg, dass korrekt '
  'gearbeitet wurde), der Sperrlisten-Eintrag (er MUSS die Löschung überleben, B1-1) sowie '
  'industry/annual_consumption_kwh/metering_type. Die Trennlinie verläuft entlang „lokalisierend" '
  'gegen „grob einordnend": PLZ + Branche + Versorger zusammen erkennen einen Betrieb wieder, '
  'Branche + Verbrauchsgrösse + Messart allein nicht. Idempotent: ein bereits anonymisierter Lead '
  'liefert Erfolg ohne zweite Wirkung. {status: ok|not_found}, outcome: '
  'anonymized|already_anonymized.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 5 — capture_lead: sechs neue Parameter und die Zusammenführungssemantik
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Die sechs Parameter hängen mit Vorgabewert null HINTEN an (nach p_locale aus B1-2), damit kein
-- bestehender Aufruf bricht.
--
-- ── WARUM DROP + CREATE UND NICHT create or replace ──────────────────────────────────────────────
-- `create or replace` kann die Parameterliste nicht erweitern; ein blosses CREATE erzeugte eine
-- ZWEITE Überladung. Ein Aufruf mit den bisherigen elf Argumenten wäre dann mehrdeutig (er passt
-- auf beide) und scheiterte mit „function is not unique" — der Erfassungspfad läge lahm. Deshalb
-- fällt die alte Fassung weg. Folge: die Supabase-Voreinstellungen greifen wieder (EXECUTE an anon/
-- authenticated/service_role) und werden unten erneut entzogen.
--
-- ── DIE ZUSAMMENFÜHRUNGSSEMANTIK IST DER KERN DIESER MIGRATION ───────────────────────────────────
-- Dieselbe Person wird über MEHRERE Einstiegspunkte erfasst, die unterschiedliche Felder erheben:
-- der Betroffenheits-Check liefert Branche und Verbrauch, die Vertragsablauf-Seite Versorger und
-- Ablaufdatum. Ohne die Regel „null lässt unberührt" löschte der zweite Kontakt, was der erste
-- erbracht hat — still, ohne Fehler, und erst beim ersten Segmentierungslauf sichtbar, wenn die
-- Menge unerklärlich klein ist. Das ist der wahrscheinlichste stille Datenverlust im gesamten
-- Erfassungspfad; ein db-test pinnt ihn.
--
-- ── UNTERSCHIED ZU company/contact_name/phone — BEWUSST, NICHT VERSEHENTLICH ─────────────────────
-- Die B1-2-Identitätsfelder benutzen `coalesce(BESTAND, neu)`: der BESTEHENDE Wert gewinnt, ein
-- neuer füllt nur Leerstellen. Die sechs Segmentierungsfelder benutzen `coalesce(neu, BESTAND)`:
-- der NEUE Wert gewinnt, null lässt unberührt. Beide schützen gegen Verlust durch eine knappere
-- zweite Absendung; sie unterscheiden sich darin, was bei ZWEI Angaben gilt. Bei Firma und Telefon
-- ist die frühere Angabe die verlässlichere (jemand tippt beim zweiten Mal weniger sorgfältig, und
-- eine Firmierung ändert sich selten). Bei Verbrauch, Versorger und Vertragsende ist die JÜNGERE
-- Angabe die richtige — sie ist genau das, was sich ändert, und eine Erinnerung an ein längst
-- ersetztes Vertragsende wäre wertlos.
drop function if exists public.capture_lead(
  text, text, platform.consent_purpose, text, timestamptz, text, text, text, inet, text, text
);

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
  p_locale text default 'de',
  -- B3-1, alle mit Vorgabewert null und ANGEHÄNGT:
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
    -- Die sechs Segmentierungsfelder folgen der umgekehrten Vorrangregel (s. Kopf dieses Teils):
    -- ein übergebener Wert überschreibt, null lässt unberührt.
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
  text, text, platform.consent_purpose, text, timestamptz, text, text, text, inet, text, text,
  platform.industry, text, integer, text, text, date
) is
  'B1-2, erweitert in B3-1: EIN atomarer Erfassungsaufruf (Lead + optionale Einwilligung in EINER '
  'Transaktion — Lead und Nachweis dürfen nicht getrennt committen). Rückgabe {outcome, lead_id} '
  'mit outcome aus lead_only (kein Zweck übergeben) · consent_created · consent_already_pending '
  '(offene, nicht abgelaufene Bestätigung — verhindert, dass wiederholtes Absenden fremde Adressen '
  'mit Bestätigungsmails zudeckt) · suppressed (Adresse gesperrt: KEINE Einwilligung, der Lead '
  'bleibt — eine Anfrage ist keine Einwilligung). NUR bei consent_created versendet der '
  'Anwendungscode eine Mail. Bestätigungspflichtiger Zweck ohne p_token_hash wirft. '
  'ZUSAMMENFÜHRUNG bei wiederholter Erfassung: die sechs Segmentierungsfelder (industry, '
  'postal_code, annual_consumption_kwh, metering_type, supplier, contract_end_date) werden von '
  'einem übergebenen Wert ÜBERSCHRIEBEN, ein null-Wert lässt den bestehenden UNBERÜHRT — dieselbe '
  'Person wird über mehrere Einstiegspunkte erfasst, die unterschiedliche Felder erheben, und ohne '
  'diese Regel löschte der zweite Kontakt still, was der erste erbracht hat. company/contact_name/'
  'phone folgen bewusst der umgekehrten Vorrangregel (Bestand gewinnt). service_role-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 6 — Seed: die Einstiegspunkte, die B3-2 verdrahtet
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Idempotent, damit ein erneutes Anwenden bestehende Zeilen nicht anfasst. Die fünf B1-1-Zeilen
-- bleiben unverändert — an ihnen hängt die Herkunft bestehender Leads (FK).
--
-- Sie stehen hier und nicht in B3-2, damit die Erfassungskomponente ohne eigene Migration auskommt:
-- `first_source_key` ist ein FK auf diese Tabelle, ein Einstiegspunkt ohne Zeile könnte also gar
-- keinen Lead anlegen.
insert into platform.lead_sources (key, label) values
  ('betroffenheits-check',   'Betroffenheits-Check'),
  ('rechnerergebnis',        'Unter dem Rechnerergebnis'),
  ('artikel-inline',         'In einem Artikel eingebettet'),
  ('branchenseite',          'Branchenseite'),
  ('vertragsablauf-landing', 'Vertragsablauf-Landingpage')
on conflict (key) do nothing;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 7 — admin_get_lead: die sechs Felder sichtbar machen
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- BEWUSST MINIMAL: nur Darstellung. Keine neuen Filter, keine Bearbeitbarkeit — die gefilterte
-- Sicht ist B2, und ein editierbares Feld bräuchte einen eigenen Schreibwrapper samt Begründung,
-- warum ein Admin eine Angabe überschreiben darf, die die Person selbst gemacht hat.
--
-- Warum überhaupt jetzt: ohne Anzeige lässt sich am ERSTEN echten Lead nicht prüfen, ob die Felder
-- ankommen. Ein Schreibpfad, den niemand nachsehen kann, ist ein unbewiesener Schreibpfad.
--
-- `create or replace` (gleiche Signatur) — die Grants aus B1-1 bleiben damit unangetastet.
create or replace function public.admin_get_lead(p_lead_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lead     jsonb;
  v_consents jsonb;
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
           -- Die BEZEICHNUNG des Einstiegspunkts fährt mit: `lead_sources` ist eine Tabelle (B1-1),
           -- die Anwendung darf sie nicht als Konstante spiegeln. Ohne diese Spalte zeigte die
           -- Detailsicht den rohen Schlüssel, während die Liste (die `sources` mitbekommt) den
           -- Klartext zeigt — dieselbe Angabe in zwei Schreibweisen.
           (select s.label from platform.lead_sources s where s.key = ld.first_source_key)
             as first_source_label,
           ld.retention_basis,
           ld.last_interaction_at,
           ld.deletion_due_at,
           ld.anonymized_at,
           ld.anonymized_by,
           (select au.email from auth.users au where au.id = ld.anonymized_by)
             as anonymized_by_email,
           -- B3-1: die Segmentierungsmerkmale. Anzeige only — der Filter darauf ist B2.
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

  return jsonb_build_object('status', 'ok', 'lead', v_lead, 'consents', v_consents);
end;
$$;

comment on function public.admin_get_lead(uuid) is
  'B1-1, erweitert in B1-3 und B3-1: ein Lead samt allen Einwilligungen — INKLUSIVE des jeweils '
  'angezeigten Textkörpers und seiner Version/Sprache (ohne den Wortlaut wäre der Nachweis keiner: '
  'die Person hat einen Satz gelesen, keinen Zweckschlüssel), effective_status je Einwilligung '
  '(dieselbe Ableitung wie in admin_list_leads), anonymized_by samt E-Mail des Kontos (null, wenn '
  'das Konto gelöscht wurde) sowie den sechs Segmentierungsmerkmalen aus B3-1 (industry, '
  'postal_code, annual_consumption_kwh, metering_type, supplier, contract_end_date — Anzeige only, '
  'der Filter darauf ist B2). token_hash/token_expires_at fahren bewusst nicht mit. WIRFT bei '
  'fehlender Adminrolle (42501); ein unbekannter Lead ist ein fachlicher Zustand '
  '({status: not_found}). authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 8 — Rechte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- capture_lead wurde neu ANGELEGT (drop + create, s. TEIL 5) — damit haben Supabases
-- ALTER-DEFAULT-PRIVILEGES wieder EXECUTE an anon, authenticated UND service_role vergeben
-- (zusätzlich zum PostgreSQL-Default-Grant an PUBLIC). Also erst allen entziehen, dann NUR
-- service_role gewähren: kein Grant an `authenticated` (der Erfassungspfad ist anonym und kennt
-- keinen eingeloggten Nutzer) und keiner an `anon` (ein Browser-Grant machte das Formular zum
-- offenen Schreibzugang auf den Lead-Bestand).
revoke all on function public.capture_lead(
  text, text, platform.consent_purpose, text, timestamptz, text, text, text, inet, text, text,
  platform.industry, text, integer, text, text, date
) from public, anon, authenticated, service_role;

grant execute on function public.capture_lead(
  text, text, platform.consent_purpose, text, timestamptz, text, text, text, inet, text, text,
  platform.industry, text, integer, text, text, date
) to service_role;

-- Die beiden `create or replace`-Funktionen behalten ihre Rechte (CREATE OR REPLACE lässt Eigentümer
-- und ACL unangetastet). Für platform.anonymize_lead wird der B1-3-Entzug trotzdem erneut
-- ausgesprochen, damit die Aussage „von aussen gar nicht aufrufbar" in dieser Datei gesetzt und
-- nicht nur vorausgesetzt ist. public.admin_get_lead bleibt authenticated-only (B1-1).
revoke all on function platform.anonymize_lead(uuid, uuid) from public;

-- Die neue Trigger-Funktion ist KEIN öffentlicher Zugriffsweg: sie wird ausschliesslich vom Trigger
-- consents_clear_contract_data aufgerufen und läuft dort unter ihrem Eigentümer. Dieselbe
-- Behandlung wie platform.touch_lead_on_consent (B1-1).
revoke all on function platform.clear_contract_data_on_withdrawal() from public;
