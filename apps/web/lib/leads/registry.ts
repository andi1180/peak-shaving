/**
 * DIE REGISTRY DER EINSTIEGSPUNKTE (B3-2, Fahrplan_2026.md B3).
 *
 * Fahrplan B3 verlangt „EIN Backend, VIELE kontextspezifische Einstiegspunkte; kein überall gleiches
 * Formular". Genau das ist diese Datei: je Einstiegspunkt steht hier fest, welchen ZWECK er erhebt,
 * WELCHE FELDER er erfragt (mit Pflichtkennzeichen) und WELCHE TEXTE er trägt.
 *
 * ── WARUM EIN MODUL UND NICHT ZWEI ───────────────────────────────────────────────────────────────
 * Dieselbe Definition speist die DARSTELLUNG im Client (`components/leads/lead-capture-form.tsx`)
 * UND die PRÜFUNG auf dem Server (`lib/leads/capture-request.ts` leitet das zod-Schema hier ab).
 * Zwei Quellen liefen auseinander: das Formular zeigte ein Feld, das der Server verwirft, oder der
 * Server verlangte eines, das nie angezeigt wurde — beides fällt erst am echten Lead auf.
 *
 * ── DIESE DATEI IST BEWUSST ABHÄNGIGKEITSFREI ────────────────────────────────────────────────────
 * Kein `server-only`, kein `next/*`, kein `@/`-Alias, kein zod — reine Typen und Literale. Zwei
 * Gründe: (1) sie wird aus Client- UND Server-Kontext importiert; (2) das DB-Gate
 * (`packages/db-tests/src/lead-source-registry.test.ts`) importiert sie über einen RELATIVEN Pfad,
 * um die Schlüssel gegen `platform.lead_sources` zu prüfen — ein Alias oder ein Next-Import wäre
 * dort nicht auflösbar. Bitte so lassen.
 *
 * ── DIE TEXTE STEHEN IN `messages/de.json`, IHRE EXISTENZ HIER ───────────────────────────────────
 * §8.7 verlangt alle nutzergerichteten Texte im Nachrichtenkatalog (anders als der Admin-Bereich,
 * der ausserhalb der next-intl-Struktur liegt). Die Registry legt deshalb nicht den WORTLAUT fest,
 * sondern dass jeder Eintrag genau vier kontextspezifische Texte HAT — Überschrift, Erläuterung,
 * Schaltflächenbeschriftung, Erfolgsmeldung — abgelegt unter `LeadCapture.entries.<key>.*`. Ein
 * Unit-Test (`lib/leads/registry.test.ts`) pinnt, dass es zu jedem Eintrag alle vier gibt; ein
 * fehlender Text ist damit ein roter Test und keine leere Überschrift auf einer Marketingseite.
 *
 * Der EINWILLIGUNGS-Wortlaut kommt dagegen NICHT von hier und auch nicht aus `messages/de.json`,
 * sondern aus `platform.consent_texts` (B1-1, append-only) — angezeigter und archivierter Wortlaut
 * müssen dieselbe Quelle haben.
 */

/**
 * Die Zwecke aus dem DB-Enum `platform.consent_purpose` (B1-1) als LITERALE.
 *
 * Diese Datei darf die generierten DB-Typen nicht importieren (s. Kopf), trägt die Union deshalb
 * selbst. Damit sie nicht von der Datenbank wegdriften kann, beweist `lib/leads/config.ts` beim
 * Typecheck ihre Gleichheit mit `Database['platform']['Enums']['consent_purpose']`.
 */
export type LeadConsentPurpose = 'marketing_email' | 'contract_expiry_reminder' | 'result_delivery'

/**
 * Alle Schlüssel aus `platform.lead_sources` — erschöpfend.
 *
 * Die Reihenfolge folgt der Entstehung (B1-1 zuerst, dann B3-1), nicht der Wichtigkeit; sie ist
 * für nichts ausser der Lesbarkeit dieser Datei relevant.
 *
 * DER ABGLEICH MIT DER DATENBANK IST EIN TEST, KEINE DISZIPLIN: `lead-source-registry.test.ts`
 * prüft in BEIDE Richtungen, dass diese Liste genau den AKTIVEN Zeilen in `platform.lead_sources`
 * entspricht. Ohne diesen Test driften Code und Datenbank auseinander, und die Fehlpaarung fällt
 * erst auf, wenn ein Einstiegspunkt unter falscher Herkunft in den Bestand schreibt — der Lead ist
 * dann da, aber die Auswertung, welcher Kanal ihn gebracht hat, ist still falsch.
 */
