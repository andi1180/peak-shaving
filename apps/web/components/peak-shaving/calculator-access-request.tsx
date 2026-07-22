import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/layout'
import { Link } from '@/i18n/navigation'
import { KONTO_HREF } from '@/lib/auth/config'
import { KONTAKT_HREF } from '@/lib/nav'

/**
 * Was ein ANGEMELDETER Besucher ohne `calculator_pro`-Entitlement statt des Rechners sieht (B10-2).
 *
 * ── WARUM DAS EIN EIGENER ZUSTAND IST UND KEINE UMLEITUNG ───────────────────────────────────────
 * Eine Umleitung ist die richtige Antwort auf „nicht angemeldet": der Besucher kann selbst etwas
 * tun. Hier hat er das bereits getan — er IST angemeldet. Ihn wegzuschicken hiesse, ihn im Kreis
 * zu führen; ihm einen Fehler zu zeigen hiesse, einen normalen Zustand als Störung auszugeben.
 * Der Zugang wird auf Anfrage vergeben, und genau das steht hier, mit dem Weg dorthin.
 *
 * Server-Komponente (kein `'use client'`): reine Darstellung ohne Zustand. `useTranslations`
 * funktioniert in dieser App auch serverseitig — dasselbe Muster wie die Startseiten-Blöcke.
 *
 * `/kontakt?thema=peakShaving` ist ein BESTEHENDER Deep-Link (`lib/kontakt/themen.ts`): das
 * Kontaktformular wählt das Thema damit vor. Kein neuer Parameter, kein zweiter Kontaktweg.
 */
export function CalculatorAccessRequest({ email }: { email: string | undefined }) {
  const t = useTranslations('CalculatorFrame.access')

  return (
    <Container className="py-16 sm:py-24">
      <div className="mx-auto w-full max-w-lg">
        <div className="rounded-lg border border-line bg-surface p-6 sm:p-8">
          <h2 className="text-h3 text-ink">{t('title')}</h2>
          <p className="mt-3 text-body text-text-muted">{t('lead')}</p>

          <div className="mt-8">
            <Button asChild variant="primary" size="lg">
              {/* Kein `Button href` — die Primitive nimmt ihr Kind an, damit der Link der
                  locale-bewusste `Link` bleibt und nicht ein zweites Mal gebaut wird. */}
              <Link href={`${KONTAKT_HREF}?thema=peakShaving`}>{t('cta')}</Link>
            </Button>
          </div>

          <div className="mt-8 border-t border-line pt-6">
            <p className="text-small text-text-muted">
              {t('redeemHint')}{' '}
              <Link
                href={KONTO_HREF}
                className="font-medium text-accent underline underline-offset-4 hover:text-accent-hover"
              >
                {t('redeemLink')}
              </Link>
            </p>
            {/*
              * Die angemeldete Adresse steht bewusst da: Ein Zugang hängt an genau EINEM Konto
              * (B13 — Mandanten/Reseller-Gruppen sind ausdrücklich zurückgestellt). Wer zwei
              * Adressen hat und mit der falschen angemeldet ist, sieht sonst nur „kein Zugang"
              * und sucht den Fehler beim Zugang statt bei der Anmeldung.
              */}
            {email && <p className="mt-2 text-small text-text-muted">{t('signedInAs', { email })}</p>}
          </div>
        </div>
      </div>
    </Container>
  )
}
