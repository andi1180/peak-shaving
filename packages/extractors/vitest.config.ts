import { defineConfig } from 'vitest/config'

/**
 * Der erste Testlauf dieses Pakets (D3). Die vier KI-Anbindungen sind bewusst ohne Tests geblieben —
 * sie sind dünne Adapter um Prompts, deren Zusagen in `packages/shared` geprüft werden. Der
 * Analyse-Einstieg ist etwas anderes: er verkettet Parser, Abbildung und Rechenkern, und genau
 * diese Kette lässt sich nur hier messen (`apps/web` kennt `engine` nicht).
 */
export default defineConfig({
  test: {
    // Ein Lauf parst einen synthetischen Lastgang und rechnet die volle Kette — wie in `engine`.
    testTimeout: 30_000,
  },
})