export const LEAD_SOURCE_KEYS = [
  'kontaktformular',
  'schnellrechner',
  'wko-postaktion-qr',
  'fachvortrag',
  'direktkontakt',
  'betroffenheits-check',
  'rechnerergebnis',
  'artikel-inline',
  'branchenseite',
  'vertragsablauf-landing',
  'warteliste',
] as const

export type LeadSourceKey = (typeof LEAD_SOURCE_KEYS)[number]

/* ─── Felder ──────────────────────────────────────────────────────────────────────────────────── */

/**
 * Die erhebbaren Felder. Jeder Name entspricht einem Parameter von `public.capture_lead` —
 * `contactName` → `p_contact_name`, `postalCode` → `p_postal_code` und so fort. Es gibt bewusst
 * kein Feld, das die Datenbank nicht kennt: was erhoben wird, muss auch ankommen können.
 */
export type LeadFieldKey =
  | 'email'
  | 'contactName'
  | 'company'
  | 'phone'
  | 'industry'
  | 'postalCode'
  | 'annualConsumptionKwh'
  | 'supplier'
  | 'contractEndDate'

/**
 * Die Eingabeart bestimmt Tastatur, Autovervollständigung und Prüfregel — an EINER Stelle, damit
 * nicht jedes Formular sie neu erfindet.
 */
export type LeadFieldKind = 'email' | 'text' | 'tel' | 'postalCode' | 'kwh' | 'date' | 'industry'

export type LeadFieldDescriptor = {
  kind: LeadFieldKind
  /** HTML-`autocomplete`; leer, wo es keinen passenden Standardwert gibt. */
  autoComplete?: string
  maxLength?: number
}

export const LEAD_FIELDS: Readonly<Record<LeadFieldKey, LeadFieldDescriptor>> = {
  // 254 = RFC 5321, die längste zustellbare Adresse (identisch zum Kontaktformular-Schema).
  email: { kind: 'email', autoComplete: 'email', maxLength: 254 },
  contactName: { kind: 'text', autoComplete: 'name', maxLength: 100 },
  company: { kind: 'text', autoComplete: 'organization', maxLength: 120 },
  phone: { kind: 'tel', autoComplete: 'tel', maxLength: 60 },
  // Kein `autocomplete`: das Enum ist eine fachliche Einordnung, keine Adressangabe.
  industry: { kind: 'industry' },
  // `postal-code` ist korrekt, obwohl wir keine Adresse erheben — der Browser füllt genau dieses
  // Feld sinnvoll vor, und die DB prüft ohnehin auf exakt vier Ziffern (B3-1-CHECK).
  postalCode: { kind: 'postalCode', autoComplete: 'postal-code', maxLength: 4 },
  annualConsumptionKwh: { kind: 'kwh' },
  supplier: { kind: 'text', maxLength: 120 },
  contractEndDate: { kind: 'date' },
}

export type LeadCaptureField = {
  key: LeadFieldKey
  required: boolean
}

/* ─── Branchen-Auswahl ────────────────────────────────────────────────────────────────────────── */

/**
 * Die zehn Werte des DB-Enums `platform.industry` (B3-1) in der dort festgelegten Reihenfolge.
 *
 * BEWUSST KEINE ABLEITUNG AUS DER BRANCHEN-IA (`lib/branchen.ts`): die fünf Branchenseiten der
 * Website (Bau, Handwerk, Hotellerie & Gastronomie, Industrie, Land- und Forstwirtschaft) und die
 * zehn Enum-Werte sind NICHT deckungsgleich — sie beantworten verschiedene Fragen (Marketing-IA
 * gegen Vollbenutzungsstunden-Kennzahl, B3-3). Eine automatische Zuordnung müsste raten, und ein
 * falsch geratener Branchenwert ist im Bestand nicht mehr von einem angegebenen unterscheidbar.
 * Deshalb setzt die Branchenseite die Branche AUCH NICHT still vor; wer sie wissen will, fragt sie.
 */
export const LEAD_INDUSTRY_VALUES = [
  'baeckerei',
  'gastronomie',
  'handel',
  'hotellerie',
  'tischlerei',
  'landwirtschaft',
  'kuehlhaus',
  'metallverarbeitung',
  'buero_dienstleistung',
  'sonstige',
] as const

export type LeadIndustry = (typeof LEAD_INDUSTRY_VALUES)[number]

/* ─── Einträge ────────────────────────────────────────────────────────────────────────────────── */

