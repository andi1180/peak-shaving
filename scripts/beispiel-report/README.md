# Beispiel-Report (Leadgen 4a)

Erzeugt `apps/web/public/beispiel-report/` aus einer gespeicherten Render-Anfrage: das PDF des
Profi-Reports mit „Gastronomiebetrieb, Wien" statt des Kundennamens, elf Seitenbilder (WebP, 1240 px)
und je ein Vorschaubild (160 px). Report-Code und Datenbank bleiben unverändert.

Herkunft: Analyse Müldür vom 08.10.2026 (Render-Anfrage `c967d744-281d-4aa8-bc95-8a07484d403a`),
Freigabe des Kunden für eine anonymisierte Veröffentlichung liegt vor.

## Neu erzeugen

1. Render-Anfrage lesen (nur lesend, Management-API; abgelaufene Anfragen bleiben in der Tabelle,
   nur der öffentliche Lesewrapper verweigert sie) und **ausserhalb des Repos** ablegen:

   ```sql
   select analysis_result, load_profile, report_input_meta
     from platform.report_render_requests
    where id = 'c967d744-281d-4aa8-bc95-8a07484d403a';
   ```

2. Playwright in einem Wegwerf-Ordner installieren (`npm i playwright`, `npx playwright install
   chromium-headless-shell`), dann:

   ```
   PLAYWRIGHT_MODULE=<ordner>/node_modules/playwright/index.js \
     node scripts/beispiel-report/erzeugen.mjs <render-request.json>
   ```

   Das Skript baut `apps/website` gegen einen lokalen Mock (Port 54999), der den einen RPC der
   Report-Seite mit der umbenannten Kopie beantwortet, lädt `/report/…` mit fester Uhr auf den
   08.10.2026 und speichert den Download. Braucht `pdftoppm` und `cwebp`.

3. Danach `pnpm --filter website build` ohne Mock-Umgebung, sonst bleibt der Mock-Build liegen.

## Anonymisierung prüfen

```
node scripts/beispiel-report/pruefen.mjs [--quelle <render-request.json>]
```

Prüft PDF-Text und Metadaten auf Kundenname (Varianten plus Name aus der Render-Anfrage),
Zählpunktnummer, fremde E-Mail-Adresse, Strassenadresse und Wiener PLZ ausser COOLiNs eigener;
Positivkontrolle „Gastronomiebetrieb, Wien". Ausgabe nur Kategorie und Trefferzahl.
