'use client'

import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// STUB (§5.1): erfasst die Pflichtfelder + Consent, PERSISTIERT ABER NICHTS.
// Der echte Lead-Pfad (leads-Tabelle, Consent-Versionierung, Routing) ist M3.
export function LeadDialog() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [funktion, setFunktion] = useState('')
  const [company, setCompany] = useState('')
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const canSubmit = Boolean(name && email && funktion && company && consent)

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="lg">Kostenloses Angebot anfordern</Button>
      </DialogTrigger>
      <DialogContent>
        {submitted ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="h-10 w-10 text-positive" />
            <DialogTitle>Danke!</DialogTitle>
            {/* [MARTIN: Copy] */}
            <DialogDescription>
              (Stub — es wurde nichts gespeichert. Der Lead-Pfad kommt in M3.)
            </DialogDescription>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Angebot anfordern</DialogTitle>
              <DialogDescription>
                {/* [MARTIN: Copy] */}
                Wir melden uns mit einem konkreten Angebot. Ihre Verbrauchsdaten bleiben in Ihrem
                Browser.
              </DialogDescription>
            </DialogHeader>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                if (canSubmit) setSubmitted(true)
              }}
            >
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="lead-name">Name *</Label>
                  <Input
                    id="lead-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="lead-funktion">Funktion / Rolle *</Label>
                  <Input
                    id="lead-funktion"
                    value={funktion}
                    onChange={(e) => setFunktion(e.target.value)}
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="lead-company">Unternehmen *</Label>
                  <Input
                    id="lead-company"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="lead-phone">Telefon</Label>
                  <Input id="lead-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <Label htmlFor="lead-email">E-Mail *</Label>
                  <Input
                    id="lead-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>
              <label className="flex items-start gap-2 text-sm text-text-muted">
                <Checkbox
                  checked={consent}
                  onCheckedChange={(v) => setConsent(v === true)}
                  className="mt-0.5"
                />
                {/* [MARTIN: Copy / rechtlich §5.1 — Einwilligungstext + Link Datenschutzerklärung] */}
                <span>
                  Ich willige ein, dass meine Kontaktdaten zur Angebotserstellung verarbeitet werden
                  (DSGVO). *
                </span>
              </label>
              <Button type="submit" disabled={!canSubmit}>
                Absenden
              </Button>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
