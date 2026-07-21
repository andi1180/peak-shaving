-- B1-1 — Lead- und Einwilligungsfundament (Fahrplan_2026.md, Abschnitt B1).
--
-- Das Datenfundament der Leadgenerierung 2026: EIN Lead-Bestand mit Lebenszyklus-Kennzeichen,
-- MEHRERE zweckgebundene Einwilligungen je Lead über die Zeit, versionierte UNVERÄNDERLICHE
-- Einwilligungstexte, auf die der Einwilligungseintrag zeigt, und eine Abmelde-Sperrliste, die die
-- Löschung des Leads bewusst ÜBERLEBT.
--
-- REIN DATENBANK. Kein UI, keine Server Action, kein Resend, kein Admin-Bereich — das sind B1-2 und
-- B1-3. Diese Migration legt Schema, Funktionen, Trigger, RLS/Grants und die public-Wrapper an,
-- gegen die B1-2/B1-3 dann bauen.
--
-- ── WARUM DIE INVARIANTEN IN DER DB STEHEN UND NICHT IM ANWENDUNGSCODE ───────────────────────────
-- Dieselbe Begründung wie bei der Entitlement-Ableitung in T4-1 (I2): Anwendungscode kann das
-- Nachziehen vergessen, die DB nicht. Konkret hier: die Löschfrist wird IMMER aus der letzten
-- Interaktion abgeleitet (nie vom Aufrufer gesetzt), ein Herkunftskontext ist nach dem Anlegen
-- unveränderlich, ein bestätigungspflichtiger Zweck kann NIE ohne Bestätigungszeitstempel den
-- Status 'confirmed' erreichen, und ein Einwilligungstext ist nach dem Anlegen weder änder- noch
-- löschbar. Ein Einwilligungsnachweis, dessen Wortlaut man nachträglich ändern kann, ist kein
-- Nachweis; eine Löschfrist, die vom Aufrufer kommt, ist keine Frist.
--
-- ── KONVENTIONEN (exakt T4-1) ────────────────────────────────────────────────────────────────────
-- Alles liegt in `platform` — dem produktübergreifenden Fundament, das NICHT über die REST-API
-- exponiert wird (`supabase/config.toml`, [api].schemas enthält `platform` bewusst nicht). Zugriff
-- von aussen ausschliesslich über SECURITY-DEFINER-Wrapper im `public`-Schema (Invariante J3: ein
-- Zugriffsweg, eine grantbare Fläche). Alle Funktionen mit SET search_path = ''. RLS auf allen
-- Tabellen. `anon` bekommt NIRGENDS Grant, Policy oder Schema-Usage.
--
-- ── WARUM LEADS KEIN NUTZERDATUM SIND ────────────────────────────────────────────────────────────
-- Ein Lead ist BETRIEBSdatum, kein Kontodatum: die Person hinter einem Lead hat in aller Regel gar
-- keinen Account. Deshalb hat `authenticated` auf leads/consents/email_suppressions KEIN Grant und
-- KEINE Policy — anders als bei profiles/entitlements gibt es hier keine "eigene Zeile". Lesender
-- Zugriff läuft ausschliesslich über die beiden admin_*-Wrapper unten (platform.is_admin(), T4-1).
-- Der SCHREIBpfad der anonymen Erfassung läuft in B1-2 über eine Server Action mit service_role —
-- NICHT über ein anon-Grant, exakt wie der Stripe-Webhook-Pfad (T4-3).
--
-- ── MANDANTENFÄHIGKEIT (B13) — JETZT BEWUSST NICHT GEBAUT ────────────────────────────────────────
-- Kein `tenant_id`. Die Erweiterung ist rein ADDITIV und braucht keinen Umbau der Beziehungen:
--   1. `alter table platform.leads add column tenant_id uuid references platform.tenants (id)`
--   2. den E-Mail-UNIQUE von `(normalize_email(email))` auf `(tenant_id, normalize_email(email))`
--      umstellen — dieselbe Adresse darf bei zwei Fachbetrieben getrennt geführt werden
--   3. eine zusätzliche RLS-Policy bzw. eine Mandanten-Bedingung in den admin_*-Wrappern
-- Die Beziehungen zwischen leads/consents/consent_texts/lead_sources/email_suppressions ändern sich
-- dabei NICHT: consents hängen am Lead (und erben dessen Mandanten), consent_texts und lead_sources
-- sind mandantenübergreifende Stammdaten, und email_suppressions ist bewusst global (eine Abmeldung
-- gilt für die Plattform, nicht je Fachbetrieb).

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — Vokabular: Enum für Zwecke, Tabelle für Einstiegspunkte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

-- ── consent_purpose: Enum, weil der ANWENDUNGSCODE jeden Zweck kennen muss ───────────────────────
-- Gegenstück zu lead_sources (Tabelle): Zwecke sind wenige, ändern sich selten, und jeder einzelne
-- hat eigenen Code hinter sich (eigener Versand, eigener Bestätigungs-Flow, eigene Rechtsfolge).
-- Ein Tippfehler soll deshalb hart scheitern statt still eine vierte Zweckkategorie zu erfinden —
-- dieselbe Abwägung wie bei platform.product_key (T4-1).
create type platform.consent_purpose as enum (
  'marketing_email',
  'contract_expiry_reminder',
  'result_delivery'
);

comment on type platform.consent_purpose is
  'Zweck einer Einwilligung. Enum (nicht Tabelle), weil der Anwendungscode jeden Zweck kennen MUSS '
  'und Zwecke sich selten ändern — Gegenstück zu platform.lead_sources, wo laufend neue Einträge '
  'dazukommen und der Code sie nicht kennen muss. Vertragsablauf-Erinnerung ist ausdrücklich NICHT '
  'dieselbe Einwilligung wie Marketing (Fahrplan_2026.md B1) — anderer Zweck, eigene Zeile.';

