/**
 * Vorschlagswerte für die MANUELLE Tarifeingabe aus dem gepflegten Netzbetreiber-Preisblatt
 * (`public.grid_tariffs`, B21-1/B21-2b).
 *
 * ── WARUM ES DIESES MODUL GIBT ──────────────────────────────────────────────────────────────────
 * Die Rechnung-Station des Wizards nimmt seit B24 Teil 1 PDFs entgegen und liest sie aus. Liegt gar
 * keine Rechnung vor, muss ein Admin die Tarifwerte von Hand eintragen — und genau dort ist der
 * Leistungspreis die Zahl, die niemand auswendig weiss. Sie steht aber gepflegt in der Datenbank:
 * je (Netzbetreiber, Netzebene, Messvariante) eine effektiv datierte Zeile.
 *
 * ⚠ DIE FUNKTION SCHLÄGT NUR VOR. Sie schreibt NICHTS in den Entwurf, und der vorgeschlagene Wert
 * bleibt im Formular ein gewöhnliches, editierbares Feld. Prinzip 1 bleibt unangetastet: die
 * Rechnung des Kunden schlägt diese Tabelle. Wer den Vorschlag still in den Entwurf schriebe,
 * machte aus einer Vorbelegung eine Messung — und niemand könnte die beiden danach unterscheiden.
 *
 * ── DIE KERNREGEL, UND WARUM SIE DIE TEUERSTE STELLE DES MODULS IST ─────────────────────────────
 * `grundpreis_unit = 'eur_per_kw_year'`  → der Grundpreis IST der Leistungspreis.
 * `grundpreis_unit = 'eur_per_year'`     → eine JAHRESPAUSCHALE ⇒ Leistungspreis 0 (Delta 3).
 * Eine als Leistungspreis übernommene Jahrespauschale (real: NE 7 ohne Leistungsmessung, 54,00)
 * ginge mit dem abgerechneten kW-Wert MULTIPLIZIERT in die Spitzenkappungs-Ersparnis ein und
 * ergäbe eine völlig plausibel aussehende, frei erfundene Zahl. Eine UNBEKANNTE Einheit wird
 * deshalb wie eine Pauschale behandelt und NICHT geraten.
 *
 * `minBillableKw` ist immer 0 — der einzige Wert, der nichts behauptet: der Sockel kann den
 * abgerechneten Leistungswert nur ANHEBEN (§3.5), eine erfundene positive Zahl erfände Kosten UND
 * Ersparnis. Dieselbe Regel und dieselbe Begründung wie `gridTariffPrefill` (packages/shared);
 * jene Funktion ist hier bewusst NICHT wiederverwendet — sie verlangt zusätzlich ein
 * Abrechnungsmodell und führt eine Herkunftsbuchhaltung für den Report, beides gibt es hier nicht.
 *
 * ── WAS BEWUSST NICHT GELESEN WIRD ─────────────────────────────────────────────────────────────
 * KEINE eingebetteten Zeitfenster (`grid_tariff_rate_windows`). Die tragen den ARBEITSPREIS je
 * Fenster und gehören in die Delta-4-Preiskurve des Rechenkerns, nicht in ein Formularfeld; hier
 * wären sie Fracht ohne Konsumenten.
 */
import 'server-only'

import { findGridTariffRow } from 'shared'

import type { createClient } from '@/lib/supabase/server'

/** Der angemeldete Admin-Client — es gibt bewusst keinen service_role-Weg (B21-1: `authenticated` darf lesen). */
type AdminClient = Awaited<ReturnType<typeof createClient>>

export type GridTariffDefaults = {
  /** €/kW·Jahr. 0, wenn das Preisblatt eine Jahrespauschale führt (Delta 3). */
  leistungspreisEurPerKwYear: number
  /** Immer 0 — s. Kopfkommentar. */
  minBillableKw: number
}

