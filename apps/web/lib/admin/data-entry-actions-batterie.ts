'use server'

import {
  MAX_BATTERY_LOOKUP_INPUT_CHARS,
  MAX_BATTERY_SPEC_FILE_BYTES,
  MAX_BATTERY_TEXT_CHARS,
  extractBatterySpec,
  extractBatteryText,
  lookupBatterySpec,
} from 'extractors'
import { type BatteryLookupNotFoundReason } from 'shared'
import { type DraftValue } from '@/lib/project-chat/draft'
import {
  BATTERY_PRESENT_KEY,
  BATTERY_RECOMMENDATION_KEY,
  BATTERY_VALUE_FIELDS,
  formatBatteryNumber,
  parseBatteryNumber,
} from './battery-draft'
import type { AdminState } from './schema'
import {
  GENERIC,
  PDF_MEDIA_TYPE,
  UNKNOWN_PROJECT,
  UUID,
  formatMegabytes,
  readProjectId,
  writeMeteringPointDraftFields,
} from './data-entry-actions-shared'

// ── Batterie ─────────────────────────────────────────────────────────────────────────────────────
/**
 * B24, Teil 1 — die Batterie-Station.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DREI ACTIONS, UND NUR ZWEI DAVON SCHREIBEN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   `saveMeteringPointBatteryChoiceAction`  der Nein-Zweig: „Soll die Analyse einen
 *                                           Speichervorschlag enthalten?" — EIN Feld, EIN Aufruf.
 *   `extractBatteryTextFromAction`          liest den Freitext aus und schreibt NICHTS. Sie ist
 *                                           die einzige Action dieser Station, die einen
 *                                           abrechenbaren Modellaufruf auslöst.
 *   `saveMeteringPointBatteryAction`        der Ja-Zweig: die vier — ggf. von Hand korrigierten —
 *                                           Kenndaten in den Entwurf.
 *
 * ── ⚠ DIE FRAGE OBEN IST EINE WEICHE, KEINE GESPEICHERTE ANTWORT ──────────────────────────────
 * „Haben Sie bereits einen Batteriespeicher?" lebt wie bei der Lastgang-Station in `useState` und
 * erreicht keine dieser Actions als eigenes Feld. Gespeichert wird, was die ZWEIGE erheben:
 * `hasBattery: true` gehört zu den Kenndaten („diese Werte gehören zu einer vorhandenen Anlage")
 * und entsteht deshalb ausschliesslich beim Speichern des Ja-Zweigs.
 *
 * ⚠ `hasBattery: false` WIRD AUSDRÜCKLICH NICHT GESCHRIEBEN, und das ist eine Entscheidung:
 * Der Nein-Zweig erhebt eine andere Frage (den Speichervorschlag), und ein aus ihr abgeleitetes
 * „keine Batterie vorhanden" wäre ein zweites Signal neben `wantsBatteryRecommendation`, das ihm
 * widersprechen kann. Ein Zählpunkt ohne `hasBattery` im Entwurf heisst damit „dazu ist nichts
 * erfasst" — ob „ausdrücklich keine" ein eigenes Feld braucht, entscheidet der Schritt, der den
 * Entwurf verbraucht (Teil 2), nicht diese Station.
 *
 * ── ⚠ ES GIBT KEINE KATALOG-ZUORDNUNG, und das ist seit dem 01.09.2026 so ─────────────────────
 * Eine genannte Kapazität wird NICHT auf den nächstliegenden Katalog-Kandidaten gerundet
 * (Delta 17 Teil 2): für die bereits installierte Anlage weist der Report gar keinen Preis aus, und
 * übrig bliebe eine Ersparnis, die zu einem Gerät gehört, das der Kunde nicht besitzt. Gespeichert
 * werden ausschliesslich die vier Rohwerte; `battery-combination.ts` kommt hier nicht vor.
 *
 * ── ⚠ `hasExistingBattery` AUS DER EXTRAKTION WIRD VERWORFEN ──────────────────────────────────
 * Der Extraktor liest es mit (der öffentliche Rechner braucht es, weil dort die Frage NUR im Satz
 * steht). Im Wizard steht sie als Weiche darüber und ist bereits beantwortet — ein zweites,
 * womöglich widersprüchliches Signal aus dem Fliesstext wäre verwirrend, nicht hilfreich. Es
 * erreicht deshalb weder ein Feld noch den Entwurf.
 */


