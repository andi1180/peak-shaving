import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Container } from '@/components/ui/layout'
import type { MyCalculatorRequestState } from '@/lib/partner-portal/my-calculator-request'
import { CalculatorRequestForm } from './calculator-request-form'

/**
 * DER REITER „KALKULATOR" (B18-4, Portal-Oberfläche) — alles ausser dem Werkzeug selbst.
 *
 * Der Zustand `granted` (der iframe) liegt bewusst NICHT hier, sondern in der Seite: Er braucht
 * weder `Container` noch Innenbreite und rendert vollflächig; ihn durch diese Komponente zu führen
 * hiesse, einen Rahmen um einen Rahmen zu legen (dieselbe Entscheidung wie auf
 * `/peak-shaving/kalkulator/rechner`).
 *
 * ── DREI ZUSTÄNDE, UND JEDER ZEIGT ETWAS ANDERES ────────────────────────────────────────────────
 *   `never`    Nie angefragt → Beschreibung, ein Beispielbild, Formular.
 *   `pending`  Eigene Anfrage liegt offen → eigener Text und eigener Begründung, KEIN zweites
 *              Formular. Ein Formular hier wäre die Einladung zu einer Einreichung, die die
 *              Datenbank ohnehin mit `already_pending` abweist — und die Abweisung sähe aus wie ein
 *              Fehler des Betriebs.
 *   `rejected` Entschieden, aber nicht freigeschaltet → kurzer Hinweis UND das Formular erneut:
 *              eine neue Anfrage ist laut B18-4-Schema ausdrücklich erlaubt (der UNIQUE-Index ist
 *              genau deshalb partiell).
 *
 * ── ⚠ `none` UND `error` FÜHREN NIE ZU EINEM FORMULAR ───────────────────────────────────────────
 * Sie zeigen denselben ehrlichen „gerade nicht abrufbar"-Zustand wie im Reiter „Anfragen" (B18-6),
 * und aus demselben Grund: Ein Lesefehler als „noch nie angefragt" gelesen stellte einem Betrieb,
 * dessen Anfrage seit gestern läuft, ein leeres Formular hin. `none` (der Betrieb wurde zwischen
 * den zwei Aufrufen stillgelegt) wird mit `error` zusammengefasst — ein Betrieb, dem hier „Sie sind
 * nicht mehr Partner" entgegenschlüge, während der Rahmen ringsum sein Portal zeigt, bekäme eine
 * Auskunft, die diese Seite nicht belegen kann.
 *
 * ── DER TON IST EIN ANDERER ALS AUF DER ÖFFENTLICHEN PRODUKTSEITE ──────────────────────────────
 * Vorbild ist `PeakShavingCalculator` (`/peak-shaving/kalkulator`), übernommen ist die SACHE, nicht
 * der Wortlaut: Wer hier liest, ist bereits Partner und muss nicht davon überzeugt werden, dass
 * Peak Shaving etwas taugt. Er will wissen, was das Werkzeug ihm im Kundengespräch abnimmt. Deshalb
 * spricht der Text von SEINEN Kunden, nicht von „Ihrem Lastgang".
 *
 * SERVER-KOMPONENTE bis auf das Formular (das braucht `useActionState`).
 */

/** Dieselbe Formatierung wie „Partner seit" und der Reiter „Anfragen": de-AT, Europe/Vienna. */
function formatDate(iso: string): string | null {
  const date = new Date(iso)
  // Ein unlesbarer Zeitstempel ist keine Angabe — dann fehlt er, statt „Invalid Date" zu zeigen.
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('de-AT', {
    dateStyle: 'medium',
    timeZone: 'Europe/Vienna',
  }).format(date)
}

