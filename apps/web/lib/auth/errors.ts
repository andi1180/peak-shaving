/**
 * Supabase-Auth-Fehler → Message-KEY (T4-2). Fehlertexte werden NIE roh von Supabase an den
 * Nutzer durchgereicht: sie sind englisch, wechseln ohne Vorwarnung und verraten teils mehr, als
 * sie sollten (Enumeration). Hier auf eine kleine, kuratierte Menge deutscher Keys gemappt.
 */
import type { AuthError } from '@supabase/supabase-js'

export function mapAuthError(error: AuthError): string {
  switch (error.code) {
    case 'invalid_credentials':
      return 'invalidCredentials'
    case 'email_not_confirmed':
      return 'emailNotConfirmed'
    case 'weak_password':
      return 'weakPassword'
    case 'same_password':
      return 'samePassword'
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'rateLimited'
    default:
      // 429 ohne spezifischen Code → Rate-Limit; alles andere → neutraler Sammel-Text.
      if (error.status === 429) return 'rateLimited'
      return 'generic'
  }
}
