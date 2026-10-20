/*
 * Rückruf-Ticket des Schnellreports (3b-2): bindet die Telefonfrage an eine erfolgreiche
 * Absendung. Ohne Ticket liesse sich für jede fremde Adresse eine `offer_contact`-Einwilligung
 * erzeugen. Rein, das Geheimnis kommt als Parameter (wie `lib/leads/token-crypto.ts`).
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export const CALLBACK_TICKET_TTL_MS = 24 * 60 * 60 * 1000

function sign(secret: string, email: string, expiresAt: number): string {
  return createHmac('sha256', secret)
    .update(`schnellreport-callback:${email.trim().toLowerCase()}:${expiresAt}`)
    .digest('base64url')
}

export function createCallbackTicket(secret: string, email: string, now = Date.now()): string {
  const expiresAt = now + CALLBACK_TICKET_TTL_MS
  return `${expiresAt}.${sign(secret, email, expiresAt)}`
}

export function verifyCallbackTicket(
  secret: string,
  email: string,
  ticket: unknown,
  now = Date.now(),
): boolean {
  if (typeof ticket !== 'string') return false
  const [rawExpiry, signature] = ticket.split('.')
  const expiresAt = Number(rawExpiry)
  if (!signature || !Number.isSafeInteger(expiresAt) || expiresAt < now) return false

  const expected = Buffer.from(sign(secret, email, expiresAt), 'utf8')
  const actual = Buffer.from(signature, 'utf8')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
