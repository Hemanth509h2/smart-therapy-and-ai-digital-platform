import { pool, tx } from "@/lib/db";
import { HttpError, json, requireAdmin, route, uuid } from "@/lib/http";
import { cleanQuick } from "@/lib/surveyStore";

/**
 * Admin: update a quick question.
 *   { move: "up" | "down" }   reorder
 *   { active: true | false }  show / hide on the board
 *   { reset: true }           clear its answers
 *   { question, options }     edit - a change to the text or options clears its answers
 */
export const PATCH = route(async (req, { params }) => {
  requireAdmin(req);
  const id = uuid(params.id);
  const b = await json(req);
  const db = pool();

  if (b.move === "up" || b.move === "down") {
    await tx(async (q) => {
      const { rows } = await q(`SELECT id FROM quick_questions WHERE active ORDER BY position, created_at`);
      const ids: string[] = rows.map((r) => r.id);
      const i = ids.indexOf(id), j = b.move === "up" ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      for (let k = 0; k < ids.length; k++) await q(`UPDATE quick_questions SET position = $2 WHERE id = $1`, [ids[k], k + 1]);
    });
    return;
  }
  if (typeof b.active === "boolean") {
    const { rowCount } = await db.query(
      `UPDATE quick_questions SET active = $2,
         position = CASE WHEN $2 THEN (SELECT COALESCE(max(position), 0) + 1 FROM quick_questions) ELSE position END
       WHERE id = $1`, [id, b.active]);
    if (!rowCount) throw new HttpError(404, "Question not found");
    return;
  }
  if (b.reset === true) {
    await tx(async (q) => {
      await q(`UPDATE quick_questions SET version = version + 1 WHERE id = $1`, [id]);
      await q(`DELETE FROM quick_answers WHERE question_id = $1`, [id]);
    });
    return;
  }

  const next = cleanQuick(b);
  const cur = await db.query(`SELECT question, options FROM quick_questions WHERE id = $1`, [id]);
  if (!cur.rowCount) throw new HttpError(404, "Question not found");
  const changed = cur.rows[0].question !== next.question || JSON.stringify(cur.rows[0].options) !== JSON.stringify(next.options);
  if (!changed) return;
  await tx(async (q) => {
    await q(`UPDATE quick_questions SET question = $2, options = $3, version = version + 1 WHERE id = $1`, [id, next.question, next.options]);
    await q(`DELETE FROM quick_answers WHERE question_id = $1`, [id]);
  });
});

/** Admin: delete a quick question and its answers. */
export const DELETE = route(async (req, { params }) => {
  requireAdmin(req);
  const { rowCount } = await pool().query(`DELETE FROM quick_questions WHERE id = $1`, [uuid(params.id)]);
  if (!rowCount) throw new HttpError(404, "Question not found");
});
