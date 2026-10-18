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
