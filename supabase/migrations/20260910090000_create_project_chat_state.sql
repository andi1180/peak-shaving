-- B24, zweiter Bauschritt — der ZUSTAND des Chats: Konversation, Entwurf, offene Rückfragen, Dateien
-- (kanonisch: `Pflichtenheft_Kalkulator_Delta_KI-Interface.md` §2.2, §3.1–§3.3 und §7; Reihenfolge
-- `Fahrplan_2026.md`, B24. Der Vorgänger ist `20260909120000_create_account_project_foundation.sql`
-- samt seinem Nachtrag `20260909150000_add_project_created_by.sql`.)
--
-- ── WAS HIER ENTSTEHT, IN EINEM SATZ ────────────────────────────────────────────────────────────
-- Der Platz, an dem ein laufendes Gespräch liegt, bevor daraus eine Analyse wird: der
-- Turn-für-Turn-Verlauf, der wachsende Entwurf des Eingabe-Contracts, die Rückfragen, die der Chat
-- nicht selbst beantworten kann, und die Dateien, die der Kunde dazu hochlädt.
--
--   TEIL 1  `platform.projects` wächst um `segment` und `draft`
--   TEIL 2  `platform.project_messages`        — der Verlauf
--   TEIL 3  `platform.project_documents`       — die Verweise auf die Dateien im Storage-Bucket
--   TEIL 4  `platform.project_open_questions`  — Weg (a)/(b) aus §3.3
--   TEIL 5  `platform.project_accessible`      — EINE Zugriffsentscheidung, zwölf Konsumenten
--   TEIL 6  die zwölf `public`-Wrapper
--   TEIL 7  der private Storage-Bucket
--   TEIL 8  RLS und Rechte
--   TEIL 9  was es hier bewusst NICHT gibt
--
-- ── WAS AUSDRÜCKLICH NICHT ENTSTEHT ─────────────────────────────────────────────────────────────
-- KEINE Chat-Logik, KEIN Anthropic-Aufruf, KEIN Tool-Use, KEIN System-Prompt (§3 — eigener Schritt).
-- KEIN Fragenkatalog und keine Pflichtfragen-Tabelle (§4 — die Platzhalter-Prüfung kommt mit dem
-- Chat, nicht hier). KEINE Kostenbremse (§6.3, offener Punkt 4). KEINE Zählpunkte und KEINE
-- Rollup-Schicht (§2.3/§2.4 — laut Delta „der grösste einzelne technische Brocken", eigener Schritt).
-- KEINE Verkettung zu `platform.analyses`. KEINE Vorsteuerabzugs-/USt-Spalte (gerechnet wird
-- durchgängig netto, `packages/shared/src/tariff.ts`; die Brutto-Anzeige ist Report-Arbeit).
-- KEINE automatische `calculator_pro`-Vergabe (§6.2, offener Punkt 8). KEIN `tenant_id` (B13).
--
-- UNVERÄNDERT bleiben alle sieben Wrapper des Fundaments (`get_or_create_my_account`,
-- `create_my_project`, `list_my_projects`, `get_my_project`, `admin_create_project`,
-- `admin_list_projects`, `admin_get_project`), `platform.ensure_account`, `platform.accounts` und
-- jede bestehende Tabelle des Schemas. `create_my_project` bekommt bewusst KEINEN neuen Parameter:
-- `draft` startet als leeres Objekt, `segment` als NULL — beides bestimmt erst das Gespräch.
--
-- ── KONVENTIONEN (exakt T4-1/B1-1/B14-1/B16-1/B16-4b und das Fundament) ─────────────────────────
-- Alles Fachliche in `platform` (nicht über die REST-API exponiert, `supabase/config.toml`), Zugriff
-- von aussen ausschliesslich über SECURITY-DEFINER-Wrapper im `public`-Schema, alle Funktionen mit
-- `SET search_path = ''` und vollqualifizierten Objektnamen. RLS an, KEINE Policy, für KEINE Rolle
-- ein Tabellen-Grant — auch nicht für `service_role`. `anon` und `service_role` bekommen bei den
-- Wrappern NIRGENDS ein EXECUTE: jede dieser Funktionen leitet ihre Autorisierung aus `auth.uid()`
-- bzw. `platform.is_admin()` ab, was dort null bzw. false ist.
--
-- ── ARBEITSREGEL 1 (Funktionsrümpfe) ────────────────────────────────────────────────────────────
-- Es wird keine Spalte gelöscht oder umbenannt. Die Regel greift in ihrer Umkehrung (B16-4b): die
-- zwei NEUEN Spalten auf `platform.projects` dürfen nicht von selbst irgendwo nach aussen gelangen.
-- Gegen den lokalen Stack gemessen: GENAU SECHS bestehende Funktionsrümpfe nennen
-- `platform.projects`, und jeder baut seine Spaltenliste EXPLIZIT auf — keiner benutzt `select *`
-- oder `%rowtype`. `segment` und `draft` erscheinen deshalb ausschliesslich dort, wo dieser Schritt
-- sie ausdrücklich aufführt (`public.get_project`), und in keinem Wrapper des Fundaments.
--
-- ── ARBEITSREGEL 5 (kein Direktaufruf ohne Grant) ───────────────────────────────────────────────
-- Das Gate prüft fehlende Aufrufbarkeit mit `has_function_privilege`, nicht durch einen Aufruf — ein
-- solcher hat im CI-Lauf von B16-4a den Postgres-Prozess mit Signal 11 beendet. Die Ablehnung eines
-- eingeloggten Nicht-Admins wird dagegen ECHT aufgerufen: dort HAT der Aufrufer das Grant, und die
-- Ablehnung IM Rumpf ist genau die zu beweisende Eigenschaft.
--
-- ── ⚠ DIE `ON DELETE SET NULL`-FALLE, ZUM SECHSTEN MAL — UND WARUM SIE HIER NICHT GREIFT ────────
-- Zwei neue Fremdschlüssel zeigen auf `auth.users` und tragen `on delete set null`
-- (`project_documents.uploaded_by`, `project_open_questions.answered_by`). Die im Repo fünfmal
-- aufgetretene Falle (`leads.last_edited_by` B2-1, `email_events.lead_id` B2-2,
-- `analyses.lead_id`/`created_by` B14-1, `partner_applications.user_id` B16-3) entsteht erst, wenn
-- auf DERSELBEN Tabelle ein Append-only- oder Unveränderlichkeits-Trigger sitzt: die referentielle
-- Aktion IST selbst ein UPDATE und würde von ihm abgewiesen — das referenzierte Konto wäre danach
-- unlöschbar, ausgerechnet gegen ein Löschverlangen. KEINE der drei neuen Tabellen trägt einen
-- solchen Trigger (Begründung je Tabelle unten), es gibt hier also nichts freizustellen.
-- **Wer je einen ergänzt, muss die asymmetrische Ausnahme für BEIDE Spalten mitbauen.**
--
-- Die zweite Hälfte derselben Familie steht bei `project_open_questions`: ein CHECK, der
-- `answered_by` verlangte, machte das Konto des Antwortenden ebenso unlöschbar (23514 statt 23502).
-- Der CHECK dieser Migration verlangt deshalb `answered_at` und NIE `answered_by` — wortgleiche
-- Lehre aus B16-3(e), dort für `partner_applications.reviewed_at`/`reviewed_by` gemessen.
--
-- ── ⚠ DER ERSTE STORAGE-BUCKET DES GESAMTEN REPOS ───────────────────────────────────────────────
-- Gemessen, nicht vermutet: `grep -rn "storage\|bucket" supabase/migrations/` und dieselbe Suche über
-- `apps/**/lib` liefern vor dieser Migration NULL Treffer. Das einzige bisherige Datei-Archiv des
-- Projekts liegt als `bytea` IN der Tabelle (`platform.analyses.source_file_gzip`, B14-1). TEIL 7
-- begründet, warum dieser Fall anders liegt — und welche Eigenschaft von `storage.objects` dabei
-- gemessen wurde, statt sie der Dokumentation zu glauben.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — platform.projects: `segment` und `draft`
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── WARUM DAS SEGMENT AM PROJEKT HÄNGT UND NICHT AM ACCOUNT ─────────────────────────────────────
-- Steht wörtlich im Delta §2.1: „Kein Typfeld Privat/Betrieb am Account selbst — das Segment hängt
-- am Projekt (ein Account könnte theoretisch ein Betriebs- und ein Privatprojekt haben)." Der
-- Tabellenkommentar von `platform.accounts` (Fundament) sagt dasselbe zu; diese Spalte löst die dort
-- angekündigte Zusage ein.
--
-- ── CHECK STATT ENUM, UND DER GRUND IST GEMESSEN ────────────────────────────────────────────────
-- Das Schema kennt beide Muster (`platform.partner_application_status` als Enum, `analyses.kind` als
-- CHECK). Hier CHECK, aus einem in diesem Repo real bezahlten Grund: `alter type … add value` darf im
-- selben Transaktionsblock nicht benutzt werden (55P04) — in B18-6 gemessen und in Delta 16b so
-- teuer, dass die Erweiterung um EINEN Wert ZWEI Migrationsdateien brauchte, weil die Supabase-CLI
-- jede Datei in einer Transaktion anwendet. Ein CHECK wird dagegen mit `drop constraint` +
-- `add constraint` in EINER Datei erweitert. Bei einer Werteliste, die absehbar wächst (die
-- Nachrichten-Rollen unten wachsen mit den Blocktypen der Anthropic-API), ist das der billigere
-- Zuschnitt. Alle drei Wertelisten dieser Migration folgen deshalb demselben Muster.
--
-- ⚠ DAS SEGMENT IST NICHT DIE BRANCHE. Delta §4.1 verlangt für die Branche ausdrücklich eine OFFENE
-- Liste („neue Branchen-Pools sollen ohne Schema-Änderung admin-seitig entstehen können") — die ist
-- Teil des Fragenkatalog-Schritts (§4) und steht bewusst NICHT hier. Diese Spalte trägt die
-- zweiwertige Achse Privat/Betrieb, und die ist geschlossen.
alter table platform.projects
  add column segment text null
    constraint projects_segment_check check (segment in ('privat', 'betrieb'));

comment on column platform.projects.segment is
  'B24: Privat oder Betrieb (Delta §3.4/§4.1). NULLABLE, und NULL heisst „das Gespraech hat es noch '
  'nicht bestimmt" — nicht „unbekannter Betrieb": der Chat legt es fest, sobald er es weiss, und '
  'vorher darf nichts so tun, als stuende es fest. Am PROJEKT und nicht am Account, weil ein Account '
  'ein Betriebs- und ein Privatprojekt zugleich haben kann. Die BRANCHE steht hier ausdruecklich '
  'NICHT — die ist laut Delta §4.1 eine offene Liste und gehoert zum Fragenkatalog-Schritt.';

-- ── `draft`: das Pendant zu TariffParams, WÄHREND es entsteht ───────────────────────────────────
-- Delta §3.1: „Der Chat muss am Ende dasselbe Zielobjekt füllen, das heute Schritt 2 des Formulars
-- füllt — sonst weiss die KI-Schicht nicht, wann sie fertig ist." Genau dieses halbfertige Zielobjekt
-- liegt hier. Bewusst `jsonb` und nicht eine Spalte je Feld:
--   * Ein Entwurf ist per Definition unvollständig — jede Spalte müsste nullable sein, und `null`
--     hiesse dann zugleich „noch nicht gefragt", „gefragt, keine Antwort" und „ausdrücklich 0".
--   * Der Zuschnitt des Betrieb-Contracts ist offener Punkt 1 des Deltas. Spalten dafür anzulegen
--     hiesse, eine offene fachliche Frage über ein Schema zu entscheiden.
--   * Präzedenz im Haus: `platform.analyses.inputs`/`result` liegen aus demselben Grund als jsonb.
-- Die TYPISIERUNG bleibt trotzdem verbindlich, sie sitzt nur woanders: `tariffParamsSchema` (zod)
-- prüft den Entwurf, wenn er die Engine erreicht. Die Datenbank prüft hier ausschliesslich, dass es
-- ein OBJEKT ist — eine Zeichenkette oder ein Array an dieser Stelle wäre für jeden Leser ein
-- Fehler, und ohne den CHECK fiele er erst im Anwendungscode auf.
--
-- `not null default '{}'` und NICHT nullable: „noch nichts eingetragen" ist das leere Objekt, nicht
-- die Abwesenheit eines Objekts. Sonst müsste jeder Leser zwei Formen desselben Nichts behandeln.
alter table platform.projects
  add column draft jsonb not null default '{}'::jsonb
    constraint projects_draft_is_object check (jsonb_typeof(draft) = 'object');

comment on column platform.projects.draft is
  'B24: der laufend gefuellte Entwurf des Eingabe-Contracts (Delta §3.1) — das Pendant zu '
  'TariffParams, waehrend es entsteht. jsonb statt Einzelspalten, weil ein Entwurf per Definition '
  'unvollstaendig ist und der Betrieb-Feldzuschnitt offener Punkt 1 des Deltas bleibt; die '
  'Typpruefung uebernimmt tariffParamsSchema (zod), sobald der Entwurf die Engine erreicht. NOT NULL '
  'mit Default {}: „noch nichts eingetragen" ist das leere Objekt, nicht die Abwesenheit eines. Der '
  'CHECK laesst ausschliesslich ein OBJEKT zu — eine Zeichenkette an dieser Stelle waere ein Fehler, '
  'der sonst erst im Anwendungscode auffiele.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — platform.project_messages: der Turn-für-Turn-Verlauf
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── ⚠ `ON DELETE CASCADE`, UND DAS IST DER UNTERSCHIED ZU JEDER ANDEREN TABELLE DIESES SCHEMAS ──
-- Das Fundament, `platform.leads`, `platform.analyses` und `platform.partners` tragen durchgängig
-- `on delete set null` — dort überlebt der Vorgang seinen Bezug, weil es einen Aufbewahrungsgrund
-- gibt (eine bezahlte Analyse, ein Nachweis, eine Statistik). Hier gibt es diesen Grund NICHT: eine
-- Nachricht ohne ihr Projekt ist kein Gesprächsverlauf mehr, sondern eine Zeile, die niemand mehr
-- einordnen kann — und sie trägt Kundentext. `set null` verlangte zudem ein nullable `project_id`,
-- und damit einen Zustand, den jede Abfrage dieser Tabelle mitbehandeln müsste.
--
-- ⚠ FOLGE, DIE BEIM ANFASSEN MITZUDENKEN IST: weil hier CASCADE steht, darf auf diese Tabelle
-- NIEMALS ein Trigger, der DELETE abweist. Ein Append-only-Trigger im Sinne von `platform.analyses`
-- würde das Löschen eines Projekts mit 23503 bzw. P0001 blockieren — das Projekt wäre unlöschbar.
-- Die Unveränderlichkeit des Verlaufs ist deshalb bewusst NICHT als Trigger gebaut, sondern über die
-- Rechtefläche: es gibt kein Tabellen-Grant und ausser `append_project_message` KEINEN Wrapper, der
-- schreibt — kein `update_project_message`, kein `delete_project_message`. Das ist derselbe
-- Mechanismus, mit dem `grid_tariffs` seine Ordnung durchsetzt (Delta §4.2: „Schreiben geht
-- ausschliesslich über service_role-Funktionen … nicht über einen offenen DB-Grant").
create table platform.project_messages (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null references platform.projects (id) on delete cascade,

  -- ── ⚠ VIER ROLLEN, OBWOHL DIE ANTHROPIC-API NUR ZWEI KENNT — Absicht, mit einer Auflage ───────
  -- Die Messages-API kennt `user` und `assistant`; ein Werkzeugaufruf ist dort ein `tool_use`-BLOCK
  -- in einer Assistenten-Nachricht, ein Ergebnis ein `tool_result`-Block in einer Nutzer-Nachricht.
  -- Diese Tabelle ist bewusst FEINER: die Zeilen-Granularität ist die PRÜF-Granularität, nicht die
  -- API-Granularität. Wer wissen will, welche Werkzeuge ein Gespräch angefasst hat, filtert eine
  -- Spalte statt jeden Block jeder Nachricht zu zerlegen.
  --
  -- ⚠ AUFLAGE FÜR DEN CHAT-SCHRITT: beim Wiedereinspielen in die API müssen aufeinanderfolgende
  -- Zeilen wieder zu API-Nachrichten ZUSAMMENGEFASST werden (`assistant` + `tool_call` → EINE
  -- Assistenten-Nachricht mit mehreren Blöcken; `tool_result` → eine Nutzer-Nachricht). Das ist die
  -- eine Stelle, an der diese Ablage dem Aufrufer Arbeit macht, und sie steht hier, damit sie nicht
  -- übersehen wird.
  role text not null
    constraint project_messages_role_check
      check (role in ('user', 'assistant', 'tool_call', 'tool_result')),

  -- Immer ein ARRAY von Blöcken, auch für reinen Text (`[{"type":"text","text":"…"}]`). Die
  -- Messages-API erlaubt zusätzlich eine blosse Zeichenkette; hier wird an der Grenze normalisiert,
  -- damit jeder Leser GENAU EINE Form behandelt statt zweier. Ohne den CHECK fiele die zweite Form
  -- erst dort auf, wo jemand über die Blöcke iteriert.
  content jsonb not null
    constraint project_messages_content_is_array check (jsonb_typeof(content) = 'array'),

  created_at timestamptz not null default now()
);

comment on table platform.project_messages is
  'B24: der Turn-fuer-Turn-Verlauf eines Projekt-Gespraechs (Delta §2.2/§3.1). ON DELETE CASCADE — '
  'anders als ueberall sonst in diesem Schema: eine Nachricht ohne ihr Projekt ist kein '
  'Gespraechsverlauf mehr, und es gibt keinen Aufbewahrungsgrund, der sie ihr Projekt ueberleben '
  'liesse. Traegt deshalb bewusst KEINEN Append-only-Trigger (der wuerde das Kaskadenloeschen '
  'abweisen und das Projekt unloeschbar machen); die Unveraenderlichkeit sitzt in der Rechteflaeche '
  '— kein Tabellen-Grant, und als einziger Schreibweg public.append_project_message. RLS aktiv OHNE '
  'Policy.';

comment on column platform.project_messages.role is
  'Feiner als die Anthropic-API: die zwei API-Rollen plus tool_call/tool_result als EIGENE Zeilen. '
  'Zeilen-Granularitaet = Pruef-Granularitaet. Beim Wiedereinspielen muss der Anwendungscode '
  'aufeinanderfolgende Zeilen wieder zu API-Nachrichten zusammenfassen.';

comment on column platform.project_messages.content is
  'Die Bloecke der Nachricht, IMMER als Array — auch reiner Text ([{"type":"text",...}]). An der '
  'Grenze normalisiert, damit jeder Leser genau eine Form behandelt statt der zwei, die die '
  'Messages-API zulaesst.';

-- Der Verlauf wird IMMER je Projekt und IMMER in Zeitfolge gelesen (Wiedereinspielen ins Modell) —
-- der zusammengesetzte Index bedient beides in einem. `created_at` allein indiziert bringt nichts:
-- es gibt keine Abfrage über alle Projekte hinweg.
create index project_messages_project_created_idx
  on platform.project_messages (project_id, created_at);

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — platform.project_documents: die Verweise auf den Storage-Bucket
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── ⚠ WARUM DIE `id` KEINEN DEFAULT HAT — die Reihenfolge des Uploads entscheidet das ───────────
-- Der Upload läuft in drei Schritten (ausgeschrieben in TEIL 7): Eigentum prüfen → BYTES schreiben →
-- Zeile schreiben. Die Bytes brauchen einen Pfad, bevor es die Zeile gibt; also vergibt der Aufrufer
-- die Kennung und reicht sie beim Anlegen mit. Ein Default hier wäre eine zweite Kennung, die zur
-- bereits geschriebenen Datei nicht mehr passt.
--
-- Die Umkehrung — erst die Zeile, dann die Bytes — wurde erwogen und VERWORFEN: scheitert dann der
-- Upload, steht eine Zeile im Bestand, die eine Datei behauptet, die es nicht gibt. Sie erschiene in
-- `list_project_documents`, der Chat hielte das Dokument für vorhanden, und der Download liefe ins
-- Leere. In der gewählten Reihenfolge ist der schlimmste Rest eine verwaiste DATEI: sie steht in
-- keiner Liste, niemand verweist auf sie, und sie liegt im Ordner ihres eigenen Projekts. Ein
-- unbemerkt falscher Bestand ist teurer als ein unbemerkter Rest.
create table platform.project_documents (
  id uuid primary key,

  project_id uuid not null references platform.projects (id) on delete cascade,

  -- ── ⚠ DER PFAD IST ABGELEITET, UND DER CHECK MACHT DAS ZUR DATENBANK-EIGENSCHAFT ─────────────
  -- `storage_path` wird im Wrapper aus `project_id` und `id` GEBILDET, nie vom Aufrufer übernommen.
  -- Der CHECK ist die zweite, unabhängige Schicht darüber: er macht „ein Dokument kann nur im Ordner
  -- SEINES Projekts liegen" zu einer Eigenschaft der Tabelle statt zu einer Konvention des
  -- Funktionsrumpfs. Ein künftiger Wrapper, der den Pfad als Parameter nähme, könnte damit gar nicht
  -- erst in einen fremden Projektordner zeigen — er würde mit 23514 abgewiesen.
  --
  -- Dass der Wert dadurch redundant ist, ist der Preis und er ist bewusst bezahlt: der Aufrufer
  -- braucht den Pfad an jeder Stelle, an der er die Storage-API anspricht, und ihn dort jedes Mal
  -- neu zusammenzusetzen hiesse, das Schema an mehreren Orten auszuschreiben. ⚠ Der CHECK FRIERT das
  -- Pfadschema ein — wer es ändert, ändert ihn mit UND verschiebt die vorhandenen Objekte; genau
  -- diese Ausdrücklichkeit ist gewollt.
  --
  -- Der BUCKET-Name steht bewusst NICHT im Pfad: die Storage-API nimmt Bucket und Pfad getrennt
  -- entgegen, und der Bucket ist eine Konstante (`packages/shared/src/project-documents.ts`).
  storage_path text not null
    constraint project_documents_storage_path_derived
      check (storage_path = project_id::text || '/' || id::text),

  -- Der Name, den die Datei beim Kunden hatte. Er ist die einzige Angabe, an der ein Mensch sie
  -- wiedererkennt („Jahresrechnung_2025.pdf"); der Pfad besteht aus zwei Kennungen und sagt nichts.
  original_filename text not null
    constraint project_documents_filename_not_blank check (btrim(original_filename) <> ''),

  -- ⚠ EINE ANGABE DES KUNDEN, KEINE MESSUNG. Der Browser meldet den Typ, wir schreiben ihn auf. Er
  -- taugt zur ANZEIGE und zur Entscheidung, welchem Extraktor eine Datei angeboten wird — er darf
  -- NIE die Grundlage sein, mit der eine Datei später ausgeliefert wird (die Ausgabe erzwingt einen
  -- Anhang; s. TEIL 7).
  content_type text not null
    constraint project_documents_content_type_not_blank check (btrim(content_type) <> ''),

  uploaded_at timestamptz not null default now(),

  -- ON DELETE SET NULL wie `analyses.created_by` (B14-1): null heisst „das Konto gibt es nicht mehr",
  -- NICHT „von niemandem hochgeladen". Kein CHECK verlangt diese Spalte — s. Kopf dieser Datei.
  uploaded_by uuid null references auth.users (id) on delete set null
);

comment on table platform.project_documents is
  'B24: die Verweise auf die Dateien eines Projekts im privaten Storage-Bucket (Delta §3.2, '
  '„Datei-Upload beliebiger Dokumenttypen"). Enthaelt AUSDRUECKLICH KEINE Bytes — anders als '
  'platform.analyses (B14-1), das seine EINE eingefrorene Quelldatei als bytea traegt; die '
  'Begruendung fuer den Unterschied steht in TEIL 7. ON DELETE CASCADE wie project_messages, aus '
  'demselben Grund und mit derselben Auflage: KEIN Trigger, der DELETE abweist. RLS aktiv OHNE '
  'Policy.';

comment on column platform.project_documents.storage_path is
  'Pfad IM Bucket, abgeleitet als <project_id>/<id> und per CHECK darauf festgelegt — „ein Dokument '
  'liegt nur im Ordner seines eigenen Projekts" ist damit eine Eigenschaft der Tabelle, nicht eine '
  'Konvention des Funktionsrumpfs. Ohne Bucket-Namen: den nimmt die Storage-API getrennt entgegen.';

comment on column platform.project_documents.content_type is
  'Der vom Browser gemeldete Typ — eine ANGABE, keine Messung. Taugt fuer Anzeige und Extraktor-Wahl '
  'und NIE als Grundlage der Auslieferung: der Download erzwingt einen Anhang.';

create index project_documents_project_uploaded_idx
  on platform.project_documents (project_id, uploaded_at);

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — platform.project_open_questions: Weg (a) und Weg (b) aus §3.3
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── ⚠ DIE ENTSCHEIDUNG, DIE DIESE TABELLE TRÄGT: EINE ANNAHME SCHLIESST DIE FRAGE NICHT ─────────
-- Delta §3.3, wörtlich: „Die Rückfrage an Martin wird dadurch nicht gelöscht, sondern bleibt am
-- Projekt offen stehen, zur nachträglichen Prüfung." Das ist der ganze Sinn des Zwei-Wege-Modells —
-- der Nutzer soll weiterarbeiten können, OHNE dass die fachliche Frage dabei verschwindet.
--
-- Genau deshalb sind `status` und `resolution_kind` ZWEI Spalten und nicht eine. Sie beantworten
-- zwei verschiedene Fragen:
--   `status`          → „liegt das hier noch bei Martin?"        (offen / beantwortet / verworfen)
--   `resolution_kind` → „womit ist der Chat weitergelaufen?"     (nichts / Annahme / Antwort)
--
-- Der interessante und für §3.3 entscheidende Zustand ist die Kombination, die eine einzige Spalte
-- nicht ausdrücken könnte:
--
--   status              resolution_kind   Bedeutung
--   ──────────────────  ────────────────  ─────────────────────────────────────────────────────────
--   'open'              null              frisch gestellt, niemand ist weitergegangen
--   'open'              'assumed'         ⚠ WEG (b): der Chat rechnet mit einer Annahme UND die
--                                            Frage liegt weiterhin bei Martin. Der Zustand, um den
--                                            es §3.3 geht.
--   'answered'          'answered'        WEG (a) am Ziel: es gibt eine echte Antwort
--   'dismissed'         null | 'assumed'  ausdrücklich geschlossen, ohne dass Martin geantwortet hat
--
-- Und die zwei Kombinationen, die WIDERSPRÜCHLICH wären, verbietet ein CHECK statt einer Konvention:
--   'answered' ohne `resolution_kind = 'answered'`  → behauptete eine Antwort, die nirgends steht
--   'open'     mit  `resolution_kind = 'answered'`  → hielte eine beantwortete Frage künstlich offen
-- `is not distinct from` statt `=`, weil `resolution_kind` nullbar ist und `null = 'answered'` zu
-- `null` auswertet — ein CHECK, der auf null auswertet, gilt in PostgreSQL als ERFÜLLT und liesse
-- genau die Zeilen durch, die er abweisen soll.
create table platform.project_open_questions (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null references platform.projects (id) on delete cascade,

  -- NULLABLE, und das ist eine fachliche Aussage: Delta §3.5 kennt ausdrücklich Fragen, die zu gar
  -- keinem Entwurfsfeld gehören („eine Struktur, die das System nicht abbildet … sauber zu ‚das
  -- braucht Martin' überleiten"). Ein Pflichtfeld zwänge den Chat, für solche Fälle einen
  -- Feldnamen zu erfinden — und der stünde dann im Bestand wie eine echte Zuordnung.
  field_key text null,

  question text not null
    constraint project_open_questions_question_not_blank check (btrim(question) <> ''),

  status text not null default 'open'
    constraint project_open_questions_status_check
      check (status in ('open', 'answered', 'dismissed')),

  created_at timestamptz not null default now(),

  resolution_kind text null
    constraint project_open_questions_resolution_kind_check
      check (resolution_kind in ('answered', 'assumed')),

  -- Der Wert, mit dem weitergerechnet wird — bei Weg (a) Martins Antwort, bei Weg (b) die Annahme.
  -- BEWUSST `text` und nicht typisiert: was hier steht, hängt am `field_key` und reicht von einer
  -- Zahl bis zu einem Satz. Die Übernahme in den `draft` ist ein eigener, sichtbarer Schritt des
  -- Chats — diese Spalte ist das Protokoll, nicht der Rechenwert.
  resolution_value text null,

  -- ⚠ Delta §3.3 verlangt eine „sichtbar gekennzeichnete, BEGRÜNDETE Annahme". Die Begründung steht
  -- hier, und `resolve_open_question` weist Weg (b) OHNE sie ab. Sie wird bei einer späteren echten
  -- Antwort NICHT gelöscht: sie belegt, womit in der Zwischenzeit gerechnet wurde, und genau das ist
  -- die nachträgliche Prüfbarkeit, die §3.3 will. Deshalb gibt es hier auch KEINEN CHECK, der sie an
  -- `resolution_kind = 'assumed'` bindet — er würde beim Übergang Annahme → Antwort die Geschichte
  -- vernichten.
  assumption_note text null,

  -- Delta §3.3: „bei der Wahl zwischen (1) und (2) wird dem Nutzer angezeigt, ob die Annahme das
  -- Ergebnis voraussichtlich stark verändern könnte". Die Einschätzung entsteht aus einem
  -- Sensitivitätslauf gegen `recommendBattery` — kein neuer Rechenweg, aber Chat-Arbeit und damit
  -- der NÄCHSTE Schritt. Hier steht die Spalte, und `append_open_question` nimmt sie entgegen, damit
  -- sie einen Schreibweg hat: eine Spalte ohne Schreibweg wäre eine Requisite.
  impact_note text null,

  -- ON DELETE SET NULL. ⚠ KEIN CHECK DARF DIESE SPALTE NENNEN — sonst schlüge das referentielle
  -- UPDATE beim Löschen des Antwortenden mit 23514 fehl und das Konto wäre unlöschbar. Wortgleiche
  -- Lehre aus B16-3(e) (`partner_applications`: „Der CHECK verlangt reviewed_at, NICHT reviewed_by").
  answered_by uuid null references auth.users (id) on delete set null,

  answered_at timestamptz null,

  -- ── die tragende Invariante (Tabelle oben) ────────────────────────────────────────────────────
  constraint project_open_questions_answered_consistent
    check ((status = 'answered') = (resolution_kind is not distinct from 'answered')),

  -- Einseitige Implikation, KEINE Äquivalenz: „beantwortet" verlangt einen Zeitpunkt, aber ein
  -- gesetzter Zeitpunkt verbietet keinen späteren Wechsel auf 'dismissed'. Eine Äquivalenz zwänge
  -- dazu, `answered_at` beim Verwerfen zu nullen — also Geschichte zu löschen, um einen CHECK zu
  -- befriedigen. Referenziert `answered_at` und NIE `answered_by` (s. o.).
  constraint project_open_questions_answered_at_present
    check (status <> 'answered' or answered_at is not null)
);

comment on table platform.project_open_questions is
  'B24: die Rueckfragen, die der Chat nicht selbst beantworten kann (Delta §2.2/§3.3). ZWEI Spalten '
  'fuer den Zustand, weil eine nicht reicht: status sagt, ob es noch bei Martin liegt, '
  'resolution_kind, womit der Chat weitergelaufen ist. Die Kombination (open, assumed) IST der '
  'Kern des Zwei-Wege-Modells — eine Annahme laesst den Nutzer weiterarbeiten und schliesst die '
  'Frage NICHT. Zwei CHECKs machen das zur Datenbank-Eigenschaft statt zur Konvention. ON DELETE '
  'CASCADE zum Projekt, KEIN Trigger (s. project_messages). RLS aktiv OHNE Policy.';

comment on column platform.project_open_questions.field_key is
  'Welches Feld des Entwurfs betroffen ist. NULLABLE: Delta §3.5 kennt Fragen ohne Feldbezug („eine '
  'Struktur, die wir nicht abbilden") — ein Pflichtfeld zwaenge dort dazu, einen Feldnamen zu '
  'erfinden, und der staende danach im Bestand wie eine echte Zuordnung.';

comment on column platform.project_open_questions.assumption_note is
  'Die Begruendung der Annahme (Delta §3.3 verlangt eine „begruendete" Annahme; resolve_open_question '
  'weist Weg (b) ohne sie ab). Bleibt bei einer spaeteren echten Antwort STEHEN — sie belegt, womit '
  'in der Zwischenzeit gerechnet wurde.';

comment on column platform.project_open_questions.impact_note is
  'Delta §3.3: „aendert das Ergebnis stark/kaum" — die Einschaetzung aus einem Sensitivitaetslauf '
  'gegen recommendBattery. Die Einschaetzung SELBST entsteht im Chat-Schritt; hier steht die Spalte, '
  'und append_open_question nimmt sie entgegen, damit sie einen Schreibweg hat.';

comment on column platform.project_open_questions.answered_by is
  'Wer geantwortet hat — Martin ueber admin_answer_open_question, oder der Kunde selbst, wenn er die '
  'Antwort auf seiner Rechnung gefunden hat. ON DELETE SET NULL; KEIN CHECK nennt diese Spalte, '
  'sonst waere das Konto des Antwortenden unloeschbar (B16-3).';

-- Zwei Zugriffswege, zwei Indizes: der Kunde/Chat liest je PROJEKT, Martins Posteingang liest quer
-- über alle Projekte nach STATUS. Der zweite ist ein Teilindex auf 'open' — der Posteingang fragt
-- nach nichts anderem, und beantwortete Fragen sind auf Dauer die Mehrheit der Zeilen (dieselbe
-- Zurückhaltung wie bei den Teilindizes aus B3-1, die nur `anonymized_at is null` führen).
create index project_open_questions_project_created_idx
  on platform.project_open_questions (project_id, created_at);

create index project_open_questions_open_idx
  on platform.project_open_questions (created_at)
  where status = 'open';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 5 — platform.project_accessible: EINE Zugriffsentscheidung, zwölf Konsumenten
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Jeder der zwölf Wrapper unten stellt dieselbe Frage: „darf diese Sitzung dieses Projekt benutzen?"
-- Zwölfmal ausgeschrieben liefen die Fassungen beim nächsten Umbau auseinander, und das fiele
-- niemandem auf, weil jede für sich funktioniert — dasselbe Argument, mit dem das Fundament
-- `platform.ensure_account` eingeführt hat und T4-1 `platform.has_entitlement`.
--
-- ── ⚠ KEIN KONTO-PARAMETER — und das ist die ANDERE Form als bei `ensure_account` ───────────────
-- Das Fundament begründet für `ensure_account` ausdrücklich den umgekehrten Zuschnitt („Nimmt das
-- Konto als PARAMETER; die Bindung an auth.uid() geschieht in den public-Wrappern"). Hier ist es
-- bewusst andersherum, aus zwei Gründen:
--
--   (a) Es ist ein LESE-Prädikat über fremde Daten. Mit Parameter gäbe es eine Funktion, die man
--       nach dem Zugriffsrecht eines DRITTEN fragen könnte; ohne Parameter existiert diese Frage
--       nicht. `platform.is_admin()` (T4-1) hat aus demselben Grund keinen Parameter — das ist der
--       Präzedenzfall im selben Schema.
--   (b) Die Entscheidung besteht aus ZWEI Teilen (Eigentum ODER Adminrolle), und der zweite Teil
--       liest ohnehin `auth.uid()`. Ein Parameter für den ersten Teil und `auth.uid()` für den
--       zweiten wären zwei Quellen dafür, WER hier fragt — die schlimmste der drei Varianten. Läge
--       nur das Eigentum hier und die Adminrolle in den Wrappern, stünde `or platform.is_admin()`
--       zwölfmal da, und der dreizehnte Wrapper vergässe es.
--
-- ── DAS PROJEKT MUSS EXISTIEREN, AUCH FÜR EINEN ADMIN ──────────────────────────────────────────
-- `platform.is_admin()` allein wäre für JEDE Kennung wahr, auch für eine erfundene. Ein
-- `append_*`-Wrapper liefe damit in einen rohen Fremdschlüssel-Fehler (23503) statt in eine benannte
-- Ablehnung. Die Existenzprüfung steht deshalb IM Prädikat und nicht in jedem Aufrufer.
create function platform.project_accessible(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from platform.projects pr
    left join platform.accounts a on a.id = pr.account_id
    where pr.id = p_project_id
      and (a.user_id = auth.uid() or platform.is_admin())
  );
$$;

comment on function platform.project_accessible(uuid) is
  'B24: darf die AKTUELLE Sitzung dieses Projekt benutzen? Eigenes Projekt ODER Adminrolle, und das '
  'Projekt muss existieren (sonst waere die Antwort fuer einen Admin auch bei einer erfundenen '
  'Kennung wahr und ein Schreib-Wrapper liefe in einen rohen 23503). KEIN Konto-Parameter — Muster '
  'platform.is_admin(), NICHT platform.ensure_account: ein Lese-Praedikat, nach dem man das '
  'Zugriffsrecht eines Dritten fragen koennte, soll es gar nicht geben. EINE Definition fuer alle '
  'zwoelf public-Wrapper dieses Schritts. Fuer keine Client-Rolle aufrufbar.';

revoke all on function platform.project_accessible(uuid) from public;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 6 — die public-Wrapper
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── DREI DURCHGÄNGIGE REGELN ────────────────────────────────────────────────────────────────────
--   1. „Gibt es nicht" und „gehört jemand anderem" liefern DENSELBEN Status `not_found`. Ein eigener
--      Status für „fremd" wäre eine Auskunft darüber, welche Kennungen existieren — dieselbe
--      Nicht-Unterscheidbarkeit wie bei `get_my_project` (Fundament), `get_active_partner` (B16-2)
--      und `submit_partner_application` (B16-3).
--   2. Die zwei `admin_*`-Wrapper WERFEN bei fehlender Adminrolle (42501) statt leer zu antworten —
--      Muster `admin_list_analyses` (B14-1): eine leere Liste ist dort die häufigste ECHTE Antwort
--      und darf nicht zugleich „kein Zugriff" bedeuten. Die übrigen zehn antworten mit `not_found`,
--      weil bei ihnen die leere Antwort keine gültige Alternativbedeutung hat.
--   3. Jede Liste hat `p_limit`/`p_offset` und liefert die Gesamtzahl GETRENNT mit, damit die
--      Oberfläche eine Kürzung offenlegen kann statt Vollständigkeit vorzutäuschen. Auch dort, wo
--      ein Elternsatz die Menge heute praktisch begrenzt: die Kostenbremse (§6.3) ist NICHT gebaut,
--      also gibt es zurzeit nichts, was die Zahl der Nachrichten oder Dokumente eines Projekts nach
--      oben schlösse.

-- ── get_project ─────────────────────────────────────────────────────────────────────────────────
-- Der Chat braucht sein Projekt unabhängig davon, ob es einem Kunden oder einem Admin gehört —
-- `get_my_project` (Fundament) beantwortet nur die erste Hälfte und bleibt UNVERÄNDERT. Dieser
-- Wrapper ist die vereinigte Frage und zugleich die Eigentumsprüfung VOR jedem Storage-Zugriff
-- (TEIL 7, Schritt 1).
--
-- ⚠ LIEFERT KEIN `created_by`. Das Fundament legt das an der Spalte fest: „Erscheint NUR in den
-- Admin-Wrappern … ein Kunde hat fuer die Kennung eines internen Kontos keine Verwendung." Da hier
-- auch ein Kunde aufruft, bleibt sie draussen (B16-2: was eine Server Component liest, kann im
-- ausgelieferten HTML landen, auch wenn niemand es rendert).
create function public.get_project(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_project jsonb;
begin
  if not platform.project_accessible(p_id) then
    return jsonb_build_object('status', 'not_found');
  end if;

  select to_jsonb(p)
    into v_project
  from (
    select pr.id, pr.account_id, pr.customer_label, pr.segment, pr.draft,
           pr.created_at, pr.updated_at
    from platform.projects pr
    where pr.id = p_id
  ) p;

  return jsonb_build_object('status', 'ok', 'project', v_project);
end;
$$;

comment on function public.get_project(uuid) is
  'B24: EIN Projekt samt segment und draft — eigenes ODER (als Admin) ein beliebiges. Ergaenzt '
  'get_my_project, das unveraendert bleibt und nur die Kundensicht kennt. Liefert bewusst KEIN '
  'created_by (Kundensicht). Fremd und unbekannt liefern denselben Status not_found. '
  'authenticated-only.';

-- ── update_project_draft ────────────────────────────────────────────────────────────────────────
-- ⚠ DER ENTWURF WIRD ERSETZT, NICHT ZUSAMMENGEFÜHRT. `jsonb ||` wäre eine flache Verschmelzung und
-- könnte einen Schlüssel nie wieder ENTFERNEN — ausgerechnet die Bewegung, die eine Korrektur im
-- Gespräch auslöst („doch keine PV-Anlage"). Der Chat hält den vollständigen Entwurf ohnehin, und
-- ein Gespräch ist der Reihe nach: zwei gleichzeitige Turns, die einander überschreiben, sind kein
-- Zustand, den dieses Modell kennt.
--
-- ⚠ `p_segment = null` HEISST „UNVERÄNDERT", NICHT „LÖSCHEN". Das Repo führt beide Lesarten
-- nebeneinander und begründet sie je Fall (B2-1: `admin_update_lead` deutet null als LÖSCHEN,
-- `capture_lead` als „unberührt lassen"). Hier gilt die zweite: ein einmal bestimmtes Segment
-- verliert man nicht dadurch, dass ein Aufrufer den Parameter weglässt. Wer es wirklich zurücknehmen
-- will, braucht dafür einen eigenen, sichtbaren Weg — den gibt es bewusst nicht, weil es dafür noch
-- keinen Anlass gibt.
--
-- Das Segment fährt hier mit, weil es IM SELBEN MOMENT vom SELBEN Akteur bestimmt wird: der Chat
-- erkennt „das ist ein Betrieb" und trägt zugleich die ersten Betriebsfelder in den Entwurf ein.
-- Zwei Wrapper wären zwei Transaktionen für einen Vorgang.
create function public.update_project_draft(
  p_id uuid,
  p_draft jsonb,
  p_segment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_segment text := nullif(btrim(coalesce(p_segment, '')), '');
begin
  if not platform.project_accessible(p_id) then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Als STATUS abgewiesen, nicht als roher 23514 aus dem CHECK: ein Constraint-Fehler traegt keinen
  -- Feldbezug, den eine Oberflaeche anzeigen koennte (dieselbe Aufteilung wie bei den
  -- grid_tariff-Wrappern und bei create_my_project — Grenze im Schema, Meldung im Rumpf).
  if p_draft is null or jsonb_typeof(p_draft) <> 'object' then
    return jsonb_build_object('status', 'invalid_draft');
  end if;

  if v_segment is not null and v_segment not in ('privat', 'betrieb') then
    return jsonb_build_object('status', 'invalid_segment');
  end if;

  update platform.projects
     set draft = p_draft,
         segment = coalesce(v_segment, segment)
   where id = p_id;

  return jsonb_build_object('status', 'ok');
end;
$$;

comment on function public.update_project_draft(uuid, jsonb, text) is
  'B24: schreibt den laufenden Entwurf und, falls uebergeben, das Segment. ERSETZT den Entwurf statt '
  'ihn zu verschmelzen — eine flache Verschmelzung koennte einen Schluessel nie wieder entfernen, '
  'und genau das loest eine Korrektur im Gespraech aus. p_segment null heisst UNVERAENDERT (Lesart '
  'capture_lead, nicht admin_update_lead — ein einmal bestimmtes Segment verliert man nicht dadurch, '
  'dass ein Aufrufer den Parameter weglaesst). Ungueltige Eingaben werden als Status abgewiesen, '
  'nicht als roher CHECK-Fehler. authenticated-only.';

-- ── append_project_message ──────────────────────────────────────────────────────────────────────
create function public.append_project_message(
  p_project_id uuid,
  p_role text,
  p_content jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := nullif(btrim(coalesce(p_role, '')), '');
  v_id   uuid;
begin
  if not platform.project_accessible(p_project_id) then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_role is null or v_role not in ('user', 'assistant', 'tool_call', 'tool_result') then
    return jsonb_build_object('status', 'invalid_role');
  end if;

  -- Ein leeres Array wird ABGEWIESEN und nicht durchgelassen: eine Nachricht ohne Bloecke ist beim
  -- Wiedereinspielen in die Messages-API ein Fehler, und sie hier zu speichern hiesse, ihn in den
  -- naechsten Lauf zu vertagen. Die Reihenfolge ist Absicht — erst die Form, dann der Inhalt.
  if p_content is null or jsonb_typeof(p_content) <> 'array' then
    return jsonb_build_object('status', 'invalid_content');
  end if;
  if jsonb_array_length(p_content) = 0 then
    return jsonb_build_object('status', 'empty_content');
  end if;

  insert into platform.project_messages (project_id, role, content)
  values (p_project_id, v_role, p_content)
  returning id into v_id;

  return jsonb_build_object('status', 'ok', 'message_id', v_id);
end;
$$;

comment on function public.append_project_message(uuid, text, jsonb) is
  'B24: haengt EINE Nachricht an den Verlauf. Der einzige Schreibweg auf platform.project_messages — '
  'es gibt bewusst kein update und kein delete (die Unveraenderlichkeit des Verlaufs sitzt in der '
  'Rechteflaeche, nicht in einem Trigger; ein Trigger wuerde das Kaskadenloeschen des Projekts '
  'abweisen). Verlangt ein nicht-leeres Array von Bloecken: eine Nachricht ohne Bloecke ist beim '
  'Wiedereinspielen in die Messages-API ein Fehler, und ihn zu speichern hiesse, ihn zu vertagen. '
  'authenticated-only.';

-- ── list_project_messages ───────────────────────────────────────────────────────────────────────
-- ÄLTESTE ZUERST, anders als jede andere Liste dieses Repos (`admin_list_*` sortiert durchgängig
-- `created_at desc`). Der Grund ist der Zweck: dieser Verlauf wird ins Modell WIEDEREINGESPIELT, und
-- ein Gespräch in umgekehrter Reihenfolge ist kein Gespräch. Wer die letzten n Turns will, rechnet
-- den Versatz aus `total` — deshalb fährt die Gesamtzahl mit.
create function public.list_project_messages(
  p_project_id uuid,
  p_limit integer default 200,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total  integer;
  v_rows   jsonb;
begin
  if not platform.project_accessible(p_project_id) then
    return jsonb_build_object('status', 'not_found');
  end if;

  with base as (
    select m.id, m.project_id, m.role, m.content, m.created_at
    from platform.project_messages m
    where m.project_id = p_project_id
  ),
  page as (
    select b.* from base b order by b.created_at, b.id limit v_limit offset v_offset
  )
  select (select count(*)::integer from base),
         coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at, p.id) from page p), '[]'::jsonb)
    into v_total, v_rows;

  return jsonb_build_object('status', 'ok', 'total', v_total, 'messages', v_rows);
end;
$$;

comment on function public.list_project_messages(uuid, integer, integer) is
  'B24: der Verlauf eines Projekts, AELTESTE ZUERST — anders als jede andere Liste dieses Repos, '
  'weil dieser Verlauf ins Modell wiedereingespielt wird und ein Gespraech in umgekehrter Reihenfolge '
  'keines ist. Obergrenze 500 je Aufruf, Gesamtzahl getrennt (wer die letzten n Turns will, rechnet '
  'den Versatz daraus). Zweitsortierung nach id, damit zwei Nachrichten mit identischem Zeitstempel '
  'eine feste Reihenfolge haben. authenticated-only.';

-- ── append_project_document ─────────────────────────────────────────────────────────────────────
-- ⚠ WIRD NACH DEM UPLOAD AUFGERUFEN, NICHT DAVOR (Begründung in TEIL 3 und TEIL 7). Der Aufrufer
-- bringt die Kennung mit, die er beim Schreiben der Bytes benutzt hat; der PFAD wird hier daraus
-- GEBILDET und nie übernommen — deshalb kann kein Aufrufer ein Dokument in einen fremden
-- Projektordner eintragen, auch nicht versehentlich.
create function public.append_project_document(
  p_project_id uuid,
  p_document_id uuid,
  p_original_filename text,
  p_content_type text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name uuid;
  v_file text := nullif(btrim(coalesce(p_original_filename, '')), '');
  v_type text := nullif(btrim(coalesce(p_content_type, '')), '');
  v_path text;
  v_id   uuid;
begin
  if not platform.project_accessible(p_project_id) then
    return jsonb_build_object('status', 'not_found');
  end if;

  if p_document_id is null then
    return jsonb_build_object('status', 'invalid_document_id');
  end if;
  if v_file is null or v_type is null then
    return jsonb_build_object('status', 'invalid_metadata');
  end if;

  v_path := p_project_id::text || '/' || p_document_id::text;

  -- Ein zweiter Aufruf mit derselben Kennung ist ein WIEDERHOLTER Versuch, kein Fehler des Nutzers.
  -- Er wird BENANNT abgewiesen statt als roher 23505 durchgereicht — dieselbe Ueberlegung wie bei
  -- unknown_account in admin_create_project (Fundament).
  insert into platform.project_documents
    (id, project_id, storage_path, original_filename, content_type, uploaded_by)
  values (p_document_id, p_project_id, v_path, v_file, v_type, auth.uid())
  on conflict (id) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('status', 'duplicate_document');
  end if;

  return jsonb_build_object('status', 'ok', 'document_id', v_id, 'storage_path', v_path);
end;
$$;

comment on function public.append_project_document(uuid, uuid, text, text) is
  'B24: traegt eine bereits hochgeladene Datei ein. Wird NACH dem Schreiben der Bytes aufgerufen — '
  'umgekehrt stuende bei einem gescheiterten Upload eine Zeile im Bestand, die eine Datei behauptet, '
  'die es nicht gibt. Der Aufrufer bringt die Kennung mit (er brauchte sie fuer den Pfad), der PFAD '
  'wird hier daraus GEBILDET und nie uebernommen: ein Dokument kann damit nicht in einem fremden '
  'Projektordner landen. Eine bereits vergebene Kennung wird als duplicate_document abgewiesen, '
  'nicht als roher 23505. authenticated-only.';

-- ── list_project_documents ──────────────────────────────────────────────────────────────────────
-- Liefert `storage_path` mit, und das ist Absicht: der Download-Weg braucht ihn, und er ist KEINE
-- Befugnis — der Bucket ist privat, ohne Policy sieht ihn keine Client-Rolle, und der Pfad besteht
-- aus zwei Kennungen, die der Eigentümer ohnehin kennt. Bytes stehen hier keine (es gibt in dieser
-- Tabelle gar keine).
create function public.list_project_documents(
  p_project_id uuid,
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
  v_rows   jsonb;
begin
  if not platform.project_accessible(p_project_id) then
    return jsonb_build_object('status', 'not_found');
  end if;

  with base as (
    select d.id, d.project_id, d.storage_path, d.original_filename, d.content_type,
           d.uploaded_at, d.uploaded_by
    from platform.project_documents d
    where d.project_id = p_project_id
  ),
  page as (
    select b.* from base b order by b.uploaded_at, b.id limit v_limit offset v_offset
  )
  select (select count(*)::integer from base),
         coalesce((select jsonb_agg(to_jsonb(p) order by p.uploaded_at, p.id) from page p), '[]'::jsonb)
    into v_total, v_rows;

  return jsonb_build_object('status', 'ok', 'total', v_total, 'documents', v_rows);
end;
$$;

comment on function public.list_project_documents(uuid, integer, integer) is
  'B24: die Dateien eines Projekts — NUR Metadaten, keine Bytes (die liegen im Storage-Bucket, und '
  'diese Tabelle traegt gar keine). AELTESTE ZUERST wie der Verlauf: Dokumente entstehen IM '
  'Gespraech und werden mit ihm gelesen. storage_path faehrt mit, weil der Download-Weg ihn braucht '
  'und er keine Befugnis ist — der Bucket ist privat und ohne Policy fuer keine Client-Rolle '
  'erreichbar. authenticated-only.';

-- ── get_project_document ────────────────────────────────────────────────────────────────────────
-- Der EINSTIEG in den Download: die Eigentumsfrage wird hier von der DATENBANK beantwortet, und erst
-- danach fasst der service_role-Weg die Bytes an (TEIL 7). Nimmt die DOKUMENT-Kennung, nicht die des
-- Projekts — sonst müsste der Aufrufer das Projekt kennen, um an sein eigenes Dokument zu kommen,
-- und die Zuordnung Dokument→Projekt wäre eine Angabe des Aufrufers statt eine des Bestands.
create function public.get_project_document(p_document_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_doc jsonb;
begin
  select to_jsonb(d)
    into v_doc
  from (
    select doc.id, doc.project_id, doc.storage_path, doc.original_filename, doc.content_type,
           doc.uploaded_at, doc.uploaded_by
    from platform.project_documents doc
    where doc.id = p_document_id
      and platform.project_accessible(doc.project_id)
  ) d;

  if v_doc is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object('status', 'ok', 'document', v_doc);
end;
$$;

comment on function public.get_project_document(uuid) is
  'B24: EIN Dokument ueber seine eigene Kennung, samt storage_path — der Einstieg in den Download. '
  'Die Eigentumsfrage beantwortet die DATENBANK (ueber das Projekt des Dokuments), erst danach fasst '
  'der service_role-Weg die Bytes an. Fremd und unbekannt liefern denselben Status not_found. '
  'authenticated-only.';

-- ── append_open_question ────────────────────────────────────────────────────────────────────────
create function public.append_open_question(
  p_project_id uuid,
  p_question text,
  p_field_key text default null,
  p_impact_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_question text := nullif(btrim(coalesce(p_question, '')), '');
  v_field    text := nullif(btrim(coalesce(p_field_key, '')), '');
  v_impact   text := nullif(btrim(coalesce(p_impact_note, '')), '');
  v_id       uuid;
begin
  if not platform.project_accessible(p_project_id) then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_question is null then
    return jsonb_build_object('status', 'invalid_question');
  end if;

  -- Es wird BEWUSST NICHT auf eine bereits offene, gleichlautende Frage geprueft. Zwei Gruende:
  -- dieselbe Frage kann an zwei Stellen des Gespraechs mit anderem Bezug auftauchen, und eine
  -- Zusammenfuehrung waere ein Urteil ueber Gleichheit von Freitext, das nur der Chat faellen kann.
  -- Wer sie faellt, tut es sichtbar im naechsten Schritt und nicht still hier unten.
  insert into platform.project_open_questions (project_id, field_key, question, impact_note)
  values (p_project_id, v_field, v_question, v_impact)
  returning id into v_id;

  return jsonb_build_object('status', 'ok', 'question_id', v_id);
end;
$$;

comment on function public.append_open_question(uuid, text, text, text) is
  'B24: stellt eine Rueckfrage an Martin (Delta §3.3). Startet immer als status open ohne '
  'resolution_kind. p_field_key optional — Delta §3.5 kennt Fragen ohne Feldbezug. p_impact_note '
  'optional: die „aendert das Ergebnis stark/kaum"-Einschaetzung entsteht im Chat-Schritt, aber die '
  'Spalte bekommt ihren Schreibweg hier, damit sie keine Requisite ist. Fuehrt gleichlautende Fragen '
  'BEWUSST nicht zusammen — das waere ein Urteil ueber Freitext-Gleichheit, das nur der Chat faellen '
  'kann, und dann sichtbar. authenticated-only.';

-- ── list_open_questions ─────────────────────────────────────────────────────────────────────────
create function public.list_open_questions(
  p_project_id uuid,
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
  v_status text    := nullif(btrim(coalesce(p_status, '')), '');
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total  integer;
  v_rows   jsonb;
begin
  if not platform.project_accessible(p_project_id) then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Ein unbekannter Filterwert wird ABGELEHNT und nicht ignoriert (Muster admin_list_analyses,
  -- B14-1): eine still verworfene Einschraenkung zeigte mehr Zeilen als angefordert, und der
  -- Aufrufer hielte das Ergebnis fuer gefiltert.
  if v_status is not null and v_status not in ('open', 'answered', 'dismissed') then
    return jsonb_build_object('status', 'invalid_filter', 'filter', 'status');
  end if;

  with base as (
    select q.id, q.project_id, q.field_key, q.question, q.status, q.created_at,
           q.resolution_kind, q.resolution_value, q.assumption_note, q.impact_note,
           q.answered_by, q.answered_at
    from platform.project_open_questions q
    where q.project_id = p_project_id
      and (v_status is null or q.status = v_status)
  ),
  page as (
    select b.* from base b order by b.created_at, b.id limit v_limit offset v_offset
  )
  select (select count(*)::integer from base),
         coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at, p.id) from page p), '[]'::jsonb)
    into v_total, v_rows;

  return jsonb_build_object('status', 'ok', 'total', v_total, 'questions', v_rows);
end;
$$;

comment on function public.list_open_questions(uuid, text, integer, integer) is
  'B24: die Rueckfragen EINES Projekts — fuer den Kunden seine eigenen, fuer einen Admin die jedes '
  'Projekts; die Verzweigung steckt in platform.project_accessible und nicht hier. Ohne Filter '
  'ALLE Status, damit „bereits beantwortet" im Gespraech sichtbar bleibt; ein unbekannter '
  'Filterwert wird abgelehnt statt ignoriert. authenticated-only.';

-- ── resolve_open_question ───────────────────────────────────────────────────────────────────────
-- ⚠ HIER STEHT WEG (a) UND WEG (b) AUS §3.3 NEBENEINANDER — und die Zuordnung ist die eigentliche
-- Aussage dieser Funktion:
--
--   p_resolution_kind   →  status         resolution_kind   verlangt
--   ──────────────────     ────────────   ───────────────   ──────────────────────────────────────
--   'assumed'              open (!)       'assumed'         p_assumption_note (Begruendung)
--   'answered'             'answered'     'answered'        p_resolution_value
--   'dismissed'            'dismissed'    unveraendert      —
--
-- Die erste Zeile IST die Zusage des Deltas: eine Annahme laesst den Nutzer weiterarbeiten und
-- schliesst die Frage NICHT. `p_resolution_kind` ist deshalb der NAME DER HANDLUNG und nicht
-- eins-zu-eins die Spalte — 'dismissed' ist ein Status, kein resolution_kind, und die Spalte behaelt
-- dabei, womit der Chat weitergelaufen war.
create function public.resolve_open_question(
  p_question_id uuid,
  p_resolution_kind text,
  p_resolution_value text default null,
  p_assumption_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind  text := nullif(btrim(coalesce(p_resolution_kind, '')), '');
  v_value text := nullif(btrim(coalesce(p_resolution_value, '')), '');
  v_note  text := nullif(btrim(coalesce(p_assumption_note, '')), '');
  v_project uuid;
begin
  select q.project_id into v_project
  from platform.project_open_questions q
  where q.id = p_question_id;

  if v_project is null or not platform.project_accessible(v_project) then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_kind is null or v_kind not in ('assumed', 'answered', 'dismissed') then
    return jsonb_build_object('status', 'invalid_kind');
  end if;

  if v_kind = 'assumed' then
    -- Delta §3.3 verlangt eine BEGRUENDETE Annahme. Ohne Begruendung entstuende genau die stille,
    -- unbelegte Annahme, die dieses Projekt sonst ueberall vermeidet — deshalb eine Ablehnung und
    -- kein Durchwinken.
    if v_note is null then
      return jsonb_build_object('status', 'assumption_note_required');
    end if;

    update platform.project_open_questions
       set resolution_kind  = 'assumed',
           resolution_value = coalesce(v_value, resolution_value),
           assumption_note  = v_note
     where id = p_question_id;

    -- Der Rueckgabewert sagt es noch einmal im Klartext: der Aufrufer soll nicht annehmen, er haette
    -- die Frage damit erledigt.
    return jsonb_build_object('status', 'ok', 'question_status', 'open', 'still_open_for_review', true);
  end if;

  if v_kind = 'answered' then
    if v_value is null then
      return jsonb_build_object('status', 'resolution_value_required');
    end if;

    update platform.project_open_questions
       set status           = 'answered',
           resolution_kind  = 'answered',
           resolution_value = v_value,
           answered_by      = auth.uid(),
           answered_at      = now()
     where id = p_question_id;

    return jsonb_build_object('status', 'ok', 'question_status', 'answered', 'still_open_for_review', false);
  end if;

  -- 'dismissed': resolution_kind bleibt, wie er war — er sagt, WOMIT der Chat weitergelaufen ist,
  -- und das aendert sich durch das Schliessen nicht.
  update platform.project_open_questions
     set status = 'dismissed'
   where id = p_question_id;

  return jsonb_build_object('status', 'ok', 'question_status', 'dismissed', 'still_open_for_review', false);
end;
$$;

comment on function public.resolve_open_question(uuid, text, text, text) is
  'B24: Weg (a) und Weg (b) aus Delta §3.3. p_resolution_kind ist der NAME DER HANDLUNG, nicht '
  'eins-zu-eins die Spalte: assumed → resolution_kind assumed bei UNVERAENDERTEM status open (die '
  'Frage bleibt bei Martin — das ist die Zusage des Deltas), answered → status answered mit '
  'answered_by/answered_at, dismissed → status dismissed bei unveraendertem resolution_kind. '
  'assumed OHNE Begruendung wird abgewiesen (§3.3 verlangt eine begruendete Annahme), answered ohne '
  'Wert ebenso. Der Rueckgabewert nennt still_open_for_review ausdruecklich, damit der Aufrufer die '
  'Annahme nicht fuer eine Erledigung haelt. authenticated-only.';

-- ── admin_list_open_questions ───────────────────────────────────────────────────────────────────
-- Martins Posteingang, QUER über alle Projekte — die eine Ansicht, die `list_open_questions` (je
-- Projekt) nicht leisten kann, weil Martin nicht weiss, in welchem Projekt die nächste Frage liegt.
--
-- ⚠ ÄLTESTE ZUERST, entgegen der Gewohnheit aller `admin_list_*` dieses Repos (`created_at desc`).
-- Ein Posteingang wird von vorne abgearbeitet: mit `desc` läge die Frage, die am längsten wartet, am
-- Ende der letzten Seite — also ausgerechnet der Kunde, der am längsten hängt.
create function public.admin_list_open_questions(
  p_status text default 'open',
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
  v_status text    := nullif(btrim(coalesce(p_status, '')), '');
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total  integer;
  v_rows   jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_list_open_questions: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  if v_status is not null and v_status not in ('open', 'answered', 'dismissed') then
    return jsonb_build_object('status', 'invalid_filter', 'filter', 'status');
  end if;

  with base as (
    -- `customer_label` faehrt mit, und das ist der Zweck der Denormalisierung (B14-1): Martin muss
    -- sehen, WESSEN Frage er beantwortet, und der Account kann bereits verschwunden sein.
    select q.id, q.project_id, pr.customer_label, pr.segment,
           q.field_key, q.question, q.status, q.created_at,
           q.resolution_kind, q.resolution_value, q.assumption_note, q.impact_note,
           q.answered_by, q.answered_at
    from platform.project_open_questions q
    join platform.projects pr on pr.id = q.project_id
    where (v_status is null or q.status = v_status)
  ),
  page as (
    select b.* from base b order by b.created_at, b.id limit v_limit offset v_offset
  )
  select (select count(*)::integer from base),
         coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at, p.id) from page p), '[]'::jsonb)
    into v_total, v_rows;

  return jsonb_build_object('status', 'ok', 'total', v_total, 'questions', v_rows);
end;
$$;

comment on function public.admin_list_open_questions(text, integer, integer) is
  'B24: Martins Posteingang quer ueber ALLE Projekte, Vorgabe status open. AELTESTE ZUERST — '
  'entgegen der Gewohnheit aller admin_list_* dieses Repos, weil ein Posteingang von vorne '
  'abgearbeitet wird und bei desc ausgerechnet der am laengsten wartende Kunde am Ende der letzten '
  'Seite laege. Fuehrt customer_label und segment mit, damit sichtbar ist, WESSEN Frage es ist. '
  'WIRFT ohne Adminrolle (42501): eine leere Liste ist hier die haeufigste ECHTE Antwort und darf '
  'nicht zugleich „kein Zugriff" bedeuten. authenticated-only.';

-- ── admin_answer_open_question ──────────────────────────────────────────────────────────────────
-- ⚠ DER ZIELSTATUS IST EIN LITERAL, KEIN PARAMETER — wortgleiches Vorbild
-- `admin_reject_partner_application` (B16-3d). Diese Funktion kann AUSSCHLIESSLICH beantworten:
-- weder eine Annahme treffen noch eine Frage verwerfen. Beides gibt es fuer einen Admin ueber
-- `resolve_open_question` (er kommt ueber `project_accessible` an jedes Projekt) — aber es soll
-- nicht derselbe Aufruf sein: Martins Antwort ist der EINE Vorgang, an dem der Wert dieser ganzen
-- Tabelle haengt, und sie soll nicht versehentlich mit einem falschen Parameter zu einer Annahme
-- werden.
create function public.admin_answer_open_question(
  p_question_id uuid,
  p_answer text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_answer text := nullif(btrim(coalesce(p_answer, '')), '');
  v_found  boolean;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_answer_open_question: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  if v_answer is null then
    return jsonb_build_object('status', 'invalid_answer');
  end if;

  update platform.project_open_questions
     set status           = 'answered',
         resolution_kind  = 'answered',
         resolution_value = v_answer,
         answered_by      = auth.uid(),
         answered_at      = now()
   where id = p_question_id
  returning true into v_found;

  if v_found is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- ⚠ EINE BEREITS GETROFFENE ANNAHME BLEIBT STEHEN (`assumption_note` wird nicht angefasst). Sie
  -- belegt, womit in der Zwischenzeit gerechnet wurde — und genau daran erkennt der naechste Schritt,
  -- ob eine bereits ausgelieferte Analyse ueber supersedes_id zu korrigieren ist (Delta §3.3,
  -- „Korrektur nach Martins Antwort").
  return jsonb_build_object('status', 'ok', 'question_id', p_question_id);
end;
$$;

comment on function public.admin_answer_open_question(uuid, text) is
  'B24: Martins Antwort auf eine Rueckfrage. Der Zielstatus ist ein LITERAL und kein Parameter '
  '(Muster admin_reject_partner_application, B16-3d) — diese Funktion kann ausschliesslich '
  'beantworten, nie annehmen oder verwerfen; dafuer gibt es resolve_open_question. Laesst eine '
  'bereits getroffene Annahme samt Begruendung STEHEN: daran erkennt der naechste Schritt, ob eine '
  'ausgelieferte Analyse ueber supersedes_id zu korrigieren ist. WIRFT ohne Adminrolle (42501). '
  'authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 7 — der private Storage-Bucket
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ── ⚠ WARUM STORAGE UND NICHT `bytea` — der Bestand kennt bisher nur den anderen Weg ────────────
-- `platform.analyses.source_file_gzip` (B14-1) legt die Quelldatei einer Analyse als `bytea` IN der
-- Tabelle ab. Das ist dort richtig und bleibt es: es ist GENAU EINE eingefrorene Datei je Analyse,
-- sie gehoert untrennbar zu einer unveraenderlichen Zeile, und ihre Pruefsumme wird IN der Datenbank
-- gegen den Klartext geprueft — eine Trennung von Zeile und Datei koennte dort auseinanderlaufen.
--
-- Hier liegt der Fall anders, in drei Punkten:
--   * Es ist ein OFFENER Stapel unbekannter Groesse und unbekannten Typs (Delta §3.2: „Datei-Upload
--     beliebiger Dokumenttypen, keine Pflichtfeld-Vorabliste"; „zwoelf Monatsrechnungen statt einer
--     Jahresrechnung"), nicht eine eingefrorene Datei je Vorgang.
--   * Nichts davon wird in der Datenbank INHALTLICH geprueft. `bytea` traegt seinen Nutzen dort, wo
--     SQL mit dem Inhalt rechnet (`sha256()` in B14-1); hier reicht die Datenbank sie nur durch.
--   * Ein Gespraech laedt Dateien, waehrend es laeuft. Sie durch jede Zeilenfassung und jedes
--     Backup der Haupttabelle mitzuschleppen, kostet ohne Gegenwert.
--
-- ── ⚠ WAS AN `storage.objects` GEMESSEN WURDE, statt es der Dokumentation zu glauben ────────────
-- Gegen den lokalen Stack (Supabase-CLI, PostgreSQL 17):
--   * `storage.objects` und `storage.buckets` haben RLS AKTIV und **0 Policies**.
--   * `anon` UND `authenticated` haben auf beiden Tabellen die VOLLEN Tabellenrechte
--     (SELECT, INSERT, UPDATE, DELETE, …) — von Supabase selbst vergeben, nicht von uns.
--
-- Daraus folgt zweierlei, und der zweite Punkt ist der wichtige:
--   (1) Der Bucket ist ohne unser Zutun geschlossen: ohne Policy weist RLS jeden Zugriff der beiden
--       Client-Rollen ab, trotz der Grants. `service_role` traegt `rolbypassrls` und kommt vorbei —
--       das ist der einzige vorgesehene Weg.
--   (2) ⚠ ES GIBT HIER NUR EINE SCHICHT, NICHT ZWEI. Im `platform`-Schema schuetzen Policy-Freiheit
--       UND fehlendes Grant unabhaengig voneinander; auf `storage.objects` ist das Grant bereits
--       vergeben und laesst sich nicht sinnvoll entziehen (es gehoert dem Storage-Dienst). Die
--       Abwesenheit einer Policy ist damit das EINZIGE, was diesen Bucket verschlossen haelt —
--       **eine einzige spaeter hinzugefuegte, permissive Policy auf `storage.objects` ohne
--       `bucket_id`-Bedingung oeffnet ihn mit.** Das DB-Gate prueft deshalb nicht die Policy-Zahl,
--       sondern das VERHALTEN: `anon` und `authenticated` duerfen in diesem Bucket weder lesen noch
--       schreiben, echt versucht.
--
-- ── DER ZUGRIFFSWEG, DEN DIESE MIGRATION VORAUSSETZT ───────────────────────────────────────────
-- Hochladen (drei Schritte, Begruendung der Reihenfolge in TEIL 3):
--   1. `public.get_project(p_id)` als ANGEMELDETES KONTO — die Eigentumsfrage beantwortet die
--      Datenbank gegen `auth.uid()`, nie der Anwendungscode gegen einen uebergebenen Wert.
--   2. Bytes nach `<project_id>/<document_id>` schreiben, mit `service_role`.
--   3. `public.append_project_document(...)` als ANGEMELDETES KONTO — prueft ein zweites Mal und
--      bildet den Pfad selbst.
-- Herunterladen:
--   1. `public.get_project_document(p_id)` als ANGEMELDETES KONTO → liefert `storage_path`.
--   2. Bytes mit `service_role` holen.
--
-- ⚠ DER `service_role`-SCHLUESSEL ENTSCHEIDET IN DIESEM WEG NICHTS. Er transportiert nur Bytes; jede
-- Ja/Nein-Frage faellt vorher in der Datenbank gegen `auth.uid()`. Ein Wrapper, der stattdessen eine
-- Konto-Kennung entgegennaehme und ihr glaubte, waere die naheliegende Abkuerzung — und die eine
-- Stelle, an der ein Fehler im Anwendungscode zu einem Datenleck ueber Kundengrenzen wuerde.
--
-- ⚠ AUFLAGE AN DEN DOWNLOAD-WEG: die Auslieferung erzwingt einen ANHANG
-- (`Content-Disposition: attachment`) und darf sich NICHT auf das gespeicherte `content_type`
-- verlassen — das ist eine Angabe des Kunden (s. Spaltenkommentar). Der Bucket nimmt bewusst jeden
-- Typ an (Delta §3.2), also ist die Ausgabe die Stelle, an der das gefaehrlich werden koennte.
insert into storage.buckets (id, name, public, file_size_limit)
values (
  'project-documents',
  'project-documents',
  -- PRIVAT. Ein oeffentlicher Bucket haette eine erratbare URL je Objekt und damit einen Lesepfad
  -- an jeder Pruefung vorbei — genau das, was Prinzip 4 fuer Verbrauchsdaten ausschliesst.
  false,
  -- 20 MB je Datei, als Ruecklage IN DER DATENBANK und nicht nur im Anwendungscode. Die Zahl liegt
  -- ueber den bestehenden fachlichen Grenzen (Rechnungs-Scan 6 MB, PV-Auslegung 8 MB) und auf der
  -- Hoehe der groessten heute vorkommenden Datei (Analyse-Buendel, 20 MB): dieser Bucket nimmt
  -- Dokumente entgegen, deren Art vorher niemand kennt. Eine engere fachliche Grenze je Weg gehoert
  -- in den Anwendungscode; diese hier ist die Grenze, die auch ein fehlerhafter Aufrufer nicht
  -- ueberschreitet.
  20971520
)
on conflict (id) do nothing;

-- ⚠ KEINE POLICY AUF `storage.objects` — und das ist die Zeile, die es NICHT gibt. Sie steht hier als
-- Kommentar, damit niemand sie fuer vergessen haelt: der Bucket ist ausschliesslich ueber
-- `service_role` erreichbar, und der einzige Weg dorthin fuehrt ueber die Wrapper oben.
--
-- ⚠ DER BUCKET WIRD BEWUSST NICHT ZUSAETZLICH IN `supabase/config.toml` DEKLARIERT
-- ([storage.buckets.*] wirkt nur lokal). Zwei Quellen fuer denselben Bucket liefen auseinander, und
-- die lokale Fassung waere die, die niemand in der Cloud sieht. `on conflict do nothing` macht diese
-- Migration idempotent — ein bereits von Hand angelegter Bucket wird nicht ueberschrieben.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 8 — RLS und Rechte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Muster platform.accounts/projects (Fundament), platform.analyses (B14-1), platform.job_runs (B4-1):
-- RLS an, KEINE Policy, fuer KEINE Rolle ein Tabellen-Grant — auch nicht fuer service_role.
alter table platform.project_messages       enable row level security;
alter table platform.project_documents      enable row level security;
alter table platform.project_open_questions enable row level security;

-- Supabase vergibt per ALTER DEFAULT PRIVILEGES auf NEUE public-Funktionen automatisch EXECUTE an
-- anon, authenticated UND service_role (zusaetzlich zum PostgreSQL-Default-Grant an PUBLIC). Deshalb
-- wie ueberall: erst allen entziehen, dann gezielt gewaehren. `anon` und `service_role` bekommen
-- NIRGENDS etwas — jede dieser Funktionen leitet ihre Autorisierung aus auth.uid() bzw.
-- platform.is_admin() ab, was dort null bzw. false ist. Fuer `service_role` heisst das ausdruecklich:
-- der Weg zu den Dateien fuehrt fuer sie NUR ueber die Storage-API, nie ueber diese Wrapper.
revoke all on function public.get_project(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.update_project_draft(uuid, jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function public.append_project_message(uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.list_project_messages(uuid, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.append_project_document(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.list_project_documents(uuid, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.get_project_document(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.append_open_question(uuid, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.list_open_questions(uuid, text, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.resolve_open_question(uuid, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_list_open_questions(text, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_answer_open_question(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.get_project(uuid) to authenticated;
grant execute on function public.update_project_draft(uuid, jsonb, text) to authenticated;
grant execute on function public.append_project_message(uuid, text, jsonb) to authenticated;
grant execute on function public.list_project_messages(uuid, integer, integer) to authenticated;
grant execute on function public.append_project_document(uuid, uuid, text, text) to authenticated;
grant execute on function public.list_project_documents(uuid, integer, integer) to authenticated;
grant execute on function public.get_project_document(uuid) to authenticated;
grant execute on function public.append_open_question(uuid, text, text, text) to authenticated;
grant execute on function public.list_open_questions(uuid, text, integer, integer) to authenticated;
grant execute on function public.resolve_open_question(uuid, text, text, text) to authenticated;
grant execute on function public.admin_list_open_questions(text, integer, integer) to authenticated;
grant execute on function public.admin_answer_open_question(uuid, text) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 9 — was es hier BEWUSST NICHT GIBT
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- KEIN `update_project_message` und KEIN `delete_project_message`. Der Verlauf ist das Protokoll des
-- Gespraechs; ihn nachtraeglich zu aendern hiesse, die Grundlage einer bereits ausgelieferten
-- Aussage zu verschieben. Umgesetzt ueber die Rechteflaeche und NICHT ueber einen Trigger — der
-- wuerde das Kaskadenloeschen des Projekts abweisen (s. TEIL 2).
--
-- KEIN `delete_project_document`. Er braeuchte ausserdem einen zweiten Schritt, den SQL nicht kann:
-- das Objekt im Bucket entfernen. Ein Wrapper, der die Zeile loescht und die Datei stehen laesst,
-- erzeugte genau den Zustand, den TEIL 3 vermeidet — nur andersherum. Er kommt mit dem Schritt, der
-- ihn braucht, und dann zusammen mit dem Storage-Aufraeumweg.
--
-- KEIN Wrapper, der ein PROJEKT aendert oder loescht — unveraendert aus dem Fundament, aus demselben
-- Grund (es gibt weiterhin keine Oberflaeche, die es ausloesen koennte; ein Wrapper ohne Aufrufer
-- waere Angriffsflaeche ohne Nutzen).
--
-- KEIN Zusammenfuehren gleichlautender Rueckfragen und KEINE automatische Ableitung von
-- `impact_note` — beides sind Urteile, die nur der Chat faellen kann (§3.3), und beide gehoeren in
-- den Schritt, der ihn baut.
--
-- KEIN `deleted_questions`-Protokoll. Delta §4.2/offener Punkt 9 fordert eines — aber fuer den
-- FRAGENKATALOG (die admin-gepflegten Pflichtfragen), nicht fuer die Rueckfragen eines Projekts.
-- Die hier werden ohnehin nicht geloescht: 'dismissed' ist ein Status, kein Loeschen.
--
-- KEINE Aufbewahrungsfrist. `platform.run_lead_retention` (B4-1) fasst diese Tabellen nicht an. Ein
-- Gespraech traegt Kundentext und faellt damit unter dieselbe offene juristische Frage wie
-- `platform.partner_applications` (B16-3f, DEPLOYMENT.md §7) — sie ist mit diesem Schritt GROESSER
-- geworden und ausdruecklich weiterhin offen.
