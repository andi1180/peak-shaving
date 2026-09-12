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

describe('B24 — der Lastgang-Schritt ist echt, der Tarif-Schritt bleibt Platzhalter', () => {
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

  it('lässt den übrigen Zählpunkt-Schritt unverändert Platzhalter', () => {
    /*
     * ⚠ DIE ZAHL IM NAMEN DIESES WÄCHTERS IST GEWANDERT: beim Lastgang-Schritt waren es VIER
     * übrige, seit der PV-Station ist es EINER (der Tarif). Die Prüfung selbst bleibt dieselbe —
     * sie hält fest, dass der Platzhalter-Zweig überhaupt noch existiert; welche Stationen er
     * abdeckt, prüfen die Wächter der jeweiligen Station (je ein `… === null` in seiner
     * Bedingung). Ein Name, der vier Platzhalter behauptet, wo einer steht, ist schlimmer als
     * keiner: er lässt den nächsten Leser drei Stationen suchen, die es als Platzhalter nicht
     * mehr gibt.
     */
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
     * Die naheliegende Reihenfolge wäre „hochladen, dann lesen". Sie ist hier falsch: eine
     * unlesbare oder uneindeutige Datei hinterliesse eine Zeile in `project_documents`, die zu
     * keinem Zählpunkt gehört.
     *
     * ⚠ DIE URSPRÜNGLICHE BEGRÜNDUNG IST ÜBERHOLT, DIE REGEL NICHT. Sie lautete: „es gibt KEINEN
     * Weg, ein eingetragenes Dokument wieder zu entfernen (TEIL 9 der Migration 20260910090000)".
     * Seit `20260911180000` gibt es ihn — aber ZÄHLPUNKT-GEBUNDEN. Für ein Dokument, das nie an
     * einem Zählpunkt hing, ist der Rückweg damit gerade nicht der vorgesehene, und die Reihenfolge
     * bleibt die einzige Stelle, an der so eine Zeile erst gar nicht entsteht.
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

describe('B24 — der Lastgang-Rückweg', () => {
  const actions = read(path.resolve(import.meta.dirname, 'data-entry-actions.ts'))
  const station = read(path.join(COMPONENTS_DIR, 'admin', 'data-entry-load-profile.tsx'))

  /** Nur der Rumpf der Entfernen-Action — die Reihenfolgen darin sind die eigentliche Zusage. */
  const removeAction = actions.slice(actions.indexOf('removeMeteringPointLoadProfileAction('))

  it('⚠ entfernt ERST die Datei, DANN die Datenbank-Zeile', () => {
    /*
     * Bricht es dazwischen ab, ist eine DB-Zeile ohne Datei sichtbar und beim nächsten Anlauf
     * löschbar; ein Bucket-Objekt ohne Zeile wäre unsichtbar und von niemandem mehr adressierbar.
     * Die umgekehrte Reihenfolge sähe im Code völlig unauffällig aus — deshalb steht sie hier.
     */
    const storage = removeAction.indexOf('removeProjectDocumentBytes')
    const row = removeAction.indexOf('admin_delete_metering_point_document')
    expect(storage).toBeGreaterThan(-1)
    expect(row).toBeGreaterThan(-1)
    expect(storage).toBeLessThan(row)
  })

  it('⚠ lässt die Datenbank-Zeile stehen, wenn das Löschen der Datei scheitert', () => {
    /*
     * Ohne diesen Abbruch entstünde genau der unsichtbare Rest, den die Reihenfolge vermeiden soll.
     *
     * ⚠ Geprüft wird das VERLASSEN der Funktion, nicht die blosse Anwesenheit der Bedingung: ein
     * `if (!removed.ok)`, das nur protokolliert und weiterläuft, liesse einen Test auf die Zeile
     * selbst grün — gemessen. Das eigentliche Verhalten misst
     * `data-entry-actions.test.ts` mit einem simulierten Fehlschlag; hier steht die Form daneben,
     * weil sie im Quelltext unauffällig verschwindet.
     */
    const guard = removeAction.indexOf('if (!removed.ok)')
    const row = removeAction.indexOf('admin_delete_metering_point_document')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(row)
    expect(removeAction.slice(guard, row)).toContain('return {')
  })

  it('⚠ lässt die Station in JEDEM Ausgang neu rendern, sobald zurückgesetzt wurde', () => {
    /*
     * Schritt 1 ist dann bereits geschehen. Ohne `revalidatePath` vor den Verzweigungen zeigte der
     * Browser weiter die Zusammenfassung eines Lastgangs, den es nicht mehr gibt — und der Admin
     * hielte einen Fehlertext für „nichts passiert".
     */
    const revalidate = removeAction.indexOf('revalidatePath')
    const storage = removeAction.indexOf('removeProjectDocumentBytes')
    expect(revalidate).toBeGreaterThan(-1)
    expect(revalidate).toBeLessThan(storage)
  })

  it('⚠ zeigt den Fehlertext des Entfernens in BEIDEN Zweigen der Station', () => {
    /*
     * Ein gescheiterter Schritt 2 oder 3 hinterlässt einen zurückgesetzten Zählpunkt — die Station
     * steht danach im Frage-Zweig. Stünde die Meldung nur an der Zusammenfassung, verschwände
     * ausgerechnet die wichtigste mit ihrem eigenen Auslöser (die Beobachtung aus B16-4b).
     */
    /*
     * ⚠ Gezählt werden die RENDER-STELLEN, nicht die Vorkommen des Feldnamens: der steht je Stelle
     * zweimal (Bedingung und Inhalt), und ein Test auf den blossen Namen bliebe nach dem Entfernen
     * einer der beiden Stellen grün — gemessen.
     */
    const site = '<AdminError>{removeState.formError}</AdminError>'
    expect(station.split(site).length - 1).toBeGreaterThanOrEqual(2)
  })

  it('⚠ hält den Zustand des Entfernens ausserhalb seines Formulars', () => {
    // `useActionState` im Formular selbst verschwände mit dem Formular — s. Test darüber.
    const hook = station.indexOf('useActionState(\n    removeMeteringPointLoadProfileAction')
    const form = station.indexOf('action={removeAction}')
    expect(hook).toBeGreaterThan(-1)
    expect(form).toBeGreaterThan(-1)
    expect(hook).toBeLessThan(form)
  })
})

describe('B24 — der Standardprofil-Zweig', () => {
  const actions = read(path.resolve(import.meta.dirname, 'data-entry-actions.ts'))
  const station = read(path.join(COMPONENTS_DIR, 'admin', 'data-entry-load-profile.tsx'))

  /** Nur der Rumpf der Standardprofil-Action — die Reihenfolgen darin sind die eigentliche Zusage. */
  const saveAction = actions.slice(actions.indexOf('saveMeteringPointStandardProfileAction('))

  it('⚠ der „Nein"-Zweig ist kein Platzhalter mehr', () => {
    /*
     * Bis zu diesem Schritt stand dort „Standardprofil — folgt als eigener Schritt.". Ein
     * Platzhalter, der neben einem funktionierenden Formular stehen bleibt, behauptet, es gebe den
     * Weg nicht — und der Admin sucht ihn woanders.
     */
    expect(station).not.toContain('folgt als eigener Schritt')
    expect(station).toContain('saveMeteringPointStandardProfileAction')
  })

  it('⚠ schreibt die EINGABE in den Entwurf, BEVOR es die Metadaten schreibt', () => {
    /*
     * Bricht es dazwischen ab, steht die Eingabe ohne den daraus erzeugten Zeitraum — der Admin
     * sieht die Frage erneut, trägt dieselbe Zahl ein und ist am Ziel. Umgekehrt stünde ein
     * Zeitraum da, dessen Grundlage nirgends steht.
     */
    const draft = saveAction.indexOf("rpc('update_metering_point_draft'")
    const metadata = saveAction.indexOf("rpc('set_metering_point_standard_profile'")
    expect(draft).toBeGreaterThan(-1)
    expect(metadata).toBeGreaterThan(-1)
    expect(draft).toBeLessThan(metadata)
  })

  it('⚠ liest das Segment aus der DATENBANK, nicht aus dem Formular', () => {
    /*
     * Es entscheidet, WELCHE Kurve gilt. Als verstecktes Feld mitgeschickt wäre es eine Behauptung
     * des Browsers über den Serverzustand, und ein veralteter Tab erzeugte ein Profil nach der
     * falschen Kurve, ohne dass irgendetwas fehlschlüge.
     */
    expect(saveAction).toContain("rpc('admin_get_project'")
    expect(saveAction).not.toContain("formData.get('segment')")
  })

  it('⚠ liest den Entwurf FRISCH, statt ihn aus einer Prop zu übernehmen', () => {
    // `update_metering_point_draft` ERSETZT ihn. Wer einen veralteten Stand hineingibt, macht jede
    // Angabe rückgängig, die seit dem Rendern dazugekommen ist.
    const list = saveAction.indexOf("rpc('list_metering_points'")
    const draft = saveAction.indexOf("rpc('update_metering_point_draft'")
    expect(list).toBeGreaterThan(-1)
    expect(list).toBeLessThan(draft)
  })

  it('⚠ benutzt den EIGENEN Wrapper, nicht den des Uploads', () => {
    /*
     * `set_metering_point_load_profile` weist `p_source_document_id => null` mit `invalid_document`
     * ab — ein Standardprofil hat keine Quelldatei und soll keine vortäuschen.
     */
    expect(saveAction).toContain("rpc('set_metering_point_standard_profile'")
    expect(saveAction).not.toContain("rpc('set_metering_point_load_profile'")
  })

  it('⚠ leitet NICHT um — der Zeitraum ist das Einzige, was ein Mensch prüfen kann', () => {
    expect(saveAction).toContain('revalidatePath')
    expect(saveAction).not.toContain('redirect(')
  })

  it('kennzeichnet eine Schätzung als solche, bevor sie gespeichert wird', () => {
    // ⚠ Die fachliche Zusage des Zweigs (Delta §3.2). Ohne den Vermerk sähe die geschätzte Zahl in
    // jeder späteren Rechnung aus wie eine abgelesene.
    expect(saveAction).toContain("'assumed'")
    expect(saveAction).toContain("'measured'")
    expect(saveAction).toContain('householdEstimateNote')
  })

  it('⚠ fragt Betriebe gar nicht erst — es gibt keine G-Kurve, und es wird keine erfunden', () => {
    expect(station).toContain('hasStandardProfileCurve')
  })

  it('⚠ hält den Zustand des Erzeugens ausserhalb seines Formulars', () => {
    // Dieselbe Beobachtung wie beim Entfernen: ein erfolgreiches Erzeugen wechselt die Station in
    // den Zusammenfassungs-Zweig, und ein `useActionState` IM Formular verschwände mit ihm.
    const hook = station.indexOf('useActionState(\n    saveMeteringPointStandardProfileAction')
    const form = station.indexOf('function StandardProfileForm')
    expect(hook).toBeGreaterThan(-1)
    expect(hook).toBeLessThan(form)
  })

  it('⚠ das inaktive Eingabefeld wird GAR NICHT gerendert, statt deaktiviert zu werden', () => {
    /*
     * Ein deaktiviertes Feld gäbe es weiterhin, und der nächste Umbau schickte seinen Wert mit —
     * dann läge neben der geltenden Zahl eine zweite im selben Formular.
     */
    expect(station).toContain("name=\"mode\"")
    expect(station).not.toContain('disabled={mode')
  })
})

describe('B24 — die Station unterscheidet die Herkunft der Verbrauchsgrundlage', () => {
  const station = read(path.join(COMPONENTS_DIR, 'admin', 'data-entry-load-profile.tsx'))
  const page = read(DATA_ENTRY_PAGE)

  it('⚠ die Zusammenfassung hängt an `profileSource`, nicht an einem Quellen-Flag', () => {
    /*
     * `hasLoadProfile` hing an `source_document_id`; ein erzeugtes Standardprofil setzt die auf
     * `null` und füllt trotzdem den Zeitraum. An der Quelle gemessen stellte die Station ihre
     * Ja/Nein-Frage danach erneut, obwohl gespeichert ist.
     */
    expect(station).toContain("meteringPoint.profileSource !== null")
    expect(station).not.toContain('hasLoadProfile')
  })

  it('⚠ die Verkleinerungs-Sperre zählt NUR hochgeladene Lastgänge', () => {
    /*
     * `admin_set_metering_point_count` prüft `source_document_id`. Ein Zählpunkt mit erzeugtem
     * Profil lässt sich sehr wohl wegkürzen — ihn mitzuzählen behauptete eine Sperre, die es nicht
     * gibt.
     */
    expect(page).toContain("point.profileSource === 'upload'")
  })

  it('⚠ die Rückfrage vor dem Entfernen nennt bei einem erzeugten Profil KEINE Datei', () => {
    /*
     * Ein Standardprofil hat keine in der Ablage. Der Datei-Text behauptete eine Löschung, die
     * nicht stattfindet — beim zweiten Mal ein Grund, der Rückfrage nicht mehr zu glauben.
     */
    const standard = station.slice(station.indexOf('REMOVE_STANDARD_CONFIRM ='))
    const text = standard.slice(0, standard.indexOf('\n\n'))
    expect(text).not.toContain('Ablage')
    expect(text).toContain('Jahresverbrauch bleibt')
  })

  it('beide Herkünfte teilen sich EINE Entfernen-Action', () => {
    // `admin_reset_metering_point_load_profile` setzt auch dann zurück, wenn keine Quelle dasteht.
    // Eine zweite Action wäre eine zweite Stelle für dieselbe Entscheidung.
    expect(station.split('removeMeteringPointLoadProfileAction').length - 1).toBeGreaterThanOrEqual(2)
    expect(station).not.toContain('removeMeteringPointStandardProfileAction')
  })
})

/**
 * B24, Teil 1 — die BATTERIE-Station.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DER EIGENTLICHE GEGENSTAND: ZWEI ACTIONS AUF EINEM FORMULAR VERLANGEN KONTROLLIERTE FELDER
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * React setzt UNKONTROLLIERTE Formularfelder nach JEDER abgeschlossenen Action auf demselben
 * Formular zurück, nicht nur nach der gemeinten. Bei der Rechnungs-Station war das ein gemessener
 * Defekt (PR #200): der Vorschlagen-Knopf löschte ausgerechnet die drei Angaben, aus denen der
 * Vorschlag gebildet wurde.
 *
 * Die Batterie-Station hat dieselbe Konstruktion („Auslesen" und „Speichern" auf einem Formular)
 * und ist deshalb von Anfang an kontrolliert. Prüfen lässt sich das hier nur am QUELLTEXT —
 * `apps/web` hat kein Renderer-Setup (`vitest.config.ts` schliesst `components/**` aus), und was
 * React mit einem `defaultValue` tut, kann ein Unit-Test nicht messen. Der Durchstich
 * „Auslesen → Speichern" liegt als Verhaltenstest in `data-entry-actions.test.ts`; er misst die
 * Bedingung dafür (die Lese-Action schreibt nichts, die Speicher-Action nimmt dieselben Werte),
 * nicht das Zurücksetzen selbst.
 */
/**
 * Die Bedingung, unter der der Platzhalter-Zweig der Zählpunkt-Stationen rendert.
 *
 * ⚠ AUSGESCHNITTEN STATT WÖRTLICH VERGLICHEN, und das ist eine Lehre aus dem PV-Schritt: die
 * Wächter prüften bis dahin `'batterie === null && ('` — also die Bedingung MITSAMT ihrer Stellung
 * als letzte. Mit der PV-Station rückte eine weitere dahinter, und der Test wurde rot, obwohl die
 * Aussage („dieser Zweig deckt die Station nicht mehr mit ab") unverändert stimmte. Geprüft wird
 * deshalb, ob der Ausschluss IN der Bedingung steht, nicht wo.
 */
function placeholderCondition(page: string): string {
  const start = page.indexOf("{station.kind === 'zaehlpunkt-schritt' &&")
  return page.slice(start, page.indexOf('<StationPlaceholder', start))
}

const BATTERY_STATION = path.join(COMPONENTS_DIR, 'admin', 'data-entry-battery.tsx')
/*
 * ⚠ SEIT DER AUFTEILUNG LIEGT JEDE QUELLE IN EINER EIGENEN DATEI. Die Station hält weiterhin die
 * drei `useActionState`, die Fehlermeldungen und den `fields`-Zustand; was eine Quelle RENDERT,
 * steht in ihrer Datei. Die Prüfungen zeigen deshalb ab hier gezielt auf den Fundort — und die
 * VERBOTE (`not.toContain`) laufen über ALLE VIER Dateien, sonst liesse sich ein untersagter
 * Griff einfach eine Datei weiter unterbringen.
 */
const BATTERY_TEXT = path.join(COMPONENTS_DIR, 'admin', 'data-entry-battery-text.tsx')
const BATTERY_SPEC = path.join(COMPONENTS_DIR, 'admin', 'data-entry-battery-spec.tsx')
const BATTERY_LOOKUP = path.join(COMPONENTS_DIR, 'admin', 'data-entry-battery-lookup.tsx')

describe('B24 — die Batterie-Station', () => {
  const source = read(BATTERY_STATION)
  const textSource = read(BATTERY_TEXT)
  const specSource = read(BATTERY_SPEC)
  const lookupSource = read(BATTERY_LOOKUP)
  const allSources = [source, textSource, specSource, lookupSource].join('\n')
  const page = read(DATA_ENTRY_PAGE)

  it('⚠ hält ALLE fünf Eingaben kontrolliert — sonst löscht „Auslesen" das Formular', () => {
    // Die vier Zahlenfelder laufen über `BATTERY_VALUE_FIELDS.map` und teilen sich eine Zuweisung.
    expect(source).toContain('value={fields[entry.form]')
    expect(source).toContain('onValueChange={(value) =>')
    // Der Freitext ebenso — er steht im selben Formular und träfe dieselbe Rücksetzung.
    expect(textSource).toContain('value={text}')
    // ⚠ Der Griff daneben: ein `defaultValue` irgendwo in diesem Formular bringt den Defekt zurück.
    expect(allSources).not.toContain('defaultValue')
  })

  it('⚠ schickt DASSELBE Formular an die Lese-Action, statt ein zweites daneben zu stellen', () => {
    // Verschachtelte Formulare gibt es in HTML nicht, und beide Wege brauchen dieselben Felder —
    // zwei Formulare hiessen, die vier Zahlen zweimal zu erheben.
    /*
     * ⚠ DIE VERDRAHTUNG HAT JETZT ZWEI ENDEN und wird an beiden geprüft: die Station gibt GENAU
     * die Lese-Action an GENAU die Freitext-Quelle, und die schickt das umgebende Formular
     * daran. Nur ein Ende geprüft liesse offen, ob dort die Action einer anderen Quelle ankommt.
     */
    const textCall = source.slice(source.indexOf('<DataEntryBatteryText'))
    expect(textCall.slice(0, textCall.indexOf('/>'))).toContain('action={readAction}')
    expect(textSource).toContain('formAction={action}')
    expect(source).toContain('extractBatteryTextFromAction')
    /*
     * ⚠ NACH DER AUFTEILUNG HÄNGT „DASSELBE FORMULAR" GENAU HIER: ein `formAction` in einer
     * Quellen-Datei beweist für sich nur noch, dass irgendein Formular angesprochen wird. Keine
     * der drei Quellen darf ein eigenes mitbringen — sonst stünden die vier Zahlenfelder
     * ausserhalb des abgeschickten Formulars und kämen bei der Lese-Action gar nicht an.
     */
    for (const child of [textSource, specSource, lookupSource]) {
      expect(child).not.toContain('<form')
    }
  })

  it('⚠ verwirft `hasExistingBattery` aus der Extraktion', () => {
    /*
     * Der Extraktor liest es mit (der öffentliche Rechner braucht es, weil dort die Frage NUR im
     * Satz steht). Im Wizard steht sie als Weiche darüber — ein zweites, womöglich
     * widersprüchliches Signal aus dem Fliesstext wäre verwirrend, nicht hilfreich.
     */
    expect(allSources).not.toContain('hasExistingBattery')
  })

  it('⚠ ordnet die genannte Kapazität KEINEM Katalog-Gerät zu', () => {
    /*
     * Delta 17 Teil 2 (01.09.2026): die bestehende Anlage wird mit ihren EXAKTEN Werten gerechnet.
     * Ein Runden auf den nächstliegenden Kandidaten ergäbe eine Ersparnis, die zu einem Gerät
     * gehört, das der Kunde nicht besitzt — und ein benannter Abstand macht eine falsche Zahl
     * nicht richtig, er macht sie nur erklärt.
     */
    expect(allSources).not.toContain('battery-combination')
    expect(allSources).not.toContain('matchCatalogByCapacity')
    expect(allSources).not.toContain('buildExistingBatteryCandidate')
    expect(allSources).not.toContain('DEMO_BATTERY_CATALOG')
  })

  it('⚠ zeigt weder Investition noch Amortisation — die Anlage ist bezahlt', () => {
    expect(allSources).not.toContain('Amortisation')
    expect(allSources).not.toContain('Investition')
  })

  it('⚠ stellt die Frage auch dann, wenn schon etwas erfasst ist', () => {
    /*
     * Anders als beim Lastgang: dort gibt es einen ausdrücklichen Entfernen-Weg, hier nicht. Wer
     * sich vertippt oder die Antwort wechselt, muss sie neu geben können — eine Frage, die nach
     * dem ersten Speichern verschwindet, wäre eine Sackgasse.
     */
    const question = source.indexOf('Haben Sie bereits einen Batteriespeicher')
    expect(question).toBeGreaterThan(-1)
    // Die Zusammenfassung steht DARÜBER und ersetzt die Frage nicht.
    expect(source.indexOf('hasSummary && <BatterySummary')).toBeLessThan(question)
  })

  it('⚠ die Weiche lebt in `useState` und erreicht keine Action', () => {
    // „Haben Sie eine Batterie?" ist eine Weiche innerhalb der Station, keine gespeicherte Angabe —
    // dieselbe Entscheidung wie beim Lastgang. Gespeichert wird, was die ZWEIGE erheben.
    expect(source).toContain("React.useState<Answer>(null)")
    expect(source).not.toContain('name="hasBattery"')
  })

  it('⚠ die Seite erkennt die Station an der SCHRITT-KENNUNG und unterdrückt ihren Weiter-Link', () => {
    expect(page).toContain("step.step !== 'batterie'")
    expect(page).toContain('DataEntryBattery')
    const weiter = page.slice(page.indexOf('{previous &&'))
    expect(weiter).toContain('batterie === null')
    // Der Platzhalter-Zweig darf die Station nicht mehr mit abdecken.
    expect(placeholderCondition(page)).toContain('batterie === null')
  })

  /*
   * ⚠ DIESER WÄCHTER HAT SEIN VORZEICHEN GEWECHSELT, und das ist kein Nachgeben.
   *
   * Er verlangte bis zum Datenblatt-Weg das Gegenteil („reicht KEINE Grössengrenze herein — diese
   * Station nimmt keine Datei entgegen"). Seit die Station ein Datenblatt entgegennimmt, ist das
   * eine falsche Behauptung. Ersetzt statt gestrichen, und zwar durch die SCHÄRFERE Aussage: nicht
   * bloss „ein Prop ist da", sondern die RICHTIGE Konstante — die Verwechslung mit der Grenze der
   * Dokumentablage ist der teure Fall, weil sie erst am abgewiesenen Scan auffiele.
   */
  it('⚠ reicht die Scan-Grenze herein, NICHT die der Dokumentablage', () => {
    const branch = page.slice(page.indexOf('<DataEntryBattery'))
    const close = branch.slice(0, branch.indexOf('/>'))
    expect(close).toContain('maxBytes={MAX_BATTERY_SPEC_FILE_BYTES}')
    // Ein Datenblatt wird ausgelesen und ausdrücklich NICHT abgelegt — 20 MB gälten hier für einen
    // Weg, den es nicht gibt, und wären mehr, als der Scan annimmt.
    expect(close).not.toContain('MAX_PROJECT_DOCUMENT_BYTES')
  })

  it('⚠ rendert die nicht gewählte Quelle GAR NICHT, statt sie auszublenden', () => {
    // Alle drei Wege schicken DASSELBE Formular ab. Ein verstecktes Dateifeld reiste beim Klick auf
    // „Auslesen" des Freitext-Wegs trotzdem mit (und umgekehrt) — die Action bekäme eine Eingabe,
    // die niemand gemacht hat. Der Umschalter ist eine Weiche, keine Sichtbarkeitsfrage.
    /*
     * ⚠ DREI EIGENSTÄNDIGE `&&`-BLÖCKE, KEIN TERNARY MEHR — der Wächter ist damit SCHÄRFER, nicht
     * nachgiebig. Bis zum Recherche-Weg genügte `{source === 'text' ? ( … ) : ( … )}`, weil es nur
     * zwei Quellen gab; mit der dritten prüft er jede EINZELN. Ein Ternary liesse den dritten Zweig
     * gar nicht zu, ohne eine der beiden bestehenden Quellen zu verschachteln.
     */
    for (const branch of ['text', 'datenblatt', 'recherche']) {
      expect(source).toContain(`{source === '${branch}' && (`)
    }
    // Und keine der drei darf über ein Ternary an einer anderen hängen.
    expect(source).not.toContain("{source === 'text' ? (")
    /*
     * ⚠ ZWEI FORMEN SIND LEGITIM UND AUSGENOMMEN: die versteckten Formularfelder (`type="hidden"`)
     * und die dekorativen Icons (`aria-hidden`). Gemeint ist ausschliesslich eine Tailwind-
     * Sichtbarkeitsklasse auf einer der beiden Quellen-Sektionen — jedes WEITERE `hidden` schlägt
     * an, und genau das soll es.
     */
    const visibility = allSources.replaceAll('type="hidden"', '').replaceAll('aria-hidden', '')
    expect(visibility).not.toContain('hidden')
    // Die drei Umschalt-Knöpfe stehen IM Speichern-Formular und dürfen es nicht absenden.
    const group = source.slice(source.indexOf('aria-label="Quelle der Kenndaten"'))
    expect(group.slice(0, group.indexOf('</div>'))).not.toContain('type="submit"')
  })

  it('⚠ der Datenblatt-Weg hat ein EIGENES useActionState, nicht das des Freitexts', () => {
    // Zusammengelegt überschriebe das Ergebnis des einen Wegs die Meldung des anderen, und die
    // zwei Ladezustände wären nicht mehr auseinanderzuhalten.
    const specCall = source.slice(source.indexOf('<DataEntryBatterySpec'))
    expect(specCall.slice(0, specCall.indexOf('/>'))).toContain('action={specAction}')
    expect(specSource).toContain('formAction={action}')
    expect(source).toContain('scanBatterySpecAction')
    expect(specSource).toContain('disabled={isScanning || isSaving}')
    expect(specSource).toContain('name="batterySpec"')
  })

  it('⚠ verspricht NICHT, dass das Datenblatt im Projekt abgelegt wird', () => {
    // Es wird gelesen und weggeworfen (`scanBatterySpecAction` legt nichts ab). Der Satz der
    // Rechnungs-Station („wird im Projekt abgelegt und ausgelesen") wäre hier unwahr.
    const hint = specSource.slice(specSource.indexOf('${SPEC_ID}-hint`}'))
    const text = hint.slice(0, hint.indexOf('</FieldHint>'))
    expect(text).toContain('im Projekt abgelegt wird es')
    expect(text).toContain('nicht gespeichert')
  })
})

/**
 * B24, Teil 1 — die PV-Station.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DER GEGENSTAND: DIE ANTWORT IST EINE ANGABE, KEINE WEICHE
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Die drei Stationen davor tragen ihre Ja/Nein-Frage in `useState` — dort steht hinter jedem Zweig
 * etwas, das erhoben wird, und die Frage ist bloss der Weg dorthin. Hier gibt es hinter dem
 * Nein-Zweig nichts zu erheben: bliebe die Antwort im lokalen Zustand, wäre sie nach jedem
 * Neuladen weg, und die Station stellte dieselbe Frage erneut.
 *
 * Der Griff daneben ist deshalb ein `useState` für die Antwort ODER ein lokaler Zustand NEBEN dem
 * Entwurf. Beides sähe im Browser zunächst richtig aus — der Unterschied zeigt sich erst beim
 * Neuladen bzw. dann, wenn der Schreibvorgang scheitert.
 *
 * Reine Quelltextprüfung: `apps/web` hat kein Renderer-Setup (`vitest.config.ts` schliesst
 * `components/**` aus). Der Durchstich „Nein speichern → Nein-Zweig" liegt als Verhaltenstest in
 * `data-entry-actions.test.ts` (die Action schreibt `hasPv: false`) und in `pv-draft.test.ts` (der
 * Leser macht daraus den Nein-Zweig); hier steht die Verdrahtung dazwischen.
 */
const PV_STATION = path.join(COMPONENTS_DIR, 'admin', 'data-entry-pv.tsx')

describe('B24 — die PV-Station', () => {
  const source = read(PV_STATION)
  const page = read(DATA_ENTRY_PAGE)
  const draftModule = read(path.resolve(import.meta.dirname, 'pv-draft.ts'))
  const actions = read(path.resolve(import.meta.dirname, 'data-entry-actions.ts'))

  it('⚠ leitet den Zweig AUSSCHLIESSLICH aus dem Entwurf ab, nicht aus lokalem Zustand', () => {
    /*
     * Ein `useState` daneben (etwa als optimistische Vorwegnahme) könnte von dem abweichen, was
     * wirklich gespeichert ist — genau dann, wenn der Schreibvorgang scheitert: die Oberfläche
     * zeigte einen beantworteten Zweig, und im Entwurf stünde nichts.
     */
    expect(source).toContain('readPvDraft(meteringPoint.draft)')
    expect(source).not.toContain('useState')
  })

  it('⚠ beide Antworten werden GESPEICHERT — die Frage ist keine Weiche', () => {
    // Zwei Absendeknöpfe mit `name`/`value` statt einer Ankreuzmöglichkeit: „nein" muss von
    // „dazu wurde nichts gefragt" unterscheidbar bleiben, und nicht angehakt hiesse beides.
    expect(source).toContain('name={PV_PRESENT_KEY}')
    expect(source).toContain("value=\"ja\"")
    expect(source).toContain("value=\"nein\"")
    expect(source).not.toContain('type="checkbox"')
    expect(source).not.toContain('type="radio"')
    // Und der Feldname kommt aus dem Entwurfs-Modul, nicht als getippte Zeichenkette.
    expect(source).not.toContain("name=\"hasPv\"")
  })

  it('⚠ die Frage bleibt stehen, auch wenn sie beantwortet ist', () => {
    /*
     * Es gibt für diese Angabe KEINEN Entfernen-Weg. Wer versehentlich „Ja" trifft, muss „Nein"
     * nachlegen können — eine Frage, die nach der ersten Antwort verschwindet, wäre eine
     * Sackgasse. Welche Antwort gilt, steht an den Knöpfen (`aria-pressed`).
     */
    const question = source.indexOf('Haben Sie bereits eine PV-Anlage')
    expect(question).toBeGreaterThan(-1)
    // Die Frage steht VOR beiden Zweigen, hängt also an keiner Bedingung.
    expect(question).toBeLessThan(source.indexOf('{hasPv === true &&'))
    expect(source).toContain('aria-pressed={hasPv === true}')
    expect(source).toContain('aria-pressed={hasPv === false}')
  })

  it('⚠ der Weiter-Knopf erscheint, sobald IRGENDEINE Antwort vorliegt', () => {
    /*
     * Nicht nur bei „ja": auch „es gibt keine PV-Anlage" ist eine vollständige Antwort auf diese
     * Station. Hinge er an `hasPv === true`, käme ein Kunde ohne PV hier nicht weiter — und die
     * Station wäre ausgerechnet für den Regelfall eine Sackgasse.
     */
    const weiter = source.slice(source.indexOf('{nextHref !== null &&'))
    expect(weiter).toContain("variant={hasPv === null ? 'secondary' : 'primary'}")
    expect(weiter).not.toContain('hasPv === true')
  })

  it('⚠ der Nein-Zweig nennt die Adresse aus COMPANY, nicht als getippte Zweitfassung', () => {
    // `lib/nav.ts` ist der EINE Fundort der Kontaktdaten — eine hier getippte Adresse zeigte nach
    // einem Postfachwechsel still ins alte Postfach.
    expect(source).toContain('COMPANY.email')
    expect(source).not.toContain('@coolin.at')
    // Der Betreff nennt das Projekt und wird kodiert (ein Projektname darf Sonderzeichen tragen).
    expect(source).toContain('encodeURIComponent')
    expect(source).toContain('PV-Planung')
  })

  it('⚠ der Ja-Zweig NIMMT eine Erzeugungsdatei entgegen — und weiterhin keinen PVGIS-Abruf', () => {
    /*
     * ⚠ NACHGEZOGEN, NICHT GESTRICHEN: bis zum Erzeugungsprofil-Upload verlangte dieser Test das
     * Gegenteil („kein Dateifeld, kein `maxBytes`") — der Ja-Zweig war ein benannter Platzhalter.
     * Diese Zusage ist mit dem Upload gefallen. Was BLEIBT, ist ihre zweite Hälfte, und sie ist
     * fachlich die wichtigere: ein PVGIS-Abruf (B22, der Weg für eine Anlage OHNE gemessene
     * Erzeugung) gehört weiterhin nicht hierher — eine erzeugte Kurve ist keine gemessene.
     */
    const ja = source.slice(source.indexOf('{hasPv === true &&'))
    const branch = ja.slice(0, ja.indexOf('{hasPv === false &&'))
    expect(branch).toContain('PvProfileUploadForm')
    expect(branch).toContain('maxBytes={maxBytes}')
    expect(source).toContain('type="file"')
    expect(source).not.toContain('pvgis')
  })

  it('⚠ das Entwurfs-Modul ist rein — die Client-Komponente importiert davon', () => {
    // Ein `server-only` oder ein Supabase-Client dort bräche den Build der Station.
    expect(draftModule).not.toContain("'server-only'")
    expect(draftModule).not.toContain('@/lib/supabase')
    expect(draftModule).not.toContain('next/')
  })

  it('⚠ die Seite erkennt die Station an der SCHRITT-KENNUNG und unterdrückt ihren Weiter-Link', () => {
    expect(page).toContain("step.step !== 'pv'")
    expect(page).toContain('DataEntryPv')
    const weiter = page.slice(page.indexOf('{previous &&'))
    expect(weiter).toContain('pv === null')
    // Der Platzhalter-Zweig darf die Station nicht mehr mit abdecken.
    expect(placeholderCondition(page)).toContain('pv === null')
  })

  it('⚠ reicht `customerLabel` UND die kleinere der zwei Grössengrenzen herein', () => {
    const branch = page.slice(page.indexOf('<DataEntryPv'))
    const close = branch.slice(0, branch.indexOf('/>'))
    // Der Betreff der PV-Anfrage nennt das Projekt; die Station kennt nur den Zählpunkt.
    expect(close).toContain('customerLabel={project.customer_label}')
    /*
     * ⚠ NACHGEZOGEN: dieser Test verlangte bis zum Erzeugungsprofil-Upload ausdrücklich KEIN
     * `maxBytes` — es gab keinen Weg, auf den sich eine Grenze hätte beziehen können. Jetzt gibt es
     * ihn, und geprüft wird nicht bloss, DASS eine Grenze hereinkommt, sondern WELCHE: es gilt die
     * kleinere von beiden. Die Ablage (`MAX_PROJECT_DOCUMENT_BYTES`, 20 MB) ist enger als der Leser
     * (`MAX_PV_PROFILE_FILE_BYTES`, 25 MB); mit der Leser-Grenze beschriftet liefe eine 22-MB-Datei
     * vollständig durch das Einlesen und scheiterte erst beim Hochladen — ein Fehlschlag, den die
     * Oberfläche selbst angekündigt hätte. Dieselbe Regel wie bei Lastgang, Rechnung und Batterie.
     */
    expect(close).toContain('maxBytes={MAX_PROJECT_DOCUMENT_BYTES}')
    expect(close).not.toContain('MAX_PV_PROFILE_FILE_BYTES')
  })

  it('⚠ die Action schreibt GENAU EIN Feld und leitet NICHT um', () => {
    const action = actions.slice(actions.indexOf('export async function saveMeteringPointPvChoiceAction'))
    const body = action.slice(0, action.indexOf('\n}\n'))
    // Ein Feld, ein Schreibvorgang — der Wrapper ERSETZT den Entwurf.
    expect(body).toContain('[{ field: PV_PRESENT_KEY, value: has }]')
    /*
     * Kein `redirect`: der gespeicherte Stand ist das Einzige, was ein Mensch hier prüfen kann.
     * Eine Weiterleitung nähme ihm genau die Bestätigung, die er gerade ausgelöst hat.
     */
    expect(body).not.toContain('redirect(')
  })
})
