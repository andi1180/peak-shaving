import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { PROJECTS_HREF, projectDataEntryHref, projectHref } from './projects'

/**
 * B24, Teil 1 — die Eigenschaften der Dateneingabe-Route, die ohne Renderer prüfbar sind.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIESE DATEI HIESS BIS ZUM WIZARD-SCHRITT `project-chat-ui.test.ts`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Die Route trug in PR #188 den Projekt-Chat und trägt jetzt den Wizard. Der alte Name behauptete
 * einen Gegenstand, den sie nicht mehr hat — umbenannt statt stehen gelassen. Was bleibt, ist die
 * Frage: was an dieser Route „funktioniert" auch dann, wenn es falsch ist?
 *
 *   1. DASS SIE KEIN ENTITLEMENT PRÜFT. Die bewusste Ausnahme des Admin-Bereichs (ein Admin ist
 *      kein Kunde seines eigenen Werkzeugs, B18-4). Ein später „zur Vereinheitlichung" ergänztes
 *      `getCalculatorAccess()` wäre in keinem Build sichtbar: die Seite funktionierte weiter, nur
 *      stünde Andreas vor dem Anfrage-Formular, wenn er ein Projekt bearbeiten will, das er selbst
 *      angelegt hat.
 *
 *   2. DASS SIE DEN ADMIN-LESEPFAD BENUTZT. `get_my_project` prüft EIGENTUM, `admin_get_project`
 *      die Adminrolle. Mit dem falschen Wrapper wäre die Seite für JEDES Projekt leer, das dem
 *      Admin nicht selbst gehört — also für praktisch alle, und ausgerechnet im Admin-Bereich.
 *
 *   3. ⚠ DASS SIE DIE ZÄHLPUNKTE ÜBER EINEN LESER MIT `null`-FALL LIEST. Der Chat-Port
 *      `listMeteringPoints` liest denselben Wrapper und fällt bei einem Lesefehler auf die LEERE
 *      Liste zurück — dort richtig, hier gefährlich: eine leere Liste führt auf den
 *      Zählpunkt-Schritt, und dessen Formular kann eine bestehende Zahl VERKLEINERN. Ein
 *      Lesefehler brächte damit einen Admin dazu, einen vorhandenen Zählpunkt zu entfernen.
 *      Ausführlich im Kopf von `lib/admin/metering-points.ts`.
 *
 *   4. DASS DER CHAT HIER NICHT MEHR STEHT. Kein Defekt, sondern die Umwidmung — aber ein später
 *      „wiederhergestellter" Chat neben dem Wizard wäre ein zweiter Schreibweg in denselben
 *      Verlauf, und zwar einer ohne die Reihenfolge, für die der Wizard gebaut ist.
 *
 * Reine Datei- und Quelltextprüfung: kein React, kein Request, keine Datenbank (s. `vitest.config.ts`).
 */

const APP_DIR = path.resolve(import.meta.dirname, '..', '..', 'app')
const COMPONENTS_DIR = path.resolve(import.meta.dirname, '..', '..', 'components')

const DATA_ENTRY_PAGE = path.join(
  APP_DIR,
  'admin',
  '(intern)',
  'kalkulator-projekte',
  '[id]',
  'dateneingabe',
  'page.tsx',
)
const DETAIL_PAGE = path.join(
  APP_DIR,
  'admin',
  '(intern)',
  'kalkulator-projekte',
  '[id]',
  'page.tsx',
)
const CUSTOMER_PAGE = path.join(
  APP_DIR,
  '(site)',
  '[locale]',
  'kalkulator',
  'projekte',
  '[id]',
  'page.tsx',
)
const ROOT_SHELL = path.join(COMPONENTS_DIR, 'admin', 'root-shell.tsx')
const ADMIN_LOGIN_FORM = path.join(COMPONENTS_DIR, 'admin', 'login-form.tsx')

