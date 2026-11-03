import { describe, expect, it } from 'vitest'
import {
  CALCULATOR_ACCESS_TTL_SECONDS,
  createCalculatorAccessToken,
  verifyCalculatorAccessToken,
} from './calculator-access'

const SECRET = 'x'.repeat(40)
const NOW = 1_800_000_000

describe('Zugangstoken der Rechner-App', () => {
  it('ein frisch ausgestelltes Token gilt bis zum Ablauf, danach nicht mehr', async () => {
    const token = await createCalculatorAccessToken(SECRET, NOW)
    expect(await verifyCalculatorAccessToken(SECRET, token, NOW + 60)).toBe(true)
    expect(
      await verifyCalculatorAccessToken(SECRET, token, NOW + CALCULATOR_ACCESS_TTL_SECONDS),
    ).toBe(false)
  })

  it('weist fremde Signatur, verlängertes Ablaufdatum und fehlendes Token ab', async () => {
    const token = (await createCalculatorAccessToken(SECRET, NOW))!
    expect(await verifyCalculatorAccessToken('y'.repeat(40), token, NOW)).toBe(false)
    const [exp, sig] = token.split('.')
    expect(await verifyCalculatorAccessToken(SECRET, `${Number(exp) + 1}.${sig}`, NOW)).toBe(false)
    expect(await verifyCalculatorAccessToken(SECRET, null, NOW)).toBe(false)
  })

  it('fail-closed: ohne oder mit zu kurzem Secret wird weder ausgestellt noch akzeptiert', async () => {
    const token = await createCalculatorAccessToken(SECRET, NOW)
    expect(await createCalculatorAccessToken(undefined, NOW)).toBeNull()
    expect(await createCalculatorAccessToken('kurz', NOW)).toBeNull()
    expect(await verifyCalculatorAccessToken(undefined, token, NOW)).toBe(false)
    expect(await verifyCalculatorAccessToken('', token, NOW)).toBe(false)
  })
})
