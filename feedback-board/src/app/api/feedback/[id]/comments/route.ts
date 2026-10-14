import { pool, tx } from "@/lib/db";
import { HOUR, authorHash, captcha, json, limit, route, str, uuid, HttpError } from "@/lib/http";
import { screen } from "@/lib/filter";
import { recountComments } from "@/lib/moderation";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, { params }) => {
  const id = uuid(params.id);
  const { rows } = await pool().query(
    `SELECT c.id, c.parent_id, CASE WHEN c.status='visible' THEN c.body END AS body,
            (c.status<>'visible') AS removed, c.is_op, c.vote_count, c.created_at
     FROM comments c
     WHERE c.feedback_id=$1
       AND (c.status='visible' OR EXISTS (SELECT 1 FROM comments r WHERE r.parent_id=c.id AND r.status='visible'))
     ORDER BY c.created_at, c.id`,
    [id]
  );
  return { items: rows };
});

export const POST = route(async (req, { params }) => {
  const id = uuid(params.id);
  limit(req, "comment", 20, HOUR);
  await captcha(req);
  const b = await json(req);
  const body = str(b.body, "body", 1, 1000);
  screen(body);
  const hash = authorHash(b.author_token);
  const parentId = b.parent_id == null ? null : uuid(b.parent_id, "parent_id");

  return tx(async (q) => {
    const post = await q(`SELECT author_hash FROM feedback WHERE id=$1 AND status='visible' FOR UPDATE`, [id]);
    if (!post.rowCount) throw new HttpError(404, "Feedback not found");
    // One level of replies, like YouTube: replying to a reply attaches to its top-level comment.
    let parent: string | null = null;
    if (parentId) {
      const p = await q(`SELECT COALESCE(parent_id, id) AS root FROM comments WHERE id=$1 AND feedback_id=$2 AND status='visible'`, [parentId, id]);
      if (!p.rowCount) throw new HttpError(404, "Comment not found");
      parent = p.rows[0].root;
    }
    const { rows } = await q(
      `INSERT INTO comments (feedback_id, parent_id, body, author_hash, is_op) VALUES ($1,$2,$3,$4,$5)
       RETURNING id, parent_id, body, is_op, vote_count, created_at`,
      [id, parent, body, hash, post.rows[0].author_hash === hash]
    );
    await recountComments(q as never, id);
    return rows[0];
  });
});
