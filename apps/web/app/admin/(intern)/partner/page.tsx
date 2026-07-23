import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { Container, Num } from '@/components/ui/layout'
import {
  AdminError,
  AdminPanel,
  AdminSection,
  Pill,
  formatDate,
  formatDateTime,
} from '@/components/admin/ui'
import { ActionButton } from '@/components/admin/action-button'
import {
  CreatePartnerForm,
  LinkAccountForm,
  PartnerEditForm,
  ReferralLink,
} from '@/components/admin/partner-forms'
import { contactPersonLabel, readPartnerList } from '@/lib/admin/partners'
import { notifyPartnerAction, setPartnerActiveAction } from '@/lib/admin/partners-actions'
import { partnerHref } from '@/lib/leads/partner'
import { absoluteUrl } from '@/lib/site'

/*
 * `/admin/partner` — die Stammdaten der Fachbetriebe (B16-2, Modell A).
 *
 * ── FÜNF FÄHIGKEITEN ─────────────────────────────────────────────────────────────────────────────
 * Auflisten, anlegen, Anzeigename/Ansprechperson korrigieren, aktiv/inaktiv schalten — und seit
 * B16-4a: ein bestehendes Konto verknüpfen. Mehr kann die Datenbank nicht, und mehr soll diese
 * Seite nicht: Kein Einladungsversand, kein E-Mail-Template, kein Partner-Login und keine
 * Partner-eigene Sicht auf Leads (B16-4b/B16-5, hängt an B13). Genehmigt wird unter
 * „Partner-Anträge", nicht hier — dort steht der Antrag, um den es geht.
 *
 * ── WARUM ES DIE KONTOVERKNÜPFUNG GIBT ──────────────────────────────────────────────────────────
 * Ein von Hand angelegter Betrieb (Raymann, der erste reale Partner) hat kein Konto, und der
 * einzige andere Weg zu einem führt über einen genehmigten Antrag, den es für ihn nicht gibt und
 * nicht mehr geben kann — sein Kurz-Key ist vergeben, eine zweite Zeile wäre ein zweiter Partner.
 * Ohne diesen Weg könnte er das Partner-Portal aus B16-4b nie benutzen.
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
                        <dt className="text-caption text-text-muted">Konto</dt>
                        {/*
                          Die ADRESSE, nicht die Konto-Kennung: eine UUID sagt niemandem, WELCHES
                          Konto verknüpft ist. „Keins" ist ein echter Zustand — bei von Hand
                          angelegten Betrieben und nachdem jemand sein Konto gelöscht hat (der
                          Partner bleibt dabei bestehen, `on delete set null`).
                        */}
                        <dd className="text-text">{partner.account_email ?? '—'}</dd>
                      </div>
                      <div>
                        {/*
                          B16-4b: OB und WANN der Betrieb über seinen Portalzugang informiert
                          wurde. Ohne diese Angabe sehen „wurde informiert und meldet sich nicht"
                          und „hat nie eine Mail bekommen" identisch aus — ein Fachbetrieb, von dem
                          nichts kommt —, verlangen aber gegensätzliches Handeln.
                        */}
                        <dt className="text-caption text-text-muted">Benachrichtigt</dt>
                        <dd className="text-text">
                          {partner.notified_at ? formatDateTime(partner.notified_at) : 'nie'}
                        </dd>
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

                      {/*
                        B16-4b — „Benachrichtigung senden". Zwei reale Fälle: ein bei der
                        Genehmigung fehlgeschlagener Versand, und ein VON HAND angelegter Betrieb
                        (Raymann), der nie durch eine Genehmigung lief und dessen Konto erst
                        nachträglich verknüpft wurde — ohne diese Schaltfläche gäbe es für ihn
                        überhaupt keinen Weg, je von seinem Portal zu erfahren.

                        OHNE VERKNÜPFTES KONTO GIBT ES SIE NICHT: Die Mail verweist auf ein Portal
                        mit Anmeldung, und ohne Konto gibt es die nicht. An ihrer Stelle steht der
                        Grund im Klartext — ein deaktivierter Knopf ohne Erklärung liesse jemanden
                        raten, und ein gar nicht vorhandener sähe aus wie ein Fehler der Seite.
                        Dieselbe Prüfung steht in der Action und in der Datenbank; die hier ist die
                        sichtbare, die dort sind die wirksamen.
                      */}
                      {partner.user_id === null ? (
                        <p className="max-w-sm text-caption text-text-muted">
                          Benachrichtigung nicht möglich: An diesem Betrieb hängt kein Konto. Die
                          Mail verweist auf das Partner-Portal, für das man sich anmelden muss —
                          bitte zuerst unten ein Konto verknüpfen.
                        </p>
                      ) : (
                        <ActionButton
                          action={notifyPartnerAction}
                          fields={{ slug: partner.slug }}
                          label={
                            partner.notified_at ? 'Benachrichtigung erneut senden' : 'Benachrichtigung senden'
                          }
                          pendingLabel="Wird versendet …"
                          /*
                           * Rückfrage NUR beim zweiten Mal: Eine erste Benachrichtigung ist genau
                           * das, was der Betrieb erwartet. Eine zweite ist eine identische Mail in
                           * einem Postfach, in dem die erste schon liegt — der einzige Grund dafür
                           * ist ein Zustellproblem, und das soll eine bewusste Entscheidung sein.
                           */
                          confirm={
                            partner.notified_at
                              ? `„${partner.display_name}" wurde am ${formatDateTime(partner.notified_at)} bereits benachrichtigt. Dieselbe Mail noch einmal senden?`
                              : undefined
                          }
                          showSuccess
                        />
                      )}
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

                    {/*
                      Das Verknüpfungsformular erscheint NUR, solange kein Konto hängt. Eine
                      bestehende Zuordnung lässt sich weder überschreiben noch lösen (B16-4a) — ein
                      Formular, das in beiden Fällen dasteht, versprächte eine Fähigkeit, die es
                      nicht gibt, und der Klick käme als Ablehnung zurück.
                    */}
                    {partner.account_email === null && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-small text-accent underline decoration-accent underline-offset-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          Konto verknüpfen
                        </summary>
                        <LinkAccountForm slug={partner.slug} />
                      </details>
                    )}
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
