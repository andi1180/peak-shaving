-- B16-3 — Partner-Bewerbungen: der öffentliche Antrag und sein Prüf-Eingang
-- (Fahrplan_2026.md, Abschnitt B16 — dritter Teil).
--
-- B16-1 hat die Stammdaten der Fachbetriebe angelegt (`platform.partners`), B16-2 den öffentlichen
-- Rand der Attribution (Landingpage, Herkunft, Lesezugriff). Beides setzt voraus, dass jemand den
-- Fachbetrieb VON HAND anlegt. B16-3 macht den Weg von aussen auf: Ein Betrieb bewirbt sich selbst,
-- bekommt dabei ein Konto, und der Antrag landet in einem Prüf-Eingang.
--
-- ── WAS HIER AUSDRÜCKLICH NICHT ENTSTEHT ────────────────────────────────────────────────────────
-- KEIN GENEHMIGEN. Es gibt in dieser Migration keinen Wrapper, der einen Antrag auf 'approved'
-- setzt — und das ist keine Lücke, sondern die zentrale Entscheidung dieses Schritts: Genehmigen
-- heisst in B16-4 einen Partner anlegen, einen Slug vergeben und ein Konto freischalten. Ein Weg,
-- der jetzt nur den Status setzte, hinterliesse einen genehmigten Antrag OHNE Partner — ein stiller
-- Zustand, der wie Erfolg aussieht und den niemand mehr von einem echten unterscheiden kann. Der
-- Enum-Wert 'approved' existiert bereits, weil B16-4 ihn braucht; erreichbar ist er nur über eine
-- Migration, die ihn erreichbar macht.
--
-- KEIN TYPFELD am Konto. Was ein Konto darf, ergibt sich aus dem, was es HÄLT: eine Zeile in
-- `platform.partners` (darf verweisen) und/oder ein Entitlement wie `calculator_pro` (darf ein
-- Produkt nutzen). Ein Betrieb kann beides gleichzeitig halten — ein Typ-Enum erzwänge eine
-- Ausschliesslichkeit, die sachlich nicht gilt, und müsste beim ersten Mischfall umgebaut werden.
-- Additive Zeilen brauchen das nie (Muster T4).
--
-- KEIN `tenant_id`, kein Partner-Login, keine Partner-eigene Sicht auf Leads (B13/B16-5/B16-6).
-- KEIN neuer `consent_purpose` und keine Einwilligungszeile: die Rechtsgrundlage einer Bewerbung ist
-- Vertragsanbahnung — dieselbe wie beim Kontaktformular (B1-2) und bei der Registrierung (B10-5).
--
-- ── ⚠ OFFEN: AUFBEWAHRUNGSFRIST FÜR ABGELEHNTE ANTRÄGE ──────────────────────────────────────────
-- Diese Migration baut BEWUSST KEINE Aufbewahrungslogik. Die bestehende Maschinerie (B4-1,
-- `platform.leads_due_for_anonymization`/`run_lead_retention`, ausgelöst vom Vercel-Cron) greift
-- ausschliesslich auf `platform.leads` und lässt diese Tabelle unangetastet — geprüft, nicht
-- angenommen: sie liest `platform.leads` und schreibt über `platform.anonymize_lead`, beides ohne
-- Bezug hierauf. Welche Frist für einen ABGELEHNTEN Antrag gilt (und ob ein genehmigter unter die
-- kaufmännische 7-Jahres-Frist fällt), gehört in dieselbe juristische Prüfung wie die noch
-- ausstehenden Einwilligungstexte (Fahrplan_2026.md §7, Owner Martin). Eine hier erfundene Frist
-- wäre genau die Sorte Zahl, die 2028 als Entscheidung dasteht, die niemand getroffen hat.
-- Zusätzlich vermerkt in `DEPLOYMENT.md` (offene Punkte) — ein Vermerk allein in einer Migration
-- wird nicht wiedergefunden.
--
-- ── KONVENTIONEN (exakt T4-1/B1-1/B2-1/B14-1/B16-1) ─────────────────────────────────────────────
-- Alles Fachliche in `platform` (nicht über die REST-API exponiert, `supabase/config.toml`), Zugriff
-- von aussen ausschliesslich über SECURITY-DEFINER-Wrapper im `public`-Schema, alle Funktionen mit
-- `SET search_path = ''` und vollqualifizierten Objektnamen, RLS auf der Tabelle, erst
-- `revoke all … from public, anon, authenticated, service_role`, dann gezielt grants. `anon` bekommt
-- NIRGENDS etwas, und es gibt für KEINE Rolle ein `delete`-Grant.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — Der Status eines Antrags
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Enum und nicht Referenztabelle: dieselbe Regel wie bei `platform.consent_purpose` (B1-1) und
-- `platform.industry` (B3-1) — der Anwendungscode MUSS jeden Wert kennen (die Oberfläche filtert
-- danach, B16-4 verzweigt daran). Eine Tabelle wäre richtig, wenn Werte im Betrieb dazukämen; hier
-- ist das Gegenteil der Fall: ein vierter Zustand wäre eine fachliche Entscheidung mit Code-Folgen.
create type platform.partner_application_status as enum ('pending', 'approved', 'rejected');

