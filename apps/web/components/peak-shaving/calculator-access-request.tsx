import { useTranslations } from 'next-intl'
import { RedeemCodeForm } from '@/components/redemption/redeem-code-form'
import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/layout'
import { Link } from '@/i18n/navigation'
import { CALCULATOR_RUN_HREF, KONTAKT_HREF } from '@/lib/nav'

/**
 * Was ein ANGEMELDETER Besucher ohne `calculator_pro`-Entitlement statt des Rechners sieht (B10-2).
 *
 * ── WARUM DAS EIN EIGENER ZUSTAND IST UND KEINE UMLEITUNG ───────────────────────────────────────
 * Eine Umleitung ist die richtige Antwort auf „nicht angemeldet": der Besucher kann selbst etwas
 * tun. Hier hat er das bereits getan — er IST angemeldet. Ihn wegzuschicken hiesse, ihn im Kreis
 * zu führen; ihm einen Fehler zu zeigen hiesse, einen normalen Zustand als Störung auszugeben.
 * Der Zugang wird auf Anfrage vergeben, und genau das steht hier, mit dem Weg dorthin.
 *
 * ── ZWEI WEGE, UND DIE REIHENFOLGE IST DIE ENTSCHEIDUNG (B10-4) ─────────────────────────────────
 * Wer bereits einen Gutscheincode hat, soll ihn hier einlösen können — nicht erst am Kontakt-CTA
 * vorbei suchen und auch nicht wissen müssen, dass es `/konto` gibt. Genau das war der Zustand bis
 * B10-4: die Seite zeigte nur den Kontakt-CTA und daneben einen Link „Im Konto einlösen". Ein
 * Partner, dem ein Testzugang per Code gegeben wurde, lief damit nach Registrierung und Login in
 * einen Umweg, obwohl er alles Nötige schon in der Hand hielt.
 *
 * Deshalb steht die Einlösung OBEN und die Anfrage darunter — und der Kontakt-CTA ist von `primary`
 * auf `secondary` gewechselt: das Einlöseformular bringt seinen eigenen `primary`-Knopf mit
 * (`AuthSubmit`), zwei gleichrangige Hauptaktionen nebeneinander hätten die Reihenfolge optisch
 * wieder eingeebnet.
 *
 * Der Einlösemechanismus selbst ist UNVERÄNDERT: dieselbe Server Action wie auf `/konto`
 * (`redeemCodeAction`), dieselbe Komponente, dieselbe Sitzungsprüfung. Diese Seite ist ein zweiter
 * AUFRUFORT, kein zweiter Weg. Der einzige Unterschied ist das Ziel nach dem Erfolg: von hier aus
 * direkt in den Rechner, denn dorthin wollte der Nutzer.
 *
 * Server-Komponente (kein `'use client'`): reine Darstellung ohne Zustand — `RedeemCodeForm` bringt
 * seine eigene `'use client'`-Grenze mit. `useTranslations` funktioniert in dieser App auch
 * serverseitig — dasselbe Muster wie die Startseiten-Blöcke.
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
            <h3 className="text-h4 text-ink">{t('redeemTitle')}</h3>
            <p className="mt-1 text-small text-text-muted">{t('redeemLead')}</p>
            {/*
              * Das Ziel wird hier gesetzt und in der Action erneut geprüft. Die Route ist ohnehin
              * sitzungsgeschützt — bis hierher kommt nur, wer angemeldet ist; die Action verlässt
              * sich darauf aber NICHT und holt die Sitzung selbst (Rückfalllinie, falls sie zwischen
              * Seitenaufbau und Absenden abläuft).
              */}
            <RedeemCodeForm redirectTo={CALCULATOR_RUN_HREF} />
          </div>

          <div className="mt-8 border-t border-line pt-6">
            <h3 className="text-h4 text-ink">{t('contactTitle')}</h3>
            <p className="mt-1 text-small text-text-muted">{t('contactLead')}</p>
            <div className="mt-4">
              <Button asChild variant="secondary" size="lg">
                {/* Kein `Button href` — die Primitive nimmt ihr Kind an, damit der Link der
                    locale-bewusste `Link` bleibt und nicht ein zweites Mal gebaut wird. */}
                <Link href={`${KONTAKT_HREF}?thema=peakShaving`}>{t('cta')}</Link>
              </Button>
            </div>
          </div>

          {/*
            * Die angemeldete Adresse steht bewusst da: Ein Zugang hängt an genau EINEM Konto
            * (B13 — Mandanten/Reseller-Gruppen sind ausdrücklich zurückgestellt). Wer zwei
            * Adressen hat und mit der falschen angemeldet ist, sieht sonst nur „kein Zugang"
            * und sucht den Fehler beim Zugang statt bei der Anmeldung. Seit B10-4 trägt das
            * zusätzlich: ein Code wird auf DIESES Konto eingelöst, nicht auf das andere.
            */}
          {email && (
            <div className="mt-8 border-t border-line pt-6">
              <p className="text-small text-text-muted">{t('signedInAs', { email })}</p>
            </div>
          )}
        </div>
      </div>
    </Container>
  )
}
