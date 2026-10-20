# Startseite: Profi-Report-Teaser und FAQ (Vorlage Schritt 7)

Stand: 20.10.2026, freigegeben von Andreas.
Visuelle Vorlage: `docs/prototypes/startseite-profi-teaser-faq.html`

## Reihenfolge der Startseite

1. Hero + Animation (bestehend)
2. Schnellcheck (bestehend)
3. **Profi-Report-Teaser (neu)**
4. Vorgehen (bestehend)
5. Peak Shaving (bestehend)
6. Branchen (bestehend)
7. Wissen (bestehend, Teasertext „Entwurf" korrigieren)
8. Von der Analyse bis zur Umsetzung (bestehend)
9. Partner-Banner (bestehend)
10. **FAQ (neu)**
11. In 30 Minuten klären wir … (bestehend, bleibt letzter Abschnitt)
12. Fußzeile: Link „Referenzen" entfernt, „Der Kalkulator" → „Schnellcheck"

---

## 3. Profi-Report-Teaser

**Gestaltung**
- Vollflächig dunkelblau (`--navy` #18336f), hebt sich klar vom Rest der Seite ab.
- Desktop zweispaltig: links Text, rechts Stapel aus drei echten Report-Seiten (Seite 1 Deckblatt hinten links, Seite 2 „Auf einen Blick" vorne Mitte, Seite 11 „Empfehlung" hinten rechts), leicht gedreht, mit Schatten. Bilder aus `public/beispiel-report/`.
- Mobil einspaltig: Text oben, Stapel darunter, Buttons volle Breite.
- Farben auf Dunkelblau: Text weiß; Fließtext #c3cde3; Überzeile und Nummern #7ee0d4; Trennlinien weiß 18 % Deckkraft. Als DESIGN.md-Ausnahme dokumentieren.

**Texte**

Überzeile: PROFI-REPORT

Überschrift: **Die genaue Antwort für Ihren Betrieb**

Einleitung: Wir rechnen mit Ihrem echten Lastgang, Viertelstunde für Viertelstunde, mit Ihren Netztarifen und mit echten Speichern.

1. **Wie viel kann ich sparen?**
   Jeder Weg mit eigener Zahl: Tarif, Börsenpreis, Speicher mit Ladesteuerung, Kappung der Spitzen.
2. **Welcher Speicher passt?**
   Echte Geräte an Ihrem Lastgang verglichen. Größer ist nicht automatisch besser.
3. **Wann rechnet es sich?**
   Investition, Ersparnis pro Jahr, Amortisation vor und nach Steuern.

Preis: **495 €** · Einführungspreis bis 31.12.2026, zzgl. USt. (aus zentraler Einstellung)

Buttons:
- „Beispiel-Report ansehen" (hell, primär) → `/profi-report#beispiel`
- „Profi-Report anfragen" (Umriss) → `/profi-report#anfrage`

Etikett am Seitenstapel: Echter Bericht, anonymisiert · 23 Seiten

Messung: Profi-Report-Klick-Ereignis mit `position: home_teaser`.

---

## 10. FAQ

**Gestaltung**
- Heller Hintergrund (`--surface-alt`), Desktop zweispaltig: links Überzeile, Überschrift, Hinweis; rechts aufklappbare Fragen (erste offen). Mobil einspaltig.
- FAQPage-Strukturdaten, exakt mit sichtbarem Text.

Überzeile: HÄUFIGE FRAGEN
Überschrift: **Gut zu wissen**
Hinweis: Ihre Frage ist nicht dabei? Schreiben Sie uns an energy@coolin.at.

**Warum zahle ich für Lastspitzen, wenn ich gleich viel Strom verbrauche?**
Betriebe mit Leistungsmessung zahlen dem Netzbetreiber neben der Strommenge einen Leistungspreis. Er richtet sich nach den Viertelstunden mit dem höchsten Bezug, in Österreich Monat für Monat, in Deutschland meist über das ganze Jahr. Eine einzige kurze Spitze kann so die Netzkosten eines ganzen Monats oder Jahres bestimmen.
*(Faktenprüfung gegen Primärquelle vor Einbau)*

**Lohnt sich das für meinen Betrieb?**
Am ehesten ab rund 100.000 kWh Jahresverbrauch und wenn auf Ihrer Netzrechnung ein Leistungspreis steht. Der Schnellcheck oben zeigt sofort, was Ihre Lastspitze im Jahr kostet. Die genaue Antwort gibt der Profi-Report. Rechnet sich ein Speicher bei Ihnen nicht, steht genau das drin.

**Was ist ein Lastgang und woher bekomme ich ihn?**
Der Lastgang zeigt Ihren Stromverbrauch in Viertelstundenwerten. Betriebe mit Leistungsmessung bekommen ihn bei ihrem Netzbetreiber, meist als Datei im Kundenportal. Wenn Sie nicht wissen, wo, helfen wir Ihnen.

**Was ändert sich 2027 in Österreich?**
Ab 1. Jänner 2027 gilt die neue Verordnung über die Netzentgelte (BGBl. II Nr. 299/2026). Auf Netzebene 7 wird die Leistung künftig nach dem Monatshöchstwert verrechnet, umgestellt wird bis spätestens 30. Juni 2028. Damit wird die Lastspitze auch für viele kleinere Betriebe zum Kostenfaktor. [Mehr im Wissen-Artikel](/wissen/leistungstarif-2027)
*(Faktenprüfung gegen BGBl. II Nr. 299/2026 vor Einbau)*

**Gilt das auch in Deutschland?**
Ja. Der Schnellcheck rechnet mit deutschen Netzentgelten, und den Profi-Report erstellen wir auch für Betriebe in Deutschland. Wie hoch der Leistungspreis ist, hängt dort stark von der Benutzungsdauer ab: unter 2.500 Stunden im Jahr niedrig, darüber deutlich höher.

**Muss ich nach dem Report einen Speicher kaufen?**
Nein. Der Profi-Report ist eine unabhängige Auswertung. Wir besprechen ihn mit Ihnen, danach entscheiden Sie in Ruhe. Die Umsetzung übernehmen auf Wunsch Fachbetriebe aus unserem Partnernetz.

---

## Konsistenz (im selben Schritt)

- SNE-G-V überall als kundgemacht (12.10.2026, BGBl. II Nr. 299/2026), kein „Entwurf" mehr.
- Preisangabe 495 € / bis 31.12.2026 / zzgl. USt. gleichlautend auf Startseite, /profi-report, Schnellreport-PDF, Mails.
- Seite „Referenzen" entfernt, 301 auf `/`.
- Öffentliche Kalkulator-Links → „Schnellcheck" (`/#schnellcheck`); Portal, Admin, Einbettung unverändert.
