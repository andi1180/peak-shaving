'use server'

import {
  TARIFF_COMPARISON_BASE_FEE_KEY,
  TARIFF_COMPARISON_DRAFT_KEYS,
  TARIFF_COMPARISON_ENERGY_PRICE_KEY,
  TARIFF_COMPARISON_PRICE_BASES,
  TARIFF_COMPARISON_PRICE_BASIS_KEY,
  TARIFF_COMPARISON_PROVIDER_NAME_KEY,
} from './tariff-draft'
import type { AdminState } from './schema'
import {
  GENERIC,
  UNKNOWN_PROJECT,
  UUID,
  clearMeteringPointDraftFields,
  readProjectId,
  writeMeteringPointDraftFields,
} from './data-entry-actions-shared'

// ── Tarif ────────────────────────────────────────────────────────────────────────────────────────
/**
 * B24, Teil 1 — die Tarif-Station, die fünfte und letzte je Zählpunkt.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ZWEI ACTIONS FÜR EINE EINZIGE ANGABE — DIE SCHMALSTE STATION DES WIZARDS
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Sie liest keine Datei und löst KEINEN abrechenbaren Modellaufruf aus. Was sie festhält, ist eine
 * ANGABE des Kunden — ein selbst gefundener Vergleichstarif — und sonst nichts. Speichern und
 * Löschen dieser Angabe sind die zwei Actions dieser Datei.
 *
 * ── ⚠ ES GIBT KEINE TARIF-WAHL MEHR (Fachentscheidung 15.09.2026) ─────────────────────────────
 * Bis hierher stand hier zusätzlich `saveMeteringPointTariffPreferenceAction`: ein WUNSCH
 * („behalten" oder „optimieren"), der als Anweisung an die spätere Analyse gedacht war. Er ist
 * ERSATZLOS entfernt, samt seinem Entwurfsfeld (s. Kopf von `lib/admin/tariff-draft.ts`). Der
 * Vergleich mit aWATTar ist ab jetzt automatisch und keine Entscheidung, die die Dateneingabe
 * abfragen müsste — der Vergleich kostet nichts, und ob der Kunde tatsächlich wechselt, ist seine
 * eigene, spätere Entscheidung.
 *
 * ── ⚠ ES GIBT KEINEN VORSCHLAG, und das ist Absicht ───────────────────────────────────────────
 * `public.retail_tariffs` (13.09.2026) und `public.spot_prices` stehen bereit und werden hier mit
 * KEINEM Aufruf angefasst. Diese Station hält fest, WAS der Kunde gefunden hat; welcher Tarif der
 * bessere wäre, ist eine Rechnung über gepflegte Preisdaten und ein eigener Schritt.
 */

/**
 * Der selbst gefundene Vergleichstarif — vier Felder, EIN Aufruf, alle vier oder keines.
 *
 * ⚠ FREIWILLIG: es gibt keinen Vorgabewert und keine Warnung, wenn das Formular leer bleibt.
 * Einmal begonnen (irgendein Feld ausgefüllt und abgeschickt), müssen aber ALLE vier stimmen: ein
 * halb eingetragener Vergleich (Name ohne Preis, Preis ohne Basis) ist nicht weniger irreführend
 * als ein erfundener.
 *
 * KEINE erfundene Ober-/Untergrenze für die Beträge — dieselbe Begründung wie bei den
 * Lieferanten-Tarifen im Katalog: ein Betrag von 2,41 statt 24,1 ct/kWh ist eine gültige Zahl und
 * ein Tippfehler des Nutzers, das fängt kein Schema.
 *
 * ⚠ `.replace(',', '.')` VOR der Zahlprüfung: die Anzeige dieser Karte formatiert mit Komma
 * (de-AT). Ohne diese Zeile würde ein von einem Vergleichsportal abgetippter Preis wie „14,94" als
 * ungültig abgelehnt — der Nutzer tippt genau das, was er auf der fremden Seite sieht.
 *
 * ⚠ Die zwei Beträge gehen als ZAHL in den Entwurf, nicht als Zeichenkette: `DraftValue` lässt
 * `number` zu (`lib/project-chat/draft.ts`), und ein „14,94" als String müsste jeder spätere Leser
 * erneut auslegen — mit derselben Komma-Frage, die hier gerade beantwortet wurde.
 */
export async function saveMeteringPointTariffComparisonAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }

  const meteringPointId = String(formData.get('meteringPointId') ?? '')
  if (!UUID.test(meteringPointId)) return { formError: GENERIC }

  const providerName = String(formData.get('providerName') ?? '').trim()
  const priceBasis = String(formData.get('priceBasis') ?? '')
  const energyPriceRaw = String(formData.get('energyPriceCtPerKwh') ?? '')
  const baseFeeRaw = String(formData.get('baseFeeEurPerMonth') ?? '')

  const fieldErrors: Record<string, string> = {}
  if (providerName === '') {
    fieldErrors.providerName = 'Bitte den Namen des gefundenen Anbieters angeben.'
  }
  if (!(TARIFF_COMPARISON_PRICE_BASES as readonly string[]).includes(priceBasis)) {
    fieldErrors.priceBasis = 'Bitte angeben, ob der gefundene Preis netto oder brutto ist.'
  }
  const energyPrice = Number(energyPriceRaw.replace(',', '.'))
  if (energyPriceRaw.trim() === '' || !Number.isFinite(energyPrice) || energyPrice < 0) {
    fieldErrors.energyPriceCtPerKwh = 'Bitte den Arbeitspreis als Zahl angeben.'
  }
  const baseFee = Number(baseFeeRaw.replace(',', '.'))
  if (baseFeeRaw.trim() === '' || !Number.isFinite(baseFee) || baseFee < 0) {
    fieldErrors.baseFeeEurPerMonth = 'Bitte die Grundgebühr als Zahl angeben.'
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors, values: { providerName, priceBasis } }
  }

  const failure = await writeMeteringPointDraftFields(
    projectId,
    meteringPointId,
    [
      { field: TARIFF_COMPARISON_PROVIDER_NAME_KEY, value: providerName },
      { field: TARIFF_COMPARISON_ENERGY_PRICE_KEY, value: energyPrice },
      { field: TARIFF_COMPARISON_BASE_FEE_KEY, value: baseFee },
      { field: TARIFF_COMPARISON_PRICE_BASIS_KEY, value: priceBasis },
    ],
    'Vergleichstarif',
  )
  if (failure) return failure

  return { success: `Vermerkt: Vergleich mit ${providerName}.` }
}

/**
 * Den eingetragenen Vergleichstarif wieder entfernen — ALLE VIER Felder gemeinsam.
 *
 * ⚠ WARUM DIE VIER NICHT EINZELN LÖSCHBAR SIND: `currentComparison` (die Leseseite) gibt `null`
 * zurück, sobald EINES der vier fehlt. Bliebe eines stehen, verschwände die Zusammenfassung
 * trotzdem — und mit ihr der Löschknopf, der das übrige Feld noch hätte entfernen können. Der
 * Zählpunkt trüge danach dauerhaft einen halben Vergleich, den keine Oberfläche mehr anzeigt und
 * kein Weg mehr erreicht. Die Liste steht deshalb als EINE Konstante neben den vier Schlüsseln
 * (`TARIFF_COMPARISON_DRAFT_KEYS`), nicht hier abgeschrieben.
 *
 * Kein neuer Löschhelfer: `clearMeteringPointDraftFields` (PR #223) entfernt benannte Schlüssel
 * samt ihrer `_provenance`-Vermerke und liest den Entwurf dafür frisch — genau der Rahmen, den der
 * Löschweg der Batterie- und der PV-Station schon benutzt.
 */
export async function deleteMeteringPointTariffComparisonAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }

  const meteringPointId = String(formData.get('meteringPointId') ?? '')
  if (!UUID.test(meteringPointId)) return { formError: GENERIC }

  const failure = await clearMeteringPointDraftFields(
    projectId,
    meteringPointId,
    TARIFF_COMPARISON_DRAFT_KEYS,
    'Vergleichstarif löschen',
  )
  if (failure) return failure

  return { success: 'Vergleichstarif gelöscht.' }
}
