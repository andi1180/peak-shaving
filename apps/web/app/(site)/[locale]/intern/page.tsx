import type { Metadata } from 'next'
import { setRequestLocale } from 'next-intl/server'
import { AuthPageShell } from '@/components/auth/auth-page-shell'
import { InternalDeviceToggle } from '@/components/analytics/internal-device-toggle'
import { INTERN_HREF } from '@/lib/analytics/internal-device'
import { robotsFor } from '@/lib/routes'

/** `/intern` — schaltet die Messung für dieses Gerät ab oder wieder an. Nicht verlinkt, kein Login. */
export const metadata: Metadata = {
  title: 'Internes Gerät — COOLiN ENERGY',
  robots: robotsFor(INTERN_HREF),
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <AuthPageShell
      title="Internes Gerät"
      lead="Geräte von COOLiN senden keine Analytics-Ereignisse, damit sie die Besucherzahlen nicht verfälschen."
    >
      <InternalDeviceToggle />
    </AuthPageShell>
  )
}
