import { SPOT_PRICE_ANCHOR_DATE, analysisWindow, startsBeforeSpotPriceAnchor } from 'shared'
import type { LoadProfile } from 'shared'

/**
 * Delta 15, Regel B — die Untergrenze des Kalkulators.
 *
 * Ein Lastgang, der VOR dem 1.1.2025 beginnt, wird abgelehnt: für diesen Zeitraum gibt es keine
 * Marktpreise (`public.spot_prices`, Backfill-Anker aus B21-2a), und der Tarifvergleich würde
 * später an der fehlenden Preiskurve scheitern — an einer Stelle, an der die Meldung niemandem mehr
 * sagt, was zu tun ist. Ablehnen heisst deshalb: früh, mit dem konkreten Datum der Datei und dem
 * konkreten frühesten zulässigen Datum.
 *
 * ── WO DIE PRÜFUNG SITZT, UND WARUM NICHT IM PARSER ────────────────────────────────────────────
 * In den Einstiegen, nicht in `parseLoadProfile`. Der Parser ist die generische Lese-Fähigkeit der
 * Engine; er liest eine Datei korrekt oder nicht. „Ab wann nehmen wir einen Lastgang an" ist dagegen
 * eine Produktentscheidung, die sich mit dem Datenbestand ändert (wächst der Backfill nach hinten,
 * wandert die Grenze mit). Im Parser stünde sie zwischen den Formaterkennungen und machte ausserdem
 * vier grüne Engine-Testdateien rot, die bewusst mit 2023er-Fixtures rechnen.
 *
 * ── ⚠ SIE GILT FÜR JEDEN WEG, DER EINEN LASTGANG ERZEUGT ──────────────────────────────────────
 * Deshalb steht sie seit Delta 17 in einem eigenen Modul statt als lokale Hilfe im Upload-Schritt:
 * Es gibt inzwischen VIER Wege (stiller Datei-Pfad · Mapping-Bestätigung · Standardprofil ·
 * mehrzeiliger Upload), und eine Regel, die nur einen von ihnen abdeckt, ist keine. Verhaltensgleich
 * zur bisherigen Fassung in `components/flow/step-upload.tsx`; nur der Ort hat sich geändert.
 */
export function rejectIfBeforeAnchor(profile: LoadProfile, timezone: string): string | null {
  const window = analysisWindow(profile)
  if (!window || !startsBeforeSpotPriceAnchor(window, timezone)) return null

  /*
   * Beide Daten in der Zeitzone des Lastgangs formatiert, damit im Text dasselbe Datum steht, das
   * in der Datei steht — und dasselbe, gegen das die Regel geprüft hat. Der Anker wird dafür als
   * reines Datum (`T00:00` ortszeitlich) gelesen und NICHT als der UTC-Zeitpunkt: sonst nennte die
   * Meldung in Wien den „1. Jänner 2025, 01:00" als Grenze und wäre um eine Stunde neben der Regel.
   */
  const fmt = new Intl.DateTimeFormat('de-AT', { dateStyle: 'long', timeZone: timezone })
  const beginn = fmt.format(new Date(window.startIso))
  const frühestens = fmt.format(new Date(`${SPOT_PRICE_ANCHOR_DATE}T12:00:00Z`))

  return (
    `Ihr Lastgang beginnt am ${beginn}. Für den Tarifvergleich stehen Börsen-Strompreise erst ` +
    `ab ${frühestens} zur Verfügung — ältere Zeiträume lassen sich damit nicht ehrlich ` +
    `nachrechnen. Bitte laden Sie einen Lastgang hoch, der am oder nach dem ${frühestens} ` +
    `beginnt; ideal sind die letzten zwölf Monate.`
  )
}
