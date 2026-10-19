import { Container, Section } from '@/components/ui/layout'
import { Schnellcheck } from '@/components/schnellcheck'
import { SCHNELLRECHNER_ANCHOR_ID } from '@/lib/nav'

/**
 * Schnellcheck direkt unter dem Hero — Ziel von „Ersparnis berechnen" in Hero und Header.
 *
 * Die Sprungmarke heisst weiter `schnellrechner`: Header- und Hero-Button zeigen darauf, und
 * bereits geteilte Links sollen nicht ins Leere laufen. Die Sektion hat keine eigene Überschrift,
 * deshalb trägt der Schnellcheck hier die des Prototyps.
 */
export function Schnellrechner() {
  return (
    <Section id={SCHNELLRECHNER_ANCHOR_ID} tone="alt">
      <Container>
        <div className="mx-auto max-w-[55rem]">
          <Schnellcheck showHeading />
        </div>
      </Container>
    </Section>
  )
}