-- ── lead_sources: Herkunftskontext als Referenztabelle, NICHT als Enum ───────────────────────────
-- Einstiegspunkte (Artikel, Branchenseiten, QR-Aktionen, Landingpages) kommen laufend dazu — B3
-- baut die Erfassungskomponente ausdrücklich als EIN Backend mit VIELEN kontextspezifischen
-- Einstiegspunkten. Ein neuer Einstiegspunkt darf keine Code-Änderung erzwingen, und der
-- Anwendungscode muss die Menge nicht kennen. Genau deshalb Tabelle statt Enum.
create table platform.lead_sources (
  key text primary key check (key ~ '^[a-z0-9-]+$'),
  label text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table platform.lead_sources is
  'Referenztabelle der Einstiegspunkte (Herkunftskontext). Tabelle statt Enum, weil laufend neue '
  'Einstiegspunkte dazukommen (Artikel, Branchenseiten, QR-Aktionen — B3) und der Anwendungscode '
  'sie nicht kennen muss. Wird von platform.leads.first_source_key UND platform.consents.source_key '
  'referenziert: der Bestand hat EINE Ersterfassungs-Herkunft, jede einzelne Einwilligung ihre '
  'eigene.';

comment on column platform.lead_sources.key is
  'Stabiler maschinenlesbarer Schlüssel (kleingeschrieben, nur a-z 0-9 und Bindestrich, per CHECK '
  'erzwungen). Wandert in URLs/QR-Codes/Auswertungen — deshalb eng gefasst.';

comment on column platform.lead_sources.is_active is
  'Einstiegspunkt aktiv? Abgelaufene Aktionen werden deaktiviert, NIE gelöscht — an ihnen hängt die '
  'Herkunft bestehender Leads (FK). Eine Löschung würde die Herkunftsaussage vernichten.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — Reine Funktionen (Normalisierung, Hash, Fristen, Zweck-Regel)
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Stehen VOR den Tabellen, weil der E-Mail-UNIQUE-Index auf platform.normalize_email() aufsetzt.

-- ── normalize_email: die EINE Definition von "dieselbe Adresse" ──────────────────────────────────
create function platform.normalize_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(btrim(p_email));
$$;

comment on function platform.normalize_email(text) is
  'Normalisiert eine E-Mail-Adresse (lower + trim) — die EINE Definition von "dieselbe Adresse". '
  'Wird vom BEFORE-Trigger auf leads, vom UNIQUE-Index und von platform.email_hash benutzt, damit '
  'Speicherung, Eindeutigkeit und Sperrlisten-Prüfung nie auseinanderlaufen. IMMUTABLE (lower/btrim '
  'sind es) — Voraussetzung für die Verwendung im Index.';

-- ── email_hash: SHA-256 der NORMALISIERTEN Adresse ───────────────────────────────────────────────
-- Bewusst deterministisch (kein Salt): die Prüfung "ist diese Adresse gesperrt" muss ohne Klartext
-- funktionieren — mit Salt wäre ein Nachschlagen unmöglich und die Sperrliste nutzlos. Der Preis
-- ist bekannt und akzeptiert: wer eine Adresse RÄT, kann sie verifizieren. Das schützt nicht gegen
-- gezielte Nachfrage, aber es verhindert, dass die Sperrliste selbst als Verteilerliste taugt —
-- genau das ist ihr Zweck (eine Liste von Personen, die Löschung verlangt haben, darf nicht
-- benutzbar sein).
--
-- IMMUTABLE, obwohl convert_to formal STABLE ist (das Ergebnis hinge an der Datenbank-Kodierung):
-- die Kodierung ist über die Lebensdauer der Datenbank fix (UTF8), der Hash damit deterministisch.
-- Bewusste, benannte Vereinfachung — die Funktion wird NICHT in einem Index verwendet (der PK von
-- email_suppressions IST der Hash-Wert), die Kennzeichnung hat also keine Korrektheitsfolge.
create function platform.email_hash(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(platform.normalize_email(p_email), 'UTF8')), 'hex');
$$;

comment on function platform.email_hash(text) is
  'SHA-256 (hex) über platform.normalize_email(p_email). Bewusst deterministisch/ohne Salt: nur so '
  'ist "ist diese Adresse gesperrt?" ohne Klartext beantwortbar. Basis von '
  'platform.email_suppressions (dort steht NUR der Hash, nie die Adresse).';

