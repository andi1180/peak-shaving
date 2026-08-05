-- B19-Nachbesserung — formlos genannte Firmen: eine eigene Ablage, GETRENNT von platform.partners.
--
-- ⚠ MASSGEBLICH FÜR DEN STAND DER B19-REIHE IST DER HANDOVER IN `apps/web/CLAUDE.md`
-- (`Fahrplan_2026.md` führt B0–B17 und kennt B19 nicht — hier steht deshalb kein Verweis dorthin).
--
-- ── DER ANLASS: EIN FREITEXTFELD, DAS NIEMANDEN WIEDERFINDBAR MACHTE ────────────────────────────
-- Das Aufnahmeformular der Telefonanfrage (B19) hatte zwei Felder für „wer hat empfohlen": den
-- Freitext „Empfohlen durch" (`platform.leads.referred_by_text`) und die Zuordnung zu einem echten
-- Fachbetrieb (`platform.leads.partner_slug`). In der Praxis nennt der Anrufer meist einen Betrieb,
-- den es in `platform.partners` gar nicht gibt. Der Freitext nahm ihn auf — und beim NÄCHSTEN Anruf
-- musste dieselbe Firma erneut abgetippt werden, in wieder anderer Schreibweise. Aus „Elektro
-- Huber", „E. Huber GmbH" und „huber elektro" liess sich hinterher nicht mehr sagen, wie oft dieser
-- Betrieb jemanden geschickt hat. Das Feld sammelte Text, nicht Wissen.
--
-- ── DIE ENTSCHEIDUNG: EINE ZWEITE ABLAGE, UND AUSDRÜCKLICH NICHT platform.partners ──────────────
-- Der naheliegende Griff wäre gewesen, einen formlos genannten Betrieb einfach als Partnerzeile
-- anzulegen — meinetwegen mit `is_active = false`. Er ist ausgeschlossen, und der Grund ist keine
-- Ordnungsliebe, sondern eine WIRKUNG:
--
--   `platform.leads.partner_slug` ist seit B18-6 der Schlüssel, über den `public.get_my_partner_leads`
--   einem angemeldeten Fachbetrieb SEINE Anfragen zeigt — mit Namen, sobald die Freigabe-Einwilligung
--   vorliegt. Diese Spalte ist damit keine Notiz, sondern ein ZUGRIFFSRECHT. Wer sie setzt, entscheidet
--   darüber, wer fremde Kundenkontakte zu sehen bekommt und wer später ein Montageprojekt zugeteilt
--   bekommt.
--
-- Ein Name, den jemand am Telefon hört und eintippt, hat nichts davon durchlaufen: keine Bewerbung
-- (B16-3), keine Prüfung, keine Genehmigung (B16-4a), kein verknüpftes Konto (B16-4b). Ihn in
-- `platform.partners` zu schreiben, hiesse, eine Partnerschaft durch Zuhören entstehen zu lassen.
-- Und `is_active = false` wäre keine Absicherung, sondern eine Zeitbombe: Der Slug wäre unwiderruflich
-- vergeben (B16-1: `guard_partner_slug`, kein `delete`-Grant für irgendeine Rolle), die Zeile stünde
-- in jeder Partnerliste, und ein späterer Klick auf „aktivieren" schaltete rückwirkend den Zugriff
-- auf alle so zugeordneten Leads frei — ohne dass irgendjemand das entschieden hätte.
--
-- Deshalb: eine EIGENE Tabelle mit einer EIGENEN Spalte am Lead. Die beiden Wege berühren sich
-- nirgends. `platform.partners` wird von dieser Migration weder erweitert noch beschrieben.
--
-- ── WARUM „mentioned_businesses" UND NICHT „prospective_partners" O. Ä. ─────────────────────────
-- Der Name beschreibt, was die Zeile IST: ein Betrieb, der genannt wurde. Jeder Name aus dem
-- Wortfeld „Partner" („prospective_partners", „partner_candidates", „unverified_partners")
-- behauptete eine Vorstufe zu einer Partnerschaft und lüde genau die Bewegung ein, die dieser
-- Abschnitt ausschliesst — nämlich, die Zeile eines Tages „hochzustufen". Es gibt hier keinen
-- Freischalt-, Genehmigungs- oder Einladungsweg, und es soll keiner entstehen. Wird aus einem
-- genannten Betrieb später ein echter Fachbetrieb, läuft das über den bestehenden Antragsweg
-- (B16-3/B16-4a) und beginnt bei null — diese Zeile bleibt, was sie war: eine Notiz.
--
-- ── WAS HIER ENTSTEHT ───────────────────────────────────────────────────────────────────────────
--   TEIL 1  die Tabelle `platform.mentioned_businesses`
--   TEIL 2  die neue Spalte `platform.leads.mentioned_business_id`
--   TEIL 3  `public.admin_list_mentioned_businesses`   — die Auswahlliste
--   TEIL 4  `public.admin_attach_mentioned_business`   — anlegen-oder-finden UND zuordnen, EIN Aufruf
--   TEIL 5  `public.admin_get_lead` nachgezogen        — sonst wäre die Zuordnung nirgends lesbar
--   TEIL 6  Rechte
--
-- ── WAS AUSDRÜCKLICH NICHT ENTSTEHT ─────────────────────────────────────────────────────────────
-- Keine Änderung an `public.capture_lead` (der Wrapper ist der ANONYME Erfassungspfad; eine formlos
-- genannte Firma entsteht ausschliesslich durch eine angemeldete Person und hat dort nichts zu
-- suchen), an `platform.leads.referred_by_text` (die Spalte und der öffentliche Weg dahin bleiben
-- unverändert — nur das interne Aufnahmeformular schreibt sie nicht mehr), an
-- `public.get_my_partner_leads`/`public.get_my_partner` (die neue Spalte ist ihnen unbekannt und
-- soll es bleiben), an `platform.partners` samt allen Partner-Wrappern, an
-- `platform.anonymize_lead`/`platform.guard_anonymized_lead` (s. TEIL 2), an
-- `public.admin_list_leads`/`public.admin_export_leads`/`platform.leads_matching` (s. TEIL 5) und an
-- `public.admin_update_lead`. Kein `is_active`, kein Slug, kein Konto, kein `tenant_id`, kein neuer
-- `consent_purpose`, keine Aufbewahrungs-/Löschmechanik über die des Leads hinaus.
--
-- ── KONVENTIONEN (exakt T4-1/B1-1/B2-1/B14-1/B16-1/B16-3/B18-4) ─────────────────────────────────
-- Alles Fachliche in `platform` (nicht über die REST-API exponiert, `supabase/config.toml`), Zugriff
-- von aussen ausschliesslich über SECURITY-DEFINER-Wrapper im `public`-Schema, alle Funktionen mit
-- `SET search_path = ''` und vollqualifizierten Objektnamen, erst `revoke all … from public, anon,
-- authenticated, service_role`, dann gezielt grants. `anon` bekommt NIRGENDS etwas.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — platform.mentioned_businesses: die Notiz
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── WARUM EINE uuid UND KEIN SLUG ───────────────────────────────────────────────────────────────
-- Genau umgekehrt zu `platform.partners` (B16-1), wo der Slug der Primärschlüssel IST, weil er in
-- Links wandert und unwiderruflich ist. Hier wandert nichts: Die Kennung steht in einem
-- `<option>`-Wert eines internen Formulars und sonst nirgends. Ein Slug brächte einen Format-CHECK,
-- eine Namensdisziplin und die Frage, was bei einem Tippfehler passiert — Eigenschaften einer
-- öffentlichen Kennung, für eine Gesprächsnotiz.
--
-- ── WARUM `created_by` NULLABLE IST UND `on delete set null` TRÄGT ──────────────────────────────
-- Wer eine Firma erfasst hat, ist eine Angabe über die Notiz, kein Zugriffsrecht. Wird das Konto
-- dieser Person gelöscht, muss die Löschung durchlaufen — die Notiz überlebt ohne Urheber, wie
-- `platform.leads.last_edited_by` (B2-1) und `platform.analyses.created_by` (B14-1).
--
-- ⚠ DIESE TABELLE HAT BEWUSST KEINEN UNVERÄNDERLICHKEITS-TRIGGER, und das ist der Grund, warum sie
-- der wiederkehrenden Falle dieses Repos entgeht: `ON DELETE SET NULL` ist SELBST EIN UPDATE, und
-- jeder Append-only-Trigger auf einer Tabelle mit einem solchen Fremdschlüssel braucht die
-- asymmetrische Ausnahme „Nullen erlaubt, Setzen und Umhängen gesperrt" (fünfmal aufgeschlagen:
-- leads.last_edited_by B2-1, email_events.lead_id B2-2, analyses.lead_id/created_by B14-1,
-- partners.user_id B16-4a, partner_applications.user_id B16-3-Nachbesserung). Unveränderlichkeit
-- entsteht hier stattdessen aus dem FEHLEN JEDES WEGES: RLS an, keine Policy, für keine Rolle ein
-- Tabellenrecht, und unter den beiden Wrappern ist keiner, der eine bestehende Zeile ändert oder
-- löscht. WER SPÄTER EINEN SOLCHEN TRIGGER ERGÄNZT, MUSS DIE AUSNAHME FÜR `created_by` MITBAUEN —
-- sonst wird ein Konto unlöschbar, sobald es je eine Firma erfasst hat.
create table platform.mentioned_businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table platform.mentioned_businesses is
  'B19-Nachbesserung: formlos genannte Firmen — Betriebe, die ein Anrufer als Empfehlungsgeber '
  'nennt und die es in platform.partners NICHT gibt. Reine Ablage, KEIN Konto-Vorläufer: kein '
  'is_active, kein Slug, kein user_id, kein Freischalt- oder Genehmigungsweg. Bewusst getrennt von '
  'platform.partners, weil platform.leads.partner_slug seit B18-6 ein ZUGRIFFSRECHT ist '
  '(public.get_my_partner_leads) und nicht durch Zuhören entstehen darf. RLS an, keine Policy, für '
  'KEINE Rolle irgendein Tabellenrecht; Zugriff ausschliesslich über public.admin_list_mentioned_businesses '
  'und public.admin_attach_mentioned_business (beide authenticated-only).';

