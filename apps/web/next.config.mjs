import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

/** @type {import('next').NextConfig} */
const nextConfig = {
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
    ]
  },
}

export default withNextIntl(nextConfig)
