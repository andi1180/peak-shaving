import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'

import { ProjectChat } from '@/components/kalkulator/project-chat'
import { CalculatorAccessRequest } from '@/components/peak-shaving/calculator-access-request'
import { Container, Eyebrow } from '@/components/ui/layout'
import { Link } from '@/i18n/navigation'
import { ANMELDEN_HREF, NEXT_PARAM } from '@/lib/auth/config'
import { redirectToLocalized } from '@/lib/auth/server-helpers'
import { getCalculatorAccess } from '@/lib/kalkulator/access'
import { PROJECT_ID_PATTERN, PROJEKTE_HREF, projectChatHref } from '@/lib/kalkulator/projects'
import { readMyProject } from '@/lib/kalkulator/projects-server'
import { loadProjectDocuments, loadProjectMessages } from '@/lib/project-chat/supabase-ports'
import { visibleTranscript } from '@/lib/project-chat/transcript'
import { robotsFor } from '@/lib/routes'

/**
 * `/kalkulator/projekte/[id]` — der Chat EINES Projekts (B24, achter Bauschritt).
 *
 * ── ⚠ DREI FRAGEN, UND DIE ERSTE STELLT NICHT DIE DATENBANK ───────────────────────────────────
 * (1) Ist die Kennung überhaupt eine UUID? Das Segment kommt aus dem Browser; ein Nicht-UUID-Wert
 *     liefe als Parameter in einen rohen Postgres-Fehler (22P02) statt in ein sauberes „gibt es
 *     nicht". Deshalb dieselbe Musterprüfung wie an den zwei Server-Action-Rändern.
 * (2) Darf dieses Konto es sehen? Das beantwortet `public.get_my_project` — EIGENTUM, nicht
 *     `project_accessible`. Die Begründung steht ausführlich im Kopf von `projects-server.ts`:
 *     mit dem weiteren Wrapper sähe ein Admin den Kundenchat in der KUNDEN-Oberfläche, samt
 *     Eingabezeile, und schriebe unter dem Konto des Kunden in dessen Gespräch.
 * (3) Ist der Kalkulator für dieses Konto freigeschaltet? Dieselbe Frage wie auf der Liste und aus
 *     demselben Grund (jeder Turn ist abrechenbar).
 *
 * Die Reihenfolge ist bewusst Zugang → Form → Eigentum: Ein nicht angemeldeter Besucher bekommt
 * eine Umleitung mit Rücksprungziel und keine 404, sonst käme er nach dem Anmelden nirgendwo an.
 *
 * ── EIN FREMDES PROJEKT IST EINE 404, KEINE MELDUNG ───────────────────────────────────────────
 * „Gibt es nicht" und „gehört jemand anderem" sind in diesem Schema durchgängig nicht
 * unterscheidbar (B24 erster Bauschritt). Ein eigener Text „das gehört Ihnen nicht" wäre die
 * Auskunft, welche Kennungen existieren.
 */
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Projekte.chat' })
  /*
   * Der Titel nennt bewusst NUR „Projekt" und nicht die Bezeichnung des Kunden: Er stünde im
   * Browser-Tab, im Verlauf und in einem geteilten Lesezeichen. Die Seite trägt `noindex`, aber
   * ein Tab-Titel ist die eine Stelle, an der ein Kundenname unbeabsichtigt über die Schulter
   * mitgelesen wird. Die Bezeichnung steht in der sichtbaren H1, wo sie hingehört.
   */
  return { title: `${t('metaTitle')} — COOLiN ENERGY`, robots: robotsFor(PROJEKTE_HREF) }
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  setRequestLocale(locale)

  const access = await getCalculatorAccess()
  if (access.state === 'anonymous') {
    redirectToLocalized(ANMELDEN_HREF, locale, { [NEXT_PARAM]: projectChatHref(id) })
  }
  if (access.state === 'no_entitlement') {
    return <CalculatorAccessRequest email={access.email} />
  }

  if (!PROJECT_ID_PATTERN.test(id)) notFound()

  const project = await readMyProject(id)
  if (project === null) notFound()

  const t = await getTranslations({ locale, namespace: 'Projekte.chat' })

  /*
   * Verlauf und Dokumente parallel — beide hängen an derselben Eigentumsentscheidung, die die
   * Datenbank in jedem der beiden Wrapper ohnehin noch einmal selbst trifft.
   */
  const [messages, documents] = await Promise.all([
    loadProjectMessages(project.id),
    loadProjectDocuments(project.id),
  ])

  return (
    <Container className="py-12 sm:py-16">
      <div className="mx-auto w-full max-w-2xl">
        <p className="text-small">
          <Link
            href={PROJEKTE_HREF}
            className="font-medium text-accent underline underline-offset-4"
          >
            {t('back')}
          </Link>
        </p>

        <Eyebrow className="mt-6">{t('metaTitle')}</Eyebrow>
        <h1 className="mt-2 break-words text-h2 text-ink">{project.customerLabel}</h1>
        <p className="mt-3 text-body text-text-muted">{t('intro')}</p>

        <div className="mt-8">
          <ProjectChat
            projectId={project.id}
            /*
             * Die Auswahl trifft `visibleTranscript` — SERVERSEITIG und an genau einer Stelle.
             * `tool_call`/`tool_result` erreichen den Browser damit gar nicht erst; sie stehen
             * weder im Markup noch im Flight-Payload.
             */
            initialTranscript={visibleTranscript(messages)}
            initialDocuments={documents.map((document) => ({
              id: document.id,
              filename: document.original_filename,
            }))}
          />
        </div>
      </div>
    </Container>
  )
}
