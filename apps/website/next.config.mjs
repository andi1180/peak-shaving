/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace-Pakete `shared` (zod-Schemata + Contract-Typen) und `engine`
  // (Parser, §3.2/§3.3) werden aus dem TS-Source transpiliert — kein
  // Build-Order-Zwang zwischen Paketen.
  transpilePackages: ['shared', 'engine'],

  /*
   * B14-2: der Commit, mit dem diese Fassung gebaut wurde, als BAU-KONSTANTE.
   *
   * Er landet in jedem Analyse-Bündel und ist dort die belastbare Angabe darüber, WOMIT gerechnet
   * wurde — eine von Hand gepflegte Versionsnummer bleibt still stehen, ein Commit nicht. Vercel
   * stellt `VERCEL_GIT_COMMIT_SHA` beim Bauen bereit; `env` setzt den Wert fest ins Client-Bündel
   * ein (die Variable selbst ist nicht `NEXT_PUBLIC_`-präfixt und wäre sonst im Browser nicht
   * sichtbar).
   *
   * Fehlt der Wert (lokaler Lauf), bleibt er leer — der Code macht daraus einen ERKENNBAREN
   * Platzhalter, und der Upload im Admin-Bereich weist ihn ab. Ein leerer String liefe durch die
   * Datenbank und stünde 2027 als Angabe da, die keine ist.
   */
  env: {
    NEXT_PUBLIC_ENGINE_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? '',
  },

  experimental: {
    /*
     * Delta 9b-2a: der Rechnungs-Scan schickt eine PDF durch eine Server Action. Next begrenzt den
     * Rumpf einer Server Action standardmässig auf 1 MB; eine eingescannte Netzrechnung liegt
     * darüber, und die Ablehnung käme als undurchsichtiger Fehler statt als Satz.
     *
     * Der Wert liegt bewusst ETWAS ÜBER der grössten fachlichen Obergrenze: so entscheidet die
     * Anwendung über zu grosse Dateien und antwortet verständlich, statt dass die Plattform die
     * Anfrage vorher abschneidet. Dasselbe Muster wie in `apps/web` (B14-2) — dort mit 24 MB, weil
     * ein Jahres-Lastgang durchgeht.
     *
     * ⚠ B22c HAT DEN WERT VON 8 auf 12 MB ANGEHOBEN, und der Grund ist die Dokumentart: der
     * PV-Auslegungs-Scan lässt bis `MAX_PV_DESIGN_FILE_BYTES` = 8 MB durch
     * (`lib/pv-design-scan/ai-client.ts`), weil ein Planungsexposé zwei Dutzend Seiten mit
     * Diagrammen und Fotos hat statt ein bis wenige wie eine Rechnung. Bei 8 MB Plattformgrenze
     * läge die fachliche Grenze GENAU auf der Plattformgrenze, und eine Datei knapp darunter
     * scheiterte am Rumpf-Overhead statt an unserer Prüfung.
     *
     * ⚠ Für den Rechnungs-Scan ändert das NICHTS an der zulässigen Grösse: seine eigene Grenze
     * (`MAX_INVOICE_FILE_BYTES` = 6 MB) prüft seine Server Action unverändert selbst. Was sich
     * ändert, ist die ART der Ablehnung zwischen 8 und 12 MB — sie kommt jetzt als Satz aus der
     * Anwendung statt als Plattformfehler, also genau so, wie dieses Muster es vorsieht.
     */
    serverActions: { bodySizeLimit: '12mb' },
  },

  /*
   * B18-4: WER DIESEN RECHNER RAHMEN DARF — zum ersten Mal ausdrücklich entschieden.
   *
   * ── DER ZUSTAND VORHER: „zulässig, weil niemand es eingeschränkt hat" ──────────────────────────
   * coolin.at (`apps/web`) bettet diesen Rechner unter `/peak-shaving/kalkulator/rechner` per
   * `<iframe>` ein. Ob ein solches iframe etwas anzeigt, entscheidet ausschliesslich die GERAHMTE
   * Seite über ihre Response-Header — also diese App. Bis hierher gab es dafür nirgends im Repo eine
   * Zeile: kein `X-Frame-Options`, keine CSP, kein `vercel.json`, keine `middleware.ts` (in
   * `DEPLOYMENT.md` §1j als Befund festgehalten). Die Einbettung funktionierte, weil nichts sie
   * verbot — nicht, weil irgendwo eine Erlaubnis stand. Jede versehentlich hinzugefügte Härtung
   * (ein `X-Frame-Options: DENY` aus einem Projekt-Preset, ein Security-Header-Baustein) hätte sie
   * kommentarlos stillgelegt, und es gäbe keine bestehende Ausnahme, die jemand „vergessen" hätte.
   *
   * ── WARUM JETZT ────────────────────────────────────────────────────────────────────────────────
   * Mit dem Partner-Portal kommt ein DRITTER Rahmen-Ursprung dazu (`partner.coolin.at`, B18-1a).
   * Ein zweites Mal auf Zufall zu bauen hiesse, die Einbettung an drei Orten von der Abwesenheit
   * einer Konfiguration abhängig zu machen. Die Fassung hier ist die engere, die der
   * `DEPLOYMENT.md`-Nachtrag selbst vorgeschlagen hat, um `partner.coolin.at` ergänzt.
   *
   * ── ⚠ WAS DIESE RICHTLINIE NICHT TUT ──────────────────────────────────────────────────────────
   * Sie enthält AUSSCHLIESSLICH `frame-ancestors` und keine weitere Direktive. Eine vollständige CSP
   * (`default-src`, `script-src`, …) ist eine eigene, grössere Entscheidung mit realem Bruchrisiko
   * für den Rechner selbst; sie hier nebenbei mitzunehmen wäre der Umbau, den niemand angefordert
   * hat. `frame-ancestors` steht bewusst allein — eine CSP darf genau eine Direktive führen.
   *
   * BEIDE Domainformen sind gelistet (Apex UND `www`), weil coolin.at heute unter `www` ausgeliefert
   * wird, die Konfiguration aber den Apex nennt (offener Betriebspunkt, `apps/web/CLAUDE.md`,
   * B18-1a). Nur eine der beiden zu listen legte die Einbettung still, sobald die Richtung
   * umgestellt wird. `'self'` bleibt drin, damit der Rechner sich selbst rahmen kann (Vorschau,
   * Vercel-Deployment-URL im eigenen Ursprung) — ohne diesen Wert wäre auch das verboten.
   *
   * ⚠ EIN NICHT GELISTETER URSPRUNG WIRD AB JETZT ABGEWIESEN. Wer eine weitere Domain aufnimmt (eine
   * White-Label-Domain, eine Partner-Seite), trägt sie HIER ein — sonst zeigt das iframe dort einen
   * leeren Rahmen, und im Browser steht der Grund nur in der Konsole.
   *
   * `source: '/:path*'` deckt jede Route ab: gerahmt wird `/rechner`, aber eine Richtlinie, die nur
   * an einem Pfad hängt, wäre beim nächsten Einbettungsziel wieder nicht da.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value:
              "frame-ancestors 'self' https://coolin.at https://www.coolin.at https://partner.coolin.at",
          },
        ],
      },
    ]
  },
}

export default nextConfig
