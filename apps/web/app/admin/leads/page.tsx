import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container, Num } from '@/components/ui/layout'
import { Button } from '@/components/ui/button'
import { Checkbox, Input, Label, Select } from '@/components/ui/input'
import {
  AdminError,
  AdminPanel,
  AdminTable,
  EmptyRow,
  Pill,
  Td,
  Th,
  formatDate,
  formatDateTime,
} from '@/components/admin/ui'
import {
  CONSENT_PURPOSES,
  CONSENT_STATUS_LABELS,
  LEADS_HREF,
  LEAD_STATUSES,
  SUPPRESSIONS_HREF,
  consentStatusLabel,
  purposeLabel,
  readLeadList,
  readStatus,
  sourceLabel,
  statusLabel,
  type LeadConsentSummary,
  type LeadListRow,
  type LeadSource,
} from '@/lib/admin/leads'

/*
 * `/admin/leads` — die Lead-Liste (B1-3).
 *
 * ── WARUM DIESER ABSCHNITT EINE EIGENE ROUTE IST (und nicht ein fünfter Block auf `/admin`) ──────
 * T4-4 hat vier Verwaltungsflächen bewusst auf EINE Seite gelegt: vier kurze Tabellen ohne eigenen
 * Zustand. Die Lead-Liste hat einen: Filter, Seite, Suchbegriff. Der gehört in die URL — nur dann
 * ist eine gefilterte Ansicht teilbar, per Zurück-Taste erreichbar und nach einer Aktion
 * wiederherstellbar. Ein Block auf der Sammelseite müsste denselben Zustand in Query-Parametern
 * führen, die für die anderen drei Blöcke bedeutungslos wären.
 *
 * ── GEFILTERT WIRD IN SQL ────────────────────────────────────────────────────────────────────────
 * Alle Filter gehen als Parameter an `admin_list_leads`, keiner wird hier nachgelagert angewandt.
 * Nachgelagertes Filtern bräche die Seitenaufteilung (die Datenbank liefert 50 Zeilen, die
 * Anwendung wirft 40 weg und zeigt 10 — die Trefferzahl wäre falsch und „Seite 2" übersprünge
 * Treffer) und holte mehr personenbezogene Daten, als jemals angezeigt werden.
 *
 * ── DAS FILTERFORMULAR IST EIN ECHTES GET-FORMULAR ───────────────────────────────────────────────
 * Kein Client-Zustand, keine Server Action: die Filter SIND die URL. Damit funktioniert die Ansicht
 * ohne JavaScript, ist teilbar, und es gibt keinen zweiten Ort, an dem der Filterzustand leben und
 * mit der URL auseinanderlaufen könnte.
 *
 * Die Zugangsprüfung läuft über dieselbe Funktion wie im Layout (`isCurrentUserAdmin`, per `cache()`
 * auf einen Aufruf je Anfrage zusammengefasst). Sie ist hier NICHT redundant: dass das Layout
 * `children` nicht rendert, verhindert nicht, dass diese Seite gerendert und ins RSC-Flight-Payload
 * geschrieben wird. Ausführlich: `lib/admin/guard.ts`.
 */

export const dynamic = 'force-dynamic'

/** Neutral wie im Layout: der Tab-Titel darf nicht verraten, dass es hier etwas zu holen gibt. */
export const metadata: Metadata = {
  title: 'COOLiN ENERGY',
  robots: { index: false, follow: false },
}

const PAGE_SIZE = 50

/** Die Filter, wie sie in der URL stehen. Deutsche Schlüssel — die Routen sind es auch. */
type Query = { [key: string]: string | string[] | undefined }

function param(query: Query, name: string): string {
  const value = query[name]
  return typeof value === 'string' ? value.trim() : ''
}

