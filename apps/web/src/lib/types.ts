import type { Block, LocalDate, Minute, SalonConfig } from '@salon/engine';

export type Status = 'requested' | 'discuss' | 'confirmed' | 'declined' | 'expired' | 'completed' | 'no_show' | 'cancelled';

export interface Profile {
  name: string;
  legalName: string;
  street: string;
  postalCode: string;
  city: string;
  phone: string;
  phoneDisplay: string;
  email: string;
  chamber: string;
}

export interface PriceEntry {
  serviceId: string;
  variant: string;
  priceCents: number;
  isFrom: boolean;
  finishSurchargeCents: number | null;
}

export interface Stylist {
  id: string;
  displayName: string;
  color: string;
}

export interface SalonData {
  slug: string;
  config: SalonConfig;
  profile: Profile;
  theme: { preset: 'dark' | 'light' | 'warm' | 'contrast'; accent: 'emerald' | 'violet' | 'rose' | 'amber' | 'sky' | 'slate' };
  hasLogo: boolean;
  prices: PriceEntry[];
  /** Homepage texts written by the salon (D-052); empty = section hidden. */
  homepage: { tagline: string; about: string };
  /** Only stylists who agreed, only their public name (D-052). */
  /** People who agreed to be shown, with their public name only (D-052); id for the wish filter (D-063). */
  team: { id: string; publicName: string }[];
  feeConsentText: Record<string, string>;
  /** Fee per service, computed by the server from the fee rule and the price list. */
  feeAmountCents: Record<string, number>;
  now: { date: LocalDate; minute: Minute };
}

export interface DayAvailability {
  date: LocalDate;
  open: boolean;
  hours: { open: Minute; close: Minute; breaks: { start: Minute; end: Minute }[] } | null;
  slots: { start: Minute; stylistIds: string[] }[];
  busy: { start: Minute; end: Minute }[];
}

export interface PublicAppointment {
  refCode: string;
  date: LocalDate;
  start: Minute;
  end: Minute;
  blocks: Block[];
  status: Status;
  serviceId: string;
  serviceLabel: string;
  price: { cents: number; isFrom: boolean; birthdayDiscount: boolean } | null;
  fee: { cents: number; lateCancelHours: number } | null;
  firstName: string;
  lastName: string;
  contact: string;
  restricted: boolean;
  canChange: boolean;
  cutoffAt: string;
  salonPhone: string;
  /** Note from the salon with its decision. */
  clientNote: string | null;
}

export interface Appointment {
  id: string;
  refCode: string;
  stylistId: string;
  date: LocalDate;
  start: Minute;
  end: Minute;
  blocks: Block[];
  status: Status;
  source: 'online' | 'staff';
  serviceId: string;
  serviceLabel: string;
  variant: string | null;
  finish: boolean;
  audience: 'women' | 'men';
  adultDeclared: boolean;
  colorNotes: string | null;
  internalNote: string | null;
  ageCheck: { status: 'not_required' | 'open' | 'requested' | 'verified' | 'not_verified' | 'not_presented'; at: string | null };
  fee: { cents: number; status: 'none' | 'due' | 'paid' | 'waived'; consentAt: string | null } | null;
  price: { cents: number; isFrom: boolean; birthdayDiscount: boolean } | null;
  expiresAt: string | null;
  clientNote: string | null;
  /** Saved note to the client of an open request, not sent yet (D-057). */
  clientNoteDraft: string | null;
  /** The stylist was deleted: give it to a colleague before confirming (D-054). */
  needsReassign: boolean;
  createdAt: string;
  version: number;
  customer: { id: string; firstName: string; lastName: string; phone: string | null; email: string | null; noShowCount: number };
}

export interface Absence {
  id: string;
  stylistId: string;
  kind: 'vacation' | 'sick' | 'training' | 'other';
  note: string | null;
  from: { date: LocalDate; minute: Minute };
  to: { date: LocalDate; minute: Minute };
}

export interface StaffUser {
  id: string;
  email: string;
  role: 'platform_admin' | 'owner' | 'stylist';
  displayName: string;
  stylistId: string | null;
  tenant: { id: string; slug: string; name: string } | null;
}
