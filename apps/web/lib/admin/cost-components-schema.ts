/**
 * Prüfung der Kostenbaustein-Formulare (K1b). Reine Funktionen über `FormData` — ohne Server,
 * ohne Sitzung, ohne Datenbank prüfbar.
 */
import { z } from 'zod'
import { COST_COMPONENT_ARTEN } from './cost-components'

const optionalText = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max, `Bitte höchstens ${max} Zeichen.`)
    .transform((v) => (v === '' ? undefined : v))

export const costComponentSchema = z.object({
  art: z
    .string()
    .trim()
    .refine(
      (v) => (COST_COMPONENT_ARTEN as readonly string[]).includes(v),
      'Bitte Fundament, Installation oder Wechselrichter wählen.',
    ),
  bezeichnung: z.string().trim().min(1, 'Bitte eine Bezeichnung angeben.').max(200),
  beschreibung: optionalText(),
  /*
   * ⚠ Leer ist der NORMALFALL und heisst „noch nicht bepreist" — nicht „kostenlos". 0 ist erlaubt
   * und eine Aussage (ein Fundament, das nichts kostet); genau diese Unterscheidung trägt die
   * Datenbank auch, deshalb `min: 0` und nicht `gt: 0`.
   */
  priceNet: z
    .string()
    .trim()
    .transform((v) => (v === '' ? undefined : Number(v.replace(',', '.'))))
    .superRefine((v, ctx) => {
      if (v === undefined) return
      if (!Number.isFinite(v)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Bitte den Preis als Zahl angeben.' })
        return
      }
      if (v < 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Der Preis kann nicht negativ sein.' })
      }
    }),
  priceAsOf: z
    .string()
    .trim()
    .transform((v) => (v === '' ? undefined : v))
    .refine((v) => v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Bitte ein gültiges Datum.'),
  notes: optionalText(4000),
  leistungKw: z
    .string()
    .trim()
    .transform((v) => (v === '' ? undefined : Number(v.replace(',', '.'))))
    .superRefine((v, ctx) => {
      if (v !== undefined && !(Number.isFinite(v) && v > 0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Bitte die Nennleistung als Zahl über 0 angeben.' })
      }
    }),
}).superRefine((v, ctx) => {
  // Dieselbe Pflicht wie der CHECK `battery_cost_components_leistung_check` — hier benannt am Feld.
  if (v.art === 'wechselrichter' && v.leistungKw === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['leistungKw'],
      message: 'Ein Wechselrichter braucht seine Nennleistung in kW.',
    })
  }
})

export type CostComponentInput = z.infer<typeof costComponentSchema>

export const COST_COMPONENT_FORM_FIELDS = [
  'art',
  'bezeichnung',
  'beschreibung',
  'priceNet',
  'priceAsOf',
  'notes',
  'leistungKw',
] as const

export function readCostComponentForm(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const name of COST_COMPONENT_FORM_FIELDS) {
    out[name] = String(formData.get(name) ?? '').trim()
  }
  return out
}
