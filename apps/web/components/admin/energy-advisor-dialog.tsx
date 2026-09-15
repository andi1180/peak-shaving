'use client'

/**
 * Der Energieberater als Popup — die Oberfläche zum Endpunkt aus `energy-advisor-chat.ts` (B24,
 * Station 6/7). Vorbild ist `components/kalkulator/project-chat.tsx`, aber ohne dessen
 * Dokument-Upload: der Energieberater liest keine Dokumente, er prüft die bereits erfassten Angaben
 * des Projekts gegen den Lastgang. Kein Kostenlimit-Anzeigetext — der Endpunkt hat noch keine eigene
 * Kostenbremse (er teilt sich `agent.ts`s Bremse mit dem Kunden-Chat), eine eigene Anzeige dafür ist
 * ein späterer, eigener Schritt.
 *
 * ⚠ DEUTSCHER TEXT IM CODE, NICHT `next-intl` — anders als `project-chat.tsx`. Der Admin-Bereich
 * liegt ausserhalb der next-intl-Struktur (Muster `components/admin/ui.tsx`).
 */
import * as React from 'react'
import { Loader2 } from 'lucide-react'

import { AdminError } from '@/components/admin/ui'
import { ChatMarkdown } from '@/components/kalkulator/chat-markdown'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label, Textarea } from '@/components/ui/input'
import { energyAdvisorTriggerLabel } from '@/lib/admin/energy-advisor'
import { sendEnergyAdvisorMessage } from '@/lib/project-chat/energy-advisor-chat'
import type { TranscriptEntry } from '@/lib/project-chat/transcript'

/**
 * Die Ausgänge, nach denen NACHWEISLICH keine Nachricht gespeichert wurde — Muster
 * `ROLLBACK_STATUSES` aus `project-chat.tsx`, hier ohne `invalid_attachments` (dieser Endpunkt kennt
 * keine Anhänge).
 */
const ROLLBACK_STATUSES = new Set(['not_found', 'empty_message', 'limit_reached', 'limit_unavailable', 'network'])

/** Fester Text des automatischen Erstaufrufs — kein Nutzer-Eingabefeld beteiligt. */
const AUTO_START_MESSAGE = 'Bitte prüfen Sie alle Angaben dieses Projekts.'

function statusMessage(status: string, extra?: { used: number; max: number }): string {
  switch (status) {
    case 'not_found':
      return 'Dieses Projekt gibt es nicht mehr.'
    case 'empty_message':
      return 'Bitte schreiben Sie etwas, bevor Sie senden.'
    case 'limit_reached':
      return extra
        ? `Tageslimit erreicht. In den letzten 24 Stunden wurden ${extra.used} von ${extra.max} Nachrichten verbraucht.`
        : 'Tageslimit erreicht.'
    case 'limit_unavailable':
      return 'Die Nachricht konnte gerade nicht angenommen werden. Bitte versuchen Sie es gleich noch einmal.'
    case 'not_configured':
      return 'Der Assistent ist gerade nicht verfügbar.'
    case 'model_error':
      return 'Der Assistent hat nicht geantwortet. Bitte versuchen Sie es noch einmal.'
    case 'storage_error':
      return 'Die Nachricht konnte nicht gespeichert werden. Bitte versuchen Sie es noch einmal.'
    case 'tool_limit':
      return 'Der Assistent hat sehr viel nachgesehen und ist noch nicht fertig. Schreiben Sie ihm kurz, woran er weitermachen soll.'
    default:
      return 'Verbindung unterbrochen. Bitte versuchen Sie es noch einmal.'
  }
}

