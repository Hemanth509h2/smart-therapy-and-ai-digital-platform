import { HttpError } from "./http";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(?:\+?\d[\s().-]?){10,}/;

/** Rejects personal-data patterns and blocklisted words before anything is saved. */
export function screen(text: string) {
  if (EMAIL.test(text) || PHONE.test(text)) {
    throw new HttpError(400, "Please remove emails or phone numbers - posts are public.");
  }
  const words = (process.env.BLOCKLIST ?? "").split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
  const lower = text.toLowerCase();
  if (words.some((w) => lower.includes(w))) throw new HttpError(400, "This text contains blocked language.");
}
