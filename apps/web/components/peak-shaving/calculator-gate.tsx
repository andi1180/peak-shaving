'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input, Label } from '@/components/ui/input'
import { CALCULATOR_FRAME_STYLE } from '@/lib/config'
import { KALKULATOR_ACCESS_LEGACY_STORAGE_KEY, isValidAccessCode } from '@/lib/kalkulator-access'
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
 *
 * JEDER SEITENAUFRUF BEGINNT GESPERRT (Prompt 28). `unlocked` startet auf
 * `false` und lebt nur im React-State — es wird nichts gespeichert und nichts
 * gelesen. Ein Reload wirft den State weg, das Modal ist wieder da; wer auf der
 * Seite bleibt, bleibt entsperrt.
 *
 * Der dreiwertige State aus Prompt 25 (`null` = „localStorage noch nicht
 * gelesen") ist damit ersatzlos entfallen: Er existierte allein, damit das
 * Modal bei einem freigeschalteten Nutzer nicht für einen Frame aufblitzt,
 * bevor der Effekt den gespeicherten Zustand nachreicht. Ohne gespeicherten
 * Zustand gibt es nichts nachzureichen — „gesperrt" ist auf dem Server und im
 * Browser dieselbe Wahrheit, das Modal ist ab dem ersten Render richtig.
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
  const [unlocked, setUnlocked] = React.useState(false)
  const [code, setCode] = React.useState('')
  const [error, setError] = React.useState(false)

  React.useEffect(() => {
    /*
     * Altlast wegräumen: Wer den Code vor Prompt 28 eingegeben hat, trägt das
     * damals gespeicherte „entsperrt"-Flag noch im Browser. Es wird zwar nicht
     * mehr gelesen, aber liegenzulassen hieße, einen toten Zustand zu dulden,
     * den ein späteres Feature versehentlich wieder ernst nimmt.
     *
     * `try`: localStorage wirft in Safaris privatem Modus und bei blockierten
     * Drittanbieter-Daten. Ein Rechner, der wegen eines Aufräum-Zugriffs gar
     * nicht mehr erscheint, wäre der schlimmere Fehler — und ohne Speicher gibt
     * es ohnehin nichts aufzuräumen.
     */
    try {
      window.localStorage.removeItem(KALKULATOR_ACCESS_LEGACY_STORAGE_KEY)
    } catch {
      // Kein Speicherzugriff, kein Altbestand, den er uns verheimlichen könnte.
    }
  }, [])

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValidAccessCode(code)) {
      setError(true)
      return
    }
    // Bewusst ohne Persistenz: Der Zugang gilt für diesen Seitenaufruf, nicht
    // für dieses Gerät (s. `lib/kalkulator-access.ts`).
    setError(false)
    setUnlocked(true)
  }

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
