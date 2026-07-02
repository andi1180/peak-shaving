import { Calculator } from '@/components/flow/calculator'
import { SiteHeader } from '@/components/marketing/site-header'

// Öffentlicher Rechner (§5). Der Flow-State lebt client-seitig; kein Upload, kein Login.
export default function RechnerPage() {
  return (
    <div className="flex min-h-screen flex-col bg-surface-alt">
      <SiteHeader />
      <main className="flex-1">
        <Calculator />
      </main>
    </div>
  )
}
