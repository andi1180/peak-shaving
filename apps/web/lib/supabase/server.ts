/**
 * Supabase-SERVER-Client (T4-2) für Server Components, Server Actions und Route Handler.
 *
 * `import 'server-only'` + non-prefixte Env (via lib/env.server): KEIN Supabase-Code im
 * Client-Bundle (Invariante J1). Es gibt bewusst KEINEN Browser-Client (kein createBrowserClient) —
 * sämtliche Auth-Vorgänge laufen server-seitig.
 *
 * EIN Client für Lese- (Server Component) UND Schreibkontext (Server Action / Route Handler):
 * Der Unterschied „darf Cookies schreiben?" steckt komplett im setAll-Adapter. In einer Server
 * Component wirft `cookieStore.set` (Next 15 verbietet Cookie-Schreiben beim Rendern) — genau hier
 * abgefangen und verworfen, weil der Token-Refresh ohnehin in der Middleware passiert (die schreiben
 * darf) und die RSC nur LIEST. In Server Actions/Route Handlern wirft `set` nicht → setAll schreibt
 * echt. Damit deckt dieselbe Factory beide vom Prompt genannten Kontexte ab; ein separater
 * „Reader"- und „Writer"-Client wäre bit-gleich bis auf dieses try/catch (s. Report (a)).
 */
import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/db-types'
import { requireSupabaseUrl, requireSupabaseAnonKey } from '@/lib/env.server'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(requireSupabaseUrl(), requireSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Server Component: Cookie-Schreiben ist verboten und wirft. Erwartet & geschluckt —
          // der Refresh läuft in der Middleware, diese RSC liest nur. In Actions/Route Handlern
          // wird dieser Zweig nie erreicht (dort schreibt setAll erfolgreich).
        }
      },
    },
  })
}
