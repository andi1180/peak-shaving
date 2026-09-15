import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container } from '@/components/ui/layout'
import { AdminError, AdminPanel, AdminSection, formatDate } from '@/components/admin/ui'
import { SystemPromptExtensionForm } from '@/components/admin/system-prompt-extension-form'
import {
  PROMPT_EXTENSION_KINDS,
  PROMPT_EXTENSION_KIND_LABELS,
  readPromptExtension,
  type PromptExtension,
  type PromptExtensionKind,
} from '@/lib/admin/system-prompt-extensions'

/*
 * `/admin/ki-prompts` — die Pflege der zwei System-Prompt-Erweiterungen (Delta §4).
 *
 * ── WAS HIER GEPFLEGT WIRD, UND WAS AUSDRÜCKLICH NICHT ────────────────────────────────────────
 * Die Kern-Prompts stehen im Anwendungscode (`lib/project-chat/system-prompt.ts`) und tragen die
 * Verhaltensanforderungen des Deltas — sie sind NICHT über diese Seite änderbar. Was hier steht,
 * ist Ton und Feinschliff: der Teil, den ein Admin ohne PR anfassen können soll. Der Text ERGÄNZT
 * den Kern-Prompt; er ersetzt ihn nicht.
 *
 * ── ZWEI KETTEN, ZWEI ABSCHNITTE ──────────────────────────────────────────────────────────────
 * `kunde` führt das Gespräch mit dem Kunden, `ki_check` das admin-interne Energieberater-Gespräch.
 * In der Datenbank sind es zwei unabhängige Ketten derselben Tabelle (Spalte `kind`, Migration
 * `20260915120000`): je datierte Stände, je genau einer offen, je eine eigene Ordnungspflicht.
 * Hier stehen sie nebeneinander statt hinter einem Umschalter — wer den einen Text ändert, soll
 * den anderen dabei lesen können.
 *
 * ── GELESEN UND GESCHRIEBEN WIRD ÜBER DEN ANGEMELDETEN CLIENT ─────────────────────────────────
 * Beide Wrapper sind `authenticated`-only und prüfen `platform.is_admin()` selbst im Rumpf; ohne
 * Adminrolle werfen sie mit 42501. Kein `service_role` — Begründung in voller Länge im Kopf von
 * `lib/admin/system-prompt-extensions-actions.ts`.
 *
 * Der `isCurrentUserAdmin()`-Guard unten ist trotzdem kein Beiwerk: Er verhindert, dass diese Seite
 * für einen Nicht-Admin überhaupt ENTSTEHT (sonst landete ihr Aufbau im Flight-Payload, s.
 * `lib/admin/guard.ts`). Die eigentliche Durchsetzung bleibt die Datenbank.
 *
 * ── KEIN LÖSCHWEG, KEINE TERMINIERUNG, KEINE HISTORIE ─────────────────────────────────────────
 * Es gibt für diese Tabelle bewusst keinen Löschweg (Tabellenkommentar) — auch kein Leerfeld
 * schaltet ab. Ein Beginn in der Zukunft wird von hier aus nicht gesetzt, und abgelöste Fassungen
 * werden nicht aufgelistet: Beides wäre ein eigener Ausbau mit eigener Anzeige, nicht ein Feld
 * nebenbei.
 */

export const dynamic = 'force-dynamic'

/** Neutral wie im Layout: der Tab-Titel darf nicht verraten, dass es hier etwas zu holen gibt. */
export const metadata: Metadata = {
  title: 'COOLiN ENERGY',
  robots: { index: false, follow: false },
}

/**
 * Was unter dem Eingabefeld steht.
 *
 * ⚠ DIE LESBARKEITS-WARNUNG GILT FÜR BEIDE ARTEN, und das ist keine Übervorsicht. Der Lesepfad des
 * Chats (`public.get_system_prompt_extension`) ist EINE `authenticated`-only Funktion mit einem
 * `p_kind`-Parameter — der Grant kennt die Art nicht. Jede angemeldete Sitzung kann damit AUCH den
 * Energieberater-Text abrufen, obwohl ihn keine Kundenoberfläche zeigt. Der Wortlaut für den
 * Kunden-Chat ist aus dem Funktionskommentar übernommen; der zweite sagt dieselbe Tatsache für die
 * Stelle, an der sie weniger offensichtlich ist.
 */
