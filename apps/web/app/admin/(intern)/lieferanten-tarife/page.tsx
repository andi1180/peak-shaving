import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container, Num } from '@/components/ui/layout'
import { AdminError, AdminPanel, AdminSection, Pill, formatDate } from '@/components/admin/ui'
import { ActionButton } from '@/components/admin/action-button'
import { CreateRetailTariffForm } from '@/components/admin/retail-tariff-form'
import { confirmRetailTariffAction } from '@/lib/admin/retail-tariffs-actions'
import {
  STALE_RETAIL_TARIFF_DAYS,
  isOpen,
  retailCombinationKey,
  retailCombinationLabel,
  retailConfirmText,
  retailPriceBasisLabel,
  retailProviderOptions,
  staleRetailTariffDays,
  type RetailTariffRow,
} from '@/lib/admin/retail-tariffs'

/*
 * `/admin/lieferanten-tarife` — die Pflege der Stromanbieter-Listenpreise (Delta 5/10).
 *
 * ── DIE ZWEITE HÄLFTE VON DELTA 5 ──────────────────────────────────────────────────────────────
 * Delta 5 nennt beide Seiten gemeinsam: Netzentgelte UND Lieferantenpreise. B21-2b hat die
 * Netzbetreiber-Seite gebaut und diese ausdrücklich offengelassen; die Migrationen `20260913120000`
 * und `…120100` haben Tabelle und Schreibweg nachgezogen, hier bekommen sie ihre Oberfläche.
 *
 * ── ZWEI FÄHIGKEITEN: ANLEGEN UND BESTÄTIGEN ──────────────────────────────────────────────────
 * Auflisten, einen neuen Stand anlegen, einen offenen Stand als weiterhin zutreffend bestätigen. Es
 * gibt KEIN Bearbeiten und — anders als bei den Netzbetreiber-Tarifen — auch KEIN Löschen: für
 * `public.retail_tariffs` existiert für keine Rolle ein `delete`-Grant und keine Löschfunktion. Eine
 * falsch eingetragene Zeile bleibt stehen und wird durch einen neuen Stand abgelöst.
 *
 * Das ist eine bewusste Entscheidung und keine Lücke: Ein Vergleichspreis ist eine Aussage über
 * einen Zeitraum, gegen die gerechnet wurde. Wer je einen Löschweg baut, beantwortet damit dieselbe
 * Frage noch einmal, die B21-2c für `grid_tariffs` beantwortet hat — und braucht dann auch dessen
 * Protokoll.
 *
 * ── WARUM ES „BESTÄTIGEN" ÜBERHAUPT GIBT ──────────────────────────────────────────────────────
 * `valid_from` sagt, ab wann ein Preis gilt; `checked_at` sagt, wann zuletzt jemand nachgesehen hat,
 * dass er noch dasteht. Die beiden fallen auseinander, sobald ein Stand länger unverändert richtig
 * ist — und ohne die zweite Angabe sähe genau dieser Fall aus wie ein vergessener Datenbestand.
 * Der Knopf setzt AUSSCHLIESSLICH `checked_at` (`public.confirm_retail_tariff`), nie einen Preis.
 *
 * ── GELESEN WIRD ÜBER DEN ANGEMELDETEN CLIENT, GESCHRIEBEN ÜBER service_role ───────────────────
 * `authenticated` hat auf der Tabelle `select` (es sind veröffentlichte Listenpreise ohne
 * Personenbezug) — die Liste braucht also keinen erhöhten Zugriff. Der Schreibweg liegt in
 * `lib/admin/retail-tariffs-actions.ts` und ist dort begründet. Dieselbe Trennung wie bei den
 * Netzbetreiber-Tarifen.
 *
 * ── KEINE WEBSUCHE, KEINE ABWEICHUNGS-WARNUNG ─────────────────────────────────────────────────
 * Beides ist vorgesehen und ausdrücklich NICHT Teil dieses Schritts: Die KI-gestützte Preisrecherche
 * ist ein eigener Bauschritt, und ein Abgleich gegen die Tarifwerte einer Kundenrechnung fasst die
 * Rechnung-Station an. Hier steht ein Formular mit Freitextfeldern, mehr nicht.
 */

export const dynamic = 'force-dynamic'

/** Neutral wie im Layout: der Tab-Titel darf nicht verraten, dass es hier etwas zu holen gibt. */
export const metadata: Metadata = {
  title: 'COOLiN ENERGY',
  robots: { index: false, follow: false },
}

/**
 * Ein Beleg ist im Regelfall eine Adresse, muss es aber nicht sein (die Spalte trägt bewusst keine
 * Formatprüfung). Verlinkt wird deshalb nur, was erkennbar eine ist — alles andere steht als Text.
 */
function isLinkableSource(value: string): boolean {
  return value.startsWith('https://') || value.startsWith('http://')
}

