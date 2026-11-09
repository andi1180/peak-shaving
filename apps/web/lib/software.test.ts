import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import messages from '@/messages/de.json'
import { SITE_ROUTES } from '@/lib/routes'
import {
  SOFTWARE_HREF,
  SOFTWARE_MODULES,
  metaDescriptionFromLead,
  softwareModuleHref,
  softwareModuleImage,
  softwareNavKey,
} from '@/lib/software'

const modules = messages.Software.Modules as Record<string, { title: string; lead: string }>

describe('Software-Module', () => {
  it('hat je Modul Texte, gleichlautendes Nav-Label und ein Bild in public/', () => {
    for (const mod of SOFTWARE_MODULES) {
      expect(modules[mod.key]?.title).toBeTruthy()
      expect((messages.Nav as Record<string, string>)[softwareNavKey(mod)]).toBe(
        modules[mod.key]!.title,
      )
      expect(fs.existsSync(path.join(process.cwd(), 'public', softwareModuleImage(mod)))).toBe(true)
    }
  })

  it('alle sechs Seiten sind indexierbare Routen', () => {
    const hrefs = [SOFTWARE_HREF, ...SOFTWARE_MODULES.map(softwareModuleHref)]
    for (const href of hrefs) {
      expect(SITE_ROUTES.find((r) => r.href === href)?.indexable).toBe(true)
    }
  })

  it('kürzt die Description an der Satzgrenze auf höchstens 160 Zeichen', () => {
    const leads = [messages.Software.Overview.lead, ...Object.values(modules).map((m) => m.lead)]
    for (const lead of leads) {
      const description = metaDescriptionFromLead(lead)
      expect(description.length).toBeLessThanOrEqual(160)
      expect(lead.startsWith(description)).toBe(true)
      expect(description).toMatch(/[.!?]$/)
    }
  })
})
