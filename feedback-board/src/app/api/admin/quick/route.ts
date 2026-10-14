import { pool } from "@/lib/db";
import { json, requireAdmin, route } from "@/lib/http";
import { cleanQuick, quickResults } from "@/lib/surveyStore";

export const dynamic = "force-dynamic";

/** Admin: all quick questions (including hidden ones) with counts. */
export const GET = route(async (req) => {
  requireAdmin(req);
  return { questions: await quickResults(true) };
});

/** Admin: add a quick question at the end. */
export const POST = route(async (req) => {
  requireAdmin(req);
  const q = cleanQuick(await json(req));
  const { rows } = await pool().query(
    `INSERT INTO quick_questions (position, question, options)
     VALUES ((SELECT COALESCE(max(position), 0) + 1 FROM quick_questions), $1, $2) RETURNING id`,
    [q.question, q.options]
  );
  return { id: rows[0].id };
});
