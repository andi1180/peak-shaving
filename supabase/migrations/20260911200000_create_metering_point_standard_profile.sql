-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- B24, Teil 1 — DER STANDARDPROFIL-ZWEIG DES LASTGANG-SCHRITTS
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
--   TEIL 1  `public.set_metering_point_standard_profile` — der Schreibweg OHNE Quelldokument
--   TEIL 2  Rechte
--   TEIL 3  Was es hier BEWUSST NICHT GIBT
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠ WARUM ES EINEN ZWEITEN SCHREIBWEG BRAUCHT — gemessen, nicht angenommen
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- Der naheliegende Weg waere gewesen, `public.set_metering_point_load_profile` (Migration
-- 20260911120000 TEIL 4) mit `p_source_document_id => null` aufzurufen. Das geht NICHT: jene
-- Funktion weist genau das mit `invalid_document` ab, und zwar mit Absicht — sie schreibt die aus
-- einer DATEI gelesenen Metadaten und haelt fest, aus welchem Dokument sie stammen. Ein Zaehlpunkt
-- mit Zeitraum, aber ohne Quelle waere ueber sie ein Widerspruch.
--
-- Ein Standardprofil hat diese Quelle nicht, und es soll sie auch nicht vortaeuschen: es entsteht
-- aus EINER Zahl (dem Jahresverbrauch) und einer Kurve, die im Code steht. `source_document_id`
-- bleibt deshalb null — und genau daran unterscheidet die Oberflaeche spaeter die beiden Faelle.
--
-- ── ⚠ DIE BESTEHENDE FUNKTION IST UNANGETASTET, UND DAS IST DIE ENTSCHEIDUNG ──────────────────
-- Sie nullbar zu machen waere weniger Code und mehr Schaden: danach koennte ein DATEI-Upload
-- versehentlich ohne Dokument eingetragen werden, und niemand saehe es. Zwei Funktionen, weil es
-- zwei Herkuenfte sind — dieselbe Aufteilung, aus der `admin_reset_metering_point_load_profile`
-- BEIDE wieder aufloest (er setzt auch dann zurueck, wenn keine Quelle dasteht; das ist dort
-- ausdruecklich vorgesehen und braucht hier kein Gegenstueck).
--
-- ── `platform.project_accessible`, NICHT `is_admin()` ─────────────────────────────────────────
-- Wortgleich zum Upload-Zwilling und aus demselben Grund: das ist der Weg, den spaeter auch eine
-- Kundenoberflaeche gehen soll (ein Kunde, der seinen Jahresverbrauch eintraegt, ist der
-- Regelfall dieses Zweigs). Zerstoerend ist er nicht — er ERSETZT einen Arbeitsstand, er
-- vernichtet keine hochgeladene Datei; die zwei admin-only Wrapper des Rueckwegs tun das.


