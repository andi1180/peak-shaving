'use client'

/**
 * B24 — DER CHAT-SCHIRM EINES PROJEKTS (achter Bauschritt).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ HIER WIRD DER ENDPUNKT AUS DEM SIEBTEN BAUSCHRITT ZUM ERSTEN MAL IMPORTIERT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Der dortige Bericht hält gemessen fest: `'use server'` allein erzeugt KEINEN Endpunkt — Next
 * schüttelt ein Modul weg, das nichts im App-Graphen importiert (`server-reference-manifest.json`:
 * 44 Actions, davon aus `chat.ts` NULL). Diese Datei ist der erste Importeur; mit ihr ist
 * `sendProjectChatMessage` als Server Action registriert und über ihre Kennung aufrufbar. Die
 * Kostenbremse (Delta §6.3) ist die Bedingung, unter der das passieren durfte, und sie steht.
 *
 * ── DER VERLAUF ZEIGT AUSSCHLIESSLICH `user`- UND `assistant`-TEXT ────────────────────────────
 * Die Auswahl trifft `lib/project-chat/transcript.ts` SERVERSEITIG, und diese Datei bekommt schon
 * fertige Einträge. `tool_call`/`tool_result` sind interne Verdrahtung — sie tragen Fehlercodes,
 * Werkzeugnamen und Contract-Feldnamen (`energyPriceCtPerKwh`, `_provenance`) und keinen Satz, den
 * ein Kunde lesen soll. Sie hier zu filtern wäre eine zweite Auslegung derselben Frage.
 *
 * ── DIE OPTIMISTISCHE BLASE TRÄGT GENAU DAS, WAS SPÄTER AUCH DASTEHT ──────────────────────────
 * Angezeigt wird der getippte Text und sonst nichts. Der Anhang-Vermerk, den `agent.ts` als
 * ZWEITEN Block an dieselbe Nutzer-Zeile hängt, erscheint nirgends — `visibleTranscript` liest von
 * einer Nutzer-Zeile ausdrücklich nur Block 0. Ohne diese Regel stünde nach einem Neuladen eine
 * andere (längere, mit rohen Kennungen gespickte) Fassung derselben Nachricht da als vorher.
 *
 * ── KEIN STREAMING ────────────────────────────────────────────────────────────────────────────
 * Ein Turn kann mehrere Sekunden dauern (bis zu acht Werkzeugaufrufe, Delta §3.1). Die Seite darf
 * dabei nicht eingefroren wirken: Eingabe und Knopf sind gesperrt, daneben läuft eine Sekundenzahl
 * in einem `role="status"`. Das ist kein Fortschrittsbalken — wie lange es dauert, weiss vorher
 * niemand, und ein Balken, der bei 80 % stehenbleibt, ist schlechter als eine ehrliche Uhr.
 */
import * as React from 'react'
import { Loader2, Paperclip } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { ChatMarkdown } from '@/components/kalkulator/chat-markdown'
import { Button } from '@/components/ui/button'
import { Label, Textarea } from '@/components/ui/input'
import { sendProjectChatMessage } from '@/lib/project-chat/chat'
import type { TranscriptEntry } from '@/lib/project-chat/transcript'
import { uploadProjectDocumentAction } from '@/lib/project-documents/actions'

export interface ChatDocument {
  id: string
  filename: string
}

/**
 * Die Ausgänge, nach denen NACHWEISLICH keine Nachricht gespeichert wurde.
 *
 * ⚠ Das ist keine Kosmetik, sondern die Frage „darf ich den getippten Text wegwerfen?". `agent.ts`
 * ruft `appendMessage` erst NACH Eigentumsprüfung und Kostenbremse; diese fünf Ausgänge liegen
 * allesamt davor (`invalid_attachments` und `network` erreichen die Schleife gar nicht). Danach
 * gibt es die Zeile im Verlauf NICHT — die optimistische Blase wird deshalb zurückgenommen und der
 * Text steht wieder im Eingabefeld, samt der hochgeladenen Unterlagen, die noch niemand gesehen
 * hat.
 *
 * Umgekehrt bei `ok`, `tool_limit`, `model_error`, `not_configured`, `storage_error`: dort steht
 * die Nutzer-Zeile bereits im Verlauf. Sie hier wegzunehmen hiesse, dass ein Neuladen sie
 * zurückbringt — und ein erneutes Senden desselben Textes erzeugte eine zweite.
 */
const ROLLBACK_STATUSES = new Set([
  'not_found',
  'empty_message',
  'limit_reached',
  'limit_unavailable',
  'invalid_attachments',
  'network',
])

