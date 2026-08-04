import type { Metadata } from 'next'
import Link from 'next/link'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container } from '@/components/ui/layout'
import { Button } from '@/components/ui/button'
import { Label, Select } from '@/components/ui/input'
import { AdminError, AdminPanel, AdminSection, Pill, formatDateTime } from '@/components/admin/ui'
import {
  CALCULATOR_REQUESTS_HREF,
  CALCULATOR_REQUEST_DETAIL_HREF,
  CALCULATOR_REQUEST_STATUSES,
  CALCULATOR_REQUEST_STATUS_LABEL,
  isCalculatorRequestStatus,
  type CalculatorRequestRow,
  type CalculatorRequestStatus,
} from '@/lib/admin/calculator-requests'
import { readCalculatorRequests } from '@/lib/admin/calculator-requests-server'
import { PARTNERS_HREF } from '@/lib/admin/partners'

/*
 * `/admin/kalkulator-anfragen` — der Prüf-Eingang der Kalkulator-Anfragen (B18-4).
 *
 * ── WARUM EIN GESCHWISTERPFAD ───────────────────────────────────────────────────────────────────
 * `components/admin/nav.tsx` markiert einen Punkt als aktiv, sobald der Pfad mit ihm BEGINNT. Läge
 * dieser Eingang unter dem Kalkulator-Punkt, wären zwei Punkte gleichzeitig markiert — genau der
 * Zustand, den der Kommentar dort ausschliesst. Der Pfad steht als Konstante in
 * `lib/admin/calculator-requests.ts`.
 *
 * ── ENTSCHIEDEN WIRD AUF DER DETAILSEITE, NICHT IN DER LISTE ────────────────────────────────────
 * Freigeben vergibt ein `calculator_pro`-Entitlement in derselben Transaktion, in der der Status
 * gesetzt wird — ein Vorgang mit Folgen und ohne Rückweg über die Oberfläche. Eine Sammelaktion
 * oder ein Häkchen je Tabellenzeile wäre dafür die falsche Bedienform; entschieden wird dort, wo
 * die Begründung vollständig steht. Dieselbe Regel und derselbe Grund wie bei den
 * Partner-Bewerbungen (B16-3).
 *
 * ── DER FILTER IST EIN ECHTES GET-FORMULAR ──────────────────────────────────────────────────────
 * Kein Client-Zustand, keine Server Action: der Filter IST die URL. Damit ist die Sicht teilbar,
 * funktioniert ohne JavaScript und kann nicht mit der Adresszeile auseinanderlaufen (Muster
 * `/admin/leads` B1-3, `/admin/partner-antraege` B16-3).
 *
 * ── ⚠ EIN UNBEKANNTER FILTERWERT WIRD HIER ABGEFANGEN, NICHT DURCHGEREICHT ──────────────────────
 * `admin_list_calculator_requests` weist ihn als `invalid_filter` ab — und `readCalculatorRequestList`
 * übersetzt das bewusst zu „nicht abrufbar" (`null`), weil ein abgewiesener Filter kein Bestand ist,
 * den man anzeigen dürfte. Die Oberfläche könnte den Fall danach nicht mehr benennen. Deshalb wird
 * ein unbekannter Wert schon hier erkannt: die Datenbank wird gar nicht gefragt, und die Meldung
 * sagt, was los ist. Was NICHT passiert: still auf „alle" zurückfallen — dann hielte man ein
 * ungefiltertes Ergebnis für ein gefiltertes.
 */

export const dynamic = 'force-dynamic'

/** Neutral wie im Layout: der Tab-Titel darf nicht verraten, dass es hier etwas zu holen gibt. */
export const metadata: Metadata = {
  title: 'COOLiN ENERGY',
  robots: { index: false, follow: false },
}

const PAGE_SIZE = 50

function pageHref(status: CalculatorRequestStatus | null, page: number): string {
  const sp = new URLSearchParams()
  if (status) sp.set('status', status)
  if (page > 1) sp.set('seite', String(page))
  const qs = sp.toString()
  return qs ? `${CALCULATOR_REQUESTS_HREF}?${qs}` : CALCULATOR_REQUESTS_HREF
}