export type LeadCaptureEntry = {
  key: LeadSourceKey
  /**
   * Der Zweck, den DIESER Einstiegspunkt erhebt — oder `null` für reine Erfassung ohne
   * Einwilligung (Rechtsgrundlage Vertragsanbahnung, wie das Kontaktformular in B1-2).
   *
   * DER ZWECK KOMMT AUSSCHLIESSLICH VON HIER. Die Server Action nimmt keinen Zweck vom Client
   * entgegen — die Begründung steht dort.
   */
  purpose: LeadConsentPurpose | null
  /**
   * Zusätzliche, NIE vorausgewählte Marketing-Einwilligung neben dem eigentlichen Zweck.
   * Nur sinnvoll, wo `purpose` nicht selbst schon 'marketing_email' ist.
   */
  offersMarketingConsent: boolean
  fields: readonly LeadCaptureField[]
  /** Hängen die Werte des Schnellrechners an dieser Absendung? (Zusendung des Ergebnisses.) */
  carriesCalculatorResult: boolean
  /**
   * Ist dieser Einstiegspunkt derzeit irgendwo platziert? REIN DOKUMENTARISCH — die Komponente
   * rendert einen Eintrag auch dann korrekt, wenn er (noch) nirgends steht: die Platzierung ist
   * eine getrennte Entscheidung und keine Eigenschaft des Eintrags.
   */
  placed: boolean
}

const EMAIL_ONLY: readonly LeadCaptureField[] = [{ key: 'email', required: true }]

/**
 * Die Felder der Warteliste (B3-4) — von BEIDEN Wartelisten-Routen geteilt, damit sie denselben
 * Bestand füllen und nicht zwei unterschiedlich vollständige.
 *
 * ── BRANCHE IST PFLICHT: eine bewusste Abweichung von der Wertleiter ────────────────────────────
 * Die Wertleiter des Fahrplans („anonym rechnen → E-Mail → Versorger + Ablaufdatum → zahlen") sagt:
 * je Stufe nur erheben, was diese Stufe rechtfertigt. Eine Warteliste rechtfertigt für sich genommen
 * die Adresse — mehr nicht.
 *
 * Was hier hinzukommt, ist der ZWECK der Liste: Der Fahrplan sieht vor, die Wartenden zum Erscheinen
 * der Tarifverordnung mit bereits bekannter Betriebsgrösse anzusprechen. Ohne Branche wäre das eine
 * Rundmail an alle — und dann hätte die Liste ihren Zweck verfehlt, nicht bloss weniger Daten.
 *
 * Der Preis ist an der EINGABEART bemessen, nicht am Interesse: Die Branche ist ein Auswahlfeld;
 * wer sie beantwortet, klickt einmal und muss nichts nachsehen. Der Jahresverbrauch verlangt, eine
 * Rechnung herauszusuchen — das ist eine Unterbrechung mit ungewissem Ausgang und bleibt deshalb
 * optional, ebenso die Postleitzahl.
 */
const WARTELISTE_FIELDS: readonly LeadCaptureField[] = [
  { key: 'email', required: true },
  { key: 'industry', required: true },
  { key: 'postalCode', required: false },
  { key: 'annualConsumptionKwh', required: false },
]

/**
 * DIE ZEHN EINSTIEGSPUNKTE.
 *
 * Die Wertleiter des Fahrplans steckt in den `fields`: „anonym rechnen → E-Mail für
 * Ergebnisdokument/Anleitung → Versorger + Ablaufdatum für echte Erinnerung → zahlen". Je Stufe
 * wird nur erhoben, was diese Stufe rechtfertigt — ein Pflichtfeld „Telefonnummer" unter einem
 * Artikel wäre eine Hürde vor einem PDF.
 */
