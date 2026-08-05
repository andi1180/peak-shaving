/**
 * Auswahlliste und Anzeige des Themas im Admin-Bereich (`lib/admin/lead-thema.ts`).
 *
 * ── DIE EIGENSCHAFT, AN DER DIESES MODUL HÄNGT ──────────────────────────────────────────────────
 * Es gibt GENAU EINE Themenliste, und sie steht in `lib/kontakt/themen.ts` (datengetrieben aus
 * `LEISTUNGEN`). Der Admin-Bereich zeigt sie nur an. Die Tests unten vergleichen deshalb gegen
 * `THEMEN` selbst statt gegen eine erwartete Aufzählung — eine hier abgetippte Liste wäre exakt der
 * Fehler, den das Modul verhindern soll, und ein Test, der sie zementiert, machte ihn dauerhaft.
 */
import { describe, expect, it } from 'vitest'

import { THEMEN } from '@/lib/kontakt/themen'
import { themaLabel, themaOptions, type ThemaLabelResolver } from './lead-thema'

/**
 * Ein Übersetzer, der Namensraum UND Schlüssel sichtbar macht. Eine Attrappe, die nur den Schlüssel
 * zurückgäbe, könnte nicht zeigen, dass die sechs Leistungen aus `Nav` und die zwei Zusätze aus
 * `Kontakt` kommen — und genau diese Zuordnung trägt `themen.ts` je Eintrag mit.
 */
const resolve: ThemaLabelResolver = (namespace, key) => `${namespace}:${key}`

describe('themaOptions — die Liste', () => {
  it('bietet GENAU die Themen der Taxonomie, in derselben Reihenfolge', () => {
    expect(themaOptions(resolve).map((option) => option.key)).toEqual(
      THEMEN.map((thema) => thema.key),
    )
  })

  it('beschriftet jede Option über den Namensraum ihres Eintrags', () => {
    const options = themaOptions(resolve)
    for (const [index, thema] of THEMEN.entries()) {
      expect(options[index]?.label).toBe(`${thema.labelNamespace}:${thema.labelKey}`)
    }
  })

  it('zieht beide Namensräume heran — die Leistungen aus Nav, die zwei Zusätze aus Kontakt', () => {
    /*
     * Ein Modul, das alles über EINEN Namensraum auflöste, funktionierte für die sechs Leistungen
     * und liesse „Peak Shaving" und „Sonstiges" unübersetzt — die zwei Themen, die es nur im
     * Kontaktformular gibt. Der Fehler wäre am Bildschirm ein roher Schlüssel neben sechs Namen.
     */
    const labels = themaOptions(resolve).map((option) => option.label)
    expect(labels.some((label) => label.startsWith('Nav:'))).toBe(true)
    expect(labels.some((label) => label.startsWith('Kontakt:'))).toBe(true)
  })
})

describe('themaLabel — die Anzeige', () => {
  it('löst einen bekannten Schlüssel zum Anzeigetext auf', () => {
    const erstes = THEMEN[0]!
    expect(themaLabel(erstes.key, resolve)).toBe(`${erstes.labelNamespace}:${erstes.labelKey}`)
  })

  it('liefert null für „nicht angegeben" — null, undefined und Leerzeichen', () => {
    // Drei Wege zu demselben Zustand: die Spalte ist nullable, und die meisten Erfassungswege
    // lassen sie leer. Ein Leerstring darf sich davon nicht unterscheiden.
    expect(themaLabel(null, resolve)).toBeNull()
    expect(themaLabel(undefined, resolve)).toBeNull()
    expect(themaLabel('   ', resolve)).toBeNull()
  })

  it('zeigt einen UNBEKANNTEN Schlüssel roh an, statt zu werfen oder zu verschweigen', () => {
    /*
     * Der Fall ist real: `platform.leads.thema` trägt bewusst keinen CHECK, ein umbenanntes
     * Leistungsfeld hinterlässt Altbestand. `findThema` wirft dann — hier wäre das die schlechteste
     * Antwort, denn es risse die gesamte Detailseite eines Leads herunter, dessen einziges Problem
     * eine veraltete Kategorie ist. Ein leeres Feld wäre die zweitschlechteste: Es sähe aus wie
     * „nicht angegeben" und wäre eine Angabe.
     */
    expect(themaLabel('gibtsNichtMehr', resolve)).toBe('gibtsNichtMehr')
    expect(() => themaLabel('gibtsNichtMehr', resolve)).not.toThrow()
  })

  it('schneidet Randleerzeichen ab, bevor es nachschlägt', () => {
    const erstes = THEMEN[0]!
    expect(themaLabel(`  ${erstes.key}  `, resolve)).toBe(
      `${erstes.labelNamespace}:${erstes.labelKey}`,
    )
  })
})
