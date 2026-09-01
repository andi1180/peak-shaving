/**
 * DER VERTRAG DER DOKUMENT-ZUORDNUNG. Rein, ohne Importe, ohne Netz, ohne Datenbank.
 *
 * ── WOZU ES DIESEN BAUSTEIN GIBT ───────────────────────────────────────────────────────────────
 * Die drei bestehenden Einstiege (Lastgang-Datei · Standardprofil · Rechnungs-Scan) verlangen vom
 * Nutzer, dass er die Art seines Dokuments VORHER kennt und den passenden Reiter wählt. Wer eine
 * Handvoll Unterlagen vom Steuerberater bekommt und nicht weiss, was davon ein Lastgang ist,
 * scheitert an dieser Vorentscheidung. Der vierte Einstieg dreht sie um: der Nutzer legt seine
 * Dateien mit EIGENEN Bezeichnungen ab, und die Zuordnung schlägt je Zeile eine Art vor.
 *
 * ── WARUM DIESER TEIL IN `shared` LIEGT UND NICHT IN `apps/website` ────────────────────────────
 * Wortgleich zur Begründung in `invoice-scan.ts` und `report-gate.ts`: `apps/website` hat **keinen
 * eigenen Testlauf**. Was hier steht, ist genau der Teil, der sich ohne einen Aufruf an ein
 * Sprachmodell prüfen lässt — das Zielschema, die Auswertung seiner Antwort und die Regel, die aus
 * den Einzelaussagen eine Art macht. Läge er in der App, wäre er unprüfbar.
 *
 * Die Datei hat **NULL Importe** — auch kein zod, aus denselben zwei Gründen wie dort: das
 * JSON-Schema unten ist die WIRE-Fassung, die an die API geht, und `apps/website` führt zod nicht.
 *
 * ── ⚠ KEINE KONFIDENZ, SONDERN EINE JA/NEIN-AUSSAGE JE KANDIDAT ───────────────────────────────
 * Das Modell nennt NICHT „Rechnung, 80 %". Es beantwortet drei getrennte, geschlossene Fragen:
 * ist das eine Rechnung? ein Lastgang? ein Tarifblatt? Der Grund ist derselbe, aus dem der
 * Rechnungs-Scan `null` statt einer geschätzten Zahl liefert: eine Zahl zwischen 0 und 1 sieht aus
 * wie eine Messung, ist aber die Selbsteinschätzung des Modells über seine eigene Antwort — und
 * jede Schwelle, die man darauf legte („ab 0,7 übernehmen"), wäre eine erfundene Grenze, die
 * niemand je gegen echte Dokumente geeicht hat.
 *
 * Drei getrennte Aussagen sind ausserdem AUSWERTBAR: genau eine Zustimmung heisst „eindeutig",
 * keine oder mehrere heissen „unklar". Genau das leistet `resolveUploadDocumentType` unten — und
 * `unbekannt` ist dabei ein vollwertiges Ergebnis, kein Fehlschlag (s. dort).
 *
 * ── ⚠ ES KOMMT KEIN FREITEXT DES MODELLS ZURÜCK ───────────────────────────────────────────────
 * Kein Begründungsfeld, keine Zusammenfassung des Dokuments. Dieselbe Regel wie in den beiden
 * bestehenden Scans („`error` trägt einen Zustand, nie eine Meldung des Modells"): was aus dem
 * Aufruf herauskommt, ist eine Auswahl aus einer geschlossenen Menge. Ein vom Modell formulierter
 * Satz, der dem Nutzer angezeigt würde, wäre Text aus einem Dokument unbekannter Herkunft in
 * unserer Oberfläche — und die Bestätigungsstufe fragt ohnehin nach der ART, nicht nach einer
 * Begründung.
 */

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Die Arten.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Die Dokumentarten, die der Rechner unterscheidet.
 *
 * `unbekannt` ist ausdrücklich Teil der Liste und kein Fehlerwert: es ist die richtige Antwort für
 * ein Dokument, das keine der drei Arten ist (ein Angebot, ein Datenblatt, ein Foto), UND für
 * eines, bei dem die Zuordnung sich nicht festlegen kann. Beides führt zu derselben Handlung —
 * der Mensch entscheidet — und braucht deshalb keine zwei Werte.
 */
export const UPLOAD_DOCUMENT_TYPES = ['rechnung', 'lastgang', 'tarifblatt', 'unbekannt'] as const
export type UploadDocumentType = (typeof UPLOAD_DOCUMENT_TYPES)[number]

/** Anzeigenamen für die Bestätigungsliste. Eine Formulierung, ein Ort. */
export const UPLOAD_DOCUMENT_TYPE_LABELS: Record<UploadDocumentType, string> = {
  rechnung: 'Stromrechnung',
  lastgang: 'Lastgang',
  tarifblatt: 'Tarif-/Preisblatt',
  unbekannt: 'Unklar',
}

/**
 * Die drei Kandidatenfragen, in fester Reihenfolge — von Schema, Auswertung und Test geteilt.
 *
 * `unbekannt` steht hier bewusst NICHT: es ist keine Frage an das Modell, sondern das Ergebnis
 * einer Auszählung (s. `resolveUploadDocumentType`). Als vierte Frage könnte das Modell ihr
 * zustimmen UND gleichzeitig einer anderen — eine Antwort, die sich selbst widerspricht.
 */
export const UPLOAD_CLASSIFICATION_CANDIDATE_KEYS = [
  'istRechnung',
  'istLastgang',
  'istTarifblatt',
] as const
export type UploadClassificationCandidateKey =
  (typeof UPLOAD_CLASSIFICATION_CANDIDATE_KEYS)[number]

