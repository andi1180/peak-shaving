import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/layout'
import { Link } from '@/i18n/navigation'
import { KONTAKT_HREF } from '@/lib/nav'
import { PARTNER_BEWERBUNG_HREF } from '@/lib/partner-application/config'

/**
 * Was ein ANGEMELDETER Besucher ohne `calculator_pro`-Entitlement statt des Rechners sieht (B10-2).
 *
 * ── WARUM DAS EIN EIGENER ZUSTAND IST UND KEINE UMLEITUNG ───────────────────────────────────────
 * Eine Umleitung ist die richtige Antwort auf „nicht angemeldet": der Besucher kann selbst etwas
 * tun. Hier hat er das bereits getan — er IST angemeldet. Ihn wegzuschicken hiesse, ihn im Kreis
 * zu führen; ihm einen Fehler zu zeigen hiesse, einen normalen Zustand als Störung auszugeben.
 * Der Zugang wird auf Anfrage vergeben, und genau das steht hier, mit dem Weg dorthin.
 *
 * ── DER GUTSCHEINCODE-WEG IST MIT B18-4 ENTFALLEN ───────────────────────────────────────────────
 * Bis B18-4 stand hier oben das Einlöseformular (`RedeemCodeForm`) und darunter ein Kontakt-CTA.
 * Der Zugang zum Kalkulator läuft ab jetzt über die Partnerschaft: Fachbetrieb werden, danach im
 * Portal (Reiter „Kalkulator") eine Begründung einreichen, danach die Freigabe. Ein zweiter,
 * paralleler Weg über einen Code stünde daneben und wäre die Antwort auf eine Frage, die niemand
 * mehr stellt — und für einen Betrieb, der beides sieht, wäre nicht erkennbar, welcher der gültige
 * ist.
 *
 * ⚠ WAS DAS AUSDRÜCKLICH NICHT HEISST: `lib/redemption/**`, `RedeemCodeForm` und `/konto` bleiben
 * unangetastet und in Betrieb. Sie bedienen weiterhin den **Monitor** mit eigenen Codes; entfernt
 * ist allein dieser AUFRUFORT. Auch `CODE_PRODUCT_KEYS` (`lib/admin/config.ts`) führt weiterhin
 * `calculator_pro` — ein bereits ausgestellter Code bleibt auf `/konto` einlösbar; er ist nur nicht
 * mehr der Weg, den diese Seite anbietet.
 *
 * ── DIE ZWEI SCHRITTE STEHEN ALS ZWEI DA, UND DAS IST DIE ENTSCHEIDUNG ──────────────────────────
 * Eine geordnete Liste, nicht ein Fliesstext mit einem Knopf. Wer nur „Partner werden" liest und
 * sich bewirbt, wartet danach auf eine Kalkulator-Freischaltung, die er nie beantragt hat — die
 * Anfrage im Portal ist ein eigener, bewusster Schritt (B18-4), und sie fehlt genau dem, der von
 * hier kommt.
 *
 * ── DER KONTAKTWEG BLEIBT, KLAR SEKUNDÄR ────────────────────────────────────────────────────────
 * Ein Textlink am Fuss, kein zweiter Knopf. Er bleibt, weil diese Seite sonst für jeden, dessen
 * Fall die zwei Schritte nicht abdecken, eine Sackgasse wäre — und den Fall gibt es real: Ein
 * Konto entsteht hier auch durch die gewöhnliche Registrierung (B10-5), also auch für Betriebe,
 * die Kunde und nicht Vertriebspartner werden wollen. Denen bliebe sonst ausschliesslich die
 * Aufforderung, sich als Fachbetrieb zu bewerben — eine Rolle, die sie gar nicht anstreben.
 *
 * Server-Komponente (kein `'use client'`): reine Darstellung ohne Zustand. `useTranslations`
 * funktioniert in dieser App auch serverseitig — dasselbe Muster wie die Startseiten-Blöcke.
 *
 * `/kontakt?thema=peakShaving` ist ein BESTEHENDER Deep-Link (`lib/kontakt/themen.ts`): das
 * Kontaktformular wählt das Thema damit vor. Kein neuer Parameter, kein zweiter Kontaktweg.
 *
 * ⚠ TEXTE SIND ARBEITSSTAND — s. Vermerk bei `CalculatorFrame.access` in `messages/de.json`.
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
            <h3 className="text-h4 text-ink">{t('partnerTitle')}</h3>
            <p className="mt-1 text-small text-text-muted">{t('partnerLead')}</p>
            {/* Nummerierung aus der Liste selbst, nicht aus danebengestellten Ziffern: die
                Reihenfolge IST die Aussage, und sie soll auch vorgelesen als Reihenfolge
                ankommen. */}
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-small text-text marker:text-text-muted">
              <li>{t('step1')}</li>
              <li>{t('step2')}</li>
            </ol>
            <div className="mt-6">
              <Button asChild variant="primary" size="lg">
                {/* Kein `Button href` — die Primitive nimmt ihr Kind an, damit der Link der
                    locale-bewusste `Link` bleibt und nicht ein zweites Mal gebaut wird. */}
                <Link href={PARTNER_BEWERBUNG_HREF}>{t('partnerCta')}</Link>
              </Button>
            </div>
          </div>

          <div className="mt-8 border-t border-line pt-6">
            <p className="text-small text-text-muted">
              {t('contactLead')}{' '}
              <Link
                href={`${KONTAKT_HREF}?thema=peakShaving`}
                className="font-medium text-accent underline underline-offset-4"
              >
                {t('contactCta')}
              </Link>
            </p>
          </div>

          {/*
            * Die angemeldete Adresse steht bewusst da: Ein Zugang hängt an genau EINEM Konto
            * (B13 — Mandanten/Reseller-Gruppen sind ausdrücklich zurückgestellt). Wer zwei
            * Adressen hat und mit der falschen angemeldet ist, sieht sonst nur „kein Zugang"
            * und sucht den Fehler beim Zugang statt bei der Anmeldung. Seit B18-4 trägt das
            * zusätzlich: die Partner-Freigabe wirkt auf DIESES Konto, nicht auf das andere.
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
