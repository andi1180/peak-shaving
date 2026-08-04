import 'server-only'
import { readMyPartnerLeads, type PortalLeadsState } from '@/lib/partner-portal/leads'
import { createClient } from '@/lib/supabase/server'

/**
 * DER ZWEITE, EIGENE LESEAUFRUF DES PORTALBEREICHS (B18-6).
 *
 * ── WARUM ER NICHT IN `readPortal` STECKT ───────────────────────────────────────────────────────
 * `readPortal` (`read.ts`) beantwortet die Frage, die JEDE Seite des Bereichs stellt: Wer ist
 * angemeldet, und gibt es dazu eine aktive Partnerzeile. Er läuft auf allen drei Reitern und auf
 * `/partner-portal`. Die Leads braucht genau EINE Seite — sie dort einzuhängen hiesse, bei jedem
 * Aufruf von „Allgemein" und „Marketing" eine Abfrage zu fahren, deren Ergebnis niemand ansieht.
 *
 * ── DIE REIHENFOLGE IST BINDEND: ERST `readPortal`, DANN DIESER AUFRUF ──────────────────────────
 * Der Wrapper ist an `auth.uid()` gebunden und antwortet ohne Sitzung `{status: none}` — er wäre
 * also nicht unsicher, sondern nur nutzlos. Der Grund für die Reihenfolge ist ein anderer: Die
 * Seite muss zuerst wissen, ob sie überhaupt den Portal-Rahmen zeigt (angemeldet, aktive
 * Partnerzeile). Steht das nicht fest, gibt es nichts zu laden. Deshalb ruft die Seite hier erst
 * auf, NACHDEM `readPortal` einen Partner gemeldet hat.
 *
 * WIRFT NICHT. Ein Fehlschlag des Aufrufs wird geloggt und zu `{state: 'error'}` — die Seite zeigt
 * dann einen ehrlichen „gerade nicht abrufbar"-Zustand statt einer leeren Liste (die etwas anderes
 * behauptete) und statt einer Fehlerseite (die den ganzen Reiter verschlänge).
 *
 * ⚠ DAS DECKT AUCH DEN FALL AB, DASS DIE MIGRATION AUF DER ZIELDATENBANK NOCH NICHT LIEGT: PostgREST
 * antwortet dann mit einem Fehler zur unbekannten Funktion, und dieser Reiter sagt „gerade nicht
 * abrufbar" — er bricht nicht, und die beiden anderen Reiter merken davon nichts.
 */
export async function readPartnerLeads(): Promise<PortalLeadsState> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('get_my_partner_leads')
  if (error) console.error('[partner-portal] get_my_partner_leads:', error)

  return readMyPartnerLeads(data, error)
}