/** Baut eine URL mit denselben Filtern und einer geänderten Seite. */
function pageHref(query: Query, page: number): string {
  const sp = new URLSearchParams()
  for (const key of ['status', 'quelle', 'zweck', 'einwilligung', 'suche'] as const) {
    const value = param(query, key)
    if (value) sp.set(key, value)
  }
  if (param(query, 'faellig') === '1') sp.set('faellig', '1')
  if (page > 1) sp.set('seite', String(page))
  const qs = sp.toString()
  return qs ? `${LEADS_HREF}?${qs}` : LEADS_HREF
}

/**
 * Die Einwilligungsspalte — die operativ wichtigste der Liste: nur BESTÄTIGTE Einwilligungen sind
 * im November aktivierbar. Angezeigt wird der WIRKSAME Zustand (`effective_status`), nicht der
 * gespeicherte: eine `pending`-Zeile mit längst verfallenem Token als „offen" auszuweisen hiesse,
 * eine Bestätigung anzukündigen, die nicht mehr kommen kann (B1-2 räumt lazy ab).
 */
function ConsentCell({ consents }: { consents: LeadConsentSummary[] }) {
  if (consents.length === 0) {
    return <span className="text-text-muted">keine</span>
  }
  return (
    <ul className="flex flex-col gap-1">
      {consents.map((c, i) => (
        <li key={`${c.purpose}-${c.granted_at}-${i}`} className="flex flex-wrap items-center gap-1.5">
          <span>{purposeLabel(c.purpose)}</span>
          <Pill
            tone={
              c.effective_status === 'confirmed'
                ? 'positive'
                : c.effective_status === 'pending'
                  ? 'warning'
                  : 'neutral'
            }
          >
            {consentStatusLabel(c.effective_status)}
          </Pill>
        </li>
      ))}
    </ul>
  )
}

function LeadRow({ lead, sources }: { lead: LeadListRow; sources: LeadSource[] }) {
  return (
    <tr>
      <Td>
        <Link
          href={`${LEADS_HREF}/${lead.id}`}
          className="rounded-sm font-medium text-accent underline decoration-accent underline-offset-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {lead.email}
        </Link>
        {lead.is_suppressed && (
          <span className="mt-1 block">
            <Pill tone="negative">gesperrt</Pill>
          </span>
        )}
      </Td>
      <Td>{lead.company ?? '—'}</Td>
      <Td>
        <Pill tone={lead.status === 'anonymized' ? 'neutral' : 'warning'}>
          {statusLabel(lead.status)}
        </Pill>
      </Td>
      <Td>{sourceLabel(lead.first_source_key, sources)}</Td>
      <Td>
        <ConsentCell consents={lead.consents} />
      </Td>
      <Td className="whitespace-nowrap">
        <Num>{formatDateTime(lead.last_interaction_at)}</Num>
      </Td>
      <Td className="whitespace-nowrap">
        {lead.deletion_due ? (
          // Fällige Fristen sind der einzige Grund, warum diese Liste vor B4 überhaupt regelmäßig
          // angesehen werden muss — sie werden deshalb deutlich hervorgehoben, nicht nur datiert.
          <span className="inline-flex flex-col items-start gap-1">
            <Pill tone="negative">fällig</Pill>
            <Num className="text-caption text-text-muted">{formatDate(lead.deletion_due_at)}</Num>
          </span>
        ) : (
          <Num>{formatDate(lead.deletion_due_at)}</Num>
        )}
      </Td>
    </tr>
  )
}

