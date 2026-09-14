/**
 * Formprüfung des Lieferanten-Tarif-Anlageformulars.
 *
 * REIN: kein `server-only`, kein `next/*` — das Client-Formular liest die Beschriftungen, die Server
 * Action das Schema. Dieselbe Aufteilung wie `lib/admin/grid-tariffs-schema.ts` und aus demselben
 * Grund eine EIGENE Datei statt `lib/admin/schema.ts`: dort liegen die Schemata aller
 * Admin-Formulare, und `ADMIN_INITIAL_STATE` aus derselben Datei wird von jedem Client-Formular
 * importiert — das Vokabular dieses einen Abschnitts hätte dort in jedem Bündel nichts verloren.
 *
 * ── DIE PRÜFUNG STEHT HIER *UND* IN DER DATENBANK, UND DAS IST KEINE VERDOPPLUNG ────────────────
 * Die CHECKs der Tabelle bleiben die harte Grenze; sie sehen auch Aufrufe an diesem Formular vorbei.
 * Was sie nicht können: eine Meldung AM FELD liefern, bevor jemand einen Stand anlegt, der sich
 * danach weder ändern noch löschen lässt — für `public.retail_tariffs` gibt es ausdrücklich KEINEN
 * Löschweg, auch nicht für `service_role`. Eine falsch eingetragene Zeile bleibt stehen und kann nur
 * durch einen neuen Stand abgelöst werden. Das wiegt hier schwerer als bei den Netzbetreiber-Tarifen,
 * wo ein Probeeintrag über `delete_grid_tariff` (protokolliert) wieder verschwinden kann.
 *
 * Was hier ABSICHTLICH nicht geprüft wird: die fachliche Plausibilität der Beträge. Ein Arbeitspreis
 * von 2,41 statt 24,1 ct/kWh ist eine gültige Zahl und ein falscher Tarif — das fängt kein Schema,
 * sondern nur der Blick auf die Preisseite. Eine erfundene Ober- oder Untergrenze wiese irgendwann
 * einen echten Preis ab (Prinzip 1).
 */
import { z } from 'zod'
import { RETAIL_PRICE_BASES, RETAIL_SEGMENTS } from './retail-tariffs'

/**
 * Form einer Anbieter-Kennung. Dieselbe Konvention wie bei den Netzbetreibern — Kleinbuchstaben,
 * Ziffern und UNTERSTRICHE.
 *
 * ⚠ Bewusst NICHT das Partner-Slug-Muster (`^[a-z0-9-]+$`, Bindestriche): Die Kennung ist Teil der
 * Identität der Zeile (`unique (provider_id, segment, valid_from)`), und zwei Schreibweisen
 * desselben Anbieters wären für den Constraint zwei verschiedene Anbieter — beide Stände blieben
 * offen, und die Effektiv-Datierung griffe zwischen ihnen nie. Eine im ganzen Admin-Bereich
 * einheitliche Konvention für Referenzdaten-Kennungen ist der billigste Schutz dagegen.
 */
const providerIdField = z
  .string()
  .trim()
  .min(1, 'Bitte eine Kennung für den Anbieter angeben.')
  .max(64, 'Höchstens 64 Zeichen.')
  .regex(
    /^[a-z0-9][a-z0-9_]*$/,
    'Nur Kleinbuchstaben, Ziffern und Unterstriche, beginnend mit Buchstabe oder Ziffer (z. B. awattar).',
  )

/** Ein Betrag: Zahl, nicht negativ, endlich. Keine erfundene Obergrenze (s. Kopf). */
function amountField(label: string) {
  return z.coerce
    .number({ invalid_type_error: `Bitte ${label} als Zahl angeben.` })
    .finite(`Bitte ${label} als Zahl angeben.`)
    .min(0, `${label} kann nicht negativ sein.`)
}