export function ProjectChat({
  projectId,
  initialTranscript,
  initialDocuments,
}: {
  projectId: string
  initialTranscript: TranscriptEntry[]
  initialDocuments: ChatDocument[]
}) {
  const t = useTranslations('Projekte.chat')
  const tStatus = useTranslations('Projekte.status')
  const tUpload = useTranslations('Projekte.upload')

  const [entries, setEntries] = React.useState<TranscriptEntry[]>(initialTranscript)
  const [draft, setDraft] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const [elapsed, setElapsed] = React.useState(0)
  /** Ein AUFGELÖSTER Satz, kein Key — `limit_reached` braucht die zwei Zahlen der Antwort. */
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null)

  const [documents, setDocuments] = React.useState<ChatDocument[]>(initialDocuments)
  /**
   * Die in DIESER Sitzung hochgeladenen Kennungen, die noch mit keinem Turn übergeben wurden.
   *
   * Sie werden bewusst NICHT dauerhaft gemerkt: „neu hochgeladen" ist eine Aussage über GENAU
   * diesen Turn (Delta §3.2 — nach der dritten Rechnung stünden sonst drei ununterscheidbare
   * Zeilen im Vermerk). Nach einem Neuladen ist die Datei im Projekt hinterlegt und steht im
   * Zustandsblock; sie ist dann nicht mehr „gerade eben dazugekommen".
   */
  const [attached, setAttached] = React.useState<string[]>([])
  const [uploading, setUploading] = React.useState(false)
  const [uploadError, setUploadError] = React.useState<string | null>(null)

  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const bottomRef = React.useRef<HTMLDivElement>(null)
  const inputId = `chat-${React.useId()}`

  // Der Verlauf wächst nach unten — ohne das führte jede Antwort aus dem Bild heraus.
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [entries, pending])

  // Die Sekundenzahl läuft NUR, solange ein Turn läuft; danach wird der Zähler zurückgesetzt,
  // damit die nächste Anfrage nicht bei der Zahl der vorigen beginnt.
  React.useEffect(() => {
    if (!pending) return
    setElapsed(0)
    const started = Date.now()
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000))
    }, 1000)
    return () => window.clearInterval(id)
  }, [pending])

  async function handleUpload(file: File) {
    setUploadError(null)
    setUploading(true)
    try {
      const formData = new FormData()
      formData.set('file', file)
      const result = await uploadProjectDocumentAction(projectId, formData)
      if (!result.ok) {
        setUploadError(tUpload(`errors.${result.reason}`))
        return
      }
      /*
       * Der Dateiname kommt hier aus dem `File`-Objekt, weil die Action nur die Kennung
       * zurückgibt. Für die ANZEIGE genügt das — der Name, den `agent.ts` in den Vermerk schreibt,
       * kommt unabhängig davon aus der Datenbank (Auflage aus dem Kopf von `buildAttachmentNote`).
       */
      setDocuments((prev) => [...prev, { id: result.documentId, filename: file.name }])
      setAttached((prev) => [...prev, result.documentId])
    } catch (error) {
      console.error('[projekt-chat] upload:', error)
      setUploadError(tUpload('errors.network'))
    } finally {
      setUploading(false)
      // Sonst löst dieselbe Datei ein zweites Mal kein `change`-Ereignis aus.
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleSend() {
    const text = draft.trim()
    if (text === '' || pending) return

    const sentAttachments = attached
    setDraft('')
    setAttached([])
    setStatusMessage(null)
    setEntries((prev) => [...prev, { role: 'user', text }])
    setPending(true)

    try {
      const result = await sendProjectChatMessage(projectId, text, sentAttachments)

      if (result.status === 'ok') {
        // `reply` kann leer sein (das Modell hat nur Werkzeuge gerufen). Dann bleibt keine leere
        // Blase stehen, sondern derselbe Hinweis wie bei `tool_limit` — es gibt kein Schlusswort.
        if (result.reply.trim() !== '') {
          setEntries((prev) => [...prev, { role: 'assistant', text: result.reply }])
        } else {
          setStatusMessage(tStatus('tool_limit'))
        }
        return
      }

      setStatusMessage(
        result.status === 'limit_reached'
          ? tStatus('limit_reached', { used: result.used, max: result.max })
          : tStatus(result.status),
      )

      if (ROLLBACK_STATUSES.has(result.status)) {
        setEntries((prev) => prev.slice(0, -1))
        setDraft(text)
        setAttached(sentAttachments)
      }
    } catch (error) {
      /*
       * Ein Wurf hier heisst: die Anfrage hat den Server nicht erreicht oder die Antwort nicht
       * zurück (Netz, Neustart). Die Schleife selbst wirft nicht — sie beantwortet jeden Fehler
       * als Status. Behandelt wie die übrigen „nichts gespeichert"-Fälle, weil ein nie
       * angekommener Aufruf nichts hinterlassen haben kann.
       */
      console.error('[projekt-chat] sendProjectChatMessage:', error)
      setStatusMessage(tStatus('network'))
      setEntries((prev) => prev.slice(0, -1))
      setDraft(text)
      setAttached(sentAttachments)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-label={t('assistant')} className="rounded-lg border border-line bg-surface p-4 sm:p-6">
        {entries.length === 0 ? (
          <p className="text-small text-text-muted">{t('emptyTranscript')}</p>
        ) : (
          <ol className="flex flex-col gap-4">
            {entries.map((entry, index) => (
              // Der Index ist hier der richtige Schlüssel: der Verlauf wird ausschliesslich
              // angehängt (und im Fehlerfall am Ende zurückgenommen) — es wird nie umsortiert.
              <li
                key={index}
                className={entry.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
              >
                <div
                  className={
                    entry.role === 'user'
                      ? 'max-w-[85%] rounded-lg bg-accent-subtle px-4 py-3'
                      : 'max-w-[85%] rounded-lg bg-surface-sunken px-4 py-3'
                  }
                >
                  <p className="text-caption font-medium uppercase text-text-muted">
                    {entry.role === 'user' ? t('you') : t('assistant')}
                  </p>
                  {/*
                    * ⚠ ZWEI DARSTELLUNGEN, UND DAS IST KEINE KOSMETIK.
                    *
                    * Die Antwort des Modells ist Markdown (es formatiert von sich aus — der
                    * System-Prompt sagt dazu nichts) und wird als solches gerendert; bis zum
                    * neunten Bauschritt standen `**` und Listenpunkte wörtlich in der Blase.
                    *
                    * Die Nachricht des Kunden bleibt Plaintext mit `whitespace-pre-wrap`. Er
                    * schreibt kein Markdown; seine eigenen Zeichen — ein `*` in „3*5 kWh", eine
                    * Zeile, die mit „1." beginnt — würden seinen Satz sonst umformatieren, und
                    * seine Absätze gingen dabei verloren. Was er getippt hat, muss dastehen, wie
                    * er es getippt hat.
                    */}
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
          <div
            role="status"
            aria-live="polite"
            className="mt-4 flex items-center gap-2 text-small text-text-muted"
          >
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
            <span>{t('sending')}</span>
            <span className="tabular-nums">{t('elapsed', { seconds: elapsed })}</span>
          </div>
        )}
        {pending && <p className="mt-1 text-caption text-text-muted">{t('sendingHint')}</p>}

        <div ref={bottomRef} />
      </section>

      {statusMessage && (
        <div role="alert" className="rounded-md border border-warning-border bg-warning-subtle p-4">
          <p className="text-small text-ink">{statusMessage}</p>
        </div>
      )}

      <section className="rounded-lg border border-line bg-surface p-4 sm:p-6">
        <Label htmlFor={inputId}>{t('inputLabel')}</Label>
        <div className="mt-1.5">
          <Textarea
            id={inputId}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter macht einen Absatz — der Kunde beschreibt hier einen Betrieb, nicht eine
              // Chatzeile. Cmd/Strg+Enter sendet, wie in jedem anderen mehrzeiligen Eingabefeld.
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void handleSend()
              }
            }}
            placeholder={t('placeholder')}
            rows={4}
            disabled={pending}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => void handleSend()}
            disabled={pending || draft.trim() === ''}
          >
            {pending && (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
            )}
            {pending ? t('sending') : t('send')}
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || pending}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
            ) : (
              <Paperclip className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            )}
            {uploading ? tUpload('uploading') : tUpload('button')}
          </Button>

          {/*
            * Kein `accept`: Der Bucket nimmt bewusst jeden Dokumenttyp an (`allowed_mime_types =
            * null`, Delta §3.2) — der Kunde soll hochladen, was er hat, und die Zuordnung trifft
            * das Modell. Ein Filter hier wiese Dateien ab, die die Anwendung verarbeiten kann.
            */}
          <input
            ref={fileInputRef}
            type="file"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void handleUpload(file)
            }}
          />
        </div>

        <p className="mt-3 text-caption text-text-muted">{t('hint')}</p>
      </section>

      <section className="rounded-lg border border-line bg-surface p-4 sm:p-6">
        <h2 className="text-h4 text-ink">{tUpload('title')}</h2>
        <p className="mt-1 text-small text-text-muted">{tUpload('lead')}</p>

        {uploadError && (
          <p role="alert" className="mt-3 text-small font-medium text-negative">
            {uploadError}
          </p>
        )}

        {documents.length === 0 ? (
          <p className="mt-3 text-small text-text-muted">{tUpload('empty')}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {documents.map((document) => (
              <li key={document.id} className="text-small text-ink">
                <span className="break-words">{document.filename}</span>
                {attached.includes(document.id) && (
                  <span className="ml-2 text-caption text-text-muted">
                    {tUpload('attachedHint')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 text-caption text-text-muted">{tUpload('privacy')}</p>
      </section>
    </div>
  )
}