-- ── retention_months: die EINZIGE Stelle, an der Fristen stehen ──────────────────────────────────
-- 24 Monate für rein werbliche Kontakte, 84 Monate (7 Jahre) für geschäftlich veranlasste — die
-- Frist ist damit KONFIGURATION an einer Stelle und kein Umbau, wenn sie justiert wird. Ein
-- unbekannter retention_basis liefert NULL; der Trigger macht daraus einen harten Fehler statt einer
-- stillschweigend unbestimmten Frist (der CHECK auf der Spalte ist die erste Grenze davor).
create function platform.retention_months(p_retention_basis text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_retention_basis
           when 'marketing'  then 24
           when 'commercial' then 84
         end;
$$;

comment on function platform.retention_months(text) is
  'Aufbewahrungsfrist in Monaten je Rechtsgrundlage: marketing = 24, commercial = 84. Die Fristen '
  'stehen NUR hier — eine spätere Justierung bleibt damit Konfiguration und wird kein Umbau. '
  'Unbekannte Grundlage → NULL (der Trigger sync_lead_retention macht daraus einen harten Fehler, '
  'nie eine unbestimmte Frist).';

-- ── purpose_requires_double_opt_in: die EINE Zuordnung Zweck → Bestätigungspflicht ───────────────
-- REGEL DAHINTER: Bestätigung ist nötig, sobald die Erfüllung eine KÜNFTIGE Mail ist — nicht erst
-- bei Werbung. 'marketing_email' (künftige Aussendungen) und 'contract_expiry_reminder' (eine Mail
-- in Monaten oder Jahren) verlangen sie deshalb beide; 'result_delivery' nicht, weil die Zusendung
-- die unmittelbar angeforderte Leistung selbst IST — wer die Adresse falsch eintippt, bekommt sein
-- Ergebnis nicht, und ein Dritter bekommt eine einzelne, von ihm nicht angeforderte Mail statt eines
-- dauerhaften Verteiler-Eintrags.
-- Muster wie platform.status_grants_access (T4-1): eine Funktion hält das Mapping, damit es nicht in
-- Anwendungscode dupliziert wird.
create function platform.purpose_requires_double_opt_in(p_purpose platform.consent_purpose)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_purpose in ('marketing_email', 'contract_expiry_reminder');
$$;

comment on function platform.purpose_requires_double_opt_in(platform.consent_purpose) is
  'Verlangt dieser Zweck eine Bestätigung (Double-Opt-in)? true für marketing_email und '
  'contract_expiry_reminder, false für result_delivery. REGEL: Bestätigung ist nötig, sobald die '
  'Erfüllung eine KÜNFTIGE Mail ist, nicht erst bei Werbung — eine Erinnerung in zwei Jahren ist '
  'genauso bestätigungsbedürftig wie ein Newsletter. Einzige Quelle dieser Zuordnung (Muster wie '
  'platform.status_grants_access); der Trigger guard_consent_confirmation erzwingt sie hart.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — leads: EIN Bestand, nicht getrennte Listen
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Fahrplan_2026.md B1: EIN Bestand mit Statuskennzeichen. Getrennte Listen je Kanal wären beim
-- ersten Massenversand die Fehlerquelle (dieselbe Person in zwei Listen, in einer abgemeldet).
--
-- `status` ist REINER LEBENSZYKLUS. Abmeldung steht bewusst NICHT darin: sie ist ein
-- EINWILLIGUNGSstatus (consents.status = 'withdrawn' bzw. ein email_suppressions-Eintrag). Der
-- Unterschied ist fachlich, nicht kosmetisch — man kann vom Marketing abgemeldet UND zugleich
-- zahlender Kunde sein; ein einziges Statusfeld für beides würde genau diesen Normalfall
-- unmodellierbar machen.
--
-- KEINE Segmentierungsspalten (Branche, Netzebene, PLZ, Verbrauch): die kommen GETYPT mit B3, wenn
-- der Betroffenheits-Check definiert, was genau erhoben wird. Bis dahin gäbe es nur die Wahl
-- zwischen Vorratsspalten und einem Freitext-Sammelbecken — beides wäre später teurer zu räumen als
-- eine additive Spalte anzulegen.
create table platform.leads (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  first_source_key text not null references platform.lead_sources (key),
  status text not null default 'new'
    check (status in ('new', 'contacted', 'customer', 'anonymized')),
  retention_basis text not null default 'marketing'
    check (retention_basis in ('marketing', 'commercial')),
  last_interaction_at timestamptz not null default now(),
  deletion_due_at timestamptz not null,
  anonymized_at timestamptz,
  company text,
  contact_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table platform.leads is
  'EIN Lead-Bestand (Fahrplan_2026.md B1) — keine getrennten Listen je Kanal. Enthält den '
  'Personenbezug im Klartext; die Löschfrist steht in deletion_due_at und wird AUSSCHLIESSLICH per '
  'Trigger abgeleitet. Kein tenant_id (B13, additiv nachrüstbar — s. Kopfkommentar). Zugriff nur '
  'über service_role (Server Action, B1-2) bzw. die admin_*-Wrapper; weder anon noch authenticated '
  'haben ein Grant.';

comment on column platform.leads.email is
  'E-Mail im Klartext, NORMALISIERT (lower + trim per BEFORE-Trigger normalize_lead_email). '
  'Eindeutig über den normalisierten Wert (unique index auf platform.normalize_email(email)) — der '
  'Index hält auch dann, wenn der Trigger je umgebaut würde. Klartext ist hier nötig (an diese '
  'Adresse wird zugestellt); nur die SPERRLISTE kommt ohne aus.';

comment on column platform.leads.first_source_key is
  'PFLICHTFELD: über welchen Einstiegspunkt der Kontakt ERSTMALS entstanden ist. Nach dem Anlegen '
  'unveränderlich (Trigger guard_lead_first_source) — eine nachträglich umgeschriebene Herkunft '
  'wäre keine Herkunft. Spätere Kontakte über andere Einstiegspunkte stehen an der jeweiligen '
  'Einwilligung (consents.source_key), nicht hier.';

comment on column platform.leads.status is
  'REINER Lebenszyklus: new → contacted → customer (bzw. anonymized). Eine ABMELDUNG ist bewusst '
  'KEIN Lead-Status, sondern ein Einwilligungsstatus (consents.status=withdrawn + '
  'email_suppressions) — man kann vom Marketing abgemeldet und zugleich zahlender Kunde sein.';

comment on column platform.leads.retention_basis is
  'Rechtsgrundlage der Aufbewahrung und damit der Fristenlänge: marketing (24 Monate) oder '
  'commercial (84 Monate, geschäftlich veranlasst). Die Monatszahlen stehen NUR in '
  'platform.retention_months.';

comment on column platform.leads.last_interaction_at is
  'Letzte Interaktion. Rückt bei jeder neuen/geänderten Einwilligung automatisch nach (Trigger '
  'touch_lead_on_consent) und schiebt damit die Löschfrist mit — die Frist läuft ab dem letzten '
  'Kontakt, nicht ab der Ersterfassung.';

comment on column platform.leads.deletion_due_at is
  'ABGELEITET, niemals vom Anwendungscode gesetzt: last_interaction_at + '
  'platform.retention_months(retention_basis), per BEFORE-Trigger sync_lead_retention bei JEDEM '
  'INSERT/UPDATE neu berechnet. Ein vom Aufrufer mitgegebener Wert wird kommentarlos überschrieben '
  '— die Spalte ist eine Ableitung, keine Eingabe.';

comment on column platform.leads.anonymized_at is
  'Zeitpunkt der Anonymisierung (Gegenstück zu status=anonymized). Der Anonymisierungs-/Löschjob '
  'selbst gehört NICHT zu B1-1 und ist bewusst nicht vorgebaut; die Spalte hält den Zustand, den er '
  'setzen wird.';

-- Eindeutigkeit über den NORMALISIERTEN Wert. Zwei Mechanismen, bewusst:
--   1. der BEFORE-Trigger normalisiert den gespeicherten Wert (was drinsteht, ist normalisiert),
--   2. dieser Ausdrucks-Index garantiert die Eindeutigkeit UNABHÄNGIG vom Trigger.
-- Nur (1) hiesse: wer den Trigger je deaktiviert/umbaut, bekommt "Max@x.at" und "max@x.at" als zwei
-- Leads — und damit denselben Menschen zweimal im Verteiler.
create unique index leads_email_normalized_key
  on platform.leads (platform.normalize_email(email));

-- Der Zugriffspfad des künftigen Löschjobs ("welche Leads sind fällig?"). Ohne ihn wäre das ein
-- Full Scan über den gesamten Bestand — der Job selbst kommt später, sein Index kostet nichts.
create index leads_deletion_due_at_idx on platform.leads (deletion_due_at);

-- Sortier-/Paginierungspfad von public.admin_list_leads (neueste zuerst).
create index leads_created_at_idx on platform.leads (created_at desc);

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — consent_texts: versionierte, UNVERÄNDERLICHE Einwilligungstexte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Der Nachweis einer Einwilligung ist wertlos, wenn der Text nachträglich änderbar ist. Deshalb
-- append-only per Trigger (Muster exakt wie platform.reject_stripe_event_mutation, T4-1) — eine
-- neue Fassung ist eine NEUE Zeile mit höherer version, nie ein UPDATE der alten. Bestehende
-- consents zeigen weiter auf die Fassung, die die Person tatsächlich gesehen hat.
--
-- `locale` ist enthalten, weil ein englischsprachig angezeigter Text auch englisch archiviert werden
-- muss: man kann keine Zustimmung zu einem Text belegen, den die Person nie gesehen hat. Ohne
-- locale-Spalte wäre die einzige Alternative, Übersetzungen als eigene "Versionen" zu führen — dann
-- wäre die Versionsnummer nicht mehr die Fassung, sondern eine Mischung aus Fassung und Sprache.
create table platform.consent_texts (
  id uuid primary key default gen_random_uuid(),
  purpose platform.consent_purpose not null,
  version integer not null check (version > 0),
  locale text not null default 'de' check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  body text not null,
  valid_from timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (purpose, version, locale)
);

comment on table platform.consent_texts is
  'Versionierte, UNVERÄNDERLICHE Einwilligungstexte. Append-only per Trigger '
  'reject_consent_text_mutation (Muster wie platform.stripe_events, T4-1): eine neue Fassung ist '
  'eine neue Zeile mit höherer version, nie ein UPDATE. Begründung: ein Nachweis, dessen Wortlaut '
  'nachträglich änderbar ist, ist kein Nachweis. platform.consents zeigt per FK auf genau die '
  'Fassung, die der Person angezeigt wurde.';

comment on column platform.consent_texts.locale is
  'Sprache der ANGEZEIGTEN Fassung (de, en, optional Region wie de-AT). Ein englisch angezeigter '
  'Text muss englisch archiviert werden — man kann keine Zustimmung zu einem Wortlaut belegen, den '
  'die Person nie gesehen hat. Deshalb Teil des UNIQUE (purpose, version, locale) und nicht des '
  'Versionsbegriffs.';

comment on column platform.consent_texts.valid_from is
  'Ab wann diese Fassung angezeigt wurde/wird. Reine Dokumentation der Ablösung; welcher Text für '
  'eine konkrete Einwilligung galt, sagt IMMER der FK consents.consent_text_id — nie ein '
  'Zeitfenster-Vergleich (der wäre bei nachträglich eingespielten Fassungen falsch).';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 5 — consents: MEHRERE zweckgebundene Einwilligungen je Lead über die Zeit
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Kein UNIQUE auf (lead_id, purpose): dieselbe Person kann denselben Zweck über die Jahre mehrfach
-- erteilen, widerrufen und erneut erteilen. Jede dieser Zeilen ist ein eigener Nachweis mit eigenem
-- Zeitpunkt, eigener Herkunft und eigenem Textstand — die HISTORIE ist der Nachweis. Die Frage "darf
-- ich jetzt senden?" beantwortet ausschliesslich platform.has_confirmed_consent, nie ein Blick auf
-- eine einzelne Zeile.
create table platform.consents (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references platform.leads (id) on delete cascade,
  consent_text_id uuid not null references platform.consent_texts (id),
  source_key text not null references platform.lead_sources (key),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'withdrawn', 'expired')),
  granted_at timestamptz not null default now(),
  confirmed_at timestamptz,
  withdrawn_at timestamptz,
  source_ip inet,
  user_agent text,
  token_hash text,
  token_expires_at timestamptz
);

