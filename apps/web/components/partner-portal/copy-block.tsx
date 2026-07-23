'use client'

/**
 * Ein Wert samt Kopier-Schaltfläche (B16-4b) — für den Empfehlungslink UND die Textvorlagen.
 *
 * EIN Baustein für beide, weil beide dasselbe leisten müssen: den Inhalt sichtbar zeigen, ihn
 * markierbar lassen und ihn auf Klick in die Zwischenablage legen. Zwei Fassungen liefen beim ersten
 * Fix auseinander — und der Fehlerfall (`navigator.clipboard` verweigert im unsicheren Kontext oder
 * ohne Nutzergeste) ist genau der, den man an der zweiten Stelle vergisst.
 *
 * Mechanik übernommen von `ReferralLink` (`components/admin/partner-forms.tsx`, B16-2), inklusive
 * der zwei Eigenschaften, die dort begründet sind:
 *   – Die Erfolgsmeldung wird für Screenreader ANGESAGT (`role="status"`); ein Icon-Wechsel wird
 *     nicht vorgelesen.
 *   – Ein FEHLGESCHLAGENES Kopieren steht als Text da und verweist auf das Markieren von Hand. Ein
 *     stiller Fehlschlag wäre hier teuer: Der Betrieb hielte einen leeren Zwischenspeicher für den
 *     Link und verschickte eine Aussendung ohne ihn.
 *
 * ⚠ Bewusst NICHT im Admin-Bereich wiederverwendet und umgekehrt: `ReferralLink` bleibt, wo er ist.
 * Das Portal liegt unter `app/(site)` mit eigenen Texten aus `messages/de.json`, der Admin-Bereich
 * hält seine deutschen Sätze im Code (T4-4-Konvention). Eine gemeinsame Komponente müsste beide
 * Welten bedienen und bekäme dafür genau die Prop-Flut, die man später nicht mehr auseinanderbaut.
 */
import * as React from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function CopyBlock({
  value,
  multiline = false,
  labels,
}: {
  value: string
  /** Mehrzeilige Texte (Vorlagen) werden in einem `<pre>` gezeigt, damit Absätze erhalten bleiben. */
  multiline?: boolean
  labels: { button: string; copied: string; copiedAnnounce: string; failed: string }
}) {
  const [copied, setCopied] = React.useState(false)
  const [failed, setFailed] = React.useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setFailed(false)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
      setFailed(true)
    }
  }

  return (
    <div>
      {multiline ? (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-surface-sunken p-3 font-sans text-small text-text">
          {value}
        </pre>
      ) : (
        <code className="block select-all break-all rounded-md border border-line bg-surface-sunken px-3 py-2 text-small text-text">
          {value}
        </code>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={copy}>
          {copied ? (
            <Check className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          ) : (
            <Copy className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          )}
          {copied ? labels.copied : labels.button}
        </Button>
      </div>

      <span role="status" aria-live="polite" className="sr-only">
        {copied ? labels.copiedAnnounce : ''}
      </span>

      {failed && <p className="mt-1.5 text-caption text-text-muted">{labels.failed}</p>}
    </div>
  )
}