export const retailTariffSchema = z.object({
  providerId: providerIdField,
  providerName: z
    .string()
    .trim()
    .min(1, 'Bitte den Anzeigenamen des Anbieters angeben.')
    .max(200, 'Zu lang.'),
  /*
   * Kein Vorgabewert im Formular, deshalb hier eine echte Ablehnung des Leerwerts statt einer
   * stillen Annahme: Das Segment ist Teil der Identität der Zeile, und eine falsch gesetzte Zeile
   * lässt sich nicht mehr entfernen. Begründung in voller Länge an `RETAIL_SELECT_UNSET`.
   */
  segment: z.enum(RETAIL_SEGMENTS, {
    errorMap: () => ({ message: 'Bitte angeben, für welche Kundengruppe dieser Preis gilt.' }),
  }),
  energyPriceCtPerKwh: amountField('den Arbeitspreis'),
  baseFeeEurPerMonth: amountField('die Grundgebühr'),
  priceBasis: z.enum(RETAIL_PRICE_BASES, {
    errorMap: () => ({ message: 'Bitte angeben, ob der Preis netto oder brutto ist.' }),
  }),
  /*
   * ── ⚠ KEINE `.url()`-PRÜFUNG, UND DAS IST EINE ENTSCHEIDUNG ────────────────────────────────
   * Die Datenbank verlangt „nicht leer" (CHECK `btrim(source_url) <> ''`) und ausdrücklich KEIN
   * URL-Format: ein Beleg darf „Preisblatt per E-Mail vom 12.09.2026" sein. Eine Formatprüfung hier
   * nähme genau den Fall zurück, für den die Spalte `text` ist — und zwar am Feld, wo sie wie eine
   * Regel der Datenbank aussähe.
   *
   * Was bleibt, ist die Pflicht selbst: Ein Listenpreis ohne Beleg ist eine Behauptung, und das
   * wiegt hier schwer, weil die Tabelle absehbar teilweise aus einer Websuche gefüllt wird.
   */
  sourceUrl: z
    .string()
    .trim()
    .min(1, 'Bitte angeben, woher dieser Preis stammt — ohne Beleg ist er eine Behauptung.')
    .max(2000, 'Zu lang.'),
  validFrom: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Bitte ein Datum angeben (JJJJ-MM-TT).')
    .refine((v) => !Number.isNaN(Date.parse(v)), 'Bitte ein gültiges Datum angeben.'),
})

export type RetailTariffInput = z.infer<typeof retailTariffSchema>

/**
 * Rohwerte aus dem abgeschickten Formular — noch UNGEPRÜFT, aber bereits in der Form, die
 * `retailTariffSchema` erwartet.
 *
 * Reine Funktion über `FormData` (eine Web-Api, kein Next-Detail): sie lässt sich ohne Server, ohne
 * Sitzung und ohne Datenbank prüfen. Was hier scheitert, erzeugt keinen Client und keinen Aufruf.
 *
 * ⚠ `providerSelect` wird bewusst NICHT gelesen. Das Auswahlfeld des Formulars trägt diesen Namen,
 * damit es die eigentliche Kennung nicht überschreibt: Bei einem bekannten Anbieter fahren
 * `providerId`/`providerName` als VERSTECKTE Felder mit, bei einem neuen als sichtbare Eingaben —
 * in beiden Fällen unter denselben Schlüsseln. Dieselbe Aufteilung wie `operatorSelect` bei den
 * Netzbetreiber-Tarifen.
 */
export function readRetailTariffForm(formData: FormData): Record<string, unknown> {
  const str = (name: string): string => String(formData.get(name) ?? '').trim()

  return {
    providerId: str('providerId'),
    providerName: str('providerName'),
    segment: str('segment'),
    energyPriceCtPerKwh: str('energyPriceCtPerKwh'),
    baseFeeEurPerMonth: str('baseFeeEurPerMonth'),
    priceBasis: str('priceBasis'),
    sourceUrl: str('sourceUrl'),
    validFrom: str('validFrom'),
  }
}