comment on table platform.consents is
  'Zweckgebundene Einwilligungen je Lead — MEHRERE über die Zeit, bewusst OHNE UNIQUE auf '
  '(lead_id, purpose): erteilen/widerrufen/erneut erteilen ist der Normalfall, und jede Zeile ist '
  'ein eigener Nachweis (Zeitpunkt, Herkunft, Textfassung). Ob gesendet werden darf, beantwortet '
  'ausschliesslich platform.has_confirmed_consent. Löscht der Lead, löschen die Einwilligungen mit '
  '(ON DELETE CASCADE) — die Sperrliste bleibt bewusst bestehen (s. email_suppressions).';

comment on column platform.consents.consent_text_id is
  'Die konkrete, unveränderliche Fassung des Textes, der DIESER Person angezeigt wurde. Kein '
  'ON DELETE CASCADE (und kein Löschpfad überhaupt): der Text überlebt den Lead, sonst verlöre man '
  'den Wortlaut für die verbleibenden Nachweise.';

comment on column platform.consents.source_key is
  'Der Einstiegspunkt, der GENAU DIESE Einwilligung erzeugt hat — nicht zu verwechseln mit '
  'leads.first_source_key (Ersterfassung des Kontakts). Beispiel: erfasst über den Schnellrechner, '
  'Jahre später Marketing-Einwilligung über einen Fachvortrag.';

comment on column platform.consents.status is
  'pending (erteilt, unbestätigt) → confirmed (Double-Opt-in vollzogen) bzw. withdrawn/expired. '
  'NUR confirmed berechtigt zum Versand (platform.has_confirmed_consent) — pending ist rechtlich '
  'wertlos. Der Trigger guard_consent_confirmation verhindert confirmed ohne confirmed_at bei '
  'bestätigungspflichtigen Zwecken.';

comment on column platform.consents.source_ip is
  'IP zum Zeitpunkt der Erteilung — AUSSCHLIESSLICH Einwilligungsnachweis, nie Profilbildung, wird '
  'mit dem Lead gelöscht (ON DELETE CASCADE). Das widerspricht dem Projektprinzip "kein '
  'IP-Tracking" nicht: verboten ist Verhaltensprofilbildung, nicht der Nachweis, dass und wann '
  'jemand zugestimmt hat. Es gibt keinen Index und keine Auswertung über diese Spalte.';

comment on column platform.consents.user_agent is
  'Browser-Kennung zum Zeitpunkt der Erteilung — selber Zweck und dieselbe Grenze wie source_ip.';

comment on column platform.consents.token_hash is
  'SHA-256 des Double-Opt-in-Tokens. Der KLARTEXT-Token steht nur in der Bestätigungsmail, NIE in '
  'der Datenbank: er ist faktisch eine Zugangsberechtigung (wer ihn hat, kann bestätigen). Ein '
  'DB-Leck darf daher keine bestätigbaren Tokens enthalten. UNIQUE, wo gesetzt.';

comment on column platform.consents.token_expires_at is
  'Ablauf des Bestätigungs-Tokens. Die Auswertung (abgelaufene pending-Einwilligungen auf expired '
  'setzen) gehört zum Bestätigungs-Flow B1-2/B1-3 und ist hier bewusst nicht vorgebaut.';

-- Join-/Zugriffspfad: Einwilligungen eines Leads (admin_get_lead, has_confirmed_consent,
-- touch_lead_on_consent, Cascade beim Löschen).
create index consents_lead_id_idx on platform.consents (lead_id);

