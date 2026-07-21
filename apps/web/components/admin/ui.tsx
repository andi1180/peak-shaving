/**
 * Bausteine des Admin-Bereichs (T4-4).
 *
 * BEWUSST OHNE `'use client'`: keiner dieser Bausteine hält Zustand. So können sie sowohl von der
 * Server-Seite (Tabellen auf `app/admin/page.tsx`) als auch aus den Client-Formularen verwendet
 * werden — ein zweites, fast gleiches Set nur fürs Rendern wäre Verdopplung.
 *
 * ── WARUM NICHT `components/auth/form-parts.tsx` WIEDERVERWENDEN ─────────────────────────────────
 * `AuthField` ruft intern `useTranslations('Konto.shared')` (für die Passwort-Toggle-Beschriftung).
 * Der Admin-Bereich liegt außerhalb der next-intl-Struktur und hat keinen Nachrichtenkatalog — der
 * Aufruf ginge ins Leere. Die Felder hier sind daher eigenständig, folgen aber demselben Muster
 * (ein Hinweis-Slot, den der Fehler ERSETZT; `aria-invalid`/`aria-describedby` verdrahtet).
 *
 * Es gibt im Projekt keine Tabellen-Primitive (`components/ui/` hat Card/Button/Input, aber keine
 * Table) — die schlichten Tabellen-Teile unten sind deshalb neu, halten sich aber an die
 * bestehenden Tokens (`line`, `surface`, `text-small`, `tabular-nums` für Zahlen).
 */
import * as React from 'react'
import { FieldHint, Input, Label, Select } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/** Abschnitt mit Überschrift + optionaler Erklärung. */
export function AdminSection({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-12 first:mt-0">
      <h2 id={`${id}-title`} className="text-h4 text-ink">
        {title}
      </h2>
      {description && <p className="mt-1 max-w-prose text-small text-text-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

/** Umrandeter Block — dieselbe Optik wie die Karten auf der Kontoseite (Rand + Fläche, kein Schatten). */
export function AdminPanel({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-lg border border-line bg-surface p-4 sm:p-6', className)}>
      {children}
    </div>
  )
}

// ── Tabelle ──────────────────────────────────────────────────────────────────────────────────────
// Der Wrapper scrollt horizontal, statt die Seite zu sprengen (Muster wie die MDX-Tabellen in
// `components/wissen/mdx-components.tsx`).

export function AdminTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse text-left text-small">{children}</table>
    </div>
  )
}

export function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        'border-b border-line py-2 pr-4 text-caption font-semibold uppercase tracking-wide text-text-muted',
        className,
      )}
    >
      {children}
    </th>
  )
}

export function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={cn('border-b border-line py-3 pr-4 align-top text-text', className)}>
      {children}
    </td>
  )
}

/** Leerzustand einer Tabelle — sagt, dass nichts da ist, statt eine leere Fläche zu zeigen. */
export function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-6 text-small text-text-muted">
        {children}
      </td>
    </tr>
  )
}

/**
 * Kleine Zustandsmarkierung. `tone` trägt die Bedeutung, der TEXT trägt sie ebenfalls — Farbe ist
 * nie das einzige Merkmal (WCAG 1.4.1, wie die Netzebenen-Grafik im Wissen-Bereich).
 */
export function Pill({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'positive' | 'negative' | 'warning'
  children: React.ReactNode
}) {
  const tones = {
    neutral: 'border-line bg-surface-sunken text-text-muted',
    positive: 'border-positive bg-positive-subtle text-positive',
    negative: 'border-negative bg-negative-subtle text-negative',
    warning: 'border-warning-border bg-warning-subtle text-ink',
  } as const
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-caption font-medium',
        tones[tone],
      )}
    >
      {children}
    </span>
  )
}

// ── Formularteile ────────────────────────────────────────────────────────────────────────────────

/** Ein Eingabefeld mit Label und EINEM Hinweis-Slot (der Fehler ersetzt den Hilfetext). */
export function AdminField({
  id,
  name,
  label,
  type = 'text',
  defaultValue,
  placeholder,
  error,
  hint,
  required,
  inputMode,
  readOnly,
}: {
  id: string
  name: string
  label: string
  type?: string
  defaultValue?: string
  placeholder?: string
  error?: string
  hint?: React.ReactNode
  required?: boolean
  inputMode?: 'text' | 'numeric'
  /**
   * Sichtbar, aber nicht änderbar — und WEITERHIN MITGESCHICKT. Bewusst `readOnly` statt `disabled`:
   * ein deaktiviertes Feld sendet seinen Wert nicht, und genau dieser Wert (der Kurz-Key eines
   * Ziels) ist es, der den Datensatz identifiziert.
   */
  readOnly?: boolean
}) {
  const hintId = `${id}-hint`
  const showHint = Boolean(error) || Boolean(hint)
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-1.5">
        <Input
          id={id}
          name={name}
          type={type}
          defaultValue={defaultValue}
          placeholder={placeholder}
          required={required}
          inputMode={inputMode}
          readOnly={readOnly}
          className={readOnly ? 'bg-surface-sunken text-text-muted' : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={showHint ? hintId : undefined}
        />
      </div>
      {showHint && (
        <FieldHint id={hintId} tone={error ? 'error' : 'muted'}>
          {error ?? hint}
        </FieldHint>
      )}
    </div>
  )
}

/** Auswahlfeld mit Label und Hinweis-Slot — gleiche Form wie AdminField. */
export function AdminSelect({
  id,
  name,
  label,
  defaultValue,
  error,
  hint,
  children,
}: {
  id: string
  name: string
  label: string
  defaultValue?: string
  error?: string
  hint?: React.ReactNode
  children: React.ReactNode
}) {
  const hintId = `${id}-hint`
  const showHint = Boolean(error) || Boolean(hint)
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-1.5">
        <Select
          id={id}
          name={name}
          defaultValue={defaultValue}
          aria-invalid={error ? true : undefined}
          aria-describedby={showHint ? hintId : undefined}
        >
          {children}
        </Select>
      </div>
      {showHint && (
        <FieldHint id={hintId} tone={error ? 'error' : 'muted'}>
          {error ?? hint}
        </FieldHint>
      )}
    </div>
  )
}

/** Formular-weiter Fehler (role=alert). */
export function AdminError({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="rounded-md border border-negative bg-negative-subtle p-3">
      <p className="text-small font-medium text-negative">{children}</p>
    </div>
  )
}

/** Erfolgsmeldung (role=status, ruhig). */
export function AdminSuccess({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="rounded-md border border-line bg-surface-sunken p-3">
      <p className="text-small text-text-muted">{children}</p>
    </div>
  )
}

// ── Formatierung ─────────────────────────────────────────────────────────────────────────────────
// Feste Locale/Zeitzone: der Bereich ist intern und österreichisch. Ohne explizite Zeitzone
// formatierte der Server in UTC und der Browser in Ortszeit — dieselbe Zeile zeigte je nach
// Renderort eine andere Uhrzeit (Hydration-Abweichung inklusive).

const DATE_TIME = new Intl.DateTimeFormat('de-AT', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Vienna',
})

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : DATE_TIME.format(d)
}

/**
 * Nur das Datum — für Fristen (B1-3). Eine Löschfrist auf die Minute genau anzuzeigen behauptet eine
 * Genauigkeit, die sie nicht hat: sie ist eine abgeleitete Monatsrechnung, und entschieden wird
 * anhand des Tages.
 */
const DATE_ONLY = new Intl.DateTimeFormat('de-AT', {
  dateStyle: 'medium',
  timeZone: 'Europe/Vienna',
})

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : DATE_ONLY.format(d)
}
