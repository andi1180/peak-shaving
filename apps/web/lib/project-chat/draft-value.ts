import { tariffParamsSchema } from 'shared'
import type { ZodTypeAny } from 'zod'

import type { DraftValue } from './draft'

/**
 * B24 — DIE TYPPRÜFUNG EINES EINZELNEN ENTWURFSWERTS (`set_draft_field`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WARUM DAS NICHT „ALLES IST EINE ZAHL" SEIN DARF
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Der Entwurf ist ein `jsonb`-Objekt und nimmt jeden Skalar an. Ein Modell, das „24,5" als
 * ZEICHENKETTE einträgt, bekam bisher ein `ok` zurück, der Wert stand im Entwurf, und erst die
 * Abbildung auf `TariffParams` warf — im Analyse-Schritt, lange nach dem Gespräch, in dem sich der
 * Fehler noch hätte klären lassen. Geprüft wird deshalb HIER, gegen den tatsächlichen Feldtyp aus
 * `tariffParamsSchema`: ein Zahlenfeld will eine Zahl, `billingModel` und `meteringVariant` wollen
 * einen ihrer Enum-Werte, `netzebene` eine Zeichenkette.
 *
 * ── DIE ZAHLENREGEL IST GESPIEGELT, NICHT NEU ERFUNDEN ────────────────────────────────────────
 * Sie ist wortgleich die der Handeingabe-Station (`readManualNumber` in
 * `apps/web/lib/admin/data-entry-actions-rechnung.ts`): das Dezimalkomma wird angenommen, eine
 * Zahl mit Tausendertrenner wird NICHT geraten. Zwei Auslegungen derselben eingetippten Zahl an
 * zwei Stationen wären genau die Drift, die dieses Repo sonst überall vermeidet.
 *
 * ⚠ ABGELEHNT HEISST: NICHTS GESCHRIEBEN. Ein stiller Ersatzwert wäre hier das Schlimmste — er
 * sähe im Report aus wie eine abgelesene Zahl. Das Modell bekommt stattdessen einen lesbaren Satz
 * und kann den Aufruf korrigieren oder nachfragen.
 */

export type DraftValueCheck = { ok: true; value: DraftValue } | { ok: false; error: string }

/** Der zod-Rumpf, so weit wie diese Datei ihn liest — `_def` ist über `ZodTypeAny` untypisiert. */
interface ZodDefPeek {
  typeName?: string
  innerType?: unknown
  values?: readonly unknown[]
}

function peek(schema: unknown): ZodDefPeek {
  return (schema as { _def?: ZodDefPeek })._def ?? {}
}

/** Hüllen, die den Feldtyp nur umschliessen — `undefined` ist an dieser Stelle längst abgefangen. */
const WRAPPER_TYPES = new Set(['ZodOptional', 'ZodNullable', 'ZodDefault'])

function unwrap(schema: ZodTypeAny): { kind: string; values: readonly unknown[] } {
  let def = peek(schema)
  while (def.typeName !== undefined && WRAPPER_TYPES.has(def.typeName) && def.innerType) {
    def = peek(def.innerType)
  }
  return { kind: def.typeName ?? '', values: def.values ?? [] }
}

/**
 * Liest eine als Zeichenkette genannte Zahl — dieselben Regeln wie `readManualNumber`.
 * `null` = unbrauchbar. Das Komma wird als Dezimaltrenner gelesen; „1.234,56" ergibt NaN und wird
 * damit abgewiesen, statt sich für eine der beiden möglichen Lesarten zu entscheiden.
 */
function readNumberLike(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const value = Number(trimmed.replace(',', '.'))
  if (!Number.isFinite(value)) return null
  return value
}

function schemaProblem(schema: ZodTypeAny, candidate: DraftValue, field: string): string | null {
  const parsed = schema.safeParse(candidate)
  if (parsed.success) return null
  return parsed.error.issues.map((issue) => issue.message).join(' · ') + ` (Feld ${field})`
}

