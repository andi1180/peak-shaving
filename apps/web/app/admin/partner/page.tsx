import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container, Num } from '@/components/ui/layout'
import { AdminError, AdminPanel, AdminSection, Pill, formatDate } from '@/components/admin/ui'
import { ActionButton } from '@/components/admin/action-button'
import {
  CreatePartnerForm,
  PartnerEditForm,
  ReferralLink,
} from '@/components/admin/partner-forms'
import { contactPersonLabel, readPartnerList } from '@/lib/admin/partners'
import { setPartnerActiveAction } from '@/lib/admin/partners-actions'
import { partnerHref } from '@/lib/leads/partner'
import { absoluteUrl } from '@/lib/site'

/*
 * `/admin/partner` — die Stammdaten der Fachbetriebe (B16-2, Modell A).
 *
 * ── GENAU VIER FÄHIGKEITEN ───────────────────────────────────────────────────────────────────────
 * Auflisten, anlegen, Anzeigename/Ansprechperson korrigieren, aktiv/inaktiv schalten. Mehr kann die
 * Datenbank nicht (B16-1 legt genau vier Wrapper an), und mehr soll diese Seite nicht: Kein
 * Einladungsversand, kein E-Mail-Template, keine Genehmigungsstrecke (das ist B16-3/B16-4), kein
 * Partner-Login und keine Partner-eigene Sicht auf Leads (B16-5/B16-6, hängt an B13).
 *
 * ── ES GIBT KEIN LÖSCHEN, UND ZWAR NICHT AUS VERSEHEN ───────────────────────────────────────────
 * `platform.partners` hat für NIEMANDEN ein `delete`-Grant. An einem Fachbetrieb hängen die bereits
 * erfolgten Zuordnungen; ein gelöschter Partner machte sie unerklärbar — in `platform.leads` stünde
 * ein Slug, zu dem es keine Zeile mehr gibt. Stilllegung über `is_active` ist der vorgesehene Weg,
 * und sie ist umkehrbar.
 *
 * ── DER LINK STEHT FERTIG DA ────────────────────────────────────────────────────────────────────
 * Er wird SERVERSEITIG aus `absoluteUrl` gebildet — es gibt in dieser App genau eine Basis-URL
 * (`lib/site.ts`). Von Hand zusammengesetzt landete früher oder später ein Link mit falscher Domain
 * oder falschem Pfad in einer Serienmail an hunderte Bestandskunden, und zurückholen lässt er sich
 * nicht.
 *
 * ── KARTEN STATT TABELLE ────────────────────────────────────────────────────────────────────────
 * Jede Zeile trägt ein eigenes Bearbeitungsformular und einen eigenen Schalter — und verschachtelte
 * Formulare gibt es in HTML nicht (dieselbe Einschränkung, die in B14-2 die Lead-Suche zu einem
 * eigenen GET-Formular gemacht hat). Karten lösen das, ohne die Beschriftungen zu verstecken.
 */

export const dynamic = 'force-dynamic'

/** Neutral wie im Layout: der Tab-Titel darf nicht verraten, dass es hier etwas zu holen gibt. */
export const metadata: Metadata = {
  title: 'COOLiN ENERGY',
  robots: { index: false, follow: false },
}