/**
 * Kommentare raus, bevor der Quelltext geprüft wird — sonst wertet der Wächter das ERKLÄREN der
 * Regel als Verstoss (die Falle aus B11, s. `route-protection.test.ts`). Die Seite begründet
 * ausführlich, warum sie KEIN Entitlement liest und warum der Chat weg ist, und nennt die Namen dabei.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function read(file: string): string {
  return stripComments(fs.readFileSync(file, 'utf8'))
}

describe('B24 — Adresse der Dateneingabe', () => {
  it('liegt unterhalb der Projekt-Detailseite', () => {
    expect(projectDataEntryHref('abc')).toBe('/admin/kalkulator-projekte/abc/dateneingabe')
    expect(projectDataEntryHref('abc').startsWith(`${projectHref('abc')}/`)).toBe(true)
    expect(projectDataEntryHref('abc').startsWith(`${PROJECTS_HREF}/`)).toBe(true)
  })

  it('kollidiert nicht mit dem Kalkulator-Bereich', () => {
    // `AdminNav` markiert über `startsWith(`${href}/`)`. Der Bindestrich ist dort kein Trennzeichen
    // — sonst stünden „Kalkulator" und „Kalkulator-Projekte" gleichzeitig aktiv.
    expect(projectDataEntryHref('abc').startsWith('/admin/kalkulator/')).toBe(false)
  })

  it('liegt als Datei genau dort, wo der Pfad es sagt', () => {
    // Der Ordner liesse sich umbenennen, ohne dass irgendetwas bricht — die verlinkte Kachel
    // führte dann auf eine 404.
    expect(fs.existsSync(DATA_ENTRY_PAGE)).toBe(true)
    expect(projectDataEntryHref('x').endsWith('/dateneingabe')).toBe(true)
  })
})

describe('B24 — die Seite prüft ausschliesslich die Adminrolle', () => {
  const source = read(DATA_ENTRY_PAGE)

  it('ruft isCurrentUserAdmin auf', () => {
    expect(source).toContain('isCurrentUserAdmin')
  })

  it('⚠ liest KEIN Entitlement — kein getCalculatorAccess, kein calculator_pro', () => {
    expect(source).not.toContain('getCalculatorAccess')
    expect(source).not.toContain('calculator_pro')
    expect(source).not.toContain('get_my_entitlement')
  })

  it('⚠ liest das Projekt über den ADMIN-Wrapper, nicht über den Eigentums-Wrapper', () => {
    expect(source).toContain('readAdminProject')
    expect(source).toContain('admin_get_project')
    // `get_my_project` prüft Eigentum — ein Admin besitzt fremde Projekte nicht.
    expect(source).not.toContain('get_my_project')
    expect(source).not.toContain('readMyProject')
  })
})

describe('B24 — die Seite rendert den Wizard, nicht den Chat', () => {
  const source = read(DATA_ENTRY_PAGE)

  it('leitet die Stationen aus dem Datenbankstand ab', () => {
    expect(source).toContain('buildStations')
    expect(source).toContain('resolveStation')
  })

  it('⚠ liest die Position aus der URL, nicht aus einem Client-Zustand', () => {
    // Ein Wizard-Zustand im Browser könnte behaupten, man stehe bei „Zählpunkt 2", nachdem der
    // zweite Zählpunkt in einem anderen Tab entfernt wurde.
    expect(source).toContain('searchParams')
    expect(source).toContain('STATION_PARAM')
    expect(source).toContain('firstParamValue')
  })

  it('⚠ leitet eine unbekannte Station um, statt einen Fehler zu zeigen', () => {
    expect(source).toContain('redirectRequired')
    expect(source).toContain('redirect(stationHref')
  })

  it('⚠ liest die Zählpunkte über den Leser MIT null-Fall, nicht über den Chat-Port', () => {
    expect(source).toContain('list_metering_points')
    expect(source).toContain('readMeteringPointList')
    // `listMeteringPoints` (lib/project-chat/supabase-ports.ts) fällt auf [] zurück — s. Kopf.
    expect(source).not.toContain('listMeteringPoints')
    expect(source).not.toContain('project-chat/supabase-ports')
  })

  it('⚠ rendert den Projekt-Chat NICHT mehr', () => {
    expect(source).not.toContain('ProjectChat')
    expect(source).not.toContain('visibleTranscript')
    expect(source).not.toContain('loadProjectMessages')
  })
})

describe('B24 — der Intl-Kontext des Admin-Bereichs', () => {
  /*
   * ⚠ DIESER BLOCK HAT SEINEN GEGENSTAND GEWECHSELT, und das ist gemessen, nicht vermutet.
   *
   * Solange die Route den Chat trug, hing sie an EINER Zeile in `root-shell.tsx`: `ProjectChat`
   * ruft `useTranslations`, und `/admin` liegt ausserhalb von `app/(site)/[locale]`. Der Wizard tut
   * das nicht — seine Bausteine (`AdminField` → `Input`/`Label`/`FieldHint`, `Button`, `Container`)
   * rufen `useTranslations` nirgends auf (mit gestrippten Kommentaren nachgezählt: 0 Treffer).
   *
   * Der Provider bleibt trotzdem nötig, nur aus einem anderen Grund — deshalb steht hier weiterhin
   * ein Wächter: `components/admin/login-form.tsx` ruft `useTranslations`, und die
   * locale-bewussten UI-Primitives brauchen `setRequestLocale`. Wer die Zeile entfernt, bricht die
   * Admin-ANMELDUNG, und zwar erst zur Laufzeit.
   */
  it('⚠ der Admin-Login braucht ihn — er ruft useTranslations', () => {
    expect(read(ADMIN_LOGIN_FORM)).toContain('useTranslations')
  })

  it('⚠ und der Admin-Rahmen stellt ihn bereit', () => {
    const shell = read(ROOT_SHELL)
    expect(shell).toContain('NextIntlClientProvider')
    expect(shell).toContain('setRequestLocale')
  })

  it('die Dateneingabe setzt KEINEN eigenen Provider', () => {
    // Sie braucht ihn nicht (s. o.) — und ein lokaler schriebe dieselben Namespaces ein zweites
    // Mal in einen Payload, der sie ohnehin trägt.
    expect(read(DATA_ENTRY_PAGE)).not.toContain('NextIntlClientProvider')
  })
})

