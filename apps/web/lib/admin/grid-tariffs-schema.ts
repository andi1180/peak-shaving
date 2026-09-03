/**
 * Formprüfung des Tarif-Anlageformulars (B21-2b).
 *
 * REIN: kein `server-only`, kein `next/*` — das Client-Formular liest die Beschriftungen, die
 * Server Action das Schema. Dieselbe Aufteilung wie `lib/admin/schema.ts`.
 *
 * ── WARUM EIGENE DATEI STATT `lib/admin/schema.ts` ──────────────────────────────────────────────
 * Dort liegen die Schemata ALLER Admin-Formulare, und `ADMIN_INITIAL_STATE` aus derselben Datei
 * wird von jedem Client-Formular importiert. Dieses Schema braucht das Vokabular aus
 * `./grid-tariffs`, und das wiederum die Betreiberliste aus `shared`. In `schema.ts` abgelegt zöge
 * es `shared` in das Bündel JEDES Admin-Formulars — für eine Konstante, die nur dieses eine
 * braucht.
 *
 * ── DIE PRÜFUNG STEHT HIER *UND* IN DER DATENBANK, UND DAS IST KEINE VERDOPPLUNG ────────────────
 * Die CHECKs aus B21-1 bleiben die harte Grenze; sie sehen auch Aufrufe an diesem Formular vorbei.
 * Was sie nicht können: eine Meldung AM FELD liefern, bevor jemand einen Tarifstand anlegt, der
 * sich nachträglich nicht mehr ändern lässt. Genau dafür ist dieses Schema da.
 *
 * Was hier ABSICHTLICH nicht geprüft wird: die fachliche Plausibilität der Beträge. Ein
 * Leistungspreis von 3,80 statt 38,52 EUR/kW·a ist eine gültige Zahl und ein falscher Tarif — das
 * fängt kein Schema, sondern nur der Blick ins Preisblatt. Eine erfundene Ober- oder Untergrenze
 * wiese irgendwann einen echten Satz ab (Prinzip 1: die Rechnung ist die Wahrheit).
 */
import { z } from 'zod'
import {
  GRUNDPREIS_UNITS,
  METERING_VARIANTS,
  NETZEBENEN,
  PRICE_BASES,
  hasMeteringVariant,
  type MeteringVariant,
} from './grid-tariffs'

/**
 * Form einer Betreiber-Kennung. Dieselbe Konvention wie die drei aus B11
 * (`wiener_netze`, `netz_noe`, `salzburg_netz`) — also Kleinbuchstaben, Ziffern und UNTERSTRICHE.
 *
 * ⚠ Bewusst NICHT das Partner-Slug-Muster (`^[a-z0-9-]+$`, Bindestriche): Die Kennung muss zu den
 * bereits vergebenen passen, sonst stünden `netz_noe` und `netz-noe` nebeneinander und wären für den
 * `unique`-Constraint aus B21-1 zwei verschiedene Betreiber.
 */
const operatorIdField = z
  .string()
  .trim()
  .min(1, 'Bitte eine Kennung für den Netzbetreiber angeben.')
  .max(64, 'Höchstens 64 Zeichen.')
  .regex(
    /^[a-z0-9][a-z0-9_]*$/,
    'Nur Kleinbuchstaben, Ziffern und Unterstriche, beginnend mit Buchstabe oder Ziffer (z. B. linz_netz).',
  )

/** `MM-DD`, jahreslos — eine Saison wiederholt sich, sie hat kein Jahr (B21-1, Delta 5). */
const monthDayField = z
  .string()
  .trim()
  .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Bitte als MM-TT angeben, z. B. 04-01.')

/**
 * Uhrzeit als `HH:MM`.
 *
 * `24:00` ist ausdrücklich erlaubt und der Grund, warum hier ein Textfeld steht und kein
 * `<input type="time">`: Ein ganztägiges Fenster endet um 24:00, und das Zeitfeld des Browsers
 * kommt nur bis 23:59. PostgreSQL nimmt `24:00:00` als `time` an — die eine fehlende Minute wäre
 * eine stille Ungenauigkeit in jeder Tagesbilanz.
 */
