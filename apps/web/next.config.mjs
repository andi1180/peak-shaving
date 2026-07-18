import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace-Paket `tariff-monitor` (T1, Haushalts-Energiemonitor-Engine) wird
  // aus dem TS-Source transpiliert — Muster wie `apps/website`s `shared`/`engine`.
  // Es ist rein & isomorph (kein I/O), läuft daher unverändert im Browser (T3).
  transpilePackages: ['tariff-monitor'],
  /**
   * 301-Redirects der alten `.html`-Pfade (Pflichtenheft §6.4).
   *
   * Der Bestand war EINE Scroll-Seite; ihre einzigen echten Unterseiten waren
   * diese drei. Sie stehen hier, weil sie in `reference/coolin-legacy.html`
   * NACHWEISLICH verlinkt waren (`href="/impressum.html"`, `href="/datenschutz.html"`,
   * `action="/danke.html"`) — nicht, weil sie plausibel klingen. Ein Redirect für
   * einen Pfad, den es nie gab, wäre toter Code, den niemand je widerlegen kann.
   *
   * `statusCode: 301` UND NICHT `permanent: true` — der Unterschied ist gemessen,
   * nicht kosmetisch: Next macht aus `permanent: true` ein **308**, kein 301
   * (belegt: `/impressum.html` lieferte damit „308 -> /impressum"). Für Google
   * sind beide gleichwertig (beide vererben das Ranking), aber:
   *
   *   – 301 ist der universell verstandene Dauer-Redirect; 308 ist von 2015 und
   *     wird von alten Clients, Proxies und Link-Checkern nicht überall sauber
   *     behandelt. Genau solche Uralt-Clients folgen aber den Links, um die es
   *     hier geht.
   *   – 308 erhält die HTTP-Methode, 301 stuft auf GET herab. Das ist für
   *     `/danke.html` relevant: Es war das POST-Ziel des alten Netlify-Formulars.
   *     Ein POST aus einer noch im Browser liegenden alten Seite würde per 308
   *     als POST auf `/kontakt` weitergereicht — dort gibt es nur eine Seite,
   *     also 405. Per 301 wird daraus ein GET, und der Absender landet auf dem
   *     Formular.
   *
   * `permanent` und `statusCode` schließen sich in Next gegenseitig aus.
   *
   * NICHT DABEI — jeweils mit Grund:
   *
   *   /coolin.html — §6.4 nennt diesen Pfad, es gibt ihn aber nicht. Die alte
   *     Startseite lief unter „/", belegt durch ihr eigenes
   *     `<meta property="og:url" content="https://coolin.at/">`. Und „/" liefert
   *     bereits die neue Startseite aus. Ein Redirect von `/coolin.html` würde
   *     eine URL erfinden, um sie umzuleiten.
   *
   *   #leistungen, #peak-shaving, #vorgehen, #ergebnisse, #kontakt — die
   *     Sprungmarken der alten Scroll-Seite. Fragmente werden vom Browser NICHT
   *     an den Server geschickt; sie sind serverseitig unsichtbar und technisch
   *     nicht umleitbar. `/#leistungen` landet auf der neuen Startseite, der
   *     Anker läuft ins Leere — mehr ist ohne Client-JS nicht möglich und wäre
   *     für ein paar alte Deep-Links den Aufwand nicht wert.
   *
   *   /favicon.png, /logo-coolin-energy.png — Bilder, keine Seiten. §6.4 will
   *     Ranking und Backlinks retten; die hängen an Dokumenten, nicht an Assets.
   */
  async redirects() {
    return [
      { source: '/impressum.html', destination: '/impressum', statusCode: 301 },
      { source: '/datenschutz.html', destination: '/datenschutz', statusCode: 301 },
      /*
       * Die Danke-Seite des alten Netlify-Formulars. Ein Pendant hat der Neubau
       * bewusst nicht — das Formular meldet den Erfolg an Ort und Stelle (§5.5).
       * `/kontakt` ist damit die Seite, die dieselbe Aufgabe erfüllt; ein
       * Redirect auf „/" würde den Besucher mit seinem Anliegen allein lassen.
       */
      { source: '/danke.html', destination: '/kontakt', statusCode: 301 },

      /*
       * BRANCHEN-NEUORDNUNG (Prompt 25). Dieselbe Konvention wie oben:
       * `statusCode: 301`, nicht `permanent: true` (das ergäbe ein 308).
       *
       * Anders als die `.html`-Pfade oben sind das URLs, die WIR selbst
       * ausgeliefert und intern verlinkt haben — sie stehen im Index, in
       * Lesezeichen und in der bereits eingereichten sitemap. Ohne Redirect
       * wären es 404er auf Seiten, die es gab.
       *
       * ZWEI ZIELE, zwei Fälle — die Unterscheidung ist inhaltlich, nicht
       * kosmetisch:
       *
       *   – Hotellerie/Gastronomie sind zu EINER Seite verschmolzen. Ihr Inhalt
       *     lebt dort weiter, also zeigt der Redirect auf die Nachfolgeseite:
       *     Ranking und Backlinks gehen an die Seite, die dasselbe Thema trägt.
       *
       *   – Bäckerei und Handel haben KEINEN Nachfolger. Sie auf eine der neuen
       *     Branchen zu leiten wäre ein Fehler, den Google „soft 404" nennt: Ein
       *     Redirect behauptet „das hier ist jetzt die Adresse dafür" — ein
       *     Bäckerei-Sucher auf /branchen/handwerk zu schicken behauptet etwas
       *     Falsches. Die Übersicht ist die ehrliche Antwort: Sie zeigt, was es
       *     stattdessen gibt, und der Besucher entscheidet.
       */
      {
        source: '/branchen/hotellerie',
        destination: '/branchen/hotellerie-gastronomie',
        statusCode: 301,
      },
      {
        source: '/branchen/gastronomie',
        destination: '/branchen/hotellerie-gastronomie',
        statusCode: 301,
      },
      { source: '/branchen/baeckerei', destination: '/branchen', statusCode: 301 },
      { source: '/branchen/handel', destination: '/branchen', statusCode: 301 },
    ]
  },
}

export default withNextIntl(nextConfig)
