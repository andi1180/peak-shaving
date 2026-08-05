'use client'

/**
 * Der Filter EINER Spalte — das kleine Symbol im Spaltenkopf und das Feld, das darunter aufgeht.
 *
 * ── DIE FILTER SIND WEITERHIN DIE ADRESSE ────────────────────────────────────────────────────────
 * Diese Datei hält KEINEN Filterzustand. Sie öffnet und schliesst ein Panel; darin steckt ein
 * echtes `<form method="get">`, das die Seite mit neuen Parametern neu lädt. Der gesamte
 * Filterzustand bleibt damit dort, wo er seit B1-3 liegt — in der URL: teilbar, per Zurück-Taste
 * erreichbar, nach einer Aktion wiederherstellbar. Ein Client-Zustand daneben wäre ein zweiter Ort
 * für dieselbe Wahrheit, und die beiden liefen beim ersten Seitenwechsel auseinander.
 *
 * ── WARUM DAS PANEL `fixed` POSITIONIERT IST UND NICHT `absolute` ────────────────────────────────
 * GEMESSEN, nicht abgeleitet: `AdminTable` legt die Tabelle in einen Container mit
 * `overflow-x-auto`. Sobald eine der beiden Overflow-Achsen nicht `visible` ist, rechnet der Browser
 * die andere von `visible` auf `auto` hoch — der Container schneidet also AUCH senkrecht. Ein
 * `absolute` positioniertes Panel im Spaltenkopf verschwände damit hinter dem Rand, sobald die
 * Liste wenige Zeilen hat: also ausgerechnet dann, wenn ein Filter bereits stark eingegrenzt hat
 * und man ihn korrigieren will.
 *
 * `fixed` entkommt dem Clipping (kein Vorfahr trägt `transform`/`filter`/`will-change` — im Browser
 * gegengeprüft). Der Preis ist, dass die Position beim Scrollen nicht mitwandert; deshalb schliesst
 * das Panel bei `scroll` und `resize`, statt neben seinem Knopf stehenzubleiben.
 *
 * ── DER NO-JS-KOMPROMISS, offengelegt ────────────────────────────────────────────────────────────
 * Ohne JavaScript öffnet sich das Panel nicht. Das ist eine bewusste Abweichung von der
 * B1-3-Bauweise (die grosse Filtersektion war ein reines GET-Formular ohne jede Client-Logik) und
 * kostet hier nichts: Der Admin-Bereich verlangt für Statuswechsel, Anonymisierung und den
 * Analysen-Upload ohnehin JavaScript. Was auch ohne JS gilt: JEDER Filter ist über die Adresse
 * setzbar, und die Liste zeigt die gesetzten Filter als abwählbare Marken oberhalb der Tabelle —
 * das Entfernen eines Filters ist ein gewöhnlicher Link.
 */

import * as React from 'react'
import { Filter } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Breite des Panels; als Konstante, weil die Einpassung in den Bildschirm damit rechnet. */
const PANEL_WIDTH = 264
/** Abstand zum Bildschirmrand. */
const EDGE = 8
/** Unterhalb dieser Resthöhe wird nach OBEN geklappt statt nach unten aufzugehen. */
const MIN_SPACE_BELOW = 220

/**
 * Wo das Panel sitzt. Entweder von oben oder von unten verankert — nie beides.
 *
 * `bottom` beim Aufklappen nach oben ist kein Stilmittel: Mit `top` müsste die Position die HÖHE
 * des Panels kennen, und die steht erst nach dem Rendern fest. Über `bottom` sitzt die Unterkante
 * exakt am Knopf, unabhängig davon, wie hoch der Inhalt ausfällt.
 */
type Placement = { left: number; maxHeight: number } & (
  | { top: number; bottom?: never }
  | { bottom: number; top?: never }
)