export function PortalCalculatorPanel({ request }: { request: MyCalculatorRequestState }) {
  const t = useTranslations('PartnerPortal.calculator')

  if (request.state === 'none' || request.state === 'error') {
    return (
      <Container className="py-16 sm:py-24">
        <div className="mx-auto w-full max-w-2xl">
          <h1 className="text-h2 text-ink">{t('title')}</h1>
          {/*
            Bewusst KEINE „Erneut versuchen"-Schaltfläche: Ein Neuladen tut dasselbe, und ein Knopf,
            der denselben Fehler ein zweites Mal erzeugt, sieht aus wie ein Versprechen (Muster
            `leads-panel.tsx`, B18-6).
          */}
          <p className="mt-8 rounded-lg border border-line bg-surface p-6 text-body text-text-muted">
            {t('formError')}
          </p>
        </div>
      </Container>
    )
  }

  if (request.state === 'request' && request.request.status === 'pending') {
    const date = request.request.createdAt ? formatDate(request.request.createdAt) : null

    return (
      <Container className="py-16 sm:py-24">
        <div className="mx-auto w-full max-w-2xl">
          <h1 className="text-h2 text-ink">{t('pendingTitle')}</h1>
          <p className="mt-3 text-body text-text-muted">
            {date ? t('pendingIntroWithDate', { date }) : t('pendingIntro')}
          </p>

          {/*
            Die eigene Begründung steht hier, weil sie der Grund ist, warum jemand diesen Reiter
            nach ein paar Tagen erneut öffnet: „Was habe ich denen eigentlich geschrieben?".
            `whitespace-pre-wrap` erhält die Absätze, ohne den Text in Markup zu übersetzen.
          */}
          <section className="mt-8 rounded-lg border border-line bg-surface p-6">
            <h2 className="text-small font-medium text-text-muted">{t('pendingMessageLabel')}</h2>
            <p className="mt-2 whitespace-pre-wrap text-body text-ink">{request.request.message}</p>
          </section>
        </div>
      </Container>
    )
  }

  const abgelehnt = request.state === 'request' && request.request.status === 'rejected'

  return (
    <Container className="py-16 sm:py-24">
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="text-h2 text-ink">{abgelehnt ? t('rejectedTitle') : t('title')}</h1>
        <p className="mt-3 text-body text-text-muted">
          {abgelehnt ? t('rejectedIntro') : t('intro')}
        </p>

        {/*
          Die Beschreibung erscheint nur beim ERSTEN Mal. Wer schon einmal angefragt hat, weiss, was
          der Kalkulator tut — ihm dieselbe Werbung erneut hinzustellen, verfehlt seine Frage („und
          jetzt?") und schiebt das Formular nach unten.
        */}
        {!abgelehnt && (
          <>
            <div className="mt-10 flex flex-col gap-8">
              <Feature title={t('f1Title')} text={t('f1Text')} />
              <Feature title={t('f2Title')} text={t('f2Text')} />
              <Feature title={t('f3Title')} text={t('f3Text')} />
            </div>

            {/*
              GENAU EIN Screenshot, nicht die vier der öffentlichen Galerie: Diese Seite soll zur
              Anfrage führen, nicht zu einer Bildergalerie — und der Reiter ist ein Arbeitsbereich,
              keine Produktseite. Gewählt ist der Jahres-Lastgang mit Kapp-Linie: Er zeigt in einem
              Bild, worum es geht (die Spitzen und die Schwelle, unter der sie liegen sollen), er
              ist als einziger querformatig und passt damit in die Spaltenbreite ohne zu schrumpfen
              — und er trägt als einziger der vier keinen Platzhaltertext aus dem Demo-Katalog
              („[MARTIN: Katalog]", s. Root-CLAUDE.md), der einem Partner wie ein vergessenes
              internes TODO entgegensähe.

              §9.5: Der Einordnungssatz steht SICHTBAR darunter — ohne ihn wäre das Bild eine
              Referenz-Behauptung statt eines Beispiels.
            */}
            <figure className="mt-10">
              <p className="text-small font-medium text-text-muted">{t('shotLabel')}</p>
              <div className="mt-2 overflow-hidden rounded-lg border border-line bg-surface">
                <Image
                  src="/images/kalkulator-report/lastgang-kapp-linie.png"
                  alt={t('shotAlt')}
                  width={1224}
                  height={664}
                  sizes="(min-width: 768px) 42rem, 100vw"
                  quality={90}
                  className="h-auto w-full"
                />
              </div>
              <figcaption className="mt-2 text-small text-text-muted">
                {t('shotCaption')}{' '}
                <span className="text-text-muted">{t('shotDisclaimer')}</span>
              </figcaption>
            </figure>
          </>
        )}

        <section className="mt-12 border-t border-line pt-8">
          <h2 className="text-h4 text-ink">{t('formTitle')}</h2>
          <p className="mt-2 text-body text-text-muted">{t('formIntro')}</p>
          <CalculatorRequestForm />
        </section>
      </div>
    </Container>
  )
}

function Feature({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h2 className="text-h4 text-ink">{title}</h2>
      <p className="mt-2 text-body text-text-muted">{text}</p>
    </div>
  )
}