/**
 * Der Nein-Zweig: „Soll die Analyse einen Speichervorschlag enthalten?"
 *
 * ⚠ SIE SCHREIBT GENAU EIN FELD — `wantsBatteryRecommendation`. Keines der vier Kenndaten-Felder
 * und auch kein `hasBattery` (Begründung im Kopf dieses Abschnitts). Der Wert ist ein echter
 * Wahrheitswert, kein Vorhandensein eines Schlüssels: „nein, ausdrücklich kein Vorschlag" ist eine
 * Angabe und muss von „dazu wurde nichts gefragt" unterscheidbar bleiben.
 */
export async function saveMeteringPointBatteryChoiceAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }

  const meteringPointId = String(formData.get('meteringPointId') ?? '')
  if (!UUID.test(meteringPointId)) return { formError: GENERIC }

  const answer = String(formData.get('wantsRecommendation') ?? '')
  if (answer !== 'ja' && answer !== 'nein') {
    // Erreichbar nur an den zwei Knöpfen vorbei — die schicken feste Werte.
    return { formError: GENERIC }
  }
  const wants = answer === 'ja'

  const failure = await writeMeteringPointDraftFields(
    projectId,
    meteringPointId,
    [{ field: BATTERY_RECOMMENDATION_KEY, value: wants }],
    'Speichervorschlag',
  )
  if (failure) return failure

  return {
    success: wants
      ? 'Vermerkt: Die Analyse soll einen Speichervorschlag enthalten.'
      : 'Vermerkt: Es wird kein Speicher vorgeschlagen.',
  }
}

/**
 * Warum ein Freitext nicht ausgelesen werden konnte — die Zustände des Extraktors, in einem Satz.
 *
 * Dieselbe Liste wie im öffentlichen Rechner (`battery-text-panel.tsx`), nur knapper: dort steht je
 * Zustand ein eigener Absatz, hier eine Zeile über dem Formular. `api_error` heisst nach aussen
 * „fehlgeschlagen" — was genau schiefging, geht den Eintragenden nichts an.
 */
const BATTERY_TEXT_FAILURE_TEXT: Record<'not_configured' | 'api_error' | 'unreadable', string> = {
  not_configured: 'Das Auslesen freier Angaben ist auf diesem Server nicht eingerichtet. Die vier Felder lassen sich trotzdem von Hand ausfüllen.',
  api_error:
    'Das Auslesen ist fehlgeschlagen. Bitte später noch einmal versuchen — oder die vier Felder von Hand ausfüllen.',
  unreadable:
    'Aus dieser Angabe liessen sich keine Kenndaten lesen. Nötig sind die nutzbare Kapazität in kWh und die Lade-/Entladeleistung in kW; hilfreich ist zusätzlich der Wirkungsgrad.',
}

/**
 * Liest die Kenndaten aus einem frei formulierten Satz und gibt sie als Formularwerte zurück.
 *
 * ⚠ SIE SCHREIBT NICHTS. Zwischen dem Gelesenen und dem Gespeicherten steht ein zweiter, eigener
 * Klick — dasselbe Muster wie beim Preisblatt-Vorschlag der Rechnungs-Station und wie im
 * öffentlichen Rechner: der Vorschlag ist eine ANGEFORDERTE Auskunft, was damit geschieht,
 * entscheidet ein Mensch.
 *
 * ⚠ DIE PRÜFUNG LÄUFT VOR JEDEM EXTERNEN KONTAKT. Eine Server Action ist über ihre Kennung
 * aufrufbar, und jeder Aufruf ist abrechenbar — die Kürzung auf `MAX_BATTERY_TEXT_CHARS` und die
 * Leerprüfung sind deshalb eine echte Sperre, keine Bedienhilfe (das `maxlength` des Textfelds ist
 * eine Angabe des Browsers).
 *
 * ── ⚠ „GELESEN, ABER KEINE ZAHL" WIRD WIE „NICHTS GELESEN" BEHANDELT ──────────────────────────
 * Der Extraktor meldet `unreadable` nur, wenn ALLE fünf Felder leer sind — `hasExistingBattery`
 * eingeschlossen. Ein Satz wie „ja, wir haben einen Speicher" liefert damit ein `ok` ohne eine
 * einzige Zahl. Würde das als Erfolg durchgereicht, leerte es die vier Felder und behauptete
 * dabei, es habe etwas gelesen. Es bekommt deshalb denselben Satz — und die Felder bleiben, wie
 * sie sind.
 */