export function ColumnFilter({
  label,
  active,
  children,
}: {
  /** Name der Spalte — nur für Hilfstechnik, sichtbar steht er ohnehin daneben. */
  label: string
  /** Ist für diese Spalte gerade ein Filter gesetzt? Trägt die Farbe UND den Text (WCAG 1.4.1). */
  active: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const [pos, setPos] = React.useState<Placement | null>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)

  const place = React.useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return

    // Rechtsbündig am Knopf, aber nie über den Bildschirmrand hinaus: die hinteren Spalten stehen
    // bei 375 px weit rechts, und ein Panel, das dort herausragt, wäre nicht mehr bedienbar.
    const left = Math.max(
      EDGE,
      Math.min(rect.right - PANEL_WIDTH, window.innerWidth - PANEL_WIDTH - EDGE),
    )

    /*
     * ⚠ DIE SENKRECHTE EINPASSUNG IST PFLICHT, und der Grund ist gemessen: Die Tabelle steht auf
     * dieser Seite weit unten (darüber liegen zwei Job-Zeilen und die Zustellstatistik). Ohne
     * Klemmung ragt ein aufgehendes Panel unter den Bildschirmrand — sein „Übernehmen"-Knopf ist
     * dann nicht erreichbar, und weil das Panel `fixed` sitzt, holt ihn auch kein Scrollen zurück.
     *
     * Zwei Massnahmen: nach oben klappen, wenn unten zu wenig Platz ist, UND in jedem Fall eine
     * Höhengrenze mit eigenem Scrollbalken. Die Grenze allein genügte nicht (das Panel schrumpfte
     * am unteren Rand auf ein paar Pixel), das Klappen allein auch nicht (oben kann es ebenso eng
     * sein).
     */
    const spaceBelow = window.innerHeight - rect.bottom - EDGE * 2
    const spaceAbove = rect.top - EDGE * 2
    const below = spaceBelow >= MIN_SPACE_BELOW || spaceBelow >= spaceAbove

    const next: Placement = below
      ? { left, top: rect.bottom + 4, maxHeight: Math.max(120, spaceBelow) }
      : {
          left,
          bottom: window.innerHeight - rect.top + 4,
          maxHeight: Math.max(120, spaceAbove),
        }

    // Nur bei echter Änderung neu setzen: `place` läuft bei jedem Scroll-Ereignis, und ein neues
    // Objekt mit denselben Zahlen erzwänge jedes Mal ein Rendern.
    setPos((prev) =>
      prev &&
      prev.left === next.left &&
      prev.top === next.top &&
      prev.bottom === next.bottom &&
      prev.maxHeight === next.maxHeight
        ? prev
        : next,
    )
  }, [])

  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    /*
     * ⚠ NACHFÜHREN, NICHT SCHLIESSEN — und diese Entscheidung ist gemessen, nicht überlegt.
     *
     * Der erste Entwurf schloss das Panel bei `scroll` und `resize` (ein `fixed` positioniertes
     * Panel bliebe sonst stehen, während sein Knopf davonwandert). Im Browserlauf zeigte sich, dass
     * der Knopf scheinbar gar nicht reagiert. Die Ereignisfolge, mit einem MutationObserver
     * mitgeschrieben:
     *
     *     pointerdown → click → focus:INPUT → DIALOG-ADDED → scroll:#document → DIALOG-REMOVED
     *
     * Das Öffnen selbst löst also ein Dokument-Scrollen aus, und der eigene Listener nahm das
     * sofort wieder zurück. (`focus({preventScroll:true})` allein hat es nicht behoben — der Scroll
     * kam trotzdem.) Ein Panel, das sich beim Öffnen selbst schliesst, ist von „der Knopf ist
     * kaputt" nicht zu unterscheiden.
     *
     * Nachführen räumt die ganze Klasse ab: Die Position wird bei jedem Scroll neu aus dem
     * Trigger-Rechteck gerechnet, das Panel bleibt an seiner Spalte, und ein selbst ausgelöstes
     * Scrollen ist folgenlos. Scrollt der Knopf aus dem Bild, geht das Panel mit ihm — genau das
     * Verhalten, das man von einem angehefteten Feld erwartet.
     */
    const onMove = () => place()
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open, place])

  /*
   * Fokus ins erste Bedienelement — wer den Knopf mit der Tastatur erreicht hat, soll nicht erst
   * weitertabben müssen.
   *
   * ⚠ `preventScroll` IST HIER PFLICHT, NICHT KOSMETIK — im Browser gemessen: Das Panel liegt im
   * DOM innerhalb des `overflow-x-auto`-Containers von `AdminTable` (nur seine DARSTELLUNG ist
   * `fixed`). Ein gewöhnlicher `focus()` lässt den Browser die Vorfahren scrollen, um das Element
   * „ins Bild" zu holen — das feuert ein `scroll`-Ereignis, und der Listener oben schliesst das
   * Panel im selben Wimpernschlag wieder. Sichtbar war das als Knopf, der scheinbar nicht
   * reagiert: Der Klick wirkte, das Panel öffnete und schloss sich selbst.
   */
  React.useEffect(() => {
    if (!open) return
    const first = panelRef.current?.querySelector<HTMLElement>('input, select, button')
    first?.focus({ preventScroll: true })
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={active ? `Filter „${label}" ändern (gesetzt)` : `Nach „${label}" filtern`}
        onClick={() => {
          place()
          setOpen((v) => !v)
        }}
        className={cn(
          'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm outline-none transition-colors',
          'focus-visible:ring-2 focus-visible:ring-ring',
          active
            ? 'bg-accent-subtle text-accent'
            : 'text-text-muted hover:bg-surface-sunken hover:text-ink',
        )}
      >
        <Filter className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={active ? 2.5 : 2} />
      </button>

      {open && pos && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={`Filter: ${label}`}
          style={{
            position: 'fixed',
            top: pos.top,
            bottom: pos.bottom,
            left: pos.left,
            width: PANEL_WIDTH,
            maxHeight: pos.maxHeight,
          }}
          className="z-50 overflow-y-auto rounded-md border border-line bg-surface p-3 text-left shadow-lg"
        >
          <p className="mb-2 text-caption font-semibold uppercase tracking-wide text-text-muted">
            {label}
          </p>
          {children}
        </div>
      )}
    </>
  )
}
