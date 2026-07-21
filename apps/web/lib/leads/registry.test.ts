/**
 * Der Vollständigkeits-Beweis der Registry-Texte (B3-2).
 *
 * Die Registry legt fest, DASS jeder Einstiegspunkt vier kontextspezifische Texte hat (Überschrift,
 * Erläuterung, Schaltflächenbeschriftung, Erfolgsmeldung); der Wortlaut steht nach §8.7 in
 * `messages/de.json`. Ohne diesen Test wäre ein vergessener Text eine leere Überschrift auf einer
 * öffentlichen Marketingseite — next-intl wirft zwar zur Laufzeit, aber erst, wenn jemand die Seite
 * aufruft, auf der der Eintrag platziert ist. Ein nicht platzierter Eintrag fiele gar nicht auf und
 * bräche in dem Moment, in dem ihn jemand platziert.
 */

import { describe, expect, it } from 'vitest'

import de from '../../messages/de.json'
import { LEAD_CAPTURE_REGISTRY, LEAD_FIELDS, LEAD_SOURCE_KEYS } from './registry'

const TEXTE = ['heading', 'body', 'submit', 'success'] as const

const entries = de.LeadCapture.entries as Record<string, Record<string, string> | undefined>
const felder = de.LeadCapture.fields as Record<string, string | undefined>

describe('Registry-Texte', () => {
  it('jeder Einstiegspunkt hat alle vier Texte, und keiner ist leer', () => {
    for (const key of LEAD_SOURCE_KEYS) {
      const eintrag = entries[key]
      expect(eintrag, `LeadCapture.entries.${key} fehlt in messages/de.json`).toBeDefined()
      for (const text of TEXTE) {
        expect(eintrag?.[text]?.trim(), `LeadCapture.entries.${key}.${text}`).toBeTruthy()
      }
    }
  })

  it('es gibt keinen verwaisten Texteintrag ohne Registry-Eintrag', () => {
    const bekannt = new Set<string>(LEAD_SOURCE_KEYS)
    // Ein Textblock ohne Eintrag ist tot: er würde nie gerendert, aber beim nächsten Umbenennen
    // sähe es so aus, als sei der Text vorhanden.
    expect(Object.keys(entries).filter((key) => !bekannt.has(key))).toEqual([])
  })

  it('jedes von einem Eintrag erhobene Feld hat eine Beschriftung', () => {
    for (const key of LEAD_SOURCE_KEYS) {
      for (const field of LEAD_CAPTURE_REGISTRY[key].fields) {
        expect(felder[field.key]?.trim(), `LeadCapture.fields.${field.key}`).toBeTruthy()
        // Und die Registry kennt seine Eingabeart — sonst renderte die Komponente ein Textfeld für
        // ein Datum.
        expect(LEAD_FIELDS[field.key], `LEAD_FIELDS.${field.key}`).toBeDefined()
      }
    }
  })

  it('jeder Eintrag erhebt mindestens die Adresse — ohne sie gäbe es nichts zuzustellen', () => {
    for (const key of LEAD_SOURCE_KEYS) {
      const email = LEAD_CAPTURE_REGISTRY[key].fields.find((field) => field.key === 'email')
      expect(email, `Eintrag "${key}" ohne E-Mail-Feld`).toBeDefined()
      expect(email?.required, `Eintrag "${key}": E-Mail muss Pflicht sein`).toBe(true)
    }
  })
})