export type GridTariffLookupParams = {
  operatorId: string
  netzebene: number
  /** `null` bei Netzebenen ohne Varianten (NE 3–6) — s. `unique nulls not distinct`, B21-1. */
  meteringVariant: string | null
  /** Kalendertag als 'YYYY-MM-DD' in ORTSZEIT (Europe/Vienna), nicht UTC. */
  stichtag: string
}

/*
 * ⚠ EIN Zeichenketten-LITERAL, nicht zusammengesetzt. supabase-js leitet die Ergebnistypen aus dem
 * TEXT dieser Auswahl ab; `'a' + 'b'` ergibt in TypeScript den Typ `string`, und die Ableitung
 * fällt dann auf `GenericStringError` zurück — die Abfrage liefe, aber jedes Feld wäre untypisiert
 * (in `apps/website/lib/tariff-data/grid-tariffs.ts` beim Bauen real passiert, 13 Typfehler).
 */
const GRID_TARIFF_SELECT = 'grundpreis_amount, grundpreis_unit, valid_from, valid_until'

/**
 * Liefert die Vorschlagswerte für genau eine Kombination zum Stichtag — `null`, wenn das
 * Preisblatt dafür keine gültige Zeile führt (kein Fehler: „für diese Kombination ist nichts
 * hinterlegt" ist eine zulässige Antwort, B21-1).
 *
 * Wirft bei einem Datenbankfehler. „Wir konnten nicht nachsehen" ist eine ANDERE Aussage als „es
 * gibt nichts" — als `null` zurückgegeben behauptete ein Ausfall eine Fehlanzeige im Preisblatt.
 */
export async function lookupGridTariffDefaults(
  supabase: AdminClient,
  { operatorId, netzebene, meteringVariant, stichtag }: GridTariffLookupParams,
): Promise<GridTariffDefaults | null> {
  let query = supabase
    .from('grid_tariffs')
    .select(GRID_TARIFF_SELECT)
    .eq('operator_id', operatorId)
    .eq('netzebene', netzebene)

  /*
   * ⚠ `.is(..., null)` statt `.eq(..., null)`: SQL vergleicht NULL nie per `=`. Ein `.eq` lieferte
   * hier für JEDE Netzebene 3–6 null Treffer — der Vorschlag bliebe dauerhaft leer, obwohl die
   * Zeile gepflegt ist, und es sähe nach fehlenden Daten aus statt nach einem Abfragefehler.
   * Umgekehrt darf die Variante NICHT weggelassen werden: sonst kämen bei NE 7 alle drei Zeilen
   * zurück, und welcher Leistungspreis vorgeschlagen wird, entschiede die Sortierreihenfolge.
   */
  query = meteringVariant === null
    ? query.is('metering_variant', null)
    : query.eq('metering_variant', meteringVariant)

  const { data, error } = await query

  if (error) {
    throw new Error(`grid_tariffs konnte nicht gelesen werden: ${error.message}`)
  }

  /*
   * Die Datierungsregel kommt aus `shared` und ist damit dieselbe, die auch der Rechenkern
   * anwendet (`valid_until` INKLUSIV; bei mehreren Treffern gewinnt die später beginnende Zeile).
   * Ein zweiter, hier ausgeschriebener Vergleich liefe beim nächsten Preisblatt-Ausbau von ihr
   * weg — und der Wizard schlüge dann einen Satz aus einer Zeile vor, mit der die Engine nie
   * rechnet. Das fiele an keiner Fehlermeldung auf.
   */
  const row = findGridTariffRow(
    (data ?? []).map((entry) => ({
      validFrom: entry.valid_from,
      validUntil: entry.valid_until,
      grundpreisAmount: entry.grundpreis_amount,
      grundpreisUnit: entry.grundpreis_unit,
    })),
    stichtag,
  )

  if (row === null) return null

  const grundpreisIsLeistungspreis = row.grundpreisUnit === 'eur_per_kw_year'

  return {
    leistungspreisEurPerKwYear: grundpreisIsLeistungspreis ? (row.grundpreisAmount ?? 0) : 0,
    minBillableKw: 0,
  }
}
