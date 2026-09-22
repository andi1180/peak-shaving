import type { Metadata } from 'next'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container, Num } from '@/components/ui/layout'
import { AdminError, AdminPanel, AdminSection, Pill } from '@/components/admin/ui'
import { ActionButton } from '@/components/admin/action-button'
import { CreateBatteryForm } from '@/components/admin/battery-catalog-form'
import { deleteBatteryAction, setBatteryActiveAction } from '@/lib/admin/battery-catalog-actions'
import { listBatteries } from '@/lib/admin/battery-catalog-data'
import {
  BATTERY_CATALOG_HREF,
  BATTERY_KATEGORIEN,
  BATTERY_KATEGORIE_LABELS,
  batterieKategorieLabel,
  batteryDeactivateConfirmText,
  batteryDeleteConfirmText,
  batteryEngineFieldLabel,
  batteryLabel,
  batteryPriceStand,
  missingEngineFields,
  type BatteryCatalogRow,
} from '@/lib/admin/battery-catalog'

/**
 * Admin-Abschnitt „Batteriespeicher" (K1) — der Gerätekatalog des Kalkulators.
 *
 * ⚠ DIESE SEITE LIEST NICHT ÜBER `.from('battery_catalog')`, und das ist der Kern des Abschnitts:
 * die RLS-Policy gibt dem angemeldeten Client nur die AKTIVEN Zeilen frei. Ein Entwurf, der noch
 * vervollständigt werden muss, wäre über den gewöhnlichen Weg unsichtbar — also genau das, was hier
 * zu tun ist. Der Leseweg läuft deshalb über `public.admin_list_battery_catalog`
 * (SECURITY DEFINER, `platform.is_admin()` im Rumpf), s. `lib/admin/battery-catalog-data.ts`.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Batteriespeicher — COOLiN ENERGY',
  robots: { index: false, follow: false },
}

/** Die zwei Filter der Liste, aus der Adresse gelesen. Ein unbekannter Wert filtert nicht. */
function readFilters(params: Record<string, string | string[] | undefined>): {
  kategorie: string | null
  active: boolean | null
} {
  const raw = (name: string): string => {
    const value = params[name]
    return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
  }

  const kategorie = raw('kategorie')
  const aktiv = raw('aktiv')

  return {
    kategorie: (BATTERY_KATEGORIEN as readonly string[]).includes(kategorie) ? kategorie : null,
    active: aktiv === 'ja' ? true : aktiv === 'nein' ? false : null,
  }
}

function num(value: number | null, unit: string): string {
  if (value === null) return '—'
  return `${new Intl.NumberFormat('de-AT', { maximumFractionDigits: 2 }).format(value)} ${unit}`
}

