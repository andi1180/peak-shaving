-- Messpreis (Messentgelt) als Pflegegrösse der Netzbetreiber-Tarifzeile.
--
-- Kanonische fachliche Quelle: `Pflichtenheft_Kalkulator_Delta_Tarifoptimierung.md`, Delta 5.
-- Anlass: Der Tarifvergleich liess bis hierher fünf Kostenkomponenten aus. Vier davon sind
-- Verordnungssätze und liegen als versionierte Code-Konstanten in `packages/shared/src/levies.ts`;
-- die fünfte — der Messpreis — ist eine Netzbetreiber-Grösse je (Betreiber, Netzebene,
-- Messvariante) und gehört deshalb in dieselbe Zeile wie der Grundpreis.
--
-- ── WAS HIER ENTSTEHT ───────────────────────────────────────────────────────────────────────────
--   TEIL 1  public.grid_tariffs.messpreis_amount / .messpreis_unit
--   TEIL 2  public.create_grid_tariff(...)    — zwei angehängte Parameter
--   TEIL 3  public.backfill_grid_tariff(...)  — dieselben zwei
--
-- Keine neue Tabelle, kein Trigger, keine Policy, KEIN neuer Tabellen-Grant, keine Zeile Inhalt.
-- `public.delete_grid_tariff`, `public.add_grid_tariff_rate_window`, das Löschprotokoll,
-- `public.spot_prices` und `platform` sind mit NULL Zeilen Diff unangetastet.
--
-- ── ⚠ NULLABLE, OHNE DEFAULT, UND KEIN BACKFILL DER BESTANDSZEILEN ─────────────────────────────
-- Jede vor dieser Migration angelegte Zeile bleibt `null`, und das ist bereits die richtige
-- Aussage: für sie wurde kein Messpreis erfasst. Ein Default (etwa der heutige Wiener-Netze-Satz)
-- machte aus „nicht erfasst" ein „erfasst" und schriebe denselben Betrag in die Zeilen JEDES
-- Netzbetreibers und JEDER Netzebene — dieselbe Überlegung wie bei `backfilled_at` (B21-2e).
-- Der Rechenkern behandelt `null` ausdrücklich als „kein Messpreis eingerechnet", nicht als 0
-- (`GridTariffRowInput.messpreisAmount`).
--
-- ── ⚠ DROP + CREATE STATT `create or replace` — und warum das hier zwingend ist ────────────────
-- Zwei ANGEHÄNGTE Parameter mit Vorgabewert ergeben eine andere Argumentliste. PostgreSQL legt
-- dann eine ÜBERLADUNG an statt zu ersetzen: die alte Zehn-/Elf-Parameter-Fassung bliebe stehen,
-- und ein Aufruf mit den bisherigen benannten Argumenten wäre gegenüber beiden Fassungen gültig —
-- 42725 (ambiguous). Die alte Fassung muss deshalb weg, und die Grants sind danach erneut zu
-- setzen (ein `drop` nimmt sie mit).
--
-- ── ⚠ ZWEI EINHEITEN, WIE BEIM GRUNDPREIS ──────────────────────────────────────────────────────
-- Die Wiener-Netze-Preisblätter weisen das Messentgelt je MONAT aus, andere Betreiber könnten es
-- je Jahr ausweisen. Eine Spalte ohne Einheit liesse die Zahl ihre Bedeutung verlieren; der
-- Unterschied ist der Faktor zwölf. Die beiden Werte stehen als CHECK in der Datenbank, nicht nur
-- im Anwendungscode.
--
-- ── DIE UMRECHNUNG STEHT NICHT HIER ────────────────────────────────────────────────────────────
-- Anteilig auf die tatsächlich belegten Kalendertage verteilt wird im Rechenkern
-- (`packages/engine/src/simulation/monthly-tariff-comparison.ts`), wie schon beim Netz-Grundpreis
-- und den Lieferantengebühren. Die Datenbank hält den Satz, nicht seine Anwendung.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — die beiden Spalten
-- ════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.grid_tariffs add column messpreis_amount numeric;
alter table public.grid_tariffs add column messpreis_unit   text;