/**
 * „Offen" trägt den Warnton: Es ist der einzige Zustand dieser Liste, der eine Handlung verlangt —
 * und hinter der Handlung steht ein Betrieb, der auf ein Werkzeug wartet. Abgelehnt ist neutral
 * (erledigt, kein Fehler).
 */
function statusTone(status: CalculatorRequestStatus): 'warning' | 'positive' | 'neutral' {
  if (status === 'pending') return 'warning'
  if (status === 'approved') return 'positive'
  return 'neutral'
}

export default async function AdminCalculatorRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!(await isCurrentUserAdmin())) return null

  const query = await searchParams
  const rawStatus = typeof query.status === 'string' ? query.status.trim() : ''
  const status = isCalculatorRequestStatus(rawStatus) ? rawStatus : null
  const unbekannterFilter = rawStatus !== '' && status === null
  const page = Math.max(1, Number(typeof query.seite === 'string' ? query.seite : '1') || 1)

  const list = unbekannterFilter
    ? null
    : await readCalculatorRequests({
        status,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })

  const pages = list ? Math.max(1, Math.ceil(list.total / PAGE_SIZE)) : 1

  return (
    <Container className="py-10 sm:py-14">
      <header className="border-b border-line pb-6">
        <h1 className="text-h2 text-ink">Kalkulator-Anfragen</h1>
        <p className="mt-2 max-w-prose text-body text-text-muted">
          Fachbetriebe, die aus ihrem Partner-Portal heraus Zugang zum Peak-Shaving-Kalkulator
          angefragt haben.
        </p>
        {/*
          Wo entschieden wird und was dabei passiert, steht im Klartext — sonst sucht man die
          Knöpfe in der Liste, und die Tragweite der Freigabe stünde nirgends.
        */}
        <p className="mt-3 max-w-prose text-small text-text-muted">
          Entschieden wird auf der Detailseite einer Anfrage. Beim Freigeben entsteht in derselben
          Transaktion der <span className="text-text">Kalkulator-Zugang</span> für das Konto des
          Betriebs, und er bekommt eine E-Mail darüber. Aus einer Ablehnung geht bewusst{' '}
          <span className="text-text">keine</span> Nachricht raus.
        </p>
      </header>

      <AdminSection
        id="anfragen-filter"
        title="Anfragen"
        description="Neueste zuerst. Die Begründung steht schon hier — sie ist der Grund, eine Anfrage zu öffnen."
      >
        <AdminPanel>
          {/* Echtes GET-Formular: der Filter IST die URL (s. Kopf). */}
          <form
            method="get"
            action={CALCULATOR_REQUESTS_HREF}
            className="flex flex-wrap items-end gap-4"
          >
            <div>
              <Label htmlFor="status">Status</Label>
              <div className="mt-1.5">
                <Select id="status" name="status" defaultValue={status ?? ''}>
                  <option value="">Alle</option>
                  {CALCULATOR_REQUEST_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {CALCULATOR_REQUEST_STATUS_LABEL[value]}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <Button type="submit" variant="secondary" size="md">
              Filtern
            </Button>
            {status && (
              <Link
                href={CALCULATOR_REQUESTS_HREF}
                className="text-small text-accent underline decoration-accent underline-offset-[3px]"
              >
                Filter zurücksetzen
              </Link>
            )}
          </form>
        </AdminPanel>

        {unbekannterFilter ? (
          <AdminError>
            Der Statusfilter „{rawStatus}" ist unbekannt. Die Liste zeigt deshalb NICHTS — ein
            ungefiltertes Ergebnis wäre hier als gefiltertes zu lesen.{' '}
            <Link
              href={CALCULATOR_REQUESTS_HREF}
              className="text-accent underline decoration-accent underline-offset-[3px]"
            >
              Filter zurücksetzen
            </Link>
            .
          </AdminError>
        ) : list === null ? (
          <AdminError>
            Die Anfragen konnten nicht geladen werden. Das ist NICHT dasselbe wie „es liegt nichts
            an" — bitte die Seite neu laden.
          </AdminError>
        ) : list.requests.length === 0 ? (
          <AdminPanel>
            <p className="text-small text-text-muted">
              {status
                ? `Keine Anfragen mit dem Status „${CALCULATOR_REQUEST_STATUS_LABEL[status]}".`
                : 'Bisher hat kein Fachbetrieb den Kalkulator angefragt.'}
            </p>
          </AdminPanel>
        ) : (
          <>
            <p className="mb-4 text-small text-text-muted">
              {list.total} {list.total === 1 ? 'Anfrage' : 'Anfragen'}
              {status ? ` mit dem Status „${CALCULATOR_REQUEST_STATUS_LABEL[status]}"` : ''}
            </p>
            <ul className="flex flex-col gap-4">
              {list.requests.map((request) => (
                <li key={request.id}>
                  <RequestCard request={request} />
                </li>
              ))}
            </ul>

            {pages > 1 && (
              <nav aria-label="Seiten" className="mt-6 flex items-center gap-4">
                {page > 1 && (
                  <Link
                    href={pageHref(status, page - 1)}
                    className="text-small text-accent underline decoration-accent underline-offset-[3px]"
                  >
                    Zurück
                  </Link>
                )}
                <span className="text-small tabular-nums text-text-muted">
                  Seite {page} von {pages}
                </span>
                {page < pages && (
                  <Link
                    href={pageHref(status, page + 1)}
                    className="text-small text-accent underline decoration-accent underline-offset-[3px]"
                  >
                    Weiter
                  </Link>
                )}
              </nav>
            )}
          </>
        )}
      </AdminSection>
    </Container>
  )
}

