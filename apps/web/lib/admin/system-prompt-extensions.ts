/**
 * Die zwei System-Prompt-Erweiterungen (B24 Station 6) — Fundort der Arten und der Adresse.
 *
 * REIN: kein `server-only`, kein `next/*`, kein Supabase-Client. Die Seite liest von hier die
 * Beschriftungen, die Server Action die erlaubte Wertemenge, `nav.ts` die Adresse — dieselbe
 * Aufteilung wie bei `lib/admin/retail-tariffs.ts`.
 *
 * ── DIE WERTELISTE STEHT HIER UND IN DER DATENBANK, UND DAS IST KEINE VERDOPPLUNG ──────────────
 * `platform.system_prompt_extensions.kind` trägt einen CHECK auf genau diese zwei Werte, und beide
 * Wrapper weisen alles andere mit `{status: invalid_kind}` ab. Die Datenbank bleibt die harte
 * Grenze (sie sieht auch Aufrufe an diesem Formular vorbei); die Liste hier erspart einen Roundtrip
 * für einen Wert, den das Formular selbst erzeugt hat, und trägt die deutschen Beschriftungen, die
 * die Datenbank gar nicht kennt.
 *
 * ⚠ Wächst die Liste, wächst sie an DREI Stellen gemeinsam: CHECK, die zwei `invalid_kind`-Zweige
 * der Wrapper, und hier. Eine Art, die nur hier stünde, liefe beim Absenden in `invalid_kind` —
 * eine Art, die nur dort stünde, wäre über diese Seite nicht pflegbar.
 */

/** Die Arten in der Reihenfolge, in der die Pflegeseite sie zeigt. */
export const PROMPT_EXTENSION_KINDS = ['kunde', 'ki_check'] as const

export type PromptExtensionKind = (typeof PROMPT_EXTENSION_KINDS)[number]

export const PROMPT_EXTENSION_KIND_LABELS: Record<PromptExtensionKind, string> = {
  kunde: 'Kunden-Chat',
  ki_check: 'Energieberater (KI-Check)',
}

/**
 * ⚠ KEIN UNTERPFAD VON `/admin/kalkulator`. Die Aktiv-Markierung in `AdminNav` arbeitet mit
 * Präfixen — `/admin/kalkulator/ki-prompts` markierte zwei Punkte gleichzeitig (dieselbe Falle wie
 * bei „Kalkulator-Anfragen", B18-4). Fachlich sind es ohnehin zwei Dinge: dort wird gerechnet, hier
 * steht der Text, der ein Gespräch führt.
 */
export const SYSTEM_PROMPT_EXTENSIONS_HREF = '/admin/ki-prompts'

export function isPromptExtensionKind(value: unknown): value is PromptExtensionKind {
  return typeof value === 'string' && (PROMPT_EXTENSION_KINDS as readonly string[]).includes(value)
}

/**
 * Der OFFENE Stand einer Art, so wie ihn `public.admin_get_system_prompt_extension` liefert.
 *
 * ⚠ DER OFFENE, NICHT DER HEUTE GELTENDE — das ist der Unterschied zwischen dem admin- und dem
 * Chat-Lesepfad und in der Migration begründet: ein zukünftig beginnender Stand soll bearbeitbar
 * bleiben. Diese Seite setzt bewusst nie ein Datum in der Zukunft (s. die Server Action), die
 * beiden fallen hier also heute nicht auseinander — wer die Datierung nachrüstet, muss es wissen.
 */
export type PromptExtension = {
  id: string
  text: string
  validFrom: string
  createdByEmail: string | null
}

/**
 * Liest die jsonb-Antwort defensiv. Alles, was nicht erkennbar ein Stand ist, wird zu `null` —
 * „es gibt keinen" ist der Normalzustand (`{status: none}`) und kein Fehler.
 *
 * ⚠ Ein LEERER Text gilt als „nichts gesetzt": die Datenbank kann ihn gar nicht enthalten
 * (`invalid_text` weist ihn ab), und als Stand angezeigt sähe er aus wie eine gepflegte Anweisung,
 * die nichts sagt. Den Fehler-/Ausnahmefall unterscheidet der Aufrufer selbst — hier kommt nur an,
 * was die Funktion tatsächlich geantwortet hat.
 */
export function readPromptExtension(data: unknown): PromptExtension | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null
  const row = data as { status?: unknown; extension?: unknown }
  if (row.status !== 'ok') return null
  const ext = row.extension
  if (ext === null || typeof ext !== 'object' || Array.isArray(ext)) return null

  const e = ext as Record<string, unknown>
  const id = e.id
  const text = e.extension_text
  const validFrom = e.valid_from
  if (typeof id !== 'string' || typeof text !== 'string' || text.trim() === '') return null
  if (typeof validFrom !== 'string') return null

  return {
    id,
    text,
    validFrom,
    createdByEmail: typeof e.created_by_email === 'string' ? e.created_by_email : null,
  }
}