-- ⚠ Der CHECK lässt `null` in BEIDEN Spalten zu (eine Zeile ohne Messpreis), und er erzwingt das
-- PAAR: ein Betrag ohne Einheit wäre eine Zahl ohne Bedeutung, eine Einheit ohne Betrag eine
-- Angabe ohne Inhalt. Beides ist über die Wrapper unten erreichbar (nur einer der zwei Parameter
-- gesetzt) und wird deshalb auf Speicherebene abgewiesen, nicht im Formular.
alter table public.grid_tariffs
  add constraint grid_tariffs_messpreis_check
  check (
    (messpreis_amount is null and messpreis_unit is null)
    or (
      messpreis_amount is not null
      and messpreis_unit in ('eur_per_month', 'eur_per_year')
    )
  );

comment on column public.grid_tariffs.messpreis_amount is
  'Messentgelt des Netzbetreibers für diese Kombination, netto. null = nicht erfasst — der '
  'Rechenkern rechnet dann KEINEN Messpreis ein, nicht einen geschätzten.';

comment on column public.grid_tariffs.messpreis_unit is
  'eur_per_month | eur_per_year. Bestimmt die Bedeutung von messpreis_amount; die Bezugsgrösse '
  'der Anteiligkeit (Monatslänge bzw. Jahreslänge) folgt daraus.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — public.create_grid_tariff
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Wortgleich die Fassung aus B21-2b, um zwei angehängte Parameter und zwei Spalten im INSERT
-- erweitert. Beide tragen `default null`: ein bestehender Aufruf mit den bisherigen ELF benannten
-- Argumenten bleibt damit gültig und legt eine Zeile ohne Messpreis an.
drop function if exists public.create_grid_tariff(
  text, text, smallint, numeric, text, numeric, text, date, text, jsonb, text
);

