import { pool, tx } from "@/lib/db";
import { HttpError, json, requireAdmin, route, uuid } from "@/lib/http";
import { cleanQuestion } from "@/lib/surveyStore";

const answerCount = async (id: string) =>
  (await pool().query(`SELECT count(*)::int AS n FROM survey_answers WHERE question_id = $1`, [id])).rows[0].n as number;

/**
 * Admin: update a question.
 *   { move: "up" | "down" }        reorder
 *   { active: true | false }       restore / archive
 *   { kind, title, options, ... }  edit (the type can't change once people have answered)
 */
export const PATCH = route(async (req, { params }) => {
  requireAdmin(req);
  const id = uuid(params.id);
  const b = await json(req);

  if (b.move === "up" || b.move === "down") {
    await tx(async (q) => {
      const { rows } = await q(`SELECT id FROM survey_questions WHERE active ORDER BY position, created_at`);
      const ids: string[] = rows.map((r) => r.id);
      const i = ids.indexOf(id);
      const j = b.move === "up" ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      for (let k = 0; k < ids.length; k++) await q(`UPDATE survey_questions SET position = $2 WHERE id = $1`, [ids[k], k + 1]);
    });
    return;
  }

  if (typeof b.active === "boolean" && Object.keys(b).length === 1) {
    const { rowCount } = await pool().query(
      `UPDATE survey_questions SET active = $2,
         position = CASE WHEN $2 THEN (SELECT COALESCE(max(position), 0) + 1 FROM survey_questions) ELSE position END
       WHERE id = $1`,
      [id, b.active]
    );
    if (!rowCount) throw new HttpError(404, "Question not found");
    return;
  }

  const q = cleanQuestion(b);
  const cur = await pool().query(`SELECT kind FROM survey_questions WHERE id = $1`, [id]);
  if (!cur.rowCount) throw new HttpError(404, "Question not found");
  if (cur.rows[0].kind !== q.kind && (await answerCount(id)) > 0) {
    throw new HttpError(409, "People have already answered this question, so its type can't change. Archive it and add a new one.");
  }
  await pool().query(
    `UPDATE survey_questions SET kind=$2, title=$3, options=$4, scale_min=$5, scale_max=$6, low_label=$7, high_label=$8, required=$9 WHERE id=$1`,
    [id, q.kind, q.title, q.options, q.scale_min, q.scale_max, q.low_label, q.high_label, q.required]
  );
});

/** Admin: remove a question. Questions with answers are archived (kept for results); others are deleted. */
export const DELETE = route(async (req, { params }) => {
  requireAdmin(req);
  const id = uuid(params.id);
  if ((await answerCount(id)) > 0) {
    await pool().query(`UPDATE survey_questions SET active = false WHERE id = $1`, [id]);
    return { archived: true };
  }
  const { rowCount } = await pool().query(`DELETE FROM survey_questions WHERE id = $1`, [id]);
  if (!rowCount) throw new HttpError(404, "Question not found");
  return { deleted: true };
});
