# Sensitivitätsrechnungen Ladesteuerung (Oktober 2026)

> **Dokumenttyp:** Kurzfassung von Messergebnissen und der darauf beruhenden Entscheidung vom
> 08.10.2026. **Es ist kein Bau-Schritt** — an Engine, Kalkulator, Report, Snapshots und
> Golden-Fällen ist nichts geändert.
>
> **⚠ Herkunft der Zahlen:** Alle Zahlen stammen aus einem Wegwerf-Harness im Scratchpad, **nicht
> im Repo**. Basis ist das Jahr (Jahreslauf wie die Engine) bzw. ausdrücklich „hochgerechnet“, wo
> so benannt. Vor jeder Auswertung wurde der Harness **bitgenau gegen die Report-Werte**
> kontrolliert.
>
> **Messbasis:**
> - Müldür: anonymisierte Fixture, 157 Tage März–August 2026, Jahresbasis.
> - Bäckerei: Golden-Fall, **synthetisch**, 365 Tage.
> - Preise und Batteriekatalog: Cloud-Stand 08.10.2026; Installationspauschale 4.900 €.
> - `ENGINE_VERSION` 1.8.0-mvp.
>
> **Bezug:** `Pflichtenheft_Vorausschauende_Ladesteuerung.md`, `Pflichtenheft_Kalkulator_MVP.md`
> (§3.6 Simulation, §3.6.1 Kapp-Suche). Für Reihenfolge und Umfang bleibt `Fahrplan_2026.md`
> maßgeblich.

---

## 1. Kappung gegen Ladesteuerung

Müldür, Dyness Stack 100 30,72 kWh mit Solinteg MHT-15K-40:

| Betriebsweise | €/Jahr |
|---|---|
| Kombination (Ladesteuerung 684 + Kappung 1.415) | 2.099 |
| Nur Kappung | 1.317 |
| Nur Ladesteuerung, ohne Deckel | 1.256 |

- Die Ladesteuerung ohne Deckel hebt die Summe der Monatsspitzen von 513 auf 623 kW — **Strafe
  863 €/a**.
- Die Ladesteuerung kostet die Kappung **0 €**; die Kappung kostet Energie **572 €/a**.
- Kipp-Punkt Leistungspreis (nur Kappung gegen nur Ladesteuerung): ca. **79 €/kW·a** (Dyness) bzw.
  **89 €/kW·a** (Retrofit S). Müldür liegt bei **82,92 €/kW·a**.

## 2. Hebel der Ladesteuerung

Dyness, Jahresbasis, €/a:

| Hebel | Wirkung |
|---|---|
| Preisspreizung ± 50 % | ± 500 (Basis) |
| Wirkungsgrad 0,88 → 0,94 | + 163 |
| Prognosequalität (Vorabend gegen Rückblick) | nur + 16 (bei unregelmässiger Last 5–36) |
| Freie Kapazität ohne Reserve | + 572 Energie |

## 3. Schwellenregel

Die Engine wählt je Monat die **niedrigste haltbare Kappschwelle**. Das kostet Ertrag bei grossen
Geräten (ab etwa 38 kWh).

Müldür, Rückblick-Variante:

- Retrofit L (63 kWh) mit Offset + 12 kW: **Netto 10 Jahre 12.444 €** statt 597 €.
- Dyness 30,72 mit + 2 kW: + 48 €/a.
- Retrofit S: 0.
- Offset je Monat: zusätzlich + 16 bis + 379 €/a.

**Muster:** Im Winter liegt der Offset etwa bei 0, im Frühjahr und Sommer hoch. Das ist ein
**Preis-, kein Lasteffekt**.

## 4. Echtbetrieb ohne Rückblick

Schwelle **Vormonat + 2 kW** und Reserve nach dem **Wochentagsmuster** (P2: 90. Perzentil der
letzten 4 gleichen Wochentage):

- Es kommen **80–94 %** des Leistungs-Anteils an (Offset 0) bzw. **71–86 %** (optimiert).
- Gegenüber der heutigen Engine mit Rückblick sind es **58–81 %** (Müldür) und **76–91 %**
  (Bäckerei).

