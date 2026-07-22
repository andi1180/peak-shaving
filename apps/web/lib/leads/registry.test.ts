/**
 * Der Vollständigkeits-Beweis der Registry-Texte (B3-2, um die formularlosen Herkünfte erweitert in
 * B10-5).
 *
 * Die Registry legt fest, DASS jeder Einstiegspunkt MIT FORMULAR vier kontextspezifische Texte hat
 * (Überschrift, Erläuterung, Schaltflächenbeschriftung, Erfolgsmeldung); der Wortlaut steht nach
 * §8.7 in `messages/de.json`. Ohne diesen Test wäre ein vergessener Text eine leere Überschrift auf
 * einer öffentlichen Marketingseite — next-intl wirft zwar zur Laufzeit, aber erst, wenn jemand die
 * Seite aufruft, auf der der Eintrag platziert ist. Ein nicht platzierter Eintrag fiele gar nicht
 * auf und bräche in dem Moment, in dem ihn jemand platziert.
 *
 * SEIT B10-5 GIBT ES HERKÜNFTE OHNE FORMULAR (die Registrierung). Für sie gilt die Textpflicht
 * ausdrücklich NICHT — sie rendern keinen Kasten, ihre Felder stehen im Auth-Schema und ihre Texte
 * im `Konto`-Namensraum. Die Tests unterscheiden deshalb sauber zwischen „alle Herkünfte" und
 * „Herkünfte mit Formular"; genau diese Trennung prüft der erste Block.
 */

import { describe, expect, it } from 'vitest'

import de from '../../messages/de.json'
import {
  LEAD_CAPTURE_FORM_KEYS,
  LEAD_CAPTURE_REGISTRY,
  LEAD_FIELDS,
  LEAD_SOURCE_KEYS,
  LEAD_SOURCE_KEYS_WITHOUT_FORM,
  isLeadCaptureFormKey,
  isLeadSourceKey,
  findLeadCaptureEntry,
} from './registry'

const TEXTE = ['heading', 'body', 'submit', 'success'] as const

const entries = de.LeadCapture.entries as Record<string, Record<string, string> | undefined>
const felder = de.LeadCapture.fields as Record<string, string | undefined>

describe('Herkünfte mit und ohne Formular (B10-5)', () => {
  it('die beiden Listen ergeben zusammen genau die Herkünfte und überschneiden sich nicht', () => {
    // Eine Herkunft, die in beiden Listen steht, wäre je nach Blickwinkel ein Formular oder keins —
    // und die Textpflicht gälte dann mal ja, mal nein.
    const doppelt = LEAD_CAPTURE_FORM_KEYS.filter((key) =>
      (LEAD_SOURCE_KEYS_WITHOUT_FORM as readonly string[]).includes(key),
    )
    expect(doppelt).toEqual([])
    expect([...LEAD_SOURCE_KEYS].sort()).toEqual(
      [...LEAD_CAPTURE_FORM_KEYS, ...LEAD_SOURCE_KEYS_WITHOUT_FORM].sort(),
    )
  })

  it('eine formularlose Herkunft ist ein gültiger Schlüssel, aber KEIN Formular-Schlüssel', () => {
    for (const key of LEAD_SOURCE_KEYS_WITHOUT_FORM) {
      expect(isLeadSourceKey(key), key).toBe(true)
      expect(isLeadCaptureFormKey(key), key).toBe(false)
      /*
       * DER EIGENTLICHE SCHUTZ: `findLeadCaptureEntry` prüft den Schlüssel, den eine abgesendete
       * Erfassungsstrecke mitschickt — er ist vom Absender frei wählbar. Fände er hier einen
       * Eintrag, liesse sich über den Formular-Endpunkt ein Lead unter der Herkunft
       * 'registrierung' anlegen: eine Kontoanlage, die nie stattgefunden hat, und eine still
       * falsche Auswertung.
       */
      expect(findLeadCaptureEntry(key), key).toBeNull()
    }
  })

  it('eine formularlose Herkunft hat bewusst KEINEN Textblock', () => {
    // Vier Texte für einen Kasten, den es nicht gibt, wären eine Requisite — beim nächsten Lesen
    // sähe der Eintrag wie eine platzierbare Erfassungsstrecke aus.
    for (const key of LEAD_SOURCE_KEYS_WITHOUT_FORM) {
      expect(entries[key], `LeadCapture.entries.${key} sollte es nicht geben`).toBeUndefined()
    }
  })
})

describe('Registry-Texte', () => {
  it('jeder Einstiegspunkt mit Formular hat alle vier Texte, und keiner ist leer', () => {
    for (const key of LEAD_CAPTURE_FORM_KEYS) {
      const eintrag = entries[key]
      expect(eintrag, `LeadCapture.entries.${key} fehlt in messages/de.json`).toBeDefined()
      for (const text of TEXTE) {
        expect(eintrag?.[text]?.trim(), `LeadCapture.entries.${key}.${text}`).toBeTruthy()
      }
    }
  })

  it('es gibt keinen verwaisten Texteintrag ohne Registry-Eintrag', () => {
    const bekannt = new Set<string>(LEAD_CAPTURE_FORM_KEYS)
    // Ein Textblock ohne Eintrag ist tot: er würde nie gerendert, aber beim nächsten Umbenennen
    // sähe es so aus, als sei der Text vorhanden.
    expect(Object.keys(entries).filter((key) => !bekannt.has(key))).toEqual([])
  })

  it('jedes von einem Eintrag erhobene Feld hat eine Beschriftung', () => {
    for (const key of LEAD_CAPTURE_FORM_KEYS) {
      for (const field of LEAD_CAPTURE_REGISTRY[key].fields) {
        expect(felder[field.key]?.trim(), `LeadCapture.fields.${field.key}`).toBeTruthy()
        // Und die Registry kennt seine Eingabeart — sonst renderte die Komponente ein Textfeld für
        // ein Datum.
        expect(LEAD_FIELDS[field.key], `LEAD_FIELDS.${field.key}`).toBeDefined()
      }
    }
  })

  it('jeder Eintrag erhebt mindestens die Adresse — ohne sie gäbe es nichts zuzustellen', () => {
    for (const key of LEAD_CAPTURE_FORM_KEYS) {
      const email = LEAD_CAPTURE_REGISTRY[key].fields.find((field) => field.key === 'email')
      expect(email, `Eintrag "${key}" ohne E-Mail-Feld`).toBeDefined()
      expect(email?.required, `Eintrag "${key}": E-Mail muss Pflicht sein`).toBe(true)
    }
  })
})
