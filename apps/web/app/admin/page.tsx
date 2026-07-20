import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container, Num } from '@/components/ui/layout'
import { revokeRoleAction, setCodeActiveAction } from '@/lib/admin/actions'
import { PRODUCT_LABELS, type ProductKey } from '@/lib/admin/config'
import {
  readList,
  readTruncation,
  type AdminRow,
  type CodeRow,
  type CustomerRow,
  type ScrapeTargetRow,
} from '@/lib/admin/types'
import { ActionButton } from '@/components/admin/action-button'
import { CodeForm, GrantRoleForm } from '@/components/admin/forms'
import { ScrapeTargetsPanel } from '@/components/admin/scrape-targets-panel'
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
 * Der Admin-Bereich (T4-4 + Nacharbeit) — VIER Verwaltungsflächen auf EINER Seite.
 *
 * WARUM EINE SEITE STATT VIER UNTERROUTEN: Die Codebase hat kein Muster für interne Unternavigation
 * (der Styleguide, das einzige Vergleichsstück, ist ebenfalls eine Seite). Vier Routen hießen eine
 * Navigationsleiste zu erfinden, für vier kurze Tabellen. Eine Seite lädt alle Listen in EINEM
 * Durchgang parallel, und jede Änderung rendert über `revalidatePath('/admin')` genau diese eine
 * Seite neu — kein Zustand, der zwischen Routen auseinanderlaufen kann.
 *
 * ── ROLLEN UND KUNDEN SIND ZWEI ABSCHNITTE, NICHT EINER ──────────────────────────────────────────
 * Bis zur Nacharbeit gab es EINE Tabelle „Nutzer & Rollen", gespeist aus `admin_list_users()`: jedes
 * registrierte Konto, mit Rollen- UND Zugangs-Spalten. Sie beantwortete damit zwei Fragen auf
 * einmal — „wer darf verwalten?" und „wer hat bezahlt?" — und beide schlecht: die zwei Rollenträger
 * verschwanden zwischen allen übrigen Konten, und wer einen Zugang prüfen wollte, las Rollen-Spalten
 * mit, die ihn nichts angingen. Jetzt hat jede Frage ihre eigene, kurze Liste (`admin_list_admins`
 * bzw. `admin_list_customers`). Ein Konto darf in beiden stehen; das ist kein Widerspruch, sondern
 * zwei zutreffende Aussagen über dieselbe Person.
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

function productLabel(key: string): string {
  return PRODUCT_LABELS[key as ProductKey] ?? key
}