-- Der Nachschlagepfad des Bestätigungslinks (B1-2) UND die harte Grenze gegen kollidierende Tokens.
-- Partiell, weil ein fehlender Token (Zwecke ohne Double-Opt-in) kein Duplikat ist.
create unique index consents_token_hash_key
  on platform.consents (token_hash) where token_hash is not null;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 6 — email_suppressions: überlebt die Lead-Löschung BEWUSST
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- KEIN Fremdschlüssel auf leads, KEIN Kaskadenlöschen. Genau das ist der Zweck: wird der Lead
-- gelöscht (Löschverlangen oder abgelaufene Frist), muss die Abmeldung bestehen bleiben — sonst
-- steht die Person beim nächsten Import wieder im Verteiler und bekommt genau die Mail, die sie
-- abbestellt hat. Ein FK würde die Zeile mitreissen und damit die Zusage brechen.
--
-- NUR der Hash, kein Klartext: eine Liste von Personen, die Löschung verlangt haben, darf keine
-- benutzbare Verteilerliste sein. Geprüft wird über platform.is_suppressed(email) — der Aufrufer
-- hat die Adresse ohnehin (er will ihr schreiben), die Liste selbst gibt sie nicht her.
create table platform.email_suppressions (
  email_hash text primary key,
  reason text not null check (reason in ('unsubscribed', 'bounced', 'complaint', 'manual')),
  created_at timestamptz not null default now()
);

comment on table platform.email_suppressions is
  'Sperrliste (Abmeldung, Bounce, Beschwerde, manuell). ÜBERLEBT die Lead-Löschung bewusst: kein FK '
  'auf leads, kein Kaskadenlöschen — sonst stünde eine abgemeldete Person nach Lead-Löschung und '
  'nächstem Import wieder im Verteiler. Speichert NUR den SHA-256 der normalisierten Adresse '
  '(platform.email_hash), damit die Liste selbst nicht als Verteilerliste taugt. Prüfung über '
  'platform.is_suppressed.';

comment on column platform.email_suppressions.email_hash is
  'SHA-256 (hex) der NORMALISIERTEN Adresse (platform.email_hash) — zugleich Primärschlüssel: '
  'dieselbe Adresse kann nicht zweimal gesperrt sein. Kein Klartext, kein Salt (sonst wäre die '
  'Prüfung "ist gesperrt?" nicht möglich).';

comment on column platform.email_suppressions.reason is
  'Warum gesperrt: unsubscribed (Abmeldelink), bounced (dauerhaft unzustellbar), complaint '
  '(Spam-Beschwerde), manual. Beeinflusst die Sperrwirkung NICHT — jede Sperre sperrt; der Grund '
  'ist Betriebswissen (z. B. Zustellqualität).';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 7 — Lesefunktionen: die zwei Fragen vor jedem Versand
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

-- ── has_confirmed_consent: die EINE Funktion, die vor jedem Versand befragt wird ─────────────────
-- Liefert AUSDRÜCKLICH false bei 'pending': eine unbestätigte Einwilligung ist rechtlich wertlos und
-- darf in keiner Aussendung landen. Genauso false bei withdrawn/expired. Der Zweck kommt über den
-- verknüpften Text (consent_texts.purpose) — es gibt keine zweite, denormalisierte Zweck-Angabe an
-- der Einwilligung, die davon abweichen könnte.
--
-- SECURITY DEFINER + nur an service_role gegrantet: ein authenticated-Aufrufer könnte sonst mit
-- geratenen lead_ids den Einwilligungsstand fremder Personen abfragen.
create function platform.has_confirmed_consent(
  p_lead_id uuid,
  p_purpose platform.consent_purpose
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from platform.consents c
    join platform.consent_texts ct on ct.id = c.consent_text_id
    where c.lead_id = p_lead_id
      and ct.purpose = p_purpose
      and c.status = 'confirmed'
  );
$$;

comment on function platform.has_confirmed_consent(uuid, platform.consent_purpose) is
  'Die EINE Funktion, die vor jedem Versand befragt wird: hat dieser Lead für diesen Zweck eine '
  'BESTÄTIGTE Einwilligung? Ausdrücklich false bei pending (unbestätigt = rechtlich wertlos), '
  'withdrawn und expired. Der Zweck kommt über den verknüpften consent_texts-Eintrag — keine zweite '
  'Zweck-Angabe, die abweichen könnte. ZWEITE Pflichtfrage vor jedem Versand ist '
  'platform.is_suppressed (eine Abmeldung überlebt den Lead und steht NICHT in consents).';

-- ── is_suppressed: die zweite Pflichtfrage ───────────────────────────────────────────────────────
create function platform.is_suppressed(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from platform.email_suppressions s
    where s.email_hash = platform.email_hash(p_email)
  );
$$;

comment on function platform.is_suppressed(text) is
  'Ist diese Adresse gesperrt? Vergleicht platform.email_hash(p_email) gegen '
  'platform.email_suppressions — ohne Klartext in der Liste. Muss vor JEDEM Versand zusätzlich zu '
  'platform.has_confirmed_consent gefragt werden: eine Sperre überlebt die Lead-Löschung und steht '
  'deshalb bewusst NICHT an der Einwilligung. SECURITY DEFINER, nur service_role — sonst wäre die '
  'Funktion ein Orakel, mit dem sich beliebige Adressen prüfen liessen.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 8 — Trigger: die Invarianten
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

-- ── normalize_lead_email: die gespeicherte Adresse IST die normalisierte ─────────────────────────
create function platform.normalize_lead_email()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.email = platform.normalize_email(new.email);

  -- '' erfüllt NOT NULL, ist aber keine Adresse (Muster wie die Pflichtfeldprüfung in
  -- public.admin_upsert_scrape_target, T4-4). Eine leere Adresse wäre zudem als einzige "eindeutig"
  -- und würde den zweiten leeren Lead mit einem irreführenden Unique-Fehler ablehnen.
  if new.email = '' then
    raise exception 'platform.leads.email darf nach der Normalisierung nicht leer sein';
  end if;

  return new;
end;
$$;

comment on function platform.normalize_lead_email() is
  'BEFORE INSERT/UPDATE auf leads: schreibt die Adresse normalisiert (platform.normalize_email) und '
  'lehnt eine leere Adresse hart ab. Zusammen mit dem UNIQUE-Index auf normalize_email(email) ist '
  'damit "dieselbe Person" genau einmal im Bestand.';

-- ── sync_lead_retention: die Löschfrist ist eine ABLEITUNG, keine Eingabe ────────────────────────
-- Läuft bei JEDEM INSERT und UPDATE — auch dann, wenn der Aufrufer deletion_due_at mitgibt: der Wert
-- wird kommentarlos überschrieben. Das ist der Punkt. Eine Frist, die der Anwendungscode setzen
-- kann, ist keine Frist; ein vergessenes Nachziehen (z. B. beim Wechsel der Rechtsgrundlage) wäre
-- unsichtbar und würde erst beim Löschjob auffallen — dann aber falsch herum.
create function platform.sync_lead_retention()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_months integer := platform.retention_months(new.retention_basis);
begin
  if v_months is null then
    -- Kann nur passieren, wenn der CHECK auf retention_basis und platform.retention_months
    -- auseinanderlaufen. Dann lieber hart scheitern als eine unbestimmte Frist speichern.
    raise exception
      'platform.retention_months kennt retention_basis "%" nicht — Aufbewahrungsfrist unbestimmbar',
      new.retention_basis;
  end if;

  new.deletion_due_at = new.last_interaction_at + make_interval(months => v_months);
  return new;
