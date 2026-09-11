import type Anthropic from '@anthropic-ai/sdk'
import { tariffParamsSchema } from 'shared'

import {
  COVERAGE_GAP_TOLERANCE_DAYS,
  INVOICE_PERIOD_FROM_KEY,
  INVOICE_PERIOD_TO_KEY,
} from './consistency'
import { INDUSTRY_KEY_PATTERN, PROJECT_SEGMENTS } from './ports'
import type { ChatExtractors } from './ports'

/**
 * B24 — DIE WERKZEUGE DES PROJEKT-CHATS. Reine Definitionen, kein Rumpf.
 *
 * ── DIE ZWEI FAMILIEN, UND WARUM SIE SICH UNTERSCHEIDLICH VERHALTEN ────────────────────────────
 * (1) ZUSTANDS-Werkzeuge (`set_segment`, `set_industry`, `set_draft_field`, `flag_open_question`,
 *     `check_draft_completeness`, `check_data_consistency`) schreiben und lesen den Projektzustand
 *     aus der Migration 20260910090000 (bzw. 20260910150000 für die Branche). Sie sind IMMER da.
 *
 *     ⚠ Die zwei `check_*` sind reine PRÜFUNGEN: sie ändern nichts und lösen nichts auf. Was aus
 *     einem Befund folgt, entscheidet der Kunde über `flag_open_question`/`set_draft_field`.
 * (2) EXTRAKTIONS-Werkzeuge (`classify_upload`, `extract_invoice`, `extract_pv_design`,
 *     `extract_battery_description`, `extract_load_profile`) sind dünne Adapter auf die Leser in
 *     `packages/extractors`. Sie erscheinen NUR, wenn der zugehörige Port da ist — Begründung im
 *     Kopf von `ports.ts`. Ein angebotenes Werkzeug ohne Rumpf wäre eine Requisite, und der Kunde
 *     bekäme „ich lese Ihre Rechnung" zu hören, wo nichts gelesen wird.
 *
 *     ⚠ `extract_load_profile` fällt in dieser Familie zweifach aus dem Rahmen: es löst KEINEN
 *     Modellaufruf aus (deterministisches Parsen), und es SCHREIBT selbst — an den Zählpunkt, nicht
 *     in den Entwurf. Beides steht an seiner Definition unten begründet.
 *
 * ── ⚠ KEIN `strict: true` IN DIESER ERSTEN FASSUNG ────────────────────────────────────────────
 * `strict: true` verlangt `additionalProperties: false` PLUS eine vollständige `required`-Liste —
 * ein optionaler Parameter muss dort also mitstehen und dafür nullbar werden, und `set_draft_field`
 * bräuchte zusätzlich eine Typ-Union für seinen Wert. Die Kombination Typ-Union + Schema-Zwang ist
 * in diesem Repo schon einmal teuer geworden (Delta 9b-2a: nach JSON Schema gültig, von der API mit
 * HTTP 400 abgewiesen, VOR dem Modellaufruf — der Rechnungs-Scan war dadurch in Produktion
 * vollständig funktionslos), und für WERKZEUG-Schemata ist sie hier gegen die echte API nicht
 * gemessen. Was `strict` leisten würde, leistet der Ausführer ohnehin: er prüft jede Eingabe selbst
 * und antwortet bei einem Fehler mit einem lesbaren `tool_result`, das das Modell korrigieren kann
 * — geprüft in `executor.test.ts`. `strict` nachzurüsten ist Sache des Abstimmungs-Schritts, mit
 * einer Messung gegen die echte API davor.
 */

export const CHAT_TOOL_NAMES = [
  'set_segment',
  'set_industry',
  'set_draft_field',
  'check_draft_completeness',
  'check_data_consistency',
  'flag_open_question',
  'classify_upload',
  'extract_invoice',
  'extract_pv_design',
  'extract_battery_description',
  'extract_load_profile',
] as const
export type ChatToolName = (typeof CHAT_TOOL_NAMES)[number]

/**
 * Welches Werkzeug hängt an welchem Port? Ein Werkzeug ohne Eintrag ist immer verfügbar.
 *
 * Der Schlüssel ist der PORT-Name, nicht der Werkzeugname: so ist im Typsystem festgehalten, dass
 * jedes Extraktions-Werkzeug genau einen der vier Extraktoren braucht — ein Tippfehler ist ein
 * Übersetzungsfehler und keine stille Fehlanzeige zur Laufzeit.
 */
