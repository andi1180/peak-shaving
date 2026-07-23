import 'server-only'
import { cache } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ADMIN_PATHNAME_HEADER, adminLoginHref } from './config'

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
 * ── OHNE SITZUNG: UMLEITUNG AUF DEN ADMIN-EINGANG, MIT RÜCKSPRUNGZIEL ───────────────────────────
 * Ziel ist `/admin/anmelden` (B17), nicht die Kunden-Anmeldung. Wer ein Lesezeichen auf
 * `/admin/leads` hat, landete sonst nach dem Anmelden auf `/konto` — der Weg war zu Ende, bevor er
 * am Ziel war. Das Ziel reist über den bestehenden `NEXT_PARAM`-Mechanismus (B10-2) mit; den
 * angeforderten Pfad liefert die Middleware (`ADMIN_PATHNAME_HEADER`, s. `./config`).
 *
 * Bewusst der schlichte `redirect`, NICHT `redirectToLocalized`: `/admin` liegt ausserhalb der
 * Sprach-Struktur, und `getPathname` erzeugte bei einer zweiten Sprache `/en/admin/anmelden` — eine
 * Route, die es nicht gibt. Dieselbe Überlegung wie bei `adminSignOutAction` (B17).
 *
 * UNVERÄNDERT bleibt der andere Fall: Wer angemeldet ist, aber keine Admin-Rolle hat, wird NICHT
 * umgeleitet. Er bekommt `false` und damit die neutrale „Kein Zugriff"-Seite — sie sagt weiterhin
 * nichts über eine fehlende Rolle, und der Eingang bekommt ihn nie zu sehen (er wäre dort ohnehin
 * bereits angemeldet und würde nur nach `/admin` zurückgeschickt).
 */
export const isCurrentUserAdmin = cache(async (): Promise<boolean> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect(adminLoginHref((await headers()).get(ADMIN_PATHNAME_HEADER)))

  const { data, error } = await supabase.rpc('is_admin')
  if (error) console.error('[admin] is_admin:', error)

  // Fail-closed: alles ausser einem ausdrücklichen `true` gilt als „kein Zugang" — auch ein Fehler
  // beim Lesen der Rolle. Eine unklare Antwort darf keinen Verwaltungsbereich öffnen.
  return data === true
})
