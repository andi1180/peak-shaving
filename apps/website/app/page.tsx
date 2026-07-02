import { Hero } from '@/components/marketing/hero'
import { HowItWorks } from '@/components/marketing/how-it-works'
import { SiteFooter } from '@/components/marketing/site-footer'
import { SiteHeader } from '@/components/marketing/site-header'

// Öffentliche Marketing-Landingpage (§5/§6.1). Server-gerendert; nur der
// Energiefluss animiert (rein CSS). Alle Texte sind [MARTIN: Copy]-Platzhalter.
export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <HowItWorks />
      </main>
      <SiteFooter />
    </div>
  )
}
