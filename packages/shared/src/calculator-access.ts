/**
 * Zugangstoken für die Rechner-App (`apps/website`) — ausgestellt von coolin.at (`apps/web`) NACH
 * der Admin-Prüfung, geprüft von der Middleware der Rechner-App bei JEDER Anfrage.
 *
 * Der Rechner läuft in einem Cross-Origin-iframe; die Sitzung von coolin.at kommt dort nicht an,
 * und ein Cookie der Rechner-App wäre im iframe ein Drittanbieter-Cookie (Safari verwirft es).
 * Das Token reist deshalb in der URL — Server Actions posten an die aktuelle URL samt Query und
 * tragen es damit mit.
 *
 * Format `<exp>.<sig>`: `exp` in Unix-Sekunden, `sig` = HMAC-SHA256(secret, exp) base64url.
 * Web Crypto statt `node:crypto`, weil die Prüfung in der Edge-Middleware läuft.
 */

/** Name des Query-Parameters, der das Token trägt. */
export const CALCULATOR_ACCESS_PARAM = 'zugang'

/** Gültigkeit eines Tokens — eine Arbeitssitzung, nicht länger. */
export const CALCULATOR_ACCESS_TTL_SECONDS = 12 * 60 * 60

/** Ein kürzeres Secret wird wie ein fehlendes behandelt (fail-closed). */
export const CALCULATOR_ACCESS_SECRET_MIN_LENGTH = 32

function usableSecret(secret: string | undefined): secret is string {
  return typeof secret === 'string' && secret.length >= CALCULATOR_ACCESS_SECRET_MIN_LENGTH
}

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = ''
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sign(secret: string, exp: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return toBase64Url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(exp)))
}

/** Liefert `null`, wenn kein brauchbares Secret konfiguriert ist — dann wird kein Token ausgestellt. */
export async function createCalculatorAccessToken(
  secret: string | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string | null> {
  if (!usableSecret(secret)) return null
  const exp = String(nowSeconds + CALCULATOR_ACCESS_TTL_SECONDS)
  return `${exp}.${await sign(secret, exp)}`
}

/** Fail-closed: ohne brauchbares Secret, bei falschem Format, Ablauf oder falscher Signatur `false`. */
export async function verifyCalculatorAccessToken(
  secret: string | undefined,
  token: string | null | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!usableSecret(secret) || typeof token !== 'string') return false
  const match = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(token)
  if (!match) return false
  const exp = match[1]!
  const sig = match[2]!
  if (Number(exp) <= nowSeconds) return false
  const expected = await sign(secret, exp)
  // Längengleich durch das Format; Vergleich ohne frühen Abbruch.
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i)
  return diff === 0
}
