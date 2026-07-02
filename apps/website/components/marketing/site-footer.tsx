export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto max-w-6xl px-4 py-10 text-sm text-text-muted sm:px-6">
        <p className="max-w-2xl">
          {/* [MARTIN: Copy / rechtlich §5.1 — finaler Text + Versionierung consent_version] */}
          Ihre Verbrauchsdaten werden ausschließlich in Ihrem Browser zur Berechnung verwendet und
          nicht übertragen. Kontaktdaten speichern wir nur mit Ihrer ausdrücklichen Einwilligung.
        </p>
        <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
          {/* [MARTIN: Copy] Rechtliche Links */}
          <span>Impressum</span>
          <span>Datenschutz</span>
          <span>© COOLiN GmbH</span>
        </div>
      </div>
    </footer>
  )
}