const HINTS: Record<PromptExtensionKind, string> = {
  kunde:
    'Dieser Text ist für jede angemeldete Kundensitzung lesbar — kein vertraulicher Inhalt. Er ' +
    'ergänzt den Kern-Prompt des Kunden-Chats und ersetzt ihn nicht.',
  ki_check:
    'Dieser Text führt das interne Energieberater-Gespräch. ⚠ Auch er ist für jede angemeldete ' +
    'Sitzung abrufbar (der Lesepfad ist derselbe wie beim Kunden-Chat, nur mit anderem Parameter) ' +
    '— kein vertraulicher Inhalt.',
}

export default async function AdminPromptExtensionsPage() {
  if (!(await isCurrentUserAdmin())) return null

  const supabase = await createClient()

  /*
   * Zwei Aufrufe, parallel: Die zwei Ketten wissen nichts voneinander, und ein Wrapper, der beide
   * lieferte, gibt es nicht. Ein Lesefehler EINER Art darf die andere nicht mitreissen — deshalb
   * wird je Abschnitt getrennt entschieden, was angezeigt wird.
   */
  const [kunde, kiCheck] = await Promise.all(
    PROMPT_EXTENSION_KINDS.map(async (kind) => {
      const { data, error } = await supabase.rpc('admin_get_system_prompt_extension', {
        p_kind: kind,
      })
      if (error) {
        console.error('[admin/ki-prompts] admin_get_system_prompt_extension:', kind, error)
        return { kind, failed: true, extension: null as PromptExtension | null }
      }
      return { kind, failed: false, extension: readPromptExtension(data) }
    }),
  )

  const sections = [kunde!, kiCheck!]

  return (
    <Container className="py-10 sm:py-14">
      <header className="border-b border-line pb-6">
        <h1 className="text-h2 text-ink">KI-Prompts</h1>
        <p className="mt-2 max-w-prose text-body text-text-muted">
          Die admin-pflegbaren Ergänzungen der System-Prompts. Sie kommen zum fest verdrahteten
          Kern-Prompt HINZU und ersetzen ihn nicht — Verhalten und Regeln stehen weiterhin im Code,
          hier stehen Ton und Feinschliff. Ein neuer Text gilt ab sofort; der bisherige wird dabei
          automatisch am Vortag beendet. Wird noch am selben Tag korrigiert, ersetzt die Korrektur
          den Wortlaut, und der vorige ist danach nirgends mehr zu finden.
        </p>
      </header>

      {sections.map(({ kind, failed, extension }) => (
        <AdminSection
          key={kind}
          id={`prompt-${kind}`}
          title={PROMPT_EXTENSION_KIND_LABELS[kind]}
          description={
            kind === 'kunde'
              ? 'Ergänzt den Prompt des Kunden-Chats unter /kalkulator/projekte.'
              : 'Ergänzt den Prompt des internen Energieberater-Gesprächs (KI-Check). Eine Oberfläche dafür gibt es noch nicht — der Text steht bereit, sobald sie entsteht.'
          }
        >
          <AdminPanel className="flex flex-col gap-5">
            {failed ? (
              <AdminError>
                Der aktuelle Stand konnte nicht geladen werden. Das ist NICHT dasselbe wie „es ist
                noch nichts gesetzt" — bitte die Seite neu laden. Das Formular bleibt deshalb
                geschlossen: Ein Speichern würde einen unbekannten Stand ablösen.
              </AdminError>
            ) : (
              <>
                {/*
                  ⚠ DER TEXT STEHT SICHTBAR DA, NICHT NUR IM FELD. Wer ändern will, muss lesen
                  können, was gilt — ein vorbelegtes Eingabefeld allein zeigt bei zehn Zeilen
                  Anweisung nur den Anfang, und der geltende Wortlaut wäre damit hinter dem
                  Bearbeitungszustand versteckt.
                */}
                {extension ? (
                  <div>
                    <p className="text-caption text-text-muted">
                      Aktuell seit {formatDate(extension.validFrom)}
                      {extension.createdByEmail ? ` (von ${extension.createdByEmail})` : ''}
                    </p>
                    <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-surface-sunken p-3 text-small text-text">
                      {extension.text}
                    </pre>
                  </div>
                ) : (
                  <p className="text-small text-text-muted">
                    Für diese Art ist noch nichts gesetzt. Das ist der Normalzustand und kein Fehler
                    — der Kern-Prompt trägt das Verhalten auch allein.
                  </p>
                )}

                <SystemPromptExtensionForm
                  kind={kind}
                  currentText={extension?.text ?? ''}
                  hint={HINTS[kind]}
                />
              </>
            )}
          </AdminPanel>
        </AdminSection>
      ))}
    </Container>
  )
}