export default async function AdminRetailTariffsPage() {
  if (!(await isCurrentUserAdmin())) return null

  const supabase = await createClient()

  /*
   * Die Sortierung ist zugleich die Gruppierung: Anbieter, dann Kundengruppe, dann jüngster Stand
   * zuerst. Dadurch stehen die Stände einer Kombination zusammenhängend, und die Karten unten
   * entstehen aus der Reihenfolge der Abfrage statt aus einer zweiten Ordnung.
   */
  const res = await supabase
    .from('retail_tariffs')
    .select('*')
    .order('provider_name', { ascending: true })
    .order('segment', { ascending: true })
    .order('valid_from', { ascending: false })

  if (res.error) console.error('[admin/retail-tariffs] retail_tariffs:', res.error)

  const failed = Boolean(res.error)
  const tariffs = (res.data ?? []) as RetailTariffRow[]

  /*
   * EIN Stichtag für die ganze Seite. Bei mehreren Karten mit je eigenem `new Date()` könnten zwei
   * Zeilen desselben Aufrufs über eine Tagesgrenze hinweg verschieden bewertet werden — an einer
   * reinen Anzeige folgenlos, aber es gäbe zwei „Jetzt" in einer Antwort.
   */
  const now = new Date()

  const groups = new Map<string, RetailTariffRow[]>()
  for (const row of tariffs) {
    const key = retailCombinationKey(row)
    const list = groups.get(key)
    if (list) list.push(row)
    else groups.set(key, [row])
  }

  return (
    <Container className="py-10 sm:py-14">
      <header className="border-b border-line pb-6">
        <h1 className="text-h2 text-ink">Lieferanten-Tarife</h1>
        <p className="mt-2 max-w-prose text-body text-text-muted">
          Die beworbenen Listenpreise der Stromanbieter, effektiv datiert — die Vergleichsseite neben
          den Netzentgelten. Zeilen werden nie überschrieben: Ein neuer Preis ist ein neuer Stand,
          und der bisher gültige wird dabei automatisch am Vortag beendet. Die Vertragswerte eines
          einzelnen Kunden gehören NICHT hierher — die kommen aus seiner eigenen Rechnung.
        </p>
      </header>

      <AdminSection
        id="lieferanten-tarif-neu"
        title="Neuen Tarifstand anlegen"
        description="Ein Arbeitspreis und eine Grundgebühr je Anbieter und Kundengruppe. Der Quellenbeleg ist Pflicht. Der Stand lässt sich danach weder bearbeiten noch löschen — nur durch einen späteren ablösen."
      >
        <AdminPanel>
          {failed ? (
            <AdminError>
              Die bestehenden Tarifstände konnten nicht geladen werden. Das Formular bleibt deshalb
              geschlossen — ohne die vorhandenen Stände liesse sich weder erkennen, ob ein neuer
              einen bestehenden ablöst, noch ein Anbieter zuverlässig auswählen.
            </AdminError>
          ) : (
            <CreateRetailTariffForm providers={retailProviderOptions(tariffs)} />
          )}
        </AdminPanel>
      </AdminSection>

      <AdminSection
        id="lieferanten-tarif-liste"
        title="Alle Tarifstände"
        description="Je Anbieter und Kundengruppe steht der aktuelle Stand oben, darunter die abgelösten. „Jetzt bestätigen“ setzt ausschliesslich den Prüfzeitpunkt auf heute — der Preis bleibt unverändert."
      >
        {failed ? (
          <AdminError>
            Die Tarifstände konnten nicht geladen werden. Das ist NICHT dasselbe wie „es gibt keine"
            — bitte die Seite neu laden.
          </AdminError>
        ) : groups.size === 0 ? (
          <AdminPanel>
            <p className="text-small text-text-muted">
              Noch kein Lieferanten-Tarif hinterlegt. Der erste entsteht über das Formular oben.
              Solange hier nichts steht, gibt es für den Anbietervergleich keine Grundlage.
            </p>
          </AdminPanel>
        ) : (
          <ul className="flex flex-col gap-6">
            {[...groups.entries()].map(([key, rows]) => (
              <li key={key}>
                <AdminPanel>
                  <h3 className="text-h4 text-ink">{retailCombinationLabel(rows[0]!)}</h3>
                  <p className="mt-1 text-caption text-text-muted">
                    Kennung <span className="font-medium text-text">{rows[0]!.provider_id}</span> ·{' '}
                    <Num>{rows.length}</Num> {rows.length === 1 ? 'Stand' : 'Stände'}
                  </p>

                  <ul className="mt-4 flex flex-col gap-4">
                    {rows.map((row) => {
                      const open = isOpen(row)
                      /*
                       * ⚠ NUR AM OFFENEN STAND. Ein abgelöster Stand ist eine abgeschlossene Aussage
                       * über einen vergangenen Zeitraum — „ich habe nachgesehen, dass er noch gilt"
                       * ist dort gar keine sinnvolle Aussage mehr. Die Datenbank hält sich bewusst
                       * heraus (`confirm_retail_tariff` urteilt darüber nicht, s. Migration): WELCHE
                       * Zeile bestätigt werden darf, ist eine fachliche Frage, und sie wird hier an
                       * genau einer Stelle beantwortet.
                       */
                      const stale = open ? staleRetailTariffDays(row.checked_at, now) : null
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
                            <div className="flex flex-wrap items-center gap-2">
                              {stale !== null && (
                                <Pill tone="warning">
                                  seit <Num>{stale}</Num> Tagen nicht geprüft
                                </Pill>
                              )}
                              {open ? (
                                <Pill tone="positive">aktuell</Pill>
                              ) : (
                                <Pill tone="neutral">abgelöst</Pill>
                              )}
                            </div>
                          </div>

                          <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-small">
                            <div>
                              <dt className="text-caption text-text-muted">Arbeitspreis</dt>
                              <dd className="text-text">
                                <Num>{row.energy_price_ct_per_kwh}</Num> ct/kWh
                              </dd>
                            </div>
                            <div>
                              <dt className="text-caption text-text-muted">Grundgebühr</dt>
                              <dd className="text-text">
                                <Num>{row.base_fee_eur_per_month}</Num> EUR/Monat
                              </dd>
                            </div>
                            <div>
                              <dt className="text-caption text-text-muted">Preisbasis</dt>
                              <dd className="text-text">{retailPriceBasisLabel(row.price_basis)}</dd>
                            </div>
                            <div>
                              <dt className="text-caption text-text-muted">Zuletzt geprüft</dt>
                              <dd className="text-text">
                                <Num>{formatDate(row.checked_at)}</Num>
                              </dd>
                            </div>
                            <div>
                              <dt className="text-caption text-text-muted">Eingetragen</dt>
                              <dd className="text-text">
                                {row.created_by} · <Num>{formatDate(row.created_at)}</Num>
                              </dd>
                            </div>
                          </dl>

                          {/*
                            Der Beleg steht bei seinem Stand und nicht in einer eigenen Liste: Ohne
                            ihn ist die Zeile eine Behauptung, und getrennt angezeigt liesse sich
                            nicht mehr sagen, zu welchem Preis er gehört.
                          */}
                          <p className="mt-3 break-words border-t border-line pt-3 text-caption text-text-muted">
                            Beleg:{' '}
                            {isLinkableSource(row.source_url) ? (
                              <a
                                href={row.source_url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-text underline decoration-line underline-offset-[3px] hover:text-ink"
                              >
                                {row.source_url}
                              </a>
                            ) : (
                              <span className="text-text">{row.source_url}</span>
                            )}
                          </p>

                          {/*
                            ⚠ REINE ANZEIGE — KEIN BLOCKER, KEIN ABLAUFDATUM.
                            Ein Listenpreis verfällt nicht: Solange der Anbieter ihn nicht geändert
                            hat, ist der Stand weiterhin richtig, und ein automatisches Ende erfände
                            eine Lücke, die es fachlich nicht gibt. Der Hinweis sagt nur, wie lange
                            niemand nachgesehen hat — und die Handlung daraus steht daneben.
                          */}
                          {stale !== null && (
                            <p className="mt-3 border-t border-line pt-3 text-caption text-text-muted">
                              Seit <Num>{stale}</Num> Tagen nicht mehr geprüft (zuletzt{' '}
                              <Num>{formatDate(row.checked_at)}</Num>). Ab{' '}
                              <Num>{STALE_RETAIL_TARIFF_DAYS}</Num> Tagen erscheint dieser Hinweis —
                              er sperrt nichts. Stimmt der Preis noch, genügt „Jetzt bestätigen";
                              hat er sich geändert, gehört er als neuer Stand oben eingetragen.
                            </p>
                          )}

                          {open && (
                            <div className="mt-4 flex justify-end border-t border-line pt-3">
                              {/*
                                ⚠ MIT `showSuccess`, und das ist bewusst anders als beim Löschknopf
                                der Netzbetreiber-Tarife: Dort verschwindet die Zeile mitsamt dem
                                Knopf und seinem Meldungs-Slot, eine Erfolgsmeldung wäre eine
                                Requisite, die niemand je zu sehen bekommt. Hier bleibt die Zeile
                                stehen — die Meldung erscheint wirklich, und sie ist neben dem neuen
                                Prüfdatum die zweite, unmittelbare Rückmeldung.
                              */}
                              <ActionButton
                                action={confirmRetailTariffAction}
                                fields={{ tariffId: row.id }}
                                label="Jetzt bestätigen"
                                pendingLabel="wird bestätigt …"
                                variant="secondary"
                                confirm={retailConfirmText(row)}
                                showSuccess
                              />
                            </div>
                          )}
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
