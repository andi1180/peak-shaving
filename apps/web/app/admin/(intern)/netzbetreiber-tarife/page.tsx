import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container, Num } from '@/components/ui/layout'
import { AdminError, AdminPanel, AdminSection, Pill, formatDate } from '@/components/admin/ui'
import { ActionButton } from '@/components/admin/action-button'
import { TariffScanCandidates } from '@/components/admin/tariff-scan-candidates'
import { AddRateWindowSection } from '@/components/admin/add-rate-window-form'
import { deleteGridTariffAction } from '@/lib/admin/grid-tariffs-actions'
import {
  combinationKey,
  combinationLabel,
  deleteConfirmText,
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
 * ── ZWEI FÄHIGKEITEN: ANLEGEN UND LÖSCHEN ───────────────────────────────────────────────────────
 * Auflisten, neu anlegen, eine Zeile entfernen. Es gibt weiterhin KEIN Bearbeiten — weder hier noch
 * in der Datenbank (keine Update-Funktion). Ein Tarifstand ist eine Aussage über einen Zeitraum;
 * eine 2026 archivierte Analyse (B14) muss 2028 noch sagen können, welcher Stand ihr zugrunde lag.
 * Ein neues Preisblatt ist deshalb ein NEUER Stand, und die bisher offene Zeile schliesst die
 * Datenbank in derselben Transaktion.
 *
 * ── DAS LÖSCHEN IST FÜR TESTZEILEN DA, NICHT FÜR RÜCKWIRKENDE KORREKTUREN (B21-2c) ──────────────
 * Der Anlass ist eine Nebenwirkung des reinen Anhänge-Wegs: Ein vertippter Probeeintrag blieb
 * bisher für immer stehen UND belegte die Kombination, sodass jeder echte Stand mit demselben oder
 * früherem Beginn auf `invalid_valid_from` lief.
 *
 * Eine rückwirkende Korrektur eines bereits GERECHNETEN Zeitraums bleibt trotzdem ein seltener
 * Eingriff mit Bedacht: sie ändert nachträglich, was einem Kunden gegenüber schon gerechnet wurde.
 * Deshalb hinterlässt jede Löschung einen vollständigen Abzug der Zeile samt Zeitfenstern in
 * `public.grid_tariff_deletions` — ohne ihn wäre eine gelöschte Zeile von einer nie angelegten
 * nicht unterscheidbar. Eine Ansicht des Protokolls gibt es (noch) nicht; es wird bei Bedarf im
 * SQL-Editor gelesen.
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
        description="Tarifzeile und Zeitfenster entstehen zusammen in einem Vorgang. Bricht etwas ab, entsteht gar nichts — es bleibt keine Tarifzeile ohne Arbeitspreis zurück. Führt ein gescanntes Preisblatt mehrere Netzebenen, entsteht je Tarifzeile ein eigenes Formular: jede wird einzeln geprüft und einzeln angelegt."
      >
        <AdminPanel>
          {failed ? (
            <AdminError>
              Die bestehenden Tarifzeilen konnten nicht geladen werden. Das Formular bleibt deshalb
              geschlossen — ohne die vorhandenen Stände liesse sich nicht erkennen, ob ein neuer
              einen bestehenden ablöst.
            </AdminError>
          ) : (
            <TariffScanCandidates operators={operatorOptions(tariffs)} />
          )}
        </AdminPanel>
      </AdminSection>

      <AdminSection
        id="tarif-liste"
        title="Alle Tarifzeilen"
        description="Je Kombination aus Netzbetreiber, Netzebene und Messvariante steht der aktuelle Stand oben, darunter die abgelösten. Löschen entfernt eine Zeile samt ihren Zeitfenstern und hinterlässt einen vollständigen Abzug im Löschprotokoll — gedacht für Probeeinträge, nicht für die Korrektur eines bereits gerechneten Zeitraums."
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
                                    {w.note && (
                                      <span className="block text-caption text-text-muted">
                                        {w.note}
                                      </span>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>

                          {/*
                            ⚠ NUR AM OFFENEN STAND — und das ist keine Anzeigefrage.
                            Ein abgelöster Stand ist eine abgeschlossene Aussage über einen
                            VERGANGENEN Zeitraum; ein nachträglich angehängtes Fenster änderte
                            rückwirkend den Preis, mit dem einem Kunden gegenüber bereits gerechnet
                            wurde — und zwar unsichtbar, denn die Zeile sähe danach lediglich um ein
                            Fenster reicher aus. `public.add_grid_tariff_rate_window` weist es
                            zusätzlich mit `closed_tariff` ab; dass die Oberfläche den Weg gar nicht
                            erst anbietet, ist die zweite, nicht die einzige Schranke.
                          */}
                          {open && (
                            <AddRateWindowSection
                              tariffId={row.id}
                              existingWindows={windowsByTariff.get(row.id) ?? []}
                            />
                          )}

                          {/*
                            Der Löschknopf steht am FUSS der Zeile, nicht neben der Markierung oben:
                            Wer ihn drückt, soll vorher gesehen haben, was in dieser Zeile steht —
                            Grundpreis, Preisbasis und vor allem die Zeitfenster mit den
                            Arbeitspreisen. Zwei Stände derselben Kombination unterscheiden sich in
                            der Kopfzeile nur durch ein Datum.

                            Wiederverwendet wird `ActionButton` (T4-4) mit seiner `confirm`-Prop —
                            die Rückfrage benennt die Zeile eindeutig. Das ausführliche
                            `<details>`-Muster aus `lead-actions.tsx` ist für Vorgänge mit
                            MEHRTEILIGEN Folgen reserviert („was verschwindet, was bleibt"); hier ist
                            die Folge eine einzige und in einem Satz sagbar.

                            ⚠ OHNE `showSuccess`, und das ist gemessen und nicht übersehen: Nach dem
                            Löschen verschwindet die Zeile — und mit ihr dieser Knopf samt seinem
                            Meldungs-Slot. Eine Erfolgsmeldung wäre hier eine Requisite, die niemand
                            je zu sehen bekommt. Die Rückmeldung IST das Verschwinden; was der
                            Vorgang hinterlässt, sagt die Rückfrage vorher (der Abzug im
                            Löschprotokoll). Der Fehler-Slot bleibt dagegen wirksam: schlägt der
                            Vorgang fehl, steht die Zeile noch da und die Meldung mit ihr.
                          */}
                          <div className="mt-4 flex justify-end border-t border-line pt-3">
                            <ActionButton
                              action={deleteGridTariffAction}
                              fields={{ tariffId: row.id }}
                              label="Tarifstand löschen"
                              pendingLabel="wird gelöscht …"
                              variant="ghost"
                              confirm={deleteConfirmText(row, windowsByTariff.get(row.id) ?? [])}
                            />
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
