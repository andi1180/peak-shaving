import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { LoadProfile } from 'shared'
import { DemoDisclaimer } from '@/components/report/demo-disclaimer'
import { PrintCover } from '@/components/report/print-cover'

/*
 * Serverseitig gerendert statt im DOM (s. `vitest.config.ts`): gemessen wird nur, ob der Satz im
 * Markup steht. `Report` rendert dieselbe `DemoDisclaimer` und ist hier nicht eigens aufgebaut.
 */
const SENTENCE = 'Demo-Berechnung mit Beispieldaten'
const PROFILE = { readings: [], timezoneMeta: 'Europe/Vienna' } as unknown as LoadProfile

describe('Demo-Hinweis am Bildschirm und im Druck-Deckblatt', () => {
  it('echter Lauf (client): kein Demo-Satz', () => {
    expect(renderToStaticMarkup(createElement(DemoDisclaimer, { origin: 'client' }))).not.toContain(SENTENCE)
    expect(renderToStaticMarkup(createElement(PrintCover, { loadProfile: PROFILE, origin: 'client' }))).not.toContain(
      SENTENCE,
    )
  })

  it('Demo: Satz steht in beiden', () => {
    expect(renderToStaticMarkup(createElement(DemoDisclaimer, { origin: 'demo' }))).toContain(SENTENCE)
    expect(renderToStaticMarkup(createElement(PrintCover, { loadProfile: PROFILE, origin: 'demo' }))).toContain(SENTENCE)
  })
})
