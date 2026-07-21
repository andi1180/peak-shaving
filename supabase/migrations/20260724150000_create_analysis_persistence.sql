-- B14-1: Analyse-Persistenz — Auslegung und Prognose-Baseline serverseitig einfrieren
-- (Fahrplan_2026.md, Abschnitt B14: „HOCH PRIORISIERT, MUSS VOR DER ERSTEN PILOTANALYSE STEHEN").
--
-- Diese Migration legt die Ablage an. Der SCHREIBWEG aus dem Kalkulator heraus und die Admin-Ansicht
-- sind B14-2; der Kalkulator am Entitlement-System B10, die Tarifsätze als Konfigurationsschicht
-- B11, der Zeitreihen-Speicher B12, `tenant_id` B13. Hier entsteht ausschliesslich das Datenmodell
-- samt Zugriffspfad.
--
-- ── (a) DIE ENTSCHEIDUNG, DIE DIESE MIGRATION TRÄGT: EINFRIEREN ──────────────────────────────────
-- `result` und `inputs` werden NIE NACHGERECHNET. Die Engine wird sich ändern (der Rechenkern ist
-- seit M1 mehrfach korrigiert worden — zuletzt an der Kern-Kennzahl `billedKw`), und die Tarifsätze
-- ändern sich spätestens mit der Tarifverordnung (B11, plus die SNE-GV-Reform ab 1.1.2027, die
-- INNERHALB des Zehnjahreshorizonts jeder heute erzeugten Analyse liegt).
--
-- Eine 2027 neu berechnete Baseline wäre eine Prognose, die 2026 niemand abgegeben hat — und genau
-- diese Prognose IST das Alleinstellungsmerkmal des Wirkungsnachweises: nur COOLiN besitzt die
-- Auslegung, gegen die gemessen wird. Rechnete man sie nach, verglichen wir die Messung des Jahres
-- 2027 gegen eine Erwartung, die im Licht desselben Jahres entstanden ist. Das ist kein Nachweis,
-- sondern ein Zirkelschluss, und er wäre von aussen nicht zu erkennen.
--
-- Eine spätere, verbesserte Rechnung ist deshalb eine NEUE Analyse mit `supersedes_id`, nie eine
-- Änderung der bestehenden. Der Append-only-Trigger macht daraus keine Übereinkunft, sondern eine
-- Datenbank-Invariante — sie gilt auch für `service_role` und `postgres`.
--
-- ── (b) KEINE VERWEISE AUF VERÄNDERLICHE KONFIGURATION ──────────────────────────────────────────
-- Alle Tarifsätze, Batteriepreise und Annahmen liegen als WERTE in `inputs`, NIEMALS als
-- Fremdschlüssel auf eine Tarif- oder Katalogzeile. Ein solcher Verweis änderte die eingefrorene
-- Baseline STILL mit, sobald jemand die Konfiguration pflegt: die Zeile sähe unverändert aus, ihre
-- Bedeutung wäre eine andere. Der Schaden wäre erst 2027 sichtbar und dann nicht mehr behebbar —
-- die Werte von 2026 sind dann nirgends mehr rekonstruierbar.
--
-- Diese Regel gilt ausdrücklich AUCH FÜR B11, wenn die Tarifschicht konfigurierbar wird: die
-- Analyse kopiert die Sätze, sie verlinkt sie nicht. Dasselbe für den Batteriekatalog (OP#2) und für
-- jede künftige Annahmen-Verwaltung. Wer hier einen Fremdschlüssel ergänzt, hebt (a) auf.
--
-- ── (c) RECHTLICHER VERMERK — KEIN CODE, ABER BINDEND ───────────────────────────────────────────
-- Der archivierte Lastgang ist VERTRAGSDURCHFÜHRUNGSDATUM eines Geschäftskunden: er wurde
-- überlassen, damit genau diese eine Auslegung entsteht. Eine Verwendung für einen
-- BRANCHEN-BENCHMARK ist nach Fahrplan_2026.md (offene Entscheidung 6) ein EIGENER ZWECK — nicht
-- dieselbe Verarbeitung — und muss ab dem ERSTEN Fall in AGB und
-- Auftragsverarbeitungsvereinbarung abgedeckt sein.
--
-- B14 baut dafür bewusst KEIN Kennzeichen (`benchmark_opt_in` o. ä.) und KEINE Auswertung. Eine
-- vorhandene Schaltfläche lädt dazu ein, sie zu benutzen, bevor die Grundlage steht; und ein
-- Kennzeichen, das niemand gesetzt hat, sieht später aus wie eine Einwilligung, die niemand erteilt
-- hat. Derselbe Absatz steht in DEPLOYMENT.md.
--
-- ── KONVENTIONEN (T4-1, B1-1, B2-1, B2-2) ───────────────────────────────────────────────────────
-- Alles im `platform`-Schema (nicht über PostgREST exponiert), Zugriff ausschliesslich über
-- SECURITY-DEFINER-Wrapper in `public`, alle Funktionen `SET search_path = ''`, explizite Grants,
-- `anon` nirgends. KEIN `installer_id` (§4 des Kalkulator-Pflichtenhefts stammt aus der Zeit vor der
-- Plattform-Entscheidung und ist überholt), KEIN `tenant_id` (B13, additiv später).

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — platform.analyses: die eingefrorene Analyse
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
create table platform.analyses (
  id uuid primary key default gen_random_uuid(),

  -- Nullable und ON DELETE SET NULL, NICHT CASCADE: die Analyse überlebt den Lead. Begründung
  -- ausführlich weiter unten („Warum die Analyse nicht am Lead hängt").
  lead_id uuid null references platform.leads (id) on delete set null,

  -- Firma/Kunde, WIE ER IM BERICHT STEHT. Denormalisiert und nicht nur am Lead: siehe unten — der
  -- Lead wird nach 24 Monaten anonymisiert, die Analyse muss 7 Jahre lang zuordenbar bleiben.
  customer_label text not null,
  -- Ein Kunde kann mehrere Standorte haben, und die Auslegung gilt IMMER einem Standort (ein
  -- Lastgang ist der eines Zählpunkts). Ohne dieses Feld wären zwei Analysen desselben Kunden
  -- ununterscheidbar — und beim Wirkungsnachweis 2027 fiele auf, dass die gemessene Anlage nicht
  -- zur Baseline gehört, gegen die verglichen wird.
  site_label text null,

  -- 'betreut' = die bezahlte oder Pilot-Analyse für einen realen Kunden; 'intern' = ein eigener
  -- Probelauf. Die Unterscheidung entscheidet später, welche Baselines für einen Wirkungsnachweis
  -- überhaupt in Frage kommen: ein Probelauf mit synthetischen Daten sieht in `result` genauso aus
  -- wie eine echte Auslegung und wäre ohne dieses Merkmal nicht mehr auseinanderzuhalten.
  -- Der CHECK ist die EINE Definition der zulässigen Werte — die Wrapper prüfen sie nicht ein
  -- zweites Mal, sondern lassen ihn sprechen (zwei Definitionen driften auseinander).
  analysis_kind text not null,
  constraint analyses_kind_check check (analysis_kind in ('betreut', 'intern')),

  -- Eine korrigierte Analyse ERSETZT eine frühere, sie ändert sie nicht. Ohne ON DELETE: die
  -- referenzierte Zeile lässt sich ohnehin nicht löschen (Append-only-Trigger) — die
  -- Fremdschlüssel-Einschränkung ist die zweite, unabhängige Sperre gegen einen Kettenbruch.
  supersedes_id uuid null references platform.analyses (id),

  -- WOMIT gerechnet wurde. Beide Pflicht: eine Baseline ohne den Stand der Engine ist 2027 nicht
  -- mehr einzuordnen — man wüsste nicht, ob eine Abweichung von der Messung an der Anlage liegt
  -- oder an einer inzwischen korrigierten Rechnung. Der Commit ist dabei die belastbarere Angabe
  -- (eine Versionsnummer wird von Hand gepflegt und bleibt still stehen).
  engine_version text not null,
  engine_commit_sha text not null,
  -- Wann die RECHNUNG lief (aus dem Kalkulator), nicht wann sie gespeichert wurde (created_at).
  computed_at timestamptz not null,

  -- Sämtliche Eingangsgrössen der Rechnung: Tarifparameter, Abrechnungsmodell, Finanzparameter,
  -- Batteriekatalog-Stand, Annahmen aus dem editierbaren Panel. WERTE, keine Verweise — siehe (b).
  inputs jsonb not null,
  -- Der vollständige `AnalysisResult` aus dem Engine-Contract (§3.10 des Kalkulator-Pflichtenhefts),
  -- WORTGLEICH wie berechnet. Nicht normalisiert, nicht bereinigt, nicht nachgerechnet — siehe (a).
  result jsonb not null,

  -- ── Fünf typisierte Auszüge, ZUSÄTZLICH zum jsonb ──────────────────────────────────────────────
  -- Der Wirkungsnachweis 2027 vergleicht gemessene Werte gegen genau diese Grössen und muss danach
  -- FILTERN und RECHNEN können („alle betreuten Analysen mit einer prognostizierten Ersparnis über
  -- 2.000 €, gemessen gegen die tatsächliche").
  --
  -- Warum nicht per jsonb-Pfad aus `result`: eine jsonb-Pfadabfrage bricht STILL, sobald sich die
  -- Struktur des Ergebnisses ändert — `result -> 'current' ->> 'billedKw'` liefert dann `null` und
  -- die Auswertung rechnet mit Nullen weiter, ohne dass irgendwo ein Fehler erscheint. Eine
  -- typisierte Spalte bricht LAUT: sie ist `not null` und muss beim Schreiben gefüllt werden, also
  -- fällt eine Umbenennung im Contract sofort auf, nicht erst in einer Auswertung ein Jahr später.
  -- Die Redundanz ist Absicht; `result` bleibt die Wahrheit, die Spalten sind der Zugriffsweg.
  baseline_billed_kw_before numeric not null,
  baseline_billed_kw_after numeric not null,
  baseline_annual_saving_eur numeric not null,
  -- Nullable: eine Analyse kann ohne Empfehlung enden (kein Kandidat rechnet sich). Ein
  -- Ersatzwert wäre hier eine Behauptung.
  recommended_battery_label text null,
  recommended_capacity_kwh numeric null,

  -- ── Die archivierte Quelldatei ─────────────────────────────────────────────────────────────────
  source_file_name text not null,
  -- SHA-256 über die UNKOMPRIMIERTE Originaldatei, Kleinbuchstaben-Hex. Bewusst nicht über den
  -- Blob: gzip ist nicht bit-deterministisch (Implementierung, Version, Kompressionsstufe dürfen
  -- ein anderes, gleichwertiges Ergebnis liefern). Die Identität der Datei darf nicht von der
  -- Kompression abhängen — sonst liesse ein Wechsel des Laufzeit-Unterbaus jede alte Zeile
  -- „falsch" aussehen.
  source_file_sha256 text not null,
  constraint analyses_sha256_format_check check (source_file_sha256 ~ '^[0-9a-f]{64}$'),
  -- gzip und nicht roh: ein Jahres-Lastgang sind ~35.040 Zeilen (rund 600 kB Text), komprimiert
  -- ein Bruchteil davon. gzip ausdrücklich und nicht der TOAST-Kompression überlassen — der Blob
  -- soll 1:1 als `.gz`-Datei herausgegeben werden können, ohne von den Speicher-Interna der
  -- Datenbank abzuhängen.
  source_file_gzip bytea not null,

  -- ON DELETE SET NULL wie `admin_exports.exported_by` (B2-1): die Analyse überlebt das Konto, das
  -- sie angelegt hat. Genau diese referentielle Aktion ist der Grund für die Ausnahme im
  -- Append-only-Trigger — siehe dort.
  created_by uuid null references auth.users (id) on delete set null,
  -- clock_timestamp(), NICHT now(): `now()` ist die Transaktionszeit und in einer Transaktion
  -- konstant — zwei in derselben Transaktion angelegte Analysen (im DB-Gate der Normalfall) trügen
  -- denselben Zeitpunkt und wären nicht mehr ordenbar. Befund aus B4-1 (job_runs), seither auch in
  -- admin_exports (B2-1) und email_events (B2-2).
  created_at timestamptz not null default clock_timestamp()
);

comment on table platform.analyses is
  'B14-1: eingefrorene Auslegung samt Prognose-Baseline und archivierter Quelldatei. `inputs` und '
  '`result` werden NIE nachgerechnet — eine 2027 neu gerechnete Baseline wäre eine Prognose, die '
  '2026 niemand abgegeben hat, und genau diese Prognose ist das Alleinstellungsmerkmal des '
  'Wirkungsnachweises. Eine verbesserte Rechnung ist eine NEUE Zeile mit supersedes_id. '
  'UPDATE/DELETE sind per Trigger gesperrt (auch für service_role und postgres); die einzige '
  'Ausnahme ist das Nullen von lead_id/created_by durch ON DELETE SET NULL. Alle Tarifsätze, '
  'Preise und Annahmen stehen als WERTE in inputs, nie als Fremdschlüssel auf veränderliche '
  'Konfiguration — auch nicht ab B11.';

comment on column platform.analyses.lead_id is
  'Der Lead, aus dem die Analyse hervorging — sofern es einen gibt. ON DELETE SET NULL, NICHT '
  'CASCADE: eine bezahlte Analyse ist eine kaufmännische Leistung mit eigener Aufbewahrungspflicht '
  'und überlebt die Marketing-Frist des Leads. Verschwindet der Lead, entfällt die ZUSCHREIBUNG, '
  'nicht die Analyse (dieselbe Lesart wie email_events.lead_id, B2-2).';

comment on column platform.analyses.customer_label is
  'Firma/Kunde wie im Bericht. DENORMALISIERT und bewusst nicht nur am Lead: platform.leads wird '
  'nach 24 Monaten anonymisiert (B1/B4-1), die Analyse muss danach noch Jahre zuordenbar bleiben. '
  'Ein Join auf den Lead lieferte dann „anonymized+<id>@invalid" statt eines Kundennamens.';

comment on column platform.analyses.analysis_kind is
  'betreut = bezahlte oder Pilot-Analyse für einen realen Kunden; intern = eigener Probelauf. '
  'Entscheidet später, welche Baselines für einen Wirkungsnachweis überhaupt in Frage kommen — ein '
  'Probelauf mit synthetischen Daten sieht in result genauso aus wie eine echte Auslegung.';

comment on column platform.analyses.supersedes_id is
  'Die Analyse, die diese hier ERSETZT. Korrekturen entstehen als neue Zeile, nie als Änderung der '
  'alten: die ersetzte Baseline bleibt vollständig lesbar, samt dem Fehler, den sie enthielt.';

comment on column platform.analyses.inputs is
  'Sämtliche Eingangsgrössen der Rechnung als WERTE (Tarifparameter, Abrechnungsmodell, '
  'Finanzparameter, Batteriekatalog-Stand, Annahmen des editierbaren Panels). NIEMALS '
  'Fremdschlüssel auf eine Tarif- oder Katalogzeile: ein Verweis änderte die eingefrorene Baseline '
  'still mit, sobald jemand die Konfiguration pflegt.';

comment on column platform.analyses.result is
  'Der vollständige AnalysisResult aus dem Engine-Contract (§3.10), wortgleich wie berechnet. Nicht '
  'nachrechnen, nicht migrieren, nicht bereinigen — die Zeile ist der Beleg dafür, was 2026 '
  'prognostiziert wurde.';

comment on column platform.analyses.baseline_billed_kw_before is
  'Typisierter Auszug aus result.current.billedKw. Redundant zum jsonb und trotzdem richtig: eine '
  'jsonb-Pfadabfrage bricht still, sobald sich die Struktur ändert (liefert null, die Auswertung '
  'rechnet weiter); eine not-null-Spalte bricht laut, nämlich beim Schreiben.';

comment on column platform.analyses.source_file_sha256 is
  'SHA-256 der UNKOMPRIMIERTEN Originaldatei (Kleinbuchstaben-Hex). Nicht des Blobs: gzip ist nicht '
  'bit-deterministisch, die Identität der Datei darf nicht von der Kompression abhängen. Wird von '
  'public.admin_create_analysis gegen die übergebene Datei GEPRÜFT.';

comment on column platform.analyses.source_file_gzip is
  'Die archivierte Quelldatei, gzip-komprimiert (RFC 1952). Ausdrücklich gzip und nicht der '
  'TOAST-Kompression überlassen: der Blob soll 1:1 als .gz-Datei herausgegeben werden können. '
  'Wird ausschliesslich über public.admin_get_analysis_source geliefert, nie nebenbei.';

comment on column platform.analyses.created_at is
  'clock_timestamp() statt now(): zwei in derselben Transaktion angelegte Analysen wären mit der '
  'Transaktionszeit nicht ordenbar (Befund aus B4-1).';

-- Der Zugriffspfad der Übersicht: „die letzten Analysen, neueste zuerst".
create index analyses_created_idx on platform.analyses (created_at desc);
-- Der Zugriffspfad der Lead-Detailseite: „die Analysen DIESES Kunden, neueste zuerst".
create index analyses_lead_created_idx on platform.analyses (lead_id, created_at desc);

-- ── Warum die Analyse NICHT am Kaskadenlöschen des Leads hängt ──────────────────────────────────
-- `platform.anonymize_lead` (B1-3) wird von dieser Migration NICHT erweitert, und `lead_id` trägt
-- bewusst kein ON DELETE CASCADE. Beides ist Entscheidung, nicht Vergessen:
--
-- Eine bezahlte Analyse ist eine KAUFMÄNNISCHE LEISTUNG mit eigener Aufbewahrungspflicht — sieben
-- Jahre ab Vertragsschluss, und das ist laut B1-Entscheidung eine GETRENNTE Rechtsgrundlage neben
-- der werblichen Frist von 24 Monaten ab letzter Interaktion. Die Marketing-Frist des Leads läuft
-- also regelmässig FRÜHER ab als die Aufbewahrung der Leistung, die für ihn erbracht wurde. Hinge
-- die Analyse am Lead, löschte der Aufräum-Lauf (B4-1, täglich 03:15 UTC) automatisch eine
-- Geschäftsunterlage — unbemerkt, unumkehrbar und ausgerechnet bei den ersten Referenzkunden.
--
-- Genau deshalb steht `customer_label` DENORMALISIERT auf der Analyse und nicht nur am Lead: nach
-- der Anonymisierung trägt der Lead keinen Kundennamen mehr, die Analyse muss ihren aber behalten.
-- Sie ist damit kein „vergessener" Personenbezug, sondern der Beleg einer erbrachten Leistung, den
-- die Aufbewahrungspflicht ausdrücklich verlangt.

-- ── Append-only: Muster reject_stripe_event_mutation (T4-1) / reject_email_event_mutation (B2-2) ──
-- Zusätzlich zum fehlenden Tabellenrecht, weil ein Grant gegen BYPASSRLS-Rollen (service_role) und
-- gegen künftige Grant-Fehler nicht schützt. Hier trägt der Trigger mehr als anderswo: er ist die
-- technische Form der Zusage (a) — eine eingefrorene Baseline, die sich ändern liesse, wäre keine.
--
-- ── DIE AUSNAHME, ZUM DRITTEN MAL DERSELBE FALL ─────────────────────────────────────────────────
-- `lead_id` UND `created_by` tragen ON DELETE SET NULL, und diese REFERENTIELLE AKTION IST SELBST
-- EIN UPDATE auf die Analyse-Zeile. Ein ausnahmsloser Trigger machte damit jeden Lead, zu dem je
-- eine Analyse entstand, und jedes Konto, das je eine angelegt hat, UNLÖSCHBAR — also ausgerechnet
-- den betreuten Kunden gegen ein Löschverlangen und den ausscheidenden Mitarbeiter.
--
-- Strukturell derselbe Fall wie `last_edited_by` in `guard_anonymized_lead` (B2-1) und
-- `email_events.lead_id` (B2-2). Die Auflösung wird ÜBERNOMMEN, nicht neu erfunden: erlaubt ist
-- AUSSCHLIESSLICH das Nullen dieser beiden Felder bei sonst BIT-IDENTISCHER Zeile
-- (`to_jsonb`-Vergleich ohne genau diese zwei Felder). Nicht erlaubt: eines von beiden zu SETZEN,
-- es auf einen anderen Lead bzw. ein anderes Konto UMZUHÄNGEN, oder es zu nullen und dabei irgend
-- etwas anderes mitzuändern.
--
-- Der Vergleich läuft über `to_jsonb` und nicht über eine Aufzählung der Spalten: eine später
-- ergänzte Spalte wäre in einer handgeschriebenen Aufzählung stillschweigend ungeschützt, und genau
-- dieses Loch fiele niemandem auf. Der Preis ist eine jsonb-Darstellung des Blobs bei jedem
-- Löschvorgang — er fällt nur auf dem seltenen Löschpfad an und ist die Sicherheit wert.
--
-- Die Append-only-Zusage bleibt vollständig: sie gilt dem INHALT der Analyse — Eingaben, Ergebnis,
-- Baseline, Quelldatei. Die Zuschreibung zu einem Lead oder Konto ist kein Inhalt, sondern ein
-- Verweis, und der verschwindet mit seinem Ziel. Genau das ist die Absicht von ON DELETE SET NULL.
create function platform.reject_analysis_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_nulls_lead    boolean;
  v_nulls_creator boolean;
begin
  if tg_op = 'UPDATE' then
    v_nulls_lead    := old.lead_id is not null and new.lead_id is null;
    v_nulls_creator := old.created_by is not null and new.created_by is null;

    if (v_nulls_lead or v_nulls_creator)
       -- Jedes der beiden Felder ist entweder unverändert oder wird genau genullt. Setzen
       -- (null → Wert) und Umhängen (Wert → anderer Wert) fallen hier durch.
       and (new.lead_id is not distinct from old.lead_id or v_nulls_lead)
       and (new.created_by is not distinct from old.created_by or v_nulls_creator)
       -- Und sonst hat sich NICHTS geändert.
       and to_jsonb(new) - 'lead_id' - 'created_by' = to_jsonb(old) - 'lead_id' - 'created_by'
    then
      return new;
    end if;
  end if;

  raise exception
    'platform.analyses ist append-only (eingefrorene Baseline, B14-1) — % nicht erlaubt. Eine '
    'korrigierte Analyse ist eine NEUE Zeile mit supersedes_id.',
    tg_op;
end;
$$;

comment on function platform.reject_analysis_mutation is
  'B14-1: blockt UPDATE/DELETE auf platform.analyses hart. Greift auch gegen service_role und '
  'postgres — die eingefrorene Baseline ist eine Datenbank-Invariante, keine Übereinkunft. GENAU '
  'EINE Ausnahme: das Nullen von lead_id und/oder created_by bei sonst unveränderter Zeile, weil '
  'die referentielle Aktion ON DELETE SET NULL selbst ein UPDATE ist und ohne die Ausnahme jeder '
  'betreute Lead und jedes anlegende Konto unlöschbar wäre (dieselbe Asymmetrie wie bei '
  'last_edited_by in guard_anonymized_lead, B2-1, und email_events.lead_id, B2-2). Setzen und '
  'Umhängen bleiben gesperrt.';

create trigger analyses_no_update
  before update on platform.analyses
  for each row execute function platform.reject_analysis_mutation();

create trigger analyses_no_delete
  before delete on platform.analyses
  for each row execute function platform.reject_analysis_mutation();

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — Wrapper: vier, mit bewusst getrenntem Zuschnitt
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Alle SECURITY DEFINER, SET search_path = '', ausschliesslich an `authenticated` gegrantet, jeder
-- prüft zuerst platform.is_admin() und WIRFT sonst 42501 (Muster B1-1/B1-3/B2-1). Ein Fehler und
-- keine leere Antwort: „kein Zugriff" darf sich nie als „keine Analysen" lesen lassen — hier
-- besonders, weil eine leere Liste am Anfang die ehrliche Antwort ist.

-- ── admin_create_analysis ────────────────────────────────────────────────────────────────────────
-- ── WARUM DIE UNKOMPRIMIERTE DATEI ÜBERGEBEN WIRD, OBWOHL SIE NICHT GESPEICHERT WIRD ────────────
-- `p_source_file` ist die Originaldatei und wird NICHT abgelegt; gespeichert wird allein
-- `p_source_file_gzip`. Sie wird trotzdem übergeben, weil die Prüfsumme sonst ungeprüft bliebe:
-- PostgreSQL kann kein gzip auspacken, also ist der Klartext der einzige Weg, `sha256()` in der
-- Datenbank tatsächlich zu RECHNEN. Und die Prüfsumme ist der EINZIGE Beleg dafür, dass die
-- archivierte Datei die ist, aus der gerechnet wurde — wird sie ungeprüft übernommen, ist sie
-- Dekoration: ein 64-Zeichen-Wert, den der Aufrufer frei erfindet und der 2027 nichts belegt.
--
-- Zusätzlich wird der Blob an die geprüfte Datei GEBUNDEN: gzip-Kennung (1f 8b) und das Feld ISIZE
-- im gzip-Abschluss (die unkomprimierte Länge modulo 2^32, RFC 1952 §2.3.1) müssen zur übergebenen
-- Datei passen. Was das NICHT beweist: dass der Blob bitgleich diese Datei enthält — dafür müsste
-- die Datenbank entpacken können. Diese Lücke schliesst der Rundlauf über die ECHTE Wrapper-Kette
-- im DB-Gate (schreiben, lesen, entpacken, Byte-Vergleich). Beides zusammen ist die Zusage: die
-- Prüfsumme ist gerechnet, und der Blob ist wenigstens nachweislich dieselbe Datei der Länge nach.
create function public.admin_create_analysis(
  p_customer_label text,
  p_analysis_kind text,
  p_engine_version text,
  p_engine_commit_sha text,
  p_computed_at timestamptz,
  p_inputs jsonb,
  p_result jsonb,
  p_baseline_billed_kw_before numeric,
  p_baseline_billed_kw_after numeric,
  p_baseline_annual_saving_eur numeric,
  p_source_file_name text,
  p_source_file_sha256 text,
  -- Unkomprimiert, NUR zur Prüfung — wird nicht gespeichert (s. o.).
  p_source_file bytea,
  p_source_file_gzip bytea,
  p_site_label text default null,
  p_lead_id uuid default null,
  p_supersedes_id uuid default null,
  p_recommended_battery_label text default null,
  p_recommended_capacity_kwh numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_sha text;
  v_actual_sha   text;
  v_gzip_len     integer;
  v_isize        bigint;
  v_id           uuid;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_create_analysis: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  -- Ein leerer Kundenname wäre eine Analyse, die 2027 niemandem mehr zuzuordnen ist — und genau
  -- dafür steht das Feld denormalisiert auf der Zeile.
  if coalesce(btrim(p_customer_label), '') = '' then
    raise exception 'public.admin_create_analysis: customer_label ist Pflicht'
      using errcode = '22023';
  end if;

  if coalesce(btrim(p_source_file_name), '') = '' then
    raise exception 'public.admin_create_analysis: source_file_name ist Pflicht'
      using errcode = '22023';
  end if;

  if p_source_file is null or p_source_file_gzip is null then
    raise exception 'public.admin_create_analysis: Quelldatei und gzip-Fassung sind Pflicht'
      using errcode = '22023';
  end if;

  -- ── Die Prüfsumme wird GERECHNET, nicht geglaubt ──────────────────────────────────────────────
  v_expected_sha := lower(btrim(coalesce(p_source_file_sha256, '')));
  if v_expected_sha !~ '^[0-9a-f]{64}$' then
    raise exception
      'public.admin_create_analysis: source_file_sha256 muss 64 Hex-Zeichen sein (SHA-256 der '
      'unkomprimierten Datei), erhalten: %', coalesce(p_source_file_sha256, '<null>')
      using errcode = '22023';
  end if;

  v_actual_sha := encode(sha256(p_source_file), 'hex');
  if v_actual_sha <> v_expected_sha then
    raise exception
      'public.admin_create_analysis: Prüfsumme passt nicht zur übergebenen Datei (angegeben %, '
      'berechnet %) — es wird nichts angelegt', v_expected_sha, v_actual_sha
      using errcode = '22023';
  end if;

  -- ── Der Blob wird an die geprüfte Datei gebunden ──────────────────────────────────────────────
  v_gzip_len := octet_length(p_source_file_gzip);
  -- 10 Byte Kopf + 8 Byte Abschluss ist das Minimum eines gzip-Stroms (RFC 1952).
  if v_gzip_len < 18
     or get_byte(p_source_file_gzip, 0) <> 31    -- 0x1f
     or get_byte(p_source_file_gzip, 1) <> 139   -- 0x8b
  then
    raise exception 'public.admin_create_analysis: source_file_gzip ist kein gzip-Datenstrom'
      using errcode = '22023';
  end if;

  -- ISIZE: die letzten vier Byte, little-endian (RFC 1952 §2.3.1).
  v_isize := get_byte(p_source_file_gzip, v_gzip_len - 4)
           + get_byte(p_source_file_gzip, v_gzip_len - 3) * 256::bigint
           + get_byte(p_source_file_gzip, v_gzip_len - 2) * 65536::bigint
           + get_byte(p_source_file_gzip, v_gzip_len - 1) * 16777216::bigint;

  if v_isize <> (octet_length(p_source_file)::bigint % 4294967296::bigint) then
    raise exception
      'public.admin_create_analysis: die gzip-Fassung gehört nicht zur übergebenen Datei '
      '(unkomprimierte Länge laut gzip-Abschluss %, tatsächlich %)',
      v_isize, octet_length(p_source_file)
      using errcode = '22023';
  end if;

  insert into platform.analyses (
    lead_id, customer_label, site_label, analysis_kind, supersedes_id,
    engine_version, engine_commit_sha, computed_at, inputs, result,
    baseline_billed_kw_before, baseline_billed_kw_after, baseline_annual_saving_eur,
    recommended_battery_label, recommended_capacity_kwh,
    source_file_name, source_file_sha256, source_file_gzip,
    created_by
  )
  values (
    p_lead_id, btrim(p_customer_label), nullif(btrim(coalesce(p_site_label, '')), ''),
    p_analysis_kind, p_supersedes_id,
    p_engine_version, p_engine_commit_sha, p_computed_at, p_inputs, p_result,
    p_baseline_billed_kw_before, p_baseline_billed_kw_after, p_baseline_annual_saving_eur,
    nullif(btrim(coalesce(p_recommended_battery_label, '')), ''), p_recommended_capacity_kwh,
    btrim(p_source_file_name), v_expected_sha, p_source_file_gzip,
    -- Der Handelnde wird GELESEN, nicht übergeben: ein Parameter liesse sich fälschen, und die
    -- Urheberschaft einer Geschäftsunterlage ist keine Angabe des Aufrufers (Muster
    -- admin_anonymize_lead, B1-3).
    auth.uid()
  )
  returning id into v_id;

  return jsonb_build_object('status', 'ok', 'id', v_id);
end;
$$;

comment on function public.admin_create_analysis(
  text, text, text, text, timestamptz, jsonb, jsonb, numeric, numeric, numeric,
  text, text, bytea, bytea, text, uuid, uuid, text, numeric
) is
  'B14-1: legt eine eingefrorene Analyse an (created_by = auth.uid()), liefert {status, id}. PRÜFT '
  'die Prüfsumme, indem sie sie über die übergebene UNKOMPRIMIERTE Datei RECHNET — die Datei wird '
  'dafür übergeben, aber NICHT gespeichert (gespeichert wird nur die gzip-Fassung). Ohne diese '
  'Prüfung wäre die Prüfsumme Dekoration: der einzige Beleg, dass die archivierte Datei die ist, '
  'aus der gerechnet wurde. Bindet den Blob zusätzlich über gzip-Kennung und ISIZE an dieselbe '
  'Datei. Wirft bei Abweichung (22023) und legt nichts an. WIRFT bei fehlender Adminrolle (42501). '
  'authenticated-only.';

-- ── admin_list_analyses ──────────────────────────────────────────────────────────────────────────
-- Kopfdaten und die fünf typisierten Auszüge — AUSDRÜCKLICH OHNE `inputs`, `result` und
-- `source_file_gzip`. Die Blob-Spalte kommt in KEINER Auswahlliste dieser Funktion vor, auch nicht
-- in der inneren: `base` wird zweimal referenziert (Gesamtzahl und Seite) und deshalb materialisiert
-- — ein `select a.*` zöge die Spalte durch den Zwischenspeicher, ohne dass es je jemand sähe.
--
-- Die GRÖSSE des Archivs steht bewusst nur in admin_get_analysis, nicht hier: die Liste ist eine
-- Liste von Analysen, keine Dateiübersicht, und die Grösse ist erst dort eine Auskunft, wo auch der
-- Download angeboten wird. (Sie wäre nicht teuer — `octet_length(bytea)` liest die Länge aus dem
-- TOAST-Kopf und packt nichts aus. Der Grund ist der Zuschnitt, nicht der Aufwand.)
create function public.admin_list_analyses(
  p_limit integer default 50,
  p_offset integer default 0,
  p_lead_id uuid default null,
  p_kind text default null
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
  v_kind   text    := nullif(btrim(coalesce(p_kind, '')), '');
  v_total  integer;
  v_rows   jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_list_analyses: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  -- Ein unbekannter Filterwert wird ABGELEHNT und nicht ignoriert (Muster admin_list_leads, B2-1):
  -- eine still verworfene Einschränkung zeigte mehr Zeilen als angefordert, und der Admin hielte
  -- das Ergebnis für gefiltert. Hier wiegt das schwerer als sonst — „alle betreuten Analysen" ist
  -- die Frage, an der 2027 der Wirkungsnachweis hängt.
  if v_kind is not null and v_kind not in ('betreut', 'intern') then
    return jsonb_build_object('status', 'invalid_filter', 'filter', 'kind');
  end if;

  with base as (
    select a.id,
           a.lead_id,
           a.customer_label,
           a.site_label,
           a.analysis_kind,
           a.supersedes_id,
           a.engine_version,
           a.engine_commit_sha,
           a.computed_at,
           a.created_at,
           a.created_by,
           a.baseline_billed_kw_before,
           a.baseline_billed_kw_after,
           a.baseline_annual_saving_eur,
           a.recommended_battery_label,
           a.recommended_capacity_kwh,
           a.source_file_name,
           a.source_file_sha256
    from platform.analyses a
    where (p_lead_id is null or a.lead_id = p_lead_id)
      and (v_kind is null or a.analysis_kind = v_kind)
  ),
  page as (
    select b.*,
           -- Nur für die Seite aufgelöst, nicht für die Gesamtzahl: `base` wird materialisiert, und
           -- ein Join über alle Treffer kostete für Zeilen, die niemand sieht.
           (select au.email from auth.users au where au.id = b.created_by) as created_by_email
    from base b
    order by b.created_at desc
    limit v_limit offset v_offset
  )
  select (select count(*)::integer from base),
         coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc) from page p), '[]'::jsonb)
    into v_total, v_rows;

  return jsonb_build_object('status', 'ok', 'total', v_total, 'analyses', v_rows);
end;
$$;

comment on function public.admin_list_analyses(integer, integer, uuid, text) is
  'B14-1: Kopfdaten und die fünf typisierten Auszüge, seitenweise, neueste zuerst, mit Gesamtzahl. '
  'Liefert AUSDRÜCKLICH KEIN inputs, KEIN result und KEINEN Blob — und rührt die Blob-Spalte auch '
  'nicht für ihre Länge an. Ein unbekannter kind-Filter wird abgelehnt statt ignoriert. WIRFT bei '
  'fehlender Adminrolle (42501): eine leere Liste ist hier die häufigste ECHTE Antwort und darf '
  'nicht zugleich „kein Zugriff" bedeuten. authenticated-only.';

-- ── admin_get_analysis ───────────────────────────────────────────────────────────────────────────
-- Kopfdaten, `inputs` und `result` — aber OHNE `source_file_gzip`.
--
-- ── WARUM DER BLOB EINEN EIGENEN WRAPPER HAT ────────────────────────────────────────────────────
-- Ein Seitenaufruf, der nebenbei mehrere hundert Kilobyte Archivdaten mitzieht, tut das UNBEMERKT
-- und DAUERHAFT: die Detailseite lädt sie bei jedem Öffnen mit, obwohl sie sie nie anzeigt, und
-- niemand bemerkt es, weil die Seite ja funktioniert. Über Monate ist das der Unterschied zwischen
-- einer Ansicht, die man beiläufig aufruft, und einer, die spürbar hängt. Der Blob wird deshalb nur
-- geholt, wenn ihn jemand ausdrücklich anfordert — und dass das ein eigener Aufruf ist, macht die
-- Kosten an der Aufrufstelle sichtbar statt sie zu verstecken.
create function public.admin_get_analysis(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_analysis jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_get_analysis: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select to_jsonb(a) into v_analysis
  from (
    select an.id,
           an.lead_id,
           an.customer_label,
           an.site_label,
           an.analysis_kind,
           an.supersedes_id,
           an.engine_version,
           an.engine_commit_sha,
           an.computed_at,
           an.created_at,
           an.created_by,
           (select au.email from auth.users au where au.id = an.created_by) as created_by_email,
           an.baseline_billed_kw_before,
           an.baseline_billed_kw_after,
           an.baseline_annual_saving_eur,
           an.recommended_battery_label,
           an.recommended_capacity_kwh,
           an.source_file_name,
           an.source_file_sha256,
           -- Die GRÖSSE des Archivs, nicht das Archiv: damit die Oberfläche „312 kB herunterladen?"
           -- anbieten kann, ohne die Daten schon geholt zu haben. Eine Zeile, ausdrücklich geöffnet
           -- — anders als in der Liste (s. dort).
           octet_length(an.source_file_gzip) as source_file_gzip_bytes,
           an.inputs,
           an.result
    from platform.analyses an
    where an.id = p_id
  ) a;

  if v_analysis is null then
    -- Fachlicher Zustand (veralteter Link), kein Autorisierungsfehler → Status, keine Exception
    -- (Muster admin_get_lead, B1-1).
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object('status', 'ok', 'analysis', v_analysis);
end;
$$;

comment on function public.admin_get_analysis(uuid) is
  'B14-1: eine Analyse mit Kopfdaten, inputs und result — OHNE den Blob, nur mit dessen Grösse '
  '(source_file_gzip_bytes). Der Blob hat einen eigenen Wrapper, damit ein Seitenaufruf nicht '
  'nebenbei und unbemerkt mehrere hundert Kilobyte mitzieht. Ein unbekannter Schlüssel ist ein '
  'fachlicher Zustand (not_found), keine Ausnahme. WIRFT bei fehlender Adminrolle (42501). '
  'authenticated-only.';

-- ── admin_get_analysis_source ────────────────────────────────────────────────────────────────────
-- Ausschliesslich Dateiname, Prüfsumme und Blob. Die Prüfsumme fährt MIT dem Blob, nicht nur in der
-- Detailansicht: wer die Datei herunterlädt, soll sie prüfen können, ohne einen zweiten Aufruf zu
-- brauchen — sonst prüft sie niemand.
--
-- Base64 und nicht die PostgreSQL-Hex-Darstellung: hex verdoppelt die Nutzlast, base64 kostet ein
-- Drittel. Bei der grössten Einzelantwort des Systems ist das der Unterschied, der zählt.
create function public.admin_get_analysis_source(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_source jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_get_analysis_source: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
           'source_file_name',   an.source_file_name,
           'source_file_sha256', an.source_file_sha256,
           'source_file_gzip_base64', encode(an.source_file_gzip, 'base64'),
           'source_file_gzip_bytes', octet_length(an.source_file_gzip)
         )
    into v_source
  from platform.analyses an
  where an.id = p_id;

  if v_source is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object('status', 'ok', 'source', v_source);
end;
$$;

comment on function public.admin_get_analysis_source(uuid) is
  'B14-1: ausschliesslich Dateiname, Prüfsumme und die archivierte Datei (gzip, base64). Getrennt '
  'von admin_get_analysis, damit der Blob nur fliesst, wenn ihn jemand ausdrücklich anfordert. Die '
  'Prüfsumme fährt mit, damit die heruntergeladene Datei prüfbar ist, ohne einen zweiten Aufruf. '
  'base64 statt hex: hex verdoppelte die grösste Einzelantwort des Systems. WIRFT bei fehlender '
  'Adminrolle (42501). authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — RLS und Rechte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Muster platform.job_runs (B4-1), platform.admin_exports (B2-1), platform.email_events (B2-2):
-- RLS an, KEINE Policy, für KEINE Rolle ein Grant — auch nicht für service_role. Zwei unabhängige
-- Schichten: ohne Policy sähe selbst eine Rolle nichts, der jemand später versehentlich ein
-- Tabellenrecht gäbe. Geschrieben wird ausschliesslich über public.admin_create_analysis, gelesen
-- ausschliesslich über die drei admin-Wrapper.
alter table platform.analyses enable row level security;

-- Die platform-Funktion ist KEIN öffentlicher Zugriffsweg: PostgreSQL grantet EXECUTE an PUBLIC per
-- Voreinstellung — hier entzogen.
revoke all on function platform.reject_analysis_mutation() from public;

-- Die vier neuen public-Funktionen: Supabases ALTER DEFAULT PRIVILEGES hat ihnen EXECUTE an anon,
-- authenticated UND service_role gegeben (zusätzlich zum PostgreSQL-Default an PUBLIC). Erst allen
-- entziehen, dann gezielt gewähren.
--
-- Alle vier authenticated-only. Ausdrücklich AUCH admin_create_analysis, obwohl es schreibt: eine
-- Analyse entsteht durch einen MENSCHEN, der sie verantwortet (created_by = auth.uid()), nicht
-- durch einen signaturbasierten Dienst. Ein service_role-Grant machte die Urheberschaft zu einer
-- leeren Spalte — und `service_role` ist zudem der Schlüssel, den jeder Server-Kontext trägt.
revoke all on function public.admin_create_analysis(
  text, text, text, text, timestamptz, jsonb, jsonb, numeric, numeric, numeric,
  text, text, bytea, bytea, text, uuid, uuid, text, numeric
) from public, anon, authenticated, service_role;
grant execute on function public.admin_create_analysis(
  text, text, text, text, timestamptz, jsonb, jsonb, numeric, numeric, numeric,
  text, text, bytea, bytea, text, uuid, uuid, text, numeric
) to authenticated;

revoke all on function public.admin_list_analyses(integer, integer, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_list_analyses(integer, integer, uuid, text) to authenticated;

revoke all on function public.admin_get_analysis(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_get_analysis(uuid) to authenticated;

revoke all on function public.admin_get_analysis_source(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_get_analysis_source(uuid) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — Was es hier BEWUSST NICHT GIBT
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- KEIN Benchmark-Kennzeichen und KEINE branchenübergreifende Auswertung — siehe (c) im Kopf.
--
-- KEINE Funktion, die `result` nachrechnet, migriert oder „repariert". Sie wäre der Weg, auf dem
-- eine eingefrorene Baseline mit einem Aufruf verschwindet, und sie sähe dabei aus wie Sorgfalt.
-- Bricht der Contract später (§3.10 wächst), entsteht eine NEUE Analyse mit supersedes_id; die alte
-- bleibt in der Form, in der sie berechnet wurde. Genau dafür stehen engine_version und
-- engine_commit_sha auf der Zeile: sie sagen, welcher Contract für diese Zeile gilt.
--
-- KEIN `tenant_id` (B13) und KEIN `installer_id`. Letzteres stammt aus §4 des
-- Kalkulator-Pflichtenhefts, das älter ist als die Plattform-Entscheidung; die Isolation läuft über
-- platform + is_admin, nicht über eine Spalte. B13 ergänzt tenant_id additiv, wenn es so weit ist.
--
-- KEIN Speicherweg aus dem Kalkulator und KEINE Admin-Ansicht — das ist B14-2. Diese Migration legt
-- ausschliesslich die Ablage und ihren Zugriffspfad an; sie wird von keiner Oberfläche aufgerufen.
