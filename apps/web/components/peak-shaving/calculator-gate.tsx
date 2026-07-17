'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input, Label } from '@/components/ui/input'
import { CALCULATOR_FRAME_STYLE } from '@/lib/config'
import { KALKULATOR_ACCESS_STORAGE_KEY, isValidAccessCode } from '@/lib/kalkulator-access'
import { KONTAKT_HREF } from '@/lib/nav'

/**
 * Das Soft-Gate vor dem Pro-Kalkulator (§5.2b) — als Popup (Prompt 26).
 *
 * Es sitzt EINE Ebene VOR dem iframe: `apps/website` (das iframe-Ziel) bleibt
 * unangetastet. Warum das Gate auf der Zielroute sitzt und nicht an den Links
 * dorthin (Nav-CTA, Hero, Cross-Links): Ein pro Link versteckter Kalkulator wäre
 * per Direkt-URL umgehbar und müsste an jeder neuen Verlinkung mitgedacht
 * werden. Hier gibt es einen Fundort.
 *
 * WAS ES NICHT IST — s. `lib/kalkulator-access.ts`: keine Sicherheit, kein Auth.
 * Diese Datei ändert an dieser Logik nichts — nur die Präsentation (Vollseite →
 * Modal).
 *
 * DER ERSTE RENDER ZEIGT WEDER MODAL NOCH RECHNER (`unlocked === null`):
 * localStorage gibt es auf dem Server nicht, und die Seite ist statisch
 * vorgerendert. Würde das Modal als Startzustand geöffnet gerendert, blitzte es
 * bei jedem freigeschalteten Nutzer für einen Frame auf, bevor der Effekt den
 * gespeicherten Zustand liest. Der dritte Zustand „weiß ich noch nicht" kostet
 * eine Zeile und vermeidet genau das.
 *
 * FLÄCHE HINTER DEM MODAL: bleibt eine leere, neutrale Fläche in EXAKT der
 * Höhe, die der iframe später einnimmt (`CALCULATOR_FRAME_STYLE`, geteilt mit
 * `rechner/page.tsx`) — kein Layout-Sprung beim Entsperren, kein Flackern.
 *
 * NICHT SCHLIESSBAR OHNE CODE: kein X-Button (dieses Primitiv hat keinen
 * eingebauten), Escape und Klick außerhalb werden abgefangen. Der einzige Weg,
 * die leere Fläche loszuwerden, ist ein gültiger Code.
 */
export function CalculatorGate({ children }: { children: React.ReactNode }) {
  const t = useTranslations('CalculatorFrame.gate')
  const [unlocked, setUnlocked] = React.useState<boolean | null>(null)
  const [code, setCode] = React.useState('')
  const [error, setError] = React.useState(false)

  React.useEffect(() => {
    /*
     * `try`: localStorage wirft in Safaris privatem Modus und bei blockierten
     * Drittanbieter-Daten. Ein Rechner, der wegen eines Speicher-Zugriffs gar
     * nicht mehr erscheint, wäre ein schlimmerer Fehler als ein Nutzer, der den
     * Code einmal pro Sitzung tippt.
     */
    try {
      setUnlocked(window.localStorage.getItem(KALKULATOR_ACCESS_STORAGE_KEY) === 'true')
    } catch {
      setUnlocked(false)
    }
  }, [])

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValidAccessCode(code)) {
      setError(true)
      return
    }
    try {
      window.localStorage.setItem(KALKULATOR_ACCESS_STORAGE_KEY, 'true')
    } catch {
      // Nicht persistierbar (privater Modus) — der Zugang gilt trotzdem für
      // diese Sitzung. Kein Grund, den Nutzer auszusperren.
    }
    setError(false)
    setUnlocked(true)
  }

  if (unlocked === null) return null

  return (
    <>
      <div className="w-full bg-surface-alt" style={CALCULATOR_FRAME_STYLE}>
        {unlocked ? children : null}
      </div>

      <Dialog open={!unlocked}>
        <DialogContent
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('lead')}</DialogDescription>

          <form onSubmit={onSubmit} noValidate className="mt-6">
            <Label htmlFor="kalkulator-code">{t('label')}</Label>
            <Input
              id="kalkulator-code"
              name="code"
              className="mt-2"
              value={code}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-invalid={error}
              aria-describedby={error ? 'kalkulator-code-error' : undefined}
              onChange={(e) => {
                setCode(e.target.value)
                // Die Meldung verschwindet beim Tippen: Sie gilt der letzten
                // Eingabe, nicht der, die gerade entsteht.
                if (error) setError(false)
              }}
            />

            {error && (
              <p id="kalkulator-code-error" role="alert" className="mt-2 text-small text-negative">
                {t('error')}
              </p>
            )}

            <Button type="submit" variant="primary" className="mt-5 w-full">
              {t('submit')}
            </Button>
          </form>

          <p className="mt-6 border-t border-line pt-4 text-small text-text-muted">
            {t('noCode')}{' '}
            <Link
              href={KONTAKT_HREF}
              className="text-accent underline underline-offset-4 hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {t('noCodeLink')}
            </Link>
          </p>
        </DialogContent>
      </Dialog>
    </>
  )
}