export const LEAD_CAPTURE_REGISTRY: Readonly<Record<LeadSourceKey, LeadCaptureEntry>> = {
  /*
   * BESTEHENDES VERHALTEN AUS B1-2, unverändert abgebildet und NICHT geändert: jede Absendung
   * schreibt einen Lead auf Grundlage Vertragsanbahnung (deshalb `purpose: null`), und nur die
   * zusätzliche, nicht vorausgewählte Ankreuzmöglichkeit erzeugt eine Marketing-Einwilligung.
   * Gerendert wird `/kontakt` weiterhin von `components/kontakt/kontakt-form.tsx` über
   * `POST /api/kontakt` — dieser Eintrag beschreibt den Einstiegspunkt, er löst ihn nicht ab.
   */
  kontaktformular: {
    key: 'kontaktformular',
    purpose: null,
    offersMarketingConsent: true,
    fields: [
      { key: 'email', required: true },
      { key: 'contactName', required: true },
      { key: 'company', required: false },
      { key: 'phone', required: false },
    ],
    carriesCalculatorResult: false,
    placed: true,
  },

  /*
   * Der ältere B1-1-Schlüssel („Schnellrechner / Betroffenheits-Check"). Seine beiden Nachfolger
   * sind spezifischer ('rechnerergebnis' für die Zusendung, 'betroffenheits-check' für B3-3); der
   * Schlüssel bleibt, weil `leads.first_source_key` ein FK ist und eine einmal vergebene Herkunft
   * nicht verschwinden darf. Platzierung später.
   */
  schnellrechner: {
    key: 'schnellrechner',
    purpose: null,
    offersMarketingConsent: true,
    fields: EMAIL_ONLY,
    carriesCalculatorResult: false,
    placed: false,
  },

  /*
   * PLATZIERT SEIT B3-4: `/warteliste/wko` — die Adresse, die auf dem Postbrief gedruckt steht.
   *
   * Fachlich IDENTISCH zu `warteliste` weiter unten (gleicher Zweck, gleiche Felder, gleicher
   * Einwilligungswortlaut); der Unterschied liegt allein in der ANSPRACHE der Seite („Sie haben von
   * uns Post erhalten") und darin, dass diese Route `noindex` trägt. Zwei nahezu gleiche
   * indexierbare Seiten wären ein Duplikat — erreichbar bleibt sie selbstverständlich.
   *
   * Die frühere Fassung erhob zusätzlich die Firma und keine Branche. Geändert, weil beide Routen
   * denselben Bestand füllen: unterschiedliche Felder je Route ergäben eine Warteliste, deren
   * Segmentierbarkeit davon abhinge, über welchen Weg jemand hereingekommen ist.
   */
  'wko-postaktion-qr': {
    key: 'wko-postaktion-qr',
    purpose: 'marketing_email',
    offersMarketingConsent: false,
    fields: WARTELISTE_FIELDS,
    carriesCalculatorResult: false,
    placed: true,
  },

  /* Erfassung im Anschluss an einen Vortrag — dort ist der Name der übliche Einstieg.
     Platzierung später. */
  fachvortrag: {
    key: 'fachvortrag',
    purpose: 'marketing_email',
    offersMarketingConsent: false,
    fields: [
      { key: 'email', required: true },
      { key: 'contactName', required: false },
      { key: 'company', required: false },
    ],
    carriesCalculatorResult: false,
    placed: false,
  },

  /* Direkt erfasster Kontakt (Messe, Telefonat). Ohne Zweck — eine Einwilligung entsteht nur, wenn
     sie ausdrücklich angekreuzt wurde. Platzierung später. */
  direktkontakt: {
    key: 'direktkontakt',
    purpose: null,
    offersMarketingConsent: true,
    fields: [
      { key: 'email', required: true },
      { key: 'contactName', required: false },
      { key: 'company', required: false },
      { key: 'phone', required: false },
    ],
    carriesCalculatorResult: false,
    placed: false,
  },

  /*
   * NICHT PLATZIERT — und das ist eine fachliche, keine terminliche Entscheidung.
   *
   * Der Betroffenheits-Check (B3-3) sagt einer Person, OB und WIE STARK sie die Umstellung 2027
   * trifft. Diese Aussage entsteht deterministisch über Vollbenutzungsstunden je Branche — und
   * genau diese Branchenkennzahlen liegen noch nicht vor. Ein Formular, das Branche, PLZ und
   * Verbrauch erhebt, aber keine belastbare Betroffenheit zurückgeben kann, sammelt Daten für eine
   * Auskunft, die es nicht gibt. Der Eintrag steht trotzdem hier, damit B3-3 nur noch die Rechnung
   * und die Seite braucht — nicht auch noch die Erfassung.
   */
  'betroffenheits-check': {
    key: 'betroffenheits-check',
    purpose: 'result_delivery',
    offersMarketingConsent: true,
    fields: [
      { key: 'email', required: true },
      { key: 'postalCode', required: true },
      { key: 'annualConsumptionKwh', required: true },
      { key: 'industry', required: true },
    ],
    carriesCalculatorResult: false,
    placed: false,
  },

  /*
   * PLATZIERT: unter dem Ergebnis des Schnellrechners.
   *
   * 'result_delivery' ist NICHT bestätigungspflichtig (B1-1, `purpose_requires_double_opt_in`): die
   * Zusendung IST die unmittelbar angeforderte Leistung. Seit B3-2 entsteht die Einwilligung
   * deshalb sofort als `confirmed`, und der Anwendungscode liefert unmittelbar aus.
   */
  rechnerergebnis: {
    key: 'rechnerergebnis',
    purpose: 'result_delivery',
    offersMarketingConsent: true,
    fields: EMAIL_ONLY,
    carriesCalculatorResult: true,
    placed: true,
  },

  /* PLATZIERT: in einem Wissen-Artikel. Nur die Adresse — wer einen Fachtext liest, soll für den
     nächsten Beitrag kein Firmenprofil hinterlassen müssen. */
  'artikel-inline': {
    key: 'artikel-inline',
    purpose: 'marketing_email',
    offersMarketingConsent: false,
    fields: EMAIL_ONLY,
    carriesCalculatorResult: false,
    placed: true,
  },

  /* PLATZIERT: auf einer Branchenseite. Ebenfalls nur die Adresse — die Branche wird bewusst NICHT
     aus der Seite abgeleitet (s. Kommentar an LEAD_INDUSTRY_VALUES). */
  branchenseite: {
    key: 'branchenseite',
    purpose: 'marketing_email',
    offersMarketingConsent: false,
    fields: EMAIL_ONLY,
    carriesCalculatorResult: false,
    placed: true,
  },

  /*
   * PLATZIERT SEIT B4-2: die eigene Landingpage `/vertragsende-erinnerung`.
   *
   * B3-2 hatte diesen Eintrag ausdrücklich NICHT platziert, und zwar aus einem fachlichen Grund:
   * wer hier Versorger und Vertragsende einträgt, tut das für genau eine Gegenleistung —
   * rechtzeitig erinnert zu werden. Diese Erinnerung ist ein zeitgesteuerter Vorgang, und den gab
   * es vor B4 nicht. Ein Vertragsende zu erfassen und die versprochene Erinnerung nicht senden zu
   * können, wäre ein gebrochenes Versprechen an eine reale Person gewesen.
   *
   * Mit B4-2 steht der Versand (`app/api/cron/contract-reminders`, täglich 06:40 UTC, acht Wochen
   * Vorlauf). Damit fällt der Grund weg — und nur er, nicht der Eintrag: Zweck, Felder und Texte
   * sind unverändert die aus B3-2.
   */
  'vertragsablauf-landing': {
    key: 'vertragsablauf-landing',
    purpose: 'contract_expiry_reminder',
    offersMarketingConsent: true,
    fields: [
      { key: 'email', required: true },
      { key: 'supplier', required: true },
      { key: 'contractEndDate', required: true },
    ],
    carriesCalculatorResult: false,
    placed: true,
  },

  /*
   * PLATZIERT SEIT B3-4: die öffentliche, indexierbare Landingpage `/warteliste`.
   *
   * Der organische Zwilling von `wko-postaktion-qr` (s. dort): gleicher Zweck, gleiche Felder,
   * gleicher Einwilligungswortlaut — die beiden Einträge unterscheiden sich AUSSCHLIESSLICH in
   * ihren Texten, weil der eine ein Anschreiben voraussetzen darf und der andere nicht.
   *
   * KEINE eigene Einwilligungsart: die Warteliste ist fachlich `marketing_email` und wird über den
   * `source_key` der Einwilligung unterschieden (B1-1 hält den Herkunftskontext je Einwilligung
   * genau dafür vor). Ausführlich begründet im Kopf der B3-4-Migration.
   */
  warteliste: {
    key: 'warteliste',
    purpose: 'marketing_email',
    offersMarketingConsent: false,
    fields: WARTELISTE_FIELDS,
    carriesCalculatorResult: false,
    placed: true,
  },
}

/** Ist der Wert ein bekannter Einstiegspunkt? Die einzige erlaubte Prüfung — kein Ersatzwert. */
export function isLeadSourceKey(value: unknown): value is LeadSourceKey {
  return typeof value === 'string' && (LEAD_SOURCE_KEYS as readonly string[]).includes(value)
}

/**
 * Der Eintrag zu einem Schlüssel — oder `null`.
 *
 * BEWUSST KEIN FALLBACK auf einen „Standard-Einstiegspunkt": ein unbekannter Schlüssel ist ein
 * Fehler des Aufrufers (oder ein manipulierter Aufruf). Ein Ersatzwert schriebe den Lead unter
 * einer Herkunft in den Bestand, die ihn nicht gebracht hat.
 */
export function findLeadCaptureEntry(key: unknown): LeadCaptureEntry | null {
  return isLeadSourceKey(key) ? LEAD_CAPTURE_REGISTRY[key] : null
}
