// Platzhalter-Seite — verifiziert nur, dass Tailwind-Theme + Fonts greifen.
// Der öffentliche 4-Schritt-Rechner (§5) kommt in einem späteren Prompt.
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-4xl font-semibold text-ink">Peak Shaving Kalkulator</h1>
      <p className="text-lg font-medium text-accent">Coming Soon</p>
      <p className="max-w-md text-sm text-text-muted">
        Fundament steht. Die Rechen-Engine (§3) folgt.
      </p>
    </main>
  )
}