end;
$$;

comment on function platform.sync_lead_retention() is
  'BEFORE INSERT/UPDATE auf leads: deletion_due_at = last_interaction_at + '
  'platform.retention_months(retention_basis). Überschreibt einen mitgegebenen Wert bewusst — die '
  'Spalte ist eine Ableitung, keine Eingabe. Folge: der Wechsel der Rechtsgrundlage (marketing → '
  'commercial) verschiebt die Frist automatisch, und eine neue Interaktion (s. touch_lead_on_consent) '
  'lässt sie nachrücken.';

-- ── guard_lead_first_source: Herkunft ist einmalig ───────────────────────────────────────────────
create function platform.guard_lead_first_source()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.first_source_key is distinct from old.first_source_key then
    raise exception
      'platform.leads.first_source_key ist nach dem Anlegen unveränderlich (% → %) — spätere '
      'Einstiegspunkte gehören an die jeweilige Einwilligung (platform.consents.source_key)',
      old.first_source_key, new.first_source_key;
  end if;
  return new;
end;
$$;

comment on function platform.guard_lead_first_source() is
  'BEFORE UPDATE auf leads: blockt jede Änderung von first_source_key. Eine nachträglich '
  'umgeschriebene Ersterfassungs-Herkunft wäre keine Herkunft mehr — und genau sie ist das '
  'Pflichtfeld aus Fahrplan_2026.md B1. Spätere Einstiegspunkte werden je Einwilligung geführt.';

-- ── guard_consent_confirmation: eine Bestätigung lässt sich nicht fälschen ───────────────────────
-- HARTE SPERRE: ein bestätigungspflichtiger Zweck (platform.purpose_requires_double_opt_in) kann
-- status='confirmed' NIE ohne confirmed_at erreichen — weder per INSERT noch per UPDATE, und auch
-- nicht durch service_role oder einen künftigen Wrapper. Ohne diese Sperre wäre "bestätigt" eine
-- Behauptung des Anwendungscodes; mit ihr ist es ein Datenzustand, der ohne Zeitstempel nicht
-- existieren kann.
--
-- Bewusst NUR für bestätigungspflichtige Zwecke: bei 'result_delivery' gibt es keinen
-- Bestätigungsschritt, den ein Zeitstempel belegen könnte — dort wäre die Forderung ein
-- Pflichtfeld ohne Aussage.
create function platform.guard_consent_confirmation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_purpose platform.consent_purpose;
begin
  if new.status <> 'confirmed' or new.confirmed_at is not null then
    return new;
  end if;

  select ct.purpose into v_purpose
    from platform.consent_texts ct
   where ct.id = new.consent_text_id;

  if v_purpose is null then
    -- Der FK garantiert die Zeile normalerweise; FK-Prüfungen laufen aber NACH den Row-Triggern.
    -- Ohne diesen Zweig würde eine unbekannte consent_text_id hier still als "nicht
    -- bestätigungspflichtig" durchgehen und erst danach am FK scheitern — dieselbe Ablehnung, aber
    -- mit irreführender Ursache.
    raise exception
      'platform.consents.consent_text_id % existiert nicht — Bestätigungspflicht nicht bestimmbar',
      new.consent_text_id;
  end if;

  if platform.purpose_requires_double_opt_in(v_purpose) then
    raise exception
      'platform.consents: Zweck % ist bestätigungspflichtig — status=confirmed ohne confirmed_at ist '
      'nicht erlaubt (Double-Opt-in)',
      v_purpose;
  end if;

  return new;
end;
$$;

comment on function platform.guard_consent_confirmation() is
  'BEFORE INSERT/UPDATE auf consents: eine Einwilligung mit '
  'platform.purpose_requires_double_opt_in(purpose)=true kann status=confirmed NIE ohne '
  'confirmed_at erreichen. Harte Sperre — kein Anwendungscode (auch nicht service_role) kann eine '
  'Bestätigung fälschen. Zwecke ohne Bestätigungspflicht sind bewusst nicht betroffen (dort gäbe es '
  'keinen Vorgang, den der Zeitstempel belegen könnte).';

-- ── reject_consent_text_mutation: append-only (Muster exakt wie reject_stripe_event_mutation) ────
create function platform.reject_consent_text_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    'platform.consent_texts ist append-only (Einwilligungsnachweis) — % nicht erlaubt: eine neue '
    'Fassung ist eine neue Zeile mit höherer version, kein UPDATE der alten',
    tg_op;
end;
$$;

comment on function platform.reject_consent_text_mutation() is
  'Blockt UPDATE/DELETE auf consent_texts hart (append-only). Muster wie '
  'platform.reject_stripe_event_mutation (T4-1): greift zusätzlich zum fehlenden Grant und damit '
  'auch gegen BYPASSRLS-Rollen (service_role) und künftige Grant-Fehler. Begründung: der Nachweis '
  'einer Einwilligung ist wertlos, wenn der Text nachträglich änderbar ist.';

-- ── touch_lead_on_consent: die Frist rückt mit der Interaktion nach ──────────────────────────────
-- Jede neue ODER geänderte Einwilligung ist ein Kontakt mit der Person — auch ein Widerruf (auch er
-- ist ein Vorgang, dessen Nachweis aufbewahrt werden muss). Der Update auf leads löst dort
-- sync_lead_retention aus, wodurch deletion_due_at automatisch nachrückt. Kein zweiter Schreibpfad,
-- keine Rekursion: leads-Trigger schreiben nicht zurück nach consents.
--
-- SECURITY DEFINER aus demselben Grund wie sync_entitlement_from_subscription (T4-1): die Ableitung
-- muss unabhängig von den Grants der schreibenden Rolle garantiert sein.
create function platform.touch_lead_on_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update platform.leads l
     set last_interaction_at = now()
   where l.id = new.lead_id;
  return null;
end;
$$;

comment on function platform.touch_lead_on_consent() is
  'AFTER INSERT/UPDATE auf consents: setzt leads.last_interaction_at auf now(), wodurch der Trigger '
  'sync_lead_retention die Löschfrist nachrücken lässt. Gilt bewusst auch für einen Widerruf — auch '
  'er ist ein Vorgang, dessen Nachweis aufzubewahren ist. SECURITY DEFINER, damit die Ableitung '
  'nicht an den Grants der schreibenden Rolle hängt.';

create trigger leads_normalize_email
  before insert or update on platform.leads
  for each row execute function platform.normalize_lead_email();

create trigger leads_sync_retention
  before insert or update on platform.leads
  for each row execute function platform.sync_lead_retention();

