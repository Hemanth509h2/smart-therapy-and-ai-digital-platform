import { tx } from "@/lib/db";
import { HOUR, HttpError, captcha, json, limit, route, voterKey } from "@/lib/http";
import { screen } from "@/lib/filter";
import { listQuestions } from "@/lib/surveyStore";
import type { Question } from "@/lib/survey";

export const dynamic = "force-dynamic";

/** Active survey questions, in order. */
export const GET = route(async () => ({ questions: await listQuestions(false) }));

type Clean = { question_id: string; num: number | null; txt: string | null; picks: string[] | null };

function cleanAnswer(q: Question, v: unknown): Clean | null {
  const base = { question_id: q.id, num: null, txt: null, picks: null };
  const empty = v == null || v === "" || (Array.isArray(v) && v.length === 0);
  if (empty) {
    if (q.required) throw new HttpError(400, `Please answer: "${q.title}"`);
    return null;
  }
  switch (q.kind) {
    case "scale":
      if (typeof v !== "number" || !Number.isInteger(v) || v < (q.scale_min ?? 0) || v > (q.scale_max ?? 10)) throw new HttpError(400, `Invalid answer for "${q.title}"`);
      return { ...base, num: v };
    case "single":
      if (typeof v !== "string" || !q.options.includes(v)) throw new HttpError(400, `Invalid answer for "${q.title}"`);
      return { ...base, picks: [v] };
    case "multi":
      if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !q.options.includes(x))) throw new HttpError(400, `Invalid answer for "${q.title}"`);
      return { ...base, picks: [...new Set(v as string[])] };
    case "text": {
      if (typeof v !== "string") throw new HttpError(400, `Invalid answer for "${q.title}"`);
      const t = v.trim();
      if (t.length > 1000) throw new HttpError(400, "Text answers must be at most 1000 characters");
      if (!t) { if (q.required) throw new HttpError(400, `Please answer: "${q.title}"`); return null; }
      screen(t);
      return { ...base, txt: t };
    }
  }
}

/** Anonymous survey response. One per browser: the key is an HMAC of the device token, like likes. */
export const POST = route(async (req) => {
  limit(req, "survey", 5, HOUR);
  await captcha(req);
  const b = await json(req);
  const answers = (b.answers && typeof b.answers === "object" ? b.answers : {}) as Record<string, unknown>;
  const questions = await listQuestions(false);
  const clean = questions.map((q) => cleanAnswer(q, answers[q.id])).filter((x): x is Clean => !!x);
  if (!clean.length) throw new HttpError(400, "Answer at least one question");
  const key = voterKey(b.device_token, "survey");

  await tx(async (q) => {
    const r = await q(`INSERT INTO survey_responses (respondent_key) VALUES ($1) ON CONFLICT (respondent_key) DO NOTHING RETURNING id`, [key]);
    if (!r.rowCount) throw new HttpError(409, "You've already answered the survey from this browser - thank you!");
    for (const a of clean) {
      await q(`INSERT INTO survey_answers (response_id, question_id, num, txt, picks) VALUES ($1,$2,$3,$4,$5)`,
        [r.rows[0].id, a.question_id, a.num, a.txt, a.picks]);
    }
  });
});
