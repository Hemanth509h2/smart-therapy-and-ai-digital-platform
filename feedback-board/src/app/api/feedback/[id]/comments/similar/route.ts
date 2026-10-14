import { pool } from "@/lib/db";
import { json, route, str, uuid } from "@/lib/http";

// Server fallback for threads over 300 comments. The draft is only used in this query; never stored or logged.
export const POST = route(async (req, { params }) => {
  const id = uuid(params.id);
  const b = await json(req);
  const draft = str(b.draft, "draft", 12, 1000);
  try {
    const { rows } = await pool().query(
      `SELECT id, body, is_op, vote_count, created_at FROM comments
       WHERE feedback_id=$1 AND status='visible' AND similarity(body, $2) >= 0.45
       ORDER BY similarity(body, $2) DESC LIMIT 3`,
      [id, draft]
    );
    return { items: rows };
  } catch {
    return { items: [] }; // pg_trgm unavailable: suggestions are optional
  }
});
