/**
 * Supabase-Session-Refresh für die Middleware (T4-2, Invariante J2).
 *
 * DIE HEIKELSTE STELLE dieses Abschnitts: Next erlaubt genau EINE `middleware.ts`, also müssen
 * next-intl-Locale-Routing UND Supabase-Token-Refresh in EINER Middleware komponiert werden — und
 * die von Supabase gesetzten (refreshten) Cookies müssen die von next-intl ERZEUGTE Response
 * überleben. Deshalb bekommt `updateSession` die bereits von next-intl gebaute `response` herein
 * und schreibt die Auth-Cookies auf GENAU DIESE Response (nicht auf eine eigene, die dann verworfen
 * würde). Reihenfolge + Begründung stehen in `middleware.ts`.
 *
 * `import 'server-only'` NICHT gesetzt: Middleware läuft im Edge-Runtime-Kontext, in dem das
 * `server-only`-Sentinel (das auf React-Server-Conditions baut) nicht greift; der Schutz gegen
 * Client-Bundling läuft hier über den non-prefixten Env-Namen (lib/env.server → serverEnv).
 */
import { createServerClient } from '@supabase/ssr'
import type { NextRequest, NextResponse } from 'next/server'
import { requireSupabaseUrl, requireSupabaseAnonKey } from '@/lib/env.server'

export async function updateSession(
  request: NextRequest,
  response: NextResponse,
): Promise<NextResponse> {
  const supabase = createServerClient(requireSupabaseUrl(), requireSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        // Auf BEIDE schreiben: request.cookies, damit ein nachgelagerter Read im selben Durchlauf
        // die refreshten Tokens sieht; response.cookies, damit sie den Browser erreichen und die
        // next-intl-Response überleben (J2).
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  // KEIN Code zwischen createServerClient und getUser (Supabase-Vorgabe): getUser() validiert das
  // JWT gegen den Auth-Server und stößt bei Bedarf den Token-Refresh an — dessen neue Cookies
  // schreibt setAll oben auf die Response. Eine abgelaufene Session wird so still erneuert, statt
  // den Nutzer scheinbar zufällig auszuloggen.
  await supabase.auth.getUser()

  return response
}
