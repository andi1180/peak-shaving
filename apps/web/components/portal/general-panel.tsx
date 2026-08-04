import { useTranslations } from 'next-intl'
import { Container } from '@/components/ui/layout'
import type { PortalPartner } from '@/lib/partner-portal/portal'

/**
 * DER REITER „ALLGEMEIN" (B18-3): Stammdaten des Fachbetriebs, wie COOLiN sie führt.
 *
 * Firmenname, Ansprechperson, Konto-Adresse und seit wann der Betrieb Partner ist — mehr nicht.
 * Es gibt hier NICHTS zu bearbeiten, und das ist kein fehlendes Feature: `public.get_my_partner`
 * ist ein reiner Lesepfad (B16-4b), und einen Schreibweg gäbe es nur über einen neuen Wrapper mit
 * eigener Begründung. Ein Eingabefeld ohne Wirkung wäre schlimmer als eine reine Anzeige — deshalb
 * steht der Weg zur Korrektur als Satz darunter.
 *
 * ── DIE ANSPRECHPERSON WIRD AUS ZWEI FELDERN GEBILDET, EINZELN GELESEN ──────────────────────────
 * `contact_first_name` und `contact_last_name` sind in `platform.partners` beide nullable, und ein
 * von Hand aufgenommener Betrieb ohne hinterlegte Ansprechperson ist der reale Normalfall (B18-3
 * Schema). Nur eine Hälfte hinterlegt ist ebenfalls zulässig. Ist am Ende nichts übrig, entfällt
 * die ZEILE — ein Feld mit „—" behauptete, es gäbe dort etwas zu sehen, das gerade fehlt.
 *
 * ── „PARTNER SEIT" WIRD HIER FORMATIERT, NICHT IM LESER ─────────────────────────────────────────
 * `readMyPartner` reicht den ISO-Zeitstempel unverändert durch (B18-3 Schema: „ein zweites Format
 * dort wäre ein zweiter Fundort für dieselbe Angabe"). Das Muster ist dasselbe wie in
 * `app/(site)/[locale]/konto/page.tsx`: `de-AT`, `dateStyle: 'medium'`, Zeitzone `Europe/Vienna` —
 * die Datenbank speichert UTC, und ein Beitritt am 1. März um 00:30 Ortszeit stünde ohne Zeitzone
 * als 28. Februar da.
 *
 * SERVER-KOMPONENTE, ohne jeden Client-Anteil.
 */
function formatDate(iso: string): string | null {
  const date = new Date(iso)
  // Ein unlesbarer Zeitstempel ist keine Angabe — dann fehlt die Zeile, statt „Invalid Date" zu zeigen.
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('de-AT', {
    dateStyle: 'medium',
    timeZone: 'Europe/Vienna',
  }).format(date)
}

export function PortalGeneralPanel({
  partner,
  /** Die Adresse des angemeldeten Kontos — aus der SITZUNG, nicht aus `get_my_partner`. */
  email,
}: {
  partner: PortalPartner
  email: string | null
}) {
  const t = useTranslations('PartnerPortal.general')

  const contactName = [partner.contactFirstName, partner.contactLastName]
    .filter((part): part is string => Boolean(part))
    .join(' ')

  const partnerSince = partner.partnerSince ? formatDate(partner.partnerSince) : null

  const rows: { key: string; label: string; value: string }[] = [
    { key: 'company', label: t('companyLabel'), value: partner.displayName },
    ...(contactName ? [{ key: 'contact', label: t('contactLabel'), value: contactName }] : []),
    ...(email ? [{ key: 'email', label: t('emailLabel'), value: email }] : []),
    ...(partnerSince ? [{ key: 'since', label: t('sinceLabel'), value: partnerSince }] : []),
  ]

  return (
    <Container className="py-16 sm:py-24">
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="text-h2 text-ink">{t('title')}</h1>
        <p className="mt-3 text-body text-text-muted">{t('intro')}</p>

        <div className="mt-8 rounded-lg border border-line bg-surface p-6">
          <dl className="flex flex-col gap-4">
            {rows.map((row) => (
              <div key={row.key}>
                <dt className="text-small text-text-muted">{row.label}</dt>
                <dd
                  className={
                    row.key === 'since'
                      ? 'mt-0.5 tabular-nums text-ink'
                      : 'mt-0.5 break-words font-medium text-ink'
                  }
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="mt-4 text-small text-text-muted">{t('hint')}</p>
      </div>
    </Container>
  )
}
