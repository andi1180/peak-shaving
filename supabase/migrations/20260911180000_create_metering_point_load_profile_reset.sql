-- B24 — Teil 1: der RUECKWEG des Lastgang-Schritts. Ein eingelesener Lastgang laesst sich
-- entfernen, und danach laesst sich ein neuer hochladen.
--
-- Kanonische fachliche Quelle: `Pflichtenheft_Kalkulator_Delta_KI-Interface.md` §2.3 (Zaehlpunkt)
-- und §3.2 (Dokumente). Einordnung: `Fahrplan_2026.md`, B24 — Teil 1.
--
-- ── WAS HIER ENTSTEHT ───────────────────────────────────────────────────────────────────────────
--   TEIL 1  `public.admin_reset_metering_point_load_profile`  — die Metadaten am Zaehlpunkt loesen
--   TEIL 2  `public.admin_delete_metering_point_document`     — die geloeste Zeile entfernen
--   TEIL 3  Rechte
--   TEIL 4  Was es hier BEWUSST NICHT GIBT
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠ WARUM ES ZWEI FUNKTIONEN SIND UND NICHT EINE — die Entscheidung, die alles andere bestimmt
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- Das Entfernen besteht aus DREI Vorgaengen, und einer davon liegt ausserhalb der Datenbank:
--
--   (1) die Metadaten am Zaehlpunkt loesen        — SQL
--   (2) das Objekt im Storage-Bucket entfernen    — NICHT SQL (Storage-API, service_role)
--   (3) die Zeile in `platform.project_documents` — SQL
--
-- Genau das ist der Grund, aus dem TEIL 9 der Migration `20260910090000` keinen
-- `delete_project_document` angelegt hat: „Er braeuchte ausserdem einen zweiten Schritt, den SQL
-- nicht kann: das Objekt im Bucket entfernen. Ein Wrapper, der die Zeile loescht und die Datei
-- stehen laesst, erzeugte genau den Zustand, den TEIL 3 vermeidet — nur andersherum."
--
-- Die Reihenfolge ist deshalb (1) → (2) → (3), und sie ist NICHT beliebig: Bricht der Vorgang
-- zwischen (2) und (3) ab, bleibt eine Zeile ohne Datei — sichtbar in `list_project_documents`,
-- reparierbar, und der Zaehlpunkt ist bereits sauber, der Admin kann also neu hochladen. Bricht er
-- in der umgekehrten Reihenfolge ab, bleibt ein Objekt im Bucket, auf das KEINE Zeile mehr zeigt:
-- unsichtbar, von niemandem mehr erreichbar, und es faellt nie jemandem auf. Ein sichtbarer Rest
-- ist billiger als ein unsichtbarer — dieselbe Abwaegung wie beim Upload (TEIL 3 jener Migration),
-- nur mit umgekehrtem Vorzeichen.
--
-- Zwei Funktionen, weil (2) dazwischenliegt. Eine einzige Funktion koennte den Bucket nicht
-- anfassen und muesste (3) vor (2) erledigen — also genau die Reihenfolge, die den unsichtbaren
-- Rest erzeugt.
--
-- ── ⚠ ADMIN-ONLY, ANDERS ALS DER SCHREIBWEG DANEBEN ────────────────────────────────────────────
-- `set_metering_point_load_profile` prueft `platform.project_accessible` (eigenes Projekt ODER
-- Adminrolle) — es ist der Weg, den spaeter auch eine Kundenoberflaeche gehen soll. Diese beiden
-- hier pruefen `platform.is_admin()` und WERFEN 42501, wie `admin_set_metering_point_count`, der
-- andere zerstoerende Zaehlpunkt-Wrapper. Der Grund ist nicht Symmetrie, sondern Zurueckhaltung:
-- Ob und wie ein KUNDE eine bereits abgelegte Datei wieder entfernen darf, hat niemand entschieden
-- — und ein `project_accessible` hier entschiede es still. Der einzige Aufrufer ist heute der
-- Admin-Wizard.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — admin_reset_metering_point_load_profile
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Setzt die fuenf Lastgang-Spalten eines Zaehlpunkts auf ihren Ausgangszustand zurueck und liefert
-- die Kennung UND den Storage-Pfad des Dokuments, das er bis eben als Quelle trug.
--
-- ── ⚠ DIE ANTWORT MUSS DEN VERWEIS TRAGEN, WEIL SIE IHN GERADE VERNICHTET ──────────────────────
-- Nach dem Zuruecksetzen gibt es keinen Weg mehr von diesem Zaehlpunkt zu seinem Dokument: die
-- Spalte ist null, und es existiert keine zweite Stelle, an der die Zuordnung stuende. Wer die
-- Kennung danach braucht — und die Schritte (2) und (3) brauchen sie — muss sie aus DIESEM Aufruf
-- haben. Deshalb wird sie VOR dem UPDATE gelesen und mitgegeben.
--
-- Der `storage_path` kommt mit, statt im Anwendungscode neu gebildet zu werden. Er steht in der
-- Zeile, der CHECK `project_documents_storage_path_derived` haelt ihn auf `<project_id>/<id>` fest,
-- und ihn ein zweites Mal zusammenzusetzen hiesse, das Pfadschema an einem zweiten Ort
-- auszuschreiben — genau das, was jener CHECK verhindern soll.
--
-- ── ES WIRD IMMER ZURUECKGESETZT, AUCH OHNE QUELLE — und das ist kein Leerlauf ─────────────────
-- Es gibt einen realen Stand, in dem die vier Metadaten dastehen und `source_document_id` null ist:
-- `on delete set null` nullt den Verweis, wenn jemand das Dokument direkt entfernt, und laesst die
-- abgeleiteten Angaben ausdruecklich stehen (Migration 20260911120000, TEIL 1 — sie sind dann „die
-- letzte Aussage darueber, was einmal gelesen wurde"). Genau diesen Rest raeumt der Aufruf mit auf.
-- `document_id` ist dann null, und der Aufrufer hat nichts zu loeschen.
create function public.admin_reset_metering_point_load_profile(
  p_metering_point_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id   uuid;
  v_document_id  uuid;
  v_storage_path text;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_reset_metering_point_load_profile: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  -- ⚠ `for update`: zwischen dem Lesen des Verweises und dem UPDATE darf kein zweiter Aufruf
  -- dieselbe Kennung lesen. Sonst bekaemen zwei gleichzeitige Klicks BEIDE dasselbe Dokument
  -- genannt, beide loeschten es, und der zweite Durchlauf faende im Bucket nichts mehr vor.
  select mp.project_id, mp.source_document_id
    into v_project_id, v_document_id
  from platform.metering_points mp
  where mp.id = p_metering_point_id
  for update;

  if v_project_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_document_id is not null then
    select d.storage_path into v_storage_path
    from platform.project_documents d
    where d.id = v_document_id;
  end if;

  -- Alle fuenf gemeinsam — spiegelbildlich zu `set_metering_point_load_profile`, das sie gemeinsam
  -- ERSETZT. Ein feldweises Zuruecksetzen erzeugte Zwischenstaende, in denen ein Zeitraum ohne
  -- Quelle oder eine Luecke ohne Zeitraum dastuende.
  update platform.metering_points mp
     set source_document_id = null,
         interval_minutes   = null,
         covered_from       = null,
         covered_to         = null,
         gaps               = '[]'::jsonb
   where mp.id = p_metering_point_id;

  return jsonb_build_object(
    'status', 'ok',
    'metering_point_id', p_metering_point_id,
    'project_id', v_project_id,
    -- null heisst: dieser Zaehlpunkt trug keine Quelle. Der Aufrufer hat dann nichts zu loeschen,
    -- und das ist eine ANDERE Aussage als ein Fehlschlag.
    'document_id', v_document_id,
    'storage_path', v_storage_path
  );
end;
$$;

comment on function public.admin_reset_metering_point_load_profile(uuid) is
  'B24 Teil 1: setzt die fuenf Lastgang-Spalten eines Zaehlpunkts gemeinsam auf den Ausgangszustand '
  'zurueck (Verweis null, Intervall/Zeitraum null, gaps []) und liefert Kennung und storage_path '
  'des bis dahin verwiesenen Dokuments MIT — nach dem UPDATE gibt es keinen Weg mehr dorthin, und '
  'die zwei Folgeschritte (Objekt im Bucket, Zeile in project_documents) brauchen beides. '
  'Idempotent: raeumt auch den Stand auf, in dem on-delete-set-null den Verweis bereits genullt und '
  'die abgeleiteten Angaben stehen gelassen hat; document_id ist dann null. Loescht SELBST kein '
  'Dokument — das kann SQL nicht vollstaendig (der Bucket liegt ausserhalb). WIRFT ohne Adminrolle '
  '(42501). authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — admin_delete_metering_point_document
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Der dritte und letzte Schritt: die Zeile in `platform.project_documents` entfernen, nachdem das
-- Objekt im Bucket weg ist.
--
-- ── ⚠ DAS IST AUSDRUECKLICH KEIN ALLGEMEINER `delete_project_document` ─────────────────────────
-- Der waere die naheliegende Form und ist bewusst NICHT gebaut. Diese Funktion nimmt den ZAEHLPUNKT
-- mit entgegen und laesst sich ohne ihn gar nicht aufrufen; daraus folgen drei Bedingungen, die
-- zusammen den Weg auf den Fall einschnueren, fuer den er existiert:
--
--   (a) der Zaehlpunkt muss es geben — sonst `not_found`;
--   (b) das Dokument muss zum SELBEN Projekt gehoeren wie er — sonst `unknown_document`
--       (dieselbe Pruefung und derselbe Status wie im Schreibweg `set_metering_point_load_profile`:
--       der Fremdschluessel sagt nur „es gibt dieses Dokument", nicht „es gehoert hierher");
--   (c) KEIN Zaehlpunkt darf es noch als Quelle fuehren — sonst `in_use`.
--
-- (c) ist die eigentliche Sperre. Sie sagt: TEIL 1 muss gelaufen sein. Und sie schuetzt zugleich
-- den Fall, den niemand plant — zwei Zaehlpunkte, die auf dasselbe Dokument zeigen: dann faellt
-- der Aufruf aus, statt dem zweiten die Quelle unter den Fuessen wegzuziehen.
--
-- ⚠ DIE GRENZE, DIE BLEIBT, und sie wird hier benannt statt weggeschrieben: Ein Dokument desselben
-- Projekts, das NIE Lastgang-Quelle war (ein Upload aus dem Chat), erfuellt (a) bis (c) ebenfalls
-- und liesse sich ueber diesen Weg entfernen, wenn jemand seine Kennung kennt. Enger geht es nicht,
-- ohne den Verweis am Zaehlpunkt stehen zu lassen — und der Verweis ist genau das, was TEIL 1
-- aufloest, damit der Zaehlpunkt nach einem Abbruch nicht in einem halben Zustand dasteht
-- („Lastgang eingelesen" mit leerem Zeitraum). Der Aufrufer ist der Admin-Wizard, und die Kennung
-- stammt aus der Antwort von TEIL 1.
create function public.admin_delete_metering_point_document(
  p_metering_point_id uuid,
  p_document_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_delete_metering_point_document: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select mp.project_id into v_project_id
  from platform.metering_points mp
  where mp.id = p_metering_point_id;

  if v_project_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- (b) — ein Dokument aus einem FREMDEN Projekt und ein gar nicht existierendes liefern denselben
  -- Status: die Antwort soll nicht verraten, welche Dokumentkennungen es sonst noch gibt.
  if not exists (
    select 1 from platform.project_documents d
    where d.id = p_document_id and d.project_id = v_project_id
  ) then
    return jsonb_build_object('status', 'unknown_document');
  end if;

  -- (c) — die Sperre. Sie wird VOR dem DELETE geprueft und nicht dem Fremdschluessel ueberlassen:
  -- der traegt `on delete set null` und liesse das Loeschen anstandslos durch, waehrend er dem
  -- verweisenden Zaehlpunkt still die Quelle naehme.
  if exists (
    select 1 from platform.metering_points mp
    where mp.source_document_id = p_document_id
  ) then
    return jsonb_build_object('status', 'in_use');
  end if;

  delete from platform.project_documents d where d.id = p_document_id;

  return jsonb_build_object(
    'status', 'ok',
    'document_id', p_document_id,
    'project_id', v_project_id
  );
end;
$$;

comment on function public.admin_delete_metering_point_document(uuid, uuid) is
  'B24 Teil 1: entfernt die project_documents-Zeile eines Lastgang-Dokuments — der dritte Schritt '
  'des Entfernens, NACH dem Objekt im Bucket. ⚠ KEIN allgemeiner delete_project_document: der '
  'Zaehlpunkt ist Pflichtparameter, das Dokument muss zu SEINEM Projekt gehoeren, und kein '
  'Zaehlpunkt darf es noch als Quelle fuehren (in_use) — Letzteres heisst: '
  'admin_reset_metering_point_load_profile muss gelaufen sein. Die verbleibende Grenze steht im '
  'Kopf der Migration: ein Chat-Dokument DESSELBEN Projekts erfuellt dieselben Bedingungen. '
  'WIRFT ohne Adminrolle (42501). authenticated-only.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — Rechte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠ `from public, anon, authenticated, service_role`, nicht nur `from public`: Supabase vergibt per
-- ALTER DEFAULT PRIVILEGES auf JEDE neue Funktion im `public`-Schema ein EXECUTE an anon,
-- authenticated UND service_role — DIREKT, nicht ueber die Pseudo-Rolle PUBLIC. Ein blosses
-- `revoke ... from public` liesse die drei Supabase-Grants stehen, und die Funktionen waeren fuer
-- `anon` aufrufbar. In der Migration 20260911120000 ist genau das real passiert und vom DB-Gate
-- gefangen worden.
--
-- `service_role` bekommt NICHTS: sie traegt kein JWT, `platform.is_admin()` ist dort false, und der
-- Grant waere eine Tuer, hinter der nur eine Ablehnung liegt. Ihr Weg zu den Dateien fuehrt
-- ausschliesslich ueber die Storage-API — genau so, wie TEIL 8 der Migration 20260910090000 es
-- festhaelt, und genau so laeuft Schritt (2) des Entfernens.
revoke all on function public.admin_reset_metering_point_load_profile(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_delete_metering_point_document(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_reset_metering_point_load_profile(uuid) to authenticated;
grant execute on function public.admin_delete_metering_point_document(uuid, uuid) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — Was es hier BEWUSST NICHT GIBT
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
--   * KEIN allgemeiner `delete_project_document` — s. TEIL 2. Die Zurueckhaltung aus TEIL 9 der
--     Migration 20260910090000 gilt fuer jeden anderen Dokumenttyp unveraendert weiter; was hier
--     entsteht, ist der EINE Weg, den der Lastgang-Schritt braucht.
--   * KEIN Tabellen-Grant. `platform.project_documents` und `platform.metering_points` haben fuer
--     KEINE Rolle ein Tabellenrecht, und das aendert dieser Schritt nicht.
--   * KEIN Loeschprotokoll. `grid_tariff_deletions` (B21-2c) hat eines, weil ein Tarifstand eine
--     veroeffentlichte Preisgrundlage ist, die in bereits gerechnete Analysen eingeht. Ein
--     Lastgang-Upload ist ein Arbeitsstand der Dateneingabe; er geht in nichts ein, was ausgeliefert
--     waere, und der Rueckweg ist das Hochladen derselben Datei.
--   * KEIN gezielter Loeschweg fuer EINEN Zaehlpunkt — unveraendert offen (TEIL 6 der Migration
--     20260911120000). Was hier entsteht, entfernt den LASTGANG, nicht den Zaehlpunkt.
--     ⚠ Nebeneffekt, den man kennen sollte: danach laesst sich wieder verkleinern, weil
--     `admin_set_metering_point_count` genau auf `source_document_id` sperrt.
--   * KEIN Aufraeumlauf fuer verwaiste Dokumente. Bricht das Entfernen zwischen Schritt (2) und (3)
--     ab, bleibt eine Zeile ohne Datei stehen — sichtbar in `list_project_documents` und bewusst in
--     Kauf genommen (s. Kopf). Ein Job, der so etwas still wegraeumt, braeuchte eine eigene
--     Entscheidung darueber, woran er einen Rest von einem Dokument unterscheidet.