/**
 * Prüft EINEN Wert gegen den Feldtyp des Eingabe-Contracts und gibt ihn getypt zurück.
 *
 * Ein Feldname, den `tariffParamsSchema` nicht kennt (Katalog-Schlüssel, freies Feld), wird
 * unverändert angenommen — über ihn sagt der Contract nichts, und eine hier erfundene Erwartung
 * wäre eine zweite, nirgends gepflegte Typisierung.
 */
export function coerceDraftValue(field: string, raw: unknown): DraftValueCheck {
  if (typeof raw !== 'number' && typeof raw !== 'string' && typeof raw !== 'boolean') {
    return {
      ok: false,
      error: 'value muss eine Zahl, eine Zeichenkette oder ein Wahrheitswert sein.',
    }
  }
  /*
   * ⚠ NaN und Infinity sind in JavaScript `typeof 'number'`. Ohne diese Prüfung liefe NaN als
   * gültiger Tarifsatz durch und vergiftete danach jede Rechnung lautlos — dieselbe Sperre wie in
   * den bestehenden Extraktions-Auswertungen (Delta 9b-2a).
   */
  if (typeof raw === 'number' && !Number.isFinite(raw)) {
    return { ok: false, error: 'value ist keine endliche Zahl.' }
  }

  const shape = tariffParamsSchema.shape as Record<string, ZodTypeAny | undefined>
  const fieldSchema = shape[field]
  if (fieldSchema === undefined) return { ok: true, value: raw }

  const { kind, values } = unwrap(fieldSchema)
  let candidate: DraftValue

  switch (kind) {
    case 'ZodNumber': {
      if (typeof raw === 'boolean') {
        return { ok: false, error: `${field} ist ein Zahlenfeld — ein Wahrheitswert passt dort nicht.` }
      }
      if (typeof raw === 'string') {
        const parsed = readNumberLike(raw)
        if (parsed === null) {
          return {
            ok: false,
            error:
              `„${raw}" ist für ${field} keine lesbare Zahl. Ein Dezimalkomma ist erlaubt („24,5"), ` +
              'ein Tausendertrenner nicht: „1.234,56" ist als 1234,56 und als 1,234 lesbar, und ' +
              'eine der beiden Lesarten wäre um den Faktor 1000 falsch. Nenn die Zahl ohne ' +
              'Trennzeichen — oder frag den Kunden, wenn du sie nicht sicher weisst.',
          }
        }
        candidate = parsed
      } else {
        candidate = raw
      }
      break
    }
    case 'ZodEnum': {
      if (typeof raw !== 'string') {
        return {
          ok: false,
          error: `${field} nimmt genau einen dieser Werte: ${values.join(', ')}.`,
        }
      }
      candidate = raw
      break
    }
    case 'ZodString': {
      if (typeof raw !== 'string') {
        return { ok: false, error: `${field} erwartet eine Zeichenkette, z. B. „NE 7".` }
      }
      candidate = raw
      break
    }
    case 'ZodBoolean': {
      if (typeof raw !== 'boolean') {
        return { ok: false, error: `${field} erwartet true oder false.` }
      }
      candidate = raw
      break
    }
    /*
     * Listen, Objekte und `z.unknown()` (`timeOfUseWindows`, `benutzungsdauerModel`,
     * `dynamicPriceProfile`): ein Skalar wäre dort keine unvollständige, sondern eine falsche
     * Angabe. Sie werden von keiner Station erhoben und sind über dieses Werkzeug nicht setzbar.
     */
    default:
      return {
        ok: false,
        error:
          `${field} nimmt eine Struktur (Liste oder Objekt) und lässt sich mit set_draft_field ` +
          'nicht setzen. Trag die Angabe nicht unter einem anderen Feldnamen ein — halte sie als ' +
          'offene Frage fest.',
      }
  }

  const problem = schemaProblem(fieldSchema, candidate, field)
  if (problem !== null) return { ok: false, error: problem }

  return { ok: true, value: candidate }
}
