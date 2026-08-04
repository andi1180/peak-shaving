import { useTranslations } from 'next-intl'
import { Container } from '@/components/ui/layout'
import type { PortalLead, PortalLeadsState } from '@/lib/partner-portal/leads'

/**
 * DER REITER „LEADS" (B18-6): die Anfragen, die über den Empfehlungslink dieses Betriebs entstanden
 * sind — namentlich nur dort, wo die Person die Weitergabe freigegeben hat.
 *
 * ── DIE FEHLENDEN NAMEN SIND DER KERN DIESER SEITE, NICHT IHR RANDFALL ──────────────────────────
 * `total` zählt ALLE zugeordneten Anfragen, `leads` enthält nur die freigegebenen. Die Differenz
 * steht als eigener Satz da, sachlich und ohne Aufforderung: Der Fachbetrieb kann daran nichts
 * ändern, und die Person, die nicht freigegeben hat, hat eine gültige Entscheidung getroffen. Ein
 * Ton, der zum Nachfassen einlädt („N Anfragen entgehen Ihnen"), machte aus einer Einwilligung ein
 * Hindernis — und die Einwilligung ist die einzige Rechtsgrundlage, auf der dieser Reiter steht.
 *
 * Aus demselben Grund gibt es hier KEINE Platzhalterzeilen für die namenlosen Anfragen: Sie trügen
 * ihren Zeitpunkt, und ein Zeitpunkt neben einer verschickten Empfehlung ist für deren Absender oft
 * schon die Zuordnung. Der Wrapper gibt sie deshalb gar nicht erst heraus (B18-6-Schema) — was hier
 * fehlt, kann diese Komponente auch nicht versehentlich anzeigen.
 *
 * ── DREI ZUSTÄNDE, UND „LEER" IST NICHT „GEHT GERADE NICHT" ─────────────────────────────────────
 * Eine leere Liste ist eine AUSSAGE („noch nichts gekommen"), ein Fehler ist das Fehlen einer
 * Aussage. Beides gleich anzuzeigen sagte einem Fachbetrieb, seine Aussendung sei wirkungslos
 * geblieben, obwohl niemand nachgesehen hat. `none` (der Betrieb wurde zwischen den zwei Aufrufen
 * stillgelegt) und `error` werden dagegen GLEICH angezeigt: Aus Sicht dieser Seite heisst beides
 * „wir können es gerade nicht sagen", und ein Betrieb, dem hier „Sie sind nicht mehr Partner"
 * entgegenschlüge, während der Rahmen ringsum sein Portal zeigt, bekäme eine Auskunft, die die
 * Seite nicht belegen kann.
 *
 * ── ES GIBT NICHTS ZU BEARBEITEN, ZU FILTERN ODER ZU EXPORTIEREN ────────────────────────────────
 * `public.get_my_partner_leads` ist ein reiner Lesepfad ohne Parameter (B18-6-Schema). Eine
 * Suchleiste oder ein CSV-Knopf ohne Wirkung wäre schlimmer als ihr Fehlen; beides verlangte einen
 * neuen Wrapper mit eigener Begründung.
 *
 * SERVER-KOMPONENTE, ohne jeden Client-Anteil.
 */
function formatDate(iso: string): string | null {
  const date = new Date(iso)
  // Ein unlesbarer Zeitstempel ist keine Angabe — dann fehlt die Zeile, statt „Invalid Date" zu zeigen.
  if (Number.isNaN(date.getTime())) return null
  /*
   * Dieselbe Formatierung wie „Partner seit" (`general-panel.tsx`) und `/konto`: `de-AT`,
   * `dateStyle: 'medium'`, Zeitzone `Europe/Vienna`. Die Datenbank speichert UTC, und eine Anfrage
   * um 00:30 Ortszeit stünde ohne Zeitzone einen Tag zu früh — bei einer Anfrage, auf die jemand
   * zurückrufen soll, ist das der Unterschied zwischen „gestern" und „heute".
   */
  return new Intl.DateTimeFormat('de-AT', {
    dateStyle: 'medium',
    timeZone: 'Europe/Vienna',
  }).format(date)
}

/**
 * Die Überschrift einer Anfrage: Firma, sonst der Name, sonst die Adresse.
 *
 * Kein „—" und kein „Unbekannt": Erhoben wird, was der jeweilige Einstiegspunkt fragt, und über die
 * Partner-Landingpage sind Firma und Telefon optional. Die Zeile zeigt deshalb den ersten Wert, den
 * es tatsächlich gibt — und wenn es gar keinen gibt, sagt sie das in EINEM Wort, statt drei leere
 * Felder untereinander zu stellen.
 */
