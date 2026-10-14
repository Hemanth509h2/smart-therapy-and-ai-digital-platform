import { pool } from "@/lib/db";
import { json, requireAdmin, route } from "@/lib/http";
import { cleanQuestion, listQuestions } from "@/lib/surveyStore";

export const dynamic = "force-dynamic";

/** Admin: all questions, including archived ones (with how many answers each has). */
export const GET = route(async (req) => {
  requireAdmin(req);
  const questions = await listQuestions(true);
  const { rows } = await pool().query(`SELECT question_id, count(*)::int AS n FROM survey_answers GROUP BY question_id`);
  const answered = Object.fromEntries(rows.map((r) => [r.question_id, r.n]));
  return { questions: questions.map((q) => ({ ...q, answers: answered[q.id] ?? 0 })) };
});

/** Admin: add a question at the end. */
export const POST = route(async (req) => {
  requireAdmin(req);
  const q = cleanQuestion(await json(req));
  const { rows } = await pool().query(
    `INSERT INTO survey_questions (position, kind, title, options, scale_min, scale_max, low_label, high_label, required)
     VALUES ((SELECT COALESCE(max(position), 0) + 1 FROM survey_questions), $1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [q.kind, q.title, q.options, q.scale_min, q.scale_max, q.low_label, q.high_label, q.required]
  );
  return { id: rows[0].id };
});
