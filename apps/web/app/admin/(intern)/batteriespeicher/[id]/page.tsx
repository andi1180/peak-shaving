import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container } from '@/components/ui/layout'
import { AdminPanel, AdminSection, Pill, formatDateTime } from '@/components/admin/ui'
import { ActionButton } from '@/components/admin/action-button'
import { EditBatteryForm } from '@/components/admin/battery-catalog-form'
import { BatteryPurchasePriceForm } from '@/components/admin/battery-purchase-price-form'
import { deleteBatteryAction, setBatteryActiveAction } from '@/lib/admin/battery-catalog-actions'
import { getBattery } from '@/lib/admin/battery-catalog-data'
import { listCostComponents } from '@/lib/admin/cost-components-data'
import {
  BATTERY_CATALOG_HREF,
  batterieKategorieLabel,
  batteryDeactivateConfirmText,
  batteryDeleteConfirmText,
  batteryEngineFieldLabel,
  batteryLabel,
  missingEngineFields,
} from '@/lib/admin/battery-catalog'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Batteriespeicher bearbeiten — COOLiN ENERGY',
  robots: { index: false, follow: false },
}

export default async function AdminBatteryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (!(await isCurrentUserAdmin())) return null

  const { id } = await params
  const battery = await getBattery(id)
  const { rows: components } = await listCostComponents()
  if (!battery) notFound()

  const missing = missingEngineFields(battery)

  return (
    <Container className="py-10 sm:py-14">
      <header className="border-b border-line pb-6">
        <p className="text-caption text-text-muted">
          <a href={BATTERY_CATALOG_HREF} className="underline underline-offset-2">
            Batteriespeicher
          </a>
        </p>
        <h1 className="mt-1 text-h2 text-ink">{batteryLabel(battery)}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Pill>{batterieKategorieLabel(battery.kategorie)}</Pill>
          {battery.active ? (
            <Pill tone="positive">Im Rechner</Pill>
          ) : missing.length > 0 ? (
            <Pill tone="warning">Entwurf</Pill>
          ) : (
            <Pill>Bereit, nicht freigegeben</Pill>
          )}
        </div>
        <p className="mt-3 text-caption text-text-muted">
          Angelegt {formatDateTime(battery.created_at)} · zuletzt geändert{' '}
          {formatDateTime(battery.updated_at)}
        </p>
      </header>

      <AdminSection
        id="batterie-freigabe"
        title="Freigabe"
        description="Nur freigegebene Geräte stehen dem Rechner zur Verfügung."
      >
        <AdminPanel>
          {missing.length > 0 && !battery.active && (
            <p className="mb-4 max-w-prose text-small text-text">
              Dieses Gerät lässt sich noch nicht freigeben. Es fehlt:{' '}
              <span className="font-medium text-ink">
                {missing.map(batteryEngineFieldLabel).join(', ')}
              </span>
              . Ohne diese Werte kann die Engine das Gerät weder simulieren noch seine
              Wirtschaftlichkeit rechnen — die Datenbank weist die Freigabe deshalb ab.
            </p>
          )}
          <div className="flex flex-wrap items-start gap-3">
            <ActionButton
              action={setBatteryActiveAction}
              fields={{ id: battery.id, active: battery.active ? 'false' : 'true' }}
              label={battery.active ? 'Zurücknehmen' : 'Für den Rechner freigeben'}
              pendingLabel={battery.active ? 'Wird zurückgenommen …' : 'Wird freigegeben …'}
              variant={battery.active ? 'secondary' : 'primary'}
              confirm={battery.active ? batteryDeactivateConfirmText(battery) : undefined}
              showSuccess
            />
            <ActionButton
              action={deleteBatteryAction}
              fields={{ id: battery.id }}
              label="Gerät löschen"
              pendingLabel="Wird gelöscht …"
              variant="ghost"
              confirm={batteryDeleteConfirmText(battery)}
            />
          </div>
        </AdminPanel>
      </AdminSection>

      <AdminSection
        id="batterie-stammdaten"
        title="Kenndaten und Preise"
        description="Alle Beträge netto. Ein geleertes Feld wird beim Speichern gelöscht."
      >
        <AdminPanel>
          <EditBatteryForm battery={battery} components={components} />
        </AdminPanel>
      </AdminSection>

      <AdminSection
        id="batterie-einkauf"
        title="Einkaufspreis"
        description="Nur intern. Der Rechner und der Kunde sehen diese Zahl nie."
      >
        <AdminPanel>
          <BatteryPurchasePriceForm battery={battery} />
        </AdminPanel>
      </AdminSection>
    </Container>
  )
}
