import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container, Num } from '@/components/ui/layout'
import { AdminError, AdminPanel, AdminSection, Pill, formatDate } from '@/components/admin/ui'
import { CreateGridTariffForm } from '@/components/admin/grid-tariff-form'
import {
  combinationKey,
  combinationLabel,
  grundpreisUnitLabel,
  isOpen,
  operatorOptions,
  priceBasisLabel,
  seasonLabel,
  shortTime,
  type GridTariffRateWindowRow,
  type GridTariffRow,
} from '@/lib/admin/grid-tariffs'

/*
 * `/admin/netzbetreiber-tarife` — die Pflege der Netzbetreiber-Tarifzeilen (B21-2b, Delta 5/10).
 *
 * ── EINE FÄHIGKEIT: ANLEGEN ─────────────────────────────────────────────────────────────────────
 * Auflisten und neu anlegen, mehr nicht. Es gibt kein Bearbeiten und kein Löschen — weder hier noch
 * in der Datenbank (kein `delete`-Grant für irgendeine Rolle, keine Update-Funktion). Ein
 * Tarifstand ist eine Aussage über einen Zeitraum; eine 2026 archivierte Analyse (B14) muss 2028
 * noch sagen können, welcher Stand ihr zugrunde lag. Ein neues Preisblatt ist deshalb ein NEUER
 * Stand, und die bisher offene Zeile schliesst die Datenbank in derselben Transaktion.
 *
 * Eine rückwirkende Korrektur eines bereits gerechneten Zeitraums bleibt bewusst ein seltener
 * Eingriff von Hand — kein Knopf: sie ändert nachträglich, was einem Kunden gegenüber schon
 * gerechnet wurde.
 *
 * ── GELESEN WIRD ÜBER DEN ANGEMELDETEN CLIENT, GESCHRIEBEN ÜBER service_role ────────────────────
 * `authenticated` hat auf beiden Tabellen seit B21-1 `select` (es sind veröffentlichte
 * Preisblattdaten ohne Personenbezug) — die Liste braucht also keinen erhöhten Zugriff. Der
 * Schreibweg liegt in `lib/admin/grid-tariffs-actions.ts` und ist dort begründet. Dieselbe Trennung
 * wie im Lead-Erfassungspfad.
 *
 * ── KEINE STROMANBIETER-TARIFE ──────────────────────────────────────────────────────────────────
 * Delta 5 nennt beide Seiten gemeinsam; für diesen Bauabschnitt ist ausdrücklich entschieden, nur
 * die Netzbetreiber-Seite zu bauen. Es gibt dafür weder Tabelle noch Wrapper.
 */

export const dynamic = 'force-dynamic'

/** Neutral wie im Layout: der Tab-Titel darf nicht verraten, dass es hier etwas zu holen gibt. */
export const metadata: Metadata = {
  title: 'COOLiN ENERGY',
  robots: { index: false, follow: false },
}