function RequestCard({ request }: { request: CalculatorRequestRow }) {
  /*
   * Der ANZEIGENAME ist die Identität, der Kurz-Key die Adresse — ein Kurz-Key ist kein Name
   * (dieselbe Entscheidung wie in der Lead-Liste, B18-5). Fehlt der Name, bleibt der Slug stehen:
   * er benennt die Zuordnung, die nachweislich besteht.
   */
  const name = request.partnerDisplayName ?? request.partnerSlug

  return (
    <AdminPanel>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-h4 text-ink">
            <Link
              href={CALCULATOR_REQUEST_DETAIL_HREF(request.id)}
              className="underline decoration-line-strong underline-offset-4 hover:decoration-accent"
            >
              {name}
            </Link>
          </h3>
          <p className="mt-1 text-caption text-text-muted">
            {request.partnerSlug}
            {request.accountEmail ? <> · {request.accountEmail}</> : null} · eingegangen{' '}
            {formatDateTime(request.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/*
            Beide Kennzeichen beantworten Fragen, die beim Freigeben als Erste kommen: Gibt es ein
            Konto zum Freischalten (`no_account` weist die Datenbank sonst ab), und ist der Betrieb
            überhaupt noch aktiv (stillgelegte bleiben entscheidbar — die Stilllegung betrifft die
            Empfehlungslinks, nicht das Werkzeug).
          */}
          {!request.accountEmail && <Pill tone="warning">ohne Konto</Pill>}
          {!request.partnerIsActive && <Pill tone="neutral">stillgelegt</Pill>}
          <Pill tone={statusTone(request.status)}>
            {CALCULATOR_REQUEST_STATUS_LABEL[request.status]}
          </Pill>
        </div>
      </div>

      {/*
        Gekürzt in der DARSTELLUNG, nicht im Datenpfad: die Detailseite zeigt denselben Text
        vollständig, und die Liste soll überflogen werden können.
      */}
      <p className="mt-4 line-clamp-3 whitespace-pre-wrap text-small text-text">
        {request.message}
      </p>

      <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-small">
        <Link
          href={CALCULATOR_REQUEST_DETAIL_HREF(request.id)}
          className="text-accent underline decoration-accent underline-offset-[3px]"
        >
          Anfrage ansehen
        </Link>
        <Link
          href={PARTNERS_HREF}
          className="text-text-muted underline decoration-line-strong underline-offset-[3px] hover:text-ink"
        >
          Fachbetriebe
        </Link>
      </p>
    </AdminPanel>
  )
}