create function public.create_grid_tariff(
  p_operator_id            text,
  p_operator_name          text,
  p_netzebene              smallint,
  p_grundpreis_amount      numeric,
  p_grundpreis_unit        text,
  p_netzverlust_ct_per_kwh numeric,
  p_price_basis            text,
  p_valid_from             date,
  p_created_by             text,
  p_windows                jsonb,
  p_metering_variant       text default null,
  p_messpreis_amount       numeric default null,
  p_messpreis_unit         text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_latest_open  date;
  v_closed_until date := p_valid_from - 1;
  v_closed_ids   uuid[];
  v_new_id       uuid;
  v_windows      int;
begin
  -- Ohne mindestens ein Zeitfenster ist die Tarifzeile unvollständig (Delta 5: die zeitabhängige
  -- Arbeitspreis-Seite des Netzentgelts). Die Prüfung steht VOR jedem Schreibvorgang — es soll
  -- nicht erst eine Vorgängerin geschlossen werden, um dann am letzten Schritt zu scheitern.
  if p_windows is null
     or jsonb_typeof(p_windows) <> 'array'
     or jsonb_array_length(p_windows) = 0 then
    return jsonb_build_object('status', 'no_windows');
  end if;

  -- Serialisiert genau diese Kombination für die Dauer der Transaktion (s. Kopf).
  -- `coalesce` auf den Leerstring, weil `metering_variant` bei NE 3–6 null ist und ein null-Anteil
  -- den ganzen Schlüssel null machte — dieselbe Falle, die das `nulls not distinct` motiviert.
  perform pg_advisory_xact_lock(
    hashtext('grid_tariff:' || p_operator_id || ':' || p_netzebene::text ||
             ':' || coalesce(p_metering_variant, ''))
  );

  -- Die Sperre steht IM Unterausdruck, nicht am Aggregat: `for update` ist neben einer
  -- Aggregatfunktion nicht zulaessig (0A000, beim Messen der Rechteflaeche aufgeschlagen). Der
  -- Advisory-Lock oben serialisiert diese Kombination bereits; das Zeilen-`for update` haelt
  -- zusaetzlich einen Schreiber auf, der an dieser Funktion vorbei ginge.
  select array_agg(id), max(valid_from)
    into v_closed_ids, v_latest_open
    from (
      select id, valid_from
        from public.grid_tariffs
       where operator_id = p_operator_id
         and netzebene = p_netzebene
         and metering_variant is not distinct from p_metering_variant
         and valid_until is null
         for update
    ) offen;

  if v_latest_open is not null and p_valid_from <= v_latest_open then
    -- Bewusst OHNE Schreibvorgang zurück: eine abgelehnte Anlage darf die bestehende Lage nicht
    -- verändert haben.
    return jsonb_build_object(
      'status', 'invalid_valid_from',
      'open_valid_from', v_latest_open
    );
  end if;

  if v_closed_ids is not null then
    update public.grid_tariffs
       set valid_until = v_closed_until
     where id = any(v_closed_ids);
  end if;

  begin
    insert into public.grid_tariffs (
      operator_id, operator_name, netzebene, metering_variant,
      grundpreis_amount, grundpreis_unit, messpreis_amount, messpreis_unit,
      netzverlust_ct_per_kwh, price_basis,
      valid_from, created_by
    ) values (
      p_operator_id, p_operator_name, p_netzebene, p_metering_variant,
      p_grundpreis_amount, p_grundpreis_unit, p_messpreis_amount, p_messpreis_unit,
      p_netzverlust_ct_per_kwh, p_price_basis,
      p_valid_from, p_created_by
    )
    returning id into v_new_id;
  exception
    -- Ein bereits ARCHIVIERTER Stand mit genau diesem `valid_from` (die offene Zeile liegt davor,
    -- die Ordnungsprüfung oben greift deshalb nicht). Der Constraint ist die Wahrheit; hier bekommt
    -- er nur einen Namen, mit dem die Oberfläche etwas anfangen kann.
    when unique_violation then
      raise exception using errcode = 'P0001', message = 'duplicate_valid_from';
    -- Ein Wert ausserhalb der CHECKs aus B21-1 (Netzebene, Einheit, Preisbasis). Erreichbar nur an
    -- der Oberfläche vorbei — die Auswahlfelder lassen nichts anderes zu.
    when check_violation then
      raise exception using errcode = 'P0001', message = 'invalid_input';
  end;

  begin
    insert into public.grid_tariff_rate_windows (
      grid_tariff_id, label, month_day_from, month_day_to, time_from, time_to, ct_per_kwh
    )
    select v_new_id, w.label, w.month_day_from, w.month_day_to, w.time_from, w.time_to, w.ct_per_kwh
      from jsonb_to_recordset(p_windows) as w(
        label          text,
        month_day_from text,
        month_day_to   text,
        time_from      time,
        time_to        time,
        ct_per_kwh     numeric
      );
    get diagnostics v_windows = row_count;
  exception
    -- Eine unbrauchbare Uhrzeit/Zahl im Fenster-Block. Der ganze Aufruf fällt damit weg —
    -- einschliesslich der oben bereits geschlossenen Vorgängerin. Genau dafür ist die Klammer da.
    when data_exception or not_null_violation then
      raise exception using errcode = 'P0001', message = 'invalid_window';
  end;

  return jsonb_build_object(
    'status', 'created',
    'id', v_new_id,
    'window_count', v_windows,
    'closed_count', coalesce(array_length(v_closed_ids, 1), 0),
    'closed_valid_until', case when v_closed_ids is null then null else v_closed_until end
  );
end;
$$;
comment on function public.create_grid_tariff(
  text, text, smallint, numeric, text, numeric, text, date, text, jsonb, text, numeric, text
) is
  'B21-2b (21.09.2026 um den Messpreis erweitert): Legt einen Netzbetreiber-Tarifstand samt '
  'Zeitfenstern an und schliesst die bisher offene Zeile derselben Kombination in DERSELBEN '
  'Transaktion (valid_until = valid_from - 1). p_messpreis_amount/p_messpreis_unit sind optional; '
  'ohne sie entsteht eine Zeile ohne Messpreis. SECURITY INVOKER — prüft KEINE Rolle; die '
  'Zugangsentscheidung liegt im Admin-Bereich von apps/web (DEPLOYMENT.md §3c).';

-- Die Grants sind mit dem `drop` oben verschwunden und werden hier erneut gesetzt — samt dem
-- `revoke`, ohne den die Funktion über Supabases ALTER DEFAULT PRIVILEGES wieder jedem
-- Browser-Client offenstünde (B21-2b).
revoke all on function public.create_grid_tariff(
  text, text, smallint, numeric, text, numeric, text, date, text, jsonb, text, numeric, text
) from public, anon, authenticated;

grant execute on function public.create_grid_tariff(
  text, text, smallint, numeric, text, numeric, text, date, text, jsonb, text, numeric, text
) to service_role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — public.backfill_grid_tariff
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Spiegelbildlich zu TEIL 2. Die `min(valid_from)`-Regel über ALLE Zeilen (offene UND geschlossene)
-- bleibt unangetastet — sie ist der Grund, aus dem es diese Funktion gibt (B21-2e).
drop function if exists public.backfill_grid_tariff(
  text, smallint, numeric, text, numeric, text, date, text, jsonb, text
);

create function public.backfill_grid_tariff(
  p_operator_id            text,
  p_netzebene              smallint,
  p_grundpreis_amount      numeric,
  p_grundpreis_unit        text,
  p_netzverlust_ct_per_kwh numeric,
  p_price_basis            text,
  p_valid_from             date,
  p_created_by             text,
  p_windows                jsonb,
  p_metering_variant       text default null,
  p_messpreis_amount       numeric default null,
  p_messpreis_unit         text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_oldest_from  date;
  v_oldest_id    uuid;
  v_operator     text;
  v_new_until    date;
  v_new_id       uuid;
  v_windows      int;
begin
  -- Ohne mindestens ein Zeitfenster ist die Tarifzeile unvollständig (Delta 5). Die Prüfung steht
  -- VOR jedem Schreibvorgang und vor der Sperre — ein Aufruf, der ohnehin nichts anlegen kann, soll
  -- keine andere Kombination blockieren.
  if p_windows is null
     or jsonb_typeof(p_windows) <> 'array'
     or jsonb_array_length(p_windows) = 0 then
    return jsonb_build_object('status', 'no_windows');
  end if;

  -- DERSELBE Schlüssel wie in `create_grid_tariff` (s. Kopf). `coalesce` auf den Leerstring, weil
  -- `metering_variant` bei NE 3-6 null ist und ein null-Anteil den ganzen Schlüssel null machte.
  perform pg_advisory_xact_lock(
    hashtext('grid_tariff:' || p_operator_id || ':' || p_netzebene::text ||
             ':' || coalesce(p_metering_variant, ''))
  );

  -- ⚠ ÜBER ALLE ZEILEN DER KOMBINATION — ausdrücklich OHNE `valid_until is null`.
  -- Genau hier sitzt der Unterschied zu `create_grid_tariff`, und genau hier wäre der Fehler aus
  -- dem Kopf dieser Datei entstanden. `order by valid_from asc limit 1` liefert den ÄLTESTEN Stand;
  -- `for update` ist neben `order by`/`limit` zulässig (anders als neben einem Aggregat, das in
  -- B21-2b mit 0A000 aufschlug — deshalb hier bewusst kein `min()`).
  select id, valid_from, operator_name
    into v_oldest_id, v_oldest_from, v_operator
    from public.grid_tariffs
   where operator_id = p_operator_id
     and netzebene = p_netzebene
     and metering_variant is not distinct from p_metering_variant
   order by valid_from asc
   limit 1
     for update;

  -- ⚠ KEIN STILLES ANLEGEN EINER ERSTEN ZEILE.
  -- Gibt es die Kombination überhaupt nicht, ist das kein Backfill, sondern eine Erstanlage — und
  -- dafür ist `create_grid_tariff` da. Hier durchgelassen entstünde eine Zeile mit `valid_until`
  -- aus dem Nichts (es gäbe keinen Nachfolger, an dem sie enden könnte) oder eine offene Zeile in
  -- der Vergangenheit. Beides wäre falsch; die Oberfläche bietet den Weg deshalb ausschliesslich
  -- an einer bestehenden Kombination an, und diese Zeile ist die zweite Schranke.
  if not found then
    return jsonb_build_object('status', 'no_existing_stand');
  end if;

  -- Die Richtung ist die UMGEKEHRTE zu `create_grid_tariff`: dort muss der neue Stand NACH dem
  -- offenen beginnen, hier VOR dem ältesten. Gleichheit ist beides Mal ausgeschlossen — eine zweite
  -- Zeile mit demselben `valid_from` wiese ohnehin der `unique nulls not distinct`-Constraint ab
  -- (B21-1); hier bekommt der Fall vorher eine Begründung, statt hinterher ein 23505 zu werden.
  if p_valid_from >= v_oldest_from then
    return jsonb_build_object(
      'status', 'not_before_oldest',
      'min_valid_from', v_oldest_from
    );
  end if;

  -- Lückenlos UND überlappungsfrei folgt daraus von selbst, spiegelbildlich zu `create_grid_tariff`:
  -- die neue Zeile endet am Tag VOR dem Beginn der bisher ältesten. `- 1` ist der einzige Wert, der
  -- beides zugleich leistet — der gleiche Tag überlappte, ein früherer risse eine Lücke.
  --
  -- ⚠ Die bestehende älteste Zeile wird dabei NICHT angefasst (kein UPDATE): Sie ist bereits
  -- korrekt datiert, und ihr `valid_until` — ob gesetzt oder offen — bleibt genau das, was es war.
  v_new_until := v_oldest_from - 1;

  begin
    insert into public.grid_tariffs (
      operator_id, operator_name, netzebene, metering_variant,
      grundpreis_amount, grundpreis_unit, messpreis_amount, messpreis_unit,
      netzverlust_ct_per_kwh, price_basis,
      valid_from, valid_until, created_by, backfilled_at
    ) values (
      p_operator_id, v_operator, p_netzebene, p_metering_variant,
      p_grundpreis_amount, p_grundpreis_unit, p_messpreis_amount, p_messpreis_unit,
      p_netzverlust_ct_per_kwh, p_price_basis,
      p_valid_from, v_new_until, p_created_by, now()
    )
    returning id into v_new_id;
  exception
    -- Über diesen Weg unerreichbar: ein `p_valid_from` KLEINER als das Minimum kann mit keinem
    -- bestehenden `valid_from` derselben Kombination zusammenfallen. Der Zweig bleibt trotzdem
    -- stehen — dieselbe Tiefenstaffelung wie `duplicate_valid_from` in B21-2b: Er fängt einen
    -- Bestand ab, der aus einem Eingriff von Hand stammt (etwa zwei Zeilen mit demselben Beginn).
    when unique_violation then
      raise exception using errcode = 'P0001', message = 'duplicate_valid_from';
    -- Ein Wert ausserhalb der CHECKs aus B21-1 (Netzebene, Einheit, Preisbasis). Erreichbar nur an
    -- der Oberfläche vorbei — die Auswahlfelder lassen nichts anderes zu.
    when check_violation then
      raise exception using errcode = 'P0001', message = 'invalid_input';
  end;

  begin
    insert into public.grid_tariff_rate_windows (
      grid_tariff_id, label, month_day_from, month_day_to, time_from, time_to, ct_per_kwh, note
    )
    select v_new_id, w.label, w.month_day_from, w.month_day_to, w.time_from, w.time_to,
           w.ct_per_kwh, nullif(btrim(w.note), '')
      from jsonb_to_recordset(p_windows) as w(
        label          text,
        month_day_from text,
        month_day_to   text,
        time_from      time,
        time_to        time,
        ct_per_kwh     numeric,
        note           text
      );
    get diagnostics v_windows = row_count;
  exception
    -- Eine unbrauchbare Uhrzeit/Zahl im Fenster-Block. Der ganze Aufruf fällt damit weg — samt der
    -- oben bereits angelegten Zeile. Genau dafür ist die Klammer da.
    when data_exception or not_null_violation then
      raise exception using errcode = 'P0001', message = 'invalid_window';
  end;

  return jsonb_build_object(
    'status', 'backfilled',
    'id', v_new_id,
    'window_count', v_windows,
    'new_valid_until', v_new_until,
    -- Die Zeile, VOR der eingefügt wurde. Die Oberfläche nennt damit beide Enden der neuen
    -- Gültigkeit, ohne sie selbst ausrechnen zu müssen.
    'preceded_id', v_oldest_id,
    'preceded_valid_from', v_oldest_from
  );
end;
$$;
comment on function public.backfill_grid_tariff(
  text, smallint, numeric, text, numeric, text, date, text, jsonb, text, numeric, text
) is
  'B21-2e (21.09.2026 um den Messpreis erweitert): Trägt einen HISTORISCHEN Stand VOR dem ältesten '
  'vorhandenen nach und schliesst ihn auf dessen valid_from minus einen Tag. Der Bezugspunkt ist '
  'das Minimum über ALLE Zeilen — offene UND geschlossene. Statuswerte: backfilled | '
  'not_before_oldest (mit min_valid_from) | no_existing_stand | no_windows; P0001: '
  'duplicate_valid_from, invalid_input, invalid_window. SECURITY INVOKER, prüft KEINE Rolle.';

revoke all on function public.backfill_grid_tariff(
  text, smallint, numeric, text, numeric, text, date, text, jsonb, text, numeric, text
) from public, anon, authenticated;

grant execute on function public.backfill_grid_tariff(
  text, smallint, numeric, text, numeric, text, date, text, jsonb, text, numeric, text
) to service_role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — der EINE belegte Messpreis
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ── WARUM HIER DOCH EIN UPDATE STEHT, OBWOHL TARIFZEILEN NICHT ÜBERSCHRIEBEN WERDEN ────────────
-- Die Regel aus B21-1 („nie in-place überschreiben — ein neuer Stand ist eine neue Zeile") schützt
-- vor der stillen ÄNDERUNG eines Preises, unter dem schon gerechnet wurde. Hier ändert sich kein
-- Preis: Die Spalte hat es bis zu dieser Migration nicht gegeben, die betroffene Zeile beschreibt
-- bereits das Preisblatt WN-EX0105 in der Fassung 2026, und der Messpreis steht in genau diesem
-- Preisblatt. Nachgetragen wird ein Feld, das die Tabelle bisher nicht aufnehmen konnte — kein
-- Stand wird ersetzt.
--
-- Rückwirkend verschiebt das nichts: eine archivierte Analyse hält ihre Eingaben als WERTE fest
-- (B14-1 Regel b, kein Fremdschlüssel auf veränderliche Konfiguration). Was 2026 gerechnet wurde,
-- bleibt, was es war.
--
-- ── ⚠ GENAU EINE KOMBINATION, UND ZWAR DIE BELEGTE ─────────────────────────────────────────────
-- Netzebene 7, `ohne_leistungsmessung`, Stand ab 01.01.2026 — die Kombination, für die der Betrag
-- 2,18 €/Monat aus dem Preisblatt vorliegt. AUSDRÜCKLICH NICHT mitgeschrieben:
--   • `mit_leistungsmessung` und `unterbrechbar` — andere Zählerarten, anderes Messentgelt, für
--     das hier kein Betrag vorliegt;
--   • die Netzebenen 3–6 — dort misst ein Lastprofilzähler, ebenfalls ohne belegten Betrag;
--   • der abgelöste Stand ab 01.01.2025 — der Betrag stammt aus dem Preisblatt 2026.
-- Für all diese bleibt die Spalte `null`, und der Rechner rechnet dort weiterhin KEINEN Messpreis
-- ein. Ein übernommener Betrag sähe aus wie eine Angabe und wäre geraten.
--
-- Idempotent über die `is null`-Bedingung: ein zweiter Lauf trifft keine Zeile mehr.
update public.grid_tariffs
   set messpreis_amount = 2.18,
       messpreis_unit   = 'eur_per_month'
 where operator_id      = 'wiener_netze'
   and netzebene        = 7
   and metering_variant = 'ohne_leistungsmessung'
   and valid_from       = date '2026-01-01'
   and messpreis_amount is null;