export async function extractBatteryTextFromAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const text = String(formData.get('batteryText') ?? '').trim()
  if (text === '') {
    return {
      fieldErrors: {
        batteryText: 'Bitte den Speicher kurz beschreiben — oder die Felder von Hand ausfüllen.',
      },
    }
  }

  const outcome = await extractBatteryText(text.slice(0, MAX_BATTERY_TEXT_CHARS))
  if (!outcome.ok) return { formError: BATTERY_TEXT_FAILURE_TEXT[outcome.reason] }

  /*
   * ⚠ ALLE VIER FELDER WERDEN GESETZT, auch die nicht gelesenen (als Leerstring).
   *
   * Ein nicht gelesenes Feld stehen zu lassen hiesse, einen Wert aus einer FRÜHEREN Ablesung neben
   * frischen stehen zu haben, ohne dass man die beiden unterscheiden kann. Was hier erscheint, ist
   * die Aussage GENAU DIESES Satzes — nicht mehr und nicht weniger. Der Preis ist benannt und in
   * der Oberfläche ausgeschrieben: eine von Hand eingetippte Zahl verliert man mit einem zweiten
   * Klick auf „Auslesen".
   */
  const values: Record<string, string> = {}
  let found = 0
  for (const entry of BATTERY_VALUE_FIELDS) {
    const value = outcome.extraction[entry.form]
    if (value === null) {
      values[entry.form] = ''
      continue
    }
    values[entry.form] = formatBatteryNumber(value)
    found += 1
  }

  if (found === 0) return { formError: BATTERY_TEXT_FAILURE_TEXT.unreadable }

  /*
   * Der Marker unterscheidet „eben gelesen" von „noch nie gelaufen" — der Zustand aus
   * `useActionState` ist beim ersten Render leer, und ein leeres `values` sähe genauso aus.
   * Dieselbe Form wie `lookup === 'ok'` bei der manuellen Tarifeingabe.
   */
  values.extraction = 'ok'
  values.found = String(found)
  return { values }
}

/**
 * Der Ja-Zweig: die vier Kenndaten in den Entwurf.
 *
 * ── DIE REIHENFOLGE ────────────────────────────────────────────────────────────────────────────
 *   1. alle gefüllten Felder prüfen (ein Fehler bricht VOR jedem Schreibvorgang ab — ein halb
 *      übernommenes Formular wäre der Zustand, den niemand nachvollziehen kann)
 *   2. Entwurf frisch lesen, Werte hineinfalten, EINMAL schreiben (`writeMeteringPointDraftFields`)
 *
 * ── ⚠ `hasBattery: true` WIRD IMMER GESCHRIEBEN, AUCH OHNE EINE EINZIGE ZAHL ──────────────────
 * „Es gibt einen Speicher, die Kenndaten fehlen noch" ist eine Angabe und nicht dasselbe wie „dazu
 * ist nichts erfasst": das eine ist eine Lücke, die der KI-Check benennen kann, das andere eine
 * Frage, die niemand gestellt hat. Deshalb hier ausdrücklich KEINE Sperre „mindestens ein Wert",
 * anders als bei der manuellen Tarifeingabe — dort gäbe es ohne Eingabe wirklich nichts zu
 * schreiben.
 *
 * ── EIN LEERES FELD IST KEINE ANGABE ──────────────────────────────────────────────────────────
 * Es wird übersprungen, nicht als `null` geschrieben: ein zuvor erfasster Wert bleibt dadurch
 * stehen, statt von einem leeren Formularfeld gelöscht zu werden. Dieselbe schonende Richtung wie
 * bei der manuellen Tarifeingabe und beim Widerspruch zweier Rechnungen.
 */
export async function saveMeteringPointBatteryAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }

  const meteringPointId = String(formData.get('meteringPointId') ?? '')
  if (!UUID.test(meteringPointId)) return { formError: GENERIC }

  const fieldErrors: Record<string, string> = {}
  const values: { field: string; value: DraftValue }[] = [
    { field: BATTERY_PRESENT_KEY, value: true },
  ]

  for (const entry of BATTERY_VALUE_FIELDS) {
    const parsed = parseBatteryNumber(String(formData.get(entry.form) ?? ''), entry.max)
    if (parsed === undefined) continue
    if (parsed === null) {
      fieldErrors[entry.form] =
        entry.max === undefined
          ? 'Bitte eine Zahl grösser als 0 eintragen, z. B. 19,2.'
          : `Bitte eine Zahl zwischen 0 und ${entry.max} eintragen, z. B. 90.`
      continue
    }
    values.push({ field: entry.field, value: parsed })
  }

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }

  const failure = await writeMeteringPointDraftFields(
    projectId,
    meteringPointId,
    values,
    'Batterie',
  )
  if (failure) return failure

  // `values` trägt immer `hasBattery` — gezählt werden die Kenndaten daneben.
  const count = values.length - 1
  return {
    success:
      count === 0
        ? 'Vermerkt: Es ist bereits ein Speicher vorhanden. Kenndaten wurden keine erfasst — sie lassen sich hier jederzeit nachtragen.'
        : count === 1
          ? 'Eine Angabe zum vorhandenen Speicher wurde übernommen. Leer gelassene Felder bleiben unverändert.'
          : `${count} Angaben zum vorhandenen Speicher wurden übernommen. Leer gelassene Felder bleiben unverändert.`,
  }
}

