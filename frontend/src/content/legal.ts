/**
 * Shared shape for the long legal pages (/privacy, /terms).
 *
 * A body entry that is a string renders as a paragraph; an array of strings
 * renders as a bulleted list.
 */

export type PolicyBlock = string | string[];

export interface PolicySection {
  id: string;
  title: string;
  body: PolicyBlock[];
}

/**
 * Version of the Privacy Policy + Terms a therapist accepts at onboarding.
 * Must match LEGAL_VERSION in backend-express/src/lib/core/legal.ts. Bump both
 * (to the date of the change) when either document changes materially:
 * therapists who accepted an older version are asked to accept again.
 */
export const LEGAL_VERSION = '2026-11-04';
