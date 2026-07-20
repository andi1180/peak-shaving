import 'server-only'
import { cache } from 'react'
import { routing } from '@/i18n/routing'
import { createClient } from '@/lib/supabase/server'
import { redirectToLocalized } from '@/lib/auth/server-helpers'
import { ANMELDEN_HREF } from '@/lib/auth/config'

/**
 * Die EINE Zugangsprüfung des Admin-Bereichs (T4-4) — benutzt von `layout.tsx` UND `page.tsx`.
 *
 * ── WARUM AN ZWEI STELLEN GEPRÜFT WIRD (und warum das keine doppelte Regel ist) ──────────────────
 * Ein Layout, das seine `children` NICHT rendert, verhindert nicht, dass Next die Seite überhaupt
 * rendert: Next erzeugt die Segmente parallel (Streaming), und das Ergebnis der Seite landet dann
 * trotzdem im RSC-Flight-Payload der Antwort — als `<script>`-Inhalt im HTML. Beim Flow-Test
 * gemessen: die „Kein Zugriff"-Antwort trug den kompletten Aufbau des Admin-Bereichs
 * („Scraper-Ziele", „Gutscheincodes", …) im Quelltext, obwohl sichtbar nur „Kein Zugriff" stand.
 * NUTZERDATEN waren nie dabei — die Wrapper hatten korrekt `forbidden` geliefert —, aber die blosse
 * STRUKTUR ist schon der Hinweis, den dieser Bereich nicht geben soll.
 *
 * Deshalb prüfen beide:
 *   - `layout.tsx` entscheidet, WAS DER NUTZER SIEHT (neutrale Seite) und deckt jede künftige
 *     Unterroute automatisch ab — dort wäre eine vergessene Prüfung sonst still offen.
 *   - `page.tsx` entscheidet, OB INHALT ÜBERHAUPT ENTSTEHT — ohne diese Prüfung wird er erzeugt,
 *     serialisiert und mitgeschickt.
 * Es sind zwei verschiedene Aufgaben, aber EINE Regel: beide rufen diese Funktion, es gibt keinen
 * zweiten Ort, an dem „ist Admin" definiert wäre. `cache()` sorgt dafür, dass Session-Abfrage und
 * RPC pro Anfrage trotzdem nur EINMAL laufen.
 *
 * Ohne Session wird sofort auf die Anmeldung umgeleitet (Muster wie /konto, J6) — das ist kein
 * Rückgabewert, sondern ein Abbruch (`redirectToLocalized` ist als `never` typisiert).
 */
export const isCurrentUserAdmin = cache(async (): Promise<boolean> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirectToLocalized(ANMELDEN_HREF, routing.defaultLocale)

  const { data, error } = await supabase.rpc('is_admin')
  if (error) console.error('[admin] is_admin:', error)

  // Fail-closed: alles ausser einem ausdrücklichen `true` gilt als „kein Zugang" — auch ein Fehler
  // beim Lesen der Rolle. Eine unklare Antwort darf keinen Verwaltungsbereich öffnen.
  return data === true
})
