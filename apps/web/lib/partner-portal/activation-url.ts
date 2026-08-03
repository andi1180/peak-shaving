/**
 * DIE ADRESSE DES AKTIVIERUNGSLINKS (B18-2a).
 *
 * REIN: kein `server-only`, kein `next/*`, keine Datenbank, kein Supabase-Client. Das ist der Grund
 * für die eigene Datei — an dieser einen Zeichenkette hängt, ob ein Fachbetrieb überhaupt in sein
 * Portal kommt, und ein Fehler darin (falscher Host, falscher Pfad, falsch kodierter Token) fiele
 * erst auf, wenn die Mail bereits in seinem Postfach liegt. In `notify-server.ts` (server-only,
 * service_role) wäre sie nur mit Attrappen prüfbar; hier ist sie es ohne.
 */

import { portalAbsoluteUrl } from '@/lib/portal-host'
import { ACTIVATION_TOKEN_PARAM, PARTNER_AKTIVIEREN_HREF } from './config'

/**
 * Baut den vollständigen Aktivierungslink zu einem Token.
 *
 * `URL`/`searchParams` statt String-Verkettung: Der Token ist zwar Hex und bräuchte keine
 * Kodierung, aber diese Zusicherung soll nicht an der Zeichenmenge eines fremden Systems hängen —
 * ändert GoTrue sein Token-Format, bleibt die URL trotzdem gültig.
 *
 * Der Host kommt aus `portalAbsoluteUrl`: in Produktion `partner.coolin.at`, sonst die tatsächlich
 * ausgelieferte Basis. Das ist keine Kosmetik — die Aktivierung setzt Auth-Cookies, und die sind
 * HOST-gebunden (Begründung ausführlich in `lib/portal-host.ts`).
 */
export function activationUrlFor(tokenHash: string): string {
  const url = new URL(portalAbsoluteUrl(PARTNER_AKTIVIEREN_HREF))
  url.searchParams.set(ACTIVATION_TOKEN_PARAM, tokenHash)
  return url.toString()
}