const timeField = z
  .string()
  .trim()
  .regex(
    /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/,
    'Bitte als HH:MM angeben, z. B. 06:00 (Tagesende: 24:00).',
  )

/** Ein Betrag: Zahl, nicht negativ, endlich. Keine erfundene Obergrenze (s. Kopf). */
function amountField(label: string) {
  return z.coerce
    .number({ invalid_type_error: `Bitte ${label} als Zahl angeben.` })
    .finite(`Bitte ${label} als Zahl angeben.`)
    .min(0, `${label} kann nicht negativ sein.`)
}

/**
 * Die Felder EINES Zeitfensters (`public.grid_tariff_rate_windows`) — ohne die Saison-Paarregel.
 *
 * ── ⚠ WARUM DIE FELDER UND DIE REGEL GETRENNT STEHEN (B21-2d) ──────────────────────────────────
 * Es gibt seither ZWEI Wege, auf denen ein Zeitfenster entsteht: als Teil einer neuen Tarifzeile
 * (`gridTariffSchema.windows`) und einzeln an einen bestehenden Stand (`addRateWindowSchema`).
 * Beide müssen dieselben Grenzen und dieselbe Paarregel anwenden — ein zweites Mal ausgeschrieben
 * liefen sie auseinander, und derselbe Eintrag würde je nach Weg angenommen oder abgewiesen.
 *
 * `.refine()`/`.superRefine()` liefert ein `ZodEffects`, und darauf gibt es kein `.extend()` mehr.
 * Deshalb ist die Basis ein reines Objekt, und BEIDE Schemata setzen die Regel selbst darauf —
 * über denselben Helfer, mit derselben Meldung und demselben Pfad.
 */
const rateWindowFields = z.object({
  label: z
    .string()
    .trim()
    .min(1, 'Bitte eine Bezeichnung angeben, z. B. normal oder snap.')
    .max(64, 'Höchstens 64 Zeichen.'),
  // Leer heisst ganzjährig — deshalb `optional`, nicht `min(1)`.
  monthDayFrom: monthDayField.optional(),
  monthDayTo: monthDayField.optional(),
  timeFrom: timeField,
  timeTo: timeField,
  ctPerKwh: amountField('den Arbeitspreis'),
  /**
   * Freitext-Notiz (B21-2d) — optional, für Menschen, geht in keine Berechnung ein.
   *
   * ⚠ Die Längengrenze steht HIER und ausdrücklich nicht als CHECK in der Datenbank: dort wiese sie
   * mit einem rohen 23514 ab, hier meldet sie sich am Feld. Dieselbe Aufteilung wie bei `label`.
   */
  note: z.string().trim().max(500, 'Höchstens 500 Zeichen.').optional(),
})

/**
 * Eine halb angegebene Saison ist keine Angabe: „ab 01.04." ohne Ende liesse offen, ob das Fenster
 * einen Tag oder neun Monate gilt — und die Datenbank nähme beide Werte an.
 */
function requireSeasonPair(
  value: { monthDayFrom?: string; monthDayTo?: string },
  ctx: z.RefinementCtx,
): void {
  if ((value.monthDayFrom === undefined) === (value.monthDayTo === undefined)) return
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['monthDayFrom'],
    message: 'Saison bitte mit Beginn UND Ende angeben, oder beides leer lassen (ganzjährig).',
  })
}

/** Ein Zeitfenster als Teil einer neuen Tarifzeile. */
export const gridTariffWindowSchema = rateWindowFields.superRefine(requireSeasonPair)

export type GridTariffWindowInput = z.infer<typeof gridTariffWindowSchema>

