/**
 * Env-gebundene Fassung der Token-Mechanismen (B1-2) + die Abmelde-URL samt RFC-8058-Kopfzeilen.
 *
 * `import 'server-only'`: das Geheimnis `LEAD_TOKEN_SECRET` darf strukturell nicht ins
 * Client-Bundle. Die reine Kryptografie liegt daneben in `token-crypto.ts` und nimmt das Geheimnis
 * als Parameter — nur deshalb ist sie ohne gesetzte Variable testbar.
 */
import 'server-only'
import { requireLeadTokenSecret } from '@/lib/env.server'
import { absoluteUrl } from '@/lib/site'
import {
  signUnsubscribe as signUnsubscribeWith,
  verifyUnsubscribe as verifyUnsubscribeWith,
} from './token-crypto'
import { ABMELDEN_API_PATH, ABMELDEN_HREF, UNSUBSCRIBE_PARAM, type ConsentPurpose } from './config'

export {
  CONFIRMATION_TOKEN_TTL_DAYS,
  createConfirmationToken,
  hashConfirmationToken,
} from './token-crypto'

/** Signiert `${leadId}:${purpose}` mit dem Server-Geheimnis. */
export function signUnsubscribeToken(leadId: string, purpose: ConsentPurpose): string {
  return signUnsubscribeWith(requireLeadTokenSecret(), leadId, purpose)
}

/** Prüft eine Abmelde-Signatur (zeitkonstanter Vergleich, s. `token-crypto.ts`). */
export function verifyUnsubscribeToken(
  leadId: string,
  purpose: ConsentPurpose,
  signature: string | null | undefined,
): boolean {
  return verifyUnsubscribeWith(requireLeadTokenSecret(), leadId, purpose, signature)
}

function unsubscribeQuery(leadId: string, purpose: ConsentPurpose): string {
  const params = new URLSearchParams({
    [UNSUBSCRIBE_PARAM.lead]: leadId,
    [UNSUBSCRIBE_PARAM.purpose]: purpose,
    [UNSUBSCRIBE_PARAM.signature]: signUnsubscribeToken(leadId, purpose),
  })
  return params.toString()
}

/**
 * Die Abmelde-Adressen zu (leadId, purpose).
 *
 * ── WARUM DIE BASIS `SITE_URL` IST UND NICHT DER REQUEST-ORIGIN ──────────────────────────────────
 * Anders als die Auth-Redirects (`lib/auth/server-helpers.ts`, `redirectBaseUrl`) entstehen diese
 * Links auch OHNE Request: B2 versendet aus einem Hintergrundlauf, der keinen Origin-Header hat.
 * Ein Link in einer E-Mail muss ausserdem kanonisch sein — er wird Monate später geklickt, wenn der
 * Host des erzeugenden Requests längst bedeutungslos ist. `absoluteUrl` liest die EINE konfigurierte
 * Basis (`lib/site.ts`), damit es keine zweite Domain-Quelle gibt.
 *
 * ZWEI ADRESSEN, EIN ZWECK:
 *  – `page`  → die Menschenseite mit zwei Möglichkeiten (nur dieser Zweck / gar keine Mails mehr).
 *  – `oneClick` → der POST-Endpunkt für RFC 8058. Er meldet OHNE Rückfrage vom übergebenen Zweck ab;
 *    ein GET darauf leitet auf die Menschenseite weiter, falls ihn doch jemand im Browser öffnet.
 */
export function unsubscribeUrls(
  leadId: string,
  purpose: ConsentPurpose,
): { page: string; oneClick: string } {
  const query = unsubscribeQuery(leadId, purpose)
  return {
    page: absoluteUrl(`${ABMELDEN_HREF}?${query}`),
    oneClick: absoluteUrl(`${ABMELDEN_API_PATH}?${query}`),
  }
}

/**
 * Die beiden Kopfzeilen für RFC 8058 (One-Click-Unsubscribe) — bei Gmail und Yahoo für
 * Massenversender PFLICHT.
 *
 * `List-Unsubscribe-Post: List-Unsubscribe=One-Click` ist die Zusage, dass die https-URL einen POST
 * OHNE weitere Bestätigungsseite verarbeitet. Genau das tut `app/api/abmelden/route.ts`; eine
 * Zwischenseite wäre ein Vertragsbruch gegenüber dem Mail-Client, der den Klick als erledigt meldet.
 *
 * Die `mailto:`-Alternative fährt bewusst mit: ältere Clients kennen One-Click nicht, und eine
 * Abmeldung, die an einem Client scheitert, ist eine Beschwerde in Wartestellung.
 *
 * HIER NUR BEREITGESTELLT — verbraucht wird die Funktion von B2 (Aussendung). Der Bestätigungsmail
 * des Double-Opt-in werden diese Kopfzeilen NICHT angehängt: sie ist keine Aussendung, sondern die
 * Frage, ob überhaupt eine erlaubt sein soll.
 */
export function unsubscribeHeaders(
  leadId: string,
  purpose: ConsentPurpose,
  mailtoAddress: string,
): Record<string, string> {
  const { oneClick } = unsubscribeUrls(leadId, purpose)
  return {
    'List-Unsubscribe': `<${oneClick}>, <mailto:${mailtoAddress}?subject=unsubscribe>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}