export default async function AdminGridTariffsPage() {
  if (!(await isCurrentUserAdmin())) return null

  const supabase = await createClient()

  /*
   * Zwei Abfragen statt eines eingebetteten Selects: PostgREST kann die Kind-Zeilen zwar mitliefern,
   * aber die Zuordnung ist hier trivial und die Zahl der Zeilen klein (ein Preisblatt je Betreiber
   * und Jahr). Zwei flache Listen bleiben lesbar und brauchen keine Beziehungs-Definition, die bei
   * einer Schemaänderung still bricht.
   */
  const [tariffRes, windowRes] = await Promise.all([
    supabase
      .from('grid_tariffs')
      .select('*')
      .order('operator_name', { ascending: true })
      .order('netzebene', { ascending: true })
      .order('valid_from', { ascending: false }),
    supabase.from('grid_tariff_rate_windows').select('*').order('label', { ascending: true }),
  ])

  if (tariffRes.error) console.error('[admin/grid-tariffs] grid_tariffs:', tariffRes.error)
  if (windowRes.error) console.error('[admin/grid-tariffs] rate_windows:', windowRes.error)

  const failed = Boolean(tariffRes.error || windowRes.error)
  const tariffs = (tariffRes.data ?? []) as GridTariffRow[]
  const windows = (windowRes.data ?? []) as GridTariffRateWindowRow[]

  const windowsByTariff = new Map<string, GridTariffRateWindowRow[]>()
  for (const w of windows) {
    const list = windowsByTariff.get(w.grid_tariff_id)
    if (list) list.push(w)
    else windowsByTariff.set(w.grid_tariff_id, [w])
  }

  /*
   * Gruppiert wird über GENAU die drei Spalten, über die auch die Datenbank datiert — sonst zeigte
   * die Seite eine andere Zusammengehörigkeit an, als die Effektiv-Datierung tatsächlich benutzt.
   * Die Reihenfolge innerhalb einer Gruppe kommt aus der Abfrage: jüngster Stand zuerst.
   */
  const groups = new Map<string, GridTariffRow[]>()
  for (const row of tariffs) {
    const key = combinationKey(row)
    const list = groups.get(key)
    if (list) list.push(row)
    else groups.set(key, [row])
  }

  return (
    <Container className="py-10 sm:py-14">
      <header className="border-b border-line pb-6">
        <h1 className="text-h2 text-ink">Netzbetreiber-Tarife</h1>
        <p className="mt-2 max-w-prose text-body text-text-muted">
          Die veröffentlichten Preisblätter der Netzbetreiber, effektiv datiert. Zeilen werden nie
          überschrieben: Ein neues Preisblatt ist ein neuer Stand, und der bisher gültige wird dabei
          automatisch am Vortag beendet. Existiert für einen Zeitraum keine Zeile, gibt es für ihn
          keine Berechnungsgrundlage — genau die Verweigerung, die der Kalkulator zeigen soll.
        </p>
      </header>

      <AdminSection
        id="tarif-neu"
        title="Neuen Tarifstand anlegen"
        description="Tarifzeile und Zeitfenster entstehen zusammen in einem Vorgang. Bricht etwas ab, entsteht gar nichts — es bleibt keine Tarifzeile ohne Arbeitspreis zurück."
      >
        <AdminPanel>
          {failed ? (
            <AdminError>
              Die bestehenden Tarifzeilen konnten nicht geladen werden. Das Formular bleibt deshalb
              geschlossen — ohne die vorhandenen Stände liesse sich nicht erkennen, ob ein neuer
              einen bestehenden ablöst.
            </AdminError>
          ) : (
            <CreateGridTariffForm operators={operatorOptions(tariffs)} />
          )}
        </AdminPanel>
      </AdminSection>

      <AdminSection
        id="tarif-liste"
        title="Alle Tarifzeilen"
        description="Je Kombination aus Netzbetreiber, Netzebene und Messvariante steht der aktuelle Stand oben, darunter die abgelösten."
      >
        {failed ? (
          <AdminError>
            Die Tarifzeilen konnten nicht geladen werden. Das ist NICHT dasselbe wie „es gibt keine"
            — bitte die Seite neu laden.
          </AdminError>
        ) : groups.size === 0 ? (
          <AdminPanel>
            <p className="text-small text-text-muted">
              Noch kein Tarifstand hinterlegt. Der erste entsteht über das Formular oben. Solange
              hier nichts steht, rechnet der Kalkulator für diese Netzebenen bewusst nicht.
            </p>
          </AdminPanel>
        ) : (
          <ul className="flex flex-col gap-6">
            {[...groups.entries()].map(([key, rows]) => (
              <li key={key}>
                <AdminPanel>
                  <h3 className="text-h4 text-ink">{combinationLabel(rows[0]!)}</h3>
                  <p className="mt-1 text-caption text-text-muted">
                    Kennung <span className="font-medium text-text">{rows[0]!.operator_id}</span> ·{' '}
                    <Num>{rows.length}</Num> {rows.length === 1 ? 'Stand' : 'Stände'}
                  </p>

                  <ul className="mt-4 flex flex-col gap-4">
                    {rows.map((row) => {
                      const open = isOpen(row)
                      return (
                        <li
                          key={row.id}
                          className={
                            open
                              ? 'rounded-md border border-accent-border bg-accent-subtle p-4'
                              : 'rounded-md border border-line p-4'
                          }
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <p className="text-small text-text">
                              gültig ab{' '}
                              <span className="font-medium text-ink">
                                <Num>{formatDate(row.valid_from)}</Num>
                              </span>
                              {row.valid_until && (
                                <>
                                  {' '}
                                  bis{' '}
                                  <span className="font-medium text-ink">
                                    <Num>{formatDate(row.valid_until)}</Num>
                                  </span>
                                </>
                              )}
                            </p>
                            {open ? (
                              <Pill tone="positive">aktuell</Pill>
                            ) : (
                              <Pill tone="neutral">abgelöst</Pill>
                            )}
                          </div>

                          <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-small">
                            <div>
                              <dt className="text-caption text-text-muted">Grundpreis</dt>
                              <dd className="text-text">
                                <Num>{row.grundpreis_amount}</Num>{' '}
                                <span className="text-text-muted">
                                  {grundpreisUnitLabel(row.grundpreis_unit)}
                                </span>
                              </dd>
                            </div>
                            <div>
                              <dt className="text-caption text-text-muted">Netzverlust</dt>
                              <dd className="text-text">
                                <Num>{row.netzverlust_ct_per_kwh}</Num> ct/kWh
                              </dd>
                            </div>
                            <div>
                              <dt className="text-caption text-text-muted">Preisbasis</dt>
                              <dd className="text-text">{priceBasisLabel(row.price_basis)}</dd>
                            </div>
                            <div>
                              <dt className="text-caption text-text-muted">Eingetragen</dt>
                              <dd className="text-text">
                                {row.created_by} · <Num>{formatDate(row.created_at)}</Num>
                              </dd>
                            </div>
                          </dl>

                          {/*
                            Die Zeitfenster stehen bei ihrer Tarifzeile und nicht in einer eigenen
                            Liste: Ohne sie ist die Zeile unvollständig, und eine getrennte Ansicht
                            liesse offen, zu welchem Stand ein Fenster gehört.
                          */}
                          <div className="mt-4 border-t border-line pt-3">
                            <p className="text-caption font-semibold uppercase tracking-wide text-text-muted">
                              Zeitfenster
                            </p>
                            {(windowsByTariff.get(row.id) ?? []).length === 0 ? (
                              <p className="mt-1 text-caption text-negative">
                                Keine Zeitfenster hinterlegt — diese Zeile trägt keinen
                                Arbeitspreis.
                              </p>
                            ) : (
                              <ul className="mt-1 flex flex-col gap-1">
                                {(windowsByTariff.get(row.id) ?? []).map((w) => (
                                  <li key={w.id} className="text-small text-text">
                                    <span className="font-medium text-ink">{w.label}</span>{' '}
                                    <span className="text-text-muted">
                                      <Num>{shortTime(w.time_from)}</Num>–
                                      <Num>{shortTime(w.time_to)}</Num> ·{' '}
                                      {seasonLabel(w.month_day_from, w.month_day_to)} ·{' '}
                                    </span>
                                    <Num>{w.ct_per_kwh}</Num>{' '}
                                    <span className="text-text-muted">ct/kWh</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </AdminPanel>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>
    </Container>
  )
}
