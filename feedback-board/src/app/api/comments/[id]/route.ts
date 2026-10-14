import { tx } from "@/lib/db";
import { authorHash, json, route, uuid, HttpError } from "@/lib/http";
import { recountComments } from "@/lib/moderation";

export const DELETE = route(async (req, { params }) => {
  const id = uuid(params.id);
  const hash = authorHash((await json(req)).author_token);
  await tx(async (q) => {
    const { rows } = await q(
      `UPDATE comments SET status='deleted', deleted_at=date_trunc('minute', now())
       WHERE id=$1 AND author_hash=$2 AND status<>'deleted' RETURNING feedback_id`,
      [id, hash]
    );
    if (!rows.length) throw new HttpError(403, "You can only delete your own comments from the browser that created them");
    await recountComments(q as never, rows[0].feedback_id);
  });
});
