-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- B24 — der STANDORT eines Projekts: platform.projects.postal_code
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Die erste Migration seit Beginn des B24-Admin-Wizards. Alle Stationen davor (Lastgang, Rechnung,
-- Batterie, PV) kamen ohne aus — sie schreiben in `platform.metering_points.draft`, und ein
-- jsonb-Seiteneintrag braucht kein Schema.
--
-- ⚠ WARUM DAS HIER NICHT TRAEGT: DIE PLZ GILT PROJEKTWEIT, DER ENTWURF HAENGT AM ZAEHLPUNKT.
-- Seit dem Entwurfs-Umzug (20260911150000) liegt `draft` an `platform.metering_points` — und das
-- aus einem harten Grund: `tariffParamsSchema` besteht zu hundert Prozent aus ZAEHLPUNKT-
-- Eigenschaften (ein Vertrag wird je Anschluss geschlossen, ein Netzentgelt je Anschluss
-- verrechnet). Die Postleitzahl ist das Gegenteil davon: ein Betrieb mit zwei Anschluessen steht an
-- EINEM Ort. Im Entwurf abgelegt stuende sie je Zaehlpunkt einmal, und zwei Eintraege koennten
-- auseinanderlaufen, ohne dass irgendetwas fehlschluege — derselbe Fall, den `segment` und
-- `industry` am PROJEKT loesen (s. der Kopf jener Migration: „Eigenschaften des KUNDEN, nicht eines
-- Anschlusses").
--
-- ⚠ WOZU SIE UEBERHAUPT DA IST, UND WOZU AUSDRUECKLICH NICHT. Sie ist der Eingang in
-- `lookupPostalCodeCentroid` (`packages/shared/src/plz-centroids.ts`, B22b) — also in die
-- Koordinate, mit der PVGIS eine Erzeugung SCHAETZEN kann, wenn keine gemessene vorliegt. Der
-- Abruf selbst ist ein eigener, unmittelbar folgender Bauabschnitt; diese Migration legt
-- ausschliesslich die Angabe an. Sie ist KEINE Adresse: es gibt bewusst keine Strasse, keine
-- Hausnummer und kein Geocoding (die Messung in jenem Modulkopf: innerhalb einer Stadt liegt der
-- PVGIS-Ertragsunterschied unter 1 % — eine hausgenaue Koordinate bringt nichts Messbares und
-- waere ein Personenbezug, den es nicht zu geben braucht).
--
--   TEIL 1  die Spalte
--   TEIL 2  public.update_project_postal_code — der Schreibweg
--   TEIL 3  public.admin_get_project liefert sie mit
--   TEIL 4  public.get_project desgleichen
--
-- ⚠ TEIL 3 UND 4 SIND KEINE KOSMETIK, SONDERN DIE HAELFTE DES SCHRITTS. Beide Funktionen fuehren
-- eine AUSGESCHRIEBENE Spaltenliste; eine neu angelegte Spalte erscheint darin NICHT von selbst.
-- Ohne sie stuende die PLZ in der Datenbank und waere ueber keinen Wrapper wieder lesbar — der
-- Wizard zeigte nach jedem Neuladen ein leeres Feld, obwohl gespeichert ist, und der naechste Klick
-- schriebe denselben Wert erneut. Genau dieser Fall ist beim Entwurfs-Umzug real beinahe
-- eingetreten (`list_metering_points` fuehrte `mp.draft` zunaechst nicht mit, s. dortiger Nachtrag).
-- ═════════════════════════════════════════════════════════════════════════════════════════════════


-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — die Spalte
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- NULLABLE: „noch nicht erhoben" ist der Anfangszustand jedes Projekts und muss von „erhoben"
-- unterscheidbar bleiben. Ein Vorgabewert waere eine Ortsangabe, die niemand gemacht hat.
--
-- ⚠ DER CHECK IST WORTGLEICH DER VON `platform.leads.postal_code` (B3-1,
-- 20260721210000_create_lead_segmentation_columns.sql): oesterreichische PLZ, exakt vier Ziffern.
-- Zwei Schreibweisen fuer dieselbe Sache in derselben Datenbank waeren die teurere Wahl — und der
-- Grund, aus dem der CHECK dort steht, gilt hier schaerfer: dort ist die PLZ eine FILTERdimension
-- („alle Kuehlhaeuser im Netzgebiet Wien"), hier ist sie der SCHLUESSEL in eine Nachschlagetabelle.
-- Ein Wert wie „1100 Wien" oder „A-1100" faende dort keinen Eintrag, und die Anlage haette
-- entweder keine Koordinate oder — schlimmer — eine geratene.
--
-- ⚠ NORMALISIERT WIRD HIER NICHT. „A-1100" wird ABGEWIESEN, nicht zu „1100" gemacht: was der
-- Aufrufer geschickt hat und was gespeichert wurde, soll dasselbe sein (dieselbe Haltung wie bei
-- `industry`, das ausdruecklich nicht kleingeschrieben wird). Die Schreibweisen eines Briefkopfs
-- kennt `normalizePostalCode` im Anwendungscode; die Datenbank sieht nur das Ergebnis.
alter table platform.projects
  add column postal_code text check (postal_code ~ '^[0-9]{4}$');

comment on column platform.projects.postal_code is
  'B24: oesterreichische PLZ des Projektstandorts, per CHECK auf exakt vier Ziffern (wortgleich zu '
  'platform.leads.postal_code). NULL heisst „noch nicht erhoben", nicht „unbekannter Ort". Sie '
  'gilt PROJEKTWEIT und liegt deshalb hier und nicht im Entwurf eines Zaehlpunkts: ein Betrieb mit '
  'zwei Anschluessen steht an EINEM Ort. Eingang in lookupPostalCodeCentroid (packages/shared, '
  'B22b) und damit in die PVGIS-Koordinate — ausdruecklich KEINE Adresse: keine Strasse, keine '
  'Hausnummer, kein Geocoding.';


-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — der Schreibweg
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Muster `public.update_project_segment_industry` (20260911170000), bis in die Details: SECURITY
-- DEFINER, leerer `search_path`, Autorisierung ueber `platform.project_accessible` (eigenes Projekt
-- ODER Adminrolle), Rueckgabe als `jsonb_build_object('status', …)`.
--
-- ⚠ ER PRUEFT DAS FORMAT UND NICHT DIE EXISTENZ DER PLZ — und das ist eine Entscheidung, keine
-- Auslassung. Ob „0000" eine oesterreichische Postleitzahl IST, beantwortet allein
-- `lookupPostalCodeCentroid`, und das ist eine 2.501 Zeilen lange, aus GeoNames abgeleitete
-- Tabelle IM CODE (bewusst dort, s. deren Modulkopf). Sie in SQL zu spiegeln hiesse, denselben
-- Datensatz an zwei Orten zu pflegen; er wuerde beim ersten Nachtrag auseinanderlaufen, und dann
-- akzeptierte die eine Seite, was die andere ablehnt. Die SEMANTISCHE Pruefung sitzt deshalb in der
-- Server Action, unmittelbar vor diesem Aufruf.
--
-- ⚠ FOLGE, OFFENGELEGT: `invalid_postal_code` ist ueber die Oberflaeche UNERREICHBAR. Die Action
-- ruft den Wrapper ausschliesslich mit der bereits normalisierten, vierstelligen Form auf. Der
-- Status bleibt trotzdem — er ist die Tiefenstaffelung fuer einen Aufruf an der Oberflaeche vorbei
-- und liefert dort einen benannten Grund statt eines rohen 23514 aus dem CHECK, aus dem niemand
-- einen Satz bilden koennte. Dieselbe Aufteilung wie bei den grid_tariff-Wrappern (B21-2b): Grenze
-- im Schema, Meldung im Rumpf.
--
-- ⚠ EIN LEERER WERT HEISST UNVERAENDERT, NICHT LOESCHEN. Lesart `capture_lead`, wortgleich zu
-- `p_segment`/`p_industry` im Vorbild — und ausdruecklich NICHT die von `admin_update_lead` (dort
-- heisst null LOESCHEN; die beiden Regeln stehen seit B2-1 bewusst gegensaetzlich nebeneinander).
-- Einen Weg, die PLZ wieder zu entfernen, gibt es damit nicht; er waere heute auch nirgends
-- ausgeloest (die Oberflaeche laesst das Feld nicht leeren) und ist additiv nachruestbar.
create function public.update_project_postal_code(
  p_id uuid,
  p_postal_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_postal_code text := nullif(btrim(coalesce(p_postal_code, '')), '');
begin
  if not platform.project_accessible(p_id) then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_postal_code is not null and v_postal_code !~ '^[0-9]{4}$' then
    return jsonb_build_object('status', 'invalid_postal_code');
  end if;

  update platform.projects
     set postal_code = coalesce(v_postal_code, postal_code)
   where id = p_id;

  return jsonb_build_object('status', 'ok');
end;
$$;

comment on function public.update_project_postal_code(uuid, text) is
  'B24: setzt die PLZ des Projektstandorts. p_postal_code null oder leer heisst UNVERAENDERT '
  '(Lesart capture_lead, nicht admin_update_lead) — es gibt bewusst keinen Weg, sie wieder zu '
  'entfernen. Geprueft wird ausschliesslich das FORMAT (exakt vier Ziffern, Status '
  'invalid_postal_code); OB es die PLZ gibt, entscheidet lookupPostalCodeCentroid im '
  'Anwendungscode — die Nachschlagetabelle liegt dort und wird nicht in SQL gespiegelt. Es wird '
  'NICHT normalisiert: „A-1100" wird abgewiesen, nicht umgeschrieben. Fremd und unbekannt liefern '
  'denselben Status not_found. authenticated-only.';

-- ⚠ ES MUSS `from public, anon, authenticated, service_role` HEISSEN, NICHT NUR `from public`.
-- Supabase vergibt per ALTER DEFAULT PRIVILEGES auf JEDE neue Funktion im `public`-Schema ein
-- EXECUTE an `anon`, `authenticated` UND `service_role` — DIREKT, nicht ueber die Pseudo-Rolle
-- PUBLIC. Ein blosses `revoke ... from public` liesse die drei Supabase-Grants stehen, und die neue
-- Funktion waere fuer `anon` aufrufbar.
--
-- Die Grants sind damit identisch zum Vorbild: anon false, authenticated true, service_role false.
-- `anon` und `service_role` bekommen nichts, weil die Funktion ihre Autorisierung ueber
-- platform.project_accessible aus auth.uid() ableitet — und das ist dort null.
revoke all on function public.update_project_postal_code(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.update_project_postal_code(uuid, text) to authenticated;


-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — admin_get_project liefert die Spalte mit
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Die Spaltenliste ist WORT FUER WORT die bisherige (20260911090000 TEIL 3), ergaenzt um
-- `pr.postal_code`. Signatur unveraendert, also `create or replace`: die Grants bleiben, ein DROP
-- haette sie mitgenommen (in B3-1 real passiert).
--
-- Die ausgeschriebene Spaltenliste ist an sich richtig — sie verhindert, dass eine kuenftige
-- interne Spalte ungefragt nach aussen wandert. Sie muss nur mitgezogen werden, und genau das ist
-- der Grund, aus dem dieser TEIL existiert.
create or replace function public.admin_get_project(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_project jsonb;
begin
  if not platform.is_admin() then
    raise exception 'public.admin_get_project: Adminrolle erforderlich'
      using errcode = '42501';
  end if;

  select to_jsonb(p)
    into v_project
  from (
    select pr.id,
           pr.account_id,
           pr.customer_label,
           pr.segment,
           pr.industry,
           pr.postal_code,
           pr.created_by,
           (select au.email from auth.users au where au.id = pr.created_by) as created_by_email,
           pr.created_at,
           pr.updated_at
    from platform.projects pr
    where pr.id = p_id
  ) p;

  if v_project is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object('status', 'ok', 'project', v_project);
end;
$$;

comment on function public.admin_get_project(uuid) is
  'B24: EIN Projekt als Admin, unabhaengig von account_id. Liefert created_by UND das dazu '
  'aufgeloeste created_by_email (auth.users ist fuer keine Client-Rolle lesbar, Muster '
  'admin_get_analysis), seit 20260911090000 segment und industry und seit 20260913090000 '
  'postal_code. WIRFT ohne Adminrolle (42501), liefert sonst {status: not_found} fuer eine '
  'unbekannte Kennung. authenticated-only.';


-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — get_project desgleichen
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠ NICHT ZUR VOLLSTAENDIGKEIT, SONDERN GEGEN EINE BENANNTE FALLE. Der Schreibweg aus TEIL 2 prueft
-- `platform.project_accessible` — er steht damit dem Projekteigentuemer offen, nicht nur dem Admin.
-- Bliebe `get_project` unveraendert, gaebe es fuer die Kundenseite einen Schreib- ohne Leseweg: der
-- Chat koennte die PLZ setzen und sie nie wieder sehen. Genau diese Asymmetrie ist beim
-- Branchen-Schreibweg als eigene Zusage gepinnt („die Branche wird geschrieben UND von get_project
-- mitgeliefert" — ohne das koennte der Chat sie setzen und nie wieder sehen).
--
-- Dass es heute weder ein Chat-Werkzeug noch einen Leser dafuer gibt, aendert daran nichts: die
-- Luecke waere erst auffaellig, wenn jemand den Weg baut — und dann als Fehlverhalten, nicht als
-- fehlende Zeile. Spaltenliste wortgleich zur bisherigen (20260911160000 TEIL 1), ergaenzt um
-- `pr.postal_code`; Signatur unveraendert, `create or replace`, Grants bleiben.
create or replace function public.get_project(p_id uuid)
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
    select pr.id, pr.account_id, pr.customer_label, pr.segment, pr.industry, pr.postal_code,
           pr.created_at, pr.updated_at
    from platform.projects pr
    where pr.id = p_id
  ) p;

  return jsonb_build_object('status', 'ok', 'project', v_project);
end;
$$;

comment on function public.get_project(uuid) is
  'B24: EIN Projekt samt segment, industry und (seit 20260913090000) postal_code — eigenes ODER '
  '(als Admin) ein beliebiges. Ergaenzt get_my_project, das unveraendert bleibt und nur die '
  'Kundensicht kennt. Liefert bewusst KEIN created_by (Kundensicht) und seit der Migration '
  '20260911160000 keinen draft mehr — der ENTWURF liegt am ZAEHLPUNKT (list_metering_points). '
  'Fremd und unbekannt liefern denselben Status not_found. authenticated-only.';
