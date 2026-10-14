import { pool } from "@/lib/db";
import { requireAdmin, route, uuid } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Admin: all replies on a note, including hidden ones. */
export const GET = route(async (req, { params }) => {
  requireAdmin(req);
  const { rows } = await pool().query(
    `SELECT c.id, c.body, c.status, c.is_op, c.vote_count, c.created_at,
            (SELECT count(*)::int FROM reports r WHERE r.target_id = c.id AND NOT r.resolved) AS open_reports
     FROM comments c
     WHERE c.feedback_id = $1 AND c.status <> 'deleted'
     ORDER BY c.created_at, c.id`,
    [uuid(params.id)]
  );
  return { items: rows };
});
