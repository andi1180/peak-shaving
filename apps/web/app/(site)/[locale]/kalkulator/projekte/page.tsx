import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { NewProjectForm } from '@/components/kalkulator/new-project-form'
import { Container, Eyebrow } from '@/components/ui/layout'
import { CalculatorAccessRequest } from '@/components/peak-shaving/calculator-access-request'
import { Link } from '@/i18n/navigation'
import { ANMELDEN_HREF, KONTO_HREF, NEXT_PARAM } from '@/lib/auth/config'
import { redirectToLocalized } from '@/lib/auth/server-helpers'
import { getCalculatorAccess } from '@/lib/kalkulator/access'
import { PROJEKTE_HREF, projectChatHref } from '@/lib/kalkulator/projects'
import { readMyProjects } from '@/lib/kalkulator/projects-server'
import { robotsFor } from '@/lib/routes'

/**
 * `/kalkulator/projekte` — die eigenen Projekte des Kunden (B24, achter Bauschritt).
 *
 * ── ⚠ DIESELBE ZUGANGSFRAGE WIE DER RECHNER, NICHT EINE ZWEITE ─────────────────────────────────
 * Der Chat IST der Kalkulator — nur die Dateneingabe im Gespräch statt im Formular (Delta §3.1).
 * Deshalb entscheidet hier `getCalculatorAccess()`, also derselbe Lesepfad
 * (`public.get_my_entitlement` mit `calculator_pro`), den auch `/peak-shaving/kalkulator/rechner`
 * benutzt. Es gibt bewusst keine zweite Definition von „hat Zugang" (Invariante I1).
 *
 * Der Grund ist nicht Symmetrie, sondern Geld: Jeder Turn löst bis zu neun ABRECHENBARE
 * Modellaufrufe aus (`MAX_TOOL_CALLS_PER_TURN` + der abschliessende), und die Kostenbremse aus dem
 * siebten Bauschritt begrenzt sie JE KONTO. Ohne Entitlement-Prüfung wäre jedes registrierte
 * Konto — und Registrierung ist öffentlich — ein eigenes Tageskontingent.
 *
 * Drei Zustände, wie auf der Rechner-Route und aus denselben Gründen: `anonymous` → Umleitung mit
 * Rücksprungziel; `no_entitlement` → die BESTEHENDE Anfrage-Seite (kein zweiter Erklärzustand
 * daneben, der dasselbe anders sagt); `granted` → die Liste.
 *
 * ── KEIN INDEX, KEIN CACHE ─────────────────────────────────────────────────────────────────────
 * `force-dynamic`: Die Seite zeigt die Projektnamen EINES Kunden. Eine zwischengespeicherte
 * Fassung zeigte dem nächsten Besucher die des vorigen — derselbe Grund wie im Partner-Portal.
 * `robotsFor` holt die `noindex`-Entscheidung aus `lib/routes.ts`, dem einen Fundort, an dem auch
 * die sitemap sie liest.
 */
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Projekte.list' })
  return { title: `${t('metaTitle')} — COOLiN ENERGY`, robots: robotsFor(PROJEKTE_HREF) }
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('de-AT', {
    dateStyle: 'medium',
    timeZone: 'Europe/Vienna',
  }).format(new Date(iso))
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  const access = await getCalculatorAccess()
  if (access.state === 'anonymous') {
    redirectToLocalized(ANMELDEN_HREF, locale, { [NEXT_PARAM]: PROJEKTE_HREF })
  }

  const t = await getTranslations({ locale, namespace: 'Projekte.list' })
  const tNew = await getTranslations({ locale, namespace: 'Projekte.new' })

  if (access.state === 'no_entitlement') {
    return <CalculatorAccessRequest email={access.email} />
  }

  const projects = await readMyProjects()

  return (
    <Container className="py-16 sm:py-24">
      <div className="mx-auto w-full max-w-2xl">
        <Eyebrow>{t('eyebrow')}</Eyebrow>
        <h1 className="mt-2 text-h2 text-ink">{t('title')}</h1>
        <p className="mt-3 text-body text-text-muted">{t('lead')}</p>

        <div className="mt-8 flex flex-col gap-4">
          {!projects.ok ? (
            /*
             * ⚠ „Konnte nicht gelesen werden" ist NICHT „Sie haben noch keine Projekte". Beides
             * gleich anzuzeigen hiesse, jemandem mit laufenden Gesprächen zu sagen, er habe noch
             * keines — und ihn einzuladen, für dieselbe Sache ein zweites anzulegen. Das
             * Anlege-Formular fehlt in diesem Zustand deshalb ebenfalls.
             */
            <div role="alert" className="rounded-lg border border-negative bg-negative-subtle p-6">
              <p className="text-small font-semibold text-negative">{t('loadError')}</p>
            </div>
          ) : projects.projects.length === 0 ? (
            <section className="rounded-lg border border-line bg-surface p-6">
              <p className="text-body font-semibold text-ink">{t('empty')}</p>
              <p className="mt-1 text-small text-text-muted">{t('emptyHint')}</p>
            </section>
          ) : (
            <ul className="flex flex-col gap-4">
              {projects.projects.map((project) => (
                <li key={project.id}>
                  <section className="rounded-lg border border-line bg-surface p-6">
                    <h2 className="text-h4 break-words text-ink">{project.customerLabel}</h2>
                    <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-small text-text-muted">
                      <div className="flex gap-2">
                        <dt>{t('createdLabel')}</dt>
                        <dd className="tabular-nums text-ink">{formatDate(project.createdAt)}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt>{t('updatedLabel')}</dt>
                        <dd className="tabular-nums text-ink">{formatDate(project.updatedAt)}</dd>
                      </div>
                    </dl>
                    <Link
                      href={projectChatHref(project.id)}
                      className="mt-4 inline-block text-small font-medium text-accent underline underline-offset-4"
                    >
                      {t('open')}
                    </Link>
                  </section>
                </li>
              ))}
            </ul>
          )}

          {projects.ok && (
            <section className="rounded-lg border border-line bg-surface p-6">
              <h2 className="text-h4 text-ink">{tNew('title')}</h2>
              <p className="mt-1 text-small text-text-muted">{tNew('lead')}</p>
              <NewProjectForm />
            </section>
          )}

          <p className="text-small">
            <Link
              href={KONTO_HREF}
              className="font-medium text-accent underline underline-offset-4"
            >
              {t('backToAccount')}
            </Link>
          </p>
        </div>
      </div>
    </Container>
  )
}
