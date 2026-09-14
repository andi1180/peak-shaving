-- Neuprüfung eines UNVERÄNDERTEN Lieferanten-Tarifstands: `public.confirm_retail_tariff`.
--
-- Kanonische fachliche Quelle: `Pflichtenheft_Kalkulator_Delta_Tarifoptimierung.md`, Delta 5
-- (Admin-Pflege) und Delta 10 (gemeinsames Admin-UI). Gehört zu den zwei Nachbarmigrationen
-- `…120000` (Tabelle) und `…120100` (Schreibweg).
--
-- ── DIESE MIGRATION IST DIE EINLÖSUNG EINER AUFLAGE, KEIN NEUER FUNKTIONSUMFANG ─────────────────
-- Der Kopf von `…120100` schreibt sie wörtlich vor:
--
--     „`service_role` bekommt unten UPDATE auf `retail_tariffs` — nicht, um Zeilen zu ändern,
--      sondern für das Schliessen der Vorgängerin und die Zeilensperre. Über PostgREST liesse sich
--      mit diesem Recht JEDE Spalte überschreiben, auch der Preis selbst. Wer die Neuprüfung eines
--      unveränderten Stands baut, baut sie deshalb als EIGENE Funktion, die nichts anfasst ausser
--      `checked_at` — und nicht als `.update()` aus dem Anwendungscode. Sonst wäre ‚nie in-place
--      überschrieben' eine Konvention statt einer Regel."
--
-- Genau das entsteht hier: EINE Funktion, EINE Spalte, kein Parameter für den Wert.
--
-- ── WAS HIER ENTSTEHT ───────────────────────────────────────────────────────────────────────────
--   TEIL 1  public.confirm_retail_tariff(p_id uuid) — setzt `checked_at` auf `now()`, sonst nichts
--   TEIL 2  Die Rechte der Funktion selbst — und die Feststellung, dass die Tabelle KEINE neuen
--           bekommt (gemessen, s. unten)
--
-- Keine Tabelle, keine Spalte, kein Trigger, keine Policy, keine Zeile Inhalt, KEIN neues
-- Tabellen-Grant. `grid_tariffs`, `grid_tariff_rate_windows`, `spot_prices` und `platform` werden
-- NICHT angefasst; `public.create_retail_tariff` bleibt unverändert.
--
-- ── ⚠ DIE RECHTEFLÄCHE IST GEMESSEN, UND DIE ERWARTUNG WAR FALSCH ──────────────────────────────
-- Die Aufgabenstellung ging davon aus, dieser Weg brauche NUR `update` — „die id kommt vom
-- Aufrufer, es gibt nichts zu suchen". Gegen den lokalen Stack (PostgreSQL 17.6) in zurückgerollten
-- Transaktionen Stufe für Stufe nachgemessen, mit einer echten Zeile und einem echten Aufruf unter
-- `set local role service_role`:
--
--     kein Grant                  → 42501 permission denied for table retail_tariffs
--     update                      → 42501 permission denied for table retail_tariffs
--     select                      → 42501 permission denied for table retail_tariffs
--     select + update             → {"status":"confirmed", …}
--     insert + select + update    → {"status":"confirmed", …}   (kein Unterschied)
--
-- Der Grund steht in der UPDATE-Dokumentation: Wer schreibt, braucht SELECT auf JEDE Spalte, deren
-- Wert in einer Bedingung oder einem Ausdruck GELESEN wird — und `where id = p_id` liest `id`.
-- ⚠ Gegenprobe, damit die Ursache eindeutig ist: dieselbe Messung mit einer Fassung OHNE
-- `returning` ergibt dieselbe Reihe. Es hängt also an der WHERE-Bedingung, nicht am Rückgabewert;
-- wer das `returning` je entfernt, weil der Status genügt, braucht SELECT trotzdem.
--
--   ⇒ FOLGE: Diese Migration vergibt GAR KEIN Tabellen-Grant. `service_role` hat seit `…120100`
--     bereits `insert, select, update` — dieser Weg passt vollständig darunter und vergrössert die
--     Fläche um nichts. Ein `grant update` hier wäre ein Duplikat ohne Wirkung; ein `grant select`
--     erweckte den Eindruck, das Lesen käme erst mit dieser Funktion dazu.
--
-- Das nimmt der Auflage nichts: Sie verlangt eine eigene FUNKTION statt einer `.update()`-Zeile im
-- Anwendungscode — nicht eine kleinere Rechtefläche. Die liesse sich hier ohnehin nicht kleiner
-- machen, weil der Schreibweg dieselben drei Rechte braucht.
--
-- ── SECURITY INVOKER — wie die beiden Nachbarfunktionen und aus demselben Grund ─────────────────
-- Die Funktion läuft mit den Rechten ihres Aufrufers, verschafft niemandem Rechte, die er nicht
-- schon hat, und prüft AUSDRÜCKLICH KEINE Rolle. Der Aufrufer ist `service_role` und trägt kein
-- JWT — `auth.uid()` ist leer, es gibt in der Datenbank nichts zu prüfen.
--
--   ⇒ Die Zugangsentscheidung fällt in `apps/web`, vor dem Anlegen des Clients
--     (`isCurrentUserAdmin()`, fail closed) — dieselbe eine Ausnahme, die DEPLOYMENT.md §3c
--     beschreibt. Es entsteht KEINE zweite Art von Ausnahme.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — public.confirm_retail_tariff
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ── ⚠ DER ZEITPUNKT IST KEIN PARAMETER, UND DAS IST DIE TRAGENDE ENTSCHEIDUNG ──────────────────
-- Die Funktion nimmt GENAU EINE Kennung entgegen und sonst nichts. `checked_at` kommt aus `now()`.
-- Ein Parameter dafür wäre dieselbe Einladung, die `create_retail_tariff` schon ausschlägt: ein
-- älteres Prüfdatum zu behaupten, das nie stattgefunden hat. Und ein Parameter für irgendeine
-- ANDERE Spalte machte aus der engen Funktion genau das `.update()`, das die Auflage verbietet.
--
-- ── „NICHT GEFUNDEN" IST EIN STATUS, KEIN FEHLER ───────────────────────────────────────────────
-- Anders als bei `delete_grid_tariff`, das `not_found` per `raise` meldet: Dort ist ein Nicht-Treffer
-- der Versuch, etwas Unumkehrbares an einer Zeile zu tun, die es nicht mehr gibt — ein Ereignis, das
-- die Oberfläche als Ausnahme behandeln soll. Hier ist er der Alltag zweier offener Browser-Fenster:
-- Ein Stand wurde inzwischen abgelöst, der Klick trifft ins Leere, und die Seite lädt neu. Dafür ist
-- ein Status die ehrlichere und billigere Antwort als eine Ausnahme, die durch PostgREST und die
-- Server Action getragen werden müsste.
--
-- ⚠ Die Funktion unterscheidet NICHT zwischen „gibt es nicht" und „gibt es, ist aber abgelöst" — sie
-- setzt `checked_at` auch an einer geschlossenen Zeile. Das ist Absicht: WELCHE Zeile bestätigt
-- werden darf, ist eine fachliche Frage der Oberfläche (dort wird der Knopf nur am offenen Stand
-- angeboten), und eine zweite, hier erfundene Regel könnte von ihr abweichen. Was die Funktion
-- zusichert, ist enger und dafür absolut: es ändert sich NICHTS ausser `checked_at`.
create or replace function public.confirm_retail_tariff(p_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_checked_at timestamptz;
begin
  -- EINE Spalte in der SET-Liste, und ihr Wert kommt aus der Uhr. Wer hier eine zweite ergänzt,
  -- hebt die Auflage aus `…120100` auf — und damit die Zusage „nie in-place überschrieben".
  update public.retail_tariffs
     set checked_at = now()
   where id = p_id
  returning checked_at into v_checked_at;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object('status', 'confirmed', 'checked_at', v_checked_at);
end;
$$;

comment on function public.confirm_retail_tariff(uuid) is
  'Bestätigt einen unveränderten Lieferanten-Tarifstand: setzt AUSSCHLIESSLICH checked_at auf '
  'now(). Kein anderes Feld ist über diesen Weg änderbar, und der Zeitpunkt ist kein Parameter. '
  'SECURITY INVOKER — prüft KEINE Rolle; die Zugangsentscheidung liegt im Admin-Bereich von '
  'apps/web. Ein Nicht-Treffer ist ein Status (not_found), kein Fehler.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — Die Rechte
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Auf der TABELLE ändert sich nichts (s. Kopf: gemessen, `insert, select, update` aus `…120100`
-- decken diesen Weg vollständig ab). Es bleibt der EXECUTE-Grant der Funktion selbst.
--
-- Funktionen im `public`-Schema bekommen EXECUTE per Default an PUBLIC und über Supabases
-- ALTER DEFAULT PRIVILEGES zusätzlich an `anon`/`authenticated`/`service_role` — dieselbe Falle wie
-- bei den Tabellen, seit T4-2 in einem Dutzend Migrationen dokumentiert. Ohne den `revoke` stünde
-- die Funktion jedem Browser-Client offen.
--
-- Wirksam wäre sie dort nicht (SECURITY INVOKER: `anon`/`authenticated` haben auf der Tabelle nur
-- `select`, das UPDATE endete mit 42501) — aber „läuft ins Leere" ist keine Zugangsregel, sondern
-- ein Zufall der aktuellen Grants.
revoke all on function public.confirm_retail_tariff(uuid) from public, anon, authenticated;

grant execute on function public.confirm_retail_tariff(uuid) to service_role;