describe('B24 — Verlinkung und Abgrenzung', () => {
  it('verlinkt die Dateneingabe-Kachel auf der Detailseite', () => {
    const source = read(DETAIL_PAGE)
    expect(source).toContain('projectDataEntryHref')
    // Kein getippter Pfad daneben — sonst zeigt die Kachel beim nächsten Umbenennen ins Leere.
    expect(source).not.toContain("'/admin/kalkulator-projekte/")
  })

  it('lässt die Report-Kachel ein Platzhalter', () => {
    const source = read(DETAIL_PAGE)
    const report = source.slice(source.indexOf('id="report"'))
    expect(report).toContain('Platzhalter')
    expect(report).not.toContain('href')
  })

  it('⚠ fasst die Kundenroute NICHT an — sie bedient weiterhin den Kunden-Chat', () => {
    const source = read(CUSTOMER_PAGE)
    expect(source).toContain('getCalculatorAccess')
    expect(source).toContain('readMyProject')
    // Der Chat lebt dort unverändert weiter; er ist NUR aus dem Admin-Bereich verschwunden.
    expect(source).toContain('ProjectChat')
    expect(source).not.toContain('isCurrentUserAdmin')
    expect(source).not.toContain('readAdminProject')
  })
})

describe('B24 — der Lastgang-Schritt ist echt, die vier übrigen bleiben Platzhalter', () => {
  const source = read(DATA_ENTRY_PAGE)

  it('⚠ erkennt die Station an der SCHRITT-KENNUNG, nicht am Titel oder an der Position', () => {
    /*
     * Der Titel ist ein Anzeigetext und die Position eine Zahl, die mit jedem weiteren Schritt
     * wandert. Beides als Merkmal genommen zeigte die Lastgang-Oberfläche eines Tages auf der
     * Rechnungs-Station — und dort nähme sie eine Datei entgegen und schriebe sie als Lastgang an
     * den Zählpunkt. Die Kennung ist der einzige stabile Bezug.
     */
    expect(source).toContain("'lastgang'")
    expect(source).toContain('station.meteringPoint')
    expect(source).toContain('DataEntryLoadProfile')
    // Ein Titelvergleich wäre der naheliegende Griff daneben — die Überschrift ist Anzeigetext.
    expect(source).not.toContain('station.title ===')
  })

  it('⚠ löst den Zählpunkt über die 1-basierte Nummer auf', () => {
    // Die Nummer ist eine POSITION in der nach Alter sortierten Liste (Migration 20260911120000
    // TEIL 3). Ein vergessenes `- 1` zeigte die Metadaten des NÄCHSTEN Zählpunkts — und nichts
    // daran sähe kaputt aus: es stünde ein plausibler Zeitraum an der falschen Zeile.
    expect(source).toContain('step.number - 1')
  })

  it('⚠ nennt die Grenze der ABLAGE (20 MB), nicht die des Lesers (25 MB)', () => {
    /*
     * Zwei Grenzen sind im Spiel, und die kleinere gewinnt: der Wrapper VERLANGT ein Dokument,
     * eine 22-MB-Datei würde also vollständig eingelesen und erst beim Hochladen abgewiesen. Die
     * Oberfläche, die 25 MB verspricht, schickt genau diesen Nutzer in einen Fehlschlag, den sie
     * selbst angekündigt hat.
     */
    expect(source).toContain('MAX_PROJECT_DOCUMENT_BYTES')
    expect(source).not.toContain('MAX_LOAD_PROFILE_FILE_BYTES')
  })

  it('lässt die vier übrigen Zählpunkt-Schritte unverändert Platzhalter', () => {
    expect(source).toContain('StationPlaceholder')
  })

  it('⚠ unterdrückt den generischen Weiter-Link für die Lastgang-Station', () => {
    /*
     * Sie rendert ihren Weiter-Knopf selbst (im „Nein"-Zweig sofort, im „Ja"-Zweig erst nach dem
     * Einlesen). Bliebe der generische Link daneben stehen, gäbe es einen zweiten Weg nach vorn —
     * einen, der die Angabe überspringt, genau das, was auf einer erhebenden Station nicht
     * passieren darf.
     */
    const weiter = source.slice(source.indexOf('{previous &&'))
    expect(weiter).toContain('lastgang === null')
  })
})