comment on type platform.partner_application_status is
  'B16-3: Lebenszyklus einer Partner-Bewerbung. ''approved'' ist in B16-3 UNERREICHBAR — es gibt '
  'keinen Wrapper, der ihn setzt (Genehmigen erzeugt in B16-4 Partner, Slug und Freischaltung; ein '
  'Weg, der jetzt nur den Status setzte, hinterliesse einen genehmigten Antrag ohne Partner). Der '
  'Wert steht schon hier, weil ein späteres ALTER TYPE … ADD VALUE nicht im selben '
  'Transaktionsblock gelesen werden darf und B16-4 ihn braucht.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — platform.partner_applications
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── WARUM EINE EIGENE TABELLE UND NICHT platform.leads ──────────────────────────────────────────
-- Zwei Gründe, und beide sind fachlich, nicht technisch:
--
--   1. ANDERER LEBENSZYKLUS. Ein Lead durchläuft new → contacted → customer (B1-1) und wird nach
--      Fristablauf anonymisiert. Eine Bewerbung durchläuft pending → approved|rejected und endet in
--      einer Partnerzeile oder einer Absage. Die zwei Ketten in eine Statusspalte zu zwingen hiesse,
--      Zustände zu erfinden, die es in der jeweils anderen Welt nicht gibt.
--
--   2. ANDERE AUSWERTUNG. `platform.leads` ist die Zahl, an der die Marktnachfrage gemessen wird
--      (Ziel: 500 Kontakte). Ein Fachbetrieb, der VERTRIEBSPARTNER werden will, ist kein
--      Peak-Shaving-Interessent — mitgezählt verfälschte er genau diese Kennzahl, und zwar
--      unbemerkt, weil die Zeile ja plausibel aussieht. In `leads` vermischt liesse sich „will Kunde
--      werden" nachträglich nicht mehr von „will Partner werden" trennen.
--
-- Aus demselben Grund erzeugt der Bewerbungsweg im Anwendungscode ausdrücklich KEINEN Lead — anders
-- als die Registrierung seit B10-5 (`lib/partner-application/`, dokumentiert dort).
--
-- ── VOR- UND NACHNAME GETRENNT, VON ANFANG AN ───────────────────────────────────────────────────
-- Genau diese Zusammenlegung hat `platform.leads` am 24.07.2026 einen brechenden Spaltenwechsel
-- gekostet (`…_split_contact_name.sql`): ein zusammengesetzter Freitextname lässt sich bei
-- Doppelnamen, Namenszusätzen und Titeln nicht zuverlässig zerlegen, und der Fehler landet in der
-- Anrede einer echten E-Mail. `platform.partners` führt sie seit B16-1 aus demselben Grund getrennt.
--
-- ── DER FREITEXT IST PFLICHT ────────────────────────────────────────────────────────────────────
-- „Was macht Ihr Betrieb, warum möchten Sie Partner werden?" ist die Grundlage der Prüfung und die
-- Basis jeder Rückfrage. Ein leerer Antrag ist nicht prüfbar — er zwänge dazu, den Betrieb erst
-- anzurufen, um zu erfahren, worüber überhaupt entschieden werden soll. Deshalb NOT NULL samt
-- Leerstring-CHECK: '' erfüllt NOT NULL, ist aber kein Text.
--
-- Eine Längenobergrenze steht bewusst NICHT hier, sondern im zod-Schema des Formulars: keine andere
-- Textspalte in `platform` trägt eine (geprüft), und ein Verstoss käme als 23514 statt als Meldung
-- am Feld. Der Wrapper unten ist service_role-only; es gibt keinen Aufrufer an dem Schema vorbei.
create table platform.partner_applications (
  id uuid primary key default gen_random_uuid(),

  -- Die Angaben des Betriebs.
  company text not null check (btrim(company) <> ''),
  first_name text not null check (btrim(first_name) <> ''),
  last_name text not null check (btrim(last_name) <> ''),
  email text not null check (btrim(email) <> ''),
  phone text,
  website text,
  message text not null check (btrim(message) <> ''),

  /*
   * Das Konto, das bei der Bewerbung entstanden ist ODER schon bestand.
   *
   * NULLABLE, und das ist keine Nachlässigkeit: (a) `on delete set null` — löscht jemand sein Konto
   * (DSGVO), darf das weder den Antrag mitreissen noch die Löschung blockieren; (b) scheitert die
   * Kontoanlage aus einem Grund, den der Bewerber nicht zu verantworten hat (Rate-Limit des
   * Mailversands, Ausfall), muss der Antrag TROTZDEM entstehen — eine verlorene Bewerbung wiegt
   * schwerer als eine fehlende Verknüpfung, und B16-4 kann sie über die Adresse nachziehen.
   *
   * Kein `on delete cascade`: Ein gelöschtes Konto löscht keine Geschäftsunterlage (dieselbe
   * Überlegung wie bei `platform.analyses.created_by`, B14-1).
   */
  user_id uuid references auth.users (id) on delete set null,

  -- Die Prüfung.
  status platform.partner_application_status not null default 'pending',
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,

  created_at timestamptz not null default now(),

  /*
   * Ein geprüfter Antrag trägt einen Prüfzeitpunkt, ein offener keinen. Der Zeitpunkt und nicht das
   * KONTO ist die Bedingung: `reviewed_by` trägt `on delete set null` und wird null, sobald das
   * Konto des Prüfers gelöscht wird — der Vorgang bleibt belegt, nur die Zuschreibung entfällt
   * (dieselbe Konstruktion und dieselbe Begründung wie `platform.leads.anonymized_by`, B1-3). Ein
   * CHECK auf `reviewed_by is not null` machte genau dieses Löschen unmöglich.
   */
  constraint partner_applications_review_consistent check (
    (status = 'pending' and reviewed_at is null and reviewed_by is null)
    or (status <> 'pending' and reviewed_at is not null)
  )
);

