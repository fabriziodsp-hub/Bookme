/**
 * Public salon details used in the UI, e-mails, Impressum and privacy drafts.
 * PLACEHOLDERS – replace with the real data before going live.
 */
export const salonProfile = {
  name: 'Salon Beispiel',
  legalName: 'Salon Beispiel – Inh. Vorname Nachname',
  street: 'Musterstraße 1',
  postalCode: '12345',
  city: 'Musterstadt',
  phone: '+49 30 1234567',
  phoneDisplay: '030 123 45 67',
  email: 'termine@salon-beispiel.de',
  /** Supervisory authority / chamber for the Impressum (Handwerkskammer). */
  chamber: 'Handwerkskammer Musterstadt',
} as const;

export type SalonProfile = { [K in keyof typeof salonProfile]: string };
