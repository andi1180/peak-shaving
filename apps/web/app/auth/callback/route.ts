import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ANMELDEN_HREF, sanitizeNext } from '@/lib/auth/config'

/**
 * Supabase-Redirect-Ziel (T4-2), bewusst AUSSERHALB des Locale-Segments (`app/auth/…`) und von der
 * Middleware ausgeschlossen — kein Locale-Rewrite, kein doppelter Session-Refresh. Tauscht den
 * `code` gegen eine Session (PKCE) und setzt die Auth-Cookies selbst (Route Handler darf schreiben),
 * dann Redirect ins App-Segment.
 *
 * Genutzt von BEIDEN Mail-Flows: E-Mail-Bestätigung (Registrierung, next=/konto) UND Passwort-Reset
 * (next=/passwort-neu). Der GoTrue-`/verify`-Schritt der Mail-Links leitet hierher mit `?code=…`.
 */
export async function GET(request: Request): Promise<Response> {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = sanitizeNext(searchParams.get('next'))

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
    console.error('[auth/callback] exchangeCodeForSession fehlgeschlagen:', error.message)
  }

  // Kein Code oder Austausch fehlgeschlagen (abgelaufener/bereits benutzter Link) → zurück zum
  // Login mit einem Fehler-Flag (die Anmelden-Seite erklärt es).
  return NextResponse.redirect(`${origin}${ANMELDEN_HREF}?error=callback`)
}
