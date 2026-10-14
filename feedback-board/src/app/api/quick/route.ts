import { pool } from "@/lib/db";
import { HOUR, HttpError, json, limit, route, uuid, voterKey } from "@/lib/http";
import { quickResults } from "@/lib/surveyStore";

export const dynamic = "force-dynamic";

/** Active quick questions with live counts. */
export const GET = route(async () => ({ questions: await quickResults() }));

/** One answer per browser per question (and per version of it); answering again changes it. */
export const POST = route(async (req) => {
  limit(req, "quick", 60, HOUR);
  const b = await json(req);
  const id = uuid(b.question_id, "question_id");
  const { rows } = await pool().query(`SELECT options, version FROM quick_questions WHERE id = $1 AND active`, [id]);
  if (!rows.length) throw new HttpError(404, "This question isn't available any more - refresh the page");
  if (typeof b.answer !== "string" || !rows[0].options.includes(b.answer)) throw new HttpError(400, "That answer isn't available any more - refresh the page");
  await pool().query(
    `INSERT INTO quick_answers (respondent_key, question_id, answer) VALUES ($1, $2, $3)
     ON CONFLICT (respondent_key) DO UPDATE SET answer = EXCLUDED.answer`,
    [voterKey(b.device_token, `quick:${id}:${rows[0].version}`), id, b.answer]
  );
  return (await quickResults()).find((q) => q.id === id);
});