Weitere Befunde:

- **Eine Reserve aus der Vorabend-Prognose taugt nicht (25–53 %): Die Reserve darf nicht aus der
  Prognose gebildet werden.**
- Perzentil (0,75–1,0) und Historie (4–8 Wochen) sind robust; der Unterschied beträgt höchstens
  etwa 5 Prozentpunkte.
- Ein Zeitfenster ist **kundenspezifisch**: Bäckerei + 148 bis + 237 €/a, Müldür verschlechtert.

## 5. Train/Test

**Müldür:** Die Offsets halten zwischen Frühling und Sommer.

**Über die Jahreszeit** ist das nur an der **synthetischen** Bäckerei prüfbar:

- Für die fünf Standardgeräte ist Offset 0 überall optimal.
- Bei grossen Geräten liegt das Sommer-Optimum bei + 15 bis + 20 kW, das Winter-Optimum bei + 6.
- Ein Sommer-Offset kostet im Winter bis 575 €/a und kann **schlechter sein als 0** (bis
  − 487 €/a).
- **Es braucht einen saisonalen Offset.**

**⚠ Übertragbarkeit offen:** Echte Kunden mit Winter und Leistungspreis über 0 gibt es im Repo
nicht. Der Müldür-Zähler läuft erst seit 28.03.2026; STCE und Urbanz haben keinen Leistungspreis.

## 6. Entscheidung 08.10.2026

**Kalkulator und Engine werden NICHT umgebaut.** Gründe:

1. Der Kalkulator soll abbilden, was der Regler real tut — und es gibt noch keinen Regler mit
   Offset und rückblickfreier Reserve.
2. Die Evidenz stammt nur von einem echten Kunden ohne Winter und einem synthetischen Fall.
3. Ein Umbau verlangt `ENGINE_VERSION` 1.9.0, neue Golden-Fälle und etwa die zehnfache Laufzeit im
   Wizard.

**Die Empfehlung für Müldür bleibt der Dyness Stack 100 30,72 kWh mit Solinteg MHT-15K-40.**

**Wiedervorlage**, sobald (i) Müldür einen Winter geliefert hat **oder** (ii) ein weiterer echter
Kunde mit Wintermonaten und Leistungspreis über 0 vorliegt, **UND** (iii) der Regler (Schwelle,
Reserve, Offset) festgelegt ist.

## 7. Regelgrössen für den Echtbetriebs-Regler (Schritt 2)

| Grösse | Festlegung |
|---|---|
| Schwelle | Vormonat + 2 kW, mit Nachführung bei Überschreitung |
| Offset | saisonal: Winter etwa 0, Sommer nach Kapazitätsklasse; bei Unsicherheit der niedrigere |
| Reserve | P2 |
| Zeitfenster | nur nach Stabilitätsprüfung (Form offen) |

**Daten, die der Regler braucht:**
- Live-Netzbezug (15 Minuten), Ladestand (SoC) und das laufende Monatsmaximum.
- Mindestens 8 Wochen 15-Minuten-Historie (idealerweise das Vorjahr).
- Day-Ahead-Preise.

## 8. Zielgruppe

- **Reine Ladesteuerung** ist sinnvoll für Kunden ohne oder mit niedrigem Leistungspreis (unter
  etwa 50 €/kW·a), mit grossem Speicher oder mit Bestandsspeicher (Investition 0).
- Bei Müldür-ähnlichen Kunden trägt die Kappung (1.415 €/a) mehr als die Ladesteuerung
  (684 €/a).

## 9. Offene Befunde

- Die Schwellensuche fällt zugunsten der Kappung aus (Retrofit S mit 15 kW war bit-gleich zum
  Dyness).
- Die Mischbasis auf Seite 17 ist seit PR #450 behoben.
- Kappung Weg 5 (1.414 €) gegen Jahreskapitel (1.415 €): zwei Rechenläufe.
- Der Preisstand der Pauschale „Gewerbe 110“ (24.09.2026) trägt die Änderung vom 05.10.2026 nicht.