/**
 * Ein Zeitfenster, das EINZELN an einen bestehenden Tarifstand gehängt wird (B21-2d).
 *
 * Dieselben Feldgrenzen und dieselbe Paarregel wie oben, plus die Kennung des Stands. Geprüft wird
 * hier nur die FORM der Kennung, nicht ihre Existenz — und schon gar nicht, ob der Stand noch offen
 * ist: Beides beantwortet `public.add_grid_tariff_rate_window` selbst (`not_found` /
 * `closed_tariff`), und eine zwischenzeitlich abgelöste Zeile wäre hier ohnehin nicht mehr aktuell.
 */
export const addRateWindowSchema = rateWindowFields
  .extend({
    tariffId: z
      .string()
      .trim()
      .regex(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        'Es wurde keine gültige Tarifzeile übergeben. Bitte die Seite neu laden.',
      ),
  })
  .superRefine(requireSeasonPair)

export type AddRateWindowInput = z.infer<typeof addRateWindowSchema>

/**
 * Die Felder EINER Tarifzeile — ohne den Anzeigenamen und ohne die Messvarianten-Regel.
 *
 * ── ⚠ WARUM DIE FELDER UND DIE REGEL GETRENNT STEHEN (B21-2e) ──────────────────────────────────
 * Es gibt seither ZWEI Wege, auf denen eine Tarifzeile entsteht: vorwärts angehängt
 * (`gridTariffSchema`) und rückwärts nachgetragen (`backfillGridTariffSchema`). Beide müssen
 * dieselben Grenzen und dieselbe Messvarianten-Regel anwenden — ein zweites Mal ausgeschrieben
 * liefen sie auseinander, und derselbe Eintrag würde je nach Weg angenommen oder abgewiesen.
 * Dieselbe Aufteilung, die `rateWindowFields` weiter oben schon für die Zeitfenster hat, und aus
 * demselben Grund: `.superRefine()` liefert ein `ZodEffects`, darauf gibt es kein `.extend()` mehr.
 *
 * ⚠ `operatorName` steht bewusst NICHT hier: Der Backfill setzt eine bestehende Kombination voraus
 * und übernimmt den Anzeigenamen aus dem Bestand (`public.backfill_grid_tariff` hat dafür gar
 * keinen Parameter). Ihn im Formular erneut zu erfragen erzeugte die Möglichkeit, dass dieselbe
 * Kennung mit ZWEI Anzeigenamen in der Liste steht — sichtbar als zwei Gruppen, die es nicht gibt.
 */
const gridTariffFields = z.object({
  operatorId: operatorIdField,
  netzebene: z.coerce
    .number({ invalid_type_error: 'Bitte eine Netzebene wählen.' })
    .int('Bitte eine Netzebene wählen.')
    .refine((n) => (NETZEBENEN as readonly number[]).includes(n), 'Bitte eine Netzebene wählen.'),
  meteringVariant: z.enum(METERING_VARIANTS).optional(),
  grundpreisAmount: amountField('den Grundpreis'),
  grundpreisUnit: z.enum(GRUNDPREIS_UNITS, {
    errorMap: () => ({ message: 'Bitte die Einheit des Grundpreises wählen.' }),
  }),
  netzverlustCtPerKwh: amountField('das Netzverlustentgelt'),
  priceBasis: z.enum(PRICE_BASES, {
    errorMap: () => ({ message: 'Bitte angeben, ob die Beträge netto oder brutto sind.' }),
  }),
  validFrom: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Bitte ein Datum angeben (JJJJ-MM-TT).')
    .refine((v) => !Number.isNaN(Date.parse(v)), 'Bitte ein gültiges Datum angeben.'),
  windows: z
    .array(gridTariffWindowSchema)
    .min(
      1,
      'Mindestens ein Zeitfenster ist nötig — ohne Arbeitspreis ist die Tarifzeile unvollständig.',
    ),
})