comment on column platform.mentioned_businesses.name is
  'Der Firmenname, wie ihn die aufnehmende Person verstanden hat. BEOBACHTUNG, kein geprüfter '
  'Firmenwortlaut — deshalb keine Rechtsform-, Format- oder Dublettenprüfung über die '
  'Schreibweisen-Vereinheitlichung hinaus.';

comment on column platform.mentioned_businesses.created_by is
  'Das Konto, das diese Firma erfasst hat — nullable und ON DELETE SET NULL: eine Angabe über die '
  'Notiz, kein Zugriffsrecht; das Löschen eines Kontos darf daran nicht scheitern.';

-- ── EINE FIRMA, EINE ZEILE — case- und randraum-unabhängig ───────────────────────────────────────
-- Der ganze Zweck dieses Abschnitts ist, dass beim NÄCHSTEN Anruf derselbe Betrieb wiedergefunden
-- wird, statt erneut getippt zu werden. Ohne diese Bedingung stünden „Elektro Huber" und „elektro
-- huber " als zwei Einträge in derselben Auswahlliste, und die Liste selbst wäre der Grund, warum
-- niemand mehr auswählt. Der Wrapper in TEIL 4 sucht mit genau diesem Ausdruck, bevor er anlegt; der
-- Index ist die Absicherung dagegen, dass zwei gleichzeitige Aufnahmen daran vorbeilaufen.
--
-- Sie ist AUSDRÜCKLICH keine Aussage darüber, dass zwei gleichnamige Betriebe derselbe sind (zwei
-- „Elektro Huber" in zwei Orten sind zwei Firmen). Für eine Notiz ohne Adresse ist der Name das
-- einzige Merkmal, das es gibt — und eine Auswahlliste mit fünf identischen Einträgen wäre der
-- teurere Fehler als eine gelegentliche Zusammenlegung, die ein Mensch beim Lesen bemerkt.
create unique index mentioned_businesses_name_key
  on platform.mentioned_businesses (lower(btrim(name)));

-- RLS an, KEINE Policy, für KEINE Rolle irgendein Tabellenrecht — Muster platform.job_runs (B4-1),
-- platform.admin_exports (B2-1) und platform.partner_applications (B16-3). Insbesondere KEIN
-- delete-Grant: platform.leads.mentioned_business_id verweist mit `on delete restrict` hierher, und
-- eine Notiz, an der Leads hängen, soll sich nicht still entfernen lassen.
alter table platform.mentioned_businesses enable row level security;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — platform.leads.mentioned_business_id: die eigene Spalte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── ⚠ WARUM NICHT `partner_slug` MITBENUTZT WIRD ────────────────────────────────────────────────
-- Weil diese Spalte etwas anderes BEWIRKT. `partner_slug` öffnet über public.get_my_partner_leads
-- den Blick eines Fachbetriebs auf die Anfrage; `mentioned_business_id` bewirkt nichts ausser
-- Wiederfindbarkeit. Zwei verschiedene Wirkungen in eine Spalte zu legen, hiesse, die stärkere
-- versehentlich zu vergeben. Es ist dieselbe Trennlinie wie zwischen `partner_slug` und
-- `referred_by_text` (B16-1: Urteil gegen Beobachtung) — nur eine Ebene weiter: hier wird die
-- Beobachtung strukturiert, ohne dadurch zum Urteil zu werden.
--
-- ── DIE BEIDEN SPALTEN SCHLIESSEN EINANDER NICHT AUS ────────────────────────────────────────────
-- Es gibt bewusst KEINEN CHECK „höchstens eines von beiden". Ein Lead kann über den Link von
-- Fachbetrieb A hereingekommen sein (`partner_slug`) und beim Rückruf zusätzlich Betrieb B genannt
-- haben (`mentioned_business_id`); beides ist wahr, und ein Constraint zwänge die aufnehmende Person,
-- eine der beiden Wahrheiten zu verwerfen. Dass das Aufnahmeformular nur EINE Auswahl anbietet, ist
-- eine Eigenschaft dieses Formulars und keine der Daten.
--
-- ── `on delete restrict` WIE BEI partner_slug, UND AUS DEMSELBEN GRUND ──────────────────────────
-- `on delete set null` ist ausgeschlossen: Es löschte genau die Aussage, die aufbewahrt werden soll,
-- und handelte sich die oben beschriebene UPDATE-Asymmetrie ein. Ein `delete` gibt es ohnehin für
-- keine Rolle — die Klausel schreibt die Entscheidung trotzdem hin, statt sie aus einer fehlenden
-- Zeile erschliessen zu lassen.
--
-- ── ⚠ ANONYMISIERUNG: DIE SPALTE ÜBERLEBT, WIE partner_slug ─────────────────────────────────────
-- `platform.anonymize_lead` und `platform.guard_anonymized_lead` bleiben in dieser Migration
-- UNVERÄNDERT, und das ist eine Entscheidung, keine Auslassung. Die Spalte trägt einen Verweis auf
-- einen BETRIEB, keinen Freitext einer Person: „dieser (anonymisierte) Kontakt wurde von Betrieb X
-- geschickt" ist ohne E-Mail, Name und PLZ keine personenbezogene Angabe mehr — dieselbe Begründung,
-- mit der B16-1 `partner_slug` aus dem Guard heraushält, und derselbe Zweck (die Frage „wer schickt
-- uns Kunden?" muss die 24-Monats-Frist überdauern, sonst verschwindet sie ausgerechnet für die
-- ältesten Empfehlungen). `referred_by_text` wird weiterhin GENULLT und ist das Gegenbeispiel: dort
-- steht der Satz eines Menschen, der den Namen eines Dritten enthalten kann.
--
-- Dass die Spalte nicht im Guard steht, ist trotzdem kein offener Schreibweg: der einzige Wrapper,
-- der sie setzt, weist einen anonymisierten Lead ab, bevor er irgendetwas schreibt (TEIL 4).
alter table platform.leads
  add column mentioned_business_id uuid
    references platform.mentioned_businesses (id) on delete restrict;

comment on column platform.leads.mentioned_business_id is
  'B19-Nachbesserung: die FORMLOSE Firmenerwähnung (FK auf platform.mentioned_businesses), nullable. '
  'Strukturierte Beobachtung — sie bewirkt NICHTS ausser Wiederfindbarkeit und ist ausdrücklich '
  'NICHT platform.leads.partner_slug: jene Spalte ist seit B18-6 ein Zugriffsrecht '
  '(public.get_my_partner_leads sieht diese hier nicht und soll sie nie sehen). Beide Spalten stehen '
  'unabhängig nebeneinander, es gibt bewusst keinen CHECK gegen die gleichzeitige Belegung. '
  'ÜBERLEBT die Anonymisierung und steht deshalb NICHT in guard_anonymized_lead — dieselbe '
  'Begründung wie bei partner_slug.';

-- Partiell wie leads_partner_slug_idx (B16-1): der ganz überwiegende Teil des Bestands trägt keine
-- Erwähnung. Trägt die Rückwärtsfrage „hängen an dieser Notiz Leads?" (on delete restrict) und eine
-- spätere Auswertung je Betrieb; ausdrücklich OHNE `anonymized_at is null`, weil eine Zählung, die
-- nach 24 Monaten schrumpft, genau den Zweck verfehlte.
create index leads_mentioned_business_idx on platform.leads (mentioned_business_id)
  where mentioned_business_id is not null;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — public.admin_list_mentioned_businesses: die Auswahlliste
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Ohne Parameter, ohne Seitenweise: Die Liste füllt ein `<select>` in einem Formular, das während
-- eines Telefonats bedient wird — eine Auswahl, die man durchblättern muss, ist keine. Sollte der
-- Bestand je so wachsen, dass das nicht mehr trägt, ist das eine sichtbare Änderung mit eigener
-- Begründung und keine, die heute vorweggenommen wird.
--
-- `lead_count` fährt mit, weil es die einzige Zahl ist, die aus dieser Ablage überhaupt etwas macht:
-- Sie beantwortet „wie oft hat dieser Betrieb schon jemanden geschickt?" — die Frage, wegen der die
-- Firmen überhaupt strukturiert erfasst werden. Anonymisierte Leads zählen MIT (s. TEIL 2).
create function public.admin_list_mentioned_businesses()
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
    raise exception 'public.admin_list_mentioned_businesses: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(b) order by lower(btrim(b.name))), '[]'::jsonb)
    into v_rows
  from (
    select mb.id,
           mb.name,
           mb.created_at,
           (select count(*)::int
              from platform.leads l
             where l.mentioned_business_id = mb.id) as lead_count
    from platform.mentioned_businesses mb
  ) b;

  return jsonb_build_object('status', 'ok', 'businesses', v_rows);
end;
$$;

comment on function public.admin_list_mentioned_businesses() is
  'B19-Nachbesserung: alle formlos erfassten Firmen (id, name, created_at, lead_count), alphabetisch. '
  'Füllt das Auswahlfeld der Lead-Aufnahme; keine Seitenweise, keine Filter. lead_count zählt '
  'anonymisierte Leads MIT. WIRFT bei fehlender Adminrolle (42501). authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — public.admin_attach_mentioned_business: anlegen-oder-finden UND zuordnen, EIN Aufruf
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── WARUM EIN WRAPPER UND NICHT ZWEI ────────────────────────────────────────────────────────────
-- Die Aufgabenstellung verlangt, dass das Eintragen einer neuen Firma und ihre Zuordnung zum Lead
-- EIN Vorgang sind. Zwei Wrapper (erst anlegen, dann zuordnen) machten daraus zwei Transaktionen mit
-- einem Zustand dazwischen, den es nicht geben soll: eine Firma in der Ablage, die zu keinem Lead
-- gehört, weil der zweite Aufruf scheiterte. Der Aufrufer übergibt deshalb ENTWEDER eine bestehende
-- Kennung ODER einen neuen Namen — und bekommt in beiden Fällen dieselbe Antwort.
--
-- ── WARUM authenticated UND NICHT service_role ──────────────────────────────────────────────────
-- `created_by = auth.uid()` — über service_role ist das null, und die Spalte wäre strukturell leer
-- (dieselbe Begründung wie bei public.admin_create_analysis, B14-1). Eine formlos erfasste Firma
-- entsteht durch einen Menschen, der sie verantwortet.
--
-- ── DIE ABLEHNUNGEN, UND WARUM SIE LAUT SIND ────────────────────────────────────────────────────
-- Eine unbekannte Kennung wird mit 22023 ABGEWIESEN und nicht still verworfen — dieselbe Regel, die
-- public.admin_update_lead für einen unbekannten partner_slug trifft (B16-1): eine still verworfene
-- Zuordnung sähe für die aufnehmende Person aus wie eine erfolgte. Aus demselben Grund ist „weder
-- noch" und „beides" ein Fehler und kein stillschweigend gewählter Vorrang.
create function public.admin_attach_mentioned_business(
  p_lead_id uuid,
  p_business_id uuid default null,
  p_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name          text := nullif(btrim(coalesce(p_name, '')), '');
  v_existing_name text;
  v_business_id   uuid;
  v_created       boolean := false;
  v_anonymized_at timestamptz;
  v_found         boolean;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_attach_mentioned_business: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  -- Genau eines von beidem. Beides gesetzt hiesse, dass der Aufrufer selbst nicht weiss, was er
  -- will; keines von beidem, dass er nichts zuzuordnen hat und den Aufruf hätte lassen sollen.
  if (p_business_id is null) = (v_name is null) then
    raise exception
      'public.admin_attach_mentioned_business: genau EINES von p_business_id und p_name angeben — '
      'entweder eine bestehende Firma auswählen oder eine neue eintragen'
      using errcode = '22023';
  end if;

  if p_lead_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Zeilensperre wie in platform.anonymize_lead: zwischen Prüfung und Schreiben soll der Lead nicht
  -- von einem parallelen Lauf anonymisiert werden können.
  select l.anonymized_at, true
    into v_anonymized_at, v_found
  from platform.leads l
  where l.id = p_lead_id
  for update;

  if not coalesce(v_found, false) then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Fachlicher Zustand, kein Autorisierungsfehler — dieselbe Antwortform wie admin_update_lead.
  -- Die Spalte steht bewusst nicht im Guard (TEIL 2); DIESE Prüfung ist der Grund, warum sie
  -- trotzdem nicht nachträglich beschrieben werden kann.
  if v_anonymized_at is not null then
    return jsonb_build_object('status', 'anonymized');
  end if;

  if p_business_id is not null then
    select mb.id, mb.name into v_business_id, v_name
    from platform.mentioned_businesses mb
    where mb.id = p_business_id;

    if v_business_id is null then
      raise exception
        'public.admin_attach_mentioned_business: unbekannte Firma % — eine still verworfene '
        'Zuordnung sähe aus wie eine erfolgte', p_business_id
        using errcode = '22023';
    end if;
  else
    -- ANLEGEN-ODER-FINDEN. Erst suchen (der Normalfall beim zweiten Anruf), dann anlegen; das
    -- `on conflict do nothing` samt Nachschlag fängt den seltenen Fall zweier gleichzeitiger
    -- Aufnahmen derselben Firma ab, ohne dass einer von beiden mit 23505 abbricht.
    --
    -- ⚠ BEIM TREFFER WIRD AUCH DER NAME ÜBERNOMMEN, nicht nur die Kennung. Zurück kommt damit die
    -- GESPEICHERTE Schreibweise statt der eingetippten — nur so ist in der Rückmeldung sichtbar,
    -- dass „elektro huber" auf den bestehenden Eintrag „Elektro Huber" gelaufen ist und kein
    -- zweiter entstanden ist. Mit der Eingabe zu antworten sähe aus wie eine Neuanlage.
    --
    -- ⚠ IN EINE EIGENE VARIABLE, NICHT DIREKT IN v_name: `select … into` setzt seine Ziele auf
    -- NULL, wenn nichts gefunden wird — der Name, mit dem gleich angelegt werden soll, wäre danach
    -- weg (und der Insert bräche am NOT NULL).
    select mb.id, mb.name into v_business_id, v_existing_name
    from platform.mentioned_businesses mb
    where lower(btrim(mb.name)) = lower(v_name);

    if v_business_id is null then
      insert into platform.mentioned_businesses (name, created_by)
      values (v_name, auth.uid())
      on conflict (lower(btrim(name))) do nothing
      returning id into v_business_id;

      if v_business_id is null then
        select mb.id, mb.name into v_business_id, v_existing_name
        from platform.mentioned_businesses mb
        where lower(btrim(mb.name)) = lower(v_name);
        v_name := coalesce(v_existing_name, v_name);
      else
        v_created := true;
      end if;
    else
      v_name := v_existing_name;
    end if;
  end if;

  -- last_edited_by wird BEWUSST NICHT gesetzt. Die Erwähnung entsteht beim Anlegen des Leads und
  -- ist keine nachträgliche Korrektur seiner Stammdaten; „zuletzt bearbeitet von" auf einem gerade
  -- erst angelegten Lead wäre eine Angabe, die den Blick auf die Detailseite verstellt statt ihn
  -- zu schärfen. Kommt später ein echter Korrekturweg für dieses Feld, gehört es dort dazu.
  update platform.leads l
     set mentioned_business_id = v_business_id
   where l.id = p_lead_id;

  return jsonb_build_object(
    'status', 'ok', 'business_id', v_business_id, 'name', v_name, 'created', v_created
  );
end;
$$;

comment on function public.admin_attach_mentioned_business(uuid, uuid, text) is
  'B19-Nachbesserung: ordnet einem Lead eine formlos genannte Firma zu — ENTWEDER eine bestehende '
  '(p_business_id) ODER eine neue (p_name), die dabei in derselben Transaktion entsteht; genau eines '
  'von beidem, sonst 22023. Ein bereits vorhandener Name wird case- und randraum-unabhängig '
  'WIEDERVERWENDET statt doppelt angelegt (das ist der Zweck der Ablage). Setzt '
  'platform.leads.mentioned_business_id und NIEMALS platform.leads.partner_slug — die formlose '
  'Erwähnung darf kein Zugriffsrecht nach B18-6 erzeugen. Legt NIE eine Zeile in platform.partners '
  'an. created_by = auth.uid(); setzt last_edited_by bewusst nicht. Rückgabe '
  '{status: ok|not_found|anonymized, business_id, name, created}. WIRFT bei fehlender Adminrolle '
  '(42501) und bei unbekannter Firmenkennung (22023). authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 5 — public.admin_get_lead nachgezogen
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── WARUM DIESE EINE LESESTELLE ERWEITERT WIRD ──────────────────────────────────────────────────
-- Ohne sie wäre die neue Spalte schreibbar und nirgends lesbar: eine Angabe, die beim Telefonat
-- erhoben wird und danach für jeden Menschen unsichtbar ist. Genau das ist die Requisite, die dieses
-- Projekt an anderer Stelle ausdrücklich vermeidet (B19: keine Felder ohne Speicherort) — hier wäre
-- es ein Speicherort ohne Sicht. Der Name fährt gleich mit, damit die Detailansicht keinen zweiten
-- Aufruf braucht, um statt einer uuid einen Firmennamen zu zeigen (dasselbe Argument wie bei
-- partner_display_name, B16-1).
--
-- ── WARUM admin_list_leads, admin_export_leads UND leads_matching UNBERÜHRT BLEIBEN ─────────────
-- Sie sind die Auswertungs- und Ausfuhrfläche. Die formlose Erwähnung ist ausdrücklich KEINE
-- Auswertungsdimension (dafür gibt es partner_slug samt Filter, B18-1), und eine zusätzliche Spalte
-- im Export änderte ein Dateiformat, auf das ausserhalb dieses Repos jemand baut. Wird die Frage
-- „welche genannten Betriebe schicken uns Kunden?" einmal zur Auswertung, ist das ein eigener
-- Schritt mit eigener Begründung — die Zahl dafür liefert bereits admin_list_mentioned_businesses.
--
-- `create or replace` bei UNVERÄNDERTER Signatur — die Grants bleiben.
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
  'B1-1, erweitert in B1-3, B3-1, B4-1, B4-2, B2-1, B2-2, B16-1 und der B19-Nachbesserung: ein Lead '
  'samt allen Einwilligungen (inkl. angezeigtem Textkörper, Version/Sprache und effective_status), '
  'den sechs Segmentierungsmerkmalen, der Urheberschaft einer Anonymisierung, dem Versandprotokoll '
  'der Vertragsablauf-Erinnerung, last_edited_by samt Konto-E-Mail, dem GRUND einer Sperre '
  '(suppression_reason), der Partner-Attribution (partner_slug, partner_display_name, '
  'partner_is_active, referred_by_text) und seit der B19-Nachbesserung der formlosen '
  'Firmenerwähnung (mentioned_business_id samt mentioned_business_name — eine Beobachtung ohne '
  'Zugriffswirkung, ausdrücklich nicht dasselbe wie partner_slug). Der Kontaktname kommt seit der '
  'Auftrennung als first_name und last_name. token_hash/token_expires_at fahren bewusst nicht mit. '
  'WIRFT bei fehlender Adminrolle (42501); ein unbekannter Lead ist ein fachlicher Zustand. '
  'authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 6 — Rechte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Supabase vergibt per ALTER DEFAULT PRIVILEGES auf NEUE public-Funktionen automatisch EXECUTE an
-- anon, authenticated UND service_role (zusätzlich zum PostgreSQL-Default-Grant an PUBLIC). Deshalb
-- wie überall: erst allen entziehen, dann gezielt gewähren.
--
-- Beide Wrapper: NUR authenticated. `service_role` bekommt bewusst KEIN Grant — sie leiten ihre
-- Autorisierung aus platform.is_admin()/auth.uid() ab, das dort null ist; sie wären funktionslos und
-- stets abgelehnt (B2-1/B16-1/B14-1). `anon` hat in `platform` bis heute nirgends ein Recht.
revoke all on function public.admin_list_mentioned_businesses()
  from public, anon, authenticated, service_role;
revoke all on function public.admin_attach_mentioned_business(uuid, uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_list_mentioned_businesses() to authenticated;
grant execute on function public.admin_attach_mentioned_business(uuid, uuid, text) to authenticated;
