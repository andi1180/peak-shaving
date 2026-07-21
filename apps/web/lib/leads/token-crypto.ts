/**
 * Die beiden Token-Mechanismen des Lead-Pfads (B1-2) — REIN, ohne Env und ohne `server-only`.
 *
 * WARUM REIN UND OHNE ENV: Kryptografie, die man nicht ausführen kann, ohne ein Geheimnis zu
 * konfigurieren, wird nicht getestet. Dieses Modul nimmt das Geheimnis als PARAMETER; die
 * env-gebundene Fassung liegt daneben in `tokens.ts` (`import 'server-only'`). Dadurch laufen die
 * Tests (`token-crypto.test.ts`) ohne Stub und ohne gesetzte Variable — und trotzdem gegen exakt den
 * Code, der in Produktion signiert und prüft.
 *
 * `node:crypto` statt WebCrypto: der Vergleich muss `timingSafeEqual` sein (s. u.), und der ist
 * synchron nur in node:crypto verfügbar. Ein Import aus einer Client-Komponente würde am Bundler
 * scheitern — laut, nicht still.
 *
 * ── ZWEI MECHANISMEN, BEWUSST NICHT DERSELBE ─────────────────────────────────────────────────────
 *
 * 1. BESTÄTIGUNGSTOKEN (Double-Opt-in): 32 Zufallsbytes, base64url ohne Padding. In der Datenbank
 *    liegt NUR der SHA-256-Hex-Wert (B1-1: `consents.token_hash`), der Klartext existiert
 *    ausschliesslich in der Mail. Wer den Token hat, kann bestätigen — er ist damit faktisch eine
 *    Zugangsberechtigung, und ein Datenbank-Leck darf keine bestätigbaren Tokens enthalten.
 *    Gültigkeit 7 Tage, LAZY geprüft (kein Hintergrundjob; vor B4 gibt es im System keine
 *    Zeitsteuerung — s. `public.confirm_consent`).
 *
 * 2. ABMELDETOKEN: HMAC-SHA256 über `${leadId}:${purpose}`. ZUSTANDSLOS und dauerhaft gültig — ein
 *    Abmeldelink muss auch in einer zwei Jahre alten Mail noch funktionieren, und eine Tabelle mit
 *    Abmelde-Tokens wäre genau der Zustand, der bei einer Lead-Löschung verschwindet. Deshalb kein
 *    Zufallstoken, deshalb keine Ablaufzeit.
 *
 *    ⚠ GENAU DESHALB DARF `LEAD_TOKEN_SECRET` NICHT ROUTINEMÄSSIG ROTIERT WERDEN: eine Rotation
 *    entwertet JEDEN bereits versendeten Abmeldelink auf einen Schlag. Steht als Warnung auch in
 *    DEPLOYMENT.md und `.env.example` — hier, weil der Code der Ort ist, an dem man es nachliest.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** Gültigkeitsdauer des Bestätigungstokens in Tagen (Double-Opt-in). */
export const CONFIRMATION_TOKEN_TTL_DAYS = 7

/** 32 Byte — dieselbe Grössenordnung wie ein Session-Token; nicht ratbar, nicht abzählbar. */
const CONFIRMATION_TOKEN_BYTES = 32

export type ConfirmationToken = {
  /** Klartext für die Mail. Wird NIE gespeichert und NIE geloggt. */
  token: string
  /** SHA-256 (hex) — der Wert, der in `platform.consents.token_hash` landet. */
  tokenHash: string
  /** Ablaufzeitpunkt für `platform.consents.token_expires_at` (ISO-String). */
  expiresAt: Date
}

/** Erzeugt ein frisches Bestätigungstoken samt Hash und Ablauf. */
export function createConfirmationToken(now: Date = new Date()): ConfirmationToken {
  const token = randomBytes(CONFIRMATION_TOKEN_BYTES).toString('base64url')
  return {
    token,
    tokenHash: hashConfirmationToken(token),
    expiresAt: new Date(now.getTime() + CONFIRMATION_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
  }
}

/**
 * SHA-256 (hex) eines Bestätigungstokens — die EINE Abbildung Klartext → gespeicherter Wert.
 * Ungesalzen und bewusst so: der Server bekommt den Klartext aus der URL und muss die Zeile damit
 * FINDEN können. Ein Salt machte das unmöglich; der Token selbst hat 256 Bit Entropie, ein
 * Wörterbuchangriff auf den Hash existiert also nicht.
 */
export function hashConfirmationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * Die signierte Nutzlast des Abmeldelinks. Nur diese beiden Werte gehen ein — die Signatur bindet
 * den Link an GENAU einen Lead und GENAU einen Zweck. Ein Angreifer, der `p` umschreibt, kann
 * niemanden von einem anderen Zweck abmelden, weil die Signatur dann nicht mehr passt.
 *
 * Der Doppelpunkt ist unkritisch als Trenner: eine UUID enthält keinen, ein `consent_purpose` (Enum)
 * ebenfalls nicht — die Zerlegung ist also eindeutig, es gibt keine zwei Paare mit derselben
 * Zeichenkette.
 */
function unsubscribePayload(leadId: string, purpose: string): string {
  return `${leadId}:${purpose}`
}

/** HMAC-SHA256 über `${leadId}:${purpose}`, base64url ohne Padding (URL-tauglich ohne Escaping). */
export function signUnsubscribe(secret: string, leadId: string, purpose: string): string {
  return createHmac('sha256', secret)
    .update(unsubscribePayload(leadId, purpose))
    .digest('base64url')
}

/**
 * Prüft eine Abmelde-Signatur.
 *
 * `timingSafeEqual` statt `===`: ein zeichenweiser Vergleich bricht beim ersten Unterschied ab und
 * verrät über die Antwortzeit, WIE VIELE führende Zeichen stimmten — damit liesse sich eine gültige
 * Signatur Zeichen für Zeichen erraten, ohne das Geheimnis zu kennen. Die Längenprüfung davor ist
 * nötig, weil `timingSafeEqual` bei ungleicher Pufferlänge WIRFT (und die Länge ohnehin kein
 * Geheimnis ist).
 */
export function verifyUnsubscribe(
  secret: string,
  leadId: string,
  purpose: string,
  signature: string | null | undefined,
): boolean {
  if (!signature) return false

  const expected = Buffer.from(signUnsubscribe(secret, leadId, purpose), 'utf8')
  const actual = Buffer.from(signature, 'utf8')
  if (expected.length !== actual.length) return false

  return timingSafeEqual(expected, actual)
}
