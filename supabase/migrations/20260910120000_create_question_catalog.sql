-- B24, Teil 2 — der admin-pflegbare Fragenkatalog und die System-Prompt-Erweiterung.
--
-- Kanonische fachliche Quelle: `Pflichtenheft_Kalkulator_Delta_KI-Interface.md` §4 (Teil 2:
-- Admin-Frage-Guidelines) und §3.2 (Baseline: admin-gepflegte Pflichtfragen). Reihenfolge/Einordnung
-- `Fahrplan_2026.md`, B24. Vorbild für Struktur und Rechtefläche: das Account/Projekt-Fundament
-- (20260909120000) und der Chat-Zustand (20260910090000); Vorbild für Ordnungspflicht und
-- Löschprotokoll: `create_grid_tariff` (B21-2b) und `delete_grid_tariff` (B21-2c).
--
-- ── WAS HIER ENTSTEHT ───────────────────────────────────────────────────────────────────────────
--   TEIL 1  `platform.projects` waechst um `industry` (offene Liste, NICHT das Lead-Enum)
--   TEIL 2  `platform.question_catalog_entries`   — die Pflichtfragen je Segment/Branche, datiert
--   TEIL 3  `platform.question_catalog_deletions` — das Loeschprotokoll
--   TEIL 4  `platform.system_prompt_extensions`   — die admin-pflegbare Prompt-Ergaenzung, datiert
--   TEIL 5  Die sieben public-Wrapper
--   TEIL 6  RLS und Rechte
--   TEIL 7  Was es hier BEWUSST NICHT GIBT
--
-- ── WAS HIER AUSDRUECKLICH NICHT ENTSTEHT ───────────────────────────────────────────────────────
-- KEINE Oberflaeche, KEINE Zeile Anwendungscode. Insbesondere ist `apps/web/lib/project-chat/`
-- unangetastet: der Kern-System-Prompt in `system-prompt.ts` bleibt, wo er ist, die Werkzeuge und
-- der Ausfuehrer ebenso, und `check_draft_completeness` bleibt vorerst der Platzhalter, der er ist.
-- Die VERDRAHTUNG (Kern-Prompt + Erweiterung gemeinsam an das Modell; der Chat liest den Katalog
-- seines Segments) ist ein eigener, spaeterer Schritt.
--
-- KEINE Befuellung der Kataloge. Welche Fragen ein Hotel-Pool enthaelt, ist Fachwissen (Delta §4.4,
-- offener Punkt 2, Owner Andreas/Martin) — hier entsteht die Struktur, nicht der Inhalt. Eine hier
-- erfundene Frage waere derselbe Fehler wie ein erfundener Tarifsatz in B11.
--
-- KEIN denormalisierter Katalog-Stand am Projekt oder an der Analyse. Delta §4.2 verlangt ihn
-- ausdruecklich („Ein referenziertes Projekt/eine Analyse fuehrt den Katalog-Stand denormalisiert
-- mit", Vorbild `tariffSetId`) — er gehoert aber an die Stelle, die den Katalog LIEST, und die gibt
-- es erst mit der Verdrahtung. `list_question_catalog` liefert die Kennungen der geltenden Staende
-- schon jetzt mit, damit dieser Schritt dort nichts nachtragen muss.
--
-- ── ⚠ ZWEI TABELLEN, EINE MIGRATION — UND DER GRUND IST DIE GEMEINSAME REGEL ────────────────────
-- Fragenkatalog und Prompt-Erweiterung sind fachlich verschiedene Dinge, folgen aber DERSELBEN
-- Ordnungsmechanik (datierte Staende, Advisory-Lock, Vorgaengerin schliessen, Korrektur am selben
-- Tag). Getrennt gebaut waere diese Mechanik zweimal ausgeschrieben und liefe beim naechsten Umbau
-- auseinander — dasselbe Argument, mit dem das Fundament `platform.ensure_account` und der
-- Chat-Zustand `platform.project_accessible` eingefuehrt haben. Sie steht hier deshalb einmal als
-- Text und zweimal als Rumpf, und die Rumpfe sind absichtlich Zeile fuer Zeile parallel gebaut.
--
-- ── KONVENTIONEN (exakt T4-1/B1-1/B14-1/B24) ────────────────────────────────────────────────────
-- Alles Fachliche in `platform` (nicht ueber die REST-API exponiert, `supabase/config.toml`),
-- Zugriff von aussen ausschliesslich ueber SECURITY-DEFINER-Wrapper im `public`-Schema, alle
-- Funktionen mit `set search_path = ''` bzw. vollqualifiziert. RLS an, keine Policy, KEIN
-- Tabellen-Grant fuer irgendeine Rolle — auch nicht fuer `service_role`.
--
-- ── ⚠ WARUM `security definer` + `authenticated`, UND NICHT `security invoker` + `service_role` ──
-- `create_grid_tariff`/`delete_grid_tariff` sind SECURITY INVOKER und pruefen KEINE Rolle: sie
-- liegen in `public`, werden von `anon` gelesen, und ihr Aufrufer ist `service_role` ohne JWT — es
-- gaebe dort nichts zu pruefen (DEPLOYMENT.md §3c nennt das die eine bewusste Abweichung des
-- Systems). Hier gilt das Gegenteil: die Tabellen liegen in `platform`, der Aufrufer ist eine
-- angemeldete Sitzung, und `platform.is_admin()` ist damit tatsaechlich beantwortbar. Die
-- Autorisierung gehoert deshalb in die DATENBANK und nicht in den Anwendungscode — diese Migration
-- ERWEITERT die Abweichung von §3c also NICHT, sie folgt der Regel.
--
-- ── ARBEITSREGEL 1 (Funktionsrumpfe) ────────────────────────────────────────────────────────────
-- Es wird keine Spalte geloescht oder umbenannt. In ihrer Umkehrung (B16-4b) greift sie trotzdem:
-- `platform.projects` bekommt eine NEUE Spalte, und kein bestehender Wrapper darf sie unbeabsichtigt
-- nach aussen tragen. Gemessen: alle Leser von `platform.projects` (`get_project`,
-- `list_my_projects`, `get_my_project`, `admin_list_projects`, `admin_get_project`,
-- `admin_list_open_questions`, `project_accessible`) fuehren eine EXPLIZITE Spaltenliste, keiner
-- benutzt `select *`, `to_jsonb(pr)` oder `%rowtype`. `industry` erscheint deshalb vorerst nirgends
-- — s. TEIL 1 und TEIL 7.
--
-- ── ARBEITSREGEL 5 (kein Direktaufruf ohne Grant) ───────────────────────────────────────────────
-- Das Gate prueft fehlende Aufrufbarkeit mit `has_function_privilege`, nicht durch einen Aufruf.
--
-- ── DIE `ON DELETE SET NULL`-FALLE ──────────────────────────────────────────────────────────────
-- Alle drei neuen Tabellen tragen `on delete set null` auf einem `auth.users`-Verweis. Die im Repo
-- fuenfmal aufgetretene Falle (`leads.last_edited_by`, `email_events.lead_id`,
-- `analyses.lead_id`/`created_by`, `partner_applications.user_id`) entsteht erst, wenn auf DERSELBEN
-- Tabelle ein Append-only- oder Unveraenderlichkeits-Trigger sitzt: die referentielle Aktion IST
-- selbst ein UPDATE und wuerde von ihm abgewiesen — das Konto waere unloeschbar. KEINE dieser drei
-- Tabellen traegt einen solchen Trigger; die Unveraenderlichkeit des Loeschprotokolls sitzt in der
-- RECHTEFLAECHE (kein Grant, kein Wrapper, der es aendert oder loescht), genau wie beim Chat-Verlauf
-- (20260910090000 TEIL 2). ⚠ WER JE EINEN SOLCHEN TRIGGER ERGAENZT, MUSS DIE ASYMMETRISCHE AUSNAHME
-- MITBAUEN (Nullen erlaubt bei sonst bit-identischer Zeile, Setzen und Umhaengen gesperrt).

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — platform.projects.industry
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── ⚠ DIESE SPALTE HEISST WIE EINE ANDERE, UND SIE IST NICHT DIESELBE ───────────────────────────
-- `platform.leads.industry` ist vom Typ `platform.industry` — ein GESCHLOSSENES Enum mit zehn
-- Werten, dessen Kommentar (B3-1) den Grund nennt: der Anwendungscode braucht je Branche eine
-- Vollbenutzungsstunden-Kennzahl, eine neue Branche ist dort zwangslaeufig ein gemeinsames Code- UND
-- Migrationsereignis.
--
-- Hier ist es umgekehrt und ausdruecklich so entschieden (Delta §4.1): eine OFFENE Liste als `text`,
-- „damit neue Branchen-Pools (z. B. Hotel) ohne Schema-Aenderung admin-seitig entstehen koennen".
-- Der Kommentar an `platform.projects.segment` (Chat-Zustand) hat genau diese Spalte angekuendigt:
-- „Die BRANCHE steht hier ausdruecklich NICHT — die ist laut Delta §4.1 eine offene Liste und
-- gehoert zum Fragenkatalog-Schritt."
--
--   ⇒ Gleicher NAME, anderer TYP, andere Wertemenge, anderer Zweck. Wer beide je zusammenfuehren
--     will, entscheidet damit zugleich die Kennzahl-Frage aus B3-3 — das ist kein Aufraeumen,
--     sondern eine fachliche Entscheidung.
--
-- ── DER FORMAT-CHECK IST KEIN WIDERSPRUCH ZU „OFFENE LISTE" ─────────────────────────────────────
-- „Offen" heisst: keine feste Werteliste. Es heisst nicht: beliebige Schreibweise. `industry` ist
-- ein IDENTITAETSfeld (es entscheidet, welcher Fragen-Pool geladen wird) — und ein Identitaetsfeld
-- ohne Format hat genau die Falle, die B21-2b fuer `operator_id` ausschreibt: ein Tippfehler erzeugt
-- keine Ablehnung, sondern eine ZWEITE Identitaet, die in einer Liste neben der ersten steht und
-- erst auffaellt, wenn ein Kunde den falschen Pool bekommt. `hotel` und `Hotel ` waeren zwei Pools.
-- Das Muster ist wortgleich das von `operator_id` (Kleinbuchstaben, Ziffern, Unterstrich).
alter table platform.projects
  add column industry text null
    constraint projects_industry_format check (industry ~ '^[a-z0-9][a-z0-9_]*$');

comment on column platform.projects.industry is
  'B24: die Branche eines Betriebs-Projekts als OFFENE Liste (Delta §4.1) — Kleinbuchstaben, '
  'Ziffern, Unterstrich, damit ein Tippfehler nicht still eine zweite Branchen-Identitaet erzeugt. '
  '⚠ NICHT zu verwechseln mit platform.leads.industry: das ist das GESCHLOSSENE Enum platform.'
  'industry und haengt an einer Kennzahl im Anwendungscode (B3-1/B3-3). Gleicher Name, anderer Typ, '
  'anderer Zweck. NULL heisst „das Gespraech hat die Branche noch nicht bestimmt" — bei einem '
  'Privat-Projekt bleibt sie dauerhaft NULL. Hat in diesem Bauschritt bewusst noch KEINEN '
  'Schreibweg (s. TEIL 7).';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — platform.question_catalog_entries
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── WAS DIE TABELLE FACHLICH IST ────────────────────────────────────────────────────────────────
-- Delta §3.2: „eine Menge von Pflichtfragen/-kategorien je Segment, gegen die jedes Projekt vor
-- Abschluss geprueft wird. Der Chat entscheidet selbst, WIE er fragt … er darf aber nicht als
-- abgeschlossen gelten, solange Pflichtpunkte seines Segments unbeantwortet oder nicht explizit als
-- offene Rueckfrage an Martin vermerkt sind." Und §4.3: „Der Chat entscheidet nicht, WAS im
-- Hotel-Pool steht — er entscheidet, DASS er den Hotel-Pool laden muss." Diese Tabelle ist das WAS;
-- sie ist deterministische, admin-gepflegte Referenz und traegt kein Urteil des Modells.
--
-- ── WARUM IN DER DATENBANK UND NICHT IM CODE (Delta §4.2, gegen den B11-Reflex) ─────────────────
-- Der staerkste Gegenbeleg liegt im eigenen Repo: B21-3d hat fuer die Netzebenen-Verfuegbarkeit
-- exakt die umgekehrte Bewegung gemacht — vom statischen Code-Katalog zur Datenbank —, weil die
-- Admin-Pflege am Code-Katalog vorbeilief und der Fehler UNSICHTBAR blieb. Ein Fragenkatalog soll
-- laut Auftrag admin-pflegbar sein; mit einem Code-Modul (Aenderung = PR eines Entwicklers) ist das
-- nicht ehrlich vereinbar.
--
-- ── BASELINE UND ZUSATZFRAGEN STEHEN IN DERSELBEN TABELLE ──────────────────────────────────────
-- `industry is null` = Baseline des Segments (gilt fuer JEDES Projekt dieses Segments),
-- `industry` gesetzt = Zusatzfrage genau dieses Branchen-Pools. Zwei Tabellen dafuer waeren zwei
-- Ordnungsmechaniken, zwei Loeschwege und zwei Stellen, an denen dieselbe Datierungsregel steht —
-- und der Leser muesste beim Lesen einer Frage erst wissen, in welcher Tabelle sie steht, um zu
-- verstehen, fuer wen sie gilt. Eine nullable Spalte sagt dasselbe an einer Stelle.
--
-- ⚠ FOLGE, DIE MITZUDENKEN IST: `industry` ist damit Teil der IDENTITAET eines Fragen-Standes und
-- zugleich NULLABLE — genau die Lage, aus der `unique nulls not distinct` (B21-1) entstanden ist.
-- Siehe den Constraint am Fuss der Tabelle.
--
-- ── DAS SEGMENT IST GESCHLOSSEN, DIE BRANCHE IST OFFEN — und das ist kein Versehen ───────────────
-- `segment` traegt dieselben zwei Werte wie `platform.projects.segment` und denselben CHECK statt
-- eines Enums (Grund dort: `alter type … add value` ist im selben Transaktionsblock nicht benutzbar,
-- 55P04, in B18-6 gemessen und in Delta 16b mit ZWEI Migrationsdateien bezahlt). Die zweiwertige
-- Achse Privat/Betrieb ist geschlossen (Delta §3.4), die Branche ausdruecklich nicht (§4.1).
create table platform.question_catalog_entries (
  id uuid primary key default gen_random_uuid(),

  segment text not null
    constraint question_catalog_entries_segment_check
      check (segment in ('privat', 'betrieb')),

  -- NULL = Baseline des Segments. Format wie platform.projects.industry (s. TEIL 1) — dieselbe
  -- Wertemenge auf beiden Seiten, sonst faende ein Projekt seinen eigenen Pool nicht.
  industry text null
    constraint question_catalog_entries_industry_format
      check (industry ~ '^[a-z0-9][a-z0-9_]*$'),

  -- ⚠ FREI WAEHLBAR UND AUSDRUECKLICH KEIN ENUM (Auftrag; Delta §4.4: die Inhalte sind Fachwissen).
  -- Das Segment 'betrieb' MUSS damit z. B. eine Baseline-Frage nach der Branche tragen koennen —
  -- das Schema stellt dafuer keinerlei Bedingung, es haelt nur die Schreibweise stabil: derselbe
  -- Format-CHECK wie `industry`, aus demselben Grund (der Schluessel IST die Identitaet des
  -- Fragen-Standes; `netzebene` und `Netzebene` waeren zwei unabhaengige Ketten).
  question_key text not null
    constraint question_catalog_entries_question_key_format
      check (question_key ~ '^[a-z0-9][a-z0-9_]*$'),

  -- Der Wortlaut, den der Admin pflegt. CHECK gegen den leeren String: `not null` allein liesse ''
  -- zu, und eine Pflichtfrage ohne Text ist in einer Liste nicht von einem Fehler zu unterscheiden
  -- (wortgleiches Vorbild projects.customer_label).
  question_text text not null
    constraint question_catalog_entries_question_text_not_blank
      check (btrim(question_text) <> ''),

  -- Pflicht oder Hinweis. Vorgabe `true`, weil eine Frage, die jemand in einen PFLICHTfragenkatalog
  -- eintraegt, im Zweifel eine Pflichtfrage ist — der weniger folgenreiche Vorgabewert waere hier
  -- der gefaehrlichere: eine versehentlich optionale Pflichtfrage laesst ein Projekt als
  -- abgeschlossen gelten, obwohl ein Pflichtpunkt offen ist (Delta §3.2).
  required boolean not null default true,

  -- ── DIE EFFEKTIV-DATIERUNG, wortgleich zu grid_tariffs ───────────────────────────────────────
  -- `valid_until is null` = der aktuell offene Stand. Beim Anlegen eines neuen Standes bekommt die
  -- Vorgaengerin `valid_until = neuer valid_from - 1` — lueckenlos UND ueberlappungsfrei zugleich,
  -- und der einzige Wert, der beides leistet.
  -- ⚠ `valid_until` IST INKLUSIV (der letzte GUELTIGE Tag steht in der Spalte). Halboffen gelesen
  -- verloere jeder Stand seinen letzten Tag — dieselbe Falle, die B21-3b fuer die Engine benannt hat.
  valid_from date not null,
  valid_until date null,

  -- Wortgleiches Vorbild platform.analyses.created_by (B14-1) und platform.projects.created_by:
  -- der Urheber als Konto-Kennung, nicht als Adresse; die Adresse loest der Lese-Wrapper auf
  -- (auth.users ist fuer keine Client-Rolle lesbar). NULLABLE + ON DELETE SET NULL: ein geloeschtes
  -- Admin-Konto darf den Katalog nicht mitreissen.
  created_by uuid null references auth.users (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- ── ⚠ `nulls not distinct` — DER WICHTIGSTE CONSTRAINT DIESER TABELLE ────────────────────────
  -- PostgreSQL wertet NULL in einem gewoehnlichen UNIQUE nie als gleich zu NULL. Ein gewoehnliches
  -- `unique` liesse damit ausgerechnet fuer den REGELFALL — die Baseline eines Segments, wo
  -- `industry` null ist — beliebig viele Staende mit demselben `valid_from` zu. Welcher Wortlaut
  -- einer Pflichtfrage dann im Chat erschiene, entschiede die Sortierreihenfolge einer Abfrage.
  -- Wortgleiches Vorbild und wortgleiche Begruendung: `grid_tariffs_unique` (B21-1), dort fuer
  -- `metering_variant`. Verfuegbar ab PG15; Cloud und lokal laufen auf 17.6.
  --
  -- Der Constraint ist RUECKHALT, nicht die Ordnungsregel selbst: die sitzt im Funktionsrumpf von
  -- public.admin_create_question_catalog_entry (Delta §4.2, Vorbild create_grid_tariff). Erreichbar
  -- ist er nur ueber einen Stand, der bereits ARCHIVIERT ist (die offene Zeile liegt dann davor,
  -- die Ordnungspruefung greift also nicht) — oder ueber einen Eingriff von Hand.
  constraint question_catalog_entries_unique_stand
    unique nulls not distinct (segment, industry, question_key, valid_from)
);

comment on table platform.question_catalog_entries is
  'B24: die admin-gepflegten Pflichtfragen je Segment und Branche (Delta §3.2/§4). '
  'industry NULL = Baseline des Segments, industry gesetzt = Zusatzfrage dieses Branchen-Pools — '
  'beides in EINER Tabelle, weil es dieselbe Ordnungsmechanik ist. Datierte Staende wie '
  'public.grid_tariffs: ein neuer Stand haengt hinten an, die Vorgaengerin wird auf valid_from - 1 '
  'geschlossen; die Ordnungspflicht sitzt im Funktionsrumpf, der unique-Constraint ist nur '
  'Rueckhalt. Geloescht wird ausschliesslich ueber public.admin_delete_question_catalog_entry, das '
  'vorher einen vollstaendigen Abzug nach platform.question_catalog_deletions schreibt. RLS aktiv '
  'OHNE Policy, kein Tabellen-Grant fuer irgendeine Rolle. Die INHALTE sind Fachwissen und werden '
  'hier bewusst nicht mitgeliefert (Delta §4.4).';

comment on column platform.question_catalog_entries.industry is
  'NULL = Baseline des Segments (gilt fuer jedes Projekt dieses Segments), gesetzt = Zusatzfrage '
  'genau dieses Branchen-Pools. OFFENE Liste (Delta §4.1), Format wie platform.projects.industry. '
  '⚠ Teil der Identitaet eines Standes UND nullable — deshalb unique nulls not distinct.';

comment on column platform.question_catalog_entries.question_key is
  'Der stabile Schluessel der Frage — frei waehlbar, ausdruecklich KEIN Enum (Delta §4.4: die '
  'Inhalte sind Fachwissen). Das Format haelt nur die Schreibweise stabil, weil der Schluessel die '
  'Identitaet des Fragen-Standes traegt: netzebene und Netzebene waeren zwei unabhaengige Ketten.';

comment on column platform.question_catalog_entries.required is
  'Pflichtfrage (true) oder Hinweis (false). Vorgabe true: eine versehentlich optionale Pflichtfrage '
  'liesse ein Projekt als abgeschlossen gelten, obwohl ein Pflichtpunkt offen ist (Delta §3.2) — '
  'der umgekehrte Fehler ist die harmlosere Richtung.';

comment on column platform.question_catalog_entries.valid_until is
  'Der LETZTE gueltige Tag, INKLUSIV — nicht der erste ungueltige. Halboffen gelesen verloere jeder '
  'Stand seinen letzten Tag. NULL = aktuell offener Stand.';

comment on column platform.question_catalog_entries.created_by is
  'Der Admin, der diesen Stand angelegt hat. NULLABLE + ON DELETE SET NULL wie analyses.created_by: '
  'ein geloeschtes Konto darf den Katalog nicht mitreissen. Die Adresse loest '
  'public.admin_list_question_catalog auf (auth.users ist fuer keine Client-Rolle lesbar).';

create trigger question_catalog_entries_set_updated_at
  before update on platform.question_catalog_entries
  for each row execute function platform.set_updated_at();

-- KEIN zusaetzlicher Index. Der unique-Constraint oben legt bereits einen Index ueber
-- (segment, industry, question_key, valid_from) an, und dessen fuehrende Spalten sind genau die,
-- nach denen public.list_question_catalog filtert. Ein Index auf Vorrat waere hier Aufwand ohne
-- Nutzen — dieselbe Ueberlegung wie bei platform.admin_exports (B2-1); die Tabelle waechst mit
-- Einzelvorgaengen eines Menschen, nicht mit Datenverkehr.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — platform.question_catalog_deletions
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── WARUM ES DAS LOESCHEN UEBERHAUPT GIBT, UND WARUM PROTOKOLLIERT ─────────────────────────────
-- Delta §4.2, woertlich: „ein `deleted_questions`-Protokoll analog zu `grid_tariff_deletions` fuer
-- den Korrekturfall. Das ist realistischer als eine harte Unveraenderlichkeit (Fragenkataloge werden
-- vermutlich oefter korrigiert als Tarifsaetze) und liefert dieselbe Reproduzierbarkeit: eine 2026
-- gefuehrte Konversation muss 2028 noch sagen koennen, welcher Fragenkatalog-Stand ihr zugrunde
-- lag." Ohne dieses Protokoll waere ein geloeschter Stand von einem nie angelegten nicht
-- unterscheidbar — und ein Gespraech, das sich auf ihn stuetzte, nicht mehr erklaerbar.
--
-- ── ⚠ DER WERT DES PROTOKOLLS HAENGT DARAN, DASS ES SELTEN IST ─────────────────────────────────
-- Genau deshalb ist das Loeschen NICHT der Weg, einen Tippfehler zu korrigieren: dafuer gibt es die
-- Korrektur am selben Tag (`status: replaced`, s. TEIL 5). Liefe jede Textkorrektur ueber
-- Loeschen+Neuanlegen, fuellte sich das Protokoll mit Rauschen und „was hier geloescht wurde"
-- hoerte auf, eine Aussage zu sein.
--
-- ── ⚠ KEIN FREMDSCHLUESSEL AUF question_catalog_entries, UND ZWAR ZWINGEND ──────────────────────
-- Die referenzierte Zeile existiert nach dem Vorgang nicht mehr. Ein Fremdschluessel waere entweder
-- unmoeglich (`restrict` — der Vorgang liefe nie) oder selbstzerstoerend (`cascade` — das Protokoll
-- verschwaende zusammen mit dem, was es belegt). Wortgleiche Lage und Begruendung wie
-- public.grid_tariff_deletions (B21-2c) und platform.admin_exports (B2-1).
create table platform.question_catalog_deletions (
  id uuid primary key default gen_random_uuid(),

  -- Die id der geloeschten Zeile — eine BLOSSE uuid, bewusst ohne Fremdschluessel (s. o.).
  entry_id uuid not null,

  -- ── ⚠ ZWEI SPALTEN FUER DENSELBEN MENSCHEN, UND DAS IST KEINE DOPPELUNG ─────────────────────
  -- `deleted_by` ist die LEBENDE Verknuepfung und die Form, in der dieses Schema Urheberschaft
  -- fuehrt (analyses.created_by, projects.created_by) — sie erlaubt einer kuenftigen Ansicht den
  -- Join und verschwindet mit dem Konto.
  -- `deleted_by_email` ist der ABZUG desselben Menschen zum Zeitpunkt des Vorgangs. Er ueberlebt das
  -- Loeschen des Kontos, und genau darauf beruht der Zweck des Protokolls: eine UUID, deren Zeile es
  -- nicht mehr gibt, sagt 2028 niemandem, WER den Stand entfernt hat (wortgleiche Begruendung wie
  -- grid_tariff_deletions.deleted_by).
  -- Dieselbe Aufteilung wie analyses.lead_id (Verknuepfung, darf verschwinden) neben
  -- analyses.customer_label (Abzug, muss bleiben) — B14-1 Regel (d).
  deleted_by uuid null references auth.users (id) on delete set null,
  deleted_by_email text not null,

  -- clock_timestamp(), NICHT now(): `now()` ist die TRANSAKTIONSzeit und in einer Transaktion
  -- konstant — zwei Loeschungen derselben Transaktion (im DB-Gate der Normalfall) waeren nicht
  -- ordenbar. Befund aus B4-1, seither auch in platform.admin_exports und grid_tariff_deletions.
  deleted_at timestamptz not null default clock_timestamp(),

  -- Die vollstaendige Zeile. `to_jsonb(e)` nimmt ALLE Spalten mit, auch kuenftig hinzukommende —
  -- ein Protokoll, das eine Spaltenliste ausschreibt, verliert beim naechsten Schema-Zuwachs still
  -- ein Feld und saehe dabei vollstaendig aus.
  entry_snapshot jsonb not null
);

comment on table platform.question_catalog_deletions is
  'B24: Loeschprotokoll des Fragenkatalogs (Delta §4.2, offener Punkt 9). Enthaelt einen '
  'VOLLSTAENDIGEN Abzug der geloeschten Zeile — ohne ihn waere ein geloeschter Stand von einem nie '
  'angelegten nicht unterscheidbar. Bewusst OHNE Fremdschluessel auf question_catalog_entries: die '
  'referenzierte Zeile existiert danach nicht mehr. Traegt die Urheber-Adresse zusaetzlich als '
  'ABZUG, weil die Konto-Verknuepfung mit dem Konto verschwinden darf. RLS aktiv OHNE Policy, kein '
  'Tabellen-Grant; geschrieben wird ausschliesslich aus '
  'public.admin_delete_question_catalog_entry. Es gibt bewusst KEINEN Lese-Wrapper (s. TEIL 7).';

comment on column platform.question_catalog_deletions.entry_snapshot is
  'Die geloeschte Zeile als jsonb, ueber to_jsonb() und damit spaltenvollstaendig. Der Abzug ist die '
  'einzige Stelle, an der der geloeschte Fragen-Wortlaut erhalten bleibt — und damit die Grundlage, '
  'aus der sich ein versehentlich geloeschter Stand wiederherstellen laesst.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — platform.system_prompt_extensions
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── ⚠ DIES ERSETZT DEN KERN-SYSTEM-PROMPT NICHT ────────────────────────────────────────────────
-- `apps/web/lib/project-chat/system-prompt.ts` bleibt unangetastet und bleibt der Ort, an dem die
-- VERHALTENSANFORDERUNGEN des Deltas stehen (§3.1 freies Gespraech, §3.2 Annahme/Messwert bei jedem
-- Wert, §3.3 immer beide Wege anbieten, §3.4 Segment frueh klaeren, §3.5 nicht abbildbare Struktur
-- an Martin). Diese Tabelle traegt eine ERGAENZUNG, die ein Admin ohne PR aendern kann — Ton,
-- Gespraechsfuehrung, Reihenfolge der Fragen, Feinschliff. Beides gemeinsam an das Modell zu geben
-- ist die Aufgabe des Verdrahtungs-Schritts, nicht dieser Migration.
--
-- ⚠ WER DAS VERDRAHTET, MUSS DIE CACHE-GRENZE MITDENKEN: der Chat setzt heute ZWEI System-Bloecke —
-- den stabilen Teil mit `cache_control` zuerst, den wechselnden Zustandsblock dahinter. Eine
-- Erweiterung, die sich selten aendert, gehoert in den STABILEN Block; steht sie hinter dem
-- Zustandsblock, ist der Cache-Vorteil weg, und aendert sie sich haeufig, entwertet sie den Cache
-- fuer alles danach.
--
-- ── GENAU EIN OFFENER EINTRAG, UND DER CONSTRAINT SAGT DAS NICHT ────────────────────────────────
-- `unique (valid_from)` schliesst zwei Staende mit demselben Beginn aus, aber nicht zwei OFFENE mit
-- verschiedenem Beginn. Die Invariante „genau ein offener Eintrag" traegt der Funktionsrumpf
-- (Advisory-Lock + Schliessen ALLER offenen Vorgaenger, s. TEIL 5) — dieselbe Aufteilung wie beim
-- Fragenkatalog und bei grid_tariffs. Ein partieller Unique-Index auf `(valid_until is null)` waere
-- moeglich gewesen und ist bewusst NICHT gebaut: er wuerde das Heilen eines von Hand entstandenen
-- Doppelzustands (mehrere offene Zeilen) blockieren, statt es zuzulassen.
create table platform.system_prompt_extensions (
  id uuid primary key default gen_random_uuid(),

  extension_text text not null
    constraint system_prompt_extensions_text_not_blank
      check (btrim(extension_text) <> ''),

  valid_from date not null,
  valid_until date null,

  created_by uuid null references auth.users (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint system_prompt_extensions_unique_stand unique (valid_from)
);

comment on table platform.system_prompt_extensions is
  'B24: die admin-pflegbare Ergaenzung des Chat-System-Prompts (Delta §4). ERSETZT NICHT den '
  'Kern-Prompt in apps/web/lib/project-chat/system-prompt.ts — der traegt weiterhin die '
  'Verhaltensanforderungen des Deltas; diese Tabelle traegt Ton und Feinschliff, die ein Admin ohne '
  'PR aendern kann. Datierte Staende wie der Fragenkatalog, genau EIN offener Eintrag (Invariante im '
  'Funktionsrumpf, nicht im Constraint). Es gibt bewusst KEINEN Loeschweg — die Korrektur am selben '
  'Tag ersetzt den Text in place. RLS aktiv OHNE Policy, kein Tabellen-Grant.';

comment on column platform.system_prompt_extensions.extension_text is
  'Der Ergaenzungstext. Bewusst OHNE Laengengrenze im Schema: eine hier gesetzte Zahl waere eine, '
  'die niemand entschieden hat. Die Kostenseite gehoert zur Kostenbremse (Delta §6.3), einem eigenen '
  'Schritt — und ein zu langer Text scheitert am Modellaufruf sofort und sichtbar, nicht still.';

comment on column platform.system_prompt_extensions.valid_until is
  'Der LETZTE gueltige Tag, INKLUSIV. NULL = aktuell offener Stand.';

create trigger system_prompt_extensions_set_updated_at
  before update on platform.system_prompt_extensions
  for each row execute function platform.set_updated_at();

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 5 — die public-Wrapper
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── VIER DURCHGAENGIGE REGELN ───────────────────────────────────────────────────────────────────
--   1. Die fuenf `admin_*`-Wrapper WERFEN bei fehlender Adminrolle (42501) statt leer zu antworten —
--      Muster admin_list_analyses (B14-1): eine leere Liste ist bei einem noch ungefuellten Katalog
--      die haeufigste ECHTE Antwort und darf nicht zugleich „kein Zugriff" bedeuten.
--   2. Abweisungen kommen als benannter STATUS zurueck, nicht als roher Constraint-Fehler: ein 23514
--      traegt keinen Feldbezug, den eine Oberflaeche anzeigen koennte (dieselbe Aufteilung wie bei
--      den grid_tariff-Wrappern und create_my_project — Grenze im Schema, Meldung im Rumpf).
--   3. Es wird NICHTS still normalisiert ausser fuehrenden/abschliessenden Leerzeichen. Insbesondere
--      wird nicht kleingeschrieben: „Hotel" wird als `invalid_industry` ABGEWIESEN und nicht
--      unbemerkt zu „hotel" — was der Admin eingetragen hat und was gespeichert wurde, soll dasselbe
--      sein.
--   4. Die beiden Listen liefern die Gesamtzahl GETRENNT mit, damit eine Ansicht eine Kuerzung
--      offenlegen kann statt Vollstaendigkeit vorzutaeuschen (Hausregel seit admin_list_analyses).
--
-- ── ⚠ DIE ORDNUNGSREGEL, EINMAL AUSGESCHRIEBEN — SIE GILT FUER BEIDE SCHREIB-WRAPPER ────────────
-- Gegen `v_open_from` = dem spaetesten Beginn unter den derzeit OFFENEN Staenden derselben
-- Identitaet:
--
--   p_valid_from  <  v_open_from  →  {status: invalid_valid_from, open_valid_from} und KEIN
--                                    Schreibvorgang. Ein Stand, der vor dem aktuell offenen
--                                    beginnt, erzeugte eine geschlossene Zeile, deren Ende vor
--                                    ihrem Anfang liegt. Dies ist die Ordnungspflicht aus Delta
--                                    §4.2, wortgleich zu create_grid_tariff.
--   p_valid_from  =  v_open_from  →  KORREKTUR AM SELBEN STAND: der Text (bzw. Text + required)
--                                    wird IN PLACE ersetzt, {status: replaced}.
--   p_valid_from  >  v_open_from  →  NEUER STAND: alle offenen Vorgaenger werden auf
--                                    p_valid_from - 1 geschlossen, die neue Zeile angelegt,
--                                    {status: created}.
--
-- ── ⚠ WARUM DER GLEICHE TAG ERSETZT UND NICHT ABGEWIESEN WIRD — Abweichung von create_grid_tariff ─
-- Dort wird `<=` abgewiesen, und das ist dort richtig: ein Tarifstand hat einen Beginn, den ein
-- fremdes Preisblatt vorgibt, und eine Korrektur ist ein seltener Eingriff von Hand.
--
-- Hier ist beides anders. Der Beginn ist der Tag, an dem der Admin die Frage eingetragen hat, und
-- ein Tippfehler im WORTLAUT ist der Normalfall, nicht die Ausnahme. Wuerde `=` abgewiesen, gaebe es
-- fuer eine Korrektur am selben Tag nur zwei Wege, und beide waeren schlechter:
--   * ueber den Loeschweg — dann fuellte sich das Loeschprotokoll mit Tippfehler-Rauschen, und
--     genau davon lebt seine Aussagekraft (s. TEIL 3);
--   * fuer die Prompt-Erweiterung gar nicht, denn dort gibt es KEINEN Loeschweg — der Admin saesse
--     in einer Sackgasse.
-- Ein Stand, der HEUTE beginnt und HEUTE korrigiert wird, hat zudem noch kein Gespraech eines
-- anderen Tages bestimmt: es ist derselbe Stand, kein zweiter. Ein Stand eines FRUEHEREN Tages
-- bleibt unantastbar — genau das prueft die Ordnungsregel.
--
-- ── DER SPERRSCHRITT IST NICHT DEKORATION ───────────────────────────────────────────────────────
-- Gelesen wird „gibt es einen offenen Stand und wann beginnt er?", geschrieben wird abhaengig von
-- der Antwort. Ohne Sperre koennten zwei gleichzeitige Aufrufe beide „nein" lesen und beide einen
-- offenen Stand anlegen — mit verschiedenem `valid_from`, sodass der unique-Constraint NICHT
-- greift. Der Advisory-Lock serialisiert genau die betroffene Identitaet und endet mit der
-- Transaktion. `coalesce(industry, '')` im Schluessel, weil ein null-Anteil den ganzen Schluessel
-- null machte — dieselbe Falle, die das `nulls not distinct` motiviert.
--
-- ── MEHRERE OFFENE STAENDE WERDEN ALLE GESCHLOSSEN ──────────────────────────────────────────────
-- Der Zustand soll nicht entstehen, kann aber aus einem Eingriff von Hand stammen. Nur einen davon
-- zu schliessen hiesse, den Fehler zu halbieren und stehen zu lassen (Vorbild create_grid_tariff).

-- ── admin_create_question_catalog_entry ─────────────────────────────────────────────────────────
-- ⚠ `p_required` UND `p_industry` STEHEN AM ENDE, UND ZWAR NICHT AUS NACHLAESSIGKEIT: sie sind die
-- einzigen Parameter mit Vorgabewert, und PostgreSQL verlangt, dass alle Parameter NACH einem mit
-- Vorgabewert ebenfalls einen tragen. Weiter vorne stehend zwaengen sie also auch `p_valid_from` zu
-- einem optionalen Parameter — ein Aufruf ohne Gueltigkeitsbeginn liefe dann durch. Fuer den
-- Aufrufer ist die Position ohne Bedeutung: PostgREST ruft mit BENANNTEN Argumenten auf. Dieselbe
-- Lehre wie `p_metering_variant` in create_grid_tariff (B21-2b).
--
-- ⚠ `p_valid_from` IST EIN PARAMETER UND KEIN `current_date` IM RUMPF. Damit ist die Ordnungspflicht
-- ueberhaupt erst pruefbar — ein Rumpf, der immer „heute" einsetzt, kann per Konstruktion nie einen
-- zu fruehen Stand bekommen, und die Regel waere eine Behauptung ohne Gegenprobe.
create function public.admin_create_question_catalog_entry(
  p_segment       text,
  p_question_key  text,
  p_question_text text,
  p_valid_from    date,
  p_required      boolean default true,
  p_industry      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_segment     text := nullif(btrim(coalesce(p_segment, '')), '');
  v_key         text := nullif(btrim(coalesce(p_question_key, '')), '');
  v_text        text := nullif(btrim(coalesce(p_question_text, '')), '');
  v_industry    text := nullif(btrim(coalesce(p_industry, '')), '');
  v_open_from   date;
  v_close_ids   uuid[];
  v_replace_ids uuid[];
  v_id          uuid;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_create_question_catalog_entry: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  if v_segment is null or v_segment not in ('privat', 'betrieb') then
    return jsonb_build_object('status', 'invalid_segment');
  end if;

  -- Das Format wird HIER geprueft und nicht dem CHECK ueberlassen, damit die Oberflaeche sagen kann,
  -- WELCHE Angabe falsch war (Regel 2 oben). Der CHECK bleibt trotzdem im Schema — er ist die
  -- Grenze, diese Zeile ist die Meldung.
  if v_key is null or v_key !~ '^[a-z0-9][a-z0-9_]*$' then
    return jsonb_build_object('status', 'invalid_question_key');
  end if;

  if v_text is null then
    return jsonb_build_object('status', 'invalid_question_text');
  end if;

  if v_industry is not null and v_industry !~ '^[a-z0-9][a-z0-9_]*$' then
    return jsonb_build_object('status', 'invalid_industry');
  end if;

  if p_valid_from is null then
    return jsonb_build_object('status', 'invalid_valid_from');
  end if;

  perform pg_advisory_xact_lock(
    hashtext('question_catalog:' || v_segment || ':' || coalesce(v_industry, '') || ':' || v_key)
  );

  -- Die Zeilensperre steht IM Unterausdruck, nicht neben den Aggregaten: `for update` ist neben
  -- einer Aggregatfunktion nicht zulaessig (0A000 — beim Bau von B21-2b real aufgeschlagen).
  select array_agg(o.id) filter (where o.valid_from < p_valid_from),
         array_agg(o.id) filter (where o.valid_from = p_valid_from),
         max(o.valid_from)
    into v_close_ids, v_replace_ids, v_open_from
    from (
      select e.id, e.valid_from
        from platform.question_catalog_entries e
       where e.segment = v_segment
         and e.industry is not distinct from v_industry
         and e.question_key = v_key
         and e.valid_until is null
         for update
    ) o;

  if v_open_from is not null and p_valid_from < v_open_from then
    -- Bewusst OHNE Schreibvorgang zurueck: eine abgelehnte Anlage darf die bestehende Lage nicht
    -- veraendert haben.
    return jsonb_build_object(
      'status', 'invalid_valid_from',
      'open_valid_from', v_open_from
    );
  end if;

  if v_close_ids is not null then
    update platform.question_catalog_entries
       set valid_until = p_valid_from - 1
     where id = any(v_close_ids);
  end if;

  -- KORREKTUR AM SELBEN STAND (s. Kopf dieses Teils). `question_key`, `segment` und `industry`
  -- bleiben ausdruecklich unberuehrt — sie SIND die Identitaet; wer sie aendern will, legt einen
  -- anderen Stand an und loescht diesen.
  if v_replace_ids is not null then
    update platform.question_catalog_entries
       set question_text = v_text,
           required      = coalesce(p_required, true)
     where id = any(v_replace_ids)
    returning id into v_id;

    return jsonb_build_object(
      'status', 'replaced',
      'id', v_id,
      'closed_count', coalesce(array_length(v_close_ids, 1), 0)
    );
  end if;

  begin
    insert into platform.question_catalog_entries (
      segment, industry, question_key, question_text, required, valid_from, created_by
    ) values (
      v_segment, v_industry, v_key, v_text, coalesce(p_required, true), p_valid_from, auth.uid()
    )
    returning id into v_id;
  exception
    -- Ein bereits ARCHIVIERTER Stand mit genau diesem `valid_from` (der offene liegt davor, die
    -- Ordnungspruefung greift deshalb nicht). Der Constraint ist die Wahrheit; hier bekommt er nur
    -- einen Namen, mit dem die Oberflaeche etwas anfangen kann.
    when unique_violation then
      return jsonb_build_object('status', 'duplicate_valid_from');
  end;

  return jsonb_build_object(
    'status', 'created',
    'id', v_id,
    'closed_count', coalesce(array_length(v_close_ids, 1), 0),
    'closed_valid_until', case when v_close_ids is null then null else p_valid_from - 1 end
  );
end;
$$;

comment on function public.admin_create_question_catalog_entry(text, text, text, date, boolean, text) is
  'B24: legt einen Fragen-Stand an und schliesst die offenen Vorgaenger derselben Identitaet '
  '(segment, industry, question_key) in DERSELBEN Transaktion auf valid_from - 1. Ein Stand VOR dem '
  'aktuell offenen wird als {status: invalid_valid_from, open_valid_from} abgewiesen (Ordnungspflicht '
  'aus Delta §4.2, Vorbild create_grid_tariff); GENAU AM Beginn des offenen Standes wird dessen Text '
  'in place ersetzt ({status: replaced}) — die Korrektur am selben Tag, damit ein Tippfehler nicht '
  'ueber den Loeschweg gehen muss. p_industry null = Baseline des Segments. Setzt created_by = '
  'auth.uid(): der Urheber ist der Aufrufer, nicht eine Angabe. WIRFT ohne Adminrolle (42501).';

-- ── admin_delete_question_catalog_entry ─────────────────────────────────────────────────────────
-- ⚠ WAS DAS LOESCHEN DES OFFENEN STANDES BEDEUTET, und es ist Absicht: die Vorgaengerin bleibt
-- GESCHLOSSEN. Die Frage hat danach keinen geltenden Stand mehr — sie ist zurueckgezogen. Das ist
-- ein legitimer Endzustand (eine Frage, die nicht mehr gestellt wird), und die Kette bleibt
-- vollstaendig lesbar. Die Vorgaengerin automatisch wieder zu oeffnen waere ein nachtraegliches
-- Umschreiben der Geschichte: sie hat den Zeitraum danach nachweislich NICHT bestimmt.
create function public.admin_delete_question_catalog_entry(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snapshot jsonb;
  v_email    text;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_delete_question_catalog_entry: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  -- `to_jsonb(e)` nimmt ALLE Spalten mit, auch kuenftig hinzukommende (s. TEIL 3). Die Zeilensperre
  -- verhindert, dass zwei gleichzeitige Aufrufe beide denselben Abzug lesen und beide einen
  -- Protokolleintrag schreiben, waehrend nur eine Loeschung stattfindet: der zweite Aufruf wartet
  -- und findet die Zeile danach nicht mehr — also genau die Wahrheit.
  select to_jsonb(e) into v_snapshot
    from platform.question_catalog_entries e
   where e.id = p_id
     for update;

  if v_snapshot is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Die Adresse als ABZUG (s. TEIL 3). `auth.users` ist fuer keine Client-Rolle lesbar; dieser
  -- Wrapper ist SECURITY DEFINER und darf sie aufloesen. Ein Konto ohne Adresse (in Supabase bei
  -- reinen Telefon-Konten moeglich) faellt auf die Kennung zurueck — die Spalte darf nicht leer
  -- bleiben, sonst haette das Protokoll genau dort eine Luecke, wo es eine Aussage machen soll.
  select au.email into v_email from auth.users au where au.id = auth.uid();

  insert into platform.question_catalog_deletions (
    entry_id, deleted_by, deleted_by_email, entry_snapshot
  ) values (
    p_id, auth.uid(), coalesce(nullif(btrim(coalesce(v_email, '')), ''), auth.uid()::text), v_snapshot
  );

  delete from platform.question_catalog_entries where id = p_id;

  return jsonb_build_object('status', 'deleted', 'id', p_id);
end;
$$;

comment on function public.admin_delete_question_catalog_entry(uuid) is
  'B24: loescht EINEN Fragen-Stand und schreibt in DERSELBEN Transaktion einen vollstaendigen Abzug '
  'nach platform.question_catalog_deletions (Delta §4.2, offener Punkt 9). Unbekannte Kennung → '
  '{status: not_found}. ⚠ Ist es der offene Stand, bleibt die Vorgaengerin GESCHLOSSEN — die Frage '
  'ist danach zurueckgezogen; sie automatisch wieder zu oeffnen waere ein nachtraegliches '
  'Umschreiben der Geschichte. Fuer einen blossen Tippfehler ist NICHT dieser Weg gedacht, sondern '
  'die Korrektur am selben Tag (admin_create_question_catalog_entry → replaced). WIRFT ohne '
  'Adminrolle (42501).';

-- ── admin_list_question_catalog ─────────────────────────────────────────────────────────────────
-- Liefert ALLE Staende, auch die archivierten — das ist die Pflegeansicht, und ohne die Geschichte
-- liesse sich eine Kette nicht nachvollziehen.
--
-- ⚠ ES GIBT BEWUSST KEINEN `p_industry`-FILTER. Er waere zweideutig: `null` hiesse dort zugleich
-- „nicht filtern" und „nur die Baseline" — dieselbe Mehrdeutigkeit, die auf Datenebene das
-- `nulls not distinct` erzwingt, hier aber an der Schnittstelle, wo kein Constraint sie abfangen
-- kann. Die Filterung nach Branche gehoert in die Ansicht; die Menge ist dafuer klein genug.
create function public.admin_list_question_catalog(
  p_segment text default null,
  p_limit   integer default 50,
  p_offset  integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_segment text := nullif(btrim(coalesce(p_segment, '')), '');
  v_limit   integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset  integer := greatest(coalesce(p_offset, 0), 0);
  v_total   integer;
  v_rows    jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_list_question_catalog: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  if v_segment is not null and v_segment not in ('privat', 'betrieb') then
    return jsonb_build_object('status', 'invalid_segment');
  end if;

  with base as (
    select e.id, e.segment, e.industry, e.question_key, e.question_text, e.required,
           e.valid_from, e.valid_until, e.created_by, e.created_at, e.updated_at
      from platform.question_catalog_entries e
     where v_segment is null or e.segment = v_segment
  ),
  page as (
    -- Nach IDENTITAET gruppiert, innerhalb einer Identitaet der neueste Stand zuerst: so steht in
    -- der Ansicht die geltende Fassung oben und ihre Geschichte darunter. Baseline vor Branche,
    -- weil sie fuer jedes Projekt des Segments gilt und die Zusatzfragen nur ergaenzen.
    select b.*
      from base b
     order by b.segment,
              (b.industry is null) desc,
              b.industry nulls first,
              b.question_key,
              b.valid_from desc
     limit v_limit offset v_offset
  )
  select (select count(*)::integer from base),
         coalesce(
           (select jsonb_agg(
                     to_jsonb(p) || jsonb_build_object(
                       -- auth.users ist fuer keine Client-Rolle lesbar; die Aufloesung gehoert
                       -- deshalb hierher (Muster admin_list_projects/admin_list_analyses).
                       'created_by_email',
                       (select au.email from auth.users au where au.id = p.created_by)
                     )
                     order by p.segment,
                              (p.industry is null) desc,
                              p.industry nulls first,
                              p.question_key,
                              p.valid_from desc
                   )
              from page p),
           '[]'::jsonb
         )
    into v_total, v_rows;

  return jsonb_build_object('status', 'ok', 'total', v_total, 'entries', v_rows);
end;
$$;

comment on function public.admin_list_question_catalog(text, integer, integer) is
  'B24: der Fragenkatalog als PFLEGEANSICHT — alle Staende, auch die archivierten, seitenweise '
  '(Obergrenze 200 je Aufruf) und MIT Gesamtzahl, damit die Ansicht eine Kuerzung offenlegen kann. '
  'Sortiert nach Identitaet (Segment, Baseline vor Branche, question_key), innerhalb einer Identitaet '
  'neuester Stand zuerst. Loest created_by_email auf. Bewusst OHNE Branchen-Filter: ein '
  'p_industry-Parameter waere zwischen „nicht filtern" und „nur Baseline" zweideutig. WIRFT ohne '
  'Adminrolle (42501).';

-- ── list_question_catalog ───────────────────────────────────────────────────────────────────────
-- Der Lesepfad des Chats (Delta §4.3: „er entscheidet, DASS er den Hotel-Pool laden muss").
--
-- ⚠ NUR DER HEUTE GELTENDE STAND, UND KEIN STICHTAG-PARAMETER. Die Frage, die der Chat hat, lautet
-- „welche Pflichtfragen gelten JETZT fuer dieses Segment" — mehr braucht er nicht. Ein
-- Stichtag-Parameter saehe aus wie der Weg, einen historischen Katalogstand zu rekonstruieren, und
-- waere genau das NICHT: ein geloeschter Stand ist aus dieser Tabelle verschwunden (nur sein Abzug
-- im Loeschprotokoll bleibt), eine Abfrage mit vergangenem Stichtag liefe also an ihm vorbei und
-- behauptete Vollstaendigkeit. Die Reproduzierbarkeit aus Delta §4.2 leistet der DENORMALISIERT
-- mitgefuehrte Katalog-Stand am Projekt — deshalb liefert diese Funktion die Kennungen und
-- valid_from der geltenden Staende mit, damit der Verdrahtungs-Schritt sie festhalten kann.
--
-- ⚠ `valid_until` WIRD INKLUSIV GELESEN (`>= current_date`). Halboffen gelesen verloere jeder Stand
-- seinen letzten Tag — dieselbe Falle, die B21-3b fuer die Engine benannt hat.
--
-- KEINE Sitzungspruefung ueber das EXECUTE-Grant hinaus: der Katalog ist admin-verfasste
-- Referenzstruktur ohne Personenbezug und ohne Projektbezug. Es gibt hier nichts, was einem
-- angemeldeten Konto gehoerte und einem anderen nicht — anders als bei jedem Wrapper des
-- Chat-Zustands, wo genau das der Fall ist.
create function public.list_question_catalog(
  p_segment  text,
  p_industry text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_segment  text := nullif(btrim(coalesce(p_segment, '')), '');
  v_industry text := nullif(btrim(coalesce(p_industry, '')), '');
  v_rows     jsonb;
begin
  if v_segment is null or v_segment not in ('privat', 'betrieb') then
    return jsonb_build_object('status', 'invalid_segment');
  end if;

  -- Baseline vor Branche, danach nach Schluessel — eine stabile, erklaerbare Reihenfolge und
  -- ausdruecklich KEINE Vorgabe, in welcher Reihenfolge der Chat fragt: das entscheidet er selbst
  -- (Delta §3.2/§4.3). Sie ist da, damit zwei Abrufe desselben Standes vergleichbar sind.
  select coalesce(
           jsonb_agg(to_jsonb(e) order by (e.industry is null) desc, e.question_key),
           '[]'::jsonb
         )
    into v_rows
  from (
    select q.id, q.segment, q.industry, q.question_key, q.question_text, q.required, q.valid_from
      from platform.question_catalog_entries q
     where q.segment = v_segment
       -- Baseline IMMER, Zusatzfragen nur fuer die uebergebene Branche. Ohne p_industry bleibt es
       -- bei der Baseline — ein Projekt ohne bestimmte Branche bekommt keinen fremden Pool.
       and (q.industry is null or (v_industry is not null and q.industry = v_industry))
       and q.valid_from <= current_date
       and (q.valid_until is null or q.valid_until >= current_date)
  ) e;

  return jsonb_build_object(
    'status', 'ok',
    'segment', v_segment,
    'industry', v_industry,
    'entries', v_rows
  );
end;
$$;

comment on function public.list_question_catalog(text, text) is
  'B24: die HEUTE geltenden Pflichtfragen eines Segments — Baseline immer, dazu die Zusatzfragen der '
  'uebergebenen Branche (Delta §3.2/§4.3). Ohne p_industry bleibt es bei der Baseline. Liefert '
  'ausschliesslich gueltige Staende (valid_until INKLUSIV) und traegt id und valid_from mit, damit '
  'der spaetere Verdrahtungs-Schritt den Katalog-Stand denormalisiert festhalten kann (Delta §4.2). '
  'Bewusst OHNE Stichtag-Parameter: eine Abfrage mit vergangenem Stichtag liefe an geloeschten '
  'Staenden vorbei und behauptete dabei Vollstaendigkeit. Unbekanntes Segment → '
  '{status: invalid_segment}, nicht eine leere Liste (die saehe aus wie „nichts gepflegt"). '
  'authenticated-only; der Katalog ist Referenzstruktur ohne Personen- und Projektbezug.';

-- ── admin_set_system_prompt_extension ───────────────────────────────────────────────────────────
-- Dieselbe Ordnungsregel wie oben, nur ohne Identitaets-Tupel: es gibt genau EINE Kette. Der
-- Advisory-Lock traegt deshalb einen konstanten Schluessel.
--
-- ⚠ `p_valid_from` HAT HIER EINEN VORGABEWERT (`current_date`), damit der im Auftrag genannte Aufruf
-- `admin_set_system_prompt_extension(p_text)` gueltig bleibt. Der Parameter existiert trotzdem, und
-- zwar aus demselben Grund wie beim Fragenkatalog: ohne ihn koennte die Ordnungspflicht per
-- Konstruktion nie verletzt werden und waere eine Behauptung ohne Gegenprobe.
create function public.admin_set_system_prompt_extension(
  p_text       text,
  p_valid_from date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_text        text := nullif(btrim(coalesce(p_text, '')), '');
  v_from        date := coalesce(p_valid_from, current_date);
  v_open_from   date;
  v_close_ids   uuid[];
  v_replace_ids uuid[];
  v_id          uuid;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_set_system_prompt_extension: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  -- Ein leerer Text ist keine Loeschung. Wer die Erweiterung abschalten will, braucht dafuer einen
  -- eigenen, bewussten Weg — ihn hier ueber einen Leerstring einzubauen hiesse, zwei sehr
  -- verschiedene Vorgaenge unter einen Aufruf zu legen (s. TEIL 7).
  if v_text is null then
    return jsonb_build_object('status', 'invalid_text');
  end if;

  perform pg_advisory_xact_lock(hashtext('system_prompt_extension'));

  select array_agg(o.id) filter (where o.valid_from < v_from),
         array_agg(o.id) filter (where o.valid_from = v_from),
         max(o.valid_from)
    into v_close_ids, v_replace_ids, v_open_from
    from (
      select x.id, x.valid_from
        from platform.system_prompt_extensions x
       where x.valid_until is null
         for update
    ) o;

  if v_open_from is not null and v_from < v_open_from then
    return jsonb_build_object(
      'status', 'invalid_valid_from',
      'open_valid_from', v_open_from
    );
  end if;

  if v_close_ids is not null then
    update platform.system_prompt_extensions
       set valid_until = v_from - 1
     where id = any(v_close_ids);
  end if;

  if v_replace_ids is not null then
    update platform.system_prompt_extensions
       set extension_text = v_text
     where id = any(v_replace_ids)
    returning id into v_id;

    return jsonb_build_object(
      'status', 'replaced',
      'id', v_id,
      'closed_count', coalesce(array_length(v_close_ids, 1), 0)
    );
  end if;

  begin
    insert into platform.system_prompt_extensions (extension_text, valid_from, created_by)
    values (v_text, v_from, auth.uid())
    returning id into v_id;
  exception
    when unique_violation then
      return jsonb_build_object('status', 'duplicate_valid_from');
  end;

  return jsonb_build_object(
    'status', 'created',
    'id', v_id,
    'closed_count', coalesce(array_length(v_close_ids, 1), 0),
    'closed_valid_until', case when v_close_ids is null then null else v_from - 1 end
  );
end;
$$;

comment on function public.admin_set_system_prompt_extension(text, date) is
  'B24: setzt die System-Prompt-Erweiterung als neuen datierten Stand und schliesst den offenen '
  'Vorgaenger auf valid_from - 1. Beginnt der offene Stand am SELBEN Tag, wird sein Text in place '
  'ersetzt ({status: replaced}) — hier ist das die einzige Korrekturmoeglichkeit, denn diese Tabelle '
  'hat bewusst KEINEN Loeschweg. Ein Stand VOR dem offenen wird abgewiesen (Ordnungspflicht). Ein '
  'leerer Text ist KEINE Abschaltung, sondern {status: invalid_text}. ERSETZT NICHT den Kern-Prompt '
  'in apps/web/lib/project-chat/system-prompt.ts. WIRFT ohne Adminrolle (42501).';

-- ── admin_get_system_prompt_extension ───────────────────────────────────────────────────────────
-- ⚠ LIEST DEN OFFENEN STAND (`valid_until is null`), NICHT den heute geltenden — und das ist der
-- Unterschied zu get_system_prompt_extension unten. Der Admin bearbeitet den Stand, den er zuletzt
-- gesetzt hat, auch wenn dieser (ueber einen p_valid_from in der Zukunft) heute noch gar nicht
-- gilt. Ihm stattdessen den heute geltenden zu zeigen hiesse, ihn eine Fassung bearbeiten zu lassen,
-- die er gerade abgeloest hat.
create function public.admin_get_system_prompt_extension()
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
    raise exception 'public.admin_get_system_prompt_extension: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select to_jsonb(e) || jsonb_build_object(
           'created_by_email',
           (select au.email from auth.users au where au.id = e.created_by)
         )
    into v_row
  from (
    select x.id, x.extension_text, x.valid_from, x.valid_until, x.created_by,
           x.created_at, x.updated_at
      from platform.system_prompt_extensions x
     where x.valid_until is null
     order by x.valid_from desc
     limit 1
  ) e;

  if v_row is null then
    return jsonb_build_object('status', 'none');
  end if;

  return jsonb_build_object('status', 'ok', 'extension', v_row);
end;
$$;

comment on function public.admin_get_system_prompt_extension() is
  'B24: der aktuell OFFENE Stand der System-Prompt-Erweiterung samt aufgeloester Urheber-Adresse — '
  'die Fassung, die der Admin bearbeitet. Bewusst NICHT der heute geltende Stand (das ist '
  'get_system_prompt_extension): ein zukuenftig beginnender Stand soll bearbeitbar bleiben. Noch '
  'nie etwas gesetzt → {status: none}. WIRFT ohne Adminrolle (42501).';

-- ── get_system_prompt_extension ─────────────────────────────────────────────────────────────────
-- Der Lesepfad des Chats. Liest den HEUTE geltenden Stand (Fenster wie list_question_catalog,
-- `valid_until` INKLUSIV) und liefert ausschliesslich den Text und die Kennung des Standes — die
-- Kennung, damit der Verdrahtungs-Schritt festhalten kann, welche Fassung ein Gespraech bestimmt hat.
--
-- ⚠ OFFENGELEGT: jede angemeldete Sitzung kann diesen Text lesen. Das ist kein Versehen, sondern die
-- Folge des Aufbaus — der Chat laeuft in `apps/web` als das ANGEMELDETE KONTO des Kunden (der
-- gesamte Zugriffsschutz der Projekt-Wrapper haengt an auth.uid()), es gibt also keine Rolle, unter
-- der er lesen koennte, die der Kunde nicht auch hat. Der Text ist eine ANWEISUNG an das Modell und
-- kein Geheimnis; wer im Chat danach fragt, bekaeme sie ohnehin sinngemaess zu sehen. Wer hier je
-- etwas Vertrauliches eintraegt, hat es damit veroeffentlicht — der Kommentar an der Spalte und
-- diese Zeile sind die Stelle, an der das steht.
create function public.get_system_prompt_extension()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id   uuid;
  v_text text;
  v_from date;
begin
  select x.id, x.extension_text, x.valid_from
    into v_id, v_text, v_from
    from platform.system_prompt_extensions x
   where x.valid_from <= current_date
     and (x.valid_until is null or x.valid_until >= current_date)
   order by x.valid_from desc
   limit 1;

  if v_id is null then
    -- „Es gibt keine Erweiterung" ist der Normalzustand, solange niemand eine gepflegt hat — und
    -- ausdruecklich kein Fehler: der Kern-Prompt traegt das Verhalten auch allein.
    return jsonb_build_object('status', 'none');
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'id', v_id,
    'extension_text', v_text,
    'valid_from', v_from
  );
end;
$$;

comment on function public.get_system_prompt_extension() is
  'B24: der HEUTE geltende Stand der System-Prompt-Erweiterung, fuer die spaetere Verdrahtung an das '
  'Modell. Liefert id und valid_from mit, damit festhaltbar ist, welche Fassung ein Gespraech '
  'bestimmt hat. Keine gepflegte Erweiterung → {status: none}, kein Fehler — der Kern-Prompt traegt '
  'das Verhalten auch allein. authenticated-only; ⚠ jede angemeldete Sitzung kann den Text damit '
  'lesen (der Chat laeuft als das Konto des Kunden — es gibt keine engere Rolle). Der Text ist eine '
  'Anweisung an das Modell, kein Geheimnis.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 6 — RLS und Rechte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Muster platform.accounts/projects (Fundament), platform.project_messages (Chat-Zustand),
-- platform.analyses (B14-1), platform.job_runs (B4-1): RLS an, KEINE Policy, fuer KEINE Rolle ein
-- Tabellen-Grant — auch nicht fuer service_role. Zwei unabhaengige Schichten: ohne Policy saehe
-- selbst eine Rolle nichts, der jemand spaeter versehentlich ein Tabellenrecht gaebe.
--
-- ⚠ FUER DAS LOESCHPROTOKOLL IST DAS ZUGLEICH SEINE UNVERAENDERLICHKEIT. Es gibt keinen Wrapper,
-- der es aendert oder loescht, und kein Grant, mit dem es jemand direkt anfassen koennte — genau
-- der Mechanismus, mit dem der Chat-Verlauf seine Unveraenderlichkeit traegt (20260910090000
-- TEIL 9), und ausdruecklich NICHT ein Trigger: der wuerde das referentielle SET NULL auf
-- `deleted_by` abweisen und damit das Loeschen eines Admin-Kontos blockieren.
alter table platform.question_catalog_entries    enable row level security;
alter table platform.question_catalog_deletions  enable row level security;
alter table platform.system_prompt_extensions    enable row level security;

-- Supabase vergibt per ALTER DEFAULT PRIVILEGES auf NEUE public-Funktionen automatisch EXECUTE an
-- anon, authenticated UND service_role (zusaetzlich zum PostgreSQL-Default-Grant an PUBLIC). Deshalb
-- wie ueberall: erst allen entziehen, dann gezielt gewaehren.
--
-- `anon` bekommt NIRGENDS etwas. `service_role` ebenfalls nicht, und das ist hier eine Aussage und
-- keine Formsache: alle sieben Wrapper leiten ihre Autorisierung aus platform.is_admin() bzw. dem
-- authenticated-Grant ab, und is_admin() ist unter service_role false — die fuenf admin_*-Wrapper
-- waeren dort funktionslos und stets abgelehnt, die zwei Lese-Wrapper eine Tuer, die den
-- Sitzungsbezug umgeht, den dieses Schema ueberall sonst verlangt.
revoke all on function public.admin_create_question_catalog_entry(text, text, text, date, boolean, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_delete_question_catalog_entry(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_list_question_catalog(text, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.list_question_catalog(text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_set_system_prompt_extension(text, date)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_get_system_prompt_extension()
  from public, anon, authenticated, service_role;
revoke all on function public.get_system_prompt_extension()
  from public, anon, authenticated, service_role;

grant execute on function public.admin_create_question_catalog_entry(text, text, text, date, boolean, text)
  to authenticated;
grant execute on function public.admin_delete_question_catalog_entry(uuid) to authenticated;
grant execute on function public.admin_list_question_catalog(text, integer, integer) to authenticated;
grant execute on function public.list_question_catalog(text, text) to authenticated;
grant execute on function public.admin_set_system_prompt_extension(text, date) to authenticated;
grant execute on function public.admin_get_system_prompt_extension() to authenticated;
grant execute on function public.get_system_prompt_extension() to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 7 — was es hier BEWUSST NICHT GIBT
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠ KEIN SCHREIBWEG FUER `platform.projects.industry`. Die Spalte existiert, hat aber weder einen
-- Wrapper, der sie setzt, noch einen, der sie liest — `update_project_draft` und `get_project`
-- (Chat-Zustand) sind mit 0 Zeilen Diff unangetastet. Das ist Absicht und zugleich die groesste
-- benannte Luecke dieses Schritts: die BEIDEN ENDEN stehen (das Feld am Projekt, der Katalog-Leser,
-- der eine Branche entgegennimmt), das Stueck dazwischen ist die Verdrahtung, und die ist laut
-- Auftrag ein eigener Schritt. Praezedenz im selben Bogen: `project_open_questions.impact_note` hat
-- seit dem Chat-Zustand eine Spalte und einen Schreibweg und bis heute keinen Erzeuger (Delta §9
-- Punkt 10).
--   ⇒ Wer das verdrahtet, erweitert `public.update_project_draft` um `p_industry` und `get_project`
--     um die Spalte. ⚠ DAS IST EIN DROP+CREATE, KEIN `create or replace`: ein zusaetzlicher
--     Parameter aendert die Signatur, `create or replace` legte eine zweite ueberladene Funktion
--     daneben statt die bestehende zu ersetzen — und die Grants sind danach erneut zu setzen (im
--     Repo mehrfach so gemacht, u. a. beim Namens-Split und in B4-1).
--
-- KEIN Wrapper, der einen Fragen-Stand ANDERT. Die Korrektur am selben Tag laeuft ueber
-- admin_create_question_catalog_entry (`replaced`), eine Aenderung an einem AELTEREN Stand ist
-- ausgeschlossen — sie verschoebe nachtraeglich, was ein bereits gefuehrtes Gespraech bestimmt hat.
--
-- ⚠ KEIN Weg, einen Fragen-Stand zu SCHLIESSEN, ohne einen neuen anzulegen. Ein `valid_until` laesst
-- sich nur setzen, indem ein Nachfolger entsteht; eine Frage zurueckzuziehen geht heute
-- ausschliesslich ueber den LOESCHWEG (der protokolliert, aber die Zeile entfernt). Der Unterschied
-- ist real: „diese Frage galt bis zum 30.09. und danach nicht mehr" laesst sich derzeit nicht
-- ausdruecken, ohne den Stand zu opfern. Ein `admin_retire_question_catalog_entry(p_id, p_valid_until)`
-- waere die saubere Ergaenzung — der Auftrag dieses Schritts zaehlt die Wrapper abschliessend auf,
-- und ein vierter waere eine stille Erweiterung gewesen. Als offener Punkt benannt, nicht vergessen.
--
-- KEIN Lese-Wrapper auf platform.question_catalog_deletions. Wortgleich zu grid_tariff_deletions
-- (B21-2c): es gibt keine Oberflaeche, die das Protokoll durchsucht, und ein ungenutzter Lesepfad
-- waere nur eine zusaetzliche Flaeche. Gelesen wird bei Bedarf im SQL-Editor; die Zeilen sind fuer
-- keine Client-Rolle erreichbar.
--
-- KEIN Loeschweg fuer die System-Prompt-Erweiterung und KEIN „Abschalten". Ein leerer Text wird
-- abgewiesen (`invalid_text`) statt als Abschaltung gedeutet: „ich will keine Erweiterung mehr"
-- und „ich habe versehentlich ein leeres Feld abgeschickt" saehen sonst identisch aus, und der
-- Unterschied waere nachtraeglich nicht mehr feststellbar. Wer das Abschalten braucht, baut einen
-- eigenen, benannten Wrapper dafuer.
--
-- KEINE Laengengrenze auf `extension_text` und KEINE Kostenbremse. Delta §6.3 ist ein eigener,
-- ausdruecklich an die Oberflaeche gekoppelter Schritt; eine hier gesetzte Zahl waere eine, die
-- niemand entschieden hat.
--
-- KEINE Aufbewahrungsfrist. platform.run_lead_retention (B4-1) fasst diese Tabellen nicht an — sie
-- tragen allerdings auch keinen Kundentext, sondern admin-verfasste Struktur; die offene juristische
-- Frage aus DEPLOYMENT.md §7 waechst durch diesen Schritt NICHT (anders als beim Chat-Zustand).
-- Einzige personenbezogene Angabe ist die Urheber-Adresse im Loeschprotokoll — dieselbe Lage wie
-- grid_tariff_deletions.deleted_by, und aus demselben Grund (Nachvollziehbarkeit) dort belassen.
--
-- KEINE Befuellung. Welche Fragen ein Segment oder ein Branchen-Pool traegt, ist Fachwissen
-- (Delta §4.4, Owner Andreas/Martin). Eine hier erfundene Pflichtfrage saehe im Bestand aus wie
-- eine fachlich abgestimmte.