export function EnergyAdvisorDialog({
  projectId,
  initialTranscript,
}: {
  projectId: string
  initialTranscript: TranscriptEntry[]
}) {
  const [open, setOpen] = React.useState(false)
  const [entries, setEntries] = React.useState<TranscriptEntry[]>(initialTranscript)
  const [draft, setDraft] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const [statusText, setStatusText] = React.useState<string | null>(null)
  const bottomRef = React.useRef<HTMLDivElement>(null)
  const inputId = React.useId()
  const autoStartTriggeredRef = React.useRef(false)

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [entries, pending])

  // Nur beim allerersten Öffnen ohne Verlauf; ein Wiederöffnen mit bestehendem Verlauf löst nichts aus.
  React.useEffect(() => {
    if (!open) {
      autoStartTriggeredRef.current = false
      return
    }
    if (autoStartTriggeredRef.current || entries.length > 0) return
    autoStartTriggeredRef.current = true

    const text = AUTO_START_MESSAGE
    setStatusText(null)
    setEntries((prev) => [...prev, { role: 'user', text }])
    setPending(true)

    void (async () => {
      try {
        const result = await sendEnergyAdvisorMessage(projectId, text)

        if (result.status === 'ok') {
          if (result.reply.trim() !== '') {
            setEntries((prev) => [...prev, { role: 'assistant', text: result.reply }])
          } else {
            setStatusText(statusMessage('tool_limit'))
          }
          return
        }

        setStatusText(
          statusMessage(result.status, result.status === 'limit_reached' ? result : undefined),
        )
        if (ROLLBACK_STATUSES.has(result.status)) {
          setEntries((prev) => prev.slice(0, -1))
        }
      } catch (error) {
        console.error('[energy-advisor-dialog] sendEnergyAdvisorMessage:', error)
        setStatusText(statusMessage('network'))
        setEntries((prev) => prev.slice(0, -1))
      } finally {
        setPending(false)
      }
    })()
  }, [open, entries.length, projectId])

  async function handleSend() {
    const text = draft.trim()
    if (text === '' || pending) return

    setDraft('')
    setStatusText(null)
    setEntries((prev) => [...prev, { role: 'user', text }])
    setPending(true)

    try {
      const result = await sendEnergyAdvisorMessage(projectId, text)

      if (result.status === 'ok') {
        if (result.reply.trim() !== '') {
          setEntries((prev) => [...prev, { role: 'assistant', text: result.reply }])
        } else {
          setStatusText(statusMessage('tool_limit'))
        }
        return
      }

      setStatusText(
        statusMessage(result.status, result.status === 'limit_reached' ? result : undefined),
      )
      if (ROLLBACK_STATUSES.has(result.status)) {
        setEntries((prev) => prev.slice(0, -1))
        setDraft(text)
      }
    } catch (error) {
      console.error('[energy-advisor-dialog] sendEnergyAdvisorMessage:', error)
      setStatusText(statusMessage('network'))
      setEntries((prev) => prev.slice(0, -1))
      setDraft(text)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" size="md">
          {energyAdvisorTriggerLabel(initialTranscript)}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col">
        <DialogTitle>KI-Prüfung</DialogTitle>
        <p className="mt-1 text-small text-text-muted">
          Der Assistent prüft die bereits erfassten Angaben dieses Projekts und stellt Rückfragen.
        </p>

        <div className="mt-4 flex-1 overflow-y-auto rounded-lg border border-line bg-surface-sunken p-4">
          {entries.length === 0 ? (
            <p className="text-small text-text-muted">Noch keine Nachrichten.</p>
          ) : (
            <ol className="flex flex-col gap-4">
              {entries.map((entry, index) => (
                // Der Verlauf wird ausschliesslich angehängt (und im Fehlerfall am Ende
                // zurückgenommen) — der Index ist hier der richtige Schlüssel.
                <li
                  key={index}
                  className={entry.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
                >
                  <div
                    className={
                      entry.role === 'user'
                        ? 'max-w-[85%] rounded-lg bg-accent-subtle px-4 py-3'
                        : 'max-w-[85%] rounded-lg bg-surface px-4 py-3'
                    }
                  >
                    <p className="text-caption font-medium uppercase text-text-muted">
                      {entry.role === 'user' ? 'Sie' : 'Assistent'}
                    </p>
                    {entry.role === 'user' ? (
                      <p className="mt-1 whitespace-pre-wrap break-words text-body text-ink">
                        {entry.text}
                      </p>
                    ) : (
                      <div className="mt-1">
                        <ChatMarkdown text={entry.text} />
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}

          {pending && (
            <div role="status" aria-live="polite" className="mt-4 flex items-center gap-2 text-small text-text-muted">
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
              <span>Antwort wird erstellt …</span>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {statusText && <AdminError>{statusText}</AdminError>}

        <div className="mt-4">
          <Label htmlFor={inputId}>Ihre Nachricht</Label>
          <div className="mt-1.5">
            <Textarea
              id={inputId}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  void handleSend()
                }
              }}
              placeholder="Nachricht schreiben …"
              rows={3}
              disabled={pending}
            />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => void handleSend()}
              disabled={pending || draft.trim() === ''}
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />}
              {pending ? 'Senden …' : 'Senden'}
            </Button>
            <Button type="button" variant="secondary" size="md" onClick={() => setOpen(false)}>
              Schliessen
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