export default async function AdminPartnersPage() {
  if (!(await isCurrentUserAdmin())) return null

  const supabase = await createClient()
  const res = await supabase.rpc('admin_list_partners')
  if (res.error) console.error('[admin/partners] admin_list_partners:', res.error)

  const partners = readPartnerList(res.data)

  return (
    <Container className="py-10 sm:py-14">
      <header className="border-b border-line pb-6">
        <h1 className="text-h2 text-ink">Partner</h1>
        <p className="mt-2 max-w-prose text-body text-text-muted">
          Fachbetriebe, die ihre Bestandskunden über einen personalisierten Link an COOLiN verweisen.
          Jeder Betrieb bekommt einen eigenen Empfehlungslink; Anfragen darüber werden ihm
          zugeordnet. Der Kurz-Key im Link ist nach dem Anlegen unveränderlich — er steht in
          verschickten Mails.
        </p>
      </header>

      <AdminSection
        id="partner-neu"
        title="Fachbetrieb anlegen"
        description="Der Kurz-Key wird beim Anlegen festgelegt und lässt sich danach nicht mehr ändern. Ein bereits vergebener Kurz-Key wird nicht überschrieben."
      >
        <AdminPanel>
          <CreatePartnerForm />
        </AdminPanel>
      </AdminSection>

      <AdminSection
        id="partner-liste"
        title="Alle Fachbetriebe"
        description={
          '„Leads“ zählt alle über diesen Betrieb entstandenen Anfragen — anonymisierte ' +
          'ausdrücklich mit, damit die Zahl nach 24 Monaten nicht schrumpft. „Kunden“ zählt davon ' +
          'unabhängig die, aus denen ein Kunde wurde.'
        }
      >
        {partners === null ? (
          <AdminError>
            Die Partnerliste konnte nicht geladen werden. Das ist NICHT dasselbe wie „es gibt keine
            Fachbetriebe" — bitte die Seite neu laden.
          </AdminError>
        ) : partners.length === 0 ? (
          <AdminPanel>
            <p className="text-small text-text-muted">
              Noch kein Fachbetrieb angelegt. Der erste entsteht über das Formular oben.
            </p>
          </AdminPanel>
        ) : (
          <ul className="flex flex-col gap-4">
            {partners.map((partner) => {
              const contact = contactPersonLabel(partner)
              const url = absoluteUrl(partnerHref(partner.slug))

              return (
                <li key={partner.slug}>
                  <AdminPanel>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h3 className="text-h4 text-ink">{partner.display_name}</h3>
                        <p className="mt-1 text-caption text-text-muted">
                          Kurz-Key <span className="font-medium text-text">{partner.slug}</span> ·
                          angelegt {formatDate(partner.created_at)}
                        </p>
                      </div>
                      {partner.is_active ? (
                        <Pill tone="positive">aktiv</Pill>
                      ) : (
                        <Pill tone="neutral">stillgelegt</Pill>
                      )}
                    </div>

                    <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-small">
                      <div>
                        <dt className="text-caption text-text-muted">Ansprechperson</dt>
                        <dd className="text-text">{contact ?? '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-caption text-text-muted">Leads</dt>
                        <dd className="text-text">
                          <Num>{partner.lead_count}</Num>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-caption text-text-muted">davon Kunden</dt>
                        <dd className="text-text">
                          <Num>{partner.customer_count}</Num>
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-4">
                      <p className="text-caption text-text-muted">
                        Empfehlungslink{' '}
                        {!partner.is_active && (
                          <span className="text-text">
                            — wirkt derzeit NICHT (der Betrieb ist stillgelegt, die Seite antwortet
                            mit 404)
                          </span>
                        )}
                      </p>
                      <div className="mt-1.5">
                        <ReferralLink url={url} />
                      </div>
                    </div>

                    <div className="mt-5 flex flex-wrap items-start gap-4 border-t border-line pt-4">
                      <ActionButton
                        action={setPartnerActiveAction}
                        fields={{ slug: partner.slug, isActive: String(!partner.is_active) }}
                        label={partner.is_active ? 'Stilllegen' : 'Reaktivieren'}
                        pendingLabel={partner.is_active ? 'Wird stillgelegt …' : 'Wird aktiviert …'}
                        /*
                         * Rückfrage NUR beim Stilllegen: Sie beendet die Wirkung eines Links, der
                         * bereits in fremden Postfächern liegt — das ist kein An/Aus-Schalter, den
                         * man einfach zurückschaltet, sondern eine Ansage nach aussen. Das
                         * Reaktivieren stellt nur wieder her.
                         */
                        confirm={
                          partner.is_active
                            ? `„${partner.display_name}" stilllegen? Der Empfehlungslink führt danach ins Leere (404), und neue Anfragen werden diesem Betrieb nicht mehr zugeordnet. Bereits erfolgte Zuordnungen bleiben erhalten.`
                            : undefined
                        }
                        showSuccess
                      />
                    </div>

                    {/*
                      `<details>` statt eines Dialogs: Das Bearbeiten ist der seltene Fall, und ein
                      Aufklappen funktioniert ohne JavaScript. Dieselbe Mechanik wie die Rückfrage
                      vor dem Anonymisieren eines Leads (B1-3).
                    */}
                    <details className="mt-4">
                      <summary className="cursor-pointer text-small text-accent underline decoration-accent underline-offset-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        Stammdaten bearbeiten
                      </summary>
                      <PartnerEditForm partner={partner} />
                    </details>
                  </AdminPanel>
                </li>
              )
            })}
          </ul>
        )}
      </AdminSection>
    </Container>
  )
}