const TOOL_REQUIRES_EXTRACTOR: Partial<Record<ChatToolName, keyof ChatExtractors>> = {
  classify_upload: 'classifyDocument',
  extract_invoice: 'extractInvoiceData',
  extract_pv_design: 'extractPvDesign',
  extract_battery_description: 'extractBatteryText',
  extract_load_profile: 'readLoadProfile',
}

/**
 * Die Feldnamen des Eingabe-Contracts — AUS `tariffParamsSchema` gelesen, nicht abgeschrieben.
 *
 * ⚠ Eine zweite Liste hier wäre genau die Drift, die dieses Repo sonst überall vermeidet: käme in
 * `packages/shared/src/tariff.ts` ein Feld dazu (der Betrieb-Zuschnitt ist offener Punkt 1 des
 * Deltas), nennte der Werkzeugtext es nicht, das Modell schriebe unter einem erfundenen Namen, und
 * `check_draft_completeness` fände es nie wieder.
 */
export const DRAFT_CONTRACT_FIELDS = Object.keys(tariffParamsSchema.shape).sort()

/**
 * Die PFLICHTFELDER des Contracts — dieselbe Quelle, andere Frage.
 *
 * `isOptional()` fragt das zod-Schema selbst; eine zweite Liste liefe beim nächsten optionalen Feld
 * auseinander und `check_draft_completeness` verlangte etwas, das die Engine gar nicht braucht.
 */
export const DRAFT_REQUIRED_FIELDS = DRAFT_CONTRACT_FIELDS.filter((key) => {
  const field = tariffParamsSchema.shape[key as keyof typeof tariffParamsSchema.shape]
  return !field.isOptional()
})

/** Woher ein Wert stammt (Delta §3.2) — durchgehend bis in den Report sichtbar zu halten. */
export const DRAFT_VALUE_SOURCES = ['measured', 'assumed'] as const
export type DraftValueSource = (typeof DRAFT_VALUE_SOURCES)[number]