create trigger leads_guard_first_source
  before update on platform.leads
  for each row execute function platform.guard_lead_first_source();

create trigger leads_set_updated_at
  before update on platform.leads
  for each row execute function platform.set_updated_at();

create trigger consents_guard_confirmation
  before insert or update on platform.consents
  for each row execute function platform.guard_consent_confirmation();

create trigger consents_touch_lead
  after insert or update on platform.consents
  for each row execute function platform.touch_lead_on_consent();

create trigger consent_texts_no_update
  before update on platform.consent_texts
  for each row execute function platform.reject_consent_text_mutation();

create trigger consent_texts_no_delete
  before delete on platform.consent_texts
  for each row execute function platform.reject_consent_text_mutation();

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 9 — RLS und Grants: Least-Privilege wie T4-1 (kein Grant ist die Voreinstellung)
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- anon: NICHTS — kein Grant, keine Policy, keine Schema-Usage (die bestehende
-- `grant usage on schema platform` aus T4-1 gilt nur authenticated + service_role). Jeder anon-
-- Zugriff scheitert schon an der Schema-Usage.
--
-- authenticated: KEIN Zugriff auf leads/consents/email_suppressions. Ein Lead ist kein Nutzerdatum,
-- es gibt keine "eigene Zeile" — die Person hinter einem Lead hat meist gar keinen Account. Admins
-- lesen ausschliesslich über die beiden public-Wrapper unten.
--
-- service_role (BYPASSRLS, serverseitig): genau die Rechte, die die Erfassung in B1-2 braucht —
-- select/insert/update auf leads und consents, select/insert auf email_suppressions, select auf die
-- beiden Stammdaten-Tabellen. NIRGENDS delete: der Löschjob (Aufbewahrungsfristen) gehört nicht zu
-- B1-1 und bekommt sein Recht, wenn er gebaut wird — keine Rechte auf Vorrat.
--
-- RLS ist auf allen fünf Tabellen aktiv und hat KEINE Policy. Das ist Absicht und kein Vergessen:
-- ohne Policy sieht jede Nicht-BYPASSRLS-Rolle nichts, selbst wenn ihr jemand später versehentlich
-- ein Tabellen-Grant gibt (zwei unabhängige Schichten, Muster wie platform.redemption_codes).

alter table platform.lead_sources       enable row level security;
alter table platform.leads              enable row level security;
alter table platform.consent_texts      enable row level security;
alter table platform.consents           enable row level security;
alter table platform.email_suppressions enable row level security;

grant select on platform.lead_sources  to service_role;
grant select on platform.consent_texts to service_role;
grant select, insert, update on platform.leads    to service_role;
grant select, insert, update on platform.consents to service_role;
-- Sperrliste: kein update/delete. Eine Sperre wird gesetzt und bleibt — ihr Zweck ist zu überleben.
grant select, insert on platform.email_suppressions to service_role;

-- Funktions-Rechte. Die IMMUTABLE-Helfer (normalize_email/email_hash/retention_months/
-- purpose_requires_double_opt_in) berühren KEINE Daten; sie behalten das PUBLIC-Execute (wie
-- platform.status_grants_access in T4-1) und werden zusätzlich explizit an service_role gegrantet,
-- weil die Trigger sie mit den Rechten der SCHREIBENDEN Rolle aufrufen (SECURITY INVOKER).
grant execute on function platform.normalize_email(text) to service_role;
grant execute on function platform.email_hash(text) to service_role;
grant execute on function platform.retention_months(text) to service_role;
grant execute on function platform.purpose_requires_double_opt_in(platform.consent_purpose)
  to service_role;

-- Die datenlesenden SECURITY-DEFINER-Funktionen dagegen erst von PUBLIC entziehen, dann gezielt
-- vergeben (Muster T4-1). NICHT an authenticated: has_confirmed_consent wäre sonst über geratene
-- lead_ids ein Auskunftsweg über fremde Personen, is_suppressed ein Orakel über beliebige Adressen.
revoke all on function platform.has_confirmed_consent(uuid, platform.consent_purpose) from public;
revoke all on function platform.is_suppressed(text) from public;
revoke all on function platform.touch_lead_on_consent() from public;

grant execute on function platform.has_confirmed_consent(uuid, platform.consent_purpose)
  to service_role;
grant execute on function platform.is_suppressed(text) to service_role;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 10 — public-Wrapper für den Admin-Bereich (B1-3 baut die Oberfläche darauf)
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Wrapper statt RLS-Policy aus demselben Grund wie in T4-4: eine Policy wirkt nur, wenn die Rolle
-- überhaupt ein Tabellen-Grant hat — und `authenticated` hat auf leads/consents bewusst keins. Der
-- Weg zurück wäre, breite Tabellenrechte zu vergeben und sie per Policy wieder einzuschränken; ein
-- Policy-Fehler öffnete dann den gesamten Lead-Bestand. Der Wrapper exponiert stattdessen genau zwei
-- Leseoperationen (J3).
--
-- ── ABWEICHUNG VON T4-4, BEWUSST: hier WIRFT die Ablehnung, sie ist kein Status ──────────────────
-- Die neun T4-4-Wrapper geben {status:'forbidden'} zurück, weil dort jede Ablehnung ein REGULÄRER
-- Betriebszustand ist (ein Nutzer tippt einen ungültigen Code ein) und die Server Action sie in
-- Nutzertext übersetzen muss. Hier ist das anders: ein Nicht-Admin, der die Lead-Liste abruft, ist
-- kein Betriebszustand, sondern ein Fehler — und "kein Zugriff" darf sich niemals als "keine Leads"
-- lesen lassen. Eine Exception (SQLSTATE 42501 = insufficient_privilege) kann nicht mit einem leeren
-- Ergebnis verwechselt werden. Fachliche Zustände (Lead nicht gefunden) bleiben Status.

