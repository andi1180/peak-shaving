import { useTranslations } from 'next-intl'
import { Container } from '@/components/ui/layout'
import { COMPANY, COMPANY_LEGAL } from '@/lib/nav'

/**
 * /impressum (Pflichtenheft §9.1) — echte Inhaltsseite, ersetzt den bisherigen
 * `PagePlaceholder`. Löst OP#13 auf: die ECG-§5-Pflichtangaben sind zugeliefert.
 *
 * WERTE AUS KONSTANTEN, BESCHRIFTUNGEN AUS `messages/de.json`: Die Angaben
 * selbst (Firmenwortlaut, UID, Firmenbuch, Sitz) sind Stammdaten und stehen in
 * `lib/nav.ts` — Adresse und E-Mail in `COMPANY` (dieselbe eine Quelle, die
 * Footer, /ueber-uns und das JSON-LD lesen), die Rechtsträger-Angaben in
 * `COMPANY_LEGAL`. Nur die Beschriftungen sind sichtbarer Text im Sinne von
 * §8.7 und kommen aus dem Nachrichtenkatalog. Stünden die Werte dort ebenfalls,
 * gäbe es zwei Adressen im Repo, die auseinanderlaufen können — ausgerechnet
 * auf der Seite, deren einziger Zweck die richtige Angabe ist.
 *
 * Eine Definitionsliste (`<dl>`) statt einer Tabelle: Beschriftung → Wert ist
 * genau das Verhältnis, das `dl` beschreibt, und sie bricht auf schmalen
 * Bildschirmen sauber um.
 */
export function ImpressumPage() {
  const t = useTranslations('Impressum')
  const l = useTranslations('Impressum.labels')

  return (
    <Container className="py-16 sm:py-24">
      <p className="text-label uppercase text-accent">{t('eyebrow')}</p>
      <h1 className="mt-3 max-w-prose text-h1 text-ink">{t('title')}</h1>
      <p className="mt-5 max-w-prose text-lead text-text">{t('intro')}</p>

      <dl className="mt-12 max-w-prose space-y-6">
        <Entry label={l('legalName')} value={COMPANY_LEGAL.legalName} />
        <Entry label={l('legalForm')} value={COMPANY_LEGAL.legalForm} />
        <Entry label={l('businessPurpose')} value={COMPANY_LEGAL.businessPurpose} />
        <Entry label={l('vatId')} value={COMPANY_LEGAL.vatId} />
        <Entry label={l('companyRegisterNumber')} value={COMPANY_LEGAL.companyRegisterNumber} />
        <Entry label={l('companyRegisterCourt')} value={COMPANY_LEGAL.companyRegisterCourt} />

        <div>
          <dt className="text-small font-medium uppercase tracking-wide text-text-muted">
            {l('seat')}
          </dt>
          <dd className="mt-1 text-body text-ink">
            <span className="block">{COMPANY_LEGAL.legalName}</span>
            <span className="block">{COMPANY.street}</span>
            <span className="block">{COMPANY.city}</span>
          </dd>
        </div>

        <div>
          <dt className="text-small font-medium uppercase tracking-wide text-text-muted">
            {l('phone')}
          </dt>
          <dd className="mt-1 text-body text-ink">
            <a
              href={`tel:${COMPANY_LEGAL.phoneHref}`}
              className="text-accent underline-offset-4 hover:underline"
            >
              {COMPANY_LEGAL.phone}
            </a>
          </dd>
        </div>

        <div>
          <dt className="text-small font-medium uppercase tracking-wide text-text-muted">
            {l('email')}
          </dt>
          <dd className="mt-1 text-body text-ink">
            <a
              href={`mailto:${COMPANY.email}`}
              className="text-accent underline-offset-4 hover:underline"
            >
              {COMPANY.email}
            </a>
          </dd>
        </div>

        <Entry label={l('memberships')} value={COMPANY_LEGAL.memberships} />

        <div>
          <dt className="text-small font-medium uppercase tracking-wide text-text-muted">
            {l('applicableLaw')}
          </dt>
          <dd className="mt-1 text-body text-ink">
            {/* Der Verweis auf das RIS ist ein Link, weil er als Fundstelle gemeint
                ist — eine nicht anklickbare Adresse wäre hier eine halbe Angabe. */}
            <a
              href={COMPANY_LEGAL.applicableLawHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline-offset-4 hover:underline"
            >
              {COMPANY_LEGAL.applicableLaw}
            </a>
          </dd>
        </div>

        <Entry label={l('supervisoryAuthority')} value={COMPANY_LEGAL.supervisoryAuthority} />
      </dl>
    </Container>
  )
}

function Entry({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-small font-medium uppercase tracking-wide text-text-muted">{label}</dt>
      <dd className="mt-1 text-body text-ink">{value}</dd>
    </div>
  )
}