const ALL_TOOLS: Record<ChatToolName, Anthropic.Tool> = {
  set_segment: {
    name: 'set_segment',
    description: [
      'Legt fest, ob es sich um einen Privathaushalt oder einen Betrieb handelt (Delta §3.4).',
      'Setze das, sobald es aus dem Gespräch hervorgeht — die Verzweigung entscheidet, welche',
      'weiteren Angaben überhaupt gebraucht werden. Rate es nicht; frag lieber nach.',
      'Ein bereits gesetztes Segment kann mit einem neuen Aufruf korrigiert werden.',
    ].join(' '),
    input_schema: {
      type: 'object',
      properties: {
        segment: {
          type: 'string',
          enum: [...PROJECT_SEGMENTS],
          description: 'privat = Haushalt, betrieb = Gewerbe/Industrie.',
        },
      },
      required: ['segment'],
    },
  },

  /*
   * ── ⚠ FREITEXT, ABER NICHT FREIE SCHREIBWEISE ────────────────────────────────────────────────
   * Es gibt bewusst KEIN `enum` (Delta §4.1: die Branchen-Pools sollen admin-seitig entstehen, ohne
   * dass jemand eine Migration schreibt) — aber sehr wohl ein FORMAT. `industry` entscheidet,
   * welcher Fragen-Pool geladen wird; ohne Format wäre `hotel` und `Hotel` zwei Pools, und der
   * Fehler fiele erst auf, wenn ein Kunde den falschen bekommt. Das Muster steht in `ports.ts`
   * neben dem CHECK, den es spiegelt, und wird hier NICHT ein zweites Mal ausgeschrieben.
   */
  set_industry: {
    name: 'set_industry',
    description: [
      'Hält die Branche eines BETRIEBS fest (Delta §4.1). Davon hängt ab, welche zusätzlichen',
      'Fragen zu diesem Fall gehören — ein Hotel wird anders gefragt als eine Tischlerei.',
      '',
      'Nur sinnvoll, wenn das Segment "betrieb" ist. Bei einem Privathaushalt gibt es keine Branche;',
      'ist das Segment noch nicht bestimmt, kläre es zuerst mit set_segment.',
      '',
      'Es gibt KEINE feste Liste. Trag ein, was der Kunde nennt — nicht, was am nächsten dran',
      'klingt: eine geratene Branche lädt still die falschen Fragen.',
      '',
      'Schreibweise: Kleinbuchstaben, Ziffern und Unterstrich, beginnend mit Buchstabe oder Ziffer',
      '(z. B. hotel, tischlerei, kfz_werkstatt). "Hotel" oder "Kfz-Werkstatt" werden abgewiesen —',
      'sie werden ausdrücklich nicht stillschweigend umgeschrieben.',
      '',
      'Eine bereits gesetzte Branche kann mit einem neuen Aufruf korrigiert werden.',
    ].join('\n'),
    input_schema: {
      type: 'object',
      properties: {
        industry: {
          type: 'string',
          description:
            'Der Branchen-Schlüssel, Kleinbuchstaben/Ziffern/Unterstrich, z. B. hotel oder tischlerei.',
          pattern: INDUSTRY_KEY_PATTERN.source,
        },
      },
      required: ['industry'],
    },
  },

  set_draft_field: {
    name: 'set_draft_field',
    description: [
      'Trägt EINEN Wert in den Entwurf der Eingabedaten EINES ZÄHLPUNKTS ein. Der Entwurf ist das',
      'Zielobjekt, das am Ende die Berechnung füttert.',
      '',
      'metering_point_id ist Pflicht, und zwar auch dann, wenn es nur einen Zählpunkt gibt: Tarif',
      'und Vertrag hängen am Zählpunkt, nicht am Betrieb — ein Betrieb kann zwei Anschlüsse mit',
      'zwei verschiedenen Arbeitspreisen haben. Kennst du die Kennung nicht oder passt sie nicht,',
      'nennt dir die Antwort die vorhandenen Zählpunkte; such dir dann NICHT selbst einen aus,',
      'sondern frag den Kunden, zu welchem Zählpunkt die Angabe gehört.',
      '',
      'source ist Pflicht und die wichtigste Angabe dieses Werkzeugs:',
      '- "measured" = der Wert steht so auf einem Dokument des Kunden oder er hat ihn ausdrücklich',
      '  so genannt.',
      '- "assumed" = du hast ihn erschlossen, geschätzt oder aus einem Erfahrungswert eingesetzt.',
      'Im Zweifel "assumed". Eine als Messwert eingetragene Schätzung ist der teuerste Fehler, den',
      'du hier machen kannst — sie sieht später aus wie eine abgelesene Zahl.',
      '',
      'note begründet den Wert, kurz. Bei "assumed" ist sie faktisch Pflicht: eine unbegründete',
      'Annahme ist im Nachhinein nicht mehr prüfbar.',
      '',
      `Bekannte Felder des Contracts: ${DRAFT_CONTRACT_FIELDS.join(', ')}.`,
      'Zusätzlich bekannt sind die Schlüssel der admin-gepflegten Pflichtfragen — die nennt dir',
      'check_draft_completeness; für eine Katalogfrage benutzt du genau ihren Schlüssel.',
      'Jeder andere Feldname wird angenommen, aber die Vollständigkeitsprüfung kennt ihn nicht —',
      'benutze ihn nur, wenn wirklich keines der bekannten Felder passt.',
    ].join('\n'),
    input_schema: {
      type: 'object',
      properties: {
        metering_point_id: {
          type: 'string',
          description: 'Der Zählpunkt, zu dem dieser Wert gehört.',
        },
        field: {
          type: 'string',
          description: 'Der Feldname im Entwurf, z. B. energyPriceCtPerKwh.',
        },
        value: {
          type: ['number', 'string', 'boolean'],
          description: 'Der Wert. Zahlen als Zahl, nicht als Zeichenkette.',
        },
        source: {
          type: 'string',
          enum: [...DRAFT_VALUE_SOURCES],
          description: 'measured = abgelesen/genannt, assumed = erschlossen oder geschätzt.',
        },
        note: {
          type: 'string',
          description: 'Kurze Begründung. Bei assumed unverzichtbar.',
        },
      },
      required: ['metering_point_id', 'field', 'value', 'source'],
    },
  },

  check_draft_completeness: {
    name: 'check_draft_completeness',
    description: [
      'Prüft die Entwürfe gegen den typisierten Eingabe-Contract UND gegen die admin-gepflegten',
      'Pflichtfragen für das Segment und die Branche dieses Projekts. Ändert nichts. Benutze es,',
      'bevor du dem Kunden sagst, dass ihr fertig seid — und gern zwischendurch, um zu sehen,',
      'worauf du als Nächstes hinarbeiten solltest.',
      '',
      'Jeder Zählpunkt hat seinen EIGENEN Entwurf. Ohne metering_point_id bekommst du alle',
      'Zählpunkte mit je eigenem Befund, und "complete" gilt dann für den ganzen Betrieb: es ist',
      'erst true, wenn JEDER Zählpunkt vollständig ist. Mit metering_point_id bekommst du nur',
      'diesen einen.',
      '',
      'In "missing" steht je Eintrag der Schlüssel, unter dem der Wert erwartet wird. Trägt ein',
      'Eintrag zusätzlich ein Feld "question", stammt er aus dem Fragenkatalog: dann ist dieser',
      'Wortlaut die Frage, die zu stellen ist — stell sie in eigenen Worten dem Kunden, statt ihm',
      'den technischen Schlüssel zu zeigen. Die Antwort trägst du mit set_draft_field unter genau',
      'diesem Schlüssel ein.',
      '',
      'Die Katalogfragen sind Mindestangaben, keine Reihenfolge: WANN du welche stellst,',
      'entscheidest du im Gesprächsverlauf.',
    ].join('\n'),
    input_schema: {
      type: 'object',
      properties: {
        metering_point_id: {
          type: 'string',
          description: 'Optional: nur diesen Zählpunkt prüfen. Weggelassen = alle.',
        },
      },
      required: [],
    },
  },

  /*
   * ── ⚠ WARUM DAS EIN EIGENES WERKZEUG IST UND KEIN TEIL VON `check_draft_completeness` ─────────
   * Die zwei beantworten verschiedene Fragen und haben verschiedene Folgen. Vollständigkeit ist
   * FELDWEISE und wird durch FRAGEN behoben („was fehlt noch?"). Stimmigkeit ist ZEITLICH und lässt
   * sich gar nicht beheben, sondern nur entscheiden: liegen Rechnung und Lastgang in verschiedenen
   * Jahren, ist keine weitere Frage offen — es ist offen, ob die Tarifwerte für den gerechneten
   * Zeitraum überhaupt gelten. In einen gemeinsamen Befund gepackt stünde diese Entscheidung
   * zwischen Feldnamen und liefe Gefahr, als „noch eine Lücke" abgearbeitet zu werden.
   */
  check_data_consistency: {
    name: 'check_data_consistency',
    description: [
      'Vergleicht je Zählpunkt, welchen Zeitraum der LASTGANG abdeckt und welchen die RECHNUNG —',
      'und meldet, wo im Lastgang Messwerte fehlen. Ändert nichts.',
      '',
      'Benutze es, sobald für einen Zählpunkt beides vorliegt, und jedenfalls bevor du dem Kunden',
      'sagst, dass die Angaben zu diesem Zählpunkt stehen. Ein vollständiger Entwurf ist nicht',
      'dasselbe wie ein stimmiger: jedes Feld kann gefüllt sein, während der Arbeitspreis aus einem',
      'anderen Jahr stammt als der Verbrauch, mit dem gerechnet wird.',
      '',
      'Ohne metering_point_id bekommst du alle Zählpunkte, je mit eigener Kennung; mit ihr nur den',
      'einen.',
      '',
      'Was du zurückbekommst:',
      '- zeitraum_vergleich sagt, ob der Abgleich überhaupt möglich war. Steht dort nicht',
      '  "geprueft", fehlt eine der beiden Seiten — dann ist NICHTS verglichen worden, und',
      '  "keine Befunde" heisst hier nicht "alles passt".',
      `- zeitraum_luecke erscheint erst ab ${COVERAGE_GAP_TOLERANCE_DAYS} Tagen Abstand. Eine kleinere`,
      '  Verschiebung ist der normale Lauf eines Abrechnungszyklus und kein Befund.',
      '- luecken sind Bereiche OHNE Messwerte innerhalb des Lastgangs.',
      '',
      '── Was du mit einer zeitraum_luecke machst ──',
      '',
      'NICHT selbst entscheiden. Dass die Tarifwerte einer Rechnung von 2024 für einen Lastgang aus',
      '2026 gelten, ist eine Annahme — sie kann stimmen, aber sie ist deine, nicht seine. Leg dem',
      'Kunden wie bei jeder Fachfrage BEIDE Wege vor:',
      '  (a) Warten: Martin sieht sich an, ob die Werte für den Lastgang-Zeitraum tragen. Oder der',
      '      Kunde reicht eine Rechnung nach, die diesen Zeitraum abdeckt.',
      '  (b) Weitermachen: wir rechnen den Lastgang mit den Tarifwerten der vorliegenden Rechnung,',
      '      als Annahme gekennzeichnet.',
      'Hat er gewählt, halte es fest — mit flag_open_question (ohne resolution_kind für (a), mit',
      '"assumed" und Begründung für (b)); die Werte selbst trägst du bei (b) mit set_draft_field und',
      'source "assumed" ein, damit im Ergebnis sichtbar bleibt, worauf sie beruhen.',
      '',
      'Sag ihm dabei konkret, worum es geht: Strompreise ändern sich zwischen zwei Jahren, und eine',
      'Ersparnis, die auf dem älteren Preis beruht, fällt entsprechend anders aus.',
    ].join('\n'),
    input_schema: {
      type: 'object',
      properties: {
        metering_point_id: {
          type: 'string',
          description: 'Optional: nur diesen Zählpunkt prüfen. Weggelassen = alle.',
        },
      },
      required: [],
    },
  },

  flag_open_question: {
    name: 'flag_open_question',
    description: [
      'Stellt eine fachliche Rückfrage an Martin (unseren Fachmann) und hält sie am Projekt fest.',
      '',
      'resolution_kind entscheidet, wie es weitergeht — und der Kunde entscheidet das, nicht du:',
      '- weglassen  = Weg (a): ihr wartet auf Martins Antwort. Der Rest des Gesprächs kann',
      '  weiterlaufen.',
      '- "assumed"  = Weg (b): du rechnest mit einer begründeten Annahme weiter. assumption_note',
      '  ist dann Pflicht.',
      '',
      'Wichtig: Weg (b) LÖSCHT DIE FRAGE NICHT. Sie bleibt offen bei Martin stehen, damit er sie',
      'nachträglich prüfen kann. Sag dem Kunden genau das, wenn er sich für die Annahme entscheidet.',
      '',
      'Die Annahme selbst gehört zusätzlich über set_draft_field mit source "assumed" in den',
      'Entwurf — dieses Werkzeug protokolliert die Frage, es rechnet nicht.',
      '',
      'field_key nennt das betroffene Entwurfsfeld, falls es eines gibt. Lass es weg, wenn die Frage',
      'zu keinem einzelnen Feld gehört (etwa bei einer Betriebsstruktur, die wir nicht abbilden).',
    ].join('\n'),
    input_schema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'Die Frage an Martin, als vollständiger Satz und ohne Kontextwissen aus dem Chat.',
        },
        field_key: {
          type: 'string',
          description: 'Betroffenes Entwurfsfeld, falls vorhanden.',
        },
        resolution_kind: {
          type: 'string',
          enum: ['assumed'],
          description: 'Nur "assumed" für Weg (b). Für Weg (a) weglassen.',
        },
        assumption_note: {
          type: 'string',
          description: 'Begründung der Annahme. Bei resolution_kind "assumed" Pflicht.',
        },
      },
      required: ['question'],
    },
  },

  classify_upload: {
    name: 'classify_upload',
    description: [
      'Ordnet ein hochgeladenes PDF einer Dokumentart zu: Stromrechnung, Lastgang, Tarifblatt oder',
      'unbekannt. Benutze es, wenn du aus Dateiname und Gespräch nicht sicher bist, was du vor dir',
      'hast — es ersetzt kein Nachfragen, aber es erspart es oft.',
      '"unbekannt" ist ein reguläres Ergebnis und kein Fehler; frag dann den Kunden.',
    ].join(' '),
    input_schema: {
      type: 'object',
      properties: {
        document_id: { type: 'string', description: 'Die Kennung des hochgeladenen Dokuments.' },
      },
      required: ['document_id'],
    },
  },

  extract_invoice: {
    name: 'extract_invoice',
    description: [
      'Liest Tarif- und Verbrauchsangaben aus einer oder mehreren Stromrechnungen (PDF).',
      '',
      'Mehrere Rechnungen gehören in EINEN Aufruf: sie werden dann zusammengeführt. Wo alle',
      'Rechnungen dasselbe sagen, wird der Wert übernommen; wo sie sich WIDERSPRECHEN, bleibt das',
      'Feld leer und der Widerspruch wird dir benannt. Genau dann darfst du nicht selbst',
      'entscheiden — leg dem Kunden die beiden Wege aus flag_open_question vor.',
      '',
      'Die gelesenen Werte landen NICHT automatisch im Entwurf. Übernimm sie einzeln mit',
      'set_draft_field und source "measured".',
      '',
      'periods nennt dir den Abrechnungszeitraum JE Rechnung, in der Reihenfolge der Dokumente.',
      'Bilde daraus den GESAMT-Zeitraum — das früheste from und das späteste to — und trag ihn mit',
      `set_draft_field als zwei Felder ein: ${INVOICE_PERIOD_FROM_KEY} und ${INVOICE_PERIOD_TO_KEY},`,
      'je als Datum im Format JJJJ-MM-TT. check_data_consistency vergleicht sie später gegen den',
      'Zeitraum des Lastgangs — unter einem anderen Namen abgelegt findet es sie nicht.',
      '',
      'Für source gilt dabei der Eintrag, aus dem die jeweilige Grenze stammt:',
      '- assumed false heisst, der Zeitraum steht auf der Rechnung — dann source "measured".',
      '- assumed true heisst, er wurde aus einer Jahresrechnung erschlossen — dann source',
      '  "assumed", und die note sagt das auch (etwa "aus Jahresrechnung ohne ausgewiesenen',
      '  Zeitraum abgeleitet").',
      'Rate das NICHT selbst: du siehst die Rechnung nicht, assumed ist deine einzige Auskunft',
      'darüber. Ist eine der beiden Grenzen erschlossen, ist auch die Gesamt-Grenze, die aus ihr',
      'stammt, "assumed".',
      '',
      'Sind alle from und to null, gibt es keinen Zeitraum: trag dann nichts ein und frag den',
      'Kunden, welchen Zeitraum die Rechnungen abdecken. Klafft zwischen zwei Zeiträumen eine',
      'Lücke (etwa 01–06/2024 und 01–06/2025), nenn sie dem Kunden — der Gesamt-Zeitraum sieht',
      'dann lückenlos aus und ist es nicht.',
    ].join('\n'),
    input_schema: {
      type: 'object',
      properties: {
        document_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Eine oder mehrere Dokumentkennungen desselben Anschlusses.',
        },
      },
      required: ['document_ids'],
    },
  },

  extract_pv_design: {
    name: 'extract_pv_design',
    description: [
      'Liest die Auslegung einer PV-Anlage aus einem Planungsdokument (PDF): Modulflächen, Leistung,',
      'Neigung, Ausrichtung. Die gelesenen Werte sind eine PLANUNG, keine Messung — übernimm sie',
      'entsprechend gekennzeichnet.',
    ].join(' '),
    input_schema: {
      type: 'object',
      properties: {
        document_id: { type: 'string', description: 'Die Kennung des hochgeladenen Dokuments.' },
      },
      required: ['document_id'],
    },
  },

  /*
   * ── ⚠ DAS EINZIGE WERKZEUG, DAS NICHT IN DEN ENTWURF SCHREIBT ────────────────────────────────
   * Alle anderen Extraktions-Werkzeuge liefern Werte, die das Modell anschliessend mit
   * `set_draft_field` übernimmt. Dieses hier schreibt SELBST — und zwar an den ZÄHLPUNKT, nicht an
   * das Projekt. Der Grund ist die Ebene: ein Betrieb kann mehrere Zählpunkte tragen (Delta §2.3),
   * und „der Lastgang deckt 2025 ab" ist eine Aussage über EINEN davon. Im Entwurf abgelegt gälte
   * sie für das ganze Projekt, und beim zweiten Zählpunkt überschriebe sie die erste.
   *
   * Deshalb ist `metering_point_id` ein PFLICHTPARAMETER. Kennt das Modell die Kennung nicht,
   * bekommt es sie in der Fehlerantwort genannt — der Ausführer listet die vorhandenen auf, statt
   * sich einen auszusuchen.
   */
  extract_load_profile: {
    name: 'extract_load_profile',
    description: [
      'Liest einen hochgeladenen Lastgang (CSV oder XLSX) und hält fest, WAS er abdeckt: das',
      'Messintervall (15 oder 60 Minuten), den Zeitraum und die Lücken darin.',
      '',
      'Das Ergebnis wird direkt am angegebenen Zählpunkt gespeichert — anders als die anderen',
      'Lese-Werkzeuge musst du hier nichts mit set_draft_field übernehmen. Der Grund: ein Betrieb',
      'kann mehrere Zählpunkte haben, und ein Lastgang gehört immer zu genau einem davon.',
      '',
      'metering_point_id ist Pflicht. Kennst du die Kennung nicht oder passt sie nicht, nennt dir',
      'die Antwort die vorhandenen Zählpunkte — such dir dann NICHT selbst einen aus, wenn es',
      'mehrere gibt, sondern frag den Kunden, zu welchem Zählpunkt die Datei gehört.',
      '',
      'Gibt es für das Projekt noch gar keine Zählpunkte, kannst du sie NICHT selbst anlegen. Sag',
      'dem Kunden, dass wir das intern einrichten müssen, und halte es mit flag_open_question fest.',
      '',
      'Es kann sein, dass die Datei mehrere Zählpunkte nebeneinander enthält (mehrere Spalten mit',
      'je einer Zählpunktnummer). Dann wird NICHTS gespeichert und du bekommst die Spalten',
      'aufgelistet — frag in dem Fall den Kunden, welche Spalte zu welchem Zählpunkt gehört.',
      '',
      'Die Messwerte selbst werden nirgends gespeichert; die Datei bleibt die Quelle.',
    ].join('\n'),
    input_schema: {
      type: 'object',
      properties: {
        document_id: { type: 'string', description: 'Die Kennung des hochgeladenen Lastgangs.' },
        metering_point_id: {
          type: 'string',
          description: 'Der Zählpunkt, zu dem dieser Lastgang gehört.',
        },
      },
      required: ['document_id', 'metering_point_id'],
    },
  },

  extract_battery_description: {
    name: 'extract_battery_description',
    description: [
      'Liest aus einem frei formulierten Satz des Kunden über seinen VORHANDENEN Batteriespeicher',
      'die technischen Angaben heraus (Kapazität, Leistung, Wirkungsgrad, Preis).',
      'Übergib den Satz so, wie der Kunde ihn geschrieben hat — deute ihn nicht vor.',
    ].join(' '),
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Die Angabe des Kunden, wörtlich.' },
      },
      required: ['text'],
    },
  },
}