-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — set_metering_point_standard_profile
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Schreibt Intervall und Zeitraum eines ERZEUGTEN Profils an einen Zaehlpunkt und setzt dabei die
-- Quelle ausdruecklich auf null.
--
-- ── ⚠ `gaps` IST KEIN PARAMETER, UND DAS IST DER EIGENTLICHE UNTERSCHIED ZUM ZWILLING ─────────
-- Beim Datei-Upload ist `gaps` eine MESSUNG: der Leser zaehlt, wo im Export Werte fehlen. Ein
-- synthetisches Profil hat diese Frage nicht — der Generator baut ein lueckenloses Gitter ueber das
-- ganze Kalenderjahr, und `dataQuality.largestGapSlots` ist dort per Konstruktion 0. Ein Parameter
-- waere eine Einladung, eine Luecke zu behaupten, die es nicht geben kann. Geschrieben wird
-- deshalb immer `'[]'` — derselbe Wert, den auch der Zwilling bei einer lueckenlosen Datei traegt,
-- nur hier nicht als Ergebnis, sondern als Eigenschaft.
--
-- ⚠ ES WERDEN ALLE FUENF SPALTEN GEMEINSAM GESETZT, `source_document_id` eingeschlossen. Wird ein
-- Zaehlpunkt, der bisher eine Datei trug, auf ein Standardprofil umgestellt, muss die alte Quelle
-- WEG — sonst stuende der Zeitraum des Standardprofils neben dem Dokument des Uploads, und die
-- Oberflaeche zeigte die falsche Herkunft. (Die DATEI selbst bleibt dabei liegen; der Weg, sie zu
-- entfernen, ist der Rueckweg aus Migration 20260911180000, und die Oberflaeche fuehrt ihn vor
-- jedem Wechsel. Ein stilles Loeschen von hier aus koennte SQL ohnehin nicht.)
create function public.set_metering_point_standard_profile(
  p_metering_point_id uuid,
  p_interval_minutes integer,
  p_covered_from timestamptz,
  p_covered_to timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
begin
  select mp.project_id into v_project_id
  from platform.metering_points mp
  where mp.id = p_metering_point_id;

  -- Reihenfolge wie ueberall: erst „gibt es das und darf ich?", dann die Form der Argumente. Sonst
  -- verriete eine Argument-Fehlermeldung, dass die Kennung existiert.
  if v_project_id is null or not platform.project_accessible(v_project_id) then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Dieselben zwei Pruefungen und dieselben zwei Statuswerte wie beim Zwilling: der Zaehlpunkt
  -- traegt denselben CHECK, und eine abweichende Fehlerfamilie fuer denselben Verstoss haette der
  -- Oberflaeche zwei Uebersetzungen fuer eine Ursache abverlangt.
  if p_interval_minutes is null or p_interval_minutes not in (15, 60) then
    return jsonb_build_object('status', 'invalid_interval');
  end if;
  if p_covered_from is null or p_covered_to is null or p_covered_to <= p_covered_from then
    return jsonb_build_object('status', 'invalid_range');
  end if;

  update platform.metering_points mp
     set source_document_id = null,
         interval_minutes   = p_interval_minutes,
         covered_from       = p_covered_from,
         covered_to         = p_covered_to,
         gaps               = '[]'::jsonb
   where mp.id = p_metering_point_id;

  return jsonb_build_object(
    'status', 'ok',
    'metering_point_id', p_metering_point_id,
    'project_id', v_project_id
  );
end;
$$;

comment on function public.set_metering_point_standard_profile(uuid, integer, timestamptz, timestamptz) is
  'B24 Teil 1: schreibt Intervall und Zeitraum eines ERZEUGTEN Standardlastprofils an einen '
  'Zaehlpunkt und setzt source_document_id ausdruecklich auf null — ein Standardprofil hat keine '
  'Quelldatei und soll keine vortaeuschen. Der Zwilling set_metering_point_load_profile weist '
  'genau diesen Fall mit invalid_document ab, deshalb zwei Funktionen. gaps ist KEIN Parameter '
  'und immer []: ein synthetisches Profil ist per Konstruktion lueckenlos, und ein Parameter waere '
  'eine Einladung, eine Luecke zu behaupten, die es nicht geben kann. Speichert KEINE Zeitreihe — '
  'die Eingabe (Jahresverbrauch samt Herkunftsvermerk) steht im Entwurf des Zaehlpunkts. Prueft '
  'platform.project_accessible. authenticated-only.';


-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — Rechte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠ `from public, anon, authenticated, service_role`, nicht nur `from public`: Supabase vergibt per
-- ALTER DEFAULT PRIVILEGES auf JEDE neue Funktion im `public`-Schema ein EXECUTE an anon,
-- authenticated UND service_role — DIREKT, nicht ueber die Pseudo-Rolle PUBLIC. Ein blosses
-- `revoke ... from public` liesse die drei Supabase-Grants stehen, und die Funktion waere fuer
-- `anon` aufrufbar. In der Migration 20260911120000 ist genau das real passiert und vom DB-Gate
-- gefangen worden.
--
-- `service_role` bekommt NICHTS: sie traegt kein JWT, `platform.project_accessible` faellt dort auf
-- „kein eigenes Projekt, kein Admin" zurueck, und der Grant waere eine Tuer, hinter der nur eine
-- Ablehnung liegt — genau wie beim Zwilling.
revoke all on function public.set_metering_point_standard_profile(uuid, integer, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function public.set_metering_point_standard_profile(uuid, integer, timestamptz, timestamptz)
  to authenticated;


-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — Was es hier BEWUSST NICHT GIBT
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
--   * KEINE Spalte, die „Standardprofil" markiert. Der Unterschied steht bereits in den Daten:
--     Metadaten vorhanden UND `source_document_id` null heisst erzeugt, mit Quelle heisst gelesen.
--     Ein drittes Feld daneben waere ein zweiter Ort fuer dieselbe Aussage — und der erste, der
--     auseinanderlaeuft.
--   * KEINE Zeitreihe. Gespeichert werden Zeitpunkte und Zahlen UEBER die Reihe, nie die Reihe
--     selbst — dieselbe Bedingung wie beim Datei-Upload (Migration 20260911120000 TEIL 6). Die
--     EINGABE, aus der sich das Profil jederzeit neu erzeugen laesst, steht im Entwurf des
--     Zaehlpunkts (`platform.metering_points.draft`, Schluessel `annualConsumptionKwh` samt
--     Herkunftsvermerk in `_provenance`).
--   * KEIN eigener Rueckweg. `admin_reset_metering_point_load_profile` setzt auch dann zurueck,
--     wenn keine Quelle dasteht — das ist dort ausdruecklich vorgesehen und deckt diesen Fall mit
--     ab. Eine zweite Reset-Funktion waere eine zweite Stelle fuer dieselbe Entscheidung.
--     ⚠ Was sie NICHT tut: den Jahresverbrauch aus dem Entwurf entfernen. Der Entwurf gehoert den
--     Schritten, die ihn lesen, und ein Wrapper, der beim Zuruecksetzen des Zeitraums stillschwei-
--     gend eine Angabe des Kunden loescht, waere eine Nebenwirkung, die niemand entschieden hat.
--   * KEINE Aenderung an `list_metering_points`. ⚠ GEPRUEFT, NICHT ANGENOMMEN: die Station zeigt
--     den Jahresverbrauch aus dem Entwurf, und der Wrapper muss ihn deshalb mitliefern — er TUT es
--     bereits seit Migration 20260911150000 (`mp.draft` in der Spaltenliste). Eine Erweiterung hier
--     waere ein `create or replace` gewesen, das eine neuere Fassung mit einer aelteren ueberschreibt.
--     ⚠ Die Falle dabei: die Spaltenliste steht in DREI Migrationen, und die aelteste (20260911120000)
--     fuehrt `draft` NICHT. Massgeblich ist der WIRKSAME Rumpf (`pg_get_functiondef`), nicht die
--     Datei, in der die Funktion zuerst angelegt wurde — dieselbe Lehre wie Arbeitsregel 1.
--   * KEINE Aenderung an `admin_set_metering_point_count`. Dessen `has_load_profile`-Sperre haengt
--     an `source_document_id` und greift fuer ein Standardprofil deshalb NICHT — ein Zaehlpunkt mit
--     erzeugtem Profil laesst sich weiterhin wegverkleinern. ⚠ Bewusst nicht mitgezogen: die Sperre
--     schuetzt eine hochgeladene DATEI, die es sonst kein zweites Mal gibt; ein Standardprofil
--     entsteht aus einer Zahl im Entwurf neu. Wer sie dennoch ausweiten will, entscheidet damit
--     zugleich ueber jeden Zaehlpunkt mit blossem Entwurf — und das ist eine breitere Frage als
--     dieser Schritt.