/**
 * `meteringVariant` ist KONTEXTABHÄNGIG pflichtig (Delta 5): Netzebenen, die eine Variante
 * anbieten, verlangen sie; alle anderen dürfen keine tragen. Beides ist eine echte Bedingung und
 * nicht nur eine Anzeigefrage — `null` gegen `'mit_leistungsmessung'` sind für die
 * Effektiv-Datierung zwei verschiedene Kombinationen.
 */
function requireMeteringVariantMatch(
  v: { netzebene: number; meteringVariant?: MeteringVariant },
  ctx: z.RefinementCtx,
): void {
  if (hasMeteringVariant(v.netzebene) && v.meteringVariant === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['meteringVariant'],
      message: `Auf Netzebene ${v.netzebene} gehört die Leistungsmessungs-Variante zur Tarifzeile.`,
    })
  }
  if (!hasMeteringVariant(v.netzebene) && v.meteringVariant !== undefined) {
    // Erreichbar nur an der Oberfläche vorbei (das Feld wird bei NE 3–6 gar nicht gerendert).
    // Stillschweigend auf null zu setzen wäre schlechter: der Eintragende hätte eine Variante
    // gewählt und bekäme eine Zeile ohne sie.
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['meteringVariant'],
      message: `Netzebene ${v.netzebene} kennt keine Leistungsmessungs-Variante.`,
    })
  }
}

/** Eine NEUE Tarifzeile, vorwärts angehängt (B21-2b) — mit Anzeigename. */
export const gridTariffSchema = gridTariffFields
  .extend({
    operatorName: z
      .string()
      .trim()
      .min(1, 'Bitte den Anzeigenamen des Netzbetreibers angeben.')
      .max(200, 'Zu lang.'),
  })
  .superRefine(requireMeteringVariantMatch)

export type GridTariffInput = z.infer<typeof gridTariffSchema>

/**
 * Ein HISTORISCHER Tarifstand, VOR den ältesten vorhandenen nachgetragen (B21-2e).
 *
 * Dieselben Feldgrenzen und dieselbe Messvarianten-Regel wie oben, nur ohne Anzeigenamen (s. den
 * Kopf von `gridTariffFields`). Geprüft wird hier ausschliesslich die FORM: ob die Kombination
 * überhaupt existiert und ob `validFrom` wirklich VOR dem ältesten Stand liegt, beantwortet
 * `public.backfill_grid_tariff` selbst (`no_existing_stand` / `not_before_oldest`) — und zwar unter
 * einer Sperre. Eine hier vorweggenommene Prüfung wäre zum Zeitpunkt des Klicks womöglich veraltet.
 */
export const backfillGridTariffSchema = gridTariffFields.superRefine(requireMeteringVariantMatch)

export type BackfillGridTariffInput = z.infer<typeof backfillGridTariffSchema>

// ── Formulardaten einlesen ───────────────────────────────────────────────────────────────────────

/**
 * Rohwerte aus dem abgeschickten Formular — noch UNGEPRÜFT, aber bereits in der Form, die
 * `gridTariffSchema` erwartet.
 *
 * Reine Funktion über `FormData` (eine Web-Api, kein Next-Detail): sie lässt sich ohne Server,
 * ohne Sitzung und ohne Datenbank prüfen. Dieselbe Aufteilung wie die Prüfkette in B14-2
 * (`lib/admin/analysis-upload.ts`) — was hier scheitert, erzeugt keinen Client und keinen Aufruf.
 *
 * ── DIE ZEITFENSTER KOMMEN ALS INDIZIERTE FELDER, NICHT ALS JSON-BLOCK ──────────────────────────
 * Der wiederholbare Abschnitt legt `w0_label`, `w0_timeFrom`, … an. Gelesen werden die Indizes aus
 * den tatsaechlich vorhandenen Schlüsseln statt aus einem Zählerfeld: Nach dem Entfernen einer
 * Zeile ist die Nummerierung LÜCKENHAFT, und eine Schleife `for (i = 0; i < count; i++)` verloere
 * dann still die Fenster hinter der Luecke. Die Reihenfolge bleibt die numerische — sie ist die,
 * die auf dem Bildschirm stand.
 *
 * Ein verstecktes JSON-Feld wäre die kürzere Variante gewesen und bräuchte zwingend JavaScript;
 * so trägt das Formular seine Werte selbst, wie jedes andere im Admin-Bereich.
 */
