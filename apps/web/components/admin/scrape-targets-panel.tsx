'use client'

/**
 * Scraper-Ziele: Tabelle + Bearbeiten-Formular als EINE Einheit (T4-4-Nacharbeit).
 *
 * ── DER BEFUND, DER DIESE DATEI NÖTIG MACHTE ─────────────────────────────────────────────────────
 * Im ersten Live-Test liess sich ein bestehendes Ziel „nicht bearbeiten" — ausser dem An/Aus-Toggle
 * ging nichts. Die Ursache lag NICHT in der Datenbank: `admin_upsert_scrape_target` bearbeitet über
 * den `provider_slug` sauber, und auch der COALESCE-Schutz für `extraction_config` ist unschuldig
 * (gegen die laufende DB nachgemessen: anlegen → Regel setzen → Name UND URL ändern persistiert
 * alle drei Werte korrekt).
 *
 * Die Ursache war, dass es in der OBERFLÄCHE keinen Bearbeiten-Weg gab. Es existierte nur ein
 * leeres „Ziel anlegen oder bearbeiten"-Formular: wer ein bestehendes Ziel ändern wollte, musste
 * dessen Kurz-Key auswendig abtippen und traf dann auf die eigentliche Falle — die übrigen Felder
 * (Netzgebiet, Notiz, Reihenfolge) waren leer und wurden vom Upsert MITGESCHRIEBEN. Eine
 * Namenskorrektur löschte also stillschweigend Netzgebiet und Notiz und setzte die Reihenfolge auf
 * 100 zurück. „Geht nicht" war insofern die gutmütige Lesart des Verhaltens.
 *
 * ── DIE LÖSUNG ──────────────────────────────────────────────────────────────────────────────────
 * Jede Zeile bekommt „Bearbeiten"; der Klick füllt EIN gemeinsames Formular mit ALLEN Werten dieser
 * Zeile vor. Damit schickt jede Bearbeitung den vollständigen Datensatz zurück, und nichts geht
 * mehr verloren, weil ein Feld nicht sichtbar war.
 *
 * WARUM EIN GEMEINSAMES FORMULAR UND NICHT EINES JE ZEILE: ein aufklappbares Formular pro Zeile
 * bräuchte keinen gemeinsamen Zustand, aber bei 15–20 kuratierten Zielen (§7) stünden ebenso viele
 * vollständige Formulare im DOM — und zwei gleichzeitig geöffnete könnten dasselbe Ziel
 * widersprüchlich beschreiben. Ein Formular, ein Bearbeitungsgegenstand.
 *
 * WARUM DAS HIER EINE CLIENT-KOMPONENTE IST: die Auswahl „welche Zeile wird gerade bearbeitet" ist
 * Zustand. Die Tabelle wandert deshalb mit ins Client-Bundle — sie zeigt ausschliesslich Daten, die
 * der Admin ohnehin sehen darf (dieselben, die zuvor server-gerendert waren), also entsteht dadurch
 * keine neue Preisgabe. Die Server Actions bleiben Server Actions.
 */
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { ActionButton } from './action-button'
import { ScrapeTargetForm } from './forms'
import { setScrapeTargetActiveAction } from '@/lib/admin/actions'
import type { ScrapeTargetRow } from '@/lib/admin/types'
import { AdminPanel, AdminTable, EmptyRow, Pill, Td, Th, formatDateTime } from './ui'
import { Num } from '@/components/ui/layout'

function ScrapeStatusPill({ row }: { row: ScrapeTargetRow }) {
  if (row.last_scrape_status === 'ok') return <Pill tone="positive">ok</Pill>
  if (row.last_scrape_status === 'failed') return <Pill tone="negative">fehlgeschlagen</Pill>
  // NULL = noch nie versucht. Kein erfundener Zustand.
  return <Pill>noch kein Lauf</Pill>
}

export function ScrapeTargetsPanel({ targets }: { targets: ScrapeTargetRow[] }) {
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const formRef = React.useRef<HTMLDivElement>(null)

  /*
   * Bewusst über die ID nachgeschlagen statt die Zeile selbst im Zustand zu halten: nach einer
   * Änderung liefert `revalidatePath` eine frische `targets`-Liste: Eine festgehaltene Kopie zeigte
   * danach den alten Stand, ohne dass es jemandem auffiele. Verschwindet die Zeile ganz, fällt die
   * Auswahl sauber auf „neues Ziel" zurück.
   */
  const editing = editingId ? (targets.find((t) => t.id === editingId) ?? null) : null

  function startEditing(target: ScrapeTargetRow) {
    setEditingId(target.id)
    // Das Formular steht unter der Tabelle — ohne Sprung sähe ein Klick weiter unten wie nichts aus.
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }

  return (
    <>
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
                  <span className="sr-only">Aktionen</span>
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
                <tr key={t.id} aria-current={t.id === editingId ? 'true' : undefined}>
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
                    <div className="flex flex-col items-start gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => startEditing(t)}
                        aria-pressed={t.id === editingId}
                      >
                        {t.id === editingId ? 'Wird bearbeitet' : 'Bearbeiten'}
                      </Button>
                      <ActionButton
                        action={setScrapeTargetActiveAction}
                        fields={{ id: t.id, isActive: t.is_active ? 'false' : 'true' }}
                        label={t.is_active ? 'Deaktivieren' : 'Aktivieren'}
                        pendingLabel="…"
                      />
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        </div>
      </AdminPanel>

      {/* Der Anker sitzt auf einem eigenen Wrapper: `AdminPanel` ist ein schlichtes Layout-Primitiv
          ohne ref-Weiterleitung, und es nur für einen Scroll-Sprung umzubauen wäre der falsche Preis. */}
      <div ref={formRef} className="mt-4">
        <AdminPanel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-h4 text-ink">
              {editing ? `Ziel bearbeiten: ${editing.provider_name}` : 'Neues Ziel anlegen'}
            </h3>
            <p className="mt-1 max-w-prose text-small text-text-muted">
              {editing
                ? 'Alle Felder sind mit dem gespeicherten Stand vorbelegt. Was hier steht, wird gespeichert — geleerte Felder werden also auch geleert.'
                : 'Ein bereits vergebener Kurz-Key bearbeitet das bestehende Ziel, statt ein zweites anzulegen.'}
            </p>
          </div>
          {editing && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditingId(null)}>
              Abbrechen
            </Button>
          )}
        </div>
        <div className="mt-4">
          {/*
           * `key` erzwingt einen frischen Formular-Zustand beim Wechsel des Bearbeitungsgegenstands.
           * Ohne ihn behielte React die unkontrollierten Felder samt Inhalt der VORIGEN Zeile —
           * man bearbeitete sichtbar Ziel B mit den Werten von Ziel A. Der Schlüssel setzt zugleich
           * die Meldung der letzten Absendung zurück, die sonst über der neuen Zeile stehen bliebe.
           */}
          <ScrapeTargetForm key={editing?.id ?? 'new'} target={editing} />
        </div>
        </AdminPanel>
      </div>
    </>
  )
}
