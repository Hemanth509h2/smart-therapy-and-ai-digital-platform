import { pool } from "@/lib/db";
import { authorHash, json, route, uuid, HttpError } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, { params }) => {
  const { rows } = await pool().query(
    `SELECT id, category, body, vote_count, comment_count, created_at FROM feedback WHERE id=$1 AND status='visible'`,
    [uuid(params.id)]
  );
  if (!rows.length) throw new HttpError(404, "Feedback not found");
  return rows[0];
});

export const DELETE = route(async (req, { params }) => {
  const id = uuid(params.id);
  const b = await json(req);
  const { rowCount } = await pool().query(
    `UPDATE feedback SET status='deleted', deleted_at=date_trunc('minute', now())
     WHERE id=$1 AND author_hash=$2 AND status<>'deleted'`,
    [id, authorHash(b.author_token)]
  );
  if (!rowCount) throw new HttpError(403, "You can only delete your own posts from the browser that created them");
});
