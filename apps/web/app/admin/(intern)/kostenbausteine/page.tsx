import type { Metadata } from 'next'
import Link from 'next/link'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container } from '@/components/ui/layout'
import { AdminError, AdminPanel, AdminSection, AdminTable, EmptyRow, Pill, Td, Th } from '@/components/admin/ui'
import { ActionButton } from '@/components/admin/action-button'
import { CreateCostComponentForm } from '@/components/admin/cost-component-form'
import { deleteCostComponentAction } from '@/lib/admin/cost-components-actions'
import { listCostComponents } from '@/lib/admin/cost-components-data'
import {
  COST_COMPONENTS_HREF,
  costComponentArtLabel,
  costComponentDeleteConfirmText,
  costComponentInUse,
  costComponentPriceText,
} from '@/lib/admin/cost-components'

export const metadata: Metadata = {
  title: 'Kostenbausteine',
  robots: { index: false, follow: false },
}

export default async function AdminCostComponentsPage() {
  if (!(await isCurrentUserAdmin())) return null

  const { rows, failed } = await listCostComponents()
  const ohnePreis = rows.filter((r) => r.price_net === null).length

  return (
    <Container className="py-10 sm:py-14">
      <header className="border-b border-line pb-6">
        <h1 className="text-h2 text-ink">Kostenbausteine</h1>
        <p className="mt-2 max-w-prose text-body text-text-muted">
          Fundament und Installation als eigene, einmal bepreisbare Leistungen. Ein Fundament ist
          keine Eigenschaft eines Geräts, sondern eine Leistung je Grössenklasse — dieselbe
          Bodenplatte trägt mehrere Aussenschränke. Ein Gerät verweist auf den Baustein; der Preis
          steht nur hier.
        </p>
        {ohnePreis > 0 && (
          <p className="mt-3 max-w-prose text-caption text-text-muted">
            {ohnePreis === 1 ? 'Ein Baustein ist' : `${ohnePreis} Bausteine sind`} noch nicht
            bepreist. Fundamentpflichtige Geräte, die daran hängen, lassen sich bis dahin nicht
            freigeben.
          </p>
        )}
      </header>

      <AdminSection
        id="kostenbausteine-neu"
        title="Baustein anlegen"
        description="Art und Bezeichnung genügen. Der Preis lässt sich jederzeit nachtragen."
      >
        <AdminPanel>
          <CreateCostComponentForm />
        </AdminPanel>
      </AdminSection>

      <AdminSection
        id="kostenbausteine-liste"
        title="Alle Bausteine"
        description={'„Genutzt von" zählt alle Geräte, die auf diesen Baustein zeigen — in Klammern die bereits freigegebenen.'}
      >
        {failed && (
          <AdminError>
            Die Bausteine konnten nicht geladen werden. Das heisst nicht, dass es keine gibt.
          </AdminError>
        )}
        <AdminPanel>
          <AdminTable>
            <thead>
              <tr>
                <Th>Art</Th>
                <Th>Bezeichnung</Th>
                <Th>Preis (netto)</Th>
                <Th>Preisstand</Th>
                <Th>Genutzt von</Th>
                <Th className="text-right">Aktion</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <EmptyRow colSpan={6}>Noch keine Bausteine angelegt.</EmptyRow>}
              {rows.map((row) => (
                <tr key={row.id}>
                  <Td>{costComponentArtLabel(row.art)}</Td>
                  <Td>
                    <Link
                      href={`${COST_COMPONENTS_HREF}/${row.id}`}
                      className="underline underline-offset-2"
                    >
                      {row.bezeichnung}
                    </Link>
                  </Td>
                  <Td>
                    {row.price_net === null ? (
                      <Pill tone="warning">noch nicht bepreist</Pill>
                    ) : (
                      costComponentPriceText(row)
                    )}
                  </Td>
                  <Td>{row.price_as_of ?? '—'}</Td>
                  <Td>
                    {row.used_by_count} ({row.used_by_active_count} freigegeben)
                  </Td>
                  <Td className="text-right">
                    {/*
                      Der Knopf steht auch bei Nutzung da — er wird nicht versteckt, sondern
                      beantwortet. Wer ihn nicht sieht, sucht den Grund; wer eine Meldung liest,
                      kennt ihn.
                    */}
                    {/*
                      Bei Nutzung steht KEIN Knopf, sondern der Grund. Ein abgeblendeter Knopf
                      liesse offen, warum er nicht geht; die Datenbank weist das Löschen ohnehin
                      ab (`on delete restrict`), das hier ist die Erklärung davor.
                    */}
                    {costComponentInUse(row) ? (
                      <span className="text-caption text-text-muted">
                        in Verwendung — erst Zuordnungen lösen
                      </span>
                    ) : (
                      <ActionButton
                        action={deleteCostComponentAction}
                        fields={{ id: row.id }}
                        label="Löschen"
                        pendingLabel="Wird gelöscht …"
                        confirm={costComponentDeleteConfirmText(row)}
                        variant="ghost"
                      />
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        </AdminPanel>
      </AdminSection>
    </Container>
  )
}
