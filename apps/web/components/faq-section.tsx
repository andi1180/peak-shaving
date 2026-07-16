import { Container, Section } from '@/components/ui/layout'
import { JsonLd } from '@/components/json-ld'
import { faqPageLd } from '@/lib/json-ld'

/**
 * Die FAQ-Sektion — EINE Struktur für Branchenseiten UND Wissen-Artikel.
 *
 * HERKUNFT: Das war bis zu diesem Schritt eine lokale Funktion in
 * `components/branche/branche-page.tsx`. Sie ist hierher gewandert, statt für
 * den Wissen-Bereich ein zweites Mal geschrieben zu werden — der Grund ist nicht
 * Zeilenersparnis, sondern §6.4: Ein späterer `FAQPage`-JSON-LD soll GENAU EINE
 * Markup-Wahrheit haben. Zwei Kopien wären zwei Gelegenheiten, dass die
 * strukturierten Daten und das sichtbare HTML auseinanderlaufen.
 *
 * BEWUSST KEIN ACCORDION, obwohl `components/ui/accordion.tsx` bereitliegt:
 * Radix hängt geschlossene Inhalte aus dem DOM aus. Die Antworten stünden dann
 * nicht im ausgelieferten HTML — für Seiten, deren Zweck Ranking ist
 * (Problem-Intent §5.3, Info-Intent §6.2), wäre das genau der falsche Preis für
 * eine Animation. Ein `FAQPage`-JSON-LD, dessen Antworten im HTML fehlen, ist
 * zudem ein Google-Richtlinienverstoß, kein Kavaliersdelikt.
 *
 * Die Datenstruktur (`{ q, a }`) ist bei beiden Aufrufern identisch: Die
 * Branchen liefern sie aus `messages/de.json`, die Artikel aus ihrem Frontmatter
 * (`lib/wissen.ts`). Beide Wege enden in derselben Liste.
 *
 * DAS `FAQPage`-JSON-LD (§6.4) IST JETZT HIER — genau dafür wurde die Komponente
 * herausgezogen. Es liest `items`, also DENSELBEN String im DERSELBEN Render wie
 * die sichtbare Liste darunter. Damit ist Googles Bedingung („markup must match
 * the visible content") nicht eingehalten, sondern strukturell unverletzbar: Es
 * gibt keine zweite Stelle, an der eine Frage anders lauten könnte. Ein
 * `FAQPage`, dessen Antworten von der Seite abweichen, ist ein
 * Richtlinienverstoß — kein Schönheitsfehler.
 *
 * EINMAL PRO SEITE: Beide Aufrufer rendern genau eine FAQ-Sektion. Stünden zwei
 * auf einer Seite, entstünden zwei `FAQPage`-Knoten für ein Dokument — dann
 * gehört das Markup nach oben in die jeweilige Seite gezogen, nicht hier
 * dupliziert.
 */
export type FaqItem = { q: string; a: string }

export function FaqSection({
  title,
  items,
  tone = 'default',
}: {
  title: string
  items: FaqItem[]
  /** Der Sektionsgrund. Die Seiten wechseln weiß/alt — das entscheidet der Aufrufer. */
  tone?: 'default' | 'alt'
}) {
  if (items.length === 0) return null

  return (
    <Section tone={tone}>
      <Container>
        {/* Aus derselben `items`-Liste wie die sichtbaren Q&A unten — s. Kopf. */}
        <JsonLd schema={faqPageLd(items)} />
        <h2 className="max-w-prose text-h2 text-ink">{title}</h2>

        <ul className="mt-8 max-w-prose space-y-8">
          {items.map((item) => (
            <li key={item.q} className="border-t border-line pt-4">
              <h3 className="text-h4 text-ink">{item.q}</h3>
              <p className="mt-2 text-body text-text-muted">{item.a}</p>
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  )
}