export default async function AdminLeadsPage({ searchParams }: { searchParams: Promise<Query> }) {
  // Kein Zugang → gar keinen Inhalt erzeugen. Was der Nutzer stattdessen SIEHT, entscheidet das
  // Layout (neutrale Seite); hier geht es darum, dass nichts entsteht, das mitgeschickt werden kann.
  if (!(await isCurrentUserAdmin())) return null

  const query = await searchParams
  const filterStatus = param(query, 'status')
  const filterSource = param(query, 'quelle')
  const filterPurpose = param(query, 'zweck')
  const filterConsent = param(query, 'einwilligung')
  const filterSearch = param(query, 'suche')
  const filterDue = param(query, 'faellig') === '1'
  const page = Math.max(1, Number.parseInt(param(query, 'seite') || '1', 10) || 1)

  const supabase = await createClient()
  const res = await supabase.rpc('admin_list_leads', {
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
    p_status: filterStatus || undefined,
    p_source_key: filterSource || undefined,
    p_consent_purpose: (filterPurpose || undefined) as
      | 'marketing_email'
      | 'contract_expiry_reminder'
      | 'result_delivery'
      | undefined,
    p_consent_status: filterConsent || undefined,
    p_search: filterSearch || undefined,
    p_due_only: filterDue,
  })
  if (res.error) console.error('[admin/leads] admin_list_leads:', res.error)

  const result = readLeadList(res.data)
  // Ein abgelehnter Filterwert ist etwas anderes als ein Ladefehler: die Datenbank hat geantwortet,
  // nur eben ablehnend. Sie ignoriert einen unbekannten Wert bewusst NICHT still — sonst hielte man
  // ein ungefiltertes Ergebnis für gefiltert.
  const invalidFilter = readStatus(res.data) === 'invalid_filter'

  const total = result?.total ?? 0
  const sources = result?.sources ?? []
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <Container className="py-10 sm:py-14">
      <header className="border-b border-line pb-6">
        <h1 className="text-h2 text-ink">Leads</h1>
        <p className="mt-2 max-w-prose text-body text-text-muted">
          Der Bestand aus Kontaktformular, Rechner und den übrigen Einstiegspunkten. Nur bestätigte
          Einwilligungen dürfen angeschrieben werden — alles andere ist rechtlich wertlos.
        </p>
        <p className="mt-3 max-w-prose text-small text-text-muted">
          <Link
            href={SUPPRESSIONS_HREF}
            className="rounded-sm font-medium text-accent underline decoration-accent underline-offset-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Sperrliste
          </Link>{' '}
          — nachsehen, ob eine Adresse dauerhaft gesperrt ist.
        </p>
      </header>

      {/*
        * Der Hinweis steht bewusst OBEN und nicht im Kleingedruckten: er beschreibt keine
        * Einschränkung der Oberfläche, sondern eine Betriebspflicht. Vor B4 gibt es im System
        * KEINEN zeitgesteuerten Job — die Löschfrist wird durchgesetzt, indem jemand diese Liste
        * ansieht.
        */}
      <div className="mt-6 rounded-md border border-warning-border bg-warning-subtle p-4">
        <p className="text-small text-ink">
          <strong className="font-semibold">Löschfristen werden derzeit manuell durchgesetzt.</strong>{' '}
          Das System hat vor Bauabschnitt B4 bewusst keinen zeitgesteuerten Job. Fällige Leads
          erscheinen über den Filter „nur zur Anonymisierung fällige“ und müssen hier von Hand
          anonymisiert werden. Die automatische Ausführung kommt mit B4.
        </p>
      </div>

      {/* ── Filter ────────────────────────────────────────────────────────────────────────────── */}
      <AdminPanel className="mt-6">
        <form method="get" action={LEADS_HREF} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <Label htmlFor="filter-suche">Suche (E-Mail oder Firma)</Label>
              <div className="mt-1.5">
                <Input
                  id="filter-suche"
                  name="suche"
                  type="search"
                  defaultValue={filterSearch}
                  placeholder="teil einer Adresse oder Firma"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="filter-status">Status</Label>
              <div className="mt-1.5">
                <Select id="filter-status" name="status" defaultValue={filterStatus}>
                  <option value="">alle</option>
                  {LEAD_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {statusLabel(s)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="filter-quelle">Herkunft</Label>
              <div className="mt-1.5">
                <Select id="filter-quelle" name="quelle" defaultValue={filterSource}>
                  <option value="">alle</option>
                  {/*
                    * Die Einstiegspunkte kommen aus der DATENBANK (`lead_sources` ist eine Tabelle,
                    * kein Enum — laufend kommen neue dazu, B3). Eine Konstante hier ließe jede neue
                    * Quelle im Filter fehlen, ohne dass es auffiele.
                    */}
                  {sources.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="filter-zweck">Einwilligung — Zweck</Label>
              <div className="mt-1.5">
                <Select id="filter-zweck" name="zweck" defaultValue={filterPurpose}>
                  <option value="">alle</option>
                  {CONSENT_PURPOSES.map((p) => (
                    <option key={p} value={p}>
                      {purposeLabel(p)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="filter-einwilligung">Einwilligung — Zustand</Label>
              <div className="mt-1.5">
                <Select id="filter-einwilligung" name="einwilligung" defaultValue={filterConsent}>
                  <option value="">alle</option>
                  {Object.entries(CONSENT_STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                  <option value="none">keine (für den gewählten Zweck)</option>
                </Select>
              </div>
            </div>

            <div className="flex items-end">
              <div className="flex items-start gap-2 pb-2">
                <Checkbox id="filter-faellig" name="faellig" value="1" defaultChecked={filterDue} />
                <Label htmlFor="filter-faellig" className="font-normal">
                  nur zur Anonymisierung fällige
                </Label>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" size="md">
              Filtern
            </Button>
            <Button asChild variant="ghost" size="md">
              <Link href={LEADS_HREF}>Zurücksetzen</Link>
            </Button>
          </div>
        </form>
      </AdminPanel>

      {/* ── Ergebnis ──────────────────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="treffer" className="mt-8">
        <h2 id="treffer" className="text-h4 text-ink">
          {invalidFilter ? 'Treffer' : <><Num>{total}</Num> Treffer</>}
        </h2>

        {invalidFilter ? (
          <div className="mt-4">
            <AdminError>
              Diese Filterkombination kennt die Datenbank nicht. Bitte setzen Sie die Filter zurück.
            </AdminError>
          </div>
        ) : result === null ? (
          <div className="mt-4">
            <AdminError>
              Die Lead-Liste konnte nicht geladen werden. Bitte laden Sie die Seite neu.
            </AdminError>
          </div>
        ) : (
          <>
            <AdminPanel className="mt-4 p-0 sm:p-0">
              <div className="px-4 py-2 sm:px-6">
                <AdminTable>
                  <thead>
                    <tr>
                      <Th>E-Mail</Th>
                      <Th>Firma</Th>
                      <Th>Status</Th>
                      <Th>Herkunft</Th>
                      <Th>Einwilligungen</Th>
                      <Th>Letzte Interaktion</Th>
                      <Th>Löschfrist</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.leads.length === 0 && (
                      <EmptyRow colSpan={7}>
                        Kein Lead passt zu diesen Filtern.
                      </EmptyRow>
                    )}
                    {result.leads.map((lead) => (
                      <LeadRow key={lead.id} lead={lead} sources={result.sources} />
                    ))}
                  </tbody>
                </AdminTable>
              </div>

              {lastPage > 1 && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-6">
                  <p className="text-caption text-text-muted">
                    Seite <Num>{page}</Num> von <Num>{lastPage}</Num>
                  </p>
                  <div className="flex items-center gap-2">
                    {page > 1 && (
                      <Button asChild variant="secondary" size="sm">
                        <Link href={pageHref(query, page - 1)}>Zurück</Link>
                      </Button>
                    )}
                    {page < lastPage && (
                      <Button asChild variant="secondary" size="sm">
                        <Link href={pageHref(query, page + 1)}>Weiter</Link>
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/*
                * Bewusst OHNE Export und OHNE Sammelaktionen: beides ist B2 (Segmentierung und
                * Aussendung). Ein Export vor der Suppression-/Zustellprotokoll-Schicht wäre eine
                * Adressliste ohne die Prüfungen, die vor jedem Versand zu laufen haben.
                */}
              <p className="border-t border-line px-4 py-3 text-caption text-text-muted sm:px-6">
                Kein Export, keine Sammelaktionen — Segmentierung und Aussendung kommen mit B2.
              </p>
            </AdminPanel>
          </>
        )}
      </section>
    </Container>
  )
}