/**
 * B24, Teil 1 — der ZWEITE Weg zu denselben vier Kenndaten: ein PDF-Datenblatt.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ SIE SPEIST IN DENSELBEN MECHANISMUS, SIE ERSETZT IHN NICHT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Der Extraktor liefert die vier Zahlenfelder unter EXAKT denselben Namen wie die
 * Freitexterfassung (`BATTERY_SPEC_NUMBER_KEYS` ist per `satisfies` an `BATTERY_TEXT_NUMBER_KEYS`
 * gebunden, `packages/shared`). Diese Action läuft deshalb über dieselbe `BATTERY_VALUE_FIELDS`,
 * füllt dieselben Formularfelder und übergibt an denselben „Speichern"-Knopf
 * (`saveMeteringPointBatteryAction`) — an `battery-draft.ts` und am Schreibweg ist KEINE Zeile
 * geändert. Es gibt damit auch weiterhin nur EINEN Ort, an dem eine Batterie-Angabe in den Entwurf
 * gelangt.
 *
 * ⚠ SIE SCHREIBT NICHTS. Zwischen dem Gelesenen und dem Gespeicherten steht ein zweiter, eigener
 * Klick — wortgleich zur Freitext-Action daneben und zum Preisblatt-Vorschlag der
 * Rechnungs-Station: der Vorschlag ist eine ANGEFORDERTE Auskunft, was damit geschieht,
 * entscheidet ein Mensch. Bei einem Datenblatt wiegt das schwerer als beim Satz: der Eintragende
 * hat die vier Zahlen dort nicht selbst formuliert und kann nur am Ergebnis prüfen, ob die
 * richtige Spalte gelesen wurde.
 *
 * ── DIE PRÜFKETTE LÄUFT VOR JEDEM EXTERNEN KONTAKT ────────────────────────────────────────────
 * Leer, kein PDF, zu gross — alles drei ist rein und kostet nichts. Eine Server Action ist über
 * ihre Kennung aufrufbar, und jeder Aufruf dahinter ist abrechenbar; die Prüfungen sind deshalb
 * eine echte Sperre und keine Bedienhilfe (das `accept` des Dateifelds ist eine Angabe des
 * Browsers).
 *
 * ── ⚠ DIE DATEI WIRD NICHT ABGELEGT, UND DAS IST DER UNTERSCHIED ZUR RECHNUNGS-STATION ────────
 * Dort landet jede PDF in `platform.project_documents`, weil sie ein BELEG des Kunden ist: ein
 * Mensch kann sie lesen, der KI-Check sieht sie, und sie gehört zum Projekt. Ein Datenblatt ist
 * das Gegenteil — ein öffentlich verfügbares Herstellerdokument, das über den Kunden nichts
 * aussagt. Es abzulegen brächte eine Zeile in die Dokumentenliste, die dort niemandem hilft, und
 * einen Löschweg, den es für Projekt-Dokumente ohnehin nicht gibt. Gelesen wird es, gespeichert
 * werden die vier Zahlen.
 *
 * ── ⚠ HERSTELLER UND MODELL WERDEN GELESEN, GEZEIGT UND NICHT GESCHRIEBEN ─────────────────────
 * Dieselbe Behandlung wie `netzbetreiber` beim Rechnungs-Scan: sie reisen als Anzeigewerte in der
 * Antwort mit, haben aber keinen Entwurfs-Schlüssel. Sie zu verschweigen wäre die schlechtere
 * Wahl — „Sungrow SBR128" neben den vier Zahlen ist das Einzige, woran ein Mensch erkennt, ob das
 * RICHTIGE Datenblatt gelesen wurde, und bei einer Produktfamilie ist genau das die Frage.
 */

