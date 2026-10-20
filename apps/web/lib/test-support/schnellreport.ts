import {
  parseSchnellreport,
  type SchnellreportSubmission,
  type SchnellreportValues,
} from '@/lib/schnellreport/request'

/** Eine gültige Absendung des Schnellreport-Formulars (synthetische Werte). */
export const SCHNELLREPORT_SUBMISSION: SchnellreportSubmission = {
  firma: 'Muster Metallbau GmbH',
  branche: 'produktion',
  vorname: 'Anna',
  nachname: 'Beispiel',
  email: 'anna.beispiel@example.test',
  tips: false,
  check: { country: 'AT', kwh: 250_000, kw: 180, bill: 65_000, sliderKw: 150 },
}

function parsed(): SchnellreportValues {
  const result = parseSchnellreport(SCHNELLREPORT_SUBMISSION)
  if (!result.ok) throw new Error('Fixture ungültig')
  return result.values
}

export const SCHNELLREPORT_VALUES: SchnellreportValues = parsed()
