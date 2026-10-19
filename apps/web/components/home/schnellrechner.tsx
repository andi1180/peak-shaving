import { Container, Section } from '@/components/ui/layout'
import { QuickCalculator } from '@/components/quick-calculator'
import { SCHNELLRECHNER_ANCHOR_ID } from '@/lib/nav'

/**
 * Schnellrechner direkt unter dem Hero — Ziel von „Ersparnis berechnen" in Hero und Header.
 *
 * Keine eigene Überschrift: die Karte trägt ihren Titel selbst. Die Komponente ist unverändert
 * (Eingaben, Formel, Vorbelegung); hier wird nur ihr Ort auf der Startseite festgelegt.
 */
export function Schnellrechner() {
  return (
    <Section id={SCHNELLRECHNER_ANCHOR_ID} tone="alt">
      <Container>
        <div className="mx-auto max-w-2xl">
          <QuickCalculator />
        </div>
      </Container>
    </Section>
  )
}
