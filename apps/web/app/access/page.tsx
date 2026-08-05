import { useTranslations } from 'next-intl'
import { AccessShell } from '@/components/access/shell'
import { Container, Eyebrow } from '@/components/ui/layout'
import { COMPANY } from '@/lib/nav'

/**
 * DER EINGANG DER ZUGANGSPLATTFORM (Baustein 1) — Platzhalter.
 *
 * ⚠ VON AUSSEN AUF KEINEM HOST ERREICHBAR. Adressiert wird sie als `/` auf `access.coolin.at`; die
 * Middleware schreibt intern hierher um. Begründung: `ACCESS_RENDER_ROOT` in `lib/access-host.ts`.
 *
 * ── WAS DIESE SEITE SAGT UND WAS SIE BEWUSST NICHT SAGT ─────────────────────────────────────────
 * Sie benennt, was hier entsteht, und dass es noch nicht benutzbar ist. Sie macht KEINE Zusage:
 * kein Preis (die Staffel in §7.2 des Pflichtenhefts ist eine interne Kalkulationsgrundlage und
 * nicht bestätigt), keine Zusage über einen Termin, keine NISG-Compliance-Behauptung (die
 * Nachweispflicht liegt rechtlich beim BETREIBER, §2.6 — eine Plattform, die „NISG-konform"
 * verspricht, behauptete etwas, das sie nicht einlösen kann) und keine technische Angabe zu Hersteller
 * oder Gerät (§0: der Name ist bewusst objekttyp-offen, und die einzige konkrete Anbindung ist noch
 * nicht gebaut).
 *
 * Der einzige Weg nach draussen ist die bestehende Kontaktadresse aus `lib/nav.ts` — nicht ein
 * getippter Zweitfundort und ausdrücklich kein Formular: Ein Formular hier würde Anfragen erfassen,
 * für die es noch keinen Empfänger-Prozess gibt (dasselbe Muster, aus dem der Betroffenheits-Check
 * in B3 nicht platziert wurde: Daten für eine Auskunft zu sammeln, die es nicht gibt).
 *
 * ── KEINE ZUGANGSPRÜFUNG, WEIL ES NICHTS ZU SCHÜTZEN GIBT ──────────────────────────────────────
 * Die Seite liest keine Sitzung, keine Datenbank und kein Geheimnis. Sie ist deshalb bewusst NICHT
 * `force-dynamic` — anders als jede Seite des Portalbereichs, wo `force-dynamic` steht, weil dort
 * die Daten EINES Betriebs gerendert werden und eine zwischengespeicherte Fassung sie dem nächsten
 * Besucher zeigte. Hier gibt es nichts Personenbezogenes, also nichts, was ein Cache falsch machen
 * könnte.
 *
 * ⚠ WER HIER DAS ERSTE MAL EINE SITZUNG ODER RMS-DATEN LIEST, MUSS BEIDES NACHZIEHEN: die
 * Zugangsprüfung IN DER SEITE (nicht im Layout — Begründung dort) und `export const dynamic =
 * 'force-dynamic'`. Das Vorbild für beides steht in `app/portal/page.tsx`.
 *
 * SERVER-KOMPONENTE, ohne jeden Client-Anteil.
 */
export default function Page() {
  const t = useTranslations('Access.placeholder')

  return (
    <AccessShell>
      <Container className="py-16 sm:py-24">
        <div className="mx-auto w-full max-w-2xl">
          <Eyebrow>{t('eyebrow')}</Eyebrow>
          <h1 className="mt-2 text-h1 text-ink">{t('title')}</h1>
          <p className="mt-4 text-lead text-text-muted">{t('lead')}</p>

          <div className="mt-8 rounded-lg border border-line bg-surface p-6">
            <h2 className="text-h4 text-ink">{t('statusTitle')}</h2>
            <p className="mt-2 text-body text-text-muted">{t('statusBody')}</p>
          </div>

          <p className="mt-6 text-small text-text-muted">
            {t('contactLead')}{' '}
            {/*
             * Die Adresse kommt aus `COMPANY` (`lib/nav.ts`) — dem EINEN Fundort der
             * Kontaktdaten. Eine hier getippte Zweitfassung zeigte nach einem Postfachwechsel
             * still ins alte Postfach; dieselbe Regel, aus der `RESEND_TO` seinen Vorgabewert von
             * dort holt.
             */}
            <a
              href={`mailto:${COMPANY.email}`}
              className="text-accent underline decoration-accent-border underline-offset-2 hover:decoration-accent"
            >
              {COMPANY.email}
            </a>
          </p>
        </div>
      </Container>
    </AccessShell>
  )
}
