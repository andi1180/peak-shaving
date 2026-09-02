'use server'

import type { PvgisArrayDesign } from 'engine'

import { fetchPvReferenceProfile, type PvgisFetchResult } from './client'

/**
 * B22a — die Server Action des PVGIS-Proxys. Reine Verdrahtung.
 *
 * ── WARUM EINE SERVER ACTION UND KEIN ROUTE HANDLER ────────────────────────────────────────────
 * Dieselbe Abwägung wie in `lib/report-gate/actions.ts` und `lib/invoice-scan/actions.ts`: ein
 * Route Handler wäre ein zweiter ÖFFENTLICHER Endpunkt mit stabiler Adresse, an dem jeder
 * unabhängig von der Oberfläche Abrufe gegen einen fremden Dienst auslösen könnte. Hier gibt es
 * nichts, was ein solcher Endpunkt zusätzlich leisten müsste.
 *
 * ⚠ Auch eine Server Action ist über ihre ID aufrufbar. Prüfkette und Frequenzgrenze in
 * `client.ts` sind deshalb echte Sperren und keine Bedienhilfen.
 *
 * ── WAS HERAUSKOMMT UND WAS NICHT ──────────────────────────────────────────────────────────────
 * Zurück geht das REFERENZPROFIL — 8.760 Stundenwerte in kW, die gemittelten Wetterjahre, die
 * Jahreserträge (für die Streuungsangabe im Report) und die von PVGIS zurückgespiegelten Eingaben.
 * Der rohe Antwortrumpf reist NICHT mit: Strahlung, Sonnenhöhe, Temperatur und Wind braucht der
 * Rechner nicht, und was der Client nicht erfährt, kann er nicht weitergeben.
 *
 * Der Lastgang kommt hier gar nicht vor — die Kopplung geschieht im Browser (s. `client.ts`).
 */
export async function fetchPvReferenceProfileAction(
  design: PvgisArrayDesign,
): Promise<PvgisFetchResult> {
  return fetchPvReferenceProfile(design)
}
