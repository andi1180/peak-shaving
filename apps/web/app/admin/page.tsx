import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container, Num } from '@/components/ui/layout'
import {
  grantRoleAction,
  revokeRoleAction,
  setCodeActiveAction,
  setScrapeTargetActiveAction,
} from '@/lib/admin/actions'
import { PRODUCT_LABELS, type ProductKey } from '@/lib/admin/config'
import {
  readList,
  readTruncation,
  type CodeRow,
  type ScrapeTargetRow,
  type UserRow,
} from '@/lib/admin/types'
import { ActionButton } from '@/components/admin/action-button'
import { CodeForm, ScrapeTargetForm } from '@/components/admin/forms'
import {
  AdminError,
  AdminPanel,
  AdminSection,
  AdminTable,
  EmptyRow,
  Pill,
  Td,
  Th,
  formatDateTime,
} from '@/components/admin/ui'

/*
 * Der Admin-Bereich (T4-4) — drei Verwaltungsflächen auf EINER Seite.
 *
 * WARUM EINE SEITE STATT DREI UNTERROUTEN: Die Codebase hat kein Muster für interne Unternavigation
 * (der Styleguide, das einzige Vergleichsstück, ist ebenfalls eine Seite). Drei Routen hießen eine
 * Navigationsleiste zu erfinden, für drei kurze Tabellen. Eine Seite lädt alle drei Listen in EINEM
 * Durchgang parallel, und jede Änderung rendert über `revalidatePath('/admin')` genau diese eine
 * Seite neu — kein Zustand, der zwischen Routen auseinanderlaufen kann.
 *
 * Die Zugangsprüfung läuft über dieselbe Funktion wie im Layout (`isCurrentUserAdmin`, dort per
 * `cache()` auf einen Aufruf je Anfrage zusammengefasst). Sie ist hier NICHT redundant: dass das
 * Layout `children` nicht rendert, verhindert nicht, dass diese Seite gerendert und ins
 * RSC-Flight-Payload geschrieben wird — der Aufbau des Bereichs stünde sonst im Quelltext der
 * „Kein Zugriff"-Antwort. Ausführliche Begründung samt Messung: `lib/admin/guard.ts`.
 */

export const dynamic = 'force-dynamic'

/** „Fehlt" heißt hier: der Wrapper hat nicht `ok` gemeldet — nicht „es gibt nichts". */
function LoadError({ what }: { what: string }) {
  return <AdminError>{what} konnten nicht geladen werden. Bitte laden Sie die Seite neu.</AdminError>
}

function ScrapeStatusPill({ row }: { row: ScrapeTargetRow }) {
  if (row.last_scrape_status === 'ok') return <Pill tone="positive">ok</Pill>
  if (row.last_scrape_status === 'failed') return <Pill tone="negative">fehlgeschlagen</Pill>
  // NULL = noch nie versucht. Kein erfundener Zustand.
  return <Pill>noch kein Lauf</Pill>
}

function productLabel(key: string): string {
  return PRODUCT_LABELS[key as ProductKey] ?? key
}