-- ── admin_list_leads: paginierte Liste ───────────────────────────────────────────────────────────
-- BEWUSST OHNE FILTER: die gefilterte Sicht (Segmentierung) ist ausdrücklich B2, nicht B1
-- (Fahrplan_2026.md). Hier nur limit/offset — die Menge, die eine Tabelle darstellen kann.
--
-- Je Zeile fahren zwei abgeleitete Angaben mit, weil die Liste ohne sie irreführend wäre:
--   * is_suppressed — eine Sperre steht im HASH und ist durch keinen Join sichtbar; ohne diese
--     Spalte sähe ein Admin einen scheinbar anschreibbaren Lead, der abgemeldet ist.
--   * consents (Zweck + Status je Einwilligung) — die Frage "wem darf ich überhaupt schreiben?"
--     ist der Grund, warum die Liste existiert; ohne sie bräuchte es je Zeile einen Detailaufruf.
create function public.admin_list_leads(
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total  integer;
  v_leads  jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_list_leads: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select count(*) into v_total from platform.leads;

  select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at desc), '[]'::jsonb)
    into v_leads
  from (
    select ld.id,
           ld.email,
           ld.company,
           ld.contact_name,
           ld.phone,
           ld.status,
           ld.first_source_key,
           ld.retention_basis,
           ld.last_interaction_at,
           ld.deletion_due_at,
           ld.anonymized_at,
           ld.created_at,
           platform.is_suppressed(ld.email) as is_suppressed,
           coalesce((
             select jsonb_agg(
                      jsonb_build_object(
                        'purpose', ct.purpose,
                        'status',  c.status,
                        'granted_at', c.granted_at
                      ) order by ct.purpose, c.granted_at desc
                    )
             from platform.consents c
             join platform.consent_texts ct on ct.id = c.consent_text_id
             where c.lead_id = ld.id
           ), '[]'::jsonb) as consents
    from platform.leads ld
    order by ld.created_at desc
    limit v_limit offset v_offset
  ) l;

  return jsonb_build_object(
    'status', 'ok',
    'leads',  v_leads,
    'total',  v_total,
    'limit',  v_limit,
    'offset', v_offset
  );
end;
$$;

comment on function public.admin_list_leads(integer, integer) is
  'B1-1: paginierte Lead-Liste für den Admin-Bereich (neueste zuerst, limit 1..200, default 50). '
  'Je Zeile zusätzlich is_suppressed (eine Sperre liegt als Hash vor und ist durch keinen Join '
  'sichtbar) und die Einwilligungen als Zweck/Status-Liste. WIRFT bei fehlender Adminrolle '
  '(SQLSTATE 42501) statt einen Status zurückzugeben — "kein Zugriff" darf sich nie als "keine '
  'Leads" lesen lassen. Filter/Segmentierung sind bewusst B2. authenticated-only.';

-- ── admin_get_lead: ein Lead samt Einwilligungen INKLUSIVE Wortlaut ──────────────────────────────
-- Der Textkörper und die Version fahren ausdrücklich mit: ein Nachweis ist nur dann ein Nachweis,
-- wenn im Admin sichtbar ist, WELCHEM WORTLAUT zugestimmt wurde. Eine Zweck-Bezeichnung allein
-- ("marketing_email") belegt nichts — die Person hat einen Satz gelesen, keinen Schlüssel.
--
-- token_hash und token_expires_at fahren BEWUSST NICHT mit: der Hash ist ein Sicherheitsartefakt
-- ohne Nachweiswert, und er gehört nicht in eine Oberfläche.
create function public.admin_get_lead(p_lead_id uuid)
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
           ld.retention_basis,
           ld.last_interaction_at,
           ld.deletion_due_at,
           ld.anonymized_at,
           ld.created_at,
           ld.updated_at,
           platform.is_suppressed(ld.email) as is_suppressed
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
           cs.source_key,
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
  'B1-1: ein Lead samt allen Einwilligungen — INKLUSIVE des jeweils angezeigten Textkörpers und '
  'seiner Version/Sprache. Ohne den Wortlaut wäre der Nachweis keiner: die Person hat einen Satz '
  'gelesen, keinen Zweckschlüssel. token_hash/token_expires_at fahren bewusst nicht mit '
  '(Sicherheitsartefakt ohne Nachweiswert). WIRFT bei fehlender Adminrolle (SQLSTATE 42501); ein '
  'unbekannter Lead ist dagegen ein fachlicher Zustand und kommt als {status: not_found}. '
  'authenticated-only.';

-- Supabase vergibt per ALTER DEFAULT PRIVILEGES auf NEUE public-Funktionen automatisch EXECUTE an
-- anon, authenticated UND service_role (zusätzlich zum PostgreSQL-Default-Grant an PUBLIC) —
-- deshalb explizit von allen entziehen und danach NUR authenticated gewähren (Muster T4-2/T4-4).
-- service_role bekommt bewusst KEIN Grant: diese Wrapper leiten ihre Autorisierung aus auth.uid()
-- ab, das für service_role NULL ist — sie wären dort funktionslos und stets abgelehnt.
revoke all on function public.admin_list_leads(integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_get_lead(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_list_leads(integer, integer) to authenticated;
grant execute on function public.admin_get_lead(uuid) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 11 — Seed (idempotent)
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

-- Die fünf Einstiegspunkte, die 2026 real existieren bzw. unmittelbar anstehen (B3). Idempotent,
-- damit ein erneutes Anwenden der Migration bestehende Zeilen nicht anfasst.
insert into platform.lead_sources (key, label) values
  ('kontaktformular',   'Kontaktformular'),
  ('schnellrechner',    'Schnellrechner / Betroffenheits-Check'),
  ('wko-postaktion-qr', 'WKO-Postaktion (QR-Code)'),
  ('fachvortrag',       'Fachvortrag'),
  ('direktkontakt',     'Direktkontakt')
on conflict (key) do nothing;

-- Je Zweck genau eine Fassung, version 1, locale 'de'.
--
-- WORTLAUT IST ARBEITSSTAND: die juristische Prüfung steht aus (Fahrplan_2026.md §7 "Fachliche
-- Abhängigkeiten": "Rechtssicherer Einwilligungstext", Owner Martin). Vor breiter Aussendung ist der
-- Wortlaut zu prüfen. Eine geprüfte Fassung kommt als NEUE Zeile mit version 2 dazu — diese hier
-- wird NICHT editiert (append-only, s. reject_consent_text_mutation): bestehende Einwilligungen
-- müssen weiter auf den Text zeigen, der ihnen tatsächlich angezeigt wurde.
insert into platform.consent_texts (purpose, version, locale, body) values
  (
    'marketing_email', 1, 'de',
    'Ich möchte von der COOLiN ENERGY GmbH Informationen und Angebote rund um Netzentgelte, '
    'Lastspitzen und Energiekosten per E-Mail erhalten. Diese Einwilligung kann ich jederzeit über '
    'den Abmeldelink in jeder E-Mail oder per Nachricht an energy@coolin.at widerrufen.'
  ),
  (
    'contract_expiry_reminder', 1, 'de',
    'Ich möchte per E-Mail an das Ende meiner Strom-Vertragslaufzeit erinnert werden. Dafür '
    'speichert die COOLiN ENERGY GmbH meinen Versorger und mein Vertragsende. Diese Einwilligung '
    'kann ich jederzeit widerrufen.'
  ),
  (
    'result_delivery', 1, 'de',
    'Ich möchte mein Rechenergebnis per E-Mail zugeschickt bekommen. Die E-Mail-Adresse wird '
    'ausschließlich für diese Zusendung verwendet.'
  )
on conflict (purpose, version, locale) do nothing;
