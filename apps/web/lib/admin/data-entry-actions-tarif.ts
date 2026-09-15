'use server'

import {
  TARIFF_COMPARISON_BASE_FEE_KEY,
  TARIFF_COMPARISON_ENERGY_PRICE_KEY,
  TARIFF_COMPARISON_PRICE_BASES,
  TARIFF_COMPARISON_PRICE_BASIS_KEY,
  TARIFF_COMPARISON_PROVIDER_NAME_KEY,
  TARIFF_PREFERENCES,
  TARIFF_PREFERENCE_KEY,
  type TariffPreference,
} from './tariff-draft'
import type { AdminState } from './schema'
import {
  GENERIC,
  UNKNOWN_PROJECT,
  UUID,
  readProjectId,
  writeMeteringPointDraftFields,
} from './data-entry-actions-shared'

// ── Tarif ────────────────────────────────────────────────────────────────────────────────────────
/**
 * B24, Teil 1 — die Tarif-Station, die fünfte und letzte je Zählpunkt.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ EINE ACTION, EIN FELD — DIE SCHMALSTE STATION DES WIZARDS
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Sie erhebt keine Zahl, liest keine Datei und löst KEINEN abrechenbaren Modellaufruf aus. Sie
 * hält einen WUNSCH fest: soll die Analyse den bestehenden Stromtarif als gegeben nehmen, oder
 * soll sie einen besseren vorschlagen? Das ist eine Anweisung an den Schritt, der den Entwurf
 * verbraucht (Teil 2) — kein Eingabewert für die Rechnung selbst.
 *
 * ── ⚠ DIE WAHL IST GESPEICHERT, NICHT EINE WEICHE ─────────────────────────────────────────────
 * Anders als „Haben Sie Lastgangsdaten?" (Lastgang-Station) und „Haben Sie bereits einen
 * Batteriespeicher?" (Batterie-Station) lebt diese Antwort NICHT in `useState`. Jene zwei sind
 * Aussagen über den Bearbeitungsmoment und verzweigen nur, welches Formular erscheint; diese ist
 * eine Aussage über den Kunden und muss den Seitenaufbau überdauern — sonst stünde beim nächsten
 * Öffnen des Wizards nicht mehr da, was er wollte.
 *
 * ── ⚠ ES GIBT KEINEN VERGLEICH UND KEINEN VORSCHLAG, und das ist Absicht ──────────────────────
 * `public.retail_tariffs` (13.09.2026) und `public.spot_prices` stehen bereit und werden hier mit
 * KEINEM Aufruf angefasst. Diese Station hält fest, WAS gewünscht ist; welcher Tarif dann der
 * bessere wäre, ist eine Rechnung über gepflegte Preisdaten und ein eigener Schritt. Beides
 * zugleich zu bauen hiesse, einen Vergleich zu zeigen, bevor feststeht, ob ihn jemand will.
 */

/**
 * „Behalten" oder „optimieren" — GENAU EIN Feld, GENAU EIN Aufruf.
 *
 * ⚠ Der Wert wird gegen `TARIFF_PREFERENCES` geprüft und nicht bloss auf „nicht leer": an den zwei
 * Knöpfen vorbei ist jede Zeichenkette möglich, und eine unbekannte landete sonst als Wunsch im
 * Entwurf, den später niemand deuten kann.
 */
export async function saveMeteringPointTariffPreferenceAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }

  const meteringPointId = String(formData.get('meteringPointId') ?? '')
  if (!UUID.test(meteringPointId)) return { formError: GENERIC }

  const answer = String(formData.get('preference') ?? '')
  if (!(TARIFF_PREFERENCES as readonly string[]).includes(answer)) {
    return { formError: GENERIC }
  }
  const preference = answer as TariffPreference

  const failure = await writeMeteringPointDraftFields(
    projectId,
    meteringPointId,
    [{ field: TARIFF_PREFERENCE_KEY, value: preference }],
    'Tarifwahl',
  )
  if (failure) return failure

  return {
    success:
      preference === 'behalten'
        ? 'Vermerkt: der aktuelle Stromtarif wird beibehalten.'
        : 'Vermerkt: die Analyse soll einen optimalen Tarif vorschlagen.',
  }
}

/**
 * Der selbst gefundene Vergleichstarif — vier Felder, EIN Aufruf, alle vier oder keines.
 *
 * ⚠ Anders als die Tarifwahl selbst KEIN erzwungener Schritt: die Station zeigt dieses Formular
 * nur im Zweig „optimieren" an, und selbst dort ist es freiwillig — es gibt keinen Vorgabewert
 * und keine Warnung, wenn es leer bleibt. Einmal begonnen (irgendein Feld ausgefüllt und
 * abgeschickt), müssen aber ALLE vier stimmen: ein halb eingetragener Vergleich (Name ohne Preis,
 * Preis ohne Basis) ist nicht weniger irreführend als ein erfundener.
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
