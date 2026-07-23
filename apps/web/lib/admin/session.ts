import 'server-only'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

/**
 * Die Adresse des angemeldeten Kontos — für die Kennzeichnung im Admin-Rahmen (B17).
 *
 * ── WARUM EIGENES MODUL UND NICHT EINE ERWEITERUNG VON `guard.ts` ────────────────────────────────
 * `isCurrentUserAdmin` beantwortet GENAU EINE Frage („darf dieses Konto hier arbeiten?") und ist die
 * Stelle, an der der Zugang des gesamten Bereichs entschieden wird. Sie um einen Rückgabewert für
 * eine reine ANZEIGE zu erweitern, hiesse, an der Zugangsprüfung zu arbeiten, um eine Zeile im
 * Kopfbereich zu füllen — die teuerste denkbare Stelle für einen beiläufigen Eingriff. Sie bleibt
 * deshalb unverändert.
 *
 * Der Preis ist ein zweiter `getUser()`-Aufruf je Seitenaufruf (ein Rundlauf zum Auth-Server; die
 * Sitzung wird dabei erneut geprüft, nicht nur aus dem Cookie gelesen). Für einen Bereich mit einer
 * Handvoll Konten ist das nachrangig gegenüber der Unversehrtheit der Schranke. `cache()` fasst
 * MEHRFACHE Aufrufe innerhalb DERSELBEN Anfrage zusammen — dedupliziert also gegen sich selbst,
 * nicht gegen den Guard.
 *
 * Gibt `null` zurück, statt umzuleiten: über den Zugang entscheidet allein der Guard. Ein zweiter
 * Ort, der umleiten kann, wäre ein zweiter Ort, an dem sich das Verhalten des Bereichs ändern lässt.
 */
export const currentUserEmail = cache(async (): Promise<string | null> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user?.email ?? null
})
