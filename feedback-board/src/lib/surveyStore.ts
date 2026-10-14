// Server-side survey helpers: load / validate questions and the quick-question settings.
import { pool } from "./db";
import { HttpError } from "./http";
import type { Question, QuestionKind, QuickResult } from "./survey";

const KINDS: QuestionKind[] = ["scale", "single", "multi", "text"];
const COLS = "id, position, kind, title, options, scale_min, scale_max, low_label, high_label, required, active";

export async function listQuestions(includeArchived = false): Promise<Question[]> {
  const { rows } = await pool().query(
    `SELECT ${COLS} FROM survey_questions WHERE $1 OR active ORDER BY active DESC, position, created_at`,
    [includeArchived]
  );
  return rows;
}

function label(v: unknown, name: string, max: number): string | null {
  if (v == null || v === "") return null;
  if (typeof v !== "string") throw new HttpError(400, `${name} must be text`);
  const t = v.trim();
  if (t.length > max) throw new HttpError(400, `${name} must be at most ${max} characters`);
  return t || null;
}

function optionList(v: unknown, min: number, max: number, maxLen: number): string[] {
  if (!Array.isArray(v)) throw new HttpError(400, "Options must be a list");
  const out: string[] = [];
  for (const o of v) {
    if (typeof o !== "string") throw new HttpError(400, "Options must be text");
    const t = o.trim();
    if (!t) continue;
    if (t.length > maxLen) throw new HttpError(400, `Each option must be at most ${maxLen} characters`);
    if (out.some((x) => x.toLowerCase() === t.toLowerCase())) throw new HttpError(400, `Duplicate option: "${t}"`);
    out.push(t);
  }
  if (out.length < min || out.length > max) throw new HttpError(400, `Add between ${min} and ${max} options`);
  return out;
}

/** Validate a question coming from the admin editor. */
export function cleanQuestion(b: Record<string, unknown>) {
  const kind = b.kind as QuestionKind;
  if (!KINDS.includes(kind)) throw new HttpError(400, "Invalid question type");
  const title = label(b.title, "Question", 200);
  if (!title) throw new HttpError(400, "Write the question text");
  const q = {
    kind, title, required: b.required === true,
    options: [] as string[], scale_min: null as number | null, scale_max: null as number | null,
    low_label: null as string | null, high_label: null as string | null,
  };
  if (kind === "single" || kind === "multi") q.options = optionList(b.options, 2, 12, 80);
  if (kind === "scale") {
    const min = Number(b.scale_min), max = Number(b.scale_max);
    if (![0, 1].includes(min)) throw new HttpError(400, "Scale must start at 0 or 1");
    if (!Number.isInteger(max) || max < min + 2 || max > 10) throw new HttpError(400, "Scale must end between 3 and 10");
    q.scale_min = min; q.scale_max = max;
    q.low_label = label(b.low_label, "Low label", 40);
    q.high_label = label(b.high_label, "High label", 40);
  }
  return q;
}

// ---------- qu// ---------- quick questions ----------

export function cleanQuick(b: Record<string, unknown>): { question: string; options: string[] } {
  const question = label(b.question, "Question", 150);
  if (!question) throw new HttpError(400, "Write the question text");
  return { question, options: optionList(b.options, 2, 6, 40) };
}

/** Quick questions with live counts, in order. Inactive ones only when includeInactive. */
export async function quickResults(includeInactive = false): Promise<QuickResult[]> {
  const db = pool();
  const [qs, counts] = await Promise.all([
    db.query(`SELECT id, position, question, options, version, active FROM quick_questions
              WHERE $1 OR active ORDER BY active DESC, position, created_at`, [includeInactive]),
    db.query(`SELECT question_id, answer, count(*)::int AS n FROM quick_answers GROUP BY 1, 2`),
  ]);
  return qs.rows.map((q) => {
    const c = Object.fromEntries((q.options as string[]).map((o) => [o, 0]));
    for (const r of counts.rows) if (r.question_id === q.id && r.answer in c) c[r.answer] = r.n;
    return { ...q, counts: c, total: Object.values(c).reduce((a: number, b) => a + (b as number), 0) };
  });
}