describe('B24 — die Server Action des Lastgang-Schritts', () => {
  const source = read(path.resolve(import.meta.dirname, 'data-entry-actions.ts'))

  it('⚠ LIEST die Datei, BEVOR sie sie hochlädt', () => {
    /*
     * Die naheliegende Reihenfolge wäre „hochladen, dann lesen". Sie ist hier falsch: es gibt
     * KEINEN Weg, ein eingetragenes Dokument wieder zu entfernen (kein Wrapper, kein Grant — TEIL 9
     * der Migration 20260910090000). Eine unlesbare oder uneindeutige Datei hinterliesse damit
     * dauerhaft eine Zeile in `project_documents`, die niemand mehr los wird.
     */
    expect(source.indexOf('readLoadProfile')).toBeGreaterThan(-1)
    expect(source.indexOf('uploadProjectDocument')).toBeGreaterThan(-1)
    expect(source.indexOf('readLoadProfile')).toBeLessThan(source.indexOf('uploadProjectDocument'))
  })

  it('⚠ schickt die Lücken IMMER mit, auch die leere Liste', () => {
    // `set_metering_point_load_profile` ERSETZT alle vier Angaben gemeinsam. Ein weggelassenes
    // `p_gaps` liesse die Lücken eines früheren Laufs an einer neuen Datei stehen.
    expect(source).toContain('p_gaps: scan.gaps')
  })

  it('⚠ rät bei uneindeutigen Spalten NICHT — es wird nichts gespeichert', () => {
    expect(source).toContain('needsMapping')
  })
})