comment on table platform.partner_applications is
  'B16-3: Bewerbungen von Fachbetrieben, die Vertriebspartner werden wollen (Modell A). EIGENE '
  'Tabelle und ausdrücklich NICHT platform.leads: anderer Lebenszyklus (Antrag → geprüft → Partner '
  'statt der Lead-Statuskette) und andere Auswertung — in leads vermischt liesse sich „will Kunde '
  'werden" nicht mehr von „will Vertriebspartner werden" trennen, und die Zahl, an der die '
  'Marktnachfrage gemessen wird, wäre still verfälscht. KEIN Slug (der entsteht erst bei der '
  'Genehmigung, B16-4), KEIN Typfeld (was ein Konto darf, ergibt sich aus dem, was es hält), KEINE '
  'Fremdschlüsselverbindung zu platform.partners (die Richtung entscheidet B16-4). RLS aktiv, für '
  'KEINE Rolle irgendein Grant — jeder Zugriff läuft über die public-Wrapper. ⚠ Aufbewahrungsfrist '
  'für abgelehnte Anträge ist OFFEN (juristische Prüfung, s. Kopf der Migration und DEPLOYMENT.md); '
  'platform.run_lead_retention greift ausschliesslich auf platform.leads und fasst diese Tabelle '
  'nicht an.';