export function readGridTariffForm(formData: FormData): Record<string, unknown> {
  const str = (name: string): string => String(formData.get(name) ?? '').trim()
  const opt = (name: string): string | undefined => {
    const value = str(name)
    return value === '' ? undefined : value
  }

  const indices = new Set<number>()
  for (const key of formData.keys()) {
    const match = /^w(\d+)_label$/.exec(key)
    if (match) indices.add(Number(match[1]))
  }

  const windows = [...indices]
    .sort((a, b) => a - b)
    .map((i) => ({
      label: str(`w${i}_label`),
      monthDayFrom: opt(`w${i}_monthDayFrom`),
      monthDayTo: opt(`w${i}_monthDayTo`),
      timeFrom: str(`w${i}_timeFrom`),
      timeTo: str(`w${i}_timeTo`),
      ctPerKwh: str(`w${i}_ctPerKwh`),
      note: opt(`w${i}_note`),
    }))

  return {
    operatorId: str('operatorId'),
    operatorName: str('operatorName'),
    netzebene: str('netzebene'),
    meteringVariant: opt('meteringVariant'),
    grundpreisAmount: str('grundpreisAmount'),
    grundpreisUnit: str('grundpreisUnit'),
    netzverlustCtPerKwh: str('netzverlustCtPerKwh'),
    priceBasis: str('priceBasis'),
    validFrom: str('validFrom'),
    windows,
  }
}

/**
 * Rohwerte des „Zeitfenster ergänzen"-Formulars (B21-2d) — noch UNGEPRÜFT.
 *
 * ⚠ FLACHE Feldnamen (`label`, `timeFrom`, …), NICHT die indizierten `w0_*` des Anlageformulars.
 * Dieses Formular trägt genau EIN Fenster; ein Index daran wäre eine Nummer ohne zweite Zeile, und
 * die Fehlerpfade des Schemas (`label`, `timeFrom`) liessen sich nicht mehr direkt auf Feldnamen
 * abbilden. `RateWindowFields` bekommt die Vorsilbe deshalb als Prop und liefert hier `''`.
 */
export function readAddRateWindowForm(formData: FormData): Record<string, unknown> {
  const str = (name: string): string => String(formData.get(name) ?? '').trim()
  const opt = (name: string): string | undefined => {
    const value = str(name)
    return value === '' ? undefined : value
  }

  return {
    tariffId: str('tariffId'),
    label: str('label'),
    monthDayFrom: opt('monthDayFrom'),
    monthDayTo: opt('monthDayTo'),
    timeFrom: str('timeFrom'),
    timeTo: str('timeTo'),
    ctPerKwh: str('ctPerKwh'),
    note: opt('note'),
  }
}

/**
 * Feld-Fehler eines Zeitfensters tragen den Index im Namen (`w2_timeFrom`), damit die Meldung an
 * DER Zeile landet, in der der Fehler steht — bei fünf Fenstern ist „bitte HH:MM angeben" ohne
 * Ortsangabe wertlos. `toFieldErrors` (lib/admin/schema.ts) nimmt nur das erste Pfadsegment und
 * kann das nicht; deshalb hier ein eigener Übersetzer.
 */
export function gridTariffFieldErrors(issues: readonly z.ZodIssue[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of issues) {
    const [head, index, leaf] = issue.path
    const field =
      head === 'windows' && typeof index === 'number' && typeof leaf === 'string'
        ? `w${index}_${leaf}`
        : typeof head === 'string'
          ? head
          : null
    if (field && !(field in out)) out[field] = issue.message
  }
  return out
}
