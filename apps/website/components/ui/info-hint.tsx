'use client'

import { useId, useState, type ReactNode } from 'react'
import { Info, X } from 'lucide-react'

import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/**
 * Infobutton mit kurzer Erklärung — Delta 9, bindende Anforderung („insbesondere für
 * Privatkunden"), und die unmittelbare Anwendung von Prinzip 5: jede Kernzahl muss in ihrer
 * Rechenweise nachvollziehbar sein. Ein Feld, das ein Bäcker nicht versteht, füllt er falsch aus —
 * und die Rechnung darüber ist dann exakt so falsch, ohne dass es irgendjemandem auffällt.
 *
 * ── WARUM SELBST GEBAUT UND KEINE BIBLIOTHEK ────────────────────────────────────────────────────
 * Der Rechner hat heute weder eine Popover- noch eine Tooltip-Komponente (die `Tooltip`-Treffer im
 * Bestand sind ausnahmslos Recharts-Chart-Tooltips). Radix' Popover wäre eine zusätzliche
 * Abhängigkeit im öffentlichen Bündel für ein Auf- und Zuklappen ohne jede Positionierungs-Akrobatik:
 * die Erklärung steht IM Textfluss unter dem Feld und schiebt den Rest nach unten. Genau das ist auf
 * einem Telefon (mobile-first, §6.1) auch das bessere Verhalten — eine schwebende Blase über einem
 * schmalen Formular verdeckt das Feld, zu dem sie gehört.
 *
 * ── AUFKLAPPEN STATT HOVER, UND DAS IST KEINE GESCHMACKSFRAGE ───────────────────────────────────
 * Ein Hover-Tooltip existiert auf einem Touchgerät nicht. Der Auslöser ist deshalb ein echter
 * `<button>` mit `aria-expanded`/`aria-controls`; Tastatur und Screenreader bekommen dasselbe wie
 * die Maus, und die Erklärung ist ein normaler Absatz, kein `title`-Attribut.
 *
 * ── IM DRUCK IST DER KNOPF SINNLOS — DIE ERKLÄRUNG NICHT IMMER (Delta 16a) ──────────────────────
 * Auslöser und aufgeklappte Fläche sind `print:hidden`: ein Knopf auf Papier ist eine Requisite,
 * und ob die Erklärung im Ausdruck steht, hinge sonst davon ab, ob der Nutzer sie vor dem Drucken
 * zufällig aufgeklappt hatte — dasselbe Dokument sähe bei zwei Leuten verschieden aus.
 *
 * `printExplanation` kehrt das für EINZELNE Infobuttons um: die Erklärung erscheint dann im Druck
 * IMMER, unabhängig vom Aufklappzustand, als eigener Absatz (dieselbe Technik wie
 * `print-assumptions-snapshot.tsx`: `hidden print:block`). Der Knopf bleibt auch dann verborgen.
 *
 * Es ist bewusst ein OPT-IN und keine neue Voreinstellung: Delta 16a benennt genau eine Stelle, an
 * der die Erklärung mitdrucken soll (die Tarifoptimierungs-Karte). Alle übrigen Infobuttons sind
 * Formular-Hilfen zu Feldern, die im Druck gar nicht vorkommen — sie würden den Report mit
 * Erklärungen zu Nicht-Vorhandenem fluten.
 *
 * ── WHITE-LABEL ─────────────────────────────────────────────────────────────────────────────────
 * Auslöser und Erklärfläche laufen über `accent`/`accent-subtle` (§6.1) — kein Hex im Code, damit
 * die Partner-Akzentfarbe durchschlägt.
 */
export function InfoHint({
  label,
  children,
  before,
  printExplanation = false,
  className,
}: {
  /** Worauf sich die Erklärung bezieht — landet im `aria-label`; sonst hiesse jeder Knopf „Info". */
  label: string
  children: ReactNode
  /** Was links vom Knopf in derselben Zeile steht (die Feldbeschriftung, eine Überschrift, …). */
  before?: ReactNode
  /**
   * Delta 16a, Opt-in: die Erklärung erscheint im DRUCK immer — unabhängig davon, ob sie am
   * Bildschirm aufgeklappt ist. Nur dort setzen, wo der gedruckte Report die Aussage wirklich
   * braucht (s. Kopf); der Vorgabewert lässt das bestehende Verhalten unberührt.
   */
  printExplanation?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const id = useId()

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center gap-1.5">
        {before}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={id}
          aria-label={open ? `Erklärung zu ${label} schliessen` : `Erklärung zu ${label}`}
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-accent-subtle hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent print:hidden"
        >
          {open ? <X className="h-3.5 w-3.5" /> : <Info className="h-3.5 w-3.5" />}
        </button>
      </div>
      {open && (
        <p
          id={id}
          className="rounded-md border border-border bg-accent-subtle px-3 py-2 text-xs leading-relaxed text-text print:hidden"
        >
          {children}
        </p>
      )}
      {/*
        Druck-Pendant (Delta 16a). Eigener Absatz statt einer Umschaltung des obigen: der obige
        hängt an `open`, und genau diese Abhängigkeit soll im Druck nicht bestehen. Kein `id` —
        `aria-controls` oben zeigt weiterhin auf den interaktiven Absatz, und zwei Elemente mit
        derselben Kennung wären ungültiges HTML.
      */}
      {printExplanation && (
        <p className="hidden rounded-md border border-border bg-accent-subtle px-3 py-2 text-xs leading-relaxed text-text print:block print:break-inside-avoid">
          {children}
        </p>
      )}
    </div>
  )
}

/**
 * Feldbeschriftung mit Infobutton daneben — der Regelfall im Formular.
 *
 * Der Knopf steht bewusst NEBEN dem `<label>` und nicht darin: ein Klick auf ein Label leitet den
 * Fokus an sein Feld weiter, der Infobutton wäre dann nicht mehr zu treffen.
 */
export function LabelWithInfo({
  htmlFor,
  label,
  children,
}: {
  htmlFor: string
  label: string
  children: ReactNode
}) {
  return (
    <InfoHint label={label} before={<Label htmlFor={htmlFor}>{label}</Label>}>
      {children}
    </InfoHint>
  )
}