export default async function AdminPage() {
  // Kein Zugang → gar keinen Inhalt erzeugen. Was der Nutzer stattdessen SIEHT, entscheidet das
  // Layout (neutrale Seite); hier geht es darum, dass nichts entsteht, das mitgeschickt werden kann.
  if (!(await isCurrentUserAdmin())) return null

  const supabase = await createClient()

  const [targetsRes, usersRes, codesRes] = await Promise.all([
    supabase.rpc('admin_list_scrape_targets'),
    supabase.rpc('admin_list_users'),
    supabase.rpc('admin_list_codes'),
  ])
  if (targetsRes.error) console.error('[admin] admin_list_scrape_targets:', targetsRes.error)
  if (usersRes.error) console.error('[admin] admin_list_users:', usersRes.error)
  if (codesRes.error) console.error('[admin] admin_list_codes:', codesRes.error)

  const targets = readList<ScrapeTargetRow>(targetsRes.data, 'targets')
  const users = readList<UserRow>(usersRes.data, 'users')
  const codes = readList<CodeRow>(codesRes.data, 'codes')
  const { total: userTotal, truncated } = readTruncation(usersRes.data)

  /*
   * Wie viele Admins gibt es insgesamt? Nur zur ERKLÄRUNG in der Oberfläche — der Lockout-Schutz
   * selbst sitzt in der Datenbank (unter Zeilensperre), nicht in dieser Zahl. Sie kann zwischen
   * Rendern und Klick veralten; die Ablehnung kommt dann sauber vom Wrapper.
   */
  const adminCount = users?.filter((u) => u.roles.includes('admin')).length ?? 0

  return (
    <Container className="py-10 sm:py-14">
      <header className="border-b border-line pb-6">
        <h1 className="text-h2 text-ink">Verwaltung</h1>
        <p className="mt-2 max-w-prose text-body text-text-muted">
          Interner Bereich. Änderungen wirken sofort.
        </p>
      </header>

      {/* ── Scraper-Ziele ─────────────────────────────────────────────────────────────────────── */}
      <AdminSection
        id="ziele"
        title="Scraper-Ziele"
        description="Die kuratierte Anbieterliste, die der Tarif-Scraper abfragt. Deaktivierte Ziele behalten ihre Konfiguration und ihren Verlauf."
      >
        {targets === null ? (
          <LoadError what="Die Scraper-Ziele" />
        ) : (
          <AdminPanel className="p-0 sm:p-0">
            <div className="px-4 py-2 sm:px-6">
              <AdminTable>
                <thead>
                  <tr>
                    <Th>Anbieter</Th>
                    <Th>Tarifseite</Th>
                    <Th className="text-right">Reihenfolge</Th>
                    <Th>Letzter Lauf</Th>
                    <Th>Status</Th>
                    <Th>
                      <span className="sr-only">Aktion</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {targets.length === 0 && (
                    <EmptyRow colSpan={6}>
                      Noch keine Ziele angelegt. Das Formular unten legt das erste an.
                    </EmptyRow>
                  )}
                  {targets.map((t) => (
                    <tr key={t.id}>
                      <Td>
                        <span className="font-medium text-ink">{t.provider_name}</span>
                        <span className="block text-caption text-text-muted">{t.provider_slug}</span>
                        {t.network_area && (
                          <span className="block text-caption text-text-muted">{t.network_area}</span>
                        )}
                      </Td>
                      <Td className="max-w-xs break-all text-caption">{t.tariff_page_url}</Td>
                      <Td className="text-right">
                        <Num>{t.sort_priority}</Num>
                      </Td>
                      <Td className="whitespace-nowrap">
                        <Num>{formatDateTime(t.last_scrape_at)}</Num>
                        {t.last_scrape_error && (
                          <span className="mt-0.5 block max-w-xs text-caption text-negative">
                            {t.last_scrape_error}
                          </span>
                        )}
                      </Td>
                      <Td>
                        <div className="flex flex-col items-start gap-1">
                          <ScrapeStatusPill row={t} />
                          {!t.is_active && <Pill tone="warning">inaktiv</Pill>}
                          {t.extraction_config == null && <Pill>keine Regel</Pill>}
                        </div>
                      </Td>
                      <Td>
                        <ActionButton
                          action={setScrapeTargetActiveAction}
                          fields={{ id: t.id, isActive: t.is_active ? 'false' : 'true' }}
                          label={t.is_active ? 'Deaktivieren' : 'Aktivieren'}
                          pendingLabel="…"
                        />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </AdminTable>
            </div>
          </AdminPanel>
        )}

        <AdminPanel className="mt-4">
          <h3 className="text-h4 text-ink">Ziel anlegen oder bearbeiten</h3>
          <p className="mt-1 text-small text-text-muted">
            Ein bereits vergebener Kurz-Key bearbeitet das bestehende Ziel, statt ein zweites anzulegen.
          </p>
          <div className="mt-4">
            <ScrapeTargetForm />
          </div>
        </AdminPanel>
      </AdminSection>

      {/* ── Nutzer & Rollen ───────────────────────────────────────────────────────────────────── */}
      <AdminSection
        id="nutzer"
        title="Nutzer & Rollen"
        description="Die Herkunft eines Zugangs steht dabei: „Stripe“ folgt dem Abo automatisch, „manuell“ (z. B. per Gutscheincode) tut das nicht mehr."
      >
        {users === null ? (
          <LoadError what="Die Nutzerliste" />
        ) : (
          <AdminPanel className="p-0 sm:p-0">
            <div className="px-4 py-2 sm:px-6">
              <AdminTable>
                <thead>
                  <tr>
                    <Th>Konto</Th>
                    <Th>Registriert</Th>
                    <Th>Zugänge</Th>
                    <Th>Rollen</Th>
                    <Th>
                      <span className="sr-only">Aktion</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 && <EmptyRow colSpan={5}>Noch keine Konten.</EmptyRow>}
                  {users.map((u) => {
                    const isAdmin = u.roles.includes('admin')
                    // Nur zur Erklärung im Text — die Regel selbst erzwingt die Datenbank.
                    const wouldBeLastAdmin = isAdmin && adminCount <= 1
                    return (
                      <tr key={u.user_id}>
                        <Td>
                          <span className="font-medium text-ink">{u.email ?? '—'}</span>
                          {u.display_name && (
                            <span className="block text-caption text-text-muted">
                              {u.display_name}
                            </span>
                          )}
                        </Td>
                        <Td className="whitespace-nowrap">
                          <Num>{formatDateTime(u.created_at)}</Num>
                        </Td>
                        <Td>
                          {u.entitlements.length === 0 ? (
                            <span className="text-text-muted">—</span>
                          ) : (
                            <ul className="flex flex-col gap-1">
                              {u.entitlements.map((e) => (
                                <li key={e.product} className="flex flex-wrap items-center gap-1.5">
                                  <span>{productLabel(e.product)}</span>
                                  <Pill tone={e.currently_active ? 'positive' : 'neutral'}>
                                    {e.currently_active ? 'aktiv' : 'inaktiv'}
                                  </Pill>
                                  <Pill tone={e.source === 'manual' ? 'warning' : 'neutral'}>
                                    {e.source === 'manual' ? 'manuell' : 'Stripe'}
                                  </Pill>
                                  {e.valid_until && (
                                    <span className="text-caption text-text-muted">
                                      bis <Num>{formatDateTime(e.valid_until)}</Num>
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </Td>
                        <Td>
                          {isAdmin ? (
                            <Pill tone="warning">Administrator</Pill>
                          ) : (
                            <span className="text-text-muted">—</span>
                          )}
                        </Td>
                        <Td>
                          {isAdmin ? (
                            <ActionButton
                              action={revokeRoleAction}
                              fields={{ userId: u.user_id, role: 'admin' }}
                              label="Admin entziehen"
                              pendingLabel="…"
                              confirm={`Administrator-Rolle von ${u.email ?? 'diesem Konto'} entziehen?`}
                            />
                          ) : (
                            <ActionButton
                              action={grantRoleAction}
                              fields={{ userId: u.user_id, role: 'admin' }}
                              label="Admin geben"
                              pendingLabel="…"
                            />
                          )}
                          {wouldBeLastAdmin && (
                            <p className="mt-1.5 max-w-xs text-caption text-text-muted">
                              Letzte Administrator-Rolle — der Entzug wird abgelehnt.
                            </p>
                          )}
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </AdminTable>
            </div>
            {truncated && (
              <p className="border-t border-line px-4 py-3 text-caption text-text-muted sm:px-6">
                Es werden die neuesten 500 von <Num>{userTotal}</Num> Konten gezeigt.
              </p>
            )}
          </AdminPanel>
        )}
      </AdminSection>

      {/* ── Gutscheincodes ────────────────────────────────────────────────────────────────────── */}
      <AdminSection
        id="codes"
        title="Gutscheincodes"
        description="Ein eingelöster Code schaltet den Zugang unbefristet frei. Codes werden nie gelöscht, nur deaktiviert — die Einlösungshistorie bleibt erhalten."
      >
        {codes === null ? (
          <LoadError what="Die Gutscheincodes" />
        ) : (
          <AdminPanel className="p-0 sm:p-0">
            <div className="px-4 py-2 sm:px-6">
              <AdminTable>
                <thead>
                  <tr>
                    <Th>Code</Th>
                    <Th>Produkt</Th>
                    <Th className="text-right">Eingelöst</Th>
                    <Th>Gültig bis</Th>
                    <Th>Status</Th>
                    <Th>
                      <span className="sr-only">Aktion</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {codes.length === 0 && <EmptyRow colSpan={6}>Noch keine Codes angelegt.</EmptyRow>}
                  {codes.map((c) => {
                    const exhausted =
                      c.max_redemptions !== null && c.redemption_count >= c.max_redemptions
                    const expired = c.expires_at !== null && new Date(c.expires_at) <= new Date()
                    return (
                      <tr key={c.id}>
                        <Td>
                          <span className="font-medium text-ink">{c.code}</span>
                          {c.note && (
                            <span className="block text-caption text-text-muted">{c.note}</span>
                          )}
                        </Td>
                        <Td>{productLabel(c.product_key)}</Td>
                        <Td className="whitespace-nowrap text-right">
                          <Num>
                            {c.redemption_count}
                            {c.max_redemptions === null ? ' / ∞' : ` / ${c.max_redemptions}`}
                          </Num>
                        </Td>
                        <Td className="whitespace-nowrap">
                          <Num>{c.expires_at ? formatDateTime(c.expires_at) : 'unbefristet'}</Num>
                        </Td>
                        <Td>
                          <div className="flex flex-col items-start gap-1">
                            {c.is_active ? (
                              <Pill tone="positive">aktiv</Pill>
                            ) : (
                              <Pill tone="neutral">deaktiviert</Pill>
                            )}
                            {c.is_active && expired && <Pill tone="warning">abgelaufen</Pill>}
                            {c.is_active && exhausted && <Pill tone="warning">ausgeschöpft</Pill>}
                          </div>
                        </Td>
                        <Td>
                          <ActionButton
                            action={setCodeActiveAction}
                            fields={{ id: c.id, isActive: c.is_active ? 'false' : 'true' }}
                            label={c.is_active ? 'Deaktivieren' : 'Aktivieren'}
                            pendingLabel="…"
                          />
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </AdminTable>
            </div>
          </AdminPanel>
        )}

        <AdminPanel className="mt-4">
          <h3 className="text-h4 text-ink">Code anlegen</h3>
          <div className="mt-4">
            <CodeForm />
          </div>
        </AdminPanel>
      </AdminSection>
    </Container>
  )
}