function BatteryRow({ row }: { row: BatteryCatalogRow }) {
  const missing = missingEngineFields(row)

  return (
    <li
      className={
        row.active
          ? 'rounded-md border border-accent-border bg-accent-subtle p-4'
          : 'rounded-md border border-line p-4'
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-small font-medium text-ink">
            <a href={`${BATTERY_CATALOG_HREF}/${row.id}`} className="underline underline-offset-2">
              {batteryLabel(row)}
            </a>
          </p>
          <p className="mt-1 text-caption text-text-muted">
            {batterieKategorieLabel(row.kategorie)}
            {row.memodo_id !== null && (
              <>
                {' · Memodo '}
                <Num>{row.memodo_id}</Num>
              </>
            )}
            {' · '}
            {batteryPriceStand(row)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {row.active ? (
            <Pill tone="positive">Im Rechner</Pill>
          ) : missing.length > 0 ? (
            <Pill tone="warning">Entwurf — {missing.length} Feld(er) offen</Pill>
          ) : (
            <Pill>Bereit, nicht freigegeben</Pill>
          )}
        </div>
      </div>

      <p className="mt-3 text-small text-text">
        <span className="text-text-muted">Kapazität </span>
        <span className="tabular-nums">{num(row.usable_capacity_kwh, 'kWh')}</span>
        <span className="text-text-muted"> · Leistung </span>
        <span className="tabular-nums">{num(row.max_power_kw, 'kW')}</span>
        <span className="text-text-muted"> · Wirkungsgrad </span>
        <span className="tabular-nums">{num(row.round_trip_efficiency, '')}</span>
      </p>
      <p className="mt-1 text-small text-text">
        <span className="text-text-muted">Liste netto </span>
        <span className="tabular-nums">{num(row.list_price_net, 'EUR')}</span>
        <span className="text-text-muted"> · Einkauf netto </span>
        <span className="tabular-nums">{num(row.purchase_price_net, 'EUR')}</span>
      </p>

      {missing.length > 0 && (
        <p className="mt-2 max-w-prose text-caption text-text-muted">
          Zum Freigeben fehlt noch: {missing.map(batteryEngineFieldLabel).join(', ')}.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-start gap-3">
        <ActionButton
          action={setBatteryActiveAction}
          fields={{ id: row.id, active: row.active ? 'false' : 'true' }}
          label={row.active ? 'Zurücknehmen' : 'Für den Rechner freigeben'}
          pendingLabel={row.active ? 'Wird zurückgenommen …' : 'Wird freigegeben …'}
          variant={row.active ? 'secondary' : 'primary'}
          confirm={row.active ? batteryDeactivateConfirmText(row) : undefined}
          showSuccess
        />
        <ActionButton
          action={deleteBatteryAction}
          fields={{ id: row.id }}
          label="Löschen"
          pendingLabel="Wird gelöscht …"
          variant="ghost"
          confirm={batteryDeleteConfirmText(row)}
        />
      </div>
    </li>
  )
}

export default async function AdminBatteryCatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!(await isCurrentUserAdmin())) return null

  const params = await searchParams
  const filters = readFilters(params)
  const { rows, failed } = await listBatteries(filters)

  const activeCount = rows.filter((r) => r.active).length

  return (
    <Container className="py-10 sm:py-14">
      <header className="border-b border-line pb-6">
        <h1 className="text-h2 text-ink">Batteriespeicher</h1>
        <p className="mt-2 max-w-prose text-body text-text-muted">
          Der Gerätekatalog des Kalkulators: Kenndaten und Netto-Listenpreise der Speicher, aus
          denen die Empfehlung gewählt wird. Ein neues Gerät ist zuerst ein Entwurf — der Rechner
          sieht es erst, wenn alle Kenndaten stehen und es ausdrücklich freigegeben wurde. Der
          Einkaufspreis liegt getrennt und verlässt den Admin-Bereich nicht.
        </p>
      </header>

      <AdminSection
        id="batteriespeicher-neu"
        title="Gerät anlegen"
        description="Hersteller, Bezeichnung und Kategorie genügen für den Anfang. Kenndaten und Preise lassen sich jederzeit nachtragen."
      >
        <AdminPanel>
          <CreateBatteryForm />
        </AdminPanel>
      </AdminSection>

      <AdminSection
        id="batteriespeicher-liste"
        title="Alle Geräte"
        description="Freigegebene Geräte stehen im Rechner zur Auswahl, Entwürfe nicht."
      >
        <AdminPanel className="mb-4">
          {/*
            Ein echtes GET-Formular: die Filter SIND die Adresse, damit sich eine Sicht teilen
            lässt und ohne JavaScript funktioniert (Muster der Lead-Liste).
          */}
          <form method="get" className="flex flex-wrap items-end gap-4">
            <div>
              <label
                htmlFor="filter-kategorie"
                className="mb-1 block text-caption font-medium text-text"
              >
                Kategorie
              </label>
              <select
                id="filter-kategorie"
                name="kategorie"
                defaultValue={filters.kategorie ?? ''}
                className="h-9 rounded-md border border-line bg-surface px-2 text-small text-ink"
              >
                <option value="">alle</option>
                {BATTERY_KATEGORIEN.map((k) => (
                  <option key={k} value={k}>
                    {BATTERY_KATEGORIE_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="filter-aktiv"
                className="mb-1 block text-caption font-medium text-text"
              >
                Status
              </label>
              <select
                id="filter-aktiv"
                name="aktiv"
                defaultValue={filters.active === null ? '' : filters.active ? 'ja' : 'nein'}
                className="h-9 rounded-md border border-line bg-surface px-2 text-small text-ink"
              >
                <option value="">alle</option>
                <option value="ja">nur freigegebene</option>
                <option value="nein">nur Entwürfe</option>
              </select>
            </div>
            <button
              type="submit"
              className="h-9 rounded-md border border-line bg-surface px-3 text-small font-medium text-ink"
            >
              Filtern
            </button>
            <a
              href={BATTERY_CATALOG_HREF}
              className="text-small text-text-muted underline underline-offset-2"
            >
              Zurücksetzen
            </a>
          </form>
        </AdminPanel>

        {failed ? (
          <AdminError>
            Der Katalog konnte nicht geladen werden. Das ist NICHT dasselbe wie „es gibt keine
            Geräte" — bitte die Seite neu laden.
          </AdminError>
        ) : rows.length === 0 ? (
          <AdminPanel>
            <p className="text-small text-text-muted">
              Keine Geräte für diese Auswahl. Solange kein Gerät freigegeben ist, hat der Rechner
              keinen Katalog, aus dem er empfehlen könnte.
            </p>
          </AdminPanel>
        ) : (
          <>
            <p className="mb-3 text-caption text-text-muted">
              <Num>{rows.length}</Num> {rows.length === 1 ? 'Gerät' : 'Geräte'} ·{' '}
              <Num>{activeCount}</Num> davon im Rechner
            </p>
            <ul className="flex flex-col gap-4">
              {rows.map((row) => (
                <BatteryRow key={row.id} row={row} />
              ))}
            </ul>
          </>
        )}
      </AdminSection>
    </Container>
  )
}
