/**
 * Who operates STAAD: the business contact details shown in the legal pages.
 *
 * Fill in the fields set to null before launch. Indian law expects the legal
 * entity, a postal address and a named Grievance Officer to be published
 * (IT Rules 2011 and 2021, DPDP Act 2023), and Cashfree asks for them on the
 * site too. A null field is simply left out of the pages; nothing is invented.
 */

import { SUPPORT_EMAIL, SUPPORT_HOURS } from '@/content/help';

export interface BusinessDetails {
  /** Trading name used throughout the product. */
  brand: string;
  /** Registered legal name, e.g. "STAAD Technologies Private Limited". */
  legalName: string | null;
  /** Registered office address, one line. */
  address: string | null;
  /** Corporate Identification Number, if a company. */
  cin: string | null;
  /** GSTIN, if registered for GST. */
  gstin: string | null;
  /** Contact phone, with country code. */
  phone: string | null;
  email: string;
  hours: string;
  /** Name of the Grievance Officer (privacy complaints, takedown notices). */
  grievanceOfficer: string | null;
}

export const BUSINESS: BusinessDetails = {
  brand: 'STAAD',
  legalName: null,
  address: null,
  cin: null,
  gstin: null,
  phone: null,
  email: SUPPORT_EMAIL,
  hours: SUPPORT_HOURS,
  grievanceOfficer: null,
};

/** The business details as bullet lines, skipping anything not filled in. */
export function businessContactLines(): string[] {
  const b = BUSINESS;
  return [
    `Operator: ${b.legalName ? `${b.legalName} (trading as ${b.brand})` : b.brand}`,
    b.address && `Registered address: ${b.address}`,
    b.cin && `CIN: ${b.cin}`,
    b.gstin && `GSTIN: ${b.gstin}`,
    `Email: ${b.email}`,
    b.phone && `Phone: ${b.phone}`,
    `Support hours: ${b.hours}`,
    `Grievance Officer: ${b.grievanceOfficer ? `${b.grievanceOfficer}, ` : ''}${b.email}`,
  ].filter((line): line is string => Boolean(line));
}