export default async function AdminPage() {
  // Kein Zugang → gar keinen Inhalt erzeugen. Was der Nutzer stattdessen SIEHT, entscheidet das
  // Layout (neutrale Seite); hier geht es darum, dass nichts entsteht, das mitgeschickt werden kann.
  if (!(await isCurrentUserAdmin())) return null

  const supabase = await createClient()

  const [targetsRes, adminsRes, customersRes, codesRes] = await Promise.all([
    supabase.rpc('admin_list_scrape_targets'),
    supabase.rpc('admin_list_admins'),
    supabase.rpc('admin_list_customers'),
    supabase.rpc('admin_list_codes'),
  ])
  if (targetsRes.error) console.error('[admin] admin_list_scrape_targets:', targetsRes.error)
  if (adminsRes.error) console.error('[admin] admin_list_admins:', adminsRes.error)
  if (customersRes.error) console.error('[admin] admin_list_customers:', customersRes.error)
  if (codesRes.error) console.error('[admin] admin_list_codes:', codesRes.error)

  const targets = readList<ScrapeTargetRow>(targetsRes.data, 'targets')
  const admins = readList<AdminRow>(adminsRes.data, 'admins')
  const customers = readList<CustomerRow>(customersRes.data, 'customers')
  const codes = readList<CodeRow>(codesRes.data, 'codes')
  const { total: customerTotal, truncated: customersTruncated } = readTruncation(customersRes.data)

  /*
   * Wie viele Admins gibt es insgesamt? Nur zur ERKLÄRUNG in der Oberfläche — der Lockout-Schutz
   * selbst sitzt in der Datenbank (unter Zeilensperre), nicht in dieser Zahl. Sie kann zwischen
   * Rendern und Klick veralten; die Ablehnung kommt dann sauber vom Wrapper.
   */
  const adminCount = admins?.filter((u) => u.roles.includes('admin')).length ?? 0

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
        {/*
         * Tabelle UND Bearbeiten-Formular liegen zusammen in einer Client-Komponente: welche Zeile
         * gerade bearbeitet wird, ist Zustand, und das Formular muss mit ALLEN Werten dieser Zeile
         * vorbelegt werden. Warum das nötig war (der Upsert schreibt auch leere Felder mit):
         * `components/admin/scrape-targets-panel.tsx`.
         */}
        {targets === null ? (
          <LoadError what="Die Scraper-Ziele" />
        ) : (
          <ScrapeTargetsPanel targets={targets} />
        )}
      </AdminSection>

      {/* ── Rollen ────────────────────────────────────────────────────────────────────────────── */}
      <AdminSection
        id="rollen"
        title="Rollen"
        description="Wer diesen Verwaltungsbereich benutzen darf. Die Liste zeigt ausschließlich Konten, die bereits eine Rolle haben — ein neues wird über seine E-Mail-Adresse aufgenommen."
      >
        {admins === null ? (
          <LoadError what="Die Rollenliste" />
        ) : (
          <AdminPanel className="p-0 sm:p-0">
            <div className="px-4 py-2 sm:px-6">
              <AdminTable>
                <thead>
                  <tr>
                    <Th>Konto</Th>
                    <Th>Rollen</Th>
                    <Th>Registriert</Th>
                    <Th>
                      <span className="sr-only">Aktion</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {admins.length === 0 && (
                    <EmptyRow colSpan={4}>
                      Noch niemand mit einer Rolle. Das kann eigentlich nicht sein — wer diese Seite
                      sieht, hat eine.
                    </EmptyRow>
                  )}
                  {admins.map((u) => {
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
                        <Td>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {u.roles.map((role) => (
                              <Pill key={role} tone="warning">
                                {role === 'admin' ? 'Administrator' : role}
                              </Pill>
                            ))}
                          </div>
                        </Td>
                        <Td className="whitespace-nowrap">
                          <Num>{formatDateTime(u.created_at)}</Num>
                        </Td>
                        <Td>
                          {isAdmin && (
                            <ActionButton
                              action={revokeRoleAction}
                              fields={{ userId: u.user_id, role: 'admin' }}
                              label="Admin entziehen"
                              pendingLabel="…"
                              confirm={`Administrator-Rolle von ${u.email ?? 'diesem Konto'} entziehen?`}
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
          </AdminPanel>
        )}

        <AdminPanel className="mt-4">
          <h3 className="text-h4 text-ink">Administrator-Rolle vergeben</h3>
          <p className="mt-1 max-w-prose text-small text-text-muted">
            Über die E-Mail-Adresse eines bereits registrierten Kontos. Es taucht danach in der
            Liste oben auf.
          </p>
          <div className="mt-4">
            <GrantRoleForm />
          </div>
        </AdminPanel>
      </AdminSection>

      {/* ── Kunden ────────────────────────────────────────────────────────────────────────────── */}
      <AdminSection
        id="kunden"
        title="Kunden"
        description="Konten mit einem Produktzugang — aktiv oder abgelaufen. Die Herkunft steht dabei: „Stripe“ folgt dem Abo automatisch, „manuell“ (z. B. per Gutscheincode) tut das nicht mehr."
      >
        {customers === null ? (
          <LoadError what="Die Kundenliste" />
        ) : (
          <AdminPanel className="p-0 sm:p-0">
            <div className="px-4 py-2 sm:px-6">
              <AdminTable>
                <thead>
                  <tr>
                    <Th>Konto</Th>
                    <Th>Zugänge</Th>
                    <Th>Registriert</Th>
                  </tr>
                </thead>
                <tbody>
                  {customers.length === 0 && (
                    <EmptyRow colSpan={3}>Noch keine Konten mit einem Produktzugang.</EmptyRow>
                  )}
                  {customers.map((u) => (
                    <tr key={u.user_id}>
                      <Td>
                        <span className="font-medium text-ink">{u.email ?? '—'}</span>
                        {u.display_name && (
                          <span className="block text-caption text-text-muted">
                            {u.display_name}
                          </span>
                        )}
                      </Td>
                      <Td>
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
                      </Td>
                      <Td className="whitespace-nowrap">
                        <Num>{formatDateTime(u.created_at)}</Num>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </AdminTable>
            </div>
            {customersTruncated && (
              <p className="border-t border-line px-4 py-3 text-caption text-text-muted sm:px-6">
                Es werden die neuesten 500 von <Num>{customerTotal}</Num> Konten gezeigt.
              </p>
            )}
            {/*
              * Bewusst OHNE Aktionen: Zugang entsteht über Stripe oder einen Gutscheincode, beides
              * mit eigener Spur. Ein Knopf „Zugang geben" hier wäre ein dritter Weg, der in keinem
              * Ledger auftaucht — und der einzige, den später niemand mehr erklären könnte.
              */}
            <p className="border-t border-line px-4 py-3 text-caption text-text-muted sm:px-6">
              Nur zur Ansicht. Zugänge entstehen über ein Stripe-Abo oder einen Gutscheincode.
            </p>
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