/** Die Antwort des Modells: je Kandidat ein Ja oder ein Nein. Nichts dazwischen. */
export type UploadClassificationVerdict = Record<UploadClassificationCandidateKey, boolean>

/** Ein Urteil, in dem nichts zutrifft. Der Ausgangszustand jeder Auswertung. */
export function emptyUploadClassificationVerdict(): UploadClassificationVerdict {
  return { istRechnung: false, istLastgang: false, istTarifblatt: false }
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Das JSON-Schema, das die API erzwingt.
 *
 * `additionalProperties: false` + vollständige `required`-Liste: das Modell MUSS jede der drei
 * Fragen beantworten. Ein weggelassenes Feld wäre ein zweiter Ausdruck für „nein", und zwei
 * Schreibweisen für dieselbe Aussage laufen beim nächsten Umbau auseinander.
 *
 * ⚠ Hier gibt es KEIN Aufzählungsfeld und damit auch nicht die Schreibweise, die am 31.08.2026
 * den Rechnungs-Scan mit HTTP 400 vollständig funktionslos gemacht hat (`type: [..., 'null']`
 * zusammen mit `enum`). Der rekursive Wächter in `upload-classification.test.ts` prüft das
 * trotzdem über den GANZEN Baum — auch für Felder, die es heute noch nicht gibt.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */

function booleanQuestion(description: string) {
  return { type: 'boolean', description } as const
}

export const UPLOAD_CLASSIFICATION_JSON_SCHEMA: { [key: string]: unknown } = {
  type: 'object',
  additionalProperties: false,
  required: [...UPLOAD_CLASSIFICATION_CANDIDATE_KEYS],
  properties: {
    istRechnung: booleanQuestion(
      'true, wenn das Dokument eine Strom- oder Netzrechnung eines Endkunden ist — also eine ' +
        'Abrechnung über bezogene Energie und/oder Netznutzung an EINEN benannten Kunden ' +
        '(Jahresabrechnung, Teilbetrag, Schlussrechnung). Sonst false.',
    ),
    istLastgang: booleanQuestion(
      'true, wenn das Dokument eine Messwertreihe über die Zeit ist — Viertelstunden- oder ' +
        'Stundenwerte des Netzbezugs mit Zeitstempeln und kW-/kWh-Werten. Sonst false.',
    ),
    istTarifblatt: booleanQuestion(
      'true, wenn das Dokument ein veröffentlichtes Preis-/Tarifblatt eines Netzbetreibers oder ' +
        'Lieferanten ist — eine allgemeine Preisliste ohne Bezug auf einen einzelnen Kunden. ' +
        'Sonst false.',
    ),
  },
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Die Auswertung.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * Wertet die Antwort des Modells aus — FAIL CLOSED, Frage für Frage.
 *
 * Es wird nichts geworfen und nichts gerettet: was nicht als echtes `true` ankommt, ist `false`.
 * Ausdrücklich auch die Zeichenkette `'true'` und die Zahl `1` — sie sähen wie eine Zustimmung
 * aus, sind aber keine, und ein Dokument aufgrund einer Typverwechslung einzuordnen wäre genau der
 * stille Fehler, den die Bestätigungsstufe danach nicht mehr auffangen könnte (der Nutzer sähe
 * einen Vorschlag, der auf nichts beruht).
 *
 * Eine vollständig unbrauchbare Antwort ergibt damit ein gültiges Urteil, in dem nichts zutrifft —
 * und das löst über `resolveUploadDocumentType` sauber `unbekannt` aus.
 */
export function parseUploadClassification(raw: unknown): UploadClassificationVerdict {
  const root = record(raw)
  const verdict = emptyUploadClassificationVerdict()
  for (const key of UPLOAD_CLASSIFICATION_CANDIDATE_KEYS) {
    verdict[key] = root[key] === true
  }
  return verdict
}

/**
 * Macht aus den drei Einzelaussagen genau eine Art.
 *
 * ── DIE REGEL: GENAU EINE ZUSTIMMUNG ──────────────────────────────────────────────────────────
 * Keine Zustimmung heisst „nichts davon". Mehrere heissen „das Modell hat sich nicht festgelegt".
 * Beides ergibt `unbekannt`, und beides ist ein ehrliches Ergebnis: der Nutzer bekommt in der
 * Bestätigungsliste eine offene Auswahl statt eines Vorschlags, der eine Gewissheit vortäuscht.
 *
 * Ausdrücklich NICHT gebaut ist eine Rangfolge („bei Rechnung UND Tarifblatt gewinnt Rechnung").
 * Sie wäre eine erfundene Regel: die beiden verwechselt man, weil beide Preise in ct/kWh
 * auflisten — und wer von beiden recht hat, entscheidet der Bezug auf einen einzelnen Kunden, den
 * genau das unsichere Urteil nicht feststellen konnte.
 */
export function resolveUploadDocumentType(verdict: UploadClassificationVerdict): UploadDocumentType {
  const yes = UPLOAD_CLASSIFICATION_CANDIDATE_KEYS.filter((key) => verdict[key])
  if (yes.length !== 1) return 'unbekannt'
  if (yes[0] === 'istRechnung') return 'rechnung'
  if (yes[0] === 'istLastgang') return 'lastgang'
  return 'tarifblatt'
}

/** Ist der Wert eine bekannte Dokumentart? Für die Korrektur aus der Oberfläche. */
export function isUploadDocumentType(value: unknown): value is UploadDocumentType {
  return UPLOAD_DOCUMENT_TYPES.includes(value as UploadDocumentType)
}
