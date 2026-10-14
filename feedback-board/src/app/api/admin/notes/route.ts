import { pool } from "@/lib/db";
import { requireAdmin, route, HttpError } from "@/lib/http";

export const dynamic = "force-dynamic";
const PAGE = 30;

/** Admin: every note (visible and hidden) with its open report count, newest first. */
export const GET = route(async (req) => {
  requireAdmin(req);
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") ?? "all";
  if (!["all", "visible", "hidden"].includes(status)) throw new HttpError(400, "Invalid status");
  const offset = Math.max(0, parseInt(sp.get("cursor") ?? "0", 10) || 0);
  const { rows } = await pool().query(
    `SELECT f.id, f.category, f.body, f.status, f.vote_count, f.comment_count, f.created_at,
            (SELECT count(*)::int FROM reports r WHERE r.target_id = f.id AND NOT r.resolved) AS open_reports
     FROM feedback f
     WHERE f.status <> 'deleted' AND ($1 = 'all' OR f.status = $1)
     ORDER BY f.created_at DESC, f.id
     LIMIT $2 OFFSET $3`,
    [status, PAGE + 1, offset]
  );
  return { items: rows.slice(0, PAGE), nextCursor: rows.length > PAGE ? String(offset + PAGE) : null };
});
