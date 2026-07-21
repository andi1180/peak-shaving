import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  CONFIRMATION_TOKEN_TTL_DAYS,
  createConfirmationToken,
  hashConfirmationToken,
  signUnsubscribe,
  verifyUnsubscribe,
} from './token-crypto'

/**
 * Die Token-Mechanismen des Lead-Pfads (B1-2).
 *
 * Der Kern dieser Datei ist die Aussage der Aufgabenstellung: „Signaturprüfung der Abmelde-URL lehnt
 * manipulierte Signaturen ab." Manipuliert heisst hier nicht nur „falsche Signatur", sondern jede
 * Vertauschung der drei Bestandteile — genau die wären der praktische Angriff: mit EINEM gültigen
 * Link jemand anderen abmelden oder einen anderen Zweck treffen.
 *
 * Der zweite Beweis: was in der Datenbank landet, ist der HASH, nie der Token — sonst enthielte ein
 * Datenbank-Leck bestätigbare Berechtigungen (B1-1, `consents.token_hash`).
 */

const SECRET = 'test-secret-nicht-in-produktion'
const LEAD = '11111111-2222-3333-4444-555555555555'
const OTHER_LEAD = '99999999-8888-7777-6666-555555555555'

describe('Bestätigungstoken (Double-Opt-in)', () => {
  it('erzeugt 32 Zufallsbytes als base64url ohne Padding — und nie zweimal denselben', () => {
    const a = createConfirmationToken()
    const b = createConfirmationToken()

    expect(a.token).not.toBe(b.token)
    // 32 Byte base64url = 43 Zeichen, kein '=', kein '+', kein '/'.
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('speichert nur den SHA-256-Hex — der Klartext ist im Hash nicht enthalten', () => {
    const { token, tokenHash } = createConfirmationToken()

    expect(tokenHash).toBe(createHash('sha256').update(token, 'utf8').digest('hex'))
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(tokenHash).not.toContain(token)
  })

  it('hasht deterministisch — der Server findet die Zeile zum Klartext aus der URL wieder', () => {
    expect(hashConfirmationToken('abc')).toBe(hashConfirmationToken('abc'))
    expect(hashConfirmationToken('abc')).not.toBe(hashConfirmationToken('abd'))
  })

  it('läuft nach genau sieben Tagen ab', () => {
    const now = new Date('2026-07-21T10:00:00.000Z')
    const { expiresAt } = createConfirmationToken(now)

    expect(CONFIRMATION_TOKEN_TTL_DAYS).toBe(7)
    expect(expiresAt.toISOString()).toBe('2026-07-28T10:00:00.000Z')
  })
})

describe('Abmeldetoken (HMAC, zustandslos)', () => {
  it('akzeptiert die eigene Signatur', () => {
    const signature = signUnsubscribe(SECRET, LEAD, 'marketing_email')

    expect(verifyUnsubscribe(SECRET, LEAD, 'marketing_email', signature)).toBe(true)
  })

  it('ist dauerhaft reproduzierbar — derselbe Link funktioniert Jahre später noch', () => {
    expect(signUnsubscribe(SECRET, LEAD, 'marketing_email')).toBe(
      signUnsubscribe(SECRET, LEAD, 'marketing_email'),
    )
  })

  it('lehnt eine veränderte Signatur ab', () => {
    const signature = signUnsubscribe(SECRET, LEAD, 'marketing_email')
    const tampered = `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`

    expect(verifyUnsubscribe(SECRET, LEAD, 'marketing_email', tampered)).toBe(false)
  })

  it('lehnt eine ABGESCHNITTENE Signatur ab (ungleiche Länge darf nicht werfen)', () => {
    const signature = signUnsubscribe(SECRET, LEAD, 'marketing_email')

    expect(() =>
      verifyUnsubscribe(SECRET, LEAD, 'marketing_email', signature.slice(0, 10)),
    ).not.toThrow()
    expect(verifyUnsubscribe(SECRET, LEAD, 'marketing_email', signature.slice(0, 10))).toBe(false)
    expect(verifyUnsubscribe(SECRET, LEAD, 'marketing_email', `${signature}xx`)).toBe(false)
  })

  it('lehnt eine fehlende Signatur ab', () => {
    expect(verifyUnsubscribe(SECRET, LEAD, 'marketing_email', null)).toBe(false)
    expect(verifyUnsubscribe(SECRET, LEAD, 'marketing_email', undefined)).toBe(false)
    expect(verifyUnsubscribe(SECRET, LEAD, 'marketing_email', '')).toBe(false)
  })

  it('bindet die Signatur an GENAU EINEN Lead — ein fremder Link meldet niemanden sonst ab', () => {
    const signature = signUnsubscribe(SECRET, LEAD, 'marketing_email')

    expect(verifyUnsubscribe(SECRET, OTHER_LEAD, 'marketing_email', signature)).toBe(false)
  })

  it('bindet die Signatur an GENAU EINEN Zweck — `p` umschreiben wirkt nicht', () => {
    const signature = signUnsubscribe(SECRET, LEAD, 'marketing_email')

    expect(verifyUnsubscribe(SECRET, LEAD, 'contract_expiry_reminder', signature)).toBe(false)
  })

  it('hängt am Geheimnis — mit einem anderen LEAD_TOKEN_SECRET passt nichts mehr', () => {
    const signature = signUnsubscribe(SECRET, LEAD, 'marketing_email')

    expect(verifyUnsubscribe('anderes-geheimnis', LEAD, 'marketing_email', signature)).toBe(false)
  })

  it('ist URL-tauglich ohne Escaping (base64url, kein Padding)', () => {
    expect(signUnsubscribe(SECRET, LEAD, 'marketing_email')).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