function leadTitle(lead: PortalLead, fallback: string): string {
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ')
  return lead.company ?? (name || lead.email) ?? fallback
}

export function PortalLeadsPanel({ leads }: { leads: PortalLeadsState }) {
  const t = useTranslations('PartnerPortal.leads')

  return (
    <Container className="py-16 sm:py-24">
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="text-h2 text-ink">{t('title')}</h1>
        <p className="mt-3 text-body text-text-muted">{t('intro')}</p>

        {leads.state !== 'ok' ? (
          /*
           * `none` und `error` teilen sich diesen Zustand (s. Kopf). Bewusst KEINE „Erneut
           * versuchen"-Schaltfläche: Ein Neuladen der Seite tut dasselbe, und ein Knopf, der
           * denselben Fehler ein zweites Mal erzeugt, sieht aus wie ein Versprechen.
           */
          <p className="mt-8 rounded-lg border border-line bg-surface p-6 text-body text-text-muted">
            {t('unavailable')}
          </p>
        ) : (
          <>
            <p className="mt-8 text-body text-ink">
              {t('total', { count: leads.total })}
            </p>

            {leads.leads.length === 0 ? (
              <p className="mt-4 rounded-lg border border-line bg-surface p-6 text-body text-text-muted">
                {/*
                  ZWEI verschiedene Leerzustände, und die Unterscheidung ist die ganze Arbeit dieses
                  Zweigs: „noch gar nichts gekommen" gegen „gekommen, aber nichts freigegeben". Ein
                  gemeinsamer Satz sagte einem Betrieb, der gerade hundert Kunden angeschrieben hat,
                  seine Aussendung sei wirkungslos geblieben.
                */}
                {leads.total === 0 ? t('empty') : t('emptyWithoutConsent')}
              </p>
            ) : (
              <ul className="mt-4 flex flex-col gap-3">
                {leads.leads.map((lead) => {
                  const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ')
                  const date = lead.createdAt ? formatDate(lead.createdAt) : null
                  const title = leadTitle(lead, t('unnamed'))

                  return (
                    <li
                      key={lead.id}
                      className="rounded-lg border border-line bg-surface p-5"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <h2 className="break-words font-medium text-ink">{title}</h2>
                        {date && (
                          <span className="shrink-0 text-small tabular-nums text-text-muted">
                            {date}
                          </span>
                        )}
                      </div>

                      <dl className="mt-3 flex flex-col gap-2">
                        {/*
                          Der Name erscheint als eigene Zeile NUR, wenn die Überschrift ihn nicht
                          schon trägt (also wenn eine Firma da ist) — sonst stünde derselbe Text
                          zweimal untereinander.
                        */}
                        {lead.company && name && (
                          <Row label={t('contactLabel')} value={name} />
                        )}
                        {lead.email && (
                          <Row label={t('emailLabel')} value={lead.email} href={`mailto:${lead.email}`} />
                        )}
                        {lead.phone && (
                          <Row label={t('phoneLabel')} value={lead.phone} href={`tel:${lead.phone}`} />
                        )}
                      </dl>
                    </li>
                  )
                })}
              </ul>
            )}

            {/*
              Der Restmengen-Satz erscheint NUR NEBEN einer Liste — „dazu kommen" setzt voraus, dass
              etwas dasteht, wozu sie kommen. Ist die Liste leer, sagt der Leerzustand darüber
              bereits dasselbe; beides untereinander gemessen (5 Anfragen, keine freigegeben) las
              sich wie zwei Anläufe, denselben Sachverhalt zu erklären.
            */}
            {leads.leads.length > 0 && leads.withoutConsent > 0 && (
              <p className="mt-4 text-small text-text-muted">
                {t('withoutConsent', { count: leads.withoutConsent })}
              </p>
            )}

            <p className="mt-6 text-small text-text-muted">{t('hint')}</p>
          </>
        )}
      </div>
    </Container>
  )
}

/**
 * Eine Angabe der Anfrage. E-Mail und Telefon sind verlinkt — der Zweck dieser Seite ist der
 * Rückruf, und eine Nummer, die man erst markieren und kopieren muss, ist auf dem Telefon eines
 * Elektrikers genau die Hürde, die dieser Reiter abbauen soll.
 */
function Row({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3">
      <dt className="w-28 shrink-0 text-small text-text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-body text-ink">
        {href ? (
          <a
            href={href}
            className="text-accent underline decoration-accent-border underline-offset-4 hover:decoration-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  )
}