/** Warum ein Datenblatt nicht gelesen werden konnte — die Zustände des Extraktors, in einem Satz. */
const BATTERY_SPEC_FAILURE_TEXT: Record<'not_configured' | 'api_error' | 'unreadable', string> = {
  not_configured:
    'Das Auslesen von Datenblättern ist auf diesem Server nicht eingerichtet. Die vier Felder lassen sich trotzdem von Hand ausfüllen.',
  api_error:
    'Das Auslesen ist fehlgeschlagen. Bitte später noch einmal versuchen — oder die vier Felder von Hand ausfüllen.',
  unreadable:
    'Auf diesem Dokument war nichts zu finden — das kann an der Bildqualität liegen, aber auch daran, dass es kein Batterie-Datenblatt ist.',
}

/**
 * Liest die Kenndaten aus einem Datenblatt und gibt sie als Formularwerte zurück.
 *
 * ── ⚠ „GELESEN, ABER KEINE KENNZAHL" IST EIN EIGENER, HÄUFIGER FALL ──────────────────────────
 * Der Extraktor meldet `unreadable` nur, wenn ALLE SECHS Felder leer sind — Hersteller und Modell
 * eingeschlossen. Ein Blatt, das eine ganze Produktfamilie beschreibt, ohne eine Variante
 * hervorzuheben, liefert deshalb ein `ok` mit Typbezeichnung und OHNE eine einzige Zahl, und das
 * ist die richtige Antwort des Extraktors (welche Variante der Kunde hat, steht dort nicht).
 *
 * Als Erfolg durchgereicht leerte es die vier Felder und behauptete dabei, es habe Kenndaten
 * gelesen. Es bekommt deshalb einen EIGENEN Satz, der das Gelesene benennt und sagt, was zu tun
 * ist — und die Felder bleiben, wie sie sind. Dieselbe Stelle wie im Freitext-Weg, nur mit einer
 * anderen, konkreteren Auskunft: dort kann man nichts weiter tun, hier schon.
 */
export async function scanBatterySpecAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const entry = formData.get('batterySpec')
  const file = entry instanceof File ? entry : null

  if (!file || file.size === 0) {
    return {
      fieldErrors: {
        batterySpec: 'Bitte ein Datenblatt als PDF wählen — oder die Felder von Hand ausfüllen.',
      },
    }
  }
  /*
   * Der Medientyp kommt vom Browser und ist kein Beweis — die eigentliche Sperre ist, dass die API
   * den `document`-Block mit genau diesem Typ erwartet. Diese Prüfung fängt den ehrlichen Irrtum
   * ab, bevor er Geld kostet (wortgleich zur Rechnungs-Station).
   */
  if (file.type !== PDF_MEDIA_TYPE) {
    return {
      fieldErrors: {
        batterySpec: 'Nur PDF — ein Foto oder Screenshot des Datenblatts lässt sich nicht auslesen.',
      },
    }
  }
  if (file.size > MAX_BATTERY_SPEC_FILE_BYTES) {
    return {
      fieldErrors: {
        batterySpec:
          `Diese Datei ist zu gross (${formatMegabytes(file.size)} MB). Mehr als ` +
          `${Math.floor(MAX_BATTERY_SPEC_FILE_BYTES / (1024 * 1024))} MB nimmt der Scan nicht an.`,
      },
    }
  }

  const bytes = await file.arrayBuffer()
  const outcome = await extractBatterySpec(Buffer.from(bytes).toString('base64'))
  if (!outcome.ok) return { formError: BATTERY_SPEC_FAILURE_TEXT[outcome.reason] }

  /*
   * ⚠ ALLE VIER FELDER WERDEN GESETZT, auch die nicht gelesenen (als Leerstring).
   *
   * Ein nicht gelesenes Feld stehen zu lassen hiesse, einen Wert aus einer FRÜHEREN Ablesung neben
   * frischen stehen zu haben, ohne dass man die beiden unterscheiden kann. Was hier erscheint, ist
   * die Aussage GENAU DIESES Dokuments. Der Preis ist derselbe wie beim Freitext-Weg und in der
   * Oberfläche ausgeschrieben: eine von Hand eingetippte Zahl verliert man mit einem zweiten Scan.
   */
  const values: Record<string, string> = {}
  let found = 0
  for (const field of BATTERY_VALUE_FIELDS) {
    const value = outcome.extraction[field.form]
    if (value === null) {
      values[field.form] = ''
      continue
    }
    values[field.form] = formatBatteryNumber(value)
    found += 1
  }

  /*
   * Hersteller und Modell NUR zur Anzeige — sie tragen keinen Entwurfs-Schlüssel und füllen kein
   * Feld (s. Kopf). Ein Leerstring statt `undefined`, damit die Oberfläche „nicht gelesen" nicht
   * von „gar nicht gefragt" unterscheiden muss.
   */
  const label = [outcome.extraction.manufacturer, outcome.extraction.model]
    .filter((part): part is string => part !== null)
    .join(' ')

  if (found === 0) {
    return {
      formError:
        label === ''
          ? BATTERY_SPEC_FAILURE_TEXT.unreadable
          : `Gelesen wurde „${label}", aber keine einzige Kennzahl. Beschreibt das Datenblatt ` +
            'mehrere Varianten einer Produktfamilie, steht dort nicht, welche gemeint ist — bitte ' +
            'die Werte der richtigen Variante von Hand eintragen.',
    }
  }

  /*
   * Der Marker unterscheidet „eben gelesen" von „noch nie gelaufen" — der Zustand aus
   * `useActionState` ist beim ersten Render leer, und ein leeres `values` sähe genauso aus.
   * ⚠ Er heisst GENAUSO wie im Freitext-Weg (`extraction: 'ok'`), und das ist Absicht: beide
   * Wege füllen dieselben Felder, und die Oberfläche wendet auf beide dieselbe Übernahme an.
   */
  values.extraction = 'ok'
  values.found = String(found)
  values.label = label
  return { values }
}

