import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container } from '@/components/ui/layout'
import { AdminPanel, AdminSection } from '@/components/admin/ui'
import { EditCostComponentForm } from '@/components/admin/cost-component-form'
import { getCostComponent } from '@/lib/admin/cost-components-data'
import { COST_COMPONENTS_HREF, costComponentArtLabel } from '@/lib/admin/cost-components'

export const metadata: Metadata = {
  title: 'Kostenbaustein bearbeiten',
  robots: { index: false, follow: false },
}

export default async function AdminCostComponentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (!(await isCurrentUserAdmin())) return null

  const { id } = await params
  const component = await getCostComponent(id)
  if (!component) notFound()

  return (
    <Container className="py-10 sm:py-14">
      <header className="border-b border-line pb-6">
        <Link href={COST_COMPONENTS_HREF} className="text-caption underline underline-offset-2">
          ← Alle Kostenbausteine
        </Link>
        <h1 className="mt-2 text-h2 text-ink">{component.bezeichnung}</h1>
        <p className="mt-2 text-body text-text-muted">
          {costComponentArtLabel(component.art)} · genutzt von {component.used_by_count} Gerät
          {component.used_by_count === 1 ? '' : 'en'} ({component.used_by_active_count} davon
          freigegeben)
        </p>
      </header>

      <AdminSection id="kostenbaustein-bearbeiten" title="Bearbeiten">
        <AdminPanel>
          <EditCostComponentForm component={component} />
        </AdminPanel>
      </AdminSection>
    </Container>
  )
}