comment on column platform.partner_applications.email is
  'Die Adresse, unter der sich der Betrieb bewirbt — zugleich die Adresse des Kontos, das dabei '
  'entsteht bzw. schon besteht. BEWUSST OHNE UNIQUE (ebenso wie company): ein Constraint-Fehler wäre '
  'genau das Enumerationsleck, das diese Seite nicht haben darf — die Antwort „diese Adresse hat '
  'sich schon beworben" verriete die Existenz eines fremden Antrags. Mehrfachbewerbungen sind '
  'erlaubt und im Admin-Bereich als mehrere Zeilen sichtbar.';

comment on column platform.partner_applications.message is
  'PFLICHT-Freitext („Was macht Ihr Betrieb, warum möchten Sie Partner werden?"). Grundlage der '
  'Prüfung und jeder Rückfrage; ein leerer Antrag ist nicht prüfbar. Leerstring-CHECK, weil '''' '
  'NOT NULL erfüllt und trotzdem kein Text ist.';

comment on column platform.partner_applications.user_id is
  'Das Auth-Konto zur Bewerbung — bei der Bewerbung entstanden ODER bereits vorhanden. Darüber '
  'weiss B16-4, welches Konto freizuschalten ist. NULLABLE: on delete set null (ein gelöschtes Konto '
  'darf weder den Antrag mitreissen noch selbst unlöschbar werden), und ein Antrag entsteht auch '
  'dann, wenn die Kontoanlage scheitert — eine verlorene Bewerbung wiegt schwerer als eine fehlende '
  'Verknüpfung.';

comment on column platform.partner_applications.status is
  'pending → approved|rejected. ''approved'' ist in B16-3 unerreichbar: es gibt keinen Wrapper dafür '
  '(s. Kommentar am Enum-Typ). Abgelehnt wird über public.admin_reject_partner_application.';

comment on column platform.partner_applications.reviewed_by is
  'WER geprüft hat (auth.users). on delete set null wie platform.leads.anonymized_by (B1-3): der '
  'Vorgang bleibt belegt (reviewed_at), nur die Zuschreibung entfällt, wenn das Konto verschwindet.';

-- ── Indizes ──────────────────────────────────────────────────────────────────────────────────────
-- Die Liste zeigt „neueste zuerst", gefiltert oder ungefiltert; B16-4 sucht über das Konto. Drei
-- kleine Indizes für drei reale Abfragen — der Bestand ist klein, aber ein fehlender Index auf einer
-- FK-Spalte macht ausgerechnet das Löschen eines Kontos zum Seq-Scan.
create index partner_applications_created_at_idx
  on platform.partner_applications (created_at desc);
create index partner_applications_status_created_at_idx
  on platform.partner_applications (status, created_at desc);
create index partner_applications_user_id_idx
  on platform.partner_applications (user_id)
  where user_id is not null;

-- ── RLS + Rechte ─────────────────────────────────────────────────────────────────────────────────
-- RLS an, KEINE Policy, für KEINE Rolle irgendein Tabellenrecht — Muster `platform.job_runs` (B4-1)
-- und `platform.admin_exports` (B2-1). Gelesen und geschrieben wird ausschliesslich über die vier
-- SECURITY-DEFINER-Wrapper unten. Insbesondere gibt es KEIN delete-Grant: eine Bewerbung ist eine
-- Geschäftsunterlage, und ihre Löschfrist ist offen (s. Kopf).
alter table platform.partner_applications enable row level security;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — public.submit_partner_application: der öffentliche Schreibweg
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── DIE VERKNÜPFUNG MIT DEM KONTO ENTSTEHT HIER, NICHT IM ANWENDUNGSCODE ────────────────────────
-- Das ist die eigentliche Entscheidung dieses Wrappers. Der Anwendungscode kann die Frage „gibt es
-- zu dieser Adresse schon ein Konto?" gar nicht sauber beantworten: GoTrue antwortet auf einen
-- `signUp` mit einer bereits registrierten Adresse mit HTTP 422 `user_already_exists` (gemessen
-- gegen den lokalen Stack, nicht aus der Doku übernommen) — eine Antwort, die die Existenz VERRÄT
-- und die der Anwendungscode deshalb verschluckt, ohne sie auszuwerten.
--
-- Die Auflösung gehört damit hierher, wo sie nach aussen unsichtbar bleibt: Die Rückgabe sagt
-- ausschliesslich, DASS ein Antrag entstanden ist — nie, ob ein Konto gefunden, angelegt oder
-- verknüpft wurde. Ein Aufrufer, der es nicht erfährt, kann es auch nicht weitergeben.
--
-- ── DREI FÄLLE, EINE ANTWORT ───────────────────────────────────────────────────────────────────
--   p_user_id gesetzt (der Bewerber war bereits ANGEMELDET)  → dieses Konto, ohne Nachschlagen.
--   p_user_id null, GENAU EIN Konto zur Adresse              → dieses Konto.
--   p_user_id null, KEIN oder MEHRERE Konten zur Adresse     → user_id bleibt null.
--
-- Mehrfachtreffer werden NICHT auf den ersten aufgelöst: auth.users erzwingt keine globale
-- E-Mail-Eindeutigkeit (mehrere Identity-Provider), und ein Antrag, der später ein zufällig
-- ausgewähltes fremdes Konto freischaltet, ist der teuerste denkbare Fehler dieses Abschnitts.
-- Anders als `public.admin_grant_role_by_email` (T4-4) wird er aber nicht ABGEWIESEN, sondern
-- unverknüpft angenommen — dort steht eine bewusste Admin-Handlung auf dem Spiel, hier eine
-- Bewerbung, die nicht verlorengehen darf. B16-4 sieht die fehlende Verknüpfung und entscheidet.
--
-- ── KEINE PRÜFUNG GEGEN platform.email_suppressions ────────────────────────────────────────────
-- Bewusst: Die Sperrliste regelt AUSSENDUNGEN an Adressen, die keine mehr wollen (Rückläufer,
-- Beschwerde, Abmeldung — B2-2). Hier hat ein Mensch soeben ein Formular ausgefüllt und um Kontakt
-- gebeten; die Eingangsbestätigung ist transaktional und die Antwort auf genau diese Handlung. Eine
-- Bewerbung wegen eines alten Rückläufers stillschweigend zu verwerfen wäre zudem der Fall, den
-- dieser Abschnitt am wenigsten haben darf: ein Antrag, den niemand je sieht.
create function public.submit_partner_application(
  p_company text,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_message text,
  p_phone text default null,
  p_website text default null,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company    text := nullif(btrim(p_company), '');
  v_first_name text := nullif(btrim(p_first_name), '');
  v_last_name  text := nullif(btrim(p_last_name), '');
  v_email      text := lower(nullif(btrim(p_email), ''));
  v_message    text := nullif(btrim(p_message), '');
  v_phone      text := nullif(btrim(p_phone), '');
  v_website    text := nullif(btrim(p_website), '');
  v_user_id    uuid;
  v_matches    integer;
  v_id         uuid;
begin
  if v_company is null
     or v_first_name is null
     or v_last_name is null
     or v_email is null
     or v_message is null then
    return jsonb_build_object('status', 'missing_fields');
  end if;

  /*
   * Die laufende Sitzung schlägt die Adresse. Wer angemeldet ist, bewirbt sich mit SEINEM Konto —
   * auch dann, wenn er eine abweichende Kontaktadresse einträgt. Ein übergebenes, aber nicht (mehr)
   * existierendes Konto wird stillschweigend verworfen statt den Antrag zu verhindern.
   */
  if p_user_id is not null then
    select au.id into v_user_id from auth.users au where au.id = p_user_id;
  end if;

  if v_user_id is null then
    select count(*) into v_matches from auth.users au where lower(au.email) = v_email;
    if v_matches = 1 then
      select au.id into v_user_id from auth.users au where lower(au.email) = v_email;
    end if;
  end if;

  insert into platform.partner_applications
    (company, first_name, last_name, email, phone, website, message, user_id)
  values
    (v_company, v_first_name, v_last_name, v_email, v_phone, v_website, v_message, v_user_id)
  returning id into v_id;

  /*
   * Die Rückgabe trägt die Antrags-ID, weil die interne Benachrichtigungsmail auf die Detailansicht
   * verweisen soll — und SONST NICHTS. Insbesondere nicht, ob ein Konto verknüpft wurde: das ist
   * genau die Auskunft, die diese Seite niemandem geben darf.
   */
  return jsonb_build_object('status', 'created', 'application_id', v_id);
end;
$$;

comment on function public.submit_partner_application(text, text, text, text, text, text, text, uuid) is
  'B16-3: nimmt eine Partner-Bewerbung entgegen. Verknüpft sie mit dem Auth-Konto — der laufenden '
  'Sitzung (p_user_id), sonst dem GENAU EINEN Konto zur Adresse; bei keinem oder mehreren Treffern '
  'bleibt user_id null (auth.users erzwingt keine globale E-Mail-Eindeutigkeit, und ein zufällig '
  'gewähltes fremdes Konto freizuschalten wäre der teuerste Fehler dieses Abschnitts). Die '
  'Auflösung passiert HIER und nicht im Anwendungscode, damit sie nach aussen unsichtbar bleibt: '
  'die Rückgabe {status: created|missing_fields, application_id} sagt NIE, ob ein Konto gefunden '
  'oder angelegt wurde. Keine Prüfung gegen platform.email_suppressions (die regelt Aussendungen, '
  'nicht eine soeben erbetene Antwort). service_role-only — die Seite rendert und schreibt '
  'serverseitig; ein anon-Grant machte den Wrapper zu einem offenen Schreibzugang.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — Der Prüf-Eingang: drei Admin-Wrapper
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Alle drei: SECURITY DEFINER, ausschliesslich an `authenticated` gegrantet, und jeder prüft als
-- erste Anweisung `platform.is_admin()` und WIRFT sonst SQLSTATE 42501 — Muster `admin_list_leads`
-- (B1-1) und die vier Partner-Wrapper (B16-1). „Kein Zugriff" darf sich nie als „keine Anträge"
-- lesen lassen; ein leeres Ergebnis und eine Ablehnung sind verschiedene Dinge, und eine Exception
-- kann man nicht verwechseln.
--
-- Fachliche Zustände (Antrag nicht gefunden, bereits geprüft) bleiben Status.

-- ── admin_list_partner_applications ──────────────────────────────────────────────────────────────
-- Neueste zuerst, seitenweise, optional nach Status gefiltert. Der Filter ist ein TEXT und wird
-- gegen die Enum-Werte geprüft, statt den Enum-Typ als Parameter zu nehmen: ein unbekannter Wert
-- käme sonst als 22P02 („invalid input value for enum") aus PostgREST zurück, und die Oberfläche
-- könnte einen Tippfehler in der URL nicht von einem Ausfall unterscheiden. Ein abgelehnter Filter
-- wird als `invalid_filter` beantwortet statt still ignoriert — sonst hielte man ein ungefiltertes
-- Ergebnis für ein gefiltertes (dieselbe Regel wie in `admin_list_leads`, B1-3).
--
-- `total` ist die Zahl der TREFFER (nicht des Bestands), damit Seitenaufteilung und Trefferanzeige
-- dieselbe Menge meinen.
--
-- Der FREITEXT fährt bewusst schon in der Liste mit: Er ist der Grund, warum jemand einen Antrag
-- überhaupt öffnet, und die Liste ist kurz. Ihn erst im Detail zu zeigen hiesse, jede Bewerbung
-- einzeln anzuklicken, um zu erfahren, worum es geht.
create function public.admin_list_partner_applications(
  p_status text default null,
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
  v_status platform.partner_application_status;
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total  integer;
  v_rows   jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_list_partner_applications: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  if p_status is not null and btrim(p_status) <> '' then
    if btrim(lower(p_status)) not in ('pending', 'approved', 'rejected') then
      return jsonb_build_object('status', 'invalid_filter', 'field', 'status');
    end if;
    v_status := btrim(lower(p_status))::platform.partner_application_status;
  end if;

  select count(*)::integer into v_total
    from platform.partner_applications pa
   where v_status is null or pa.status = v_status;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb)
    into v_rows
  from (
    select pa.id,
           pa.company,
           pa.first_name,
           pa.last_name,
           pa.email,
           pa.phone,
           pa.website,
           pa.message,
           pa.status,
           pa.created_at,
           pa.reviewed_at,
           pa.user_id is not null as has_account
    from platform.partner_applications pa
    where v_status is null or pa.status = v_status
    order by pa.created_at desc
    limit v_limit offset v_offset
  ) r;

  return jsonb_build_object(
    'status', 'ok',
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'applications', v_rows
  );
end;
$$;

comment on function public.admin_list_partner_applications(text, integer, integer) is
  'B16-3: die Bewerbungsliste (neueste zuerst, seitenweise, optional nach Status gefiltert). Der '
  'Freitext fährt schon hier mit — er ist der Grund, warum jemand einen Antrag öffnet. total ist '
  'die Zahl der TREFFER, nicht des Bestands. Ein unbekannter Statusfilter wird als invalid_filter '
  'ABGEWIESEN statt still ignoriert (sonst hielte man ein ungefiltertes Ergebnis für gefiltert). '
  'WIRFT bei fehlender Adminrolle (42501). authenticated-only.';

-- ── admin_get_partner_application ────────────────────────────────────────────────────────────────
-- ALLE Felder inklusive Freitext, plus die Adresse des verknüpften Kontos und die des Prüfers.
-- Beim Genehmigen in B16-4 wird nichts davon erneut eingetippt.
--
-- Die KONTO-Adresse steht neben der Antrags-Adresse und wird nicht mit ihr verschmolzen: Wer
-- angemeldet einen Antrag stellt, kann eine abweichende Kontaktadresse angeben — und wer in B16-4
-- ein Konto freischaltet, muss sehen, WELCHES.
create function public.admin_get_partner_application(p_id uuid)
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
    raise exception 'public.admin_get_partner_application: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select to_jsonb(r) into v_row
  from (
    select pa.id,
           pa.company,
           pa.first_name,
           pa.last_name,
           pa.email,
           pa.phone,
           pa.website,
           pa.message,
           pa.status,
           pa.created_at,
           pa.reviewed_at,
           pa.user_id,
           (select au.email from auth.users au where au.id = pa.user_id) as account_email,
           (select au.email from auth.users au where au.id = pa.reviewed_by) as reviewed_by_email
    from platform.partner_applications pa
    where pa.id = p_id
  ) r;

  if v_row is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object('status', 'ok', 'application', v_row);
end;
$$;

comment on function public.admin_get_partner_application(uuid) is
  'B16-3: ein Antrag mit ALLEN Feldern inklusive Freitext, dazu die Adresse des verknüpften Kontos '
  '(account_email) und die des Prüfers. Die Konto-Adresse steht NEBEN der Antrags-Adresse und wird '
  'nicht mit ihr verschmolzen: wer angemeldet einen Antrag stellt, kann eine abweichende '
  'Kontaktadresse angeben, und wer in B16-4 ein Konto freischaltet, muss sehen welches. WIRFT bei '
  'fehlender Adminrolle (42501); ein unbekannter Antrag ist ein fachlicher Zustand. '
  'authenticated-only.';

-- ── admin_reject_partner_application ─────────────────────────────────────────────────────────────
-- DER EINZIGE SCHREIBWEG DES PRÜF-EINGANGS — und er kann nur ABLEHNEN.
--
-- Der Zielstatus ist ein LITERAL, kein Parameter. Ein `p_status`-Parameter wäre der Weg, auf dem
-- sich über dieselbe Funktion auch 'approved' setzen liesse — genau der Zustand, den B16-3 nicht
-- herstellen darf (ein genehmigter Antrag ohne Partner, ohne Slug, ohne Freischaltung). Die
-- Beschränkung steht damit in der SIGNATUR und nicht in der Disziplin des Aufrufers.
--
-- Bereits geprüfte Anträge werden mit `already_reviewed` abgewiesen, nicht erneut geschrieben: die
-- Prüfung ist eine einmalige Handlung, und ein zweiter Zeitstempel überschriebe, wann sie
-- tatsächlich stattfand.
create function public.admin_reject_partner_application(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current platform.partner_application_status;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_reject_partner_application: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select pa.status into v_current
    from platform.partner_applications pa
   where pa.id = p_id
   for update;

  if v_current is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_current <> 'pending' then
    return jsonb_build_object('status', 'already_reviewed', 'current', v_current);
  end if;

  update platform.partner_applications pa
     set status      = 'rejected',
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where pa.id = p_id;

  return jsonb_build_object('status', 'ok');
end;
$$;

comment on function public.admin_reject_partner_application(uuid) is
  'B16-3: lehnt eine Bewerbung ab und hält Prüfer und Zeitpunkt fest. DER ZIELSTATUS IST EIN '
  'LITERAL, KEIN PARAMETER — es gibt in B16-3 keinen Weg, einen Antrag auf ''approved'' zu setzen, '
  'weil Genehmigen in B16-4 zusätzlich Partner, Slug und Freischaltung erzeugt; ein Status ohne '
  'diese drei wäre ein stiller Zustand, der wie Erfolg aussieht. Ein bereits geprüfter Antrag wird '
  'mit already_reviewed abgewiesen (ein zweiter Zeitstempel überschriebe, wann die Prüfung '
  'stattfand). Rückgabe {status: ok|not_found|already_reviewed, current}. WIRFT bei fehlender '
  'Adminrolle (42501). authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 5 — Rechte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Supabase vergibt per ALTER DEFAULT PRIVILEGES auf NEUE public-Funktionen automatisch EXECUTE an
-- anon, authenticated UND service_role (zusätzlich zum PostgreSQL-Default-Grant an PUBLIC). Deshalb
-- wie überall: erst allen entziehen, dann gezielt gewähren.
--
-- submit_partner_application: NUR service_role. Die Bewerbungsseite rendert und schreibt
-- serverseitig (Muster `lib/leads/store.ts`); ein `anon`-Grant brächte keinen Aufruf, den es sonst
-- nicht gäbe, wohl aber einen von aussen erreichbaren Schreibzugang auf eine Tabelle, die niemand
-- löschen kann. `anon` hat in `platform` bis heute nirgends ein Recht — das bleibt so.
revoke all on function public.submit_partner_application(text, text, text, text, text, text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_partner_application(text, text, text, text, text, text, text, uuid)
  to service_role;

-- Die drei Admin-Wrapper: NUR authenticated. `service_role` bekommt bewusst KEIN Grant — sie leiten
-- ihre Autorisierung aus `auth.uid()` ab, das dort NULL ist; sie wären funktionslos und stets
-- abgelehnt (B2-1/B16-1).
revoke all on function public.admin_list_partner_applications(text, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_get_partner_application(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_reject_partner_application(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_list_partner_applications(text, integer, integer) to authenticated;
grant execute on function public.admin_get_partner_application(uuid) to authenticated;
grant execute on function public.admin_reject_partner_application(uuid) to authenticated;