/**
 * B24, Teil 1 — der DRITTE Weg zu denselben vier Kenndaten: Marke und Typ im Web nachschlagen.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ SIE SPEIST IN DENSELBEN MECHANISMUS, SIE ERSETZT IHN NICHT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Der Extraktor liefert die vier Zahlenfelder unter EXAKT denselben Namen wie Freitexterfassung
 * und Datenblatt-Scan (`BATTERY_LOOKUP_NUMBER_KEYS` ist per `satisfies` an
 * `BATTERY_TEXT_NUMBER_KEYS` gebunden, `packages/shared`). Diese Action läuft deshalb über
 * dieselbe `BATTERY_VALUE_FIELDS`, füllt dieselben Formularfelder und übergibt an denselben
 * „Speichern"-Knopf (`saveMeteringPointBatteryAction`) — an `battery-draft.ts` und am Schreibweg
 * ist KEINE Zeile geändert. Es gibt damit weiterhin nur EINEN Ort, an dem eine Batterie-Angabe in
 * den Entwurf gelangt.
 *
 * ⚠ SIE SCHREIBT NICHTS. Zwischen dem Gefundenen und dem Gespeicherten steht ein zweiter, eigener
 * Klick — wortgleich zu den beiden Wegen daneben. Hier wiegt das am schwersten von allen dreien:
 * beim Satz hat der Eintragende die Zahlen selbst formuliert, beim Datenblatt hat er das Papier
 * vor sich, hier hat er WEDER das eine NOCH das andere. Was ihm bleibt, ist die Quellenangabe —
 * und genau deshalb wird sie angezeigt, bevor irgendetwas gespeichert wird.
 *
 * ── DIE PRÜFKETTE LÄUFT VOR JEDEM EXTERNEN KONTAKT ────────────────────────────────────────────
 * Leer, zu lang — beides ist rein und kostet nichts. Eine Server Action ist über ihre Kennung
 * aufrufbar, und was dahinter liegt, ist teurer als bei jeder Anbindung davor: neben dem
 * Modellaufruf bezahlt jede Suche, und die Treffer landen als Eingabe-Tokens im Kontext (gemessen:
 * rund 57.000 für EINEN Vorschlag). Die Prüfungen sind deshalb eine echte Sperre, keine
 * Bedienhilfe — das `maxlength` der zwei Textfelder ist eine Angabe des Browsers.
 *
 * ── ⚠ ES WIRD KEINE DATEI ABGELEGT UND KEINE QUELLE GESPEICHERT ───────────────────────────────
 * Die gefundenen Adressen reisen als Anzeigewerte in der Antwort mit und haben keinen
 * Entwurfs-Schlüssel. Sie sind eine Auskunft über DIESEN Vorschlag, kein Beleg am Zählpunkt: was
 * gespeichert wird, sind die vier Zahlen, die ein Mensch danach bestätigt hat — ab dann sind es
 * seine Angaben, nicht die einer Website. (Dieselbe Behandlung wie `netzbetreiber` beim
 * Rechnungs-Scan und Hersteller/Modell beim Datenblatt-Scan.)
 */

