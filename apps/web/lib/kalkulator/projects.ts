/**
 * PFADE UND KONSTANTEN DES KUNDENSEITIGEN PROJEKTBEREICHS (B24, achter Bauschritt).
 *
 * REIN: kein `server-only`, kein `next/*`, keine Datenbank. Vier Beteiligte brauchen dieselben
 * Werte — die zwei Routen, die Anmeldeseite (als Rücksprungziel), `lib/routes.ts` für den
 * Platten-Abgleich und die Kontoseite für ihren Link. Muster `lib/partner-portal/config.ts`.
 *
 * ── WARUM `/kalkulator/projekte` UND NICHT `/projekte` ─────────────────────────────────────────
 * `platform.projects` ist eine Tabelle des KALKULATORS (B24), auch wenn ihr Name das nicht sagt.
 * Ein Top-Level `/projekte` auf coolin.at läse sich wie „Referenzprojekte" — und diese Seite trägt
 * exakt das Gegenteil: den privaten Arbeitsstand eines einzelnen Kunden. Der Pfad nennt deshalb
 * das Produkt.
 *
 * ⚠ `/kalkulator` selbst ist bewusst KEINE Seite. Die öffentliche Produktseite liegt seit jeher
 * unter `/peak-shaving/kalkulator`, und eine zweite Einstiegsseite unter einer zweiten Adresse
 * wäre genau die Kannibalisierung, die `lib/routes.ts` an mehreren Stellen begründet vermeidet.
 * Der Ordner trägt nur Kindsegmente; `walkPages` sammelt ausschliesslich `page.tsx` und meldet
 * deshalb auch nichts.
 */

/** Die Projektliste — OHNE Locale-Präfix, wie alle Hrefs unter `app/(site)/[locale]`. */
export const PROJEKTE_HREF = '/kalkulator/projekte'

/**
 * Das Muster der Chat-Route für den Platten-Abgleich in `lib/routes.ts`.
 *
 * Die konkreten Adressen entstehen im laufenden Betrieb (eine je Projekt eines Kunden) und stehen
 * in keiner Liste im Code — dieselbe Lage wie bei `/partner/[slug]`. In eine sitemap gehören sie
 * ohnehin nicht: hinter der Anmeldung gibt es für Suchende nichts.
 */
export const PROJEKT_ROUTE_TEMPLATE = `${PROJEKTE_HREF}/[id]`

/** Der Chat eines einzelnen Projekts. */
export function projectChatHref(projectId: string): string {
  return `${PROJEKTE_HREF}/${projectId}`
}

/**
 * Das Format einer Projektkennung — Spiegel der `uuid`-Spalte.
 *
 * Steht hier, weil ZWEI Ränder sie prüfen müssen und beide es aus demselben Grund tun: an einem
 * Server-Action-Rand und in einem dynamischen Routensegment kommt der Wert aus dem Browser, und
 * ein Nicht-UUID-Wert liefe als Parameter in einen rohen Postgres-Fehler (22P02) statt in ein
 * sauberes „gibt es nicht". `chat.ts` trägt dieselbe Prüfung für seinen eigenen Rand.
 */
export const PROJECT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Obergrenze für die Zahl der Dokumente, die EIN Turn als neu hochgeladen melden darf.
 *
 * ⚠ Das ist keine Formfrage, sondern eine Kostenbremse zweiter Ordnung: jede gemeldete Kennung ist
 * eine Einladung an das Modell, ein Werkzeug darauf laufen zu lassen, und jeder Werkzeugaufruf ist
 * abrechenbar. Die Obergrenze der Schleife (`MAX_TOOL_CALLS_PER_TURN`, 8) begrenzt die AUFRUFE;
 * diese Zahl begrenzt, wie viele Anlässe ein einzelner Turn überhaupt mitbringen kann.
 *
 * Zwölf, weil das der Grössenordnung eines realen Anlasses entspricht (zwölf Monatsrechnungen
 * statt einer Jahresrechnung — Delta §3.2 nennt genau diesen Fall). Mehr ist kein Fehler des
 * Kunden: er lädt weiter hoch, und der nächste Turn meldet den Rest.
 */
export const MAX_ATTACHED_DOCUMENTS_PER_TURN = 12

/**
 * Zustandsvertrag des „Neues Projekt"-Formulars (`useActionState`).
 *
 * ⚠ Typ UND Startwert stehen HIER und nicht in `projects-actions.ts`: eine `'use server'`-Datei
 * darf ausschliesslich async Funktionen exportieren. Ein daneben exportierter Startwert bricht
 * erst zur LAUFZEIT (HTTP 500, „can only export async functions, found object") — Build, Typecheck
 * und Lint bleiben grün. In B18-4 real passiert; ein Wächter (`lib/use-server-exports.test.ts`)
 * hält es seither fest.
 *
 * Fehler sind KEYS, keine Sätze: die Wortwahl steht in `messages/de.json`, und serverseitig gibt
 * es keinen Locale-Kontext für fertige Texte (Muster `lib/redemption/schema.ts`).
 */
export type NewProjectState = {
  /** Feld-Fehler-KEY (`Projekte.new.errors.*`). */
  fieldError?: 'labelRequired' | 'labelTooLong'
  /** Formular-weiter Fehler-KEY (`Projekte.new.errors.*`) — nur für echte Fehlschläge. */
  formError?: 'notSignedIn' | 'generic'
  /** Eingabe zur Wiederanzeige nach einer Ablehnung. */
  label?: string
}

export const NEW_PROJECT_INITIAL_STATE: NewProjectState = {}

/**
 * Längengrenze der Projektbezeichnung.
 *
 * ⚠ Die Datenbank hat dafür KEINE Grenze — `platform.projects.customer_label` ist `text` mit einem
 * CHECK gegen den LEEREN Wert, sonst nichts. Diese Zahl ist deshalb eine Entscheidung der
 * Oberfläche und keine Spiegelung des Schemas: die Bezeichnung steht in einer Liste und in einer
 * Überschrift, und ein 4000-Zeichen-Titel wäre dort kein Titel mehr. Sie wird SERVERSEITIG geprüft
 * (das Formularattribut ist Bedienhilfe, keine Grenze).
 */
export const MAX_PROJECT_LABEL_LENGTH = 120