/**
 * Die Werkzeuge, die dieser Lauf tatsächlich anbieten kann.
 *
 * Die Reihenfolge ist FEST (`CHAT_TOOL_NAMES`) und nicht die des Port-Objekts: die Werkzeugliste
 * steht im Anfrage-Präfix VOR dem System-Prompt, und eine wechselnde Reihenfolge macht jeden
 * Cache-Treffer zunichte (`shared/prompt-caching.md`: „unsorted JSON, varying tool set").
 */
export function buildChatTools(extractors: Partial<ChatExtractors>): Anthropic.Tool[] {
  return CHAT_TOOL_NAMES.filter((name) => {
    const required = TOOL_REQUIRES_EXTRACTOR[name]
    return required === undefined || typeof extractors[required] === 'function'
  }).map((name) => ALL_TOOLS[name])
}

/** Welche Extraktions-Werkzeuge fehlen? Der System-Prompt sagt es dem Modell im Klartext. */
export function missingExtractionTools(extractors: Partial<ChatExtractors>): ChatToolName[] {
  return CHAT_TOOL_NAMES.filter((name) => {
    const required = TOOL_REQUIRES_EXTRACTOR[name]
    return required !== undefined && typeof extractors[required] !== 'function'
  })
}

export function isChatToolName(value: unknown): value is ChatToolName {
  return typeof value === 'string' && (CHAT_TOOL_NAMES as readonly string[]).includes(value)
}