/** Warum eine Recherche nichts ergeben hat — die Zustände des Extraktors, in einem Satz. */
const BATTERY_LOOKUP_FAILURE_TEXT: Record<'not_configured' | 'api_error' | 'unreadable', string> = {
  not_configured:
    'Die Marke/Typ-Recherche ist auf diesem Server nicht eingerichtet. Die vier Felder lassen sich trotzdem von Hand ausfüllen.',
  api_error:
    'Die Recherche ist fehlgeschlagen. Bitte später noch einmal versuchen — oder die vier Felder von Hand ausfüllen.',
  unreadable:
    'Zu dieser Angabe war nichts zu finden. Bitte Hersteller und Typbezeichnung prüfen — oder die vier Felder von Hand ausfüllen.',
}

/**
 * Warum ein gefundenes Produkt keine Kennzahlen geliefert hat.
 *
 * ── ⚠ DIE SÄTZE STEHEN HIER, DER GRUND KOMMT ALS SCHLÜSSEL ────────────────────────────────────
 * Der Extraktor gibt eine geschlossene Liste zurück und keinen Satz — „kein Freitextfeld in der
 * Rückgabe" gilt in allen sechs Anbindungen. Eine Begründung des Modells über die eigene
 * Sicherheit würde hier als Auskunft des Rechners erscheinen; formuliert wird deshalb bei uns.
 *
 * ⚠ `no_evidence` ist der einzige Grund, den NICHT das Modell vergibt, sondern die Belegprüfung
 * (`parseBatteryLookupExtraction`): es gab Zahlen, aber keine nachweisbare Quelle dafür. Sein Satz
 * sagt das im Klartext, statt es als Suchmisserfolg zu tarnen — der Unterschied ist für den
 * Eintragenden wesentlich, weil er hier NICHT durch eine bessere Eingabe zu beheben ist.
 */
const BATTERY_LOOKUP_REASON_TEXT: Record<BatteryLookupNotFoundReason, string> = {
  not_identified:
    'Unter dieser Bezeichnung war kein Speicher zu finden. Bitte Schreibweise von Hersteller und Typ prüfen.',
  ambiguous:
    'Die Bezeichnung passt auf mehrere Varianten, und welche gemeint ist, steht in keiner Quelle. Bitte die genaue Typbezeichnung angeben (sie steht meist auf dem Typenschild) — oder die Werte von Hand eintragen.',
  no_specs:
    'Das Produkt ist gefunden, verlässliche Kenndaten waren dazu aber nicht auffindbar. Bitte die Werte von Hand eintragen.',
  no_evidence:
    'Es liess sich keine Quelle belegen, auf der die Werte stehen. Ungeprüfte Zahlen werden hier bewusst nicht vorgeschlagen — bitte die Werte von Hand eintragen.',
}

/**
 * Sucht die Kenndaten zu Hersteller und Modell und gibt sie als Formularwerte zurück.
 *
 * ── ⚠ „GEFUNDEN, ABER KEINE KENNZAHL" IST EIN EIGENER, HÄUFIGER FALL ─────────────────────────
 * Der Extraktor meldet `unreadable` nur, wenn ALLE Felder leer sind — Hersteller und Modell
 * eingeschlossen. Eine Bezeichnung, die auf eine ganze Produktfamilie passt, liefert deshalb ein
 * `ok` mit Typbezeichnung und OHNE eine einzige Zahl, und das ist die richtige Antwort (welche
 * Variante der Kunde hat, steht nirgends).
 *
 * Als Erfolg durchgereicht leerte es die vier Felder und behauptete dabei, es habe Kenndaten
 * gefunden. Es bekommt deshalb einen eigenen Satz je Grund (s. oben) — und die Felder bleiben, wie
 * sie sind. Dieselbe Stelle wie in den beiden Wegen daneben, nur mit einer konkreteren Auskunft:
 * dort kann man nichts weiter tun, hier führt eine genauere Typbezeichnung oft zum Ziel.
 */
export async function lookupBatterySpecByModelAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const manufacturer = String(formData.get('batteryManufacturer') ?? '').trim()
  const model = String(formData.get('batteryModel') ?? '').trim()

  /*
   * ⚠ BEIDE ANGABEN SIND PFLICHT, und das ist eine Kostenentscheidung: eine Typbezeichnung ohne
   * Hersteller („HVS 10.2") passt im offenen Web auf beliebig viele Produkte, und eine Marke ohne
   * Typ auf das ganze Sortiment. Beides führte in eine Suche, die teuer ist und deren Ergebnis
   * anschliessend als `ambiguous` abgelehnt wird — die Ablehnung steht besser hier, bevor sie Geld
   * kostet.
   */
  if (manufacturer === '') {
    return {
      fieldErrors: {
        batteryManufacturer: 'Bitte den Hersteller angeben — oder die Felder von Hand ausfüllen.',
      },
    }
  }
  if (model === '') {
    return {
      fieldErrors: {
        batteryModel:
          'Bitte die Modell-/Typbezeichnung angeben — oder die Felder von Hand ausfüllen.',
      },
    }
  }
  if (
    manufacturer.length > MAX_BATTERY_LOOKUP_INPUT_CHARS ||
    model.length > MAX_BATTERY_LOOKUP_INPUT_CHARS
  ) {
    /*
     * ⚠ ABGEWIESEN UND NICHT GEKÜRZT. Bei einem Satz wäre Kürzen richtig (es bleibt derselbe Satz,
     * nur kürzer); eine halbierte Typbezeichnung ist dagegen eine ANDERE Bezeichnung, und die
     * Recherche suchte dann nach einem Produkt, das niemand genannt hat.
     */
    return {
      fieldErrors: {
        batteryModel:
          `Hersteller und Typ dürfen je höchstens ${MAX_BATTERY_LOOKUP_INPUT_CHARS} Zeichen haben. ` +
          'Gemeint ist die Bezeichnung vom Typenschild, kein ganzer Satz.',
      },
    }
  }

  const outcome = await lookupBatterySpec(manufacturer, model)
  if (!outcome.ok) return { formError: BATTERY_LOOKUP_FAILURE_TEXT[outcome.reason] }

  /*
   * ⚠ ALLE VIER FELDER WERDEN GESETZT, auch die nicht gefundenen (als Leerstring).
   *
   * Ein nicht gefundenes Feld stehen zu lassen hiesse, einen Wert aus einer FRÜHEREN Ablesung
   * neben frischen stehen zu haben, ohne dass man die beiden unterscheiden kann. Was hier
   * erscheint, ist das Ergebnis GENAU DIESER Recherche. Der Preis ist derselbe wie bei den beiden
   * Wegen daneben und in der Oberfläche ausgeschrieben: eine von Hand eingetippte Zahl verliert
   * man mit einer zweiten Suche.
   */
  const values: Record<string, string> = {}
  let found = 0
  for (const field of BATTERY_VALUE_FIELDS) {
    const value = outcome.extraction[field.form]
    if (value === null) {
      values[field.form] = ''
      continue
    }
    values[field.form] = formatBatteryNumber(value)
    found += 1
  }

  const label = [outcome.extraction.manufacturer, outcome.extraction.model]
    .filter((part): part is string => part !== null)
    .join(' ')

  if (found === 0) {
    /*
     * Der Grund des Extraktors, falls er einen hat — sonst der allgemeine „gefunden, aber nichts
     * Belastbares"-Satz. Der Produktname steht davor, wo es einen gibt: er ist die Auskunft
     * darüber, WORAN es lag (eine Familie statt einer Variante sieht man erst an ihm).
     */
    const reason = outcome.extraction.notFound
      ? BATTERY_LOOKUP_REASON_TEXT[outcome.extraction.notFound]
      : BATTERY_LOOKUP_REASON_TEXT.no_specs
    return {
      formError: label === '' ? reason : `Gefunden wurde „${label}". ${reason}`,
    }
  }

  /*
   * Der Marker unterscheidet „eben gesucht" von „noch nie gelaufen" — der Zustand aus
   * `useActionState` ist beim ersten Render leer, und ein leeres `values` sähe genauso aus.
   * ⚠ Er heisst GENAUSO wie in den beiden Wegen daneben (`extraction: 'ok'`), und das ist Absicht:
   * alle drei füllen dieselben Felder, und die Oberfläche wendet auf alle drei dieselbe Übernahme
   * an.
   */
  values.extraction = 'ok'
  values.found = String(found)
  values.label = label
  /*
   * ⚠ DIE QUELLEN REISEN ALS EINE ZEILE MIT, nicht als Liste — `AdminState.values` ist ein flaches
   * `Record<string, string>` (es kommt aus einem Formular-Zustand). Getrennt wird mit einem
   * Leerzeichen: eine URL enthält keines, und die Aufteilung in der Oberfläche ist damit eindeutig.
   * Die Liste ist bereits geprüft und auf `MAX_BATTERY_LOOKUP_SOURCE_URLS` begrenzt
   * (`packages/shared`); hier wird nichts mehr gefiltert.
   */
  values.sourceUrls = outcome.extraction.sourceUrls.join(' ')
  return { values }
}
